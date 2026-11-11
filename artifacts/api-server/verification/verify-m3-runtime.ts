import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createM3Handler } from "../src/ai/m3-operation";
import {
  createM3PermissionAuthority,
  M3PermissionError,
  type M3IdentityContext,
} from "../src/ai/m3-permission";

const OWNER_A = Object.freeze({ subjectId: "owner-a", profileId: "profile-a" });
const OWNER_B = Object.freeze({ subjectId: "owner-b", profileId: "profile-b" });
let now = Date.now();
let id = 0;
const identity = (
  sessionKey = "session-key-a",
  owner = OWNER_A,
  validUntil = new Date(now + 60_000).toISOString(),
): M3IdentityContext => Object.freeze({ sessionKey, owner, validUntil });
const scope = Object.freeze({
  taskSessionId: "task-session-1",
  taskId: "task-1",
  taskRevision: 1,
  permissionRevision: 1,
});
const grantRequest = (operationId = "grant-op-0001", override = {}) => ({
  version: "m3.v1" as const,
  action: "GRANT" as const,
  purpose: "m3_intent_understanding" as const,
  operationId,
  ...scope,
  accepted: true as const,
  createdAt: new Date(now),
  ...override,
});
const revokeRequest = (operationId: string, grantOperationId: string, override = {}) => ({
  version: "m3.v1" as const,
  action: "REVOKE" as const,
  purpose: "m3_intent_understanding" as const,
  operationId,
  grantOperationId,
  ...scope,
  createdAt: new Date(now),
  ...override,
});
const permission = () => createM3PermissionAuthority({
  now: () => now,
  newId: () => `permission-${(++id).toString().padStart(8, "0")}`,
});

class RequestFixture extends EventEmitter {
  headers: Record<string, string>;
  constructor(readonly body: unknown, token: string) {
    super();
    this.headers = { authorization: `Bearer ${token}` };
  }
}
class ResponseFixture extends EventEmitter {
  statusCode = 200;
  payload: unknown;
  destroyed = false;
  writableEnded = false;
  status(value: number) { this.statusCode = value; return this; }
  json(value: unknown) { this.payload = value; this.writableEnded = true; return this; }
}
const meaning = Object.freeze({
  intent_type: "CURRENT_TASK",
  interpreted_meaning: "Current task",
  confidence: 0.8,
  uncertainty: null,
  missing_context: Object.freeze([]),
  clarification_needed: false,
  clarification_question: null,
  safety_state: "CLEAR",
  suggested_next_role: "M4",
  task_kind: null,
  context_effect: "NONE",
  used_context_ids: Object.freeze([]),
  response: "Understood",
});
const requestBody = (grantId: string, requestId = "request-0001", override = {}) => ({
  version: "m3.v1",
  operation: "interpret",
  requestId,
  sessionId: scope.taskSessionId,
  taskId: scope.taskId,
  taskRevision: scope.taskRevision,
  permissionRevision: scope.permissionRevision,
  grantId,
  createdAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 60_000).toISOString(),
  locale: "vi",
  consent: { granted: true, version: "m3.v1", purpose: "m3_intent_understanding" },
  input: {
    locale: "vi",
    current_text: "Tiếp tục việc hiện tại",
    relevant_context: [],
    recent_relevant_turns: [],
    user_correction: null,
    safety_signal: "CLEAR",
    asking_stopped: false,
  },
  ...override,
});

function operationFixture(input: Readonly<{
  authority: ReturnType<typeof permission>;
  identities?: M3IdentityContext[];
  enabled?: boolean;
  interpret?: (signal: AbortSignal) => Promise<{ meaning: unknown; usage: { inputTokens: number; outputTokens: number } }>;
  record?: () => Promise<void>;
}>) {
  let providerCalls = 0;
  let identityReads = 0;
  let records = 0;
  const identities = input.identities ?? [identity()];
  const handler = createM3Handler({
    enabled: () => input.enabled ?? true,
    available: () => {},
    async verifyIdentity() {
      const value = identities[Math.min(identityReads++, identities.length - 1)];
      if (!value || Date.parse(value.validUntil) <= now) {
        const error = new Error("INVALID_SESSION");
        error.name = "IdentitySessionError";
        throw error;
      }
      return value;
    },
    permission: input.authority,
    acquire: () => {},
    release: () => {},
    reserve: async () => {},
    async record() { records++; await input.record?.(); },
    async interpret(_language, signal) {
      providerCalls++;
      return input.interpret?.(signal) ?? { meaning, usage: { inputTokens: 2, outputTokens: 3 } };
    },
    audit: () => {},
    diagnose: () => {},
    timeoutMs: 100,
  });
  return Object.freeze({
    async call(body: unknown, token = "token-a") {
      const req = new RequestFixture(body, token);
      const res = new ResponseFixture();
      await handler(req as never, res as never);
      return res;
    },
    counts: () => ({ providerCalls, identityReads, records }),
  });
}

let passed = 0;
async function check(name: string, work: () => void | Promise<void>) {
  await work();
  passed++;
  console.log(`PASS ${name}`);
}

async function main() {
  await check("T01 unauthenticated and expired Identity cannot grant, revoke, send, or publish", async () => {
    const authority = permission();
    const expired = identity("expired-key", OWNER_A, new Date(now - 1).toISOString());
    assert.throws(() => authority.handle(expired, grantRequest()), M3PermissionError);
    const runtime = operationFixture({ authority, identities: [expired] });
    const result = await runtime.call(requestBody("unknown-grant"));
    assert.equal(result.statusCode, 401, JSON.stringify(result.payload));
    assert.equal(runtime.counts().providerCalls, 0);
  });

  await check("T03 one current grant per Identity session", () => {
    const authority = permission();
    const first = authority.handle(identity(), grantRequest("grant-op-0002"));
    const second = authority.handle(identity(), grantRequest("grant-op-0003", { taskId: "task-2" }));
    assert.equal(first.action, "GRANT");
    assert.equal(second.action, "GRANT");
    assert.throws(() => authority.beginOperation(identity(), {
      operationId: "send-old-001", grantId: first.grantId, ...scope,
    }), (error: unknown) => error instanceof M3PermissionError && error.code === "M3_PERMISSION_DENIED");
    assert.equal(authority.inspect().grants, 1);
  });

  await check("T04 same operation/body is idempotent and changed body conflicts", () => {
    const authority = permission();
    const request = grantRequest("grant-op-0004");
    const first = authority.handle(identity(), request);
    assert.deepEqual(authority.handle(identity(), request), first);
    assert.throws(() => authority.handle(identity(), { ...request, taskId: "changed-task" }),
      (error: unknown) => error instanceof M3PermissionError
        && error.code === "M3_PERMISSION_IDEMPOTENCY_CONFLICT");
    const revoke = revokeRequest("revoke-op-004", request.operationId, {
      grantId: first.action === "GRANT" ? first.grantId : undefined,
      taskRevision: 2,
      permissionRevision: 2,
    });
    const revoked = authority.handle(identity(), revoke);
    assert.deepEqual(authority.handle(identity(), revoke), revoked);
    assert.throws(() => authority.handle(identity(), { ...revoke, taskId: "changed-task" }),
      (error: unknown) => error instanceof M3PermissionError
        && error.code === "M3_PERMISSION_IDEMPOTENCY_CONFLICT");
  });

  await check("T05 revoke followed by old GRANT replay cannot resurrect", () => {
    const authority = permission();
    const request = grantRequest("grant-op-0005");
    const receipt = authority.handle(identity(), request);
    assert.equal(receipt.action, "GRANT");
    authority.handle(identity(), revokeRequest("revoke-op-005", request.operationId, {
      grantId: receipt.grantId,
      taskRevision: 2,
      permissionRevision: 2,
    }));
    assert.throws(() => authority.handle(identity(), request),
      (error: unknown) => error instanceof M3PermissionError && error.code === "M3_PERMISSION_REVOKED");
    assert.equal(authority.inspect().grants, 0);
  });

  await check("T06 pending GRANT tombstone blocks late grant success", () => {
    const authority = permission();
    authority.handle(identity(), revokeRequest("revoke-op-006", "grant-op-0006"));
    assert.throws(() => authority.handle(identity(), grantRequest("grant-op-0006")), M3PermissionError);
    assert.equal(authority.inspect().grants, 0);
  });

  await check("T07 session, task, revision, and permission drift fail closed", () => {
    const authority = permission();
    const receipt = authority.handle(identity(), grantRequest("grant-op-0007"));
    assert.equal(receipt.action, "GRANT");
    for (const drift of [
      { taskSessionId: "other-session" },
      { taskId: "other-task" },
      { taskRevision: 2 },
      { permissionRevision: 2 },
    ]) assert.throws(() => authority.beginOperation(identity(), {
      operationId: `drift-${JSON.stringify(drift)}`.slice(0, 99),
      grantId: receipt.grantId,
      ...scope,
      ...drift,
    }), M3PermissionError);
    assert.throws(() => authority.handle(identity(), revokeRequest(
      "revoke-drift-007", "grant-op-0007", { grantId: receipt.grantId, taskId: "other-task" },
    )), (error: unknown) => error instanceof M3PermissionError
      && error.code === "M3_PERMISSION_DENIED");
    const stillCurrent = authority.beginOperation(identity(), {
      operationId: "drift-survives-07", grantId: receipt.grantId, ...scope,
    });
    authority.finishOperation(stillCurrent);
  });

  await check("T08 credential A cannot complete with credential B", () => {
    const authority = permission();
    const receipt = authority.handle(identity(), grantRequest("grant-op-0008"));
    assert.equal(receipt.action, "GRANT");
    assert.throws(() => authority.beginOperation(identity("session-key-b", OWNER_B), {
      operationId: "credential-b-001", grantId: receipt.grantId, ...scope,
    }), M3PermissionError);
  });

  await check("T09 restart restores zero authority and rejects old grant", () => {
    const first = permission();
    const receipt = first.handle(identity(), grantRequest("grant-op-0009"));
    assert.equal(receipt.action, "GRANT");
    const restarted = permission();
    assert.equal(restarted.inspect().grants, 0);
    assert.throws(() => restarted.beginOperation(identity(), {
      operationId: "restart-send-1", grantId: receipt.grantId, ...scope,
    }), M3PermissionError);
  });

  await check("T10 unknown cross-worker RAM authority fails closed", () => {
    const workerA = permission();
    const workerB = permission();
    const receipt = workerA.handle(identity(), grantRequest("grant-op-0010"));
    assert.equal(receipt.action, "GRANT");
    assert.throws(() => workerB.beginOperation(identity(), {
      operationId: "cross-worker-01", grantId: receipt.grantId, ...scope,
    }), M3PermissionError);
  });

  await check("T11 grant and replay capacity exhaust safely without eviction", () => {
    const authority = permission();
    for (let index = 0; index < 256; index++) {
      const suffix = index.toString().padStart(4, "0");
      authority.handle(identity(`capacity-session-${suffix}`, {
        subjectId: `owner-${suffix}`, profileId: `profile-${suffix}`,
      }), grantRequest(`capacity-grant-${suffix}`));
    }
    assert.throws(() => authority.handle(identity("capacity-session-over", {
      subjectId: "owner-over", profileId: "profile-over",
    }), grantRequest("capacity-grant-over")),
    (error: unknown) => error instanceof M3PermissionError
      && error.code === "M3_AUTHORITY_UNAVAILABLE" && error.retryable === false);
    assert.equal(authority.inspect().grants, 256);

    const replayAuthority = permission();
    let lastGrant;
    for (let index = 0; index < 1024; index++) {
      lastGrant = replayAuthority.handle(identity(),
        grantRequest(`replay-capacity-${index.toString().padStart(4, "0")}`));
    }
    assert.equal(replayAuthority.inspect().records, 1024);
    assert.equal(lastGrant?.action, "GRANT");
    const revoke = replayAuthority.handle(identity(), revokeRequest(
      "revoke-at-capacity", "replay-capacity-1023",
      { grantId: lastGrant?.action === "GRANT" ? lastGrant.grantId : undefined,
        taskRevision: 2, permissionRevision: 2 },
    ));
    assert.equal(revoke.action, "REVOKE");
    assert.equal(replayAuthority.inspect().grants, 0);
  });

  await check("T12 revoke during provider await blocks publish and aborts dependent operation", async () => {
    const authority = permission();
    const grant = authority.handle(identity(), grantRequest("grant-op-0012"));
    assert.equal(grant.action, "GRANT");
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const runtime = operationFixture({
      authority,
      async interpret() {
        entered();
        return await new Promise(() => {});
      },
    });
    const pending = runtime.call(requestBody(grant.grantId, "request-0012"));
    await started;
    authority.handle(identity(), revokeRequest("revoke-op-012", "grant-op-0012", {
      grantId: grant.grantId, taskRevision: 2, permissionRevision: 2,
    }));
    const result = await pending;
    assert.equal(result.statusCode, 409);
    assert.equal(runtime.counts().records, 0);
  });

  await check("T13 provider ignoring abort cannot create truth or automatic retry", async () => {
    const authority = permission();
    const grant = authority.handle(identity(), grantRequest("grant-op-0013"));
    assert.equal(grant.action, "GRANT");
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const runtime = operationFixture({
      authority,
      async interpret() { entered(); return await new Promise(() => {}); },
    });
    const pending = runtime.call(requestBody(grant.grantId, "request-0013"));
    await started;
    authority.handle(identity(), revokeRequest("revoke-op-013", "grant-op-0013", {
      grantId: grant.grantId, taskRevision: 2, permissionRevision: 2,
    }));
    assert.equal((await pending).statusCode, 409);
    assert.equal(runtime.counts().providerCalls, 1);
    assert.equal(runtime.counts().records, 0);
  });

  await check("T14 private identity and generation values do not leak", () => {
    const authority = permission();
    const receipt = authority.handle(identity("PRIVATE_SESSION_KEY"), grantRequest("grant-op-0014"));
    const serialized = JSON.stringify(receipt);
    assert.doesNotMatch(serialized, /PRIVATE_SESSION_KEY|owner-a|profile-a|generation/iu);
    assert.doesNotMatch(JSON.stringify(authority.inspect()), /PRIVATE_SESSION_KEY|owner-a|profile-a/iu);
  });

  await check("T15 CANCEL retires one operation; REVOKE retires the grant", () => {
    const authority = permission();
    const grant = authority.handle(identity(), grantRequest("grant-op-0015"));
    assert.equal(grant.action, "GRANT");
    const first = authority.beginOperation(identity(), {
      operationId: "cancel-op-001", grantId: grant.grantId, ...scope,
    });
    authority.cancelOperation(first);
    authority.finishOperation(first);
    const second = authority.beginOperation(identity(), {
      operationId: "cancel-op-002", grantId: grant.grantId, ...scope,
    });
    authority.finishOperation(second);
    authority.handle(identity(), revokeRequest("revoke-op-015", "grant-op-0015", {
      grantId: grant.grantId, taskRevision: 2, permissionRevision: 2,
    }));
    assert.throws(() => authority.beginOperation(identity(), {
      operationId: "cancel-op-003", grantId: grant.grantId, ...scope,
    }), M3PermissionError);
  });

  await check("T16 late result after Identity drift is discarded", async () => {
    const authority = permission();
    const grant = authority.handle(identity(), grantRequest("grant-op-0016"));
    assert.equal(grant.action, "GRANT");
    const runtime = operationFixture({
      authority,
      identities: [identity(), identity(), identity("session-key-b", OWNER_B)],
    });
    const result = await runtime.call(requestBody(grant.grantId, "request-0016"));
    assert.ok([403, 409].includes(result.statusCode));
    assert.equal(runtime.counts().records, 0);
  });

  await check("T18 LIVE_M3 off blocks provider before authority use", async () => {
    const authority = permission();
    const runtime = operationFixture({ authority, enabled: false });
    const result = await runtime.call(requestBody("no-live-grant", "request-0018"));
    assert.equal(result.statusCode, 503);
    assert.equal(runtime.counts().providerCalls, 0);
  });

  assert.equal(passed, 16);
  console.log(`M3 Identity/permission verifier: ${passed}/16 PASS`);
  console.log("Live provider calls: 0; all provider boundaries were deterministic fixtures");
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
