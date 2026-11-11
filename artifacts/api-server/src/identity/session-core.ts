import { createHash, randomBytes, randomUUID } from "node:crypto";

const SCHEMA = '"identity_v1"';
export const IDENTITY_TABLES = Object.freeze({
  owners: `${SCHEMA}."owners"`,
  controls: `${SCHEMA}."verified_control_bindings"`,
  sessions: `${SCHEMA}."sessions"`,
});

declare const verifiedControlBrand: unique symbol;
export type VerifiedControl = Readonly<{ [verifiedControlBrand]: true }>;
export type VerifiedControlDescriptor = Readonly<{
  provider: string;
  credentialNamespaceDigest: string;
  providerSubjectDigest: string;
  concurrencyLockKey: string;
}>;

export interface VerifiedControlAuthority {
  resolve(control: VerifiedControl): VerifiedControlDescriptor;
}

export type IdentitySessionErrorCode =
  | "UNTRUSTED_CONTROL"
  | "INVALID_SESSION"
  | "AUTHORITY_UNAVAILABLE"
  | "AUTHORITY_RETIRED_DB_CLEANUP_PENDING"
  | "INTEGRITY_UNAVAILABLE";

export class IdentitySessionError extends Error {
  readonly code: IdentitySessionErrorCode;
  constructor(code: IdentitySessionErrorCode) {
    super(code);
    this.name = "IdentitySessionError";
    this.code = code;
  }
}

const fail = (code: IdentitySessionErrorCode): never => {
  throw new IdentitySessionError(code);
};
const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function createVerifiedControlCapability() {
  const issued = new WeakMap<object, VerifiedControlDescriptor>();
  const authority: VerifiedControlAuthority = Object.freeze({
    resolve(control: VerifiedControl): VerifiedControlDescriptor {
      if (!control || typeof control !== "object") return fail("UNTRUSTED_CONTROL");
      return issued.get(control) ?? fail("UNTRUSTED_CONTROL");
    },
  });
  const trustedIssuer = Object.freeze({
    issue(input: Readonly<{
      provider: string;
      issuer: string;
      audience: string;
      providerSubject: string;
    }>): VerifiedControl {
      const normalizedProvider = typeof input?.provider === "string"
        ? input.provider.trim().toLowerCase()
        : "";
      const normalizedIssuer = typeof input?.issuer === "string" ? input.issuer.trim() : "";
      const normalizedAudience = typeof input?.audience === "string" ? input.audience.trim() : "";
      const providerSubject = input?.providerSubject;
      if (!/^[a-z][a-z0-9._-]{0,63}$/.test(normalizedProvider)
        || normalizedIssuer.length < 1
        || normalizedIssuer.length > 2048
        || normalizedAudience.length < 1
        || normalizedAudience.length > 2048
        || /[\u0000-\u001f\u007f]/.test(normalizedIssuer)
        || /[\u0000-\u001f\u007f]/.test(normalizedAudience)
        || typeof providerSubject !== "string"
        || providerSubject.length < 1
        || providerSubject.length > 2048) {
        return fail("UNTRUSTED_CONTROL");
      }
      const credentialNamespaceDigest = sha256(JSON.stringify([
        normalizedProvider,
        normalizedIssuer,
        normalizedAudience,
      ]));
      const providerSubjectDigest = sha256(`${credentialNamespaceDigest}\0${providerSubject}`);
      const concurrencyLockKey = BigInt.asIntN(
        64,
        BigInt(`0x${providerSubjectDigest.slice(0, 16)}`),
      ).toString();
      const control = Object.freeze(Object.create(null)) as VerifiedControl;
      issued.set(control, Object.freeze({
        provider: normalizedProvider,
        credentialNamespaceDigest,
        providerSubjectDigest,
        concurrencyLockKey,
      }));
      return control;
    },
  });
  return Object.freeze({ trustedIssuer, authority });
}

export interface SqlResult {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
}
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<SqlResult>;
  release(destroy?: boolean): void;
}
export interface SqlPool {
  connect(): Promise<SqlClient>;
}
export type OwnerIdentity = Readonly<{ subjectId: string; profileId: string }>;
export type VerifiedSession = Readonly<{ owner: OwnerIdentity; validUntil: string }>;
export type IssuedSession = VerifiedSession & Readonly<{ token: string }>;
export type SessionOrigin = Readonly<{
  provider: string;
  credentialNamespaceDigest: string;
  epoch: number;
  reconciliationDigest: string;
}>;
export interface SessionOriginPolicy {
  assertIssuancePreflight(
    pool: SqlPool,
    descriptor: VerifiedControlDescriptor,
  ): Promise<void>;
  authorizeIssuance(
    client: SqlClient,
    descriptor: VerifiedControlDescriptor,
  ): Promise<SessionOrigin>;
  confirmIssuanceCurrent(
    pool: SqlPool,
    input: Readonly<{ origin: SessionOrigin; subjectId: string }>,
  ): Promise<boolean>;
  verifySessionOrigin(
    client: SqlClient,
    input: Readonly<{
      origin: SessionOrigin;
      subjectId: string;
    }>,
  ): Promise<boolean>;
}

function ownerFromRow(row: Record<string, unknown>): OwnerIdentity {
  if (typeof row.subject_id !== "string" || !UUID.test(row.subject_id)
    || typeof row.profile_id !== "string" || !UUID.test(row.profile_id)) {
    return fail("INTEGRITY_UNAVAILABLE");
  }
  return Object.freeze({
    subjectId: row.subject_id.toLowerCase(),
    profileId: row.profile_id.toLowerCase(),
  });
}

function dateFromRow(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) return fail("INTEGRITY_UNAVAILABLE");
  return date.toISOString();
}

function bindingIdFromRow(row: Record<string, unknown>): string {
  if (typeof row.binding_id !== "string" || !UUID.test(row.binding_id)) {
    return fail("INTEGRITY_UNAVAILABLE");
  }
  return row.binding_id.toLowerCase();
}

function sessionOriginFromRow(row: Record<string, unknown>): SessionOrigin | null {
  const values = [
    row.issuer_provider,
    row.issuer_namespace_digest,
    row.issuer_epoch,
    row.issuer_reconciliation_digest,
  ];
  const absent = values.map(value => value === null || value === undefined);
  if (absent.every(Boolean)) return null;
  if (absent.some(Boolean)
    || typeof row.issuer_provider !== "string"
    || !/^[a-z][a-z0-9._-]{0,63}$/.test(row.issuer_provider)
    || typeof row.issuer_namespace_digest !== "string"
    || !/^[0-9a-f]{64}$/.test(row.issuer_namespace_digest)
    || !Number.isSafeInteger(Number(row.issuer_epoch))
    || Number(row.issuer_epoch) < 1
    || typeof row.issuer_reconciliation_digest !== "string"
    || !/^[0-9a-f]{64}$/.test(row.issuer_reconciliation_digest)) {
    return fail("INTEGRITY_UNAVAILABLE");
  }
  return Object.freeze({
    provider: row.issuer_provider,
    credentialNamespaceDigest: row.issuer_namespace_digest,
    epoch: Number(row.issuer_epoch),
    reconciliationDigest: row.issuer_reconciliation_digest,
  });
}

async function useClient<T>(
  pool: SqlPool,
  transaction: boolean,
  work: (client: SqlClient) => Promise<T>,
): Promise<T> {
  let client: SqlClient;
  try {
    client = await pool.connect();
  } catch {
    return fail("AUTHORITY_UNAVAILABLE");
  }
  let destroy = false;
  let commitAttempted = false;
  try {
    if (transaction) await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const result = await work(client);
    if (transaction) {
      commitAttempted = true;
      await client.query("COMMIT");
    }
    return result;
  } catch (error) {
    if (transaction) {
      try { await client.query("ROLLBACK"); } catch { destroy = true; }
    }
    if (commitAttempted) destroy = true;
    if (error instanceof IdentitySessionError) throw error;
    destroy = true;
    return fail("AUTHORITY_UNAVAILABLE");
  } finally {
    client.release(destroy);
  }
}


export type OwnerRevocation = Readonly<{owner: OwnerIdentity; sessionKeys: readonly string[]; retired: boolean}>;
const retiredOwners = new Set<string>();
const verifiedFactOwners = new WeakMap<object,Readonly<{sessionKey:string;validUntil:string}>>();
const revokedSessionKeys = new Set<string>();
const revocationListeners = new Set<(event: OwnerRevocation) => void>();
const ownerKey = (owner: OwnerIdentity) => JSON.stringify([owner.subjectId, owner.profileId]);
export function assertIdentityNotRetired(owner: OwnerIdentity, sessionKey?: string): void {
  if (retiredOwners.has(ownerKey(owner)) || (sessionKey !== undefined && revokedSessionKeys.has(sessionKey))) fail('INVALID_SESSION');
}
export function subscribeOwnerRevocation(listener: (event: OwnerRevocation) => void): () => void {
  revocationListeners.add(listener); return () => { revocationListeners.delete(listener); };
}
function publishOwnerRevocation(owner: OwnerIdentity, sessionKeys: readonly string[], retired: boolean): void {
  if (retired) retiredOwners.add(ownerKey(owner));
  for (const key of sessionKeys) revokedSessionKeys.add(key);
  const event = Object.freeze({owner: Object.freeze({...owner}), sessionKeys: Object.freeze([...sessionKeys]), retired});
  let incomplete = false;
  for (const listener of [...revocationListeners]) try { listener(event); } catch { incomplete = true; }
  if (incomplete) fail('AUTHORITY_RETIRED_DB_CLEANUP_PENDING');
}

export interface IdentitySessionCore {
  issueSession(control: VerifiedControl): Promise<IssuedSession>;
  verifySession(token: string): Promise<VerifiedSession>;
  revokeSession(token: string): Promise<void>;
  eraseAccount(token: string): Promise<void>;
  readOwnerFacts(token: string): Promise<unknown>;
}

export function createPostgresIdentitySessionCore(
  pool: SqlPool,
  authority: VerifiedControlAuthority,
  options: {
    sessionTtlMs: number;
    now?: () => number;
    newId?: () => string;
    tokenBytes?: (size: number) => Buffer;
    originPolicy?: SessionOriginPolicy;
    taskAuthority?: OwnerTaskFactsAuthority;
  },
): IdentitySessionCore {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomUUID;
  const tokenBytes = options.tokenBytes ?? randomBytes;
  const sessionTtlMs = options.sessionTtlMs;
  if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1) {
    return fail("INTEGRITY_UNAVAILABLE");
  }

  const currentDate = (): Date => {
    const value = now();
    if (!Number.isFinite(value)) return fail("AUTHORITY_UNAVAILABLE");
    return new Date(value);
  };
  const validTokenDigest = (token: unknown): string => {
    if (typeof token !== "string" || !TOKEN.test(token)) return fail("INVALID_SESSION");
    return sha256(token);
  };

  const core: IdentitySessionCore = Object.freeze({
    async issueSession(control: VerifiedControl): Promise<IssuedSession> {
      const descriptor = authority.resolve(control);
      if (descriptor.provider === "google") {
        if (!options.originPolicy) return fail("AUTHORITY_UNAVAILABLE");
        await options.originPolicy.assertIssuancePreflight(pool, descriptor);
      }
      const issuedAt = currentDate();
      const validUntil = new Date(issuedAt.getTime() + sessionTtlMs);
      if (!Number.isFinite(validUntil.getTime())) return fail("AUTHORITY_UNAVAILABLE");
      const token = tokenBytes(32).toString("base64url");
      if (!TOKEN.test(token)) return fail("AUTHORITY_UNAVAILABLE");
      const tokenDigest = sha256(token);
      const candidateOwner = Object.freeze({ subjectId: newId(), profileId: newId() });
      const bindingId = newId();
      const sessionId = newId();
      for (const id of [candidateOwner.subjectId, candidateOwner.profileId, bindingId, sessionId]) {
        if (!UUID.test(id)) return fail("AUTHORITY_UNAVAILABLE");
      }

      const owner = await useClient(pool, true, async client => {
        await client.query(
          "/* identity71:lock-control */ SELECT pg_advisory_xact_lock($1::bigint)",
          [descriptor.concurrencyLockKey],
        );
        const existing = await client.query(
          `/* identity71:find-owner */ SELECT o.subject_id, o.profile_id, c.binding_id FROM ${IDENTITY_TABLES.controls} c `
          + `JOIN ${IDENTITY_TABLES.owners} o ON o.subject_id=c.subject_id `
          + "WHERE c.provider=$1 AND c.credential_namespace_digest=$2 "
          + "AND c.provider_subject_digest=$3 AND o.status='ACTIVE' FOR UPDATE",
          [descriptor.provider, descriptor.credentialNamespaceDigest, descriptor.providerSubjectDigest],
        );
        let resolved: Readonly<{ owner: OwnerIdentity; bindingId: string }>;
        if (existing.rows.length === 0) {
          await client.query(
            `/* identity71:insert-owner */ INSERT INTO ${IDENTITY_TABLES.owners} `
            + "(subject_id,profile_id,status,created_at) VALUES ($1,$2,'ACTIVE',$3)",
            [candidateOwner.subjectId, candidateOwner.profileId, issuedAt],
          );
          await client.query(
            `/* identity71:insert-control */ INSERT INTO ${IDENTITY_TABLES.controls} `
            + "(binding_id,provider,credential_namespace_digest,provider_subject_digest,subject_id,created_at) "
            + "VALUES ($1,$2,$3,$4,$5,$6)",
            [
              bindingId,
              descriptor.provider,
              descriptor.credentialNamespaceDigest,
              descriptor.providerSubjectDigest,
              candidateOwner.subjectId,
              issuedAt,
            ],
          );
          resolved = Object.freeze({ owner: candidateOwner, bindingId });
        } else if (existing.rows.length === 1) {
          resolved = Object.freeze({
            owner: ownerFromRow(existing.rows[0]),
            bindingId: bindingIdFromRow(existing.rows[0]),
          });
        } else {
          return fail("INTEGRITY_UNAVAILABLE");
        }
        assertIdentityNotRetired(resolved.owner);
        const origin = descriptor.provider === "google"
          ? await (options.originPolicy?.authorizeIssuance(client, descriptor)
            ?? fail("AUTHORITY_UNAVAILABLE"))
          : null;
        await client.query(
          `/* identity71:insert-session */ INSERT INTO ${IDENTITY_TABLES.sessions} `
          + "(session_id,token_digest,subject_id,issued_at,valid_until,revoked_at,"
          + "issuer_provider,issuer_namespace_digest,issuer_epoch,issuer_reconciliation_digest,"
          + "legacy_control_binding_id) VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10)",
          [
            sessionId,
            tokenDigest,
            resolved.owner.subjectId,
            issuedAt,
            validUntil,
            origin?.provider ?? null,
            origin?.credentialNamespaceDigest ?? null,
            origin?.epoch ?? null,
            origin?.reconciliationDigest ?? null,
            descriptor.provider === "apple" ? resolved.bindingId : null,
          ],
        );
        return Object.freeze({ owner: resolved.owner, origin });
      });
      if (owner.origin !== null
        && (!options.originPolicy
          || !await options.originPolicy.confirmIssuanceCurrent(pool, {
            origin: owner.origin,
            subjectId: owner.owner.subjectId,
          }))) {
        return fail("AUTHORITY_UNAVAILABLE");
      }
      assertIdentityNotRetired(owner.owner, tokenDigest);
      return Object.freeze({ token, owner: owner.owner, validUntil: validUntil.toISOString() });
    },

    async verifySession(token: string): Promise<VerifiedSession> {
      const tokenDigest = validTokenDigest(token);
      const checkedAt = currentDate();
      return useClient(pool, false, async client => {
        const result = await client.query(
          `/* identity71:verify-session */ SELECT o.subject_id,o.profile_id,s.valid_until,`
          + "s.issuer_provider,s.issuer_namespace_digest,s.issuer_epoch,s.issuer_reconciliation_digest,"
          + "s.legacy_control_binding_id "
          + `FROM ${IDENTITY_TABLES.sessions} s JOIN ${IDENTITY_TABLES.owners} o ON o.subject_id=s.subject_id `
          + "WHERE s.token_digest=$1 AND s.revoked_at IS NULL AND s.valid_until>$2 AND o.status='ACTIVE' "
          + "AND ((s.issuer_provider IS NOT NULL AND s.issuer_namespace_digest IS NOT NULL "
          + "AND s.issuer_epoch IS NOT NULL AND s.issuer_reconciliation_digest IS NOT NULL "
          + "AND s.legacy_control_binding_id IS NULL) OR ("
          + "s.issuer_provider IS NULL AND s.issuer_namespace_digest IS NULL "
          + "AND s.issuer_epoch IS NULL AND s.issuer_reconciliation_digest IS NULL "
          + "AND s.legacy_control_binding_id IS NOT NULL AND EXISTS ("
          + `SELECT 1 FROM ${IDENTITY_TABLES.controls} legacy_control `
          + "WHERE legacy_control.binding_id=s.legacy_control_binding_id "
          + "AND legacy_control.subject_id=s.subject_id AND legacy_control.provider='apple'))) ",
          [tokenDigest, checkedAt],
        );
        if (result.rows.length !== 1) return fail("INVALID_SESSION");
        const row = result.rows[0];
        const owner = ownerFromRow(row);
        assertIdentityNotRetired(owner, tokenDigest);
        const origin = sessionOriginFromRow(row);
        if (origin !== null
          && (!options.originPolicy
            || !await options.originPolicy.verifySessionOrigin(client, {
              origin,
              subjectId: owner.subjectId,
            }))) {
          return fail("INVALID_SESSION");
        }
        const validUntil=dateFromRow(row.valid_until);verifiedFactOwners.set(owner,Object.freeze({sessionKey:tokenDigest,validUntil}));
        return Object.freeze({ owner, validUntil });
      });
    },

    async revokeSession(token: string): Promise<void> {
      const tokenDigest = validTokenDigest(token);
      const verified = await core.verifySession(token);
      const revokedAt = currentDate();
      await useClient(pool, true, async client => {
        const result = await client.query(
          `/* identity71:revoke-session */ UPDATE ${IDENTITY_TABLES.sessions} SET revoked_at=$2 `
          + "WHERE token_digest=$1 AND revoked_at IS NULL AND valid_until>$2 RETURNING session_id",
          [tokenDigest, revokedAt],
        );
        if (result.rows.length !== 1) return fail("INVALID_SESSION");
      });
      publishOwnerRevocation(verified.owner, [tokenDigest], false);
    },

    async readOwnerFacts(token:string):Promise<unknown>{
      const identity=await core.verifySession(token);
      const sessionKey=validTokenDigest(token);assertIdentityNotRetired(identity.owner,sessionKey);
      return options.taskAuthority?.read({...identity,sessionKey})??Object.freeze({version:'owner-facts.v1',state:'UNKNOWN',provenance:'UNCONFIGURED'});
    },
    async eraseAccount(token: string): Promise<void> {
      const tokenDigest = validTokenDigest(token), at = currentDate();
      let retirement: OwnerIdentity | undefined; let sessionKeys: string[] = [];
      try {
        await useClient(pool, true, async client => {
          const found = await client.query(
            '/* identity55:lock-owner */ SELECT o.subject_id,o.profile_id,s.valid_until,s.issuer_provider,s.issuer_namespace_digest,s.issuer_epoch,s.issuer_reconciliation_digest,s.legacy_control_binding_id FROM '+IDENTITY_TABLES.sessions+' s JOIN '+IDENTITY_TABLES.owners+' o ON o.subject_id=s.subject_id '
            +"WHERE s.token_digest=$1 AND s.revoked_at IS NULL AND s.valid_until>$2 AND o.status='ACTIVE' "
            +"AND ((s.issuer_provider IS NOT NULL AND s.legacy_control_binding_id IS NULL) OR (s.issuer_provider IS NULL AND EXISTS (SELECT 1 FROM "+IDENTITY_TABLES.controls+" c WHERE c.binding_id=s.legacy_control_binding_id AND c.subject_id=s.subject_id AND c.provider='apple'))) FOR UPDATE OF o", [tokenDigest, at]);
          if (found.rows.length !== 1) return fail('INVALID_SESSION');
          const owner = ownerFromRow(found.rows[0]); assertIdentityNotRetired(owner, tokenDigest);
          // Reuse the SAME transaction client; never acquire a second pool connection while holding owner locks.
          const origin = sessionOriginFromRow(found.rows[0]);
          if (Date.parse(dateFromRow(found.rows[0].valid_until)) <= currentDate().getTime()) return fail('INVALID_SESSION');
          if (origin !== null && (!options.originPolicy || !await options.originPolicy.verifySessionOrigin(client, {origin, subjectId:owner.subjectId}))) return fail('INVALID_SESSION');
          const updated = await client.query('/* identity55:retire-owner */ UPDATE '+IDENTITY_TABLES.owners
            +" SET status='RETIRED' WHERE subject_id=$1 AND profile_id=$2 AND status='ACTIVE' RETURNING subject_id", [owner.subjectId, owner.profileId]);
          if (updated.rows.length !== 1) return fail('INVALID_SESSION');
          retirement = owner;
          const removed = await client.query('/* identity55:erase-sessions */ DELETE FROM '+IDENTITY_TABLES.sessions+' WHERE subject_id=$1 RETURNING token_digest', [owner.subjectId]);
          sessionKeys = removed.rows.map(row => { if (typeof row.token_digest !== 'string' || !/^[0-9a-f]{64}$/.test(row.token_digest)) return fail('INTEGRITY_UNAVAILABLE'); return row.token_digest; });
          await client.query('/* identity55:erase-controls */ DELETE FROM '+IDENTITY_TABLES.controls+' WHERE subject_id=$1', [owner.subjectId]);
        });
      } catch (error) {
        // A COMMIT transport failure cannot prove rollback. Retire RAM fail-closed; never announce completed erasure.
        if (retirement) { publishOwnerRevocation(retirement, sessionKeys, true); return fail('AUTHORITY_RETIRED_DB_CLEANUP_PENDING'); }
        throw error;
      }
      if (!retirement) return fail('INTEGRITY_UNAVAILABLE');
      publishOwnerRevocation(retirement, sessionKeys, true); // synchronous before success is observable
    },
  });
  return core;
}

/** Authenticated self-erasure only. Body cannot select another owner. No Express dependency. */
export function createAccountErasureDispatcher(core: Pick<IdentitySessionCore, 'eraseAccount'>) {
  return async (wire: Readonly<{path:string;method:string;headers?:Readonly<Record<string,string|undefined>>;rawBody:string|Uint8Array;signal?:AbortSignal}>) => {
    const headers = {'Cache-Control':'no-store'};
    const reply=(status:number,code?:string)=>({status,headers,body:code?{code}:undefined});
    if (wire.path !== '/api/identity/account/delete') return reply(404,'NOT_FOUND');
    if (wire.method !== 'POST') return reply(405,'METHOD_NOT_ALLOWED');
    const h=Object.entries(wire.headers??{});
    const auth=h.filter(([k])=>k.toLowerCase()==='authorization');
    const content=h.filter(([k])=>k.toLowerCase()==='content-type');
    const match=auth.length===1&&typeof auth[0][1]==='string'?/^Bearer ([A-Za-z0-9_-]{43})$/.exec(auth[0][1]):null;
    if(!match)return reply(401,'INVALID_SESSION');
    if(content.length!==1||content[0][1]?.split(';')[0].trim().toLowerCase()!=='application/json')return reply(415,'UNSUPPORTED_MEDIA_TYPE');
    const bytes=typeof wire.rawBody==='string'?new TextEncoder().encode(wire.rawBody):wire.rawBody;
    if(!(bytes instanceof Uint8Array)||bytes.byteLength>1024)return reply(413,'PAYLOAD_TOO_LARGE');
    let body:unknown;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return reply(400,'INVALID_CONFIRMATION');}
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||(body as {confirm?:unknown}).confirm!==true)return reply(400,'INVALID_CONFIRMATION');
    if(wire.signal?.aborted)return reply(409,'CANCELLED');
    try{await core.eraseAccount(match[1]);return reply(204);}catch(error){return reply(error instanceof IdentitySessionError&&error.code==='INVALID_SESSION'?401:503,error instanceof IdentitySessionError?error.code:'AUTHORITY_UNAVAILABLE');}
  };
}

export type OwnerTaskHistoryPort = Readonly<{
 provenance:'TEST_FIXTURE'|'PRODUCTION_OWNED';
 read(owner:OwnerIdentity):unknown; subscribe(listener:(owner?:OwnerIdentity)=>void):()=>void;
}>;
/** Trusted SERVER composition injection, never a body/header/environment task producer. */
export function createOwnerTaskFactsAuthority(options:Readonly<{source?:OwnerTaskHistoryPort;now?:()=>number}>={}){
 const now=options.now??Date.now, source=options.source;
 const versions=new Map<string,{version:number;fingerprint:string}>(), sessions=new Map<string,string>();
 const listeners=new Set<(owner?:OwnerIdentity)=>void>();let disposed=false;
 const emit=(owner?:OwnerIdentity)=>{for(const fn of [...listeners])try{fn(owner)}catch{}};
 const offSource=source?.subscribe(emit);
 const offRetirement=subscribeOwnerRevocation(event=>{if(event.retired)versions.delete(ownerKey(event.owner));for(const key of event.sessionKeys)sessions.delete(key);emit(event.owner);});
 const plain=(value:unknown):any=>{
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number')return value;
  if(Array.isArray(value)){if(value.length>32)throw Error('FACTS_BOUND');return Object.freeze(value.map(plain));}
  if(typeof value!=='object'||!value)throw Error('FACTS_DATA');
  const d=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(d).length>24)throw Error('FACTS_BOUND');
  const copy:Record<string,unknown>={};for(const key of Reflect.ownKeys(d)){if(typeof key!=='string'||key==='__proto__'||!('value'in d[key]))throw Error('FACTS_ACCESSOR');copy[key]=plain(d[key].value);}return Object.freeze(copy);
 };
 const unknown=()=>Object.freeze({version:'owner-facts.v1',state:'UNKNOWN',provenance:'UNCONFIGURED'});
 const read=(identity:Readonly<{owner:OwnerIdentity;sessionKey:string;validUntil:string}>)=>{
  try{assertIdentityNotRetired(identity.owner,identity.sessionKey);const issued=verifiedFactOwners.get(identity.owner);if(!issued||issued.sessionKey!==identity.sessionKey||issued.validUntil!==identity.validUntil)return unknown();const at=now();
   if(disposed||!source||!['TEST_FIXTURE','PRODUCTION_OWNED'].includes(source.provenance)||!Number.isFinite(at)||Date.parse(identity.validUntil)<=at)return unknown();
   const raw=plain(source.read(identity.owner));if(JSON.stringify(raw).length>12000)throw Error('FACTS_BOUND');
   if(raw.owner?.subjectId!==identity.owner.subjectId||raw.owner?.profileId!==identity.owner.profileId
    ||!Number.isSafeInteger(raw.sourceVersion)||raw.sourceVersion<1||!Number.isFinite(raw.observedAt)||raw.observedAt>at
    ||!Number.isFinite(raw.validUntil)||raw.validUntil<=at)return unknown();
   const key=ownerKey(identity.owner),fingerprint=JSON.stringify(raw),old=versions.get(key);
   if(old&&(raw.sourceVersion<old.version||raw.sourceVersion===old.version&&fingerprint!==old.fingerprint))return unknown();
   versions.set(key,{version:raw.sourceVersion,fingerprint});
   if(!sessions.has(identity.sessionKey))sessions.set(identity.sessionKey,randomUUID());
   const c=raw.complete,complete=!!c&&c.profile===true&&c.goal===true&&c.activeTask===true&&c.returning===true;
   const task=raw.task,returning=raw.returning,change=raw.change;let state='UNKNOWN';
   const taskValid=task&&typeof task.id==='string'&&task.id.length>0&&typeof task.sessionId==='string'
    &&Number.isSafeInteger(task.revision)&&task.revision>0&&typeof task.kind==='string'&&['READY','STARTED','STOPPED','ENDED'].includes(task.status);
   if(complete&&['new','existing'].includes(raw.profile)&&['none','confirmed'].includes(raw.goal)){
    if(taskValid&&task.status==='ENDED'&&task.endKind==='USER_REPORTED_END')state='JUST_COMPLETED';
    else if(change?.kind==='USER_CONFIRMED_CHANGE'&&change.revision===raw.sourceVersion&&Number.isFinite(change.observedAt)&&change.observedAt<=at)state='CHANGED';
    else if(taskValid&&task.status==='STARTED'&&task.startKind==='USER_REPORTED_START')state='IN_PROGRESS';
    else if(task===null&&returning?.kind==='USER_CONFIRMED_RETURN'&&typeof returning.planId==='string'&&typeof returning.title==='string'&&returning.title.trim())state='RETURNING';
    else if(task===null&&returning===null&&raw.profile==='new'&&raw.goal==='none')state='NEW';
   }
   const envelope={version:'owner-facts.v1',owner:Object.freeze({...identity.owner}),sessionBinding:sessions.get(identity.sessionKey),
    sourceVersion:raw.sourceVersion,basisRevision:raw.sourceVersion+':'+sessions.get(identity.sessionKey),
    observedAt:raw.observedAt,validUntil:Math.min(raw.validUntil,Date.parse(identity.validUntil)),provenance:source.provenance,
    complete:Object.freeze({...c}),profile:raw.profile,goal:raw.goal,task:taskValid?Object.freeze({...task}):null,
    returning:returning?Object.freeze({...returning}):null,change:change?Object.freeze({...change}):null,state};
   assertIdentityNotRetired(identity.owner,identity.sessionKey);return Object.freeze(envelope);
  }catch{return unknown();}
 };
 return Object.freeze({read,subscribe:(fn:(owner?:OwnerIdentity)=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}},
  readVisionFacts:(identity:Readonly<{owner:OwnerIdentity;sessionKey:string;validUntil:string}>)=>{
   const facts=read(identity) as any, task=facts.task, image=task?.image;
   const domains:Record<string,string>={meal_image_assessment:'meal',exercise_form_observation:'exercise_form',physique_posture_observation:'physique_posture'};
   if(facts.provenance==='UNCONFIGURED'||!task||!['READY','STARTED'].includes(task.status)||task.safety!=='CLEAR'||task.permission!=='allowed'||!domains[task.kind]||!image||image.c1Accepted!==true||image.m4Required!==true
    ||typeof image.candidateId!=='string'||!Number.isSafeInteger(image.c1Revision)||image.c1Revision<1)return undefined;
   const domain=domains[task.kind],purpose=domain==='meal'?'MEAL_IMAGE_EXTERNAL_ANALYSIS':domain==='exercise_form'?'EXERCISE_FORM_EXTERNAL_ANALYSIS':'PHYSIQUE_POSTURE_EXTERNAL_ANALYSIS';
   return Object.freeze({owner:facts.owner,sessionKey:identity.sessionKey,taskSessionId:task.sessionId,taskId:task.id,taskRevision:task.revision,
    taskKind:task.kind,vision_domain:domain,purpose,candidateId:image.candidateId,c1Revision:image.c1Revision,m4Required:true,c1Accepted:true,
    sourceEpoch:facts.sourceVersion,validUntil:facts.validUntil,provenance:facts.provenance});
  },dispose:()=>{disposed=true;offSource?.();offRetirement();versions.clear();sessions.clear();emit();listeners.clear();}});
}
export type OwnerTaskFactsAuthority=ReturnType<typeof createOwnerTaskFactsAuthority>;
