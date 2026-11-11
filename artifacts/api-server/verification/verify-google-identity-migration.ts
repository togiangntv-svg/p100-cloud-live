import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyGoogleA1Migration,
  GOOGLE_A1_MIGRATION_ID,
  GoogleA1MigrationError,
  loadGoogleA1MigrationSource,
} from "../../../lib/db/scripts/google-a1-migration.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const migrations = resolve(root, "lib/db/migrations");
const runnerPath = resolve(root, "lib/db/scripts/google-a1-migration.mjs");
const migrationPath = suffix => resolve(migrations, `${GOOGLE_A1_MIGRATION_ID}.${suffix}`);
const sha256 = value => createHash("sha256").update(value).digest("hex");
const EXPECTED_UP_SHA256 = "7268a1d3a54477318f289deae81d08ed6247a0750b949dd74c65759776c32773";

type FakeState = {
  schemaApplied: boolean;
  recordChecksum: string | null;
  collision: boolean;
  unknownCommitOnce: boolean;
  semanticDrift: null | "CHECK_TRUE" | "MISSING_NONCE_CHECK" | "INDEX_TRIGGER_FUNCTION"
    | "MISSING_LEGACY_BINDING_FK" | "MISSING_LEGACY_BINDING_ORIGIN_CHECK";
};

class FakeMigrationPool {
  state: FakeState = {
    schemaApplied: false,
    recordChecksum: null,
    collision: false,
    unknownCommitOnce: false,
    semanticDrift: null,
  };
  readonly queries: Array<{ sql: string; values: unknown[] }> = [];
  connects = 0;

  async connect() {
    this.connects++;
    let snapshot: FakeState | undefined;
    return {
      query: async (sql: string, values: unknown[] = []) => {
        this.queries.push({ sql, values });
        if (sql.startsWith("BEGIN")) {
          snapshot = { ...this.state };
          return { rows: [] };
        }
        if (sql === "ROLLBACK") {
          if (snapshot) this.state = snapshot;
          snapshot = undefined;
          return { rows: [] };
        }
        if (sql === "COMMIT") {
          snapshot = undefined;
          if (this.state.unknownCommitOnce) {
            this.state.unknownCommitOnce = false;
            throw new Error("simulated unknown commit result");
          }
          return { rows: [] };
        }
        if (sql.startsWith("SET LOCAL") || sql.includes("identity197:migration-lock")) {
          return { rows: [] };
        }
        if (sql.includes("identity197:migration-table")) {
          return { rows: [{ migration_table: this.state.schemaApplied
            ? "identity_v1.schema_migrations" : null }] };
        }
        if (sql.includes("identity197:migration-record")) {
          return { rows: this.state.recordChecksum === null
            ? [] : [{ checksum: this.state.recordChecksum }] };
        }
        if (sql.includes("identity197:migration-collision")) {
          return { rows: [{
            policies: this.state.collision ? "identity_v1.provider_session_policies" : null,
            challenges: null,
            windows: null,
            session_origin: false,
            policy_trigger: false,
          }] };
        }
        if (sql.includes("CREATE TABLE identity_v1.schema_migrations")) {
          this.state.schemaApplied = true;
          return { rows: [] };
        }
        if (sql.includes("identity197:migration-insert")) {
          this.state.recordChecksum = String(values[1]);
          return { rows: [{ migration_id: values[0], checksum: values[1] }] };
        }
        if (sql.includes("DO $verify$")) {
          if (!this.state.schemaApplied || this.state.recordChecksum === null) {
            throw new Error("schema verification failed");
          }
          if (this.state.semanticDrift !== null) {
            throw new Error(`semantic catalog drift: ${this.state.semanticDrift}`);
          }
          return { rows: [{ migration_id: GOOGLE_A1_MIGRATION_ID, verified: true }] };
        }
        throw new Error(`unexpected fake migration query: ${sql.slice(0, 80)}`);
      },
      release: (_destroy?: boolean) => undefined,
    };
  }
}

const migrationError = code => (error: unknown) =>
  error instanceof GoogleA1MigrationError && error.code === code;

test("manifest checksum matches canonical UTF-8/LF up migration content", () => {
  const manifest = JSON.parse(readFileSync(migrationPath("manifest.json"), "utf8"));
  const up = readFileSync(migrationPath("up.sql"));
  assert.equal(manifest.migrationId, GOOGLE_A1_MIGRATION_ID);
  assert.equal(manifest.checksumEncoding, "utf8-lf");
  assert.equal(manifest.upSha256, EXPECTED_UP_SHA256);
  assert.equal(manifest.upSha256, sha256(Buffer.from(
    up.toString("utf8").replace(/\r\n/g, "\n"),
    "utf8",
  )));
  assert.equal(loadGoogleA1MigrationSource(migrations).checksum, manifest.upSha256);
});

test("up migration is additive and contains the complete scoped foundation", () => {
  const up = readFileSync(migrationPath("up.sql"), "utf8");
  assert.doesNotMatch(up.replace(/\bON\s+DELETE\s+RESTRICT\b/gi, ""), /\b(?:DROP|TRUNCATE|DELETE)\b/i);
  for (const marker of [
    "provider_session_policies",
    "google_sign_in_challenges",
    "google_challenge_issuance_windows",
    "issuer_provider",
    "issuer_namespace_digest",
    "issuer_epoch",
    "issuer_reconciliation_digest",
    "legacy_control_binding_id",
    "identity_sessions_legacy_control_binding_fk",
    "identity_sessions_legacy_control_binding_origin",
    "reconciliation_digest",
    "provider_session_policies_monotonic",
    "schema_migrations",
  ]) assert.ok(up.includes(marker), marker);
});

test("verification reads exact catalog semantics instead of object names only", () => {
  const verify = readFileSync(migrationPath("verify.sql"), "utf8");
  for (const marker of [
    "pg_get_constraintdef",
    "convalidated",
    "google_sign_in_nonce_digest_hex",
    "identity_sessions_origin_all_or_none",
    "identity_sessions_legacy_control_binding_fk",
    "identity_sessions_legacy_control_binding_origin",
    "legacy_control_binding_id",
    "verified_control_bindings",
    "confdeltype",
    "pg_index",
    "indkey",
    "indpred",
    "tgfoid",
    "tgtype = 19",
    "procedure_catalog.prosrc",
    "migration record checksum drifted",
  ]) assert.ok(verify.includes(marker), marker);
  assert.doesNotMatch(verify, /conname\s*=\s*ANY/i);
  assert.match(
    verify,
    /identity_sessions_origin_all_or_none[\s\S]*checkissuer_providerisnullandissuer_namespace_digestisnullandissuer_epochisnullandissuer_reconciliation_digestisnullorissuer_providerisnotnullandissuer_namespace_digestisnotnullandissuer_epochisnotnullandissuer_reconciliation_digestisnotnull/,
  );
  assert.match(
    verify,
    /identity_sessions_legacy_control_binding_origin[\s\S]*checklegacy_control_binding_idisnullorissuer_providerisnullandissuer_namespace_digestisnullandissuer_epochisnullandissuer_reconciliation_digestisnull/,
  );
  assert.match(
    verify,
    /google_sign_in_nonce_digest_hex[\s\S]*checknonce_digest~''\^\[0-9a-f\]\{64\}\$''/,
  );
  assert.match(
    verify,
    /identity_sessions_origin_idx[\s\S]*issuer_provider[\s\S]*issuer_namespace_digest[\s\S]*issuer_epoch[\s\S]*issuer_reconciliation_digest/,
  );
  assert.match(verify, /tgfoid\s*=\s*'identity_v1\.enforce_provider_session_policy_monotonic\(\)'::regprocedure/);
  assert.match(verify, /procedure_catalog\.prosrc[\s\S]*provider session policy rollback is not monotonic/);
});

test("local containment is clearly not the F2 external retirement authority", () => {
  const contain = readFileSync(migrationPath("contain.sql"), "utf8");
  assert.match(contain, /LOCAL DB CONTAINMENT ONLY/i);
  assert.match(contain, /does not retire the external Google namespace authority/i);
  assert.match(contain, /provider\s*=\s*'google'/i);
  assert.match(contain, /current_epoch\s*=\s*current_epoch\s*\+\s*1/i);
  assert.match(contain, /issuer_provider\s*=\s*'google'/i);
  assert.match(contain, /invalidated_at/i);
  assert.doesNotMatch(contain, /\b(?:DELETE|DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(contain, /\bowners\b|apple_/i);
});

test("bounded runner applies once then verifies idempotently", async () => {
  const pool = new FakeMigrationPool();
  const first = await applyGoogleA1Migration(pool, { directory: migrations });
  assert.equal(first.status, "APPLIED");
  const second = await applyGoogleA1Migration(pool, { directory: migrations });
  assert.equal(second.status, "ALREADY_APPLIED");
  assert.equal(pool.state.recordChecksum, first.checksum);
  assert.equal(pool.queries.filter(call =>
    call.sql.includes("CREATE TABLE identity_v1.schema_migrations")).length, 1);
});

test("same migration ID with another checksum blocks without mutation", async () => {
  const pool = new FakeMigrationPool();
  pool.state.schemaApplied = true;
  pool.state.recordChecksum = "0".repeat(64);
  await assert.rejects(
    applyGoogleA1Migration(pool, { directory: migrations }),
    migrationError("MIGRATION_CHECKSUM_MISMATCH"),
  );
  assert.equal(pool.queries.some(call => call.sql.includes("CREATE TABLE")), false);
});

for (const [drift, label] of [
  ["CHECK_TRUE", "same-name CHECK(TRUE)"],
  ["MISSING_NONCE_CHECK", "missing nonce digest constraint"],
  ["INDEX_TRIGGER_FUNCTION", "same-name index/trigger/function drift"],
  ["MISSING_LEGACY_BINDING_FK", "missing legacy binding foreign key"],
  ["MISSING_LEGACY_BINDING_ORIGIN_CHECK", "missing legacy binding origin check"],
] as const) {
  test(`${label} cannot return ALREADY_APPLIED with a matching checksum`, async () => {
    const pool = new FakeMigrationPool();
    const source = loadGoogleA1MigrationSource(migrations);
    pool.state.schemaApplied = true;
    pool.state.recordChecksum = source.checksum;
    pool.state.semanticDrift = drift;
    await assert.rejects(
      applyGoogleA1Migration(pool, { directory: migrations }),
      migrationError("MIGRATION_SCHEMA_DRIFT"),
    );
    assert.equal(pool.queries.some(call => call.sql.includes("CREATE TABLE")), false);
  });
}

test("unrecorded schema collision blocks before executing up.sql", async () => {
  const pool = new FakeMigrationPool();
  pool.state.collision = true;
  await assert.rejects(
    applyGoogleA1Migration(pool, { directory: migrations }),
    migrationError("MIGRATION_SCHEMA_COLLISION"),
  );
  assert.equal(pool.state.schemaApplied, false);
  assert.equal(pool.state.recordChecksum, null);
});

test("unknown commit result reconciles readback and never retries the migration", async () => {
  const pool = new FakeMigrationPool();
  pool.state.unknownCommitOnce = true;
  const result = await applyGoogleA1Migration(pool, { directory: migrations });
  assert.equal(result.status, "RECONCILED_AFTER_UNKNOWN_COMMIT");
  assert.equal(pool.connects, 2);
  assert.equal(pool.queries.filter(call =>
    call.sql.includes("CREATE TABLE identity_v1.schema_migrations")).length, 1);
});

test("verification is synthetic and runner ignores generic production DATABASE_URL", () => {
  const runner = readFileSync(runnerPath, "utf8");
  assert.equal(new FakeMigrationPool().connects, 0);
  assert.doesNotMatch(runner, /process\.env\.DATABASE_URL/);
  assert.match(runner, /P100_A1_GOOGLE_MIGRATION_DATABASE_URL/);
  assert.match(runner, /I_ACKNOWLEDGE_NON_PRODUCTION_ONLY/);
});
