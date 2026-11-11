import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { OWNER_A as A, OWNER_B as B, FakeClock, FakeStorage, fakeAuthority } from './fixtures/local-owner.mjs';

registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { createOpeningStore } = await import('../context/opening-owner/store.ts');
const { createCoachingStore } = await import('../context/coaching-owner/store.ts');
const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { initialOpeningState, serializeOpening, inspectOpening, OPENING_STORAGE_KEY } = await import('../domain/opening.ts');
const { initialCoachingState, serializeCoaching, inspectCoaching, COACHING_STORAGE_KEY } = await import('../domain/coaching.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); }
  assert.fail('controlled operation did not settle');
}
const key = (owner, slot) => `@100/v2/subject/${owner.subjectId}/profile/${owner.profileId}/${slot}`;
const owned = (owner, value) => JSON.stringify({ schemaVersion: 1, owner, value });
const openingState = marker => ({ ...initialOpeningState, status: 'completed', focusArea: 'work',
  need: 'stuck', path: 'clarify', usefulness: marker === 'A' ? 'useful' : 'unclear' });
const coachingState = marker => ({ ...initialCoachingState, status: 'domain_select', freeformStory: `PRIVATE-${marker}` });
function seed(backend, owner, slot, serialized) { backend.data.set(key(owner, slot), owned(owner, serialized)); }
function decode(backend, owner, slot) {
  const raw = backend.data.get(key(owner, slot));
  return raw === undefined ? undefined : JSON.parse(raw).value;
}
function fixture() {
  const clock = new FakeClock(), backend = new FakeStorage(), authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock); const stores = [];
  async function lease(owner, ready = true) {
    authority.results.push({ status: 'verified', owner, validUntil: clock.now() + 1_000_000 });
    const value = await boundary.control.verifySession(); if (ready) boundary.control.finishHydration(value); return value;
  }
  function mount(kind, value) {
    const create = kind === 'opening' ? createOpeningStore : createCoachingStore;
    const store = create({ owner: value ? { access: boundary.access, lease: value } : undefined, backend });
    stores.push(store); store.start(); return store;
  }
  return { clock, backend, boundary, lease, mount, cleanup: () => stores.forEach(store => store.stop()) };
}
async function settled(store) { await until(() => store.getSnapshot().hydrated
  && store.getSnapshot().ownerStorageState !== 'LOADING'); await tick(); }
const tests = [];
const test = (name, body) => tests.push({ name, body });

test('no owner and HYDRATING perform no personal I/O or mutation', async f => {
  const lockedO = f.mount('opening'), lockedC = f.mount('coaching');
  lockedO.getSnapshot().selectFocus('work'); lockedC.getSnapshot().startStory('PRIVATE');
  assert.equal(await lockedO.getSnapshot().forgetMemory(), false);
  assert.equal(await lockedC.getSnapshot().deleteData(), false);
  const lease = await f.lease(A, false), hydrating = f.mount('opening', lease);
  hydrating.getSnapshot().selectFocus('work'); await tick();
  assert.deepEqual(f.backend.calls, []);
});
test('A Opening logout then B sees only B and old callback is closed', async f => {
  seed(f.backend, A, 'opening', serializeOpening(openingState('A')));
  seed(f.backend, B, 'opening', serializeOpening(openingState('B')));
  const a = f.mount('opening', await f.lease(A)); await settled(a); const old = a.getSnapshot();
  assert.equal(old.state.usefulness, 'useful'); f.boundary.control.invalidateCurrentSession();
  assert.equal(a.getSnapshot().state.focusArea, null); old.selectNeed('ready');
  const b = f.mount('opening', await f.lease(B)); await settled(b);
  assert.equal(b.getSnapshot().state.usefulness, 'unclear'); assert.equal(await old.forgetMemory(), false);
});
test('A Coaching logout then B sees no A freeform text', async f => {
  seed(f.backend, A, 'coaching', serializeCoaching(coachingState('A')));
  seed(f.backend, B, 'coaching', serializeCoaching(coachingState('B')));
  const a = f.mount('coaching', await f.lease(A)); await settled(a); const old = a.getSnapshot();
  assert.equal(old.state.freeformStory, 'PRIVATE-A'); f.boundary.control.invalidateCurrentSession();
  assert.equal(a.getSnapshot().state.freeformStory, '');
  const b = f.mount('coaching', await f.lease(B)); await settled(b);
  assert.equal(b.getSnapshot().state.freeformStory, 'PRIVATE-B'); old.startStory('LATE-A');
  assert.equal(b.getSnapshot().state.freeformStory, 'PRIVATE-B');
});
test('same subject different profile remains isolated', async f => {
  const otherProfile = { subjectId: A.subjectId, profileId: 'fixture-profile-other' };
  seed(f.backend, A, 'coaching', serializeCoaching(coachingState('A')));
  const store = f.mount('coaching', await f.lease(otherProfile)); await settled(store);
  assert.equal(store.getSnapshot().state.freeformStory, '');
});
test('delayed A hydrate never publishes after owner retirement', async f => {
  seed(f.backend, A, 'opening', serializeOpening(openingState('A')));
  const gate = f.backend.holdNext('getItem'), a = f.mount('opening', await f.lease(A)); await gate.started;
  f.boundary.control.invalidateCurrentSession(); gate.release(); await tick(); await tick();
  assert.equal(a.getSnapshot().state.focusArea, null); assert.equal(a.getSnapshot().ownerStorageState, 'LOCKED');
});
test('delayed A write never lands in B namespace', async f => {
  const a = f.mount('coaching', await f.lease(A)); await settled(a);
  const gate = f.backend.holdNext('setItem'); a.getSnapshot().startStory('PRIVATE-A'); await gate.started;
  f.boundary.control.invalidateCurrentSession(); const b = f.mount('coaching', await f.lease(B)); await settled(b);
  gate.release(); await tick(); await tick();
  assert.equal(decode(f.backend, B, 'coaching'), undefined); assert.equal(b.getSnapshot().state.freeformStory, '');
});
test('A relogin restores valid A data when not deleted', async f => {
  seed(f.backend, A, 'opening', serializeOpening(openingState('A')));
  const first = f.mount('opening', await f.lease(A)); await settled(first);
  f.boundary.control.invalidateCurrentSession();
  const again = f.mount('opening', await f.lease(A)); await settled(again);
  assert.equal(again.getSnapshot().state.usefulness, 'useful');
});
for (const [kind, slot, legacy] of [
  ['opening', 'opening', OPENING_STORAGE_KEY], ['coaching', 'coaching', COACHING_STORAGE_KEY],
]) {
  test(`${kind} never reads or changes legacy global data`, async f => {
    f.backend.data.set(legacy, `LEGACY-${kind}`);
    const store = f.mount(kind, await f.lease(A)); await settled(store);
    assert.equal(f.backend.data.get(legacy), `LEGACY-${kind}`);
    assert.ok(f.backend.calls.every(call => call.key !== legacy));
    assert.equal(await (kind === 'opening' ? store.getSnapshot().forgetMemory() : store.getSnapshot().deleteData()), true);
    assert.equal(f.backend.data.get(legacy), `LEGACY-${kind}`);
    assert.ok(!f.backend.calls.some(call => call.method === 'getAllKeys'));
  });
}
for (const raw of ['', '{bad', JSON.stringify({ schemaVersion: 99 }), 42]) {
  test(`unreadable opening ${JSON.stringify(raw)} is preserved and write locked`, async f => {
    f.backend.data.set(key(A, 'opening'), owned(A, raw)); const before = f.backend.data.get(key(A, 'opening'));
    const store = f.mount('opening', await f.lease(A)); await settled(store);
    assert.equal(store.getSnapshot().ownerStorageState, 'ERROR'); assert.equal(store.getSnapshot().unreadableDataPreserved, true);
    store.getSnapshot().selectFocus('work'); await tick(); assert.equal(f.backend.data.get(key(A, 'opening')), before);
  });
}
test('empty coaching is unreadable, preserved, and explicitly deletable', async f => {
  f.backend.data.set(key(A, 'coaching'), owned(A, '')); const store = f.mount('coaching', await f.lease(A)); await settled(store);
  assert.equal(store.getSnapshot().ownerStorageState, 'ERROR'); store.getSnapshot().startStory('ignored');
  assert.equal(await store.getSnapshot().deleteData(), true); assert.equal(f.backend.data.has(key(A, 'coaching')), false);
});
test('read error fails closed and preserves owner slot', async f => {
  seed(f.backend, A, 'opening', serializeOpening(openingState('A'))); const before = f.backend.data.get(key(A, 'opening'));
  const gate = f.backend.holdNext('getItem', true), store = f.mount('opening', await f.lease(A));
  await gate.started; gate.release(); await settled(store);
  assert.equal(store.getSnapshot().ownerStorageState, 'ERROR'); assert.equal(f.backend.data.get(key(A, 'opening')), before);
});
test('delete removes only A slot and A relogin stays empty', async f => {
  seed(f.backend, A, 'opening', serializeOpening(openingState('A')));
  seed(f.backend, B, 'opening', serializeOpening(openingState('B'))); const bBytes = f.backend.data.get(key(B, 'opening'));
  const store = f.mount('opening', await f.lease(A)); await settled(store); const old = store.getSnapshot();
  assert.equal(await old.forgetMemory(), true); old.selectFocus('health');
  assert.equal(f.backend.data.has(key(A, 'opening')), false); assert.equal(f.backend.data.get(key(B, 'opening')), bBytes);
  f.boundary.control.invalidateCurrentSession(); const again = f.mount('opening', await f.lease(A)); await settled(again);
  assert.equal(again.getSnapshot().ownerStorageState, 'EMPTY');
});
test('pending write then delete is ordered and cannot resurrect', async f => {
  const store = f.mount('coaching', await f.lease(A)); await settled(store);
  const gate = f.backend.holdNext('setItem'); store.getSnapshot().startStory('PENDING-A'); await gate.started;
  const old = store.getSnapshot(), deletion = old.deleteData(); old.update({ freeformStory: 'STALE' });
  gate.release(); assert.equal(await deletion, true); await tick();
  assert.equal(f.backend.data.has(key(A, 'coaching')), false);
  assert.deepEqual(f.backend.calls.filter(call => ['setItem', 'removeItem'].includes(call.method)).map(call => call.method),
    ['setItem', 'removeItem']);
});
test('observer delete follows triggering write and leaves no record', async f => {
  const store = f.mount('opening', await f.lease(A)); await settled(store); let deletion;
  store.subscribe(() => {
    if (!deletion && store.getSnapshot().state.focusArea === 'work') deletion = store.getSnapshot().forgetMemory();
  });
  store.getSnapshot().selectFocus('work'); assert.ok(deletion); assert.equal(await deletion, true); await tick();
  assert.equal(f.backend.data.has(key(A, 'opening')), false);
});
test('old delete confirmation callback cannot delete B', async f => {
  seed(f.backend, B, 'coaching', serializeCoaching(coachingState('B')));
  const a = f.mount('coaching', await f.lease(A)); await settled(a); const oldDelete = a.getSnapshot().deleteData;
  f.boundary.control.invalidateCurrentSession(); const b = f.mount('coaching', await f.lease(B)); await settled(b);
  assert.equal(await oldDelete(), false); assert.equal(b.getSnapshot().state.freeformStory, 'PRIVATE-B');
  assert.ok(f.backend.data.has(key(B, 'coaching')));
});
test('same-owner relogin waits for pending cleanup and cannot adopt deleted bytes', async f => {
  seed(f.backend, A, 'opening', serializeOpening(openingState('A')));
  const first = f.mount('opening', await f.lease(A)); await settled(first);
  const gate = f.backend.holdNext('removeItem');
  const deletion = first.getSnapshot().forgetMemory(); await gate.started;
  f.boundary.control.invalidateCurrentSession();
  const again = f.mount('opening', await f.lease(A));
  gate.release(); assert.equal(await deletion, false); await settled(again);
  assert.equal(again.getSnapshot().ownerStorageState, 'EMPTY');
  assert.equal(again.getSnapshot().state.focusArea, null);
  assert.equal(f.backend.data.has(key(A, 'opening')), false);
});
test('delete backend failure is truthful and preserves the exact owner slot', async f => {
  seed(f.backend, A, 'coaching', serializeCoaching(coachingState('A')));
  const before = f.backend.data.get(key(A, 'coaching'));
  const store = f.mount('coaching', await f.lease(A)); await settled(store);
  const gate = f.backend.holdNext('removeItem', true);
  const deletion = store.getSnapshot().deleteData(); await gate.started; gate.release();
  assert.equal(await deletion, false);
  assert.equal(store.getSnapshot().ownerStorageState, 'ERROR');
  assert.equal(store.getSnapshot().unreadableDataPreserved, true);
  assert.equal(f.backend.data.get(key(A, 'coaching')), before);
});
test('lease expiry retires synchronously before retained action', async f => {
  seed(f.backend, A, 'coaching', serializeCoaching(coachingState('A')));
  const store = f.mount('coaching', await f.lease(A)); await settled(store); const old = store.getSnapshot();
  f.clock.jumpWithoutTimers(1_000_001); old.startStory('EXPIRED');
  assert.equal(store.getSnapshot().ownerStorageState, 'LOCKED'); assert.equal(store.getSnapshot().state.freeformStory, '');
});
test('Strict Mode stop/start has no default writes and old projection retires', async f => {
  const store = f.mount('opening', await f.lease(A)); await settled(store); const old = store.getSnapshot();
  assert.equal(f.backend.calls.filter(call => call.method === 'setItem').length, 0);
  store.stop(); store.start(); await settled(store); old.selectFocus('work'); await tick();
  assert.equal(f.backend.calls.filter(call => call.method === 'setItem').length, 0);
});
test('domain inspectors distinguish missing from unreadable', async () => {
  assert.equal(inspectOpening(null).kind, 'empty'); assert.equal(inspectOpening('').kind, 'unreadable');
  assert.equal(inspectCoaching(null).kind, 'empty'); assert.equal(inspectCoaching('').kind, 'unreadable');
});
test('providers use external stores and contain no global persistence fallback', async () => {
  const files = await Promise.all(['OpeningContext.tsx', 'CoachingContext.tsx'].map(name =>
    readFile(new URL(`../context/${name}`, import.meta.url), 'utf8')));
  for (const source of files) {
    assert.match(source, /useSyncExternalStore/); assert.doesNotMatch(source, /AsyncStorage\.(getItem|setItem|removeItem)/);
    assert.doesNotMatch(source, /@100-human-development-(?:opening|coaching)/);
  }
});

let passed = 0;
for (const { name, body } of tests) {
  const f = fixture();
  try { await body(f); passed++; console.log(`PASS ${name}`); } finally { f.cleanup(); }
}
console.log(`Opening/Coaching owner isolation: ${passed}/${tests.length} PASS`);
