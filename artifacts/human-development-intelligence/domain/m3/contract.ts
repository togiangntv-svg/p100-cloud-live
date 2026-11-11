import type { M3Locale } from "../../../../lib/api-zod/src/m3-locales";

export const M3_VERSION = "m3.v1" as const;
export const M3_PURPOSE = "m3_intent_understanding" as const;
export const M3_PATH = "/api/ai/m3" as const;
export const INTENT_TYPES = [
  "GOAL", "CURRENT_TASK", "QUESTION", "CORRECTION", "CHANGE_OF_MIND",
  "REFUSAL", "STOP_PAUSE", "AMBIGUOUS", "HUMOR_PRAGMATIC", "SAFETY", "OUT_OF_SCOPE",
] as const;
export type SafetyState = "CLEAR" | "SENSITIVE" | "PAIN" | "URGENT";
export type LanguageInput = Readonly<{
  locale: M3Locale; current_text: string;
  relevant_context: readonly Readonly<{ id: string; kind: string; text: string }>[];
  recent_relevant_turns: readonly Readonly<{ role: "user" | "assistant"; text: string }>[];
  user_correction: Readonly<{ text: string; replaces_revision: number }> | null;
  safety_signal: SafetyState; asking_stopped: boolean;
}>;
export type IntentMeaning = Readonly<{
  intent_type: typeof INTENT_TYPES[number]; interpreted_meaning: string; confidence: number;
  uncertainty: string | null; missing_context: readonly string[]; clarification_needed: boolean;
  clarification_question: string | null; safety_state: SafetyState;
  suggested_next_role: "M4" | "M5" | "M6" | "M7" | "STOP"; task_kind: string | null;
  context_effect: "NONE" | "ADJUST_CURRENT"; used_context_ids: readonly string[]; response: string;
}>;