import { createHash, randomUUID } from "node:crypto";

// Server-only internal boundary. Do not expose the issuer or this module in UI/API routes.
export const TEST_SCHEMA = "identity02_test_v01" as const;
const S = '"identity02_test_v01"';
export const TABLES = Object.freeze({
  subjects: S + '."identity02_subjects"',
  profiles: S + '."identity02_profiles"',
  goals: S + '."identity02_goal_states"',
  creations: S + '."identity02_creations"',
});
export type GoalState = "UNKNOWN" | "NONE" | "CONFIRMED";
export type ProfileStatus = "ACTIVE" | "INACTIVE";
declare const contextBrand: unique symbol;
export type RegistryContext = { readonly [contextBrand]: true };
export interface ControlAuthority {
  resolve(context: RegistryContext): string;
}
export class RegistryError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "RegistryError"; this.code = code; }
}
const fail = (code: string): never => { throw new RegistryError(code); };
const uuid = (value: unknown): string => {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    return fail("INVALID_REQUEST");
  return value.toLowerCase();
};
export function createInternalControlAuthority() {
  const issued = new WeakMap<object, string>();
  return Object.freeze({
    // Only a trusted server/test adapter may issue this capability after verifying control.
    // A control reference is NOT a device/session/install identifier or a credential itself.
    issueForVerifiedControl(controlRef: string): RegistryContext {
      const ref = uuid(controlRef);
      const context = Object.freeze({}) as RegistryContext;
      issued.set(context, ref);
      return context;
    },
    resolve(context: RegistryContext): string {
      if (!context || typeof context !== "object") return fail("CONTEXT_REQUIRED");
      const ref = issued.get(context);
      return ref ?? fail("CONTEXT_REQUIRED");
    },
  });
}
export interface SqlResult { rows: Record<string, unknown>[] }
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<SqlResult>;
  release(destroy?: boolean): void;
}
export interface SqlPool { connect(): Promise<SqlClient> }
export interface SubjectRecord {
  subjectId: string;
  status: "ACTIVE";
  createdAt: string;
  revision: number;
}
export interface ProfileAddress { subjectId: string; profileId: string }
export interface CreationReceipt extends ProfileAddress {
  receiptVersion: 1;
  receiptId: string;
  registryRevision: 1;
  createdAt: string;
  confirmedGoalState: "NONE";
  scope: "INITIAL_CREATION_ONLY";
  commitStatus: "COMMITTED";
}
export interface ProfileRecord extends ProfileAddress {
  status: ProfileStatus;
  createdAt: string;
  revision: number;
}
export interface ConfirmedGoalStateRecord {
  profileId: string;
  state: GoalState;
  revision: number | null;
  updatedAt: string | null;
}
function iso(value: unknown): string {
  if (!(value instanceof Date) && typeof value !== "string") return fail("INTEGRITY_UNAVAILABLE");
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return fail("INTEGRITY_UNAVAILABLE");
  return date.toISOString();
}
function positiveRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return fail("INVALID_REVISION");
  return value;
}
function keyDigest(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{16,128}$/.test(value)) return fail("INVALID_REQUEST");
  return createHash("sha256").update(value).digest("hex");
}
function receipt(row: Record<string, unknown>): CreationReceipt {
  const subjectId = uuid(row.subject_id), profileId = uuid(row.profile_id);
  if (row.receipt_version !== 1) return fail("INTEGRITY_UNAVAILABLE");
  return Object.freeze({
    subjectId, profileId, receiptVersion: 1, receiptId: "initial:" + subjectId + ":1",
    registryRevision: 1, createdAt: iso(row.created_at), confirmedGoalState: "NONE",
    scope: "INITIAL_CREATION_ONLY", commitStatus: "COMMITTED",
  });
}
function profile(row: Record<string, unknown>): ProfileRecord {
  if (row.status !== "ACTIVE" && row.status !== "INACTIVE") return fail("INTEGRITY_UNAVAILABLE");
  return Object.freeze({
    subjectId: uuid(row.subject_id), profileId: uuid(row.profile_id),
    status: row.status, revision: positiveRevision(row.revision), createdAt: iso(row.created_at),
  });
}
export function createPostgresIdentityRegistry(
  pool: SqlPool,
  authority: ControlAuthority,
  options: { schema: string; newId?: () => string },
) {
  // This validation adapter cannot silently become a public/production registry.
  if (options.schema !== TEST_SCHEMA) return fail("TEST_SCHEMA_REQUIRED");
  const newId = options.newId ?? randomUUID;
  async function use<T>(work: (client: SqlClient) => Promise<T>, transaction: boolean): Promise<T> {
    let client: SqlClient;
    try { client = await pool.connect(); } catch { return fail("REGISTRY_UNAVAILABLE"); }
    let commitAttempted = false, destroy = false;
    try {
      if (transaction) await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const result = await work(client);
      if (transaction) {
        commitAttempted = true;
        await client.query("COMMIT");
      }
      // Nothing escapes until COMMIT has been acknowledged.
      return result;
    } catch (error) {
      if (transaction) {
        try { await client.query("ROLLBACK"); } catch { destroy = true; }
      }
      if (commitAttempted) { destroy = true; return fail("COMMIT_OUTCOME_UNKNOWN"); }
      if (error instanceof RegistryError) throw error;
      destroy = true;
      return fail("REGISTRY_UNAVAILABLE");
    } finally { client.release(destroy); }
  }
  function address(context: RegistryContext, pair: ProfileAddress) {
    const ref = uuid(authority.resolve(context));
    if (!pair) return fail("INVALID_REQUEST");
    return [ref, uuid(pair.subjectId), uuid(pair.profileId)];
  }
  async function loadReceipt(client: SqlClient, ref: string, digest: string, pair?: string[]) {
    const result = await client.query(
      "SELECT s.subject_id, p.profile_id, s.created_at, c.receipt_version FROM " + TABLES.creations + " c " +
      "JOIN " + TABLES.subjects + " s ON s.subject_id = c.subject_id " +
      "JOIN " + TABLES.profiles + " p ON p.profile_id = c.profile_id AND p.subject_id = s.subject_id " +
      "WHERE s.control_ref = $1 AND c.request_key_digest = $2 AND s.status = 'ACTIVE'" +
      (pair ? " AND s.subject_id = $3 AND p.profile_id = $4" : ""),
      pair ? [ref, digest, ...pair] : [ref, digest]);
    if (result.rows.length !== 1) return fail("NOT_FOUND_OR_DENIED");
    return receipt(result.rows[0]);
  }
  return Object.freeze({
    async createInitialSubjectProfile(context: RegistryContext, request: { idempotencyKey: string }) {
      const ref = uuid(authority.resolve(context));
      const digest = keyDigest(request?.idempotencyKey);
      return use(async client => {
        const subjectId = uuid(newId()), profileId = uuid(newId());
        const created = await client.query(
          "INSERT INTO " + TABLES.subjects +
          " (subject_id, control_ref, profile_id, status, created_at, revision) " +
          "VALUES ($1,$2,$3,'ACTIVE',pg_catalog.transaction_timestamp(),1) " +
          "ON CONFLICT (control_ref) DO NOTHING RETURNING subject_id",
          [subjectId, ref, profileId]);
        if (created.rows.length === 1) {
          await client.query(
            "INSERT INTO " + TABLES.profiles +
            " (profile_id, subject_id, status, created_at, revision) " +
            "VALUES ($1,$2,'ACTIVE',pg_catalog.transaction_timestamp(),1)", [profileId, subjectId]);
          await client.query(
            "INSERT INTO " + TABLES.goals +
            " (profile_id, state, revision, updated_at) VALUES ($1,'NONE',1,pg_catalog.transaction_timestamp())",
            [profileId]);
        }
        // A new request/session for the same verified control resolves the existing subject.
        const owner = await client.query(
          "SELECT subject_id, profile_id FROM " + TABLES.subjects + " WHERE control_ref=$1 AND status='ACTIVE'", [ref]);
        if (owner.rows.length !== 1) return fail("NOT_FOUND_OR_DENIED");
        const row = owner.rows[0];
        await client.query(
          "INSERT INTO " + TABLES.creations +
          " (request_key_digest, subject_id, profile_id, receipt_version, recorded_at) " +
          "VALUES ($1,$2,$3,1,pg_catalog.transaction_timestamp()) ON CONFLICT (request_key_digest) DO NOTHING",
          [digest, row.subject_id, row.profile_id]);
        // Wrong-owner reuse of a global key returns no receipt and rolls back all provisional rows.
        return loadReceipt(client, ref, digest);
      }, true);
    },
    async readCreationReceipt(context: RegistryContext, pair: ProfileAddress, idempotencyKey: string) {
      const [ref, subjectId, profileId] = address(context, pair);
      const digest = keyDigest(idempotencyKey);
      return use(client => loadReceipt(client, ref, digest, [subjectId, profileId]), false);
    },
    async readProfile(context: RegistryContext, pair: ProfileAddress) {
      const args = address(context, pair);
      return use(async client => {
        const result = await client.query(
          "SELECT p.* FROM " + TABLES.profiles + " p JOIN " + TABLES.subjects +
          " s ON s.subject_id=p.subject_id WHERE s.control_ref=$1 AND p.subject_id=$2 AND p.profile_id=$3 AND s.status='ACTIVE'", args);
        if (result.rows.length !== 1) return fail("NOT_FOUND_OR_DENIED");
        return profile(result.rows[0]);
      }, false);
    },
    async readConfirmedGoalState(context: RegistryContext, pair: ProfileAddress): Promise<ConfirmedGoalStateRecord> {
      const args = address(context, pair);
      return use(async client => {
        const result = await client.query(
          "SELECT p.profile_id, g.state, g.revision, g.updated_at FROM " + TABLES.profiles +
          " p JOIN " + TABLES.subjects + " s ON s.subject_id=p.subject_id LEFT JOIN " + TABLES.goals +
          " g ON g.profile_id=p.profile_id WHERE s.control_ref=$1 AND p.subject_id=$2 AND p.profile_id=$3 AND s.status='ACTIVE'", args);
        if (result.rows.length !== 1) return fail("NOT_FOUND_OR_DENIED");
        const row = result.rows[0];
        if (!["UNKNOWN", "NONE", "CONFIRMED"].includes(row.state as string) ||
            typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 1 ||
            row.updated_at == null) {
          return Object.freeze({ profileId: args[2], state: "UNKNOWN", revision: null, updatedAt: null });
        }
        return Object.freeze({
          profileId: args[2], state: row.state as GoalState, revision: row.revision, updatedAt: iso(row.updated_at),
        });
      }, false);
    },
    async updateProfileStatus(context: RegistryContext, pair: ProfileAddress, status: ProfileStatus, expectedRevision: number) {
      const args = address(context, pair);
      if (status !== "ACTIVE" && status !== "INACTIVE") return fail("INVALID_STATUS");
      positiveRevision(expectedRevision);
      return use(async client => {
        const result = await client.query(
          "UPDATE " + TABLES.profiles + " p SET status=$4, revision=p.revision+1 FROM " + TABLES.subjects +
          " s WHERE s.subject_id=p.subject_id AND s.control_ref=$1 AND p.subject_id=$2 AND p.profile_id=$3 " +
          "AND p.revision=$5 AND s.status='ACTIVE' RETURNING p.*", [...args, status, expectedRevision]);
        if (result.rows.length !== 1) return fail("NOT_FOUND_DENIED_OR_STALE");
        return profile(result.rows[0]);
      }, true);
    },
    // Internal authority assertion only. No draft input or UI/provider route is wired to this operation.
    async recordConfirmedGoalState(context: RegistryContext, pair: ProfileAddress, state: GoalState, expectedRevision: number) {
      const args = address(context, pair);
      if (!["UNKNOWN", "NONE", "CONFIRMED"].includes(state)) return fail("INVALID_GOAL_STATE");
      positiveRevision(expectedRevision);
      return use(async client => {
        const result = await client.query(
          "UPDATE " + TABLES.goals + " g SET state=$4, revision=g.revision+1, updated_at=pg_catalog.transaction_timestamp() " +
          "FROM " + TABLES.profiles + " p JOIN " + TABLES.subjects + " s ON s.subject_id=p.subject_id " +
          "WHERE g.profile_id=p.profile_id AND s.control_ref=$1 AND p.subject_id=$2 AND p.profile_id=$3 " +
          "AND g.revision=$5 AND s.status='ACTIVE' RETURNING g.*", [...args, state, expectedRevision]);
        if (result.rows.length !== 1) return fail("NOT_FOUND_DENIED_OR_STALE");
        const row = result.rows[0];
        return Object.freeze({
          profileId: args[2], state: row.state as GoalState,
          revision: positiveRevision(row.revision), updatedAt: iso(row.updated_at),
        });
      }, true);
    },
  });
}
