import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extname, resolve } from 'node:path';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const product = resolve(fileURLToPath(new URL('..', import.meta.url)));
registerHooks({ resolve(specifier, context, next) {
  const path = specifier.startsWith('@/') ? pathToFileURL(resolve(product,
    `${specifier.slice(2)}${extname(specifier) ? '' : '.ts'}`)).href
    : specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier;
  return next(path, context);
} });
let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw Error('NETWORK_FORBIDDEN'); };

const { FakeClock, fakeAuthority, OWNER_A, OWNER_B } = await import('./fixtures/local-owner.mjs');
const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { createM3HostLifetime } = await import('../components/m3-host-lifetime.ts');
const { createM7RecordActivation } = await import('../components/m7-record-activation.ts');
const { createW01ProductionBinding, createW01ProductController } =
  await import('../components/w01-product-controller.ts');
const { M7_RECORD_COPY } = await import('../i18n-m7-record.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const adapter = Object.freeze({
  provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
  async interpret() {
    return Object.freeze({ intent_type: 'GOAL', interpreted_meaning: 'Khỏe hơn', confidence: 0.95,
      uncertainty: null, missing_context: [], clarification_needed: false, clarification_question: null,
      safety_state: 'CLEAR', suggested_next_role: 'M4', task_kind: 'general_health',
      context_effect: 'NONE', used_context_ids: [], response: 'Đã ghi nhận.' });
  }, async revoke() {},
});
async function fixture(activationKind = 'VALID') {
  const clock = new FakeClock(), authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner: OWNER_A, validUntil: 100_000 });
  const lease = await boundary.control.verifySession();
  boundary.control.finishHydration(lease);
  const binding = { access: boundary.access, lease };
  const activation = typeof activationKind === 'function' ? await activationKind(binding, clock) : activationKind === 'VALID'
    ? createM7RecordActivation(binding, 80_000, clock.now)
    : activationKind === 'EXPIRED'
      ? createM7RecordActivation(binding, 900, clock.now)
      : activationKind === 'FORGED' ? Object.freeze({}) : undefined;
  const host = createM3HostLifetime(() => {});
  host.activate('OWNED', binding, 'fixture', () => adapter, activation);
  const slot = host.currentSlot();
  assert.ok(slot);
  return { host, slot, clock, authority, boundary, binding, activation };
}
async function goal(f) {
  const { store } = f.slot;
  const task = store.submit('Khỏe hơn', { permission_granted: true });
  await tick();
  let ref = store.reference(task);
  assert.ok(store.acceptM5Goal(ref, store.assessM5Goal(ref, store.assessM4GoalReadiness(ref))));
  ref = store.reference(task);
  const w01 = createW01ProductController({ onChange() {} });
  w01.bind(createW01ProductionBinding({
    identity: { ownerAccess: f.binding.access, ownerLease: f.binding.lease, store, ref },
    current: () => f.host.currentSlot() === f.slot
      && store.reference(task)?.revision === ref.revision,
    selfWalk: store.selfWalk,
  }));
  return w01;
}
const favorable = ['yes', 'none', 'none', 'adult', 'independent', 'supported',
  'none_competing', 'suitable', '5', '3'];
function proposed(w01) {
  let view;
  for (const answer of favorable) {
    view = w01.presentation();
    assert.ok(view.question);
    assert.equal(view.answer(answer), true);
  }
  assert.equal(w01.presentation().state, 'PROPOSED');
  return w01.presentation();
}
function started(w01) {
  proposed(w01).act('accept');
  assert.equal(w01.presentation().state, 'ACCEPTED');
  w01.presentation().act('start');
  assert.equal(w01.presentation().state, 'STARTED');
}
function draft(record, extent = 'DID', problem = 'NONE') {
  for (const [field, value] of [
    ['execution_extent', extent], ['action_change', 'UNCHANGED'],
    ['user_stopped', false], ['problem_report', problem], ['constraint', 'NONE_REPORTED'],
  ]) assert.equal(record.presentation().choose(field, value), true);
  return record.presentation();
}

test('real owned host and W01 route keep M7 ungranted until explicit submit', async () => {
  const f = await fixture(), w01 = await goal(f);
  const record = f.slot.record;
  assert.ok(record);
  assert.equal(record.presentation().state, 'UNAVAILABLE');
  assert.equal(f.slot.store.m7Outcome.getSnapshot(undefined).state, 'DENIED');
  assert.equal(f.slot.store.m7Outcome.readNextCycle(undefined), undefined);
  proposed(w01);
  assert.equal(record.presentation().state, 'UNAVAILABLE');
  w01.presentation().act('accept');
  assert.equal(record.presentation().state, 'UNAVAILABLE');
  w01.presentation().act('start');
  assert.equal(record.presentation().state, 'READY');
  assert.equal(f.slot.store.m7Outcome.getSnapshot(undefined).state, 'DENIED');
  assert.equal(draft(record).submit(), true);
  const view = record.presentation();
  assert.equal(view.state, 'ACTIVE');
  assert.equal(view.outcome.evidence.source, 'USER_REPORT');
  assert.equal(view.outcome.outcome.execution_extent, 'DID');
  assert.equal(view.outcome.outcome.performed_minutes, undefined);
  assert.equal(f.slot.store.m7Outcome.readNextCycle(undefined), undefined);
  assert.equal(networkCalls, 0);
});

test('decline, cancel before start, and safety hold never issue a reportable episode', async () => {
  const declined = await fixture(), declineWalk = await goal(declined);
  assert.equal(declineWalk.presentation().answer('decline'), true);
  assert.equal(declined.slot.record.presentation().state, 'UNAVAILABLE');
  const cancelled = await fixture(), cancelWalk = await goal(cancelled);
  proposed(cancelWalk).act('cancel');
  assert.equal(cancelled.slot.record.presentation().state, 'UNAVAILABLE');
  const hold = await fixture(), holdWalk = await goal(hold);
  holdWalk.presentation().answer('yes');
  holdWalk.presentation().answer('pain');
  assert.equal(hold.slot.record.presentation().state, 'UNAVAILABLE');
});

test('all extent choices remain distinct; problem is separate and no favorable default is filled', async () => {
  for (const extent of ['DID', 'PARTIAL', 'SKIPPED', 'UNKNOWN']) {
    const f = await fixture(), w01 = await goal(f); started(w01);
    assert.equal(f.slot.record.presentation().canSubmit, false);
    const view = draft(f.slot.record, extent, extent === 'PARTIAL' ? 'PROBLEM' : 'UNKNOWN');
    assert.equal(view.submit(), true);
    const outcome = f.slot.record.presentation().outcome;
    assert.equal(outcome.outcome.execution_extent, extent);
    assert.equal(outcome.outcome.problem_state, extent === 'PARTIAL' ? 'PROBLEM' : 'UNKNOWN');
    assert.equal(outcome.outcome.performed_minutes, undefined);
    assert.equal(outcome.evidence.source, 'USER_REPORT');
  }
});

test('correction, retraction and delete use current revision and do not replay removed payload', async () => {
  const f = await fixture(), w01 = await goal(f); started(w01);
  const record = f.slot.record, old = record.presentation();
  assert.equal(draft(record).submit(), true);
  assert.equal(old.submit(), false);
  const first = record.presentation().outcome;
  assert.equal(record.presentation().beginCorrection(), true);
  assert.equal(record.presentation().choose('execution_extent', 'PARTIAL'), true);
  assert.equal(record.presentation().submit(), true);
  assert.equal(record.presentation().outcome.revision, first.revision + 1);
  assert.equal(record.presentation().outcome.outcome.execution_extent, 'PARTIAL');
  assert.equal(record.presentation().requestRetraction(), true);
  assert.equal(record.presentation().confirmRetraction(), true);
  assert.equal(record.presentation().state, 'RETRACTED');
  assert.equal(record.presentation().requestDelete(), true);
  assert.equal(record.presentation().confirmDelete(), true);
  assert.equal(record.presentation().state, 'DELETED');
  assert.equal(record.presentation().outcome, undefined);
  assert.equal(old.submit(), false);
  f.host.deactivate();
  assert.equal(f.host.currentSlot(), undefined);
});

test('activation defaults OFF; forged, expired, stale owner and host replacement deny', async () => {
  for (const kind of ['ABSENT', 'FORGED', 'EXPIRED']) {
    const f = await fixture(kind);
    assert.equal(f.slot.record, undefined);
  }
  const f = await fixture(), w01 = await goal(f); started(w01);
  const old = f.slot.record.presentation();
  f.authority.results.push({ status: 'verified', owner: OWNER_B, validUntil: 100_000 });
  const lease = await f.boundary.control.verifySession();
  f.boundary.control.finishHydration(lease);
  assert.equal(old.choose('execution_extent', 'DID'), false);
  assert.equal(f.host.currentSlot(), undefined);
});

test('eight locale copy and production composition chain stay reachable without future-use route', () => {
  for (const locale of ['vi', 'en', 'zh-Hans', 'es', 'hi', 'ja', 'ko', 'ru']) {
    const copy = M7_RECORD_COPY[locale];
    for (const key of ['available', 'unavailable', 'did', 'partial', 'skipped', 'unknown',
      'submit', 'correct', 'retract', 'confirmRetract', 'delete', 'confirmDelete',
      'localOnly', 'stale']) assert.ok(copy[key]);
  }
  const source = name => readFileSync(resolve(product, 'components', name), 'utf8');
  assert.match(source('OpeningGoalFlow.tsx'), /useM2Gateway\([\s\S]*m7RecordActivation\)/u);
  assert.match(source('OpeningGoalFlow.tsx'), /<M7RecordCard presentation=\{m2\.m7Record\.presentation\}/u);
  assert.match(source('useM2Gateway.ts'), /m3Lifetime\.activate\([\s\S]*m7RecordActivation\)/u);
  assert.match(source('m3-host-lifetime.ts'), /createSessionTaskStore\(/u);
  assert.match(source('m3-host-lifetime.ts'), /m7Purpose: cycle\.access/u);
  assert.doesNotMatch(source('m7-record-controller.ts'), /allowNextCycle|readNextCycle|fetch\(/u);
  assert.equal(networkCalls, 0);
});

test('R8-T09..T14 causal truth, unavailable neutrality and authority stay distinct', () => {
  for (const locale of ['vi', 'en', 'zh-Hans', 'es', 'hi', 'ja', 'ko', 'ru']) {
    const copy = M7_RECORD_COPY[locale];
    assert.equal(new Set([copy.unavailable, copy.stale, copy.unknown, copy.none]).size, 4,
      `R8-T09 distinct missing/stale/unknown/no-problem ${locale}`);
  }
  const card = readFileSync(resolve(product, 'components', 'M7RecordCard.tsx'), 'utf8');
  const unavailable = card.match(/if \(view\.state === 'UNAVAILABLE'\)([\s\S]*?)if \(view\.state === 'DELETED'\)/u)?.[1];
  assert.ok(unavailable, 'R8-T10 actual M7 UNAVAILABLE render branch');
  assert.match(unavailable, /copy\.unavailable/u);
  assert.doesNotMatch(unavailable, /copy\.stale|button\(|view\.submit|view\.choose/u,
    'R8-T10/T12 unknown unavailable is neutral and creates no action');

  const controller = readFileSync(resolve(product, 'components', 'm7-record-controller.ts'), 'utf8');
  assert.match(controller, /execution_extent/u);
  assert.match(controller, /problem_report/u);
  assert.match(controller, /requestRetraction/u);
  assert.match(controller, /requestDelete/u);
  assert.doesNotMatch(controller, /allowNextCycle|readNextCycle|fetch\(/u);
  assert.equal(networkCalls, 0);
});

test('R8-T20 presentation adds no HealthKit, Camera or live-M3 capability claim', () => {
  for (const name of ['M7RecordCard.tsx', 'WelcomeExperience.tsx']) {
    const source = readFileSync(resolve(product, 'components', name), 'utf8');
    assert.doesNotMatch(source,/HealthKit|camera enabled|live M3|medical clearance/iu,name);
  }
});

test('R8-T06 locale-switch composition has no M7 semantic callback', () => {
  const welcome = readFileSync(resolve(product, 'components', 'WelcomeExperience.tsx'), 'utf8');
  const localeHandlers = [...welcome.matchAll(/onPress=\{\(\) => setLocale\([^\n]+/gu)]
    .map(match => match[0]).join('\n');
  assert.doesNotMatch(localeHandlers,/submit|record|correct|retract|revoke|delete|activate|reuse/iu);
  assert.equal(networkCalls, 0);
});

process.on('beforeExit', () => {
  console.log('R8-T09..R8-T14 M7 distinctions/neutral unavailable/no activation/no reuse: PASS');
  console.log('R8-T20 no HealthKit/Camera/live-M3 capability overclaim: PASS');
});

// U2 actual host/controller composition; activation/owner/M3 are CODE_OFFLINE fixtures.
const ended = w01 => assert.equal(w01.presentation().act('end'), true);
const chooseF = (record, choice = 'VERY_GOOD', locale = 'vi') => {
  assert.equal(record.presentation(locale).chooseFeedback(choice), true);
  return record.presentation(locale);
};
test('U2 E01/E12 actual host activation expiry at Start suppresses intake, never lawful W01 controls', async () => {
  for (const kind of ['ABSENT', 'FORGED', 'EXPIRED', 'VALID']) {
    const f = await fixture(kind), w01 = await goal(f);
    if (kind === 'VALID') f.clock.jumpWithoutTimers(80_000);
    started(w01);
    assert.equal(w01.presentation().act('stop'), true); ended(w01);
    assert.equal(f.slot.store.selfWalk.getCurrentEpisode(f.slot.store.reference()).end.kind, 'USER_REPORTED_END');
    if (f.slot.record) {
      assert.equal(f.slot.record.presentation().canFeedback, false);
      assert.equal(draft(f.slot.record).submit(), false);
    }
    f.host.deactivate();
  }
});

test('U2 current End enables four distinct F meanings with no R default or next-cycle grant', async () => {
  for (const [choice, label] of [['VERY_GOOD','Rất ổn'],['FELT_MANAGEABLE','Vừa sức'],['FELT_TOO_MUCH','Hơi quá'],['PROBLEM_REPORTED','Có vấn đề']]) {
    const f = await fixture(), w01 = await goal(f); started(w01); const record = f.slot.record;
    assert.equal(record.presentation().chooseFeedback(choice), false);
    ended(w01); assert.equal(record.presentation().feedbackDraft, undefined);
    assert.equal(record.presentation().canSubmitFeedback, false);
    assert.equal(chooseF(record, choice).submitFeedback(), true);
    const view = record.presentation();
    assert.equal(view.feedback.feedback.experience, choice);
    assert.equal(view.feedback.feedback.displayed_label, label);
    assert.equal(view.feedback.evidence.source, 'USER_REPORT');
    assert.equal(view.outcome, undefined); assert.equal(view.notice, 'saved');
    assert.equal(f.slot.store.m7Outcome.readNextCycle(undefined), undefined);
    assert.equal(f.slot.store.selfWalk.getCurrentEpisode(f.slot.store.reference()).end.kind, 'USER_REPORTED_END');
    f.host.deactivate();
  }
});

test('U2 P02/P03 locale change invalidates pending F/confirmation, preserves R draft and original revision locale', async () => {
  const f = await fixture(), w01 = await goal(f); started(w01); ended(w01); const r = f.slot.record;
  r.presentation().setEvidenceText('independent R note');
  const stale = chooseF(r); const japanese = r.presentation('ja');
  assert.equal(stale.submitFeedback(), false); assert.equal(japanese.feedbackDraft, undefined);
  assert.equal(japanese.draft.evidence_text, 'independent R note');
  assert.equal(chooseF(r, 'FELT_MANAGEABLE', 'ja').submitFeedback(), true);
  const stored = r.presentation('en').feedback;
  assert.equal(stored.feedback.locale, 'ja'); assert.equal(stored.feedback.displayed_label, '無理なく感じた');
  assert.equal(r.presentation().requestFeedbackDelete(), true); const confirm = r.presentation();
  r.presentation('vi'); assert.equal(confirm.confirmDelete(), false);
  assert.equal(r.presentation().feedback, stored);
  f.host.deactivate();
});

test('U2 E05/E06 controller preserves R non-CLEAR and independently retained F in both serializations', async () => {
  for (const fFirst of [true, false]) {
    const f = await fixture(), w01 = await goal(f); started(w01); ended(w01); const r = f.slot.record;
    if (fFirst) assert.equal(chooseF(r).submitFeedback(), true);
    assert.equal(draft(r, 'PARTIAL', 'PROBLEM').submit(), true);
    assert.equal(r.presentation().canFeedback, false);
    if (fFirst) {
      assert.equal(r.presentation().feedback.state, 'ACTIVE');
      assert.equal(r.presentation().beginFeedbackCorrection(), true);
      assert.equal(chooseF(r, 'PROBLEM_REPORTED').submitFeedback(), true);
      assert.equal(r.presentation().feedback.feedback.experience, 'PROBLEM_REPORTED');
    } else assert.equal(r.presentation().chooseFeedback('VERY_GOOD'), false);
    assert.equal(r.presentation().outcome.outcome.safety_disposition, 'REASSESS');
    f.host.deactivate();
  }
});

test('U2 E07/E09/E10 F-only M3 revoke retains management; final owned delete gives neutral closed view', async () => {
  const f = await fixture(), w01 = await goal(f); started(w01); ended(w01); const r = f.slot.record;
  assert.equal(chooseF(r).submitFeedback(), true); const stale = r.presentation();
  assert.equal(await f.slot.store.revoke(f.slot.store.reference()), true);
  assert.equal(r.presentation().feedback.state, 'ACTIVE');
  assert.equal(r.presentation().requestFeedbackRetraction(), true);
  assert.equal(r.presentation().confirmRetraction(), true);
  assert.equal(r.presentation().feedbackState, 'RETRACTED');
  assert.equal(r.presentation().requestFeedbackDelete(), true);
  assert.equal(r.presentation().confirmDelete(), true);
  const closed = r.presentation();
  assert.equal(closed.feedback, undefined); assert.equal(closed.notice, 'deletedFeedback');
  assert.equal(closed.canFeedback, false); assert.equal(stale.submitFeedback(), false);
  f.host.deactivate();
});

test('U2 D04/D05 exact component ACK and stale confirmation cannot erase a newer revision or counterpart', async () => {
  const f = await fixture(), w01 = await goal(f); started(w01); ended(w01); const r = f.slot.record;
  assert.equal(draft(r).submit(), true); assert.equal(chooseF(r).submitFeedback(), true);
  const report = r.presentation().outcome;
  assert.equal(r.presentation().requestFeedbackDelete(), true); const stale = r.presentation();
  assert.equal(r.presentation().beginFeedbackCorrection(), true);
  assert.equal(chooseF(r, 'FELT_TOO_MUCH').submitFeedback(), true);
  assert.equal(stale.confirmDelete(), false);
  assert.equal(r.presentation().requestFeedbackDelete(), true);
  assert.equal(r.presentation().confirmDelete(), true);
  assert.equal(r.presentation().notice, 'deletedFeedback'); assert.equal(r.presentation().outcome, report);
  assert.equal(r.presentation().feedback, undefined); assert.equal(r.presentation().canFeedback, false);
  assert.equal(r.presentation().requestDelete(), true); assert.equal(r.presentation().confirmDelete(), true);
  assert.equal(r.presentation().state, 'DELETED'); assert.equal(r.presentation().notice, 'deletedReport');
  f.host.deactivate();
});

test('U2 D05 own F notify may advance token; newer observer-authored draft survives old ACK', async () => {
  const f = await fixture(), w01 = await goal(f); started(w01); ended(w01); const r = f.slot.record;
  let changed = false;
  const off = f.slot.store.m7Outcome.subscribe(() => {
    if (changed || r.presentation().feedback?.state !== 'ACTIVE') return;
    changed = true;
    assert.equal(r.presentation().beginFeedbackCorrection(), true);
    assert.equal(r.presentation().chooseFeedback('FELT_TOO_MUCH'), true);
    r.presentation().setEvidenceText('new independent R note');
  });
  assert.equal(chooseF(r).submitFeedback(), true);
  off(); const view = r.presentation();
  assert.equal(changed, true); assert.equal(view.feedbackDraft.experience, 'FELT_TOO_MUCH');
  assert.equal(view.feedbackEditing, true); assert.equal(view.notice, undefined);
  assert.equal(view.draft.evidence_text, 'new independent R note');
  assert.equal(view.submitFeedback(), true);
  assert.equal(r.presentation().feedback.feedback.experience, 'FELT_TOO_MUCH');
  f.host.deactivate();
});

test('U2 owner revoked by F commit observer suppresses stale success and all old payload', async () => {
  const f = await fixture(), w01 = await goal(f); started(w01); ended(w01); const r = f.slot.record;
  let once = true; const store = f.slot.store;
  store.m7Outcome.subscribe(() => { if (once) { once = false; f.boundary.control.invalidateCurrentSession(); } });
  assert.equal(chooseF(r).submitFeedback(), false);
  assert.equal(f.host.currentSlot(), undefined); assert.equal(r.presentation().state, 'UNAVAILABLE');
  assert.equal(r.presentation().notice, undefined); assert.equal(store.m7Outcome.hasRetained(), false);
});

test('U2 exact selected8x25 F copy and unchanged34-key R vocabulary, not native-language acceptance', async () => {
  const { M7_FEEDBACK_COPY } = await import('../i18n-m7-record.ts');
  const { createHash } = await import('node:crypto');
  const canonical = x => x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
  for (const locale of ['vi','en','zh-Hans','es','hi','ja','ko','ru']) {
    assert.equal(Object.keys(M7_FEEDBACK_COPY[locale]).length, 25);
    assert.equal(Object.keys(M7_RECORD_COPY[locale]).length, 34);
  }
  assert.equal(createHash('sha256').update(JSON.stringify(canonical(M7_FEEDBACK_COPY))).digest('hex'), '4421669c546476efa1d6762a926eebcb422c19edf9618d677f4e6e86e572c0df');
});

test('U2 final erase observer switches current task before ACK; old success never enters successor', async () => {
  const f = await fixture(), w01 = await goal(f); started(w01); ended(w01); const r = f.slot.record;
  assert.equal(chooseF(r).submitFeedback(), true);
  assert.equal(r.presentation().requestFeedbackDelete(), true); const oldConfirm = r.presentation();
  let once = true; const off = f.slot.store.m7Outcome.subscribe(() => {
    if (!once) return; once = false;
    f.slot.store.submit('Successor independent task', { permission_granted: true });
  });
  assert.equal(oldConfirm.confirmDelete(), false); off(); await tick();
  assert.equal(r.presentation().notice, undefined); assert.equal(r.presentation().feedback, undefined);
  assert.equal(r.presentation().state, 'UNAVAILABLE');
  assert.equal(oldConfirm.confirmDelete(), false);
  f.host.deactivate();
});

test('U2 final-delete flush followed by genuine same-task successor Start suppresses old ACK', async () => {
  const f = await fixture(), w01 = await goal(f); started(w01); ended(w01); const r = f.slot.record;
  assert.equal(chooseF(r).submitFeedback(), true);
  assert.equal(r.presentation().requestFeedbackDelete(), true); const oldConfirm = r.presentation();
  const store = f.slot.store; let once = true, newStart;
  const off = store.m7Outcome.subscribe(() => {
    if (!once) return; once = false;
    const ref = store.reference();
    assert.equal(store.selfWalk.reportContext(ref, { source_ref: 'successor-current-context', intent: 'SHORT_LIGHT_MOVEMENT',
      walking_choice: 'WANTS_WALK', adult: 'REPORTED_ADULT', mobility: 'INDEPENDENT_COMFORTABLE_WALKING',
      concerns: 'NONE_REPORTED', professional_limits: 'NONE_REPORTED', setting: 'INDOOR_FLAT_CLEAR_LIT_DRY_STOPPABLE',
      competing_activity: 'NONE', footwear: 'FAMILIAR_SECURE', available_minutes: 5, requested_minutes: 3, currency: 'CURRENT' }), true);
    const p = store.selfWalk.propose(ref, 'successor-proposal');
    newStart = store.selfWalk.chooseAndStart(ref, p, 'successor-start');
  });
  assert.equal(oldConfirm.confirmDelete(), false); off();
  assert.equal(newStart.state, 'STARTED'); assert.equal(store.m7Outcome.getActivityVersion(), 2);
  const current = r.presentation(); assert.equal(current.notice, undefined); assert.equal(current.feedback, undefined);
  assert.equal(current.canFeedback, false); assert.equal(draft(r).submit(), true);
  assert.equal(r.presentation().outcome.episode.proposal_revision, newStart.proposal_revision);
  f.host.deactivate();
});

test('U2 independent R/F draft exits never cancel the counterpart draft or submit anything', async () => {
  const f=await fixture(),w01=await goal(f);started(w01);ended(w01);const r=f.slot.record;
  r.presentation().setEvidenceText('R draft survives F exit');chooseF(r);
  assert.equal(r.presentation().cancelFeedback(),true);
  assert.equal(r.presentation().feedbackDraft,undefined);assert.equal(r.presentation().draft.evidence_text,'R draft survives F exit');
  chooseF(r,'FELT_TOO_MUCH');const pending=r.presentation().feedbackDraft;
  assert.equal(r.presentation().cancel(),true);assert.equal(r.presentation().feedbackDraft,pending);
  assert.equal(r.presentation().draft.evidence_text,'');assert.equal(r.presentation().feedback,undefined);
  assert.equal(r.presentation().outcome,undefined);f.host.deactivate();
});

for(const kind of ['valid','shallow','deep','json','same-fields-expiry','wrong-lease','wrong-owner','expired-at-start','missing']) {
  test('QA11 T11 actual host Start activation '+kind+' with lawful M6 control',async()=>{
    const f=await fixture(async(binding,clock)=>{
      const token=createM7RecordActivation(binding,80000,clock.now);
      if(kind==='valid'||kind==='expired-at-start')return token;
      if(kind==='shallow')return {...token};
      if(kind==='deep')return structuredClone(token);
      if(kind==='json')return JSON.parse(JSON.stringify(token));
      if(kind==='same-fields-expiry')return Object.freeze({binding,expiresAt:80000,now:clock.now});
      if(kind==='wrong-lease')return createM7RecordActivation({...binding,lease:{...binding.lease}},80000,clock.now);
      if(kind==='wrong-owner'){
        const a=fakeAuthority(),b=createLocalOwnerBoundary(a.verifier,clock);
        a.results.push({status:'verified',owner:OWNER_B,validUntil:100000});const lease=await b.control.verifySession();b.control.finishHydration(lease);
        return createM7RecordActivation({access:b.access,lease},80000,clock.now);
      }
      return undefined;
    });
    const w01=await goal(f);const p=proposed(w01);assert.equal(p.act('accept'),true);
    if(kind==='expired-at-start')f.clock.jumpWithoutTimers(80000);
    assert.equal(w01.presentation().act('start'),true);
    assert.equal(w01.presentation().act('stop'),true);ended(w01);
    assert.equal(f.slot.store.selfWalk.getCurrentEpisode(f.slot.store.reference()).end.kind,'USER_REPORTED_END');
    const record=f.slot.record;
    if(kind==='valid'){assert.ok(record);assert.equal(chooseF(record).submitFeedback(),true);}
    else {
      for(let i=0;i<3;i++) {f.host.getSnapshot();record?.presentation();f.slot.store.selfWalk.getCurrentEpisode(f.slot.store.reference());}
      assert.equal(f.slot.store.m7Outcome.canRecord(f.slot.store.reference(),'F'),false);
      if(record)assert.equal(record.presentation().chooseFeedback('VERY_GOOD'),false);
    }
    f.host.deactivate();
  });
}

for(const newer of ['none','R','F','R+F'])test('QA11 T19 actual correction notification newer draft '+newer,async()=>{
  const f=await fixture(),w01=await goal(f);started(w01);ended(w01);const r=f.slot.record;
  assert.equal(chooseF(r).submitFeedback(),true);assert.equal(r.presentation().beginFeedbackCorrection(),true);
  const submitted=chooseF(r,'FELT_MANAGEABLE');let seen=0;const errors=[];
  const off=f.slot.store.m7Outcome.subscribe(()=>{
    if(seen++)return;
    try {
      assert.equal(r.presentation().feedback.feedback.experience,'FELT_MANAGEABLE');
      if(newer.includes('F')){assert.equal(r.presentation().beginFeedbackCorrection(),true);assert.equal(r.presentation().chooseFeedback('PROBLEM_REPORTED'),true);}
      if(newer.includes('R'))assert.equal(r.presentation().setEvidenceText('QA independent newer R'),true);
    }catch(e){errors.push(e);}
  });
  assert.equal(submitted.submitFeedback(),true);off();assert.equal(seen,1);assert.deepEqual(errors,[]);
  const v=r.presentation();assert.equal(v.feedback.feedback.experience,'FELT_MANAGEABLE');
  if(newer.includes('R'))assert.equal(v.draft.evidence_text,'QA independent newer R');
  if(newer.includes('F')){assert.equal(v.feedbackDraft.experience,'PROBLEM_REPORTED');assert.equal(v.feedbackEditing,true);assert.equal(v.notice,undefined);assert.equal(v.submitFeedback(),true);}
  else {assert.equal(v.feedbackDraft,undefined);assert.equal(v.feedbackEditing,false);assert.equal(v.notice,'corrected');}
  f.host.deactivate();
});

for(const roundtrip of [false,true])test('QA11 T29 locale changes inside F commit notification '+(roundtrip?'VI-JA-VI':'VI-JA'),async()=>{
  const f=await fixture(),w01=await goal(f);started(w01);ended(w01);const r=f.slot.record;
  r.presentation('vi').setEvidenceText('independent R text');const old=chooseF(r,'VERY_GOOD','vi');
  let seen=0;const errors=[];const off=f.slot.store.m7Outcome.subscribe(()=>{
    if(seen++)return;
    try {
      r.presentation('ja');if(roundtrip)r.presentation('vi');
      assert.equal(r.presentation().beginFeedbackCorrection(),true);
      assert.equal(r.presentation().chooseFeedback('FELT_TOO_MUCH'),true);
      assert.equal(r.presentation().setEvidenceText('newer R inside locale notification'),true);
    }catch(e){errors.push(e);}
  });
  assert.equal(old.submitFeedback(),true);off();assert.deepEqual(errors,[]);assert.equal(seen,1);
  const current=r.presentation();assert.equal(current.feedback.feedback.locale,'vi');assert.equal(current.feedback.feedback.displayed_label,'Rất ổn');
  assert.equal(current.notice,undefined);assert.equal(current.feedbackDraft.locale,roundtrip?'vi':'ja');
  assert.equal(current.feedbackDraft.experience,'FELT_TOO_MUCH');assert.equal(current.draft.evidence_text,'newer R inside locale notification');
  assert.equal(old.submitFeedback(),false);assert.equal(r.presentation().feedbackDraft,current.feedbackDraft);
  assert.equal(r.presentation().submitFeedback(),true);assert.equal(r.presentation().notice,'corrected');f.host.deactivate();
});

test('QA11 T22 actual host deactivate retirement closes before observer reentry; repeated retirement and successor positive',async()=>{
  const f=await fixture(),w01=await goal(f);started(w01);ended(w01);const r=f.slot.record,store=f.slot.store;
  assert.equal(chooseF(r).submitFeedback(),true);const prior=r.presentation().feedback;
  assert.equal(r.presentation().beginFeedbackCorrection(),true);const held=chooseF(r,'FELT_TOO_MUCH');
  let seen=0;const errors=[];
  const off=store.m7Outcome.subscribe(()=>{
    if(seen++)return;
    try {
      assert.equal(f.host.currentSlot(),undefined);
      assert.equal(store.m7Outcome.hasRetained(),false);
      assert.equal(held.submitFeedback(),false);
      assert.equal(r.presentation().chooseFeedback('VERY_GOOD'),false);
      assert.equal(r.presentation().feedback,undefined);
      assert.equal(store.m7Outcome.getFeedbackRevision(prior.revision,undefined),undefined);
    }catch(e){errors.push(e);}
  });
  f.host.deactivate();off();assert.equal(seen,1);assert.deepEqual(errors,[]);
  f.host.deactivate();assert.equal(held.submitFeedback(),false);assert.equal(store.m7Outcome.hasRetained(),false);
  f.host.activate('OWNED',f.binding,'fixture',()=>adapter,createM7RecordActivation(f.binding,80000,f.clock.now));
  const next={...f,slot:f.host.currentSlot()};assert.ok(next.slot);assert.notEqual(next.slot,f.slot);
  const nw=await goal(next);started(nw);ended(nw);
  assert.equal(held.submitFeedback(),false);assert.equal(chooseF(next.slot.record).submitFeedback(),true);
  assert.equal(next.slot.record.presentation().feedback.feedback.experience,'VERY_GOOD');f.host.deactivate();
});

// ROOT unit: execute actual default RootLayout -> private AppSurface -> actual Flow/hook.
// React scheduling, owner context, native UI and explicit M3 fixture are deterministic doubles.
// Root factory, lease boundary, activation reader, host, W01 and M7 remain actual modules.
{
const {createRequire}=await import('node:module');
const {dirname,relative}=await import('node:path');
const {existsSync}=await import('node:fs');
const {Script,createContext}=await import('node:vm');
const {createHash}=await import('node:crypto');
const require=createRequire(import.meta.url);
const ts=require('/workspace/100-human-development-Intelligence/node_modules/typescript/lib/typescript.js');
const app=product,candidate=resolve(app,'../..'),compiled=new Map(),loadedSources=new Map(),observations=[];
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
async function rootHarness({flow=true, mode='OWNED', locale='vi', managed=true, gatewayPatch={}, executors={}, recording=false,onCycleCreated, rootPhase='READY', bindingKind='VALID', runtimeMode='fixture'}={}) {
  const metrics={notifications:0,subscriptions:0,cleanups:0,stateChanges:0,provider:0,storageReadsDenied:0,storageWrites:0,nativeCalls:0,focus:0,blur:0,dismiss:0};
  const trace=[], hosts=[], cycles=[], modules=new Map(), timers=new Map();
  const rootCells=[],surfaceCells=[],flowCells=[];let cells=flowCells;let currentClock;
  let cursor=0, dirty=false, jobs=[], tree, api, phase='INITIAL', disposed=false, taskInputs=[];
  const blocked = name => () => { metrics.nativeCalls++; throw Error('FORBIDDEN_NATIVE_'+name); };
  const react={
    Fragment: 'Fragment',
    createElement(type,props,...children){return {type,props:{...props,children}};},
    useState(initial){const i=cursor++; if(!cells[i])cells[i]={value:typeof initial==='function'?initial():initial};const cell=cells[i];return [cell.value,next=>{const value=typeof next==='function'?next(cell.value):next;if(!Object.is(value,cell.value)){cell.value=value;dirty=true;metrics.stateChanges++;}}];},
    useRef(initial){return cells[cursor++]??={current:initial};},
    useMemo(fn,deps){const i=cursor++;if(!same(cells[i]?.deps,deps))cells[i]={deps,value:fn()};return cells[i].value;},
    useCallback(fn,deps){return react.useMemo(()=>fn,deps);},
    useEffect(fn,deps){const i=cursor++;if(!same(cells[i]?.deps,deps)){const prior=cells[i];const cell=cells[i]={deps};jobs.push(()=>{prior?.cleanup?.();cell.cleanup=fn();});}},
    useLayoutEffect(fn,deps){return react.useEffect(fn,deps);},
    useSyncExternalStore(subscribe,read){react.useLayoutEffect(()=>{metrics.subscriptions++;const off=subscribe(()=>{metrics.notifications++;trace.push({kind:'notify',phase});dirty=true;});return ()=>{metrics.cleanups++;off();};},[subscribe]);return read();},
  };
  const animation=()=>({start:cb=>cb?.({finished:true}),stop(){}});
  class Value {constructor(v){this.value=v;}setValue(v){this.value=v;}stopAnimation(){}interpolate(){return this;}}
  const native={Keyboard:{dismiss(){metrics.dismiss++;}},AccessibilityInfo:{isReduceMotionEnabled:async()=>true,addEventListener:()=>({remove(){}}),setAccessibilityFocus(){}},
    Animated:{Value,View:'Animated.View',Image:'Animated.Image',timing:animation,spring:animation,sequence:animation,parallel:animation,delay:animation,loop:animation},
    AppState:{addEventListener:()=>({remove(){}})},Easing:{out:v=>v,in:v=>v,inOut:v=>v,back:v=>v,quad:1,cubic:1,sin:1},
    Platform:{OS:'ios',select:v=>v.ios},StyleSheet:{create:v=>v,absoluteFill:{},absoluteFillObject:{},hairlineWidth:1},useWindowDimensions:()=>({width:390,height:844}),findNodeHandle:()=>null,
    ...Object.fromEntries(['Image','Modal','Pressable','ScrollView','Text','TextInput','View'].map(v=>[v,v]))};
  const storage={getItem:async()=>{metrics.storageReadsDenied++;throw Error('STORAGE_READ_DENIED');},setItem:async()=>{metrics.storageWrites++;throw Error('STORAGE_WRITE_FORBIDDEN');},removeItem:async()=>{metrics.storageWrites++;throw Error('STORAGE_REMOVE_FORBIDDEN');}};
  const mocks=new Map([
    ['react',react],['react-native',native],['@expo/vector-icons',{Feather:'Feather',MaterialCommunityIcons:'Icons'}],
    ['expo-linear-gradient',{LinearGradient:'Gradient'}],['expo-status-bar',{StatusBar:'StatusBar'}],
    ['@react-native-async-storage/async-storage',storage],
    ['react-native-safe-area-context',{useSafeAreaInsets:()=>({top:47,bottom:34})}],
    ['react-native-keyboard-controller',{KeyboardAvoidingView:'KeyboardAvoidingView',useKeyboardState:select=>select({isVisible:true})}],
    ['@/components/WelcomeLogoAnimation',{WelcomeLogoAnimation:'Logo'}],['@/components/WelcomeExperience',{WelcomeExperience:'WelcomeExperience'}],
    ['@/components/Animated100Signature',{Animated100Signature:'Signature'}],['@/components/TrainerJourneyCard',{TrainerJourneyCard:'TrainerJourneyCard'}],
    ['@/context/TrainerRuntimeContext',{useOptionalTrainerJourney:()=>undefined}],
    ['@/hooks/useColors',{useColors:()=>({})}],
    ['@/context/LocalizationContext',{useLocale:()=>({locale,setLocale:v=>{locale=v;dirty=true;},t:key=>load('i18n.ts').translate(locale,key)})}],
  ]);
  const nativeModules=new Map([
    ['components/cameraC0Picker.ts',{expoCameraC0Picker:{requestCameraPermission:blocked('permission'),takePhoto:blocked('camera'),choosePhoto:blocked('library')}}],
    ['components/CameraLocalPreview.tsx',{createCameraLocalPreviewHandle:blocked('preview')}],
    ['lib/camera/expo-cache-cleanup.ts',{createExpoCacheCleanup:()=>({remove:blocked('cache-remove')})}],
    ['domain/m3/gateway-adapter.ts',{createM3GatewayAdapter:blocked('provider-adapter')}],
  ]);
  class RootDate extends Date {static now(){return currentClock?.now()??1000;}}
  const context=createContext({Date:RootDate,console,crypto:globalThis.crypto,process:{env:Object.freeze({EXPO_PUBLIC_M3_RUNTIME_MODE:runtimeMode})},AbortController,URL,TextEncoder,TextDecoder,
    fetch:()=>{metrics.provider++;throw Error('NETWORK_FORBIDDEN');},queueMicrotask,
    setTimeout(fn){const id=Symbol();timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>{const id=Symbol();timers.set(id,fn);return id;},cancelAnimationFrame:id=>timers.delete(id)});
  function load(name,parent=app+'/entry.ts') {
    if(mocks.has(name))return mocks.get(name);
    if(name.endsWith('.png')){assert.equal(name,'../assets/images/100-v05-sunless-scene-v1.png');return 1;}
    let file=name.startsWith('@/')?resolve(app,name.slice(2)):name.startsWith('.')?resolve(dirname(parent),name):resolve(app,name);
    if(!extname(file)){file=['.ts','.tsx','.mjs','.js'].map(ext=>file+ext).find(existsSync);assert.ok(file,'MISSING_DEPENDENCY '+name);}
    assert.ok(file.startsWith(candidate+'/'),'OUTSIDE_CANDIDATE '+name);
    const rel=relative(app,file);if(nativeModules.has(rel))return nativeModules.get(rel);
    if(modules.has(file))return modules.get(file).exports;
    assert.ok(existsSync(file),'UNKNOWN_DEPENDENCY '+name);
    const mod={exports:{}};modules.set(file,mod);
    if(!compiled.has(file)){const bytes=readFileSync(file);const source=bytes.toString('utf8');loadedSources.set(file,{path:relative(candidate,file),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});compiled.set(file,ts.transpileModule(source,{fileName:file.replace(/\.mjs$/,'.ts'),compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText);}
    const execute=new Script('(function(require,module,exports){'+compiled.get(file)+'\n})',{filename:file}).runInContext(context);
    execute(dep=>load(dep,file),mod,mod.exports);
    if(rel==='domain/m2.ts'){
      const actual=mod.exports.resolveM2View;mod.exports.resolveM2View=(...args)=>{const result=actual(...args);trace.push({kind:'resolve',phase,snapshot:args[0],result});return result;};
    }
    if(rel==='components/useM2Gateway.ts'){
      const actual=mod.exports.useM2Gateway;mod.exports.useM2Gateway=(...args)=>{api=actual(...args);return api;};
    }
    if(rel==='domain/trainer-runtime/m7-cycle-authority.ts'){
      const actual=mod.exports.createTrainerM7CycleAuthority;mod.exports.createTrainerM7CycleAuthority=(...args)=>{const c=actual(...args);cycles.push(c);onCycleCreated?.(c,load);return c;};
    }
    if(rel==='components/m3-host-lifetime.ts'){
      const actual=mod.exports.createM3HostLifetime;mod.exports.createM3HostLifetime=(...args)=>{const h=actual(...args);hosts.push(h);return h;};
    }
    return mod.exports;
  }
  const fixture=load('scripts/fixtures/local-owner.mjs');
  const {createLocalOwnerBoundary}=load('domain/local-owner/boundary.ts');
  const clock=new fixture.FakeClock();currentClock=clock;const authority=fixture.fakeAuthority();const boundary=createLocalOwnerBoundary(authority.verifier,clock);
  async function session(owner=fixture.OWNER_A){authority.results.push({status:'verified',owner,validUntil:100000});const lease=await boundary.control.verifySession();boundary.control.finishHydration(lease);return {access:boundary.access,lease};}
  let ownerSession=await session();
  const adapter={provenance:'TEST_FIXTURE',processing:'ON_DEVICE',contract:'M3_GATEWAY_V1',async interpret(input){taskInputs.push(input);return {intent_type:'GOAL',interpreted_meaning:'Khỏe hơn',confidence:.95,uncertainty:null,missing_context:[],clarification_needed:false,clarification_question:null,safety_state:'CLEAR',suggested_next_role:'M4',task_kind:'general_health',context_effect:'NONE',used_context_ids:[],response:'Đã ghi nhận.'};},async revoke(){}};
  if(bindingKind==='MISSING')ownerSession=undefined;
  else if(bindingKind==='COPIED_LEASE')ownerSession={...ownerSession,lease:{...ownerSession.lease}};
  else if(bindingKind==='FORGED_PROOF')ownerSession={...ownerSession,lease:{owner:fixture.OWNER_A,generation:1,validUntil:100000}};
  else if(bindingKind==='WRONG_ACCESS'){const other=createLocalOwnerBoundary(fixture.fakeAuthority().verifier,clock);ownerSession={...ownerSession,access:other.access};}
  else if(bindingKind==='EXPIRED')clock.jumpWithoutTimers(100000);
  const welcome={hydrated:true,visible:true,reviewing:false,resumeGoal:false,runId:'root-run-1',markWelcomeSeen(){},closeWelcome(){}};
  for(const name of ['Development','Opening','Coaching','Interaction'])mocks.set('@/context/'+name+'Context',{[name+'Provider']:name+'Provider'});
  mocks.set('@/context/OwnerSessionContext',{OwnerSessionProvider:'OwnerSessionProvider',useOwnerSessionBinding:()=>ownerSession,useOwnerSessionControl:()=>({phase:rootPhase})});
  mocks.set('@/context/WelcomeContext',{WelcomeProvider:'WelcomeProvider',FORCE_SLICE_PREVIEW_OPENING:false,useWelcome:()=>welcome});
  mocks.get('@/context/LocalizationContext').LocalizationProvider='LocalizationProvider';
  mocks.get('@/context/TrainerRuntimeContext').TrainerRuntimeProvider='TrainerRuntimeProvider';
  mocks.get('react-native-safe-area-context').SafeAreaProvider='SafeAreaProvider';
  mocks.get('react-native-keyboard-controller').KeyboardProvider='KeyboardProvider';
  mocks.set('@tanstack/react-query',{QueryClient:class {},QueryClientProvider:'QueryClientProvider'});
  mocks.set('react-native-gesture-handler',{GestureHandlerRootView:'GestureHandlerRootView'});
  mocks.set('@/components/ErrorBoundary',{ErrorBoundary:'ErrorBoundary'});
  mocks.set('@expo-google-fonts/inter',{useFonts:()=>[true,null]});
  mocks.set('expo-router',{Stack:Object.assign('Stack',{Screen:'Stack.Screen'}),useRouter:()=>({push(){}})});
  mocks.set('expo-splash-screen',{preventAutoHideAsync:async()=>{},hideAsync:async()=>{}});
  // Explicit test-only M3 interpretation boundary; root runtime selector still executes.
  mocks.set('@/domain/m3/stub-adapter',{createM3StubAdapter:()=>adapter});
  let props;

  const hook=load('components/useM2Gateway.ts').useM2Gateway;
  const Flow=flow?load('components/OpeningGoalFlow.tsx').OpeningGoalFlow:undefined;
  const Card=load('components/W01ProductCard.tsx').W01ProductCard;
  const RecordCard=load('components/M7RecordCard.tsx').M7RecordCard;
  const translate=key=>load('i18n.ts').translate(locale,key);
  const Root=load('app/_layout.tsx').default;
  function locate(value,predicate){if(Array.isArray(value)){for(const v of value){const hit=locate(v,predicate);if(hit)return hit;}}else if(value?.props){if(predicate(value))return value;return locate(value.props.children,predicate);}}
  function rootProps(){cells=rootCells;cursor=0;const rootTree=Root();const surface=locate(rootTree,n=>typeof n.type==='function'&&n.type.name==='AppSurface');assert.ok(surface,'ACTUAL_ROOT_APPSURFACE');cells=surfaceCells;cursor=0;const surfaceTree=surface.type(surface.props);const receiver=locate(surfaceTree,n=>n.type===Flow);assert.ok(receiver,'ACTUAL_OPENING_GOAL_FLOW_RECEIVER');return receiver.props;}
  const nodes=()=>{const result=[];function walk(v){if(Array.isArray(v))v.forEach(walk);else if(v?.props){result.push(v);if(v.type===Card)walk(Card(v.props));else if(v.type===RecordCard)walk(RecordCard(v.props));else walk(v.props.children);}}walk(tree);return result;};
  const find=id=>nodes().find(n=>n.props.testID===id);
  const inputHost={focus(){metrics.focus++;find('opening-goal-input')?.props.onFocus?.();},blur(){metrics.blur++;find('opening-goal-input')?.props.onBlur?.();}};
  function render(){assert.equal(disposed,false);for(let pass=0;pass<35;pass++){dirty=false;props=rootProps();cells=flowCells;cursor=0;tree=flow?Flow(props):(hook(props.m2Gateway,locale,translate,props.ownerSession,undefined,props.m3HostMode,props.m7RecordActivation),null);const input=find('opening-goal-input');if(input?.props.ref)input.props.ref.current=inputHost;const scroll=find('opening-goal-scroll');if(scroll?.props.ref)scroll.props.ref.current={scrollTo(){}};const pending=jobs;jobs=[];pending.forEach(fn=>fn());if(!dirty)return;}assert.fail('UNBOUNDED_RENDER');}
  async function settle(){await tick();if(dirty)render();await tick();if(dirty)render();}
  function press(id){const n=find(id);assert.ok(n,'MISSING_CONTROL '+id);assert.notEqual(n.props.disabled,true,'DISABLED_CONTROL '+id);phase=id;return n.props.onPress();}
  render();await settle();
  if(flow){assert.equal(tree.type,'WelcomeExperience');tree.props.onBegin();render();await settle();}
  return {load,find,nodes,render,settle,press,metrics,trace,get props(){return props;},clock,boundary,authority,fixture,session,welcome,
    setControlPhase(v){rootPhase=v;render();},setBinding(v){ownerSession=v;render();},get binding(){return ownerSession;},
    get api(){return api;},get cycle(){return cycles.at(-1);},get dirty(){return dirty;},get store(){return hosts.at(-1)?.currentSlot()?.store;},get host(){return hosts.at(-1);},get inputs(){return taskInputs;},
    setPhase(v){phase=v;},setLocale(v){locale=v;render();},
    type(text){phase='TYPE';if(flow)find('opening-goal-input').props.onChangeText(text);else api.changeText(text);render();},
    async submit(text='Khỏe hơn'){this.type(text);phase='SUBMIT';if(flow)press('opening-goal-submit');else api.submit(text);await settle();},
    async accept(){phase='ACCEPT';if(flow)press('m5-goal-use');else assert.equal(api.acceptM5GoalChoice(),true);assert.equal(dirty,true,'ACCEPT_MUST_NOTIFY');await settle();},
    async start(){for(const answer of favorable){if(flow)press('w01-answer-'+answer);else assert.equal(api.w01.presentation.answer(answer),true);assert.equal(dirty,true,'W01_MUST_NOTIFY');await settle();}if(flow)press('w01-accept');else assert.equal(api.w01.presentation.act('accept'),true);await settle();if(flow)press('w01-start');else assert.equal(api.w01.presentation.act('start'),true);assert.equal(dirty,true,'START_MUST_NOTIFY');await settle();},
    async owner(owner){ownerSession=await session(owner);render();await settle();},
    revoke(){phase='REVOKE';boundary.control.invalidateCurrentSession();},
    dispose(){for(const c of [...rootCells,...surfaceCells,...flowCells])c?.cleanup?.();disposed=true;observations.push({...metrics});assert.equal(metrics.provider,0);assert.equal(metrics.storageWrites,0);assert.equal(metrics.nativeCalls,0);assert.equal(metrics.subscriptions,metrics.cleanups);},
  };
}
const rootActivationValid=h=>h.load('components/m7-record-activation.ts').readM7RecordActivation(h.props.m7RecordActivation,h.binding);
async function rootReady(h){await h.submit();await h.accept();await h.start();}
function rootInput(h){const n=h.find('opening-goal-input');return {value:n.props.value,ref:n.props.ref,key:n.props.key,focus:h.metrics.focus,blur:h.metrics.blur,dismiss:h.metrics.dismiss};}

test('ROOT R01 actual RootLayout AppSurface passes genuine activation into actual Flow without granting purpose',async()=>{
 const h=await rootHarness();try{
  assert.ok(h.props.m7RecordActivation);assert.equal(rootActivationValid(h),true);assert.equal(h.props.m3HostMode,'OWNED');
  assert.ok(h.host.currentSlot().record);assert.equal(h.store.m7Outcome.getSnapshot(undefined).state,'DENIED');
  assert.equal(h.store.m7Outcome.readNextCycle(undefined),undefined);assert.equal(h.store.selfWalk.getSnapshot().state,'IDLE');
  assert.equal(h.host.currentSlot().record.presentation().canFeedback,false);assert.equal(h.api.view,null);
 }finally{h.dispose();}
});
for(const kind of ['MISSING','COPIED_LEASE','FORGED_PROOF','WRONG_ACCESS','EXPIRED'])test('ROOT R02 negative root binding '+kind,async()=>{
 const h=await rootHarness({bindingKind:kind});try{assert.equal(h.props.m7RecordActivation,undefined);assert.equal(rootActivationValid(h),false);assert.equal(h.host.currentSlot()?.record,undefined);}finally{h.dispose();}
});
for(const phase of ['VERIFYING','HYDRATING','LOCKED'])test('ROOT R03 phase '+phase+' cannot issue activation',async()=>{
 const h=await rootHarness({rootPhase:phase});try{assert.equal(h.props.m7RecordActivation,undefined);assert.notEqual(h.props.m3HostMode,'OWNED');assert.equal(rootActivationValid(h),false);}finally{h.dispose();}
});
test('ROOT R04 same actual tuple wrapper locale and M3 rerenders preserve activation host record and composer',async()=>{
 const h=await rootHarness();try{await rootReady(h);h.press('w01-end');await h.settle();h.type('independent M2 text');
  const token=h.props.m7RecordActivation,host=h.host.currentSlot(),record=host.record;
  record.presentation().setEvidenceText('independent R draft');await h.settle();const before=rootInput(h);
  h.setBinding({...h.binding});h.render();h.setLocale('ja');h.props.m2Gateway.setM3Access(true);await h.settle();
  assert.equal(h.props.m7RecordActivation,token);assert.equal(h.host.currentSlot(),host);assert.equal(h.host.currentSlot().record,record);
  assert.deepEqual(rootInput(h),before);assert.equal(record.presentation().draft.evidence_text,'independent R draft');
 }finally{h.dispose();}
});
test('ROOT R05 A1 B A2 same owner ID never revives old token callback; fresh activity remains positive',async()=>{
 const h=await rootHarness();try{await rootReady(h);h.press('w01-end');await h.settle();const oldToken=h.props.m7RecordActivation,oldBinding=h.binding,old=h.host.currentSlot().record.presentation();
  await h.owner(h.fixture.OWNER_B);const bToken=h.props.m7RecordActivation;assert.notEqual(bToken,oldToken);assert.equal(rootActivationValid(h),true);
  await h.owner(h.fixture.OWNER_A);h.type('fresh A2 draft');const current=rootInput(h);assert.notEqual(h.props.m7RecordActivation,oldToken);
  assert.equal(h.load('components/m7-record-activation.ts').readM7RecordActivation(oldToken,oldBinding),false);assert.equal(old.chooseFeedback('VERY_GOOD'),false);assert.deepEqual(rootInput(h),current);
  await rootReady(h);h.press('w01-end');await h.settle();assert.equal(h.host.currentSlot().record.presentation().chooseFeedback('VERY_GOOD'),true);
 }finally{h.dispose();}
});
test('ROOT R06 root issued activation actual W01 Stop denies F; actual End explicit F succeeds with no R or reuse',async()=>{
 const h=await rootHarness();try{await rootReady(h);const r=h.host.currentSlot().record;
  h.press('w01-stop');await h.settle();assert.equal(r.presentation().chooseFeedback('VERY_GOOD'),false);assert.equal(r.presentation().canFeedback,false);
  h.press('w01-end');await h.settle();assert.equal(r.presentation().chooseFeedback('FELT_MANAGEABLE'),true);assert.equal(r.presentation().submitFeedback(),true);await h.settle();
  assert.equal(r.presentation().feedback.feedback.experience,'FELT_MANAGEABLE');assert.equal(r.presentation().outcome,undefined);assert.equal(r.presentation().notice,'saved');assert.equal(h.store.m7Outcome.readNextCycle(undefined),undefined);
 }finally{h.dispose();}
});
test('ROOT R07 proof cutoff before Start fails closed without token renewal by getters or rerender',async()=>{
 const h=await rootHarness();try{await h.submit();await h.accept();const token=h.props.m7RecordActivation;
  for(const answer of favorable){h.press('w01-answer-'+answer);await h.settle();}
  h.press('w01-accept');await h.settle();const heldStart=h.find('w01-start').props.onPress;
  const store=h.store,record=h.host.currentSlot().record;
  assert.equal(store.selfWalk.getSnapshot().state,'ACCEPTED');
  h.clock.jumpWithoutTimers(99000);assert.equal(rootActivationValid(h),false);
  assert.equal(heldStart(),false);assert.equal(record.presentation().chooseFeedback('VERY_GOOD'),false);
  assert.equal(store.selfWalk.getCurrentEpisode(store.reference()),undefined);
  h.render();await h.settle();
  assert.equal(h.props.m7RecordActivation===token||h.props.m7RecordActivation===undefined,true);assert.equal(rootActivationValid(h),false);
  assert.equal(h.host.currentSlot()?.record?.presentation().canFeedback??false,false);
 }finally{h.dispose();}
});
test('ROOT R08 proof cutoff after End rejects held explicit F commit',async()=>{
 const h=await rootHarness();try{await rootReady(h);h.press('w01-end');await h.settle();const r=h.host.currentSlot().record;assert.equal(r.presentation().chooseFeedback('VERY_GOOD'),true);const held=r.presentation();
  h.clock.jumpWithoutTimers(99000);assert.equal(held.submitFeedback(),false);assert.equal(rootActivationValid(h),false);assert.equal(r.presentation().feedback,undefined);
 }finally{h.dispose();}
});
test('ROOT R09 production default OFF is unchanged; render cannot enable fixture or provider',async()=>{
 const h=await rootHarness({runtimeMode:''});try{assert.equal(h.props.m2Gateway.m3StubAdapter,undefined);assert.equal(h.metrics.provider,0);assert.equal(h.store.selfWalk.getSnapshot().state,'IDLE');}finally{h.dispose();}
});

test('ROOT R10 transient blocked phase retires old host callbacks; current READY gets fresh usable host',async()=>{
 const h=await rootHarness();try{await rootReady(h);h.press('w01-end');await h.settle();
  const old=h.host.currentSlot().record.presentation(),oldSlot=h.host.currentSlot(),oldToken=h.props.m7RecordActivation;
  h.setControlPhase('HYDRATING');await h.settle();assert.equal(h.props.m7RecordActivation,undefined);assert.equal(h.host.currentSlot(),undefined);
  assert.equal(old.chooseFeedback('VERY_GOOD'),false);
  h.setControlPhase('READY');await h.settle();assert.equal(rootActivationValid(h),true);assert.notEqual(h.props.m7RecordActivation,oldToken);assert.notEqual(h.host.currentSlot(),oldSlot);
  h.type('independent replacement input');const current=rootInput(h);assert.equal(old.submitFeedback(),false);assert.deepEqual(rootInput(h),current);
  await rootReady(h);h.press('w01-end');await h.settle();assert.equal(h.host.currentSlot().record.presentation().chooseFeedback('VERY_GOOD'),true);
 }finally{h.dispose();}
});
}

// M2 UNKNOWN guard: reuse the exact existing ROOT fixture definitions above.
// Its block-private helpers cannot be imported; evaluate only those fixture definitions,
// never a copied product predicate. All product modules still load from this candidate.
{
const priorRootFixture = readFileSync(fileURLToPath(import.meta.url), 'utf8');
const fixtureBegin = priorRootFixture.indexOf("const {createRequire}=await import('node:module');");
const fixtureEnd = priorRootFixture.indexOf("test('ROOT R01 ", fixtureBegin);
assert.ok(fixtureBegin > 0 && fixtureEnd > fixtureBegin);
const {rootHarness,rootActivationValid,rootReady,rootInput} = await eval('(async()=>{'
  + priorRootFixture.slice(fixtureBegin,fixtureEnd).replaceAll('import.meta.url',JSON.stringify(import.meta.url))
  + 'return {rootHarness,rootActivationValid,rootReady,rootInput};})()');
const guardCopy = {question:'Goal?',placeholder:'Express',goals:['A','B','C','D'],resume:'Resume',returnWithPlan:'Return',actions:{}};
test('M2UG G01 actual root unsupported defaults must resolve neutral rather than NEW',async()=>{
 const h=await rootHarness();try{
  const actual=h.load('domain/m2.ts').resolveM2View;
  assert.equal(actual(h.props.m2Gateway.snapshot,guardCopy,[],h.clock.now()),null);
 }finally{h.dispose();}
});

for(const [label,options] of [
 ['owned-ready',{}],['missing-binding',{bindingKind:'MISSING'}],
 ['locked-without-binding',{bindingKind:'MISSING',rootPhase:'LOCKED'}],
 ['verifying',{rootPhase:'VERIFYING'}],['hydrating',{rootPhase:'HYDRATING'}],
 ['copied-lease',{bindingKind:'COPIED_LEASE'}],['forged-proof',{bindingKind:'FORGED_PROOF'}],
 ['wrong-access',{bindingKind:'WRONG_ACCESS'}],['expired',{bindingKind:'EXPIRED'}],
 ['default-OFF',{runtimeMode:''}],
])test('M2UG G02 four unknown axes and neutral actual resolver '+label,async()=>{
 const h=await rootHarness(options);try{
  const s=h.props.m2Gateway.snapshot;
  assert.equal(s.subject.profile,'unknown');assert.equal(s.goal,'unknown');
  assert.equal(s.activeTask.kind,'unknown');assert.equal(s.returning.kind,'unknown');
  assert.equal(h.load('domain/m2.ts').resolveM2View(s,guardCopy,[],h.clock.now()),null);
  assert.equal(h.props.m2Gateway.m3Access.status,'denied');assert.equal(h.metrics.provider,0);
  if(label==='default-OFF')assert.equal(h.props.m2Gateway.m3StubAdapter,undefined);
 }finally{h.dispose();}
});
for(const axis of ['profile','goal','activeTask','returning'])test('M2UG G03 explicit verified NEW comparator and independent unknown '+axis,async()=>{
 const h=await rootHarness();try{
  const actual=h.load('domain/m2.ts').resolveM2View;
  // Explicit deterministic contract fixture, never a root truth issuer.
  const verified={...h.props.m2Gateway.snapshot,subject:{...h.props.m2Gateway.snapshot.subject,profile:'new'},goal:'none',activeTask:{kind:'none'},returning:{kind:'none'}};
  assert.equal(actual(verified,guardCopy,[],h.clock.now()).kind,'goal');
  const unknown={...verified};
  if(axis==='profile')unknown.subject={...verified.subject,profile:'unknown'};
  else if(axis==='goal')unknown.goal='unknown';else unknown[axis]={kind:'unknown'};
  assert.equal(actual(unknown,guardCopy,[],h.clock.now()),null);
 }finally{h.dispose();}
});
for(const label of ['empty-device-marker','hidden-then-reopened-marker','review-device-marker'])test('M2UG G04 Welcome presentation never mints observations '+label,async()=>{
 const h=await rootHarness();try{
  h.type('independent typed expression');const before=rootInput(h);
  if(label==='hidden-then-reopened-marker'){
   h.welcome.visible=false;
   assert.throws(()=>h.render(),/ACTUAL_OPENING_GOAL_FLOW_RECEIVER/,'actual hidden root has no Flow receiver');
  }
  Object.assign(h.welcome,{visible:true,reviewing:label==='review-device-marker',resumeGoal:false});h.render();await h.settle();
  const s=h.props.m2Gateway.snapshot;
  assert.equal(s.subject.profile,'unknown');assert.equal(s.goal,'unknown');assert.equal(s.activeTask.kind,'unknown');assert.equal(s.returning.kind,'unknown');
  assert.equal(h.load('domain/m2.ts').resolveM2View(s,guardCopy,[],h.clock.now()),null);
  assert.deepEqual(rootInput(h),before);assert.equal(h.metrics.storageWrites,0);
 }finally{h.dispose();}
});
for(const locale of ['vi','en','zh-Hans','es','hi','ja','ko','ru'])test('M2UG G05 unknown survives locale permission wrapper rerender with composer '+locale,async()=>{
 const h=await rootHarness();try{
  h.type('independent draft '+locale);const before=rootInput(h),activation=h.props.m7RecordActivation;
  h.setLocale(locale);h.setBinding({...h.binding});h.props.m2Gateway.setM3Access(true);await h.settle();
  assert.deepEqual(rootInput(h),before);assert.equal(h.props.m7RecordActivation,activation);
  const s=h.props.m2Gateway.snapshot;assert.equal(h.load('domain/m2.ts').resolveM2View(s,guardCopy,[],h.clock.now()),null);
  assert.equal(s.subject.profile,'unknown');assert.equal(s.activeTask.kind,'unknown');assert.equal(s.returning.kind,'unknown');assert.equal(h.metrics.provider,0);
 }finally{h.dispose();}
});
test('M2UG G06 actual accepted M5 and W01 Start Stop End F supersede unknown only through genuine projection',async()=>{
 const h=await rootHarness();try{
  assert.equal(h.api.view,null);await h.submit();await h.accept();
  assert.equal(h.props.m2Gateway.snapshot.goal,'unknown','root itself still has no goal issuer');
  assert.ok(h.trace.some(t=>t.kind==='resolve'&&t.snapshot?.goal==='confirmed'),'actual hook accepted goal projection');
  await h.start();assert.equal(h.api.view.kind,'reported_action');assert.equal(h.api.view.phase,'started');
  const record=h.host.currentSlot().record;h.press('w01-stop');await h.settle();assert.equal(record.presentation().chooseFeedback('VERY_GOOD'),false);
  h.press('w01-end');await h.settle();assert.equal(h.api.view.phase,'ended_by_user');
  assert.equal(record.presentation().chooseFeedback('FELT_MANAGEABLE'),true);assert.equal(record.presentation().submitFeedback(),true);await h.settle();
  assert.equal(record.presentation().feedback.feedback.experience,'FELT_MANAGEABLE');assert.equal(record.presentation().outcome,undefined);
  assert.equal(h.store.m7Outcome.readNextCycle(undefined),undefined);
 }finally{h.dispose();}
});

test('M2UG G07 explicit guest selection remains ANONYMOUS unknown without activation',async()=>{
 const h=await rootHarness({bindingKind:'MISSING',rootPhase:'LOCKED'});try{
  assert.equal(h.props.m3HostMode,'ANONYMOUS','existing harness onBegin already invokes the actual guest selection callback');h.props.onGoalOpened();h.render();await h.settle();
  assert.equal(h.props.m3HostMode,'ANONYMOUS');assert.equal(h.props.m7RecordActivation,undefined);
  const s=h.props.m2Gateway.snapshot;assert.equal(s.subject.profile,'unknown');assert.equal(s.goal,'unknown');assert.equal(s.activeTask.kind,'unknown');assert.equal(s.returning.kind,'unknown');
  assert.equal(h.load('domain/m2.ts').resolveM2View(s,guardCopy,[],h.clock.now()),null);assert.equal(h.metrics.provider,0);
 }finally{h.dispose();}
});
}
