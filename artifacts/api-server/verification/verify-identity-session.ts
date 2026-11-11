import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { after, test } from "node:test";
import express from "express";
import {
  createPostgresIdentitySessionCore,
  createVerifiedControlCapability,
  IdentitySessionError,
  type SqlClient,
  type SqlPool,
} from "../src/identity/session-core";
import {
  createIdentityRouter,
  requireProductionSessionTtlMs,
  verifyIdentityRequest,
} from "../src/routes/identity";

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
type Data = {
  owners: Map<string, OwnerRow>;
  controls: Map<string, ControlRow>;
  sessions: Map<string, SessionRow>;
};
const clone = (data: Data): Data => ({
  owners: new Map([...data.owners].map(([key, row]) => [key, { ...row }])),
  controls: new Map([...data.controls].map(([key, row]) => [key, { ...row }])),
  sessions: new Map([...data.sessions].map(([key, row]) => [key, { ...row }])),
});

class FixtureDb implements SqlPool {
  data: Data = { owners: new Map(), controls: new Map(), sessions: new Map() };
  calls: Array<{ sql: string; values: unknown[] }> = [];
  connects = 0;
  fail = false;
  private readonly advisoryLocks = new Map<string, Promise<void>>();

  private async acquireAdvisoryLock(key: string): Promise<() => void> {
    const previous = this.advisoryLocks.get(key) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>(resolve => { releaseCurrent = resolve; });
    this.advisoryLocks.set(key, current);
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseCurrent();
      if (this.advisoryLocks.get(key) === current) this.advisoryLocks.delete(key);
    };
  }

  async connect(): Promise<SqlClient> {
    this.connects++;
    let working = this.data;
    let transaction = false;
    let releaseAdvisoryLock: (() => void) | undefined;
    return {
      query: async (sql, values = []) => {
        this.calls.push({ sql, values });
        if (this.fail) throw new Error("postgres://PRIVATE_DATABASE_DETAIL");
        if (sql.startsWith("BEGIN")) {
          transaction = true;
          working = clone(this.data);
          return { rows: [] };
        }
        if (sql === "COMMIT") {
          if (transaction) this.data = working;
          transaction = false;
          releaseAdvisoryLock?.();
          releaseAdvisoryLock = undefined;
          return { rows: [] };
        }
        if (sql === "ROLLBACK") {
          transaction = false;
          working = this.data;
          releaseAdvisoryLock?.();
          releaseAdvisoryLock = undefined;
          return { rows: [] };
        }
        if (sql.includes("identity71:lock-control")) {
          releaseAdvisoryLock = await this.acquireAdvisoryLock(String(values[0]));
          working = clone(this.data);
          return { rows: [] };
        }
        if (sql.includes("identity71:find-owner")) {
          const control = working.controls.get(`${values[0]}:${values[1]}:${values[2]}`);
          const row = control ? working.owners.get(control.subject_id) : undefined;
          return { rows: row?.status === "ACTIVE" ? [{ ...row, binding_id: control?.binding_id }] : [] };
        }
        if (sql.includes("identity71:insert-owner")) {
          working.owners.set(String(values[0]), {
            subject_id: String(values[0]), profile_id: String(values[1]),
            status: "ACTIVE", created_at: values[2] as Date,
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
            session_id: String(values[0]), token_digest: String(values[1]), subject_id: String(values[2]),
            issued_at: values[3] as Date, valid_until: values[4] as Date, revoked_at: null,
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
        throw new Error("unexpected fixture query");
      },
      release: () => releaseAdvisoryLock?.(),
    };
  }
}

let clock = Date.parse("2026-09-21T00:00:00.000Z");
let idCounter = 0;
let tokenCounter = 0;
const newId = () => `10000000-0000-4000-8000-${(++idCounter).toString().padStart(12, "0")}`;
const tokenBytes = () => Buffer.alloc(32, ++tokenCounter);
const tokenDigest = (token: string) => createHash("sha256").update(token).digest("hex");
const db = new FixtureDb();
const capability = createVerifiedControlCapability();
const core = createPostgresIdentitySessionCore(db, capability.authority, {
  now: () => clock, newId, tokenBytes, sessionTtlMs: 60_000,
});
const appleNamespace = Object.freeze({
  provider: "apple",
  issuer: "https://appleid.apple.com",
  audience: "com.project100.ios",
});
const aliceSubject = "apple-private-subject-a";
const alice = capability.trustedIssuer.issue({ ...appleNamespace, providerSubject: aliceSubject });
const bob = capability.trustedIssuer.issue({
  ...appleNamespace,
  providerSubject: "apple-private-subject-b",
});

let aliceOwner: Readonly<{ subjectId: string; profileId: string }>;
let aliceToken: string;

test("trusted capabilities map the same verified control to one durable owner", async () => {
  const first = await core.issueSession(alice);
  const firstSession = db.data.sessions.get(tokenDigest(first.token));
  const appleControl = [...db.data.controls.values()].find(control =>
    control.subject_id === first.owner.subjectId && control.provider === "apple");
  assert.ok(firstSession);
  assert.ok(appleControl);
  assert.equal(firstSession.legacy_control_binding_id, appleControl.binding_id);
  assert.equal(firstSession.issuer_provider, null);
  const second = await core.issueSession(capability.trustedIssuer.issue({
    ...appleNamespace,
    provider: "APPLE",
    providerSubject: aliceSubject,
  }));
  assert.deepEqual(second.owner, first.owner);
  const secondSession = db.data.sessions.get(tokenDigest(second.token));
  assert.ok(secondSession);
  assert.equal(secondSession.legacy_control_binding_id, appleControl.binding_id);
  assert.equal(db.data.controls.size, 1);
  aliceOwner = second.owner;
  aliceToken = second.token;
  assert.deepEqual((await core.verifySession(first.token)).owner, first.owner);
  assert.deepEqual(await core.verifySession(second.token), {
    owner: first.owner, validUntil: second.validUntil,
  });
  secondSession.legacy_control_binding_id = null;
  await assert.rejects(core.verifySession(second.token), (error: unknown) =>
    error instanceof IdentitySessionError && error.code === "INVALID_SESSION");
  secondSession.legacy_control_binding_id = appleControl.binding_id;
  secondSession.issuer_provider = "google";
  secondSession.issuer_namespace_digest = "a".repeat(64);
  secondSession.issuer_epoch = 1;
  secondSession.issuer_reconciliation_digest = "b".repeat(64);
  await assert.rejects(core.verifySession(second.token), (error: unknown) =>
    error instanceof IdentitySessionError && error.code === "INVALID_SESSION");
  secondSession.issuer_provider = null;
  secondSession.issuer_namespace_digest = null;
  secondSession.issuer_epoch = null;
  secondSession.issuer_reconciliation_digest = null;
  assert.deepEqual((await core.verifySession(second.token)).owner, first.owner);
});

test("different verified controls map to different owners", async () => {
  const issued = await core.issueSession(bob);
  assert.notDeepEqual(issued.owner, aliceOwner);
  const aliceSession = db.data.sessions.get(tokenDigest(aliceToken));
  const bobControl = [...db.data.controls.values()].find(control =>
    control.subject_id === issued.owner.subjectId && control.provider === "apple");
  assert.ok(aliceSession);
  assert.ok(bobControl);
  const correctBinding = aliceSession.legacy_control_binding_id;
  aliceSession.legacy_control_binding_id = bobControl.binding_id;
  await assert.rejects(core.verifySession(aliceToken), (error: unknown) =>
    error instanceof IdentitySessionError && error.code === "INVALID_SESSION");
  const originalSubject = bobControl.subject_id;
  const originalProvider = bobControl.provider;
  bobControl.subject_id = aliceOwner.subjectId;
  bobControl.provider = "oidc";
  await assert.rejects(core.verifySession(aliceToken), (error: unknown) =>
    error instanceof IdentitySessionError && error.code === "INVALID_SESSION");
  bobControl.subject_id = originalSubject;
  bobControl.provider = originalProvider;
  aliceSession.legacy_control_binding_id = correctBinding;
  assert.deepEqual((await core.verifySession(aliceToken)).owner, aliceOwner);
});

test("provider, issuer, and audience each scope the verified credential namespace", async () => {
  const namespaceVariants = [
    { ...appleNamespace, provider: "oidc" },
    { ...appleNamespace, issuer: "https://accounts.example.test" },
    { ...appleNamespace, audience: "com.project100.web" },
  ];
  const owners = [];
  for (const namespace of namespaceVariants) {
    const issued = await core.issueSession(capability.trustedIssuer.issue({
      ...namespace,
      providerSubject: aliceSubject,
    }));
    assert.notDeepEqual(issued.owner, aliceOwner);
    owners.push(issued.owner);
  }
  assert.equal(new Set(owners.map(owner => owner.subjectId)).size, namespaceVariants.length);
});

test("untrusted route-shaped JSON cannot forge verified control authority", async () => {
  const before = db.connects;
  await assert.rejects(
    core.issueSession({
      provider: "apple",
      issuer: appleNamespace.issuer,
      audience: appleNamespace.audience,
      providerSubject: aliceSubject,
    } as never),
    (error: unknown) => error instanceof IdentitySessionError && error.code === "UNTRUSTED_CONTROL",
  );
  assert.equal(db.connects, before);
});

test("database stores token and provider subject digests, never raw secrets", () => {
  const stored = JSON.stringify({
    controls: [...db.data.controls], sessions: [...db.data.sessions], calls: db.calls,
  });
  assert.equal(stored.includes(aliceToken), false);
  assert.equal(stored.includes(aliceSubject), false);
  assert.equal(stored.includes(appleNamespace.issuer), false);
  assert.equal(stored.includes(appleNamespace.audience), false);
  for (const digest of db.data.sessions.keys()) assert.match(digest, /^[0-9a-f]{64}$/);
});

test("identity and session verification survive a core restart through the database", async () => {
  const restartedCapability = createVerifiedControlCapability();
  const restarted = createPostgresIdentitySessionCore(db, restartedCapability.authority, {
    now: () => clock, newId, tokenBytes, sessionTtlMs: 60_000,
  });
  assert.deepEqual((await restarted.verifySession(aliceToken)).owner, aliceOwner);
  const reissued = await restarted.issueSession(restartedCapability.trustedIssuer.issue({
    ...appleNamespace,
    providerSubject: aliceSubject,
  }));
  assert.deepEqual(reissued.owner, aliceOwner);
  const previousBinding = db.data.sessions.get(tokenDigest(aliceToken))?.legacy_control_binding_id;
  assert.ok(previousBinding);
  assert.equal(db.data.sessions.get(tokenDigest(reissued.token))?.legacy_control_binding_id, previousBinding);
  aliceToken = reissued.token;
});

test("expiry and random tokens fail closed", async () => {
  const expiring = await core.issueSession(alice);
  clock += 60_001;
  await assert.rejects(core.verifySession(expiring.token), (error: unknown) =>
    error instanceof IdentitySessionError && error.code === "INVALID_SESSION");
  await assert.rejects(core.verifySession(Buffer.alloc(32, 99).toString("base64url")), (error: unknown) =>
    error instanceof IdentitySessionError && error.code === "INVALID_SESSION");
});

test("independent sessions coexist and logout revokes only the presented session", async () => {
  const first = await core.issueSession(alice);
  const second = await core.issueSession(alice);
  assert.deepEqual((await core.verifySession(first.token)).owner, first.owner);
  assert.deepEqual((await core.verifySession(second.token)).owner, first.owner);
  await core.revokeSession(first.token);
  await assert.rejects(core.verifySession(first.token), (error: unknown) =>
    error instanceof IdentitySessionError && error.code === "INVALID_SESSION");
  assert.deepEqual((await core.verifySession(second.token)).owner, first.owner);
});

test("production session lifetime is explicit and validated", () => {
  assert.equal(requireProductionSessionTtlMs("60000"), 60_000);
  for (const invalid of [undefined, "", "0", "-1", "1.5", "24h", "9007199254740992"]) {
    assert.throws(
      () => requireProductionSessionTtlMs(invalid),
      (error: unknown) => error instanceof IdentitySessionError
        && error.code === "INTEGRITY_UNAVAILABLE",
    );
  }
  assert.throws(
    () => createPostgresIdentitySessionCore(db, capability.authority, { sessionTtlMs: 0 }),
    (error: unknown) => error instanceof IdentitySessionError
      && error.code === "INTEGRITY_UNAVAILABLE",
  );
});

test("concurrent first login converges on one owner without orphan rows", async () => {
  const raceDb = new FixtureDb();
  const raceCapability = createVerifiedControlCapability();
  let raceId = 500;
  let raceToken = 100;
  const raceCore = createPostgresIdentitySessionCore(raceDb, raceCapability.authority, {
    now: () => clock,
    newId: () => `20000000-0000-4000-8000-${(++raceId).toString().padStart(12, "0")}`,
    tokenBytes: () => Buffer.alloc(32, ++raceToken),
    sessionTtlMs: 60_000,
  });
  const firstControl = raceCapability.trustedIssuer.issue({
    ...appleNamespace,
    providerSubject: "concurrent-first-login",
  });
  const secondControl = raceCapability.trustedIssuer.issue({
    ...appleNamespace,
    providerSubject: "concurrent-first-login",
  });
  const [first, second] = await Promise.all([
    raceCore.issueSession(firstControl),
    raceCore.issueSession(secondControl),
  ]);
  assert.deepEqual(second.owner, first.owner);
  assert.equal(raceDb.data.owners.size, 1);
  assert.equal(raceDb.data.controls.size, 1);
  assert.equal(raceDb.data.sessions.size, 2);
  assert.deepEqual((await raceCore.verifySession(first.token)).owner, first.owner);
  assert.deepEqual((await raceCore.verifySession(second.token)).owner, first.owner);
});

test("database failures expose only fixed fail-closed errors", async () => {
  const issued = await core.issueSession(alice);
  db.fail = true;
  try {
    await core.verifySession(issued.token);
    assert.fail("database failure must reject");
  } catch (error) {
    assert.equal(error instanceof IdentitySessionError, true);
    assert.equal(String(error), "IdentitySessionError: AUTHORITY_UNAVAILABLE");
    assert.equal(String(error).includes(issued.token), false);
    assert.equal(String(error).includes("PRIVATE_DATABASE_DETAIL"), false);
  } finally {
    db.fail = false;
  }
});

const app = express();
app.use(express.json());
app.use("/api", createIdentityRouter(async () => core));
const server = createServer(app);
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
after(() => server.close());
const address = server.address();
if (!address || typeof address === "string") throw new Error("fixture server unavailable");
const origin = `http://127.0.0.1:${address.port}/api`;

test("HTTP surface exposes verify/logout only and returns bounded identity", async () => {
  const issued = await core.issueSession(alice);
  const forged = await fetch(`${origin}/identity/session`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "apple", providerSubject: aliceSubject }),
  });
  assert.equal(forged.status, 404);
  const verified = await fetch(`${origin}/identity/session`, {
    headers: { authorization: `Bearer ${issued.token}` },
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.headers.get("cache-control"), "no-store");
  const body = await verified.json();
  assert.deepEqual(Object.keys(body).sort(), ["owner", "validUntil"]);
  assert.deepEqual(Object.keys(body.owner).sort(), ["profileId", "subjectId"]);
  assert.equal(JSON.stringify(body).includes(issued.token), false);
  const logout = await fetch(`${origin}/identity/session/logout`, {
    method: "POST", headers: { authorization: `Bearer ${issued.token}` },
  });
  assert.equal(logout.status, 204);
  const denied = await fetch(`${origin}/identity/session`, {
    headers: { authorization: `Bearer ${issued.token}` },
  });
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { status: "denied" });
});

test("M3 request verification reuses IdentitySessionCore and exposes only a token digest", async () => {
  const issued = await core.issueSession(alice);
  let loads = 0;
  const verified = await verifyIdentityRequest({
    headers: { authorization: `Bearer ${issued.token}` },
  } as never, async () => {
    loads++;
    return core;
  });
  assert.equal(loads, 1);
  assert.equal(verified.sessionKey, tokenDigest(issued.token));
  assert.deepEqual(verified.owner, issued.owner);
  assert.equal(JSON.stringify(verified).includes(issued.token), false);
  await assert.rejects(
    verifyIdentityRequest({ headers: { authorization: 'Bearer malformed' } } as never,
      async () => { assert.fail('malformed bearer must fail before core load'); }),
    (error: unknown) => error instanceof IdentitySessionError && error.code === 'INVALID_SESSION',
  );
});

test("HTTP database failure is generic and contains no token/private payload", async () => {
  const issued = await core.issueSession(alice);
  db.fail = true;
  const response = await fetch(`${origin}/identity/session`, {
    headers: { authorization: `Bearer ${issued.token}` },
  });
  db.fail = false;
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.equal(text.includes(issued.token), false);
  assert.equal(text.includes(aliceSubject), false);
  assert.equal(text.includes("PRIVATE_DATABASE_DETAIL"), false);
  assert.deepEqual(JSON.parse(text), { status: "unavailable" });
});
