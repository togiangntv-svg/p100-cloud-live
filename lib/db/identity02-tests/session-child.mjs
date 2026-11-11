import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createInternalControlAuthority, createPostgresIdentityRegistry } from "../src/identity02/registry.ts";
import { environmentGuard, databaseGuard, SCHEMA } from "./guard.mjs";
let pool;
try {
  const args = process.argv.slice(2);
  environmentGuard(process.env, args);
  const anchor = args.find(a => a.startsWith("--pg-package-json="))?.slice("--pg-package-json=".length) ??
    fileURLToPath(new URL("../package.json", import.meta.url));
  const { Pool } = createRequire(anchor)("pg");
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 10000, query_timeout: 15000 });
  pool.on("error", () => {});
  const c = await pool.connect();
  try { await databaseGuard(c, false); } finally { c.release(); }
  const authority = createInternalControlAuthority();
  const context = authority.issueForVerifiedControl("20000000-0000-4000-8000-000000000007");
  let n = 910000;
  const registry = createPostgresIdentityRegistry(pool, authority, {
    schema: SCHEMA, newId: () => "10000000-0000-4000-8000-" + (n++).toString(16).padStart(12, "0"),
  });
  const receipt = await registry.createInitialSubjectProfile(context, { idempotencyKey: "identity02:new_execution_session" });
  console.log(JSON.stringify({ subjectId: receipt.subjectId, profileId: receipt.profileId, pid: process.pid }));
} catch { console.log(JSON.stringify({ status: "FAIL_CLOSED" })); process.exitCode = 1; }
finally { if (pool) await pool.end(); }

