import type { SessionTask } from "../session-task/store";
import type { M4ContextInput, M4Decision, M4Requirement, M4Result } from "./contract";

export const MEAL_IMAGE_REQUIREMENT: M4Requirement = Object.freeze({
  task_kind: "meal_image_assessment",
  item: "meal_image",
});

const positiveRevision = (value: number) => Number.isSafeInteger(value) && value > 0;
const GOAL_READY_TASK_KINDS = new Set(["general_health", "body_composition", "strength", "movement"]);

/**
 * Pure goal-readiness gate. It consumes only the structured M3 result and the
 * task lifecycle/permission boundary; it never gathers profile or raw-text context.
 */
export function resolveM4GoalReadiness(task: SessionTask): M4Result {
  const finish = (decision: M4Decision): M4Result => Object.freeze({
    scope: Object.freeze({ session_id: task.session_id, task_id: task.task_id, revision: task.revision }),
    decision: Object.freeze(decision),
  });
  const m3 = task.interpretation;
  if (!task.permission_granted || !m3) {
    return finish({ state: "DEFERRED", reason: "TASK_NOT_READY" });
  }
  if (m3.safety_state !== "CLEAR" || task.m3_context.safety_signal !== "CLEAR"
    || ["SAFETY", "OUT_OF_SCOPE", "REFUSAL", "STOP_PAUSE"].includes(m3.intent_type)
    || m3.suggested_next_role === "STOP") {
    return finish({ state: "DEFERRED", reason: "M3_BOUNDARY" });
  }
  if (m3.clarification_needed || m3.intent_type === "AMBIGUOUS") {
    if (task.m3_context.asking_stopped) {
      return finish({ state: "DEFERRED", reason: "M3_BOUNDARY" });
    }
    return finish({ state: "NEED_CLARIFICATION", next_role: "M3" });
  }
  if (task.status !== "READY") {
    return finish({ state: "DEFERRED", reason: "TASK_NOT_READY" });
  }
  if (m3.intent_type !== "GOAL" || m3.suggested_next_role !== "M4"
    || !m3.task_kind || !GOAL_READY_TASK_KINDS.has(m3.task_kind)) {
    return finish({ state: "DEFERRED", reason: "UNSUPPORTED_TASK" });
  }
  return finish({
    state: "CONTEXT_SUFFICIENT",
    sufficient_for: "NEXT_STEP_CONTRACT_ONLY",
    used_context_ids: Object.freeze([]),
  });
}

/**
 * Pure contract assessment. No storage, provider, pixels, UI or downstream action.
 * Call through SessionTaskStore.assessM4 for a fresh host-owned task reference.
 * A sufficient result is a point-in-time observation, never an execution permit.
 */
export function resolveM4Context(
  task: SessionTask,
  context: M4ContextInput,
  requirement: M4Requirement = MEAL_IMAGE_REQUIREMENT,
): M4Result {
  const finish = (decision: M4Decision): M4Result => Object.freeze({
    scope: Object.freeze({ session_id: task.session_id, task_id: task.task_id, revision: task.revision }),
    decision: Object.freeze(decision),
  });
  const m3 = task.interpretation;
  if (!task.permission_granted || !m3 || !["READY", "AWAITING_INPUT"].includes(task.status)) {
    return finish({ state: "DEFERRED", reason: "TASK_NOT_READY" });
  }
  // Never repair intent or weaken M3's safety/stop/refusal handling.
  if (m3.safety_state !== "CLEAR" || task.m3_context.safety_signal !== "CLEAR"
    || ["SAFETY", "OUT_OF_SCOPE", "REFUSAL", "STOP_PAUSE"].includes(m3.intent_type)
    || m3.suggested_next_role === "STOP") {
    return finish({ state: "DEFERRED", reason: "M3_BOUNDARY" });
  }
  if (m3.clarification_needed || m3.intent_type === "AMBIGUOUS") {
    // Stopping questions does not resolve intent or reopen M3's removed question.
    if (task.m3_context.asking_stopped) {
      return finish({ state: "DEFERRED", reason: "M3_BOUNDARY" });
    }
    return finish({ state: "NEED_CLARIFICATION", next_role: "M3" });
  }
  if (m3.intent_type !== "CURRENT_TASK" || m3.suggested_next_role !== "M4"
    || requirement.item !== "meal_image" || !requirement.task_kind.trim()
    || m3.task_kind !== requirement.task_kind) {
    return finish({ state: "DEFERRED", reason: "UNSUPPORTED_TASK" });
  }
  if (!positiveRevision(context.scope.revision)
    || context.scope.session_id !== task.session_id || context.scope.task_id !== task.task_id
    || context.scope.revision !== task.revision) {
    return finish({ state: "DEFERRED", reason: "STALE_CONTEXT" });
  }
  if (context.boundary === "professional_required") {
    return finish({ state: "PROFESSIONAL_HANDOFF_NEEDED", reason: "OUTSIDE_AI_AUTHORITY" });
  }
  if (context.boundary !== "within_slice") {
    return finish({ state: "DEFERRED", reason: "INVALID_CONTEXT" });
  }
  if (context.image.state === "declined") {
    return finish({ state: "CONTEXT_DECLINED", alternative: "TEXT_DESCRIPTION_OPTION", ask_again: false });
  }
  if (context.image.state === "absent") {
    // Respect the question boundary without inventing an item-scoped refusal.
    if (task.m3_context.asking_stopped) {
      return finish({ state: "DEFERRED", reason: "M3_BOUNDARY" });
    }
    return finish({ state: "CONTEXT_REQUIRED", missing: Object.freeze(["meal_image"] as const) });
  }
  if (context.image.state !== "present" || typeof context.image.id !== "string" || !context.image.id.trim()) {
    return finish({ state: "DEFERRED", reason: "INVALID_CONTEXT" });
  }
  if (context.permission.purpose !== "meal_image_assessment" || context.permission.status !== "allowed"
    || !positiveRevision(context.permission.revision)
    || context.image.permission_revision !== context.permission.revision) {
    return finish({ state: "PERMISSION_REQUIRED", item: "meal_image" });
  }
  if (context.image.usable !== true) {
    return finish({ state: "DEFERRED", reason: "CONTEXT_UNUSABLE" });
  }
  return finish({
    state: "CONTEXT_SUFFICIENT",
    sufficient_for: "NEXT_STEP_CONTRACT_ONLY",
    used_context_ids: Object.freeze([context.image.id]),
  });
}
