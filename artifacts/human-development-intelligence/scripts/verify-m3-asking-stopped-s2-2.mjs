import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { test } from 'node:test';

registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('.') && !extname(specifier)
    ? specifier + '.ts' : specifier, context);
} });

globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN_IN_S2_2'); };
const { validateMeaning } = await import('../../../lib/api-zod/src/m3-meaning.ts');
const { M3_LOCALE_CONFIG } = await import('../../../lib/api-zod/src/m3-locales.ts');
const { resolveM4Context } = await import('../domain/m4/resolver.ts');

const languageInput = (overrides = {}) => ({
  locale: 'vi', current_text: 'Đánh giá ảnh bữa ăn này', relevant_context: [],
  recent_relevant_turns: [], user_correction: null, safety_signal: 'CLEAR',
  asking_stopped: true, ...overrides,
});
const meaning = (overrides = {}) => ({
  intent_type: 'CURRENT_TASK', interpreted_meaning: 'Người dùng muốn đánh giá ảnh bữa ăn.',
  confidence: 0.9, uncertainty: null, missing_context: [],
  clarification_needed: false, clarification_question: null, safety_state: 'CLEAR',
  suggested_next_role: 'M4', task_kind: 'meal_image_assessment',
  context_effect: 'NONE', used_context_ids: [], response: 'Mình hiểu việc bạn muốn làm.',
  ...overrides,
});
const task = (interpretation, input) => ({
  session_id: 'fixture-session', task_id: 'fixture-task', revision: 1,
  source_input: input.current_text, status: 'READY', permission_revision: 1,
  permission_granted: true, m3_context: input, interpretation,
});
const available = () => ({
  scope: { session_id: 'fixture-session', task_id: 'fixture-task', revision: 1 },
  image: { state: 'present', id: 'already-permitted-image', usable: true, permission_revision: 1 },
  permission: { purpose: 'meal_image_assessment', status: 'allowed', revision: 1 },
  boundary: 'within_slice',
});
const m4 = (interpretation, input, context) =>
  resolveM4Context(task(interpretation, input), context).decision;

test('CLEAR CURRENT_TASK + asking_stopped suppresses questions but preserves M4 meaning', () => {
  const input = languageInput();
  const result = validateMeaning(meaning(), input);
  assert.equal(result.intent_type, 'CURRENT_TASK');
  assert.equal(result.safety_state, 'CLEAR');
  assert.equal(result.suggested_next_role, 'M4');
  assert.equal(result.task_kind, 'meal_image_assessment');
  assert.equal(result.context_effect, 'NONE');
  assert.deepEqual(result.used_context_ids, []);
  assert.equal(result.clarification_needed, false);
  assert.equal(result.clarification_question, null);
  assert.deepEqual(result.missing_context, []);
  assert.equal(result.response, 'Mình hiểu việc bạn muốn làm.');
});

test('already-permitted image remains sufficient after M3 asking_stopped normalization', () => {
  const input = languageInput();
  const result = validateMeaning(meaning(), input);
  assert.equal(m4(result, input, available()).state, 'CONTEXT_SUFFICIENT');
});

test('absent context does not reopen questions after asking_stopped', () => {
  const input = languageInput();
  const result = validateMeaning(meaning(), input);
  const absent = { ...available(), image: { state: 'absent' },
    permission: { purpose: 'meal_image_assessment', status: 'unknown', revision: 1 } };
  assert.deepEqual(m4(result, input, absent), { state: 'DEFERRED', reason: 'M3_BOUNDARY' });
});

test('AMBIGUOUS asking_stopped keeps ambiguity and M4 fail-closed', () => {
  const input = languageInput({ current_text: 'Cái đó ấy' });
  const result = validateMeaning(meaning({
    intent_type: 'AMBIGUOUS', task_kind: null, clarification_needed: true,
    clarification_question: 'Bạn muốn làm việc nào?', missing_context: ['việc cần làm'],
  }), input);
  assert.equal(result.intent_type, 'AMBIGUOUS');
  assert.equal(result.clarification_needed, false);
  assert.equal(result.clarification_question, null);
  assert.deepEqual(result.missing_context, []);
  assert.deepEqual(m4(result, input, available()), { state: 'DEFERRED', reason: 'M3_BOUNDARY' });
});

test('explicit STOP_PAUSE and REFUSAL remain STOP', () => {
  for (const intent_type of ['STOP_PAUSE', 'REFUSAL']) {
    const input = languageInput();
    // The intent itself, not a provider-supplied next role, carries this boundary.
    const result = validateMeaning(meaning({ intent_type, suggested_next_role: 'M4', task_kind: null }), input);
    assert.equal(result.intent_type, intent_type);
    assert.equal(result.suggested_next_role, 'STOP');
    assert.equal(result.clarification_needed, false);
    assert.equal(result.response, M3_LOCALE_CONFIG.vi.stop);
    assert.deepEqual(m4(result, input, available()), { state: 'DEFERRED', reason: 'M3_BOUNDARY' });
  }
});

test('host PAIN, deterministic URGENT text, and provider URGENT still force SAFETY STOP', () => {
  const cases = [
    [languageInput({ safety_signal: 'PAIN' }), meaning(), 'PAIN'],
    [languageInput({ current_text: 'Tôi đang đau ngực' }), meaning(), 'URGENT'],
    [languageInput(), meaning({ safety_state: 'URGENT' }), 'URGENT'],
  ];
  for (const [input, raw, expected] of cases) {
    const result = validateMeaning(raw, input);
    assert.equal(result.safety_state, expected);
    assert.equal(result.intent_type, 'SAFETY');
    assert.equal(result.suggested_next_role, 'STOP');
    assert.equal(result.clarification_needed, false);
    assert.equal(result.response, M3_LOCALE_CONFIG.vi[expected === 'URGENT' ? 'urgentSafety' : 'safety']);
  }
});

test('locale changes presentation only, not clear-task semantics', () => {
  const vi = validateMeaning(meaning(), languageInput());
  const en = validateMeaning(meaning(), languageInput({ locale: 'en',
    current_text: 'Assess this meal photo' }));
  for (const key of ['intent_type', 'safety_state', 'suggested_next_role', 'task_kind',
    'context_effect', 'clarification_needed', 'clarification_question']) {
    assert.deepEqual(en[key], vi[key], key);
  }
});
