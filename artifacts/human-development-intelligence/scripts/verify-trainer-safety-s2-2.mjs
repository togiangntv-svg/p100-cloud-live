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
  throw new Error('NETWORK_FORBIDDEN_IN_SAFETY_S2_2');
};

const { evaluateTrainerSafetyText } = await import('../../../lib/api-zod/src/trainer-safety-policy.ts');
const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { createLocalWalkResource } = await import('../domain/m6/walk-resource.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const { FakeClock, fakeAuthority, OWNER_A } = await import('./fixtures/local-owner.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

const release8 = [
  { locale: 'vi', unknown: 'Tức ngực.', uncertain: 'Có lẽ tôi bị tức ngực.', other: 'Đó là chuyện của bạn tôi.' },
  { locale: 'en', unknown: 'Chest pressure.', uncertain: 'Maybe I have chest pressure.', other: 'It is about my friend.' },
  { locale: 'zh-Hans', unknown: '胸口有压迫感。', uncertain: '我可能胸口有压迫感。', other: '这是我的朋友。' },
  { locale: 'es', unknown: 'Presión en el pecho.', uncertain: 'Quizás yo tengo presión en el pecho.', other: 'Es de mi amigo.' },
  { locale: 'hi', unknown: 'सीने में दबाव।', uncertain: 'शायद मुझे सीने में दबाव है।', other: 'यह मेरा दोस्त है।' },
  { locale: 'ja', unknown: '胸の圧迫感。', uncertain: 'たぶん私は胸の圧迫感があります。', other: '友人のことです。' },
  { locale: 'ko', unknown: '가슴 압박감.', uncertain: '아마 저는 가슴 압박감이 있습니다.', other: '제 친구의 일입니다.' },
  { locale: 'ru', unknown: 'Давление в груди.', uncertain: 'Возможно, у меня давление в груди.', other: 'Это мой друг.' },
];

const release8FreshUrgent = [
  { locale: 'vi', initial: 'Tức ngực.', answer: 'Đó là chuyện của bạn tôi, nhưng tôi vừa ngất khi đang chạy.' },
  { locale: 'en', initial: 'Chest pressure.', answer: 'It is about my friend, but I just fainted while running.' },
  { locale: 'zh-Hans', initial: '胸口有压迫感。', answer: '这是我的朋友。我刚刚跑步时晕倒了。' },
  { locale: 'es', initial: 'Presión en el pecho.', answer: 'Es de mi amigo, pero me desmayé mientras corría.' },
  { locale: 'hi', initial: 'सीने में दबाव।', answer: 'यह मेरा दोस्त है। मैं अभी-अभी दौड़ते समय बेहोश हो गया।' },
  { locale: 'ja', initial: '胸の圧迫感。', answer: '友人のことです。私はたった今失神した。' },
  { locale: 'ko', initial: '가슴 압박감.', answer: '제 친구의 일입니다. 저는 방금 달리는 중 기절했습니다.' },
  { locale: 'ru', initial: 'Давление в груди.', answer: 'Это мой друг. Я только что упал в обморок.' },
];

const meaning = (changes = {}) => ({
  intent_type: 'GOAL', interpreted_meaning: 'Improve general health.', confidence: 0.95,
  uncertainty: null, missing_context: [], clarification_needed: false,
  clarification_question: null, safety_state: 'CLEAR', suggested_next_role: 'M4',
  task_kind: 'general_health', context_effect: 'NONE', used_context_ids: [],
  response: 'Understood.', ...changes,
});

const adapter = (onCall = () => meaning()) => ({
  provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1', calls: 0,
  async interpret() { this.calls++; return onCall(); }, async revoke() {},
});

const held = async (text = 'Chest pressure.', locale = 'en', fixtureAdapter) => {
  const store = createSessionTaskStore(fixtureAdapter ? { adapter: fixtureAdapter } : {});
  store.start();
  const taskId = store.submit(text, { locale, permission_granted: Boolean(fixtureAdapter) });
  await tick(); await tick();
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
  return { store, taskId };
};

test('RED A unknown subject asks SUBJECT only', () => {
  const decision = evaluateTrainerSafetyText('en', 'Chest pressure.');
  assert.equal(decision.level, 'SENSITIVE');
  assert.equal(decision.clarification?.kind, 'SUBJECT');
  assert.match(decision.clarification.question, /you|someone else|other person/i);
  assert.doesNotMatch(decision.clarification.question, /now|past|before/i);
});

test('RED B known user with unknown currentness asks CURRENT_STATUS only', () => {
  const decision = evaluateTrainerSafetyText('en', 'Maybe I have chest pressure.');
  assert.equal(decision.observations[0].subject, 'USER');
  assert.equal(decision.level, 'SENSITIVE');
  assert.equal(decision.clarification?.kind, 'CURRENT_STATUS');
  assert.match(decision.clarification.question, /now|recent|past|before/i);
  assert.doesNotMatch(decision.clarification.question, /someone else|other person/i);
});

for (const fixture of release8) {
  test(`Release-8 ${fixture.locale} keeps SUBJECT and CURRENT_STATUS as separate axes`, () => {
    const subject = evaluateTrainerSafetyText(fixture.locale, fixture.unknown);
    const currentness = evaluateTrainerSafetyText(fixture.locale, fixture.uncertain);
    assert.equal(subject.clarification?.kind, 'SUBJECT');
    assert.equal(currentness.clarification?.kind, 'CURRENT_STATUS');
    assert.ok(subject.clarification.question.trim());
    assert.ok(currentness.clarification.question.trim());
    assert.notEqual(subject.clarification.question, currentness.clarification.question);
  });

  test(`Release-8 ${fixture.locale} other-person correction releases the exact hold`, async () => {
    const { store, taskId } = await held(fixture.unknown, fixture.locale);
    const oldRef = store.reference(taskId);
    const before = store.getTrainerSafetySnapshot();
    assert.equal(store.submit(fixture.other, { locale: fixture.locale }), taskId);
    await tick(); await tick();
    const next = store.getSnapshot().tasks.find(item => item.task_id === taskId);
    assert.equal(store.getTrainerSafetySnapshot().state, 'OPEN');
    assert.equal(store.getTrainerSafetySnapshot().revision, before.revision + 1);
    assert.equal(store.getTrainerActionAvailability(), 'AVAILABLE');
    assert.equal(next.permission_granted, false);
    assert.equal(next.revision, oldRef.revision + 1);
    assert.equal(store.assessM4GoalReadiness(oldRef).decision.reason, 'STALE_TASK');
  });
}

for (const fixture of release8FreshUrgent) {
  test(`Release-8 ${fixture.locale} correction plus fresh fainting stays atomically URGENT`, async () => {
    const { store, taskId } = await held(fixture.initial, fixture.locale);
    const oldRef = store.reference(taskId);
    const before = store.getTrainerSafetySnapshot();
    const observed = [];
    store.subscribe(() => observed.push({
      safety: store.getTrainerSafetySnapshot(),
      availability: store.getTrainerActionAvailability(),
      task: store.getSnapshot().tasks.find(item => item.task_id === taskId),
    }));
    assert.equal(store.submit(fixture.answer, { locale: fixture.locale }), taskId);
    const task = store.getSnapshot().tasks.find(item => item.task_id === taskId);
    assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
    assert.equal(store.getTrainerSafetySnapshot().revision, before.revision + 1);
    assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
    assert.equal(task.revision, oldRef.revision + 1);
    assert.equal(task.interpretation.safety_state, 'URGENT');
    assert.equal(task.m3_context.safety_signal, 'URGENT');
    assert.notEqual(task.m3_context.user_correction?.text, fixture.answer);
    assert.equal(task.permission_granted, false);
    assert.ok(observed.length);
    assert.ok(observed.every(item => item.safety.state === 'HOLD'
      && item.availability === 'SAFETY_HOLD'));
    assert.equal(store.assessM4GoalReadiness(oldRef).decision.reason, 'STALE_TASK');
    assert.equal(store.selfWalk.chooseAndStart(oldRef, {}, 'stale-safety-start').state, 'DENIED');
  });
}

test('historical correction plus current abnormal breathing keeps HOLD without inventing URGENT', async () => {
  const { store, taskId } = await held();
  const before = store.getTrainerSafetySnapshot();
  const observed = [];
  store.subscribe(() => observed.push(store.getTrainerSafetySnapshot().state));
  assert.equal(store.submit('It was last year, but right now I cannot breathe normally.',
    { locale: 'en' }), taskId);
  const task = store.getSnapshot().tasks.find(item => item.task_id === taskId);
  assert.equal(task.interpretation.safety_state, 'SENSITIVE');
  assert.equal(task.m3_context.safety_signal, 'SENSITIVE');
  assert.equal(store.getTrainerSafetySnapshot().revision, before.revision + 1);
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
  assert.deepEqual(observed, ['HOLD']);
});

test('me plus now confirms the prior chest observation without repeating the symptom', async () => {
  const { store, taskId } = await held();
  const before = store.getTrainerSafetySnapshot();
  assert.equal(store.submit('It is me, and it is happening now.', { locale: 'en' }), taskId);
  const task = store.getSnapshot().tasks.find(item => item.task_id === taskId);
  assert.equal(task.interpretation.safety_state, 'URGENT');
  assert.equal(store.getTrainerSafetySnapshot().revision, before.revision + 1);
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
});

test('friend plus action-relevant sharp pain keeps PAIN and no OPEN publication', async () => {
  const { store, taskId } = await held();
  const observed = [];
  store.subscribe(() => observed.push(store.getTrainerSafetySnapshot().state));
  assert.equal(store.submit('It is my friend, but my knee hurts sharply when I squat.',
    { locale: 'en' }), taskId);
  assert.equal(store.getSnapshot().tasks.find(item => item.task_id === taskId).interpretation.safety_state, 'PAIN');
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
  assert.deepEqual(observed, ['HOLD']);
});

for (const answer of ['It is my friend. I do not have chest pain.',
  'It is my friend. What if I faint while running?',
  'It is my friend, and I am tired after exercise.']) {
  test(`non-blocking fresh answer preserves legitimate R3 correction: ${answer}`, async () => {
    const { store, taskId } = await held();
    assert.equal(store.submit(answer, { locale: 'en' }), taskId);
    assert.equal(store.getTrainerSafetySnapshot().state, 'OPEN');
    assert.equal(store.getTrainerActionAvailability(), 'AVAILABLE');
  });
}

test('fresh urgent is protected even when answer does not resolve the old SUBJECT question', async () => {
  const { store, taskId } = await held();
  const before = store.getTrainerSafetySnapshot();
  assert.equal(store.submit("I don't know, but I just fainted while running.", { locale: 'en' }), taskId);
  const task = store.getSnapshot().tasks.find(item => item.task_id === taskId);
  assert.equal(task.interpretation.safety_state, 'URGENT');
  assert.equal(task.m3_context.user_correction, null);
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(store.getTrainerSafetySnapshot().revision, before.revision + 1);
});

test('structured URGENT cannot be cleared by an otherwise valid R3 correction', async () => {
  const { store, taskId } = await held();
  assert.equal(store.submit('It is about my friend.',
    { locale: 'en', safety_signal: 'URGENT' }), taskId);
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(store.getSnapshot().tasks.find(item => item.task_id === taskId).interpretation.safety_state, 'URGENT');
});

test('contradictory subject evidence cannot release the old concern', async () => {
  const { store } = await held();
  store.submit('It is my friend and me.', { locale: 'en' });
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
});

test('contradictory current and historical evidence cannot release the old concern', async () => {
  const { store } = await held('Maybe I have chest pressure.');
  store.submit('It was last year, and it is happening now.', { locale: 'en' });
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
});

test('mixed-language correction plus current critical signal keeps HOLD', async () => {
  const { store, taskId } = await held();
  assert.equal(store.submit('It is about my friend, nhưng tôi vừa ngất khi đang chạy.',
    { locale: 'en' }), taskId);
  assert.equal(store.getSnapshot().tasks.find(item => item.task_id === taskId).interpretation.safety_state, 'URGENT');
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
});

test('clause order does not let OTHER erase a preceding current-user fainting signal', async () => {
  const { store, taskId } = await held();
  assert.equal(store.submit('I just fainted while running, but it is about my friend.',
    { locale: 'en' }), taskId);
  assert.equal(store.getSnapshot().tasks.find(item => item.task_id === taskId).interpretation.safety_state, 'URGENT');
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
});

test('new R2 basis remains non-releasable by a later historical-looking answer', async () => {
  const { store, taskId } = await held();
  store.submit('It is about my friend, but I just fainted while running.', { locale: 'en' });
  const afterUrgent = store.getTrainerSafetySnapshot();
  assert.equal(store.submit('That happened last year, not now.', { locale: 'en' }) === taskId, false);
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(store.getTrainerSafetySnapshot().revision, afterUrgent.revision);
});

test('independent hard Safety source is not released by a valid text correction', async () => {
  const clock = new FakeClock();
  const authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner: OWNER_A, validUntil: 100_000 });
  const lease = await boundary.control.verifySession();
  boundary.control.finishHydration(lease);
  const store = createSessionTaskStore({ ownerSession: Object.freeze({ access: boundary.access, lease }) });
  store.start();
  const taskId = store.submit('Chest pressure.', { locale: 'en' });
  const ref = store.reference(taskId);
  assert.equal(store.signalTrainerSafety(ref, 'PROBLEM'), true);
  store.submit('It is about my friend.', { locale: 'en' });
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
});

test('observer reentry sees committed HOLD and cannot open action with a new goal', async () => {
  const { store, taskId } = await held();
  const oldRef = store.reference(taskId);
  let reentered = false;
  const observed = [];
  store.subscribe(() => {
    if (reentered) return;
    const task = store.getSnapshot().tasks.find(item => item.task_id === taskId);
    if (!task?.source_input.includes('fainted')) return;
    reentered = true;
    observed.push({ safety: store.getTrainerSafetySnapshot(),
      availability: store.getTrainerActionAvailability(), revision: task.revision });
    store.submit('Improve my general health.', { locale: 'en' });
    observed.push({ safety: store.getTrainerSafetySnapshot(),
      availability: store.getTrainerActionAvailability(), revision: task.revision });
  });
  store.submit('It is about my friend, but I just fainted while running.', { locale: 'en' });
  assert.equal(reentered, true);
  assert.ok(observed.every(item => item.safety.state === 'HOLD'
    && item.availability === 'SAFETY_HOLD'));
  assert.equal(store.assessM4GoalReadiness(oldRef).decision.reason, 'STALE_TASK');
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
});

test('fresh Safety after a real Start interrupts future guidance but retains Start facts', async () => {
  const clock = new FakeClock();
  const authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner: OWNER_A, validUntil: 100_000 });
  const lease = await boundary.control.verifySession();
  boundary.control.finishHydration(lease);
  const store = createSessionTaskStore({
    ownerSession: Object.freeze({ access: boundary.access, lease }),
    walkResource: createLocalWalkResource().access,
    adapter: adapter(), now: () => clock.now(),
  });
  store.start();
  const taskId = store.submit('Improve my general health.', { locale: 'en', permission_granted: true });
  await tick(); await tick();
  let ref = store.reference(taskId);
  const choice = store.acceptM5Goal(ref, store.assessM5Goal(ref, store.assessM4GoalReadiness(ref)));
  assert.ok(choice);
  ref = store.reference(taskId);
  assert.equal(store.selfWalk.reportContext(ref, {
    source_ref: 's2-fresh-after-start', intent: 'SHORT_LIGHT_MOVEMENT', walking_choice: 'WANTS_WALK',
    adult: 'REPORTED_ADULT', mobility: 'INDEPENDENT_COMFORTABLE_WALKING',
    concerns: 'NONE_REPORTED', professional_limits: 'NONE_REPORTED',
    setting: 'INDOOR_FLAT_CLEAR_LIT_DRY_STOPPABLE', competing_activity: 'NONE',
    footwear: 'FAMILIAR_SECURE', available_minutes: 20, requested_minutes: 5,
    currency: 'CURRENT',
  }), true);
  const proposal = store.selfWalk.propose(ref, 's2-fresh-propose');
  assert.equal(proposal.state, 'PROPOSED');
  assert.equal(store.selfWalk.chooseAndStart(ref, proposal, 's2-fresh-start').state, 'STARTED');
  store.submit('I just fainted while running.', { locale: 'en' });
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(store.selfWalk.getSnapshot().state, 'INVALIDATED');
  assert.equal(store.selfWalk.getSnapshot().start.request_id, 's2-fresh-start');
  assert.equal(store.selfWalk.start(ref, proposal, 's2-old-start-again').state, 'DENIED');
});

test('RED C other-person correction releases only the reassessment hold', async () => {
  const { store, taskId } = await held();
  const before = store.getTrainerSafetySnapshot();
  const resolvedTaskId = store.submit('It is about my friend.', { locale: 'en' });
  await tick(); await tick();
  assert.equal(resolvedTaskId, taskId);
  assert.equal(store.getTrainerActionAvailability(), 'AVAILABLE');
  assert.equal(store.getTrainerSafetySnapshot().state, 'OPEN');
  assert.equal(store.getTrainerSafetySnapshot().revision, before.revision + 1);
});

test('RED D historical correction releases only the reassessment hold', async () => {
  const { store, taskId } = await held();
  const before = store.getTrainerSafetySnapshot();
  const resolvedTaskId = store.submit('That happened last year, not now.', { locale: 'en' });
  await tick(); await tick();
  assert.equal(resolvedTaskId, taskId);
  assert.equal(store.getTrainerActionAvailability(), 'AVAILABLE');
  assert.equal(store.getTrainerSafetySnapshot().state, 'OPEN');
  assert.equal(store.getTrainerSafetySnapshot().revision, before.revision + 1);
});

test('subject then currentness uses two revisions and releases only after both axes resolve safely', async () => {
  const { store, taskId } = await held();
  const first = store.getSnapshot().tasks.find(item => item.task_id === taskId);
  assert.equal(store.submit('It is happening to me.', { locale: 'en' }), taskId);
  const second = store.getSnapshot().tasks.find(item => item.task_id === taskId);
  assert.equal(second.revision, first.revision + 1);
  assert.equal(second.interpretation.clarification_needed, true);
  assert.deepEqual(second.interpretation.missing_context, ['CURRENT_STATUS']);
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(store.submit('That happened last year, not now.', { locale: 'en' }), taskId);
  assert.equal(store.getSnapshot().tasks.find(item => item.task_id === taskId).revision, second.revision + 1);
  assert.equal(store.getTrainerSafetySnapshot().state, 'OPEN');
});

test('a clarification that confirms a current user R2 event makes the hold non-releasable', async () => {
  const { store, taskId } = await held();
  assert.equal(store.submit('It is happening to me.', { locale: 'en' }), taskId);
  assert.equal(store.submit('It is happening now.', { locale: 'en' }), taskId);
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(store.submit('That happened last year, not now.', { locale: 'en' }) === taskId, false);
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
});

test('other-person resolution never revives old proposal, receipt, or Start authority', async () => {
  const fixtureAdapter = adapter();
  const store = createSessionTaskStore({ adapter: fixtureAdapter });
  store.start();
  const oldTaskId = store.submit('Improve my general health.', { locale: 'en', permission_granted: true });
  await tick(); await tick();
  const oldRef = store.reference(oldTaskId);
  const oldProposal = store.assessM5Goal(oldRef, store.assessM4GoalReadiness(oldRef));
  const oldReceipt = store.acceptM5Goal(oldRef, oldProposal);
  assert.ok(oldReceipt);

  store.submit('Chest pressure.', { locale: 'en', permission_granted: true });
  await tick(); await tick();
  store.submit('It is about my friend.', { locale: 'en', permission_granted: true });
  await tick(); await tick();
  assert.equal(store.getTrainerActionAvailability(), 'AVAILABLE');
  assert.equal(store.getM5GoalChoiceReceipt(oldRef), undefined);
  assert.equal(store.acceptM5Goal(oldRef, oldProposal), undefined);
  assert.equal(store.resolveM6GoalAction(oldRef, oldReceipt), undefined);
});

test('current urgent event cannot release from a later plain CLEAR sentence', async () => {
  const { store } = await held('I currently have chest pressure.');
  store.submit('I feel fine now.', { locale: 'en' });
  await tick(); await tick();
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
});

test('current exertional fainting cannot release from an ordinary new goal', async () => {
  const { store } = await held('I just fainted while running.');
  store.submit('Improve my general health.', { locale: 'en' });
  await tick(); await tick();
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
});

test('all bounded current/recent R2 classes remain held after later historical-looking text', async () => {
  for (const text of [
    'I currently have chest pressure.',
    'I just fainted while running.',
    'I currently have severe trouble breathing.',
    'I suddenly have trouble speaking now.',
    'I cannot bear weight now.',
  ]) {
    const { store } = await held(text);
    store.submit('That happened last year, not now.', { locale: 'en' });
    await tick(); await tick();
    assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD', text);
    assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD', text);
  }
});

test('model CLEAR, locale change, and unrelated task cannot release HOLD', async () => {
  const fixtureAdapter = adapter();
  const { store } = await held('I currently have chest pressure.', 'en', fixtureAdapter);
  store.submit('Quiero mejorar mi salud.', { locale: 'es', permission_granted: true });
  await tick(); await tick();
  assert.equal(fixtureAdapter.calls, 1);
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
});

test('feel-better, pain-stopped, elapsed-time, wearable-normal, and continue text never release', async () => {
  for (const text of ['I feel better.', 'The pain stopped.', 'Two hours passed.',
    'My wearable says normal.', 'Let me continue.']) {
    const { store } = await held('I currently have chest pressure.');
    store.submit(text, { locale: 'en' });
    await tick(); await tick();
    assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD', text);
    assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD', text);
  }
});

test('provider failure cannot release a hard local Safety hold', async () => {
  const unavailable = {
    provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1', calls: 0,
    async interpret() { this.calls++; throw new Error('PROVIDER_UNAVAILABLE'); }, async revoke() {},
  };
  const { store } = await held('I currently have chest pressure.', 'en', unavailable);
  store.submit('Improve my general health.', { locale: 'en', permission_granted: true });
  await tick(); await tick();
  assert.equal(unavailable.calls, 1);
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
});

test('task switch makes the old reassessment revision unable to release', async () => {
  const { store, taskId } = await held();
  const unrelatedId = store.submit('Improve my general health.', { locale: 'en' });
  assert.notEqual(unrelatedId, taskId);
  const answerId = store.submit('It is about my friend.', { locale: 'en' });
  await tick(); await tick();
  assert.notEqual(answerId, taskId);
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
});

test('owner loss retires the session instead of permitting a reassessment release', async () => {
  const clock = new FakeClock();
  const authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner: OWNER_A, validUntil: 100_000 });
  const lease = await boundary.control.verifySession();
  boundary.control.finishHydration(lease);
  const store = createSessionTaskStore({ ownerSession: Object.freeze({ access: boundary.access, lease }) });
  store.start();
  store.submit('Chest pressure.', { locale: 'en' });
  await tick(); await tick();
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  boundary.control.invalidateCurrentSession();
  assert.equal(store.submit('It is about my friend.', { locale: 'en' }), undefined);
  assert.equal(store.getTrainerSafetySnapshot().state, 'UNAVAILABLE');
  assert.equal(store.getSnapshot().session_id, null);
});

test('manual Stop remains local and functional while safety is held', async () => {
  const { store, taskId } = await held();
  const stoppedTaskId = store.submit('Stop', { locale: 'en' });
  await tick(); await tick();
  assert.equal(stoppedTaskId, taskId);
  assert.equal(store.getSnapshot().tasks.find(item => item.task_id === taskId).status, 'PAUSED');
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
});

test('S2.2 verifier performs zero live provider or network calls', () => {
  assert.equal(networkCalls, 0);
});
