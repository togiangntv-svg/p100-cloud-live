import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createInternalControlAuthority, createPostgresIdentityRegistry, TABLES, RegistryError } from "../src/identity02/registry.ts";
import { environmentGuard, databaseGuard, publicSnapshot, assertPublicUnchanged, SCHEMA } from "./guard.mjs";

const results = [];
let pool, guardClient, beforePublic, afterPublic;
const options = process.argv.slice(2);
const requirePg = () => {
  const matches = options.filter(a => a.startsWith("--pg-package-json="));
  if (matches.length > 1) throw new Error("ONE_PG_PACKAGE_PATH_REQUIRED");
  const anchor = matches.length ? matches[0].slice("--pg-package-json=".length) : fileURLToPath(new URL("../package.json", import.meta.url));
  return createRequire(anchor)("pg");
};
const uid = n => "10000000-0000-4000-8000-" + n.toString(16).padStart(12, "0");
const control = n => "20000000-0000-4000-8000-" + n.toString(16).padStart(12, "0");
const authority = createInternalControlAuthority();
const ctx = n => authority.issueForVerifiedControl(control(n));
let nextId = 1;
const registry = targetPool => createPostgresIdentityRegistry(targetPool, authority, { schema: SCHEMA, newId: () => uid(nextId++) });
async function check(name, action) {
  await action();
  afterPublic = await assertPublicUnchanged(guardClient, beforePublic);
  results.push({ name, status: "PASS" });
}
async function counts() {
  const c = await pool.connect();
  try {
    const { rows } = await c.query("SELECT " + Object.values(TABLES).map((t, i) => "(SELECT pg_catalog.count(*)::int FROM " + t + ") AS n" + i).join(","));
    return rows[0];
  } finally { c.release(); }
}
async function deny(action) {
  await assert.rejects(action, e => e instanceof RegistryError &&
    ["NOT_FOUND_OR_DENIED","NOT_FOUND_DENIED_OR_STALE","CONTEXT_REQUIRED","INVALID_REQUEST"].includes(e.code));
}
async function rejectedSql(sql, params, expectedCode) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await assert.rejects(async () => { await c.query(sql, params); await c.query("COMMIT"); }, e => e.code === expectedCode);
  } finally { try { await c.query("ROLLBACK"); } finally { c.release(); } }
}
function faultPool(mode) {
  let fired = false;
  return { async connect() {
    const c = await pool.connect();
    return {
      async query(sql, values) {
        if (!fired && mode === "during" && sql.startsWith("INSERT INTO " + TABLES.goals)) {
          fired = true;
          return c.query("SELECT 1/0");
        }
        if (!fired && sql === "COMMIT" && (mode === "before" || mode === "lost")) {
          fired = true;
          if (mode === "lost") await c.query(sql);
          throw new Error("SIMULATED_ACK_OR_PRECOMMIT_FAILURE");
        }
        return c.query(sql, values);
      },
      release(destroy) { c.release(destroy); },
    };
  }};
}
try {
  environmentGuard(process.env, options); // before importing pg or opening a connection
  const { Pool } = requirePg();
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8, connectionTimeoutMillis: 10000,
    query_timeout: 15000, application_name: "identity02_test_v01_validation" });
  pool.on("error", () => {}); // error output must never contain connection details
  guardClient = await pool.connect();
  const guard = await databaseGuard(guardClient);
  beforePublic = await publicSnapshot(guardClient);
  await assertPublicUnchanged(guardClient, beforePublic);
  await check("01 schema-qualified DDL, PK/FK/unique catalog", async () => {
    await guardClient.query("BEGIN");
    try { await guardClient.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8")); await guardClient.query("COMMIT"); }
    catch (e) { await guardClient.query("ROLLBACK"); throw e; }
    const { rows } = await guardClient.query(
      "SELECT c.relname,k.contype,k.condeferrable,k.condeferred FROM pg_catalog.pg_constraint k " +
      "JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1", [SCHEMA]);
    assert.equal(rows.filter(r => r.contype === "p").length, 4);
    assert.equal(rows.filter(r => r.contype === "f").length, 4);
    assert(rows.filter(r => r.contype === "u").length >= 4);
    assert(rows.some(r => r.condeferrable && r.condeferred));
  });
  const r = registry(pool);
  let a, b;
  const keyA = "identity02:first_request_A";
  const keyB = "identity02:first_request_B";
  await check("02 first atomic creation and explicit NONE", async () => {
    a = await r.createInitialSubjectProfile(ctx(1), { idempotencyKey: keyA });
    assert.equal(a.commitStatus, "COMMITTED");
    assert.equal(a.scope, "INITIAL_CREATION_ONLY");
    assert.equal(a.confirmedGoalState, "NONE");
    assert.notEqual(a.subjectId, a.profileId);
    assert.deepEqual(await counts(), { n0: 1, n1: 1, n2: 1, n3: 1 });
    assert.equal((await r.readProfile(ctx(1), a)).revision, 1);
    assert.equal((await r.readConfirmedGoalState(ctx(1), a)).state, "NONE");
  });
  await check("03 idempotent same-request retry", async () => {
    assert.deepEqual(await r.createInitialSubjectProfile(ctx(1), { idempotencyKey: keyA }), a);
    assert.deepEqual(await counts(), { n0: 1, n1: 1, n2: 1, n3: 1 });
  });
  await check("04 concurrent same-key duplicate request", async () => {
    const answers = await Promise.all(Array.from({ length: 8 }, () =>
      r.createInitialSubjectProfile(ctx(2), { idempotencyKey: keyB })));
    b = answers[0];
    answers.forEach(answer => assert.deepEqual(answer, b));
    assert.deepEqual(await counts(), { n0: 2, n1: 2, n2: 2, n3: 2 });
  });
  await check("05 concurrent different keys same control", async () => {
    const start = await counts();
    const answers = await Promise.all(Array.from({ length: 4 }, (_, i) =>
      r.createInitialSubjectProfile(ctx(2), { idempotencyKey: "identity02:second_key_B_" + i })));
    answers.forEach(answer => assert.deepEqual(answer, b));
    assert.deepEqual(await counts(), { ...start, n3: start.n3 + 4 });
  });
  await check("06 PK, FK, one-profile uniqueness, required profile and goal constraints enforced", async () => {
    const start = await counts();
    await rejectedSql("INSERT INTO " + TABLES.subjects + " SELECT * FROM " + TABLES.subjects + " WHERE subject_id=$1", [a.subjectId], "23505");
    await rejectedSql("INSERT INTO " + TABLES.profiles + " VALUES ($1,$2,'ACTIVE',pg_catalog.now(),1)", [uid(900001), uid(900002)], "23503");
    await rejectedSql("INSERT INTO " + TABLES.profiles + " VALUES ($1,$2,'ACTIVE',pg_catalog.now(),1)", [uid(900003), a.subjectId], "23505");
    await rejectedSql("INSERT INTO " + TABLES.subjects + " VALUES ($1,$2,$3,'ACTIVE',pg_catalog.now(),1)", [uid(900004), control(900004), uid(900005)], "23503");
    await rejectedSql("UPDATE " + TABLES.goals + " SET state=NULL WHERE profile_id=$1", [a.profileId], "23502");
    await rejectedSql("UPDATE " + TABLES.goals + " SET state='DRAFT' WHERE profile_id=$1", [a.profileId], "23514");
    await rejectedSql("UPDATE " + TABLES.creations + " SET profile_id=$1 WHERE subject_id=$2", [b.profileId, a.subjectId], "23503");
    assert.deepEqual(await counts(), start);
  });
  await check("07 intentional failure before COMMIT leaves no partial identity", async () => {
    const start = await counts();
    await assert.rejects(registry(faultPool("before")).createInitialSubjectProfile(ctx(3), { idempotencyKey: "identity02:precommit_fail" }),
      e => e.code === "COMMIT_OUTCOME_UNKNOWN");
    assert.deepEqual(await counts(), start);
  });
  await check("08 failure during transaction rolls back Subject/Profile/goal/request", async () => {
    const start = await counts();
    await assert.rejects(registry(faultPool("during")).createInitialSubjectProfile(ctx(4), { idempotencyKey: "identity02:during_failure" }),
      e => e.code === "REGISTRY_UNAVAILABLE");
    assert.deepEqual(await counts(), start);
  });
  await check("09 lost COMMIT response recovers the committed identity", async () => {
    const key = "identity02:lost_commit_ack";
    const start = await counts();
    await assert.rejects(registry(faultPool("lost")).createInitialSubjectProfile(ctx(5), { idempotencyKey: key }),
      e => e.code === "COMMIT_OUTCOME_UNKNOWN");
    assert.deepEqual(await counts(), Object.fromEntries(Object.entries(start).map(([k, v]) => [k, v + 1])));
    const recovered = await r.createInitialSubjectProfile(ctx(5), { idempotencyKey: key });
    assert.deepEqual(await r.readCreationReceipt(ctx(5), recovered, key), recovered);
    assert.deepEqual(await r.createInitialSubjectProfile(ctx(5), { idempotencyKey: key }), recovered);
    assert.deepEqual(await counts(), Object.fromEntries(Object.entries(start).map(([k, v]) => [k, v + 1])));
  });
  await check("10 A cannot read B profile/goal/receipt or claim B idempotency key", async () => {
    await deny(() => r.readProfile(ctx(1), b));
    await deny(() => r.readConfirmedGoalState(ctx(1), b));
    await deny(() => r.readCreationReceipt(ctx(1), b, keyB));
    await deny(() => r.readCreationReceipt(ctx(1), a, keyB));
    const start = await counts();
    await deny(() => r.createInitialSubjectProfile(ctx(99), { idempotencyKey: keyB }));
    assert.deepEqual(await counts(), start);
  });
  await check("11 A cannot mutate B profile or goal state", async () => {
    const p = await r.readProfile(ctx(2), b), g = await r.readConfirmedGoalState(ctx(2), b);
    await deny(() => r.updateProfileStatus(ctx(1), b, "INACTIVE", p.revision));
    await deny(() => r.recordConfirmedGoalState(ctx(1), b, "CONFIRMED", g.revision));
    assert.deepEqual(await r.readProfile(ctx(2), b), p);
    assert.deepEqual(await r.readConfirmedGoalState(ctx(2), b), g);
  });
  await check("12 wrong/missing subject context and mixed pairing fail closed", async () => {
    for (const pair of [{ subjectId: a.subjectId, profileId: b.profileId }, { subjectId: b.subjectId, profileId: a.profileId }]) {
      await deny(() => r.readProfile(ctx(1), pair));
      await deny(() => r.recordConfirmedGoalState(ctx(1), pair, "CONFIRMED", 1));
      await deny(() => r.readCreationReceipt(ctx(1), pair, keyA));
    }
    for (const wrong of [undefined, {}, { subjectId: a.subjectId }, { deviceId: control(1) }, { installationId: control(1) }]) {
      await deny(() => r.readProfile(wrong, a));
      await deny(() => r.createInitialSubjectProfile(wrong, { idempotencyKey: keyA }));
    }
  });
  await check("13 explicit UNKNOWN differs from NONE and DRAFT is never promoted", async () => {
    assert.equal((await r.recordConfirmedGoalState(ctx(1), a, "UNKNOWN", 1)).state, "UNKNOWN");
    await assert.rejects(r.recordConfirmedGoalState(ctx(1), a, "DRAFT", 2), e => e.code === "INVALID_GOAL_STATE");
    assert.equal((await r.readConfirmedGoalState(ctx(1), a)).state, "UNKNOWN");
    assert.equal((await r.recordConfirmedGoalState(ctx(1), a, "NONE", 2)).state, "NONE");
  });
  await check("14 explicit goal mutation and removal retain Subject/Profile; receipt is historical", async () => {
    assert.equal((await r.recordConfirmedGoalState(ctx(1), a, "CONFIRMED", 3)).state, "CONFIRMED");
    assert.deepEqual(await r.readCreationReceipt(ctx(1), a, keyA), a);
    await deny(() => r.recordConfirmedGoalState(ctx(1), a, "NONE", 3));
    assert.equal((await r.recordConfirmedGoalState(ctx(1), a, "NONE", 4)).state, "NONE");
    assert.equal((await r.readProfile(ctx(1), a)).subjectId, a.subjectId);
    assert.equal((await r.updateProfileStatus(ctx(1), a, "INACTIVE", 1)).revision, 2);
    await deny(() => r.updateProfileStatus(ctx(1), a, "ACTIVE", 1));
    assert.equal((await r.updateProfileStatus(ctx(1), a, "ACTIVE", 2)).revision, 3);
  });
  await check("15 missing goal record yields UNKNOWN, cannot silently become NONE", async () => {
    const missing = await r.createInitialSubjectProfile(ctx(6), { idempotencyKey: "identity02:missing_goalrow" });
    await guardClient.query("DELETE FROM " + TABLES.goals + " WHERE profile_id=$1", [missing.profileId]);
    assert.deepEqual(await r.readConfirmedGoalState(ctx(6), missing),
      { profileId: missing.profileId, state: "UNKNOWN", revision: null, updatedAt: null });
    await deny(() => r.recordConfirmedGoalState(ctx(6), missing, "NONE", 1));
    assert.equal((await r.readProfile(ctx(6), missing)).subjectId, missing.subjectId);
  });
  await check("16 new Node execution/session and new request key resolve existing Subject", async () => {
    const existing = await r.createInitialSubjectProfile(ctx(7), { idempotencyKey: "identity02:session_initial" });
    const start = await counts();
    const child = spawnSync(process.execPath, ["--experimental-strip-types",
      fileURLToPath(new URL("./session-child.mjs", import.meta.url)), ...options],
      { encoding: "utf8", env: process.env, timeout: 30000, windowsHide: true });
    assert.equal(child.status, 0, "CHILD_SESSION_FAILED");
    const answer = JSON.parse(child.stdout);
    assert.equal(answer.subjectId, existing.subjectId);
    assert.equal(answer.profileId, existing.profileId);
    assert.notEqual(answer.pid, process.pid);
    assert.deepEqual(await counts(), { ...start, n3: start.n3 + 1 });
  });
  await check("17 device/install/cache/session data cannot act as registry authority", async () => {
    const freshAuthority = createInternalControlAuthority();
    const freshRegistry = createPostgresIdentityRegistry(pool, freshAuthority, { schema: SCHEMA });
    await deny(() => freshRegistry.readProfile(ctx(1), a)); // capability from another process/issuer is invalid
    const recoveredContext = freshAuthority.issueForVerifiedControl(control(1));
    assert.deepEqual(await freshRegistry.createInitialSubjectProfile(recoveredContext, { idempotencyKey: keyA }), a);
    assert.equal((await freshRegistry.readProfile(recoveredContext, a)).profileId, a.profileId);
    // No local cache/device/installation data is supplied or read.
  });
  await check("18 no orphan Subject/Profile/creation links after failures", async () => {
    const { rows } = await guardClient.query(
      "SELECT pg_catalog.count(*)::int AS broken FROM " + TABLES.subjects + " s FULL JOIN " + TABLES.profiles +
      " p ON p.subject_id=s.subject_id AND p.profile_id=s.profile_id WHERE s.subject_id IS NULL OR p.profile_id IS NULL");
    assert.equal(rows[0].broken, 0);
  });
  console.log(JSON.stringify({ status: "PASS", schema: SCHEMA, guard, results,
    publicBefore: beforePublic, publicAfter: afterPublic, counts: await counts(),
    cleanup: "PENDING_FOUNDER_REVIEW_NO_DROP", productionMigration: "NOT_RUN" }));
} catch (error) {
  if (guardClient && beforePublic) {
    try { afterPublic = await assertPublicUnchanged(guardClient, beforePublic); }
    catch (safety) { error = safety; }
  }
  // Never print driver messages, SQL values, connection strings or raw assertions.
  console.log(JSON.stringify({ status: "FAIL_CLOSED", code: error?.code ?? error?.name ?? "TEST_FAILED",
    completed: results, publicBefore: beforePublic, publicAfter: afterPublic, cleanup: "PENDING_NO_AUTOMATIC_CLEANUP" }));
  process.exitCode = 1;
} finally {
  if (guardClient) guardClient.release();
  if (pool) await pool.end();
}

