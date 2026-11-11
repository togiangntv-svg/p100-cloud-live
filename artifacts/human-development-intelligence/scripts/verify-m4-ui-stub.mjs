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
globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN_IN_M4_UI_TEST'); };

const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const { createM3StubAdapter } = await import('../domain/m3/stub-adapter.ts');
const { resolveM4Context } = await import('../domain/m4/resolver.ts');
const {
  M4_MEAL_IMAGE_STUB_INPUT,
  isM4MealImageStubInput,
  presentM4StubDecision,
  projectM4StubContext,
} = await import('../domain/m4/ui-stub.ts');

const wait = () => new Promise((resolve) => setTimeout(resolve, 5));
const stubAdapter = createM3StubAdapter(0);
assert.equal(stubAdapter.provenance, 'TEST_FIXTURE');
const store = createSessionTaskStore({ adapter: stubAdapter, now: () => 100 });
store.start();
const taskId = store.submit('Tôi cần đánh giá bữa ăn bằng hình ảnh.', {
  locale: 'en',
  permission_granted: true,
  permission_revision: 1,
});
await wait();
const task = store.getSnapshot().tasks.find((item) => item.task_id === taskId);
const ref = store.reference(taskId);
assert.equal(task.status, 'READY');
assert.equal(task.interpretation.intent_type, 'CURRENT_TASK');
assert.equal(task.interpretation.task_kind, 'meal_image_assessment');
assert.equal(task.interpretation.suggested_next_role, 'M4');
assert.equal(task.interpretation.response, 'Mình đã ghi nhận yêu cầu này.');

const nfdMealInput = M4_MEAL_IMAGE_STUB_INPUT.normalize('NFD');
assert.notEqual(nfdMealInput, M4_MEAL_IMAGE_STUB_INPUT);
assert.equal(isM4MealImageStubInput(nfdMealInput), true);
const nfdStore = createSessionTaskStore({ adapter: createM3StubAdapter(0), now: () => 150 });
nfdStore.start();
const nfdTaskId = nfdStore.submit(nfdMealInput, {
  locale: 'vi', permission_granted: true, permission_revision: 1,
});
await wait();
const nfdTask = nfdStore.getSnapshot().tasks.find((item) => item.task_id === nfdTaskId);
assert.equal(nfdTask.status, 'READY');
assert.equal(nfdTask.interpretation.intent_type, 'CURRENT_TASK');
assert.equal(nfdTask.interpretation.task_kind, 'meal_image_assessment');
assert.equal(nfdTask.interpretation.suggested_next_role, 'M4');
assert.equal(nfdTask.interpretation.clarification_needed, false);
assert.equal(nfdTask.source_input, nfdMealInput);
assert.equal(nfdTask.m3_context.current_text, nfdMealInput);

const assess = (fixture, useRef = ref) => store.assessM4(
  useRef,
  projectM4StubContext({
    session_id: useRef.session_id,
    task_id: useRef.task_id,
    revision: useRef.revision,
  }, fixture),
).decision;

const missing = assess('absent');
assert.equal(missing.state, 'CONTEXT_REQUIRED');
assert.equal(presentM4StubDecision(missing, 'vi'),
  'Mình đã ghi nhận yêu cầu này.');
assert.equal(task.m3_context.locale, 'en');
assert.equal(isM4MealImageStubInput(task.source_input), true);
assert.equal(presentM4StubDecision(missing,
  isM4MealImageStubInput(task.source_input) ? 'vi' : task.m3_context.locale),
  'Mình đã ghi nhận yêu cầu này.');
assert.equal(presentM4StubDecision(missing, 'en'), "I've noted your request.");
assert.doesNotMatch(presentM4StubDecision(missing, 'vi'),
  /Bản thử|giả lập|mô phỏng|prototype|stub|simulation|CONTEXT|MEAL_IMAGE|profile|mục tiêu|tuổi|cân nặng|gửi ảnh/u);

const copyStore = createSessionTaskStore({ adapter: createM3StubAdapter(0), now: () => 200 });
copyStore.start();
const vietnameseGenericId = copyStore.submit('Tôi cần sắp xếp việc hôm nay.', {
  locale: 'vi', permission_granted: true, permission_revision: 1,
});
await wait();
const vietnameseGeneric = copyStore.getSnapshot().tasks.find((item) => item.task_id === vietnameseGenericId);
assert.equal(vietnameseGeneric?.interpretation?.response,
  'Mình hiểu điều bạn đang muốn là: Tôi cần sắp xếp việc hôm nay.');
const vietnameseGenericRef = copyStore.reference(vietnameseGenericId);
assert.ok(vietnameseGenericRef);
assert.equal(copyStore.edit(vietnameseGenericRef, 'Tôi muốn đổi yêu cầu này.'), true);
await wait();
assert.equal(copyStore.getSnapshot().tasks.find((item) => item.task_id === vietnameseGenericId)?.interpretation?.response,
  'Mình hiểu điều bạn đang muốn là: Tôi muốn đổi yêu cầu này.');
const englishGenericId = copyStore.submit('Please help me plan today.', {
  locale: 'en', permission_granted: true, permission_revision: 1,
});
await wait();
const englishGeneric = copyStore.getSnapshot().tasks.find((item) => item.task_id === englishGenericId);
assert.equal(englishGeneric?.interpretation?.response,
  'I understand what you want is: Please help me plan today.');
for (const [label, expected] of [
  ['Khỏe hơn', 'Mình hiểu bạn muốn cơ thể khỏe hơn.'],
  ['Gọn đẹp hơn', 'Mình hiểu bạn muốn cơ thể gọn đẹp hơn.'],
  ['Mạnh hơn', 'Mình hiểu bạn muốn cơ thể mạnh hơn.'],
  ['Vận động tốt hơn', 'Mình hiểu bạn muốn cơ thể vận động tốt hơn.'],
]) {
  const id = copyStore.submit(label, {
    locale: 'vi', permission_granted: true, permission_revision: 1,
  });
  await wait();
  assert.equal(copyStore.getSnapshot().tasks.find((item) => item.task_id === id)?.interpretation?.response,
    expected);
}
for (const response of [
  task.interpretation.response,
  vietnameseGeneric?.interpretation?.response,
  englishGeneric?.interpretation?.response,
]) {
  assert.doesNotMatch(response, /Bản thử|giả lập|mô phỏng|prototype|stub|simulation|M3|M4|M5|provider|fixture/u);
}

const valid = assess('valid');
assert.equal(valid.state, 'CONTEXT_SUFFICIENT');
assert.match(presentM4StubDecision(valid, 'vi'), /Chưa có bước phân tích ảnh nào/u);
assert.doesNotMatch(presentM4StubDecision(valid, 'vi'), /gửi ảnh/u);

const denied = assess('permission_denied');
assert.equal(denied.state, 'PERMISSION_REQUIRED');
assert.match(presentM4StubDecision(denied, 'vi'), /chưa có quyền sử dụng/u);

const declined = assess('declined');
assert.equal(declined.state, 'CONTEXT_DECLINED');
assert.match(presentM4StubDecision(declined, 'vi'), /không yêu cầu lại ảnh/u);

const stopped = {
  ...task,
  m3_context: { ...task.m3_context, asking_stopped: true },
};
assert.equal(resolveM4Context(stopped, projectM4StubContext(ref, 'valid')).decision.state,
  'CONTEXT_SUFFICIENT');
assert.deepEqual(resolveM4Context(stopped, projectM4StubContext(ref, 'absent')).decision,
  { state: 'DEFERRED', reason: 'M3_BOUNDARY' });

const taskB = { ...task, task_id: 'fixture-task-b' };
const taskBContext = projectM4StubContext({
  session_id: taskB.session_id,
  task_id: taskB.task_id,
  revision: taskB.revision,
}, 'valid');
assert.equal(resolveM4Context(task, taskBContext).decision.reason, 'STALE_CONTEXT');
const stale = projectM4StubContext({ ...ref, revision: ref.revision + 1 }, 'valid');
assert.equal(resolveM4Context(task, stale).decision.reason, 'STALE_CONTEXT');

const hook = await readFile(new URL('../components/useM2Gateway.ts', import.meta.url), 'utf8');
const host = await readFile(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
const flow = await readFile(new URL('../components/OpeningGoalFlow.tsx', import.meta.url), 'utf8');
assert.match(hook, /store\.assessM4/u);
assert.match(hook, /presentM4StubDecision/u);
assert.match(hook, /presentM3TaskNotice\(activeTask,\s*m3Store,\s*gateway\?\.m4StubFixture,\s*locale\)/u);
assert.match(hook, /m3Permission\.showExternalPermissionNotice/u);
assert.doesNotMatch(hook, /permission_granted: Boolean\(m3Adapter\)/u);
assert.match(host, /m4StubFixture: 'absent'/u);
assert.match(flow, /accessibilityLiveRegion="polite"/u);
assert.match(flow, /testID="m4-primary-response"/u);
assert.match(flow, /m2\.activeM3Task/u);
assert.match(flow, /!m2\.adaptiveHandoff/u);
assert.match(flow, /if \(setGoalDraft\(''\) && m2\.cancelM3Task\(\)\)/u);
assert.match(hook, /setM3NoticeKey\('m2Cancelled'\)/u);
assert.match(hook, /task\.status !== 'CANCELLED'/u);
assert.doesNotMatch(flow,
  /Prototype status|Trạng thái bản thử|Simulation|Mô phỏng|m2\.m3Tasks|m3-stub-task-|switchM3Task/u);
assert.doesNotMatch(flow, /showM3Diagnostics|m3-stub-details-toggle|m3-stub-active-response/u);
assert.doesNotMatch(flow, /M3 AI thật|Live AI M3|Nghiệm thu M3|Stub M3|NEEDS_ROUTING|intent_type/u);
assert.doesNotMatch(hook + host, /AsyncStorage|ImagePicker|launchCamera|fetch\s*\(/u);

store.stop();
copyStore.stop();
console.log('M4 UI host: canonical M3 -> SessionTask -> M4 -> existing notice PASS');
console.log('M4 UI cases: 8/8 PASS');
