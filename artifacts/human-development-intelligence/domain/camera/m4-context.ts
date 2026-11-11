import type { CameraAcceptedReceipt, CameraTaskScope } from './candidate.ts';
import type { M4ContextInput, M4Result, M4Scope } from '../m4/contract.ts';
import { resolveM4Context } from '../m4/resolver.ts';
import type { SessionTask } from '../session-task/store.ts';

export type CameraC1PermissionStatus = 'unknown' | 'allowed' | 'denied';
export type CameraC1ExternalReadiness = 'LOCAL_ONLY';

export type CameraC1ContextRef = Readonly<CameraTaskScope & {
  context_id: string;
  candidate_id: string;
  permission_revision: number;
  external_readiness: CameraC1ExternalReadiness;
}>;

type CameraC1Entry = Readonly<{
  scope: CameraTaskScope;
  context_id: string;
  candidate_id: string;
  usable: boolean;
  permission: Readonly<{
    status: CameraC1PermissionStatus;
    revision: number;
  }>;
  external_readiness: CameraC1ExternalReadiness;
}>;

const freezeScope = (scope: CameraTaskScope): CameraTaskScope => Object.freeze({
  session_id: scope.session_id,
  task_id: scope.task_id,
  revision: scope.revision,
});

const validScope = (scope: CameraTaskScope): boolean => Boolean(
  scope.session_id && scope.task_id && Number.isSafeInteger(scope.revision) && scope.revision > 0,
);

const sameScope = (a: M4Scope, b: M4Scope): boolean =>
  a.session_id === b.session_id && a.task_id === b.task_id && a.revision === b.revision;

const publicRef = (entry: CameraC1Entry): CameraC1ContextRef => Object.freeze({
  ...entry.scope,
  context_id: entry.context_id,
  candidate_id: entry.candidate_id,
  permission_revision: entry.permission.revision,
  external_readiness: entry.external_readiness,
});

const sameProjection = (a: M4ContextInput, b: M4ContextInput): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Camera is offered only for the exact current M4 meal-image requirement. */
export function mayOfferCameraForM4(scope: CameraTaskScope, result: M4Result): boolean {
  return validScope(scope)
    && sameScope(scope, result.scope)
    && result.decision.state === 'CONTEXT_REQUIRED'
    && result.decision.missing.includes('meal_image');
}

/**
 * Ephemeral C1 authority. It stores no URI, file data, metadata or external payload.
 * Every permission mutation creates a new revision and invalidates older projections.
 */
export function createCameraM4ContextStore() {
  let entry: CameraC1Entry | undefined;
  let declinedScope: CameraTaskScope | undefined;
  let activeScope: CameraTaskScope | undefined;
  let contextSequence = 0;
  let permissionSequence = 0;

  const clearAuthority = () => {
    entry = undefined;
    declinedScope = undefined;
  };

  const bind = (scope: CameraTaskScope): boolean => {
    if (!validScope(scope)) return false;
    if (activeScope && sameScope(activeScope, scope)) return true;
    clearAuthority();
    activeScope = freezeScope(scope);
    return true;
  };

  const project = (scope: CameraTaskScope): M4ContextInput => {
    const revision = Math.max(permissionSequence, 1);
    if (activeScope && sameScope(activeScope, scope) && declinedScope) {
      return Object.freeze({
        scope: freezeScope(scope),
        image: Object.freeze({ state: 'declined' as const }),
        permission: Object.freeze({
          purpose: 'meal_image_assessment' as const,
          status: 'unknown' as const,
          revision,
        }),
        boundary: 'within_slice' as const,
      });
    }
    if (!activeScope || !sameScope(activeScope, scope) || !entry) {
      return Object.freeze({
        scope: freezeScope(scope),
        image: Object.freeze({ state: 'absent' as const }),
        permission: Object.freeze({
          purpose: 'meal_image_assessment' as const,
          status: 'unknown' as const,
          revision,
        }),
        boundary: 'within_slice' as const,
      });
    }
    return Object.freeze({
      scope: freezeScope(scope),
      image: Object.freeze({
        state: 'present' as const,
        id: entry.context_id,
        usable: entry.usable,
        permission_revision: entry.permission.revision,
      }),
      permission: Object.freeze({
        purpose: 'meal_image_assessment' as const,
        status: entry.permission.status,
        revision: entry.permission.revision,
      }),
      boundary: 'within_slice' as const,
    });
  };

  const matches = (ref: CameraC1ContextRef): boolean => Boolean(entry
    && sameScope(entry.scope, ref)
    && entry.context_id === ref.context_id
    && entry.candidate_id === ref.candidate_id
    && entry.permission.revision === ref.permission_revision);

  const changePermission = (
    ref: CameraC1ContextRef,
    status: CameraC1PermissionStatus,
  ): CameraC1ContextRef | undefined => {
    if (!matches(ref) || !entry) return undefined;
    entry = Object.freeze({
      ...entry,
      permission: Object.freeze({ status, revision: ++permissionSequence }),
    });
    return publicRef(entry);
  };

  return Object.freeze({
    consume: (
      receipt: CameraAcceptedReceipt,
      usable = true,
    ): CameraC1ContextRef | undefined => {
      if (receipt.choice !== 'USE_PHOTO' || !validScope(receipt)
        || !receipt.candidate_id || typeof usable !== 'boolean') return undefined;
      if (!activeScope || !sameScope(activeScope, receipt)) return undefined;
      if (entry && sameScope(entry.scope, receipt)
        && entry.candidate_id === receipt.candidate_id) return publicRef(entry);
      declinedScope = undefined;
      entry = Object.freeze({
        scope: freezeScope(receipt),
        context_id: `camera-c1-context-${++contextSequence}`,
        candidate_id: receipt.candidate_id,
        usable,
        permission: Object.freeze({ status: 'unknown' as const, revision: ++permissionSequence }),
        external_readiness: 'LOCAL_ONLY' as const,
      });
      return publicRef(entry);
    },
    allow: (ref: CameraC1ContextRef) => changePermission(ref, 'allowed'),
    deny: (ref: CameraC1ContextRef) => changePermission(ref, 'denied'),
    revoke: (ref: CameraC1ContextRef) => changePermission(ref, 'denied'),
    bind,
    decline: (scope: CameraTaskScope): boolean => {
      if (!validScope(scope) || !activeScope || !sameScope(activeScope, scope)) return false;
      entry = undefined;
      declinedScope = freezeScope(scope);
      permissionSequence += 1;
      return true;
    },
    project,
    assess: (
      task: SessionTask,
      proposed: M4ContextInput,
    ): M4Result => {
      const taskScope = {
        session_id: task.session_id,
        task_id: task.task_id,
        revision: task.revision,
      };
      if (!sameScope(taskScope, proposed.scope)) return resolveM4Context(task, proposed);
      const current = project(taskScope);
      if (sameProjection(current, proposed)) return resolveM4Context(task, proposed);
      if (current.image.state !== 'present' || current.permission.status !== 'allowed') {
        return resolveM4Context(task, current);
      }
      // A stale or altered projection cannot inherit the current ALLOWED authority.
      const failClosed = Object.freeze({
        ...current,
        permission: Object.freeze({ ...current.permission, status: 'unknown' as const }),
      });
      return resolveM4Context(task, failClosed);
    },
    retire: () => {
      clearAuthority();
      activeScope = undefined;
    },
    getSnapshot: (): CameraC1ContextRef | undefined => entry ? publicRef(entry) : undefined,
  });
}
