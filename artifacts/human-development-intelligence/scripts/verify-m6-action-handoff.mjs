import assert from 'node:assert/strict';
import { extname } from 'node:path';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !extname(specifier)) return nextResolve(specifier + '.ts', context);
    return nextResolve(specifier, context);
  },
});

globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN_IN_M6_HANDOFF_TEST'); };
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');

const tick = () => new Promise(resolve => setImmediate(resolve));
const meaning = (overrides = {}) => ({
  intent_type: 'GOAL', interpreted_meaning: 'Người dùng muốn cải thiện sức khỏe tổng thể.',
  confidence: 0.95, uncertainty: null, missing_context: [], clarification_needed: false,
  clarification_question: null, safety_state: 'CLEAR', suggested_next_role: 'M4',
  task_kind: 'general_health', context_effect: 'NONE', used_context_ids: [],
  response: 'Mình hiểu bạn muốn khỏe hơn.', ...overrides,
});

const createFixture = async (overrides = {}) => {
  const adapter = {
    provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1', calls: 0,
    async interpret() { this.calls += 1; return meaning(overrides); }, async revoke() {},
  };
  const store = createSessionTaskStore({ adapter, now: () => 900 });
  store.start();
  const taskId = store.submit('Khỏe hơn', { permission_granted: true });
  await tick();
  const ref = store.reference(taskId);
  const receipt = store.acceptM5Goal(ref, store.assessM5Goal(ref, store.assessM4GoalReadiness(ref)));
  return { adapter, store, taskId, receipt, ref: store.reference(taskId) };
};

const currentContext = Object.freeze({ available_time_minutes: 20, current_constraints: 'NONE_REPORTED' });

{
  const { adapter, store, ref, receipt } = await createFixture();
  assert.ok(receipt);
  const snapshotBefore = store.getSnapshot();
  const need = store.resolveM6GoalAction(ref, receipt);
  assert.deepEqual(need, {
    scope: { session_id: ref.session_id, task_id: ref.task_id, task_revision: ref.revision },
    source_m5_receipt: { session_id: receipt.session_id, task_id: receipt.task_id,
      task_revision: receipt.revision, proposal_kind: 'ADOPT_CURRENT_GOAL',
      goal_kind: 'general_health', choice: 'ACCEPTED' },
    goal_kind: 'general_health', mode: 'SELF', state: 'NEED_CONTEXT',
    missing_context: ['available_time_minutes', 'current_constraints'], execution_state: 'NOT_STARTED',
  });
  assert.equal(store.getSnapshot(), snapshotBefore, 'M6-0 resolution must not mutate SessionTask state');
  assert.ok(Object.isFrozen(need));
  assert.ok(Object.isFrozen(need.missing_context));

  const ready = store.resolveM6GoalAction(ref, receipt, currentContext);
  assert.deepEqual(ready, {
    scope: { session_id: ref.session_id, task_id: ref.task_id, task_revision: ref.revision },
    source_m5_receipt: { session_id: receipt.session_id, task_id: receipt.task_id,
      task_revision: receipt.revision, proposal_kind: 'ADOPT_CURRENT_GOAL',
      goal_kind: 'general_health', choice: 'ACCEPTED' },
    goal_kind: 'general_health', mode: 'SELF', state: 'ACTION_READY',
    action_kind: 'SELF_GUIDED_GOAL_STEP', available_time_minutes: 20,
    constraint_basis: 'NONE_REPORTED_NOT_CONFIRMED_SAFE', execution_state: 'NOT_STARTED',
  });
  assert.deepEqual(store.resolveM6GoalAction(ref, receipt, currentContext), ready);
  assert.equal(store.getSnapshot(), snapshotBefore, 'duplicate resolution must have no side effect');
  assert.equal(adapter.calls, 1);
  for (const prohibited of ['executed', 'completed', 'camera', 'wearable', 'age', 'injury', 'fitness_level']) {
    assert.equal(prohibited in ready, false);
  }
  store.stop();
}

for (const [context, missing] of [
  [{ current_constraints: 'NONE_REPORTED' }, ['available_time_minutes']],
  [{ available_time_minutes: 20 }, ['current_constraints']],
  [{ available_time_minutes: 20, current_constraints: 'REPORTED' }, ['action_adaptation']],
  [{ available_time_minutes: 20, current_constraints: 'UNTRUSTED_VALUE' }, ['current_constraints']],
]) {
  const { store, ref, receipt } = await createFixture();
  assert.deepEqual(store.resolveM6GoalAction(ref, receipt, context).missing_context, missing);
  store.stop();
}

{
  const adapter = { provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    async interpret() { return meaning(); }, async revoke() {} };
  const store = createSessionTaskStore({ adapter, now: () => 901 });
  store.start();
  const id = store.submit('Khỏe hơn', { permission_granted: true });
  await tick();
  const ref = store.reference(id);
  assert.equal(store.resolveM6GoalAction(ref, undefined, currentContext), undefined);
  assert.equal(store.getSnapshot().tasks.some(task => 'm6' in task || 'action' in task), false);
  store.stop();
}

for (const patch of [
  { session_id: 'other-session' }, { task_id: 'other-task' }, { revision: 999 },
  { goal_kind: 'strength' }, { proposal_kind: 'OTHER' }, { choice: 'DECLINED' },
]) {
  const { store, ref, receipt } = await createFixture();
  assert.equal(store.resolveM6GoalAction(ref, { ...receipt, ...patch }, currentContext), undefined);
  store.stop();
}

for (const lifecycle of ['edit', 'cancel', 'revoke']) {
  const { store, taskId, ref, receipt } = await createFixture();
  if (lifecycle === 'edit') store.edit(store.reference(taskId), 'Mạnh hơn');
  if (lifecycle === 'cancel') store.cancel(store.reference(taskId));
  if (lifecycle === 'revoke') await store.revoke(store.reference(taskId));
  assert.equal(store.resolveM6GoalAction(ref, receipt, currentContext), undefined);
  store.stop();
}

{
  const { store, taskId, ref, receipt } = await createFixture();
  const otherId = store.submit('Mạnh hơn', { permission_granted: true });
  await tick();
  assert.equal(store.resolveM6GoalAction(ref, receipt, currentContext), undefined);
  assert.notEqual(otherId, taskId);
  store.stop();
}

for (const boundary of [
  { safety_state: 'PAIN', suggested_next_role: 'STOP', intent_type: 'SAFETY' },
  { safety_state: 'URGENT', suggested_next_role: 'STOP', intent_type: 'SAFETY' },
  { intent_type: 'STOP_PAUSE', suggested_next_role: 'STOP' },
  { intent_type: 'REFUSAL', suggested_next_role: 'STOP' },
  { intent_type: 'OUT_OF_SCOPE', suggested_next_role: 'STOP' },
]) {
  const { store, ref, receipt } = await createFixture(boundary);
  assert.equal(receipt, undefined);
  assert.equal(store.resolveM6GoalAction(ref, receipt, currentContext), undefined);
  store.stop();
}

console.log('M6-0 M5 receipt -> task-bound SELF action handoff: 12 acceptance boundaries PASS');
console.log('M6-0 provider calls: 0');
