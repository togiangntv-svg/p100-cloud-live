import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extname } from 'node:path';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { FakeClock, fakeAuthority, OWNER_A, OWNER_B } from './fixtures/local-owner.mjs';

registerHooks({ resolve(s, c, next) { return next(s.startsWith('.') && !extname(s) ? s + '.ts' : s, c); } });
let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw Error('NETWORK_FORBIDDEN_IN_M7_TEST'); };

const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const { createLocalWalkResource } = await import('../domain/m6/walk-resource.ts');
const { createLocalM7PurposeAuthority } = await import('../domain/m7/outcome.ts');
const { resolveConfirmedWalkMinutes } = await import('../domain/m7/next-cycle.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));

const walkFacts = (changes = {}) => ({
  source_ref: 'walk-context-1', intent: 'SHORT_LIGHT_MOVEMENT', walking_choice: 'WANTS_WALK',
  adult: 'REPORTED_ADULT', mobility: 'INDEPENDENT_COMFORTABLE_WALKING', concerns: 'NONE_REPORTED',
  professional_limits: 'NONE_REPORTED', setting: 'INDOOR_FLAT_CLEAR_LIT_DRY_STOPPABLE',
  competing_activity: 'NONE', footwear: 'FAMILIAR_SECURE', available_minutes: 20,
  requested_minutes: 5, currency: 'CURRENT', ...changes,
});
const report = (changes = {}) => ({
  request_id: 'outcome-1', execution_extent: 'DID', action_change: 'UNCHANGED',
  user_stopped: false, problem_state: 'NO_PROBLEM_REPORTED', safety_disposition: 'CLEAR',
  constraint: 'NONE_REPORTED', occurred_at: 700, ...changes,
});

async function fixture({ grantNext = true, start = true } = {}) {
  const clock = new FakeClock();
  const authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner: OWNER_A, validUntil: 100000 });
  const lease = await boundary.control.verifySession();
  boundary.control.finishHydration(lease);
  const resource = createLocalWalkResource();
  const purpose = createLocalM7PurposeAuthority();
  // CODE_OFFLINE technical-scope fixture; production uses actual controller activation.
  purpose.control.bindRecordingScope(() => { try { boundary.access.requireLease(lease); return true; } catch { return false; } });
  let deferNextInterpretation = false;
  let releaseInterpretation;
  let deferredInterpretations = 0;
  const adapterControl = Object.freeze({
    deferNext: () => { deferNextInterpretation = true; },
    release: () => { releaseInterpretation?.(); },
    pending: () => deferredInterpretations,
  });
  const adapter = { provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    async interpret() {
      if (deferNextInterpretation) {
        deferNextInterpretation = false; deferredInterpretations += 1;
        await new Promise(resolve => { releaseInterpretation = resolve; });
      }
      return { intent_type: 'GOAL', interpreted_meaning: 'Khỏe hơn', confidence: .95,
      uncertainty: null, missing_context: [], clarification_needed: false, clarification_question: null,
      safety_state: 'CLEAR', suggested_next_role: 'M4', task_kind: 'general_health', context_effect: 'NONE',
      used_context_ids: [], response: 'Đã ghi nhận.' };
    }, async revoke() {} };
  const store = createSessionTaskStore({ adapter, now: () => clock.now(),
    ownerSession: { access: boundary.access, lease }, walkResource: resource.access, m7Purpose: purpose.access });
  store.start(); const task = store.submit('Khỏe hơn', { permission_granted: true }); await tick();
  let ref = store.reference(task);
  const m5Receipt = store.acceptM5Goal(ref, store.assessM5Goal(ref, store.assessM4GoalReadiness(ref)));
  ref = store.reference(task);
  store.selfWalk.reportContext(ref, walkFacts());
  const proposal = store.selfWalk.propose(ref, 'proposal-1');
  if (start) store.selfWalk.chooseAndStart(ref, proposal, 'start-1');
  const recordReceipt = purpose.control.grant('RECORD_OUTCOME');
  const nextReceipt = grantNext ? purpose.control.grant('USE_NEXT_CYCLE') : undefined;
  return { store, ref, task, proposal, m5Receipt, recordReceipt, nextReceipt, purpose, resource,
    clock, authority, boundary, lease, adapterControl };
}
const record = (f, input = report()) => f.store.m7Outcome.report(f.ref, f.recordReceipt, input);

async function startFreshEpisodeOnTask(f, suffix) {
  let ref = f.store.reference(f.task);
  assert.equal(f.store.setM3Permission(ref, true), true);
  await tick(); await tick();
  ref = f.store.reference(f.task);
  const choice = f.store.acceptM5Goal(ref,
    f.store.assessM5Goal(ref, f.store.assessM4GoalReadiness(ref)));
  assert.ok(choice);
  ref = f.store.reference(f.task);
  assert.equal(f.store.selfWalk.reportContext(ref, walkFacts({ source_ref: `walk-context-${suffix}` })), true);
  const proposal = f.store.selfWalk.propose(ref, `proposal-${suffix}`);
  assert.equal(proposal.state, 'PROPOSED');
  assert.equal(f.store.selfWalk.chooseAndStart(ref, proposal, `start-${suffix}`).state, 'STARTED');
  return ref;
}

test('01 STARTED alone remains UNKNOWN and never DID', async () => {
  const f = await fixture();
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt).state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.readNextCycle(f.nextReceipt), undefined);
  assert.equal(f.store.selfWalk.getSnapshot().state, 'STARTED');
});
test('02 full W01 report records DID with USER_REPORT provenance', async () => {
  const f = await fixture(); const result = record(f);
  assert.equal(result.outcome.execution_extent, 'DID');
  assert.equal(result.evidence.source, 'USER_REPORT');
  assert.equal(result.episode.action_id, 'trainer.self.walk-easy.v0_1');
  assert.equal(result.evidence.task_revision, result.episode.task_revision);
  assert.equal(result.evidence.proposal_revision, result.episode.proposal_revision);
  assert.equal(result.evidence.source_revision, result.episode.source_revision);
});
test('03 3/5 due time is PARTIAL with a narrow time constraint', async () => {
  const f = await fixture(); record(f, report({ execution_extent: 'PARTIAL', performed_minutes: 3,
    constraint: 'TIME_CONSTRAINT' }));
  const fragment = f.store.m7Outcome.readNextCycle(f.nextReceipt);
  assert.equal(fragment.reported_constraint.kind, 'PRIOR_EPISODE_TIME_CONSTRAINT');
  assert.equal(fragment.requires_reconfirmation.includes('CURRENT_TIME_AVAILABLE'), true);
});
test('04 SKIPPED creates no guilt or progression fields', async () => {
  const f = await fixture(); const result = record(f, report({ execution_extent: 'SKIPPED' }));
  for (const field of ['streak', 'guilt', 'punishment', 'progression']) assert.equal(field in result, false);
});
test('05 PARTIAL and USER_STOPPED coexist', async () => {
  const f = await fixture(); const result = record(f, report({ execution_extent: 'PARTIAL', user_stopped: true }));
  assert.equal(result.outcome.execution_extent, 'PARTIAL'); assert.equal(result.outcome.user_stopped, true);
});
test('06 CHANGED and PARTIAL coexist', async () => {
  const f = await fixture(); const result = record(f, report({ execution_extent: 'PARTIAL', action_change: 'CHANGED' }));
  assert.equal(result.outcome.execution_extent, 'PARTIAL'); assert.equal(result.outcome.action_change, 'CHANGED');
});
test('07 DID and PROBLEM coexist', async () => {
  const f = await fixture(); const result = record(f, report({ problem_state: 'PROBLEM', safety_disposition: 'REASSESS' }));
  assert.equal(result.outcome.execution_extent, 'DID'); assert.equal(result.outcome.problem_state, 'PROBLEM');
});
test('08 PARTIAL and PROBLEM coexist', async () => {
  const f = await fixture(); const result = record(f, report({ execution_extent: 'PARTIAL', problem_state: 'PROBLEM', safety_disposition: 'REASSESS' }));
  assert.equal(result.outcome.execution_extent, 'PARTIAL'); assert.equal(result.outcome.problem_state, 'PROBLEM');
});
test('09 structured acute problem creates safety hold and retires guidance authority', async () => {
  const f = await fixture(); record(f, report({ problem_state: 'PROBLEM', safety_disposition: 'REASSESS' }));
  const fragment = f.store.m7Outcome.readNextCycle(f.nextReceipt);
  assert.equal(fragment.state, 'SAFETY_HOLD'); assert.equal(f.store.selfWalk.getSnapshot().state, 'INVALIDATED');
});
test('10 structured urgent state creates urgent-help semantics', async () => {
  const f = await fixture(); record(f, report({ problem_state: 'PROBLEM', safety_disposition: 'URGENT_HELP' }));
  assert.equal(f.store.m7Outcome.readNextCycle(f.nextReceipt).state, 'URGENT_HELP');
});
test('11 M7 has no symptom keyword parser', async () => {
  const f = await fixture();
  const result = record(f, report({ evidence_text: 'đầu gối đau nhưng không được parser đọc' }));
  assert.equal(result.outcome.problem_state, 'NO_PROBLEM_REPORTED');
});
test('12 missing wearable cannot alter a user report', async () => {
  const f = await fixture(); const result = record(f, report({ wearable: undefined }));
  assert.equal(result.outcome.execution_extent, 'DID'); assert.equal(result.evidence.source, 'USER_REPORT');
});
test('13 correction supersedes old revision', async () => {
  const f = await fixture(); const first = record(f);
  f.store.submit('Vòng kế tiếp', { permission_granted: true }); await tick();
  const priorEpisodeRef = f.store.reference(f.task);
  const corrected = f.store.m7Outcome.correct(priorEpisodeRef, f.recordReceipt, first.revision,
    report({ request_id: 'correct-1', execution_extent: 'PARTIAL' }));
  assert.equal(f.store.m7Outcome.correct(priorEpisodeRef, f.recordReceipt, first.revision,
    report({ request_id: 'correct-1', execution_extent: 'PARTIAL' })), corrected);
  assert.equal(corrected.supersedes_revision, first.revision);
  assert.equal(f.store.m7Outcome.getRevision(first.revision, f.recordReceipt).state, 'SUPERSEDED');
});
test('14 time-to-pain correction removes time adaptation and prioritizes safety', async () => {
  const f = await fixture(); const first = record(f, report({ execution_extent: 'PARTIAL', constraint: 'TIME_CONSTRAINT' }));
  f.store.m7Outcome.correct(f.ref, f.recordReceipt, first.revision,
    report({ request_id: 'pain-correction', execution_extent: 'PARTIAL', constraint: 'NONE_REPORTED',
      problem_state: 'PROBLEM', safety_disposition: 'REASSESS' }));
  const fragment = f.store.m7Outcome.readNextCycle(f.nextReceipt);
  assert.equal(fragment.state, 'SAFETY_HOLD'); assert.equal(fragment.reported_constraint, undefined);
});
test('15 retraction removes next-cycle use', async () => {
  const f = await fixture(); const first = record(f);
  assert.equal(f.store.m7Outcome.retract(f.ref, f.recordReceipt, first.revision, 'retract-1').state, 'RETRACTED');
  assert.equal(f.store.m7Outcome.readNextCycle(f.nextReceipt), undefined);
});
test('15a M3 revoke does not erase an already recorded ACTIVE outcome', async () => {
  const f = await fixture(); const first = record(f);
  assert.equal(await f.store.revoke(f.ref), true);
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt), first);
  assert.equal(f.store.m7Outcome.getRevision(first.revision, f.recordReceipt), first);
  assert.equal(f.store.getSnapshot().tasks[0].permission_granted, false);
});
test('15b M3 revoke preserves RETRACTED lineage and explicit delete authority', async () => {
  const f = await fixture(); const first = record(f);
  const retracted = f.store.m7Outcome.retract(f.ref, f.recordReceipt, first.revision, 'retract-before-m3-revoke');
  assert.equal(retracted.state, 'RETRACTED');
  assert.equal(await f.store.revoke(f.ref), true);
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt), retracted);
  assert.equal(f.store.m7Outcome.getRevision(first.revision, f.recordReceipt).state, 'SUPERSEDED');
  assert.equal(f.store.m7Outcome.getRevision(retracted.revision, f.recordReceipt), retracted);
  assert.equal(f.store.m7Outcome.delete(f.ref, f.recordReceipt, retracted.revision,
    'delete-retracted-after-m3-revoke').state, 'UNKNOWN');
});
test('15c setM3Permission(false) preserves the local outcome but clears external permission', async () => {
  const f = await fixture(); const first = record(f);
  assert.equal(f.store.setM3Permission(f.ref, false), true);
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt), first);
  assert.equal(f.store.m7Outcome.getRevision(first.revision, f.recordReceipt), first);
  const task = f.store.getSnapshot().tasks[0];
  assert.equal(task.permission_granted, false);
  assert.equal(task.interpretation, undefined);
});
test('15d granting M3 again preserves provenance without reviving M5 or M6 authority', async () => {
  const f = await fixture(); const first = record(f);
  const provenance = first.evidence;
  assert.equal(await f.store.revoke(f.ref), true);
  let current = f.store.reference(f.task);
  assert.equal(f.store.setM3Permission(current, true), true);
  await tick(); await tick();
  current = f.store.reference(f.task);
  const retained = f.store.m7Outcome.getSnapshot(f.recordReceipt);
  assert.equal(retained, first);
  assert.equal(retained.evidence, provenance);
  assert.equal(f.store.getM5GoalChoiceReceipt(current), undefined);
  assert.equal(f.store.resolveM6GoalAction(current, f.m5Receipt, {
    available_time_minutes: 5, current_constraints: 'NONE_REPORTED',
  }), undefined);
});
test('15e M3 revoke rejects a late pending result without erasing the existing outcome', async () => {
  const f = await fixture(); const first = record(f);
  assert.equal(await f.store.revoke(f.ref), true);
  let current = f.store.reference(f.task);
  f.adapterControl.deferNext();
  assert.equal(f.store.setM3Permission(current, true), true);
  await tick();
  assert.equal(f.adapterControl.pending(), 1);
  current = f.store.reference(f.task);
  assert.equal(await f.store.revoke(current), true);
  f.adapterControl.release();
  await tick(); await tick();
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt), first);
  const task = f.store.getSnapshot().tasks[0];
  assert.equal(task.permission_granted, false);
  assert.equal(task.status, 'PAUSED');
  assert.equal(task.interpretation, undefined);
});
test('15f permission-only retention never authorizes a new stale outcome report', async () => {
  const f = await fixture();
  assert.equal(await f.store.revoke(f.ref), true);
  assert.equal(record(f).state, 'DENIED');
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt).state, 'UNKNOWN');
});
test('15g DELETE releases M3 retention before a fresh same-task episode', async () => {
  const f = await fixture(); const first = record(f);
  assert.equal(await f.store.revoke(f.ref), true);
  assert.equal(f.store.m7Outcome.delete(f.ref, f.recordReceipt, first.revision,
    'delete-before-fresh-episode').state, 'UNKNOWN');
  const freshRef = await startFreshEpisodeOnTask(f, 'after-delete');
  const freshReceipt = f.purpose.control.grant('RECORD_OUTCOME');
  const fresh = f.store.m7Outcome.report(freshRef, freshReceipt,
    report({ request_id: 'outcome-after-delete' }));
  assert.equal(fresh.state, 'ACTIVE');
  assert.notEqual(fresh.episode.episode_key, first.episode.episode_key);
  assert.equal(await f.store.revoke(freshRef), true);
  assert.equal(f.store.m7Outcome.getSnapshot(freshReceipt), fresh);
});
test('15h RECORD_OUTCOME revoke releases M3 retention before a fresh episode', async () => {
  const f = await fixture(); const first = record(f);
  assert.equal(await f.store.revoke(f.ref), true);
  f.purpose.control.revoke('RECORD_OUTCOME');
  const freshReceipt = f.purpose.control.grant('RECORD_OUTCOME');
  assert.equal(f.store.m7Outcome.getSnapshot(freshReceipt).state, 'UNKNOWN');
  const freshRef = await startFreshEpisodeOnTask(f, 'after-record-revoke');
  const fresh = f.store.m7Outcome.report(freshRef, freshReceipt,
    report({ request_id: 'outcome-after-record-revoke' }));
  assert.equal(fresh.state, 'ACTIVE');
  assert.notEqual(fresh.episode.episode_key, first.episode.episode_key);
  assert.equal(await f.store.revoke(freshRef), true);
  assert.equal(f.store.m7Outcome.getSnapshot(freshReceipt), fresh);
});
test('15i correction and USE_NEXT_CYCLE revoke preserve same-episode M3 retention', async () => {
  const f = await fixture(); const first = record(f);
  assert.equal(await f.store.revoke(f.ref), true);
  const corrected = f.store.m7Outcome.correct(f.ref, f.recordReceipt, first.revision,
    report({ request_id: 'correction-while-m3-revoked', execution_extent: 'PARTIAL' }));
  assert.equal(corrected.state, 'ACTIVE');
  assert.equal(corrected.episode.episode_key, first.episode.episode_key);
  f.purpose.control.revoke('USE_NEXT_CYCLE');
  assert.equal(f.store.m7Outcome.readNextCycle(f.nextReceipt), undefined);
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt), corrected);
  let current = f.store.reference(f.task);
  assert.equal(f.store.setM3Permission(current, true), true);
  await tick(); await tick();
  current = f.store.reference(f.task);
  assert.equal(await f.store.revoke(current), true);
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt), corrected);
});
test('15j real task cancel releases M3 retention and invalidates the retained outcome', async () => {
  const f = await fixture(); const first = record(f);
  assert.equal(await f.store.revoke(f.ref), true);
  const current = f.store.reference(f.task);
  assert.equal(f.store.cancel(current), true);
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt).state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.getRevision(first.revision, f.recordReceipt), undefined);
});
test('16 delete and RECORD_OUTCOME revoke clear private RAM and fragments', async () => {
  for (const mode of ['delete', 'revoke']) {
    const f = await fixture(); const first = record(f, report({ evidence_text: 'private' }));
    if (mode === 'delete') f.store.m7Outcome.delete(f.ref, f.recordReceipt, first.revision, 'delete-1');
    else f.purpose.control.revoke('RECORD_OUTCOME');
    // U2 full deletion now settles exact purpose reduction before ACK.
    assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt).state, 'DENIED');
    const inspectionReceipt = f.purpose.control.grant('RECORD_OUTCOME');
    assert.equal(f.store.m7Outcome.getSnapshot(inspectionReceipt).state, 'UNKNOWN');
    assert.equal(f.store.m7Outcome.getRevision(first.revision, inspectionReceipt), undefined);
    assert.equal(f.store.m7Outcome.readNextCycle(f.nextReceipt), undefined);
    assert.equal(record(f, report({ request_id: `late-${mode}` })).state, 'DENIED');
  }
});
test('16a REPORT -> DELETE clears the current outcome and its retained revision', async () => {
  const f = await fixture(); const first = record(f, report({ evidence_text: 'private-report' }));
  assert.equal(f.store.m7Outcome.delete(f.ref, f.recordReceipt, first.revision, 'delete-report').state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt).state, 'DENIED');
  // A fresh explicit receipt can inspect emptiness, but cannot reopen erased intake.
  assert.equal(f.store.m7Outcome.getSnapshot(f.purpose.control.grant('RECORD_OUTCOME')).state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.getRevision(first.revision, f.recordReceipt), undefined);
  assert.equal(f.store.m7Outcome.readNextCycle(f.nextReceipt), undefined);
});
test('16b REPORT -> RETRACT -> DELETE clears both revisions and dependent next-cycle state', async () => {
  const f = await fixture(); const first = record(f, report({ evidence_text: 'private-retracted-report' }));
  const retracted = f.store.m7Outcome.retract(f.ref, f.recordReceipt, first.revision, 'retract-delete');
  assert.equal(retracted.state, 'RETRACTED');
  assert.equal(f.store.m7Outcome.delete(f.ref, f.recordReceipt, retracted.revision, 'delete-retracted').state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt).state, 'DENIED');
  // A fresh explicit receipt can inspect emptiness, but cannot reopen erased intake.
  assert.equal(f.store.m7Outcome.getSnapshot(f.purpose.control.grant('RECORD_OUTCOME')).state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.getRevision(first.revision, f.recordReceipt), undefined);
  assert.equal(f.store.m7Outcome.getRevision(retracted.revision, f.recordReceipt), undefined);
  assert.equal(f.store.m7Outcome.readNextCycle(f.nextReceipt), undefined);
});
test('16c duplicate delete fails closed and cannot resurrect deleted data', async () => {
  const f = await fixture(); const first = record(f);
  assert.equal(f.store.m7Outcome.delete(f.ref, f.recordReceipt, first.revision, 'delete-once').state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.delete(f.ref, f.recordReceipt, first.revision, 'delete-once').state, 'DENIED');
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt).state, 'DENIED');
  // A fresh explicit receipt can inspect emptiness, but cannot reopen erased intake.
  assert.equal(f.store.m7Outcome.getSnapshot(f.purpose.control.grant('RECORD_OUTCOME')).state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.readNextCycle(f.nextReceipt), undefined);
});
test('16d replayed report, correction and retraction requests cannot recover a deleted lineage', async () => {
  const f = await fixture(); const originalInput = report({ evidence_text: 'private-lineage' });
  const first = record(f, originalInput);
  const correctionInput = report({ request_id: 'correct-before-delete', execution_extent: 'PARTIAL' });
  const corrected = f.store.m7Outcome.correct(f.ref, f.recordReceipt, first.revision, correctionInput);
  const retracted = f.store.m7Outcome.retract(f.ref, f.recordReceipt, corrected.revision, 'retract-before-delete');
  assert.equal(f.store.m7Outcome.delete(f.ref, f.recordReceipt, retracted.revision, 'delete-lineage').state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.report(f.ref, f.recordReceipt, originalInput).state, 'DENIED');
  assert.equal(f.store.m7Outcome.correct(f.ref, f.recordReceipt, first.revision, correctionInput).state, 'DENIED');
  assert.equal(f.store.m7Outcome.retract(f.ref, f.recordReceipt, corrected.revision,
    'retract-before-delete').state, 'DENIED');
  for (const revision of [first.revision, corrected.revision, retracted.revision]) {
    assert.equal(f.store.m7Outcome.getRevision(revision, f.recordReceipt), undefined);
  }
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt).state, 'DENIED');
  // A fresh explicit receipt can inspect emptiness, but cannot reopen erased intake.
  assert.equal(f.store.m7Outcome.getSnapshot(f.purpose.control.grant('RECORD_OUTCOME')).state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.readNextCycle(f.nextReceipt), undefined);
});
test('16e delete requires the current episode task, revision and RECORD_OUTCOME receipt', async () => {
  const f = await fixture(); const first = record(f);
  const wrongTask = Object.freeze({ ...f.ref, task_id: 'wrong-task' });
  const forgedReceipt = Object.freeze({ purpose: 'RECORD_OUTCOME', revision: f.recordReceipt.revision });
  assert.equal(f.store.m7Outcome.delete(wrongTask, f.recordReceipt, first.revision, 'delete-wrong-task').state, 'DENIED');
  assert.equal(f.store.m7Outcome.delete(f.ref, forgedReceipt, first.revision, 'delete-forged-purpose').state, 'DENIED');
  assert.equal(f.store.m7Outcome.delete(f.ref, f.recordReceipt, first.revision + 1, 'delete-wrong-revision').state, 'DENIED');
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt), first);
});
test('16f stale RECORD_OUTCOME authority cannot delete or retain the old payload', async () => {
  const f = await fixture(); const first = record(f, report({ evidence_text: 'stale-purpose-private' }));
  const staleReceipt = f.recordReceipt;
  const currentReceipt = f.purpose.control.grant('RECORD_OUTCOME');
  assert.equal(f.store.m7Outcome.delete(f.ref, staleReceipt, first.revision, 'delete-stale-purpose').state, 'DENIED');
  assert.equal(f.store.m7Outcome.getSnapshot(currentReceipt).state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.getRevision(first.revision, currentReceipt), undefined);
});
test('16g wrong owner generation cannot delete and retires private RAM', async () => {
  const f = await fixture(); const first = record(f, report({ evidence_text: 'owner-private' }));
  f.authority.results.push({ status: 'verified', owner: OWNER_B, validUntil: 200000 });
  const next = await f.boundary.control.verifySession(); f.boundary.control.finishHydration(next);
  assert.equal(f.store.m7Outcome.delete(f.ref, f.recordReceipt, first.revision, 'delete-wrong-owner').state, 'DENIED');
  assert.equal(f.store.m7Outcome.getRevision(first.revision, f.recordReceipt), undefined);
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt).state, 'UNAVAILABLE');
});
test('16h silent lease expiry blocks delete/read and retires private RAM', async () => {
  const f = await fixture(); const first = record(f, report({ evidence_text: 'expired-lease-private' }));
  f.clock.jumpWithoutTimers(100_000);
  assert.equal(f.store.m7Outcome.delete(f.ref, f.recordReceipt, first.revision, 'delete-expired').state, 'DENIED');
  assert.equal(f.store.m7Outcome.getRevision(first.revision, f.recordReceipt), undefined);
  assert.equal(f.store.m7Outcome.readNextCycle(f.nextReceipt), undefined);
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt).state, 'UNAVAILABLE');
});
test('17 real task edit keeps stale report, correction and start fail-closed', async () => {
  const f = await fixture(); const first = record(f); f.store.edit(f.ref, 'Khỏe hơn nữa');
  assert.equal(record(f).state, 'DENIED');
  assert.equal(f.store.m7Outcome.correct(f.ref, f.recordReceipt, first.revision,
    report({ request_id: 'stale-correction-after-edit' })).state, 'DENIED');
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt).state, 'UNKNOWN');
  const notStarted = await fixture({ start: false });
  notStarted.store.edit(notStarted.ref, 'Khỏe hơn sau khi đổi task');
  assert.equal(notStarted.store.selfWalk.chooseAndStart(notStarted.ref, notStarted.proposal,
    'stale-start-after-edit').state, 'DENIED');
});
test('18 owner/generation change retires M7 state', async () => {
  const f = await fixture(); record(f);
  f.authority.results.push({ status: 'verified', owner: OWNER_B, validUntil: 200000 });
  const next = await f.boundary.control.verifySession(); f.boundary.control.finishHydration(next);
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt).state, 'UNAVAILABLE');
});
test('18a direct revision read after silent lease expiry fails closed and retires private RAM', async () => {
  const f = await fixture(); const first = record(f, report({ evidence_text: 'private-owner-data' }));
  assert.equal(f.store.m7Outcome.getRevision(first.revision, f.recordReceipt), first);
  f.clock.jumpWithoutTimers(100_000);
  assert.equal(f.store.m7Outcome.getRevision(first.revision, f.recordReceipt), undefined);
  assert.equal(f.store.m7Outcome.getRevision(first.revision, f.recordReceipt), undefined);
  assert.equal(f.store.m7Outcome.readNextCycle(f.nextReceipt), undefined);
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt).state, 'UNAVAILABLE');
});
test('18b invalidated owner generation cannot read a private revision', async () => {
  const f = await fixture(); const first = record(f);
  f.boundary.control.invalidateCurrentSession();
  assert.equal(f.store.m7Outcome.getRevision(first.revision, f.recordReceipt), undefined);
  assert.equal(f.store.m7Outcome.readNextCycle(f.nextReceipt), undefined);
});
test('18c current READY owner and current RECORD_OUTCOME receipt can read its revision', async () => {
  const f = await fixture(); const first = record(f);
  assert.equal(f.store.m7Outcome.getRevision(first.revision, f.recordReceipt), first);
});
test('19 purpose A without purpose B stores outcome but exposes no fragment', async () => {
  const f = await fixture({ grantNext: false });
  assert.equal(f.store.m7Outcome.report(f.ref, { purpose: 'RECORD_OUTCOME', revision: 1 },
    report({ request_id: 'forged' })).state, 'DENIED');
  assert.equal(record(f).state, 'ACTIVE');
  assert.equal(f.store.m7Outcome.readNextCycle(undefined), undefined);
});
test('20 revoking next-cycle purpose hides fragment immediately but preserves outcome', async () => {
  const f = await fixture(); record(f); f.purpose.control.revoke('USE_NEXT_CYCLE');
  assert.equal(f.store.m7Outcome.readNextCycle(f.nextReceipt), undefined);
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt).state, 'ACTIVE');
});
test('21 duplicate request is idempotent', async () => {
  const f = await fixture(); const input = report(); const first = record(f, input);
  assert.equal(record(f, input), first);
});
test('22 same request ID with different payload fails closed', async () => {
  const f = await fixture(); record(f, report());
  assert.equal(record(f, report({ execution_extent: 'SKIPPED' })).state, 'DENIED');
});
test('23 W01 withdrawn before start blocks any episode/outcome authority', async () => {
  const f = await fixture({ start: false }); f.resource.withdraw();
  assert.equal(record(f).state, 'DENIED');
});
test('24 W01 withdrawn after episode still permits authorized history report', async () => {
  const f = await fixture(); f.resource.withdraw(); const result = record(f, report({ problem_state: 'PROBLEM', safety_disposition: 'REASSESS' }));
  assert.equal(result.state, 'ACTIVE'); assert.equal(result.outcome.problem_state, 'PROBLEM');
});
test('25 restart restores no outcome or learning', async () => {
  const f = await fixture(); record(f); f.store.stop(); const fresh = await fixture();
  assert.equal(fresh.store.m7Outcome.getSnapshot(fresh.recordReceipt).state, 'UNKNOWN');
});
test('26 locale/presentation fields do not change semantic outcome', async () => {
  const a = await fixture(); const b = await fixture();
  const x = record(a, report({ locale: 'vi' })); const y = record(b, report({ locale: 'en', presentation_preference: 'compact' }));
  assert.deepEqual(x.outcome, y.outcome);
});
test('27 prior 3/5 report does not prescribe three minutes next cycle', async () => {
  const f = await fixture(); record(f, report({ execution_extent: 'PARTIAL', performed_minutes: 3,
    constraint: 'TIME_CONSTRAINT' }));
  const fragment = f.store.m7Outcome.readNextCycle(f.nextReceipt);
  assert.equal(resolveConfirmedWalkMinutes(fragment, {}), undefined);
  assert.equal('prescribed_minutes' in fragment, false);
});
test('28 current-cycle confirmation can supply current available minutes', async () => {
  const f = await fixture(); record(f, report({ execution_extent: 'PARTIAL', performed_minutes: 3,
    constraint: 'TIME_CONSTRAINT' }));
  const fragment = f.store.m7Outcome.readNextCycle(f.nextReceipt);
  assert.equal(resolveConfirmedWalkMinutes(fragment, { available_minutes: 3, confirmed_current: true }), 3);
  const nextTask = f.store.submit('Khỏe hơn', { permission_granted: true }); await tick();
  let nextRef = f.store.reference(nextTask);
  f.store.acceptM5Goal(nextRef, f.store.assessM5Goal(nextRef, f.store.assessM4GoalReadiness(nextRef)));
  nextRef = f.store.reference(nextTask);
  assert.equal(f.store.selfWalk.reportContext(nextRef, walkFacts({ available_minutes: 3, requested_minutes: 3 })), true);
  assert.equal(f.store.selfWalk.propose(nextRef, 'proposal-cycle-2').duration_minutes, 3);
});
test('29 one episode creates no durable trait or learning claim', async () => {
  const f = await fixture(); const result = record(f);
  for (const field of ['trait', 'fitness_level', 'habit_score', 'optimal_duration', 'durable_learning']) {
    assert.equal(field in result, false); assert.equal(field in f.store.m7Outcome.readNextCycle(f.nextReceipt), false);
  }
});
test('30 prior M5/M6 acceptance is never reusable in next-cycle fragment', async () => {
  const f = await fixture(); record(f); const fragment = f.store.m7Outcome.readNextCycle(f.nextReceipt);
  for (const field of ['m5_receipt', 'acceptance', 'start', 'command']) assert.equal(field in fragment, false);
  assert.equal(fragment.requires_reconfirmation.includes('HUMAN_CHOICE'), true);
  const nextTask = f.store.submit('Khỏe hơn vòng mới', { permission_granted: true }); await tick();
  const nextRef = f.store.reference(nextTask);
  assert.equal(f.store.getM5GoalChoiceReceipt(nextRef), undefined);
  assert.equal(f.store.resolveM6GoalAction(nextRef, f.m5Receipt, { available_time_minutes: 5,
    current_constraints: 'NONE_REPORTED' }), undefined);
  assert.equal(f.store.m7Outcome.readNextCycle(f.nextReceipt).episode_ref.episode_key, fragment.episode_ref.episode_key);
  const ui = readFileSync(new URL('../components/useM2Gateway.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /m7Outcome|createLocalM7PurposeAuthority/u);
  assert.equal(networkCalls, 0);
});

// U2 CODE_OFFLINE: actual same-store Start/intake/End/outcome implementation.
const feedback = (changes = {}) => ({ request_id: 'feedback-1', experience: 'VERY_GOOD',
  locale: 'vi', displayed_label: 'Rất ổn', ...changes });
const endEpisode = f => assert.equal(f.store.selfWalk.end(f.ref, f.proposal, 'end-u2').state, 'STOPPED');
const recordFeedback = (f, input = feedback()) => f.store.m7Outcome.reportFeedback(f.ref, f.recordReceipt, input);

// QA11 finite reachable domain states. Drafts are controller-owned and tested
// separately; a retracted head retains its lawful versions and is not absent.
for (const rs of ['absent','active','history','retracted']) for (const fs of ['absent','active','history','retracted']) {
  for (const boundary of ['owner','record-purpose','task-edit','store-retire','M3-only','USE-only']) {
    test(`QA11 T21 R=${rs} F=${fs} boundary=${boundary}`, async () => {
      const f=await fixture();endEpisode(f);const store=f.store.m7Outcome;
      const revisions={R:[],F:[]};let rh,fh;
      if(rs!=='absent') { rh=record(f,report({evidence_text:'qa-r-original'}));assert.equal(rh.state,'ACTIVE');revisions.R.push(rh.revision); }
      if(fs!=='absent') { fh=recordFeedback(f);assert.equal(fh.state,'ACTIVE');revisions.F.push(fh.revision); }
      if(rs==='history'||rs==='retracted') { rh=store.correct(f.ref,f.recordReceipt,rh.revision,report({request_id:'qa-r-correct',evidence_text:'qa-r-new'}));assert.equal(rh.state,'ACTIVE');revisions.R.push(rh.revision); }
      if(fs==='history'||fs==='retracted') { fh=store.correctFeedback(f.ref,f.recordReceipt,fh.revision,feedback({request_id:'qa-f-correct',experience:'FELT_TOO_MUCH',displayed_label:'Hơi quá'}));assert.equal(fh.state,'ACTIVE');revisions.F.push(fh.revision); }
      if(rs==='retracted'){rh=store.retract(f.ref,f.recordReceipt,rh.revision,'qa-r-retract');assert.equal(rh.state,'RETRACTED');revisions.R.push(rh.revision);}
      if(fs==='retracted'){fh=store.retractFeedback(f.ref,f.recordReceipt,fh.revision,'qa-f-retract');assert.equal(fh.state,'RETRACTED');revisions.F.push(fh.revision);}
      const priorR=store.getSnapshot(f.recordReceipt),priorF=store.getFeedbackSnapshot(f.recordReceipt);
      if(boundary==='owner')f.boundary.control.invalidateCurrentSession();
      if(boundary==='record-purpose')f.purpose.control.revoke('RECORD_OUTCOME');
      if(boundary==='task-edit')assert.equal(f.store.edit(f.ref,'QA new task meaning'),true);
      if(boundary==='store-retire')f.store.stop();
      if(boundary==='M3-only')assert.equal(await f.store.revoke(f.ref),true);
      if(boundary==='USE-only')f.purpose.control.revoke('USE_NEXT_CYCLE');
      const retained=boundary==='M3-only'||boundary==='USE-only';
      if(retained) {
        assert.equal(store.getSnapshot(f.recordReceipt),priorR);
        assert.equal(store.getFeedbackSnapshot(f.recordReceipt),priorF);
        for(const rev of revisions.R)assert.ok(store.getRevision(rev,f.recordReceipt));
        for(const rev of revisions.F)assert.ok(store.getFeedbackRevision(rev,f.recordReceipt));
        const expected={...(rh?{R:rh.revision}:{}),...(fh?{F:fh.revision}:{})};
        if(rh||fh)assert.equal(store.erase(f.ref,f.recordReceipt,expected,'qa-retained-delete').state,'UNKNOWN');
      } else {
        assert.equal(store.hasRetained(),false);
        for(const rev of revisions.R)assert.equal(store.getRevision(rev,f.recordReceipt),undefined);
        for(const rev of revisions.F)assert.equal(store.getFeedbackRevision(rev,f.recordReceipt),undefined);
        assert.equal(record(f,report({evidence_text:'qa-r-original'})).state,'DENIED');
        assert.equal(recordFeedback(f).state,'DENIED');
        const fresh=f.purpose.control.grant('RECORD_OUTCOME');
        assert.equal(store.report(f.ref,fresh,report({request_id:'qa-fresh-r'})).state,'DENIED');
        assert.equal(store.reportFeedback(f.ref,fresh,feedback({request_id:'qa-fresh-f'})).state,'DENIED');
        for(const rev of revisions.R)assert.equal(store.getRevision(rev,fresh),undefined);
        for(const rev of revisions.F)assert.equal(store.getFeedbackRevision(rev,fresh),undefined);
      }
      f.store.stop();
    });
  }
}

for(const [experience,displayed_label] of [['VERY_GOOD','Rất ổn'],['FELT_MANAGEABLE','Vừa sức'],['FELT_TOO_MUCH','Hơi quá'],['PROBLEM_REPORTED','Có vấn đề']]) {
  for(const operation of ['correct','retract','delete'])test(`QA11 T28 ${experience} ${operation} under actual trainer HOLD`,async()=>{
    const f=await fixture();endEpisode(f);const first=recordFeedback(f,feedback({experience,displayed_label}));assert.equal(first.state,'ACTIVE');
    f.store.submit('Tôi đang đau ngực dữ dội và khó thở',{permission_granted:true});await tick();
    const hold=f.store.getTrainerSafetySnapshot();assert.equal(hold.state,'HOLD');
    assert.equal(f.store.m7Outcome.reportFeedback(f.store.reference(),f.recordReceipt,feedback({request_id:'qa-new-under-hold',experience,displayed_label})).state,'DENIED');
    if(operation==='correct')assert.equal(f.store.m7Outcome.correctFeedback(f.ref,f.recordReceipt,first.revision,feedback({request_id:'qa-correct-under-hold',experience,displayed_label})).state,'ACTIVE');
    if(operation==='retract')assert.equal(f.store.m7Outcome.retractFeedback(f.ref,f.recordReceipt,first.revision,'qa-retract-under-hold').state,'RETRACTED');
    if(operation==='delete')assert.equal(f.store.m7Outcome.erase(f.ref,f.recordReceipt,{F:first.revision},'qa-delete-under-hold').state,'UNKNOWN');
    assert.deepEqual(f.store.getTrainerSafetySnapshot(),hold);assert.equal(f.store.getTrainerActionAvailability(),'SAFETY_HOLD');
    f.store.submit('Please alphabetize books',{permission_granted:true});await tick();
    assert.equal(f.store.getTrainerSafetySnapshot().state,'HOLD');assert.equal(f.store.getTrainerActionAvailability(),'SAFETY_HOLD');
    assert.equal(f.store.selfWalk.getCurrentEpisode(f.store.reference()),undefined);f.store.stop();
  });
}

for(const shape of ['timestamp','occurred_at','end','copied-end','json-end','episode','copied-episode','stopped','fresh-ID','old-ID']) {
  test('QA11 T43 fake End input '+shape+' denies; actual current End positive and withdrawn End negative',async()=>{
    const f=await fixture();const ep=f.store.selfWalk.getCurrentEpisode(f.ref);
    const witness={kind:'USER_REPORTED_END',recorded_at:f.clock.now()};
    const extra={timestamp:{timestamp:f.clock.now()},occurred_at:{occurred_at:f.clock.now()},end:{end:witness},
      'copied-end':{end:{...witness}},'json-end':{end:JSON.parse(JSON.stringify(witness))},
      episode:{episode:{...ep,end:witness}},'copied-episode':{episode:structuredClone({...ep,end:witness})},stopped:{state:'STOPPED',end:witness}}[shape]??{};
    const id=shape==='old-ID'?'feedback-1':'qa-fake-'+shape;
    f.clock.jumpWithoutTimers(1500);
    assert.equal(recordFeedback(f,feedback({request_id:id,...extra})).state,'DENIED');
    assert.equal(f.store.selfWalk.stop(f.ref,f.proposal,'qa-ordinary-stop').state,'STOPPED');
    assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref).end,undefined);
    assert.equal(recordFeedback(f,feedback({request_id:id,...extra})).state,'DENIED');
    endEpisode(f);
    if(Object.keys(extra).length)assert.equal(recordFeedback(f,feedback({request_id:'qa-extra-after-real-end',...extra})).state,'DENIED');
    assert.equal(recordFeedback(f,feedback({request_id:'qa-real-end-positive'})).state,'ACTIVE');
    const other=await fixture();endEpisode(other);const oldEnd=other.store.selfWalk.getCurrentEpisode(other.ref).end;
    other.resource.withdraw();assert.equal(other.store.selfWalk.getCurrentEpisode(other.ref),undefined);
    assert.equal(recordFeedback(other,feedback({request_id:'qa-old-end',end:{...oldEnd}})).state,'DENIED');
    assert.equal(recordFeedback(other,feedback({request_id:'qa-old-end-plain'})).state,'DENIED');
    f.store.stop();other.store.stop();
  });
}

for(const copyKind of ['shallow','deep','json','changed-owner','changed-lease','changed-task','changed-generation','changed-purpose']) {
  test('QA11 T09 M7 copied episode/ref/receipt '+copyKind+' never grants current F',async()=>{
    const f=await fixture();endEpisode(f);const ep=f.store.selfWalk.getCurrentEpisode(f.ref);
    const clone=x=>copyKind==='deep'?structuredClone(x):copyKind==='json'?JSON.parse(JSON.stringify(x)):{...x};
    const fakeRef=clone(f.ref),fakeReceipt=clone(f.recordReceipt),fakeEpisode=clone(ep);
    const field=copyKind.replace('changed-','');if(copyKind.startsWith('changed-')){fakeRef[field]='forged';fakeReceipt[field]='forged';fakeEpisode[field]='forged';}
    for(const wrongRef of [fakeRef,fakeEpisode])assert.equal(f.store.m7Outcome.reportFeedback(wrongRef,f.recordReceipt,feedback()).state,'DENIED');
    assert.equal(f.store.m7Outcome.reportFeedback(f.ref,fakeReceipt,feedback()).state,'DENIED');
    assert.equal(recordFeedback(f).state,'ACTIVE');f.store.stop();
  });
}

test('U2-E02/E03 Start and ordinary Stop do not authorize F; actual current End does', async () => {
  const f = await fixture();
  assert.equal(recordFeedback(f).state, 'DENIED');
  assert.equal(f.store.selfWalk.stop(f.ref, f.proposal, 'stop-u2').state, 'STOPPED');
  assert.equal(recordFeedback(f).state, 'DENIED');
  endEpisode(f);
  const result = recordFeedback(f);
  assert.equal(result.state, 'ACTIVE');
  assert.deepEqual(result.feedback, { experience: 'VERY_GOOD', locale: 'vi', displayed_label: 'Rất ổn' });
  for (const key of ['outcome', 'performed_minutes', 'safety_disposition', 'sensor', 'completion']) assert.equal(key in result, false);
  assert.equal(result.evidence.source, 'USER_REPORT');
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt).state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.readNextCycle(f.nextReceipt), undefined);
});

test('U2-F validation rejects copied ref/receipt, mismatched meaning/label and inferred facts', async () => {
  const f = await fixture(); endEpisode(f);
  for (const input of [feedback({ displayed_label: 'Vừa sức' }), feedback({ locale: 'en' }),
    feedback({ experience: 'DID' }), feedback({ safety_disposition: 'CLEAR' }), feedback({ performed_minutes: 5 }),
    feedback({ experience: undefined }), feedback({ evidence_text: 'copied composer' })]) {
    assert.equal(recordFeedback(f, input).state, 'DENIED');
  }
  assert.equal(f.store.m7Outcome.reportFeedback({ ...f.ref }, f.recordReceipt, feedback()).state, 'DENIED');
  assert.equal(f.store.m7Outcome.reportFeedback(f.ref, { ...f.recordReceipt }, feedback()).state, 'DENIED');
  assert.equal(recordFeedback(f).state, 'ACTIVE');
});

test('U2-E04 historical first R survives withdrawal; copied or historical End never authorizes F', async () => {
  const f = await fixture(); endEpisode(f); f.resource.withdraw();
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref), undefined);
  assert.equal(recordFeedback(f).state, 'DENIED');
  assert.equal(record(f, report({ problem_state: 'PROBLEM', safety_disposition: 'REASSESS' })).state, 'ACTIVE');
});

test('U2-E05 R non-CLEAR after End denies first F without restoring guidance', async () => {
  const f = await fixture(); endEpisode(f);
  const r = record(f, report({ problem_state: 'PROBLEM', safety_disposition: 'REASSESS' }));
  assert.equal(r.state, 'ACTIVE');
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref), undefined);
  assert.equal(recordFeedback(f).state, 'DENIED');
  assert.equal(f.store.selfWalk.getSnapshot().state, 'STOPPED');
});

test('U2-E06 F then non-CLEAR R preserves F retained correction/retraction without current End', async () => {
  const f = await fixture(); endEpisode(f); const first = recordFeedback(f);
  const r = record(f, report({ problem_state: 'PROBLEM', safety_disposition: 'REASSESS' }));
  assert.equal(r.state, 'ACTIVE'); assert.equal(f.store.m7Outcome.getFeedbackSnapshot(f.recordReceipt), first);
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.ref), undefined);
  const corrected = f.store.m7Outcome.correctFeedback(f.ref, f.recordReceipt, first.revision,
    feedback({ request_id: 'f-correct', experience: 'PROBLEM_REPORTED', displayed_label: 'Có vấn đề' }));
  assert.equal(corrected.state, 'ACTIVE');
  assert.equal(f.store.m7Outcome.getFeedbackRevision(first.revision, f.recordReceipt).feedback.displayed_label, 'Rất ổn');
  assert.equal(f.store.m7Outcome.retractFeedback(f.ref, f.recordReceipt, corrected.revision, 'f-retract').state, 'RETRACTED');
  assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt), r);
});

test('U2-E07 F-only remains manageable after M3 revoke and closes on final erase', async () => {
  const f = await fixture(); endEpisode(f); const first = recordFeedback(f);
  assert.equal(first.state, 'ACTIVE'); assert.equal(await f.store.revoke(f.ref), true);
  assert.equal(f.store.m7Outcome.getFeedbackSnapshot(f.recordReceipt), first);
  assert.equal(f.store.m7Outcome.canRecord(f.ref, 'F'), false);
  assert.equal(f.store.m7Outcome.erase(f.ref, f.recordReceipt, { F: first.revision }, 'delete-f').state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.getFeedbackRevision(first.revision, f.recordReceipt), undefined);
  const fresh = f.purpose.control.grant('RECORD_OUTCOME');
  assert.equal(f.store.m7Outcome.getFeedbackSnapshot(fresh).state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.reportFeedback(f.ref, fresh, feedback({ request_id: 'new-f' })).state, 'DENIED');
});

test('U2-E08 USE_NEXT_CYCLE-only revoke preserves F and independent R receipt', async () => {
  const f = await fixture(); endEpisode(f); const first = recordFeedback(f);
  f.purpose.control.revoke('USE_NEXT_CYCLE');
  assert.equal(f.store.m7Outcome.getFeedbackSnapshot(f.recordReceipt), first);
  assert.equal(record(f).state, 'ACTIVE'); assert.equal(f.store.m7Outcome.readNextCycle(f.nextReceipt), undefined);
});

test('U2-E09 narrow deletion in both directions preserves retracted counterpart and history', async () => {
  for (const target of ['R', 'F']) {
    const f = await fixture(); endEpisode(f); const r = record(f), x = recordFeedback(f);
    const rr = f.store.m7Outcome.retract(f.ref, f.recordReceipt, r.revision, 'rr');
    const ff = f.store.m7Outcome.retractFeedback(f.ref, f.recordReceipt, x.revision, 'ff');
    const result = f.store.m7Outcome.erase(f.ref, f.recordReceipt,
      target === 'R' ? { R: rr.revision } : { F: ff.revision }, 'narrow');
    assert.equal(result.state, 'UNKNOWN');
    if (target === 'R') {
      assert.equal(f.store.m7Outcome.getRevision(r.revision, f.recordReceipt), undefined);
      assert.equal(f.store.m7Outcome.getFeedbackSnapshot(f.recordReceipt), ff);
      assert.equal(f.store.m7Outcome.getFeedbackRevision(x.revision, f.recordReceipt).feedback.displayed_label, 'Rất ổn');
      assert.equal(record(f, report({ request_id: 'new-r' })).state, 'DENIED');
    } else {
      assert.equal(f.store.m7Outcome.getFeedbackRevision(x.revision, f.recordReceipt), undefined);
      assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt), rr);
      assert.equal(f.store.m7Outcome.getRevision(r.revision, f.recordReceipt).outcome.execution_extent, 'DID');
      assert.equal(recordFeedback(f, feedback({ request_id: 'new-f' })).state, 'DENIED');
    }
  }
});

test('U2-E10 final erase purges replay/history and forbids same-episode replacement or grant-only recovery', async () => {
  const f = await fixture(); endEpisode(f); const first = recordFeedback(f);
  assert.equal(recordFeedback(f), first);
  assert.equal(record(f, report({ request_id: 'feedback-1' })).state, 'DENIED', 'shared R/F request namespace');
  assert.equal(f.store.m7Outcome.erase(f.ref, f.recordReceipt, { F: first.revision }, 'purge').state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.getFeedbackRevision(first.revision, f.recordReceipt), undefined);
  const receipt = f.purpose.control.grant('RECORD_OUTCOME');
  for (const id of ['feedback-1', 'fresh-id']) assert.equal(f.store.m7Outcome.reportFeedback(f.ref, receipt, feedback({ request_id: id })).state, 'DENIED');
  assert.equal(f.store.m7Outcome.report(f.ref, receipt, report()).state, 'DENIED');
  assert.equal(f.store.m7Outcome.getFeedbackSnapshot(receipt).state, 'UNKNOWN');
});

test('U2-E11 F-only purge on owner, purpose, task edit and episode retirement has no payload replay', async () => {
  for (const kind of ['owner', 'purpose', 'edit', 'stop']) {
    const f = await fixture(); endEpisode(f); const first = recordFeedback(f);
    if (kind === 'owner') f.boundary.control.invalidateCurrentSession();
    if (kind === 'purpose') f.purpose.control.revoke('RECORD_OUTCOME');
    if (kind === 'edit') f.store.edit(f.ref, 'new task meaning');
    if (kind === 'stop') f.store.stop();
    assert.equal(f.store.m7Outcome.getFeedbackRevision(first.revision, f.recordReceipt), undefined, kind);
    assert.notEqual(f.store.m7Outcome.getFeedbackSnapshot(f.recordReceipt).state, 'ACTIVE', kind);
    assert.equal(recordFeedback(f).state, 'DENIED', kind);
  }
});

test('U2-E14 genuine new activity after purge gets fresh intake; old callbacks remain denied', async () => {
  const f = await fixture(); endEpisode(f); const first = recordFeedback(f);
  f.store.m7Outcome.erase(f.ref, f.recordReceipt, { F: first.revision }, 'purge');
  const newRef = await startFreshEpisodeOnTask(f, 'u2');
  const receipt = f.purpose.control.grant('RECORD_OUTCOME');
  assert.equal(f.store.m7Outcome.report(f.ref, receipt, report()).state, 'DENIED');
  assert.equal(f.store.m7Outcome.report(newRef, receipt, report({ request_id: 'new-episode-r' })).state, 'ACTIVE');
  assert.equal(f.store.m7Outcome.reportFeedback(newRef, receipt, feedback()).state, 'DENIED', 'new episode still requires its own End');
});

test('U2-D01/D05 shared128 budget blocks increase but permits exact final erasure', async () => {
  const f = await fixture(); endEpisode(f); let current = recordFeedback(f);
  for (let i = 1; i < 128; i++) {
    current = f.store.m7Outcome.correctFeedback(f.ref, f.recordReceipt, current.revision, feedback({ request_id: `correct-${i}` }));
    assert.equal(current.state, 'ACTIVE');
  }
  assert.equal(record(f).state, 'DENIED');
  assert.equal(f.store.m7Outcome.correctFeedback(f.ref, f.recordReceipt, current.revision, feedback({ request_id: 'overflow' })).state, 'DENIED');
  assert.equal(f.store.m7Outcome.erase(f.ref, f.recordReceipt, { F: current.revision }, 'full-cleanup').state, 'UNKNOWN');
  const newRef = await startFreshEpisodeOnTask(f, 'capacity');
  const receipt = f.purpose.control.grant('RECORD_OUTCOME');
  assert.equal(f.store.m7Outcome.report(newRef, receipt, report({ request_id: 'no-budget-reset' })).state, 'DENIED');
});

test('U2-D05 opposite create-first retains receipt; close-first rejects observer reentry before ACK', async () => {
  const a = await fixture(); endEpisode(a); const r = record(a); const f = recordFeedback(a);
  assert.equal(a.store.m7Outcome.erase(a.ref, a.recordReceipt, { R: r.revision }, 'erase-r').state, 'UNKNOWN');
  assert.equal(a.store.m7Outcome.getFeedbackSnapshot(a.recordReceipt), f);
  const b = await fixture(); endEpisode(b); const old = record(b);
  const { observeM7Purpose } = await import('../domain/m7/outcome.ts');
  let observed, reentered;
  const off = observeM7Purpose(b.purpose.access, () => {
    observed = b.store.m7Outcome.getRevision(old.revision, b.recordReceipt);
    reentered = recordFeedback(b);
  });
  assert.equal(b.store.m7Outcome.erase(b.ref, b.recordReceipt, { R: old.revision }, 'erase-last').state, 'UNKNOWN');
  off(); assert.equal(observed, undefined); assert.equal(reentered.state, 'DENIED');
});

test('U2-D02 outcome observer purges own new F before return; no stale successful publication', async () => {
  const f = await fixture(); endEpisode(f); let once = true;
  f.store.m7Outcome.subscribe(() => { if (once) { once = false; f.purpose.control.revoke('RECORD_OUTCOME'); } });
  assert.equal(recordFeedback(f).state, 'DENIED');
  const fresh = f.purpose.control.grant('RECORD_OUTCOME');
  assert.equal(f.store.m7Outcome.getFeedbackSnapshot(fresh).state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.reportFeedback(f.ref, fresh, feedback()).state, 'DENIED');
});

test('U2 scoped-delete ID cannot be relabelled as counterpart erase/correct or new payload', async () => {
  const f = await fixture(); endEpisode(f); const r = record(f), x = recordFeedback(f);
  assert.equal(f.store.m7Outcome.erase(f.ref, f.recordReceipt, { R: r.revision }, 'scoped-id').state, 'UNKNOWN');
  assert.equal(f.store.m7Outcome.erase(f.ref, f.recordReceipt, { F: x.revision }, 'scoped-id').state, 'DENIED');
  assert.equal(f.store.m7Outcome.correctFeedback(f.ref, f.recordReceipt, x.revision, feedback({ request_id: 'scoped-id' })).state, 'DENIED');
  assert.equal(record(f, report({ request_id: 'scoped-id' })).state, 'DENIED');
  assert.equal(f.store.m7Outcome.getFeedbackSnapshot(f.recordReceipt), x);
  assert.equal(f.store.m7Outcome.erase(f.ref, f.recordReceipt, { F: x.revision }, 'fresh-final').state, 'UNKNOWN');
});

test('U2 revoke/regrant in one observer publication cannot preserve pre-revocation intake with no payload', async () => {
  const f = await fixture(); endEpisode(f);
  const { withM7PurposePublicationHeld } = await import('../domain/m7/outcome.ts');
  let fresh;
  withM7PurposePublicationHeld(f.purpose.access, () => {
    f.purpose.control.revoke('RECORD_OUTCOME'); fresh = f.purpose.control.grant('RECORD_OUTCOME');
    assert.equal(f.store.m7Outcome.reportFeedback(f.ref, fresh, feedback()).state, 'DENIED');
  });
  assert.equal(f.store.m7Outcome.report(f.ref, fresh, report()).state, 'DENIED');
  assert.equal(f.store.m7Outcome.getSnapshot(fresh).state, 'UNKNOWN');
});

test('U2 T14 independent R before End and F only after real End coexist under same actual receipt', async () => {
  const f=await fixture();const r=record(f);
  assert.equal(r.state,'ACTIVE');assert.equal(recordFeedback(f).state,'DENIED');endEpisode(f);
  assert.equal(recordFeedback(f).state,'ACTIVE');assert.equal(f.store.m7Outcome.getSnapshot(f.recordReceipt),r);
});

test('U2 T16 active component deletion preserves opposite retracted revisions in both directions', async () => {
  for(const target of ['R','F']) {
    const f=await fixture();endEpisode(f);const r=record(f),x=recordFeedback(f);
    const counterpart=target==='R'?f.store.m7Outcome.retractFeedback(f.ref,f.recordReceipt,x.revision,'retract-f')
      :f.store.m7Outcome.retract(f.ref,f.recordReceipt,r.revision,'retract-r');
    const expected=target==='R'?{R:r.revision}:{F:x.revision};
    assert.equal(f.store.m7Outcome.erase(f.ref,f.recordReceipt,expected,'erase-active').state,'UNKNOWN');
    assert.equal(target==='R'?f.store.m7Outcome.getFeedbackSnapshot(f.recordReceipt):f.store.m7Outcome.getSnapshot(f.recordReceipt),counterpart);
    assert.ok(target==='R'?f.store.m7Outcome.getFeedbackRevision(x.revision,f.recordReceipt):f.store.m7Outcome.getRevision(r.revision,f.recordReceipt));
    assert.equal(f.store.m7Outcome.hasRetained(),true);
  }
});

test('U2 T22 direct store retire closes intake before cleanup observer can recreate F', async () => {
  const f=await fixture();endEpisode(f);const first=recordFeedback(f);let attempted;
  f.store.m7Outcome.subscribe(()=>{attempted=recordFeedback(f,feedback({request_id:'reentry-on-retire'}));});
  f.store.m7Outcome.retire();assert.equal(attempted.state,'DENIED');
  assert.equal(f.store.m7Outcome.getFeedbackRevision(first.revision,f.recordReceipt),undefined);
  assert.equal(f.store.m7Outcome.getFeedbackSnapshot(f.recordReceipt).state,'UNAVAILABLE');
});

test('U2 T23 distinct R/F revision sentinels purge at exact scope; fresh authority cannot replay erased results', async () => {
  const f=await fixture();endEpisode(f);
  const r1=record(f,report({evidence_text:'R_OWNED_SENTINEL_1'}));
  const r2=f.store.m7Outcome.correct(f.ref,f.recordReceipt,r1.revision,report({request_id:'r-sentinel-2',evidence_text:'R_OWNED_SENTINEL_2'}));
  const f1=recordFeedback(f);
  const f2=f.store.m7Outcome.correctFeedback(f.ref,f.recordReceipt,f1.revision,feedback({request_id:'f-sentinel-2',experience:'FELT_TOO_MUCH',displayed_label:'Hơi quá'}));
  assert.equal(f.store.m7Outcome.erase(f.ref,f.recordReceipt,{R:r2.revision},'erase-r-sentinels').state,'UNKNOWN');
  for(const rev of [r1.revision,r2.revision])assert.equal(f.store.m7Outcome.getRevision(rev,f.recordReceipt),undefined);
  assert.equal(f.store.m7Outcome.getFeedbackSnapshot(f.recordReceipt),f2);
  assert.equal(f.store.m7Outcome.getFeedbackRevision(f1.revision,f.recordReceipt).feedback.displayed_label,'Rất ổn');
  assert.equal(record(f,report({evidence_text:'R_OWNED_SENTINEL_1'})).state,'DENIED');
  assert.equal(f.store.m7Outcome.erase(f.ref,f.recordReceipt,{F:f2.revision},'erase-f-sentinels').state,'UNKNOWN');
  const fresh=f.purpose.control.grant('RECORD_OUTCOME');
  for(const rev of [r1.revision,r2.revision,f1.revision,f2.revision]) {
    assert.equal(f.store.m7Outcome.getRevision(rev,fresh),undefined);assert.equal(f.store.m7Outcome.getFeedbackRevision(rev,fresh),undefined);
  }
  assert.equal(f.store.m7Outcome.correct(f.ref,fresh,r1.revision,report({request_id:'r-sentinel-2',evidence_text:'R_OWNED_SENTINEL_2'})).state,'DENIED');
  assert.equal(f.store.m7Outcome.reportFeedback(f.ref,fresh,feedback()).state,'DENIED');
  assert.equal(f.store.m7Outcome.getSnapshot(fresh).state,'UNKNOWN');assert.equal(f.store.m7Outcome.getFeedbackSnapshot(fresh).state,'UNKNOWN');
});

test('U2 T28 independent real trainer hold is not cleared by F correction/delete or subsequent no-match text', async () => {
  const f=await fixture();endEpisode(f);const first=recordFeedback(f);
  const safetyTask=f.store.submit('Tôi đang đau ngực dữ dội và khó thở', {permission_granted:true});await tick();
  assert.ok(safetyTask);const hold=f.store.getTrainerSafetySnapshot();assert.equal(hold.state,'HOLD');
  const corrected=f.store.m7Outcome.correctFeedback(f.ref,f.recordReceipt,first.revision,feedback({request_id:'positive-under-hold'}));
  assert.equal(corrected.state,'ACTIVE');assert.deepEqual(f.store.getTrainerSafetySnapshot(),hold);
  assert.equal(f.store.m7Outcome.erase(f.ref,f.recordReceipt,{F:corrected.revision},'delete-under-hold').state,'UNKNOWN');
  assert.deepEqual(f.store.getTrainerSafetySnapshot(),hold);
  f.store.submit('Please organize these books alphabetically', {permission_granted:true});await tick();
  assert.equal(f.store.getTrainerSafetySnapshot().state,'HOLD');
  assert.equal(f.store.getTrainerActionAvailability(),'SAFETY_HOLD');
  assert.equal(f.store.selfWalk.getCurrentEpisode(f.store.reference()),undefined);
});
