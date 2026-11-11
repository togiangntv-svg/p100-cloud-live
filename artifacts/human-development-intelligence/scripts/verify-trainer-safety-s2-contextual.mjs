import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { test } from 'node:test';

registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('.') && !extname(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw new Error('NETWORK_FORBIDDEN_IN_SAFETY_S2'); };

const { deriveM3TextSafetyFloor } = await import('../../../lib/api-zod/src/m3-text-safety-floor.ts');
const { evaluateTrainerSafetyText, recognizeTrainerSafety } =
  await import('../../../lib/api-zod/src/trainer-safety-policy.ts');
const { validateMeaning } = await import('../../../lib/api-zod/src/m3-meaning.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');

const input = (locale, text, changes = {}) => ({
  locale, current_text: text, relevant_context: [], recent_relevant_turns: [],
  user_correction: null, safety_signal: 'CLEAR', asking_stopped: false, ...changes,
});
const meaning = (changes = {}) => ({
  intent_type: 'CURRENT_TASK', interpreted_meaning: 'The current request is understood.',
  confidence: 0.9, uncertainty: null, missing_context: [], clarification_needed: false,
  clarification_question: null, safety_state: 'CLEAR', suggested_next_role: 'M4',
  task_kind: 'general_health', context_effect: 'NONE', used_context_ids: [],
  response: 'I understand the current request.', ...changes,
});
const tick = () => new Promise(resolve => setImmediate(resolve));

const release8 = [
  ['vi', 'Đang chạy thì tôi tức ngực.'],
  ['en', 'My chest is tight during this run.'],
  ['zh-Hans', '我跑步时胸口有压迫感。'],
  ['es', 'Tengo presión en el pecho mientras corro.'],
  ['hi', 'दौड़ते समय मेरे सीने में दबाव है।'],
  ['ja', '走っていると胸が締め付けられます。'],
  ['ko', '달리는 중 가슴이 조여요.'],
  ['ru', 'Во время бега у меня давление в груди.'],
];

test('01 Release 8 equivalent current chest pressure uses one URGENT policy', () => {
  for (const [locale, text] of release8) {
    const decision = evaluateTrainerSafetyText(locale, text, 4);
    assert.equal(decision.level, 'URGENT', `${locale}: ${text}`);
    assert.equal(decision.authority_effect, 'URGENT_HELP', locale);
    assert.equal(decision.observations[0].revision, 4, locale);
  }
});

test('02 historical event is retained as history without becoming current emergency', () => {
  const decision = evaluateTrainerSafetyText('vi', 'Năm ngoái tôi từng tức ngực khi chạy.');
  assert.equal(decision.level, 'CLEAR');
  assert.equal(decision.observations[0].time, 'HISTORICAL');
  assert.equal(decision.observations[0].currentness, 'NOT_CURRENT');
});

test('03 negation applies to chest pain without claiming medical clearance', () => {
  const decision = evaluateTrainerSafetyText('vi', 'Tôi không đau ngực.');
  assert.equal(decision.level, 'CLEAR');
  assert.equal(decision.recognition, 'MATCH');
  assert.equal(decision.observations[0].assertion, 'NEGATED');
});

test('04 other-person report is not attached to the current owner', () => {
  const decision = evaluateTrainerSafetyText('vi', 'Bạn tôi bị đau ngực.');
  assert.equal(decision.level, 'CLEAR');
  assert.equal(decision.observations[0].subject, 'OTHER');
});

test('05 hypothetical signal does not create a current urgent event', () => {
  const decision = evaluateTrainerSafetyText('vi', 'Nếu chạy mà đau ngực thì sao?');
  assert.equal(decision.level, 'CLEAR');
  assert.equal(decision.observations[0].assertion, 'HYPOTHETICAL');
});

test('06 mild post-exercise soreness stays ordinary and creates no diagnosis', () => {
  const decision = evaluateTrainerSafetyText('vi', 'Tôi hơi mỏi chân sau buổi hôm qua.');
  assert.equal(decision.level, 'CLEAR');
  assert.notEqual(decision.authority_effect, 'URGENT_HELP');
});

test('07 action-relevant sharp pain stops the relevant action', () => {
  const decision = evaluateTrainerSafetyText('vi', 'Đầu gối đau nhói khi squat.');
  assert.equal(decision.level, 'PAIN');
  assert.equal(decision.authority_effect, 'STOP_RELEVANT_ACTION');
});

test('08 ordinary breathlessness after running is not promoted to urgent', () => {
  assert.equal(deriveM3TextSafetyFloor('vi', 'Tôi hơi hụt hơi vì vừa chạy nhanh.'), 'CLEAR');
});

test('09 severe current breathlessness is urgent', () => {
  assert.equal(deriveM3TextSafetyFloor('vi', 'Tôi khó thở đến mức không nói hết câu.'), 'URGENT');
});

test('10 recent fainting during exertion is urgent', () => {
  const observation = recognizeTrainerSafety('vi', 'Tôi vừa ngất khi đang chạy.')[0];
  assert.equal(observation.signal, 'FAINTING');
  assert.equal(observation.time, 'RECENT_UNRESOLVED');
  assert.equal(evaluateTrainerSafetyText('vi', 'Tôi vừa ngất khi đang chạy.').level, 'URGENT');
});

test('11 near-fainting holds without claiming loss of consciousness', () => {
  const decision = evaluateTrainerSafetyText('vi', 'Tôi thấy sắp ngất.');
  assert.equal(decision.level, 'SENSITIVE');
  assert.equal(decision.observations[0].signal, 'NEAR_FAINTING');
});

test('12 wearable reassurance in text cannot lower a current user chest report', () => {
  assert.equal(deriveM3TextSafetyFloor('vi',
    'Đồng hồ bảo bình thường, nhưng tôi đang đau ngực.'), 'URGENT');
});

test('13 unknown or uncertain action-relevant signal becomes HOLD, not CLEAR or URGENT', () => {
  const decision = evaluateTrainerSafetyText('vi', 'Tôi không chắc có đau ngực không.');
  assert.equal(decision.knowledge, 'UNKNOWN');
  assert.equal(decision.level, 'SENSITIVE');
  assert.equal(decision.authority_effect, 'HOLD');
});

test('14 no match is UNKNOWN recognition and not a medical-safe claim', () => {
  const decision = evaluateTrainerSafetyText('vi', 'Hôm nay tôi muốn đi bộ nhẹ.');
  assert.equal(decision.recognition, 'NO_MATCH');
  assert.equal(decision.knowledge, 'UNKNOWN');
  assert.equal(decision.level, 'CLEAR');
});

test('15 observation correction is revision-bound and does not mutate old evidence', () => {
  const oldObservation = recognizeTrainerSafety('vi', 'Tôi đang đau ngực.', 7)[0];
  const correction = recognizeTrainerSafety('vi', 'Đó là bạn tôi bị đau ngực.', 8)[0];
  assert.equal(oldObservation.revision, 7);
  assert.equal(oldObservation.subject, 'USER');
  assert.equal(correction.revision, 8);
  assert.equal(correction.subject, 'OTHER');
});

test('16 model CLEAR cannot lower the local URGENT floor', () => {
  const result = validateMeaning(meaning(), input('vi', 'Đang chạy thì tôi tức ngực.'));
  assert.equal(result.safety_state, 'URGENT');
  assert.equal(result.intent_type, 'SAFETY');
  assert.equal(result.suggested_next_role, 'STOP');
});

test('17 model URGENT may raise an otherwise ordinary local input', () => {
  const result = validateMeaning(meaning({ safety_state: 'URGENT' }),
    input('vi', 'Hôm nay tôi muốn đi bộ nhẹ.'));
  assert.equal(result.safety_state, 'URGENT');
  assert.equal(result.suggested_next_role, 'STOP');
});

test('18 mixed negation does not swallow a separate asserted fainting signal', () => {
  const decision = evaluateTrainerSafetyText('vi', 'Tôi không đau ngực và vừa ngất khi đi bộ.');
  assert.equal(decision.level, 'URGENT');
  assert.ok(decision.observations.some(item => item.signal === 'CHEST_PAIN_OR_PRESSURE'
    && item.assertion === 'NEGATED'));
  assert.ok(decision.observations.some(item => item.signal === 'FAINTING'
    && item.assertion === 'ASSERTED'));
});

test('19 historical prefix cannot hide a separate current chest observation', () => {
  assert.equal(deriveM3TextSafetyFloor('vi',
    'Năm ngoái từng đau, nhưng bây giờ đang tức ngực.'), 'URGENT');
});

test('20 other-person and user signals in one turn stay scoped separately', () => {
  const decision = evaluateTrainerSafetyText('vi',
    'Bạn tôi bị đau ngực, còn tôi khó thở đến mức không nói hết câu.');
  assert.equal(decision.level, 'URGENT');
  assert.equal(decision.observations[0].subject, 'OTHER');
  assert.ok(decision.observations.some(item => item.subject === 'USER'
    && item.signal === 'SEVERE_BREATHLESSNESS'));
});

test('21 Vietnamese without diacritics remains recognizable', () => {
  assert.equal(deriveM3TextSafetyFloor('vi', 'Dang chay thi toi tuc nguc'), 'URGENT');
});

test('22 punctuation is optional for a supported current signal', () => {
  assert.equal(deriveM3TextSafetyFloor('vi', 'Đang chạy thì tôi tức ngực'), 'URGENT');
});

test('23 mixed-language critical signal is explicit and locale-independent', () => {
  assert.equal(deriveM3TextSafetyFloor('ko', '운동 중 chest pain'), 'URGENT');
});

test('24 denied M3 permission cannot disable local Safety', async () => {
  const store = createSessionTaskStore();
  store.start();
  const task = store.submit('Đang chạy thì tôi tức ngực.', {
    locale: 'vi', permission_granted: false,
  });
  await tick();
  const snapshot = store.getSnapshot().tasks.find(item => item.task_id === task);
  assert.equal(snapshot.m3_context.safety_signal, 'URGENT');
  assert.equal(snapshot.status, 'PAUSED');
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
});

test('25 provider timeout cannot clear the already-applied local floor', async () => {
  const adapter = Object.freeze({
    provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    async interpret() { throw new Error('EXPECTED_TIMEOUT'); }, async revoke() {},
  });
  const store = createSessionTaskStore({ adapter });
  store.start();
  const task = store.submit('I just fainted while running.', {
    locale: 'en', permission_granted: true,
  });
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
  await tick(); await tick();
  assert.equal(store.getSnapshot().tasks.find(item => item.task_id === task).status, 'PAUSED');
});

test('26 malformed provider result cannot clear the already-applied local floor', async () => {
  const adapter = Object.freeze({
    provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    async interpret() { throw new Error('M3_OUTPUT_INVALID'); }, async revoke() {},
  });
  const store = createSessionTaskStore({ adapter });
  store.start();
  store.submit('I have severe trouble breathing.', { locale: 'en', permission_granted: true });
  await tick(); await tick();
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
});

test('27 manual Stop works locally with M3 denied and asks for no outcome authority', async () => {
  const store = createSessionTaskStore();
  store.start();
  const task = store.submit('Khỏe hơn', { locale: 'vi', permission_granted: false });
  await tick();
  assert.equal(store.submit('Dừng lại', { locale: 'vi', permission_granted: false }), task);
  await tick();
  const stopped = store.getSnapshot().tasks.find(item => item.task_id === task);
  assert.equal(stopped.status, 'PAUSED');
  assert.equal(stopped.m3_context.asking_stopped, true);
});

test('28 verifier performs no provider, network, build, or persistence call', () => {
  assert.equal(networkCalls, 0);
});

test('29 sudden neurologic-like warning is urgent without naming a diagnosis', () => {
  const decision = evaluateTrainerSafetyText('vi', 'Đột nhiên tôi yếu một bên.');
  assert.equal(decision.level, 'URGENT');
  assert.equal(decision.observations[0].signal, 'SUDDEN_NEUROLOGIC_WARNING');
});

test('30 significant swelling or loss of function holds as suspected acute injury', () => {
  const decision = evaluateTrainerSafetyText('vi', 'Đầu gối sưng đáng kể và không chịu lực.');
  assert.equal(decision.level, 'PAIN');
  assert.equal(decision.authority_effect, 'STOP_RELEVANT_ACTION');
});

test('31 new breathlessness without established severity holds for reassessment', () => {
  const decision = evaluateTrainerSafetyText('vi', 'Tôi đang khó thở mới.');
  assert.equal(decision.level, 'SENSITIVE');
  assert.equal(decision.authority_effect, 'HOLD');
});

test('32 reported professional limit is retained as a HOLD boundary', () => {
  const decision = evaluateTrainerSafetyText('vi', 'Bác sĩ nói tôi không được squat.');
  assert.equal(decision.level, 'SENSITIVE');
  assert.equal(decision.observations[0].signal, 'PROFESSIONAL_LIMIT');
});
