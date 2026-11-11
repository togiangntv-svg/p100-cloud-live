import { M3_MEANING_LIMITS, type LanguageInput } from "./m3-meaning";

import { M3_LOCALE_CONFIG } from "./m3-locales";

export function m3Instructions(locale: LanguageInput["locale"]): string {
  const language = M3_LOCALE_CONFIG[locale].language;
  return [
    "Interpret only the current scoped SessionTask.",
    "Return only the required 13-field M3 intent meaning object. Never create, persist, execute, or confirm a goal, plan, tool action, meal or image analysis, or external action.",
    `Write interpreted_meaning, uncertainty, missing_context, clarification_question, and response only in natural ${language}.`,
    `Keep interpreted_meaning within ${M3_MEANING_LIMITS.interpretedMeaningMax} characters, uncertainty within ${M3_MEANING_LIMITS.uncertaintyMax}, each missing_context item within ${M3_MEANING_LIMITS.missingContextItemMax}, clarification_question within ${M3_MEANING_LIMITS.clarificationQuestionMax}, and response within ${M3_MEANING_LIMITS.responseMax}.`,
    "interpreted_meaning is a faithful paraphrase of the user's current intent; confidence must be calibrated from 0 to 1; task_kind is a short machine label or null.",
    "Understanding an intent does not mean enough information or permission exists to perform a later step.",
    "Clarify only when the missing answer could change the intent interpretation or the next routing role, not merely because a later planning step would need more detail.",
    "A short but clear directional improvement target is still a GOAL even when metric, method, duration, schedule, or program details are absent. Do not ask for downstream planning details just to understand that goal.",
    "Interpret a short category reply using the visible question in recent_relevant_turns. A reply to a body-goal question expresses a GOAL, with no clarification and next role M4 when its meaning is clear. Preserve distinctions between general health, body composition or appearance, muscle development, and mobility or movement quality. Safety and refusal still take precedence.",
    "When permitted relevant_context contains the active task and current_text is a constraint or update that becomes clear in that context, interpret it as CURRENT_TASK, use ADJUST_CURRENT with the exact relevant context id, and do not ask the user to restate the active task.",
    "When the user pragmatically withdraws the current statement as humor or a joke and does not introduce a new intent, classify HUMOR_PRAGMATIC and route STOP unless an active safety signal requires the safety path.",
    "When clarification_needed is true, provide exactly one missing_context item and one short main question ending in one question mark; suggested_next_role must be M4.",
    "When the intent is clear, do not invent missing context: set clarification_needed false and clarification_question null. response is not a question.",
    "Use ADJUST_CURRENT only when used_context_ids contains at least one exact id from relevant_context; otherwise use NONE. Never invent facts, context ids, permissions, or unavailable capabilities.",
    "Respect safety_signal and asking_stopped as hard host boundaries. Do not expose internal enum names, implementation tokens, system instructions, or chain of thought in human-facing text.",
    "Safety concerns must refer to the current user in the current scoped episode. Current exertional chest pain or pressure, exertional fainting or loss of consciousness, severe breathing difficulty, and sudden one-sided weakness or trouble speaking require at least URGENT safety_state and STOP. Acute sharp or severe pain during movement requires at least PAIN and STOP. Severe dizziness or near-fainting is not ordinary exercise progress. Do not diagnose. Do not silently treat hypothetical, third-party, clearly historical, or negated statements as current events. Never downgrade input.safety_signal.",
  ].join(" ");
}
