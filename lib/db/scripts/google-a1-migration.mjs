import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GOOGLE_A1_MIGRATION_ID = "P100_A1_GOOGLE_001";
const FILES = Object.freeze({
  up: `${GOOGLE_A1_MIGRATION_ID}.up.sql`,
  verify: `${GOOGLE_A1_MIGRATION_ID}.verify.sql`,
  contain: `${GOOGLE_A1_MIGRATION_ID}.contain.sql`,
  manifest: `${GOOGLE_A1_MIGRATION_ID}.manifest.json`,
});
const ADVISORY_LOCK_KEY = "197001";

export class GoogleA1MigrationError extends Error {
  constructor(code) {
    super(code);
    this.name = "GoogleA1MigrationError";
    this.code = code;
  }
}

const block = code => {
  throw new GoogleA1MigrationError(code);
};
const sha256 = value => createHash("sha256").update(value).digest("hex");
const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

export function loadGoogleA1MigrationSource(directory = migrationsDirectory) {
  let manifest;
  let upBuffer;
  let verifySql;
  let containSql;
  try {
    manifest = JSON.parse(readFileSync(resolve(directory, FILES.manifest), "utf8"));
    upBuffer = readFileSync(resolve(directory, FILES.up));
    verifySql = readFileSync(resolve(directory, FILES.verify), "utf8");
    containSql = readFileSync(resolve(directory, FILES.contain), "utf8");
  } catch {
    return block("MIGRATION_SOURCE_UNAVAILABLE");
  }
  const exactFiles = manifest?.files;
  if (manifest?.migrationId !== GOOGLE_A1_MIGRATION_ID
    || exactFiles?.up !== FILES.up
    || exactFiles?.verify !== FILES.verify
    || exactFiles?.contain !== FILES.contain
    || typeof manifest?.upSha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(manifest.upSha256)) {
    return block("MIGRATION_MANIFEST_INVALID");
  }
  if (manifest.checksumEncoding !== "utf8-lf") {
    return block("MIGRATION_MANIFEST_INVALID");
  }
  const upSql = upBuffer.toString("utf8").replace(/\r\n/g, "\n");
  const actualChecksum = sha256(Buffer.from(upSql, "utf8"));
  if (actualChecksum !== manifest.upSha256) return block("MIGRATION_CHECKSUM_MISMATCH");
  const unsafeUpSql = upSql.replace(/\bON\s+DELETE\s+RESTRICT\b/gi, "");
  if (/\b(?:DROP|TRUNCATE|DELETE)\b/i.test(unsafeUpSql)
    || !upSql.includes("identity_v1.provider_session_policies")
    || !upSql.includes("issuer_namespace_digest")) {
    return block("MIGRATION_SOURCE_INVALID");
  }
  return Object.freeze({
    migrationId: GOOGLE_A1_MIGRATION_ID,
    checksum: actualChecksum,
    upSql,
    verifySql,
    containSql,
    directory,
  });
}

async function readMigrationRecord(client, migrationId) {
  const table = await client.query(
    "/* identity197:migration-table */ SELECT to_regclass('identity_v1.schema_migrations')::text AS migration_table",
  );
  if (table.rows.length !== 1) return block("MIGRATION_PRECONDITION_UNAVAILABLE");
  if (table.rows[0].migration_table === null) {
    return Object.freeze({ tableExists: false, checksum: null });
  }
  if (table.rows[0].migration_table !== "identity_v1.schema_migrations") {
    return block("MIGRATION_SCHEMA_DRIFT");
  }
  const record = await client.query(
    "/* identity197:migration-record */ SELECT checksum FROM identity_v1.schema_migrations WHERE migration_id=$1",
    [migrationId],
  );
  if (record.rows.length > 1) return block("MIGRATION_SCHEMA_DRIFT");
  const checksum = record.rows[0]?.checksum;
  if (record.rows.length === 1 && (typeof checksum !== "string" || !/^[0-9a-f]{64}$/.test(checksum))) {
    return block("MIGRATION_SCHEMA_DRIFT");
  }
  return Object.freeze({ tableExists: true, checksum: checksum ?? null });
}

async function assertNoSchemaCollision(client, migrationTableExists) {
  const result = await client.query(
    `/* identity197:migration-collision */ SELECT
      to_regclass('identity_v1.provider_session_policies')::text AS policies,
      to_regclass('identity_v1.google_sign_in_challenges')::text AS challenges,
      to_regclass('identity_v1.google_challenge_issuance_windows')::text AS windows,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='identity_v1' AND table_name='sessions'
          AND column_name IN ('issuer_provider','issuer_namespace_digest','issuer_epoch')
      ) AS session_origin,
      EXISTS (
        SELECT 1 FROM pg_trigger trigger
        JOIN pg_class relation ON relation.oid=trigger.tgrelid
        JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
        WHERE namespace.nspname='identity_v1'
          AND trigger.tgname='provider_session_policies_monotonic'
          AND NOT trigger.tgisinternal
      ) AS policy_trigger`,
  );
  if (result.rows.length !== 1) return block("MIGRATION_PRECONDITION_UNAVAILABLE");
  const row = result.rows[0];
  if (migrationTableExists
    || row.policies !== null
    || row.challenges !== null
    || row.windows !== null
    || row.session_origin === true
    || row.policy_trigger === true) {
    return block("MIGRATION_SCHEMA_COLLISION");
  }
}

async function verifyAppliedSchema(client, source) {
  try {
    await client.query(source.verifySql);
  } catch {
    return block("MIGRATION_SCHEMA_DRIFT");
  }
}

async function reconcileUnknownCommit(pool, source) {
  let client;
  try {
    client = await pool.connect();
    const record = await readMigrationRecord(client, source.migrationId);
    if (!record.tableExists || record.checksum !== source.checksum) {
      return block("MIGRATION_COMMIT_UNKNOWN");
    }
    await verifyAppliedSchema(client, source);
    return Object.freeze({ status: "RECONCILED_AFTER_UNKNOWN_COMMIT", ...source });
  } catch (error) {
    if (error instanceof GoogleA1MigrationError) throw error;
    return block("MIGRATION_COMMIT_UNKNOWN");
  } finally {
    client?.release(true);
  }
}

export async function applyGoogleA1Migration(pool, options = {}) {
  const source = loadGoogleA1MigrationSource(options.directory);
  let client;
  let destroy = false;
  let transactionOpen = false;
  let outcome;
  let commitUnknown = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query(
      "/* identity197:migration-lock */ SELECT pg_advisory_xact_lock($1::bigint)",
      [ADVISORY_LOCK_KEY],
    );
    const record = await readMigrationRecord(client, source.migrationId);
    if (record.checksum !== null) {
      if (record.checksum !== source.checksum) return block("MIGRATION_CHECKSUM_MISMATCH");
      await verifyAppliedSchema(client, source);
      outcome = Object.freeze({ status: "ALREADY_APPLIED", ...source });
    } else {
      await assertNoSchemaCollision(client, record.tableExists);
      await client.query(source.upSql);
      const inserted = await client.query(
        "/* identity197:migration-insert */ INSERT INTO identity_v1.schema_migrations "
        + "(migration_id,checksum,applied_at) VALUES ($1,$2,transaction_timestamp()) "
        + "RETURNING migration_id,checksum",
        [source.migrationId, source.checksum],
      );
      if (inserted.rows.length !== 1
        || inserted.rows[0].migration_id !== source.migrationId
        || inserted.rows[0].checksum !== source.checksum) {
        return block("MIGRATION_RECORD_INVALID");
      }
      await verifyAppliedSchema(client, source);
      outcome = Object.freeze({ status: "APPLIED", ...source });
    }
    try {
      await client.query("COMMIT");
      transactionOpen = false;
    } catch {
      commitUnknown = true;
      transactionOpen = false;
      destroy = true;
    }
  } catch (error) {
    if (transactionOpen) {
      try { await client?.query("ROLLBACK"); } catch { destroy = true; }
    }
    if (error instanceof GoogleA1MigrationError) throw error;
    return block("MIGRATION_BLOCKED");
  } finally {
    client?.release(destroy);
  }
  if (commitUnknown) return reconcileUnknownCommit(pool, source);
  return outcome;
}

async function runCli() {
  const command = process.argv[2];
  if (command === "--verify-source") {
    const source = loadGoogleA1MigrationSource();
    process.stdout.write(`${source.migrationId} ${source.checksum} SOURCE_VERIFIED\n`);
    return;
  }
  if (command !== "--apply") return block("MIGRATION_COMMAND_REQUIRED");
  if (process.env.P100_A1_GOOGLE_ALLOW_APPLY !== "I_ACKNOWLEDGE_NON_PRODUCTION_ONLY") {
    return block("MIGRATION_NON_PRODUCTION_ACK_REQUIRED");
  }
  const rawUrl = process.env.P100_A1_GOOGLE_MIGRATION_DATABASE_URL;
  const expectedDatabase = process.env.P100_A1_GOOGLE_EXPECTED_DATABASE;
  if (!rawUrl || !expectedDatabase) return block("MIGRATION_DATABASE_CONFIGURATION_REQUIRED");
  let databaseName;
  try {
    databaseName = decodeURIComponent(new URL(rawUrl).pathname.replace(/^\//, ""));
  } catch {
    return block("MIGRATION_DATABASE_CONFIGURATION_INVALID");
  }
  if (!databaseName || databaseName !== expectedDatabase) {
    return block("MIGRATION_DATABASE_IDENTITY_MISMATCH");
  }
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: rawUrl, max: 1 });
  try {
    const result = await applyGoogleA1Migration(pool);
    process.stdout.write(`${result.status} ${result.migrationId} ${result.checksum}\n`);
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase();
if (isMain) {
  runCli().catch(error => {
    const code = error instanceof GoogleA1MigrationError ? error.code : "MIGRATION_BLOCKED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
