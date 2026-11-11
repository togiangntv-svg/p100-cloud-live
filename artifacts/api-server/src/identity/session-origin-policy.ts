import { createHash, randomBytes } from "node:crypto";
import {
  IdentitySessionError,
  type SessionOrigin,
  type SessionOriginPolicy,
  type SqlClient,
  type SqlPool,
  type VerifiedControlDescriptor,
} from "./session-core";
import {
  sameGoogleNamespaceAuthorityState,
  unavailableGoogleNamespaceAuthority,
  validateGoogleNamespaceAuthorityRecord,
  type GoogleNamespaceAuthority,
  type GoogleNamespaceAuthorityKey,
  type GoogleNamespaceAuthoritySnapshot,
  type TrustedGoogleNamespaceBinding,
} from "./google-namespace-authority";

const GOOGLE = "google";
const SCHEMA = '"identity_v1"';
const POLICIES = `${SCHEMA}."provider_session_policies"`;
const SESSIONS = `${SCHEMA}."sessions"`;
const CHALLENGES = `${SCHEMA}."google_sign_in_challenges"`;
const CONTROLS = `${SCHEMA}."verified_control_bindings"`;
const SHA256_HEX = /^[0-9a-f]{64}$/;

type ReconciliationState = Readonly<{
  epoch: number;
  digest: string;
  authority: GoogleNamespaceAuthoritySnapshot;
}>;

export interface GoogleSessionOriginPolicy extends SessionOriginPolicy {
  reconcileProviderNamespace(
    pool: SqlPool,
    credentialNamespaceDigest: string,
  ): Promise<ReconciliationState>;
  invalidateReconciliation(
    credentialNamespaceDigest: string,
    retiredEpoch: number,
  ): void;
  readCurrentAuthority(
    credentialNamespaceDigest: string,
  ): Promise<GoogleNamespaceAuthoritySnapshot>;
  retireNamespaceAuthority(
    credentialNamespaceDigest: string,
    expectedGeneration: number,
    operationId: string,
  ): Promise<GoogleNamespaceAuthoritySnapshot>;
}

const fail = (): never => {
  throw new IdentitySessionError("AUTHORITY_UNAVAILABLE");
};
const failCleanupPending = (): never => {
  throw new IdentitySessionError("AUTHORITY_RETIRED_DB_CLEANUP_PENDING");
};

function validDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

function validEpoch(value: unknown): value is number | string {
  return Number.isSafeInteger(Number(value)) && Number(value) >= 1;
}

function operationIdForRetirement(
  key: GoogleNamespaceAuthorityKey,
  incarnation: string,
  generation: number,
): string {
  return createHash("sha256").update(JSON.stringify([
    key.deploymentEnvironment,
    GOOGLE,
    key.credentialNamespaceDigest,
    incarnation,
    generation,
    "RETIRE",
  ]), "utf8").digest("hex");
}

export function createPostgresSessionOriginPolicy(
  options: Readonly<{
    tokenBytes?: (size: number) => Buffer;
    authority?: GoogleNamespaceAuthority;
    trustedBinding?: TrustedGoogleNamespaceBinding;
  }> = {},
): GoogleSessionOriginPolicy {
  const reconciled = new Map<string, ReconciliationState>();
  const minimumEpochs = new Map<string, number>();
  const tokenBytes = options.tokenBytes ?? randomBytes;
  const authority = options.authority ?? unavailableGoogleNamespaceAuthority;

  const keyFor = (credentialNamespaceDigest: string): GoogleNamespaceAuthorityKey => ({
    deploymentEnvironment: options.trustedBinding?.deploymentEnvironment ?? "",
    provider: "google",
    credentialNamespaceDigest,
  });

  const readCurrentAuthority = async (
    credentialNamespaceDigest: string,
  ): Promise<GoogleNamespaceAuthoritySnapshot> => {
    if (!validDigest(credentialNamespaceDigest) || !options.trustedBinding) return fail();
    const key = keyFor(credentialNamespaceDigest);
    let record: unknown;
    try {
      record = await authority.readCurrent(key);
    } catch {
      return fail();
    }
    return validateGoogleNamespaceAuthorityRecord(record, key, options.trustedBinding) ?? fail();
  };

  const invalidate = (credentialNamespaceDigest: string, retiredEpoch: number): void => {
    if (!validDigest(credentialNamespaceDigest) || !Number.isSafeInteger(retiredEpoch)
      || retiredEpoch < 1) return fail();
    reconciled.delete(credentialNamespaceDigest);
    minimumEpochs.set(
      credentialNamespaceDigest,
      Math.max(minimumEpochs.get(credentialNamespaceDigest) ?? 1, retiredEpoch),
    );
  };

  const retireNamespaceAuthority = async (
    credentialNamespaceDigest: string,
    expectedGeneration: number,
    operationId: string,
  ): Promise<GoogleNamespaceAuthoritySnapshot> => {
    if (!validDigest(credentialNamespaceDigest)
      || !Number.isSafeInteger(expectedGeneration)
      || expectedGeneration < 1
      || !SHA256_HEX.test(operationId)) return fail();
    const key = keyFor(credentialNamespaceDigest);
    const current = await readCurrentAuthority(credentialNamespaceDigest);
    const targetGeneration = expectedGeneration + 1;
    if (!Number.isSafeInteger(targetGeneration)) return fail();

    if (current.status === "DISABLED"
      && current.monotonicGeneration === targetGeneration
      && current.lastControlAction === "RETIRE"
      && current.lastControlOperationId === operationId) {
      return current;
    }
    if (current.status !== "ENABLED"
      || current.monotonicGeneration !== expectedGeneration) return fail();

    try {
      await authority.compareAndSetRetirement({
        key,
        expectedIncarnation: current.admittedIncarnation,
        expectedGeneration,
        expectedStatus: "ENABLED",
        operationId,
      });
    } catch {
      // The result can be ambiguous after an external commit; the readback below decides.
    }

    const readback = await readCurrentAuthority(credentialNamespaceDigest);
    if (readback.status !== "DISABLED"
      || readback.monotonicGeneration !== targetGeneration
      || readback.admittedIncarnation !== current.admittedIncarnation
      || readback.lastControlAction !== "RETIRE"
      || readback.lastControlOperationId !== operationId) return fail();
    return readback;
  };

  return Object.freeze({
    async reconcileProviderNamespace(
      pool: SqlPool,
      credentialNamespaceDigest: string,
    ): Promise<ReconciliationState> {
      if (!validDigest(credentialNamespaceDigest)) return fail();
      reconciled.delete(credentialNamespaceDigest);
      const r0 = await readCurrentAuthority(credentialNamespaceDigest);
      if (r0.status !== "ENABLED") return fail();

      let client: SqlClient;
      try {
        client = await pool.connect();
      } catch {
        return fail();
      }
      let destroy = false;
      let committed = false;
      try {
        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        const current = await client.query(
          `/* identity197:lock-google-policy-reconciliation */ SELECT enabled,current_epoch `
          + `FROM ${POLICIES} WHERE provider=$1 AND credential_namespace_digest=$2 FOR UPDATE`,
          [GOOGLE, credentialNamespaceDigest],
        );
        const row = current.rows[0];
        const minimumEpoch = minimumEpochs.get(credentialNamespaceDigest) ?? 1;
        if (current.rows.length !== 1 || row.enabled !== true
          || !validEpoch(row.current_epoch)
          || Number(row.current_epoch) !== r0.monotonicGeneration
          || Number(row.current_epoch) < minimumEpoch) return fail();

        const token = tokenBytes(32);
        if (!Buffer.isBuffer(token) || token.byteLength !== 32) return fail();
        const digest = createHash("sha256").update(token).digest("hex");
        const updated = await client.query(
          `/* identity197:reconcile-google-policy */ UPDATE ${POLICIES} `
          + "SET reconciliation_digest=$3 WHERE provider=$1 AND credential_namespace_digest=$2 "
          + "AND enabled=TRUE AND current_epoch=$4 RETURNING current_epoch,reconciliation_digest",
          [GOOGLE, credentialNamespaceDigest, digest, Number(row.current_epoch)],
        );
        if (updated.rows.length !== 1
          || Number(updated.rows[0].current_epoch) !== r0.monotonicGeneration
          || updated.rows[0].reconciliation_digest !== digest) return fail();
        await client.query("COMMIT");
        committed = true;

        const r1 = await readCurrentAuthority(credentialNamespaceDigest);
        if (r1.status !== "ENABLED"
          || !sameGoogleNamespaceAuthorityState(r0, r1)) {
          reconciled.delete(credentialNamespaceDigest);
          return fail();
        }
        const state = Object.freeze({
          epoch: r0.monotonicGeneration,
          digest,
          authority: r0,
        });
        reconciled.set(credentialNamespaceDigest, state);
        return state;
      } catch (error) {
        reconciled.delete(credentialNamespaceDigest);
        if (error instanceof IdentitySessionError) throw error;
        destroy = true;
        return fail();
      } finally {
        if (!committed) {
          try { await client.query("ROLLBACK"); } catch { destroy = true; }
        }
        client.release(destroy);
      }
    },

    invalidateReconciliation: invalidate,
    readCurrentAuthority,
    retireNamespaceAuthority,

    async assertIssuancePreflight(
      pool: SqlPool,
      descriptor: VerifiedControlDescriptor,
    ): Promise<void> {
      if (descriptor.provider !== GOOGLE
        || !validDigest(descriptor.credentialNamespaceDigest)) return fail();
      const namespaceDigest = descriptor.credentialNamespaceDigest;
      const r0 = await readCurrentAuthority(namespaceDigest);
      const state = reconciled.get(namespaceDigest);
      if (r0.status !== "ENABLED"
        || !state
        || state.epoch !== r0.monotonicGeneration
        || !sameGoogleNamespaceAuthorityState(state.authority, r0)) return fail();

      let client: SqlClient;
      try {
        client = await pool.connect();
      } catch {
        return fail();
      }
      let destroy = false;
      let current = false;
      try {
        const result = await client.query(
          `/* identity197:preflight-google-issuance */ SELECT enabled,current_epoch,reconciliation_digest `
          + `FROM ${POLICIES} WHERE provider=$1 AND credential_namespace_digest=$2`,
          [GOOGLE, namespaceDigest],
        );
        const row = result.rows[0];
        current = result.rows.length === 1
          && row.enabled === true
          && validEpoch(row.current_epoch)
          && Number(row.current_epoch) === r0.monotonicGeneration
          && row.reconciliation_digest === state.digest;
      } catch {
        destroy = true;
      } finally {
        client.release(destroy);
      }
      if (!current) return fail();

      const r1 = await readCurrentAuthority(namespaceDigest);
      if (r1.status !== "ENABLED"
        || !sameGoogleNamespaceAuthorityState(r0, r1)
        || !sameGoogleNamespaceAuthorityState(state.authority, r1)) return fail();
    },

    async authorizeIssuance(
      client: SqlClient,
      descriptor: VerifiedControlDescriptor,
    ): Promise<SessionOrigin> {
      if (descriptor.provider !== GOOGLE || !validDigest(descriptor.credentialNamespaceDigest)) {
        return fail();
      }
      const currentAuthority = await readCurrentAuthority(descriptor.credentialNamespaceDigest);
      const current = reconciled.get(descriptor.credentialNamespaceDigest);
      if (currentAuthority.status !== "ENABLED"
        || !current
        || current.epoch !== currentAuthority.monotonicGeneration
        || !sameGoogleNamespaceAuthorityState(current.authority, currentAuthority)) return fail();

      const result = await client.query(
        `/* identity197:lock-google-policy */ SELECT enabled,current_epoch,reconciliation_digest FROM ${POLICIES} `
        + "WHERE provider=$1 AND credential_namespace_digest=$2 FOR UPDATE",
        [GOOGLE, descriptor.credentialNamespaceDigest],
      );
      if (result.rows.length !== 1) return fail();
      const row = result.rows[0];
      if (row.enabled !== true
        || !validEpoch(row.current_epoch)
        || Number(row.current_epoch) !== currentAuthority.monotonicGeneration
        || current.digest !== row.reconciliation_digest) return fail();
      return Object.freeze({
        provider: GOOGLE,
        credentialNamespaceDigest: descriptor.credentialNamespaceDigest,
        epoch: currentAuthority.monotonicGeneration,
        reconciliationDigest: current.digest,
      });
    },

    async confirmIssuanceCurrent(
      pool: SqlPool,
      input: Readonly<{ origin: SessionOrigin; subjectId: string }>,
    ): Promise<boolean> {
      const { origin, subjectId } = input;
      if (origin.provider !== GOOGLE || !validDigest(origin.credentialNamespaceDigest)
        || !validEpoch(origin.epoch) || !validDigest(origin.reconciliationDigest)) return false;
      const before = await readCurrentAuthority(origin.credentialNamespaceDigest);
      const state = reconciled.get(origin.credentialNamespaceDigest);
      if (before.status !== "ENABLED" || before.monotonicGeneration !== origin.epoch
        || !state || state.epoch !== origin.epoch || state.digest !== origin.reconciliationDigest
        || !sameGoogleNamespaceAuthorityState(state.authority, before)) return false;

      let client: SqlClient;
      try {
        client = await pool.connect();
      } catch {
        return false;
      }
      let destroy = false;
      let current = false;
      try {
        const result = await client.query(
          `/* identity197:confirm-google-issuance-current */ SELECT 1 AS current FROM ${POLICIES} policy `
          + "WHERE policy.provider=$1 AND policy.credential_namespace_digest=$2 "
          + "AND policy.enabled=TRUE AND policy.current_epoch=$3 AND policy.reconciliation_digest=$4 "
          + "AND EXISTS (SELECT 1 FROM " + CONTROLS + " control "
          + "WHERE control.subject_id=$5 AND control.provider=$1 "
          + "AND control.credential_namespace_digest=$2)",
          [GOOGLE, origin.credentialNamespaceDigest, origin.epoch,
            origin.reconciliationDigest, subjectId],
        );
        current = result.rows.length === 1;
      } catch {
        destroy = true;
      } finally {
        client.release(destroy);
      }
      if (!current) return false;
      const after = await readCurrentAuthority(origin.credentialNamespaceDigest);
      return after.status === "ENABLED"
        && after.monotonicGeneration === origin.epoch
        && sameGoogleNamespaceAuthorityState(before, after);
    },

    async verifySessionOrigin(
      client: SqlClient,
      input: Readonly<{ origin: SessionOrigin; subjectId: string }>,
    ): Promise<boolean> {
      if (input.origin.provider !== GOOGLE
        || !validDigest(input.origin.credentialNamespaceDigest)
        || !validEpoch(input.origin.epoch)
        || !validDigest(input.origin.reconciliationDigest)) return false;
      let currentAuthority: GoogleNamespaceAuthoritySnapshot;
      try {
        currentAuthority = await readCurrentAuthority(input.origin.credentialNamespaceDigest);
      } catch {
        return false;
      }
      const current = reconciled.get(input.origin.credentialNamespaceDigest);
      if (currentAuthority.status !== "ENABLED"
        || currentAuthority.monotonicGeneration !== input.origin.epoch
        || current?.epoch !== input.origin.epoch
        || current.digest !== input.origin.reconciliationDigest
        || !sameGoogleNamespaceAuthorityState(current.authority, currentAuthority)) return false;
      const result = await client.query(
        `/* identity197:verify-google-policy */ SELECT 1 AS current FROM ${POLICIES} policy `
        + "WHERE policy.provider=$1 AND policy.credential_namespace_digest=$2 "
        + "AND policy.enabled=TRUE AND policy.current_epoch=$3 "
        + "AND policy.reconciliation_digest=$5 AND EXISTS ("
        + `SELECT 1 FROM ${CONTROLS} control WHERE control.subject_id=$4 `
        + "AND control.provider=$1 AND control.credential_namespace_digest=$2)",
        [
          GOOGLE,
          input.origin.credentialNamespaceDigest,
          input.origin.epoch,
          input.subjectId,
          input.origin.reconciliationDigest,
        ],
      );
      return result.rows.length === 1;
    },
  });
}

export type GoogleProviderRetirement = Readonly<{
  provider: "google";
  credentialNamespaceDigest: string;
  retiredEpoch: number;
  revokedSessions: number;
  invalidatedChallenges: number;
}>;

export async function retireGoogleProviderNamespace(
  pool: SqlPool,
  credentialNamespaceDigest: string,
  originPolicy: GoogleSessionOriginPolicy,
  now: () => number = Date.now,
): Promise<GoogleProviderRetirement> {
  if (!validDigest(credentialNamespaceDigest)) return fail();
  const retiredAt = new Date(now());
  if (!Number.isFinite(retiredAt.getTime())) return fail();
  const initialAuthority = await originPolicy.readCurrentAuthority(credentialNamespaceDigest);

  let client: SqlClient;
  try {
    client = await pool.connect();
  } catch {
    return initialAuthority.status === "DISABLED" ? failCleanupPending() : fail();
  }
  let destroy = false;
  let committed = false;
  let externalRetired = initialAuthority.status === "DISABLED";
  let targetEpoch = 0;
  let operationId = "";
  let revokedSessions = 0;
  let invalidatedChallenges = 0;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const current = await client.query(
      `/* identity197:lock-google-policy-retirement */ SELECT enabled,current_epoch FROM ${POLICIES} `
      + "WHERE provider=$1 AND credential_namespace_digest=$2 FOR UPDATE",
      [GOOGLE, credentialNamespaceDigest],
    );
    if (current.rows.length !== 1 || !validEpoch(current.rows[0].current_epoch)) return fail();
    const dbEpoch = Number(current.rows[0].current_epoch);

    if (initialAuthority.status === "ENABLED") {
      if (dbEpoch !== initialAuthority.monotonicGeneration) return fail();
      targetEpoch = initialAuthority.monotonicGeneration + 1;
      if (!Number.isSafeInteger(targetEpoch)) return fail();
      operationId = operationIdForRetirement(
        {
          deploymentEnvironment: initialAuthority.deploymentEnvironment,
          provider: GOOGLE,
          credentialNamespaceDigest,
        },
        initialAuthority.admittedIncarnation,
        initialAuthority.monotonicGeneration,
      );
      const retiredAuthority = await originPolicy.retireNamespaceAuthority(
        credentialNamespaceDigest,
        initialAuthority.monotonicGeneration,
        operationId,
      );
      if (retiredAuthority.status !== "DISABLED"
        || retiredAuthority.monotonicGeneration !== targetEpoch) return fail();
      externalRetired = true;
    } else {
      if (initialAuthority.lastControlAction !== "RETIRE"
        || initialAuthority.monotonicGeneration < 2
        || (dbEpoch !== initialAuthority.monotonicGeneration
          && dbEpoch !== initialAuthority.monotonicGeneration - 1)) return fail();
      targetEpoch = initialAuthority.monotonicGeneration;
      operationId = initialAuthority.lastControlOperationId;
    }

    // The external DISABLED transition is authoritative. Invalidate local positive state before DB cleanup.
    originPolicy.invalidateReconciliation(credentialNamespaceDigest, targetEpoch);

    const policy = await client.query(
      `/* identity197:disable-google-policy */ UPDATE ${POLICIES} `
      + "SET enabled=FALSE,current_epoch=$3,reconciliation_digest=NULL WHERE provider=$1 "
      + "AND credential_namespace_digest=$2 AND current_epoch=$4 "
      + "RETURNING enabled,current_epoch,reconciliation_digest",
      [GOOGLE, credentialNamespaceDigest, targetEpoch, dbEpoch],
    );
    if (policy.rows.length !== 1 || policy.rows[0].enabled !== false
      || Number(policy.rows[0].current_epoch) !== targetEpoch
      || policy.rows[0].reconciliation_digest !== null) return fail();
    const sessions = await client.query(
      `/* identity197:revoke-google-sessions */ UPDATE ${SESSIONS} SET revoked_at=$3 `
      + "WHERE issuer_provider=$1 AND issuer_namespace_digest=$2 AND revoked_at IS NULL "
      + "RETURNING session_id",
      [GOOGLE, credentialNamespaceDigest, retiredAt],
    );
    const challenges = await client.query(
      `/* identity197:invalidate-google-challenges */ UPDATE ${CHALLENGES} SET invalidated_at=$2 `
      + "WHERE credential_namespace_digest=$1 AND consumed_at IS NULL "
      + "AND invalidated_at IS NULL RETURNING challenge_digest",
      [credentialNamespaceDigest, retiredAt],
    );
    await client.query("COMMIT");
    committed = true;
    revokedSessions = sessions.rows.length;
    invalidatedChallenges = challenges.rows.length;
  } catch (error) {
    if (externalRetired) return failCleanupPending();
    if (error instanceof IdentitySessionError) throw error;
    destroy = true;
    return fail();
  } finally {
    if (!committed) {
      try { await client.query("ROLLBACK"); } catch { destroy = true; }
    }
    client.release(destroy);
  }

  try {
    const authorityReadback = await originPolicy.readCurrentAuthority(credentialNamespaceDigest);
    if (authorityReadback.status !== "DISABLED"
      || authorityReadback.monotonicGeneration !== targetEpoch
      || authorityReadback.lastControlAction !== "RETIRE"
      || authorityReadback.lastControlOperationId !== operationId) return failCleanupPending();
    const readbackClient = await pool.connect();
    let readbackDestroy = false;
    let dbCurrent = false;
    try {
      const dbReadback = await readbackClient.query(
        `/* identity197:read-google-policy-retirement */ SELECT enabled,current_epoch,reconciliation_digest `
        + `FROM ${POLICIES} WHERE provider=$1 AND credential_namespace_digest=$2`,
        [GOOGLE, credentialNamespaceDigest],
      );
      dbCurrent = dbReadback.rows.length === 1
        && dbReadback.rows[0].enabled === false
        && Number(dbReadback.rows[0].current_epoch) === targetEpoch
        && dbReadback.rows[0].reconciliation_digest === null;
    } catch {
      readbackDestroy = true;
    } finally {
      readbackClient.release(readbackDestroy);
    }
    if (!dbCurrent) return failCleanupPending();
  } catch (error) {
    if (error instanceof IdentitySessionError
      && error.code === "AUTHORITY_RETIRED_DB_CLEANUP_PENDING") throw error;
    return failCleanupPending();
  }

  return Object.freeze({
    provider: GOOGLE,
    credentialNamespaceDigest,
    retiredEpoch: targetEpoch,
    revokedSessions,
    invalidatedChallenges,
  });
}
