import type { TaskRef } from "../session-task/store";

/** Correlation within the host's RAM session, NOT authenticated ownership. */
export type M4Scope = Pick<TaskRef, "session_id" | "task_id" | "revision">;
export type M4ContextItem = "meal_image";

export type M4ImageContext =
  | Readonly<{ state: "absent" }>
  | Readonly<{ state: "declined" }>
  | Readonly<{
      state: "present";
      id: string; // opaque host reference only: never bytes, base64, URL or path
      usable: boolean;
      permission_revision: number;
    }>;

/**
 * A per-evaluation projection from the host, not a context store or an API.
 * Image permission is purpose-specific; M3 text consent never grants it.
 * The host must supply the CURRENT decision on every call. This contract
 * neither authenticates a caller nor creates production permission authority.
 */
export type M4ContextInput = Readonly<{
  scope: M4Scope;
  image: M4ImageContext;
  permission: Readonly<{
    purpose: "meal_image_assessment";
    status: "allowed" | "denied" | "unknown";
    revision: number;
  }>;
  // An explicit upstream boundary decision, not a medical inference by M4.
  boundary: "within_slice" | "professional_required";
}>;

/** Maps an already understood machine label to this slice's one requirement. */
export type M4Requirement = Readonly<{ task_kind: string; item: M4ContextItem }>;

export type M4Decision =
  | Readonly<{ state: "CONTEXT_SUFFICIENT"; sufficient_for: "NEXT_STEP_CONTRACT_ONLY"; used_context_ids: readonly string[] }>
  | Readonly<{ state: "CONTEXT_REQUIRED"; missing: readonly M4ContextItem[] }>
  | Readonly<{ state: "PERMISSION_REQUIRED"; item: M4ContextItem }>
  | Readonly<{ state: "CONTEXT_DECLINED"; alternative: "TEXT_DESCRIPTION_OPTION"; ask_again: false }>
  | Readonly<{ state: "PROFESSIONAL_HANDOFF_NEEDED"; reason: "OUTSIDE_AI_AUTHORITY" }>
  | Readonly<{ state: "NEED_CLARIFICATION"; next_role: "M3" }>
  | Readonly<{
      state: "DEFERRED";
      reason: "STALE_TASK" | "TASK_NOT_READY" | "M3_BOUNDARY" | "UNSUPPORTED_TASK"
        | "STALE_CONTEXT" | "CONTEXT_UNUSABLE" | "INVALID_CONTEXT";
    }>;
export type M4Result = Readonly<{ scope: M4Scope; decision: M4Decision }>;
