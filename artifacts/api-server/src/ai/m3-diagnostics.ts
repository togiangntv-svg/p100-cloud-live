export const M3_FAILURE_STAGES = [
  "provider_call",
  "provider_finish_reason_invalid",
  "provider_refusal",
  "provider_content_missing",
  "provider_json_parse",
  "response_structure_or_usage",
  "response_content_validation",
  "record_usage",
] as const;

export type M3FailureStage = typeof M3_FAILURE_STAGES[number];
export type M3DiagnosticField = "usage" | "meaning" | "clarification_question"
  | "context_effect" | "interpreted_meaning" | "response" | "uncertainty"
  | "missing_context";

export type M3DiagnosticMetadata = {
  event: "ai_m3_internal_failure";
  correlationHash: string;
  stage: M3FailureStage;
  errorType: "ProviderError" | "MissingContent" | "JsonParseError"
    | "CompletionEndReason" | "ProviderRefusal"
    | "ResponseValidationError" | "ContentValidationError" | "UsageRecordError";
  status?: number;
  finishReason?: "length" | "content_filter" | "tool_calls" | "function_call"
    | "other" | "missing";
  validationBranch?: "usage" | "meaning_shape" | "meaning_relation" | "content";
  field?: M3DiagnosticField;
  rule?: "EXACT_SHAPE" | "SAFE_INTEGER_NONNEGATIVE" | "SHAPE_OR_FIELD_INVALID"
    | "CLARIFICATION_RELATION" | "QUESTION_MUST_BE_NULL"
    | "CONTEXT_IDS_REQUIRED" | "CONTENT_INVALID" | "CONTENT_BLOCKED"
    | "LOCALE_MISMATCH";
  errorCode: "PROVIDER_ABORTED" | "PROVIDER_AUTH" | "PROVIDER_RATE_LIMITED"
    | "PROVIDER_CLIENT_ERROR" | "PROVIDER_SERVER_ERROR" | "PROVIDER_ERROR"
    | "FINISH_REASON_INVALID" | "PROVIDER_REFUSAL"
    | "CONTENT_MISSING" | "JSON_INVALID" | "RESPONSE_INVALID"
    | "USAGE_SHAPE_INVALID" | "USAGE_VALUE_INVALID"
    | "MEANING_SHAPE_OR_FIELD_INVALID" | "MEANING_QUESTION_RELATION_INVALID"
    | "MEANING_UNNEEDED_QUESTION" | "MEANING_CONTEXT_EFFECT_RELATION_INVALID"
    | "CONTENT_INVALID" | "USAGE_RECORD_FAILED";
};

type DiagnosticDetail = Omit<M3DiagnosticMetadata, "event" | "correlationHash">;

export class M3DiagnosticFailure extends Error {
  constructor(readonly detail: DiagnosticDetail) {
    super("M3_INTERNAL_DIAGNOSTIC_FAILURE");
  }
}

function numericStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return Number.isInteger(status) && Number(status) >= 400 && Number(status) <= 599
    ? Number(status)
    : undefined;
}

export function providerFailure(error: unknown): M3DiagnosticFailure {
  const status = numericStatus(error);
  const aborted = error instanceof Error && error.name === "AbortError";
  const errorCode = aborted ? "PROVIDER_ABORTED"
    : status === 401 || status === 403 ? "PROVIDER_AUTH"
      : status === 429 ? "PROVIDER_RATE_LIMITED"
        : status !== undefined && status < 500 ? "PROVIDER_CLIENT_ERROR"
          : status !== undefined ? "PROVIDER_SERVER_ERROR"
            : "PROVIDER_ERROR";
  return new M3DiagnosticFailure({
    stage: "provider_call",
    errorType: "ProviderError",
    ...(status === undefined ? {} : { status }),
    errorCode,
  });
}

export function fixedFailure(
  stage: Exclude<M3FailureStage, "provider_call" | "provider_finish_reason_invalid" | "provider_refusal">,
): M3DiagnosticFailure {
  switch (stage) {
    case "provider_content_missing":
      return new M3DiagnosticFailure({
        stage, errorType: "MissingContent", errorCode: "CONTENT_MISSING",
      });
    case "provider_json_parse":
      return new M3DiagnosticFailure({
        stage, errorType: "JsonParseError", errorCode: "JSON_INVALID",
      });
    case "response_structure_or_usage":
      return new M3DiagnosticFailure({
        stage, errorType: "ResponseValidationError", errorCode: "RESPONSE_INVALID",
      });
    case "response_content_validation":
      return new M3DiagnosticFailure({
        stage, errorType: "ContentValidationError", errorCode: "CONTENT_INVALID",
      });
    case "record_usage":
      return new M3DiagnosticFailure({
        stage, errorType: "UsageRecordError", errorCode: "USAGE_RECORD_FAILED",
      });
  }
}

export function finishReasonFailure(value: unknown): M3DiagnosticFailure {
  const finishReason = value === "length" || value === "content_filter"
    || value === "tool_calls" || value === "function_call"
    ? value
    : value === undefined || value === null ? "missing" : "other";
  return new M3DiagnosticFailure({
    stage: "provider_finish_reason_invalid",
    errorType: "CompletionEndReason",
    finishReason,
    errorCode: "FINISH_REASON_INVALID",
  });
}

export function refusalFailure(): M3DiagnosticFailure {
  return new M3DiagnosticFailure({
    stage: "provider_refusal",
    errorType: "ProviderRefusal",
    errorCode: "PROVIDER_REFUSAL",
  });
}

export function responseValidationFailure(error: unknown): M3DiagnosticFailure {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case "M3_SCHEMA_INVALID":
      return new M3DiagnosticFailure({
        stage: "response_structure_or_usage",
        errorType: "ResponseValidationError",
        errorCode: "USAGE_SHAPE_INVALID",
        validationBranch: "usage",
        field: "usage",
        rule: "EXACT_SHAPE",
      });
    case "M3_USAGE_INVALID":
      return new M3DiagnosticFailure({
        stage: "response_structure_or_usage",
        errorType: "ResponseValidationError",
        errorCode: "USAGE_VALUE_INVALID",
        validationBranch: "usage",
        field: "usage",
        rule: "SAFE_INTEGER_NONNEGATIVE",
      });
    case "M3_OUTPUT_INVALID":
      return new M3DiagnosticFailure({
        stage: "response_structure_or_usage",
        errorType: "ResponseValidationError",
        errorCode: "MEANING_SHAPE_OR_FIELD_INVALID",
        validationBranch: "meaning_shape",
        field: "meaning",
        rule: "SHAPE_OR_FIELD_INVALID",
      });
    case "M3_QUESTION_INVALID":
      return new M3DiagnosticFailure({
        stage: "response_structure_or_usage",
        errorType: "ResponseValidationError",
        errorCode: "MEANING_QUESTION_RELATION_INVALID",
        validationBranch: "meaning_relation",
        field: "clarification_question",
        rule: "CLARIFICATION_RELATION",
      });
    case "M3_UNNEEDED_QUESTION":
      return new M3DiagnosticFailure({
        stage: "response_structure_or_usage",
        errorType: "ResponseValidationError",
        errorCode: "MEANING_UNNEEDED_QUESTION",
        validationBranch: "meaning_relation",
        field: "clarification_question",
        rule: "QUESTION_MUST_BE_NULL",
      });
    case "M3_CONTEXT_EFFECT_INVALID":
      return new M3DiagnosticFailure({
        stage: "response_structure_or_usage",
        errorType: "ResponseValidationError",
        errorCode: "MEANING_CONTEXT_EFFECT_RELATION_INVALID",
        validationBranch: "meaning_relation",
        field: "context_effect",
        rule: "CONTEXT_IDS_REQUIRED",
      });
    default:
      return fixedFailure("response_structure_or_usage");
  }
}

export function contentValidationFailure(
  error: unknown,
  field: Exclude<M3DiagnosticField, "usage" | "meaning" | "context_effect">,
): M3DiagnosticFailure {
  const code = error instanceof Error ? error.message : "";
  const rule = code === "AI_OUTPUT_BLOCKED" ? "CONTENT_BLOCKED"
    : code === "AI_OUTPUT_LANGUAGE_MISMATCH" ? "LOCALE_MISMATCH"
      : "CONTENT_INVALID";
  return new M3DiagnosticFailure({
    stage: "response_content_validation",
    errorType: "ContentValidationError",
    errorCode: "CONTENT_INVALID",
    validationBranch: "content",
    field,
    rule,
  });
}