import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ClientSessionError,
  ClientSessionTransportError,
  createAppleSessionHandoff,
  createInstallBoundSessionCredentialStore,
  createIdentityHttpTransport,
  createProviderNeutralSessionAdapter,
} from '../domain/identity/client-session.ts';

const NOW = Date.parse('2026-09-21T10:00:00.000Z');
const VALID_UNTIL = '2026-09-21T11:00:00.000Z';
const TOKEN = 'A'.repeat(43);
const CHALLENGE = 'B'.repeat(43);
const RAW_NONCE = 'C'.repeat(43);
const IDENTITY_TOKEN = 'header.payload.signature';
const OWNER = Object.freeze({ subjectId: 'subject_100', profileId: 'profile_100' });
const signal = () => new AbortController().signal;
const sha256 = async value => createHash('sha256').update(value, 'utf8').digest('hex');

function fixture(overrides = {}) {
  const events = [];
  let stored = overrides.initialToken ?? null;
  const store = {
    async load() { events.push(['load']); return stored; },
    async save(value) { events.push(['save', value]); stored = value; },
    async remove() { events.push(['remove']); stored = null; },
  };
  const transport = {
    async beginApple() {
      events.push(['begin']);
      if (overrides.beginError) throw overrides.beginError;
      return { challenge: CHALLENGE, rawNonce: RAW_NONCE, validUntil: VALID_UNTIL };
    },
    async completeApple(input) {
      events.push(['complete', input]);
      if (overrides.completeError) throw overrides.completeError;
      return overrides.issued ?? { token: TOKEN, owner: OWNER, validUntil: VALID_UNTIL };
    },
    async verify(token) {
      events.push(['verify', token]);
      if (overrides.verifyError) throw overrides.verifyError;
      return overrides.verified ?? { owner: OWNER, validUntil: VALID_UNTIL };
    },
    async logout(token) { events.push(['logout', token]); if (overrides.logoutError) throw overrides.logoutError; },
  };
  const native = {
    async authorize(nonce) {
      events.push(['native', nonce]);
      if (overrides.nativeError) throw overrides.nativeError;
      return overrides.nativeResult ?? {
        status: 'success',
        identityToken: IDENTITY_TOKEN,
        user: 'must-not-be-authority',
        email: 'must-not-be-authority@example.test',
        fullName: { givenName: 'Ignored' },
      };
    },
  };
  const adapter = createProviderNeutralSessionAdapter({ store, transport, now: () => NOW });
  const handoff = createAppleSessionHandoff({ native, transport, session: adapter, sha256 });
  return { adapter, events, handoff, readStored: () => stored };
}

function installBoundFixture({ markerPresent, initialToken = TOKEN } = {}) {
  const events = [];
  let stored = initialToken;
  let established = markerPresent;
  const credentials = {
    async load() { events.push(['credential:load']); return stored; },
    async save(value) { events.push(['credential:save', value]); stored = value; },
    async remove() { events.push(['credential:remove']); stored = null; },
  };
  const installation = {
    async isEstablished() { events.push(['marker:read']); return established; },
    async establish(...args) {
      events.push(['marker:write', ...args]);
      established = true;
    },
  };
  const store = createInstallBoundSessionCredentialStore({ credentials, installation });
  const transport = {
    async beginApple() {
      events.push(['begin']);
      return { challenge: CHALLENGE, rawNonce: RAW_NONCE, validUntil: VALID_UNTIL };
    },
    async completeApple(input) {
      events.push(['complete', input]);
      return { token: TOKEN, owner: OWNER, validUntil: VALID_UNTIL };
    },
    async verify(token) {
      events.push(['verify', token]);
      return { owner: OWNER, validUntil: VALID_UNTIL };
    },
    async logout(token) { events.push(['logout', token]); },
  };
  const native = {
    async authorize(nonce) {
      events.push(['native', nonce]);
      return { status: 'success', identityToken: IDENTITY_TOKEN };
    },
  };
  const adapter = createProviderNeutralSessionAdapter({ store, transport, now: () => NOW });
  const handoff = createAppleSessionHandoff({ native, transport, session: adapter, sha256 });
  return {
    adapter,
    events,
    handoff,
    isEstablished: () => established,
    readStored: () => stored,
  };
}

test('challenge rawNonce is SHA-256 hashed before the native Apple request', async () => {
  const f = fixture();
  const result = await f.handoff.signIn(signal());
  assert.deepEqual(result, { status: 'verified', owner: OWNER, validUntil: Date.parse(VALID_UNTIL) });
  const native = f.events.find(event => event[0] === 'native');
  assert.equal(native[1], await sha256(RAW_NONCE));
  const complete = f.events.find(event => event[0] === 'complete');
  assert.deepEqual(complete[1], { challenge: CHALLENGE, identityToken: IDENTITY_TOKEN });
});

test('only the verified opaque 100 session is persisted', async () => {
  const f = fixture();
  await f.handoff.signIn(signal());
  assert.equal(f.readStored(), TOKEN);
  assert.equal(JSON.stringify(f.events).includes(IDENTITY_TOKEN), true);
  const saves = f.events.filter(event => event[0] === 'save');
  assert.deepEqual(saves, [['save', TOKEN]]);
});

test('request authorization confines the opaque session to one bounded callback', async () => {
  const f = fixture({ initialToken: TOKEN });
  let captured;
  const result = await f.adapter.authorization.withBearer(signal(), async authorization => {
    captured = authorization;
    return 'bounded-result';
  });
  assert.equal(result, 'bounded-result');
  assert.equal(captured, `Bearer ${TOKEN}`);
  assert.deepEqual(f.events, [['load']]);
  assert.equal(JSON.stringify(f.adapter).includes(TOKEN), false);

  const missing = fixture();
  await assert.rejects(
    () => missing.adapter.authorization.withBearer(signal(), async () => 'forbidden'),
    { code: 'INVALID_SESSION' },
  );
});

test('native Apple user, email and name cannot override the server owner', async () => {
  const f = fixture();
  const result = await f.handoff.signIn(signal());
  assert.deepEqual(result.status === 'verified' ? result.owner : null, OWNER);
});

test('Apple cancellation is recoverable and creates no session', async () => {
  const f = fixture({ nativeResult: { status: 'cancelled' } });
  assert.deepEqual(await f.handoff.signIn(signal()), { status: 'cancelled' });
  assert.equal(f.events.some(event => event[0] === 'complete'), false);
  assert.equal(f.readStored(), null);
});

test('native Apple failure is fixed and fail-closed', async () => {
  const privateError = new Error(`native failed ${IDENTITY_TOKEN}`);
  const f = fixture({ nativeError: privateError });
  await assert.rejects(() => f.handoff.signIn(signal()), error => {
    assert.equal(error instanceof ClientSessionError, true);
    assert.equal(error.code, 'AUTHORITY_UNAVAILABLE');
    assert.equal(error.message.includes(IDENTITY_TOKEN), false);
    return true;
  });
  assert.equal(f.readStored(), null);
});

test('challenge and session server failures create no local authority', async () => {
  for (const override of [
    { beginError: new Error(`challenge ${IDENTITY_TOKEN}`) },
    { completeError: new Error(`complete ${IDENTITY_TOKEN}`) },
  ]) {
    const f = fixture(override);
    await assert.rejects(() => f.handoff.signIn(signal()), error => {
      assert.equal(error instanceof ClientSessionError, true);
      assert.equal(error.message.includes(IDENTITY_TOKEN), false);
      return true;
    });
    assert.equal(f.readStored(), null);
  }
});

test('a session is verified against the 100 server before persistence', async () => {
  const f = fixture({ verified: { owner: { subjectId: 'other', profileId: 'profile_100' }, validUntil: VALID_UNTIL } });
  await assert.rejects(() => f.handoff.signIn(signal()), { code: 'INVALID_SESSION' });
  assert.equal(f.readStored(), null);
  assert.equal(f.events.some(event => event[0] === 'logout' && event[1] === TOKEN), true);
});

test('logout retires local authority before remote revocation', async () => {
  const f = fixture({ initialToken: TOKEN, logoutError: new Error('offline private') });
  await assert.rejects(() => f.adapter.logout(signal()), { code: 'AUTHORITY_UNAVAILABLE' });
  assert.equal(f.readStored(), null);
  assert.deepEqual(f.events.slice(0, 3).map(event => event[0]), ['load', 'remove', 'logout']);
});

test('401/revoked verification retires the stored session', async () => {
  const f = fixture({ initialToken: TOKEN, verifyError: new ClientSessionTransportError('DENIED') });
  assert.deepEqual(await f.adapter.ownerVerifier.verify(signal()), { status: 'revoked' });
  assert.equal(f.readStored(), null);
});

test('expired verified session is retired locally', async () => {
  const f = fixture({ initialToken: TOKEN, verified: { owner: OWNER, validUntil: new Date(NOW - 1).toISOString() } });
  assert.deepEqual(await f.adapter.ownerVerifier.verify(signal()), { status: 'expired' });
  assert.equal(f.readStored(), null);
});

test('normal relaunch with an installation marker keeps and verifies the session', async () => {
  const f = installBoundFixture({ markerPresent: true });
  assert.deepEqual(await f.adapter.ownerVerifier.verify(signal()), {
    status: 'verified', owner: OWNER, validUntil: Date.parse(VALID_UNTIL),
  });
  assert.equal(f.readStored(), TOKEN);
  assert.equal(f.events.some(event => event[0] === 'credential:remove'), false);
});

test('fresh reinstall marker absence clears a surviving Keychain session before authority', async () => {
  const f = installBoundFixture({ markerPresent: false });
  assert.deepEqual(await f.adapter.ownerVerifier.verify(signal()), { status: 'missing' });
  assert.equal(f.readStored(), null);
  assert.equal(f.isEstablished(), true);
  assert.deepEqual(f.events.slice(0, 4).map(event => event[0]), [
    'marker:read', 'credential:remove', 'marker:write', 'credential:load',
  ]);
  assert.equal(f.events.some(event => event[0] === 'verify'), false);
});

test('re-sign-in after reinstall recovers the same server owner without marker personal data', async () => {
  const f = installBoundFixture({ markerPresent: false });
  assert.deepEqual(await f.adapter.ownerVerifier.verify(signal()), { status: 'missing' });
  const result = await f.handoff.signIn(signal());
  assert.deepEqual(result, { status: 'verified', owner: OWNER, validUntil: Date.parse(VALID_UNTIL) });
  assert.equal(f.readStored(), TOKEN);
  assert.deepEqual(f.events.find(event => event[0] === 'marker:write'), ['marker:write']);
});

test('HTTPS transport uses only the bounded 100 identity endpoints and bearer session', async () => {
  const calls = [];
  const responses = [
    new Response(JSON.stringify({ challenge: CHALLENGE, rawNonce: RAW_NONCE, validUntil: VALID_UNTIL }), { status: 201 }),
    new Response(JSON.stringify({ token: TOKEN, owner: OWNER, validUntil: VALID_UNTIL }), { status: 201 }),
    new Response(JSON.stringify({ owner: OWNER, validUntil: VALID_UNTIL }), { status: 200 }),
    new Response(null, { status: 204 }),
  ];
  const transport = createIdentityHttpTransport({
    baseUrl: 'https://api.example.test/',
    timeoutMs: 1_000,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return responses.shift();
    },
  });
  assert.equal((await transport.beginApple(signal())).rawNonce, RAW_NONCE);
  await transport.completeApple({ challenge: CHALLENGE, identityToken: IDENTITY_TOKEN }, signal());
  await transport.verify(TOKEN, signal());
  await transport.logout(TOKEN, signal());
  assert.deepEqual(calls.map(call => [call.url, call.init.method]), [
    ['https://api.example.test/identity/apple/challenge', 'POST'],
    ['https://api.example.test/identity/apple/session', 'POST'],
    ['https://api.example.test/identity/session', 'GET'],
    ['https://api.example.test/identity/session/logout', 'POST'],
  ]);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    challenge: CHALLENGE,
    identityToken: IDENTITY_TOKEN,
  });
  assert.equal(calls[2].init.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[3].init.headers.authorization, `Bearer ${TOKEN}`);
});

test('identity transport deadline aborts a hanging fetch and redacts its private failure', async () => {
  let aborted = false;
  const transport = createIdentityHttpTransport({
    baseUrl: 'https://api.example.test',
    timeoutMs: 10,
    fetchImpl: async (_url, init) => await new Promise((_resolve, reject) => {
      const onAbort = () => {
        aborted = true;
        reject(new Error(`timed out ${IDENTITY_TOKEN}`));
      };
      if (init?.signal?.aborted) onAbort();
      else init?.signal?.addEventListener('abort', onAbort, { once: true });
    }),
  });
  await assert.rejects(() => transport.beginApple(signal()), error => {
    assert.equal(error instanceof ClientSessionTransportError, true);
    assert.equal(error.code, 'UNAVAILABLE');
    assert.equal(error.message.includes(IDENTITY_TOKEN), false);
    return true;
  });
  assert.equal(aborted, true);
});

test('caller cancellation aborts identity transport before its own deadline', async () => {
  let aborted = false;
  const controller = new AbortController();
  const transport = createIdentityHttpTransport({
    baseUrl: 'https://api.example.test',
    timeoutMs: 10_000,
    fetchImpl: async (_url, init) => await new Promise((_resolve, reject) => {
      const onAbort = () => {
        aborted = true;
        reject(new Error(`caller cancelled ${TOKEN}`));
      };
      if (init?.signal?.aborted) onAbort();
      else init?.signal?.addEventListener('abort', onAbort, { once: true });
    }),
  });
  const request = transport.beginApple(controller.signal);
  controller.abort();
  await assert.rejects(() => request, error => {
    assert.equal(error instanceof ClientSessionTransportError, true);
    assert.equal(error.code, 'UNAVAILABLE');
    assert.equal(error.message.includes(TOKEN), false);
    return true;
  });
  assert.equal(aborted, true);
});

test('transport rejects insecure origins and redacts server payload failures', async () => {
  assert.throws(
    () => createIdentityHttpTransport({ baseUrl: 'http://api.example.test', timeoutMs: 1_000 }),
    { code: 'AUTHORITY_UNAVAILABLE' },
  );
  assert.throws(
    () => createIdentityHttpTransport({ baseUrl: 'https://api.example.test', timeoutMs: 0 }),
    { code: 'AUTHORITY_UNAVAILABLE' },
  );
  const transport = createIdentityHttpTransport({
    baseUrl: 'https://api.example.test',
    timeoutMs: 1_000,
    fetchImpl: async () => new Response(JSON.stringify({ private: IDENTITY_TOKEN }), { status: 503 }),
  });
  await assert.rejects(() => transport.beginApple(signal()), error => {
    assert.equal(error instanceof ClientSessionTransportError, true);
    assert.equal(error.code, 'UNAVAILABLE');
    assert.equal(error.message.includes(IDENTITY_TOKEN), false);
    return true;
  });
});
test('provider-neutral adapter exposes no Apple identity surface', async () => {
  const source = await readFile(new URL('../domain/identity/client-session.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /expo-apple-authentication|AppleAuthenticationCredential|email|fullName|\buser\b/u);
  assert.doesNotMatch(source, /console\.(log|warn|error)/u);
});

test('Expo adapter uses native Apple, SHA-256 and device-only secure storage safely', async () => {
  const source = await readFile(new URL('../lib/identity/expo-apple-session.ts', import.meta.url), 'utf8');
  assert.match(source, /AppleAuthentication\.signInAsync\(\{[\s\S]*nonce: nonceDigest/u);
  assert.match(source, /requestedScopes: \[\]/u);
  assert.match(source, /CryptoDigestAlgorithm\.SHA256/u);
  assert.match(source, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/u);
  assert.match(source, /SecureStore\.(getItemAsync|setItemAsync|deleteItemAsync)/u);
  assert.match(source, /AsyncStorage\.(getItem|setItem)/u);
  assert.match(source, /INSTALL_MARKER_VALUE = 'v1'/u);
  assert.doesNotMatch(source, /AsyncStorage\.setItem\([^,]+,\s*(token|subjectId|profileId)/u);
  assert.match(source, /requestTimeoutMs/u);
  assert.doesNotMatch(source, /credential\.(user|email|fullName)/u);
  assert.doesNotMatch(source, /console\.(log|warn|error)/u);
});

test('native capability is configured without wiring a login wall into M1/M2', async () => {
  const app = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8'));
  assert.equal(app.expo.ios.usesAppleSignIn, true);
  assert.equal(app.expo.plugins.includes('expo-apple-authentication'), true);
  assert.equal(app.expo.plugins.includes('expo-secure-store'), false);
  const layout = await readFile(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(layout, /identity|AppleAuthentication|SignIn/u);
});
