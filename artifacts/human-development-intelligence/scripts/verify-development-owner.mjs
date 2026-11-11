// Deterministic tests of the exact lifecycle consumed by DevelopmentContext.
// Fake authority/storage only; no network, credentials, database or real personal data.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { OWNER_A as A, OWNER_B as B, FakeClock, FakeStorage, fakeAuthority, deferred } from './fixtures/local-owner.mjs';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && /\/(gate7|boundary|storage)$/.test(specifier)) {
      return nextResolve(specifier + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});
const { createDevelopmentStore } = await import('../context/development-owner/store.ts');
const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { initialState, failClosedState, reduceGate7State, buildDecisionBundle, hydrateState,
  serializeState, STORAGE_KEY, runAcceptanceSuite } = await import('../domain/gate7.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); }
  assert.fail('Controlled operation did not settle');
}
async function idle(store) {
  await until(() => store.getSnapshot().hydrated && store.getSnapshot().persistenceStatus !== 'loading');
  await tick();
}
const key = (owner, name = 'state') =>
  `@100/v2/subject/${owner.subjectId}/profile/${owner.profileId}/${name}`;
const owned = (owner, value) => JSON.stringify({ schemaVersion: 1, owner, value });
function privateState(text) {
  return { ...initialState, inferenceCorrection: text, reviewNote: text, outcomeRecorded: true,
    calendarConnected: false, calendarRevokedAt: 800, dependentClaimStatus: 'review_required',
    episodes: 3, learningVersion: 1, claimStatus: 'active' };
}
function seed(backend, owner, text) {
  backend.data.set(key(owner), owned(owner, serializeState(privateState(text))));
}
function disk(backend, owner) {
  const raw = backend.data.get(key(owner));
  return raw === undefined ? undefined : hydrateState(JSON.parse(raw).value);
}
function empty(store) {
  assert.deepEqual(store.getSnapshot().state, failClosedState);
  assert.equal(store.getSnapshot().decisionBundle.recommendation, null);
}
function fixture() {
  const clock = new FakeClock(), backend = new FakeStorage(), authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  const stores = []; let selections = 0;
  async function lease(owner, ready = true) {
    authority.results.push({ status: 'verified', owner, validUntil: clock.now() + 1_000_000 });
    const value = await boundary.control.verifySession();
    if (ready) boundary.control.finishHydration(value);
    return value;
  }
  function mount(value) {
    const store = createDevelopmentStore({ owner: value ? { access: boundary.access, lease: value } : undefined,
      backend, now: clock.now, onSelection: () => { selections++; } });
    stores.push(store); store.start(); return store;
  }
  return { clock, backend, authority, boundary, lease, mount, selections: () => selections,
    cleanup: () => { for (const store of stores) store.stop(); } };
}
const tests = [];
const test = (name, body) => tests.push({ name, body });

test('No lease and forged local IDs cannot hydrate, write, reset or trigger haptics', async f => {
  seed(f.backend, A, 'fixture-private-A');
  const locked = f.mount(); empty(locked);
  locked.getSnapshot().correctInference('ignored');
  assert.equal(await locked.getSnapshot().resetLocalState(), false);
  await f.lease(A);
  const forged = f.mount({ subjectId: A.subjectId, profileId: A.profileId });
  empty(forged); forged.getSnapshot().runValidation(); await tick();
  assert.deepEqual(f.backend.calls, []); assert.equal(f.selections(), 0);
});
test('Boundary HYDRATING cannot read until READY', async f => {
  seed(f.backend, A, 'fixture-private-A');
  const lease = await f.lease(A, false), store = f.mount(lease);
  empty(store); store.getSnapshot().recordOutcome('ignored'); await tick();
  assert.deepEqual(f.backend.calls, []);
  f.boundary.control.finishHydration(lease); await idle(store);
  assert.equal(store.getSnapshot().state.reviewNote, 'fixture-private-A');
});
test('LOCKED and VERIFYING immediately retire A RAM before any await', async f => {
  seed(f.backend, A, 'fixture-private-A');
  const store = f.mount(await f.lease(A)); await idle(store);
  let observed; store.subscribe(() => { observed = store.getSnapshot().state.inferenceCorrection; });
  const pending = deferred(); f.authority.results.push(() => pending.promise);
  const verification = f.boundary.control.verifySession();
  assert.equal(f.boundary.access.getSnapshot().phase, 'VERIFYING');
  empty(store); assert.equal(observed, null);
  pending.resolve({ status: 'unknown' });
  await assert.rejects(verification, { code: 'AUTHORITY_UNAVAILABLE' });
  assert.equal(f.boundary.access.getSnapshot().phase, 'LOCKED'); empty(store);
});
test('A writes only its Development slot; legacy/other owner/context markers stay byte-identical', async f => {
  const preserved = [[STORAGE_KEY, serializeState(privateState('legacy'))],
    [key(B), owned(B, serializeState(privateState('B')))],
    [key(A, 'interaction-deleted-at'), 'fixture-marker'], [key(A, 'interaction'), 'fixture-interaction']];
  for (const [k, v] of preserved) f.backend.data.set(k, v);
  const store = f.mount(await f.lease(A)); await idle(store);
  assert.deepEqual(store.getSnapshot().state, initialState);
  store.getSnapshot().correctInference('fixture-owned-A'); await idle(store);
  assert.equal(disk(f.backend, A).inferenceCorrection, 'fixture-owned-A');
  for (const [k, v] of preserved) assert.equal(f.backend.data.get(k), v);
  assert.ok(f.backend.calls.every(call => call.key === key(A)));
});
test('A to B to A restores only each owner data and synchronously hides old snapshots', async f => {
  const a = f.mount(await f.lease(A)); await idle(a);
  a.getSnapshot().recordOutcome('fixture-A'); await idle(a);
  const old = a.getSnapshot(), bLease = f.lease(B); empty(a);
  const b = f.mount(await bLease); empty(b); await idle(b);
  assert.deepEqual(b.getSnapshot().state, initialState);
  old.recordOutcome('late-A'); assert.equal(await old.resetLocalState(), false);
  b.getSnapshot().recordOutcome('fixture-B'); await idle(b);
  const a2 = f.mount(await f.lease(A)); empty(b); await idle(a2);
  assert.equal(a2.getSnapshot().state.reviewNote, 'fixture-A');
  assert.equal(disk(f.backend, B).reviewNote, 'fixture-B');
});
test('Same Subject different Profile is isolated', async f => {
  const alternate = { subjectId: A.subjectId, profileId: 'fixture-profile-alternate' };
  seed(f.backend, A, 'fixture-A');
  const store = f.mount(await f.lease(alternate)); await idle(store);
  assert.deepEqual(store.getSnapshot().state, initialState);
  store.getSnapshot().recordOutcome('alternate'); await idle(store);
  assert.equal(disk(f.backend, A).reviewNote, 'fixture-A');
  assert.equal(disk(f.backend, alternate).reviewNote, 'alternate');
});
test('Delayed A hydration cannot publish to B or resurrect retired A RAM', async f => {
  seed(f.backend, A, 'fixture-A'); seed(f.backend, B, 'fixture-B');
  const gate = f.backend.holdNext('getItem');
  const a = f.mount(await f.lease(A)); await gate.started;
  const b = f.mount(await f.lease(B)); await idle(b);
  gate.release(); await tick(); empty(a);
  assert.equal(b.getSnapshot().state.inferenceCorrection, 'fixture-B');
});
test('Delayed A write stays in A scope; cleanup cannot change B storage/RAM/status', async f => {
  const a = f.mount(await f.lease(A)); await idle(a);
  const gate = f.backend.holdNext('setItem'); a.getSnapshot().recordOutcome('late-A'); await gate.started;
  const b = f.mount(await f.lease(B)); await idle(b);
  b.getSnapshot().recordOutcome('current-B'); await idle(b);
  const before = f.backend.data.get(key(B)); gate.release();
  await until(() => f.backend.calls.some(c => c.method === 'removeItem' && c.key === key(A)));
  await tick(); empty(a);
  assert.equal(f.backend.data.has(key(A)), false);
  assert.equal(f.backend.data.get(key(B)), before);
  assert.equal(b.getSnapshot().state.reviewNote, 'current-B');
  assert.equal(b.getSnapshot().persistenceStatus, 'ready');
});
test('Delayed failed A write cannot lock B', async f => {
  const a = f.mount(await f.lease(A)); await idle(a);
  const gate = f.backend.holdNext('setItem', true); a.getSnapshot().recordOutcome('late-A'); await gate.started;
  const b = f.mount(await f.lease(B)); await idle(b); gate.release(); await tick();
  b.getSnapshot().recordOutcome('current-B'); await idle(b);
  assert.equal(disk(f.backend, B).reviewNote, 'current-B'); empty(a);
});
test('Same owner new generation rejects old hydration and retained actions', async f => {
  seed(f.backend, A, 'original');
  const gate = f.backend.holdNext('getItem');
  const old = f.mount(await f.lease(A)); await gate.started; const oldActions = old.getSnapshot();
  const fresh = f.mount(await f.lease(A)); empty(old);
  gate.release(); await idle(fresh); await tick();
  fresh.getSnapshot().recordOutcome('new-generation'); await idle(fresh);
  oldActions.recordOutcome('stale'); assert.equal(await oldActions.resetLocalState(), false);
  assert.equal(disk(f.backend, A).reviewNote, 'new-generation'); empty(old);
});
test('Same owner new generation waits for stale write cleanup before hydrating/writing', async f => {
  const old = f.mount(await f.lease(A)); await idle(old);
  const gate = f.backend.holdNext('setItem'); old.getSnapshot().recordOutcome('stale'); await gate.started;
  const fresh = f.mount(await f.lease(A)); await tick(); empty(fresh);
  gate.release(); await idle(fresh);
  assert.deepEqual(fresh.getSnapshot().state, initialState);
  fresh.getSnapshot().recordOutcome('fresh'); await idle(fresh);
  assert.equal(disk(f.backend, A).reviewNote, 'fresh'); empty(old);
});
for (const [label, raw] of [
  ['wrong owner', owned(B, serializeState(privateState('B')))],
  ['wrong profile', owned({ ...A, profileId: B.profileId }, serializeState(privateState('B')))],
  ['outer schema', JSON.stringify({ schemaVersion: 2, owner: A, value: serializeState(initialState) })],
  ['missing envelope value', JSON.stringify({ schemaVersion: 1, owner: A })],
  ['invalid JSON', '{broken'],
  ['non-string domain value', owned(A, { schemaVersion: 1 })],
  ['empty string', owned(A, '')],
  ['domain schema', owned(A, JSON.stringify({ schemaVersion: 2, provenance: 'DEMO_LOCAL', state: initialState }))],
  ['invalid private field', owned(A, serializeState({ ...initialState, episodes: -1 }))],
  ['extra domain field', owned(A, serializeState({ ...initialState, foreignPrivateField: 'fixture' }))],
]) test('Corrupt ' + label + ' fails closed without overwriting original', async f => {
  f.backend.data.set(key(A), raw);
  const store = f.mount(await f.lease(A)); await idle(store); empty(store);
  assert.equal(store.getSnapshot().persistenceStatus, 'error');
  assert.equal(store.getSnapshot().decisionBundle.silenceReason, 'persistence_unavailable');
  store.getSnapshot().recordOutcome('ignored'); await tick();
  assert.equal(f.backend.data.get(key(A)), raw);
  assert.equal(f.backend.calls.filter(c => c.method !== 'getItem').length, 0);
});
test('Read failure preserves owner data and sanitizes error', async f => {
  seed(f.backend, A, 'fixture-private'); const before = f.backend.data.get(key(A));
  const gate = f.backend.holdNext('getItem', true), store = f.mount(await f.lease(A));
  await gate.started; gate.release(); await idle(store); empty(store);
  assert.equal(f.backend.data.get(key(A)), before);
  assert.ok(!store.getSnapshot().persistenceError.includes('private payload'));
});
test('Write failure silences recommendation, locks writes, and never clears other context data', async f => {
  f.backend.data.set(key(A, 'interaction-deleted-at'), 'marker');
  const store = f.mount(await f.lease(A)); await idle(store);
  const gate = f.backend.holdNext('setItem', true); store.getSnapshot().recordOutcome('failed');
  await gate.started; gate.release(); await idle(store);
  assert.equal(store.getSnapshot().persistenceStatus, 'error');
  assert.equal(store.getSnapshot().decisionBundle.recommendation, null);
  assert.ok(!store.getSnapshot().persistenceError.includes('private payload'));
  const count = f.backend.calls.length; store.getSnapshot().recordOutcome('ignored'); await tick();
  assert.equal(f.backend.calls.length, count);
  // The sealed adapter keeps I/O-uncertain namespaces quarantined. Do not clear all keys to recover.
  assert.equal(await store.getSnapshot().resetLocalState(), false); empty(store);
  assert.equal(f.backend.data.get(key(A, 'interaction-deleted-at')), 'marker');
});
test('Reset removes only A Development and invalidates pre-reset callbacks', async f => {
  seed(f.backend, A, 'A'); seed(f.backend, B, 'B');
  const preserved = [[key(B), f.backend.data.get(key(B))], [STORAGE_KEY, 'legacy'],
    [key(A, 'interaction'), 'interaction'], [key(A, 'interaction-deleted-at'), 'marker']];
  for (const [k, v] of preserved) f.backend.data.set(k, v);
  const store = f.mount(await f.lease(A)); await idle(store); const old = store.getSnapshot();
  assert.equal(await old.resetLocalState(), true);
  assert.deepEqual(store.getSnapshot().state, initialState);
  old.recordOutcome('retired'); assert.equal(await old.resetLocalState(), false); await tick();
  assert.equal(f.backend.data.has(key(A)), false);
  for (const [k, v] of preserved) assert.equal(f.backend.data.get(k), v);
  store.getSnapshot().recordOutcome('fresh-A'); await idle(store);
  assert.equal(disk(f.backend, A).reviewNote, 'fresh-A');
});
test('Delayed A reset cannot clear B or publish after switching', async f => {
  seed(f.backend, A, 'A'); seed(f.backend, B, 'B');
  const a = f.mount(await f.lease(A)); await idle(a);
  const gate = f.backend.holdNext('removeItem'), reset = a.getSnapshot().resetLocalState();
  empty(a); await gate.started;
  const b = f.mount(await f.lease(B)); await idle(b); gate.release();
  assert.equal(await reset, false); empty(a);
  assert.equal(b.getSnapshot().state.reviewNote, 'B'); assert.equal(disk(f.backend, B).reviewNote, 'B');
});
test('Reset during pending hydration discards late private read', async f => {
  seed(f.backend, A, 'A'); const gate = f.backend.holdNext('getItem');
  const store = f.mount(await f.lease(A)); await gate.started;
  const reset = store.getSnapshot().resetLocalState(); empty(store);
  gate.release(); assert.equal(await reset, true); await tick();
  assert.deepEqual(store.getSnapshot().state, initialState);
  assert.equal(f.backend.data.has(key(A)), false);
});
test('Reset waits behind pending writes; pre-reset action cannot recreate deleted state', async f => {
  const store = f.mount(await f.lease(A)); await idle(store);
  const gate = f.backend.holdNext('setItem'); store.getSnapshot().recordOutcome('pending'); await gate.started;
  const old = store.getSnapshot(), reset = old.resetLocalState(); empty(store);
  old.recordOutcome('ignored'); assert.equal(await store.getSnapshot().resetLocalState(), false);
  gate.release(); assert.equal(await reset, true); await tick();
  assert.equal(f.backend.data.has(key(A)), false);
  assert.deepEqual(f.backend.calls.filter(c => c.method !== 'getItem').map(c => c.method), ['setItem', 'removeItem']);
});
test('Reset failure is fail closed, sanitized, and does not claim deletion', async f => {
  seed(f.backend, A, 'A'); const store = f.mount(await f.lease(A)); await idle(store);
  const before = f.backend.data.get(key(A)), gate = f.backend.holdNext('removeItem', true);
  const reset = store.getSnapshot().resetLocalState(); await gate.started; gate.release();
  assert.equal(await reset, false); empty(store);
  assert.equal(store.getSnapshot().persistenceStatus, 'error');
  assert.equal(f.backend.data.get(key(A)), before);
  assert.ok(!store.getSnapshot().persistenceError.includes('private payload'));
});
test('Explicit reset can remove corrupt Development without importing legacy', async f => {
  f.backend.data.set(key(A), 'broken'); f.backend.data.set(STORAGE_KEY, 'legacy');
  const store = f.mount(await f.lease(A)); await idle(store); empty(store);
  assert.equal(await store.getSnapshot().resetLocalState(), true);
  assert.deepEqual(store.getSnapshot().state, initialState);
  assert.equal(f.backend.data.get(STORAGE_KEY), 'legacy'); assert.equal(f.backend.data.has(key(A)), false);
});
test('Reentrant action notification preserves chronological persistence order', async f => {
  const store = f.mount(await f.lease(A)); await idle(store);
  let fired = false;
  store.subscribe(() => {
    if (!fired && store.getSnapshot().state.reviewNote === 'first') {
      fired = true; store.getSnapshot().recordOutcome('second');
    }
  });
  store.getSnapshot().recordOutcome('first'); await idle(store);
  assert.equal(store.getSnapshot().state.reviewNote, 'second'); assert.equal(disk(f.backend, A).reviewNote, 'second');
});
test('Reentrant reset follows triggering action write and leaves no recreated key', async f => {
  const store = f.mount(await f.lease(A)); await idle(store); let reset;
  store.subscribe(() => {
    if (!reset && store.getSnapshot().state.reviewNote === 'trigger') reset = store.getSnapshot().resetLocalState();
  });
  store.getSnapshot().recordOutcome('trigger'); assert.ok(reset);
  assert.equal(await reset, true); await tick(); assert.equal(f.backend.data.has(key(A)), false);
});
test('Reentrant owner invalidation before backend work stops pending action and haptics', async f => {
  const store = f.mount(await f.lease(A)); await idle(store);
  store.subscribe(() => {
    if (store.getSnapshot().state.reviewNote === 'trigger') f.boundary.control.invalidateCurrentSession();
  });
  store.getSnapshot().recordOutcome('trigger'); empty(store); await tick();
  assert.equal(f.backend.data.has(key(A)), false); assert.equal(f.selections(), 0);
});
test('Latest write completion alone sets ready while later write is pending', async f => {
  const store = f.mount(await f.lease(A)); await idle(store);
  const first = f.backend.holdNext('setItem'); store.getSnapshot().recordOutcome('one'); await first.started;
  const second = f.backend.holdNext('setItem'); store.getSnapshot().recordOutcome('two');
  first.release(); await second.started; await tick();
  assert.equal(store.getSnapshot().persistenceStatus, 'loading');
  second.release(); await idle(store); assert.equal(disk(f.backend, A).reviewNote, 'two');
});
test('Stop/restart retires actions and late hydration, preserving Strict Mode lifecycle', async f => {
  seed(f.backend, A, 'A'); const gate = f.backend.holdNext('getItem');
  const store = f.mount(await f.lease(A)); await gate.started; const old = store.getSnapshot();
  store.stop(); empty(store); store.start(); gate.release(); await idle(store);
  old.recordOutcome('stale'); assert.equal(await old.resetLocalState(), false);
  assert.equal(store.getSnapshot().state.reviewNote, 'A');
  const count = f.backend.calls.length; store.start(); await tick(); assert.equal(f.backend.calls.length, count);
});
test('Suspended expiry is checked before snapshot or retained action can expose/change current state', async f => {
  seed(f.backend, A, 'A'); const store = f.mount(await f.lease(A)); await idle(store);
  const old = store.getSnapshot(), before = f.backend.data.get(key(A));
  f.clock.jumpWithoutTimers(1_000_001); old.recordOutcome('expired'); empty(store);
  assert.equal(await old.resetLocalState(), false); await tick(); assert.equal(f.backend.data.get(key(A)), before);
});
test('Public state, validation and nested decision bundle cannot bypass action guards', async f => {
  const store = f.mount(await f.lease(A)); await idle(store); const snapshot = store.getSnapshot();
  assert.throws(() => { snapshot.state.reviewNote = 'bypass'; }, TypeError);
  assert.throws(() => { snapshot.state.validationLog.fake = true; }, TypeError);
  assert.throws(() => { snapshot.decisionBundle.understanding.text = 'bypass'; }, TypeError);
  assert.throws(() => snapshot.decisionBundle.relevantContext.sources.push('calendar_demo'), TypeError);
  assert.ok(!Object.isFrozen(initialState)); assert.ok(!Object.isFrozen(initialState.validationLog));
});
test('Every existing Development action/decision preserves the unchanged reducer business semantics', async f => {
  const store = f.mount(await f.lease(A)); await idle(store); let expected = initialState;
  const suite = runAcceptanceSuite();
  const log = Object.fromEntries(suite.results.map(result => [result.id,
    result.pass && Boolean(suite.faultDetection.find(fault => fault.testId === result.id)?.detected)]));
  const steps = [
    ['setMode', ['silence'], { type: 'SET_MODE', mode: 'silence' }],
    ['completeAction', [], { type: 'COMPLETE_ACTION' }],
    ['correctInference', ['fixture-correction'], { type: 'CORRECT_INFERENCE', value: 'fixture-correction' }],
    ['revokeCalendar', [], { type: 'REVOKE_CALENDAR', at: f.clock.now() }],
    ['chooseTradeoff', ['recovery'], { type: 'CHOOSE_TRADEOFF', value: 'recovery' }],
    ['reduceLoad', [], { type: 'REDUCE_LOAD' }], ['recoverLoad', [], { type: 'RECOVER_LOAD' }],
    ['recordOutcome', [], { type: 'RECORD_OUTCOME', note: 'Có đủ khoảng trống để làm việc theo cách phù hợp.' }],
    ['recordOutcome', ['fixture-note'], { type: 'RECORD_OUTCOME', note: 'fixture-note' }],
    ...Array.from({ length: 3 }, () => ['createLearning', [], { type: 'ADD_POSITIVE_EPISODE' }]),
    ['contestClaim', [], { type: 'CONTEST_CLAIM' }], ['retractClaim', [], { type: 'RETRACT_CLAIM' }],
    ['startNewCycle', [], { type: 'START_NEW_CYCLE' }], ['runValidation', [], { type: 'SET_VALIDATION', log }],
  ];
  for (const [method, args, action] of steps) {
    expected = reduceGate7State(expected, action); store.getSnapshot()[method](...args); await idle(store);
    assert.deepEqual(store.getSnapshot().state, expected, method);
    assert.deepEqual(store.getSnapshot().decisionBundle, buildDecisionBundle(expected), method);
    assert.equal(JSON.parse(f.backend.data.get(key(A))).value, serializeState(expected), method);
  }
  assert.equal(f.selections(), steps.length);
  const rehydrated = f.mount(await f.lease(A)); await idle(rehydrated);
  assert.deepEqual(rehydrated.getSnapshot().state, hydrateState(serializeState(expected)));
  assert.equal(rehydrated.getSnapshot().state.validationRun, false);
});
test('Provider uses tested store/external snapshots and has no direct legacy persistence', async () => {
  const provider = await readFile(new URL('../context/DevelopmentContext.tsx', import.meta.url), 'utf8');
  assert.match(provider, /createDevelopmentStore/); assert.match(provider, /useSyncExternalStore/);
  assert.doesNotMatch(provider, /AsyncStorage\.(getItem|setItem|removeItem)|STORAGE_KEY/);
});

let passed = 0;
for (const { name, body } of tests) {
  const f = fixture();
  try { await body(f); passed++; console.log('PASS ' + name); }
  finally { f.cleanup(); }
}
console.log(`Development owner isolation: ${passed}/${tests.length} PASS`);
