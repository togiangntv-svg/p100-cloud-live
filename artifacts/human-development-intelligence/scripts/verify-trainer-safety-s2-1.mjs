import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { test } from 'node:test';

registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('.') && !extname(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls++;
  throw new Error('NETWORK_FORBIDDEN_IN_SAFETY_S2_1');
};

const { evaluateTrainerSafetyText, recognizeTrainerSafety } =
  await import('../../../lib/api-zod/src/trainer-safety-policy.ts');
const { validateMeaning } = await import('../../../lib/api-zod/src/m3-meaning.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));

const input = (locale, text) => ({
  locale, current_text: text, relevant_context: [], recent_relevant_turns: [],
  user_correction: null, safety_signal: 'CLEAR', asking_stopped: false,
});
const meaning = (changes = {}) => ({
  intent_type: 'CURRENT_TASK', interpreted_meaning: 'The current request is understood.',
  confidence: 0.9, uncertainty: null, missing_context: [], clarification_needed: false,
  clarification_question: null, safety_state: 'CLEAR', suggested_next_role: 'M4',
  task_kind: 'general_health', context_effect: 'NONE', used_context_ids: [],
  response: 'I understand the current request.', ...changes,
});

const semantics = Object.freeze([
  ['current-chest', 'URGENT', 'CHEST_PAIN_OR_PRESSURE'],
  ['historical-chest', 'CLEAR', 'CHEST_PAIN_OR_PRESSURE', 'HISTORICAL'],
  ['negated-chest', 'CLEAR', 'CHEST_PAIN_OR_PRESSURE', 'NEGATED'],
  ['other-person-chest', 'CLEAR', 'CHEST_PAIN_OR_PRESSURE', 'OTHER'],
  ['hypothetical-chest', 'CLEAR', 'CHEST_PAIN_OR_PRESSURE', 'HYPOTHETICAL'],
  ['mild-post-exercise-soreness', 'CLEAR', 'MILD_POST_EXERCISE_SORENESS'],
  ['sharp-action-pain', 'PAIN', 'ACTION_RELEVANT_PAIN'],
  ['ordinary-exertion', 'CLEAR', 'ORDINARY_EXERTION'],
  ['severe-breathlessness', 'URGENT', 'SEVERE_BREATHLESSNESS'],
  ['fainting', 'URGENT', 'FAINTING'],
  ['near-fainting', 'SENSITIVE', 'NEAR_FAINTING'],
  ['uncertain-current-signal', 'SENSITIVE', 'CHEST_PAIN_OR_PRESSURE', 'UNCERTAIN'],
  ['new-or-unusual-breathlessness', 'SENSITIVE', 'NEW_OR_UNUSUAL_BREATHLESSNESS'],
  ['suspected-acute-injury', 'PAIN', 'SUSPECTED_ACUTE_INJURY'],
  ['professional-limit', 'SENSITIVE', 'PROFESSIONAL_LIMIT'],
  ['revision-bound-correction', 'CORRECTION'],
  ['mixed-negation-and-fainting', 'URGENT', 'FAINTING'],
  ['mixed-history-and-current', 'URGENT', 'CHEST_PAIN_OR_PRESSURE'],
  ['mixed-other-and-user', 'URGENT', 'SEVERE_BREATHLESSNESS'],
  ['model-cannot-downgrade', 'NON_DOWNGRADE'],
]);

const corpus = Object.freeze({
  vi: [
    'Tôi đang tức ngực.', 'Năm ngoái tôi từng tức ngực.', 'Tôi không đau ngực.',
    'Bạn tôi bị đau ngực.', 'Nếu chạy mà đau ngực thì sao?',
    'Tôi hơi mỏi chân sau buổi hôm qua.', 'Tôi đau nhói khi squat.',
    'Tôi mệt vì chạy.', 'Tôi đang khó thở đến mức không nói hết câu.',
    'Tôi vừa ngất khi đang chạy.', 'Tôi thấy sắp ngất.', 'Có lẽ tôi đang đau ngực.',
    'Tôi đang khó thở mới.', 'Đầu gối tôi đang sưng đáng kể và không chịu lực.',
    'Bác sĩ nói tôi hiện không được squat.',
    ['Tôi đang đau ngực.', 'Đó là bạn tôi bị đau ngực.'],
    'Tôi không đau ngực, nhưng vừa ngất khi đi bộ.',
    'Năm ngoái từng khó chịu, nhưng bây giờ tôi đang tức ngực.',
    'Bạn tôi bị đau ngực, còn tôi đang khó thở đến mức không nói hết câu.',
    'Tôi đang tức ngực.',
  ],
  en: [
    'I currently have chest pressure.', 'Last year I had chest pressure.',
    'I do not have chest pain.', 'My friend has chest pain.',
    'If I had chest pain while running, what then?',
    'I am mildly sore after exercise yesterday.', 'I have sharp pain while walking.',
    'I am tired because of running.', 'I currently cannot speak a sentence because of breathlessness.',
    'I just fainted while running.', 'I may pass out now.', 'Maybe I currently have chest pain.',
    'I currently have new shortness of breath.',
    'My knee currently has significant swelling and I cannot bear weight.',
    'My doctor says I should avoid squats.',
    ['I currently have chest pressure.', 'My friend has chest pressure.'],
    'I do not have chest pain, but I just fainted while walking.',
    'Last year I felt unwell, but now I have chest pressure.',
    'My friend has chest pain, but I currently cannot speak a sentence because of breathlessness.',
    'I currently have chest pressure.',
  ],
  'zh-Hans': [
    '我现在胸口有压迫感。', '去年我胸痛。', '我没有胸痛。', '我的朋友胸痛。',
    '如果我跑步时胸痛会怎样？', '我昨天运动后有点酸痛。', '我运动时有刺痛。',
    '我跑步后有点累。', '我现在无法说完整句子。', '我刚刚晕倒。', '我现在快要晕倒。',
    '我可能现在胸痛。', '我现在有新的呼吸困难。', '我的膝盖现在明显肿胀，无法承重。',
    '医生说我现在应该避免深蹲。', ['我现在胸痛。', '我的朋友胸痛。'],
    '我没有胸痛，但我刚刚晕倒。', '去年有过不适，但我现在胸痛。',
    '我的朋友胸痛，但我现在无法说完整句子。', '我现在胸口有压迫感。',
  ],
  es: [
    'Ahora tengo presión en el pecho.', 'El año pasado tuve dolor de pecho.',
    'No tengo dolor de pecho.', 'Mi amigo tiene dolor de pecho.',
    'Si tuviera dolor de pecho al correr, ¿qué pasaría?',
    'Tengo dolor muscular leve después de entrenar ayer.', 'Tengo dolor punzante al caminar.',
    'Estoy cansado después de correr.', 'Ahora no puedo hablar una frase completa.',
    'Recién me desmayé.', 'Ahora casi me desmayo.', 'Quizás ahora tengo dolor de pecho.',
    'Ahora tengo una falta de aire nueva e inusual.',
    'Mi rodilla tiene hinchazón importante y no puedo apoyar peso.',
    'Mi médico dice que debo evitar sentadillas.',
    ['Ahora tengo dolor de pecho.', 'Mi amigo tiene dolor de pecho.'],
    'No tengo dolor de pecho, pero recién me desmayé.',
    'El año pasado tuve molestias, pero ahora tengo presión en el pecho.',
    'Mi amigo tiene dolor de pecho, pero ahora no puedo hablar una frase completa.',
    'Ahora tengo presión en el pecho.',
  ],
  hi: [
    'अभी मेरे सीने में दबाव है।', 'पिछले साल मेरे सीने में दर्द था।',
    'मेरे सीने में दर्द नहीं है।', 'मेरा दोस्त सीने में दर्द महसूस करता है।',
    'अगर दौड़ते समय सीने में दर्द हो तो क्या?',
    'कल व्यायाम के बाद हल्का मांसपेशियों का दर्द है।',
    'स्क्वाट करते समय मुझे तेज दर्द होता है।', 'दौड़ने के बाद मैं थोड़ा थका हूँ।',
    'अभी मैं पूरा वाक्य नहीं बोल पा रहा हूँ।', 'अभी-अभी मैं बेहोश हो गया।',
    'अभी मैं बेहोश होने वाला हूँ।', 'शायद अभी मेरे सीने में दर्द है।',
    'मुझे अभी नई या असामान्य सांस की तकलीफ है।',
    'मेरे घुटने में अभी काफी सूजन है और मैं वजन नहीं डाल सकता।',
    'डॉक्टर ने कहा कि मुझे स्क्वाट से बचना चाहिए।',
    ['अभी मेरे सीने में दर्द है।', 'मेरा दोस्त सीने में दर्द महसूस करता है।'],
    'मेरे सीने में दर्द नहीं है, लेकिन अभी-अभी मैं बेहोश हो गया।',
    'पिछले साल परेशानी थी, लेकिन अभी मेरे सीने में दबाव है।',
    'मेरा दोस्त सीने में दर्द महसूस करता है, लेकिन अभी मैं पूरा वाक्य नहीं बोल पा रहा हूँ।',
    'अभी मेरे सीने में दबाव है।',
  ],
  ja: [
    '今、私は胸の圧迫感があります。', '去年、私は胸の圧迫感がありました。',
    '私は胸の圧迫感はありません。', '友人は胸の圧迫感があります。',
    'もし胸の圧迫感があったらどうしますか。', '昨日の運動後に軽い筋肉痛があります。',
    '運動中に鋭い痛みがあります。', '走った後で少し疲れています。',
    '今、私は一文を話せないほど息苦しいです。', 'たった今、私は失神した。',
    '今、私は失神しそうです。', 'たぶん今、私は胸の圧迫感があります。',
    '今、新しい異常な息切れがあります。', '今、膝にかなりの腫れがあり、体重をかけられません。',
    '医師からスクワットを避けるよう言われています。',
    ['今、私は胸の圧迫感があります。', '友人は胸の圧迫感があります。'],
    '私は胸の圧迫感はありません。しかし、たった今失神した。',
    '去年は不調でした。しかし、今は胸の圧迫感があります。',
    '友人は胸の圧迫感があります。しかし、今、私は一文を話せないほど息苦しいです。',
    '今、私は胸の圧迫感があります。',
  ],
  ko: [
    '지금 저는 가슴 압박감이 있습니다.', '작년에 저는 가슴 통증이 있었습니다.',
    '저는 가슴 통증이 없습니다.', '제 친구는 가슴 통증이 있습니다.',
    '만약 달리다 가슴 통증이 생기면 어떻게 하나요?',
    '어제 운동 후 가벼운 근육통이 있습니다.', '운동 중 날카로운 통증이 있습니다.',
    '달리기 후 조금 피곤합니다.', '지금 저는 문장을 끝까지 말할 수 없습니다.',
    '방금 제가 기절했습니다.', '지금 저는 기절할 것 같습니다.',
    '아마 지금 저는 가슴 통증이 있습니다.', '지금 새롭고 평소와 다른 숨가쁨이 있습니다.',
    '지금 무릎이 심하게 붓고 체중을 실을 수 없습니다.', '의사가 스쿼트를 피하라고 했습니다.',
    ['지금 저는 가슴 통증이 있습니다.', '제 친구는 가슴 통증이 있습니다.'],
    '저는 가슴 통증이 없습니다. 하지만 방금 기절했습니다.',
    '작년에는 불편했습니다. 하지만 지금 저는 가슴 압박감이 있습니다.',
    '제 친구는 가슴 통증이 있습니다. 하지만 지금 저는 문장을 끝까지 말할 수 없습니다.',
    '지금 저는 가슴 압박감이 있습니다.',
  ],
  ru: [
    'Сейчас у меня давление в груди.', 'В прошлом году у меня была боль в груди.',
    'Я не чувствую давление в груди.', 'У моего друга боль в груди.',
    'Если при беге будет боль в груди, что тогда?',
    'После вчерашней тренировки у меня легкая мышечная боль.',
    'У меня резкая боль при ходьбе.', 'Я немного устал после бега.',
    'Сейчас я не могу закончить предложение из-за одышки.', 'Только что я упал в обморок.',
    'Сейчас я чуть не упал в обморок.', 'Возможно сейчас у меня давление в груди.',
    'Сейчас у меня новая необычная одышка.',
    'Сейчас колено значительно опухло, и я не могу наступать на ногу.',
    'Врач сказал мне избегать приседаний.',
    ['Сейчас у меня давление в груди.', 'У моего друга боль в груди.'],
    'Я не чувствую давление в груди, но только что упал в обморок.',
    'В прошлом году было недомогание, но сейчас у меня давление в груди.',
    'У моего друга боль в груди, но сейчас я не могу закончить предложение из-за одышки.',
    'Сейчас у меня давление в груди.',
  ],
});

for (const [locale, examples] of Object.entries(corpus)) {
  assert.equal(examples.length, semantics.length, `${locale} corpus size`);
  for (let index = 0; index < semantics.length; index++) {
    const [semantic, level, signal, detail] = semantics[index];
    const example = examples[index];
    test(`Release-8 corpus ${locale} ${String(index + 1).padStart(2, '0')} ${semantic}`, () => {
      if (level === 'CORRECTION') {
        const [before, after] = example;
        const oldObservation = recognizeTrainerSafety(locale, before, 7)[0];
        const correction = recognizeTrainerSafety(locale, after, 8)[0];
        assert.equal(evaluateTrainerSafetyText(locale, before, 7).level, 'URGENT');
        assert.equal(evaluateTrainerSafetyText(locale, after, 8).level, 'CLEAR');
        assert.equal(oldObservation.revision, 7);
        assert.equal(oldObservation.subject, 'USER');
        assert.equal(correction.revision, 8);
        assert.equal(correction.subject, 'OTHER');
        return;
      }
      if (level === 'NON_DOWNGRADE') {
        const result = validateMeaning(meaning(), input(locale, example));
        assert.equal(result.safety_state, 'URGENT');
        assert.equal(result.intent_type, 'SAFETY');
        assert.equal(result.suggested_next_role, 'STOP');
        return;
      }
      const decision = evaluateTrainerSafetyText(locale, example, 4);
      assert.equal(decision.level, level);
      const observation = decision.observations.find(item => item.signal === signal);
      assert.ok(observation, `${locale} missing ${signal}`);
      assert.equal(observation.revision, 4);
      if (semantic === 'historical-chest') assert.equal(observation.time, detail);
      if (semantic === 'negated-chest' || semantic === 'hypothetical-chest'
        || semantic === 'uncertain-current-signal') assert.equal(observation.assertion, detail);
      if (semantic === 'other-person-chest') assert.equal(observation.subject, detail);
    });
  }
}

test('ambiguous action-relevant signal holds and exposes one local clarification', () => {
  const decision = evaluateTrainerSafetyText('en', 'Chest pressure.');
  assert.equal(decision.level, 'SENSITIVE');
  assert.equal(decision.knowledge, 'UNKNOWN');
  assert.equal(decision.authority_effect, 'HOLD');
  assert.equal(decision.clarification?.kind, 'SUBJECT');
  assert.ok(decision.clarification?.question);
});

test('local clarification precedes provider and cannot restore action authority', async () => {
  let adapterCalls = 0;
  const adapter = Object.freeze({
    provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    async interpret() { adapterCalls++; throw new Error('PROVIDER_MUST_NOT_ASK_SAFETY_CLARIFICATION'); },
    async revoke() {},
  });
  const store = createSessionTaskStore({ adapter });
  store.start();
  const taskId = store.submit('Chest pressure.', { locale: 'en', permission_granted: true });
  await tick(); await tick();
  const task = store.getSnapshot().tasks.find(item => item.task_id === taskId);
  assert.equal(adapterCalls, 0);
  assert.equal(task.status, 'AWAITING_INPUT');
  assert.equal(task.interpretation.clarification_needed, true);
  assert.equal(task.interpretation.missing_context.length, 1);
  assert.ok(task.interpretation.clarification_question);
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
});

test('clarification cannot revive a superseded proposal or accepted receipt', async () => {
  let adapterCalls = 0;
  const adapter = Object.freeze({
    provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    async interpret() {
      adapterCalls++;
      return meaning({ intent_type: 'GOAL', interpreted_meaning: 'Improve general health.' });
    },
    async revoke() {},
  });
  const store = createSessionTaskStore({ adapter });
  store.start();
  const oldTaskId = store.submit('Improve my general health.', {
    locale: 'en', permission_granted: true,
  });
  await tick(); await tick();
  const oldRef = store.reference(oldTaskId);
  const proposal = store.assessM5Goal(oldRef, store.assessM4GoalReadiness(oldRef));
  const receipt = store.acceptM5Goal(oldRef, proposal);
  assert.ok(receipt);
  assert.equal(adapterCalls, 1);

  const heldTaskId = store.submit('Chest pressure.', { locale: 'en', permission_granted: true });
  await tick(); await tick();
  assert.equal(adapterCalls, 1);
  assert.equal(store.getSnapshot().tasks.find(item => item.task_id === heldTaskId).status, 'AWAITING_INPUT');
  assert.equal(store.getM5GoalChoiceReceipt(oldRef), undefined);
  assert.equal(store.resolveM6GoalAction(oldRef, receipt), undefined);
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
});

test('urgent and pain decisions never wait for clarification', () => {
  const urgent = evaluateTrainerSafetyText('en', 'I currently have chest pressure.');
  const pain = evaluateTrainerSafetyText('en', 'I have sharp pain while walking.');
  assert.equal(urgent.level, 'URGENT');
  assert.equal(urgent.clarification, null);
  assert.equal(pain.level, 'PAIN');
  assert.equal(pain.clarification, null);
});

test('urgent route pauses locally without invoking the M3 adapter', async () => {
  let adapterCalls = 0;
  const adapter = Object.freeze({
    provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    async interpret() { adapterCalls++; return meaning(); }, async revoke() {},
  });
  const store = createSessionTaskStore({ adapter });
  store.start();
  const taskId = store.submit('I currently have chest pressure.', {
    locale: 'en', permission_granted: true,
  });
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
  await tick();
  assert.equal(adapterCalls, 0);
  assert.equal(store.getSnapshot().tasks.find(item => item.task_id === taskId).status, 'PAUSED');
});

test('verifier performs zero live provider or network calls', () => {
  assert.equal(networkCalls, 0);
});
