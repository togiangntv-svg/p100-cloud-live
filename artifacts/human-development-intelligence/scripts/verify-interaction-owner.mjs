// Deterministic tests of the exact store consumed by InteractionContext.
// In-memory authority/storage/API only. Never use production authentication or user data.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { OWNER_A as A, OWNER_B as B, FakeClock, FakeStorage, fakeAuthority, deferred } from './fixtures/local-owner.mjs';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && /\/(interaction|boundary|storage)$/.test(specifier)) {
      return nextResolve(specifier + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});
const { createInteractionStore } = await import('../context/interaction-owner/store.ts');
const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { createInitialInteractionState, appendUserMessage, serializeInteraction, grantAiContextConsent } =
  await import('../domain/interaction.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); }
  assert.fail('Controlled operation did not settle');
}
async function idle(store) {
  await until(() => store.getSnapshot().hydrated && store.getSnapshot().persistenceStatus !== 'loading');
  await tick();
}
const key = (owner, name = 'interaction') =>
  `@100/v2/subject/${owner.subjectId}/profile/${owner.profileId}/${name}`;
const iso = ms => new Date(ms).toISOString();
function seed(backend, owner, text, consent = false) {
  let state = appendUserMessage(createInitialInteractionState(iso(500)), text, iso(600));
  if (consent) state = grantAiContextConsent(state, iso(700));
  backend.data.set(key(owner), JSON.stringify({ schemaVersion: 1, owner, value: serializeInteraction(state) }));
}
function decoded(backend, owner, name = 'interaction') {
  const raw = backend.data.get(key(owner, name));
  return raw === undefined ? undefined : JSON.parse(raw).value;
}
function privateEmpty(store) {
  const snap = store.getSnapshot();
  assert.deepEqual(snap.state.messages, []);
  assert.deepEqual(snap.state.understandings, []);
  assert.equal(snap.state.goal, null);
  assert.equal(snap.state.aiConsent, 'not_asked');
  assert.equal(snap.state.pendingRequest, null);
  assert.equal(snap.aiBusy, false);
}
function apiFixture() {
  const calls = [], status = [], pilot = [], respond = [];
  const invoke = async (kind, body, options) => {
    calls.push({ kind, body, signal: options.signal });
    const result = ({ status, pilot, respond })[kind].shift();
    if (result) return result.promise; // Intentionally ignore abort: generation guards must suffice.
    if (kind === 'status') return { availability: 'not_connected', remainingLiveCalls: 4 };
    if (kind === 'respond') return { requestId: body.requestId, text: 'fixture-answer' };
    return {};
  };
  return { calls, status, pilot, respond, api: {
    status: options => invoke('status', undefined, options),
    pilot: (body, options) => invoke('pilot', body, options),
    respond: (body, options) => invoke('respond', body, options),
  } };
}
function fixture() {
  const clock = new FakeClock(), backend = new FakeStorage(), authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  const stores = []; let sequence = 0;
  async function lease(owner, ready = true) {
    authority.results.push({ status: 'verified', owner, validUntil: clock.now() + 1_000_000 });
    const value = await boundary.control.verifySession();
    if (ready) boundary.control.finishHydration(value);
    return value;
  }
  function mount(value, api = apiFixture()) {
    const store = createInteractionStore({ owner: value ? { access: boundary.access, lease: value } : undefined,
      backend, api: api.api, now: clock.now, newId: prefix => `${prefix}-fixture-${++sequence}` });
    stores.push(store); store.start(); return { store, api };
  }
  return { clock, backend, authority, boundary, lease, mount,
    cleanup: () => stores.forEach(store => store.stop()) };
}
const tests = [];
const test = (name, body) => tests.push({ name, body });
test('No supplied authority: LOCKED, no storage or API, actions fail closed', async f => {
  const { store, api } = f.mount();
  privateEmpty(store); assert.equal(store.getSnapshot().hydrated, false);
  assert.equal(await store.getSnapshot().addUserMessage('fixture', 'vi'), false);
  assert.equal(await store.getSnapshot().enableAiPilot('vi'), false);
  assert.equal(await store.getSnapshot().deleteData(), false);
  assert.equal(store.getSnapshot().saveGoal('g', 'a'), false);
  store.getSnapshot().setAiConsent('granted');
  assert.equal(f.backend.calls.length, 0); assert.equal(api.calls.length, 0);
});
test('Fake lease cannot read storage even while boundary READY', async f => {
  await f.lease(A);
  const { store } = f.mount({});
  privateEmpty(store); assert.equal(store.getSnapshot().hydrated, false);
  assert.equal(f.backend.calls.length, 0);
});
test('Boundary HYDRATING stays private until READY, then A writes only A namespace', async f => {
  const lease = await f.lease(A, false);
  const { store } = f.mount(lease);
  privateEmpty(store); assert.equal(f.backend.calls.length, 0);
  f.boundary.control.finishHydration(lease); await idle(store);
  assert.equal(await store.getSnapshot().addUserMessage('fixture-A-private', 'vi'), true);
  await idle(store);
  assert.match(decoded(f.backend, A), /fixture-A-private/);
  assert.ok(f.backend.calls.every(call => call.key.startsWith(key(A, ''))));
  assert.equal(decoded(f.backend, B), undefined);
});
test('A to B: synchronous RAM retirement, old callbacks closed, B inherits no A consent', async f => {
  seed(f.backend, A, 'fixture-A-private', true);
  const { store: a } = f.mount(await f.lease(A)); await idle(a);
  const old = a.getSnapshot();
  f.boundary.control.invalidateCurrentSession(); privateEmpty(a);
  assert.equal(a.getSnapshot().hydrated, false);
  assert.equal(old.saveGoal('old', 'old'), false);
  old.setAiConsent('granted');
  const { store: b } = f.mount(await f.lease(B)); privateEmpty(b); await idle(b);
  privateEmpty(b);
  assert.equal(await old.addUserMessage('old', 'vi'), false);
  assert.equal(await old.deleteData(), false);
});
test('READY B restores only B history; A consent/history cannot cross', async f => {
  seed(f.backend, A, 'fixture-A-private', true); seed(f.backend, B, 'fixture-B-private');
  const { store } = f.mount(await f.lease(B)); await idle(store);
  assert.equal(store.getSnapshot().state.messages[0].text, 'fixture-B-private');
  assert.equal(store.getSnapshot().state.aiConsent, 'not_asked');
  assert.ok(f.backend.calls.every(call => call.key.startsWith(key(B, ''))));
});
test('Delayed A hydration after B starts cannot publish A', async f => {
  seed(f.backend, A, 'fixture-A-private'); seed(f.backend, B, 'fixture-B-private');
  const gate = f.backend.holdNext('getItem');
  const { store: a } = f.mount(await f.lease(A)); await gate.started;
  const { store: b } = f.mount(await f.lease(B)); await idle(b);
  const before = b.getSnapshot(); gate.release(); await tick(); await tick();
  privateEmpty(a); assert.equal(b.getSnapshot(), before);
});
for (const result of ['success', 'error']) {
  test(`Delayed A AI ${result}, consent and finally cannot alter busy B`, async f => {
    const apiA = apiFixture(), waitA = deferred(); apiA.respond.push(waitA);
    const { store: a } = f.mount(await f.lease(A), apiA); await idle(a);
    a.getSnapshot().setAiConsent('granted'); await idle(a);
    const pendingA = a.getSnapshot().addUserMessage('fixture-A-private', 'vi');
    assert.equal(a.getSnapshot().aiBusy, true);
    const apiB = apiFixture(), waitB = deferred(); apiB.respond.push(waitB);
    const { store: b } = f.mount(await f.lease(B), apiB); await idle(b);
    b.getSnapshot().setAiConsent('granted'); await idle(b);
    const pendingB = b.getSnapshot().addUserMessage('fixture-B-private', 'vi');
    await until(() => b.getSnapshot().persistenceStatus === 'ready');
    const before = b.getSnapshot(), disk = decoded(f.backend, B);
    const reqA = apiA.calls.find(call => call.kind === 'respond');
    assert.equal(reqA.signal.aborted, true);
    result === 'success' ? waitA.resolve({ requestId: reqA.body.requestId, text: 'fixture-A-answer' })
      : waitA.reject({ body: { code: 'AI_BUDGET_EXHAUSTED' } });
    assert.equal(await pendingA, false); await tick();
    privateEmpty(a); assert.equal(b.getSnapshot(), before);
    assert.equal(b.getSnapshot().aiBusy, true); assert.equal(decoded(f.backend, B), disk);
    const reqB = apiB.calls.find(call => call.kind === 'respond');
    assert.ok(!JSON.stringify(reqB.body).includes('fixture-A'));
    waitB.resolve({ requestId: reqB.body.requestId, text: 'fixture-B-answer' });
    assert.equal(await pendingB, true); await idle(b); assert.equal(b.getSnapshot().aiBusy, false);
  });
}
for (const result of ['success', 'error']) {
  test(`Delayed pilot ${result} cannot grant/revoke new owner consent`, async f => {
    const api = apiFixture(), delayed = deferred(); api.pilot.push(delayed);
    const { store: a } = f.mount(await f.lease(A), api); await idle(a);
    const pending = a.getSnapshot().enableAiPilot('vi');
    const { store: b } = f.mount(await f.lease(B)); await idle(b);
    const before = b.getSnapshot();
    result === 'success' ? delayed.resolve({}) : delayed.reject(new Error('fixture'));
    assert.equal(await pending, false); assert.equal(b.getSnapshot(), before); privateEmpty(a);
  });
}
test('Owner hydration is storage-read-only and provider-silent until explicit AI opt-in', async f => {
  const api = apiFixture();
  const { store } = f.mount(await f.lease(A), api); await idle(store);
  assert.equal(store.getSnapshot().state.aiAvailability, 'not_connected');
  assert.equal(api.calls.length, 0, 'owner hydration must not call AI/provider status');
  assert.ok(f.backend.calls.length >= 2);
  assert.ok(f.backend.calls.every(call => call.method === 'getItem'),
    'owner hydration must perform storage reads only');
  assert.equal(await store.getSnapshot().enableAiPilot('vi'), true); await idle(store);
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].kind, 'pilot', 'explicit pilot must be the first provider-facing call');
  assert.equal(store.getSnapshot().state.aiAvailability, 'ready');
  assert.ok(f.backend.calls.some(call => call.method === 'setItem'),
    'explicit opt-in may persist its resulting state');
});
for (const priorConsent of ['not_asked', 'declined']) {
  for (const failure of [
    { label: 'quota', code: 'AI_BUDGET_EXHAUSTED', expected: 'quota_exhausted' },
    { label: 'offline', code: null, expected: 'offline' },
  ]) {
    test(`Pilot ${failure.label} failure preserves ${priorConsent} consent and does not auto-retry`, async f => {
      const api = apiFixture(), delayed = deferred(); api.pilot.push(delayed);
      const { store } = f.mount(await f.lease(A), api); await idle(store);
      if (priorConsent === 'declined') {
        store.getSnapshot().setAiConsent('declined'); await idle(store);
      }
      const beforeConsentAt = store.getSnapshot().state.aiConsentUpdatedAt;
      const pending = store.getSnapshot().enableAiPilot('vi');
      assert.equal(api.calls.filter(call => call.kind === 'pilot').length, 1);
      if (failure.code) delayed.reject({ body: { code: failure.code } });
      else delayed.reject(new Error('fixture'));
      assert.equal(await pending, false); await idle(store);
      assert.equal(store.getSnapshot().state.aiConsent, priorConsent);
      assert.equal(store.getSnapshot().state.aiConsentUpdatedAt, beforeConsentAt);
      assert.equal(store.getSnapshot().state.aiAvailability, failure.expected);
      const callsAfterFailure = api.calls.length; await tick(); await tick();
      assert.equal(api.calls.length, callsAfterFailure, 'pilot failure must not auto-retry provider');
      store.stop();
      const freshApi = apiFixture();
      const { store: fresh } = f.mount(await f.lease(A), freshApi); await idle(fresh);
      assert.equal(fresh.getSnapshot().state.aiConsent, priorConsent);
      assert.equal(fresh.getSnapshot().state.aiAvailability, 'not_connected');
      assert.equal(freshApi.calls.length, 0, 'relaunch hydration must remain provider-silent');
    });
  }
}
test('Same Subject new generation rejects old AI and action callbacks', async f => {
  const api = apiFixture(), delayed = deferred(); api.respond.push(delayed);
  const { store: old } = f.mount(await f.lease(A), api); await idle(old);
  old.getSnapshot().setAiConsent('granted'); await idle(old);
  const actions = old.getSnapshot(), pending = actions.addUserMessage('old-generation', 'vi');
  await idle(old); // Owner history may persist, in-flight authority must not.
  const { store: fresh } = f.mount(await f.lease(A)); await idle(fresh);
  assert.equal(fresh.getSnapshot().state.pendingRequest, null);
  assert.equal(fresh.getSnapshot().aiBusy, false);
  const before = fresh.getSnapshot();
  delayed.resolve({ requestId: api.calls.find(c => c.kind === 'respond').body.requestId, text: 'late-answer' });
  assert.equal(await pending, false); assert.equal(actions.saveCorrection('old-correction'), false);
  assert.equal(fresh.getSnapshot(), before); privateEmpty(old);
});
test('Expiry retires RAM synchronously with timers and on read after timer suspension', async f => {
  const { store: a } = f.mount(await f.lease(A)); await idle(a);
  await a.getSnapshot().addUserMessage('private', 'vi'); await idle(a);
  f.clock.advance(1_000_000); privateEmpty(a);
  const { store: again } = f.mount(await f.lease(A)); await idle(again);
  f.clock.jumpWithoutTimers(1_000_000); privateEmpty(again);
  assert.equal(f.boundary.access.getSnapshot().phase, 'LOCKED');
});
for (const corrupt of ['owner', 'schema', 'payload', 'marker']) {
  test(`Corrupt ${corrupt} preserved and fails closed without writes or fallback`, async f => {
    seed(f.backend, A, 'fixture-private');
    const stored = JSON.parse(f.backend.data.get(key(A)));
    if (corrupt === 'owner') stored.owner = B;
    if (corrupt === 'schema') stored.schemaVersion = 99;
    if (corrupt === 'payload') stored.value = '{"invalid":true}';
    f.backend.data.set(key(A), JSON.stringify(stored));
    if (corrupt === 'marker') f.backend.data.set(key(A, 'interaction-deleted-at'),
      JSON.stringify({ schemaVersion: 1, owner: A, value: 'invalid-date' }));
    const before = new Map(f.backend.data);
    const { store, api } = f.mount(await f.lease(A)); await idle(store); privateEmpty(store);
    assert.equal(store.getSnapshot().unreadableDataPreserved, true);
    assert.equal(store.getSnapshot().persistenceStatus, 'error');
    assert.equal(await store.getSnapshot().addUserMessage('blocked', 'vi'), false);
    assert.deepEqual(f.backend.data, before); assert.equal(api.calls.length, 0);
  });
}
test('Legacy global payload and marker never read, imported, deleted or rewritten', async f => {
  const legacy = '@100-human-development-interaction', marker = legacy + '-deleted-at';
  f.backend.data.set(legacy, 'legacy-unowned-fixture');
  f.backend.data.set(marker, iso(900));
  const { store } = f.mount(await f.lease(A)); await idle(store); privateEmpty(store);
  assert.equal(await store.getSnapshot().deleteData(), true);
  assert.equal(f.backend.data.get(legacy), 'legacy-unowned-fixture');
  assert.equal(f.backend.data.get(marker), iso(900));
  assert.ok(f.backend.calls.every(call => call.key !== legacy && call.key !== marker));
});
test('A deletion clears RAM/pending AI, marker only A, cannot affect B', async f => {
  seed(f.backend, B, 'fixture-B-private');
  const beforeB = f.backend.data.get(key(B));
  const api = apiFixture(), delayed = deferred(); api.respond.push(delayed);
  const { store } = f.mount(await f.lease(A), api); await idle(store);
  store.getSnapshot().setAiConsent('granted'); await idle(store);
  const pending = store.getSnapshot().addUserMessage('fixture-A-private', 'vi');
  const removed = store.getSnapshot().deleteData(); privateEmpty(store);
  assert.equal(await removed, true);
  delayed.resolve({ requestId: api.calls.find(c => c.kind === 'respond').body.requestId, text: 'late' });
  assert.equal(await pending, false); privateEmpty(store);
  assert.equal(decoded(f.backend, A), undefined);
  assert.equal(typeof decoded(f.backend, A, 'interaction-deleted-at'), 'string');
  assert.equal(f.backend.data.get(key(B)), beforeB);
  assert.equal(decoded(f.backend, B, 'interaction-deleted-at'), undefined);
  const { store: b } = f.mount(await f.lease(B)); await idle(b);
  assert.equal(b.getSnapshot().state.messages[0].text, 'fixture-B-private');
});
test('Delayed A pending write never lands in B namespace', async f => {
  const { store: a } = f.mount(await f.lease(A)); await idle(a);
  const gate = f.backend.holdNext('setItem');
  await a.getSnapshot().addUserMessage('fixture-A-private', 'vi'); await gate.started;
  const { store: b } = f.mount(await f.lease(B)); await idle(b);
  await b.getSnapshot().addUserMessage('fixture-B-private', 'vi'); await idle(b);
  const before = decoded(f.backend, B); gate.release(); await tick(); await tick();
  assert.equal(decoded(f.backend, B), before); assert.ok(!before.includes('fixture-A-private')); privateEmpty(a);
});
test('Pending same-owner write completes before delete and cannot recreate deleted data', async f => {
  const { store } = f.mount(await f.lease(A)); await idle(store);
  const gate = f.backend.holdNext('setItem');
  await store.getSnapshot().addUserMessage('before-delete', 'vi'); await gate.started;
  const oldActions = store.getSnapshot(), deleted = oldActions.deleteData();
  privateEmpty(store); assert.equal(await oldActions.addUserMessage('late', 'vi'), false);
  gate.release(); assert.equal(await deleted, true);
  assert.equal(decoded(f.backend, A), undefined);
  // Fresh edit in the same clock tick must survive its own deletion marker.
  assert.equal(await store.getSnapshot().addUserMessage('after-delete', 'vi'), true); await idle(store);
  store.stop(); store.start(); await idle(store);
  assert.equal(store.getSnapshot().state.messages[0].text, 'after-delete');
});
test('Owner switch during delayed A deletion cannot delete B or set B marker', async f => {
  seed(f.backend, B, 'fixture-B-private');
  const { store: a } = f.mount(await f.lease(A)); await idle(a);
  const gate = f.backend.holdNext('setItem');
  const removed = a.getSnapshot().deleteData(); await gate.started;
  const { store: b } = f.mount(await f.lease(B)); await idle(b);
  const before = new Map(f.backend.data), beforeSnapshot = b.getSnapshot();
  gate.release(); assert.equal(await removed, false); await tick();
  assert.equal(f.backend.data.get(key(B)), before.get(key(B)));
  assert.equal(decoded(f.backend, B, 'interaction-deleted-at'), undefined);
  assert.equal(b.getSnapshot(), beforeSnapshot); privateEmpty(a);
});
test('Delete failure remains empty/locked and marker suppresses old data on restart', async f => {
  const { store } = f.mount(await f.lease(A)); await idle(store);
  await store.getSnapshot().addUserMessage('old-private', 'vi'); await idle(store);
  const gate = f.backend.holdNext('removeItem', true);
  const removed = store.getSnapshot().deleteData(); await gate.started; gate.release();
  assert.equal(await removed, false); privateEmpty(store);
  assert.equal(store.getSnapshot().persistenceStatus, 'error');
  assert.equal(await store.getSnapshot().addUserMessage('blocked', 'vi'), false);
  store.stop(); store.start(); await idle(store); privateEmpty(store);
});
test('Wrong response requestId rejected; current errors stop consent; valid response works', async f => {
  const api = apiFixture(), wrong = deferred(), error = deferred(); api.respond.push(wrong, error);
  const { store } = f.mount(await f.lease(A), api); await idle(store);
  store.getSnapshot().setAiConsent('granted'); await idle(store);
  const first = store.getSnapshot().addUserMessage('one', 'vi');
  wrong.resolve({ requestId: 'wrong-id', text: 'must-not-apply' }); assert.equal(await first, false);
  assert.ok(!JSON.stringify(store.getSnapshot().state).includes('must-not-apply'));
  const second = store.getSnapshot().addUserMessage('two', 'vi');
  error.reject({ body: { code: 'AI_BUDGET_EXHAUSTED' } }); assert.equal(await second, false);
  assert.equal(store.getSnapshot().state.aiConsent, 'declined');
  assert.equal(store.getSnapshot().state.aiAvailability, 'quota_exhausted');
  assert.equal(store.getSnapshot().aiBusy, false);
  store.getSnapshot().setAiConsent('granted');
  assert.equal(await store.getSnapshot().addUserMessage('three', 'vi'), true); await idle(store);
  assert.equal(store.getSnapshot().state.messages.at(-1).text, 'fixture-answer');
});
for (const result of ['success', 'error']) {
  test(`Sequence change via correction rejects old ${result}/finally within same owner`, async f => {
    const api = apiFixture(), old = deferred(), fresh = deferred(); api.respond.push(old, fresh);
    const { store } = f.mount(await f.lease(A), api); await idle(store);
    store.getSnapshot().setAiConsent('granted');
    const pending = store.getSnapshot().addUserMessage('old', 'vi');
    assert.equal(store.getSnapshot().saveCorrection('current correction'), true);
    const newer = store.getSnapshot().addUserMessage('new', 'vi');
    await until(() => store.getSnapshot().persistenceStatus === 'ready');
    const before = store.getSnapshot();
    result === 'success' ? old.resolve({ requestId: api.calls.find(c => c.kind === 'respond').body.requestId, text: 'obsolete' })
      : old.reject(new Error('obsolete'));
    assert.equal(await pending, false); assert.equal(store.getSnapshot(), before);
    assert.equal(store.getSnapshot().aiBusy, true); assert.equal(store.getSnapshot().state.aiConsent, 'granted');
    fresh.resolve({ requestId: api.calls.filter(c => c.kind === 'respond').at(-1).body.requestId, text: 'current' });
    assert.equal(await newer, true);
  });
}
test('Stop/start drops old hydration callbacks; captured actions cannot mutate new run', async f => {
  seed(f.backend, A, 'same-owner');
  const gate = f.backend.holdNext('getItem');
  const { store } = f.mount(await f.lease(A)); await gate.started;
  const old = store.getSnapshot(); store.stop(); privateEmpty(store); store.start();
  gate.release(); await idle(store);
  assert.equal(store.getSnapshot().state.messages[0].text, 'same-owner');
  assert.equal(old.saveCorrection('obsolete'), false);
});
test('Boundary VERIFYING retires old RAM before verifier settles', async f => {
  seed(f.backend, A, 'fixture-A-private');
  const { store } = f.mount(await f.lease(A)); await idle(store);
  const delayed = deferred(); f.authority.results.push(() => delayed.promise);
  const verification = f.boundary.control.verifySession(); privateEmpty(store);
  assert.equal(f.boundary.access.getSnapshot().phase, 'VERIFYING');
  delayed.resolve({ status: 'unknown' }); await assert.rejects(verification); privateEmpty(store);
});

test('Delayed failed A write cannot lock B or change B persistence status', async f => {
  const { store: a } = f.mount(await f.lease(A)); await idle(a);
  const gate = f.backend.holdNext('setItem', true);
  await a.getSnapshot().addUserMessage('fixture-A-private', 'vi'); await gate.started;
  const { store: b } = f.mount(await f.lease(B)); await idle(b);
  const before = b.getSnapshot(); gate.release(); await tick(); await tick();
  privateEmpty(a); assert.equal(b.getSnapshot(), before);
  assert.equal(await b.getSnapshot().addUserMessage('fixture-B-private', 'vi'), true);
});
test('Synchronous invalidation during publication rejects caller success and persistence', async f => {
  const { store } = f.mount(await f.lease(A)); await idle(store);
  const beforeDisk = decoded(f.backend, A);
  const unsubscribe = store.subscribe(() => {
    if (store.getSnapshot().state.goal) f.boundary.control.invalidateCurrentSession();
  });
  assert.equal(store.getSnapshot().saveGoal('fixture-goal', 'fixture-action'), false);
  privateEmpty(store); await tick(); assert.equal(decoded(f.backend, A), beforeDisk); unsubscribe();
});
test('Read failure preserves original owner data and exposes no private content', async f => {
  seed(f.backend, A, 'fixture-private');
  const original = f.backend.data.get(key(A)), gate = f.backend.holdNext('getItem', true);
  const { store } = f.mount(await f.lease(A)); await gate.started; gate.release(); await idle(store);
  privateEmpty(store); assert.equal(store.getSnapshot().persistenceStatus, 'error');
  assert.equal(f.backend.data.get(key(A)), original);
});

let passed = 0;
for (const { name, body } of tests) {
  const f = fixture();
  try { await body(f); passed++; console.log('PASS ' + name); }
  finally { f.cleanup(); }
}
console.log(`Interaction owner isolation: ${passed}/${tests.length} PASS`);
