import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { createServer } from "node:http";
import { after, test } from "node:test";
import express from "express";
import {
  AppleSignInError,
  APPLE_ISSUER,
  createAppleSignInService,
  createPostgresAppleChallengeIssuanceGate,
  createPostgresAppleChallengeStore,
  createRemoteAppleJwkSource,
  requireAppleAudience,
  requireAppleChallengeIssuanceConfig,
  requireAppleChallengeTtlMs,
  requireAppleJwkTimeoutMs,
  type AppleJwkSource,
} from "../src/identity/apple";
import {
  createPostgresIdentitySessionCore,
  createVerifiedControlCapability,
  IdentitySessionError,
  type SqlClient,
  type SqlPool,
} from "../src/identity/session-core";
import { createIdentityRouter } from "../src/routes/identity";

type OwnerRow = { subject_id: string; profile_id: string; status: "ACTIVE"; created_at: Date };
type ControlRow = { binding_id: string; subject_id: string; provider: string };
type SessionRow = {
  session_id: string;
  token_digest: string;
  subject_id: string;
  issued_at: Date;
  valid_until: Date;
  revoked_at: Date | null;
  issuer_provider: string | null;
  issuer_namespace_digest: string | null;
  issuer_epoch: number | null;
  issuer_reconciliation_digest: string | null;
  legacy_control_binding_id: string | null;
};
type ChallengeRow = {
  challenge_digest: string;
  nonce_digest: string;
  created_at: Date;
  valid_until: Date;
  consumed_at: Date | null;
};
type Data = {
  owners: Map<string, OwnerRow>;
  controls: Map<string, ControlRow>;
  sessions: Map<string, SessionRow>;
  challenges: Map<string, ChallengeRow>;
};

const clone = (data: Data): Data => ({
  owners: new Map([...data.owners].map(([key, row]) => [key, { ...row }])),
  controls: new Map([...data.controls].map(([key, row]) => [key, { ...row }])),
  sessions: new Map([...data.sessions].map(([key, row]) => [key, { ...row }])),
  challenges: new Map([...data.challenges].map(([key, row]) => [key, { ...row }])),
});

class FixtureDb implements SqlPool {
  data: Data = {
    owners: new Map(),
    controls: new Map(),
    sessions: new Map(),
    challenges: new Map(),
  };
  calls: Array<{ sql: string; values: unknown[] }> = [];
  fail = false;

  async connect(): Promise<SqlClient> {
    let working = this.data;
    let transaction = false;
    return {
      query: async (sql, values = []) => {
        this.calls.push({ sql, values });
        if (this.fail) throw new Error("postgres://PRIVATE_APPLE_TOKEN_DATABASE_DETAIL");
        if (sql.startsWith("BEGIN")) {
          transaction = true;
          working = clone(this.data);
          return { rows: [] };
        }
        if (sql === "COMMIT") {
          if (transaction) this.data = working;
          transaction = false;
          return { rows: [] };
        }
        if (sql === "ROLLBACK") {
          transaction = false;
          working = this.data;
          return { rows: [] };
        }
        if (sql.includes("identity71:lock-control")) return { rows: [] };
        if (sql.includes("identity71:find-owner")) {
          const control = working.controls.get(`${values[0]}:${values[1]}:${values[2]}`);
          const row = control ? working.owners.get(control.subject_id) : undefined;
          return { rows: row?.status === "ACTIVE" ? [{ ...row, binding_id: control?.binding_id }] : [] };
        }
        if (sql.includes("identity71:insert-owner")) {
          working.owners.set(String(values[0]), {
            subject_id: String(values[0]),
            profile_id: String(values[1]),
            status: "ACTIVE",
            created_at: values[2] as Date,
          });
          return { rows: [] };
        }
        if (sql.includes("identity71:insert-control")) {
          working.controls.set(`${values[1]}:${values[2]}:${values[3]}`, {
            binding_id: String(values[0]), provider: String(values[1]), subject_id: String(values[4]),
          });
          return { rows: [] };
        }
        if (sql.includes("identity71:insert-session")) {
          const row: SessionRow = {
            session_id: String(values[0]),
            token_digest: String(values[1]),
            subject_id: String(values[2]),
            issued_at: values[3] as Date,
            valid_until: values[4] as Date,
            revoked_at: null,
            issuer_provider: values[5] as string | null,
            issuer_namespace_digest: values[6] as string | null,
            issuer_epoch: values[7] as number | null,
            issuer_reconciliation_digest: values[8] as string | null,
            legacy_control_binding_id: values[9] as string | null,
          };
          working.sessions.set(row.token_digest, row);
          return { rows: [] };
        }
        if (sql.includes("identity71:verify-session")) {
          const session = working.sessions.get(String(values[0]));
          const checkedAt = values[1] as Date;
          if (!session || session.revoked_at !== null || session.valid_until <= checkedAt) return { rows: [] };
          const owner = working.owners.get(session.subject_id);
          if (!owner || owner.status !== "ACTIVE") return { rows: [] };
          const scoped = session.issuer_provider !== null
            && session.issuer_namespace_digest !== null
            && session.issuer_epoch !== null
            && session.issuer_reconciliation_digest !== null
            && session.legacy_control_binding_id === null;
          const legacy = session.issuer_provider === null
            && session.issuer_namespace_digest === null
            && session.issuer_epoch === null
            && session.issuer_reconciliation_digest === null
            && session.legacy_control_binding_id !== null
            && [...working.controls.values()].some(control =>
              control.binding_id === session.legacy_control_binding_id
              && control.subject_id === session.subject_id
              && control.provider === "apple");
          return { rows: scoped || legacy ? [{ ...owner, ...session }] : [] };
        }
        if (sql.includes("identity71:revoke-session")) {
          const session = working.sessions.get(String(values[0]));
          const revokedAt = values[1] as Date;
          if (!session || session.revoked_at !== null || session.valid_until <= revokedAt) return { rows: [] };
          session.revoked_at = revokedAt;
          return { rows: [{ session_id: session.session_id }] };
        }
        if (sql.includes("identity73:create-challenge")) {
          const row: ChallengeRow = {
            challenge_digest: String(values[0]),
            nonce_digest: String(values[1]),
            created_at: values[2] as Date,
            valid_until: values[3] as Date,
            consumed_at: null,
          };
          working.challenges.set(row.challenge_digest, row);
          return { rows: [] };
        }
        if (sql.includes("identity73:cleanup-challenges")) {
          const retiredAt = values[0] as Date;
          for (const [digest, row] of working.challenges) {
            if (row.valid_until <= retiredAt
              || (row.consumed_at !== null && row.consumed_at <= retiredAt)) {
              working.challenges.delete(digest);
            }
          }
          return { rows: [] };
        }
        if (sql.includes("identity73:read-challenge")) {
          const row = working.challenges.get(String(values[0]));
          return { rows: row ? [row] : [] };
        }
        if (sql.includes("identity73:consume-challenge")) {
          const row = working.challenges.get(String(values[0]));
          const consumedAt = values[2] as Date;
          if (!row
            || row.nonce_digest !== values[1]
            || row.consumed_at !== null
            || row.valid_until <= consumedAt) return { rows: [] };
          row.consumed_at = consumedAt;
          return { rows: [{ challenge_digest: row.challenge_digest }] };
        }
        throw new Error("unexpected fixture query");
      },
      release: () => undefined,
    };
  }
}

type IssuanceWindowRow = {
  window_started_at: Date;
  request_count: number;
};

class AbuseControlFixtureDb implements SqlPool {
  row: IssuanceWindowRow | null = null;
  calls: Array<{ sql: string; values: unknown[] }> = [];
  fail = false;

  async connect(): Promise<SqlClient> {
    return {
      query: async (sql, values = []) => {
        this.calls.push({ sql, values });
        if (this.fail) throw new Error("postgres://PRIVATE_LIMITER_DATABASE_DETAIL");
        if (!sql.includes("identity78:acquire-apple-challenge")) {
          throw new Error("unexpected abuse-control fixture query");
        }
        const acquiredAt = values[0] as Date;
        const windowMs = Number(values[1]);
        const maxPerWindow = Number(values[2]);
        const expired = this.row === null
          || this.row.window_started_at.getTime() + windowMs <= acquiredAt.getTime();
        if (expired) {
          this.row = {
            window_started_at: acquiredAt,
            request_count: 1,
          };
          return { rows: [{ request_count: 1 }] };
        }
        if (this.row.request_count >= maxPerWindow) return { rows: [] };
        this.row.request_count += 1;
        return { rows: [{ request_count: this.row.request_count }] };
      },
      release: () => undefined,
    };
  }
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
const signJwt = (
  privateKey: KeyObject,
  kid: string,
  claims: Record<string, unknown>,
): string => {
  const signingInput = `${encode({ alg: "RS256", kid, typ: "JWT" })}.${encode(claims)}`;
  return `${signingInput}.${sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url")}`;
};
const publicJwk = (publicKey: KeyObject, kid: string): JsonWebKey & { kid: string } => ({
  ...publicKey.export({ format: "jwk" }),
  kid,
  alg: "RS256",
  use: "sig",
});

const primaryKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rotatedKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const attackerKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const primaryJwk = publicJwk(primaryKeys.publicKey, "apple-key-primary");
const rotatedJwk = publicJwk(rotatedKeys.publicKey, "apple-key-rotated");
const audience = "com.project100.ios";
const appleSubject = "apple-verified-private-subject";
let clock = Date.parse("2026-09-21T12:00:00.000Z");
let idCounter = 700;
let sessionTokenCounter = 10;
let challengeTokenCounter = 100;

class FixtureJwkSource implements AppleJwkSource {
  readonly calls: boolean[] = [];
  constructor(
    private readonly current: unknown,
    private readonly refreshed: unknown = current,
  ) {}
  async load(forceRefresh: boolean): Promise<unknown> {
    this.calls.push(forceRefresh);
    return forceRefresh ? this.refreshed : this.current;
  }
}

const db = new FixtureDb();
const capability = createVerifiedControlCapability();
const core = createPostgresIdentitySessionCore(db, capability.authority, {
  sessionTtlMs: 120_000,
  now: () => clock,
  newId: () => `30000000-0000-4000-8000-${(++idCounter).toString().padStart(12, "0")}`,
  tokenBytes: () => Buffer.alloc(32, ++sessionTokenCounter),
});
const challengeStore = createPostgresAppleChallengeStore(db);

function serviceWith(jwkSource: AppleJwkSource = new FixtureJwkSource({ keys: [primaryJwk] })) {
  return createAppleSignInService({
    audience,
    challengeTtlMs: 30_000,
    challengeStore,
    jwkSource,
    sessionCore: core,
    issueVerifiedControl: input => capability.trustedIssuer.issue(input),
    now: () => clock,
    tokenBytes: () => Buffer.alloc(32, ++challengeTokenCounter),
  });
}

const service = serviceWith();
const claimsFor = (
  rawNonce: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => {
  const nowSeconds = Math.floor(clock / 1000);
  return {
    iss: APPLE_ISSUER,
    aud: audience,
    exp: nowSeconds + 300,
    iat: nowSeconds,
    sub: appleSubject,
    nonce: sha256(rawNonce),
    ...overrides,
  };
};
const errorIs = (code: string) => (error: unknown): boolean =>
  error instanceof AppleSignInError && error.code === code;

let acceptedOwner: Readonly<{ subjectId: string; profileId: string }>;
let acceptedAppleToken: string;

test("valid Apple JWT creates trusted control and opaque 100 session", async () => {
  const request = await service.begin();
  const identityToken = signJwt(
    primaryKeys.privateKey,
    "apple-key-primary",
    claimsFor(request.rawNonce),
  );
  const issued = await service.complete({ challenge: request.challenge, identityToken });
  acceptedOwner = issued.owner;
  acceptedAppleToken = identityToken;
  assert.deepEqual((await core.verifySession(issued.token)).owner, issued.owner);
  assert.equal(JSON.stringify(db.calls).includes(identityToken), false);
  assert.equal(JSON.stringify(db.data).includes(identityToken), false);
});

test("nonce contract requires Apple request nonce to be SHA-256(rawNonce)", async () => {
  const request = await service.begin();
  assert.deepEqual(Object.keys(request).sort(), ["challenge", "rawNonce", "validUntil"]);
  const tokenWithUnhashedNonce = signJwt(
    primaryKeys.privateKey,
    "apple-key-primary",
    claimsFor(request.rawNonce, { nonce: request.rawNonce }),
  );
  await assert.rejects(
    service.complete({ challenge: request.challenge, identityToken: tokenWithUnhashedNonce }),
    errorIs("INVALID_CREDENTIAL"),
  );
  const boundToken = signJwt(
    primaryKeys.privateKey,
    "apple-key-primary",
    claimsFor(request.rawNonce),
  );
  assert.deepEqual(
    (await service.complete({ challenge: request.challenge, identityToken: boundToken })).owner,
    acceptedOwner,
  );
});

test("same verified Apple namespace and subject maps to the same owner", async () => {
  const request = await service.begin();
  const issued = await service.complete({
    challenge: request.challenge,
    identityToken: signJwt(primaryKeys.privateKey, "apple-key-primary", claimsFor(request.rawNonce)),
  });
  assert.deepEqual(issued.owner, acceptedOwner);
});

for (const [name, override] of [
  ["wrong issuer", { iss: "https://attacker.invalid" }],
  ["wrong audience", { aud: "com.attacker.app" }],
  ["expired token", { exp: Math.floor(clock / 1000) }],
  ["not-yet-valid token", { nbf: Math.floor(clock / 1000) + 60 }],
  ["missing subject", { sub: undefined }],
  ["invalid subject", { sub: "bad\u0000subject" }],
] as const) {
  test(`${name} fails closed`, async () => {
    const request = await service.begin();
    const identityToken = signJwt(
      primaryKeys.privateKey,
      "apple-key-primary",
      claimsFor(request.rawNonce, override),
    );
    await assert.rejects(
      service.complete({ challenge: request.challenge, identityToken }),
      errorIs("INVALID_CREDENTIAL"),
    );
  });
}

test("bad signature fails closed", async () => {
  const request = await service.begin();
  const identityToken = signJwt(
    attackerKeys.privateKey,
    "apple-key-primary",
    claimsFor(request.rawNonce),
  );
  await assert.rejects(
    service.complete({ challenge: request.challenge, identityToken }),
    errorIs("INVALID_CREDENTIAL"),
  );
});

test("unknown kid fails after one bounded refresh", async () => {
  const source = new FixtureJwkSource({ keys: [primaryJwk] });
  const unknownKidService = serviceWith(source);
  const request = await unknownKidService.begin();
  const identityToken = signJwt(primaryKeys.privateKey, "unknown-kid", claimsFor(request.rawNonce));
  await assert.rejects(
    unknownKidService.complete({ challenge: request.challenge, identityToken }),
    errorIs("INVALID_CREDENTIAL"),
  );
  assert.deepEqual(source.calls, [false, true]);
});

test("JWK rotation refresh accepts the newly published key", async () => {
  const source = new FixtureJwkSource(
    { keys: [primaryJwk] },
    { keys: [primaryJwk, rotatedJwk] },
  );
  const rotatedService = serviceWith(source);
  const request = await rotatedService.begin();
  const identityToken = signJwt(
    rotatedKeys.privateKey,
    "apple-key-rotated",
    claimsFor(request.rawNonce),
  );
  const issued = await rotatedService.complete({ challenge: request.challenge, identityToken });
  assert.deepEqual(issued.owner, acceptedOwner);
  assert.deepEqual(source.calls, [false, true]);
});

test("challenge is one-time and replay fails closed", async () => {
  const request = await service.begin();
  const identityToken = signJwt(
    primaryKeys.privateKey,
    "apple-key-primary",
    claimsFor(request.rawNonce),
  );
  await service.complete({ challenge: request.challenge, identityToken });
  await assert.rejects(
    service.complete({ challenge: request.challenge, identityToken }),
    errorIs("INVALID_CHALLENGE"),
  );
});

test("expired challenge fails closed", async () => {
  const request = await service.begin();
  clock += 30_001;
  const identityToken = signJwt(
    primaryKeys.privateKey,
    "apple-key-primary",
    claimsFor(request.rawNonce),
  );
  await assert.rejects(
    service.complete({ challenge: request.challenge, identityToken }),
    errorIs("INVALID_CHALLENGE"),
  );
});

test("foreign challenge cannot consume another request", async () => {
  const first = await service.begin();
  const second = await service.begin();
  const firstToken = signJwt(
    primaryKeys.privateKey,
    "apple-key-primary",
    claimsFor(first.rawNonce),
  );
  await assert.rejects(
    service.complete({ challenge: second.challenge, identityToken: firstToken }),
    errorIs("INVALID_CREDENTIAL"),
  );
  const secondToken = signJwt(
    primaryKeys.privateKey,
    "apple-key-primary",
    claimsFor(second.rawNonce),
  );
  assert.deepEqual(
    (await service.complete({ challenge: second.challenge, identityToken: secondToken })).owner,
    acceptedOwner,
  );
});

test("provider failure is fixed, fail-closed, and redacts the Apple token", async () => {
  const failingService = serviceWith({
    async load() { throw new Error(`PRIVATE_JWK_FAILURE:${acceptedAppleToken}`); },
  });
  const request = await failingService.begin();
  const identityToken = signJwt(
    primaryKeys.privateKey,
    "apple-key-primary",
    claimsFor(request.rawNonce),
  );
  try {
    await failingService.complete({ challenge: request.challenge, identityToken });
    assert.fail("provider failure must reject");
  } catch (error) {
    assert.equal(String(error), "AppleSignInError: PROVIDER_UNAVAILABLE");
    assert.equal(String(error).includes(identityToken), false);
    assert.equal(String(error).includes("PRIVATE_JWK_FAILURE"), false);
  }
});

test("remote JWK timeout aborts deterministically and fails closed", async () => {
  let configuredTimeout: number | undefined;
  const controller = new AbortController();
  const hangingFetch = ((_input: URL | RequestInfo, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return reject(new Error("missing timeout signal"));
      signal.addEventListener("abort", () => {
        reject(new Error(`PRIVATE_TIMEOUT_DETAIL:${acceptedAppleToken}`));
      }, { once: true });
    })) as typeof fetch;
  const source = createRemoteAppleJwkSource(hangingFetch, 1_500, timeoutMs => {
    configuredTimeout = timeoutMs;
    queueMicrotask(() => controller.abort());
    return controller.signal;
  });
  const timeoutService = serviceWith(source);
  const request = await timeoutService.begin();
  const identityToken = signJwt(
    primaryKeys.privateKey,
    "apple-key-primary",
    claimsFor(request.rawNonce),
  );
  try {
    await timeoutService.complete({ challenge: request.challenge, identityToken });
    assert.fail("timeout must reject");
  } catch (error) {
    assert.equal(String(error), "AppleSignInError: PROVIDER_UNAVAILABLE");
    assert.equal(String(error).includes(identityToken), false);
    assert.equal(String(error).includes("PRIVATE_TIMEOUT_DETAIL"), false);
  }
  assert.equal(configuredTimeout, 1_500);
  assert.equal(controller.signal.aborted, true);
});

test("challenge database failure is fixed and fail-closed", async () => {
  db.fail = true;
  try {
    await assert.rejects(service.begin(), errorIs("AUTHORITY_UNAVAILABLE"));
  } finally {
    db.fail = false;
  }
});

test("arbitrary JSON cannot mint the provider-neutral VerifiedControl", async () => {
  await assert.rejects(
    core.issueSession({
      provider: "apple",
      issuer: APPLE_ISSUER,
      audience,
      providerSubject: appleSubject,
    } as never),
    (error: unknown) => error instanceof IdentitySessionError
      && error.code === "UNTRUSTED_CONTROL",
  );
});

test("challenge rows store digests, never raw challenge or nonce", async () => {
  const request = await service.begin();
  const stored = JSON.stringify({ data: [...db.data.challenges], calls: db.calls });
  assert.equal(stored.includes(request.challenge), false);
  assert.equal(stored.includes(request.rawNonce), false);
  for (const [digest, row] of db.data.challenges) {
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.match(row.nonce_digest, /^[0-9a-f]{64}$/);
  }
});

test("challenge issuance cleans expired and consumed rows while retaining active rows", async () => {
  const retiredAt = new Date(clock);
  const consumedChallenge = "c".repeat(43);
  const expiredChallenge = "e".repeat(43);
  const activeChallenge = "a".repeat(43);
  const nonceDigest = sha256("fixture-nonce");
  await challengeStore.create({
    challengeDigest: sha256(consumedChallenge),
    nonceDigest,
    createdAt: new Date(clock - 2_000),
    validUntil: new Date(clock + 30_000),
  });
  assert.equal(await challengeStore.consume({
    challengeDigest: sha256(consumedChallenge),
    nonceDigest,
    consumedAt: retiredAt,
  }), true);
  await challengeStore.create({
    challengeDigest: sha256(expiredChallenge),
    nonceDigest,
    createdAt: new Date(clock - 2_000),
    validUntil: new Date(clock - 1),
  });
  await challengeStore.create({
    challengeDigest: sha256(activeChallenge),
    nonceDigest,
    createdAt: new Date(clock - 2_000),
    validUntil: new Date(clock + 30_000),
  });

  const fresh = await service.begin();

  assert.equal(db.data.challenges.has(sha256(consumedChallenge)), false);
  assert.equal(db.data.challenges.has(sha256(expiredChallenge)), false);
  assert.equal(db.data.challenges.has(sha256(activeChallenge)), true);
  assert.equal(db.data.challenges.has(sha256(fresh.challenge)), true);
});

test("Apple production configuration is explicit and validated", () => {
  assert.equal(requireAppleAudience(audience), audience);
  assert.equal(requireAppleChallengeTtlMs("30000"), 30_000);
  assert.equal(requireAppleJwkTimeoutMs("5000"), 5_000);
  for (const invalid of [undefined, "", " client", "client id", "x".repeat(256)]) {
    assert.throws(() => requireAppleAudience(invalid), errorIs("CONFIGURATION_UNAVAILABLE"));
  }
  for (const invalid of [undefined, "", "0", "-1", "1.5", "forever", "9007199254740992"]) {
    assert.throws(() => requireAppleChallengeTtlMs(invalid), errorIs("CONFIGURATION_UNAVAILABLE"));
  }
  for (const invalid of [undefined, "", "0", "-1", "1.5", "30001", "forever"]) {
    assert.throws(() => requireAppleJwkTimeoutMs(invalid), errorIs("CONFIGURATION_UNAVAILABLE"));
  }
});

test("challenge abuse-control configuration is explicit, bounded, and fail-closed", () => {
  assert.deepEqual(
    requireAppleChallengeIssuanceConfig({ windowMs: "60000", maxPerWindow: "20" }),
    { windowMs: 60_000, maxPerWindow: 20 },
  );
  for (const input of [
    { windowMs: undefined, maxPerWindow: "20" },
    { windowMs: "", maxPerWindow: "20" },
    { windowMs: "999", maxPerWindow: "20" },
    { windowMs: "86400001", maxPerWindow: "20" },
    { windowMs: "60000", maxPerWindow: undefined },
    { windowMs: "60000", maxPerWindow: "0" },
    { windowMs: "60000", maxPerWindow: "1001" },
    { windowMs: "60000", maxPerWindow: "1.5" },
  ]) {
    assert.throws(
      () => requireAppleChallengeIssuanceConfig(input),
      errorIs("CONFIGURATION_UNAVAILABLE"),
    );
  }
});

test("shared Postgres challenge budget permits only the configured count atomically", async () => {
  const limiterDb = new AbuseControlFixtureDb();
  const gate = createPostgresAppleChallengeIssuanceGate(
    limiterDb,
    { windowMs: 60_000, maxPerWindow: 3 },
    () => clock,
  );
  const outcomes = await Promise.all(Array.from({ length: 12 }, () => gate.acquire()));
  assert.equal(outcomes.filter(value => value === "ACQUIRED").length, 3);
  assert.equal(outcomes.filter(value => value === "THROTTLED").length, 9);
  assert.equal(limiterDb.row?.request_count, 3);
  assert.match(limiterDb.calls[0]?.sql ?? "", /ON CONFLICT/u);
  assert.match(limiterDb.calls[0]?.sql ?? "", /budget\.request_count<\$3/u);
  assert.match(limiterDb.calls[0]?.sql ?? "", /RETURNING request_count/u);
});

test("separate gate instances share budget and restart cannot reset it", async () => {
  const limiterDb = new AbuseControlFixtureDb();
  const firstProcess = createPostgresAppleChallengeIssuanceGate(
    limiterDb,
    { windowMs: 60_000, maxPerWindow: 2 },
    () => clock,
  );
  const restartedProcess = createPostgresAppleChallengeIssuanceGate(
    limiterDb,
    { windowMs: 60_000, maxPerWindow: 2 },
    () => clock,
  );
  assert.equal(await firstProcess.acquire(), "ACQUIRED");
  assert.equal(await restartedProcess.acquire(), "ACQUIRED");
  assert.equal(await firstProcess.acquire(), "THROTTLED");
});

test("a new issuance window restores capacity without growing limiter state", async () => {
  const limiterDb = new AbuseControlFixtureDb();
  let limiterClock = clock;
  const gate = createPostgresAppleChallengeIssuanceGate(
    limiterDb,
    { windowMs: 1_000, maxPerWindow: 1 },
    () => limiterClock,
  );
  assert.equal(await gate.acquire(), "ACQUIRED");
  assert.equal(await gate.acquire(), "THROTTLED");
  limiterClock += 1_000;
  assert.equal(await gate.acquire(), "ACQUIRED");
  assert.equal(limiterDb.row?.request_count, 1);
});

test("limiter database failure is unavailable, redacted, and fail-closed", async () => {
  const limiterDb = new AbuseControlFixtureDb();
  limiterDb.fail = true;
  const gate = createPostgresAppleChallengeIssuanceGate(
    limiterDb,
    { windowMs: 60_000, maxPerWindow: 2 },
    () => clock,
  );
  assert.equal(await gate.acquire(), "UNAVAILABLE");
  assert.equal(JSON.stringify(limiterDb.calls).includes("PRIVATE_LIMITER_DATABASE_DETAIL"), false);
});

test("limiter persists only a global bucket without personal identifiers", async () => {
  const limiterDb = new AbuseControlFixtureDb();
  const gate = createPostgresAppleChallengeIssuanceGate(
    limiterDb,
    { windowMs: 60_000, maxPerWindow: 2 },
    () => clock,
  );
  assert.equal(await gate.acquire(), "ACQUIRED");
  const persisted = JSON.stringify({ row: limiterDb.row, calls: limiterDb.calls });
  for (const privateValue of [
    appleSubject,
    acceptedAppleToken,
    "attacker@example.invalid",
    "client-supplied-user-id",
  ]) {
    assert.equal(persisted.includes(privateValue), false);
  }
});

const app = express();
app.use(express.json());
app.use("/api", createIdentityRouter(
  async () => core,
  async () => service,
  Object.freeze({ acquire: async () => "ACQUIRED" as const }),
));
let disabledAppleLoadCalls = 0;
app.use("/disabled", createIdentityRouter(
  async () => core,
  async () => {
    disabledAppleLoadCalls += 1;
    return service;
  },
));
let throttledAppleLoadCalls = 0;
app.use("/throttled", createIdentityRouter(
  async () => core,
  async () => {
    throttledAppleLoadCalls += 1;
    return service;
  },
  Object.freeze({ acquire: async () => "THROTTLED" as const }),
));
const server = createServer(app);
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
after(() => server.close());
const address = server.address();
if (!address || typeof address === "string") throw new Error("fixture server unavailable");
const origin = `http://127.0.0.1:${address.port}/api`;

test("challenge issuance is disabled by default without a runtime abuse-control gate", async () => {
  const challengeCount = db.data.challenges.size;
  const previousWindow = process.env["APPLE_CHALLENGE_ISSUANCE_WINDOW_MS"];
  const previousMaximum = process.env["APPLE_CHALLENGE_ISSUANCE_MAX_PER_WINDOW"];
  delete process.env["APPLE_CHALLENGE_ISSUANCE_WINDOW_MS"];
  delete process.env["APPLE_CHALLENGE_ISSUANCE_MAX_PER_WINDOW"];
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/disabled/identity/apple/challenge`, {
      method: "POST",
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "unavailable" });
  } finally {
    if (previousWindow === undefined) delete process.env["APPLE_CHALLENGE_ISSUANCE_WINDOW_MS"];
    else process.env["APPLE_CHALLENGE_ISSUANCE_WINDOW_MS"] = previousWindow;
    if (previousMaximum === undefined) delete process.env["APPLE_CHALLENGE_ISSUANCE_MAX_PER_WINDOW"];
    else process.env["APPLE_CHALLENGE_ISSUANCE_MAX_PER_WINDOW"] = previousMaximum;
  }
  assert.equal(disabledAppleLoadCalls, 0);
  assert.equal(db.data.challenges.size, challengeCount);
});

test("throttled challenge request returns 429 without loading Apple or creating a challenge", async () => {
  const challengeCount = db.data.challenges.size;
  const response = await fetch(`http://127.0.0.1:${address.port}/throttled/identity/apple/challenge`, {
    method: "POST",
  });
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { status: "throttled" });
  assert.equal(throttledAppleLoadCalls, 0);
  assert.equal(db.data.challenges.size, challengeCount);
});

test("HTTP Apple flow ignores client identity claims and returns only a 100 session", async () => {
  const beginResponse = await fetch(`${origin}/identity/apple/challenge`, { method: "POST" });
  assert.equal(beginResponse.status, 201);
  assert.equal(beginResponse.headers.get("cache-control"), "no-store");
  const request = await beginResponse.json() as { challenge: string; rawNonce: string };
  const identityToken = signJwt(
    primaryKeys.privateKey,
    "apple-key-primary",
    claimsFor(request.rawNonce),
  );
  const completeResponse = await fetch(`${origin}/identity/apple/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challenge: request.challenge,
      identityToken,
      email: "attacker@example.invalid",
      userId: "client-supplied-user-id",
    }),
  });
  assert.equal(completeResponse.status, 201);
  assert.equal(completeResponse.headers.get("cache-control"), "no-store");
  const body = await completeResponse.json() as {
    owner: { subjectId: string; profileId: string };
    token: string;
    validUntil: string;
  };
  assert.deepEqual(body.owner, acceptedOwner);
  assert.deepEqual(Object.keys(body).sort(), ["owner", "token", "validUntil"]);
  assert.deepEqual((await core.verifySession(body.token)).owner, acceptedOwner);
  assert.equal(JSON.stringify(db.calls).includes(identityToken), false);
});
