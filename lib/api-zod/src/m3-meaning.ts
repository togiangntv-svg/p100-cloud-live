import { M3_LOCALE_CONFIG, type M3Locale } from "./m3-locales";
import { evaluateTrainerSafetyText } from "./trainer-safety-policy";

// M3 only interprets a scoped SessionTask. It never writes goals, grants
// permission, executes actions, or claims production authority.
export const INTENT_TYPES = [
  "GOAL", "CURRENT_TASK", "QUESTION", "CORRECTION", "CHANGE_OF_MIND",
  "REFUSAL", "STOP_PAUSE", "AMBIGUOUS", "HUMOR_PRAGMATIC", "SAFETY", "OUT_OF_SCOPE",
] as const;
export type IntentType = typeof INTENT_TYPES[number];
export type SafetyState = "CLEAR" | "SENSITIVE" | "PAIN" | "URGENT";
export type LanguageInput = Readonly<{
  locale: M3Locale;
  current_text: string;
  relevant_context: readonly Readonly<{ id: string; kind: string; text: string }>[];
  recent_relevant_turns: readonly Readonly<{ role: "user" | "assistant"; text: string }>[];
  user_correction: Readonly<{ text: string; replaces_revision: number }> | null;
  safety_signal: SafetyState;
  asking_stopped: boolean;
}>;
export type IntentMeaning = Readonly<{
  intent_type: IntentType;
  interpreted_meaning: string;
  confidence: number;
  uncertainty: string | null;
  missing_context: readonly string[];
  clarification_needed: boolean;
  clarification_question: string | null;
  safety_state: SafetyState;
  suggested_next_role: "M4" | "M5" | "M6" | "M7" | "STOP";
  task_kind: string | null;
  context_effect: "NONE" | "ADJUST_CURRENT";
  used_context_ids: readonly string[];
  response: string;
}>;

export const M3_MEANING_LIMITS = Object.freeze({
  interpretedMeaningMax: 400,
  uncertaintyMax: 240,
  missingContextMaxItems: 1,
  missingContextItemMax: 160,
  clarificationQuestionMax: 180,
  taskKindPattern: /^[a-z][a-z0-9_]{0,79}$/u,
  usedContextIdsMaxItems: 4,
  responseMax: 320,
});

const INTERNAL = /\b(?:GOAL|CURRENT_TASK|QUESTION|CORRECTION|CHANGE_OF_MIND|REFUSAL|STOP_PAUSE|AMBIGUOUS|HUMOR_PRAGMATIC|SAFETY|OUT_OF_SCOPE|NEEDS_ROUTING|UNSUPPORTED|VERIFIED_RESOLVER|M[3-7])\b|[{}]|\b[a-z]+_[a-z_]+\b/u;
const readable = (v: unknown, max: number): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= max && !INTERNAL.test(v);
const oneOf = (v: unknown, values: readonly string[]) => typeof v === "string" && values.includes(v);

export function validateMeaning(raw: unknown, input: LanguageInput): IntentMeaning {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("M3_OUTPUT_INVALID");
  const value = raw as Record<string, unknown>;
  const keys = [
    "intent_type", "interpreted_meaning", "confidence", "uncertainty", "missing_context",
    "clarification_needed", "clarification_question", "safety_state", "suggested_next_role",
    "task_kind", "context_effect", "used_context_ids", "response",
  ];
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error("M3_OUTPUT_INVALID");
  }
  if (!oneOf(value.intent_type, INTENT_TYPES)
    || !readable(value.interpreted_meaning, M3_MEANING_LIMITS.interpretedMeaningMax)
    || typeof value.confidence !== "number" || !Number.isFinite(value.confidence)
    || value.confidence < 0 || value.confidence > 1
    || !(value.uncertainty === null || readable(value.uncertainty, M3_MEANING_LIMITS.uncertaintyMax))
    || !Array.isArray(value.missing_context)
    || value.missing_context.length > M3_MEANING_LIMITS.missingContextMaxItems
    || !value.missing_context.every((item) => readable(item, M3_MEANING_LIMITS.missingContextItemMax))
    || typeof value.clarification_needed !== "boolean"
    || !oneOf(value.safety_state, ["CLEAR", "SENSITIVE", "PAIN", "URGENT"])
    || !oneOf(value.suggested_next_role, ["M4", "M5", "M6", "M7", "STOP"])
    || !(value.task_kind === null || (typeof value.task_kind === "string"
      && M3_MEANING_LIMITS.taskKindPattern.test(value.task_kind)))
    || !oneOf(value.context_effect, ["NONE", "ADJUST_CURRENT"])
    || !Array.isArray(value.used_context_ids)
    || value.used_context_ids.length > M3_MEANING_LIMITS.usedContextIdsMaxItems
    || !value.used_context_ids.every((id) => input.relevant_context.some((item) => item.id === id))
    || new Set(value.used_context_ids).size !== value.used_context_ids.length
    || !readable(value.response, M3_MEANING_LIMITS.responseMax) || /[?？]/u.test(value.response)) {
    throw new Error("M3_OUTPUT_INVALID");
  }
  if (value.clarification_needed) {
    if (!readable(value.clarification_question, M3_MEANING_LIMITS.clarificationQuestionMax)
      || value.missing_context.length !== 1
      || (value.clarification_question as string).split(/[?？]/u).length !== 2
      || !/[?？]$/u.test(value.clarification_question as string)) throw new Error("M3_QUESTION_INVALID");
  } else if (value.clarification_question !== null) {
    throw new Error("M3_UNNEEDED_QUESTION");
  }
  if (value.context_effect === "ADJUST_CURRENT" && value.used_context_ids.length === 0) {
    throw new Error("M3_CONTEXT_EFFECT_INVALID");
  }
  const rank = { CLEAR: 0, SENSITIVE: 1, PAIN: 2, URGENT: 3 } as const;
  // Recognition is local and policy-owned; model output can raise but never
  // lower a current valid observation.
  const textFloor = evaluateTrainerSafetyText(input.locale, input.current_text).level;
  const safety = ([input.safety_signal, textFloor, value.safety_state as SafetyState] as const)
    .reduce((highest, next) => rank[next] > rank[highest] ? next : highest);
  const sensitive = safety !== "CLEAR" || value.intent_type === "SAFETY";
  const explicitStop = ["REFUSAL", "STOP_PAUSE"].includes(value.intent_type as string);
  const result: IntentMeaning = {
    ...(value as unknown as IntentMeaning),
    safety_state: safety,
    intent_type: sensitive ? "SAFETY" : value.intent_type as IntentType,
    suggested_next_role: sensitive || explicitStop ? "STOP" : value.suggested_next_role as IntentMeaning["suggested_next_role"],
    clarification_needed: sensitive || ["REFUSAL", "STOP_PAUSE"].includes(value.intent_type as string)
      ? false : value.clarification_needed,
    clarification_question: sensitive || ["REFUSAL", "STOP_PAUSE"].includes(value.intent_type as string)
      ? null : value.clarification_question as string | null,
    missing_context: sensitive || ["REFUSAL", "STOP_PAUSE"].includes(value.intent_type as string)
      ? [] : Object.freeze([...(value.missing_context as string[])]),
    used_context_ids: Object.freeze([...(value.used_context_ids as string[])]),
    response: sensitive
      ? M3_LOCALE_CONFIG[input.locale][safety === "URGENT" ? "urgentSafety" : "safety"]
      : ["REFUSAL", "STOP_PAUSE"].includes(value.intent_type as string)
        ? M3_LOCALE_CONFIG[input.locale].stop
        : value.response as string,
  };
  if (input.asking_stopped || result.intent_type === "OUT_OF_SCOPE") {
    return Object.freeze({ ...result, clarification_needed: false, clarification_question: null, missing_context: [] });
  }
  if (result.clarification_needed) return Object.freeze({ ...result, suggested_next_role: "M4" });
  if (result.intent_type === "GOAL" && input.relevant_context.length === 0) {
    return Object.freeze({ ...result, suggested_next_role: "M4" });
  }
  return Object.freeze(result);
}
