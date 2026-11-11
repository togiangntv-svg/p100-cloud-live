import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extname } from 'node:path';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { FakeClock, fakeAuthority, OWNER_A, OWNER_B } from './fixtures/local-owner.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier,
      context);
  },
});

let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls++;
  throw Error('NETWORK_FORBIDDEN_IN_APP_COMPOSITION_TEST');
};

const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { createLocalWalkResource, W01 } = await import('../domain/m6/walk-resource.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const { createTrainerRuntimeAppHost } = await import('../domain/trainer-runtime/app-host.ts');

const tick = () => new Promise(resolve => setImmediate(resolve));

const meaning = Object.freeze({
  intent_type: 'GOAL', interpreted_meaning: 'Khỏe hơn', confidence: 0.95,
  uncertainty: null, missing_context: [], clarification_needed: false,
  clarification_question: null, safety_state: 'CLEAR', suggested_next_role: 'M4',
  task_kind: 'general_health', context_effect: 'NONE', used_context_ids: [],
  response: 'Đã ghi nhận.',
});

const walkFacts = Object.freeze({
  source_ref: 'app-host-walk-context', intent: 'SHORT_LIGHT_MOVEMENT',
  walking_choice: 'WANTS_WALK', adult: 'REPORTED_ADULT',
  mobility: 'INDEPENDENT_COMFORTABLE_WALKING', concerns: 'NONE_REPORTED',
  professional_limits: 'NONE_REPORTED', setting: 'INDOOR_FLAT_CLEAR_LIT_DRY_STOPPABLE',
  competing_activity: 'NONE', footwear: 'FAMILIAR_SECURE', available_minutes: 20,
  requested_minutes: 5, currency: 'CURRENT',
});

const outcomeReport = (changes = {}) => Object.freeze({
  request_id: 'app-host-outcome', execution_extent: 'DID', action_change: 'UNCHANGED',
  user_stopped: false, problem_state: 'NO_PROBLEM_REPORTED', safety_disposition: 'CLEAR',
  constraint: 'TIME_CONSTRAINT', occurred_at: 700, evidence_text: 'PRIVATE_NOT_FOR_NEXT_CYCLE',
  ...changes,
});

const submitted = request_id => Object.freeze({ type: 'USER_SUBMITTED_OUTCOME', request_id });
const allowed = request_id => Object.freeze({ type: 'USER_ALLOWED_NEXT_CYCLE', request_id });

async function ownerFixture(owner = OWNER_A, validUntil = 100_000) {
  const clock = new FakeClock();
  const authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner, validUntil });
  const lease = await boundary.control.verifySession();
  boundary.control.finishHydration(lease);
  return { clock, authority, boundary, binding: Object.freeze({ access: boundary.access, lease }) };
}

async function replaceOwner(owner, identity, validUntil = 100_000) {
  owner.authority.results.push({ status: 'verified', owner: identity, validUntil });
  const lease = await owner.boundary.control.verifySession();
  owner.boundary.control.finishHydration(lease);
  return Object.freeze({ access: owner.boundary.access, lease });
}

function localAdapter(captures, cycle) {
  return Object.freeze({
    provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    interpret(input) {
      captures[cycle].push(input.content);
      return Promise.resolve(meaning);
    },
    async revoke() {},
  });
}

async function hostFixture() {
  const owner = await ownerFixture();
  const walkResource = createLocalWalkResource();
  const captures = { A: [], B: [] };
  const stores = [];
  const host = createTrainerRuntimeAppHost({
    createStore(input) {
      const store = createSessionTaskStore({
        adapter: localAdapter(captures, input.cycle),
        now: owner.clock.now,
        ownerSession: input.binding,
        walkResource: walkResource.access,
        m7Purpose: input.m7Purpose,
        m7NextCycle: input.m7NextCycle,
      });
      stores.push({ cycle: input.cycle, store });
      return store;
    },
  });
  host.setBinding(owner.binding);
  assert.equal(host.getSnapshot().state, 'READY');
  return { owner, walkResource, captures, stores, host };
}

async function prepareCycleA(f) {
  const cycle = f.host.getSnapshot().cycle_a;
  const task = cycle.store.submit('Khỏe hơn', { permission_granted: true });
  await tick();
  await tick();
  assert.ok(task);
  let ref = cycle.store.reference(task);
  const m4 = cycle.store.assessM4GoalReadiness(ref);
  const m5 = cycle.store.assessM5Goal(ref, m4);
  const choice = cycle.store.acceptM5Goal(ref, m5);
  assert.ok(choice);
  ref = cycle.store.reference(task);
  assert.equal(cycle.store.selfWalk.reportContext(ref, walkFacts), true);
  const proposal = cycle.store.selfWalk.propose(ref, 'app-host-proposal-a');
  assert.equal(proposal.state, 'PROPOSED');
  const started = cycle.store.selfWalk.chooseAndStart(ref, proposal, 'app-host-start-a');
  assert.equal(started.state, 'STARTED');
  return { cycle, task, ref, m4, m5, choice, proposal, started };
}

async function recordCycleA(f) {
  const prepared = await prepareCycleA(f);
  const grant = prepared.cycle.m7.submitOutcome(submitted('app-host-submit-outcome'));
  assert.equal(grant.state, 'GRANTED');
  const outcome = prepared.cycle.store.m7Outcome.report(prepared.ref, grant.receipt,
    outcomeReport());
  assert.equal(outcome.state, 'ACTIVE');
  return { ...prepared, recordReceipt: grant.receipt, outcome };
}

async function readyForB() {
  const f = await hostFixture();
  const a = await recordCycleA(f);
  const next = a.cycle.m7.allowNextCycle(allowed('app-host-allow-next'));
  assert.equal(next.state, 'GRANTED');
  const created = f.host.control.createNextCycleFromA();
  assert.equal(created.state, 'CREATED');
  return { ...f, a, nextReceipt: next.receipt, b: created.cycle };
}

test('01 layout keeps TrainerRuntimeProvider directly inside OwnerSessionProvider', async () => {
  const layout = await readFile(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(layout,
    /<OwnerSessionProvider>\s*<TrainerRuntimeProvider>\s*<WelcomeProvider>/u);
});

test('02 canonical host uses Two-Cycle runtime and not the legacy coordinator', async () => {
  const provider = await readFile(new URL('../context/TrainerRuntimeContext.tsx', import.meta.url),
    'utf8');
  const adapter = await readFile(new URL('../domain/trainer-runtime/app-host.ts', import.meta.url),
    'utf8');
  assert.match(provider, /createTrainerRuntimeAppHost/u);
  assert.match(adapter, /createTrainerTwoCycleRuntime/u);
  assert.doesNotMatch(`${provider}\n${adapter}`, /createTrainerRuntimeCoordinator/u);
});

test('03 no owner binding keeps the app host unavailable', () => {
  const host = createTrainerRuntimeAppHost();
  assert.deepEqual(host.getSnapshot(), { state: 'UNAVAILABLE' });
});

test('04 a valid owner binding installs Cycle A only', async () => {
  const f = await hostFixture();
  const snapshot = f.host.getSnapshot();
  assert.equal(snapshot.state, 'READY');
  assert.equal(snapshot.cycle_a.id, 'A');
  assert.equal(snapshot.cycle_b, undefined);
});

test('05 app-host construction grants no M7 purpose', async () => {
  const f = await hostFixture();
  const authority = f.host.getSnapshot().cycle_a.m7.getSnapshot();
  assert.equal(authority.record_outcome_receipt, undefined);
  assert.equal(authority.use_next_cycle_receipt, undefined);
  assert.equal(authority.request_count, 0);
});

test('06 render, rerender, locale, welcome and subscription equivalents never auto-create B',
  async () => {
    const owner = await ownerFixture();
    const host = createTrainerRuntimeAppHost();
    let notifications = 0;
    host.subscribe(() => { notifications++; });
    host.setBinding(owner.binding);
    assert.equal(notifications, 1);
    assert.equal(host.getSnapshot().cycle_b, undefined);
    host.setBinding(Object.freeze({ access: owner.binding.access, lease: owner.binding.lease }));
    let locale = 'vi';
    let welcomeOpen = true;
    locale = 'en';
    welcomeOpen = false;
    assert.equal(`${locale}:${welcomeOpen}`, 'en:false');
    assert.equal(host.getSnapshot().cycle_b, undefined);
    const provider = await readFile(new URL('../context/TrainerRuntimeContext.tsx', import.meta.url),
      'utf8');
    assert.doesNotMatch(provider, /useWelcome|useLocale|Localization|Keyboard|router|pathname/u);
  });

test('07 narrow control delegates only A to the canonical domain operation', async () => {
  const host = createTrainerRuntimeAppHost();
  assert.deepEqual(Object.keys(host.control), ['createNextCycleFromA']);
  assert.deepEqual(host.control.createNextCycleFromA(),
    { state: 'DENIED', reason: 'OWNER_UNAVAILABLE' });
  const adapter = await readFile(new URL('../domain/trainer-runtime/app-host.ts', import.meta.url),
    'utf8');
  assert.match(adapter, /createNextCycleFromA:\s*\(\)\s*=>\s*runtime\.createNextCycle\('A'\)/u);
  assert.doesNotMatch(adapter, /readNextCycle|record_outcome|use_next_cycle|\.grant\s*\(|retry/iu);
});

test('08 without an ACTIVE outcome the host denies Cycle B', async () => {
  const f = await hostFixture();
  assert.deepEqual(f.host.control.createNextCycleFromA(),
    { state: 'DENIED', reason: 'OUTCOME_UNAVAILABLE' });
  assert.equal(f.host.getSnapshot().cycle_b, undefined);
});

test('09 without USE_NEXT_CYCLE the host denies Cycle B', async () => {
  const f = await hostFixture();
  await recordCycleA(f);
  assert.deepEqual(f.host.control.createNextCycleFromA(),
    { state: 'DENIED', reason: 'USE_NEXT_CYCLE_REQUIRED' });
  assert.equal(f.host.getSnapshot().cycle_b, undefined);
});

test('10 valid outcome plus explicit USE_NEXT_CYCLE creates Cycle B', async () => {
  const f = await readyForB();
  assert.equal(f.host.getSnapshot().cycle_b, f.b);
});

test('11 after B, A is retained-only and B remains independently usable', async () => {
  const f = await readyForB();
  assert.equal(f.a.cycle.store.submit('A must not act again', { permission_granted: true }), undefined);
  assert.equal(f.a.cycle.store.assessM4GoalReadiness(
    f.a.cycle.store.reference(f.a.task)).decision.reason, 'STALE_TASK');
  const bTask = f.b.store.submit('B remains usable', { permission_granted: true });
  await tick();
  await tick();
  assert.ok(bTask);
  assert.ok(f.b.store.reference(bTask));
});

test('12 second advance request is deterministically bounded by TWO_CYCLE_LIMIT', async () => {
  const f = await readyForB();
  assert.deepEqual(f.host.control.createNextCycleFromA(),
    { state: 'UNSUPPORTED', reason: 'TWO_CYCLE_LIMIT' });
});

test('13 owner generation change retires both cycles', async () => {
  const f = await readyForB();
  const oldA = f.a.cycle;
  const oldB = f.b;
  await replaceOwner(f.owner, OWNER_A);
  assert.equal(f.host.getSnapshot().state, 'UNAVAILABLE');
  assert.equal(oldA.m7.getSnapshot().state, 'RETIRED');
  assert.equal(oldB.m7.getSnapshot().state, 'RETIRED');
  assert.equal(oldA.store.getSnapshot().session_id, null);
  assert.equal(oldB.store.getSnapshot().session_id, null);
});

test('14 owner A to B replacement yields one fresh A and no B', async () => {
  const f = await readyForB();
  const oldA = f.a.cycle;
  const oldB = f.b;
  const bindingB = await replaceOwner(f.owner, OWNER_B);
  f.host.setBinding(bindingB);
  const fresh = f.host.getSnapshot();
  assert.equal(fresh.state, 'READY');
  assert.equal(fresh.cycle_b, undefined);
  assert.notEqual(fresh.cycle_a, oldA);
  assert.equal(oldA.m7.getSnapshot().state, 'RETIRED');
  assert.equal(oldB.m7.getSnapshot().state, 'RETIRED');
});

test('15 binding removal or logout retires A and B', async () => {
  const f = await readyForB();
  const oldA = f.a.cycle;
  const oldB = f.b;
  f.host.setBinding(undefined);
  assert.equal(f.host.getSnapshot().state, 'UNAVAILABLE');
  assert.equal(oldA.m7.getSnapshot().state, 'RETIRED');
  assert.equal(oldB.m7.getSnapshot().state, 'RETIRED');
});

test('16 Strict Mode setup-cleanup-setup cannot revive old cycles', async () => {
  const f = await readyForB();
  const oldA = f.a.cycle;
  const oldB = f.b;
  f.host.setBinding(undefined);
  f.host.setBinding(f.owner.binding);
  const fresh = f.host.getSnapshot();
  assert.equal(fresh.state, 'READY');
  assert.equal(fresh.cycle_b, undefined);
  assert.notEqual(fresh.cycle_a, oldA);
  assert.equal(oldA.m7.getSnapshot().state, 'RETIRED');
  assert.equal(oldB.m7.getSnapshot().state, 'RETIRED');
});

test('17 old refs, receipts and namespaces cannot authorize a fresh runtime', async () => {
  const f = await readyForB();
  const oldRef = f.a.ref;
  const oldReceipt = f.a.recordReceipt;
  const oldASession = f.a.cycle.store.getSnapshot().session_id;
  const oldBSession = f.b.store.getSnapshot().session_id;
  f.host.setBinding(undefined);
  f.host.setBinding(f.owner.binding);
  const fresh = f.host.getSnapshot().cycle_a;
  assert.notEqual(fresh.store.getSnapshot().session_id, oldASession);
  assert.notEqual(fresh.store.getSnapshot().session_id, oldBSession);
  assert.equal(fresh.store.assessM4GoalReadiness(oldRef).decision.reason, 'STALE_TASK');
  assert.notEqual(fresh.store.m7Outcome.getSnapshot(oldReceipt).state, 'ACTIVE');
});

test('18 throwing subscriber is isolated and later subscribers still observe lifecycle', async () => {
  const f = await hostFixture();
  const a = await recordCycleA(f);
  let laterNotifications = 0;
  f.host.subscribe(() => { throw Error('EXPECTED_APP_HOST_OBSERVER_FAILURE'); });
  f.host.subscribe(() => { laterNotifications++; });
  assert.equal(a.cycle.m7.allowNextCycle(allowed('app-host-observer-next')).state, 'GRANTED');
  const created = f.host.control.createNextCycleFromA();
  assert.equal(created.state, 'CREATED');
  assert.equal(laterNotifications, 1);
  assert.equal(f.host.getSnapshot().cycle_b, created.cycle);
  assert.equal(a.cycle.store.submit('observer cannot reopen A'), undefined);
});

test('19 provider exposes safe runtime view plus bounded commands, not raw cycle authority', async () => {
  const provider = await readFile(new URL('../context/TrainerRuntimeContext.tsx', import.meta.url),
    'utf8');
  assert.match(provider, /useTrainerRuntime\(\): TrainerRuntimeView/u);
  assert.match(provider, /useTrainerRuntimeControl\(\): TrainerRuntimeControl/u);
  assert.doesNotMatch(provider, /Provider value=\{host\}|Provider value=\{binding\}/u);
  assert.doesNotMatch(provider, /session_id|subjectId|profileId|validUntil|dispose/u);
  assert.match(provider, /current_cycle:\s*runtime\.cycle_b\s*\?\s*'B'\s*:\s*'A'/u);
  const f = await hostFixture();
  assert.deepEqual(Object.keys(f.host.control), ['createNextCycleFromA']);
});

test('20 production app host does not activate real W01', async () => {
  const owner = await ownerFixture();
  const host = createTrainerRuntimeAppHost();
  host.setBinding(owner.binding);
  const a = host.getSnapshot().cycle_a;
  assert.equal(W01.real_user_activation, false);
  assert.equal(a.store.selfWalk.chooseAndStart(undefined, {}, 'forbidden-real-w01').state, 'DENIED');
  const adapter = await readFile(new URL('../domain/trainer-runtime/app-host.ts', import.meta.url),
    'utf8');
  assert.doesNotMatch(adapter, /createLocalWalkResource|walkResource\s*:/u);
});

test('21 verifier and app composition perform no provider or live network call', () => {
  assert.equal(networkCalls, 0);
});

test('22 app composition adds no persistence or unbounded history', async () => {
  const provider = await readFile(new URL('../context/TrainerRuntimeContext.tsx', import.meta.url),
    'utf8');
  const adapter = await readFile(new URL('../domain/trainer-runtime/app-host.ts', import.meta.url),
    'utf8');
  assert.doesNotMatch(`${provider}\n${adapter}`,
    /AsyncStorage|localStorage|sessionStorage|indexedDB|SQLite|writeFile|new Map/u);
});

test('23 app composition changes no Camera, Identity, UI or localization semantics', async () => {
  const provider = await readFile(new URL('../context/TrainerRuntimeContext.tsx', import.meta.url),
    'utf8');
  const adapter = await readFile(new URL('../domain/trainer-runtime/app-host.ts', import.meta.url),
    'utf8');
  assert.doesNotMatch(`${provider}\n${adapter}`,
    /Camera|ImagePicker|Identity|AppleAuthentication|useWelcome|useLocale|translations|OpeningGoal/u);
});

test('24 Cycle B has independent store namespace and M7 authority', async () => {
  const f = await readyForB();
  assert.notEqual(f.a.cycle.store, f.b.store);
  assert.notEqual(f.a.cycle.store.getSnapshot().session_id, f.b.store.getSnapshot().session_id);
  assert.notEqual(f.a.cycle.m7, f.b.m7);
  assert.equal(f.b.m7.getSnapshot().record_outcome_receipt, undefined);
  assert.equal(f.b.m7.getSnapshot().use_next_cycle_receipt, undefined);
  assert.equal(f.b.store.assessM4GoalReadiness(f.a.ref).decision.reason, 'STALE_TASK');
});
