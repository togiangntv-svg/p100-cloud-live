import assert from 'node:assert/strict';
import { extname } from 'node:path';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !extname(specifier)) {
      return nextResolve(specifier + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN_IN_M5_GOAL_TEST'); };
const { resolveGoalM5Decision } = await import('../domain/m5/goal-choice.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');

const meaning = (overrides = {}) => ({
  intent_type: 'GOAL',
  interpreted_meaning: 'Người dùng muốn khỏe hơn.',
  confidence: 0.95,
  uncertainty: null,
  missing_context: [],
  clarification_needed: false,
  clarification_question: null,
  safety_state: 'CLEAR',
  suggested_next_role: 'M4',
  task_kind: 'general_health',
  context_effect: 'NONE',
  used_context_ids: [],
  response: 'Mình hiểu mục tiêu của bạn.',
  ...overrides,
});

const task = (overrides = {}) => ({
  session_id: 'fixture-session',
  task_id: 'fixture-task',
  source_input: 'Khỏe hơn',
  revision: 3,
  status: 'READY',
  permission_revision: 1,
  permission_granted: true,
  m3_context: {
    locale: 'vi',
    current_text: 'Khỏe hơn',
    relevant_context: [],
    recent_relevant_turns: [],
    user_correction: null,
    safety_signal: 'CLEAR',
    asking_stopped: false,
  },
  interpretation: meaning(),
  ...overrides,
});

const m4Sufficient = (t = task()) => ({
  scope: { session_id: t.session_id, task_id: t.task_id, revision: t.revision },
  decision: {
    state: 'CONTEXT_SUFFICIENT',
    sufficient_for: 'NEXT_STEP_CONTRACT_ONLY',
    used_context_ids: [],
  },
});

for (const goal_kind of ['general_health', 'body_composition', 'strength', 'movement']) {
  const t = task({ interpretation: meaning({ task_kind: goal_kind }) });
  const before = JSON.stringify({ t, m4: m4Sufficient(t) });
  const first = resolveGoalM5Decision(t, m4Sufficient(t));
  const second = resolveGoalM5Decision(t, m4Sufficient(t));
  assert.deepEqual(first, {
    scope: { session_id: t.session_id, task_id: t.task_id, revision: t.revision },
    state: 'PROPOSAL',
    proposal: {
      kind: 'ADOPT_CURRENT_GOAL',
      goal_kind,
      why_code: 'CLEAR_GOAL_READY',
      tradeoff_code: 'REVERSIBLE_USER_CHOICE',
      requires_user_choice: true,
    },
  });
  assert.deepEqual(second, first);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.scope));
  assert.ok(Object.isFrozen(first.proposal));
  assert.equal(JSON.stringify({ t, m4: m4Sufficient(t) }), before);
}

{
  const t = task();
  for (const key of ['source_input', 'profile', 'goalDraft', 'age', 'weight', 'occupation']) {
    Object.defineProperty(t, key, { get() { throw new Error('PROHIBITED_GOAL_DATA_READ'); } });
  }
  for (const key of ['current_text', 'relevant_context', 'recent_relevant_turns', 'user_correction']) {
    Object.defineProperty(t.m3_context, key, { get() { throw new Error('PROHIBITED_CONTEXT_READ'); } });
  }
  assert.equal(resolveGoalM5Decision(t, m4Sufficient(t)).state, 'PROPOSAL');
}

{
  const t = task();
  for (const patch of [
    { session_id: 'other-session' },
    { task_id: 'other-task' },
    { revision: t.revision + 1 },
  ]) {
    const m4 = m4Sufficient(t); Object.assign(m4.scope, patch);
    assert.deepEqual(resolveGoalM5Decision(t, m4), {
      scope: m4.scope, state: 'NO_ACTION', reason: 'STALE_CONTEXT', proposal: null,
    });
  }
}

for (const patch of [
  { status: 'CANCELLED' },
  { status: 'PAUSED' },
  { status: 'AWAITING_INPUT' },
  { status: 'FAILED' },
  { permission_granted: false },
  { interpretation: undefined },
]) {
  const t = task(patch);
  assert.notEqual(resolveGoalM5Decision(t, m4Sufficient(t)).state, 'PROPOSAL');
}

for (const patch of [
  { intent_type: 'AMBIGUOUS' },
  { clarification_needed: true },
  { safety_state: 'PAIN' },
  { suggested_next_role: 'STOP' },
  { intent_type: 'STOP_PAUSE' },
  { intent_type: 'REFUSAL' },
  { intent_type: 'SAFETY' },
  { intent_type: 'OUT_OF_SCOPE' },
]) {
  const t = task({ interpretation: meaning(patch) });
  assert.deepEqual(resolveGoalM5Decision(t, m4Sufficient(t)), {
    scope: m4Sufficient(t).scope, state: 'NO_ACTION', reason: 'M3_BOUNDARY', proposal: null,
  });
}

{
  const t = task({ m3_context: { ...task().m3_context, safety_signal: 'URGENT' } });
  assert.equal(resolveGoalM5Decision(t, m4Sufficient(t)).reason, 'M3_BOUNDARY');
}

for (const interpretation of [
  meaning({ intent_type: 'CURRENT_TASK' }),
  meaning({ task_kind: 'meal_image_assessment' }),
  meaning({ task_kind: null }),
  meaning({ suggested_next_role: 'M5' }),
]) {
  const t = task({ interpretation });
  assert.deepEqual(resolveGoalM5Decision(t, m4Sufficient(t)), {
    scope: m4Sufficient(t).scope, state: 'NO_ACTION', reason: 'UNSUPPORTED_TASK', proposal: null,
  });
}

{
  const t = task();
  for (const decision of [
    { state: 'DEFERRED', reason: 'TASK_NOT_READY' },
    { state: 'NEED_CLARIFICATION', next_role: 'M3' },
    { state: 'PROFESSIONAL_HANDOFF_NEEDED', reason: 'OUTSIDE_AI_AUTHORITY' },
    { state: 'CONTEXT_SUFFICIENT', sufficient_for: 'EXECUTION', used_context_ids: [] },
  ]) {
    const m4 = { ...m4Sufficient(t), decision };
    assert.deepEqual(resolveGoalM5Decision(t, m4), {
      scope: m4.scope, state: 'NO_ACTION', reason: 'M4_BLOCKED', proposal: null,
    });
  }
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const adapter = {
  provenance: 'TEST_FIXTURE',
  processing: 'ON_DEVICE',
  contract: 'M3_GATEWAY_V1',
  calls: 0,
  async interpret() { this.calls++; return meaning(); },
  async revoke() {},
};
const store = createSessionTaskStore({ adapter, now: () => 700 });
store.start();
const id = store.submit('fixture goal', { permission_granted: true });
await tick();
const ref = store.reference(id);
const snapshot = store.getSnapshot();
const readiness = store.assessM4GoalReadiness(ref);
assert.equal(store.assessM5Goal(ref, readiness).state, 'PROPOSAL');
assert.equal(store.getSnapshot(), snapshot);
const other = store.submit('another goal', { permission_granted: true });
await tick();
assert.deepEqual(store.assessM5Goal(ref, readiness), {
  scope: { session_id: ref.session_id, task_id: ref.task_id, revision: ref.revision },
  state: 'NO_ACTION', reason: 'STALE_TASK', proposal: null,
});
store.cancel(store.reference(other));
const cancelledRef = store.reference(other);
assert.notEqual(store.assessM5Goal(cancelledRef, store.assessM4GoalReadiness(cancelledRef)).state, 'PROPOSAL');
assert.equal(adapter.calls, 2);
store.stop();

const acceptedStore = createSessionTaskStore({ adapter, now: () => 701 });
acceptedStore.start();
const acceptedId = acceptedStore.submit('Khỏe hơn', { permission_granted: true });
await tick();
const acceptedRef = acceptedStore.reference(acceptedId);
const acceptedM4 = acceptedStore.assessM4GoalReadiness(acceptedRef);
const acceptedProposal = acceptedStore.assessM5Goal(acceptedRef, acceptedM4);
const taskBeforeAccept = acceptedStore.getSnapshot().tasks.find(task => task.task_id === acceptedId);
const callsBeforeAccept = adapter.calls;
let receiptEvents = 0;
const unsubscribeReceipt = acceptedStore.subscribe(() => { receiptEvents += 1; });
const acceptedReceipt = acceptedStore.acceptM5Goal(acceptedRef, acceptedProposal);
assert.deepEqual(acceptedReceipt, {
  session_id: acceptedRef.session_id,
  task_id: acceptedRef.task_id,
  revision: acceptedRef.revision,
  proposal_kind: 'ADOPT_CURRENT_GOAL',
  goal_kind: 'general_health',
  choice: 'ACCEPTED',
});
assert.ok(Object.isFrozen(acceptedReceipt));
assert.deepEqual(Object.keys(acceptedReceipt).sort(), [
  'choice', 'goal_kind', 'proposal_kind', 'revision', 'session_id', 'task_id',
]);
assert.ok(!('executed' in acceptedReceipt));
assert.ok(!('persisted' in acceptedReceipt));
assert.equal(acceptedStore.getSnapshot().tasks.find(task => task.task_id === acceptedId), taskBeforeAccept);
assert.equal(adapter.calls, callsBeforeAccept);
assert.equal(receiptEvents, 1);

const postAcceptRef = acceptedStore.reference(acceptedId);
assert.equal(acceptedStore.getM5GoalChoiceReceipt(postAcceptRef), acceptedReceipt);
const currentM4 = acceptedStore.assessM4GoalReadiness(postAcceptRef);
const currentProposal = acceptedStore.assessM5Goal(postAcceptRef, currentM4);
assert.equal(
  acceptedStore.acceptM5Goal(postAcceptRef, currentProposal),
  acceptedReceipt,
  'duplicate acceptance must be idempotent',
);
assert.equal(receiptEvents, 1, 'duplicate acceptance must not publish a second effect');
assert.equal(adapter.calls, callsBeforeAccept);
unsubscribeReceipt();
assert.equal(
  acceptedStore.acceptM5Goal(acceptedRef, acceptedProposal),
  undefined,
  'the pre-publication TaskRef must be stale',
);
assert.equal(acceptedStore.getSnapshot().tasks.some(task => 'goal_choice_receipt' in task), false);

const mismatchedProposal = {
  ...currentProposal,
  proposal: { ...currentProposal.proposal, goal_kind: 'strength' },
};
assert.equal(
  acceptedStore.acceptM5Goal(acceptedStore.reference(acceptedId), mismatchedProposal),
  undefined,
  'a proposal that does not match current M3/M4/M5 must fail closed',
);

const preEditReceipt = acceptedStore.getM5GoalChoiceReceipt(acceptedStore.reference(acceptedId));
const preEditProposal = acceptedStore.assessM5Goal(
  acceptedStore.reference(acceptedId),
  acceptedStore.assessM4GoalReadiness(acceptedStore.reference(acceptedId)),
);
assert.ok(preEditReceipt);
assert.equal(acceptedStore.edit(acceptedStore.reference(acceptedId), 'Mạnh hơn'), true);
assert.equal(acceptedStore.getM5GoalChoiceReceipt(acceptedStore.reference(acceptedId)), undefined);
assert.equal(
  acceptedStore.acceptM5Goal(acceptedStore.reference(acceptedId), preEditProposal),
  undefined,
  'a proposal for an earlier revision cannot be accepted',
);
await tick();

let lifecycleRef = acceptedStore.reference(acceptedId);
let lifecycleM4 = acceptedStore.assessM4GoalReadiness(lifecycleRef);
let lifecycleProposal = acceptedStore.assessM5Goal(lifecycleRef, lifecycleM4);
assert.ok(acceptedStore.acceptM5Goal(lifecycleRef, lifecycleProposal));
assert.equal(acceptedStore.cancel(acceptedStore.reference(acceptedId)), true);
assert.equal(acceptedStore.getM5GoalChoiceReceipt(acceptedStore.reference(acceptedId)), undefined);

const permissionStore = createSessionTaskStore({ adapter, now: () => 702 });
permissionStore.start();
const permissionId = permissionStore.submit('Khỏe hơn', { permission_granted: true });
await tick();
lifecycleRef = permissionStore.reference(permissionId);
lifecycleM4 = permissionStore.assessM4GoalReadiness(lifecycleRef);
lifecycleProposal = permissionStore.assessM5Goal(lifecycleRef, lifecycleM4);
assert.ok(permissionStore.acceptM5Goal(lifecycleRef, lifecycleProposal));
const permissionTask = permissionStore.getSnapshot().tasks.find(task => task.task_id === permissionId);
assert.equal(permissionStore.retireM5GoalChoice(permissionStore.reference(permissionId)), true);
assert.equal(permissionStore.getM5GoalChoiceReceipt(permissionStore.reference(permissionId)), undefined);
assert.equal(permissionStore.getSnapshot().tasks.find(task => task.task_id === permissionId), permissionTask);
lifecycleRef = permissionStore.reference(permissionId);
lifecycleM4 = permissionStore.assessM4GoalReadiness(lifecycleRef);
lifecycleProposal = permissionStore.assessM5Goal(lifecycleRef, lifecycleM4);
assert.ok(permissionStore.acceptM5Goal(lifecycleRef, lifecycleProposal));
assert.equal(permissionStore.setM3Permission(permissionStore.reference(permissionId), false), true);
assert.equal(permissionStore.getM5GoalChoiceReceipt(permissionStore.reference(permissionId)), undefined);

const activeStore = createSessionTaskStore({ adapter, now: () => 703 });
activeStore.start();
const firstId = activeStore.submit('Khỏe hơn', { permission_granted: true });
await tick();
const firstRef = activeStore.reference(firstId);
const firstM4 = activeStore.assessM4GoalReadiness(firstRef);
const firstProposal = activeStore.assessM5Goal(firstRef, firstM4);
assert.ok(activeStore.acceptM5Goal(firstRef, firstProposal));
const secondId = activeStore.submit('Mạnh hơn', { permission_granted: true });
await tick();
assert.equal(activeStore.getM5GoalChoiceReceipt(activeStore.reference(firstId)), undefined);
assert.equal(activeStore.assessM5Goal(activeStore.reference(firstId), firstM4).state, 'NO_ACTION');
assert.equal(
  activeStore.acceptM5Goal(activeStore.reference(firstId), firstProposal),
  undefined,
  'an inactive task cannot accept or expose the old receipt',
);
assert.equal(activeStore.getM5GoalChoiceReceipt(activeStore.reference(secondId)), undefined);

const secondRef = activeStore.reference(secondId);
const secondM4 = activeStore.assessM4GoalReadiness(secondRef);
const secondProposal = activeStore.assessM5Goal(secondRef, secondM4);
assert.ok(activeStore.acceptM5Goal(secondRef, secondProposal));
const secondReceiptRef = activeStore.reference(secondId);
assert.ok(activeStore.getM5GoalChoiceReceipt(secondReceiptRef));
assert.equal(activeStore.switchTask(activeStore.reference(firstId)), true);
assert.equal(activeStore.getM5GoalChoiceReceipt(activeStore.reference(firstId)), undefined);
assert.equal(activeStore.getM5GoalChoiceReceipt(activeStore.reference(secondId)), undefined);

const restartedStore = createSessionTaskStore({ adapter, now: () => 704 });
restartedStore.start();
const restartId = restartedStore.submit('Khỏe hơn', { permission_granted: true });
await tick();
const restartRef = restartedStore.reference(restartId);
const restartM4 = restartedStore.assessM4GoalReadiness(restartRef);
const restartProposal = restartedStore.assessM5Goal(restartRef, restartM4);
assert.ok(restartedStore.acceptM5Goal(restartRef, restartProposal));
const previousSession = restartedStore.getSnapshot().session_id;
restartedStore.stop();
assert.equal(restartedStore.getM5GoalChoiceReceipt(restartRef), undefined);
restartedStore.start();
assert.notEqual(restartedStore.getSnapshot().session_id, previousSession);
assert.equal(restartedStore.getM5GoalChoiceReceipt(restartRef), undefined);
assert.equal(restartedStore.getSnapshot().tasks.length, 0);

permissionStore.stop();
activeStore.stop();
acceptedStore.stop();
restartedStore.stop();

console.log('M5 goal proposal + explicit receipt: 48 acceptance boundaries PASS');
console.log('M5 goal provider calls: 0');
