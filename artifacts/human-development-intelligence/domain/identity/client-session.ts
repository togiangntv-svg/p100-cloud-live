import type { OwnerVerifier, VerificationResult } from '../local-owner/boundary';

const OPAQUE_256 = /^[A-Za-z0-9_-]{43}$/u;
const OWNER_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const MAX_IDENTITY_TOKEN_LENGTH = 32_768;
const MAX_RESPONSE_BYTES = 32_768;
const MAX_REQUEST_TIMEOUT_MS = 60_000;

export type ClientSessionErrorCode =
  | 'AUTHORITY_UNAVAILABLE'
  | 'INVALID_SESSION'
  | 'STORAGE_UNAVAILABLE';

export class ClientSessionError extends Error {
  readonly code: ClientSessionErrorCode;
  constructor(code: ClientSessionErrorCode) {
    super(code);
    this.name = 'ClientSessionError';
    this.code = code;
  }
}

export type ClientSessionTransportErrorCode = 'DENIED' | 'UNAVAILABLE';

export class ClientSessionTransportError extends Error {
  readonly code: ClientSessionTransportErrorCode;
  constructor(code: ClientSessionTransportErrorCode) {
    super(code);
    this.name = 'ClientSessionTransportError';
    this.code = code;
  }
}

export type ClientOwner = Readonly<{ subjectId: string; profileId: string }>;
export type VerifiedClientSession = Readonly<{
  status: 'verified';
  owner: ClientOwner;
  validUntil: number;
}>;
export type ClientSignInResult = VerifiedClientSession | Readonly<{ status: 'cancelled' }>;

export type AppleChallenge = Readonly<{
  challenge: string;
  rawNonce: string;
  validUntil: string;
}>;
export type IssuedClientSession = Readonly<{
  token: string;
  owner: ClientOwner;
  validUntil: string;
}>;
export type ServerVerifiedSession = Readonly<{
  owner: ClientOwner;
  validUntil: string;
}>;

export interface SessionCredentialStore {
  load(): Promise<string | null>;
  save(token: string): Promise<void>;
  remove(): Promise<void>;
}

export interface InstallationMarkerStore {
  isEstablished(): Promise<boolean>;
  establish(): Promise<void>;
}

export interface IdentitySessionTransport {
  beginApple(signal: AbortSignal): Promise<AppleChallenge>;
  completeApple(
    input: Readonly<{ challenge: string; identityToken: string }>,
    signal: AbortSignal,
  ): Promise<IssuedClientSession>;
  verify(token: string, signal: AbortSignal): Promise<ServerVerifiedSession>;
  logout(token: string, signal: AbortSignal): Promise<void>;
}

export interface NativeAppleSignIn {
  authorize(nonceDigest: string): Promise<
    | Readonly<{ status: 'success'; identityToken: string }>
    | Readonly<{ status: 'cancelled' }>
  >;
}

export interface ProviderNeutralSessionAdapter {
  readonly ownerVerifier: OwnerVerifier;
  readonly authorization: IdentityRequestAuthorization;
  acceptIssuedSession(
    issued: IssuedClientSession,
    signal: AbortSignal,
  ): Promise<VerifiedClientSession>;
  logout(signal: AbortSignal): Promise<void>;
}

export interface IdentityRequestAuthorization {
  withBearer<T>(
    signal: AbortSignal,
    use: (authorization: string) => Promise<T>,
  ): Promise<T>;
}

function fail(code: ClientSessionErrorCode): never {
  throw new ClientSessionError(code);
}

function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) fail('AUTHORITY_UNAVAILABLE');
}

function validOwner(value: unknown): value is ClientOwner {
  if (!value || typeof value !== 'object') return false;
  const owner = value as Record<string, unknown>;
  return typeof owner.subjectId === 'string'
    && OWNER_ID.test(owner.subjectId)
    && typeof owner.profileId === 'string'
    && OWNER_ID.test(owner.profileId);
}

function validUntilMs(value: unknown): number {
  if (typeof value !== 'string') return fail('INVALID_SESSION');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return fail('INVALID_SESSION');
  return parsed;
}

function parseIssued(value: unknown): Readonly<{
  token: string;
  owner: ClientOwner;
  validUntil: number;
}> {
  if (!value || typeof value !== 'object') return fail('INVALID_SESSION');
  const session = value as Record<string, unknown>;
  if (typeof session.token !== 'string' || !OPAQUE_256.test(session.token)
    || !validOwner(session.owner)) return fail('INVALID_SESSION');
  return Object.freeze({
    token: session.token,
    owner: Object.freeze({
      subjectId: session.owner.subjectId,
      profileId: session.owner.profileId,
    }),
    validUntil: validUntilMs(session.validUntil),
  });
}

function parseVerified(value: unknown): Readonly<{ owner: ClientOwner; validUntil: number }> {
  if (!value || typeof value !== 'object') return fail('INVALID_SESSION');
  const session = value as Record<string, unknown>;
  if (!validOwner(session.owner)) return fail('INVALID_SESSION');
  return Object.freeze({
    owner: Object.freeze({
      subjectId: session.owner.subjectId,
      profileId: session.owner.profileId,
    }),
    validUntil: validUntilMs(session.validUntil),
  });
}

function sameVerifiedSession(
  issued: Readonly<{ owner: ClientOwner; validUntil: number }>,
  verified: Readonly<{ owner: ClientOwner; validUntil: number }>,
): boolean {
  return issued.owner.subjectId === verified.owner.subjectId
    && issued.owner.profileId === verified.owner.profileId
    && issued.validUntil === verified.validUntil;
}

async function safeRemove(store: SessionCredentialStore): Promise<void> {
  try {
    await store.remove();
  } catch {
    fail('STORAGE_UNAVAILABLE');
  }
}

function transportFailure(error: unknown): never {
  if (error instanceof ClientSessionError) throw error;
  if (error instanceof ClientSessionTransportError && error.code === 'DENIED') {
    return fail('INVALID_SESSION');
  }
  return fail('AUTHORITY_UNAVAILABLE');
}

function requireHttpsBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return fail('AUTHORITY_UNAVAILABLE');
    }
    return url.toString().replace(/\/+$/u, '');
  } catch {
    return fail('AUTHORITY_UNAVAILABLE');
  }
}

function requireRequestTimeoutMs(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_REQUEST_TIMEOUT_MS) {
    return fail('AUTHORITY_UNAVAILABLE');
  }
  return value;
}

function createRequestAbortScope(callerSignal: AbortSignal, timeoutMs: number): Readonly<{
  signal: AbortSignal;
  dispose(): void;
}> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (callerSignal.aborted) abort();
  else callerSignal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  return Object.freeze({
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      callerSignal.removeEventListener('abort', abort);
    },
  });
}

async function parseBoundedJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length < 2 || text.length > MAX_RESPONSE_BYTES) return fail('AUTHORITY_UNAVAILABLE');
  try {
    return JSON.parse(text);
  } catch {
    return fail('AUTHORITY_UNAVAILABLE');
  }
}

function transportStatus(status: number): never {
  throw new ClientSessionTransportError(status === 401 ? 'DENIED' : 'UNAVAILABLE');
}

export function createInstallBoundSessionCredentialStore(input: Readonly<{
  credentials: SessionCredentialStore;
  installation: InstallationMarkerStore;
}>): SessionCredentialStore {
  let initialization: Promise<void> | undefined;
  const ensureCurrentInstallation = (): Promise<void> => {
    initialization ??= (async () => {
      const established = await input.installation.isEstablished();
      if (established === true) return;
      // AsyncStorage marker loss means a fresh install. Retire any Keychain survivor first.
      await input.credentials.remove();
      await input.installation.establish();
    })();
    return initialization;
  };
  return Object.freeze({
    async load(): Promise<string | null> {
      await ensureCurrentInstallation();
      return input.credentials.load();
    },
    async save(token: string): Promise<void> {
      await ensureCurrentInstallation();
      await input.credentials.save(token);
    },
    async remove(): Promise<void> {
      await ensureCurrentInstallation();
      await input.credentials.remove();
    },
  });
}

export function createIdentityHttpTransport(input: Readonly<{
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}>): IdentitySessionTransport {
  const baseUrl = requireHttpsBaseUrl(input.baseUrl);
  const timeoutMs = requireRequestTimeoutMs(input.timeoutMs);
  const fetchImpl = input.fetchImpl ?? fetch;
  const request = async <T>(
    path: string,
    init: RequestInit,
    callerSignal: AbortSignal,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> => {
    const scope = createRequestAbortScope(callerSignal, timeoutMs);
    let rejectAbort!: (error: Error) => void;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(new ClientSessionTransportError('UNAVAILABLE'));
    scope.signal.addEventListener('abort', onAbort, { once: true });
    try {
      if (scope.signal.aborted) throw new ClientSessionTransportError('UNAVAILABLE');
      const work = (async () => {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          ...init.headers,
        },
        signal: scope.signal,
      });
      if (!response.ok) return transportStatus(response.status);
      const result = await consume(response);
      if (scope.signal.aborted) throw new ClientSessionTransportError('UNAVAILABLE');
      return result;
      })();
      return await Promise.race([work, aborted]);
    } catch (error) {
      if (error instanceof ClientSessionTransportError) throw error;
      throw new ClientSessionTransportError('UNAVAILABLE');
    } finally {
      scope.signal.removeEventListener('abort', onAbort);
      scope.dispose();
    }
  };

  return Object.freeze({
    async beginApple(signal: AbortSignal): Promise<AppleChallenge> {
      return await request('/identity/apple/challenge', { method: 'POST' }, signal,
        async response => await parseBoundedJson(response) as AppleChallenge);
    },
    async completeApple(
      body: Readonly<{ challenge: string; identityToken: string }>,
      signal: AbortSignal,
    ): Promise<IssuedClientSession> {
      return await request('/identity/apple/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, signal, async response => await parseBoundedJson(response) as IssuedClientSession);
    },
    async verify(token: string, signal: AbortSignal): Promise<ServerVerifiedSession> {
      return await request('/identity/session', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      }, signal, async response => await parseBoundedJson(response) as ServerVerifiedSession);
    },
    async logout(token: string, signal: AbortSignal): Promise<void> {
      await request('/identity/session/logout', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }, signal, async () => undefined);
    },
  });
}
export function createProviderNeutralSessionAdapter(dependencies: Readonly<{
  store: SessionCredentialStore;
  transport: IdentitySessionTransport;
  now?: () => number;
}>): ProviderNeutralSessionAdapter {
  const now = dependencies.now ?? Date.now;

  const ownerVerifier: OwnerVerifier = Object.freeze({
    async verify(signal: AbortSignal): Promise<VerificationResult> {
      checkSignal(signal);
      let token: string | null;
      try {
        token = await dependencies.store.load();
      } catch {
        return fail('STORAGE_UNAVAILABLE');
      }
      checkSignal(signal);
      if (token === null) return Object.freeze({ status: 'missing' });
      if (!OPAQUE_256.test(token)) {
        await safeRemove(dependencies.store);
        return Object.freeze({ status: 'unknown' });
      }
      let response: ServerVerifiedSession;
      try {
        response = await dependencies.transport.verify(token, signal);
      } catch (error) {
        if (error instanceof ClientSessionTransportError && error.code === 'DENIED') {
          await safeRemove(dependencies.store);
          return Object.freeze({ status: 'revoked' });
        }
        return transportFailure(error);
      }
      checkSignal(signal);
      const verified = parseVerified(response);
      if (!Number.isFinite(now()) || verified.validUntil <= now()) {
        await safeRemove(dependencies.store);
        return Object.freeze({ status: 'expired' });
      }
      return Object.freeze({
        status: 'verified',
        owner: verified.owner,
        validUntil: verified.validUntil,
      });
    },
  });

  return Object.freeze({
    ownerVerifier,
    authorization: Object.freeze({
      async withBearer<T>(
        signal: AbortSignal,
        use: (authorization: string) => Promise<T>,
      ): Promise<T> {
        checkSignal(signal);
        let token: string | null;
        try {
          token = await dependencies.store.load();
        } catch {
          return fail('STORAGE_UNAVAILABLE');
        }
        checkSignal(signal);
        if (token === null || !OPAQUE_256.test(token)) return fail('INVALID_SESSION');
        // The opaque credential exists only for this bounded callback. It is
        // never returned, stored in coordinator state, logged, or serialized.
        return await use(`Bearer ${token}`);
      },
    }),
    async acceptIssuedSession(
      issuedValue: IssuedClientSession,
      signal: AbortSignal,
    ): Promise<VerifiedClientSession> {
      checkSignal(signal);
      const issued = parseIssued(issuedValue);
      if (!Number.isFinite(now()) || issued.validUntil <= now()) return fail('INVALID_SESSION');
      let verified: Readonly<{ owner: ClientOwner; validUntil: number }>;
      try {
        verified = parseVerified(await dependencies.transport.verify(issued.token, signal));
      } catch (error) {
        try { await dependencies.transport.logout(issued.token, signal); } catch { /* fixed failure below */ }
        return transportFailure(error);
      }
      checkSignal(signal);
      if (!sameVerifiedSession(issued, verified) || verified.validUntil <= now()) {
        try { await dependencies.transport.logout(issued.token, signal); } catch { /* fixed failure below */ }
        return fail('INVALID_SESSION');
      }
      try {
        await dependencies.store.save(issued.token);
      } catch {
        try { await dependencies.transport.logout(issued.token, signal); } catch { /* no payload logging */ }
        return fail('STORAGE_UNAVAILABLE');
      }
      return Object.freeze({
        status: 'verified',
        owner: verified.owner,
        validUntil: verified.validUntil,
      });
    },
    async logout(signal: AbortSignal): Promise<void> {
      let token: string | null;
      try {
        token = await dependencies.store.load();
      } catch {
        return fail('STORAGE_UNAVAILABLE');
      }
      await safeRemove(dependencies.store); // Local authority retires before network work.
      if (token === null || !OPAQUE_256.test(token)) return;
      checkSignal(signal);
      try {
        await dependencies.transport.logout(token, signal);
      } catch (error) {
        return transportFailure(error);
      }
    },
  });
}

export function createAppleSessionHandoff(dependencies: Readonly<{
  native: NativeAppleSignIn;
  transport: IdentitySessionTransport;
  session: ProviderNeutralSessionAdapter;
  sha256(rawNonce: string): Promise<string>;
}>): Readonly<{ signIn(signal: AbortSignal): Promise<ClientSignInResult> }> {
  return Object.freeze({
    async signIn(signal: AbortSignal): Promise<ClientSignInResult> {
      checkSignal(signal);
      let challenge: AppleChallenge;
      try {
        challenge = await dependencies.transport.beginApple(signal);
      } catch (error) {
        return transportFailure(error);
      }
      checkSignal(signal);
      if (!challenge || !OPAQUE_256.test(challenge.challenge)
        || !OPAQUE_256.test(challenge.rawNonce)
        || !Number.isFinite(Date.parse(challenge.validUntil))) {
        return fail('AUTHORITY_UNAVAILABLE');
      }
      let nonceDigest: string;
      try {
        nonceDigest = await dependencies.sha256(challenge.rawNonce);
      } catch {
        return fail('AUTHORITY_UNAVAILABLE');
      }
      checkSignal(signal);
      if (!SHA256_HEX.test(nonceDigest)) return fail('AUTHORITY_UNAVAILABLE');
      let nativeResult: Awaited<ReturnType<NativeAppleSignIn['authorize']>>;
      try {
        nativeResult = await dependencies.native.authorize(nonceDigest);
      } catch {
        return fail('AUTHORITY_UNAVAILABLE');
      }
      checkSignal(signal);
      if (nativeResult.status === 'cancelled') return Object.freeze({ status: 'cancelled' });
      if (typeof nativeResult.identityToken !== 'string'
        || nativeResult.identityToken.length < 1
        || nativeResult.identityToken.length > MAX_IDENTITY_TOKEN_LENGTH) {
        return fail('AUTHORITY_UNAVAILABLE');
      }
      let issued: IssuedClientSession;
      try {
        issued = await dependencies.transport.completeApple({
          challenge: challenge.challenge,
          identityToken: nativeResult.identityToken,
        }, signal);
      } catch (error) {
        return transportFailure(error);
      }
      return dependencies.session.acceptIssuedSession(issued, signal);
    },
  });
}
