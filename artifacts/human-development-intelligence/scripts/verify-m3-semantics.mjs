import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';

registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('.') && !extname(specifier) ? specifier + '.ts' : specifier, context);
} });
let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw new Error('NETWORK_FORBIDDEN'); };
const { createM3StubAdapter } = await import('../domain/m3/stub-adapter.ts');
const { deriveM3TextSafetyFloor } = await import('../../../lib/api-zod/src/m3-text-safety-floor.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const adapter = createM3StubAdapter(0);
const input = (text, extra = {}) => ({ locale: 'vi', current_text: text, relevant_context: [],
  recent_relevant_turns: [], user_correction: null, safety_signal: 'CLEAR', asking_stopped: false, ...extra });
const interpret = (text, extra) => adapter.interpret({ content: input(text, extra), operation: {
  ticket: { session_id: 's', task_id: 't', task_revision: 1, permission_revision: 1, operation_id: 'o' },
  permission: { external_access: 'M3_TEXT', purpose: 'm3_intent_understanding', revision: 1 }, isCurrent: () => true,
} }, new AbortController().signal);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const context = [{ id: 'workout-1', kind: 'active_task:workout', text: 'An active workout session' }];
test('wellness is understood without profile questions or echo', async () => {
  const result = await interpret('Khỏe hơn');
  assert.equal(result.intent_type, 'GOAL');
  assert.equal(result.task_kind, 'general_health');
  assert.equal(result.clarification_needed, false);
  assert.equal(result.suggested_next_role, 'M4');
  assert.match(result.interpreted_meaning, /sức khỏe tổng thể/u);
  assert.doesNotMatch(result.interpreted_meaning, /Đã hiểu việc|Khỏe hơn/u);
});
test('free composite goal keeps both fat reduction and muscle preservation', async () => {
  for (const text of ['Tôi muốn bụng nhỏ lại nhưng giữ cơ', 'Mình muốn giảm mỡ bụng và vẫn giữ cơ bắp']) {
    const result = await interpret(text);
    assert.equal(result.intent_type, 'GOAL');
    assert.equal(result.task_kind, 'body_composition');
    assert.match(result.interpreted_meaning, /giảm mỡ/u);
    assert.match(result.interpreted_meaning, /giữ cơ/u);
    assert.equal(result.clarification_needed, false);
  }
});
test('time constraint consumes only explicit active task context', async () => {
  const result = await interpret('Còn 20 phút', { relevant_context: context });
  assert.equal(result.intent_type, 'CURRENT_TASK');
  assert.equal(result.task_kind, 'workout');
  assert.equal(result.context_effect, 'ADJUST_CURRENT');
  assert.deepEqual(result.used_context_ids, ['workout-1']);
  assert.match(result.interpreted_meaning, /20/u);
  assert.equal(result.clarification_needed, false);
  const absent = await interpret('Còn 20 phút', { recent_relevant_turns: [{ role: 'user', text: 'Tôi đang tập luyện' }] });
  assert.equal(absent.intent_type, 'AMBIGUOUS');
  assert.equal(absent.clarification_needed, true);
  assert.deepEqual(absent.missing_context, ['active_task']);
});
test('semantic correction replaces fat-loss interpretation with discomfort', async () => {
  const result = await interpret('Không, tôi nói bụng khó chịu', {
    relevant_context: [{ id: 'old', kind: 'active_task:body_composition', text: 'giảm mỡ bụng, giữ cơ' }],
  });
  assert.equal(result.intent_type, 'CORRECTION');
  assert.equal(result.task_kind, 'physical_discomfort');
  assert.equal(result.safety_state, 'SENSITIVE');
  assert.match(result.interpreted_meaning, /khó chịu/u);
  assert.doesNotMatch(result.interpreted_meaning, /giảm mỡ|giữ cơ/u);
  assert.equal(result.context_effect, 'ADJUST_CURRENT');
  assert.equal(result.clarification_needed, false);
});
test('stop, refusal and pause do not ask or create an action', async () => {
  for (const text of ['Thôi', 'Dừng lại', 'Tạm dừng', 'Không muốn tiếp tục', 'Stop', 'No thanks', 'Pause']) {
    const result = await interpret(text);
    assert.ok(['STOP_PAUSE', 'REFUSAL'].includes(result.intent_type));
    assert.equal(result.suggested_next_role, 'STOP');
    assert.equal(result.clarification_needed, false);
    assert.equal(result.task_kind, null);
  }
});
test('joke and unknown text are not fabricated tasks', async () => {
  const joke = await interpret('Tôi muốn thành siêu nhân, đùa thôi');
  assert.equal(joke.intent_type, 'HUMOR_PRAGMATIC');
  assert.equal(joke.suggested_next_role, 'STOP');
  const ambiguous = await interpret('Cái đó ấy');
  assert.equal(ambiguous.intent_type, 'AMBIGUOUS');
  assert.equal(ambiguous.clarification_needed, true);
  assert.deepEqual(ambiguous.missing_context, ['intended_request']);
  const stopped = await interpret('Cái đó ấy', { asking_stopped: true });
  assert.equal(stopped.clarification_needed, false);
  assert.equal(stopped.clarification_question, null);
  assert.equal(stopped.suggested_next_role, 'STOP');
});
test('safety precedes joking and does not diagnose', async () => {
  const result = await interpret('Đầu gối đau nhói khi squat, đùa thôi');
  assert.equal(result.intent_type, 'SAFETY');
  assert.equal(result.safety_state, 'PAIN');
  assert.equal(result.suggested_next_role, 'STOP');
  assert.doesNotMatch(result.response, /siêu nhân|cố lên|tiếp tục squat/u);
});

test('shared VI/EN text floor recognizes only bounded current red flags and fixture uses it', async () => {
  const cases = [
    ['vi', 'Đang đi tôi tức ngực', 'URGENT'],
    ['vi', 'Tôi đang đau ngực', 'URGENT'],
    ['vi', 'Đang tập tôi thấy đè ép ở ngực', 'URGENT'],
    ['vi', 'Tôi vừa ngất lúc đi', 'URGENT'],
    ['vi', 'Tôi bị ngất khi đang tập', 'URGENT'],
    ['vi', 'Tôi khó thở dữ dội', 'URGENT'],
    ['vi', 'Tôi khó thở đến mức không nói hết câu', 'URGENT'],
    ['vi', 'Đột nhiên tôi yếu một bên', 'URGENT'],
    ['vi', 'Đột nhiên tôi khó nói', 'URGENT'],
    ['vi', 'Đang đi thì đầu gối đau nhói', 'PAIN'],
    ['vi', 'Tôi đau nhói khi đang tập', 'PAIN'],
    ['vi', 'Tôi choáng nặng, sắp ngất', 'SENSITIVE'],
    ['vi', 'Đang đi tôi thấy sắp ngất', 'SENSITIVE'],
    ['en', 'I have chest pain while walking', 'URGENT'],
    ['en', 'I am having chest pressure while exercising', 'URGENT'],
    ['en', 'My chest feels tight while I am walking', 'URGENT'],
    ['en', 'I just fainted while walking', 'URGENT'],
    ['en', 'I passed out while exercising', 'URGENT'],
    ['en', 'I have severe trouble breathing', 'URGENT'],
    ['en', 'I am too short of breath to finish a sentence', 'URGENT'],
    ['en', 'Suddenly one side feels weak', 'URGENT'],
    ['en', 'I suddenly have trouble speaking', 'URGENT'],
    ['en', 'I have sharp pain while moving', 'PAIN'],
    ['en', 'My knee suddenly hurts sharply while walking', 'PAIN'],
    ['en', 'I feel very dizzy and almost faint', 'SENSITIVE'],
    ['en', 'I feel like I may pass out while walking', 'SENSITIVE'],
  ];
  for (const [locale, text, expected] of cases) {
    assert.equal(deriveM3TextSafetyFloor(locale, text), expected, `${locale}: ${text}`);
    const result = await interpret(text, { locale });
    assert.equal(result.safety_state, expected, `${locale}: ${text}`);
    assert.equal(result.intent_type, 'SAFETY');
    assert.equal(result.suggested_next_role, 'STOP');
    assert.equal(result.clarification_question, null);
  }
});

test('shared floor excludes hypothetical, third-party, historical, negated and ordinary recovery text', () => {
  const clear = [
    ['vi', 'Nếu tôi bị đau ngực thì sao?'], ['en', 'What if I get chest pain?'],
    ['vi', 'Bạn tôi vừa bị ngất.'], ['en', 'My friend fainted.'],
    ['vi', 'Năm ngoái tôi từng ngất.'], ['en', 'I fainted last year.'],
    ['vi', 'Tôi không đau ngực.'], ['en', 'I do not have chest pain.'],
    ['vi', 'Chân tôi hơi mỏi sau khi đi.'], ['en', 'My legs are a little tired after walking.'],
    ['vi', 'Hôm sau cơ hơi đau mỏi.'], ['en', 'My muscles are a little sore the next day.'],
    ['vi', 'Tôi khó chịu.'], ['en', 'My chest feels weird.'],
  ];
  for (const [locale, text] of clear) {
    assert.equal(deriveM3TextSafetyFloor(locale, text), 'CLEAR', `${locale}: ${text}`);
  }
  // A supported mixed-language critical signal remains safety-relevant; this
  // is explicit mixed-language recognition, not an English locale fallback.
  assert.equal(deriveM3TextSafetyFloor('es', 'I have chest pain while walking'), 'URGENT');
  assert.equal(deriveM3TextSafetyFloor('en',
    'My friend fainted. I have chest pain while walking'), 'URGENT');
});
test('mentioning someone else or rejecting part of a goal is not self intent', async () => {
  for (const text of ['Bạn tôi muốn bụng nhỏ lại nhưng giữ cơ', 'Tôi muốn bụng nhỏ lại nhưng không giữ cơ']) {
    const result = await interpret(text);
    assert.notEqual(result.intent_type, 'GOAL');
    assert.notEqual(result.task_kind, 'body_composition');
  }
});
test('negation and partial correction are not silently converted into goals', async () => {
  const negated = await interpret('Tôi không muốn bụng nhỏ lại nhưng giữ cơ');
  assert.notEqual(negated.intent_type, 'GOAL');
  const correction = await interpret('Không, không phải thế');
  assert.equal(correction.intent_type, 'CORRECTION');
  assert.equal(correction.clarification_needed, true);
  assert.equal(correction.task_kind, null);
});
test('determinism, locale and provenance preserve the semantic decision', async () => {
  const vi = await interpret('Khỏe hơn');
  assert.deepEqual(await interpret('Khỏe hơn'), vi);
  const en = await interpret('Khỏe hơn', { locale: 'en' });
  for (const key of ['intent_type', 'task_kind', 'safety_state', 'suggested_next_role', 'clarification_needed']) assert.equal(en[key], vi[key]);
  assert.match(en.response, /health/i);
  assert.equal(adapter.provenance, 'TEST_FIXTURE');
});

const settle = () => new Promise(resolve => setTimeout(resolve, 10));
const details = { locale: 'vi', permission_granted: true, permission_revision: 1 };
const taskAt = (store, id) => store.getSnapshot().tasks.find(task => task.task_id === id);
test('session correction invalidates the prior interpretation and old reference', async () => {
  const store = createSessionTaskStore({ adapter }); store.start();
  const id = store.submit('Tôi muốn bụng nhỏ lại nhưng giữ cơ', details); await settle();
  const old = store.reference(id);
  assert.equal(store.submit('Không, tôi nói bụng khó chịu', details), id);
  assert.equal(taskAt(store, id).interpretation, undefined);
  await settle();
  assert.equal(taskAt(store, id).interpretation.task_kind, 'physical_discomfort');
  assert.equal(store.cancel(old), false);
  assert.equal(store.getSnapshot().tasks.length, 1);
  store.stop();
});
test('active task constraint stays scoped; cancelled or different task is not borrowed', async () => {
  const store = createSessionTaskStore({ adapter }); store.start();
  const id = store.submit('Tôi đang tập luyện', details); await settle();
  const old = store.reference(id);
  assert.equal(store.submit('Còn 20 phút', details), id); await settle();
  assert.equal(taskAt(store, id).interpretation.task_kind, 'workout');
  assert.equal(store.cancel(old), false);
  assert.equal(store.cancel(store.reference(id)), true);
  assert.equal(store.edit(store.reference(id), 'Tôi đang tập luyện'), false);
  assert.equal(store.switchTask(store.reference(id)), false);
  const next = store.submit('Còn 20 phút', details); await settle();
  assert.notEqual(next, id);
  assert.equal(taskAt(store, id).status, 'CANCELLED');
  assert.equal(taskAt(store, next).interpretation.clarification_needed, true);
  const meal = store.submit('Tôi cần đánh giá bữa ăn bằng hình ảnh.', details); await settle();
  assert.notEqual(meal, next);
  assert.deepEqual(taskAt(store, meal).m3_context.relevant_context, []);
  store.stop();
});
test('stop aborts a pending interpretation without restoring it later', async () => {
  const store = createSessionTaskStore({ adapter: createM3StubAdapter(30) }); store.start();
  const id = store.submit('Tôi muốn bụng nhỏ lại nhưng giữ cơ', details);
  assert.equal(store.submit('Thôi', details), id);
  await new Promise(resolve => setTimeout(resolve, 65));
  assert.equal(taskAt(store, id).status, 'PAUSED');
  assert.equal(taskAt(store, id).interpretation.intent_type, 'STOP_PAUSE');
  assert.equal(taskAt(store, id).interpretation.task_kind, null);
  store.stop();
});
test('follow-up cannot inherit permission from a previous allowed attempt', async () => {
  const store = createSessionTaskStore({ adapter }); store.start();
  const id = store.submit('Tôi đang tập luyện', details); await settle();
  store.submit('Còn 20 phút', { permission_granted: false, permission_revision: 2 }); await settle();
  assert.equal(taskAt(store, id).status, 'UNSUPPORTED');
  assert.equal(taskAt(store, id).interpretation, undefined);
  store.stop();
});
test('a time constraint cannot erase an active safety boundary', async () => {
  const store = createSessionTaskStore({ adapter }); store.start();
  const id = store.submit('Đầu gối đau nhói khi squat', details); await settle();
  store.submit('Còn 20 phút', details); await settle();
  assert.equal(taskAt(store, id).interpretation.safety_state, 'PAIN');
  assert.equal(taskAt(store, id).interpretation.suggested_next_role, 'STOP');
  store.submit('Còn 10 phút', { ...details, safety_signal: 'URGENT' }); await settle();
  assert.equal(taskAt(store, id).interpretation.safety_state, 'URGENT');
  assert.equal(taskAt(store, id).interpretation.suggested_next_role, 'STOP');
  store.stop();
});
let failed = 0;
for (const [name, run] of tests) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}
assert.equal(networkCalls, 0);
console.log(`M3 semantics: ${tests.length - failed}/${tests.length} PASS; network/provider calls: 0`);
if (failed) process.exitCode = 1;
