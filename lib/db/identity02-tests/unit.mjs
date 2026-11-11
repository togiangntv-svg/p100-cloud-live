import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createInternalControlAuthority, createPostgresIdentityRegistry, RegistryError, TABLES } from "../src/identity02/registry.ts";
import { environmentGuard, databaseGuard, publicSnapshot, assertPublicUnchanged, SCHEMA, REPL } from "./guard.mjs";
const subjectId = "10000000-0000-4000-8000-000000000001";
const profileId = "10000000-0000-4000-8000-000000000002";
const controlRef = "20000000-0000-4000-8000-000000000001";
const pair = { subjectId, profileId };
const key = "identity02:unit_request_01";
const stamp = new Date("2026-09-14T00:00:00Z");
const row = { subject_id: subjectId, profile_id: profileId, receipt_version: 1, created_at: stamp };
const errorIs = code => e => e instanceof RegistryError && e.code === code;
function fixture(handler) {
  const calls = [], releases = [];
  const authority = createInternalControlAuthority();
  const context = authority.issueForVerifiedControl(controlRef);
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (handler) { const result = await handler(sql, values); if (result !== undefined) return result; }
      if (sql.startsWith("INSERT INTO " + TABLES.subjects)) return { rows: [{ subject_id: subjectId }] };
      if (sql.startsWith("SELECT subject_id")) return { rows: [row] };
      if (sql.startsWith("SELECT s.subject_id")) return { rows: [row] };
      return { rows: [] };
    },
    release(value) { releases.push(value); },
  };
  let ids = 0, connects = 0;
  const pool = { async connect() { connects++; return client; } };
  const registry = createPostgresIdentityRegistry(pool, authority, { schema: SCHEMA, newId: () => ++ids % 2 ? subjectId : profileId });
  return { registry, authority, context, calls, releases, connects: () => connects };
}
test("internal context is nonserializable authority and cannot be forged/reused across issuers", () => {
  const a = createInternalControlAuthority(), b = createInternalControlAuthority();
  const context = a.issueForVerifiedControl(controlRef);
  assert.equal(a.resolve(context), controlRef);
  for (const candidate of [null, undefined, {}, JSON.parse(JSON.stringify(context)), { subjectId }, { deviceId: controlRef }])
    assert.throws(() => a.resolve(candidate), errorIs("CONTEXT_REQUIRED"));
  assert.throws(() => b.resolve(context), errorIs("CONTEXT_REQUIRED"));
});
test("invalid context prevents every registry operation before pool access", async () => {
  const f = fixture();
  for (const action of [
    () => f.registry.createInitialSubjectProfile({}, { idempotencyKey: key }),
    () => f.registry.readCreationReceipt({}, pair, key),
    () => f.registry.readProfile({}, pair),
    () => f.registry.readConfirmedGoalState({}, pair),
    () => f.registry.updateProfileStatus({}, pair, "ACTIVE", 1),
    () => f.registry.recordConfirmedGoalState({}, pair, "NONE", 1),
  ]) await assert.rejects(action, errorIs("CONTEXT_REQUIRED"));
  assert.equal(f.connects(), 0);
});
test("adapter refuses public, absent, injected and alternate schema", () => {
  for (const schema of ["public", undefined, "", "identity02_test_v02", 'identity02_test_v01";DROP TABLE public.x;--'])
    assert.throws(() => createPostgresIdentityRegistry({}, createInternalControlAuthority(), { schema }), errorIs("TEST_SCHEMA_REQUIRED"));
});
test("malformed identifiers and request key fail before SQL", async () => {
  const f = fixture();
  for (const idempotencyKey of ["short", "x".repeat(129), "identity02:';DROP"])
    await assert.rejects(f.registry.createInitialSubjectProfile(f.context, { idempotencyKey }), errorIs("INVALID_REQUEST"));
  await assert.rejects(f.registry.readProfile(f.context, { ...pair, subjectId: "device-identifier" }), errorIs("INVALID_REQUEST"));
  assert.equal(f.connects(), 0);
});
test("first receipt stays withheld until COMMIT ack; same client contains all writes", async () => {
  let ack, enteredCommit;
  const entered = new Promise(resolve => { enteredCommit = resolve; });
  const f = fixture(sql => {
    if (sql === "COMMIT") { enteredCommit(); return new Promise(resolve => { ack = () => resolve({ rows: [] }); }); }
  });
  let delivered = false;
  const work = f.registry.createInitialSubjectProfile(f.context, { idempotencyKey: key }).then(r => { delivered = true; return r; });
  await entered;
  assert.equal(delivered, false);
  assert.equal(f.connects(), 1);
  ack();
  const result = await work;
  assert.equal(result.commitStatus, "COMMITTED");
  assert.equal(result.scope, "INITIAL_CREATION_ONLY");
  assert.equal(result.confirmedGoalState, "NONE");
  assert.equal(result.registryRevision, 1);
  assert.equal(f.calls[0].sql, "BEGIN ISOLATION LEVEL READ COMMITTED");
  assert.equal(f.calls.at(-1).sql, "COMMIT");
  const insert = f.calls.find(c => c.sql.startsWith("INSERT INTO " + TABLES.creations));
  assert.match(insert.values[0], /^[a-f0-9]{64}$/);
  assert.equal(f.calls.some(c => c.sql.includes(key)), false);
  assert.deepEqual(f.releases, [false]);
});
test("transaction failure rolls back and suppresses partial receipt and driver secrets", async () => {
  const f = fixture(sql => { if (sql.startsWith("INSERT INTO " + TABLES.goals)) throw new Error("postgres://SECRET"); });
  await assert.rejects(f.registry.createInitialSubjectProfile(f.context, { idempotencyKey: key }),
    e => e.code === "REGISTRY_UNAVAILABLE" && !String(e).includes("SECRET"));
  assert.equal(f.calls.at(-1).sql, "ROLLBACK");
  assert.equal(f.calls.some(c => c.sql === "COMMIT"), false);
  assert.deepEqual(f.releases, [true]);
});
test("unknown COMMIT outcome never returns receipt and destroys ambiguous connection", async () => {
  const f = fixture(sql => { if (sql === "COMMIT") throw new Error("lost acknowledgement"); });
  await assert.rejects(f.registry.createInitialSubjectProfile(f.context, { idempotencyKey: key }), errorIs("COMMIT_OUTCOME_UNKNOWN"));
  assert.equal(f.calls.at(-1).sql, "ROLLBACK");
  assert.deepEqual(f.releases, [true]);
});
test("failed rollback also destroys the connection", async () => {
  const f = fixture(sql => {
    if (sql.startsWith("INSERT INTO " + TABLES.goals) || sql === "ROLLBACK") throw new Error("fault");
  });
  await assert.rejects(f.registry.createInitialSubjectProfile(f.context, { idempotencyKey: key }), errorIs("REGISTRY_UNAVAILABLE"));
  assert.deepEqual(f.releases, [true]);
});
test("existing control skips new profile and goal creation", async () => {
  const f = fixture(sql => { if (sql.startsWith("INSERT INTO " + TABLES.subjects)) return { rows: [] }; });
  await f.registry.createInitialSubjectProfile(f.context, { idempotencyKey: key });
  assert.equal(f.calls.some(c => c.sql.startsWith("INSERT INTO " + TABLES.profiles)), false);
  assert.equal(f.calls.some(c => c.sql.startsWith("INSERT INTO " + TABLES.goals)), false);
});
test("wrong owner key lookup fails closed and rolls back", async () => {
  const f = fixture(sql => { if (sql.startsWith("SELECT s.subject_id")) return { rows: [] }; });
  await assert.rejects(f.registry.createInitialSubjectProfile(f.context, { idempotencyKey: key }), errorIs("NOT_FOUND_OR_DENIED"));
  assert.equal(f.calls.at(-1).sql, "ROLLBACK");
});
test("profile and receipt reads send both IDs and trusted control predicate", async () => {
  const f = fixture(sql => sql.startsWith("SELECT p.*") ? { rows: [{ ...row, status: "ACTIVE", revision: 1 }] } : undefined);
  await f.registry.readProfile(f.context, pair);
  await f.registry.readCreationReceipt(f.context, pair, key);
  assert.deepEqual(f.calls[0].values, [controlRef, subjectId, profileId]);
  assert.deepEqual(f.calls[1].values.slice(2), [subjectId, profileId]);
  for (const c of f.calls) assert.match(c.sql, /s\.control_ref/);
});
test("empty unauthorized reads reveal no payload", async () => {
  const f = fixture(() => ({ rows: [] }));
  await assert.rejects(f.registry.readProfile(f.context, pair), errorIs("NOT_FOUND_OR_DENIED"));
  await assert.rejects(f.registry.readConfirmedGoalState(f.context, pair), errorIs("NOT_FOUND_OR_DENIED"));
  await assert.rejects(f.registry.readCreationReceipt(f.context, pair, key), errorIs("NOT_FOUND_OR_DENIED"));
});
for (const missing of [
  { state: null, revision: null, updated_at: null },
  { state: undefined, revision: 1, updated_at: stamp },
  { state: "DRAFT", revision: 1, updated_at: stamp },
  { state: "NONE", revision: null, updated_at: stamp },
  { state: "CONFIRMED", revision: 0, updated_at: stamp },
  { state: "NONE", revision: 1, updated_at: null },
]) test("incomplete goal authority becomes UNKNOWN: " + JSON.stringify(missing), async () => {
  const f = fixture(() => ({ rows: [{ profile_id: profileId, ...missing }] }));
  assert.deepEqual(await f.registry.readConfirmedGoalState(f.context, pair),
    { profileId, state: "UNKNOWN", revision: null, updatedAt: null });
});
for (const state of ["NONE", "UNKNOWN", "CONFIRMED"])
  test("explicit persisted " + state + " retains its semantics", async () => {
    const f = fixture(() => ({ rows: [{ profile_id: profileId, state, revision: 1, updated_at: stamp }] }));
    assert.equal((await f.registry.readConfirmedGoalState(f.context, pair)).state, state);
  });
test("DRAFT, null, absent state and invalid revisions cannot mutate", async () => {
  const f = fixture();
  for (const state of ["DRAFT", null, undefined, ""])
    await assert.rejects(f.registry.recordConfirmedGoalState(f.context, pair, state, 1), errorIs("INVALID_GOAL_STATE"));
  for (const revision of [0, -1, 1.5, "1", NaN])
    await assert.rejects(f.registry.recordConfirmedGoalState(f.context, pair, "NONE", revision), errorIs("INVALID_REVISION"));
  assert.equal(f.connects(), 0);
});
test("zero-row profile/goal updates fail closed and roll back", async () => {
  const f = fixture();
  await assert.rejects(f.registry.updateProfileStatus(f.context, pair, "INACTIVE", 1), errorIs("NOT_FOUND_DENIED_OR_STALE"));
  await assert.rejects(f.registry.recordConfirmedGoalState(f.context, pair, "CONFIRMED", 1), errorIs("NOT_FOUND_DENIED_OR_STALE"));
  for (const call of f.calls.filter(c => c.sql.startsWith("UPDATE"))) {
    assert.match(call.sql, /s\.control_ref=\$1/);
    assert.match(call.sql, /p\.subject_id=\$2 AND p\.profile_id=\$3/);
    assert.deepEqual(call.values.slice(0,3), [controlRef, subjectId, profileId]);
  }
  assert.equal(f.calls.filter(c => c.sql === "ROLLBACK").length, 2);
});
const env = { NODE_ENV: "test", REPL_ID: REPL, REPLIT_DEV_DOMAIN: "development.invalid", DATABASE_URL: "not-a-real-secret" };
const args = ["--schema=" + SCHEMA, "--development-test-only"];
test("environment guard admits only explicit Replit development target", () => assert.equal(environmentGuard(env, args), SCHEMA));
for (const [field, value] of [["NODE_ENV","production"],["REPL_ID","other"],["REPLIT_DEV_DOMAIN",""],["DATABASE_URL",""],["REPLIT_DEPLOYMENT","1"]])
  test("environment guard rejects unsafe " + field, () => assert.throws(() => environmentGuard({ ...env, [field]: value }, args)));
test("guard rejects missing/alternate/public/duplicate schema before DB connection", () => {
  for (const bad of [[], ["--schema=public","--development-test-only"], ["--schema="+SCHEMA], [...args,"--schema="+SCHEMA]])
    assert.throws(() => environmentGuard(env, bad));
});
const good = { database: "heliumdb", version: "160010", recovery: false, active_event_triggers: 0, target_oid: "40000", public_oid: "2200", usage: true, create_permission: true };
for (const [field, value] of [["database","other"],["version","150010"],["recovery",true],["target_oid",null],["target_oid","2200"],["public_oid",null],["usage",false],["create_permission",false]])
  test("DB guard refuses unverified " + field + "=" + value, async () => {
    await assert.rejects(databaseGuard({ query: async () => ({ rows: [{ ...good, [field]: value }] }) }));
  });
test("DB guard refuses nonempty test schema", async () => {
  let n = 0;
  await assert.rejects(databaseGuard({ query: async () => ({ rows: ++n === 1 ? [good] : [{ name:"existing" }] }) }),
    e => e.code === "TEST_SCHEMA_NOT_EMPTY");
});
test("public guard detects changed objects and identity objects outside schema", async () => {
  function catalog(outside = false, changed = false) {
    return { query: async sql => ({
      rows: sql.startsWith("SELECT oid::text") ? [{ nspname:"public", oid:changed ? "changed" : "2200" }] :
        sql.startsWith("SELECT n.nspname AS schema") && outside ? [{ schema:"public", name:"identity02_unexpected" }] : [],
    }) };
  }
  const before = await publicSnapshot(catalog());
  await assertPublicUnchanged(catalog(), before);
  await assert.rejects(assertPublicUnchanged(catalog(false,true), before), e => e.code === "PUBLIC_METADATA_CHANGED_STOP");
  await assert.rejects(assertPublicUnchanged(catalog(true), before), e => e.code === "IDENTITY_OBJECT_OUTSIDE_TEST_SCHEMA_STOP");
});
test("DDL names every table/ref in allowed schema and has no schema creation/cleanup/default NONE", () => {
  const ddl = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  for (const match of ddl.matchAll(/\b(?:CREATE TABLE|ALTER TABLE|REFERENCES)\s+([^\s(]+)/g))
    assert.match(match[1], /^identity02_test_v01\.identity02_/);
  assert.equal(/DROP|TRUNCATE|CREATE SCHEMA|search_path|\bpublic\b|DEFAULT\s+'NONE'/i.test(ddl), false);
  assert.match(ddl, /DEFERRABLE INITIALLY DEFERRED/);
});
