import { createHash } from "node:crypto";
export const SCHEMA = "identity02_test_v01";
export const REPL = "ec87068b-9834-4027-8871-941eb6547441";
export class SafetyError extends Error {
  constructor(code) { super(code); this.name = "SafetyError"; this.code = code; }
}
const stop = code => { throw new SafetyError(code); };
export function environmentGuard(env, argv) {
  const targets = argv.filter(a => a.startsWith("--schema="));
  if (targets.length !== 1 || targets[0] !== "--schema=" + SCHEMA) stop("EXACT_TEST_SCHEMA_REQUIRED");
  if (!argv.includes("--development-test-only")) stop("DEVELOPMENT_ACK_REQUIRED");
  if (env.NODE_ENV !== "test" || env.REPL_ID !== REPL || !env.REPLIT_DEV_DOMAIN ||
      (env.REPLIT_DEPLOYMENT && !["0", "false"].includes(env.REPLIT_DEPLOYMENT)))
    stop("VERIFIED_REPLIT_DEVELOPMENT_REQUIRED");
  if (!env.DATABASE_URL) stop("DATABASE_URL_NOT_AVAILABLE");
  return SCHEMA;
}
export async function databaseGuard(client, requireEmpty = true) {
  const { rows } = await client.query(
    "SELECT pg_catalog.current_database() AS database, " +
    "pg_catalog.current_setting('server_version_num') AS version, " +
    "pg_catalog.pg_is_in_recovery() AS recovery, " +
    "(SELECT pg_catalog.count(*)::int FROM pg_catalog.pg_event_trigger WHERE evtenabled <> 'D') AS active_event_triggers, " +
    "t.oid::text AS target_oid, p.oid::text AS public_oid, " +
    "pg_catalog.has_schema_privilege(t.oid,'USAGE') AS usage, " +
    "pg_catalog.has_schema_privilege(t.oid,'CREATE') AS create_permission " +
    "FROM (VALUES (1)) v(x) LEFT JOIN pg_catalog.pg_namespace t ON t.nspname=$1 " +
    "LEFT JOIN pg_catalog.pg_namespace p ON p.nspname='public'", [SCHEMA]);
  const r = rows[0];
  if (rows.length !== 1 || r.database !== "heliumdb" || Number(r.version) !== 160010 ||
      r.recovery !== false || r.active_event_triggers !== 0 || !r.target_oid || !r.public_oid || r.target_oid === r.public_oid ||
      r.usage !== true || r.create_permission !== true) stop("DATABASE_PRECONDITIONS_NOT_VERIFIED");
  // Empty target required: never overwrite, reset, truncate or reuse an unknown previous run.
  const existing = await client.query(
    "SELECT 'relation' AS kind,c.relname AS name FROM pg_catalog.pg_class c WHERE c.relnamespace=$1::oid " +
    "UNION ALL SELECT 'routine',p.proname FROM pg_catalog.pg_proc p WHERE p.pronamespace=$1::oid " +
    "UNION ALL SELECT 'type',t.typname FROM pg_catalog.pg_type t WHERE t.typnamespace=$1::oid", [r.target_oid]);
  if (requireEmpty && existing.rows.length) stop("TEST_SCHEMA_NOT_EMPTY");
  return { database: r.database, version: r.version, targetOid: r.target_oid, publicOid: r.public_oid };
}
const PUBLIC_METADATA = [
  "SELECT oid::text,nspname,nspowner::text,nspacl::text FROM pg_catalog.pg_namespace WHERE nspname='public'",
  "SELECT c.oid::text,c.relname,c.relkind,c.relpersistence,c.relowner::text,c.relacl::text,c.reloptions," +
  "c.relrowsecurity,c.relforcerowsecurity FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
  "SELECT a.attrelid::text,a.attnum,a.attname,a.atttypid::text,a.attnotnull,a.attidentity,a.attgenerated,a.attisdropped," +
  "pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expr FROM pg_catalog.pg_attribute a " +
  "JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace " +
  "LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND a.attnum>0",
  "SELECT k.oid::text,k.conname,k.contype,k.conrelid::text,k.confrelid::text,k.convalidated," +
  "pg_catalog.pg_get_constraintdef(k.oid) AS definition FROM pg_catalog.pg_constraint k " +
  "JOIN pg_catalog.pg_namespace n ON n.oid=k.connamespace WHERE n.nspname='public'",
  "SELECT c.oid::text,c.relname,pg_catalog.pg_get_indexdef(c.oid) AS definition FROM pg_catalog.pg_class c " +
  "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('i','I')",
  "SELECT p.oid::text,p.proname,p.prokind,p.proowner::text,p.proacl::text,p.proconfig::text,p.prosrc,p.probin," +
  "p.proargtypes::text,p.prorettype::text,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof " +
  "FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'",
  "SELECT t.oid::text,t.typname,t.typtype,t.typowner::text,t.typacl::text,t.typbasetype::text,t.typnotnull,t.typdefault," +
  "e.enumlabel,e.enumsortorder FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace " +
  "LEFT JOIN pg_catalog.pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public'",
  "SELECT t.oid::text,t.tgrelid::text,t.tgname,t.tgenabled,pg_catalog.pg_get_triggerdef(t.oid) AS definition " +
  "FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid " +
  "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
  "SELECT r.oid::text,r.rulename,pg_catalog.pg_get_ruledef(r.oid) AS definition FROM pg_catalog.pg_rewrite r " +
  "JOIN pg_catalog.pg_class c ON c.oid=r.ev_class JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
  "SELECT p.oid::text,p.polrelid::text,p.polname,p.polcmd,p.polpermissive,p.polroles::text," +
  "pg_catalog.pg_get_expr(p.polqual,p.polrelid) AS qual,pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid) AS check_expr " +
  "FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid " +
  "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
  "SELECT d.defaclrole::text,d.defaclnamespace::text,d.defaclobjtype,d.defaclacl::text FROM pg_catalog.pg_default_acl d " +
  "JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname='public'",
  "SELECT s.seqrelid::text,s.seqtypid::text,s.seqstart::text,s.seqincrement::text,s.seqmax::text,s.seqmin::text,s.seqcache::text,s.seqcycle " +
  "FROM pg_catalog.pg_sequence s JOIN pg_catalog.pg_class c ON c.oid=s.seqrelid " +
  "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
];
export async function publicSnapshot(client) {
  const collections = [];
  for (const sql of PUBLIC_METADATA) {
    const result = await client.query(sql);
    collections.push(result.rows.map(row => JSON.stringify(row)).sort());
  }
  if (collections[0].length !== 1) stop("PUBLIC_SCHEMA_MISSING");
  return {
    digest: createHash("sha256").update(JSON.stringify(collections)).digest("hex"),
    categoryCounts: collections.map(rows => rows.length),
  };
}
export async function assertPublicUnchanged(client, before) {
  const after = await publicSnapshot(client);
  if (before.digest !== after.digest) stop("PUBLIC_METADATA_CHANGED_STOP");
  const outside = await client.query(
    "SELECT n.nspname AS schema,c.relname AS name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace " +
    "WHERE c.relname LIKE 'identity02\\_%' ESCAPE '\\' AND n.nspname<>$1 " +
    "UNION ALL SELECT n.nspname,p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace " +
    "WHERE p.proname LIKE 'identity02\\_%' ESCAPE '\\' AND n.nspname<>$1 " +
    "UNION ALL SELECT n.nspname,t.typname FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace " +
    "WHERE (t.typname LIKE 'identity02\\_%' ESCAPE '\\' OR t.typname LIKE '\\_identity02\\_%' ESCAPE '\\') AND n.nspname<>$1 " +
    "UNION ALL SELECT n.nspname,k.conname FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_namespace n ON n.oid=k.connamespace " +
    "WHERE k.conname LIKE 'identity02\\_%' ESCAPE '\\' AND n.nspname<>$1", [SCHEMA]);
  if (outside.rows.length) stop("IDENTITY_OBJECT_OUTSIDE_TEST_SCHEMA_STOP");
  return after;
}
