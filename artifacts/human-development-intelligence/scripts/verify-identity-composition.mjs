import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  createOwnerSessionCoordinator,
  resolveProductionIdentityConfig,
} = await import('../domain/identity/owner-session-coordinator.ts');

const OWNER_A = Object.freeze({ subjectId: 'subject_a', profileId: 'profile_a' });
const OWNER_B = Object.freeze({ subjectId: 'subject_b', profileId: 'profile_b' });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeClock(start = 10_000) {
  let now = start;
  const jobs = new Set();
  return {
    now: () => now,
    schedule(callback, delayMs) {
      const job = { at: now + delayMs, callback, active: true };
      jobs.add(job);
      return () => { job.active = false; jobs.delete(job); };
    },
    advance(ms) {
      now += ms;
      let ran;
      do {
        ran = false;
        for (const job of [...jobs]) {
          if (job.active && job.at <= now) {
            job.active = false;
            jobs.delete(job);
            job.callback();
            ran = true;
          }
        }
      } while (ran);
    },
  };
}

function fixture(results, { logout } = {}) {
  const queue = [...results];
  const authorization = Object.freeze({
    async withBearer(_signal, use) { return use('Bearer bounded-fixture-token'); },
  });
  return Object.freeze({
    ownerVerifier: Object.freeze({
      async verify() {
        if (queue.length === 0) throw new Error('fixture exhausted');
        const result = queue.shift();
        if (result instanceof Error) throw result;
        return await result;
      },
    }),
    authorization,
    logout: logout ?? (async () => undefined),
  });
}

const verified = (owner, validUntil) => Object.freeze({ status: 'verified', owner, validUntil });

test('anonymous startup remains locked and never fabricates READY authority', async () => {
  const coordinator = createOwnerSessionCoordinator({ clock: fakeClock() });
  assert.equal(await coordinator.refresh(), false);
  assert.deepEqual(coordinator.getSnapshot(), {
    phase: 'LOCKED',
    generation: coordinator.getSnapshot().generation,
  });
  assert.equal(coordinator.getSnapshot().binding, undefined);
});

test('verified server session publishes one bounded owner binding', async () => {
  const clock = fakeClock();
  const session = fixture([verified(OWNER_A, clock.now() + 1_000)]);
  const coordinator = createOwnerSessionCoordinator({
    clock,
    session,
  });
  assert.equal(await coordinator.refresh(), true);
  const snapshot = coordinator.getSnapshot();
  assert.equal(snapshot.phase, 'READY');
  assert.equal(snapshot.binding.access.requireLease(snapshot.binding.lease).owner.subjectId, 'subject_a');
  assert.equal(snapshot.binding.authorization, session.authorization);
  assert.doesNotMatch(JSON.stringify(snapshot), /bounded-fixture-token/);
  assert.equal(coordinator.getSnapshot().binding, snapshot.binding);
});

test('missing, unavailable and revoked authority fail closed without leaking backend errors', async () => {
  const clock = fakeClock();
  for (const result of [
    Object.freeze({ status: 'missing' }),
    new Error('secret-token-value'),
    Object.freeze({ status: 'revoked' }),
  ]) {
    const coordinator = createOwnerSessionCoordinator({ clock, session: fixture([result]) });
    assert.equal(await coordinator.refresh(), false);
    assert.equal(coordinator.getSnapshot().phase, 'LOCKED');
    assert.equal(coordinator.getSnapshot().binding, undefined);
    assert.doesNotMatch(JSON.stringify(coordinator.getSnapshot()), /secret-token-value/);
  }
});

test('refresh retires old owner synchronously and owner change cannot retain stale authority', async () => {
  const clock = fakeClock();
  const next = deferred();
  const coordinator = createOwnerSessionCoordinator({
    clock,
    session: fixture([
      verified(OWNER_A, clock.now() + 5_000),
      next.promise,
    ]),
  });
  await coordinator.refresh();
  const old = coordinator.getSnapshot().binding;
  const refresh = coordinator.refresh();
  assert.equal(coordinator.getSnapshot().phase, 'VERIFYING');
  assert.equal(coordinator.getSnapshot().binding, undefined);
  assert.throws(() => old.access.requireLease(old.lease), { message: 'STALE_LEASE' });
  next.resolve(verified(OWNER_B, clock.now() + 5_000));
  assert.equal(await refresh, true);
  const current = coordinator.getSnapshot().binding;
  assert.equal(current.access.requireLease(current.lease).owner.subjectId, 'subject_b');
  assert.notEqual(current, old);
});

test('revocation or 401-equivalent verification retires authority before the request settles', async () => {
  const clock = fakeClock();
  const revoked = deferred();
  const coordinator = createOwnerSessionCoordinator({
    clock,
    session: fixture([
      verified(OWNER_A, clock.now() + 5_000),
      revoked.promise,
    ]),
  });
  await coordinator.refresh();
  const refresh = coordinator.refresh();
  assert.equal(coordinator.getSnapshot().phase, 'VERIFYING');
  assert.equal(coordinator.getSnapshot().binding, undefined);
  revoked.resolve(Object.freeze({ status: 'revoked' }));
  assert.equal(await refresh, false);
  assert.equal(coordinator.getSnapshot().phase, 'LOCKED');
});

test('expiry retires the published binding', async () => {
  const clock = fakeClock();
  const coordinator = createOwnerSessionCoordinator({
    clock,
    session: fixture([verified(OWNER_A, clock.now() + 100)]),
  });
  await coordinator.refresh();
  const binding = coordinator.getSnapshot().binding;
  clock.advance(100);
  assert.equal(coordinator.getSnapshot().phase, 'LOCKED');
  assert.equal(coordinator.getSnapshot().binding, undefined);
  assert.throws(() => binding.access.requireLease(binding.lease), { message: 'STALE_LEASE' });
});

test('logout locks local private authority before remote logout completes', async () => {
  const clock = fakeClock();
  const gate = deferred();
  const coordinator = createOwnerSessionCoordinator({
    clock,
    session: fixture([verified(OWNER_A, clock.now() + 5_000)], { logout: () => gate.promise }),
  });
  await coordinator.refresh();
  const logout = coordinator.logout(new AbortController().signal);
  assert.equal(coordinator.getSnapshot().phase, 'LOCKED');
  assert.equal(coordinator.getSnapshot().binding, undefined);
  gate.resolve();
  assert.equal(await logout, true);
});

test('remote logout failure cannot restore local authority', async () => {
  const clock = fakeClock();
  const coordinator = createOwnerSessionCoordinator({
    clock,
    session: fixture([verified(OWNER_A, clock.now() + 5_000)], {
      logout: async () => { throw new Error('PRIVATE_REMOTE_DETAIL'); },
    }),
  });
  await coordinator.refresh();
  assert.equal(await coordinator.logout(new AbortController().signal), false);
  assert.equal(coordinator.getSnapshot().phase, 'LOCKED');
  assert.equal(coordinator.getSnapshot().binding, undefined);
  assert.doesNotMatch(JSON.stringify(coordinator.getSnapshot()), /PRIVATE_REMOTE_DETAIL/);
});

test('startup refresh never invokes the native Apple sign-in moment', async () => {
  let appleCalls = 0;
  const coordinator = createOwnerSessionCoordinator({
    session: fixture([Object.freeze({ status: 'missing' })]),
    apple: Object.freeze({
      async signIn() {
        appleCalls++;
        return Object.freeze({ status: 'cancelled' });
      },
    }),
  });
  assert.equal(coordinator.canSignInWithApple, true);
  assert.equal(await coordinator.refresh(), false);
  assert.equal(appleCalls, 0);
  assert.equal(coordinator.getSnapshot().phase, 'LOCKED');
});

test('user-cancelled Apple sign-in remains recoverably locked without verification', async () => {
  let verificationCalls = 0;
  const coordinator = createOwnerSessionCoordinator({
    session: {
      ownerVerifier: Object.freeze({
        async verify() {
          verificationCalls++;
          return Object.freeze({ status: 'missing' });
        },
      }),
      async logout() {},
    },
    apple: Object.freeze({
      async signIn() { return Object.freeze({ status: 'cancelled' }); },
    }),
  });
  assert.equal(await coordinator.signIn(new AbortController().signal), 'CANCELLED');
  assert.equal(verificationCalls, 0);
  assert.equal(coordinator.getSnapshot().phase, 'LOCKED');
  assert.equal(coordinator.getSnapshot().binding, undefined);
});

test('successful Apple handoff refreshes the existing coordinator into READY', async () => {
  const clock = fakeClock();
  const coordinator = createOwnerSessionCoordinator({
    clock,
    session: fixture([verified(OWNER_A, clock.now() + 5_000)]),
    apple: Object.freeze({
      async signIn() {
        return Object.freeze({ status: 'verified', owner: OWNER_A, validUntil: clock.now() + 5_000 });
      },
    }),
  });
  assert.equal(await coordinator.signIn(new AbortController().signal), 'READY');
  const snapshot = coordinator.getSnapshot();
  assert.equal(snapshot.phase, 'READY');
  assert.equal(snapshot.binding.access.requireLease(snapshot.binding.lease).owner.subjectId, 'subject_a');
});

test('sign-in failure and a concurrent logout cannot fabricate or resurrect authority', async () => {
  const failed = createOwnerSessionCoordinator({
    apple: Object.freeze({ async signIn() { throw new Error('PRIVATE_NATIVE_DETAIL'); } }),
  });
  assert.equal(await failed.signIn(new AbortController().signal), 'UNAVAILABLE');
  assert.equal(failed.getSnapshot().phase, 'LOCKED');
  assert.doesNotMatch(JSON.stringify(failed.getSnapshot()), /PRIVATE_NATIVE_DETAIL/);

  const pending = deferred();
  let verificationCalls = 0;
  const raced = createOwnerSessionCoordinator({
    session: {
      ownerVerifier: Object.freeze({
        async verify() {
          verificationCalls++;
          return verified(OWNER_A, Date.now() + 5_000);
        },
      }),
      async logout() {},
    },
    apple: Object.freeze({ signIn: () => pending.promise }),
  });
  const signIn = raced.signIn(new AbortController().signal);
  assert.equal(await raced.logout(new AbortController().signal), true);
  pending.resolve(Object.freeze({ status: 'verified', owner: OWNER_A, validUntil: Date.now() + 5_000 }));
  assert.equal(await signIn, 'UNAVAILABLE');
  assert.equal(verificationCalls, 0);
  assert.equal(raced.getSnapshot().phase, 'LOCKED');
});

test('non-iOS style coordinator exposes no Apple capability', () => {
  const coordinator = createOwnerSessionCoordinator();
  assert.equal(coordinator.canSignInWithApple, false);
});

test('production identity configuration is explicit, bounded and fail closed', () => {
  assert.deepEqual(resolveProductionIdentityConfig('identity.example.test', '10000'), {
    baseUrl: 'https://identity.example.test/api',
    requestTimeoutMs: 10_000,
  });
  assert.deepEqual(resolveProductionIdentityConfig('https://identity.example.test', '1'), {
    baseUrl: 'https://identity.example.test/api',
    requestTimeoutMs: 1,
  });
  for (const input of [
    [undefined, '10000'],
    ['http://identity.example.test', '10000'],
    ['https://identity.example.test/path', '10000'],
    ['identity.example.test', undefined],
    ['identity.example.test', '0'],
    ['identity.example.test', '60001'],
    ['identity.example.test', '1.5'],
  ]) assert.equal(resolveProductionIdentityConfig(...input), undefined);
});

test('composition root supplies the exact same binding and keeps credentials out of app state', async () => {
  const [layout, context, coordinator, privacy] = await Promise.all([
    readFile(new URL('../app/_layout.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../context/OwnerSessionContext.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../domain/identity/owner-session-coordinator.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/(tabs)/privacy.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(layout, /<OwnerSessionProvider>/);
  assert.match(layout, /<InteractionProvider ownerSession=\{ownerSession\}>/);
  assert.match(layout, /<DevelopmentProvider ownerSession=\{ownerSession\}>/);
  assert.match(layout, /<OpeningGoalFlow[\s\S]*ownerSession=\{ownerSession\}/);
  assert.doesNotMatch(layout, /user-001/);
  assert.match(context, /Platform\.OS !== 'ios'/);
  assert.match(context, /EXPO_PUBLIC_IDENTITY_REQUEST_TIMEOUT_MS/);
  assert.match(context, /useOwnerSessionControl/);
  assert.match(privacy, /identity-sign-in-apple/);
  assert.match(privacy, /identity-logout/);
  assert.doesNotMatch(layout, /\.signIn\(/);
  assert.doesNotMatch(privacy, /subjectId|profileId|identityToken|rawNonce|OwnerVerifier|\blease\b|authority seam/i);
  const newSource = `${context}\n${coordinator}`;
  assert.doesNotMatch(newSource, /identityToken|Bearer\s|SecureStore|console\./i);
  assert.doesNotMatch(newSource, /createRuntimeLeaseBridge|identity02_test|user-001/i);
});

test('identity control copy is complete and distinct for all release locales', async () => {
  const [{ IDENTITY_TRANSLATION_KEYS, identityMessages }, { RELEASE_LOCALES }, { translate }] = await Promise.all([
    import('../i18n-identity.ts'),
    import('../i18n-opening.ts'),
    import('../i18n.ts'),
  ]);
  assert.deepEqual(Object.keys(identityMessages).sort(), [...RELEASE_LOCALES].sort());
  for (const locale of RELEASE_LOCALES) {
    for (const key of IDENTITY_TRANSLATION_KEYS) {
      assert.equal(typeof identityMessages[locale][key], 'string', `${locale}:${key}`);
      assert.ok(identityMessages[locale][key].trim(), `${locale}:${key}`);
      assert.equal(translate(locale, key), identityMessages[locale][key]);
      if (locale !== 'en') assert.notEqual(identityMessages[locale][key], identityMessages.en[key]);
    }
  }
});

// S4 CODE_OFFLINE: actual Web consumer/adapter/coordinator/boundary; HTTP is doubled.
const { createWebOwnerSessionComposition, resolveWebIdentityConfig } = await import('../lib/identity/web-session.ts');
const S4_A = 'A'.repeat(43), S4_B = 'B'.repeat(43), S4_A2 = 'C'.repeat(43);
const s4Signal = () => new AbortController().signal;
const s4Tick = () => new Promise(resolve => setImmediate(resolve));
const s4Reply = (owner, until) => new Response(JSON.stringify({ owner, validUntil: new Date(until).toISOString() }), { status: 200 });
const s4Issued = (owner, token, until) => ({ owner, token, validUntil: new Date(until).toISOString() });
function s4Fixture({ intercept, timeoutMs = 1000 } = {}) {
  const clock = fakeClock(); const until = clock.now() + 5000; const calls = [];
  const fetchImpl = async (url, init) => {
    const token = init.headers.authorization.slice(7);
    calls.push({ url, method: init.method, cache: init.cache, credentials: init.credentials,
      redirect: init.redirect, signal: init.signal, token });
    const override = await intercept?.({ url, init, token, calls, until });
    if (override !== undefined) return override;
    return url.endsWith('/logout') ? new Response(null, { status: 204 }) : s4Reply(token === S4_B ? OWNER_B : OWNER_A, until);
  };
  const composition = createWebOwnerSessionComposition({ origin: 'http://127.0.0.1:4040', timeoutMs, fetchImpl, clock });
  return { ...composition, clock, until, calls };
}

test('S4 URL accepts trusted HTTPS and exactly the three literal loopback hosts', () => {
  for (const origin of ['https://identity.example.test', 'http://127.0.0.1:4040', 'http://localhost:4040', 'http://[::1]:4040']) {
    assert.equal(resolveWebIdentityConfig(origin, '1000')?.origin, origin);
  }
  for (const origin of ['http://identity.example.test', 'http://localhost.evil.test', 'http://127.0.0.2',
    'http://127.1', 'http://2130706433', 'http://[::ffff:127.0.0.1]', 'http://localhost.',
    'http://localhost:0', 'http://localhost:65536', 'https://user:pass@identity.example.test',
    'https://identity.example.test/path', 'https://identity.example.test?', 'https://identity.example.test#',
    'http://%6cocalhost', 'https://identity.example.test\\evil']) {
    assert.equal(resolveWebIdentityConfig(origin, '1000'), undefined, origin);
  }
  for (const timeout of ['0', '60001', '1.5', '', 'NaN']) assert.equal(resolveWebIdentityConfig('https://identity.example.test', timeout), undefined);
});

test('S4 missing credential stays LOCKED with zero HTTP and no Apple capability', async () => {
  const h = s4Fixture(); try {
    assert.equal(await h.coordinator.refresh(), false); assert.equal(h.coordinator.getSnapshot().phase, 'LOCKED');
    assert.equal(h.calls.length, 0); assert.equal(h.coordinator.canSignInWithApple, false);
    assert.equal(await h.coordinator.signIn(s4Signal()), 'UNAVAILABLE');
  } finally { h.dispose(); }
});

test('S4 actual adapter re-verifies issued session and publishes an opaque lease', async () => {
  const h = s4Fixture(); try {
    await h.acceptIssuedSession(s4Issued(OWNER_A, S4_A, h.until), s4Signal());
    const binding = h.coordinator.getSnapshot().binding; assert.ok(binding);
    assert.equal(h.coordinator.getSnapshot().phase, 'READY');
    assert.equal(binding.access.requireLease(binding.lease).owner.subjectId, OWNER_A.subjectId);
    assert.throws(() => binding.access.requireLease({}), /INVALID_LEASE/);
    assert.equal(JSON.stringify(binding.lease), '{}'); assert.equal(h.calls.length, 2);
    assert.ok(h.calls.every(c => c.url === 'http://127.0.0.1:4040/api/identity/session'
      && c.method === 'GET' && c.credentials === 'omit' && c.redirect === 'error' && c.cache === 'no-store'));
  } finally { h.dispose(); }
});

test('S4 malformed or owner-mismatched handoff fails closed', async () => {
  const h = s4Fixture(); try {
    await assert.rejects(h.acceptIssuedSession(s4Issued(OWNER_A, 'bad', h.until), s4Signal()));
    assert.equal(h.calls.length, 0);
    await assert.rejects(h.acceptIssuedSession(s4Issued(OWNER_B, S4_A, h.until), s4Signal()));
    assert.equal(h.coordinator.getSnapshot().phase, 'LOCKED');
    const before = h.calls.length; assert.equal(await h.coordinator.refresh(), false); assert.equal(h.calls.length, before);
  } finally { h.dispose(); }
});

test('S4 expiry clears credential and cannot rehydrate from stale RAM', async () => {
  const h = s4Fixture(); try {
    await h.acceptIssuedSession(s4Issued(OWNER_A, S4_A, h.until), s4Signal());
    const binding = h.coordinator.getSnapshot().binding; h.clock.advance(6000);
    assert.throws(() => binding.access.requireLease(binding.lease), /STALE_LEASE/);
    assert.equal(await h.coordinator.refresh(), false);
    const before = h.calls.length; assert.equal(await h.coordinator.refresh(), false); assert.equal(h.calls.length, before);
  } finally { h.dispose(); }
});

test('S4 revoked DENIED clears credential before any subsequent refresh', async () => {
  let denied = false;
  const h = s4Fixture({ intercept: () => denied ? new Response('{}', { status: 401 }) : undefined });
  try { await h.acceptIssuedSession(s4Issued(OWNER_A, S4_A, h.until), s4Signal()); denied = true;
    assert.equal(await h.coordinator.refresh(), false); assert.equal(h.coordinator.getSnapshot().phase, 'LOCKED');
    const before = h.calls.length; assert.equal(await h.coordinator.refresh(), false); assert.equal(h.calls.length, before);
  } finally { h.dispose(); }
});

test('S4 logout retires lease and RAM credential before remote logout, even on failure', async () => {
  let lockedBeforeRemote = false; let h;
  h = s4Fixture({ intercept: ({ url }) => { if (url.endsWith('/logout')) {
    lockedBeforeRemote = h.coordinator.getSnapshot().phase === 'LOCKED'; return new Response('{}', { status: 503 });
  } } });
  try { await h.acceptIssuedSession(s4Issued(OWNER_A, S4_A, h.until), s4Signal());
    const binding = h.coordinator.getSnapshot().binding;
    assert.equal(await h.coordinator.logout(s4Signal()), false); assert.equal(lockedBeforeRemote, true);
    assert.throws(() => binding.access.requireLease(binding.lease), /STALE_LEASE/);
    const before = h.calls.length; assert.equal(await h.coordinator.refresh(), false); assert.equal(h.calls.length, before);
  } finally { h.dispose(); }
});

test('S4 R01 late handoff after logout cannot save credential or resurrect READY', async () => {
  const gate = deferred(); let intercepted = false;
  const h = s4Fixture({ intercept: ({ url }) => { if (!intercepted && !url.endsWith('/logout')) { intercepted = true; return gate.promise; } } });
  try { const pending = h.acceptIssuedSession(s4Issued(OWNER_A, S4_A, h.until), s4Signal()).then(() => 'READY', () => 'REJECTED');
    await s4Tick(); assert.equal(intercepted, true); await h.coordinator.logout(s4Signal());
    gate.resolve(s4Reply(OWNER_A, h.until)); assert.equal(await pending, 'REJECTED'); await s4Tick();
    assert.equal(await h.coordinator.refresh(), false); assert.equal(h.coordinator.getSnapshot().phase, 'LOCKED');
  } finally { gate.resolve(s4Reply(OWNER_A, h.until)); h.dispose(); }
});

test('S4 R02 A-B-A handoffs retire old leases and late A cannot erase current A2 credential', async () => {
  const gate = deferred(); let aCalls = 0;
  const h = s4Fixture({ intercept: ({ token, url }) => { if (token === S4_A && !url.endsWith('/logout') && ++aCalls === 3) return gate.promise; } });
  try { await h.acceptIssuedSession(s4Issued(OWNER_A, S4_A, h.until), s4Signal());
    const oldA = h.coordinator.getSnapshot().binding;
    const late = h.acceptIssuedSession(s4Issued(OWNER_A, S4_A, h.until), s4Signal()).then(() => 'READY', () => 'REJECTED');
    await s4Tick(); await h.acceptIssuedSession(s4Issued(OWNER_B, S4_B, h.until), s4Signal());
    const oldB = h.coordinator.getSnapshot().binding;
    await h.acceptIssuedSession(s4Issued(OWNER_A, S4_A2, h.until), s4Signal());
    gate.resolve(s4Reply(OWNER_A, h.until)); assert.equal(await late, 'REJECTED'); await s4Tick();
    const current = h.coordinator.getSnapshot().binding; assert.ok(current);
    assert.throws(() => oldA.access.requireLease(oldA.lease), /STALE_LEASE/);
    assert.throws(() => oldB.access.requireLease(oldB.lease), /STALE_LEASE/);
    assert.equal(current.access.requireLease(current.lease).owner.subjectId, OWNER_A.subjectId);
    assert.equal(await current.authorization.withBearer(s4Signal(), async auth => auth === `Bearer ${S4_A2}`), true);
  } finally { gate.resolve(s4Reply(OWNER_A, h.until)); h.dispose(); }
});

test('S4 caller abort during coordinator refresh cannot leave READY or credential', async () => {
  const gate = deferred(); let calls = 0; const controller = new AbortController();
  const h = s4Fixture({ intercept: () => ++calls === 2 ? gate.promise : undefined });
  try { const pending = h.acceptIssuedSession(s4Issued(OWNER_A, S4_A, h.until), controller.signal).then(() => 'READY', () => 'REJECTED');
    for (let i = 0; i < 5 && calls < 2; i++) await s4Tick(); assert.equal(calls, 2);
    controller.abort(); gate.resolve(s4Reply(OWNER_A, h.until)); assert.equal(await pending, 'REJECTED');
    assert.equal(await h.coordinator.refresh(), false); assert.equal(h.coordinator.getSnapshot().phase, 'LOCKED');
  } finally { gate.resolve(s4Reply(OWNER_A, h.until)); h.dispose(); }
});

test('S4 bounded transport rejects redirect, cross-origin response and oversized body', async () => {
  for (const kind of ['redirect', 'cross-origin', 'oversize']) {
    const h = s4Fixture({ intercept: () => { const response = kind === 'oversize' ? new Response('x'.repeat(32769)) : s4Reply(OWNER_A, 15000);
      if (kind === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
      if (kind === 'cross-origin') Object.defineProperty(response, 'url', { value: 'https://evil.example.test/api/identity/session' });
      return response; } });
    try { await assert.rejects(h.acceptIssuedSession(s4Issued(OWNER_A, S4_A, h.until), s4Signal()));
      assert.equal(h.coordinator.getSnapshot().phase, 'LOCKED');
    } finally { h.dispose(); }
  }
});

test('S4 timeout and pre-aborted handoff fail closed with no unbounded wait', async () => {
  const h = s4Fixture({ timeoutMs: 5, intercept: () => new Promise(() => {}) });
  try { await assert.rejects(h.acceptIssuedSession(s4Issued(OWNER_A, S4_A, h.until), s4Signal()));
    assert.equal(h.coordinator.getSnapshot().phase, 'LOCKED');
    const controller = new AbortController(); controller.abort(); const before = h.calls.length;
    await assert.rejects(h.acceptIssuedSession(s4Issued(OWNER_A, S4_A, h.until), controller.signal)); assert.equal(h.calls.length, before);
  } finally { h.dispose(); }
});

test('S4 invalidate and dispose retire memory-only composition permanently', async () => {
  const h = s4Fixture(); await h.acceptIssuedSession(s4Issued(OWNER_A, S4_A, h.until), s4Signal());
  h.coordinator.invalidate(); assert.equal(await h.coordinator.refresh(), false);
  h.dispose(); await assert.rejects(h.acceptIssuedSession(s4Issued(OWNER_A, S4_A, h.until), s4Signal()));
});

test('S4 root selects Web composition without adding a credential input or relaxing iOS', async () => {
  const context = await readFile(new URL('../context/OwnerSessionContext.tsx', import.meta.url), 'utf8');
  assert.match(context, /Platform\.OS === 'web'/); assert.match(context, /createWebOwnerSessionComposition\(config\)\.coordinator/);
  assert.match(context, /if \(Platform\.OS !== 'ios'\) return createOwnerSessionCoordinator\(\)/);
  assert.doesNotMatch(context, /acceptIssuedSession|postMessage|localStorage|sessionStorage|Bearer\s/);
  const privacyGuard = /subjectId|profileId|identityToken|rawNonce|OwnerVerifier|\blease\b|authority seam/i;
  assert.equal(privacyGuard.test('ReleaseLocale RELEASE_LOCALE_OPTIONS'), false);
  assert.equal(privacyGuard.test('const lease = owner.lease'), true);
});

console.log('S4_OFFLINE_EVIDENCE ' + JSON.stringify({ tier: 'CODE_OFFLINE', transport: 'FETCH_DOUBLE_ONLY',
    native: 0, real_HTTP_TCP: 0, provider: 0, DB: 0, credential_persistence: 'RAM_ONLY',
    mountedReact: 'NOT_RUN', live_handoff: 'OPEN_NOT_IMPLEMENTED', User001: 'NOT_AUTHORIZED' }));

// S5 CODE_OFFLINE: actual handoff/adapter/coordinator; all HTTP and SDK inputs are fixtures.
const { createHash } = await import('node:crypto');
const S5_OWNER_A = Object.freeze({ subjectId: '11111111-1111-4111-8111-111111111111', profileId: '22222222-2222-4222-8222-222222222222' });
const S5_OWNER_B = Object.freeze({ subjectId: '33333333-3333-4333-8333-333333333333', profileId: '44444444-4444-4444-8444-444444444444' });
const S5_TOKENS = ['D'.repeat(43), 'E'.repeat(43), 'F'.repeat(43), 'G'.repeat(43)];
const s5Json = value => new Response(JSON.stringify(value), { status: 200 });
const s5Digest = raw => createHash('sha256').update(raw, 'utf8').digest('hex');
const s5Challenge = n => String(n).padStart(43, 'c');
const s5Nonce = n => String(n).padStart(43, 'n');
async function s5Until(predicate) {
  for (let i = 0; i < 30 && !predicate(); i++) await s4Tick();
  assert.ok(predicate(), 'expected offline checkpoint was not reached');
}
function s5Fixture(options = {}) {
  const clock = fakeClock(), until = clock.now() + 10_000;
  const counts = { begin: 0, sha: 0, authorize: 0, complete: 0, verify: 0, logout: 0 };
  const calls = [], events = [], nonces = new Map();
  const ownerFor = n => options.ownerFor?.(n) ?? (n === 2 ? S5_OWNER_B : S5_OWNER_A);
  const tokenFor = n => S5_TOKENS[(n - 1) % S5_TOKENS.length];
  const fetchImpl = async (url, init) => {
    const kind = url.endsWith('/apple/challenge') ? 'begin' : url.endsWith('/apple/session') ? 'complete'
      : url.endsWith('/logout') ? 'logout' : 'verify';
    const count = ++counts[kind], body = init.body === undefined ? undefined : JSON.parse(init.body);
    const info = { kind, count, url, init, body, clock, until, counts, calls };
    calls.push(info); events.push(kind);
    const override = await options.intercept?.(info);
    if (override !== undefined) return override;
    if (kind === 'begin') return s5Json({ challenge: s5Challenge(count), rawNonce: s5Nonce(count), validUntil: new Date(clock.now() + 2_000).toISOString() });
    if (kind === 'complete') {
      const n = Number(body.identityToken.split('_').at(-1));
      return s5Json(s4Issued(ownerFor(n), tokenFor(n), until));
    }
    if (kind === 'logout') return new Response(null, { status: 204 });
    const n = S5_TOKENS.indexOf(init.headers.authorization?.slice(7)) + 1;
    return s4Reply(ownerFor(n), until);
  };
  const apple = options.noApple ? undefined : Object.freeze({
    async authorize(digest) {
      ++counts.authorize; events.push('authorize');
      const n = nonces.get(digest); assert.ok(n, 'authorize must receive SHA-256 of fixture nonce');
      return options.authorize ? options.authorize({ digest, n, clock, until, counts }) : { status: 'success', identityToken: 'S5_JWT_FIXTURE_' + n };
    },
  });
  const sha256 = options.noDigest ? undefined : async raw => {
    ++counts.sha; events.push('sha');
    const n = Number(raw.slice(-1)); nonces.set(s5Digest(raw), n);
    return options.sha256 ? options.sha256({ raw, n, clock, until, counts }) : s5Digest(raw);
  };
  const composition = createWebOwnerSessionComposition({ origin: 'http://127.0.0.1:4040', timeoutMs: options.timeoutMs ?? 1000,
    clock, fetchImpl, apple, sha256 });
  return { ...composition, clock, until, counts, calls, events, tokenFor, ownerFor };
}
async function s5NoCredential(h) {
  assert.equal(h.coordinator.getSnapshot().phase, 'LOCKED');
  assert.equal(h.coordinator.getSnapshot().binding, undefined);
  const before = h.calls.length;
  assert.equal(await h.coordinator.refresh(), false);
  assert.equal(h.calls.length, before, 'retired credential must not cause verify HTTP');
}

test('S5 POST issuance uses exact nonce, body and policy; actual adapter/coordinator mint opaque lease', async () => {
  const h = s5Fixture();
  try {
    assert.equal(h.coordinator.canSignInWithApple, true);
    assert.equal(await h.coordinator.signIn(s4Signal()), 'READY');
    assert.deepEqual(h.events, ['begin', 'sha', 'authorize', 'complete', 'verify', 'verify']);
    const [begin, complete, ...verify] = h.calls;
    assert.equal(begin.url, 'http://127.0.0.1:4040/api/identity/apple/challenge');
    assert.equal(complete.url, 'http://127.0.0.1:4040/api/identity/apple/session');
    assert.equal(begin.init.method, 'POST'); assert.equal(complete.init.method, 'POST');
    assert.equal(begin.init.headers.authorization, undefined); assert.equal(complete.init.headers.authorization, undefined);
    assert.equal(begin.init.body, undefined); assert.equal(complete.init.headers['content-type'], 'application/json');
    assert.deepEqual(complete.body, { challenge: s5Challenge(1), identityToken: 'S5_JWT_FIXTURE_1' });
    assert.equal(complete.init.body.includes(s5Nonce(1)), false);
    assert.ok(verify.every(c => c.init.method === 'GET' && c.init.headers.authorization === 'Bearer ' + S5_TOKENS[0]));
    assert.ok(h.calls.every(c => c.init.cache === 'no-store' && c.init.credentials === 'omit' && c.init.redirect === 'error'));
    const binding = h.coordinator.getSnapshot().binding;
    assert.equal(binding.access.requireLease(binding.lease).owner.subjectId, S5_OWNER_A.subjectId);
    assert.equal(JSON.stringify(binding.lease), '{}'); assert.throws(() => binding.access.requireLease({}), /INVALID_LEASE/);
    assert.doesNotMatch(JSON.stringify(h.coordinator.getSnapshot()), /S5_JWT_FIXTURE|DDDD|rawNonce/);
    assert.equal(await binding.authorization.withBearer(s4Signal(), async bearer => bearer === 'Bearer ' + S5_TOKENS[0]), true);
    assert.equal(await h.coordinator.logout(s4Signal()), true);
    const logout = h.calls.at(-1); assert.equal(logout.kind, 'logout'); assert.equal(logout.init.method, 'POST');
    assert.equal(logout.init.headers.authorization, 'Bearer ' + S5_TOKENS[0]);
    await s5NoCredential(h);
  } finally { h.dispose(); }
});

for (const options of [{ noApple: true }, { noDigest: true }, { noApple: true, noDigest: true }]) {
  test('S5 absent authority/hash remains capability false and LOCKED ' + JSON.stringify(options), async () => {
    const h = s5Fixture(options);
    try { assert.equal(h.coordinator.canSignInWithApple, false); assert.equal(await h.coordinator.signIn(s4Signal()), 'UNAVAILABLE');
      await s5NoCredential(h); assert.equal(h.calls.length, 0); } finally { h.dispose(); }
  });
}

test('S5 user cancellation retires prior lease and never completes or verifies new issuance', async () => {
  const h = s5Fixture({ authorize: async () => ({ status: 'cancelled' }) });
  try {
    await h.acceptIssuedSession(s4Issued(S5_OWNER_A, S5_TOKENS[0], h.until), s4Signal());
    const old = h.coordinator.getSnapshot().binding, before = h.counts.verify;
    assert.equal(await h.coordinator.signIn(s4Signal()), 'CANCELLED');
    assert.throws(() => old.access.requireLease(old.lease), /STALE_LEASE/);
    assert.equal(h.counts.verify, before); assert.equal(h.counts.complete, 0); await s5NoCredential(h);
  } finally { h.dispose(); }
});

for (const kind of ['sha-error', 'sha-invalid', 'authorize-error', 'token-empty', 'token-too-long', 'utf8-request-too-large']) {
  test('S5 nonce/authority input fails closed: ' + kind, async () => {
    const h = s5Fixture({
      sha256: kind === 'sha-error' ? async () => { throw Error('PRIVATE_HASH'); } : kind === 'sha-invalid' ? async () => 'INVALID_DIGEST' : undefined,
      authorize: async ({ n }) => {
        if (kind === 'authorize-error') throw Error('PRIVATE_SDK');
        return { status: 'success', identityToken: kind === 'token-empty' ? '' : kind === 'token-too-long' ? 'x'.repeat(32769)
          : kind === 'utf8-request-too-large' ? '\u00e9'.repeat(17000) : 'S5_JWT_FIXTURE_' + n };
      },
    });
    try {
      assert.equal(await h.coordinator.signIn(s4Signal()), 'UNAVAILABLE');
      assert.equal(h.counts.complete, 0); assert.equal(h.counts.verify, 0); await s5NoCredential(h);
      assert.doesNotMatch(JSON.stringify(h.coordinator.getSnapshot()), /PRIVATE_HASH|PRIVATE_SDK/);
    } finally { h.dispose(); }
  });
}

for (const kind of ['null', 'bad-challenge', 'bad-nonce', 'bad-date', 'expired', 'expires-now']) {
  test('S5 malformed/expired challenge never reaches authorize: ' + kind, async () => {
    const h = s5Fixture({ intercept: ({ kind: step, clock }) => {
      if (step !== 'begin') return;
      const challenge = { challenge: s5Challenge(1), rawNonce: s5Nonce(1), validUntil: new Date(clock.now() + 2000).toISOString() };
      if (kind === 'null') return s5Json(null);
      if (kind === 'bad-challenge') challenge.challenge = 'bad';
      if (kind === 'bad-nonce') challenge.rawNonce = 'bad';
      if (kind === 'bad-date') challenge.validUntil = 'not-a-date';
      if (kind === 'expired') challenge.validUntil = new Date(clock.now() - 1).toISOString();
      if (kind === 'expires-now') challenge.validUntil = new Date(clock.now()).toISOString();
      return s5Json(challenge);
    } });
    try { assert.equal(await h.coordinator.signIn(s4Signal()), 'UNAVAILABLE');
      assert.equal(h.counts.authorize, 0); assert.equal(h.counts.complete, 0); await s5NoCredential(h);
    } finally { h.dispose(); }
  });
}

for (const phase of ['sha', 'authorize', 'complete', 'verify1', 'verify2']) {
  test('S5 challenge expiry during ' + phase + ' cannot publish READY', async () => {
    const h = s5Fixture({
      sha256: phase === 'sha' ? async ({ raw, clock }) => { clock.advance(2000); return s5Digest(raw); } : undefined,
      authorize: phase === 'authorize' ? async ({ n, clock }) => { clock.advance(2000); return { status: 'success', identityToken: 'S5_JWT_FIXTURE_' + n }; } : undefined,
      intercept: ({ kind, count, clock, until }) => {
        if (phase === 'complete' && kind === 'complete') { clock.advance(2000); return s5Json(s4Issued(S5_OWNER_A, S5_TOKENS[0], until)); }
        if (kind === 'verify' && phase === 'verify' + count) { clock.advance(2000); return s4Reply(S5_OWNER_A, until); }
      },
    });
    const phases = []; const stop = h.coordinator.subscribe(() => phases.push(h.coordinator.getSnapshot().phase));
    try { assert.equal(await h.coordinator.signIn(s4Signal()), 'UNAVAILABLE'); assert.equal(phases.includes('READY'), false);
      if (phase === 'sha' || phase === 'authorize') assert.equal(h.counts.complete, 0);
      await s5NoCredential(h);
    } finally { stop(); h.dispose(); }
  });
}

for (const kind of ['issued-expired', 'owner-mismatch', 'expiry-mismatch', 'denied-verification']) {
  test('S5 actual adapter rejects issued session: ' + kind, async () => {
    const h = s5Fixture({ intercept: ({ kind: step, clock, until }) => {
      if (step === 'complete' && kind === 'issued-expired') return s5Json(s4Issued(S5_OWNER_A, S5_TOKENS[0], clock.now()));
      if (step === 'verify' && kind === 'owner-mismatch') return s4Reply(S5_OWNER_B, until);
      if (step === 'verify' && kind === 'expiry-mismatch') return s4Reply(S5_OWNER_A, until - 1);
      if (step === 'verify' && kind === 'denied-verification') return new Response('{}', { status: 401 });
    } });
    try { assert.equal(await h.coordinator.signIn(s4Signal()), 'UNAVAILABLE'); await s5NoCredential(h); }
    finally { h.dispose(); }
  });
}

for (const step of ['begin', 'complete']) for (const kind of ['redirect', 'cross-origin', 'oversize', 'malformed-json', 'invalid-utf8', '401', '503', 'timeout']) {
  test('S5 bounded Apple ' + step + ' transport rejects ' + kind, async () => {
    const h = s5Fixture({ timeoutMs: 5, intercept: ({ kind: actual }) => {
      if (actual !== step) return;
      if (kind === 'timeout') return new Promise(() => {});
      if (kind === '401' || kind === '503') return new Response('{}', { status: Number(kind) });
      if (kind === 'oversize') return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array(16000)); controller.enqueue(new Uint8Array(16769)); controller.close();
      } }));
      if (kind === 'malformed-json') return new Response('{bad}');
      if (kind === 'invalid-utf8') return new Response(new Uint8Array([123, 34, 0xff, 34, 125]));
      const response = new Response('{}');
      Object.defineProperty(response, kind === 'redirect' ? 'redirected' : 'url',
        { value: kind === 'redirect' ? true : 'https://evil.example.test/api/identity/apple/session' });
      return response;
    } });
    try { assert.equal(await h.coordinator.signIn(s4Signal()), 'UNAVAILABLE');
      assert.equal(h.counts.verify, 0); await s5NoCredential(h);
    } finally { h.dispose(); }
  });
}

test('S5 pre-aborted caller does not start HTTP/SDK work', async () => {
  const h = s5Fixture(), controller = new AbortController(); controller.abort();
  try { assert.equal(await h.coordinator.signIn(controller.signal), 'UNAVAILABLE');
    assert.equal(h.calls.length, 0); assert.equal(h.counts.authorize, 0); await s5NoCredential(h);
  } finally { h.dispose(); }
});

test('S5 abort during SDK await settles logically and ignores late authorization result', async () => {
  const gate = deferred(), controller = new AbortController();
  const h = s5Fixture({ authorize: () => gate.promise });
  try {
    const pending = h.coordinator.signIn(controller.signal); await s5Until(() => h.counts.authorize === 1);
    controller.abort(); assert.equal(await pending, 'UNAVAILABLE');
    gate.resolve({ status: 'success', identityToken: 'S5_JWT_FIXTURE_1' }); await s4Tick(); await s4Tick();
    assert.equal(h.counts.complete, 0); await s5NoCredential(h);
  } finally { gate.resolve({ status: 'cancelled' }); h.dispose(); }
});

for (const phase of ['begin', 'sha', 'authorize', 'complete', 'verify1', 'verify2']) {
  for (const action of ['logout', 'invalidate', 'dispose', 'caller-abort', 'replacement']) {
    test('S5 currentness ' + action + ' while ' + phase + ' is pending', async () => {
      const gate = deferred(), controller = new AbortController(); let blocked = false, saved;
      const block = value => { blocked = true; saved = value; return gate.promise; };
      const h = s5Fixture({
        sha256: phase === 'sha' ? async ({ raw, counts }) => counts.sha === 1 ? block(s5Digest(raw)) : s5Digest(raw) : undefined,
        authorize: phase === 'authorize' ? async ({ n, counts }) => counts.authorize === 1 ? block({ status: 'success', identityToken: 'S5_JWT_FIXTURE_' + n }) : { status: 'success', identityToken: 'S5_JWT_FIXTURE_' + n } : undefined,
        intercept: ({ kind, count, clock, until }) => {
          if (phase === 'begin' && kind === 'begin' && count === 1) return block(s5Json({ challenge: s5Challenge(1), rawNonce: s5Nonce(1), validUntil: new Date(clock.now() + 2000).toISOString() }));
          if (phase === 'complete' && kind === 'complete' && count === 1) return block(s5Json(s4Issued(S5_OWNER_A, S5_TOKENS[0], until)));
          if (kind === 'verify' && phase === 'verify' + count) return block(s4Reply(S5_OWNER_A, until));
        },
      });
      try {
        const pending = h.coordinator.signIn(controller.signal); await s5Until(() => blocked);
        if (action === 'logout') await h.coordinator.logout(s4Signal());
        if (action === 'invalidate') h.coordinator.invalidate();
        if (action === 'dispose') h.dispose();
        if (action === 'caller-abort') controller.abort();
        if (action === 'replacement') assert.equal(await h.coordinator.signIn(s4Signal()), 'READY');
        gate.resolve(saved); assert.equal(await pending, 'UNAVAILABLE'); await s4Tick(); await s4Tick();
        if (action === 'replacement') {
          const binding = h.coordinator.getSnapshot().binding; assert.ok(binding, 'late operation cannot erase replacement');
          assert.equal(binding.access.requireLease(binding.lease).owner.subjectId, S5_OWNER_B.subjectId);
          assert.equal(await binding.authorization.withBearer(s4Signal(), async token => token === 'Bearer ' + S5_TOKENS[1]), true);
        } else await s5NoCredential(h);
      } finally { gate.resolve(saved); h.dispose(); }
    });
  }
}

test('S5 A-B-A rejects matching-owner stale response and preserves newest A credential', async () => {
  const gate = deferred(); let blocked = false;
  const h = s5Fixture({ ownerFor: n => n === 3 ? S5_OWNER_B : S5_OWNER_A,
    intercept: ({ kind, count, until }) => {
      if (kind === 'verify' && count === 3) { blocked = true; return gate.promise; }
    } });
  try {
    assert.equal(await h.coordinator.signIn(s4Signal()), 'READY'); const oldA = h.coordinator.getSnapshot().binding;
    const lateA = h.coordinator.signIn(s4Signal()); await s5Until(() => blocked);
    assert.equal(await h.coordinator.signIn(s4Signal()), 'READY'); const oldB = h.coordinator.getSnapshot().binding;
    assert.equal(oldB.access.requireLease(oldB.lease).owner.subjectId, S5_OWNER_B.subjectId);
    assert.equal(await h.coordinator.signIn(s4Signal()), 'READY');
    gate.resolve(s4Reply(S5_OWNER_A, h.until)); assert.equal(await lateA, 'UNAVAILABLE'); await s4Tick();
    assert.throws(() => oldA.access.requireLease(oldA.lease), /STALE_LEASE/);
    assert.throws(() => oldB.access.requireLease(oldB.lease), /STALE_LEASE/);
    const current = h.coordinator.getSnapshot().binding; assert.ok(current);
    assert.equal(current.access.requireLease(current.lease).owner.subjectId, S5_OWNER_A.subjectId);
    assert.equal(await current.authorization.withBearer(s4Signal(), async token => token === 'Bearer ' + S5_TOKENS[3]), true);
  } finally { gate.resolve(s4Reply(S5_OWNER_A, h.until)); h.dispose(); }
});

console.log('S5_OFFLINE_EVIDENCE ' + JSON.stringify({ tier: 'CODE_OFFLINE', transport: 'FETCH_DOUBLE_ONLY',
  authorization: 'EXPLICIT_SDK_FIXTURE', native: 0, real_HTTP_TCP: 0, DB_provider: 0,
  rootSDK: 'NOT_CONFIGURED', actualAppleWebSignIn: 'NOT_RUN', User001: 'NOT_AUTHORIZED' }));

// S6 CODE_OFFLINE: SDK is a fixture, crypto is the built-in Web Crypto implementation.
const { webcrypto } = await import('node:crypto');
const { resolveWebAppleConfig } = await import('../lib/identity/web-session.ts');
const S6_ORIGIN = 'https://identity.example.test';
const S6_CONFIG = Object.freeze({ clientId: 'com.project100.web', redirectURI: S6_ORIGIN + '/apple/callback' });
const s6Segment = value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
function s6Jwt(config, clock, override = {}) {
  return s6Segment({ alg: 'RS256', kid: 'OFFLINE_FIXTURE_NOT_A_REAL_SIGNATURE' }) + '.' + s6Segment({
    iss: 'https://appleid.apple.com', aud: config.clientId, nonce: config.nonce, sub: 'APPLE_SUBJECT_FIXTURE',
    iat: Math.floor(clock.now() / 1000), exp: Math.floor(clock.now() / 1000) + 60, ...override,
  }) + '.AA';
}
function s6Fixture(options = {}) {
  const clock = fakeClock(), calls = [], sdkCalls = [], configs = [], until = clock.now() + 10000;
  const sdk = options.sdk !== undefined ? options.sdk : {
    init(config) { configs.push({ ...config }); sdkCalls.push({ kind: 'init', config: { ...config } }); if (options.initError) throw Error('PRIVATE_INIT'); },
    async signIn(...args) {
      assert.equal(args.length, 0); const config = configs.at(-1); sdkCalls.push({ kind: 'signIn', args });
      if (options.sdkResult) return options.sdkResult({ config, clock });
      return { authorization: { state: config.state, id_token: s6Jwt(config, clock, options.claims) } };
    },
  };
  const fetchImpl = async (url, init) => {
    const kind = url.endsWith('/apple/challenge') ? 'begin' : url.endsWith('/apple/session') ? 'complete' : url.endsWith('/logout') ? 'logout' : 'verify';
    const body = init.body ? JSON.parse(init.body) : undefined; calls.push({ kind, url, init, body });
    if (kind === 'begin') return s5Json({ challenge: s5Challenge(1), rawNonce: s5Nonce(1), validUntil: new Date(clock.now() + 2000).toISOString() });
    if (kind === 'complete') return s5Json(s4Issued(S5_OWNER_A, S5_TOKENS[0], until));
    if (kind === 'logout') return new Response(null, { status: 204 });
    return s4Reply(S5_OWNER_A, until);
  };
  const config = resolveWebIdentityConfig(S6_ORIGIN, '1000', S6_CONFIG.clientId, S6_CONFIG.redirectURI);
  const composition = createWebOwnerSessionComposition({ ...config, clock, fetchImpl, appleSdk: sdk,
    subtle: options.subtle !== undefined ? options.subtle : webcrypto.subtle,
    randomValues: options.randomValues !== undefined ? options.randomValues : bytes => webcrypto.getRandomValues(bytes),
    ...options.input });
  return { ...composition, clock, calls, sdkCalls, configs, sdk };
}

test('S6 config preserves legacy shape and separates Apple config from S5 authority', () => {
  const old = resolveWebIdentityConfig(S6_ORIGIN, '1000');
  assert.deepEqual(old, { origin: S6_ORIGIN, timeoutMs: 1000 });
  assert.deepEqual(resolveWebIdentityConfig(S6_ORIGIN, '1000', 'bad id', S6_CONFIG.redirectURI), old);
  const config = resolveWebIdentityConfig(S6_ORIGIN, '1000', S6_CONFIG.clientId, S6_CONFIG.redirectURI);
  assert.deepEqual(config.appleConfig, S6_CONFIG); assert.equal(config.apple, undefined);
  assert.equal(Object.isFrozen(config.appleConfig), true);
});
for (const [id, uri] of [
  ['', S6_CONFIG.redirectURI], [' bad', S6_CONFIG.redirectURI], ['bad/id', S6_CONFIG.redirectURI], ['bad#id', S6_CONFIG.redirectURI],
  ['x'.repeat(256), S6_CONFIG.redirectURI], [S6_CONFIG.clientId, 'https://other.example.test/callback'],
  [S6_CONFIG.clientId, 'https://identity.example.test:444/callback'], [S6_CONFIG.clientId, S6_CONFIG.redirectURI + '?x=1'],
  [S6_CONFIG.clientId, S6_CONFIG.redirectURI + '#'], [S6_CONFIG.clientId, 'https://u:p@identity.example.test/callback'],
  [S6_CONFIG.clientId, 'http://identity.example.test/callback'], [S6_CONFIG.clientId, S6_ORIGIN + '/%61pple'],
]) test('S6 rejects unsafe config ' + JSON.stringify([id, uri]), () => {
  assert.equal(resolveWebAppleConfig(S6_ORIGIN, id, uri), undefined);
});
test('S6 Apple SDK callback excludes localhost and IP without relaxing S4 loopback consumer', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.equal(resolveWebAppleConfig('https://' + host, S6_CONFIG.clientId, 'https://' + host + '/callback'), undefined);
  assert.ok(resolveWebIdentityConfig('http://127.0.0.1:4040', '1000'));
});
test('S6 actual composition follows Web Crypto/SDK/state/JWT/HTTP contract to opaque READY', async () => {
  const h = s6Fixture();
  try {
    assert.equal(h.coordinator.canSignInWithApple, true); assert.equal(await h.coordinator.signIn(s4Signal()), 'READY');
    assert.deepEqual(h.sdkCalls.map(x => x.kind), ['init', 'signIn']);
    const config = h.configs[0]; assert.equal(config.nonce, s5Digest(s5Nonce(1))); assert.match(config.state, /^[0-9a-f]{64}$/);
    assert.equal(config.usePopup, true); assert.equal(config.clientId, S6_CONFIG.clientId); assert.equal(config.redirectURI, S6_CONFIG.redirectURI);
    assert.deepEqual(h.calls.map(x => x.kind), ['begin', 'complete', 'verify', 'verify']);
    assert.equal(h.calls[1].body.identityToken.split('.').length, 3);
    assert.equal(JSON.stringify(h.calls).includes(s5Nonce(1)), false);
    const b = h.coordinator.getSnapshot().binding; assert.ok(b); assert.equal(JSON.stringify(b.lease), '{}');
    assert.equal(b.access.requireLease(b.lease).owner.subjectId, S5_OWNER_A.subjectId);
    assert.equal(await h.coordinator.logout(s4Signal()), true); await s5NoCredential(h);
  } finally { h.dispose(); }
});
for (const options of [{ sdk: null }, { sdk: {} }, { subtle: null }, { randomValues: null }, { subtle: {} },
  { input: { appleConfig: undefined } }, { input: { apple: { authorize: async () => ({ status: 'cancelled' }) } } },
  { input: { sha256: async () => '0'.repeat(64) } }]) {
  test('S6 missing SDK/config/crypto or partial S5 authority stays disabled ' + JSON.stringify(options), async () => {
    const h = s6Fixture(options); try { assert.equal(h.coordinator.canSignInWithApple, false);
      assert.equal(await h.coordinator.signIn(s4Signal()), 'UNAVAILABLE'); assert.equal(h.calls.length, 0);
    } finally { h.dispose(); }
  });
}
for (const kind of ['state-wrong', 'state-missing', 'state-replayed', 'iss', 'aud', 'nonce', 'expired', 'future-iat', 'future-nbf', 'fractional-time', 'bad-sub', 'markdown-issuer', 'malformed-token']) {
  test('S6 JWT/state precheck rejects ' + kind + ' before issuance POST', async () => {
    const h = s6Fixture({ sdkResult: ({ config, clock }) => {
      const claims = kind === 'iss' ? { iss: 'https://evil.example.test' } : kind === 'aud' ? { aud: 'another.app' }
        : kind === 'nonce' ? { nonce: '0'.repeat(64) } : kind === 'expired' ? { exp: 10 }
        : kind === 'future-iat' ? { iat: 11 } : kind === 'future-nbf' ? { nbf: 11 }
        : kind === 'fractional-time' ? { exp: 99.5 } : kind === 'bad-sub' ? { sub: '\u0000' }
        : kind === 'markdown-issuer' ? { iss: '[https://appleid.apple.com](https://appleid.apple.com)' } : {};
      const state = kind === 'state-wrong' ? 'wrong' : kind === 'state-missing' ? undefined : kind === 'state-replayed' ? 'F'.repeat(64) : config.state;
      return { authorization: { state, id_token: kind === 'malformed-token' ? 'not.jwt' : s6Jwt(config, clock, claims) } };
    } });
    try { assert.equal(await h.coordinator.signIn(s4Signal()), 'UNAVAILABLE');
      assert.equal(h.calls.some(x => x.kind === 'complete'), false); await s5NoCredential(h);
    } finally { h.dispose(); }
  });
}
for (const kind of ['cancel-return', 'cancel-throw', 'sdk-error', 'init-error', 'digest-error', 'digest-length', 'random-error']) {
  test('S6 SDK/crypto failure or cancellation: ' + kind, async () => {
    const h = s6Fixture({
      initError: kind === 'init-error',
      sdkResult: ({ config, clock }) => {
        if (kind === 'cancel-return') return { error: 'popup_closed_by_user' };
        if (kind === 'cancel-throw') throw { error: 'user_cancelled_authorize' };
        if (kind === 'sdk-error') throw Error('PRIVATE_SDK');
        return { authorization: { state: config.state, id_token: s6Jwt(config, clock) } };
      },
      subtle: kind === 'digest-error' ? { digest: async () => { throw Error('PRIVATE_CRYPTO'); } }
        : kind === 'digest-length' ? { digest: async () => new ArrayBuffer(31) } : undefined,
      randomValues: kind === 'random-error' ? () => { throw Error('PRIVATE_RANDOM'); } : undefined,
    });
    try { assert.equal(await h.coordinator.signIn(s4Signal()), kind.startsWith('cancel-') ? 'CANCELLED' : 'UNAVAILABLE');
      assert.equal(h.calls.some(x => x.kind === 'complete'), false); await s5NoCredential(h);
    } finally { h.dispose(); }
  });
}
for (const phase of ['digest', 'sdk']) for (const action of ['logout', 'invalidate', 'dispose', 'abort', 'replacement']) {
  test('S6 ' + action + ' during ' + phase + ' rejects late effects', async () => {
    const gate = deferred(), controller = new AbortController(); let saved, blocked = false, n = 0;
    const h = s6Fixture({
      subtle: phase === 'digest' ? { digest: async (alg, data) => {
        const value = await webcrypto.subtle.digest(alg, data); if (++n === 1) { blocked = true; saved = value; return gate.promise; } return value;
      } } : undefined,
      sdkResult: phase === 'sdk' ? ({ config, clock }) => {
        const value = { authorization: { state: config.state, id_token: s6Jwt(config, clock) } };
        if (++n === 1) { blocked = true; saved = value; return gate.promise; } return value;
      } : undefined,
    });
    try {
      const pending = h.coordinator.signIn(controller.signal); await s5Until(() => blocked);
      if (action === 'logout') await h.coordinator.logout(s4Signal());
      if (action === 'invalidate') h.coordinator.invalidate(); if (action === 'dispose') h.dispose(); if (action === 'abort') controller.abort();
      if (action === 'replacement') assert.equal(await h.coordinator.signIn(s4Signal()), phase === 'sdk' ? 'UNAVAILABLE' : 'READY');
      gate.resolve(saved); assert.equal(await pending, 'UNAVAILABLE'); await s4Tick();
      if (action === 'replacement' && phase === 'digest') assert.ok(h.coordinator.getSnapshot().binding);
      else await s5NoCredential(h);
      if (action === 'replacement' && phase === 'sdk') assert.equal(await h.coordinator.signIn(s4Signal()), 'READY');
    } finally { gate.resolve(saved); h.dispose(); }
  });
}
test('S6 shared SDK keeps physical ownership across composition abort and releases after settle', async () => {
  const gate = deferred(); let config, calls = 0;
  const sdk = { init(value) { config = { ...value }; }, async signIn() { if (++calls === 1) return gate.promise;
    return { authorization: { state: config.state, id_token: s6Jwt(config, { now: () => 10000 }) } }; } };
  const a = s6Fixture({ sdk }), b = s6Fixture({ sdk }), controller = new AbortController();
  try {
    const old = a.coordinator.signIn(controller.signal); await s5Until(() => calls === 1); const oldConfig = config;
    controller.abort(); assert.equal(await old, 'UNAVAILABLE');
    assert.equal(await b.coordinator.signIn(s4Signal()), 'UNAVAILABLE'); assert.equal(calls, 1);
    gate.resolve({ authorization: { state: oldConfig.state, id_token: s6Jwt(oldConfig, a.clock) } }); await s4Tick(); await s4Tick();
    assert.equal(await b.coordinator.signIn(s4Signal()), 'READY'); await s5NoCredential(a);
    assert.ok(b.coordinator.getSnapshot().binding);
  } finally { gate.resolve({ error: 'user_cancelled_authorize' }); a.dispose(); b.dispose(); }
});
test('S6 SDK source present before composition supports root-shaped configuration', async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'AppleID'); let h;
  const source = s6Fixture(); source.dispose();
  Object.defineProperty(globalThis, 'AppleID', { configurable: true, value: { auth: source.sdk } });
  try { h = s6Fixture({ input: { appleSdk: undefined } }); assert.equal(h.coordinator.canSignInWithApple, true); }
  finally { h?.dispose(); if (old) Object.defineProperty(globalThis, 'AppleID', old); else delete globalThis.AppleID; }
});
test('S6 root wires two public values and retains existing factory call and unchanged iOS', async () => {
  const source = await readFile(new URL('../context/OwnerSessionContext.tsx', import.meta.url), 'utf8');
  assert.match(source, /EXPO_PUBLIC_APPLE_WEB_CLIENT_ID/); assert.match(source, /EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI/);
  assert.match(source, /createWebOwnerSessionComposition\(config\)\.coordinator/);
  assert.doesNotMatch(source, /identityToken|Bearer\s|SecureStore|console\.|acceptIssuedSession|postMessage|localStorage|sessionStorage/);
});
console.log('S6_OFFLINE_EVIDENCE ' + JSON.stringify({ tier: 'CODE_OFFLINE', SDK: 'EXPLICIT_FIXTURE_ONLY',
  crypto: 'BUILTIN_WEB_CRYPTO_PLUS_EXPLICIT_NEGATIVE_DOUBLES', native: 0, real_HTTP_TCP: 0, SDK_download: 0,
  actualAppleLogin: 'NOT_RUN', User001: 'NOT_AUTHORIZED' }));

test('S6 fresh state rejects a real prior SDK response replay on the next attempt', async () => {
  let cached, n = 0;
  const h = s6Fixture({ sdkResult: ({ config, clock }) => {
    if (++n === 2) return cached;
    const response = { authorization: { state: config.state, id_token: s6Jwt(config, clock) } };
    cached = response; return response;
  } });
  try {
    assert.equal(await h.coordinator.signIn(s4Signal()), 'READY'); const old = h.coordinator.getSnapshot().binding;
    const completes = h.calls.filter(x => x.kind === 'complete').length;
    assert.equal(await h.coordinator.signIn(s4Signal()), 'UNAVAILABLE');
    assert.notEqual(h.configs[0].state, h.configs[1].state);
    assert.equal(h.calls.filter(x => x.kind === 'complete').length, completes);
    assert.throws(() => old.access.requireLease(old.lease), /STALE_LEASE/);
    await s5NoCredential(h); assert.equal(await h.coordinator.signIn(s4Signal()), 'READY');
  } finally { h.dispose(); }
});
for (const phase of ['digest', 'sdk']) test('S6 A-B-A request currentness at ' + phase + ' preserves latest same-owner session', async () => {
  const gate = deferred(); let count = 0, blocked = false, saved;
  const h = s6Fixture({
    subtle: phase === 'digest' ? { digest: async (alg, bytes) => {
      const result = await webcrypto.subtle.digest(alg, bytes);
      if (++count === 2) { blocked = true; saved = result; return gate.promise; } return result;
    } } : undefined,
    sdkResult: phase === 'sdk' ? ({ config, clock }) => {
      const result = { authorization: { state: config.state, id_token: s6Jwt(config, clock) } };
      if (++count === 2) { blocked = true; saved = result; return gate.promise; } return result;
    } : undefined,
  });
  try {
    assert.equal(await h.coordinator.signIn(s4Signal()), 'READY'); const oldA = h.coordinator.getSnapshot().binding;
    const lateA = h.coordinator.signIn(s4Signal()); await s5Until(() => blocked);
    if (phase === 'sdk') {
      assert.equal(await h.coordinator.signIn(s4Signal()), 'UNAVAILABLE');
      assert.equal(await h.coordinator.signIn(s4Signal()), 'UNAVAILABLE');
      gate.resolve(saved); assert.equal(await lateA, 'UNAVAILABLE'); await s4Tick();
    }
    assert.equal(await h.coordinator.signIn(s4Signal()), 'READY'); const b = h.coordinator.getSnapshot().binding;
    assert.equal(await h.coordinator.signIn(s4Signal()), 'READY'); const a2 = h.coordinator.getSnapshot().binding;
    if (phase === 'digest') { gate.resolve(saved); assert.equal(await lateA, 'UNAVAILABLE'); await s4Tick(); }
    assert.throws(() => oldA.access.requireLease(oldA.lease), /STALE_LEASE/);
    assert.throws(() => b.access.requireLease(b.lease), /STALE_LEASE/);
    assert.equal(h.coordinator.getSnapshot().binding, a2); assert.equal(a2.access.requireLease(a2.lease).owner.subjectId, S5_OWNER_A.subjectId);
    assert.equal(await a2.authorization.withBearer(s4Signal(), async bearer => bearer === 'Bearer ' + S5_TOKENS[0]), true);
  } finally { gate.resolve(saved); h.dispose(); }
});





// S10 actual local authority/client/engine. Transport is in-memory; no listener.
const {randomBytes:s10Random}=await import('node:crypto');
const {createLocalVerificationAuthority:s10Authority}=await import('../dev/local-verification/authority.ts');
const {resolveLocalVerificationConfig:s10Config,createLocalVerificationClient:s10Client,readLocalVerificationBinding:s10Binding}=await import('../lib/identity/local-verification.ts');
const {createLocalVerificationAdapter:s10Adapter,isLocalVerificationAdapter:s10IsAdapter}=await import('../domain/m3/local-verification-adapter.ts');
const {resolveM3HostPermission:s10Permission}=await import('../domain/m3/host-permission.ts');
const S10_BROWSER='http://127.0.0.1:63338',S10_AUTH='http://127.0.0.1:63339';
function s10Fixture({ttl=600000,issueOverride,holdGet=false}={}){
 const clock=fakeClock(),authority=s10Authority({origin:S10_AUTH,browserOrigin:S10_BROWSER,now:clock.now,ttlMs:ttl,randomBytes:n=>s10Random(n)});
 const wire={holdGet,queue:[],delivered:0};
 const transport=async(url,init)=>{
  const deliver=()=>{wire.delivered++;let r=authority.handle({url,method:init.method,origin:S10_BROWSER,
    authorization:init.headers?.authorization,body:init.body?JSON.parse(init.body):undefined});
   if(issueOverride&&url.endsWith('/local/session'))r={status:200,body:issueOverride};
   return new Response(r.body===undefined?null:JSON.stringify(r.body),{status:r.status});};
  return wire.holdGet&&init.method==='GET'?new Promise(resolve=>wire.queue.push(()=>resolve(deliver()))):deliver();
 };
 const config=s10Config('1',S10_BROWSER,S10_AUTH,'local-verification');
 const client=s10Client(config,{clock,now:clock.now,fetchImpl:transport});
 return {clock,authority,wire,config,client,close(){client.coordinator.dispose();authority.dispose();}};
}
test('S10 A01 registry-issued technical session is independently verified and yields opaque lease',async()=>{
 const f=s10Fixture();try{
  assert.equal(await f.client.control.createSession(),true);
  const b=f.client.coordinator.getSnapshot().binding;
  assert.ok(s10Binding(b));assert.equal(b.access.getSnapshot().phase,'READY');
  const fake={access:b.access,lease:{}};assert.equal(s10Binding(fake),undefined);
  assert.doesNotMatch(JSON.stringify(f.client.coordinator.getSnapshot()),/Bearer|token/);
 }finally{f.close();}
});
for(const [flag,browser,authority,mode] of [
 ['0',S10_BROWSER,S10_AUTH,'local-verification'],['1','https://example.test',S10_AUTH,'local-verification'],
 ['1','http://localhost:63338',S10_AUTH,'local-verification'],['1',S10_BROWSER,'http://0.0.0.0:63339','local-verification'],
 ['1',S10_BROWSER,'http://127.0.0.1:63339/path','local-verification'],['1',S10_BROWSER,S10_AUTH,'live'],
 ['1',S10_BROWSER,'http://127.0.0.1:0','local-verification'],['1',S10_BROWSER,'http://127.0.0.1:63339?x=1','local-verification']
]){
 test('S10 A02 config rejection '+[flag,browser,authority,mode].join('|'),()=>assert.equal(s10Config(flag,browser,authority,mode),undefined));
}
test('S10 A03 caller object cannot self-issue a trusted realm config',()=>{
 const f=s10Fixture();try{assert.throws(()=>s10Client({...f.config}),/UNTRUSTED_CONFIG/);}finally{f.close();}
});
test('S10 A04 server rejects foreign origin/method/path/client-selected owner and replayed issue ID',()=>{
 const f=s10Fixture();try{
  const request={url:S10_AUTH+'/api/identity/local/session',method:'POST',origin:S10_BROWSER,body:{request_id:'a'.repeat(32)}};
  assert.equal(f.authority.handle({...request,origin:'http://foreign.invalid'}).status,403);
  assert.equal(f.authority.handle({...request,method:'GET'}).status,404);
  assert.equal(f.authority.handle({...request,url:S10_AUTH+'/api/identity/apple/session'}).status,404);
  assert.equal(f.authority.handle({...request,body:{request_id:'a'.repeat(32),owner:'caller'}}).status,400);
  assert.equal(f.authority.handle(request).status,200);assert.equal(f.authority.handle(request).status,409);
 }finally{f.close();}
});
test('S10 A05 wrong bearer, expired and server-restarted sessions never verify',async()=>{
 const f=s10Fixture({ttl:1000});try{
  assert.equal(f.authority.handle({url:S10_AUTH+'/api/identity/session',method:'GET',origin:S10_BROWSER,authorization:'Bearer '+'x'.repeat(43)}).status,401);
  assert.equal(await f.client.control.createSession(),true);const b=f.client.coordinator.getSnapshot().binding;
  f.clock.advance(1001);assert.equal(s10Binding(b),undefined);
  assert.equal(f.client.coordinator.getSnapshot().phase,'LOCKED');
 }finally{f.close();}
 const r=s10Fixture();try{
  assert.equal(await r.client.control.createSession(),true);const b=s10Binding(r.client.coordinator.getSnapshot().binding);
  r.authority.dispose();await assert.rejects(b.authorize(new AbortController().signal,async()=>true),/UNAVAILABLE/);
  assert.equal(r.client.coordinator.getSnapshot().phase,'LOCKED');
 }finally{r.close();}
});
test('S10 A06 fake issued payload cannot become owner without server verify',async()=>{
 const f=s10Fixture({issueOverride:{token:'z'.repeat(43),owner:OWNER_A,validUntil:new Date(100000).toISOString()}});
 try{assert.equal(await f.client.control.createSession(),false);assert.equal(f.client.coordinator.getSnapshot().phase,'LOCKED');}finally{f.close();}
});
test('S10 A07 logout retires local metadata and old callback before any restart',async()=>{
 const f=s10Fixture();try{
  const initial=f.client.control;assert.equal(await initial.createSession(),true);
  const b=f.client.coordinator.getSnapshot().binding;const held=f.client.control;
  assert.equal(await f.client.coordinator.logout(new AbortController().signal),true);
  assert.equal(s10Binding(b),undefined);assert.equal(await held.createSession(),false);
  assert.equal(await f.client.control.createSession(),true);
 }finally{f.close();}
});
test('S10 A08 late verify after invalidation cannot publish READY or save successor credential',async()=>{
 const f=s10Fixture({holdGet:true});try{
  const pending=f.client.control.createSession();for(let i=0;i<12&&!f.wire.queue.length;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(f.wire.queue.length);const old=f.client.control;f.client.coordinator.invalidate();
  f.wire.holdGet=false;for(const release of f.wire.queue.splice(0))release();
  assert.equal(await pending,false);assert.equal(f.client.coordinator.getSnapshot().phase,'LOCKED');
  assert.equal(await old.createSession(),false);
  await f.client.coordinator.refresh();assert.equal(await old.createSession(),false);
  assert.equal(await f.client.control.createSession(),true);
 }finally{f.close();}
});
test('S10 C01 actual deterministic adapter keeps fixture provenance and requires explicit local permission',async()=>{
 const f=s10Fixture();try{
  await f.client.control.createSession();const owner=f.client.coordinator.getSnapshot().binding;
  let allowed=false;const adapter=s10Adapter(owner,()=>allowed);
  assert.equal(adapter.provenance,'TEST_FIXTURE');assert.equal(adapter.processing,'ON_DEVICE');assert.equal(s10IsAdapter(adapter),true);
  assert.equal(s10IsAdapter({...adapter}),false);
  assert.equal(s10Permission(adapter,{status:'denied',revision:1}).taskPermissionGranted,false);
  assert.equal(s10Permission(adapter,{status:'allowed',revision:2}).taskPermissionGranted,true);
  const content={locale:'vi',current_text:'Khỏe hơn',relevant_context:[],recent_relevant_turns:[],user_correction:null,safety_signal:'CLEAR',asking_stopped:false};
  const operation={isCurrent:()=>true};
  await assert.rejects(adapter.interpret({content,operation},new AbortController().signal),/DENIED/);
  allowed=true;const meaning=await adapter.interpret({content,operation},new AbortController().signal);
  assert.equal(meaning.task_kind,'general_health');assert.equal(meaning.intent_type,'GOAL');
  const ambiguous=await adapter.interpret({content:{...content,current_text:'unclear phrase'},operation},new AbortController().signal);
  assert.equal(ambiguous.clarification_needed,true);
  await assert.rejects(adapter.interpret({content:{...content,locale:'ja'},operation},new AbortController().signal),/UNSUPPORTED_LOCALE/);
  await assert.rejects(adapter.interpret({content,operation:{isCurrent:()=>false}},new AbortController().signal),/DENIED/);
 }finally{f.close();}
});
test('S10 C02 no replay of a local adapter after actual local owner replacement',async()=>{
 const f=s10Fixture();try{
  await f.client.control.createSession();const a=f.client.coordinator.getSnapshot().binding,adapter=s10Adapter(a,()=>true);
  await f.client.control.createSession();const b=f.client.coordinator.getSnapshot().binding;
  assert.notEqual(a.lease,b.lease);assert.equal(s10Binding(a),undefined);
  assert.equal(s10Permission(adapter,{status:'allowed',revision:2}).taskPermissionGranted,false);
 }finally{f.close();}
});

test('S10 A09 control capability retires on replace, invalidate and dispose',async()=>{
 const f=s10Fixture();try{
  const before=f.client.control;assert.equal(before.isCurrent(),true);
  assert.equal(await before.createSession(),true);assert.equal(before.isCurrent(),false);
  const ready=f.client.control;assert.equal(ready.isCurrent(),true);
  f.client.coordinator.invalidate();assert.equal(ready.isCurrent(),false);
  await f.client.coordinator.refresh();assert.equal(ready.isCurrent(),false);
  assert.equal(await ready.createSession(),false);
  const fresh=f.client.control;assert.equal(fresh.isCurrent(),true);
  f.client.coordinator.dispose();assert.equal(fresh.isCurrent(),false);
  assert.equal(await fresh.createSession(),false);
 }finally{f.close();}
});

test('S10 C03 actual English deterministic meaning and aborted operation',async()=>{
 const f=s10Fixture();try{
  await f.client.control.createSession();const adapter=s10Adapter(f.client.coordinator.getSnapshot().binding,()=>true);
  const content={locale:'en',current_text:'I want to be healthier',relevant_context:[],recent_relevant_turns:[],user_correction:null,safety_signal:'CLEAR',asking_stopped:false};
  const operation={isCurrent:()=>true},meaning=await adapter.interpret({content,operation},new AbortController().signal);
  assert.equal(meaning.intent_type,'GOAL');assert.equal(meaning.task_kind,'general_health');
  const controller=new AbortController();controller.abort();
  await assert.rejects(adapter.interpret({content,operation},controller.signal),/DENIED|STALE|UNAVAILABLE/);
 }finally{f.close();}
});
