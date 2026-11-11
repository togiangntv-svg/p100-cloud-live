import { subscribeOwnerRevocation, assertIdentityNotRetired } from '../identity/session-core';
import { randomUUID } from "node:crypto";
import type {
  M3PermissionGrantReceipt,
  M3PermissionGrantRequest,
  M3PermissionReceipt,
  M3PermissionRequest,
  M3PermissionRevokeReceipt,
  M3PermissionRevokeRequest,
} from "@workspace/api-zod";

export const M3_PERMISSION_LIMITS = Object.freeze({
  futureSkewMs: 30_000,
  commandAgeMs: 120_000,
  activeGrants: 256,
  replayRecords: 1024,
});

export type M3IdentityContext = Readonly<{
  sessionKey: string;
  owner: Readonly<{ subjectId: string; profileId: string }>;
  validUntil: string;
}>;

export class M3PermissionError extends Error {
  readonly status: number;
  readonly retryable: false;
  constructor(readonly code: string, status: number) {
    super(code);
    this.name = "M3PermissionError";
    this.status = status;
    this.retryable = false;
  }
}

type Grant = Readonly<{
  grantId: string;
  grantOperationId: string;
  sessionKey: string;
  owner: M3IdentityContext["owner"];
  identityValidUntil: string;
  validUntil: string;
  taskSessionId: string;
  taskId: string;
  taskRevision: number;
  permissionRevision: number;
  processGeneration: string;
}>;
type ReplayRecord = {
  hash: string;
  recordedAt: number;
  receipt?: M3PermissionReceipt;
  revoked: boolean;
  revocation?: Readonly<{
    operationId: string;
    hash: string;
    receipt: M3PermissionRevokeReceipt;
  }>;
};
type ActiveOperation = {
  grantId: string;
  controller: AbortController;
  finished: boolean;
};
export type M3OperationGuard = Readonly<{
  operationKey: string;
  grantId: string;
  processGeneration: string;
  identity: M3IdentityContext;
  scope: Readonly<{
    taskSessionId: string;
    taskId: string;
    taskRevision: number;
    permissionRevision: number;
  }>;
  signal: AbortSignal;
}>;

const fail = (code: string, status: number): never => {
  throw new M3PermissionError(code, status);
};
const positiveRevision = (value: unknown): value is number => Number.isSafeInteger(value)
  && Number(value) > 0 && Number(value) <= 1_000_000_000;
const bounded = (value: unknown, min: number, max: number): value is string =>
  typeof value === "string" && value.length >= min && value.length <= max && value.trim().length > 0;
const stableHash = (request: M3PermissionRequest): string => JSON.stringify({
  ...request,
  createdAt: request.createdAt instanceof Date ? request.createdAt.toISOString() : request.createdAt,
});

export function createM3PermissionAuthority(options: Readonly<{
  now?: () => number;
  newId?: () => string;
}> = {}) {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomUUID;
  const processGeneration = newId();
  const grants = new Map<string, Grant>();
  const activeBySession = new Map<string, string>();
  const records = new Map<string, ReplayRecord>();
  const operations = new Map<string, ActiveOperation>();

  const currentTime = (): number => {
    const value = now();
    if (!Number.isFinite(value)) return fail("M3_AUTHORITY_UNAVAILABLE", 503);
    return value;
  };
  const recordKey = (sessionKey: string, operationId: string) =>
    JSON.stringify([sessionKey, operationId]);
  const validIdentity = (identity: M3IdentityContext, at = currentTime()): number => {
    if (!bounded(identity?.sessionKey, 8, 128)
      || !bounded(identity?.owner?.subjectId, 1, 128)
      || !bounded(identity?.owner?.profileId, 1, 128)) return fail("M3_IDENTITY_INVALID", 401);
    assertIdentityNotRetired(identity.owner, identity.sessionKey);
    const validUntil = Date.parse(identity.validUntil);
    if (!Number.isFinite(validUntil) || validUntil <= at) return fail("M3_IDENTITY_INVALID", 401);
    return validUntil;
  };
  const validateCommand = (request: M3PermissionRequest, at = currentTime()) => {
    if (request.version !== "m3.v1" || request.purpose !== "m3_intent_understanding"
      || !bounded(request.operationId, 8, 100)
      || !bounded(request.taskSessionId, 1, 100)
      || !bounded(request.taskId, 1, 180)
      || !positiveRevision(request.taskRevision)
      || !positiveRevision(request.permissionRevision)) return fail("M3_PERMISSION_REQUEST_INVALID", 400);
    const createdAt = request.createdAt instanceof Date
      ? request.createdAt.getTime() : Date.parse(String(request.createdAt));
    if (!Number.isFinite(createdAt)
      || createdAt > at + M3_PERMISSION_LIMITS.futureSkewMs
      || at - createdAt > M3_PERMISSION_LIMITS.commandAgeMs) {
      return fail("M3_PERMISSION_COMMAND_EXPIRED", 400);
    }
    if (request.action === "GRANT" && request.accepted !== true) {
      return fail("M3_PERMISSION_REQUEST_INVALID", 400);
    }
    if (request.action === "REVOKE" && (!bounded(request.grantOperationId, 8, 100)
      || request.grantOperationId === request.operationId
      || (request.grantId !== undefined && !bounded(request.grantId, 8, 100)))) {
      return fail("M3_PERMISSION_REQUEST_INVALID", 400);
    }
  };
  const retireGrant = (grantId: string) => {
    const grant = grants.get(grantId);
    if (!grant) return;
    grants.delete(grantId);
    if (activeBySession.get(grant.sessionKey) === grantId) activeBySession.delete(grant.sessionKey);
    const grantRecord = records.get(recordKey(grant.sessionKey, grant.grantOperationId));
    if (grantRecord) grantRecord.revoked = true;
    for (const operation of operations.values()) {
      if (operation.grantId === grantId && !operation.finished) operation.controller.abort();
    }
  };
  const prune = (at = currentTime()) => {
    for (const grant of grants.values()) {
      if (Date.parse(grant.validUntil) <= at) retireGrant(grant.grantId);
    }
    for (const [key, record] of records) {
      if (record.recordedAt + M3_PERMISSION_LIMITS.commandAgeMs < at) records.delete(key);
    }
  };
  const reserveRecords = (count: number, at = currentTime()) => {
    prune(at);
    if (records.size + count > M3_PERMISSION_LIMITS.replayRecords) {
      return fail("M3_AUTHORITY_UNAVAILABLE", 503);
    }
  };
  const sameIdentity = (grant: Grant, identity: M3IdentityContext): boolean =>
    grant.sessionKey === identity.sessionKey
    && grant.owner.subjectId === identity.owner.subjectId
    && grant.owner.profileId === identity.owner.profileId
    && grant.identityValidUntil === identity.validUntil
    && grant.processGeneration === processGeneration;
  const sameScope = (grant: Grant, scope: M3OperationGuard["scope"]): boolean =>
    grant.taskSessionId === scope.taskSessionId && grant.taskId === scope.taskId
    && grant.taskRevision === scope.taskRevision
    && grant.permissionRevision === scope.permissionRevision;
  const requireGrant = (
    identity: M3IdentityContext,
    input: Readonly<M3OperationGuard["scope"] & { grantId: string }>,
  ): Grant => {
    validIdentity(identity);
    prune();
    const grant = grants.get(input.grantId);
    if (!grant || activeBySession.get(identity.sessionKey) !== grant.grantId
      || !sameIdentity(grant, identity) || !sameScope(grant, input)) {
      return fail("M3_PERMISSION_DENIED", 403);
    }
    return grant;
  };

  const grant = (identity: M3IdentityContext, request: M3PermissionGrantRequest) => {
    const at = currentTime();
    const validUntil = validIdentity(identity, at);
    validateCommand(request, at);
    const key = recordKey(identity.sessionKey, request.operationId);
    const hash = stableHash(request);
    const replay = records.get(key);
    if (replay) {
      if (replay.revoked) return fail("M3_PERMISSION_REVOKED", 409);
      if (replay.hash !== hash) return fail("M3_PERMISSION_IDEMPOTENCY_CONFLICT", 409);
      if (replay.receipt?.action !== "GRANT") return fail("M3_PERMISSION_IDEMPOTENCY_CONFLICT", 409);
      return replay.receipt;
    }
    reserveRecords(1, at);
    if (grants.size >= M3_PERMISSION_LIMITS.activeGrants
      && !activeBySession.has(identity.sessionKey)) return fail("M3_AUTHORITY_UNAVAILABLE", 503);
    const prior = activeBySession.get(identity.sessionKey);
    if (prior) retireGrant(prior);
    const grantId = newId();
    if (!bounded(grantId, 8, 100)) return fail("M3_AUTHORITY_UNAVAILABLE", 503);
    const value: Grant = Object.freeze({
      grantId,
      grantOperationId: request.operationId,
      sessionKey: identity.sessionKey,
      owner: Object.freeze({ ...identity.owner }),
      identityValidUntil: identity.validUntil,
      validUntil: new Date(Math.min(validUntil, at + M3_PERMISSION_LIMITS.commandAgeMs)).toISOString(),
      taskSessionId: request.taskSessionId,
      taskId: request.taskId,
      taskRevision: request.taskRevision,
      permissionRevision: request.permissionRevision,
      processGeneration,
    });
    const receipt: M3PermissionGrantReceipt = Object.freeze({
      version: "m3.v1", action: "GRANT", purpose: "m3_intent_understanding",
      operationId: request.operationId, grantId, taskSessionId: request.taskSessionId,
      taskId: request.taskId, taskRevision: request.taskRevision,
      permissionRevision: request.permissionRevision, expiresAt: new Date(value.validUntil),
    });
    grants.set(grantId, value);
    activeBySession.set(identity.sessionKey, grantId);
    records.set(key, { hash, recordedAt: at, receipt, revoked: false });
    return receipt;
  };

  const revoke = (identity: M3IdentityContext, request: M3PermissionRevokeRequest) => {
    const at = currentTime();
    validIdentity(identity, at);
    validateCommand(request, at);
    const hash = stableHash(request);
    const grantKey = recordKey(identity.sessionKey, request.grantOperationId);
    const grantRecord = records.get(grantKey);
    if (grantRecord?.revocation?.operationId === request.operationId) {
      if (grantRecord.revocation.hash !== hash) {
        return fail("M3_PERMISSION_IDEMPOTENCY_CONFLICT", 409);
      }
      return grantRecord.revocation.receipt;
    }
    if (!grantRecord) reserveRecords(1, at);
    const recordedGrant = grantRecord?.receipt?.action === "GRANT" ? grantRecord.receipt : undefined;
    if (recordedGrant && (request.taskSessionId !== recordedGrant.taskSessionId
      || request.taskId !== recordedGrant.taskId
      || request.taskRevision < recordedGrant.taskRevision
      || request.permissionRevision < recordedGrant.permissionRevision
      || (request.grantId !== undefined && request.grantId !== recordedGrant.grantId))) {
      return fail("M3_PERMISSION_DENIED", 403);
    }
    const currentId = activeBySession.get(identity.sessionKey);
    const current = currentId ? grants.get(currentId) : undefined;
    if (current?.grantOperationId === request.grantOperationId) {
      if ((request.grantId && request.grantId !== current.grantId)
        || !sameIdentity(current, identity)
        || current.taskSessionId !== request.taskSessionId
        || current.taskId !== request.taskId
        || request.taskRevision < current.taskRevision
        || request.permissionRevision < current.permissionRevision) {
        return fail("M3_PERMISSION_DENIED", 403);
      }
      retireGrant(current.grantId);
    }
    const receipt: M3PermissionRevokeReceipt = Object.freeze({
      version: "m3.v1", action: "REVOKE", purpose: "m3_intent_understanding",
      operationId: request.operationId, grantOperationId: request.grantOperationId,
      ...(request.grantId ? { grantId: request.grantId } : {}),
      taskSessionId: request.taskSessionId, taskId: request.taskId,
      taskRevision: request.taskRevision, permissionRevision: request.permissionRevision,
      revoked: true,
    });
    const revocation = Object.freeze({ operationId: request.operationId, hash, receipt });
    if (grantRecord) {
      grantRecord.revoked = true;
      grantRecord.revocation = revocation;
    } else {
      records.set(grantKey, {
        hash: "REVOKED_BEFORE_GRANT", recordedAt: at, revoked: true, revocation,
      });
    }
    return receipt;
  };

  const unsubscribeRetirement = subscribeOwnerRevocation(event => {
    const sessions = new Set(event.sessionKeys), retiredGrantIds = new Set<string>();
    for (const grant of [...grants.values()]) {
      if ((event.retired && grant.owner.subjectId === event.owner.subjectId
        && grant.owner.profileId === event.owner.profileId) || sessions.has(grant.sessionKey)) {
        sessions.add(grant.sessionKey); retiredGrantIds.add(grant.grantId); retireGrant(grant.grantId);
      }
    }
    for (const [key, operation] of [...operations]) if (retiredGrantIds.has(operation.grantId)) {
      operation.controller.abort(); operations.delete(key);
    }
    for (const key of [...records.keys()]) {
      if (sessions.has(JSON.parse(key)[0])) records.delete(key);
    }
  });
  return Object.freeze({
    dispose() { unsubscribeRetirement(); for (const id of [...grants.keys()]) retireGrant(id); records.clear(); operations.clear(); },
    handle(identity: M3IdentityContext, request: M3PermissionRequest): M3PermissionReceipt {
      return request.action === "GRANT" ? grant(identity, request) : revoke(identity, request);
    },
    beginOperation(identity: M3IdentityContext, input: Readonly<{
      operationId: string;
      grantId: string;
      taskSessionId: string;
      taskId: string;
      taskRevision: number;
      permissionRevision: number;
    }>): M3OperationGuard {
      if (!bounded(input.operationId, 8, 100)) return fail("M3_OPERATION_INVALID", 400);
      const grantValue = requireGrant(identity, input);
      const operationKey = JSON.stringify([identity.sessionKey, input.operationId]);
      if (operations.has(operationKey)) return fail("M3_REQUEST_IN_FLIGHT", 409);
      const controller = new AbortController();
      operations.set(operationKey, { grantId: grantValue.grantId, controller, finished: false });
      return Object.freeze({
        operationKey,
        grantId: grantValue.grantId,
        processGeneration,
        identity: Object.freeze({ ...identity, owner: Object.freeze({ ...identity.owner }) }),
        scope: Object.freeze({
          taskSessionId: input.taskSessionId,
          taskId: input.taskId,
          taskRevision: input.taskRevision,
          permissionRevision: input.permissionRevision,
        }),
        signal: controller.signal,
      });
    },
    assertCurrent(guard: M3OperationGuard, identity: M3IdentityContext): void {
      const operation = operations.get(guard.operationKey);
      if (!operation || operation.finished || operation.controller.signal.aborted
        || guard.processGeneration !== processGeneration) return fail("M3_OPERATION_RETIRED", 409);
      requireGrant(identity, { grantId: guard.grantId, ...guard.scope });
      if (identity.sessionKey !== guard.identity.sessionKey
        || identity.owner.subjectId !== guard.identity.owner.subjectId
        || identity.owner.profileId !== guard.identity.owner.profileId
        || identity.validUntil !== guard.identity.validUntil) return fail("M3_IDENTITY_DRIFT", 409);
    },
    cancelOperation(guard: M3OperationGuard): void {
      const operation = operations.get(guard.operationKey);
      if (operation && !operation.finished) operation.controller.abort();
    },
    finishOperation(guard: M3OperationGuard): void {
      const operation = operations.get(guard.operationKey);
      if (operation) operation.finished = true;
      operations.delete(guard.operationKey);
    },
    inspect() {
      prune();
      return Object.freeze({ grants: grants.size, records: records.size, operations: operations.size });
    },
  });
}

export type M3PermissionAuthority = ReturnType<typeof createM3PermissionAuthority>;
