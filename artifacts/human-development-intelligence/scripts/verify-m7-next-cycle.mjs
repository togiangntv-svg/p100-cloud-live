import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extname } from 'node:path';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { FakeClock, fakeAuthority, OWNER_A, OWNER_B } from './fixtures/local-owner.mjs';

registerHooks({ resolve(s, c, next) { return next(s.startsWith('.') && !extname(s) ? s + '.ts' : s, c); } });
let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw Error('NETWORK_FORBIDDEN_IN_M7_2_TEST'); };

const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const { createLocalWalkResource } = await import('../domain/m6/walk-resource.ts');
const { createLocalM7PurposeAuthority } = await import('../domain/m7/outcome.ts');
const { createM3StubAdapter } = await import('../domain/m3/stub-adapter.ts');
const { createM7NextCycleConsumer, readM7NextCycleContext,
  resolveConfirmedWalkMinutes } = await import('../domain/m7/next-cycle.ts');
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

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
const goalMeaning = Object.freeze({ intent_type: 'GOAL', interpreted_meaning: 'Improve health', confidence: .95,
  uncertainty: null, missing_context: [], clarification_needed: false, clarification_question: null,
  safety_state: 'CLEAR', suggested_next_role: 'M4', task_kind: 'general_health', context_effect: 'NONE',
  used_context_ids: [], response: 'Noted.' });

async function fixture(outcomeChanges = {}) {
  const clock = new FakeClock();
  const authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner: OWNER_A, validUntil: 100000 });
  const lease = await boundary.control.verifySession();
  boundary.control.finishHydration(lease);
  const resource = createLocalWalkResource();
  const purpose = createLocalM7PurposeAuthority();
  const oldAdapter = { provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    async interpret() { return goalMeaning; }, async revoke() {} };
  const oldStore = createSessionTaskStore({ adapter: oldAdapter, now: clock.now,
    ownerSession: { access: boundary.access, lease }, walkResource: resource.access, m7Purpose: purpose.access });
  oldStore.start(); const oldTask = oldStore.submit('Khỏe hơn', { permission_granted: true }); await tick();
  let oldRef = oldStore.reference(oldTask);
  oldStore.acceptM5Goal(oldRef, oldStore.assessM5Goal(oldRef, oldStore.assessM4GoalReadiness(oldRef)));
  oldRef = oldStore.reference(oldTask);
  oldStore.selfWalk.reportContext(oldRef, walkFacts());
  const oldProposal = oldStore.selfWalk.propose(oldRef, 'proposal-1');
  oldStore.selfWalk.chooseAndStart(oldRef, oldProposal, 'start-1');
  const recordReceipt = purpose.control.grant('RECORD_OUTCOME');
  const nextReceipt = purpose.control.grant('USE_NEXT_CYCLE');
  const outcome = oldStore.m7Outcome.report(oldRef, recordReceipt, report(outcomeChanges));
  const ownerBinding = Object.freeze({ access: boundary.access, lease });
  const consumer = createM7NextCycleConsumer(ownerBinding, () => oldStore.m7Outcome.readNextCycle(nextReceipt));
  const captured = [];
  const deterministic = createM3StubAdapter(0);
  const currentAdapter = { provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    async interpret(input, signal) { captured.push(input.content); assert.equal(input.operation.isCurrent(), true);
      return deterministic.interpret(input, signal); },
    async revoke() {} };
  const currentStore = createSessionTaskStore({ adapter: currentAdapter, now: clock.now,
    ownerSession: { access: boundary.access, lease }, walkResource: resource.access, m7NextCycle: consumer });
  return { clock, authority, boundary, lease, ownerBinding, resource, purpose, recordReceipt, nextReceipt, oldStore,
    oldTask, oldRef, outcome, consumer, currentStore, captured };
}

async function submitCurrent(f, text = 'Khỏe hơn', locale = 'vi') {
  f.currentStore.start();
  const task = f.currentStore.submit(text, { permission_granted: true, locale });
  await tick();
  return { task, ref: f.currentStore.reference(task), input: f.captured.at(-1) };
}

test('01 valid prior time constraint reaches a real new task input', async () => {
  const f = await fixture(); const current = await submitCurrent(f);
  assert.equal(current.input.relevant_context.length, 1);
  assert.equal(current.input.relevant_context[0].reported_constraint.kind, 'PRIOR_EPISODE_TIME_CONSTRAINT');
});
test('02 prior context preserves episode, revision, provenance, purpose and reconfirmation', async () => {
  const f = await fixture(); const item = readM7NextCycleContext(f.consumer, f.ownerBinding);
  assert.equal(item.episode_ref.episode_key, f.outcome.episode.episode_key);
  assert.equal(item.episode_ref.outcome_revision, f.outcome.revision);
  assert.equal(item.provenance.source, 'USER_REPORT');
  assert.equal(item.provenance.epistemic_role, 'PERSONAL_OBSERVATION_PR0');
  assert.equal(item.provenance.purpose_revision, f.nextReceipt.revision);
  assert.equal(item.requires_reconfirmation.includes('CURRENT_TIME_AVAILABLE'), true);
});
test('03 prior context never supplies current available minutes or prescribed minutes', async () => {
  const f = await fixture(); const item = readM7NextCycleContext(f.consumer, f.ownerBinding);
  assert.equal('available_minutes' in item, false); assert.equal('prescribed_minutes' in item, false);
  assert.equal('performed_minutes' in item, false);
});
test('04 independently confirmed current three minutes can be used', async () => {
  const f = await fixture(); const item = readM7NextCycleContext(f.consumer, f.ownerBinding);
  assert.equal(resolveConfirmedWalkMinutes(item, { available_minutes: 3, confirmed_current: true }), 3);
});
test('05 independently confirmed current ten minutes overrides no prior rule', async () => {
  const f = await fixture(); const item = readM7NextCycleContext(f.consumer, f.ownerBinding);
  assert.equal(resolveConfirmedWalkMinutes(item, { available_minutes: 10, confirmed_current: true }), 10);
});
test('06 prior fragment never auto-accepts M5', async () => {
  const f = await fixture(); const { ref } = await submitCurrent(f);
  assert.equal(f.currentStore.getM5GoalChoiceReceipt(ref), undefined);
});
test('07 prior fragment never auto-starts M6', async () => {
  const f = await fixture(); await submitCurrent(f);
  assert.equal(f.currentStore.selfWalk.getSnapshot().state, 'IDLE');
});
test('08 retracted outcome removes prior context', async () => {
  const f = await fixture(); f.oldStore.m7Outcome.retract(f.oldRef, f.recordReceipt, f.outcome.revision, 'retract-1');
  assert.equal(readM7NextCycleContext(f.consumer, f.ownerBinding), undefined);
});
test('08a deleted outcome removes prior context', async () => {
  const f = await fixture(); f.oldStore.m7Outcome.delete(f.oldRef, f.recordReceipt, f.outcome.revision, 'delete-1');
  assert.equal(readM7NextCycleContext(f.consumer, f.ownerBinding), undefined);
});
test('09 corrected outcome replaces prior context instead of preserving stale context', async () => {
  const f = await fixture(); const corrected = f.oldStore.m7Outcome.correct(f.oldRef, f.recordReceipt,
    f.outcome.revision, report({ request_id: 'correct-1', constraint: 'OTHER_CONSTRAINT', performed_minutes: undefined }));
  const item = readM7NextCycleContext(f.consumer, f.ownerBinding);
  assert.equal(item.episode_ref.outcome_revision, corrected.revision);
  assert.equal(item.reported_constraint.kind, 'PRIOR_EPISODE_OTHER_CONSTRAINT');
});
test('10 USE_NEXT_CYCLE revoke removes prior context', async () => {
  const f = await fixture(); f.purpose.control.revoke('USE_NEXT_CYCLE');
  assert.equal(readM7NextCycleContext(f.consumer, f.ownerBinding), undefined);
});
test('10a RECORD_OUTCOME revoke removes dependent prior context', async () => {
  const f = await fixture(); f.purpose.control.revoke('RECORD_OUTCOME');
  assert.equal(readM7NextCycleContext(f.consumer, f.ownerBinding), undefined);
});
test('10b revocation during M3 work discards the copied projection and reroutes without it', async () => {
  const f = await fixture(); const captured = []; let release;
  const gate = new Promise(resolve => { release = resolve; }); let calls = 0;
  const adapter = { provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    async interpret({ content }) { captured.push(content); if (++calls === 1) await gate; return goalMeaning; },
    async revoke() {} };
  const store = createSessionTaskStore({ adapter, now: f.clock.now, ownerSession: f.ownerBinding,
    walkResource: f.resource.access, m7NextCycle: f.consumer });
  store.start(); const task = store.submit('Khỏe hơn', { permission_granted: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(captured[0].relevant_context.length, 1);
  f.purpose.control.revoke('USE_NEXT_CYCLE'); release(); await tick(); await tick();
  assert.equal(captured.length, 2); assert.equal(captured[1].relevant_context.length, 0);
  assert.equal(store.getSnapshot().tasks.find(value => value.task_id === task).interpretation.intent_type, 'GOAL');
});
test('11 owner generation change removes prior context', async () => {
  const f = await fixture(); f.authority.results.push({ status: 'verified', owner: OWNER_B, validUntil: 200000 });
  const next = await f.boundary.control.verifySession(); f.boundary.control.finishHydration(next);
  assert.equal(readM7NextCycleContext(f.consumer, f.ownerBinding), undefined);
});
test('11a a different owner boundary cannot consume the prior owner context', async () => {
  const f = await fixture(); const clock = new FakeClock(); const authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner: OWNER_B, validUntil: 100000 });
  const lease = await boundary.control.verifySession(); boundary.control.finishHydration(lease);
  const captured = [];
  const adapter = { provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    async interpret({ content }) { captured.push(content); return goalMeaning; }, async revoke() {} };
  const store = createSessionTaskStore({ adapter, now: clock.now,
    ownerSession: { access: boundary.access, lease }, m7NextCycle: f.consumer });
  store.start(); const task = store.submit('Khỏe hơn', { permission_granted: true }); await tick();
  const ref = store.reference(task);
  assert.equal(captured[0].relevant_context.length, 0);
  assert.equal(store.readM7NextCycleContext(ref), undefined);
});
test('12 silent lease expiry fails closed on read and use', async () => {
  const f = await fixture(); f.clock.jumpWithoutTimers(100000);
  assert.equal(readM7NextCycleContext(f.consumer, f.ownerBinding), undefined);
  const current = await submitCurrent(f);
  assert.equal(current.task, undefined); assert.equal(f.captured.length, 0);
});
test('13 SAFETY_HOLD is a reassessment context, never ordinary movement context', async () => {
  const f = await fixture({ problem_state: 'PROBLEM', safety_disposition: 'REASSESS', constraint: 'NONE_REPORTED', performed_minutes: undefined });
  const item = readM7NextCycleContext(f.consumer, f.ownerBinding);
  assert.equal(item.state, 'SAFETY_HOLD'); assert.equal(item.kind, 'prior_episode:safety_reassessment');
  assert.equal(item.reported_constraint, undefined);
  const current = await submitCurrent(f);
  assert.equal(current.input.safety_signal, 'SENSITIVE');
  assert.equal(f.currentStore.getSnapshot().tasks[0].interpretation.suggested_next_role, 'STOP');
});
test('14 URGENT_HELP is a reassessment context, never ordinary movement context', async () => {
  const f = await fixture({ problem_state: 'PROBLEM', safety_disposition: 'URGENT_HELP', constraint: 'NONE_REPORTED', performed_minutes: undefined });
  const item = readM7NextCycleContext(f.consumer, f.ownerBinding);
  assert.equal(item.state, 'URGENT_HELP'); assert.equal(item.kind, 'prior_episode:safety_reassessment');
  assert.equal(item.reported_constraint, undefined);
  const current = await submitCurrent(f);
  assert.equal(current.input.safety_signal, 'SENSITIVE');
  assert.equal(f.currentStore.getSnapshot().tasks[0].interpretation.safety_state, 'SENSITIVE');
  assert.equal(f.currentStore.getTrainerActionAvailability(), 'SAFETY_HOLD');
  assert.equal(f.currentStore.getSnapshot().tasks[0].interpretation.suggested_next_role, 'STOP');
});
test('15 locale change does not alter prior-context semantics', async () => {
  const vi = await fixture(); const en = await fixture();
  const viInput = (await submitCurrent(vi, 'Khỏe hơn', 'vi')).input.relevant_context[0];
  const enInput = (await submitCurrent(en, 'Feel healthier', 'en')).input.relevant_context[0];
  const withoutCorrelation = ({ id, episode_ref: { episode_key, ...episode_ref }, ...value }) => ({
    ...value, episode_ref,
  });
  assert.deepEqual(withoutCorrelation(viInput), withoutCorrelation(enInput));
});
test('16 bridge has no Camera or Wearable dependency', async () => {
  const source = readFileSync(new URL('../domain/m7/next-cycle.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /camera|wearable/iu);
});
test('17 consumer causes no provider or network call', async () => {
  const f = await fixture(); await submitCurrent(f); assert.equal(networkCalls, 0);
});
test('18 consumer creates no durable trait or persistence surface', async () => {
  const f = await fixture(); const item = readM7NextCycleContext(f.consumer, f.ownerBinding);
  for (const field of ['trait', 'fitness_level', 'habit_score', 'durable_learning', 'storage']) {
    assert.equal(field in item, false);
  }
});
test('19 one prior episode remains explicitly prior, never a current fact', async () => {
  const f = await fixture(); const item = readM7NextCycleContext(f.consumer, f.ownerBinding);
  assert.equal(item.reported_constraint.scope, 'ONE_PRIOR_EPISODE');
  assert.equal(item.kind, 'prior_episode:m7_outcome');
  assert.equal(resolveConfirmedWalkMinutes(item, {}), undefined);
});
test('20 new cycle still needs a new M5 choice and new M6 action authority', async () => {
  const f = await fixture(); const { ref } = await submitCurrent(f);
  assert.equal(f.currentStore.getM5GoalChoiceReceipt(ref), undefined);
  assert.equal(f.currentStore.resolveM6GoalAction(ref, undefined, { available_time_minutes: 3,
    current_constraints: 'NONE_REPORTED' }), undefined);
  const decision = f.currentStore.assessM5Goal(ref, f.currentStore.assessM4GoalReadiness(ref));
  f.currentStore.acceptM5Goal(ref, decision); const nextRef = f.currentStore.reference(ref.task_id);
  assert.equal(f.currentStore.selfWalk.reportContext(nextRef, walkFacts({ available_minutes: 3, requested_minutes: 3 })), true);
  assert.equal(f.currentStore.selfWalk.propose(nextRef, 'new-proposal').state, 'PROPOSED');
  assert.equal(f.currentStore.selfWalk.getSnapshot().state, 'PROPOSED');
});
