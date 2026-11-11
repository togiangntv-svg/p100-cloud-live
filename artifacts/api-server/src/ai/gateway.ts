import { createHash } from "node:crypto";
import type { LanguageInput } from "@workspace/api-zod";
import type {
  AiIntentAction, AiIntentOutput, AiProviderInput, AiProviderOutput, AiSuggestionKind,
} from "./provider";

const ALLOWED_SUGGESTIONS = new Set<AiSuggestionKind>([
  "plan.create",
  "plan.view",
  "plan.edit",
  "action.self",
  "outcome.record",
  "understanding.correct",
]);

const FORBIDDEN_OUTPUT_PATTERNS = [
  /\b(ngừng|bỏ|đổi)\s+thuốc\b/iu,
  /\b(stop|quit|change)\s+(your\s+)?medication\b/iu,
  /\b(chắc chắn|tôi chẩn đoán|you definitely have|i diagnose)\b/iu,
  /\b(tôi đã|i have)\s+(gọi|đặt lịch|liên hệ|called|booked|contacted)\b/iu,
  /\b(chain of thought|chuỗi suy nghĩ riêng)\b/iu,
];

const ALLOWED_INTENT_ACTIONS = new Set<AiIntentAction>([
  "continue_current_task",
  "adjust_current_task",
  "pause_current_task",
  "end_current_task",
  "change_task_context",
  "review_progress",
  "record_outcome",
  "correct_understanding",
]);

export class GatewayProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryable = false,
  ) {
    super(code);
  }
}

export function hashOpaque(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function validateProviderOutput(output: AiProviderOutput, locale?: LanguageInput["locale"]): AiProviderOutput {
  const text = output.text.trim();
  if (!text || text.length > 5000) {
    throw new GatewayProblem(502, "AI_OUTPUT_INVALID");
  }
  if (FORBIDDEN_OUTPUT_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new GatewayProblem(502, "AI_OUTPUT_BLOCKED");
  }
  if (locale === "vi" && /\b(the|and|you|your|please|should|goal|plan|next step)\b/iu.test(text)) {
    throw new GatewayProblem(502, "AI_OUTPUT_LANGUAGE_MISMATCH");
  }
  if (!Array.isArray(output.suggestions) || output.suggestions.length > 3) {
    throw new GatewayProblem(502, "AI_OUTPUT_INVALID");
  }
  const suggestions = output.suggestions.filter((item) => (
    ALLOWED_SUGGESTIONS.has(item.kind)
    && typeof item.label === "string"
    && item.label.trim().length > 0
    && item.label.length <= 120
  ));
  if (suggestions.length !== output.suggestions.length) {
    throw new GatewayProblem(502, "AI_OUTPUT_BLOCKED");
  }
  if (locale === "vi" && suggestions.some((item) => (
    /\b(the|and|you|your|please|should|goal|plan|next step)\b/iu.test(item.label)
  ))) {
    throw new GatewayProblem(502, "AI_OUTPUT_LANGUAGE_MISMATCH");
  }
  if (!Number.isInteger(output.usage.inputTokens)
    || !Number.isInteger(output.usage.outputTokens)
    || output.usage.inputTokens < 0
    || output.usage.outputTokens < 0) {
    throw new GatewayProblem(502, "AI_USAGE_UNKNOWN");
  }
  return { ...output, text, suggestions };
}

export function validateIntentOutput(output: AiIntentOutput): AiIntentOutput {
  const value = output.understanding;
  if (!value || !["understood", "needs_clarification", "open_path", "supportive_hold"].includes(value.status)
    || ![...ALLOWED_INTENT_ACTIONS, "unknown"].includes(value.intent)
    || !["high", "medium", "low"].includes(value.confidence)
    || typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 500
    || !(value.clarificationQuestion === null
      || (typeof value.clarificationQuestion === "string" && value.clarificationQuestion.length <= 300))
    || !Array.isArray(value.suggestedActions) || value.suggestedActions.length > 3
    || value.suggestedActions.some((action) => !ALLOWED_INTENT_ACTIONS.has(action))
    || !Number.isInteger(output.usage.inputTokens) || output.usage.inputTokens < 0
    || !Number.isInteger(output.usage.outputTokens) || output.usage.outputTokens < 0) {
    throw new GatewayProblem(502, "AI_INTENT_OUTPUT_INVALID");
  }
  if (value.status === "needs_clarification"
    && !(value.clarificationQuestion && value.clarificationQuestion.trim())) {
    throw new GatewayProblem(502, "AI_INTENT_OUTPUT_INVALID");
  }
  if (FORBIDDEN_OUTPUT_PATTERNS.some((pattern) => (
    pattern.test(value.summary) || pattern.test(value.clarificationQuestion ?? "")
  ))) {
    throw new GatewayProblem(502, "AI_OUTPUT_BLOCKED");
  }
  return {
    ...output,
    understanding: {
      ...value,
      summary: value.summary.trim(),
      clarificationQuestion: value.clarificationQuestion?.trim() || null,
    },
  };
}

export function validateRequestTiming(createdAt: string, expiresAt: string, now = Date.now()): void {
  const created = Date.parse(createdAt);
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires)
    || created > now + 30_000
    || now - created > 120_000
    || expires <= now
    || expires - created > 180_000) {
    throw new GatewayProblem(409, "AI_REQUEST_STALE");
  }
}

export function validateInput(input: AiProviderInput): void {
  if (input.messages.length < 1 || input.messages.length > 20) {
    throw new GatewayProblem(413, "AI_INPUT_TOO_LARGE");
  }
  const messageChars = input.messages.reduce((total, item) => total + item.content.length, 0);
  const contextChars = input.relevantContext.reduce((total, item) => total + item.text.length, 0);
  if (messageChars > 6_000 || contextChars > 2_000) {
    throw new GatewayProblem(413, "AI_INPUT_TOO_LARGE");
  }
  if (input.relevantContext.some((item) => item.permission !== "external_ai_allowed")) {
    throw new GatewayProblem(403, "AI_CONTEXT_NOT_PERMITTED");
  }
}