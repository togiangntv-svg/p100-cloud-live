import {
  INTENT_TYPES, M3_MEANING_LIMITS, validateMeaning,
  type IntentMeaning, type LanguageInput,
} from "./m3-meaning";

import { M3_LOCALES } from "./m3-locales";

export const M3_VERSION = "m3.v1" as const;
export const M3_PURPOSE = "m3_intent_understanding" as const;
export const M3_PATH = "/api/ai/m3" as const;
export type M3Request = Readonly<{
  version: typeof M3_VERSION; operation: "interpret" | "revoke"; requestId: string; sessionId: string;
  taskId: string; taskRevision: number; permissionRevision: number; grantId: string;
  createdAt: string; expiresAt: string;
  locale: LanguageInput["locale"];
  consent: Readonly<{ granted: boolean; version: typeof M3_VERSION; purpose: typeof M3_PURPOSE }>;
  input: (Omit<LanguageInput, "relevant_context"> & {
    relevant_context: readonly Readonly<{ id: string; kind: "workout" | "other"; text: string; permission: "external_ai_allowed" }>[];
  }) | null;
}>;
export type M3Usage = Readonly<{ inputTokens: number; outputTokens: number }>;
const pairs = {
  intentType: "intent_type", interpretedMeaning: "interpreted_meaning", confidence: "confidence",
  uncertainty: "uncertainty", missingContext: "missing_context", clarificationNeeded: "clarification_needed",
  clarificationQuestion: "clarification_question", safetyState: "safety_state",
  suggestedNextRole: "suggested_next_role", taskKind: "task_kind", contextEffect: "context_effect",
  usedContextIds: "used_context_ids", response: "response",
} as const;
export type M3WireMeaning = { [K in keyof typeof pairs]: IntentMeaning[typeof pairs[K]] };
export type M3Response = M3WireMeaning & Readonly<{
  version: typeof M3_VERSION; requestId: string; sessionId: string; taskId: string;
  taskRevision: number; permissionRevision: number; usage: M3Usage;
}>;
export type M3RevocationReceipt = Readonly<{
  version: typeof M3_VERSION; requestId: string; sessionId: string; taskId: string;
  taskRevision: number; permissionRevision: number; revoked: true;
}>;
export type M3PermissionGrantRequest = Readonly<{
  version: typeof M3_VERSION; action: "GRANT"; purpose: typeof M3_PURPOSE; operationId: string;
  taskSessionId: string; taskId: string; taskRevision: number; permissionRevision: number;
  accepted: true; createdAt: string;
}>;
export type M3PermissionRevokeRequest = Readonly<{
  version: typeof M3_VERSION; action: "REVOKE"; purpose: typeof M3_PURPOSE; operationId: string;
  grantOperationId: string; grantId?: string; taskSessionId: string; taskId: string;
  taskRevision: number; permissionRevision: number; createdAt: string;
}>;
export type M3PermissionRequest = M3PermissionGrantRequest | M3PermissionRevokeRequest;
export type M3PermissionGrantReceipt = Readonly<{
  version: typeof M3_VERSION; action: "GRANT"; purpose: typeof M3_PURPOSE; operationId: string;
  grantId: string; taskSessionId: string; taskId: string; taskRevision: number;
  permissionRevision: number; expiresAt: string;
}>;
export type M3PermissionRevokeReceipt = Readonly<{
  version: typeof M3_VERSION; action: "REVOKE"; purpose: typeof M3_PURPOSE; operationId: string;
  grantOperationId: string; grantId?: string; taskSessionId: string; taskId: string;
  taskRevision: number; permissionRevision: number; revoked: true;
}>;
export type M3PermissionReceipt = M3PermissionGrantReceipt | M3PermissionRevokeReceipt;

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function exact(v: unknown, keys: readonly string[]): asserts v is Record<string, unknown> {
  if (!plain(v) || Object.keys(v).length !== keys.length || keys.some((key) => !Object.hasOwn(v, key))) {
    throw new Error("M3_SCHEMA_INVALID");
  }
}
const string = (v: unknown, max: number) => typeof v === "string" && !!v.trim() && v.length <= max;
const revision = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0 && Number(v) <= 1_000_000_000;
const oneOf = (v: unknown, list: readonly unknown[]) => list.includes(v);

export function parseM3Request(raw: unknown): M3Request {
  exact(raw, ["version", "operation", "requestId", "sessionId", "taskId", "taskRevision", "permissionRevision",
    "grantId", "createdAt", "expiresAt", "locale", "consent", "input"]);
  if (raw.version !== M3_VERSION || !oneOf(raw.operation, ["interpret", "revoke"])
    || !string(raw.requestId, 100) || String(raw.requestId).length < 8
    || !string(raw.sessionId, 100) || !string(raw.taskId, 180)
    || !revision(raw.taskRevision) || !revision(raw.permissionRevision) || !string(raw.grantId, 100)
    || String(raw.grantId).length < 8
    || !oneOf(raw.locale, M3_LOCALES) || !string(raw.createdAt, 40) || !string(raw.expiresAt, 40)
    || !Number.isFinite(Date.parse(String(raw.createdAt))) || !Number.isFinite(Date.parse(String(raw.expiresAt)))) {
    throw new Error("M3_SCHEMA_INVALID");
  }
  exact(raw.consent, ["granted", "version", "purpose"]);
  if (raw.consent.version !== M3_VERSION || raw.consent.purpose !== M3_PURPOSE
    || raw.consent.granted !== (raw.operation === "interpret")) throw new Error("M3_CONSENT_REQUIRED");
  if (raw.operation === "revoke") {
    if (raw.input !== null) throw new Error("M3_SCHEMA_INVALID");
    return raw as unknown as M3Request;
  }
  const input = raw.input;
  exact(input, ["locale", "current_text", "relevant_context", "recent_relevant_turns",
    "user_correction", "safety_signal", "asking_stopped"]);
  if (input.locale !== raw.locale || !string(input.current_text, 1000)
    || !oneOf(input.safety_signal, ["CLEAR", "SENSITIVE", "PAIN", "URGENT"])
    || typeof input.asking_stopped !== "boolean" || !Array.isArray(input.relevant_context)
    || input.relevant_context.length > 4 || !Array.isArray(input.recent_relevant_turns)
    || input.recent_relevant_turns.length > 6) throw new Error("M3_SCHEMA_INVALID");
  let chars = String(input.current_text).length;
  const ids = new Set<string>();
  for (const context of input.relevant_context) {
    exact(context, ["id", "kind", "text", "permission"]);
    if (!string(context.id, 80) || !oneOf(context.kind, ["workout", "other"])
      || !string(context.text, 1000) || ids.has(String(context.id))
      || context.permission !== "external_ai_allowed") throw new Error(
      context.permission === "external_ai_allowed" ? "M3_SCHEMA_INVALID" : "M3_CONTEXT_NOT_PERMITTED");
    ids.add(String(context.id)); chars += String(context.text).length;
  }
  for (const turn of input.recent_relevant_turns) {
    exact(turn, ["role", "text"]);
    if (!oneOf(turn.role, ["user", "assistant"]) || !string(turn.text, 1000)) throw new Error("M3_SCHEMA_INVALID");
    chars += String(turn.text).length;
  }
  if (input.user_correction !== null) {
    exact(input.user_correction, ["text", "replaces_revision"]);
    if (!string(input.user_correction.text, 1000) || input.user_correction.text !== input.current_text
      || !revision(input.user_correction.replaces_revision)
      || Number(input.user_correction.replaces_revision) >= Number(raw.taskRevision)) throw new Error("M3_SCHEMA_INVALID");
    chars += String(input.user_correction.text).length;
  }
  if (chars > 8_000) throw new Error("M3_INPUT_TOO_LARGE");
  return raw as unknown as M3Request;
}
export function readM3PermissionReceipt(
  raw: unknown,
  request: M3PermissionRequest,
): M3PermissionReceipt {
  const scope = ["version", "action", "purpose", "operationId", "taskSessionId", "taskId",
    "taskRevision", "permissionRevision"] as const;
  if (request.action === "GRANT") {
    exact(raw, [...scope, "grantId", "expiresAt"]);
    if (raw.version !== M3_VERSION || raw.action !== "GRANT" || raw.purpose !== M3_PURPOSE
      || !string(raw.grantId, 100) || String(raw.grantId).length < 8
      || !string(raw.expiresAt, 40) || !Number.isFinite(Date.parse(String(raw.expiresAt)))) {
      throw new Error("M3_PERMISSION_RECEIPT_INVALID");
    }
    for (const key of ["operationId", "taskSessionId", "taskId", "taskRevision",
      "permissionRevision"] as const) {
      if (raw[key] !== request[key]) throw new Error("M3_PERMISSION_RECEIPT_SCOPE_MISMATCH");
    }
    return raw as unknown as M3PermissionGrantReceipt;
  }
  const revokeKeys = request.grantId ? [...scope, "grantOperationId", "grantId", "revoked"]
    : [...scope, "grantOperationId", "revoked"];
  exact(raw, revokeKeys);
  if (raw.version !== M3_VERSION || raw.action !== "REVOKE" || raw.purpose !== M3_PURPOSE
    || raw.grantOperationId !== request.grantOperationId || raw.revoked !== true
    || (request.grantId !== undefined && raw.grantId !== request.grantId)) {
    throw new Error("M3_PERMISSION_RECEIPT_INVALID");
  }
  for (const key of ["operationId", "taskSessionId", "taskId", "taskRevision",
    "permissionRevision"] as const) {
    if (raw[key] !== request[key]) throw new Error("M3_PERMISSION_RECEIPT_SCOPE_MISMATCH");
  }
  return raw as unknown as M3PermissionRevokeReceipt;
}
export function m3LanguageInput(request: M3Request): LanguageInput {
  if (!request.input) throw new Error("M3_SCHEMA_INVALID");
  return { ...request.input, relevant_context: request.input.relevant_context.map(({ id, kind, text }) => ({ id, kind, text })) };
}
export function validateM3Meaning(raw: unknown, input: LanguageInput): IntentMeaning {
  return validateMeaning(raw, input);
}
export function makeM3Response(request: M3Request, raw: unknown, usage: unknown): M3Response {
  exact(usage, ["inputTokens", "outputTokens"]);
  if (!Number.isSafeInteger(usage.inputTokens) || Number(usage.inputTokens) < 0
    || !Number.isSafeInteger(usage.outputTokens) || Number(usage.outputTokens) < 0) throw new Error("M3_USAGE_INVALID");
  const meaning = validateMeaning(raw, m3LanguageInput(request));
  return {
    version: M3_VERSION, requestId: request.requestId, sessionId: request.sessionId, taskId: request.taskId,
    taskRevision: request.taskRevision, permissionRevision: request.permissionRevision,
    ...Object.fromEntries(Object.entries(pairs).map(([wire, key]) => [wire, meaning[key as keyof IntentMeaning]])),
    usage: { inputTokens: Number(usage.inputTokens), outputTokens: Number(usage.outputTokens) },
  } as M3Response;
}
export function readM3Response(raw: unknown, request: M3Request): M3WireMeaning {
  exact(raw, ["version", "requestId", "sessionId", "taskId", "taskRevision", "permissionRevision", "usage", ...Object.keys(pairs)]);
  for (const key of ["version", "requestId", "sessionId", "taskId", "taskRevision", "permissionRevision"] as const) {
    if (raw[key] !== request[key]) throw new Error("M3_RESPONSE_SCOPE_MISMATCH");
  }
  const meaning = Object.fromEntries(Object.entries(pairs).map(([wire, key]) => [key, raw[wire]]));
  const validated = makeM3Response(request, meaning, raw.usage);
  // These are production wire-contract rules, not generic IntentMeaning rules.
  // Check the raw response so normalization cannot conceal an invalid claim.
  if ((!raw.clarificationNeeded && (raw.missingContext as unknown[]).length !== 0)
    || (raw.contextEffect === "ADJUST_CURRENT"
      && !request.input?.relevant_context.some((context) => context.kind === "workout"
        && (raw.usedContextIds as string[]).includes(context.id)))) throw new Error("M3_RESPONSE_INVALID");
  return Object.fromEntries(Object.keys(pairs).map((wire) =>
    [wire, validated[wire as keyof M3WireMeaning]])) as M3WireMeaning;
}
export const M3_MODEL_SCHEMA = {
  name: "m3_intent_meaning_v1", strict: true,
  schema: {
    type: "object", additionalProperties: false,
    properties: {
      intent_type: { type: "string", enum: INTENT_TYPES },
      interpreted_meaning: { type: "string", pattern: "\\S" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      uncertainty: { type: ["string", "null"], pattern: "\\S" },
      missing_context: {
        type: "array", maxItems: M3_MEANING_LIMITS.missingContextMaxItems,
        items: { type: "string", pattern: "\\S" },
      },
      clarification_needed: { type: "boolean" },
      clarification_question: { type: ["string", "null"], pattern: "\\S" },
      safety_state: { type: "string", enum: ["CLEAR", "SENSITIVE", "PAIN", "URGENT"] },
      suggested_next_role: { type: "string", enum: ["M4", "M5", "M6", "M7", "STOP"] },
      task_kind: {
        type: ["string", "null"],
        pattern: M3_MEANING_LIMITS.taskKindPattern.source,
      },
      context_effect: { type: "string", enum: ["NONE", "ADJUST_CURRENT"] },
      used_context_ids: {
        type: "array", maxItems: M3_MEANING_LIMITS.usedContextIdsMaxItems,
        items: { type: "string", pattern: "\\S" },
      },
      response: { type: "string", pattern: "\\S" },
    },
    required: Object.values(pairs),
  },
} as const;
