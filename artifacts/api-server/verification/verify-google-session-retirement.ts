import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  createPostgresIdentitySessionCore,
  createVerifiedControlCapability,
  IdentitySessionError,
  type SqlClient,
  type SqlPool,
} from "../src/identity/session-core";
import type {
  GoogleNamespaceAuthority,
  GoogleNamespaceAuthorityKey,
  GoogleNamespaceRetirementCas,
  GoogleNamespaceAuthoritySnapshot,
} from "../src/identity/google-namespace-authority";
import {
  createPostgresSessionOriginPolicy,
  retireGoogleProviderNamespace,
} from "../src/identity/session-origin-policy";

type OwnerRow = { subject_id: string; profile_id: string; status: "ACTIVE"; created_at: Date };
type PolicyRow = {
  provider: "google";
  credential_namespace_digest: string;
  enabled: boolean;
  current_epoch: number;
  reconciliation_digest: string | null;
};
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
type ControlRow = {
  binding_id: string;
  provider: string;
  credential_namespace_digest: string;
  provider_subject_digest: string;
  subject_id: string;
};
type ChallengeRow = {
  challenge_digest: string;
  credential_namespace_digest: string;
  consumed_at: Date | null;
  invalidated_at: Date | null;
};
type Data = {
  owners: Map<string, OwnerRow>;
  controls: Map<string, ControlRow>;
  policies: Map<string, PolicyRow>;
  sessions: Map<string, SessionRow>;
  challenges: Map<string, ChallengeRow>;
};

const clone = (data: Data): Data => ({
  owners: new Map([...data.owners].map(([key, row]) => [key, { ...row }])),
  controls: new Map([...data.controls].map(([key, row]) => [key, { ...row }])),
  policies: new Map([...data.policies].map(([key, row]) => [key, { ...row }])),
  sessions: new Map([...data.sessions].map(([key, row]) => [key, { ...row }])),
  challenges: new Map([...data.challenges].map(([key, row]) => [key, { ...row }])),
});
const policyKey = (provider: string, digest: string) => `${provider}:${digest}`;

class FixtureDb implements SqlPool {
  data: Data = {
    owners: new Map(), controls: new Map(), policies: new Map(),
    sessions: new Map(), challenges: new Map(),
  };
  readonly calls: Array<{ sql: string; values: unknown[] }> = [];
  private transactionTail: Promise<void> = Promise.resolve();
  failNextQueryMarker: string | null = null;
  afterCommit: (() => void) | undefined;

  private async acquireTransaction(): Promise<() => void> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    return release;
  }

  async connect(): Promise<SqlClient> {
    let working = this.data;
    let transaction = false;
    let releaseTransaction: (() => void) | undefined;
    return {
      query: async (sql, values = []) => {
        this.calls.push({ sql, values });
        if (this.failNextQueryMarker && sql.includes(this.failNextQueryMarker)) {
          this.failNextQueryMarker = null;
          throw new Error("simulated database cleanup failure");
        }
        if (sql.startsWith("BEGIN")) {
          releaseTransaction = await this.acquireTransaction();
          transaction = true;
          working = clone(this.data);
          return { rows: [] };
        }
        if (sql === "COMMIT") {
          if (transaction) this.data = working;
          transaction = false;
          releaseTransaction?.();
          releaseTransaction = undefined;
          this.afterCommit?.();
          this.afterCommit = undefined;
          return { rows: [] };
        }
        if (sql === "ROLLBACK") {
          transaction = false;
          working = this.data;
          releaseTransaction?.();
          releaseTransaction = undefined;
          return { rows: [] };
        }
        if (sql.includes("identity71:lock-control")) return { rows: [] };
        if (sql.includes("identity71:find-owner")) {
          const control = working.controls.get(`${values[0]}:${values[1]}:${values[2]}`);
          const owner = control ? working.owners.get(control.subject_id) : undefined;
          return { rows: owner && control ? [{ ...owner, binding_id: control.binding_id }] : [] };
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
            binding_id: String(values[0]),
            provider: String(values[1]),
            credential_namespace_digest: String(values[2]),
            provider_subject_digest: String(values[3]),
            subject_id: String(values[4]),
          });
          return { rows: [] };
        }
        if (sql.includes("identity197:lock-google-policy-retirement")
          || sql.includes("identity197:lock-google-policy-reconciliation")
          || sql.includes("identity197:lock-google-policy")) {
          const row = working.policies.get(policyKey(String(values[0]), String(values[1])));
          return { rows: row ? [{
            enabled: row.enabled,
            current_epoch: row.current_epoch,
            reconciliation_digest: row.reconciliation_digest,
          }] : [] };
        }
        if (sql.includes("identity197:reconcile-google-policy")) {
          const row = working.policies.get(policyKey(String(values[0]), String(values[1])));
          if (!row || !row.enabled || row.current_epoch !== Number(values[3])) return { rows: [] };
          row.reconciliation_digest = String(values[2]);
          return { rows: [{
            current_epoch: row.current_epoch,
            reconciliation_digest: row.reconciliation_digest,
          }] };
        }
        if (sql.includes("identity197:preflight-google-issuance")) {
          const row = working.policies.get(policyKey(String(values[0]), String(values[1])));
          return { rows: row ? [{ enabled: row.enabled,
            current_epoch: row.current_epoch,
            reconciliation_digest: row.reconciliation_digest }] : [] };
        }
        if (sql.includes("identity71:insert-session")) {
          const row: SessionRow = {
            session_id: String(values[0]), token_digest: String(values[1]), subject_id: String(values[2]),
            issued_at: values[3] as Date, valid_until: values[4] as Date, revoked_at: null,
            issuer_provider: values[5] === null ? null : String(values[5]),
            issuer_namespace_digest: values[6] === null ? null : String(values[6]),
            issuer_epoch: values[7] === null ? null : Number(values[7]),
            issuer_reconciliation_digest: values[8] === null ? null : String(values[8]),
            legacy_control_binding_id: values[9] === null ? null : String(values[9]),
          };
          working.sessions.set(row.token_digest, row);
          return { rows: [] };
        }
        if (sql.includes("identity71:verify-session")) {
          const session = working.sessions.get(String(values[0]));
          const checkedAt = values[1] as Date;
          if (!session || session.revoked_at !== null || session.valid_until <= checkedAt) return { rows: [] };
          const originValues = [
            session.issuer_provider,
            session.issuer_namespace_digest,
            session.issuer_epoch,
            session.issuer_reconciliation_digest,
          ];
          const originAbsent = originValues.every(value => value === null);
          const originPresent = originValues.every(value => value !== null);
          if (!originAbsent && !originPresent) return { rows: [] };
          if (originAbsent) {
            const exactLegacyControl = session.legacy_control_binding_id === null ? undefined
              : [...working.controls.values()].find(control =>
                control.binding_id === session.legacy_control_binding_id
                  && control.subject_id === session.subject_id
                  && control.provider === "apple");
            if (!exactLegacyControl) return { rows: [] };
          } else if (session.legacy_control_binding_id !== null) {
            return { rows: [] };
          }
          const owner = working.owners.get(session.subject_id);
          return { rows: owner ? [{
            ...owner,
            valid_until: session.valid_until,
            issuer_provider: session.issuer_provider,
            issuer_namespace_digest: session.issuer_namespace_digest,
            issuer_epoch: session.issuer_epoch,
            issuer_reconciliation_digest: session.issuer_reconciliation_digest,
            legacy_control_binding_id: session.legacy_control_binding_id,
          }] : [] };
        }
        if (sql.includes("identity197:confirm-google-issuance-current")) {
          const row = working.policies.get(policyKey(String(values[0]), String(values[1])));
          const hasControl = [...working.controls.values()].some(control =>
            control.subject_id === String(values[4])
              && control.provider === String(values[0])
              && control.credential_namespace_digest === String(values[1]));
          return { rows: row?.enabled
            && row.current_epoch === Number(values[2])
            && row.reconciliation_digest === String(values[3])
            && hasControl ? [{ current: 1 }] : [] };
        }
        if (sql.includes("identity197:verify-google-policy")) {
          const row = working.policies.get(policyKey(String(values[0]), String(values[1])));
          const hasControl = [...working.controls.values()].some(control =>
            control.subject_id === String(values[3])
              && control.provider === String(values[0])
              && control.credential_namespace_digest === String(values[1]));
          return { rows: row?.enabled && row.current_epoch === Number(values[2])
            && row.reconciliation_digest === String(values[4]) && hasControl
            ? [{ current: 1 }] : [] };
        }
        if (sql.includes("identity197:disable-google-policy")) {
          const key = policyKey(String(values[0]), String(values[1]));
          const row = working.policies.get(key);
          if (!row || row.current_epoch !== Number(values[3])) return { rows: [] };
          row.enabled = false;
          row.current_epoch = Number(values[2]);
          row.reconciliation_digest = null;
          return { rows: [{ enabled: row.enabled, current_epoch: row.current_epoch,
            reconciliation_digest: row.reconciliation_digest }] };
        }
        if (sql.includes("identity197:revoke-google-sessions")) {
          const rows: Record<string, unknown>[] = [];
          for (const session of working.sessions.values()) {
            if (session.issuer_provider === values[0]
              && session.issuer_namespace_digest === values[1]
              && session.revoked_at === null) {
              session.revoked_at = values[2] as Date;
              rows.push({ session_id: session.session_id });
            }
          }
          return { rows };
        }
        if (sql.includes("identity197:invalidate-google-challenges")) {
          const rows: Record<string, unknown>[] = [];
          for (const challenge of working.challenges.values()) {
            if (challenge.credential_namespace_digest === values[0]
              && challenge.consumed_at === null && challenge.invalidated_at === null) {
              challenge.invalidated_at = values[1] as Date;
              rows.push({ challenge_digest: challenge.challenge_digest });
            }
          }
          return { rows };
        }
        if (sql.includes("identity197:read-google-policy-retirement")) {
          const row = working.policies.get(policyKey(String(values[0]), String(values[1])));
          return { rows: row ? [{ enabled: row.enabled, current_epoch: row.current_epoch,
            reconciliation_digest: row.reconciliation_digest }] : [] };
        }
        if (sql.includes("identity71:revoke-session")) {
          const session = working.sessions.get(String(values[0]));
          if (!session || session.revoked_at !== null) return { rows: [] };
          session.revoked_at = values[1] as Date;
          return { rows: [{ session_id: session.session_id }] };
        }
        throw new Error(`unexpected fixture query: ${sql}`);
      },
      release: () => {
        releaseTransaction?.();
        releaseTransaction = undefined;
      },
    };
  }
}

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const namespaceDigest = (provider: string, issuer: string, audience: string) =>
  sha256(JSON.stringify([provider, issuer, audience]));
const tokenDigest = (token: string) => sha256(token);
function seedOwnerAndControl(
  db: FixtureDb,
  namespace: Readonly<{ provider: string; issuer: string; audience: string }>,
  providerSubject: string,
  subjectId: string,
  bindingId: string,
): ControlRow {
  const digest = namespaceDigest(namespace.provider, namespace.issuer, namespace.audience);
  const subjectDigest = sha256(`${digest}\0${providerSubject}`);
  const row: ControlRow = {
    binding_id: bindingId,
    provider: namespace.provider,
    credential_namespace_digest: digest,
    provider_subject_digest: subjectDigest,
    subject_id: subjectId,
  };
  if (!db.data.owners.has(subjectId)) {
    db.data.owners.set(subjectId, {
      subject_id: subjectId,
      profile_id: subjectId.replace(/.$/, "2"),
      status: "ACTIVE",
      created_at: new Date("2026-10-02T00:00:00.000Z"),
    });
  }
  db.data.controls.set(`${namespace.provider}:${digest}:${subjectDigest}`, row);
  return row;
}
const googleA = Object.freeze({
  provider: "google", issuer: "https://accounts.google.com", audience: "project-100-ios",
});
const googleB = Object.freeze({
  provider: "google", issuer: "https://accounts.google.com", audience: "project-100-web",
});
const apple = Object.freeze({
  provider: "apple", issuer: "https://appleid.apple.com", audience: "com.project100.ios",
});

const TEST_ENVIRONMENT = "verification";
const TEST_INCARNATION = "verified-incarnation-1";

const authorityKey = (key: GoogleNamespaceAuthorityKey): string =>
  `${key.deploymentEnvironment}:${key.provider}:${key.credentialNamespaceDigest}`;

class FixtureGoogleNamespaceAuthority implements GoogleNamespaceAuthority {
  readonly records = new Map<string, unknown>();
  reads = 0;
  retirementCalls = 0;
  readFailures = 0;
  ambiguousRetirementOnce = false;
  onRead: ((key: GoogleNamespaceAuthorityKey, readNumber: number) => void) | undefined;

  seed(credentialNamespaceDigest: string, generation = 1): GoogleNamespaceAuthoritySnapshot {
    const record: GoogleNamespaceAuthoritySnapshot = Object.freeze({
      schemaVersion: 1,
      deploymentEnvironment: TEST_ENVIRONMENT,
      provider: "google",
      credentialNamespaceDigest,
      admittedIncarnation: TEST_INCARNATION,
      monotonicGeneration: generation,
      status: "ENABLED",
      lastControlOperationId: `enable-${generation}`,
      lastControlAction: "ENABLE",
    });
    this.records.set(authorityKey({
      deploymentEnvironment: TEST_ENVIRONMENT,
      provider: "google",
      credentialNamespaceDigest,
    }), record);
    return record;
  }

  replace(credentialNamespaceDigest: string, value: unknown): void {
    this.records.set(authorityKey({
      deploymentEnvironment: TEST_ENVIRONMENT,
      provider: "google",
      credentialNamespaceDigest,
    }), value);
  }

  enable(credentialNamespaceDigest: string, generation: number, operationId: string): void {
    const key = authorityKey({
      deploymentEnvironment: TEST_ENVIRONMENT,
      provider: "google",
      credentialNamespaceDigest,
    });
    const current = this.records.get(key) as GoogleNamespaceAuthoritySnapshot;
    this.records.set(key, Object.freeze({
      ...current,
      monotonicGeneration: generation,
      status: "ENABLED",
      lastControlOperationId: operationId,
      lastControlAction: "ENABLE",
    }));
  }

  readCurrent(key: GoogleNamespaceAuthorityKey): Promise<unknown> {
    this.reads++;
    this.onRead?.(key, this.reads);
    if (this.readFailures > 0) {
      this.readFailures--;
      return Promise.reject(new Error("simulated external authority read failure"));
    }
    const value = this.records.get(authorityKey(key));
    return Promise.resolve(value && typeof value === "object" ? { ...value } : value ?? null);
  }

  async compareAndSetRetirement(input: GoogleNamespaceRetirementCas): Promise<unknown> {
    this.retirementCalls++;
    const key = authorityKey(input.key);
    const value = this.records.get(key);
    if (!value || typeof value !== "object") throw new Error("authority compare-and-set conflict");
    const current = value as GoogleNamespaceAuthoritySnapshot;
    if (current.admittedIncarnation !== input.expectedIncarnation
      || current.monotonicGeneration !== input.expectedGeneration
      || current.status !== input.expectedStatus) throw new Error("authority compare-and-set conflict");
    const retired: GoogleNamespaceAuthoritySnapshot = Object.freeze({
      ...current,
      monotonicGeneration: input.expectedGeneration + 1,
      status: "DISABLED",
      lastControlOperationId: input.operationId,
      lastControlAction: "RETIRE",
    });
    this.records.set(key, retired);
    if (this.ambiguousRetirementOnce) {
      this.ambiguousRetirementOnce = false;
      throw new Error("simulated response loss after external commit");
    }
    return retired;
  }
}

function harness() {
  const db = new FixtureDb();
  const capability = createVerifiedControlCapability();
  const externalAuthority = new FixtureGoogleNamespaceAuthority();
  const trustedBinding = Object.freeze({
    deploymentEnvironment: TEST_ENVIRONMENT,
    admittedIncarnation: TEST_INCARNATION,
  });
  let reconciliationToken = 0;
  const newOriginPolicy = () => createPostgresSessionOriginPolicy({
    authority: externalAuthority,
    trustedBinding,
    tokenBytes: () => Buffer.alloc(32, ++reconciliationToken),
  });
  const originPolicy = newOriginPolicy();
  let id = 0;
  let token = 0;
  const newCore = (
    policy: ReturnType<typeof createPostgresSessionOriginPolicy> | undefined = originPolicy,
    bytes: (() => Buffer) | undefined = undefined,
  ) => createPostgresIdentitySessionCore(db, capability.authority, {
    sessionTtlMs: 60_000,
    now: () => Date.parse("2026-10-02T00:00:00.000Z"),
    newId: () => `30000000-0000-4000-8000-${(++id).toString().padStart(12, "0")}`,
    tokenBytes: bytes ?? (() => Buffer.alloc(32, ++token)),
    originPolicy: policy,
  });
  const core = newCore();
  const seedPolicy = (namespace: typeof googleA | typeof googleB, enabled = true, epoch = 1) => {
    const digest = namespaceDigest(namespace.provider, namespace.issuer, namespace.audience);
    externalAuthority.seed(digest, epoch);
    db.data.policies.set(policyKey("google", digest), {
      provider: "google", credential_namespace_digest: digest, enabled, current_epoch: epoch,
      reconciliation_digest: null,
    });
    if (!enabled) {
      const current = externalAuthority.records.get(authorityKey({
        deploymentEnvironment: TEST_ENVIRONMENT,
        provider: "google",
        credentialNamespaceDigest: digest,
      })) as GoogleNamespaceAuthoritySnapshot;
      externalAuthority.replace(digest, Object.freeze({
        ...current,
        status: "DISABLED",
        lastControlOperationId: `retire-${epoch}`,
        lastControlAction: "RETIRE",
      }));
    }
    return digest;
  };
  const reconcilePolicy = async (namespace: typeof googleA | typeof googleB) => {
    const digest = namespaceDigest(namespace.provider, namespace.issuer, namespace.audience);
    await originPolicy.reconcileProviderNamespace(db, digest);
    return digest;
  };
  return {
    db,
    capability,
    core,
    originPolicy,
    externalAuthority,
    newOriginPolicy,
    newCore,
    seedPolicy,
    reconcilePolicy,
  };
}

const denied = (error: unknown) => error instanceof IdentitySessionError
  && (error.code === "INVALID_SESSION"
    || error.code === "AUTHORITY_UNAVAILABLE"
    || error.code === "INTEGRITY_UNAVAILABLE"
    || error.code === "UNTRUSTED_CONTROL");

test("legacy Apple sessions retain the approved origin-free behavior", async () => {
  const { db, capability, core } = harness();
  const issued = await core.issueSession(capability.trustedIssuer.issue({
    ...apple, providerSubject: "apple-user-a",
  }));
  const row = db.data.sessions.get(tokenDigest(issued.token))!;
  const appleControl = [...db.data.controls.values()].find(control => control.provider === "apple");
  assert.ok(appleControl);
  assert.equal(row.legacy_control_binding_id, appleControl.binding_id);
  assert.equal(row.issuer_provider, null);
  assert.deepEqual((await core.verifySession(issued.token)).owner, issued.owner);
});

test("historical all-null Apple-shaped session without its own marker is denied", async () => {
  const { db, capability, core } = harness();
  const issued = await core.issueSession(capability.trustedIssuer.issue({
    ...apple, providerSubject: "old-unmarked-apple-session",
  }));
  const row = db.data.sessions.get(tokenDigest(issued.token))!;
  row.legacy_control_binding_id = null;
  await assert.rejects(core.verifySession(issued.token), denied);
});

test("mixed Apple and Google owner cannot downgrade an origin-erased Google session", async () => {
  const { db, capability, core, seedPolicy, reconcilePolicy } = harness();
  const owner = "50000000-0000-4000-8000-000000000001";
  const appleBinding = seedOwnerAndControl(
    db, apple, "mixed-owner-apple", owner, "60000000-0000-4000-8000-000000000001",
  );
  seedOwnerAndControl(
    db, googleA, "mixed-owner-google", owner, "60000000-0000-4000-8000-000000000002",
  );
  seedPolicy(googleA);
  await reconcilePolicy(googleA);
  const appleSession = await core.issueSession(capability.trustedIssuer.issue({
    ...apple, providerSubject: "mixed-owner-apple",
  }));
  const googleSession = await core.issueSession(capability.trustedIssuer.issue({
    ...googleA, providerSubject: "mixed-owner-google",
  }));
  assert.equal(appleSession.owner.subjectId, googleSession.owner.subjectId);
  const googleRow = db.data.sessions.get(tokenDigest(googleSession.token))!;
  assert.equal(googleRow.legacy_control_binding_id, null);
  assert.deepEqual((await core.verifySession(appleSession.token)).owner, appleSession.owner);

  googleRow.issuer_provider = null;
  googleRow.issuer_namespace_digest = null;
  googleRow.issuer_epoch = null;
  googleRow.issuer_reconciliation_digest = null;
  assert.equal(db.data.controls.get(`apple:${appleBinding.credential_namespace_digest}:${appleBinding.provider_subject_digest}`)?.binding_id,
    appleBinding.binding_id);
  await assert.rejects(core.verifySession(googleSession.token), denied);
});

test("legacy marker for another subject or non-Apple provider is denied", async () => {
  const { db, capability, core, seedPolicy, reconcilePolicy } = harness();
  const owner = "50000000-0000-4000-8000-000000000011";
  const foreignOwner = "50000000-0000-4000-8000-000000000021";
  const foreignApple = seedOwnerAndControl(
    db, apple, "foreign-apple", foreignOwner, "60000000-0000-4000-8000-000000000021",
  );
  const ownGoogle = seedOwnerAndControl(
    db, googleA, "owner-google", owner, "60000000-0000-4000-8000-000000000011",
  );
  seedOwnerAndControl(
    db, apple, "owner-apple", owner, "60000000-0000-4000-8000-000000000012",
  );
  seedPolicy(googleA);
  await reconcilePolicy(googleA);
  const googleSession = await core.issueSession(capability.trustedIssuer.issue({
    ...googleA, providerSubject: "owner-google",
  }));
  const row = db.data.sessions.get(tokenDigest(googleSession.token))!;
  row.issuer_provider = null;
  row.issuer_namespace_digest = null;
  row.issuer_epoch = null;
  row.issuer_reconciliation_digest = null;
  row.legacy_control_binding_id = foreignApple.binding_id;
  await assert.rejects(core.verifySession(googleSession.token), denied);

  row.legacy_control_binding_id = ownGoogle.binding_id;
  await assert.rejects(core.verifySession(googleSession.token), denied);
});

test("scoped Google origin cannot also claim Apple legacy provenance", async () => {
  const { db, capability, core, seedPolicy, reconcilePolicy } = harness();
  const owner = "50000000-0000-4000-8000-000000000031";
  const appleBinding = seedOwnerAndControl(
    db, apple, "scope-apple", owner, "60000000-0000-4000-8000-000000000031",
  );
  seedOwnerAndControl(
    db, googleA, "scope-google", owner, "60000000-0000-4000-8000-000000000032",
  );
  seedPolicy(googleA);
  await reconcilePolicy(googleA);
  const issued = await core.issueSession(capability.trustedIssuer.issue({
    ...googleA, providerSubject: "scope-google",
  }));
  db.data.sessions.get(tokenDigest(issued.token))!.legacy_control_binding_id = appleBinding.binding_id;
  await assert.rejects(core.verifySession(issued.token), denied);
});

test("Google issuance requires trusted control plus an enabled current policy", async () => {
  const { db, capability, core, seedPolicy, reconcilePolicy } = harness();
  const control = capability.trustedIssuer.issue({ ...googleA, providerSubject: "google-user-a" });
  await assert.rejects(core.issueSession(control), denied);
  assert.equal(db.data.owners.size, 0, "failed issuance must roll back owner creation");
  seedPolicy(googleA);
  await assert.rejects(
    core.issueSession(control),
    denied,
    "enabled policy without explicit currentness reconciliation must fail closed",
  );
  await reconcilePolicy(googleA);
  await assert.rejects(core.issueSession({
    provider: "google", issuer: googleA.issuer, audience: googleA.audience,
    providerSubject: "google-user-a", issuerEpoch: 1,
  } as never), denied);
  const issued = await core.issueSession(control);
  assert.deepEqual((await core.verifySession(issued.token)).owner, issued.owner);
});

test("Google scoped sessions fail closed when origin is missing, disabled, or stale", async () => {
  const { db, capability, core, seedPolicy, reconcilePolicy } = harness();
  const digest = seedPolicy(googleA);
  await reconcilePolicy(googleA);
  const control = capability.trustedIssuer.issue({ ...googleA, providerSubject: "google-user-a" });
  const missing = await core.issueSession(control);
  const missingRow = db.data.sessions.get(tokenDigest(missing.token))!;
  missingRow.issuer_provider = "google";
  missingRow.issuer_namespace_digest = null;
  missingRow.issuer_epoch = null;
  missingRow.issuer_reconciliation_digest = null;
  await assert.rejects(core.verifySession(missing.token), denied);

  const disabled = await core.issueSession(control);
  db.data.policies.get(policyKey("google", digest))!.enabled = false;
  await assert.rejects(core.verifySession(disabled.token), denied);

  db.data.policies.get(policyKey("google", digest))!.enabled = true;
  db.data.policies.get(policyKey("google", digest))!.current_epoch = 2;
  await assert.rejects(core.verifySession(disabled.token), denied);
});

test("ALL_NULL_GOOGLE_ORIGIN_ACCEPTED_WITH_DISABLED_POLICY is denied", async () => {
  const { db, capability, core, seedPolicy, reconcilePolicy } = harness();
  const digest = seedPolicy(googleA);
  await reconcilePolicy(googleA);
  const control = capability.trustedIssuer.issue({ ...googleA, providerSubject: "all-null-google" });
  const issued = await core.issueSession(control);
  const row = db.data.sessions.get(tokenDigest(issued.token))!;
  row.issuer_provider = null;
  row.issuer_namespace_digest = null;
  row.issuer_epoch = null;
  row.issuer_reconciliation_digest = null;
  row.legacy_control_binding_id = null;
  db.data.policies.get(policyKey("google", digest))!.enabled = false;
  await assert.rejects(core.verifySession(issued.token), denied);
});

test("provider retirement touches only the selected Google namespace", async () => {
  const { db, capability, core, originPolicy, seedPolicy, reconcilePolicy } = harness();
  const digestA = seedPolicy(googleA);
  const digestB = seedPolicy(googleB);
  await reconcilePolicy(googleA);
  await reconcilePolicy(googleB);
  const googleSessionA = await core.issueSession(capability.trustedIssuer.issue({
    ...googleA, providerSubject: "google-user-a",
  }));
  const googleSessionB = await core.issueSession(capability.trustedIssuer.issue({
    ...googleB, providerSubject: "google-user-b",
  }));
  const appleSession = await core.issueSession(capability.trustedIssuer.issue({
    ...apple, providerSubject: "apple-user-a",
  }));
  db.data.challenges.set("challenge-a", {
    challenge_digest: "challenge-a", credential_namespace_digest: digestA,
    consumed_at: null, invalidated_at: null,
  });
  db.data.challenges.set("challenge-b", {
    challenge_digest: "challenge-b", credential_namespace_digest: digestB,
    consumed_at: null, invalidated_at: null,
  });
  const ownersBefore = JSON.stringify([...db.data.owners]);
  const controlsBefore = JSON.stringify([...db.data.controls]);

  const retired = await retireGoogleProviderNamespace(db, digestA, originPolicy, () =>
    Date.parse("2026-10-02T00:00:10.000Z"));
  assert.equal(retired.retiredEpoch, 2);
  assert.equal(retired.revokedSessions, 1);
  assert.equal(retired.invalidatedChallenges, 1);
  await assert.rejects(core.verifySession(googleSessionA.token), denied);
  assert.deepEqual((await core.verifySession(googleSessionB.token)).owner, googleSessionB.owner);
  assert.deepEqual((await core.verifySession(appleSession.token)).owner, appleSession.owner);
  assert.equal(JSON.stringify([...db.data.owners]), ownersBefore);
  assert.equal(JSON.stringify([...db.data.controls]), controlsBefore);
  assert.equal(db.data.policies.get(policyKey("google", digestA))!.enabled, false);
  assert.equal(db.data.policies.get(policyKey("google", digestB))!.enabled, true);
  assert.ok(db.data.challenges.get("challenge-a")!.invalidated_at instanceof Date);
  assert.equal(db.data.challenges.get("challenge-b")!.invalidated_at, null);
});

test("concurrent issuance and retirement cannot leave a usable Google session", async () => {
  const { db, capability, core, originPolicy, seedPolicy, reconcilePolicy } = harness();
  const digest = seedPolicy(googleA);
  await reconcilePolicy(googleA);
  const issuance = core.issueSession(capability.trustedIssuer.issue({
    ...googleA, providerSubject: "racing-google-user",
  }));
  const retirement = retireGoogleProviderNamespace(db, digest, originPolicy, () =>
    Date.parse("2026-10-02T00:00:20.000Z"));
  const [issued, retired] = await Promise.allSettled([issuance, retirement]);
  assert.equal(retired.status, "fulfilled");
  if (issued.status === "fulfilled") {
    await assert.rejects(core.verifySession(issued.value.token), denied);
  } else {
    assert.equal(denied(issued.reason), true);
  }
  const policy = db.data.policies.get(policyKey("google", digest))!;
  assert.equal(policy.enabled, false);
  assert.equal(policy.current_epoch, 2);
});

test("explicit newer external enable never revives retired sessions", async () => {
  const { db, capability, core, originPolicy, externalAuthority, seedPolicy, reconcilePolicy } = harness();
  const digest = seedPolicy(googleA);
  await reconcilePolicy(googleA);
  const control = capability.trustedIssuer.issue({ ...googleA, providerSubject: "google-user-a" });
  const oldSession = await core.issueSession(control);
  await retireGoogleProviderNamespace(db, digest, originPolicy);
  const policy = db.data.policies.get(policyKey("google", digest))!;
  policy.enabled = true;
  policy.current_epoch = 3;
  externalAuthority.enable(digest, 3, "explicit-enable-3");
  await reconcilePolicy(googleA);
  await assert.rejects(core.verifySession(oldSession.token), denied);
  const currentSession = await core.issueSession(control);
  assert.deepEqual((await core.verifySession(currentSession.token)).owner, currentSession.owner);
});

test("restored old policy and session stay denied after policy object recreation", async () => {
  const { db, capability, core, originPolicy, newOriginPolicy, newCore,
    seedPolicy, reconcilePolicy } = harness();
  const digest = seedPolicy(googleA);
  await reconcilePolicy(googleA);
  const control = capability.trustedIssuer.issue({ ...googleA, providerSubject: "restored-user" });
  const oldSession = await core.issueSession(control);
  const restoredState = clone(db.data);

  await retireGoogleProviderNamespace(db, digest, originPolicy);
  db.data = clone(restoredState);
  await assert.rejects(
    core.verifySession(oldSession.token),
    denied,
    "RESTORED_MATCHING_POLICY_AND_SESSION_ACCEPTED_WITHOUT_RECONCILIATION",
  );
  await assert.rejects(
    originPolicy.reconcileProviderNamespace(db, digest),
    denied,
    "a restored policy below the retired epoch floor must not be reconciled",
  );

  const restartedPolicy = newOriginPolicy();
  const restartedCore = newCore(restartedPolicy);
  await assert.rejects(
    restartedPolicy.reconcileProviderNamespace(db, digest),
    denied,
    "a new process cannot create current authority from a restored old DB snapshot",
  );
  await assert.rejects(restartedCore.issueSession(control), denied);
  await assert.rejects(restartedCore.verifySession(oldSession.token), denied);
});

test("missing authority port fails closed for reconcile, issue, and verify", async () => {
  const { db, capability, core, seedPolicy, reconcilePolicy, newCore } = harness();
  const digest = seedPolicy(googleA);
  await reconcilePolicy(googleA);
  const control = capability.trustedIssuer.issue({ ...googleA, providerSubject: "no-port-user" });
  const existing = await core.issueSession(control);
  const noPortPolicy = createPostgresSessionOriginPolicy();
  const noPortCore = newCore(noPortPolicy);
  await assert.rejects(noPortPolicy.reconcileProviderNamespace(db, digest), denied);
  await assert.rejects(noPortCore.issueSession(control), denied);
  await assert.rejects(noPortCore.verifySession(existing.token), denied);
});

test("missing, malformed, and unadmitted authority records deny reconciliation", async () => {
  for (const state of ["MISSING", "MALFORMED", "UNADMITTED"] as const) {
    const { externalAuthority, seedPolicy, reconcilePolicy, db, originPolicy } = harness();
    const digest = seedPolicy(googleA);
    const key = authorityKey({
      deploymentEnvironment: TEST_ENVIRONMENT,
      provider: "google",
      credentialNamespaceDigest: digest,
    });
    const snapshot = externalAuthority.records.get(key) as GoogleNamespaceAuthoritySnapshot;
    if (state === "MISSING") externalAuthority.records.delete(key);
    if (state === "MALFORMED") externalAuthority.replace(digest, { ...snapshot, status: "UNKNOWN" });
    if (state === "UNADMITTED") {
      externalAuthority.replace(digest, { ...snapshot, admittedIncarnation: "restored-old-incarnation" });
    }
    await assert.rejects(originPolicy.reconcileProviderNamespace(db, digest), denied, state);
    await assert.rejects(reconcilePolicy(googleA), denied, `${state} read remains denied`);
  }
});

test("DB generation below or ahead of enabled authority is denied", async () => {
  for (const direction of ["DB_BELOW", "DB_AHEAD"] as const) {
    const { db, externalAuthority, seedPolicy, originPolicy } = harness();
    const digest = seedPolicy(googleA);
    const policy = db.data.policies.get(policyKey("google", digest))!;
    const record = externalAuthority.records.get(authorityKey({
      deploymentEnvironment: TEST_ENVIRONMENT,
      provider: "google",
      credentialNamespaceDigest: digest,
    })) as GoogleNamespaceAuthoritySnapshot;
    if (direction === "DB_BELOW") {
      externalAuthority.replace(digest, { ...record, monotonicGeneration: 2 });
    } else {
      policy.current_epoch = 2;
    }
    await assert.rejects(originPolicy.reconcileProviderNamespace(db, digest), denied, direction);
  }
});

test("exact enabled authority and DB tuple reconciles", async () => {
  const { db, originPolicy, seedPolicy } = harness();
  const digest = seedPolicy(googleA);
  const state = await originPolicy.reconcileProviderNamespace(db, digest);
  assert.equal(state.epoch, 1);
  assert.equal(state.authority.status, "ENABLED");
  assert.equal(db.data.policies.get(policyKey("google", digest))!.current_epoch,
    state.authority.monotonicGeneration);
});

test("Google issuance preflight rejects stale policy before owner or session writes", async () => {
  const { db, capability, core, externalAuthority, seedPolicy, reconcilePolicy } = harness();
  const digest = seedPolicy(googleA);
  await reconcilePolicy(googleA);
  db.calls.length = 0;
  db.data.policies.get(policyKey("google", digest))!.enabled = false;

  await assert.rejects(core.issueSession(capability.trustedIssuer.issue({
    ...googleA, providerSubject: "stale-preflight-user",
  })), denied);
  assert.equal(db.calls.some(call => call.sql.includes("identity197:preflight-google-issuance")), true);
  assert.equal(db.calls.some(call => call.sql.includes("identity71:")), false,
    "no identity rows or bindings may be touched before the Google currentness preflight");
  assert.equal((externalAuthority.records.get(authorityKey({
    deploymentEnvironment: TEST_ENVIRONMENT,
    provider: "google",
    credentialNamespaceDigest: digest,
  })) as GoogleNamespaceAuthoritySnapshot).status, "ENABLED");
});

test("authority change between reconciliation R0 and R1 never publishes RAM state", async () => {
  const { db, originPolicy, externalAuthority, seedPolicy } = harness();
  const digest = seedPolicy(googleA);
  externalAuthority.onRead = (_key, readNumber) => {
    if (readNumber !== 2) return;
    const record = externalAuthority.records.get(authorityKey({
      deploymentEnvironment: TEST_ENVIRONMENT,
      provider: "google",
      credentialNamespaceDigest: digest,
    })) as GoogleNamespaceAuthoritySnapshot;
    externalAuthority.replace(digest, {
      ...record,
      monotonicGeneration: 2,
      status: "DISABLED",
      lastControlOperationId: "retire-during-reconcile",
      lastControlAction: "RETIRE",
    });
  };
  await assert.rejects(originPolicy.reconcileProviderNamespace(db, digest), denied);
  externalAuthority.onRead = undefined;
  await assert.rejects(originPolicy.authorizeIssuance(
    { query: async () => ({ rows: [] }), release: () => undefined },
    { provider: "google", credentialNamespaceDigest: digest,
      providerSubjectDigest: "0".repeat(64), concurrencyLockKey: "0" },
  ), denied);
});

test("post-commit authority change returns no token and leaves only an unusable orphan row", async () => {
  const { db, capability, originPolicy, externalAuthority, seedPolicy,
    reconcilePolicy, newCore } = harness();
  const digest = seedPolicy(googleA);
  await reconcilePolicy(googleA);
  const control = capability.trustedIssuer.issue({ ...googleA, providerSubject: "post-commit-race" });
  const fixedBytes = Buffer.alloc(32, 77);
  const token = fixedBytes.toString("base64url");
  const issuingCore = newCore(originPolicy, () => Buffer.from(fixedBytes));
  db.afterCommit = () => {
    const record = externalAuthority.records.get(authorityKey({
      deploymentEnvironment: TEST_ENVIRONMENT,
      provider: "google",
      credentialNamespaceDigest: digest,
    })) as GoogleNamespaceAuthoritySnapshot;
    externalAuthority.replace(digest, {
      ...record,
      monotonicGeneration: 2,
      status: "DISABLED",
      lastControlOperationId: "retire-after-session-commit",
      lastControlAction: "RETIRE",
    });
  };
  await assert.rejects(issuingCore.issueSession(control), denied);
  assert.ok(db.data.sessions.has(tokenDigest(token)), "committed session row is an orphan without returned token");
  await assert.rejects(issuingCore.verifySession(token), denied);
});

test("Google verification rereads live authority after successful issuance", async () => {
  const { db, capability, core, externalAuthority, seedPolicy, reconcilePolicy } = harness();
  const digest = seedPolicy(googleA);
  await reconcilePolicy(googleA);
  const issued = await core.issueSession(capability.trustedIssuer.issue({
    ...googleA, providerSubject: "live-verify-user",
  }));
  const record = externalAuthority.records.get(authorityKey({
    deploymentEnvironment: TEST_ENVIRONMENT,
    provider: "google",
    credentialNamespaceDigest: digest,
  })) as GoogleNamespaceAuthoritySnapshot;
  externalAuthority.replace(digest, {
    ...record,
    monotonicGeneration: 2,
    status: "DISABLED",
    lastControlOperationId: "retire-before-verify",
    lastControlAction: "RETIRE",
  });
  await assert.rejects(core.verifySession(issued.token), denied);
});

test("both issuance and retirement linearization orders fail closed after retirement", async () => {
  const first = harness();
  const firstDigest = first.seedPolicy(googleA);
  await first.reconcilePolicy(googleA);
  await retireGoogleProviderNamespace(first.db, firstDigest, first.originPolicy);
  await assert.rejects(first.core.issueSession(first.capability.trustedIssuer.issue({
    ...googleA, providerSubject: "retired-first-user",
  })), denied);

  const second = harness();
  const secondDigest = second.seedPolicy(googleA);
  await second.reconcilePolicy(googleA);
  const issued = await second.core.issueSession(second.capability.trustedIssuer.issue({
    ...googleA, providerSubject: "issued-before-retirement-user",
  }));
  await retireGoogleProviderNamespace(second.db, secondDigest, second.originPolicy);
  await assert.rejects(second.core.verifySession(issued.token), denied);
});

test("external retirement survives DB cleanup failure and retry uses the same generation", async () => {
  const { db, originPolicy, externalAuthority, seedPolicy } = harness();
  const digest = seedPolicy(googleA);
  db.failNextQueryMarker = "identity197:disable-google-policy";
  await assert.rejects(
    retireGoogleProviderNamespace(db, digest, originPolicy),
    error => error instanceof IdentitySessionError
      && error.code === "AUTHORITY_RETIRED_DB_CLEANUP_PENDING",
  );
  const key = authorityKey({
    deploymentEnvironment: TEST_ENVIRONMENT,
    provider: "google",
    credentialNamespaceDigest: digest,
  });
  const afterFirstAttempt = externalAuthority.records.get(key) as GoogleNamespaceAuthoritySnapshot;
  assert.equal(afterFirstAttempt.status, "DISABLED");
  assert.equal(afterFirstAttempt.monotonicGeneration, 2);
  assert.equal(externalAuthority.retirementCalls, 1);

  const retried = await retireGoogleProviderNamespace(db, digest, originPolicy);
  const afterRetry = externalAuthority.records.get(key) as GoogleNamespaceAuthoritySnapshot;
  assert.equal(retried.retiredEpoch, 2);
  assert.equal(afterRetry.monotonicGeneration, 2);
  assert.equal(externalAuthority.retirementCalls, 1);
  assert.equal(db.data.policies.get(policyKey("google", digest))!.enabled, false);
});

test("ambiguous external retirement commit is decided only by same-operation readback", async () => {
  const { db, originPolicy, externalAuthority, seedPolicy } = harness();
  const digest = seedPolicy(googleA);
  externalAuthority.ambiguousRetirementOnce = true;
  const result = await retireGoogleProviderNamespace(db, digest, originPolicy);
  const record = externalAuthority.records.get(authorityKey({
    deploymentEnvironment: TEST_ENVIRONMENT,
    provider: "google",
    credentialNamespaceDigest: digest,
  })) as GoogleNamespaceAuthoritySnapshot;
  assert.equal(result.retiredEpoch, 2);
  assert.equal(record.status, "DISABLED");
  assert.equal(record.monotonicGeneration, 2);
  assert.match(record.lastControlOperationId, /^[0-9a-f]{64}$/);
  assert.equal(externalAuthority.retirementCalls, 1);
});

test("stale retirement generation cannot overwrite newer external authority", async () => {
  const { db, originPolicy, externalAuthority, seedPolicy } = harness();
  const digest = seedPolicy(googleA);
  const key = authorityKey({
    deploymentEnvironment: TEST_ENVIRONMENT,
    provider: "google",
    credentialNamespaceDigest: digest,
  });
  const initial = externalAuthority.records.get(key) as GoogleNamespaceAuthoritySnapshot;
  externalAuthority.replace(digest, { ...initial, monotonicGeneration: 3 });
  await assert.rejects(
    originPolicy.retireNamespaceAuthority(digest, 1, "0".repeat(64)),
    denied,
  );
  assert.equal((externalAuthority.records.get(key) as GoogleNamespaceAuthoritySnapshot)
    .monotonicGeneration, 3);
  assert.equal(externalAuthority.retirementCalls, 0);
  assert.equal(db.data.policies.get(policyKey("google", digest))!.current_epoch, 1);
});

test("Apple issue and verify remain available while Google authority is unavailable", async () => {
  const { capability, newCore } = harness();
  const appleOnlyCore = newCore(createPostgresSessionOriginPolicy());
  const issued = await appleOnlyCore.issueSession(capability.trustedIssuer.issue({
    ...apple, providerSubject: "apple-with-google-outage",
  }));
  assert.deepEqual((await appleOnlyCore.verifySession(issued.token)).owner, issued.owner);
});

test("two policy objects share external currentness but cannot borrow each other's RAM", async () => {
  const { db, capability, core, externalAuthority, newOriginPolicy, newCore,
    seedPolicy, reconcilePolicy } = harness();
  const digest = seedPolicy(googleA);
  await reconcilePolicy(googleA);
  const control = capability.trustedIssuer.issue({ ...googleA, providerSubject: "two-process-user" });
  const issued = await core.issueSession(control);
  const secondPolicy = newOriginPolicy();
  const secondCore = newCore(secondPolicy);
  await assert.rejects(secondCore.verifySession(issued.token), denied);
  await secondPolicy.reconcileProviderNamespace(db, digest);
  await assert.rejects(secondCore.verifySession(issued.token), denied,
    "a fresh reconciliation digest does not adopt sessions bound to the prior process digest");
  const secondSession = await secondCore.issueSession(control);
  assert.deepEqual((await secondCore.verifySession(secondSession.token)).owner, secondSession.owner);

  const record = externalAuthority.records.get(authorityKey({
    deploymentEnvironment: TEST_ENVIRONMENT,
    provider: "google",
    credentialNamespaceDigest: digest,
  })) as GoogleNamespaceAuthoritySnapshot;
  externalAuthority.replace(digest, {
    ...record,
    monotonicGeneration: 2,
    status: "DISABLED",
    lastControlOperationId: "shared-retirement",
    lastControlAction: "RETIRE",
  });
  await assert.rejects(secondCore.verifySession(issued.token), denied);
  await assert.rejects(secondCore.verifySession(secondSession.token), denied);
});

test("co-restored authority snapshot under an unadmitted incarnation remains denied", async () => {
  const { db, capability, core, originPolicy, externalAuthority, newOriginPolicy,
    newCore, seedPolicy, reconcilePolicy } = harness();
  const digest = seedPolicy(googleA);
  await reconcilePolicy(googleA);
  const control = capability.trustedIssuer.issue({ ...googleA, providerSubject: "co-restored-user" });
  const issued = await core.issueSession(control);
  const restoredDatabase = clone(db.data);
  await retireGoogleProviderNamespace(db, digest, originPolicy);
  db.data = restoredDatabase;
  const old = externalAuthority.records.get(authorityKey({
    deploymentEnvironment: TEST_ENVIRONMENT,
    provider: "google",
    credentialNamespaceDigest: digest,
  })) as GoogleNamespaceAuthoritySnapshot;
  externalAuthority.replace(digest, {
    ...old,
    monotonicGeneration: 1,
    status: "ENABLED",
    admittedIncarnation: "unadmitted-restored-incarnation",
    lastControlOperationId: "restored-before-retirement",
    lastControlAction: "ENABLE",
  });
  const restoredPolicy = newOriginPolicy();
  const restoredCore = newCore(restoredPolicy);
  await assert.rejects(restoredPolicy.reconcileProviderNamespace(db, digest), denied);
  await assert.rejects(restoredCore.issueSession(control), denied);
  await assert.rejects(restoredCore.verifySession(issued.token), denied);
});
