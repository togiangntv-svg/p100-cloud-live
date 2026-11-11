import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extname } from 'node:path';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { FakeClock, fakeAuthority, OWNER_A } from './fixtures/local-owner.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context);
  },
});

let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw Error('NETWORK_FORBIDDEN'); };

const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { createLocalWalkResource } = await import('../domain/m6/walk-resource.ts');
const { readM7Purpose } = await import('../domain/m7/outcome.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const {
  TRAINER_M7_CYCLE_REQUEST_LIMIT,
  createTrainerM7CycleAuthority,
} = await import('../domain/trainer-runtime/m7-cycle-authority.ts');

const tick = () => new Promise(resolve => setImmediate(resolve));

const submitted = request_id => Object.freeze({ type: 'USER_SUBMITTED_OUTCOME', request_id });
const allowed = request_id => Object.freeze({ type: 'USER_ALLOWED_NEXT_CYCLE', request_id });
const declined = request_id => Object.freeze({ type: 'USER_REVOKED_NEXT_CYCLE', request_id });
const recordRevoked = request_id => Object.freeze({ type: 'TRUSTED_REVOKED_OUTCOME', request_id });

const report = (request_id = 'outcome-fixture-1') => Object.freeze({
  request_id,
  execution_extent: 'DID',
  action_change: 'UNCHANGED',
  user_stopped: false,
  problem_state: 'NO_PROBLEM_REPORTED',
  safety_disposition: 'CLEAR',
  constraint: 'NONE_REPORTED',
  occurred_at: 700,
});

const walkFacts = Object.freeze({
  source_ref: 'walk-context-cycle-authority',
  intent: 'SHORT_LIGHT_MOVEMENT',
  walking_choice: 'WANTS_WALK',
  adult: 'REPORTED_ADULT',
  mobility: 'INDEPENDENT_COMFORTABLE_WALKING',
  concerns: 'NONE_REPORTED',
  professional_limits: 'NONE_REPORTED',
  setting: 'INDOOR_FLAT_CLEAR_LIT_DRY_STOPPABLE',
  competing_activity: 'NONE',
  footwear: 'FAMILIAR_SECURE',
  available_minutes: 20,
  requested_minutes: 5,
  currency: 'CURRENT',
});

async function ownerFixture() {
  const clock = new FakeClock();
  const authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner: OWNER_A, validUntil: 100_000 });
  const lease = await boundary.control.verifySession();
  boundary.control.finishHydration(lease);
  return { clock, boundary, binding: Object.freeze({ access: boundary.access, lease }) };
}

async function integrationFixture() {
  const owner = await ownerFixture();
  const cycle = createTrainerM7CycleAuthority();
  cycle.bindRecordingScope(() => { try { owner.binding.access.requireLease(owner.binding.lease); return true; } catch { return false; } });
  const walk = createLocalWalkResource();
  const adapter = Object.freeze({
    provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    async interpret() {
      return Object.freeze({ intent_type: 'GOAL', interpreted_meaning: 'Khỏe hơn', confidence: 0.95,
        uncertainty: null, missing_context: [], clarification_needed: false, clarification_question: null,
        safety_state: 'CLEAR', suggested_next_role: 'M4', task_kind: 'general_health',
        context_effect: 'NONE', used_context_ids: [], response: 'Đã ghi nhận.' });
    },
    async revoke() {},
  });
  const store = createSessionTaskStore({
    adapter,
    now: () => owner.clock.now(),
    ownerSession: owner.binding,
    walkResource: walk.access,
    m7Purpose: cycle.access,
  });
  store.start();
  const task = store.submit('Khỏe hơn', { permission_granted: true });
  await tick();
  let ref = store.reference(task);
  const choice = store.acceptM5Goal(ref, store.assessM5Goal(ref, store.assessM4GoalReadiness(ref)));
  assert.ok(choice);
  ref = store.reference(task);
  assert.equal(store.selfWalk.reportContext(ref, walkFacts), true);
  const proposal = store.selfWalk.propose(ref, 'proposal-cycle-authority');
  assert.equal(proposal.state, 'PROPOSED');
  assert.equal(store.selfWalk.chooseAndStart(ref, proposal, 'start-cycle-authority').state, 'STARTED');
  return { cycle, store, ref, owner, walk };
}

async function recordedFixture() {
  const fixture = await integrationFixture();
  const grant = fixture.cycle.submitOutcome(submitted('submit-outcome-integration'));
  assert.equal(grant.state, 'GRANTED');
  const outcome = fixture.store.m7Outcome.report(fixture.ref, grant.receipt, report());
  assert.equal(outcome.state, 'ACTIVE');
  return { ...fixture, recordReceipt: grant.receipt, outcome };
}

test('01 new cycle authority starts with no RECORD_OUTCOME receipt', () => {
  const cycle = createTrainerM7CycleAuthority();
  assert.equal(cycle.getSnapshot().record_outcome_receipt, undefined);
});

test('02 new cycle authority starts with no USE_NEXT_CYCLE receipt', () => {
  const cycle = createTrainerM7CycleAuthority();
  assert.equal(cycle.getSnapshot().use_next_cycle_receipt, undefined);
});

test('03 explicit USER_SUBMITTED_OUTCOME grants RECORD_OUTCOME', () => {
  const cycle = createTrainerM7CycleAuthority();
  const result = cycle.submitOutcome(submitted('submit-outcome-1'));
  assert.equal(result.state, 'GRANTED');
  assert.equal(result.receipt.purpose, 'RECORD_OUTCOME');
  assert.equal(cycle.getSnapshot().record_outcome_receipt, result.receipt);
});

test('04 creating or opening cycle authority alone grants nothing', () => {
  const cycle = createTrainerM7CycleAuthority();
  assert.deepEqual(cycle.getSnapshot(), Object.freeze({ state: 'ACTIVE', request_count: 0,
    record_outcome_receipt: undefined, use_next_cycle_receipt: undefined }));
});

test('05 duplicate outcome submission request is idempotent', () => {
  const cycle = createTrainerM7CycleAuthority();
  const first = cycle.submitOutcome(submitted('submit-outcome-duplicate'));
  const duplicate = cycle.submitOutcome(submitted('submit-outcome-duplicate'));
  assert.equal(duplicate, first);
  assert.equal(duplicate.receipt, first.receipt);
  assert.equal(cycle.getSnapshot().request_count, 1);
});

test('06 conflicting request-id reuse fails closed', () => {
  const cycle = createTrainerM7CycleAuthority();
  cycle.submitOutcome(submitted('conflicting-request'));
  const conflict = cycle.allowNextCycle(allowed('conflicting-request'));
  assert.deepEqual(conflict, Object.freeze({ state: 'DENIED', command: 'USER_ALLOWED_NEXT_CYCLE',
    request_id: 'conflicting-request', reason: 'REQUEST_CONFLICT' }));
  assert.equal(cycle.getSnapshot().use_next_cycle_receipt, undefined);
  const wrongEvent = cycle.submitOutcome({ type: 'USER_ALLOWED_NEXT_CYCLE', request_id: 'wrong-event-type' });
  assert.equal(wrongEvent.reason, 'INVALID_REQUEST');
});

test('07 explicit USER_ALLOWED_NEXT_CYCLE separately grants USE_NEXT_CYCLE', () => {
  const cycle = createTrainerM7CycleAuthority();
  const result = cycle.allowNextCycle(allowed('allow-next-cycle-1'));
  assert.equal(result.state, 'GRANTED');
  assert.equal(result.receipt.purpose, 'USE_NEXT_CYCLE');
});

test('08 RECORD_OUTCOME existing does not auto-grant USE_NEXT_CYCLE', () => {
  const cycle = createTrainerM7CycleAuthority();
  cycle.submitOutcome(submitted('record-only'));
  assert.equal(cycle.getSnapshot().use_next_cycle_receipt, undefined);
});

test('09 USE_NEXT_CYCLE authority has no external M3 permission implication', async () => {
  const cycle = createTrainerM7CycleAuthority();
  cycle.allowNextCycle(allowed('next-without-m3'));
  assert.equal('m3_permission' in cycle.getSnapshot(), false);
  const source = await readFile(new URL('../domain/trainer-runtime/m7-cycle-authority.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /M3_TEXT|m3_intent_understanding|permission_revision/u);
});

test('10 revoke USE_NEXT_CYCLE invalidates only its receipt', () => {
  const cycle = createTrainerM7CycleAuthority();
  const recordGrant = cycle.submitOutcome(submitted('record-before-next-revoke'));
  const nextGrant = cycle.allowNextCycle(allowed('next-before-revoke'));
  assert.equal(cycle.revokeNextCycle(declined('revoke-next')).state, 'REVOKED');
  assert.equal(readM7Purpose(cycle.access, nextGrant.receipt, 'USE_NEXT_CYCLE'), undefined);
  assert.equal(readM7Purpose(cycle.access, recordGrant.receipt, 'RECORD_OUTCOME'), recordGrant.receipt.revision);
});

test('11 RECORD_OUTCOME receipt remains after USE_NEXT_CYCLE revoke', () => {
  const cycle = createTrainerM7CycleAuthority();
  const recordGrant = cycle.submitOutcome(submitted('record-remains'));
  cycle.allowNextCycle(allowed('next-revoked'));
  cycle.revokeNextCycle(declined('decline-next'));
  assert.equal(cycle.getSnapshot().record_outcome_receipt, recordGrant.receipt);
  assert.equal(cycle.getSnapshot().use_next_cycle_receipt, undefined);
});

test('12 explicit RECORD_OUTCOME revoke invalidates its receipt', () => {
  const cycle = createTrainerM7CycleAuthority();
  const recordGrant = cycle.submitOutcome(submitted('record-to-revoke'));
  assert.equal(cycle.revokeRecordOutcome(recordRevoked('revoke-record')).state, 'REVOKED');
  assert.equal(readM7Purpose(cycle.access, recordGrant.receipt, 'RECORD_OUTCOME'), undefined);
  assert.equal(cycle.getSnapshot().record_outcome_receipt, undefined);
});

test('13 different cycle authorities do not invalidate each other', () => {
  const cycleA = createTrainerM7CycleAuthority();
  const cycleB = createTrainerM7CycleAuthority();
  const a = cycleA.submitOutcome(submitted('cycle-a-record'));
  const b = cycleB.submitOutcome(submitted('cycle-b-record'));
  cycleB.revokeRecordOutcome(recordRevoked('cycle-b-revoke'));
  assert.equal(readM7Purpose(cycleA.access, a.receipt, 'RECORD_OUTCOME'), a.receipt.revision);
  assert.equal(readM7Purpose(cycleB.access, b.receipt, 'RECORD_OUTCOME'), undefined);
});

test('14 grant in cycle B does not invalidate cycle A receipts', () => {
  const cycleA = createTrainerM7CycleAuthority();
  const cycleB = createTrainerM7CycleAuthority();
  const recordA = cycleA.submitOutcome(submitted('cycle-a-record-stable'));
  const nextA = cycleA.allowNextCycle(allowed('cycle-a-next-stable'));
  cycleB.submitOutcome(submitted('cycle-b-record-new'));
  cycleB.allowNextCycle(allowed('cycle-b-next-new'));
  assert.equal(readM7Purpose(cycleA.access, recordA.receipt, 'RECORD_OUTCOME'), recordA.receipt.revision);
  assert.equal(readM7Purpose(cycleA.access, nextA.receipt, 'USE_NEXT_CYCLE'), nextA.receipt.revision);
});

test('15 retire invalidates both purposes and clears receipts and ledger', () => {
  const cycle = createTrainerM7CycleAuthority();
  const recordGrant = cycle.submitOutcome(submitted('record-before-retire'));
  const nextGrant = cycle.allowNextCycle(allowed('next-before-retire'));
  cycle.retire();
  assert.equal(readM7Purpose(cycle.access, recordGrant.receipt, 'RECORD_OUTCOME'), undefined);
  assert.equal(readM7Purpose(cycle.access, nextGrant.receipt, 'USE_NEXT_CYCLE'), undefined);
  assert.deepEqual(cycle.getSnapshot(), Object.freeze({ state: 'RETIRED', request_count: 0,
    record_outcome_receipt: undefined, use_next_cycle_receipt: undefined }));
});

test('16 retired authority cannot grant again', () => {
  const cycle = createTrainerM7CycleAuthority();
  cycle.retire();
  assert.equal(cycle.submitOutcome(submitted('late-record')).reason, 'RETIRED');
  assert.equal(cycle.allowNextCycle(allowed('late-next')).reason, 'RETIRED');
});

test('17 request ledger is bounded', () => {
  const cycle = createTrainerM7CycleAuthority();
  for (let index = 0; index < TRAINER_M7_CYCLE_REQUEST_LIMIT; index++) {
    assert.equal(cycle.submitOutcome(submitted(`bounded-${index}`)).state, 'GRANTED');
  }
  const overflow = cycle.submitOutcome(submitted('bounded-overflow'));
  assert.equal(overflow.reason, 'LEDGER_FULL');
  assert.equal(cycle.getSnapshot().request_count, TRAINER_M7_CYCLE_REQUEST_LIMIT);
});

test('18 request ledger accepts no owner ID or private free text fields', async () => {
  const cycle = createTrainerM7CycleAuthority();
  const first = cycle.submitOutcome({ type: 'USER_SUBMITTED_OUTCOME', request_id: 'bounded-semantic-only',
    owner_id: 'owner-private', private_text: 'sensitive free text' });
  const duplicate = cycle.submitOutcome({ type: 'USER_SUBMITTED_OUTCOME', request_id: 'bounded-semantic-only',
    owner_id: 'different-owner', private_text: 'different private text' });
  assert.equal(duplicate, first);
  assert.deepEqual(Object.keys(cycle.getSnapshot()).sort(),
    ['record_outcome_receipt', 'request_count', 'state', 'use_next_cycle_receipt']);
  const source = await readFile(new URL('../domain/trainer-runtime/m7-cycle-authority.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /subjectId|profileId|owner_id|private_text|evidence_text/u);
});

test('19 React, effect, store construction, owner READY and M3 paths do not auto-grant', async () => {
  const paths = [
    '../app/_layout.tsx',
    '../context/TrainerRuntimeContext.tsx',
    '../domain/trainer-runtime/coordinator.ts',
    '../domain/session-task/store.ts',
  ];
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /createTrainerM7CycleAuthority|USER_SUBMITTED_OUTCOME|USER_ALLOWED_NEXT_CYCLE/u);
    assert.doesNotMatch(source, /\.grant\s*\(\s*['"](?:RECORD_OUTCOME|USE_NEXT_CYCLE)['"]\s*\)/u);
  }
});

test('20 cycle authority tests require no provider or network call', () => {
  assert.equal(networkCalls, 0);
});

test('21 SessionTaskStore accepts cycle-scoped trusted access', async () => {
  const fixture = await integrationFixture();
  assert.equal(fixture.store.m7Outcome.getSnapshot(undefined).state, 'DENIED');
  fixture.store.stop(); fixture.cycle.retire();
});

test('22 without explicit RECORD_OUTCOME command, outcome report is denied', async () => {
  const fixture = await integrationFixture();
  assert.equal(fixture.store.m7Outcome.report(fixture.ref, undefined, report('without-record-command')).state, 'DENIED');
  fixture.store.stop(); fixture.cycle.retire();
});

test('23 explicit USER_SUBMITTED_OUTCOME permits the same valid episode to report', async () => {
  const fixture = await integrationFixture();
  const grant = fixture.cycle.submitOutcome(submitted('explicit-record-command'));
  assert.equal(fixture.store.m7Outcome.report(fixture.ref, grant.receipt, report('after-record-command')).state, 'ACTIVE');
  fixture.store.stop(); fixture.cycle.retire();
});

test('24 without explicit USE_NEXT_CYCLE choice, readNextCycle returns no fragment', async () => {
  const fixture = await recordedFixture();
  assert.equal(fixture.store.m7Outcome.readNextCycle(undefined), undefined);
  fixture.store.stop(); fixture.cycle.retire();
});

test('25 separate explicit next-cycle choice makes the fragment available', async () => {
  const fixture = await recordedFixture();
  const next = fixture.cycle.allowNextCycle(allowed('allow-next-integration'));
  assert.equal(fixture.store.m7Outcome.readNextCycle(next.receipt).state, 'AVAILABLE');
  fixture.store.stop(); fixture.cycle.retire();
});

test('26 USE_NEXT_CYCLE revoke hides fragment while local outcome remains', async () => {
  const fixture = await recordedFixture();
  const next = fixture.cycle.allowNextCycle(allowed('allow-then-revoke-next'));
  assert.ok(fixture.store.m7Outcome.readNextCycle(next.receipt));
  fixture.cycle.revokeNextCycle(declined('revoke-next-integration'));
  assert.equal(fixture.store.m7Outcome.readNextCycle(next.receipt), undefined);
  assert.equal(fixture.store.m7Outcome.getSnapshot(fixture.recordReceipt), fixture.outcome);
  fixture.store.stop(); fixture.cycle.retire();
});

test('27 RECORD_OUTCOME revoke clears private outcome under the existing M7 contract', async () => {
  const fixture = await recordedFixture();
  fixture.cycle.revokeRecordOutcome(recordRevoked('revoke-record-integration'));
  assert.equal(fixture.store.m7Outcome.getSnapshot(fixture.recordReceipt).state, 'DENIED');
  assert.equal(fixture.store.m7Outcome.getRevision(fixture.outcome.revision, fixture.recordReceipt), undefined);
  fixture.store.stop(); fixture.cycle.retire();
});

test('28 a second explicit outcome submission reuses the active RECORD_OUTCOME receipt', () => {
  const cycle = createTrainerM7CycleAuthority();
  const first = cycle.submitOutcome(submitted('stable-record-first'));
  const second = cycle.submitOutcome(submitted('stable-record-second'));
  assert.equal(second.receipt, first.receipt);
  assert.equal(second.receipt.revision, first.receipt.revision);
  assert.equal(cycle.getSnapshot().request_count, 2);
});

test('29 a second explicit outcome submission does not clear the recorded outcome', async () => {
  const fixture = await recordedFixture();
  fixture.cycle.submitOutcome(submitted('stable-record-integration-second'));
  assert.equal(fixture.store.m7Outcome.getSnapshot(fixture.recordReceipt), fixture.outcome);
  assert.equal(fixture.store.m7Outcome.getRevision(fixture.outcome.revision, fixture.recordReceipt), fixture.outcome);
  fixture.store.stop(); fixture.cycle.retire();
});

test('30 a second explicit next-cycle allowance reuses the active USE_NEXT_CYCLE receipt', async () => {
  const fixture = await recordedFixture();
  const first = fixture.cycle.allowNextCycle(allowed('stable-next-first'));
  const fragment = fixture.store.m7Outcome.readNextCycle(first.receipt);
  assert.equal(fragment.state, 'AVAILABLE');
  const second = fixture.cycle.allowNextCycle(allowed('stable-next-second'));
  assert.equal(second.receipt, first.receipt);
  assert.equal(second.receipt.revision, first.receipt.revision);
  assert.deepEqual(fixture.store.m7Outcome.readNextCycle(first.receipt), fragment);
  fixture.store.stop(); fixture.cycle.retire();
});

test('31 RECORD_OUTCOME revoke then a new explicit request grants a fresh receipt', () => {
  const cycle = createTrainerM7CycleAuthority();
  const first = cycle.submitOutcome(submitted('record-before-fresh-grant'));
  cycle.revokeRecordOutcome(recordRevoked('record-revoke-before-fresh-grant'));
  const second = cycle.submitOutcome(submitted('record-after-fresh-grant'));
  assert.notEqual(second.receipt, first.receipt);
  assert.notEqual(second.receipt.revision, first.receipt.revision);
  assert.equal(readM7Purpose(cycle.access, first.receipt, 'RECORD_OUTCOME'), undefined);
  assert.equal(readM7Purpose(cycle.access, second.receipt, 'RECORD_OUTCOME'), second.receipt.revision);
});

test('32 replaying a pre-revoke outcome request returns its result without re-granting', () => {
  const cycle = createTrainerM7CycleAuthority();
  const first = cycle.submitOutcome(submitted('record-replay-after-revoke'));
  cycle.revokeRecordOutcome(recordRevoked('record-replay-revoke'));
  const replay = cycle.submitOutcome(submitted('record-replay-after-revoke'));
  assert.equal(replay, first);
  assert.equal(cycle.getSnapshot().record_outcome_receipt, undefined);
  assert.equal(readM7Purpose(cycle.access, first.receipt, 'RECORD_OUTCOME'), undefined);
});

test('33 USE_NEXT_CYCLE revoke then a new explicit request grants a fresh receipt', () => {
  const cycle = createTrainerM7CycleAuthority();
  const first = cycle.allowNextCycle(allowed('next-before-fresh-grant'));
  cycle.revokeNextCycle(declined('next-revoke-before-fresh-grant'));
  const second = cycle.allowNextCycle(allowed('next-after-fresh-grant'));
  assert.notEqual(second.receipt, first.receipt);
  assert.notEqual(second.receipt.revision, first.receipt.revision);
  assert.equal(readM7Purpose(cycle.access, first.receipt, 'USE_NEXT_CYCLE'), undefined);
  assert.equal(readM7Purpose(cycle.access, second.receipt, 'USE_NEXT_CYCLE'), second.receipt.revision);
});

test('34 replaying a pre-revoke next-cycle request returns its result without re-granting', () => {
  const cycle = createTrainerM7CycleAuthority();
  const first = cycle.allowNextCycle(allowed('next-replay-after-revoke'));
  cycle.revokeNextCycle(declined('next-replay-revoke'));
  const replay = cycle.allowNextCycle(allowed('next-replay-after-revoke'));
  assert.equal(replay, first);
  assert.equal(cycle.getSnapshot().use_next_cycle_receipt, undefined);
  assert.equal(readM7Purpose(cycle.access, first.receipt, 'USE_NEXT_CYCLE'), undefined);
});

// U2 CODE_OFFLINE observers exercise the actual authority, not copied guards.
test('U2-D01 full64 exact-record reduction preserves USE_NEXT_CYCLE and capacity', () => {
  const cycle = createTrainerM7CycleAuthority();
  const r = cycle.submitOutcome(submitted('first-record'));
  const n = cycle.allowNextCycle(allowed('next-purpose'));
  for (let i = 2; i < 64; i++) assert.equal(cycle.submitOutcome(submitted(`fill-${i}`)).state, 'GRANTED');
  assert.equal(cycle.getSnapshot().request_count, 64);
  assert.equal(cycle.submitOutcome(submitted('overflow')).reason, 'LEDGER_FULL');
  const reduced = cycle.revokeRecordOutcome({ ...recordRevoked('full-reduce'), expected_receipt: r.receipt });
  assert.equal(reduced.state, 'REVOKED');
  assert.equal(readM7Purpose(cycle.access, r.receipt, 'RECORD_OUTCOME'), undefined);
  assert.equal(readM7Purpose(cycle.access, n.receipt, 'USE_NEXT_CYCLE'), n.receipt.revision);
  assert.equal(cycle.getSnapshot().request_count, 64);
});

test('U2-D02 retire during grant prevents outer publication and ledger revival', async () => {
  const { observeM7Purpose, readM7RecordingScope } = await import('../domain/m7/outcome.ts');
  const cycle = createTrainerM7CycleAuthority(); cycle.bindRecordingScope(() => true);
  assert.ok(readM7RecordingScope(cycle.access));
  let once = true;
  observeM7Purpose(cycle.access, () => { if (once) { once = false; cycle.retire(); } });
  assert.equal(cycle.submitOutcome(submitted('retire-during-grant')).state, 'DENIED');
  assert.deepEqual(cycle.getSnapshot(), { state: 'RETIRED', request_count: 0,
    record_outcome_receipt: undefined, use_next_cycle_receipt: undefined });
  assert.equal(readM7RecordingScope(cycle.access), undefined);
});

test('U2-D02/D03 reduction during grant then successor acquisition cannot be erased by outer unwind', async () => {
  const { observeM7Purpose } = await import('../domain/m7/outcome.ts');
  const cycle = createTrainerM7CycleAuthority(); let once = true, successor;
  observeM7Purpose(cycle.access, () => {
    if (!once) return; once = false;
    assert.equal(cycle.revokeRecordOutcome(recordRevoked('reduce-pending')).state, 'REVOKED');
    successor = cycle.submitOutcome(submitted('successor'));
  });
  assert.equal(cycle.submitOutcome(submitted('predecessor')).state, 'DENIED');
  assert.equal(successor.state, 'GRANTED');
  assert.equal(cycle.getSnapshot().record_outcome_receipt, successor.receipt);
  assert.equal(readM7Purpose(cycle.access, successor.receipt, 'RECORD_OUTCOME'), successor.receipt.revision);
  assert.equal(cycle.getSnapshot().request_count, 3);
});

test('U2-D02 grant observer cannot overbook the last64 slot with a nested other-purpose grant', async () => {
  const { observeM7Purpose } = await import('../domain/m7/outcome.ts');
  const cycle = createTrainerM7CycleAuthority();
  for (let i = 0; i < 63; i++) cycle.revokeRecordOutcome(recordRevoked(`reserve-${i}`));
  let nested;
  observeM7Purpose(cycle.access, () => { nested = cycle.allowNextCycle(allowed('nested')); });
  assert.equal(cycle.submitOutcome(submitted('last')).state, 'GRANTED');
  assert.equal(nested.reason, 'LEDGER_FULL');
  assert.equal(cycle.getSnapshot().request_count, 64);
  assert.equal(cycle.getSnapshot().use_next_cycle_receipt, undefined);
});

test('U2-D03 stale/copy expected receipt cannot reduce fresh successor or its independent next purpose', () => {
  const cycle = createTrainerM7CycleAuthority(); const first = cycle.submitOutcome(submitted('r-old'));
  cycle.revokeRecordOutcome({ ...recordRevoked('r-release'), expected_receipt: first.receipt });
  const next = cycle.allowNextCycle(allowed('n-current'));
  const fresh = cycle.submitOutcome(submitted('r-fresh'));
  for (const receipt of [first.receipt, { ...fresh.receipt }]) {
    assert.equal(cycle.revokeRecordOutcome({ ...recordRevoked(`stale-${receipt.revision}`), expected_receipt: receipt }).state, 'DENIED');
  }
  assert.equal(cycle.getSnapshot().record_outcome_receipt, fresh.receipt);
  assert.equal(readM7Purpose(cycle.access, next.receipt, 'USE_NEXT_CYCLE'), next.receipt.revision);
  // Historical idempotent grant is an old result, never current permission.
  assert.equal(cycle.submitOutcome(submitted('r-old')), first);
  assert.equal(readM7Purpose(cycle.access, first.receipt, 'RECORD_OUTCOME'), undefined);
});

test('U2 private scope installation exposes only frozen opaque identity and never a mutable predicate/receipt', async () => {
  const { readM7RecordingScope } = await import('../domain/m7/outcome.ts');
  const cycle = createTrainerM7CycleAuthority(); let live = true;
  assert.equal(cycle.bindRecordingScope(() => live), true);
  assert.equal(cycle.bindRecordingScope(() => true), false);
  const scope = readM7RecordingScope(cycle.access);
  assert.ok(Object.isFrozen(scope)); assert.deepEqual(Object.keys(scope), []);
  assert.equal(cycle.getSnapshot().record_outcome_receipt, undefined);
  assert.equal(cycle.getSnapshot().request_count, 0);
  live = false; assert.equal(readM7RecordingScope(cycle.access), undefined);
  live = true; assert.equal(readM7RecordingScope(cycle.access), undefined, 'closed installed lifetime cannot revive by boolean ABA');
});
