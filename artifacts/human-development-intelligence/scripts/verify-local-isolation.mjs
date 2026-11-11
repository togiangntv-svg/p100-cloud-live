import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createLocalOwnerBoundary } from '../domain/local-owner/boundary.ts';
import { OWNER_A as A, OWNER_B as B, FakeClock, FakeStorage, fakeAuthority, deferred } from './fixtures/local-owner.mjs';

const storageUrl = new URL('../domain/local-owner/storage.ts', import.meta.url).href;
const loader = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === storageUrl && specifier === './boundary') specifier += '.ts';
  return next(specifier, context);
} });
const { createGuardedUserStorage, USER_DATA_KEYS } = await import(storageUrl);
loader.deregister();
const errorCode = code => error => error?.name === 'LocalIsolationError' && error.code === code && error.message === code;
const prefix = owner => '@100/v2/subject/' + owner.subjectId + '/profile/' + owner.profileId + '/';
const envelope = (owner, value, schemaVersion = 1) => JSON.stringify({ owner, value, schemaVersion });

function harness(t, storage = new FakeStorage()) {
  const clock = new FakeClock(), authority = fakeAuthority();
  const { access, control } = createLocalOwnerBoundary(authority.verifier, clock);
  const adapter = createGuardedUserStorage(access, storage);
  t.after(() => control.invalidateCurrentSession());
  return {
    clock, authority, access, control, storage, adapter,
    async login(owner = A, ready = true, ttl = 100) {
      authority.results.push({ status: 'verified', owner, validUntil: clock.now() + ttl });
      const lease = await control.verifySession();
      if (ready) control.finishHydration(lease);
      return lease;
    },
  };
}

test('01: initial LOCKED state rejects missing/fabricated leases without touching backend', async t => {
  const h = harness(t);
  assert.deepEqual(h.access.getSnapshot(), { phase: 'LOCKED', generation: 0 });
  for (const fake of [undefined, null, {}, { subjectId: A.subjectId, profileId: A.profileId, generation: 0 }]) {
    await assert.rejects(h.adapter.readUserState(fake, 'state'), errorCode('INVALID_LEASE'));
    await assert.rejects(h.adapter.writeUserState(fake, 'state', 'x'), errorCode('INVALID_LEASE'));
    await assert.rejects(h.adapter.removeUserState(fake, 'state'), errorCode('INVALID_LEASE'));
    await assert.rejects(h.adapter.clearOwnerNamespace(fake), errorCode('INVALID_LEASE'));
  }
  assert.equal(h.storage.calls.length, 0);
});
test('02: VERIFYING retires old lease and blocks hydration until authority resolves', async t => {
  const h = harness(t), old = await h.login(), pending = deferred();
  h.authority.results.push(() => pending.promise);
  const verifying = h.control.verifySession();
  assert.equal(h.access.getSnapshot().phase, 'VERIFYING');
  await assert.rejects(h.adapter.readUserState(old, 'state'), errorCode('STALE_LEASE'));
  pending.resolve({ status: 'verified', owner: B, validUntil: 1100 });
  const lease = await verifying;
  assert.equal(h.access.getSnapshot().phase, 'HYDRATING');
  assert.equal(await h.adapter.readUserState(lease, 'state'), null);
  h.control.finishHydration(lease);
  assert.equal(h.access.getSnapshot().phase, 'READY');
});
test('03: A reads/writes all approved keys only in A namespace; snapshot is immutable', async t => {
  const h = harness(t), lease = await h.login();
  for (const key of USER_DATA_KEYS) {
    await h.adapter.writeUserState(lease, key, { fixture: key });
    assert.deepEqual(await h.adapter.readUserState(lease, key), { fixture: key });
    assert.deepEqual(JSON.parse(h.storage.data.get(prefix(A) + key)).owner, A);
  }
  assert.ok([...h.storage.data.keys()].every(k => k.startsWith(prefix(A))));
  assert.ok(Object.isFrozen(lease));
  assert.ok(Object.isFrozen(h.access.getSnapshot().owner));
  assert.throws(() => { h.access.getSnapshot().owner.subjectId = B.subjectId; }, TypeError);
});
test('04: B cannot inherit A after switch, including all approved keys', async t => {
  const h = harness(t), a = await h.login(A);
  for (const key of USER_DATA_KEYS) await h.adapter.writeUserState(a, key, 'fixture A');
  const b = await h.login(B);
  for (const key of USER_DATA_KEYS) assert.equal(await h.adapter.readUserState(b, key), null);
  await h.adapter.writeUserState(b, 'state', 'fixture B');
  assert.equal(JSON.parse(h.storage.data.get(prefix(A) + 'state')).value, 'fixture A');
  assert.equal(await h.adapter.readUserState(b, 'state'), 'fixture B');
});
test('05: stale lease fails read/write/remove/clear and cannot publish RAM state', async t => {
  const h = harness(t), a = await h.login();
  h.control.invalidateCurrentSession();
  const generation = h.access.getSnapshot().generation;
  const b = await h.login(B);
  assert.ok(h.access.getSnapshot().generation > generation);
  for (const task of [
    () => h.adapter.readUserState(a, 'state'), () => h.adapter.writeUserState(a, 'state', 'old'),
    () => h.adapter.removeUserState(a, 'state'), () => h.adapter.clearOwnerNamespace(a),
  ]) await assert.rejects(task(), errorCode('STALE_LEASE'));
  let current = 'B';
  assert.throws(() => h.access.applyIfCurrent(a, () => { current = 'A'; }), errorCode('STALE_LEASE'));
  h.access.applyIfCurrent(b, () => { current = 'B fresh'; });
  assert.equal(current, 'B fresh');
});
test('06: same Subject relogin has a new generation and invalidates callbacks', async t => {
  const h = harness(t), old = await h.login();
  const generation = h.access.getSnapshot().generation;
  const fresh = await h.login();
  assert.ok(h.access.getSnapshot().generation > generation);
  await assert.rejects(h.adapter.readUserState(old, 'state'), errorCode('STALE_LEASE'));
  assert.throws(() => h.control.finishHydration(old), errorCode('STALE_LEASE'));
  assert.equal(await h.adapter.readUserState(fresh, 'state'), null);
});
test('07: delayed A hydration finishing after B login is discarded', async t => {
  const h = harness(t), a = await h.login(A, false);
  h.storage.data.set(prefix(A) + 'state', envelope(A, 'fixture A'));
  const gate = h.storage.holdNext('getItem');
  const reading = h.adapter.readUserState(a, 'state');
  const rejected = assert.rejects(reading, errorCode('STALE_LEASE'));
  await gate.started;
  const b = await h.login(B);
  gate.release();
  await rejected;
  assert.equal(await h.adapter.readUserState(b, 'state'), null);
});
test('08: delayed A write never lands in B; stale written value is removed', async t => {
  const h = harness(t), a = await h.login();
  const gate = h.storage.holdNext('setItem');
  const writing = h.adapter.writeUserState(a, 'state', 'fixture A');
  const rejected = assert.rejects(writing, errorCode('STALE_LEASE'));
  await gate.started;
  const b = await h.login(B);
  await h.adapter.writeUserState(b, 'state', 'fixture B');
  gate.release();
  await rejected;
  assert.equal(h.storage.data.has(prefix(A) + 'state'), false);
  assert.equal(await h.adapter.readUserState(b, 'state'), 'fixture B');
});
test('09: queued stale A write never calls backend', async t => {
  const h = harness(t), a = await h.login();
  const gate = h.storage.holdNext('setItem');
  const first = assert.rejects(h.adapter.writeUserState(a, 'state', 'first'), errorCode('STALE_LEASE'));
  await gate.started;
  const second = assert.rejects(h.adapter.writeUserState(a, 'opening', 'queued'), errorCode('STALE_LEASE'));
  await h.login(B);
  gate.release();
  await Promise.all([first, second]);
  assert.equal(h.storage.calls.filter(c => c.method === 'setItem').length, 1);
});
test('10: same-owner relogin waits for stale write cleanup before new work', async t => {
  const h = harness(t), old = await h.login();
  const gate = h.storage.holdNext('setItem');
  const stale = assert.rejects(h.adapter.writeUserState(old, 'state', 'old'), errorCode('STALE_LEASE'));
  await gate.started;
  const fresh = await h.login();
  const next = h.adapter.writeUserState(fresh, 'state', 'fresh');
  gate.release();
  await Promise.all([stale, next]);
  assert.equal(await h.adapter.readUserState(fresh, 'state'), 'fresh');
  assert.deepEqual(h.storage.calls.slice(0, 3).map(c => c.method), ['setItem', 'removeItem', 'setItem']);
});
test('11: forged clones and a real lease from another boundary are rejected', async t => {
  const h = harness(t), other = harness(t), lease = await h.login(), foreign = await other.login();
  for (const fake of [{ ...lease }, Object.create(lease), foreign]) {
    await assert.rejects(h.adapter.readUserState(fake, 'state'), errorCode('INVALID_LEASE'));
  }
});
test('12: corrupt owner metadata, schema and malformed JSON fail closed', async t => {
  const h = harness(t), lease = await h.login();
  for (const raw of [
    envelope(B, 'foreign'), envelope({ ...A, profileId: B.profileId }, 'foreign'),
    envelope(A, 'x', 2), envelope(A, 'x', '1'), '{broken', '{}', '[]',
    JSON.stringify({ schemaVersion: 1, owner: A }),
    '{"schemaVersion":1,"owner":' + JSON.stringify(A) + ',"value":1e400}',
  ]) {
    h.storage.data.set(prefix(A) + 'state', raw);
    await assert.rejects(h.adapter.readUserState(lease, 'state'), errorCode('CORRUPT_DATA'));
    assert.equal(h.storage.data.get(prefix(A) + 'state'), raw); // No silent overwrite.
  }
});
test('13: expiry timer invalidates HYDRATING and READY without a storage call', async t => {
  for (const ready of [false, true]) {
    const h = harness(t), lease = await h.login(A, ready);
    const generation = h.access.getSnapshot().generation;
    let observed;
    h.access.subscribe(() => { observed = h.access.getSnapshot().phase; });
    h.clock.advance(100);
    assert.equal(observed, 'LOCKED');
    assert.ok(h.access.getSnapshot().generation > generation);
    await assert.rejects(h.adapter.readUserState(lease, 'state'), errorCode('STALE_LEASE'));
  }
});
test('14: suspended expiry timer is backed by access-time expiry checks', async t => {
  const h = harness(t), lease = await h.login();
  h.clock.jumpWithoutTimers(100);
  await assert.rejects(h.adapter.writeUserState(lease, 'state', 'expired'), errorCode('STALE_LEASE'));
  assert.equal(h.access.getSnapshot().phase, 'LOCKED');
  assert.equal(h.storage.calls.length, 0);
});
test('15: revoke primitive immediately locks, retires leases and cancels expiry', async t => {
  const h = harness(t), lease = await h.login();
  h.control.invalidateCurrentSession();
  assert.equal(h.access.getSnapshot().phase, 'LOCKED');
  assert.equal(h.clock.timers.size, 0);
  await assert.rejects(h.adapter.readUserState(lease, 'state'), errorCode('STALE_LEASE'));
});
test('16: missing/expired/revoked/unknown/failed verification leaves LOCKED', async t => {
  const h = harness(t);
  for (const result of [
    ...['missing', 'expired', 'revoked', 'unknown'].map(status => ({ status })),
    { status: 'verified', owner: A, validUntil: 1000 },
    { status: 'verified', owner: A, validUntil: Infinity },
    { status: 'verified', owner: { ...A, subjectId: '../foreign' }, validUntil: 1100 },
    { status: 'verified', owner: { ...A, profileId: '' }, validUntil: 1100 },
    () => { throw new Error('must not expose secret'); },
  ]) {
    h.authority.results.push(result);
    await assert.rejects(h.control.verifySession(), errorCode('AUTHORITY_UNAVAILABLE'));
    assert.equal(h.access.getSnapshot().phase, 'LOCKED');
  }
});
test('17: late verification A cannot replace verified B or relock B', async t => {
  const h = harness(t), gate = deferred();
  h.authority.results.push(() => gate.promise);
  const old = assert.rejects(h.control.verifySession(), errorCode('STALE_LEASE'));
  const b = await h.login(B);
  assert.equal(h.authority.signals[0].aborted, true);
  gate.resolve({ status: 'verified', owner: A, validUntil: 1100 });
  await old;
  assert.deepEqual(h.access.requireLease(b).owner, B);
  assert.equal(h.access.getSnapshot().phase, 'READY');
});
test('18: legacy and locale stay untouched; no namespace/global fallback', async t => {
  const h = harness(t);
  const legacy = ['state', 'opening', 'coaching', 'interaction', 'interaction-deleted-at',
    'opening-goal-draft', 'opening-goal-flow', 'welcome', 'locale'];
  for (const key of legacy) h.storage.data.set('@100-human-development-' + key, 'legacy fixture');
  const before = [...h.storage.data];
  const lease = await h.login();
  for (const key of USER_DATA_KEYS) assert.equal(await h.adapter.readUserState(lease, key), null);
  await h.adapter.writeUserState(lease, 'state', 'owned');
  await h.adapter.clearOwnerNamespace(lease);
  assert.deepEqual([...h.storage.data], before);
});
test('19: no arbitrary path/data key or locale key can be supplied', async t => {
  const h = harness(t), lease = await h.login();
  for (const key of ['locale', '../state', prefix(B) + 'state', '@100-human-development-state', '', null]) {
    await assert.rejects(h.adapter.readUserState(lease, key), errorCode('INVALID_KEY'));
    await assert.rejects(h.adapter.writeUserState(lease, key, 'x'), errorCode('INVALID_KEY'));
    await assert.rejects(h.adapter.removeUserState(lease, key), errorCode('INVALID_KEY'));
  }
  assert.equal(h.storage.calls.length, 0);
});
test('20: same Subject different Profile is a distinct namespace', async t => {
  const h = harness(t), a = await h.login();
  await h.adapter.writeUserState(a, 'state', 'profile A');
  const other = { subjectId: A.subjectId, profileId: 'fixture-profile-other' };
  const b = await h.login(other);
  assert.equal(await h.adapter.readUserState(b, 'state'), null);
  await h.adapter.clearOwnerNamespace(b);
  assert.equal(JSON.parse(h.storage.data.get(prefix(A) + 'state')).value, 'profile A');
});
test('21: remove and clear never touch another owner or similar prefix', async t => {
  const h = harness(t), a = await h.login();
  await h.adapter.writeUserState(a, 'state', 'remove me');
  await h.adapter.removeUserState(a, 'state');
  assert.equal(await h.adapter.readUserState(a, 'state'), null);
  h.storage.data.set(prefix(A) + 'opening', envelope(A, 'clear me'));
  h.storage.data.set(prefix(B) + 'opening', envelope(B, 'keep B'));
  h.storage.data.set(prefix({ ...A, profileId: A.profileId + '-other' }) + 'state', 'keep profile');
  await h.adapter.clearOwnerNamespace(a);
  assert.equal(h.storage.data.has(prefix(A) + 'opening'), false);
  assert.equal(h.storage.data.size, 2);
});
test('22: writes are serial and snapshot the input before waiting', async t => {
  const h = harness(t), lease = await h.login(), gate = h.storage.holdNext('setItem');
  const first = h.adapter.writeUserState(lease, 'state', 'first');
  await gate.started;
  const value = { text: 'captured' };
  const second = h.adapter.writeUserState(lease, 'state', value);
  value.text = 'mutated later';
  assert.equal(h.storage.calls.filter(c => c.method === 'setItem').length, 1);
  gate.release();
  await Promise.all([first, second]);
  assert.deepEqual(await h.adapter.readUserState(lease, 'state'), { text: 'captured' });
});
test('23: multiple adapters sharing a backend also share the namespace barrier', async t => {
  const h = harness(t), lease = await h.login(), gate = h.storage.holdNext('setItem');
  const other = createGuardedUserStorage(h.access, h.storage);
  const writing = h.adapter.writeUserState(lease, 'state', 'value');
  await gate.started;
  const clearing = other.clearOwnerNamespace(lease);
  gate.release();
  await Promise.all([writing, clearing]);
  assert.equal(await h.adapter.readUserState(lease, 'state'), null);
});
test('24: stale write cleanup failure quarantines same owner but does not block B', async t => {
  const h = harness(t), old = await h.login(), write = h.storage.holdNext('setItem');
  const stale = assert.rejects(h.adapter.writeUserState(old, 'state', 'old'), errorCode('NAMESPACE_QUARANTINED'));
  await write.started;
  const cleanup = h.storage.holdNext('removeItem', true);
  const fresh = await h.login();
  write.release();
  await cleanup.started;
  cleanup.release();
  await stale;
  await assert.rejects(h.adapter.readUserState(fresh, 'state'), errorCode('NAMESPACE_QUARANTINED'));
  const b = await h.login(B);
  await h.adapter.writeUserState(b, 'state', 'B');
  const a = await h.login();
  await h.adapter.clearOwnerNamespace(a);
  assert.equal(await h.adapter.readUserState(a, 'state'), null);
  assert.equal(JSON.parse(h.storage.data.get(prefix(B) + 'state')).value, 'B');
});
test('25: storage errors are redacted; later explicit clear recovers quarantine', async t => {
  const h = harness(t), lease = await h.login(), failed = h.storage.holdNext('setItem', true);
  const writing = assert.rejects(h.adapter.writeUserState(lease, 'state', 'x'), errorCode('STORAGE_UNAVAILABLE'));
  await failed.started;
  failed.release();
  await writing;
  await assert.rejects(h.adapter.writeUserState(lease, 'state', 'x'), errorCode('NAMESPACE_QUARANTINED'));
  await h.adapter.clearOwnerNamespace(lease);
  await h.adapter.writeUserState(lease, 'state', 'recovered');
  assert.equal(await h.adapter.readUserState(lease, 'state'), 'recovered');
});
test('26: clear finishing enumeration after invalidation cannot delete anything', async t => {
  const h = harness(t), a = await h.login(), gate = h.storage.holdNext('getAllKeys');
  h.storage.data.set(prefix(A) + 'state', envelope(A, 'A'));
  const clearing = assert.rejects(h.adapter.clearOwnerNamespace(a), errorCode('STALE_LEASE'));
  await gate.started;
  await h.login(B);
  gate.release();
  await clearing;
  assert.equal(h.storage.calls.filter(c => c.method === 'removeItem').length, 0);
});
test('27: delayed remove stays in captured A namespace and blocks same-owner writes', async t => {
  const h = harness(t), a = await h.login(), gate = h.storage.holdNext('removeItem');
  h.storage.data.set(prefix(A) + 'state', envelope(A, 'A'));
  const removing = assert.rejects(h.adapter.removeUserState(a, 'state'), errorCode('STALE_LEASE'));
  await gate.started;
  const fresh = await h.login();
  const writing = h.adapter.writeUserState(fresh, 'state', 'fresh');
  gate.release();
  await Promise.all([removing, writing]);
  assert.equal(await h.adapter.readUserState(fresh, 'state'), 'fresh');
});
test('28: restart begins LOCKED even with owned storage present; no authority is persisted', async t => {
  const storage = new FakeStorage(), first = harness(t, storage), a = await first.login();
  await first.adapter.writeUserState(a, 'state', 'A persisted');
  const restarted = harness(t, storage);
  assert.equal(restarted.access.getSnapshot().phase, 'LOCKED');
  await assert.rejects(restarted.adapter.readUserState(a, 'state'), errorCode('INVALID_LEASE'));
  const b = await restarted.login(B);
  assert.equal(await restarted.adapter.readUserState(b, 'state'), null);
  const a2 = await restarted.login(A);
  assert.equal(await restarted.adapter.readUserState(a2, 'state'), 'A persisted');
  assert.deepEqual([...storage.data.keys()], [prefix(A) + 'state']);
});
test('29: non-JSON payloads rejected before storage; malformed data cannot poison queue', async t => {
  const h = harness(t), lease = await h.login(), cyclic = {};
  cyclic.self = cyclic;
  for (const value of [undefined, NaN, Infinity, BigInt(1), () => 1, cyclic, { invalid: undefined }]) {
    await assert.rejects(h.adapter.writeUserState(lease, 'state', value), errorCode('INVALID_DATA'));
  }
  assert.equal(h.storage.calls.length, 0);
  await h.adapter.writeUserState(lease, 'state', { valid: [null, 1, true, 'text'] });
});
test('30: expiry during delayed write discards caller result and cleans old data', async t => {
  const h = harness(t), lease = await h.login(), gate = h.storage.holdNext('setItem');
  const writing = assert.rejects(h.adapter.writeUserState(lease, 'state', 'expired'), errorCode('STALE_LEASE'));
  await gate.started;
  h.clock.advance(100);
  gate.release();
  await writing;
  assert.equal(h.storage.data.size, 0);
});
test('31: callers must recheck at publication even after a successful read', async t => {
  const h = harness(t), a = await h.login();
  await h.adapter.writeUserState(a, 'state', 'A');
  const value = await h.adapter.readUserState(a, 'state');
  await h.login(B);
  let rendered = null;
  assert.throws(() => h.access.applyIfCurrent(a, () => { rendered = value; }), errorCode('STALE_LEASE'));
  assert.equal(rendered, null);
});
test('32: observer failure cannot prevent locking; old timers cannot lock a new session', async t => {
  const h = harness(t);
  await h.login(A, true, 10);
  h.access.subscribe(() => { throw new Error('observer failure'); });
  const b = await h.login(B, true, 100);
  h.clock.advance(10);
  assert.deepEqual(h.access.requireLease(b).owner, B);
  h.control.invalidateCurrentSession();
  assert.equal(h.access.getSnapshot().phase, 'LOCKED');
});
test('33: fixture authority is outside production modules and no runtime wiring is added', async () => {
  for (const name of ['boundary.ts', 'storage.ts']) {
    const source = await readFile(new URL('../domain/local-owner/' + name, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"].*(fixtures|api-client|SecureStore|async-storage)/);
    assert.doesNotMatch(source, /console\.(log|error|warn)/);
  }
});
