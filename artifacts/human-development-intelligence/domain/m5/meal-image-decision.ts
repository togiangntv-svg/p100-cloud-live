import { taskCopy } from '../../i18n-task';
import type { M4ContextItem, M4Result, M4Scope } from "../m4/contract";
import type { SessionTask } from "../session-task/store";

export const M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE = Object.freeze({
  meal_image_assessment: "NOT_AVAILABLE" as const,
});

export type M5CapabilityState = Readonly<{
  meal_image_assessment: "NOT_AVAILABLE";
}>;

export type M5Proposal = Readonly<{
  kind: "ASSESS_CURRENT_MEAL_IMAGE";
  why_code: "MEAL_IMAGE_CONTEXT_READY";
  tradeoff_code: "IMAGE_USE_IS_TASK_SCOPED";
  requires_user_choice: true;
}>;

export type M5NoActionReason =
  | "STALE_TASK"
  | "STALE_CONTEXT"
  | "CANCELLED"
  | "TASK_NOT_READY"
  | "M3_BOUNDARY"
  | "M4_BLOCKED"
  | "UNSUPPORTED_TASK";

export type M5Decision =
  | Readonly<{ scope: M4Scope; state: "PROPOSAL"; proposal: M5Proposal }>
  | Readonly<{
      scope: M4Scope;
      state: "NEED_CONTEXT";
      missing: readonly M4ContextItem[];
      proposal: null;
    }>
  | Readonly<{
      scope: M4Scope;
      state: "UNSUPPORTED";
      reason: "MEAL_IMAGE_CAPABILITY_NOT_AVAILABLE";
      proposal: null;
    }>
  | Readonly<{
      scope: M4Scope;
      state: "NO_ACTION";
      reason: M5NoActionReason;
      proposal: null;
    }>;

export type M5PresentationPreference = "BRIEF" | "EXPLAINED";

const freezeScope = (scope: M4Scope): M4Scope => Object.freeze({
  session_id: scope.session_id,
  task_id: scope.task_id,
  revision: scope.revision,
});

const sameScope = (task: SessionTask, scope: M4Scope): boolean =>
  task.session_id === scope.session_id
  && task.task_id === scope.task_id
  && task.revision === scope.revision;

export function createM5NoAction(
  scope: M4Scope,
  reason: M5NoActionReason,
): M5Decision {
  return Object.freeze({
    scope: freezeScope(scope), state: "NO_ACTION" as const, reason, proposal: null,
  });
}

/**
 * P5.1 is a pure decision gate for the current product state. The capability
 * contract deliberately has no AVAILABLE variant: adding one requires a later,
 * separately verified capability/executor slice. This resolver cannot execute,
 * persist, read image bytes, or turn M4 sufficiency into action authority.
 */
export function resolveMealImageM5Decision(
  task: SessionTask,
  m4: M4Result,
  capability: M5CapabilityState,
): M5Decision {
  if (!sameScope(task, m4.scope)) return createM5NoAction(m4.scope, "STALE_CONTEXT");
  if (task.status === "CANCELLED") return createM5NoAction(m4.scope, "CANCELLED");
  if (task.status !== "READY" || !task.interpretation) {
    return createM5NoAction(m4.scope, "TASK_NOT_READY");
  }
  const meaning = task.interpretation;
  if (task.m3_context.safety_signal !== "CLEAR" || meaning.safety_state !== "CLEAR"
    || meaning.suggested_next_role === "STOP"
    || ["STOP_PAUSE", "REFUSAL", "SAFETY", "OUT_OF_SCOPE"].includes(meaning.intent_type)) {
    return createM5NoAction(m4.scope, "M3_BOUNDARY");
  }
  if (meaning.intent_type !== "CURRENT_TASK" || meaning.task_kind !== "meal_image_assessment") {
    return createM5NoAction(m4.scope, "UNSUPPORTED_TASK");
  }
  if (["DEFERRED", "NEED_CLARIFICATION", "PROFESSIONAL_HANDOFF_NEEDED"].includes(m4.decision.state)) {
    return createM5NoAction(m4.scope, "M4_BLOCKED");
  }
  if (capability.meal_image_assessment !== "NOT_AVAILABLE") {
    return createM5NoAction(m4.scope, "M4_BLOCKED");
  }
  return Object.freeze({
    scope: freezeScope(m4.scope),
    state: "UNSUPPORTED" as const,
    reason: "MEAL_IMAGE_CAPABILITY_NOT_AVAILABLE" as const,
    proposal: null,
  });
}

/** User copy is kept outside the semantic resolver and exposes no internal code. */
export function presentMealImageM5Decision(
  decision: M5Decision,
  locale: string,
  preference: M5PresentationPreference = "EXPLAINED",
): string | null {
  if (decision.state !== "UNSUPPORTED"
    || decision.reason !== "MEAL_IMAGE_CAPABILITY_NOT_AVAILABLE") return null;
  const copy = taskCopy(locale);
  return preference === "BRIEF" ? copy.mealBrief : copy.mealExplained;
}
