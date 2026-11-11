import {
  aiM3,
  aiM3Permission,
  type M3PermissionRequest as GeneratedM3PermissionRequest,
  type M3Request as GeneratedM3Request,
} from "@workspace/api-client-react";
import {
  readM3PermissionReceipt,
  readM3Response,
  type M3PermissionGrantRequest,
  type M3PermissionRequest,
  type M3Request,
} from "../../../../lib/api-zod/src/m3-contract";
import type { IdentityRequestAuthorization } from "../identity/client-session";
import { M3_PATH, M3_PURPOSE, M3_VERSION, type IntentMeaning, type LanguageInput } from "./contract";
import type { M3LanguageAdapter, M3Operation, M3Revocation } from "./resolver";

type M3WireContext = NonNullable<GeneratedM3Request["input"]>["relevant_context"][number];
type GrantState = {
  grantOperationId: string;
  grantId?: string;
  active: boolean;
};

export type M3Http = (url: string, init: Readonly<{
  method: "POST";
  headers: Readonly<Record<string, string>>;
  body: string;
  credentials: "omit";
  redirect: "error";
  signal: AbortSignal;
}>) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const hasExternalContextPermission = (operation: M3Operation): boolean =>
  operation.permission.external_access === "M3_TEXT"
  && operation.permission.purpose === M3_PURPOSE
  && Number.isSafeInteger(operation.permission.revision)
  && operation.permission.revision > 0
  && operation.permission.revision === operation.ticket.permission_revision;
const projectWireContext = (context: LanguageInput["relevant_context"][number]): M3WireContext => {
  const priorM7 = context.kind === "prior_episode:m7_outcome"
    || context.kind === "prior_episode:safety_reassessment";
  return Object.freeze({
    id: priorM7 ? `m7-prior:${context.text.toLowerCase().replaceAll("_", "-")}` : context.id,
    kind: context.kind === "workout" || context.kind === "active_task:workout" ? "workout" : "other",
    text: context.text,
    permission: "external_ai_allowed" as const,
  });
};
function mapWireMeaning(raw: unknown, body: M3Request): IntentMeaning {
  const value = readM3Response(raw, body);
  return {
    intent_type: value.intentType,
    interpreted_meaning: value.interpretedMeaning,
    confidence: value.confidence,
    uncertainty: value.uncertainty,
    missing_context: value.missingContext,
    clarification_needed: value.clarificationNeeded,
    clarification_question: value.clarificationQuestion,
    safety_state: value.safetyState,
    suggested_next_role: value.suggestedNextRole,
    task_kind: value.taskKind,
    context_effect: value.contextEffect,
    used_context_ids: value.usedContextIds,
    response: value.response,
  };
}

export function createM3GatewayAdapter(options: {
  origin?: string;
  http?: M3Http;
  authorization: IdentityRequestAuthorization;
  isSessionCurrent: (sessionId: string) => boolean;
  provenance?: "PRODUCTION" | "TEST_FIXTURE";
  timeoutMs?: number;
  serverTimeoutMs?: number;
}): M3LanguageAdapter {
  const serverTimeoutMs = options.serverTimeoutMs ?? 33_000;
  const clientTimeoutMs = options.timeoutMs ?? 38_000;
  if (!Number.isSafeInteger(serverTimeoutMs) || serverTimeoutMs <= 0
    || !Number.isSafeInteger(clientTimeoutMs) || clientTimeoutMs > 2_147_483_647
    || clientTimeoutMs - serverTimeoutMs < 4_000) throw new Error("M3_TIMEOUT_HIERARCHY_INVALID");
  const origin = options.origin ?? "http://localhost";
  const parsed = new URL(origin);
  if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)))
    || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("M3_ENDPOINT_INVALID");
  }
  const endpoint = parsed.origin + M3_PATH;
  const permissionEndpoint = parsed.origin + "/api/ai/m3/permission";
  const grants = new Map<string, GrantState>();
  const scopeKey = (ticket: M3Operation["ticket"]) =>
    JSON.stringify([ticket.session_id, ticket.task_id]);
  const statusError = (status: number): never => {
    throw new Error(status === 401 ? "M3_AUTH_REQUIRED" : status === 403
      ? "M3_PERMISSION_DENIED" : status === 409 ? "M3_STALE_SCOPE"
        : status === 429 ? "M3_BUDGET_OR_RATE_LIMIT" : "M3_GATEWAY_FAILED");
  };
  const send = async (
    url: string,
    body: M3Request | M3PermissionRequest,
    signal: AbortSignal,
    valid: () => boolean,
  ): Promise<unknown> => {
    if (signal.aborted || !valid()) throw new Error("M3_STALE_SCOPE");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, clientTimeoutMs);
    let rejectAbort!: (error: Error) => void;
    const interrupted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(Object.assign(new Error('M3_GATEWAY_FAILED'), { retryable: true }));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    try {
      if (controller.signal.aborted) onAbort();
      const work = options.authorization.withBearer(controller.signal, async authorization => {
        if (controller.signal.aborted || !valid()) throw new Error("M3_STALE_SCOPE");
        const requestOptions = {
          headers: { Authorization: authorization },
          credentials: "omit" as const,
          redirect: "error" as const,
          signal: controller.signal,
        };
        const request = options.http
          ? options.http(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: authorization },
            body: JSON.stringify(body),
            credentials: "omit",
            redirect: "error",
            signal: controller.signal,
          })
          : url === permissionEndpoint
            ? aiM3Permission(body as unknown as GeneratedM3PermissionRequest, requestOptions)
            : aiM3(body as unknown as GeneratedM3Request, requestOptions);
        let result;
        try {
          result = await request;
        } catch (error) {
          const status = error && typeof error === "object" && "status" in error
            ? (error as { status?: unknown }).status : undefined;
          if (typeof status === "number") statusError(status);
          throw new Error("M3_GATEWAY_FAILED");
        }
        if ("ok" in result && !result.ok) statusError(result.status);
        const raw = "json" in result ? await result.json() : result;
        if (controller.signal.aborted || !valid()) throw new Error("M3_STALE_SCOPE");
        return raw;
      });
      return await Promise.race([work, interrupted]);
    } finally {
      controller.signal.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  };
  const envelope = (
    op: M3Operation,
    grantId: string,
    locale: LanguageInput["locale"],
  ): M3Request => ({
    version: M3_VERSION,
    operation: "interpret",
    requestId: op.ticket.operation_id,
    sessionId: op.ticket.session_id,
    taskId: op.ticket.task_id,
    taskRevision: op.ticket.task_revision,
    permissionRevision: op.ticket.permission_revision,
    grantId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    locale,
    consent: { granted: true, version: M3_VERSION, purpose: M3_PURPOSE },
    input: null,
  });

  return Object.freeze({
    provenance: options.provenance ?? "PRODUCTION",
    processing: "EXTERNAL" as const,
    contract: "M3_GATEWAY_V1" as const,
    async interpret(
      operationInput: { content: LanguageInput; operation: M3Operation },
      signal: AbortSignal,
    ): Promise<IntentMeaning> {
      const operation = operationInput.operation;
      if (!options.isSessionCurrent(operation.ticket.session_id) || !operation.isCurrent()) {
        throw new Error("M3_STALE_SCOPE");
      }
      if (!hasExternalContextPermission(operation)) throw new Error("M3_PERMISSION_DENIED");
      const key = scopeKey(operation.ticket);
      const state: GrantState = {
        grantOperationId: operation.ticket.operation_id,
        active: true,
      };
      grants.set(key, state);
      const grantRequest: M3PermissionGrantRequest = {
        version: M3_VERSION,
        action: "GRANT",
        purpose: M3_PURPOSE,
        operationId: state.grantOperationId,
        taskSessionId: operation.ticket.session_id,
        taskId: operation.ticket.task_id,
        taskRevision: operation.ticket.task_revision,
        permissionRevision: operation.ticket.permission_revision,
        accepted: true,
        createdAt: new Date().toISOString(),
      };
      const rawGrant = await send(permissionEndpoint, grantRequest, signal, () => state.active
        && grants.get(key) === state && options.isSessionCurrent(operation.ticket.session_id)
        && operation.isCurrent());
      const receipt = readM3PermissionReceipt(rawGrant, grantRequest);
      if (receipt.action !== "GRANT" || !state.active || grants.get(key) !== state
        || !options.isSessionCurrent(operation.ticket.session_id) || !operation.isCurrent()) {
        throw new Error("M3_STALE_SCOPE");
      }
      state.grantId = receipt.grantId;
      const body: M3Request = {
        ...envelope(operation, receipt.grantId, operationInput.content.locale),
        input: {
          ...operationInput.content,
          relevant_context: operationInput.content.relevant_context.map(projectWireContext),
        },
      };
      return mapWireMeaning(await send(endpoint, body, signal, () => state.active
        && grants.get(key) === state && state.grantId === body.grantId
        && options.isSessionCurrent(body.sessionId) && operation.isCurrent()), body);
    },
    async revoke(operation: M3Revocation) {
      const key = scopeKey(operation.ticket);
      const state = grants.get(key);
      if (!state) return;
      state.active = false;
      grants.delete(key);
      if (!options.isSessionCurrent(operation.ticket.session_id)) return;
      const request: M3PermissionRequest = {
        version: M3_VERSION,
        action: "REVOKE",
        purpose: M3_PURPOSE,
        operationId: operation.ticket.operation_id,
        grantOperationId: state.grantOperationId,
        ...(state.grantId ? { grantId: state.grantId } : {}),
        taskSessionId: operation.ticket.session_id,
        taskId: operation.ticket.task_id,
        taskRevision: operation.ticket.task_revision,
        permissionRevision: operation.ticket.permission_revision,
        createdAt: new Date().toISOString(),
      };
      const raw = await send(permissionEndpoint, request, new AbortController().signal,
        () => options.isSessionCurrent(operation.ticket.session_id));
      readM3PermissionReceipt(raw, request);
    },
  });
}
