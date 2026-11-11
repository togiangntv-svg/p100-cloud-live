import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extname } from 'node:path';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FakeClock, fakeAuthority, OWNER_A, OWNER_B } from './fixtures/local-owner.mjs';
registerHooks({ resolve(s, c, next) { return next(s.startsWith('.') && !extname(s) ? s + '.ts' : s, c); } });
let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw Error('NETWORK_FORBIDDEN'); };
const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const { createLocalWalkResource, W01 } = await import('../domain/m6/walk-resource.ts');
const { urgentWalkGuidance } = await import('../domain/m6/self-walk.ts');
const tick = () => new Promise(r => setImmediate(r));
const facts = (changes = {}) => ({
  source_ref: 'fixture-report-1', intent: 'SHORT_LIGHT_MOVEMENT', walking_choice: 'WANTS_WALK',
  adult: 'REPORTED_ADULT', mobility: 'INDEPENDENT_COMFORTABLE_WALKING',
  concerns: 'NONE_REPORTED', professional_limits: 'NONE_REPORTED',
  setting: 'INDOOR_FLAT_CLEAR_LIT_DRY_STOPPABLE', competing_activity: 'NONE',
  footwear: 'FAMILIAR_SECURE', available_minutes: 20, requested_minutes: 5,
  currency: 'CURRENT', ...changes,
});
async function fixture({ phase = 'READY', source = true, goal = 'general_health', anonymous = false, badLease = false, beforeApply, m7Purpose } = {}) {
  const clock = new FakeClock(); const authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner: OWNER_A, validUntil: 100000 });
  const lease = await boundary.control.verifySession();
  if (phase === 'READY') boundary.control.finishHydration(lease);
  const resource = createLocalWalkResource();
  const adapter = { provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    async interpret() { return { intent_type: 'GOAL', interpreted_meaning: 'Khỏe hơn', confidence: .95,
      uncertainty: null, missing_context: [], clarification_needed: false, clarification_question: null,
      safety_state: 'CLEAR', suggested_next_role: 'M4', task_kind: goal, context_effect: 'NONE',
      used_context_ids: [], response: 'Đã ghi nhận.' }; }, async revoke() {} };
  const store = createSessionTaskStore({ adapter, now: () => clock.now(),
    ownerSession: anonymous ? undefined : { access: beforeApply ? { ...boundary.access, applyIfCurrent(lease, apply) { beforeApply(); return boundary.access.applyIfCurrent(lease, apply); } } : boundary.access, lease: badLease ? {} : lease },
    m7Purpose, walkResource: source === true ? resource.access : source === false ? undefined : source });
  store.start(); const task = store.submit('Khỏe hơn', { permission_granted: true }); await tick();
  let ref = store.reference(task);
  const receipt = ref && store.acceptM5Goal(ref, store.assessM5Goal(ref, store.assessM4GoalReadiness(ref)));
  ref = store.reference(task);
  return { store, ref, task, receipt, clock, boundary, authority, lease, resource };
}
const proposal = (f, report = facts()) => {
  assert.equal(f.store.selfWalk.reportContext(f.ref, report), true);
  return f.store.selfWalk.propose(f.ref, 'proposal-1');
};
test('AS01 concrete source-bound proposal is NOT_STARTED; source bytes preserved', async () => {
  const f = await fixture(); const p = proposal(f);
  assert.equal(p.state, 'PROPOSED'); assert.equal(p.duration_minutes, 5);
  assert.equal(p.action_id, 'trainer.self.walk-easy.v0_1');
  assert.equal(p.start, undefined); assert.equal(p.acceptance, undefined);
  assert.equal(p.source_handoff.source_m5_receipt.task_id, f.receipt.task_id);
  assert.equal(p.source_handoff.source_m5_receipt.choice, 'ACCEPTED');
  assert.match(p.content.instructions, /Có thể dừng bất cứ lúc nào/u);
  assert.equal(p.source.real_user_activation, false);
  assert.equal(createHash('sha256').update(readFileSync(new URL('../../../docs/100-trainer/100_M6_TRAINER_ACTION_SOURCE_v0.1_2026-09-22.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')).digest('hex'), W01.sha256);
});
test('AS02 missing, forged, wrong-version and withdrawn sources fail closed', async () => {
  for (const source of [false, {}, { version: 99, approved: true }]) {
    const f = await fixture({ source }); assert.equal(proposal(f).state, 'SOURCE_BLOCKED');
  }
  const f = await fixture(); f.resource.withdraw(); assert.equal(proposal(f).state, 'SOURCE_BLOCKED');
});
test('AS03 M5 acceptance alone never starts W01', async () => {
  const f = await fixture(); assert.ok(f.receipt); assert.equal(f.store.selfWalk.getSnapshot().state, 'IDLE');
  assert.equal(f.store.selfWalk.start(f.ref, {}, 'start').state, 'DENIED');
});
test('AS04 atomic choice/start records distinct meanings once, no completion', async () => {
  const f = await fixture(); const p = proposal(f);
  const result = f.store.selfWalk.chooseAndStart(f.ref, p, 'choose-start');
  assert.equal(result.state, 'STARTED'); assert.equal(result.acceptance.kind, 'USER_CHOICE');
  assert.equal(result.start.kind, 'USER_REPORTED_START');
  assert.equal(result.start.recorded_at, f.clock.now());
  assert.equal(result.acceptance.recorded_at, result.start.recorded_at);
  assert.equal(f.store.selfWalk.chooseAndStart(f.ref, p, 'choose-start'), result);
  assert.equal('completed' in result, false); assert.equal('outcome' in result, false);
});
test('separate acceptance still requires explicit start', async () => {
  const f = await fixture(); const p = proposal(f);
  assert.equal(f.store.selfWalk.accept(f.ref, p, 'accept').state, 'ACCEPTED');
  assert.equal(f.store.selfWalk.getSnapshot().start, undefined);
  assert.equal(f.store.selfWalk.start(f.ref, p, 'start').state, 'STARTED');
});
test('AS05 time and NONE_REPORTED alone are insufficient', async () => {
  const f = await fixture(); assert.equal(proposal(f, { source_ref: 'partial', available_minutes: 20, concerns: 'NONE_REPORTED', currency: 'CURRENT' }).state, 'NEED_CONTEXT');
});
test('AS06/07 bounded durations, no invented twenty-minute walk', async () => {
  for (const [available, wanted, duration] of [[3,3,3],[20,5,5],[20,undefined,5],[1,undefined,1],[4,4,4]]) {
    const f = await fixture(); assert.equal(proposal(f, facts({ available_minutes: available, requested_minutes: wanted })).duration_minutes, duration);
  }
  for (const [available, wanted] of [[3,5],[20,20],[0,1],[20,0],[20,NaN]]) {
    const f = await fixture(); assert.equal(proposal(f, facts({ available_minutes: available, requested_minutes: wanted })).state, 'NEED_CONTEXT');
  }
});
test('AS08 refusal, strength intent and unsupported mobility do not become W01', async () => {
  for (const report of [facts({ walking_choice: 'DECLINED' }), facts({ intent: 'STRENGTH_SESSION' })]) {
    const f = await fixture(); assert.equal(proposal(f, report).state, 'NO_ACTION');
  }
  const f = await fixture(); assert.equal(proposal(f, facts({ mobility: 'NEEDS_SUPPORT' })).state, 'UNSUPPORTED');
});
test('AS09 current report reused without extra questions or proposal replacement', async () => {
  const f = await fixture(); const p = proposal(f);
  assert.equal(f.store.selfWalk.reportContext(f.ref, facts()), true);
  assert.equal(f.store.selfWalk.propose(f.ref, 'proposal-1'), p);
  assert.equal(f.store.selfWalk.accept(f.ref, p, 'a').state, 'ACCEPTED');
});
test('AS10 missing, uncertain and conflicting facts block', async () => {
  for (const change of [{ currency: 'UNCERTAIN' }, { currency: 'CONFLICTING' }, { concerns: 'UNKNOWN' }, { footwear: undefined }, { adult: undefined }]) {
    const f = await fixture(); const result = proposal(f, facts(change));
    assert.equal(result.state, 'NEED_CONTEXT'); assert.equal(typeof result.clarify, 'string');
  }
});
test('AS11 urgent safety takes precedence even when other context is missing', async () => {
  const f = await fixture(); const p = proposal(f); f.store.selfWalk.accept(f.ref, p, 'a');
  f.store.selfWalk.reportContext(f.ref, { source_ref: 'urgent', concerns: 'URGENT' });
  assert.equal(f.store.selfWalk.getSnapshot().state, 'INVALIDATED');
  assert.equal(f.store.selfWalk.start(f.ref, p, 's').state, 'DENIED');
  assert.equal(f.store.selfWalk.propose(f.ref, 'urgent-p').state, 'URGENT_HELP');
  assert.match(urgentWalkGuidance, /khẩn cấp/u);
});
test('AS12 symptoms/professional limits never trigger a smaller-dose workaround', async () => {
  for (const change of [{ concerns: 'PAIN' }, { concerns: 'DIZZY' }, { concerns: 'UNUSUAL_BREATHLESSNESS' }, { concerns: 'UNRESOLVED' }, { professional_limits: 'REPORTED' }]) {
    const f = await fixture(); assert.equal(proposal(f, facts({ ...change, requested_minutes: 1 })).state, 'SAFETY_HOLD');
  }
});
test('AS13 invalid lease and anonymous task cannot create owner-bound content', async () => {
  for (const opts of [{ badLease: true }, { anonymous: true }]) {
    const f = await fixture(opts); assert.equal(f.store.selfWalk.getSnapshot().state, 'UNAVAILABLE');
    assert.equal(f.store.selfWalk.reportContext(f.ref, facts()), false);
  }
});
test('AS13 expiry on getter clears private RAM even with suspended timers', async () => {
  const f = await fixture(); proposal(f); f.clock.jumpWithoutTimers(100001);
  assert.equal(f.store.selfWalk.getSnapshot().state, 'UNAVAILABLE');
  assert.equal(f.store.getSnapshot().tasks.length, 0);
  assert.equal(f.store.selfWalk.start(f.ref, {}, 's').state, 'DENIED');
});
test('AS14 HYDRATING is not READY; no task, proposal or start', async () => {
  const f = await fixture({ phase: 'HYDRATING' }); assert.equal(f.task, undefined);
  assert.equal(f.store.selfWalk.start(f.ref, {}, 's').state, 'DENIED');
});
test('AS15 task edit/cancel/permission/M5 retirement invalidates old proposal', async () => {
  for (const mutate of [f => f.store.edit(f.ref, 'Khỏe hơn nữa'), f => f.store.cancel(f.ref), f => f.store.setM3Permission(f.ref, false), f => f.store.retireM5GoalChoice(f.ref)]) {
    const f = await fixture(); const p = proposal(f); mutate(f); await tick();
    assert.equal(f.store.selfWalk.getSnapshot().state, 'INVALIDATED');
    assert.equal(f.store.selfWalk.chooseAndStart(f.ref, p, 'x').state, 'DENIED');
  }
});
test('AS15 context revision changes independently, interruption retires prior context', async () => {
  const f = await fixture(); const p = proposal(f);
  f.store.selfWalk.reportContext(f.ref, facts({ available_minutes: 3, requested_minutes: 3 }));
  assert.equal(f.store.selfWalk.accept(f.ref, p, 'a').state, 'DENIED');
  const p2 = f.store.selfWalk.propose(f.ref, 'p2'); assert.equal(p2.duration_minutes, 3);
  f.store.selfWalk.interrupt(); assert.equal(f.store.selfWalk.propose(f.ref, 'p3').state, 'NEED_CONTEXT');
});
test('AS16 owner change/generation change never adopts A into B or refresh', async () => {
  for (const owner of [OWNER_A, OWNER_B]) {
    const f = await fixture(); const p = proposal(f);
    f.authority.results.push({ status: 'verified', owner, validUntil: 200000 });
    const next = await f.boundary.control.verifySession(); f.boundary.control.finishHydration(next);
    assert.equal(f.store.selfWalk.getSnapshot().state, 'UNAVAILABLE'); assert.equal(f.store.getSnapshot().tasks.length, 0);
    f.store.start(); assert.equal(f.store.submit('new', { permission_granted: true }), undefined);
    assert.equal(f.store.selfWalk.accept(f.ref, p, 'a').state, 'DENIED');
  }
});
test('AS17 reused request with different command or proposal fails, duplicate is idempotent', async () => {
  const f = await fixture(); const p = proposal(f);
  const a = f.store.selfWalk.accept(f.ref, p, 'same');
  assert.equal(f.store.selfWalk.accept(f.ref, p, 'same'), a);
  assert.equal(f.store.selfWalk.start(f.ref, p, 'same').state, 'DENIED');
  assert.equal(f.store.selfWalk.accept(f.ref, { ...p }, 'same').state, 'DENIED');
});
test('AS18 cancel/stop/revoke after STARTED never completes', async () => {
  for (const op of ['cancel', 'stop', 'revoke']) {
    const f = await fixture(); const p = proposal(f); f.store.selfWalk.chooseAndStart(f.ref, p, 's');
    if (op === 'revoke') await f.store.revoke(f.ref); else f.store.selfWalk[op](f.ref, p, op);
    const result = f.store.selfWalk.getSnapshot();
    assert.equal(result.state, op === 'cancel' ? 'CANCELLED' : op === 'stop' ? 'STOPPED' : 'INVALIDATED');
    assert.equal('completed' in result, false);
    assert.equal(f.store.selfWalk.start(f.ref, p, 'retry').state, 'DENIED');
  }
});
test('AS19/20 offline SELF and presentation preference cannot change decision', async () => {
  const a = await fixture(); const b = await fixture();
  const p1 = proposal(a); const p2 = proposal(b, { ...facts(), presentation_preference: 'COMPACT_EN' });
  assert.equal(p1.duration_minutes, p2.duration_minutes); assert.equal(p1.action_id, p2.action_id);
  assert.equal(networkCalls, 0);
});
test('AS21 RAM only: a newly constructed store does not restore action', async () => {
  const a = await fixture(); const p = proposal(a); a.store.selfWalk.chooseAndStart(a.ref, p, 's'); a.store.stop();
  const b = await fixture(); assert.equal(b.store.selfWalk.getSnapshot().state, 'IDLE');
});
test('AS22 source withdrawal invalidates immediately and cannot be undone by replay', async () => {
  const f = await fixture(); const p = proposal(f); f.store.selfWalk.accept(f.ref, p, 'a'); f.resource.withdraw();
  assert.equal(f.store.selfWalk.getSnapshot().state, 'INVALIDATED');
  assert.equal(f.store.selfWalk.start(f.ref, p, 's').state, 'DENIED');
  assert.equal(f.store.selfWalk.propose(f.ref, 'p2').state, 'SOURCE_BLOCKED');
});
test('foreign proposal/task cannot cross stores even with coincident task IDs', async () => {
  const a = await fixture(); const b = await fixture(); const p = proposal(a); proposal(b);
  assert.equal(b.store.selfWalk.accept(b.ref, p, 'a').state, 'DENIED');
});
test('switch away and back never revives the prior view or context', async () => {
  const f = await fixture(); const p = proposal(f);
  const other = f.store.submit('Another goal', { permission_granted: true }); await tick();
  assert.ok(other); f.store.switchTask(f.store.reference(f.task));
  const r = f.store.reference(f.task);
  f.store.acceptM5Goal(r, f.store.assessM5Goal(r, f.store.assessM4GoalReadiness(r)));
  const current = f.store.reference(f.task);
  assert.equal(f.store.selfWalk.getSnapshot().state, 'INVALIDATED');
  assert.equal(f.store.selfWalk.accept(current, p, 'old').state, 'DENIED');
  assert.equal(f.store.selfWalk.propose(current, 'new').state, 'NEED_CONTEXT');
});
test('non-general-health M5 cannot be relabeled walking by context', async () => {
  const f = await fixture({ goal: 'strength' });
  if (f.receipt) assert.equal(proposal(f).state, 'NO_ACTION');
  else assert.equal(f.store.selfWalk.reportContext(f.ref, facts()), false);
});
test('withdrawal after STARTED preserves start record but blocks further authority', async () => {
  const f = await fixture(); const p = proposal(f);
  const started = f.store.selfWalk.chooseAndStart(f.ref, p, 'start'); f.resource.withdraw();
  const invalid = f.store.selfWalk.getSnapshot(); assert.equal(invalid.state, 'INVALIDATED');
  assert.equal(invalid.start, started.start);
  assert.equal(f.store.selfWalk.chooseAndStart(f.ref, p, 'start').state, 'DENIED');
});
test('current-context refusal after STARTED invalidates, never restarts', async () => {
  const f = await fixture(); const p = proposal(f); f.store.selfWalk.chooseAndStart(f.ref, p, 's');
  f.store.selfWalk.reportContext(f.ref, facts({ walking_choice: 'DECLINED' }));
  assert.equal(f.store.selfWalk.getSnapshot().state, 'INVALIDATED');
  assert.equal(f.store.selfWalk.propose(f.ref, 'refusal').state, 'NO_ACTION');
});
test('invalid authority from another real boundary cannot accept the lease', async () => {
  const f = await fixture(); const other = await fixture();
  const s = createSessionTaskStore({ ownerSession: { access: other.boundary.access, lease: f.lease }, walkResource: f.resource.access });
  s.start(); assert.equal(s.getSnapshot().tasks.length, 0);
  assert.equal(s.selfWalk.getSnapshot().state, 'UNAVAILABLE');
});
test('scheduled expiry clears both task and action state', async () => {
  const f = await fixture(); const p = proposal(f); f.store.selfWalk.chooseAndStart(f.ref, p, 's');
  f.clock.advance(100001); assert.equal(f.store.getSnapshot().tasks.length, 0);
  assert.equal(f.store.selfWalk.getSnapshot().state, 'UNAVAILABLE');
});
test('late M3 result after owner revocation cannot resurrect task or M6', async () => {
  const f = await fixture(); let release;
  const adapter = { provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    interpret: () => new Promise(r => { release = r; }), async revoke() {} };
  const s = createSessionTaskStore({ adapter, ownerSession: { access: f.boundary.access, lease: f.lease }, walkResource: f.resource.access });
  s.start(); s.submit('Khỏe hơn', { permission_granted: true }); await tick();
  f.boundary.control.invalidateCurrentSession(); release?.({}); await tick();
  assert.equal(s.getSnapshot().tasks.length, 0); assert.equal(s.selfWalk.getSnapshot().state, 'UNAVAILABLE');
});
test('input mutation does not rewrite a displayed decision or its selected duration', async () => {
  const f = await fixture(); const input = facts(); const p = proposal(f, input);
  input.requested_minutes = 20; input.concerns = 'URGENT';
  assert.equal(p.duration_minutes, 5); assert.ok(Object.isFrozen(p.content));
  // Changes are only accepted as a NEW report, which invalidates the old action.
  f.store.selfWalk.reportContext(f.ref, input);
  assert.equal(f.store.selfWalk.accept(f.ref, p, 'a').state, 'DENIED');
});
test('request capacity is bounded and fails closed without evicting replay history', async () => {
  const f = await fixture(); let first;
  for (let i = 0; i < 128; i++) {
    assert.equal(f.store.selfWalk.reportContext(f.ref, facts({ source_ref: `report-${i}` })), true);
    const p = f.store.selfWalk.propose(f.ref, `p-${i}`); assert.equal(p.state, 'PROPOSED'); first ??= p;
  }
  f.store.selfWalk.reportContext(f.ref, facts({ source_ref: 'overflow' }));
  assert.equal(f.store.selfWalk.propose(f.ref, 'overflow').state, 'DENIED');
  assert.equal(f.store.selfWalk.accept(f.ref, first, 'p-0').state, 'DENIED');
});
test('product path uses explicit transitions and preserves non-activation truth', () => {
  const hook = readFileSync(new URL('../components/useM2Gateway.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(hook, /createLocalWalkResource|chooseAndStart/u);
  assert.match(hook, /selfWalk\.reportContext/u);
  assert.match(hook, /selfWalk\.propose/u);
  assert.match(hook, /operation: 'accept' \| 'start' \| 'cancel' \| 'stop'/u);
  assert.equal(W01.real_user_activation, false); assert.equal(W01.independent_clinical_review, 'NOT_RUN');
  assert.equal(networkCalls, 0);
});

// U1 CODE_OFFLINE: actual domain with synthetic owner/resource inputs, no activation.
const startEpisode = (f) => { const p = proposal(f); assert.equal(f.store.selfWalk.chooseAndStart(f.ref, p, 'u1-start').state, 'STARTED'); return p; };
test('U1 WE01 explicit End commits STOPPED plus private current witness, without outcome/reuse', async () => {
  const f = await fixture(); const p = startEpisode(f);
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref).end, undefined);
  const result = f.store.selfWalk.end(f.ref, p, 'u1-end');
  const episode = f.store.selfWalk.getCurrentEpisode(f.ref);
  assert.equal(result.state, 'STOPPED'); assert.equal(episode.action, result);
  assert.equal(episode.end.kind, 'USER_REPORTED_END'); assert.equal(episode.end.request_id, 'u1-end');
  assert.ok(Object.isFrozen(episode.end)); assert.equal('end' in f.store.selfWalk.getSnapshot(), false);
  for (const name of ['performed','effective','completed','outcome','reuse']) assert.equal(name in result, false);
});
test('U1 WE02 Stop is not End; ordinary Stop permits a fresh explicit End', async () => {
  const f = await fixture(); const p = startEpisode(f);
  assert.equal(f.store.selfWalk.stop(f.ref, p, 'ordinary-stop').state, 'STOPPED');
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref).end, undefined);
  assert.equal(f.store.selfWalk.end(f.ref, p, 'after-stop-end').state, 'STOPPED');
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref).end.request_id, 'after-stop-end');
});
test('U1 WE03 invalidated retained Stop cannot be laundered into current lifecycle', async () => {
  for (const invalidate of [f => f.resource.withdraw(), f => f.store.selfWalk.interrupt(),
    f => f.store.selfWalk.reportContext(f.ref, facts({source_ref:'replacement'}))]) {
    const f = await fixture(); const p = startEpisode(f); invalidate(f);
    assert.equal(f.store.selfWalk.stop(f.ref, p, 'retained-stop').state, 'STOPPED');
    assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref), undefined);
    assert.equal(f.store.selfWalk.end(f.ref, p, 'invalid-end').state, 'DENIED');
  }
});
test('U1 WE04 acceptance and elapsed time never create an End witness', async () => {
  const f = await fixture(); const p = proposal(f);
  assert.equal(f.store.selfWalk.accept(f.ref, p, 'accept-only').state, 'ACCEPTED');
  f.clock.advance(1000);
  assert.equal(f.store.selfWalk.end(f.ref, p, 'not-started').state, 'DENIED');
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref), undefined);
});
test('U1 WE08 exact replay is immutable; cross-operation and fresh End IDs fail', async () => {
  const f = await fixture(); const p = startEpisode(f);
  assert.equal(f.store.selfWalk.end(f.ref, p, 'u1-start').state, 'DENIED');
  f.store.selfWalk.end(f.ref, p, 'original-end');
  const e = f.store.selfWalk.getCurrentEpisode(f.ref).end;
  f.clock.advance(100);
  assert.equal(f.store.selfWalk.end(f.ref, p, 'original-end').state, 'STOPPED');
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref).end, e);
  assert.equal(f.store.selfWalk.end(f.ref, p, 'refresh-end').state, 'DENIED');
  assert.equal(f.store.selfWalk.stop(f.ref, p, 'original-end').state, 'DENIED');
});
async function filledEpisode(proposals) {
  const f=await fixture(); let p;
  for(let i=0;i<proposals;i++) { assert.equal(f.store.selfWalk.reportContext(f.ref,facts({source_ref:'fill-'+i})),true); p=f.store.selfWalk.propose(f.ref,'p-'+i); assert.equal(p.state,'PROPOSED'); }
  assert.equal(f.store.selfWalk.chooseAndStart(f.ref,p,'fill-start').state,'STARTED'); return {f,p};
}
test('U1 WE09 full map denies new End without blocking independent reducing Stop', async () => {
  const {f,p}=await filledEpisode(127);
  assert.equal(f.store.selfWalk.end(f.ref,p,'overflow-end').state,'DENIED');
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref).end,undefined);
  assert.equal(f.store.selfWalk.stop(f.ref,p,'capacity-stop').state,'STOPPED');
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref).end,undefined);
});
test('U1 WE09 original End replay succeeds at full capacity without refreshing E', async () => {
  const {f,p}=await filledEpisode(126);
  assert.equal(f.store.selfWalk.end(f.ref,p,'last-slot-end').state,'STOPPED');
  const e=f.store.selfWalk.getCurrentEpisode(f.ref).end;
  assert.equal(f.store.selfWalk.end(f.ref,p,'last-slot-end').state,'STOPPED');
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref).end,e);
  assert.equal(f.store.selfWalk.end(f.ref,p,'one-more-end').state,'DENIED');
});
test('U1 WE07 revoke during owner transaction cannot publish half End state', async () => {
  let armed=false; let f;
  f=await fixture({beforeApply:()=>{if(armed){armed=false;f.boundary.control.invalidateCurrentSession();}}});
  const p=startEpisode(f); armed=true;
  assert.equal(f.store.selfWalk.end(f.ref,p,'reentrant-end').state,'DENIED');
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref),undefined);
  assert.equal(f.store.selfWalk.getSnapshot().state,'UNAVAILABLE');
});
test('U1 WE05/06/10 withdrawn, switched or retired End never reappears', async () => {
  for (const invalidate of [f=>f.resource.withdraw(),f=>f.store.selfWalk.interrupt(),f=>f.boundary.control.invalidateCurrentSession()]) {
    const f=await fixture();const p=startEpisode(f);f.store.selfWalk.end(f.ref,p,'end');invalidate(f);
    assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref),undefined);
    assert.equal(f.store.selfWalk.end(f.ref,p,'end').state,'DENIED');
  }
  const f=await fixture();const p=startEpisode(f);f.store.selfWalk.end(f.ref,p,'end');
  f.store.submit('Another goal',{permission_granted:true});await tick();
  f.store.switchTask(f.store.reference(f.task));
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.store.reference(f.task)),undefined);
  assert.equal(f.store.selfWalk.end(f.ref,p,'end').state,'DENIED');
});

test('U1 WE08 prior proposal End ID cannot replay into a newly started episode',async()=>{
  const f=await fixture();const old=startEpisode(f);assert.equal(f.store.selfWalk.end(f.ref,old,'prior-end').state,'STOPPED');
  assert.equal(f.store.selfWalk.reportContext(f.ref,facts({source_ref:'next-context'})),true);
  const next=f.store.selfWalk.propose(f.ref,'next-proposal');assert.equal(next.state,'PROPOSED');
  assert.equal(f.store.selfWalk.chooseAndStart(f.ref,next,'next-start').state,'STARTED');
  assert.equal(f.store.selfWalk.end(f.ref,old,'prior-end').state,'DENIED');
  assert.equal(f.store.selfWalk.end(f.ref,next,'prior-end').state,'DENIED');
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref).end,undefined);
  assert.equal(f.store.selfWalk.end(f.ref,next,'next-end').state,'STOPPED');
});

// U2 CODE_OFFLINE Start seam: no activation dependency is added to lawful M6.
// QA11 tests extend the accepted d0 corpus without altering its assertions.
test('QA11 T07 Stop-before-first-Start reads regrant End cannot mint intake; later real Start positive', async () => {
  const { createLocalM7PurposeAuthority } = await import('../domain/m7/outcome.ts');
  const purpose = createLocalM7PurposeAuthority(); purpose.control.bindRecordingScope(() => true);
  const f = await fixture({ m7Purpose: purpose.access }), p = proposal(f);
  assert.equal(f.store.selfWalk.stop(f.ref, p, 'qa-pre-stop').state, 'DENIED');
  for (let i=0;i<3;i++) {
    f.store.selfWalk.getSnapshot(); f.store.selfWalk.getEpisode(f.ref); f.store.selfWalk.getCurrentEpisode(f.ref);
    const r=purpose.control.grant('RECORD_OUTCOME');
    assert.equal(f.store.selfWalk.end(f.ref,p,'qa-pre-end-'+i).state,'DENIED');
    assert.equal(f.store.m7Outcome.getActivityVersion(),0);
    assert.equal(f.store.m7Outcome.reportFeedback(f.ref,r,{request_id:'qa-pre-f-'+i,experience:'VERY_GOOD',locale:'vi',displayed_label:'Rất ổn'}).state,'DENIED');
  }
  assert.equal(f.store.selfWalk.chooseAndStart(f.ref,p,'qa-real-start').state,'STARTED');
  assert.equal(f.store.m7Outcome.getActivityVersion(),1);
  assert.equal(f.store.selfWalk.stop(f.ref,p,'qa-real-stop').state,'STOPPED');
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref).end,undefined);
  assert.equal(f.store.selfWalk.end(f.ref,p,'qa-real-end').state,'STOPPED');
  assert.equal(f.store.m7Outcome.canRecord(f.ref,'F'),true);
});

for (const shape of ['shallow','deep','json','generation','owner','lease','task','revision','source','start','episode']) {
  test('QA11 T09 copied proposal/ref/episode denied '+shape+' with genuine positive', async () => {
    const f=await fixture(),p=proposal(f);
    const clone=x=>shape==='deep'?structuredClone(x):shape==='json'?JSON.parse(JSON.stringify(x)):{...x};
    const fake=clone(p);
    const fields={generation:999,owner:'other',lease:{},task_id:'other',revision:999,source_revision:999,start:{kind:'USER_REPORTED_START'}};
    if(shape in fields)fake[shape]=fields[shape];
    if(shape==='task')fake.task_id='other';
    if(shape==='source')fake.source_revision=999;
    assert.equal(f.store.selfWalk.chooseAndStart(f.ref,fake,'qa-copy-start').state,'DENIED');
    const copiedRef=clone(f.ref);if(shape==='task')copiedRef.task_id='other';if(shape==='revision')copiedRef.revision=999;
    assert.equal(f.store.selfWalk.chooseAndStart(copiedRef,p,'qa-copy-ref').state,'DENIED');
    assert.equal(f.store.selfWalk.chooseAndStart(f.ref,p,'qa-real').state,'STARTED');
    const episode=f.store.selfWalk.getCurrentEpisode(f.ref);assert.ok(episode);
    assert.equal(f.store.selfWalk.end(f.ref,clone(episode),'qa-copy-episode-end').state,'DENIED');
    assert.equal(f.store.selfWalk.end(f.ref,clone(p),'qa-copy-proposal-end').state,'DENIED');
    assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref).end,undefined);
    assert.equal(f.store.selfWalk.end(f.ref,p,'qa-current-end').state,'STOPPED');
    assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref).end.kind,'USER_REPORTED_END');
  });
}

test('QA11 T09 actual foreign same-ID task references and owner-generation replacement are not authority', async () => {
  const a=await fixture(),b=await fixture(),p=proposal(a);
  assert.equal(a.store.selfWalk.chooseAndStart(b.ref,p,'foreign-actual-ref').state,'DENIED');
  a.authority.results.push({status:'verified',owner:OWNER_B,validUntil:100000});
  const lb=await a.boundary.control.verifySession();a.boundary.control.finishHydration(lb);
  a.authority.results.push({status:'verified',owner:OWNER_A,validUntil:100000});
  const la=await a.boundary.control.verifySession();a.boundary.control.finishHydration(la);
  assert.notEqual(la,a.lease);
  assert.equal(a.store.selfWalk.chooseAndStart(a.ref,p,'old-generation').state,'DENIED');
  const fresh=await fixture(),fp=proposal(fresh);
  assert.equal(fresh.store.selfWalk.chooseAndStart(fresh.ref,fp,'fresh-current').state,'STARTED');
});

test('U2-E01 missing recording activation permits genuine Start Stop End without intake', async () => {
  const { createLocalM7PurposeAuthority } = await import('../domain/m7/outcome.ts');
  const purpose = createLocalM7PurposeAuthority(); const f = await fixture({ m7Purpose: purpose.access });
  const p = proposal(f); const receipt = purpose.control.grant('RECORD_OUTCOME');
  assert.equal(f.store.selfWalk.chooseAndStart(f.ref, p, 'real-start').state, 'STARTED');
  assert.equal(f.store.m7Outcome.canRecord(f.ref, 'R'), false);
  assert.equal(f.store.selfWalk.stop(f.ref, p, 'real-stop').state, 'STOPPED');
  assert.equal(f.store.selfWalk.end(f.ref, p, 'real-end').state, 'STOPPED');
  assert.ok(f.store.selfWalk.getCurrentEpisode(f.ref).end);
  assert.equal(f.store.m7Outcome.reportFeedback(f.ref, receipt,
    { request_id: 'f', experience: 'VERY_GOOD', locale: 'vi', displayed_label: 'Rất ổn' }).state, 'DENIED');
});

test('U2-E13 late scope installation, regrant, getters, repeated Start, Stop and End never mint missed intake', async () => {
  const { createLocalM7PurposeAuthority } = await import('../domain/m7/outcome.ts');
  const purpose = createLocalM7PurposeAuthority(); const f = await fixture({ m7Purpose: purpose.access });
  const p = proposal(f);
  assert.equal(f.store.selfWalk.chooseAndStart(f.ref, p, 'start-before-activation').state, 'STARTED');
  assert.equal(purpose.control.bindRecordingScope(() => true), true);
  const r = purpose.control.grant('RECORD_OUTCOME');
  assert.equal(f.store.selfWalk.chooseAndStart(f.ref, p, 'start-before-activation').state, 'STARTED');
  f.store.selfWalk.getEpisode(f.ref); f.store.selfWalk.getCurrentEpisode(f.ref);
  assert.equal(f.store.selfWalk.stop(f.ref, p, 'stop').state, 'STOPPED');
  assert.equal(f.store.selfWalk.end(f.ref, p, 'end').state, 'STOPPED');
  assert.equal(f.store.m7Outcome.canRecord(f.ref, 'R'), false);
  assert.equal(f.store.m7Outcome.canRecord(f.ref, 'F'), false);
  assert.equal(f.store.m7Outcome.getSnapshot(r).state, 'UNKNOWN');
});

test('U2 genuine guarded Start issues one intake before presentation; acceptance/replay never reissues', async () => {
  const { createLocalM7PurposeAuthority } = await import('../domain/m7/outcome.ts');
  const purpose = createLocalM7PurposeAuthority(); purpose.control.bindRecordingScope(() => true);
  const f = await fixture({ m7Purpose: purpose.access }); const p = proposal(f);
  assert.equal(f.store.m7Outcome.getActivityVersion(), 0);
  f.store.selfWalk.accept(f.ref, p, 'accept-u2');
  assert.equal(f.store.m7Outcome.getActivityVersion(), 0);
  assert.equal(f.store.selfWalk.start(f.ref, p, 'start-u2').state, 'STARTED');
  assert.equal(f.store.m7Outcome.getActivityVersion(), 1);
  assert.equal(f.store.m7Outcome.canRecord(f.ref, 'R'), true);
  f.store.selfWalk.start(f.ref, p, 'start-u2');
  f.store.selfWalk.getEpisode(f.ref); f.store.selfWalk.getSnapshot();
  assert.equal(f.store.m7Outcome.getActivityVersion(), 1);
});

test('U2 T10 owner retirement at guarded Start cannot leave a usable private intake', async () => {
  const { createLocalM7PurposeAuthority } = await import('../domain/m7/outcome.ts');
  const purpose = createLocalM7PurposeAuthority(); purpose.control.bindRecordingScope(() => true);
  let armed=false, f;
  f=await fixture({ m7Purpose:purpose.access, beforeApply(){if(armed){armed=false;f.boundary.control.invalidateCurrentSession();}} });
  const p=proposal(f);const receipt=purpose.control.grant('RECORD_OUTCOME');armed=true;
  assert.equal(f.store.selfWalk.chooseAndStart(f.ref,p,'guard-retired').state,'DENIED');
  assert.equal(f.store.m7Outcome.canRecord(f.ref,'R'),false);
  assert.equal(f.store.m7Outcome.reportFeedback(f.ref,receipt,{request_id:'orphan',experience:'VERY_GOOD',locale:'vi',displayed_label:'Rất ổn'}).state,'DENIED');
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref),undefined);
});

test('U2 T10 scope closes during actual Start predicate evaluation; lawful M6 remains but no intake escapes', async () => {
  const { createLocalM7PurposeAuthority } = await import('../domain/m7/outcome.ts');
  const purpose=createLocalM7PurposeAuthority();
  purpose.control.bindRecordingScope(()=>{purpose.control.closeRecordingScope();return true;});
  const f=await fixture({m7Purpose:purpose.access});const p=proposal(f);
  assert.equal(f.store.selfWalk.chooseAndStart(f.ref,p,'scope-closes-start').state,'STARTED');
  assert.equal(f.store.m7Outcome.canRecord(f.ref,'R'),false);
  assert.equal(f.store.selfWalk.end(f.ref,p,'scope-closes-end').state,'STOPPED');
  assert.equal(f.store.m7Outcome.canRecord(f.ref,'F'),false);
});
