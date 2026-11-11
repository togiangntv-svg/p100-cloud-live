import type { AiIntentResult } from '@workspace/api-client-react';

export type M3IntentBinding = Readonly<{
  requestId: string;
  sessionId: string;
  sessionRevision: string;
  taskId: string;
  taskRevision: string;
  inputRevision: string;
}>;

export type M3IntentApplication =
  | { status: 'applied'; understanding: AiIntentResult['understanding'] }
  | { status: 'stale' | 'cancelled' };

const sameBinding = (a: M3IntentBinding, b: M3IntentBinding): boolean =>
  a.requestId === b.requestId
  && a.sessionId === b.sessionId
  && a.sessionRevision === b.sessionRevision
  && a.taskId === b.taskId
  && a.taskRevision === b.taskRevision
  && a.inputRevision === b.inputRevision;

/**
 * SessionTask remains host-owned, memory-only state. This guard stores only the
 * current request binding and never writes a task, goal, intent, or result.
 */
export function createM3IntentGuard() {
  let current: M3IntentBinding | null = null;
  let cancelled = new Set<string>();
  return Object.freeze({
    begin(binding: M3IntentBinding): M3IntentBinding {
      current = Object.freeze({ ...binding });
      return current;
    },
    cancel(requestId: string): void {
      cancelled.add(requestId);
      if (current?.requestId === requestId) current = null;
    },
    invalidate(): void {
      current = null;
    },
    apply(result: AiIntentResult): M3IntentApplication {
      if (cancelled.has(result.requestId)) return { status: 'cancelled' };
      const resultBinding: M3IntentBinding = {
        requestId: result.requestId,
        sessionId: result.sessionId,
        sessionRevision: result.sessionRevision,
        taskId: result.taskId,
        taskRevision: result.taskRevision,
        inputRevision: result.inputRevision,
      };
      if (!current || !sameBinding(current, resultBinding)) return { status: 'stale' };
      current = null;
      return { status: 'applied', understanding: result.understanding };
    },
    isCurrent(binding: M3IntentBinding): boolean {
      return current !== null && sameBinding(current, binding);
    },
  });
}