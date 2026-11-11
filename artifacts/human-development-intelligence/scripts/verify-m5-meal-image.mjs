import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !extname(specifier)) {
      return nextResolve(specifier + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});
let providerCalls = 0;
globalThis.fetch = () => {
  providerCalls += 1;
  throw new Error('NETWORK_FORBIDDEN_IN_M5_TEST');
};

const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const { createM3StubAdapter } = await import('../domain/m3/stub-adapter.ts');
const { projectM4StubContext } = await import('../domain/m4/ui-stub.ts');
const {
  M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE,
  presentMealImageM5Decision,
  resolveMealImageM5Decision,
} = await import('../domain/m5/meal-image-decision.ts');

const INPUT = 'Tôi cần đánh giá bữa ăn bằng hình ảnh.';
const wait = () => new Promise((resolve) => setTimeout(resolve, 8));
const findTask = (store, id) => store.getSnapshot().tasks.find((task) => task.task_id === id);
const currentM4 = (store, id, fixture = 'absent') => {
  const ref = store.reference(id);
  assert.ok(ref);
  return {
    ref,
    result: store.assessM4(ref, projectM4StubContext(ref, fixture)),
  };
};

const store = createSessionTaskStore({ adapter: createM3StubAdapter(0), now: () => 100 });
store.start();
const taskId = store.submit(INPUT, { permission_granted: true, permission_revision: 1 });
await wait();
assert.equal(findTask(store, taskId).status, 'READY');
const first = currentM4(store, taskId);
const decisionA = store.assessM5(
  first.ref, first.result, M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE,
);
const decisionB = store.assessM5(
  first.ref, first.result, M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE,
);
assert.deepEqual(decisionA, decisionB, 'same semantic input must yield the same decision');
assert.equal(decisionA.state, 'UNSUPPORTED');
assert.equal(decisionA.reason, 'MEAL_IMAGE_CAPABILITY_NOT_AVAILABLE');
assert.equal(decisionA.proposal, null);
assert.ok(Object.isFrozen(decisionA));
assert.ok(Object.isFrozen(decisionA.scope));

const beforePresentation = JSON.stringify(decisionA);
const brief = presentMealImageM5Decision(decisionA, 'vi', 'BRIEF');
const explained = presentMealImageM5Decision(decisionA, 'vi', 'EXPLAINED');
const explainedEnglish = presentMealImageM5Decision(decisionA, 'en', 'EXPLAINED');
assert.notEqual(brief, explained);
assert.equal(JSON.stringify(decisionA), beforePresentation,
  'presentation preference must not mutate semantic decision');
assert.equal(explained,
  'Mình hiểu bạn muốn đánh giá bữa ăn bằng ảnh. Tính năng nhận và phân tích ảnh chưa được bật, nên mình chưa thể đưa ra đánh giá đáng tin cậy.');
assert.equal(explainedEnglish,
  'I understand that you want a meal assessment from a photo. Photo intake and analysis are not enabled, so I cannot provide a trustworthy assessment yet.');
assert.equal(JSON.stringify(decisionA), beforePresentation,
  'presentation locale must not mutate semantic decision');
for (const copy of [brief, explained, explainedEnglish]) {
  assert.ok(copy);
  assert.doesNotMatch(copy, /M5|intent_type|UNSUPPORTED|MEAL_IMAGE_CAPABILITY/u);
  assert.doesNotMatch(copy, /Chụp ảnh|Chọn ảnh|Tiếp tục/u);
  assert.doesNotMatch(copy, /mô tả bữa ăn/u);
}

const validContext = currentM4(store, taskId, 'valid');
const validButUnavailable = store.assessM5(
  validContext.ref, validContext.result, M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE,
);
assert.equal(validButUnavailable.state, 'UNSUPPORTED',
  'M4 sufficiency is not capability or execution authority');
assert.equal(validButUnavailable.proposal, null);

const smuggledCapability = store.assessM5(
  validContext.ref,
  validContext.result,
  { meal_image_assessment: 'AVAILABLE' },
);
assert.equal(smuggledCapability.state, 'NO_ACTION',
  'an unapproved runtime capability label cannot create a proposal');
assert.equal(smuggledCapability.proposal, null);

for (const fixture of ['permission_denied', 'declined']) {
  const blockedContext = currentM4(store, taskId, fixture);
  const blockedDecision = store.assessM5(
    blockedContext.ref, blockedContext.result, M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE,
  );
  assert.equal(blockedDecision.state, 'UNSUPPORTED');
  const blockedCopy = presentMealImageM5Decision(blockedDecision, 'vi', 'EXPLAINED');
  assert.doesNotMatch(blockedCopy, /mô tả bữa ăn/u);
}

const oldRef = validContext.ref;
const oldM4 = validContext.result;
assert.equal(store.edit(oldRef, 'Tôi sửa yêu cầu này.'), true);
assert.deepEqual(store.assessM5(oldRef, oldM4, M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE), {
  scope: { session_id: oldRef.session_id, task_id: oldRef.task_id, revision: oldRef.revision },
  state: 'NO_ACTION', reason: 'STALE_TASK', proposal: null,
});
await wait();

const cancelStore = createSessionTaskStore({ adapter: createM3StubAdapter(0), now: () => 200 });
cancelStore.start();
const cancelId = cancelStore.submit(INPUT, { permission_granted: true });
await wait();
const cancelCurrent = currentM4(cancelStore, cancelId, 'valid');
assert.equal(cancelStore.assessM5(
  cancelCurrent.ref, cancelCurrent.result, M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE,
).state, 'UNSUPPORTED');
assert.equal(cancelStore.cancel(cancelCurrent.ref), true);
assert.equal(cancelStore.assessM5(
  cancelCurrent.ref, cancelCurrent.result, M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE,
).state, 'NO_ACTION');
const cancelledRef = cancelStore.reference(cancelId);
assert.ok(cancelledRef);
const cancelledM4 = cancelStore.assessM4(
  cancelledRef, projectM4StubContext(cancelledRef, 'valid'),
);
assert.deepEqual(cancelStore.assessM5(
  cancelledRef, cancelledM4, M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE,
), {
  scope: cancelledM4.scope, state: 'NO_ACTION', reason: 'CANCELLED', proposal: null,
});

let finishLate;
const lateMeaning = {
  intent_type: 'CURRENT_TASK', interpreted_meaning: 'meal image task', confidence: 1,
  uncertainty: null, missing_context: [], clarification_needed: false,
  clarification_question: null, safety_state: 'CLEAR', suggested_next_role: 'M4',
  task_kind: 'meal_image_assessment', context_effect: 'NONE', used_context_ids: [], response: 'understood',
};
const lateAdapter = {
  provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
  interpret() { return new Promise((resolve) => { finishLate = resolve; }); },
  async revoke() {},
};
const lateStore = createSessionTaskStore({ adapter: lateAdapter, now: () => 300 });
lateStore.start();
const lateId = lateStore.submit(INPUT, { permission_granted: true });
const lateRef = lateStore.reference(lateId);
assert.ok(lateRef);
assert.equal(lateStore.cancel(lateRef), true);
finishLate(lateMeaning);
await wait();
assert.equal(findTask(lateStore, lateId).status, 'CANCELLED');
assert.equal(findTask(lateStore, lateId).interpretation, undefined,
  'late interpretation cannot revive a cancelled task');

const isolated = createSessionTaskStore({ adapter: createM3StubAdapter(0), now: () => 400 });
isolated.start();
const taskA = isolated.submit(INPUT, { permission_granted: true });
await wait();
const taskB = isolated.submit(INPUT, { permission_granted: true });
await wait();
const aRef = isolated.reference(taskA);
const bRef = isolated.reference(taskB);
assert.ok(aRef && bRef);
const bM4 = isolated.assessM4(bRef, projectM4StubContext(bRef, 'valid'));
assert.deepEqual(isolated.assessM5(aRef, bM4, M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE), {
  scope: bM4.scope, state: 'NO_ACTION', reason: 'STALE_CONTEXT', proposal: null,
});

const readyTask = findTask(isolated, taskA);
const taskAScope = { session_id: aRef.session_id, task_id: aRef.task_id, revision: aRef.revision };
const aM4 = { scope: taskAScope, decision: { state: 'CONTEXT_REQUIRED', missing: ['meal_image'] } };
for (const patch of [
  { intent_type: 'STOP_PAUSE' },
  { intent_type: 'REFUSAL' },
  { intent_type: 'SAFETY', safety_state: 'PAIN' },
  { suggested_next_role: 'STOP' },
]) {
  const bounded = {
    ...readyTask,
    interpretation: { ...readyTask.interpretation, ...patch },
  };
  const result = resolveMealImageM5Decision(
    bounded, aM4, M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE,
  );
  assert.equal(result.state, 'NO_ACTION');
  assert.equal(result.reason, 'M3_BOUNDARY');
  assert.equal(result.proposal, null);
}

const domainSource = await readFile(new URL('../domain/m5/meal-image-decision.ts', import.meta.url), 'utf8');
const storeSource = await readFile(new URL('../domain/session-task/store.ts', import.meta.url), 'utf8');
const hookSource = await readFile(new URL('../components/useM2Gateway.ts', import.meta.url), 'utf8');
const openingSource = await readFile(new URL('../components/OpeningGoalFlow.tsx', import.meta.url), 'utf8');
assert.match(storeSource, /assessM5/u);
assert.match(hookSource, /presentMealImageM5Decision/u);
assert.match(hookSource, /M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE/u);
assert.match(hookSource, /const effectiveLocale = locale/u);
assert.match(hookSource, /presentM3TaskNotice\(activeTask,\s*m3Store,\s*gateway\?\.m4StubFixture,\s*locale\)/u);
assert.match(hookSource, /presentMealImageM5Decision\(\s*store\.assessM5\(ref, m4Result, M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE\),\s*locale,\s*'EXPLAINED',\s*\)/u);
assert.doesNotMatch(hookSource, /taskPresentationLocale|task\.m3_context\.locale/u);
assert.match(openingSource, /translate\(m2\.effectiveLocale, 'm2EditRequest'\)/u);
assert.match(openingSource, /translate\(m2\.effectiveLocale, 'm2CancelRequest'\)/u);
assert.doesNotMatch(openingSource,
  /Prototype status|Trạng thái bản thử|Simulation|Mô phỏng|m2\.m3Tasks|m3-stub-task-|switchM3Task/u);
assert.doesNotMatch(domainSource + storeSource + hookSource,
  /ImagePicker|launchCamera|AsyncStorage|aiM3|aiPilotSession|fetch\s*\(/u);
assert.doesNotMatch(domainSource, /TEXT_DESCRIPTION_OPTION/u);
assert.equal(providerCalls, 0);

for (const active of [store, cancelStore, lateStore, isolated]) active.stop();
console.log('M5 deterministic decision: PASS');
console.log('M5 edit/cancel/stale/task isolation: PASS');
console.log('M5 capability honesty and presentation separation: PASS');
console.log('M5 provider calls: 0');
