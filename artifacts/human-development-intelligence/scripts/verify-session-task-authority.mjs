import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extname } from 'node:path';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { FakeClock, fakeAuthority, OWNER_A } from './fixtures/local-owner.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context);
  },
});

let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw Error('NETWORK_FORBIDDEN'); };

const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const { createLocalWalkResource } = await import('../domain/m6/walk-resource.ts');
const { createLocalM7PurposeAuthority } = await import('../domain/m7/outcome.ts');
const { createM7NextCycleConsumer } = await import('../domain/m7/next-cycle.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const COLLIDING_SESSION_ID = 's-00000000000000000000000000000000-1';
const collidingSessionId = () => COLLIDING_SESSION_ID;

const goalMeaning = () => ({
  intent_type: 'GOAL', interpreted_meaning: 'Khỏe hơn', confidence: .95,
  uncertainty: null, missing_context: [], clarification_needed: false, clarification_question: null,
  safety_state: 'CLEAR', suggested_next_role: 'M4', task_kind: 'general_health', context_effect: 'NONE',
  used_context_ids: [], response: 'Đã ghi nhận.',
});

const goalAdapter = () => ({
  provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
  async interpret() { return goalMeaning(); },
  async revoke() {},
});

const walkFacts = (changes = {}) => ({
  source_ref: 'authority-walk-context', intent: 'SHORT_LIGHT_MOVEMENT', walking_choice: 'WANTS_WALK',
  adult: 'REPORTED_ADULT', mobility: 'INDEPENDENT_COMFORTABLE_WALKING', concerns: 'NONE_REPORTED',
  professional_limits: 'NONE_REPORTED', setting: 'INDOOR_FLAT_CLEAR_LIT_DRY_STOPPABLE',
  competing_activity: 'NONE', footwear: 'FAMILIAR_SECURE', available_minutes: 5,
  requested_minutes: 5, currency: 'CURRENT', ...changes,
});

const outcomeInput = (changes = {}) => ({
  request_id: 'authority-outcome', execution_extent: 'DID', action_change: 'UNCHANGED',
  user_stopped: false, problem_state: 'NO_PROBLEM_REPORTED', safety_disposition: 'CLEAR',
  constraint: 'NONE_REPORTED', occurred_at: 700, ...changes,
});

async function ownerFixture() {
  const clock = new FakeClock();
  const authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner: OWNER_A, validUntil: 100_000 });
  const lease = await boundary.control.verifySession();
  boundary.control.finishHydration(lease);
  return { clock, authority, boundary, lease,
    binding: Object.freeze({ access: boundary.access, lease }) };
}

async function goalPair() {
  const owner = await ownerFixture();
  const resourceA = createLocalWalkResource(); const resourceB = createLocalWalkResource();
  const purposeA = createLocalM7PurposeAuthority(); const purposeB = createLocalM7PurposeAuthority();
  const make = (resource, purpose) => createSessionTaskStore({ adapter: goalAdapter(), now: owner.clock.now,
    ownerSession: owner.binding, walkResource: resource.access, m7Purpose: purpose.access });
  const a = make(resourceA, purposeA); const b = make(resourceB, purposeB);
  a.start(); b.start();
  const taskA = a.submit('Khỏe hơn', { permission_granted: true });
  const taskB = b.submit('Khỏe hơn', { permission_granted: true });
  await tick(); await tick();
  const refA = a.reference(taskA); const refB = b.reference(taskB);
  const m4A = a.assessM4GoalReadiness(refA); const m4B = b.assessM4GoalReadiness(refB);
  const decisionA = a.assessM5Goal(refA, m4A); const decisionB = b.assessM5Goal(refB, m4B);
  return { ...owner, a, b, taskA, taskB, refA, refB, m4A, m4B, decisionA, decisionB,
    resourceA, resourceB, purposeA, purposeB };
}

async function actionPair({ start = false } = {}) {
  const f = await goalPair();
  const receiptA = f.a.acceptM5Goal(f.refA, f.decisionA);
  const receiptB = f.b.acceptM5Goal(f.refB, f.decisionB);
  const refA = f.a.reference(f.taskA); const refB = f.b.reference(f.taskB);
  assert.equal(f.a.selfWalk.reportContext(refA, walkFacts({ source_ref: 'walk-a' })), true);
  assert.equal(f.b.selfWalk.reportContext(refB, walkFacts({ source_ref: 'walk-b' })), true);
  const proposalA = f.a.selfWalk.propose(refA, 'proposal-a');
  const proposalB = f.b.selfWalk.propose(refB, 'proposal-b');
  if (start) {
    assert.equal(f.a.selfWalk.chooseAndStart(refA, proposalA, 'start-a').state, 'STARTED');
    assert.equal(f.b.selfWalk.chooseAndStart(refB, proposalB, 'start-b').state, 'STARTED');
  }
  return { ...f, refA, refB, receiptA, receiptB, proposalA, proposalB };
}

function controlledAdapter() {
  const calls = [];
  return {
    calls,
    adapter: {
      provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
      interpret(input) {
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        calls.push({ input, resolve, reject });
        return promise;
      },
      async revoke() {},
    },
  };
}

async function collidingStores() {
  const clock = new FakeClock();
  const authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner: OWNER_A, validUntil: 100_000 });
  const lease = await boundary.control.verifySession();
  boundary.control.finishHydration(lease);
  const binding = Object.freeze({ access: boundary.access, lease });
  const a = createSessionTaskStore({ ownerSession: binding, now: clock.now, sessionIdFactory: collidingSessionId });
  const b = createSessionTaskStore({ ownerSession: binding, now: clock.now, sessionIdFactory: collidingSessionId });
  a.start(); b.start();
  const taskA = a.submit('Tôi muốn cải thiện sức khỏe', { permission_granted: false });
  const taskB = b.submit('Tôi muốn cải thiện sức khỏe', { permission_granted: false });
  const refA = a.reference(taskA);
  const refB = b.reference(taskB);
  assert.ok(refA); assert.ok(refB);
  return { a, b, refA, refB };
}

function rejectionReason(store, ref) {
  return store.assessM4GoalReadiness(ref).decision.reason;
}

test('01 A/B can intentionally collide on every public TaskRef field', async () => {
  const f = await collidingStores();
  assert.deepEqual(f.refA, f.refB);
  assert.notEqual(f.refA, f.refB);
  f.a.stop(); f.b.stop();
});

test('02 foreign canonical A ref is rejected by B at the issuer boundary', async () => {
  const f = await collidingStores();
  assert.equal(rejectionReason(f.b, f.refA), 'STALE_TASK');
  f.a.stop(); f.b.stop();
});

test('03 spread A ref has no authority in B', async () => {
  const f = await collidingStores();
  assert.equal(rejectionReason(f.b, { ...f.refA }), 'STALE_TASK');
  f.a.stop(); f.b.stop();
});

test('04 Object.assign clone has no authority in B', async () => {
  const f = await collidingStores();
  assert.equal(rejectionReason(f.b, Object.assign({}, f.refA)), 'STALE_TASK');
  f.a.stop(); f.b.stop();
});

test('05 JSON round-trip A ref has no authority in B', async () => {
  const f = await collidingStores();
  assert.equal(rejectionReason(f.b, JSON.parse(JSON.stringify(f.refA))), 'STALE_TASK');
  f.a.stop(); f.b.stop();
});

test('06 structured clone A ref has no authority in B', async () => {
  const f = await collidingStores();
  assert.equal(rejectionReason(f.b, structuredClone(f.refA)), 'STALE_TASK');
  f.a.stop(); f.b.stop();
});

test('07 manually fabricated matching ref has no authority in B', async () => {
  const f = await collidingStores();
  assert.equal(rejectionReason(f.b, Object.freeze({ ...f.refB })), 'STALE_TASK');
  f.a.stop(); f.b.stop();
});

test('08 original canonical B ref remains a positive control', async () => {
  const f = await collidingStores();
  assert.equal(rejectionReason(f.b, f.refB), 'TASK_NOT_READY');
  f.a.stop(); f.b.stop();
  assert.equal(networkCalls, 0);
});

test('09 alias to the exact canonical B object retains authority', async () => {
  const f = await collidingStores(); const alias = f.refB;
  assert.equal(rejectionReason(f.b, alias), 'TASK_NOT_READY');
  f.a.stop(); f.b.stop();
});

test('10 foreign canonical B ref is rejected by A', async () => {
  const f = await collidingStores();
  assert.equal(rejectionReason(f.a, f.refB), 'STALE_TASK');
  f.a.stop(); f.b.stop();
});

test('11 stop synchronously invalidates the old epoch ref', async () => {
  const f = await collidingStores(); f.a.stop();
  assert.equal(rejectionReason(f.a, f.refA), 'STALE_TASK');
  f.b.stop();
});

test('12 anonymous restart creates a fresh epoch and never revives an old ref', () => {
  const clock = new FakeClock(); const store = createSessionTaskStore({ now: clock.now });
  store.start(); const oldTask = store.submit('old', { permission_granted: false });
  const oldRef = store.reference(oldTask); store.stop(); store.start();
  const newTask = store.submit('new', { permission_granted: false }); const newRef = store.reference(newTask);
  assert.equal(rejectionReason(store, oldRef), 'STALE_TASK');
  assert.equal(rejectionReason(store, newRef), 'TASK_NOT_READY');
  store.stop();
});

test('13 R1 retirement then R2 same owner and clock rejects the R1 ref', async () => {
  const f = await ownerFixture();
  const r1 = createSessionTaskStore({ ownerSession: f.binding, now: f.clock.now, sessionIdFactory: collidingSessionId });
  r1.start(); const t1 = r1.submit('same', { permission_granted: false }); const ref1 = r1.reference(t1); r1.stop();
  const r2 = createSessionTaskStore({ ownerSession: f.binding, now: f.clock.now, sessionIdFactory: collidingSessionId });
  r2.start(); const t2 = r2.submit('same', { permission_granted: false }); const ref2 = r2.reference(t2);
  assert.deepEqual(ref1, ref2);
  assert.equal(rejectionReason(r2, ref1), 'STALE_TASK');
  assert.equal(rejectionReason(r2, ref2), 'TASK_NOT_READY');
  r2.stop();
});

test('14 owner generation replacement invalidates the prior epoch ref', async () => {
  const f = await ownerFixture(); const store = createSessionTaskStore({ ownerSession: f.binding, now: f.clock.now });
  store.start(); const task = store.submit('same', { permission_granted: false }); const ref = store.reference(task);
  f.authority.results.push({ status: 'verified', owner: OWNER_A, validUntil: 200_000 });
  const replacement = await f.boundary.control.verifySession(); f.boundary.control.finishHydration(replacement);
  assert.equal(rejectionReason(store, ref), 'STALE_TASK');
  assert.equal(store.getSnapshot().session_id, null);
});

test('15 M4 output from A cannot become M5 authority in B', async () => {
  const f = await goalPair();
  const result = f.b.assessM5Goal(f.refB, f.m4A);
  assert.equal(result.state, 'NO_ACTION'); assert.equal(result.reason, 'STALE_CONTEXT');
  f.a.stop(); f.b.stop();
});

test('16 ref A with valid B receipt cannot authorize B M6', async () => {
  const f = await actionPair();
  assert.equal(f.b.resolveM6GoalAction(f.refA, f.receiptB,
    { available_time_minutes: 5, current_constraints: 'NONE_REPORTED' }), undefined);
  f.a.stop(); f.b.stop();
});

test('17 canonical ref B with receipt A cannot authorize B M6', async () => {
  const f = await actionPair();
  assert.equal(f.b.resolveM6GoalAction(f.refB, f.receiptA,
    { available_time_minutes: 5, current_constraints: 'NONE_REPORTED' }), undefined);
  f.a.stop(); f.b.stop();
});

test('18 copied canonical B receipt cannot authorize B M6', async () => {
  const f = await actionPair();
  assert.equal(f.b.resolveM6GoalAction(f.refB, { ...f.receiptB },
    { available_time_minutes: 5, current_constraints: 'NONE_REPORTED' }), undefined);
  f.a.stop(); f.b.stop();
});

test('19 decision A cannot be accepted with canonical ref B', async () => {
  const f = await goalPair();
  assert.equal(f.b.acceptM5Goal(f.refB, f.decisionA), undefined);
  assert.ok(f.b.acceptM5Goal(f.refB, f.decisionB));
  f.a.stop(); f.b.stop();
});

test('20 proposal B plus ref A is rejected', async () => {
  const f = await actionPair();
  assert.equal(f.b.selfWalk.chooseAndStart(f.refA, f.proposalB, 'foreign-ref').state, 'DENIED');
  f.a.stop(); f.b.stop();
});

test('21 proposal A cannot execute in B', async () => {
  const f = await actionPair();
  assert.equal(f.b.selfWalk.chooseAndStart(f.refB, f.proposalA, 'foreign-proposal').state, 'DENIED');
  f.a.stop(); f.b.stop();
});

test('22 canonical B proposal remains an executable positive control', async () => {
  const f = await actionPair();
  assert.equal(f.b.selfWalk.chooseAndStart(f.refB, f.proposalB, 'canonical-start').state, 'STARTED');
  f.a.stop(); f.b.stop();
});

test('23 M7 report with foreign-store ref is rejected', async () => {
  const f = await actionPair({ start: true }); const receipt = f.purposeB.control.grant('RECORD_OUTCOME');
  assert.equal(f.b.m7Outcome.report(f.refA, receipt, outcomeInput()).state, 'DENIED');
  assert.equal(f.b.m7Outcome.report(f.refB, receipt, outcomeInput()).state, 'ACTIVE');
  f.a.stop(); f.b.stop();
});

test('24 M7 correction rejects foreign ref even with valid B purpose receipt', async () => {
  const f = await actionPair({ start: true }); const receipt = f.purposeB.control.grant('RECORD_OUTCOME');
  const active = f.b.m7Outcome.report(f.refB, receipt, outcomeInput());
  assert.equal(f.b.m7Outcome.correct(f.refA, receipt, active.revision,
    outcomeInput({ request_id: 'foreign-correct', execution_extent: 'PARTIAL' })).state, 'DENIED');
  assert.equal(f.b.m7Outcome.getSnapshot(receipt), active);
  f.a.stop(); f.b.stop();
});

test('25 M7 retract and delete both reject a foreign ref', async () => {
  const f = await actionPair({ start: true }); const receipt = f.purposeB.control.grant('RECORD_OUTCOME');
  const active = f.b.m7Outcome.report(f.refB, receipt, outcomeInput());
  assert.equal(f.b.m7Outcome.retract(f.refA, receipt, active.revision, 'foreign-retract').state, 'DENIED');
  assert.equal(f.b.m7Outcome.delete(f.refA, receipt, active.revision, 'foreign-delete').state, 'DENIED');
  assert.equal(f.b.m7Outcome.getSnapshot(receipt), active);
  f.a.stop(); f.b.stop();
});

test('26 legitimate historical M7 ref remains correctable after independent M3 revoke', async () => {
  const f = await actionPair({ start: true }); const receipt = f.purposeB.control.grant('RECORD_OUTCOME');
  const active = f.b.m7Outcome.report(f.refB, receipt, outcomeInput());
  assert.equal(await f.b.revoke(f.refB), true);
  const corrected = f.b.m7Outcome.correct(f.refB, receipt, active.revision,
    outcomeInput({ request_id: 'historical-correct', execution_extent: 'PARTIAL' }));
  assert.equal(corrected.state, 'ACTIVE');
  f.a.stop(); f.b.stop();
});

test('27 retained ACTIVE can retract then delete with its issued historical ref', async () => {
  const f = await actionPair({ start: true }); const receipt = f.purposeB.control.grant('RECORD_OUTCOME');
  const active = f.b.m7Outcome.report(f.refB, receipt, outcomeInput());
  assert.equal(await f.b.revoke(f.refB), true);
  const retracted = f.b.m7Outcome.retract(f.refB, receipt, active.revision, 'historical-retract');
  assert.equal(retracted.state, 'RETRACTED');
  assert.equal(f.b.m7Outcome.delete(f.refB, receipt, retracted.revision, 'historical-delete').state, 'UNKNOWN');
  f.a.stop(); f.b.stop();
});

test('28 RECORD_OUTCOME revoke still clears private outcome lineage', async () => {
  const f = await actionPair({ start: true }); const receipt = f.purposeB.control.grant('RECORD_OUTCOME');
  const active = f.b.m7Outcome.report(f.refB, receipt, outcomeInput()); assert.equal(active.state, 'ACTIVE');
  f.purposeB.control.revoke('RECORD_OUTCOME');
  const fresh = f.purposeB.control.grant('RECORD_OUTCOME');
  assert.equal(f.b.m7Outcome.getSnapshot(fresh).state, 'UNKNOWN');
  assert.equal(f.b.m7Outcome.getRevision(active.revision, fresh), undefined);
  f.a.stop(); f.b.stop();
});

test('29 late resolve from retired A cannot mutate same-ID store B', async () => {
  const f = await ownerFixture(); const ca = controlledAdapter(); const cb = controlledAdapter();
  const a = createSessionTaskStore({ ownerSession: f.binding, now: f.clock.now, adapter: ca.adapter,
    sessionIdFactory: collidingSessionId });
  const b = createSessionTaskStore({ ownerSession: f.binding, now: f.clock.now, adapter: cb.adapter,
    sessionIdFactory: collidingSessionId });
  a.start(); b.start(); a.submit('same', { permission_granted: true }); b.submit('same', { permission_granted: true });
  assert.equal(ca.calls[0].input.operation.ticket.operation_id, cb.calls[0].input.operation.ticket.operation_id);
  a.stop(); ca.calls[0].resolve(goalMeaning()); await tick(); await tick();
  assert.equal(a.getSnapshot().tasks.length, 0);
  assert.equal(b.getSnapshot().tasks[0].status, 'NEEDS_ROUTING');
  cb.calls[0].resolve(goalMeaning()); await tick(); await tick();
  assert.equal(b.getSnapshot().tasks[0].status, 'READY'); b.stop();
});

test('30 late reject from retired A cannot clear B pending object with the same operation_id', async () => {
  const f = await ownerFixture(); const ca = controlledAdapter(); const cb = controlledAdapter();
  const a = createSessionTaskStore({ ownerSession: f.binding, now: f.clock.now, adapter: ca.adapter,
    sessionIdFactory: collidingSessionId });
  const b = createSessionTaskStore({ ownerSession: f.binding, now: f.clock.now, adapter: cb.adapter,
    sessionIdFactory: collidingSessionId });
  a.start(); b.start(); a.submit('same', { permission_granted: true }); b.submit('same', { permission_granted: true });
  assert.equal(ca.calls[0].input.operation.ticket.operation_id, cb.calls[0].input.operation.ticket.operation_id);
  a.stop(); ca.calls[0].reject(Error('late-a')); await tick(); await tick();
  assert.equal(b.getSnapshot().tasks[0].status, 'NEEDS_ROUTING');
  cb.calls[0].resolve(goalMeaning()); await tick(); await tick();
  assert.equal(b.getSnapshot().tasks[0].status, 'READY'); b.stop();
});

test('31 next-cycle consumer crosses context only, never TaskRef or action authority', async () => {
  const f = await actionPair({ start: true });
  const recordReceipt = f.purposeA.control.grant('RECORD_OUTCOME');
  const nextReceipt = f.purposeA.control.grant('USE_NEXT_CYCLE');
  assert.equal(f.a.m7Outcome.report(f.refA, recordReceipt, outcomeInput()).state, 'ACTIVE');
  const consumer = createM7NextCycleConsumer(f.binding, () => f.a.m7Outcome.readNextCycle(nextReceipt));
  const c = createSessionTaskStore({ ownerSession: f.binding, now: f.clock.now, m7NextCycle: consumer });
  c.start(); const task = c.submit('next', { permission_granted: false }); const ref = c.reference(task);
  const context = c.readM7NextCycleContext(ref); assert.ok(context);
  for (const field of ['task_ref', 'm5_receipt', 'acceptance', 'start', 'command']) {
    assert.equal(field in context, false);
  }
  assert.equal(c.resolveM6GoalAction(ref, f.receiptA,
    { available_time_minutes: 5, current_constraints: 'NONE_REPORTED' }), undefined);
  c.stop(); f.a.stop(); f.b.stop();
});

test('32 verifier requires no provider or network call', () => {
  assert.equal(networkCalls, 0);
});

test('33 authority seam remains RAM-only with no persistence import', () => {
  const authoritySource = readFileSync(new URL('../domain/session-task/authority.ts', import.meta.url), 'utf8');
  const storeSource = readFileSync(new URL('../domain/session-task/store.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(authoritySource + storeSource, /AsyncStorage|localStorage|secure-store|node:fs|writeFile/u);
  assert.match(authoritySource, /WeakMap/u);
});

test('34 patch does not activate real W01 or two-cycle composition', () => {
  const walk = readFileSync(new URL('../domain/m6/walk-resource.ts', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../domain/session-task/store.ts', import.meta.url), 'utf8');
  assert.match(walk, /real_user_activation:\s*false/u);
  assert.doesNotMatch(store, /createLocalWalkResource|TrainerRuntimeTwoCycle|beginNextCycle/u);
  assert.equal(networkCalls, 0);
});
