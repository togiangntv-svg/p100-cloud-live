import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extname } from 'node:path';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { FakeClock, fakeAuthority, OWNER_A, OWNER_B } from './fixtures/local-owner.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context);
  },
});

let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw Error('NETWORK_FORBIDDEN_IN_TWO_CYCLE_TEST'); };

const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { createLocalWalkResource, W01 } = await import('../domain/m6/walk-resource.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const { createTrainerTwoCycleRuntime } = await import('../domain/trainer-runtime/two-cycle.ts');

const tick = () => new Promise(resolve => setImmediate(resolve));

const meaning = Object.freeze({
  intent_type: 'GOAL', interpreted_meaning: 'Khỏe hơn', confidence: 0.95,
  uncertainty: null, missing_context: [], clarification_needed: false,
  clarification_question: null, safety_state: 'CLEAR', suggested_next_role: 'M4',
  task_kind: 'general_health', context_effect: 'NONE', used_context_ids: [],
  response: 'Đã ghi nhận.',
});

const walkFacts = Object.freeze({
  source_ref: 'two-cycle-walk-context', intent: 'SHORT_LIGHT_MOVEMENT',
  walking_choice: 'WANTS_WALK', adult: 'REPORTED_ADULT',
  mobility: 'INDEPENDENT_COMFORTABLE_WALKING', concerns: 'NONE_REPORTED',
  professional_limits: 'NONE_REPORTED', setting: 'INDOOR_FLAT_CLEAR_LIT_DRY_STOPPABLE',
  competing_activity: 'NONE', footwear: 'FAMILIAR_SECURE', available_minutes: 20,
  requested_minutes: 5, currency: 'CURRENT',
});

const outcomeReport = (changes = {}) => Object.freeze({
  request_id: 'two-cycle-outcome', execution_extent: 'DID', action_change: 'UNCHANGED',
  user_stopped: false, problem_state: 'NO_PROBLEM_REPORTED', safety_disposition: 'CLEAR',
  constraint: 'TIME_CONSTRAINT', occurred_at: 700, evidence_text: 'PRIVATE_NOT_FOR_NEXT_CYCLE',
  ...changes,
});

const submitted = request_id => Object.freeze({ type: 'USER_SUBMITTED_OUTCOME', request_id });
const allowed = request_id => Object.freeze({ type: 'USER_ALLOWED_NEXT_CYCLE', request_id });
const declined = request_id => Object.freeze({ type: 'USER_REVOKED_NEXT_CYCLE', request_id });
const recordRevoked = request_id => Object.freeze({ type: 'TRUSTED_REVOKED_OUTCOME', request_id });

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

function controlledAdapter(label, controls) {
  return Object.freeze({
    provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    interpret(input, signal) {
      controls.captures[label].push(input.content);
      if (!controls.defer[label]) {
        const prior = input.content.relevant_context.find(item => item.kind.startsWith('prior_episode:'));
        return Promise.resolve(Object.freeze({ ...meaning,
          used_context_ids: prior && label === 'B' ? [prior.id] : [],
        }));
      }
      return new Promise((resolve, reject) => {
        controls.pending[label].push({ input, signal, resolve, reject });
      });
    },
    async revoke() {},
  });
}

async function runtimeFixture(options = {}) {
  const owner = await ownerFixture(options.owner ?? OWNER_A, options.validUntil ?? 100_000);
  const resource = createLocalWalkResource();
  const controls = {
    captures: { A: [], B: [] },
    pending: { A: [], B: [] },
    defer: { A: options.deferA === true, B: options.deferB === true },
    stores: [],
    nestedAdvance: undefined,
  };
  let runtime;
  runtime = createTrainerTwoCycleRuntime({
    createStore(input) {
      if (input.cycle === 'B' && options.failBConstruction) throw Error('EXPECTED_B_CONSTRUCTION_FAILURE');
      if (input.cycle === 'B' && options.aliasBToA) return controls.stores[0].store;
      const store = createSessionTaskStore({
        adapter: controlledAdapter(input.cycle, controls),
        now: owner.clock.now,
        ownerSession: input.binding,
        walkResource: resource.access,
        m7Purpose: input.m7Purpose,
        m7NextCycle: input.m7NextCycle,
      });
      controls.stores.push({ cycle: input.cycle, store });
      if (input.cycle === 'B') options.onBStoreCreated?.({ store, owner, controls, runtime });
      return store;
    },
  });
  runtime.setBinding(owner.binding);
  assert.equal(runtime.getSnapshot().state, 'READY');
  return { owner, resource, controls, runtime };
}

async function prepareCycleA(f) {
  const cycle = f.runtime.getSnapshot().cycle_a;
  const task = cycle.store.submit('Khỏe hơn', { permission_granted: true });
  await tick(); await tick();
  assert.ok(task);
  let ref = cycle.store.reference(task);
  const m4 = cycle.store.assessM4GoalReadiness(ref);
  const m5 = cycle.store.assessM5Goal(ref, m4);
  const choice = cycle.store.acceptM5Goal(ref, m5);
  assert.ok(choice);
  ref = cycle.store.reference(task);
  assert.equal(cycle.store.selfWalk.reportContext(ref, walkFacts), true);
  const proposal = cycle.store.selfWalk.propose(ref, 'two-cycle-proposal-a');
  assert.equal(proposal.state, 'PROPOSED');
  const started = cycle.store.selfWalk.chooseAndStart(ref, proposal, 'two-cycle-start-a');
  assert.equal(started.state, 'STARTED');
  return { cycle, task, ref, m4, m5, choice, proposal, started };
}

async function recordCycleA(f, changes = {}) {
  const prepared = await prepareCycleA(f);
  const grant = prepared.cycle.m7.submitOutcome(submitted('two-cycle-submit-outcome'));
  assert.equal(grant.state, 'GRANTED');
  const outcome = prepared.cycle.store.m7Outcome.report(prepared.ref, grant.receipt,
    outcomeReport(changes));
  assert.equal(outcome.state, 'ACTIVE');
  return { ...prepared, recordReceipt: grant.receipt, outcome };
}

async function readyForB(options = {}) {
  const f = await runtimeFixture(options);
  const a = await recordCycleA(f, options.outcomeChanges ?? {});
  const next = a.cycle.m7.allowNextCycle(allowed('two-cycle-allow-next'));
  assert.equal(next.state, 'GRANTED');
  const created = f.runtime.createNextCycle('A');
  assert.equal(created.state, 'CREATED');
  return { ...f, a, nextReceipt: next.receipt, b: created.cycle };
}

async function submitCycleB(f, text = 'Khỏe hơn ở vòng B') {
  const task = f.b.store.submit(text, { permission_granted: true });
  await tick(); await tick();
  return { task, ref: f.b.store.reference(task) };
}

test('01 valid owner runtime starts with Cycle A only', async () => {
  const f = await runtimeFixture();
  const snapshot = f.runtime.getSnapshot();
  assert.equal(snapshot.state, 'READY');
  assert.equal(snapshot.cycle_a.id, 'A');
  assert.equal(snapshot.cycle_b, undefined);
});

test('02 Cycle A authority starts with no M7 grants', async () => {
  const f = await runtimeFixture();
  const authority = f.runtime.getSnapshot().cycle_a.m7.getSnapshot();
  assert.equal(authority.record_outcome_receipt, undefined);
  assert.equal(authority.use_next_cycle_receipt, undefined);
});

test('03 fixture Cycle A reaches valid M5, M6 and W01 start', async () => {
  const f = await runtimeFixture();
  const a = await prepareCycleA(f);
  assert.equal(a.m5.state, 'PROPOSAL');
  assert.equal(a.choice.choice, 'ACCEPTED');
  assert.equal(a.started.action_id, W01.id);
});

test('04 explicit outcome command permits Cycle A report', async () => {
  const f = await runtimeFixture();
  const a = await recordCycleA(f);
  assert.equal(a.outcome.state, 'ACTIVE');
  assert.equal(a.cycle.store.m7Outcome.getSnapshot(a.recordReceipt), a.outcome);
});

test('05 without USE_NEXT_CYCLE Cycle B cannot start', async () => {
  const f = await runtimeFixture();
  await recordCycleA(f);
  assert.deepEqual(f.runtime.createNextCycle('A'),
    { state: 'DENIED', reason: 'USE_NEXT_CYCLE_REQUIRED' });
  assert.equal(f.runtime.getSnapshot().cycle_b, undefined);
});

test('06 explicit allow-next permits Cycle B creation', async () => {
  const f = await readyForB();
  assert.equal(f.runtime.getSnapshot().cycle_b, f.b);
});

test('07 Cycle B store is not Cycle A store', async () => {
  const f = await readyForB();
  assert.notEqual(f.b.store, f.a.cycle.store);
});

test('08 Cycle B local issuer is independent from Cycle A', async () => {
  const f = await readyForB();
  const bTask = f.b.store.submit('B authority proof', { permission_granted: false });
  const bRef = f.b.store.reference(bTask);
  assert.notEqual(bRef, f.a.ref);
  assert.equal(f.b.store.assessM4GoalReadiness(f.a.ref).decision.reason, 'STALE_TASK');
  assert.equal(f.a.cycle.store.assessM4GoalReadiness(bRef).decision.reason, 'STALE_TASK');
});

test('09 Cycle B network namespace differs from Cycle A', async () => {
  const f = await readyForB();
  assert.notEqual(f.a.cycle.store.getSnapshot().session_id, f.b.store.getSnapshot().session_id);
});

test('10 Cycle B M7 authority is independent', async () => {
  const f = await readyForB();
  assert.notEqual(f.a.cycle.m7, f.b.m7);
  assert.notEqual(f.a.cycle.m7.access, f.b.m7.access);
});

test('11 Cycle B starts with no M7 grants', async () => {
  const f = await readyForB();
  assert.equal(f.b.m7.getSnapshot().record_outcome_receipt, undefined);
  assert.equal(f.b.m7.getSnapshot().use_next_cycle_receipt, undefined);
});

test('12 Cycle A M5 receipt cannot authorize Cycle B', async () => {
  const f = await readyForB();
  const current = await submitCycleB(f);
  assert.equal(f.b.store.resolveM6GoalAction(current.ref, f.a.choice), undefined);
});

test('13 Cycle A M6 proposal and start cannot authorize Cycle B', async () => {
  const f = await readyForB();
  const current = await submitCycleB(f);
  assert.equal(f.b.store.selfWalk.chooseAndStart(current.ref, f.a.proposal, 'cross-cycle-start').state,
    'DENIED');
});

test('14 Cycle A TaskRef cannot authorize Cycle B', async () => {
  const f = await readyForB();
  assert.equal(f.b.store.assessM4GoalReadiness(f.a.ref).decision.reason, 'STALE_TASK');
});

test('15 only the authorized bounded fragment crosses A to B', async () => {
  const f = await readyForB();
  await submitCycleB(f);
  const captured = f.controls.captures.B[0];
  assert.equal(captured.relevant_context.length, 1);
  assert.equal(captured.relevant_context[0].kind, 'prior_episode:m7_outcome');
  const wire = JSON.stringify(captured.relevant_context[0]);
  assert.equal(wire.includes('PRIVATE_NOT_FOR_NEXT_CYCLE'), false);
  assert.equal(wire.includes('available_minutes'), false);
  assert.equal(wire.includes('performed_minutes'), false);
});

test('16 prior outcome is historical context, never a current fact', async () => {
  const f = await readyForB();
  const current = await submitCycleB(f);
  const prior = f.b.store.readM7NextCycleContext(current.ref);
  assert.equal(prior.kind, 'prior_episode:m7_outcome');
  assert.equal(prior.text, 'PRIOR_EPISODE_TIME_CONSTRAINT');
  assert.ok(prior.requires_reconfirmation.includes('CURRENT_TIME_AVAILABLE'));
  assert.equal('current_fact' in prior, false);
});

test('17 Cycle B performs fresh M3, M4 and M5 reasoning', async () => {
  const f = await readyForB();
  const current = await submitCycleB(f);
  assert.equal(f.controls.captures.B.length, 1);
  const m4 = f.b.store.assessM4GoalReadiness(current.ref);
  const m5 = f.b.store.assessM5Goal(current.ref, m4);
  assert.equal(m4.decision.state, 'CONTEXT_SUFFICIENT');
  assert.equal(m5.state, 'PROPOSAL');
});

test('18 correcting Cycle A updates the fragment observed by Cycle B', async () => {
  const f = await readyForB();
  const current = await submitCycleB(f);
  const before = f.b.store.readM7NextCycleContext(current.ref);
  const corrected = f.a.cycle.store.m7Outcome.correct(f.a.ref, f.a.recordReceipt,
    f.a.outcome.revision, outcomeReport({ request_id: 'two-cycle-correct', constraint: 'OTHER_CONSTRAINT' }));
  assert.equal(f.b.store.readM7NextCycleContext(current.ref), undefined);
  const after = f.b.store.readM7NextCycleContext(f.b.store.reference());
  assert.equal(corrected.state, 'ACTIVE');
  assert.notEqual(after.id, before.id);
  assert.equal(after.reported_constraint.kind, 'PRIOR_EPISODE_OTHER_CONSTRAINT');
});

test('19 retracting Cycle A removes the fragment from Cycle B', async () => {
  const f = await readyForB();
  const current = await submitCycleB(f);
  const retracted = f.a.cycle.store.m7Outcome.retract(f.a.ref, f.a.recordReceipt,
    f.a.outcome.revision, 'two-cycle-retract');
  assert.equal(retracted.state, 'RETRACTED');
  assert.equal(f.b.store.readM7NextCycleContext(current.ref), undefined);
});

test('20 deleting Cycle A outcome removes the fragment from Cycle B', async () => {
  const f = await readyForB();
  const current = await submitCycleB(f);
  assert.equal(f.a.cycle.store.m7Outcome.delete(f.a.ref, f.a.recordReceipt,
    f.a.outcome.revision, 'two-cycle-delete').state, 'UNKNOWN');
  assert.equal(f.b.store.readM7NextCycleContext(current.ref), undefined);
});

test('21 revoking USE_NEXT_CYCLE removes fragment but retains Cycle A outcome', async () => {
  const f = await readyForB();
  const current = await submitCycleB(f);
  f.a.cycle.m7.revokeNextCycle(declined('two-cycle-revoke-next'));
  assert.equal(f.b.store.readM7NextCycleContext(current.ref), undefined);
  assert.equal(f.a.cycle.store.m7Outcome.getSnapshot(f.a.recordReceipt).state, 'ACTIVE');
});

test('22 revoking RECORD_OUTCOME clears Cycle A outcome and fragment', async () => {
  const f = await readyForB();
  const current = await submitCycleB(f);
  f.a.cycle.m7.revokeRecordOutcome(recordRevoked('two-cycle-revoke-record'));
  assert.equal(f.a.cycle.store.m7Outcome.getSnapshot(f.a.recordReceipt).state, 'DENIED');
  assert.equal(f.b.store.readM7NextCycleContext(current.ref), undefined);
});

test('23 Cycle B grants and revokes do not affect Cycle A', async () => {
  const f = await readyForB();
  const before = f.a.cycle.m7.getSnapshot();
  f.b.m7.submitOutcome(submitted('cycle-b-record'));
  f.b.m7.allowNextCycle(allowed('cycle-b-next'));
  f.b.m7.revokeNextCycle(declined('cycle-b-next-revoke'));
  f.b.m7.revokeRecordOutcome(recordRevoked('cycle-b-record-revoke'));
  assert.equal(f.a.cycle.m7.getSnapshot().record_outcome_receipt, before.record_outcome_receipt);
  assert.equal(f.a.cycle.m7.getSnapshot().use_next_cycle_receipt, before.use_next_cycle_receipt);
});

test('24 Cycle A purpose changes never auto-grant Cycle B', async () => {
  const f = await readyForB();
  f.a.cycle.m7.revokeNextCycle(declined('a-next-revoke-again'));
  f.a.cycle.m7.allowNextCycle(allowed('a-next-fresh'));
  assert.equal(f.b.m7.getSnapshot().record_outcome_receipt, undefined);
  assert.equal(f.b.m7.getSnapshot().use_next_cycle_receipt, undefined);
});

test('25 owner generation change retires Cycle A and B', async () => {
  const f = await readyForB();
  const oldA = f.a.cycle; const oldB = f.b;
  await replaceOwner(f.owner, OWNER_A);
  assert.equal(f.runtime.getSnapshot().state, 'UNAVAILABLE');
  assert.equal(oldA.store.getSnapshot().session_id, null);
  assert.equal(oldB.store.getSnapshot().session_id, null);
  assert.equal(oldA.m7.getSnapshot().state, 'RETIRED');
  assert.equal(oldB.m7.getSnapshot().state, 'RETIRED');
});

test('26 owner A to B retires old cycles before a fresh A-only runtime', async () => {
  const f = await readyForB();
  const oldA = f.a.cycle; const oldB = f.b;
  const bindingB = await replaceOwner(f.owner, OWNER_B);
  assert.equal(oldA.store.getSnapshot().session_id, null);
  assert.equal(oldB.store.getSnapshot().session_id, null);
  f.runtime.setBinding(bindingB);
  const fresh = f.runtime.getSnapshot();
  assert.equal(fresh.state, 'READY');
  assert.equal(fresh.cycle_b, undefined);
  assert.notEqual(fresh.cycle_a, oldA);
});

test('27 silent lease expiry retires both cycles on the next read', async () => {
  const f = await readyForB({ validUntil: 1_010 });
  const oldA = f.a.cycle; const oldB = f.b;
  f.owner.clock.jumpWithoutTimers(11);
  assert.equal(f.runtime.getSnapshot().state, 'UNAVAILABLE');
  assert.equal(oldA.store.getSnapshot().session_id, null);
  assert.equal(oldB.store.getSnapshot().session_id, null);
});

test('28 late Cycle B M3 success after A invalidation cannot commit stale context', async () => {
  const f = await readyForB({ deferB: true });
  const task = f.b.store.submit('B pending success', { permission_granted: true });
  await tick();
  assert.equal(f.controls.pending.B.length, 1);
  f.a.cycle.store.m7Outcome.correct(f.a.ref, f.a.recordReceipt, f.a.outcome.revision,
    outcomeReport({ request_id: 'correct-before-late-success', constraint: 'OTHER_CONSTRAINT' }));
  f.controls.pending.B[0].resolve(meaning);
  await tick(); await tick();
  const stale = f.b.store.getSnapshot().tasks.find(value => value.task_id === task);
  assert.equal(stale.interpretation, undefined);
  assert.equal(f.controls.pending.B.length, 2);
  assert.equal(f.controls.pending.B[1].input.content.relevant_context[0].text,
    'PRIOR_EPISODE_OTHER_CONSTRAINT');
  f.controls.pending.B[1].resolve(meaning);
  await tick(); await tick();
  assert.equal(f.b.store.getSnapshot().tasks.find(value => value.task_id === task).status, 'READY');
});

test('29 late Cycle B M3 failure cannot corrupt Cycle A or cross-cycle authority', async () => {
  const f = await readyForB({ deferB: true });
  const task = f.b.store.submit('B pending failure', { permission_granted: true });
  await tick();
  const retracted = f.a.cycle.store.m7Outcome.retract(f.a.ref, f.a.recordReceipt,
    f.a.outcome.revision, 'retract-before-late-failure');
  f.controls.pending.B[0].reject(Error('EXPECTED_LATE_FAILURE'));
  await tick(); await tick();
  const bTask = f.b.store.getSnapshot().tasks.find(value => value.task_id === task);
  assert.equal(retracted.state, 'RETRACTED');
  assert.equal(f.a.cycle.store.m7Outcome.getSnapshot(f.a.recordReceipt).state, 'RETRACTED');
  assert.equal(bTask.interpretation, undefined);
  assert.equal(f.runtime.getSnapshot().state, 'READY');
  assert.equal(f.b.store.assessM4GoalReadiness(f.a.ref).decision.reason, 'STALE_TASK');
});

test('30 Cycle A remains correctable, retractable and deletable after B exists', async () => {
  const f = await readyForB();
  const corrected = f.a.cycle.store.m7Outcome.correct(f.a.ref, f.a.recordReceipt,
    f.a.outcome.revision, outcomeReport({ request_id: 'a-correct-after-b', constraint: 'NONE_REPORTED' }));
  assert.equal(corrected.state, 'ACTIVE');
  const retracted = f.a.cycle.store.m7Outcome.retract(f.a.ref, f.a.recordReceipt,
    corrected.revision, 'a-retract-after-b');
  assert.equal(retracted.state, 'RETRACTED');
  assert.equal(f.a.cycle.store.m7Outcome.delete(f.a.ref, f.a.recordReceipt,
    retracted.revision, 'a-delete-after-b').state, 'UNKNOWN');
});

test('31 a third cycle is deterministically unsupported', async () => {
  const f = await readyForB();
  assert.deepEqual(f.runtime.createNextCycle('B'),
    { state: 'UNSUPPORTED', reason: 'TWO_CYCLE_LIMIT' });
  assert.deepEqual(f.runtime.createNextCycle('A'),
    { state: 'UNSUPPORTED', reason: 'TWO_CYCLE_LIMIT' });
});

test('32 Strict Mode equivalent teardown retires both and recreates fresh A only', async () => {
  const f = await readyForB();
  const oldA = f.a.cycle; const oldB = f.b;
  f.runtime.setBinding(undefined);
  f.runtime.setBinding(f.owner.binding);
  const fresh = f.runtime.getSnapshot();
  assert.equal(oldA.m7.getSnapshot().state, 'RETIRED');
  assert.equal(oldB.m7.getSnapshot().state, 'RETIRED');
  assert.equal(fresh.state, 'READY');
  assert.equal(fresh.cycle_b, undefined);
  assert.notEqual(fresh.cycle_a, oldA);
});

test('33 old references and namespaces cannot revive in a fresh runtime', async () => {
  const f = await readyForB();
  const oldARef = f.a.ref;
  const oldASession = f.a.cycle.store.getSnapshot().session_id;
  const oldBSession = f.b.store.getSnapshot().session_id;
  f.runtime.setBinding(undefined);
  f.runtime.setBinding(f.owner.binding);
  const fresh = f.runtime.getSnapshot().cycle_a;
  assert.notEqual(fresh.store.getSnapshot().session_id, oldASession);
  assert.notEqual(fresh.store.getSnapshot().session_id, oldBSession);
  assert.equal(fresh.store.assessM4GoalReadiness(oldARef).decision.reason, 'STALE_TASK');
});

test('34 composition has no persistence or unbounded cycle history', async () => {
  const f = await readyForB();
  const source = await readFile(new URL('../domain/trainer-runtime/two-cycle.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /AsyncStorage|localStorage|sessionStorage|indexedDB|SQLite|filesystem|writeFile/u);
  assert.doesNotMatch(source, /cycles\s*:\s*\[|new Map\s*<.*TrainerTwoCycle/u);
  assert.deepEqual(Object.keys(f.runtime.getSnapshot()).sort(), ['cycle_a', 'cycle_b', 'state']);
});

test('35 runtime construction and Cycle B creation auto-grant no M7 purpose', async () => {
  const f = await readyForB();
  assert.equal(f.b.m7.getSnapshot().request_count, 0);
  const source = await readFile(new URL('../domain/trainer-runtime/two-cycle.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.grant\s*\(|USER_SUBMITTED_OUTCOME|USER_ALLOWED_NEXT_CYCLE/u);
});

test('36 default composition cannot activate real W01', async () => {
  const owner = await ownerFixture();
  const runtime = createTrainerTwoCycleRuntime();
  runtime.setBinding(owner.binding);
  const a = runtime.getSnapshot().cycle_a;
  assert.equal(W01.real_user_activation, false);
  assert.equal(a.store.selfWalk.chooseAndStart(undefined, {}, 'forbidden-real-w01').state, 'DENIED');
  const source = await readFile(new URL('../domain/trainer-runtime/two-cycle.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /createLocalWalkResource|walkResource\s*:/u);
});

test('37 verifier performs zero provider or live network calls', () => {
  assert.equal(networkCalls, 0);
});

test('38 raw and captured Cycle A submit are denied after Cycle B exists', async () => {
  const f = await runtimeFixture();
  const a = await recordCycleA(f);
  const rawA = a.cycle.store;
  const capturedSubmit = rawA.submit;
  const next = a.cycle.m7.allowNextCycle(allowed('retained-submit-allow-next'));
  assert.equal(next.state, 'GRANTED');
  assert.equal(f.runtime.createNextCycle('A').state, 'CREATED');
  assert.equal(rawA.submit('raw A must not act', { permission_granted: true }), undefined);
  assert.equal(capturedSubmit('captured A must not act', { permission_granted: true }), undefined);
});

test('39 fresh retained A ref cannot open M4 through M6 or task mutation', async () => {
  const f = await readyForB();
  const store = f.a.cycle.store;
  const ref = store.reference(f.a.task);
  assert.ok(ref);
  const m4 = store.assessM4GoalReadiness(ref);
  const m5 = store.assessM5Goal(ref, m4);
  assert.equal(m4.decision.reason, 'STALE_TASK');
  assert.equal(m5.state, 'NO_ACTION');
  assert.equal(store.acceptM5Goal(ref, f.a.m5), undefined);
  assert.equal(store.getM5GoalChoiceReceipt(ref), undefined);
  assert.equal(store.resolveM6GoalAction(ref, f.a.choice), undefined);
  assert.equal(store.edit(ref, 'retained edit denied'), false);
  assert.equal(store.cancel(ref), false);
  assert.equal(store.switchTask(ref), false);
});

test('40 retained A denies old SelfWalk handles and new M7 reports including replay', async () => {
  const f = await runtimeFixture();
  const a = await recordCycleA(f);
  const store = a.cycle.store;
  const capturedReportContext = store.selfWalk.reportContext;
  const capturedPropose = store.selfWalk.propose;
  const capturedStart = store.selfWalk.start;
  const capturedChooseAndStart = store.selfWalk.chooseAndStart;
  assert.equal(a.cycle.m7.allowNextCycle(allowed('retained-handles-next')).state, 'GRANTED');
  assert.equal(f.runtime.createNextCycle('A').state, 'CREATED');
  const ref = store.reference(a.task);
  assert.equal(capturedReportContext(ref, { ...walkFacts, source_ref: 'retained-context' }), false);
  assert.equal(capturedPropose(ref, 'retained-proposal').state, 'DENIED');
  assert.equal(capturedStart(ref, a.proposal, 'retained-old-start').state, 'DENIED');
  assert.equal(capturedChooseAndStart(ref, a.proposal, 'retained-old-choose').state, 'DENIED');
  assert.equal(store.m7Outcome.report(a.ref, a.recordReceipt,
    outcomeReport({ request_id: 'retained-new-report' })).state, 'DENIED');
  assert.equal(store.m7Outcome.report(a.ref, a.recordReceipt, outcomeReport()).state, 'DENIED');
});

test('41 retained A keeps exact outcome history and supports correction', async () => {
  const f = await readyForB();
  const store = f.a.cycle.store;
  assert.equal(store.m7Outcome.getSnapshot(f.a.recordReceipt), f.a.outcome);
  assert.equal(store.m7Outcome.getRevision(f.a.outcome.revision, f.a.recordReceipt), f.a.outcome);
  const corrected = store.m7Outcome.correct(store.reference(f.a.task), f.a.recordReceipt,
    f.a.outcome.revision, outcomeReport({ request_id: 'retained-correct', constraint: 'NONE_REPORTED' }));
  assert.equal(corrected.state, 'ACTIVE');
  assert.equal(corrected.episode, f.a.outcome.episode);
  assert.equal(corrected.evidence.task_revision, f.a.outcome.episode.task_revision);
});

test('42 correction survives prior M3 revoke and retained seal', async () => {
  const f = await runtimeFixture();
  const a = await recordCycleA(f);
  assert.equal(await a.cycle.store.revoke(a.ref), true);
  assert.equal(a.cycle.m7.allowNextCycle(allowed('revoke-before-seal-next')).state, 'GRANTED');
  assert.equal(f.runtime.createNextCycle('A').state, 'CREATED');
  const corrected = a.cycle.store.m7Outcome.correct(a.ref, a.recordReceipt,
    a.outcome.revision, outcomeReport({ request_id: 'correct-after-revoke-seal' }));
  assert.equal(corrected.state, 'ACTIVE');
  assert.equal(corrected.episode, a.outcome.episode);
});

test('43 retained A retracts, deletes and cannot resurrect after purpose regrant', async () => {
  const f = await readyForB();
  const ref = f.a.cycle.store.reference(f.a.task);
  const retracted = f.a.cycle.store.m7Outcome.retract(ref, f.a.recordReceipt,
    f.a.outcome.revision, 'retained-retract-delete');
  assert.equal(retracted.state, 'RETRACTED');
  assert.equal(f.a.cycle.store.m7Outcome.delete(ref, f.a.recordReceipt,
    retracted.revision, 'retained-delete').state, 'UNKNOWN');
  f.a.cycle.m7.revokeRecordOutcome(recordRevoked('retained-delete-revoke-purpose'));
  const regrant = f.a.cycle.m7.submitOutcome(submitted('retained-delete-regrant'));
  assert.equal(regrant.state, 'GRANTED');
  assert.equal(f.a.cycle.store.m7Outcome.getSnapshot(regrant.receipt).state, 'UNKNOWN');
  assert.equal(f.a.cycle.store.m7Outcome.report(ref, regrant.receipt,
    outcomeReport({ request_id: 'retained-no-resurrection' })).state, 'DENIED');
});

test('44 RECORD_OUTCOME revoke clears retained lineage and a later regrant stays empty', async () => {
  const f = await readyForB();
  const bTask = await submitCycleB(f);
  f.a.cycle.m7.revokeRecordOutcome(recordRevoked('retained-record-revoke'));
  assert.equal(f.b.store.readM7NextCycleContext(bTask.ref), undefined);
  const regrant = f.a.cycle.m7.submitOutcome(submitted('retained-record-regrant'));
  const ref = f.a.cycle.store.reference(f.a.task);
  assert.equal(f.a.cycle.store.m7Outcome.getSnapshot(regrant.receipt).state, 'UNKNOWN');
  assert.equal(f.a.cycle.store.m7Outcome.report(ref, regrant.receipt,
    outcomeReport({ request_id: 'retained-record-no-resurrection' })).state, 'DENIED');
});

test('45 retained A permits M3 reduction but rejects regrant and reroute', async () => {
  const f = await readyForB();
  const store = f.a.cycle.store;
  const ref = store.reference(f.a.task);
  const captures = f.controls.captures.A.length;
  assert.equal(store.setM3Permission(ref, false), true);
  const reduced = store.reference(f.a.task);
  assert.equal(store.m7Outcome.getSnapshot(f.a.recordReceipt).state, 'ACTIVE');
  assert.equal(store.setM3Permission(reduced, true), false);
  await tick(); await tick();
  assert.equal(f.controls.captures.A.length, captures);
  assert.equal(store.m7Outcome.getSnapshot(f.a.recordReceipt).state, 'ACTIVE');
});

test('46 pending Cycle A success after seal is ignored', async () => {
  const f = await runtimeFixture();
  const a = await recordCycleA(f);
  f.controls.defer.A = true;
  assert.equal(a.cycle.store.setM3Permission(a.cycle.store.reference(a.task), true), true);
  await tick();
  assert.equal(f.controls.pending.A.length, 1);
  assert.equal(a.cycle.m7.allowNextCycle(allowed('pending-success-next')).state, 'GRANTED');
  assert.equal(f.runtime.createNextCycle('A').state, 'CREATED');
  const sealed = a.cycle.store.getSnapshot();
  f.controls.pending.A[0].resolve(meaning);
  await tick(); await tick();
  assert.equal(a.cycle.store.getSnapshot(), sealed);
});

test('47 pending Cycle A failure after seal is ignored', async () => {
  const f = await runtimeFixture();
  const a = await recordCycleA(f);
  f.controls.defer.A = true;
  assert.equal(a.cycle.store.setM3Permission(a.cycle.store.reference(a.task), true), true);
  await tick();
  assert.equal(a.cycle.m7.allowNextCycle(allowed('pending-failure-next')).state, 'GRANTED');
  assert.equal(f.runtime.createNextCycle('A').state, 'CREATED');
  const sealed = a.cycle.store.getSnapshot();
  f.controls.pending.A[0].reject(Error('EXPECTED_RETAINED_LATE_FAILURE'));
  await tick(); await tick();
  assert.equal(a.cycle.store.getSnapshot(), sealed);
});

test('48 abort callback reentry cannot reopen retained A', async () => {
  const f = await runtimeFixture();
  const a = await recordCycleA(f);
  f.controls.defer.A = true;
  assert.equal(a.cycle.store.setM3Permission(a.cycle.store.reference(a.task), true), true);
  await tick();
  let reentry;
  f.controls.pending.A[0].signal.addEventListener('abort', () => {
    reentry = a.cycle.store.submit('abort reentry must fail', { permission_granted: true });
  });
  assert.equal(a.cycle.m7.allowNextCycle(allowed('abort-reentry-next')).state, 'GRANTED');
  assert.equal(f.runtime.createNextCycle('A').state, 'CREATED');
  assert.equal(reentry, undefined);
  assert.equal(a.cycle.store.submit('post-abort must fail'), undefined);
});

test('49 candidate construction failure before seal leaves A action-capable', async () => {
  const f = await runtimeFixture({ failBConstruction: true });
  const a = await recordCycleA(f);
  assert.equal(a.cycle.m7.allowNextCycle(allowed('fail-before-seal-next')).state, 'GRANTED');
  assert.deepEqual(f.runtime.createNextCycle('A'), { state: 'DENIED', reason: 'ISOLATION_FAILURE' });
  assert.equal(f.runtime.getSnapshot().cycle_b, undefined);
  assert.ok(a.cycle.store.submit('A remains open after candidate failure'));
});

test('50 factory returning A store is rejected without stopping or sealing A', async () => {
  const f = await runtimeFixture({ aliasBToA: true });
  const a = await recordCycleA(f);
  const session = a.cycle.store.getSnapshot().session_id;
  assert.equal(a.cycle.m7.allowNextCycle(allowed('alias-before-seal-next')).state, 'GRANTED');
  assert.deepEqual(f.runtime.createNextCycle('A'), { state: 'DENIED', reason: 'ISOLATION_FAILURE' });
  assert.equal(a.cycle.store.getSnapshot().session_id, session);
  assert.ok(a.cycle.store.submit('A remains open after alias rejection'));
});

test('51 owner loss during candidate construction retires the runtime fail-closed', async () => {
  const f = await runtimeFixture({
    onBStoreCreated({ owner }) { owner.boundary.control.invalidateCurrentSession(); },
  });
  const a = await recordCycleA(f);
  assert.equal(a.cycle.m7.allowNextCycle(allowed('owner-loss-next')).state, 'GRANTED');
  assert.deepEqual(f.runtime.createNextCycle('A'), { state: 'DENIED', reason: 'OWNER_UNAVAILABLE' });
  assert.equal(f.runtime.getSnapshot().state, 'UNAVAILABLE');
  assert.equal(a.cycle.store.getSnapshot().session_id, null);
});

test('52 source loss during candidate construction leaves A open and B unpublished', async () => {
  const f = await runtimeFixture({
    onBStoreCreated({ runtime }) {
      runtime.getSnapshot().cycle_a.m7.revokeNextCycle(declined('source-loss-during-build'));
    },
  });
  const a = await recordCycleA(f);
  assert.equal(a.cycle.m7.allowNextCycle(allowed('source-loss-next')).state, 'GRANTED');
  assert.deepEqual(f.runtime.createNextCycle('A'),
    { state: 'DENIED', reason: 'CURRENT_FRAGMENT_UNAVAILABLE' });
  assert.equal(f.runtime.getSnapshot().cycle_b, undefined);
  assert.ok(a.cycle.store.submit('A remains open after source loss'));
});

test('53 duplicate reentrant advance creates only one Cycle B', async () => {
  const f = await runtimeFixture({
    onBStoreCreated({ runtime, controls }) {
      controls.nestedAdvance = runtime.createNextCycle('A');
    },
  });
  const a = await recordCycleA(f);
  assert.equal(a.cycle.m7.allowNextCycle(allowed('nested-next')).state, 'GRANTED');
  assert.equal(f.runtime.createNextCycle('A').state, 'CREATED');
  assert.deepEqual(f.controls.nestedAdvance, { state: 'DENIED', reason: 'ISOLATION_FAILURE' });
  assert.equal(f.controls.stores.filter(value => value.cycle === 'B').length, 1);
  assert.ok(f.runtime.getSnapshot().cycle_b);
});

test('54 runtime observer exception cannot publish B while A remains open', async () => {
  const f = await runtimeFixture();
  const a = await recordCycleA(f);
  f.runtime.subscribe(() => { throw Error('EXPECTED_RUNTIME_OBSERVER_FAILURE'); });
  assert.equal(a.cycle.m7.allowNextCycle(allowed('observer-next')).state, 'GRANTED');
  assert.equal(f.runtime.createNextCycle('A').state, 'CREATED');
  assert.ok(f.runtime.getSnapshot().cycle_b);
  assert.equal(a.cycle.store.submit('observer cannot reopen A'), undefined);
});

test('55 store observer failure is isolated from retained seal and Cycle B publication', async () => {
  const f = await runtimeFixture();
  const a = await recordCycleA(f);
  let laterListenerNotifications = 0;
  a.cycle.store.subscribe(() => { throw Error('EXPECTED_SEAL_OBSERVER_FAILURE'); });
  a.cycle.store.subscribe(() => { laterListenerNotifications++; });
  assert.equal(a.cycle.m7.allowNextCycle(allowed('seal-observer-next')).state, 'GRANTED');
  const created = f.runtime.createNextCycle('A');
  assert.equal(created.state, 'CREATED');
  assert.equal(laterListenerNotifications, 1);
  assert.equal(f.runtime.getSnapshot().cycle_b, created.cycle);
  assert.equal(a.cycle.store.submit('sealed A cannot reopen'), undefined);
  assert.equal(a.cycle.store.assessM4GoalReadiness(
    a.cycle.store.reference(a.task)).decision.reason, 'STALE_TASK');
  assert.equal(a.cycle.store.m7Outcome.getSnapshot(a.recordReceipt).state, 'ACTIVE');
  const bTask = created.cycle.store.submit('B remains usable', { permission_granted: true });
  await tick(); await tick();
  assert.ok(bTask);
  assert.ok(created.cycle.store.reference(bTask));
});

test('56 stopping Cycle B never reactivates retained A', async () => {
  const f = await readyForB();
  f.b.store.stop();
  assert.equal(f.a.cycle.store.submit('B stop cannot reopen A'), undefined);
  assert.equal(f.a.cycle.store.m7Outcome.getSnapshot(f.a.recordReceipt).state, 'ACTIVE');
});

test('57 Cycle B remains a positive M3 through M6 control', async () => {
  const f = await readyForB();
  const current = await submitCycleB(f, 'B positive action control');
  const m4 = f.b.store.assessM4GoalReadiness(current.ref);
  const m5 = f.b.store.assessM5Goal(current.ref, m4);
  const choice = f.b.store.acceptM5Goal(current.ref, m5);
  const ref = f.b.store.reference(current.task);
  const handoff = f.b.store.resolveM6GoalAction(ref, choice, {
    available_time_minutes: 20, current_constraints: 'NONE_REPORTED',
  });
  assert.equal(m4.decision.state, 'CONTEXT_SUFFICIENT');
  assert.equal(m5.state, 'PROPOSAL');
  assert.equal(choice.choice, 'ACCEPTED');
  assert.equal(handoff.state, 'ACTION_READY');
});

test('58 retained transition is idempotent without extra publication', async () => {
  const f = await readyForB();
  const before = f.a.cycle.store.getSnapshot();
  assert.equal(f.a.cycle.store.enterRetainedSourceMode(undefined), false);
  assert.equal(f.a.cycle.store.enterRetainedSourceMode(f.a.recordReceipt), true);
  assert.equal(f.a.cycle.store.getSnapshot(), before);
});
