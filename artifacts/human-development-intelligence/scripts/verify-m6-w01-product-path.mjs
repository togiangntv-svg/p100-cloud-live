import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extname } from 'node:path';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
registerHooks({ resolve(s, c, next) { return next(s.startsWith('.') && !extname(s) ? `${s}.ts` : s, c); } });
let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw Error('NETWORK_FORBIDDEN'); };
const { FakeClock, fakeAuthority, OWNER_A, OWNER_B } = await import('./fixtures/local-owner.mjs');
const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const { createLocalWalkResource, W01 } = await import('../domain/m6/walk-resource.ts');
const { actW01Product, answerW01ProductQuestion, createW01ProductController,
  createW01ProductionBinding } = await import('../components/w01-product-controller.ts');
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function fixture({ owner = OWNER_A, observe = true, onChange = () => {}, legacy = false } = {}) {
  const clock = new FakeClock(); const authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner, validUntil: 100000 });
  const lease = await boundary.control.verifySession(); boundary.control.finishHydration(lease);
  const resource = createLocalWalkResource();
  const adapter = { provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    async interpret() { return { intent_type: 'GOAL', interpreted_meaning: 'Khỏe hơn', confidence: .95,
      uncertainty: null, missing_context: [], clarification_needed: false, clarification_question: null,
      safety_state: 'CLEAR', suggested_next_role: 'M4', task_kind: 'general_health', context_effect: 'NONE',
      used_context_ids: [], response: 'Đã ghi nhận.' }; }, async revoke() {} };
  const store = createSessionTaskStore({ adapter, now: () => clock.now(),
    ownerSession: { access: boundary.access, lease }, walkResource: resource.access });
  store.start(); const task = store.submit('Khỏe hơn', { permission_granted: true }); await tick();
  let ref = store.reference(task); store.acceptM5Goal(ref, store.assessM5Goal(ref, store.assessM4GoalReadiness(ref)));
  ref = store.reference(task); let current = true; let reports = []; let proposeCalls = 0;
  const selfWalk = observe ? Object.freeze({ ...store.selfWalk,
    reportContext(boundRef, facts, metadata) {
      reports.push(structuredClone(facts));
      return store.selfWalk.reportContext(boundRef, facts, metadata);
    },
    propose(boundRef, id) { proposeCalls++; return store.selfWalk.propose(boundRef, id); },
  }) : store.selfWalk;
  const identity = Object.freeze({ ownerAccess: boundary.access, ownerLease: lease, store, ref });
  const makeBinding = () => createW01ProductionBinding({
    identity, current: () => current, selfWalk: legacy ? { ...selfWalk, end: undefined, getCurrentEpisode: undefined } : selfWalk,
  });
  let binding = makeBinding();
  const controller = createW01ProductController({ onChange }); controller.bind(binding);
  return { controller, store, ref, resource, boundary, authority, clock, reports,
    get binding() { return binding; },
    get proposeCalls() { return proposeCalls; },
    deny() { current = false; },
    replace() { binding = makeBinding(); controller.bind(binding); } };
}
const answer = (f, id) => { const view = f.controller.presentation(); assert.ok(view.question); assert.equal(answerW01ProductQuestion(view,id), true); return f.controller.presentation(); };
const favorable = ['yes','none','none','adult','independent','supported','none_competing','suitable','5','3'];
const complete = (f) => { let view; for (const id of favorable) view = answer(f, id); return view; };

// P01-P04: passive/navigation/default behavior and explicit traceability.
test('P01-P04 passive front door has no defaults or invented favorable report', async () => {
  const f = await fixture(); const first = f.controller.presentation();
  assert.equal(first.state, 'IDLE'); assert.equal(first.question.id, 'walking_choice'); assert.equal(f.reports.length, 0);
  f.controller.presentation(); assert.equal(f.reports.length, 0); assert.equal(first.question.options.includes('yes'), true);
  const v = answer(f, 'yes'); assert.equal(v.question.id, 'concerns');
  assert.deepEqual(f.reports[0], { intent: 'SHORT_LIGHT_MOVEMENT', walking_choice: 'WANTS_WALK' });
  assert.equal('available_minutes' in f.reports[0], false); assert.equal('requested_minutes' in f.reports[0], false);
});

test('P05-P10 safety answers exit through domain without proposal/start', async () => {
  for (const [id, expected] of [['pain','SAFETY_HOLD'],['dizzy','SAFETY_HOLD'],['breathless','SAFETY_HOLD'],['unresolved','SAFETY_HOLD'],['urgent','URGENT_HELP']]) {
    const f = await fixture(); answer(f, 'yes'); const v = answer(f, id);
    assert.equal(v.state, expected); assert.equal(v.question, undefined); assert.equal(f.store.selfWalk.getSnapshot().state, 'IDLE');
  }
  const f = await fixture(); answer(f, 'yes'); answer(f, 'none'); assert.equal(answer(f, 'restricted').state, 'SAFETY_HOLD');
});

test('P08 question-level uncertainty and skip retain the same unresolved question without domain calls', async () => {
  for (const id of ['not_sure','skip']) {
    const f = await fixture(); const before = f.controller.presentation();
    const reportCount = f.reports.length; const proposeCount = f.proposeCalls;
    assert.equal(before.answer(id), true);
    const after = f.controller.presentation();
    assert.equal(after.state, 'NEED_CONTEXT');
    assert.equal(after.question?.id, before.question?.id);
    assert.equal(f.reports.length, reportCount);
    assert.equal(f.proposeCalls, proposeCount);
  }
});

test('P11-P13 unanswered remains IDLE; decline is the only decline', async () => {
  const untouched = await fixture(); assert.equal(untouched.controller.presentation().state, 'IDLE');
  const declined = await fixture(); const out = answer(declined, 'decline'); assert.equal(out.state, 'NO_ACTION');
  assert.deepEqual(declined.reports[0], { walking_choice: 'DECLINED' }); assert.equal(out.question, undefined);
});

test('P14-P18 each unsupported explicit fact exits early', async () => {
  const cases = [[3,'not_adult'],[4,'needs_support'],[5,'unsupported'],[6,'hazardous'],[7,'unsuitable']];
  for (const [at, adverse] of cases) { const f = await fixture(); for (let i=0;i<at;i++) answer(f,favorable[i]); const v=answer(f,adverse); assert.equal(v.state,'UNSUPPORTED'); assert.equal(v.question,undefined); }
});

test('P19-P23 available/requested are separate, bounded, and proposal acceptance does not start', async () => {
  const f = await fixture(); let view = complete(f); assert.equal(view.state, 'PROPOSED'); assert.equal(view.content.title.includes('3'), true);
  assert.equal(f.reports.at(-2).available_minutes, 5); assert.equal('requested_minutes' in f.reports.at(-2), false);
  assert.equal(f.reports.at(-1).requested_minutes, 3);
  const proposed = f.store.selfWalk.getSnapshot(); assert.equal(proposed.start, undefined);
  assert.equal(view.act('accept'), true); view = f.controller.presentation(); assert.equal(view.state, 'ACCEPTED'); assert.equal(f.store.selfWalk.getSnapshot().start, undefined);
  assert.equal(view.act('start'), true); assert.equal(f.controller.presentation().state, 'STARTED');
});

test('P24-P27 cancel, global skip, stop and no automatic reopen', async () => {
  const skipped = await fixture(); assert.equal(skipped.controller.presentation().globalSkip(), true); assert.equal(skipped.reports.length, 0); assert.equal(skipped.controller.presentation().state, 'DISMISSED');
  const cancelled = await fixture(); let v=complete(cancelled); assert.equal(v.act('cancel'),true); assert.equal(cancelled.controller.presentation().state,'CANCELLED');
  const stopped = await fixture(); v=complete(stopped); v.act('accept'); stopped.controller.presentation().act('start'); assert.equal(stopped.controller.presentation().act('stop'),true); assert.equal(stopped.controller.presentation().state,'STOPPED');
});

test('P28-P35 stale callbacks, replay, authority/source/task and owner changes fail closed', async () => {
  const f = await fixture(); const stale=f.controller.presentation(); answer(f,'yes'); assert.equal(stale.answer('yes'),false); assert.equal(stale.answer('decline'),false);
  const live=f.controller.presentation(); f.replace(); assert.equal(live.answer('none'),false);
  const permission=await fixture(); permission.deny(); assert.equal(permission.controller.presentation().answer('yes'),false);
  const source=await fixture(); source.resource.withdraw(); assert.equal(answer(source,'yes').state,'NEED_CONTEXT');
  const task=await fixture(); task.store.edit(task.ref,'changed'); await tick(); assert.equal(task.controller.presentation().answer('yes'),false);
  const owner=await fixture(); owner.authority.results.push({status:'verified',owner:OWNER_B,validUntil:200000}); const lease=await owner.boundary.control.verifySession(); owner.boundary.control.finishHydration(lease); assert.equal(owner.controller.presentation().answer('yes'),false);
});

test('F1/P36-P39 same-owner INVALIDATED exposes only bounded Stop; logout denies it', async () => {
  const f=await fixture(); let v=complete(f); v.act('accept'); f.controller.presentation().act('start'); f.resource.withdraw();
  v=f.controller.presentation(); assert.equal(v.state,'INVALIDATED'); assert.equal(v.primaryAction,'stop');
  assert.equal(v.canCancel,false); assert.equal(v.act('accept'),false); assert.equal(v.act('start'),false);
  assert.equal(actW01Product(v,'stop'),true); assert.equal(f.controller.presentation().state,'STOPPED');
  const logout=await fixture(); v=complete(logout); v.act('accept'); logout.controller.presentation().act('start'); logout.boundary.control.invalidateCurrentSession(); assert.equal(logout.controller.presentation().act('stop'),false);
});

test('F2 production rebind starts clean and rejects stale owner callbacks', async () => {
  const a=await fixture(); const b=await fixture({ owner: OWNER_B });
  const controller=createW01ProductController({ onChange() {} }); controller.bind(a.binding);
  let view;
  for (const id of favorable) {
    view=controller.presentation(); assert.equal(answerW01ProductQuestion(view,id),true);
  }
  view=controller.presentation(); assert.equal(view.state,'PROPOSED');
  assert.equal(actW01Product(view,'accept'),true); view=controller.presentation();
  assert.equal(actW01Product(view,'start'),true); const staleA=controller.presentation();
  const aReports=a.reports.length; controller.bind(b.binding);
  const freshB=controller.presentation(); assert.equal(freshB.state,'IDLE');
  assert.equal(freshB.question.id,'walking_choice'); assert.equal(b.reports.length,0);
  assert.equal(b.store.selfWalk.getSnapshot().state,'IDLE');
  assert.equal(staleA.act('stop'),false); assert.equal(a.reports.length,aReports); assert.equal(b.reports.length,0);
  assert.equal(answerW01ProductQuestion(freshB,'yes'),true);
  assert.deepEqual(b.reports[0],{intent:'SHORT_LIGHT_MOVEMENT',walking_choice:'WANTS_WALK'});
});

test('P40-P43 release-8, locale purity and prohibited integrations', async () => {
  const { W01_COPY } = await import('../i18n-m6.ts');
  assert.deepEqual(Object.keys(W01_COPY).sort(), ['en','es','hi','ja','ko','ru','vi','zh-Hans'].sort());
  const card=readFileSync(new URL('../components/W01ProductCard.tsx',import.meta.url),'utf8');
  const controller=readFileSync(new URL('../components/w01-product-controller.ts',import.meta.url),'utf8');
  assert.doesNotMatch(controller+card,/chooseAndStart|AsyncStorage|fetch\(|HealthKit|Health Connect|Camera/u);
  const f=await fixture(); f.controller.presentation(); JSON.stringify(W01_COPY); assert.equal(f.reports.length,0);
  assert.equal(W01.real_user_activation,false); assert.equal(W01.independent_clinical_review,'NOT_RUN'); assert.equal(networkCalls,0);
});

test('P44 shared production binding drives real store, Stop visibility and clean rebind', async () => {
  const a=await fixture({ observe: false });
  const controller=createW01ProductController({ onChange() {} }); controller.bind(a.binding);
  let view=controller.presentation(); assert.equal(view.question.id,'walking_choice');
  assert.equal(answerW01ProductQuestion(view,'yes'),true);
  view=controller.presentation(); assert.equal(view.state,'NEED_CONTEXT'); assert.equal(view.question.id,'concerns');
  for (const id of favorable.slice(1)) {
    view=controller.presentation(); assert.ok(view.question);
    assert.equal(answerW01ProductQuestion(view,id),true);
  }
  view=controller.presentation(); assert.equal(view.state,'PROPOSED');
  assert.equal(a.store.selfWalk.getSnapshot().state,'PROPOSED');
  assert.equal(a.store.selfWalk.getSnapshot().start,undefined);
  assert.equal(actW01Product(view,'accept'),true); view=controller.presentation();
  assert.equal(view.state,'ACCEPTED'); assert.equal(a.store.selfWalk.getSnapshot().start,undefined);
  assert.equal(actW01Product(view,'start'),true); view=controller.presentation();
  const started=a.store.selfWalk.getSnapshot(); assert.equal(view.state,'STARTED'); assert.ok(started.start);
  assert.equal('performed' in started,false); assert.equal('effective' in started,false);
  a.resource.withdraw(); const staleA=controller.presentation();
  assert.equal(staleA.state,'INVALIDATED'); assert.equal(staleA.primaryAction,'stop');
  const b=await fixture({ owner: OWNER_B, observe: false }); controller.bind(b.binding);
  const freshB=controller.presentation(); assert.equal(freshB.state,'IDLE'); assert.equal(freshB.question.id,'walking_choice');
  assert.equal(b.store.selfWalk.getSnapshot().state,'IDLE'); assert.equal(b.store.selfWalk.getSnapshot().start,undefined);
  assert.equal(actW01Product(staleA,'stop'),false); assert.equal(b.store.selfWalk.getSnapshot().state,'IDLE');
  assert.equal(networkCalls,0);
});

// U1 CODE_OFFLINE: fixture authority, actual binding/controller, no product activation.
function startBound(f) { let v=complete(f);assert.equal(v.act('accept'),true);v=f.controller.presentation();assert.equal(v.act('start'),true);return f.controller.presentation(); }
test('U1 WE01/02 bound End is separate, current and available after ordinary Stop',async()=>{
  for(const ordinaryStop of [false,true]) {
    const f=await fixture();let v=startBound(f);assert.equal(v.canEnd,true);assert.equal(v.primaryAction,'stop');
    if(ordinaryStop){assert.equal(v.act('stop'),true);v=f.controller.presentation();assert.equal(v.state,'STOPPED');assert.equal(v.endedByUser,false);assert.equal(v.canEnd,true);}
    assert.equal(v.act('end'),true);v=f.controller.presentation();assert.equal(v.state,'STOPPED');assert.equal(v.endedByUser,true);assert.equal(v.canEnd,false);assert.equal(v.act('end'),false);
  }
});
test('U1 WE03 invalidated Stop survives but End and current lifecycle do not',async()=>{
  const f=await fixture();startBound(f);f.resource.withdraw();let v=f.controller.presentation();
  assert.equal(v.primaryAction,'stop');assert.equal(v.canEnd,false);assert.equal(v.act('end'),false);
  assert.equal(v.act('stop'),true);v=f.controller.presentation();assert.equal(v.state,'STOPPED');assert.equal(v.canEnd,false);assert.equal(v.endedByUser,false);
});
test('U1 WE05 old End callbacks cannot cross a real owner-bound rebind',async()=>{
  const a=await fixture();const b=await fixture({owner:OWNER_B});const old=startBound(a);
  a.controller.bind(b.binding);assert.equal(old.act('end'),false);assert.equal(b.store.selfWalk.getSnapshot().state,'IDLE');
  a.controller.bind(a.binding);assert.equal(old.act('end'),false);
  const fresh=await fixture();assert.equal(startBound(fresh).act('end'),true);
});
test('U1 WE15 notification revocation denies old success after committed intent',async()=>{
  let f,armed=false;
  f=await fixture({onChange:()=>{if(armed)f.boundary.control.invalidateCurrentSession();}});
  const v=startBound(f);armed=true;assert.equal(v.act('end'),false);
  assert.equal(f.controller.presentation().endedByUser,false);
});
test('U1 WE15 throwing observer cannot mint End acknowledgement from STOPPED alone',async()=>{
  let armed=false;const f=await fixture({onChange:()=>{if(armed)throw Error('OBSERVER_FAILURE');}});
  const v=startBound(f);armed=true;assert.equal(v.act('end'),true);
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref).end.kind,'USER_REPORTED_END');
});
test('U1 WE14 old port without End capability keeps accept/start/Stop functional',async()=>{
  const f=await fixture({legacy:true});let v=startBound(f);assert.equal(v.canEnd,false);assert.equal(v.act('end'),false);
  assert.equal(v.act('stop'),true);assert.equal(f.controller.presentation().state,'STOPPED');
});
test('U1 WE12 eight locales have distinct neutral End copy without changing Stop indexes',async()=>{
  const {W01_COPY}=await import('../i18n-m6.ts');
  const stops={en:'Stop',vi:'Dừng','zh-Hans':'停止',es:'Detener',hi:'रोकें',ja:'停止',ko:'중지',ru:'Остановиться'};
  for(const [locale,c] of Object.entries(W01_COPY)){assert.equal(c.actions.stop,stops[locale]);assert.ok(c.actions.end.trim());assert.notEqual(c.actions.end,c.actions.stop);assert.ok(c.ended.trim());assert.equal(Object.keys(c.questions).length,10);assert.equal(Object.keys(c.answers).length,26);}
  assert.equal(networkCalls,0);
});
