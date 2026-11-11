import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import type { JsonWebKeyInput } from "node:crypto";
import type {
  IdentitySessionCore,
  IssuedSession,
  SqlClient,
  SqlPool,
  VerifiedControl,
} from "./session-core";

export const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_CHALLENGES_TABLE = '"identity_v1"."apple_sign_in_challenges"';
const APPLE_CHALLENGE_WINDOWS_TABLE = '"identity_v1"."apple_challenge_issuance_windows"';
const APPLE_CHALLENGE_GLOBAL_BUCKET = "APPLE_CHALLENGE_GLOBAL_V1";
const OPAQUE_VALUE = /^[A-Za-z0-9_-]{43}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type AppleSignInErrorCode =
  | "INVALID_CHALLENGE"
  | "INVALID_CREDENTIAL"
  | "PROVIDER_UNAVAILABLE"
  | "AUTHORITY_UNAVAILABLE"
  | "CONFIGURATION_UNAVAILABLE";

export class AppleSignInError extends Error {
  readonly code: AppleSignInErrorCode;
  constructor(code: AppleSignInErrorCode) {
    super(code);
    this.name = "AppleSignInError";
    this.code = code;
  }
}

const fail = (code: AppleSignInErrorCode): never => {
  throw new AppleSignInError(code);
};
const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

export function requireAppleAudience(value: string | undefined): string {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > 255
    || value !== value.trim()
    || /[\u0000-\u0020\u007f]/.test(value)) {
    return fail("CONFIGURATION_UNAVAILABLE");
  }
  return value;
}

export function requireAppleChallengeTtlMs(value: string | undefined): number {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    return fail("CONFIGURATION_UNAVAILABLE");
  }
  const ttlMs = Number(value);
  if (!Number.isSafeInteger(ttlMs)) return fail("CONFIGURATION_UNAVAILABLE");
  return ttlMs;
}

export function requireAppleJwkTimeoutMs(value: string | undefined): number {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    return fail("CONFIGURATION_UNAVAILABLE");
  }
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs > 30_000) {
    return fail("CONFIGURATION_UNAVAILABLE");
  }
  return timeoutMs;
}

export type AppleChallengeIssuanceResult = "ACQUIRED" | "THROTTLED" | "UNAVAILABLE";

export interface AppleChallengeIssuanceGate {
  acquire(): Promise<AppleChallengeIssuanceResult>;
}

export type AppleChallengeIssuanceConfig = Readonly<{
  windowMs: number;
  maxPerWindow: number;
}>;

export function requireAppleChallengeIssuanceConfig(input: Readonly<{
  windowMs: string | undefined;
  maxPerWindow: string | undefined;
}>): AppleChallengeIssuanceConfig {
  const parse = (value: string | undefined, minimum: number, maximum: number): number => {
    if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
      return fail("CONFIGURATION_UNAVAILABLE");
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
      return fail("CONFIGURATION_UNAVAILABLE");
    }
    return parsed;
  };
  return Object.freeze({
    windowMs: parse(input.windowMs, 1_000, 86_400_000),
    maxPerWindow: parse(input.maxPerWindow, 1, 1_000),
  });
}

export interface AppleJwkSource {
  load(forceRefresh: boolean): Promise<unknown>;
}

export function createRemoteAppleJwkSource(
  fetchJwks: typeof fetch,
  timeoutMs: number,
  timeoutSignal: (timeoutMs: number) => AbortSignal = value => AbortSignal.timeout(value),
): AppleJwkSource {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    return fail("CONFIGURATION_UNAVAILABLE");
  }
  return Object.freeze({
    async load(): Promise<unknown> {
      try {
        const signal = timeoutSignal(timeoutMs);
        const response = await fetchJwks(APPLE_JWKS_URL, {
          method: "GET",
          headers: { accept: "application/json" },
          redirect: "error",
          signal,
        });
        if (!response.ok) return fail("PROVIDER_UNAVAILABLE");
        const body = await response.text();
        if (body.length < 1 || body.length > 65_536) return fail("PROVIDER_UNAVAILABLE");
        return JSON.parse(body) as unknown;
      } catch (error) {
        if (error instanceof AppleSignInError) throw error;
        return fail("PROVIDER_UNAVAILABLE");
      }
    },
  });
}

type ChallengeRecord = Readonly<{
  nonceDigest: string;
  validUntil: Date;
  consumedAt: Date | null;
}>;

type CreateChallengeInput = Readonly<{
  challengeDigest: string;
  nonceDigest: string;
  createdAt: Date;
  validUntil: Date;
}>;

type ConsumeChallengeInput = Readonly<{
  challengeDigest: string;
  nonceDigest: string;
  consumedAt: Date;
}>;

export interface AppleChallengeStore {
  cleanup(retiredAt: Date): Promise<void>;
  create(input: CreateChallengeInput): Promise<void>;
  read(challengeDigest: string): Promise<ChallengeRecord | null>;
  consume(input: ConsumeChallengeInput): Promise<boolean>;
}

async function useClient<T>(pool: SqlPool, work: (client: SqlClient) => Promise<T>): Promise<T> {
  let client: SqlClient;
  try {
    client = await pool.connect();
  } catch {
    return fail("AUTHORITY_UNAVAILABLE");
  }
  let destroy = false;
  try {
    return await work(client);
  } catch (error) {
    if (error instanceof AppleSignInError) throw error;
    destroy = true;
    return fail("AUTHORITY_UNAVAILABLE");
  } finally {
    client.release(destroy);
  }
}

export function createPostgresAppleChallengeIssuanceGate(
  pool: SqlPool,
  config: AppleChallengeIssuanceConfig,
  now: () => number = Date.now,
): AppleChallengeIssuanceGate {
  if (!Number.isSafeInteger(config.windowMs)
    || config.windowMs < 1_000
    || config.windowMs > 86_400_000
    || !Number.isSafeInteger(config.maxPerWindow)
    || config.maxPerWindow < 1
    || config.maxPerWindow > 1_000) {
    return fail("CONFIGURATION_UNAVAILABLE");
  }
  return Object.freeze({
    async acquire(): Promise<AppleChallengeIssuanceResult> {
      let client: SqlClient;
      try {
        client = await pool.connect();
      } catch {
        return "UNAVAILABLE";
      }
      let destroy = false;
      try {
        const nowMs = now();
        const acquiredAt = new Date(nowMs);
        if (!Number.isFinite(nowMs) || !Number.isFinite(acquiredAt.getTime())) {
          return "UNAVAILABLE";
        }
        const result = await client.query(
          `/* identity78:acquire-apple-challenge */ INSERT INTO ${APPLE_CHALLENGE_WINDOWS_TABLE} AS budget `
          + "(bucket_name,window_started_at,request_count) VALUES ($4,$1,1) "
          + "ON CONFLICT (bucket_name) DO UPDATE SET "
          + "window_started_at=CASE WHEN budget.window_started_at+($2*INTERVAL '1 millisecond')"
          + "<=EXCLUDED.window_started_at THEN EXCLUDED.window_started_at ELSE budget.window_started_at END, "
          + "request_count=CASE WHEN budget.window_started_at+($2*INTERVAL '1 millisecond')"
          + "<=EXCLUDED.window_started_at THEN 1 ELSE budget.request_count+1 END WHERE "
          + "budget.window_started_at+($2*INTERVAL '1 millisecond')<=EXCLUDED.window_started_at "
          + "OR budget.request_count<$3 RETURNING request_count",
          [acquiredAt, config.windowMs, config.maxPerWindow, APPLE_CHALLENGE_GLOBAL_BUCKET],
        );
        if (result.rows.length === 0) return "THROTTLED";
        if (result.rows.length !== 1
          || !Number.isSafeInteger(Number(result.rows[0]?.request_count))
          || Number(result.rows[0]?.request_count) < 1
          || Number(result.rows[0]?.request_count) > config.maxPerWindow) {
          return "UNAVAILABLE";
        }
        return "ACQUIRED";
      } catch {
        destroy = true;
        return "UNAVAILABLE";
      } finally {
        client.release(destroy);
      }
    },
  });
}

function challengeFromRow(row: Record<string, unknown>): ChallengeRecord {
  const validUntil = row.valid_until instanceof Date
    ? row.valid_until
    : new Date(String(row.valid_until));
  const consumedAt = row.consumed_at === null
    ? null
    : row.consumed_at instanceof Date
      ? row.consumed_at
      : new Date(String(row.consumed_at));
  if (typeof row.nonce_digest !== "string"
    || !SHA256_HEX.test(row.nonce_digest)
    || !Number.isFinite(validUntil.getTime())
    || (consumedAt !== null && !Number.isFinite(consumedAt.getTime()))) {
    return fail("AUTHORITY_UNAVAILABLE");
  }
  return Object.freeze({ nonceDigest: row.nonce_digest, validUntil, consumedAt });
}

export function createPostgresAppleChallengeStore(pool: SqlPool): AppleChallengeStore {
  return Object.freeze({
    async cleanup(retiredAt: Date): Promise<void> {
      await useClient(pool, async client => {
        await client.query(
          `/* identity73:cleanup-challenges */ DELETE FROM ${APPLE_CHALLENGES_TABLE} `
          + "WHERE valid_until<=$1 OR (consumed_at IS NOT NULL AND consumed_at<=$1)",
          [retiredAt],
        );
      });
    },

    async create(input: CreateChallengeInput): Promise<void> {
      await useClient(pool, async client => {
        await client.query(
          `/* identity73:create-challenge */ INSERT INTO ${APPLE_CHALLENGES_TABLE} `
          + "(challenge_digest,nonce_digest,created_at,valid_until,consumed_at) "
          + "VALUES ($1,$2,$3,$4,NULL)",
          [input.challengeDigest, input.nonceDigest, input.createdAt, input.validUntil],
        );
      });
    },

    async read(challengeDigest: string): Promise<ChallengeRecord | null> {
      return useClient(pool, async client => {
        const result = await client.query(
          `/* identity73:read-challenge */ SELECT nonce_digest,valid_until,consumed_at `
          + `FROM ${APPLE_CHALLENGES_TABLE} WHERE challenge_digest=$1`,
          [challengeDigest],
        );
        if (result.rows.length === 0) return null;
        if (result.rows.length !== 1) return fail("AUTHORITY_UNAVAILABLE");
        return challengeFromRow(result.rows[0]);
      });
    },

    async consume(input: ConsumeChallengeInput): Promise<boolean> {
      return useClient(pool, async client => {
        const result = await client.query(
          `/* identity73:consume-challenge */ UPDATE ${APPLE_CHALLENGES_TABLE} SET consumed_at=$3 `
          + "WHERE challenge_digest=$1 AND nonce_digest=$2 AND consumed_at IS NULL "
          + "AND valid_until>$3 RETURNING challenge_digest",
          [input.challengeDigest, input.nonceDigest, input.consumedAt],
        );
        if (result.rows.length > 1) return fail("AUTHORITY_UNAVAILABLE");
        return result.rows.length === 1;
      });
    },
  });
}

type JsonObject = Record<string, unknown>;

function decodeJsonSegment(segment: string): JsonObject {
  if (segment.length < 1 || segment.length > 16_384 || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    return fail("INVALID_CREDENTIAL");
  }
  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return fail("INVALID_CREDENTIAL");
    }
    return value as JsonObject;
  } catch (error) {
    if (error instanceof AppleSignInError) throw error;
    return fail("INVALID_CREDENTIAL");
  }
}

function findSigningJwk(document: unknown, kid: string): JsonObject | null {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return fail("PROVIDER_UNAVAILABLE");
  }
  const keys = (document as JsonObject).keys;
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 32) {
    return fail("PROVIDER_UNAVAILABLE");
  }
  const matches = keys.filter(key => key && typeof key === "object"
    && !Array.isArray(key) && (key as JsonObject).kid === kid) as JsonObject[];
  if (matches.length === 0) return null;
  if (matches.length !== 1) return fail("PROVIDER_UNAVAILABLE");
  const key = matches[0];
  if (key.kty !== "RSA"
    || typeof key.n !== "string"
    || typeof key.e !== "string"
    || (key.alg !== undefined && key.alg !== "RS256")
    || (key.use !== undefined && key.use !== "sig")) {
    return fail("PROVIDER_UNAVAILABLE");
  }
  return key;
}

async function loadSigningJwk(source: AppleJwkSource, kid: string): Promise<JsonObject> {
  const load = async (forceRefresh: boolean): Promise<JsonObject | null> => {
    try {
      return findSigningJwk(await source.load(forceRefresh), kid);
    } catch (error) {
      if (error instanceof AppleSignInError) throw error;
      return fail("PROVIDER_UNAVAILABLE");
    }
  };
  return await load(false) ?? await load(true) ?? fail("INVALID_CREDENTIAL");
}

async function verifyAppleIdentityToken(
  identityToken: string,
  expectedAudience: string,
  expectedNonceDigest: string,
  nowMs: number,
  jwkSource: AppleJwkSource,
): Promise<Readonly<{ issuer: string; audience: string; subject: string }>> {
  if (typeof identityToken !== "string" || identityToken.length < 1 || identityToken.length > 32_768) {
    return fail("INVALID_CREDENTIAL");
  }
  const segments = identityToken.split(".");
  if (segments.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(segments[2])) {
    return fail("INVALID_CREDENTIAL");
  }
  const header = decodeJsonSegment(segments[0]);
  const claims = decodeJsonSegment(segments[1]);
  if (header.alg !== "RS256"
    || typeof header.kid !== "string"
    || header.kid.length < 1
    || header.kid.length > 255) {
    return fail("INVALID_CREDENTIAL");
  }
  const jwk = await loadSigningJwk(jwkSource, header.kid);
  let verified = false;
  try {
    const publicKey = createPublicKey({ key: jwk, format: "jwk" } as JsonWebKeyInput);
    verified = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${segments[0]}.${segments[1]}`, "ascii"),
      publicKey,
      Buffer.from(segments[2], "base64url"),
    );
  } catch {
    return fail("PROVIDER_UNAVAILABLE");
  }
  if (!verified) return fail("INVALID_CREDENTIAL");

  const nowSeconds = Math.floor(nowMs / 1000);
  const validIntegerTime = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (claims.iss !== APPLE_ISSUER
    || claims.aud !== expectedAudience
    || !validIntegerTime(claims.exp)
    || !validIntegerTime(claims.iat)
    || claims.exp <= nowSeconds
    || claims.iat > nowSeconds
    || claims.iat > claims.exp
    || (claims.nbf !== undefined && (!validIntegerTime(claims.nbf) || claims.nbf > nowSeconds))
    || typeof claims.sub !== "string"
    || claims.sub.length < 1
    || claims.sub.length > 255
    || /[\u0000-\u001f\u007f]/.test(claims.sub)
    || typeof claims.nonce !== "string"
    || !SHA256_HEX.test(claims.nonce)) {
    return fail("INVALID_CREDENTIAL");
  }
  const actualNonce = Buffer.from(claims.nonce, "hex");
  const expectedNonce = Buffer.from(expectedNonceDigest, "hex");
  if (actualNonce.length !== expectedNonce.length || !timingSafeEqual(actualNonce, expectedNonce)) {
    return fail("INVALID_CREDENTIAL");
  }
  return Object.freeze({
    issuer: APPLE_ISSUER,
    audience: expectedAudience,
    subject: claims.sub,
  });
}

export type AppleSignInChallenge = Readonly<{
  challenge: string;
  /** Set the Apple authorization-request nonce to SHA-256(rawNonce), encoded as lowercase hex. */
  rawNonce: string;
  validUntil: string;
}>;

export interface AppleSignInService {
  begin(): Promise<AppleSignInChallenge>;
  complete(input: CompleteAppleSignInInput): Promise<IssuedSession>;
}

type CompleteAppleSignInInput = Readonly<{
  challenge: unknown;
  identityToken: unknown;
}>;

export function createAppleSignInService(dependencies: Readonly<{
  audience: string;
  challengeTtlMs: number;
  challengeStore: AppleChallengeStore;
  jwkSource: AppleJwkSource;
  sessionCore: IdentitySessionCore;
  issueVerifiedControl(input: Readonly<{
    provider: string;
    issuer: string;
    audience: string;
    providerSubject: string;
  }>): VerifiedControl;
  now?: () => number;
  tokenBytes?: (size: number) => Buffer;
}>): AppleSignInService {
  const audience = requireAppleAudience(dependencies.audience);
  const challengeTtlMs = dependencies.challengeTtlMs;
  if (!Number.isSafeInteger(challengeTtlMs) || challengeTtlMs < 1) {
    return fail("CONFIGURATION_UNAVAILABLE");
  }
  const now = dependencies.now ?? Date.now;
  const tokenBytes = dependencies.tokenBytes ?? randomBytes;
  const currentDate = (): Date => {
    const value = now();
    const date = new Date(value);
    if (!Number.isFinite(value) || !Number.isFinite(date.getTime())) {
      return fail("AUTHORITY_UNAVAILABLE");
    }
    return date;
  };

  return Object.freeze({
    async begin() {
      const createdAt = currentDate();
      const validUntil = new Date(createdAt.getTime() + challengeTtlMs);
      if (!Number.isFinite(validUntil.getTime())) return fail("AUTHORITY_UNAVAILABLE");
      const challenge = tokenBytes(32).toString("base64url");
      const rawNonce = tokenBytes(32).toString("base64url");
      if (!OPAQUE_VALUE.test(challenge) || !OPAQUE_VALUE.test(rawNonce)) {
        return fail("AUTHORITY_UNAVAILABLE");
      }
      await dependencies.challengeStore.cleanup(createdAt);
      await dependencies.challengeStore.create({
        challengeDigest: sha256(challenge),
        nonceDigest: sha256(rawNonce),
        createdAt,
        validUntil,
      });
      return Object.freeze({ challenge, rawNonce, validUntil: validUntil.toISOString() });
    },

    async complete(input: CompleteAppleSignInInput) {
      if (typeof input.challenge !== "string" || !OPAQUE_VALUE.test(input.challenge)) {
        return fail("INVALID_CHALLENGE");
      }
      const challengeDigest = sha256(input.challenge);
      const record = await dependencies.challengeStore.read(challengeDigest);
      const checkedAt = currentDate();
      if (!record || record.consumedAt !== null || record.validUntil <= checkedAt) {
        return fail("INVALID_CHALLENGE");
      }
      const verified = await verifyAppleIdentityToken(
        typeof input.identityToken === "string" ? input.identityToken : "",
        audience,
        record.nonceDigest,
        checkedAt.getTime(),
        dependencies.jwkSource,
      );
      const consumed = await dependencies.challengeStore.consume({
        challengeDigest,
        nonceDigest: record.nonceDigest,
        consumedAt: currentDate(),
      });
      if (!consumed) return fail("INVALID_CHALLENGE");
      const control = dependencies.issueVerifiedControl({
        provider: "apple",
        issuer: verified.issuer,
        audience: verified.audience,
        providerSubject: verified.subject,
      });
      return dependencies.sessionCore.issueSession(control);
    },
  });
}
