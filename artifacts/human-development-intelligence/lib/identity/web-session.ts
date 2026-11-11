import {
  ClientSessionError, ClientSessionTransportError, createProviderNeutralSessionAdapter, createAppleSessionHandoff,
  type AppleChallenge, type IdentitySessionTransport, type IssuedClientSession, type NativeAppleSignIn, type SessionCredentialStore,
} from '../../domain/identity/client-session';
import { createOwnerSessionCoordinator } from '../../domain/identity/owner-session-coordinator';
import type { BoundaryClock } from '../../domain/local-owner/boundary';

const unavailable = (): never => { throw new ClientSessionTransportError('UNAVAILABLE'); };
const MAX_BODY = 32_768;

/** Web-only policy. Does not relax the shared HTTPS/iOS transport. */
export function resolveWebIdentityConfig(originValue: string | undefined, timeoutValue: string | undefined, appleClientId?: string, appleRedirectURI?: string) {
  if (!originValue || !timeoutValue || !/^[1-9][0-9]*$/u.test(timeoutValue)) return undefined;
  const timeoutMs = Number(timeoutValue);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs > 60_000) return undefined;
  if (/[\s\\%?#]/u.test(originValue)) return undefined;
  try {
    const url = new URL(originValue);
    if (!url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || (url.port !== '' && Number(url.port) === 0)) return undefined;
    if (url.protocol !== 'https:') {
      const literal = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?\/?$/iu.exec(originValue);
      if (!literal || (literal[2] !== undefined && (Number(literal[2]) < 1 || Number(literal[2]) > 65_535))) return undefined;
    }
    const appleConfig = resolveWebAppleConfig(url.origin, appleClientId, appleRedirectURI);
    return appleConfig ? Object.freeze({ origin: url.origin, timeoutMs, appleConfig }) : Object.freeze({ origin: url.origin, timeoutMs });
  } catch { return undefined; }
}


type WebAppleConfig = Readonly<{ clientId: string; redirectURI: string }>;
type WebAppleSdk = Readonly<{ init(config: Readonly<{ clientId: string; redirectURI: string; nonce: string; state: string; usePopup: true }>): void; signIn(): Promise<unknown> }>;
const sdkOwners = new WeakMap<object, object>();
export function resolveWebAppleConfig(origin: string, clientId: string | undefined, redirectURI: string | undefined): WebAppleConfig | undefined {
  if (typeof clientId !== 'string' || !clientId.length || clientId.length > 255 || clientId !== clientId.trim()
    || /[\u0000-\u0020\u007f\\/?#%]/u.test(clientId) || typeof redirectURI !== 'string' || /[\s\\%?#]/u.test(redirectURI)) return undefined;
  try {
    const url = new URL(redirectURI);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || url.search || url.hash
      || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.startsWith('[') || /^[0-9.]+$/u.test(url.hostname)) return undefined;
    return Object.freeze({ clientId, redirectURI: url.href });
  } catch { return undefined; }
}
// Client claim precheck only; the server verifies the actual signature/JWK.
function precheckAppleToken(value: unknown, config: WebAppleConfig, nonce: string, now: () => number): string {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > MAX_BODY) return unavailable();
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/u.test(part) || part.length % 4 === 1)) return unavailable();
  const decode = (part: string) => {
    const bytes = Uint8Array.from(atob(part.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
    const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!result || typeof result !== 'object' || Array.isArray(result)) return unavailable();
    return result as Record<string, unknown>;
  };
  const header = decode(parts[0]), claims = decode(parts[1]), time = now();
  const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (header.alg !== 'RS256' || !Number.isFinite(time) || claims.iss !== 'https://appleid.apple.com' || claims.aud !== config.clientId || claims.nonce !== nonce
    || typeof claims.sub !== 'string' || !claims.sub.length || claims.sub.length > 255 || /[\u0000-\u001f\u007f]/u.test(claims.sub)
    || !integer(claims.exp) || !integer(claims.iat) || claims.exp <= Math.floor(time / 1000) || claims.iat > Math.floor(time / 1000) || claims.iat > claims.exp
    || (claims.nbf !== undefined && (!integer(claims.nbf) || claims.nbf > Math.floor(time / 1000)))) return unavailable();
  return value;
}
function createWebAppleSdkAuthorizer(config: WebAppleConfig, sdk: WebAppleSdk, random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>, now: () => number): NativeAppleSignIn {
  const cancelled = (value: unknown) => {
    const code = typeof value === 'string' ? value : value && typeof value === 'object' ? (value as { error?: unknown }).error : undefined;
    return code === 'user_cancelled_authorize' || code === 'popup_closed_by_user';
  };
  return Object.freeze({
    async authorize(nonceDigest: string) {
      if (!/^[0-9a-f]{64}$/u.test(nonceDigest) || sdkOwners.has(sdk)) return unavailable();
      const owner = Object.freeze({}); sdkOwners.set(sdk, owner);
      try {
        const bytes = new Uint8Array(32), result = random(bytes);
        if (result !== bytes) return unavailable();
        const state = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        // Official JS contract: init(config), then signIn() with no arguments.
        sdk.init({ ...config, nonce: nonceDigest, state, usePopup: true });
        const response = await sdk.signIn();
        if (cancelled(response)) return Object.freeze({ status: 'cancelled' as const });
        if (!response || typeof response !== 'object') return unavailable();
        const authorization = (response as { authorization?: { state?: unknown; id_token?: unknown } }).authorization;
        // S6_STATE_CORRELATION: mutation oracle covers wrong/missing state.
        if (!authorization || authorization.state !== state) return unavailable();
        return Object.freeze({ status: 'success' as const, identityToken: precheckAppleToken(authorization.id_token, config, nonceDigest, now) });
      } catch (error) {
        if (cancelled(error)) return Object.freeze({ status: 'cancelled' as const });
        return unavailable();
      } finally {
        // Logical abort does not settle the physical SDK promise.
        if (sdkOwners.get(sdk) === owner) sdkOwners.delete(sdk);
      }
    },
  });
}

function createWebTransport(input: Readonly<{ origin: string; timeoutMs: number; fetchImpl?: typeof fetch }>): IdentitySessionTransport {
  const fetchImpl = input.fetchImpl ?? fetch;
  async function request(path: string, options: Readonly<{
    method: 'GET' | 'POST'; token?: string; body?: Readonly<{ challenge: string; identityToken: string }>; json: boolean;
  }>, signal: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    let rejectAbort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new ClientSessionTransportError('UNAVAILABLE'));
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    const timer = setTimeout(abort, input.timeoutMs);
    if (signal.aborted) abort();
    const work = async () => {
      if (controller.signal.aborted) return unavailable();
      const headers: Record<string, string> = { accept: 'application/json' };
      if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
      let body: string | undefined;
      if (options.body !== undefined) {
        body = JSON.stringify(options.body);
        if (new TextEncoder().encode(body).byteLength > MAX_BODY) return unavailable();
        headers['content-type'] = 'application/json';
      }
      const response = await fetchImpl(input.origin + '/api' + path, {
        method: options.method, headers, body,
        cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal,
      });
      if (controller.signal.aborted) return unavailable();
      if (response.redirected || (response.url && new URL(response.url).origin !== input.origin)) return unavailable();
      if (!response.ok) throw new ClientSessionTransportError(response.status === 401 ? 'DENIED' : 'UNAVAILABLE');
      if (!options.json) return undefined;
      const reader = response.body?.getReader();
      if (!reader) return unavailable();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          if (controller.signal.aborted) return unavailable();
          const part = await reader.read();
          if (controller.signal.aborted) return unavailable();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > MAX_BODY) { await reader.cancel(); return unavailable(); }
          chunks.push(part.value);
        }
        if (size < 2) return unavailable();
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } finally { reader.releaseLock(); }
    };
    try { return await Promise.race([work(), cancelled]); }
    catch (error) { if (error instanceof ClientSessionTransportError) throw error; return unavailable(); }
    finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', rejectAbort);
      controller.abort();
    }
  }
  return Object.freeze({
    async beginApple(signal: AbortSignal) {
      return await request('/identity/apple/challenge', { method: 'POST', json: true }, signal) as AppleChallenge;
    },
    async completeApple(body: Readonly<{ challenge: string; identityToken: string }>, signal: AbortSignal) {
      return await request('/identity/apple/session', { method: 'POST', body, json: true }, signal) as IssuedClientSession;
    },
    async verify(token: string, signal: AbortSignal) {
      return await request('/identity/session', { method: 'GET', token, json: true }, signal);
    },
    async logout(token: string, signal: AbortSignal) {
      await request('/identity/session/logout', { method: 'POST', token, json: false }, signal);
    },
  });
}

/**
 * RAM-only composition. Optional Apple authority must be supplied by a trusted
 * caller; the Web root installs no SDK. Offline fixtures do not close runtime A.
 */
export function createWebOwnerSessionComposition(input: Readonly<{
  origin: string; timeoutMs: number; fetchImpl?: typeof fetch; now?: () => number; clock?: BoundaryClock;
  apple?: NativeAppleSignIn; sha256?: (rawNonce: string) => Promise<string>;
  appleConfig?: WebAppleConfig; appleSdk?: WebAppleSdk | null; subtle?: Pick<SubtleCrypto, "digest"> | null;
  randomValues?: ((bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>) | null;
}>) {
  const config = resolveWebIdentityConfig(input.origin, String(input.timeoutMs));
  if (!config) throw new ClientSessionError('AUTHORITY_UNAVAILABLE');
  const now = input.now ?? input.clock?.now ?? Date.now;
  const transport = createWebTransport({ ...config, fetchImpl: input.fetchImpl });
  let credential: string | null = null, generation = 0, disposed = false;
  const handoffs = new Set<AbortController>();
  type SignInScope = { ticket: number; controller: AbortController; challengeUntil?: number };
  const signInScopes = new WeakMap<AbortSignal, SignInScope>();
  const pendingSignIns = new Map<number, SignInScope>();
  let base: ReturnType<typeof createOwnerSessionCoordinator>;
  const current = (ticket: number) => !disposed && ticket === generation;
  const requireCurrent = (ticket: number) => {
    if (!current(ticket)) throw new ClientSessionError('AUTHORITY_UNAVAILABLE');
  };
  const scopedStore = (ticket: number): SessionCredentialStore => Object.freeze({
    async load() { requireCurrent(ticket); return credential; },
    async save(token: string) { requireCurrent(ticket); credential = token; },
    async remove() { if (current(ticket)) credential = null; },
  });
  const adapter = (ticket: number) => createProviderNeutralSessionAdapter({ store: scopedStore(ticket), transport, now });
  const retireCurrent = () => {
    generation++; credential = null;
    base.invalidate(); // Retire private lease before abort listeners or network work.
    const old = [...handoffs]; handoffs.clear();
    for (const controller of old) controller.abort();
  };
  const checkSignIn = (scope: SignInScope) => {
    requireCurrent(scope.ticket);
    if (scope.controller.signal.aborted) return unavailable();
    if (scope.challengeUntil !== undefined) {
      const time = now();
      if (!Number.isFinite(time) || time >= scope.challengeUntil) return unavailable();
    }
  };
  const session = Object.freeze({
    ownerVerifier: Object.freeze({
      async verify(signal: AbortSignal) {
        const ticket = generation;
        const signIn = pendingSignIns.get(ticket);
        if (signIn) checkSignIn(signIn);
        const result = await adapter(ticket).ownerVerifier.verify(signal);
        if (signIn) checkSignIn(signIn);
        return current(ticket) ? result : Object.freeze({ status: 'unknown' as const });
      },
    }),
    authorization: Object.freeze({
      async withBearer<T>(signal: AbortSignal, use: (authorization: string) => Promise<T>): Promise<T> {
        const ticket = generation;
        return adapter(ticket).authorization.withBearer(signal, async authorization => {
          requireCurrent(ticket);
          const result = await use(authorization);
          requireCurrent(ticket); return result;
        });
      },
    }),
    async logout(signal: AbortSignal) {
      const oldCredential = credential;
      // AUTHORITY_RETIRE_BEFORE_LOGOUT: mutation oracle covers this exact fence.
      retireCurrent();
      const captured: SessionCredentialStore = Object.freeze({
        async load() { return oldCredential; }, async save() { return unavailable(); }, async remove() {},
      });
      await createProviderNeutralSessionAdapter({ store: captured, transport, now }).logout(signal);
    },
  });
  let native = input.apple, digest = input.sha256;
  if (input.apple === undefined && input.sha256 === undefined) {
    const appleConfig = resolveWebAppleConfig(config.origin, input.appleConfig?.clientId, input.appleConfig?.redirectURI);
    const sdk = input.appleSdk !== undefined ? input.appleSdk : (globalThis as unknown as { AppleID?: { auth?: WebAppleSdk } }).AppleID?.auth;
    const subtle = input.subtle !== undefined ? input.subtle : globalThis.crypto?.subtle;
    const random = input.randomValues !== undefined ? input.randomValues : globalThis.crypto?.getRandomValues
      ? (bytes: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(bytes) : undefined;
    if (appleConfig && sdk && typeof sdk.init === 'function' && typeof sdk.signIn === 'function'
      && subtle && typeof subtle.digest === 'function' && typeof random === 'function') {
      native = createWebAppleSdkAuthorizer(appleConfig, sdk, random, now);
      digest = async rawNonce => {
        if (!/^[A-Za-z0-9_-]{43}$/u.test(rawNonce)) return unavailable();
        const bytes = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(rawNonce)));
        if (bytes.byteLength !== 32) return unavailable();
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      };
    }
  }
  const apple = typeof native?.authorize === 'function' && typeof digest === 'function' ? Object.freeze({
    async signIn(signal: AbortSignal) {
      const scope = signInScopes.get(signal);
      if (!scope) return unavailable();
      checkSignIn(scope);
      const scopedSession = adapter(scope.ticket);
      const handoff = createAppleSessionHandoff({
        native: Object.freeze({
          async authorize(nonceDigest: string) {
            checkSignIn(scope);
            const result = await native.authorize(nonceDigest);
            checkSignIn(scope); return result;
          },
        }),
        sha256: async rawNonce => {
          checkSignIn(scope);
          const result = await digest(rawNonce);
          checkSignIn(scope); return result;
        },
        transport: Object.freeze({
          ...transport,
          async beginApple(requestSignal: AbortSignal) {
            checkSignIn(scope);
            const challenge = await transport.beginApple(requestSignal);
            checkSignIn(scope);
            const until = Date.parse(challenge?.validUntil);
            if (!Number.isFinite(until)) return unavailable();
            scope.challengeUntil = until; checkSignIn(scope);
            return challenge;
          },
          async completeApple(body: Readonly<{ challenge: string; identityToken: string }>, requestSignal: AbortSignal) {
            checkSignIn(scope);
            const issued = await transport.completeApple(body, requestSignal);
            checkSignIn(scope); return issued;
          },
        }),
        session: Object.freeze({
          ...scopedSession,
          async acceptIssuedSession(issued: IssuedClientSession, requestSignal: AbortSignal) {
            checkSignIn(scope);
            const result = await scopedSession.acceptIssuedSession(issued, requestSignal);
            checkSignIn(scope); return result;
          },
        }),
      });
      // SDK authorize has no AbortSignal: retire logically and ignore its late
      // result, without claiming that the native/SDK popup is physically closed.
      let abort: () => void = () => {};
      const cancelled = new Promise<never>((_resolve, reject) => {
        abort = () => reject(new ClientSessionTransportError('UNAVAILABLE'));
        signal.addEventListener('abort', abort, { once: true });
      });
      try {
        if (signal.aborted) return unavailable();
        return await Promise.race([handoff.signIn(signal), cancelled]);
      } finally { signal.removeEventListener('abort', abort); }
    },
  }) : undefined;
  base = createOwnerSessionCoordinator({ session, apple, clock: input.clock });
  const coordinator = Object.freeze({ ...base,
    invalidate: retireCurrent,
    async signIn(signal: AbortSignal) {
      if (!apple || disposed || signal.aborted) return 'UNAVAILABLE' as const;
      // Retire before base.signIn creates its own operation ticket. The nested
      // handoff never calls this facade's acceptIssuedSession or refresh.
      // S5_RETIRE_BEFORE_SIGN_IN: mutation oracle covers replacement races.
      retireCurrent();
      const scope: SignInScope = { ticket: generation, controller: new AbortController() };
      const abort = () => { scope.controller.abort(); if (current(scope.ticket)) retireCurrent(); };
      signInScopes.set(scope.controller.signal, scope); pendingSignIns.set(scope.ticket, scope);
      handoffs.add(scope.controller); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      try {
        const result = await base.signIn(scope.controller.signal);
        checkSignIn(scope);
        if (result !== 'READY' && current(scope.ticket)) retireCurrent();
        return result;
      } catch {
        if (current(scope.ticket)) retireCurrent();
        return 'UNAVAILABLE' as const;
      } finally {
        signal.removeEventListener('abort', abort); handoffs.delete(scope.controller);
        signInScopes.delete(scope.controller.signal); pendingSignIns.delete(scope.ticket);
      }
    },
    dispose() { disposed = true; retireCurrent(); base.dispose(); },
  });
  return Object.freeze({
    coordinator,
    async acceptIssuedSession(issued: IssuedClientSession, signal: AbortSignal) {
      if (disposed) throw new ClientSessionError('AUTHORITY_UNAVAILABLE');
      retireCurrent();
      const ticket = generation, controller = new AbortController();
      const abort = () => { controller.abort(); if (current(ticket)) retireCurrent(); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      handoffs.add(controller);
      try {
        const result = await adapter(ticket).acceptIssuedSession(issued, controller.signal);
        requireCurrent(ticket);
        if (controller.signal.aborted) throw new ClientSessionError('AUTHORITY_UNAVAILABLE');
        const ready = await coordinator.refresh();
        if (controller.signal.aborted || !ready) throw new ClientSessionError('AUTHORITY_UNAVAILABLE');
        requireCurrent(ticket);
        return result;
      } catch (error) {
        if (current(ticket)) retireCurrent();
        throw error instanceof ClientSessionError ? error : new ClientSessionError('AUTHORITY_UNAVAILABLE');
      } finally { signal.removeEventListener('abort', abort); handoffs.delete(controller); }
    },
    dispose() { coordinator.dispose(); },
  });
}

/** Explicit, non-release connected test entry. Tokens stay in the existing RAM composition. */
export const CONNECTED_LOOPBACK_SESSION_KEY = '__P100_CONNECTED_LOOPBACK_SESSION_V1__';
export function createConnectedLoopbackWebCoordinator(
  config: Readonly<{origin:string;timeoutMs:number}>,
  options: Readonly<{gate:unknown;host?:object;fetchImpl?:typeof fetch}>,
) {
  const host=options.host??globalThis;
  const documentOrigin=()=>{try{return (host as {location?:{origin?:string}}).location?.origin;}catch{return undefined;}};
  const allowed=()=>{
    if(options.gate!=='1')return false;
    const c=resolveWebIdentityConfig(config.origin,String(config.timeoutMs));
    if(!c||documentOrigin()!==c.origin)return false;
    const u=new URL(c.origin);
    return u.protocol==='http:'&&(u.hostname==='127.0.0.1'||u.hostname==='localhost');
  };
  if(!allowed())return undefined;
  const composition=createWebOwnerSessionComposition({...config,fetchImpl:options.fetchImpl});
  let epoch=0,pending:AbortController|undefined;
  const copySession=(value:unknown):IssuedClientSession|undefined=>{
    try{
      const plain=(v:unknown,keys:readonly string[])=>{
        if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)throw Error('SHAPE');
        const ds=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(ds);
        if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)||!('value'in ds[k])))throw Error('SHAPE');
        return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
      };
      const s=plain(value,['token','owner','validUntil']),o=plain(s.owner,['subjectId','profileId']);
      if(typeof s.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(s.token)||typeof s.validUntil!=='string'||!Number.isFinite(Date.parse(s.validUntil))
        ||!['subjectId','profileId'].every(k=>typeof o[k]==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(o[k])))return undefined;
      return Object.freeze({token:s.token,validUntil:s.validUntil,owner:Object.freeze({subjectId:o.subjectId,profileId:o.profileId})});
    }catch{return undefined;}
  };
  const mount=()=>{
    if(!allowed()||Object.getOwnPropertyDescriptor(host,CONNECTED_LOOPBACK_SESSION_KEY))return()=>{};
    const ticket=++epoch;
    const surface=Object.freeze({provenance:'TEST_FIXTURE_CONNECTED_LOOPBACK' as const,origin:config.origin,
      async accept(value:unknown):Promise<'ready'|'unavailable'>{
        if(ticket!==epoch||!allowed()||Object.getOwnPropertyDescriptor(host,CONNECTED_LOOPBACK_SESSION_KEY)?.value!==surface)return 'unavailable';
        const issued=copySession(value);if(!issued)return 'unavailable';
        pending?.abort();const controller=new AbortController();pending=controller;
        try{
          await composition.acceptIssuedSession(issued,controller.signal);
          return ticket===epoch&&allowed()&&!controller.signal.aborted&&composition.coordinator.getSnapshot().phase==='READY'?'ready':'unavailable';
        }catch{return 'unavailable';}
        finally{if(pending===controller)pending=undefined;}
      },
    });
    Object.defineProperty(host,CONNECTED_LOOPBACK_SESSION_KEY,{value:surface,configurable:true,writable:false,enumerable:false});
    return()=>{
      if(ticket!==epoch)return;epoch++;pending?.abort();pending=undefined;composition.coordinator.invalidate();
      if(Object.getOwnPropertyDescriptor(host,CONNECTED_LOOPBACK_SESSION_KEY)?.value===surface)Reflect.deleteProperty(host,CONNECTED_LOOPBACK_SESSION_KEY);
    };
  };
  return Object.freeze({...composition.coordinator,connectedLoopback:Object.freeze({origin:config.origin,mount})});
}
