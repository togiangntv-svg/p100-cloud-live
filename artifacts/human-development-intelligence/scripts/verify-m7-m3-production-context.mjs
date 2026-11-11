import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extname } from 'node:path';
import { registerHooks } from 'node:module';
import { FakeClock, fakeAuthority, OWNER_A, OWNER_B } from './fixtures/local-owner.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@workspace/api-client-react') {
      // The injected HTTP seam is the boundary under test; generated React
      // Query clients are deliberately unreachable and never provider-backed.
      return {
        url: 'data:text/javascript,export const aiM3=()=>{throw Error("CLIENT_FORBIDDEN")};export const aiPilotSession=aiM3',
        shortCircuit: true,
      };
    }
    return nextResolve(specifier.startsWith('.') && (!extname(specifier) || specifier.endsWith('/api.schemas'))
      ? specifier + '.ts' : specifier, context);
  },
});

let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls += 1;
  throw new Error('NETWORK_FORBIDDEN_IN_M7_M3_PRODUCTION_CONTEXT_TEST');
};

const { parseM3Request } = await import('../../../lib/api-zod/src/m3-contract.ts');
const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const { createLocalWalkResource } = await import('../domain/m6/walk-resource.ts');
const { createLocalM7PurposeAuthority } = await import('../domain/m7/outcome.ts');
const { createM7NextCycleConsumer, readM7NextCycleContext } = await import('../domain/m7/next-cycle.ts');
const { createM3GatewayAdapter } = await import('../domain/m3/gateway-adapter.ts');

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function eventually(read, accept, message) {
  for (let index = 0; index < 40; index += 1) {
    const value = read();
    if (accept(value)) return value;
    await tick();
  }
  assert.fail(message);
}

const walkFacts = (changes = {}) => ({
  source_ref: 'walk-context-1', intent: 'SHORT_LIGHT_MOVEMENT', walking_choice: 'WANTS_WALK',
  adult: 'REPORTED_ADULT', mobility: 'INDEPENDENT_COMFORTABLE_WALKING', concerns: 'NONE_REPORTED',
  professional_limits: 'NONE_REPORTED', setting: 'INDOOR_FLAT_CLEAR_LIT_DRY_STOPPABLE',
  competing_activity: 'NONE', footwear: 'FAMILIAR_SECURE', available_minutes: 20,
  requested_minutes: 5, currency: 'CURRENT', ...changes,
});
const report = (changes = {}) => ({
  request_id: 'outcome-1', execution_extent: 'PARTIAL', action_change: 'UNCHANGED',
  user_stopped: false, problem_state: 'NO_PROBLEM_REPORTED', safety_disposition: 'CLEAR',
  constraint: 'TIME_CONSTRAINT', performed_minutes: 3, occurred_at: 700, ...changes,
});
const goalMeaning = Object.freeze({
  intent_type: 'GOAL', interpreted_meaning: 'Improve health', confidence: 0.95,
  uncertainty: null, missing_context: [], clarification_needed: false, clarification_question: null,
  safety_state: 'CLEAR', suggested_next_role: 'M4', task_kind: 'general_health', context_effect: 'NONE',
  used_context_ids: [], response: 'Noted.',
});
const responseFor = (body) => ({
  version: body.version, requestId: body.requestId, sessionId: body.sessionId, taskId: body.taskId,
  taskRevision: body.taskRevision, permissionRevision: body.permissionRevision,
  intentType: body.input.safety_signal === 'CLEAR' ? 'GOAL' : 'SAFETY',
  interpretedMeaning: 'Bounded production gateway fixture', confidence: 0.9, uncertainty: null,
  missingContext: [], clarificationNeeded: false, clarificationQuestion: null,
  safetyState: body.input.safety_signal,
  suggestedNextRole: body.input.safety_signal === 'CLEAR' ? 'M4' : 'STOP',
  taskKind: 'general_health', contextEffect: 'NONE', usedContextIds: [], response: 'Noted.',
  usage: { inputTokens: 1, outputTokens: 1 },
});
const content = (changes = {}) => ({
  locale: 'vi', current_text: 'Khỏe hơn', relevant_context: [], recent_relevant_turns: [],
  user_correction: null, safety_signal: 'CLEAR', asking_stopped: false, ...changes,
});
const operation = (changes = {}) => ({
  ticket: { session_id: 'session-1', task_id: 'task-1', task_revision: 1,
    permission_revision: 2, operation_id: 'operation-1' },
  permission: { external_access: 'M3_TEXT', purpose: 'm3_intent_understanding', revision: 2 },
  isCurrent: () => true,
  ...changes,
});

function gatewayHarness({ current = () => true, defer = false } = {}) {
  const requests = [];
  let release;
  const gate = defer ? new Promise((resolve) => { release = resolve; }) : undefined;
  let httpCalls = 0;
  const adapter = createM3GatewayAdapter({
    origin: 'https://m7-m3.invalid', provenance: 'TEST_FIXTURE', isSessionCurrent: current,
    async http(url, init) {
      httpCalls += 1;
      if (url.endsWith('/api/ai/session')) {
        const session = JSON.parse(init.body);
        assert.deepEqual(session.consent,
          { granted: true, version: 'm3.v1', purpose: 'm3_intent_understanding' });
        return { ok: true, status: 200, async json() { return {}; } };
      }
      const body = JSON.parse(init.body);
      parseM3Request(body);
      requests.push(body);
      if (gate) await gate;
      return { ok: true, status: 200, async json() { return responseFor(body); } };
    },
  });
  return { adapter, requests, release: () => release?.(), httpCalls: () => httpCalls };
}

async function priorFixture(outcomeChanges = {}) {
  const clock = new FakeClock();
  const authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner: OWNER_A, validUntil: 100000 });
  const lease = await boundary.control.verifySession();
  boundary.control.finishHydration(lease);
  const ownerBinding = Object.freeze({ access: boundary.access, lease });
  const resource = createLocalWalkResource();
  const purpose = createLocalM7PurposeAuthority();
  const oldAdapter = Object.freeze({
    provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    async interpret() { return goalMeaning; }, async revoke() {},
  });
  const oldStore = createSessionTaskStore({ adapter: oldAdapter, now: clock.now,
    ownerSession: ownerBinding, walkResource: resource.access, m7Purpose: purpose.access });
  oldStore.start();
  const oldTask = oldStore.submit('Khỏe hơn', { permission_granted: true });
  await tick();
  let oldRef = oldStore.reference(oldTask);
  oldStore.acceptM5Goal(oldRef, oldStore.assessM5Goal(oldRef, oldStore.assessM4GoalReadiness(oldRef)));
  oldRef = oldStore.reference(oldTask);
  oldStore.selfWalk.reportContext(oldRef, walkFacts());
  const proposal = oldStore.selfWalk.propose(oldRef, 'proposal-1');
  oldStore.selfWalk.chooseAndStart(oldRef, proposal, 'start-1');
  const recordReceipt = purpose.control.grant('RECORD_OUTCOME');
  const nextReceipt = purpose.control.grant('USE_NEXT_CYCLE');
  const outcome = oldStore.m7Outcome.report(oldRef, recordReceipt, report(outcomeChanges));
  const consumer = createM7NextCycleConsumer(ownerBinding,
    () => oldStore.m7Outcome.readNextCycle(nextReceipt));
  return { clock, authority, boundary, lease, ownerBinding, resource, purpose, recordReceipt,
    nextReceipt, oldStore, oldRef, outcome, consumer };
}

function currentHarness(f, { binding = f.ownerBinding, defer = false } = {}) {
  let store;
  const wire = gatewayHarness({
    defer,
    current: (sessionId) => store?.getSnapshot().session_id === sessionId,
  });
  store = createSessionTaskStore({ adapter: wire.adapter, now: f.clock.now,
    ownerSession: binding, walkResource: f.resource.access, m7NextCycle: f.consumer });
  return { store, ...wire };
}

async function submitCurrent(current, options = {}) {
  current.store.start();
  const task = current.store.submit(options.text ?? 'Khỏe hơn vòng mới', {
    permission_granted: options.permissionGranted ?? true,
    permission_revision: options.permissionRevision ?? 2,
  });
  if (options.permissionGranted !== false) {
    await eventually(() => current.requests.length, (length) => length > 0,
      'production M3 request was not captured');
  } else await tick();
  return task;
}

test('01 ordinary current M3 context projects to an exact production request', async () => {
  const wire = gatewayHarness();
  await wire.adapter.interpret({
    content: content({ relevant_context: [{ id: 'workout-1', kind: 'active_task:workout', text: 'Current workout' }] }),
    operation: operation(),
  }, new AbortController().signal);
  const body = wire.requests[0];
  assert.equal(parseM3Request(body), body);
  assert.deepEqual(body.input.relevant_context, [{
    id: 'workout-1', kind: 'workout', text: 'Current workout', permission: 'external_ai_allowed',
  }]);
});

test('02 missing or mismatched M3_TEXT authority sends no session or context', async () => {
  for (const permission of [
    { external_access: 'NONE', purpose: 'm3_intent_understanding', revision: 2 },
    { external_access: 'M3_TEXT', purpose: 'other', revision: 2 },
    { external_access: 'M3_TEXT', purpose: 'm3_intent_understanding', revision: 1 },
  ]) {
    const wire = gatewayHarness();
    await assert.rejects(wire.adapter.interpret({ content: content(),
      operation: operation({ permission }) }, new AbortController().signal), /M3_PERMISSION_DENIED/u);
    assert.equal(wire.httpCalls(), 0);
  }
});

test('03 M7 TIME_CONSTRAINT sends only a bounded exact projection', async () => {
  const f = await priorFixture();
  const internal = readM7NextCycleContext(f.consumer, f.ownerBinding);
  const current = currentHarness(f);
  await submitCurrent(current);
  const body = current.requests[0];
  const projected = body.input.relevant_context[0];
  assert.equal(parseM3Request(body), body);
  assert.deepEqual(Object.keys(projected).sort(), ['id', 'kind', 'permission', 'text']);
  assert.deepEqual(projected, {
    id: 'm7-prior:prior-episode-time-constraint', kind: 'other',
    text: 'PRIOR_EPISODE_TIME_CONSTRAINT', permission: 'external_ai_allowed',
  });
  assert.equal(internal.id.startsWith('m7-prior:'), true);
  assert.equal(internal.episode_ref.episode_key, f.outcome.episode.episode_key);
  assert.equal(internal.provenance.source, 'USER_REPORT');
  assert.equal(JSON.stringify(body).includes(f.outcome.episode.episode_key), false);
  for (const key of ['episode_ref', 'provenance', 'reported_constraint', 'requires_reconfirmation',
    'state', 'performed_minutes', 'proposal_revision', 'source_revision']) {
    assert.equal(key in projected, false, `${key} must remain local`);
  }
});

test('04 denied external permission sends no M7 data and preserves local safety authority', async () => {
  const f = await priorFixture({ problem_state: 'PROBLEM', safety_disposition: 'REASSESS',
    constraint: 'NONE_REPORTED', performed_minutes: undefined });
  const current = currentHarness(f);
  const task = await submitCurrent(current, { permissionGranted: false });
  assert.ok(task);
  assert.equal(current.requests.length, 0);
  assert.equal(current.store.getSnapshot().tasks[0].status, 'PAUSED');
  assert.equal(current.store.getTrainerActionAvailability(), 'SAFETY_HOLD');
  assert.equal(current.store.readM7NextCycleContext(current.store.reference(task)).state, 'SAFETY_HOLD');
});

test('05 valid authority sends bounded safety context without downgrading the signal', async () => {
  for (const [changes, expectedSignal, expectedText] of [
    [{ problem_state: 'PROBLEM', safety_disposition: 'REASSESS', constraint: 'NONE_REPORTED',
      performed_minutes: undefined }, 'SENSITIVE', 'PRIOR_EPISODE_SAFETY_REASSESSMENT_REQUIRED'],
    [{ problem_state: 'PROBLEM', safety_disposition: 'URGENT_HELP', constraint: 'NONE_REPORTED',
      performed_minutes: undefined }, 'SENSITIVE', 'PRIOR_EPISODE_URGENT_HELP_REASSESSMENT_REQUIRED'],
  ]) {
    const f = await priorFixture(changes);
    const current = currentHarness(f);
    await submitCurrent(current);
    const body = current.requests[0];
    assert.equal(body.input.safety_signal, expectedSignal);
    assert.deepEqual(body.input.relevant_context[0], {
      id: `m7-prior:${expectedText.toLowerCase().replaceAll('_', '-')}`,
      kind: 'other', text: expectedText, permission: 'external_ai_allowed',
    });
  }
});

async function pendingInvalidation(mutate) {
  const f = await priorFixture();
  const current = currentHarness(f, { defer: true });
  const task = await submitCurrent(current);
  assert.equal(current.requests[0].input.relevant_context.length, 1);
  await mutate(f);
  current.release();
  const settled = await eventually(
    () => current.store.getSnapshot().tasks.find((value) => value.task_id === task),
    (value) => value && value.status !== 'NEEDS_ROUTING',
    'stale production request did not settle',
  );
  assert.equal(settled.interpretation, undefined);
}

test('06 USE_NEXT_CYCLE revoke invalidates a pending production result', async () => {
  await pendingInvalidation((f) => f.purpose.control.revoke('USE_NEXT_CYCLE'));
});

test('07 RECORD_OUTCOME revoke, delete and retraction invalidate pending results', async () => {
  await pendingInvalidation((f) => f.purpose.control.revoke('RECORD_OUTCOME'));
  await pendingInvalidation((f) => f.oldStore.m7Outcome.delete(
    f.oldRef, f.recordReceipt, f.outcome.revision, 'delete-pending'));
  await pendingInvalidation((f) => f.oldStore.m7Outcome.retract(
    f.oldRef, f.recordReceipt, f.outcome.revision, 'retract-pending'));
});

test('08 a correction cannot leave stale prior text in a later production request', async () => {
  const f = await priorFixture();
  const pending = currentHarness(f, { defer: true });
  await submitCurrent(pending);
  assert.equal(pending.requests[0].input.relevant_context[0].text, 'PRIOR_EPISODE_TIME_CONSTRAINT');
  f.oldStore.m7Outcome.correct(f.oldRef, f.recordReceipt, f.outcome.revision,
    report({ request_id: 'correct-1', constraint: 'OTHER_CONSTRAINT', performed_minutes: undefined }));
  pending.release();
  await tick(); await tick();
  const later = currentHarness(f);
  await submitCurrent(later);
  assert.equal(later.requests[0].input.relevant_context[0].text, 'PRIOR_EPISODE_OTHER_CONSTRAINT');
  assert.equal(JSON.stringify(later.requests[0]).includes('PRIOR_EPISODE_TIME_CONSTRAINT'), false);
});

test('09 wrong owner cannot send the prior owner context', async () => {
  const f = await priorFixture();
  const otherClock = new FakeClock();
  const otherAuthority = fakeAuthority();
  const otherBoundary = createLocalOwnerBoundary(otherAuthority.verifier, otherClock);
  otherAuthority.results.push({ status: 'verified', owner: OWNER_B, validUntil: 100000 });
  const otherLease = await otherBoundary.control.verifySession();
  otherBoundary.control.finishHydration(otherLease);
  const current = currentHarness(f, { binding: { access: otherBoundary.access, lease: otherLease } });
  await submitCurrent(current);
  assert.deepEqual(current.requests[0].input.relevant_context, []);
});

test('10 owner generation change and silent lease expiry cannot send or use prior context', async () => {
  const changed = await priorFixture();
  changed.authority.results.push({ status: 'verified', owner: OWNER_B, validUntil: 200000 });
  const next = await changed.boundary.control.verifySession();
  changed.boundary.control.finishHydration(next);
  const changedCurrent = currentHarness(changed);
  changedCurrent.store.start();
  assert.equal(changedCurrent.store.submit('Khỏe hơn', { permission_granted: true, permission_revision: 2 }), undefined);
  assert.equal(changedCurrent.requests.length, 0);

  const expired = await priorFixture();
  expired.clock.jumpWithoutTimers(100000);
  const expiredCurrent = currentHarness(expired);
  expiredCurrent.store.start();
  assert.equal(expiredCurrent.store.submit('Khỏe hơn', { permission_granted: true, permission_revision: 2 }), undefined);
  assert.equal(expiredCurrent.requests.length, 0);
  assert.equal(readM7NextCycleContext(expired.consumer, expired.ownerBinding), undefined);
});

test('11 exact parser still rejects a deliberately leaked internal field', async () => {
  const f = await priorFixture();
  const current = currentHarness(f);
  await submitCurrent(current);
  const body = structuredClone(current.requests[0]);
  body.input.relevant_context[0].episode_ref = { episode_key: 'must-not-cross' };
  assert.throws(() => parseM3Request(body), /M3_SCHEMA_INVALID/u);
});

test('12 no provider or real network is called', () => {
  assert.equal(networkCalls, 0);
});
