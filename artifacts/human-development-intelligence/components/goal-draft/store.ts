import type { LeaseScope, OwnerAccess, SessionLease } from '../../domain/local-owner/boundary';
import { createGuardedUserStorage, type LocalStorageBackend } from '../../domain/local-owner/storage';

/** Supplied by a trusted host; neither the draft nor the M2 gateway creates authority. */
export type GoalDraftOwnerBinding = Readonly<{ access: OwnerAccess; lease: SessionLease }>;
type Persistence = 'memory' | 'loading' | 'ready' | 'error';
type Observation = { scope?: LeaseScope; generation?: number };
type Run = Observation & { edited: boolean; hydrated: boolean; writable: boolean };
export type GoalDraftSnapshot = Readonly<{
  text: string;
  persistence: Persistence;
  isCurrent: () => boolean;
  changeText: (text: string) => boolean;
}>;
const SLOT = 'opening-goal-draft';
const validDraft = (value: unknown): value is string => typeof value === 'string' && value.length <= 1000;

export function createGoalDraftStore(options: {
  owner?: GoalDraftOwnerBinding;
  backend: LocalStorageBackend;
  /** Presentation hints can restrict persistence, never grant it. */
  subjectHint?: string;
  persistenceAllowed?: boolean;
}) {
  const { backend, subjectHint, persistenceAllowed = true } = options;
  const owner = options.owner
    ? Object.freeze({ access: options.owner.access, lease: options.owner.lease }) : undefined;
  const storage = owner ? createGuardedUserStorage(owner.access, backend) : undefined;
  const listeners = new Set<() => void>();
  let active = false, synchronizing = false;
  let unsubscribe: (() => void) | undefined;
  let run: Run = { edited: false, hydrated: false, writable: false };

  const observe = (): Observation => {
    let generation: number | undefined;
    try {
      if (!owner) return {};
      const state = owner.access.getSnapshot();
      generation = state.generation;
      if (state.phase !== 'READY' || !persistenceAllowed) return { generation };
      const scope = owner.access.requireLease(owner.lease);
      if (scope.generation !== generation
        || scope.owner.subjectId !== state.owner.subjectId
        || scope.owner.profileId !== state.owner.profileId
        || (subjectHint !== undefined && subjectHint !== scope.owner.subjectId)) return { generation };
      return { generation, scope };
    } catch { return { generation }; } // Invalid/copied/stale lease: usable RAM, no persistence.
  };
  const current = (captured: Run): boolean => {
    if (!active || run !== captured) return false;
    const observed = observe();
    return run === captured && observed.scope === captured.scope && observed.generation === captured.generation;
  };
  const notify = () => {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* One observer cannot prevent private RAM retirement. */ }
    }
  };
  const publish = (captured: Run, text: string, persistence: Persistence) => {
    snapshot = Object.freeze({ text, persistence,
      isCurrent: () => current(captured), changeText: value => change(captured, value) });
  };
  const apply = (captured: Run, action: () => void) => {
    if (!current(captured)) return;
    try {
      owner!.access.applyIfCurrent(owner!.lease, () => {
        if (current(captured)) action();
        return undefined;
      });
    } catch { synchronize(); }
  };
  const persist = (captured: Run, text: string) => {
    if (!captured.scope || !captured.hydrated || !captured.writable || !current(captured)) return;
    // Enqueue before notifying React/listeners; reentrant edits must retain their order.
    try {
      void storage!.writeUserState(owner!.lease, SLOT, text).catch(() => {
        apply(captured, () => {
          captured.writable = false;
          publish(captured, snapshot.text, 'error'); notify();
        });
      });
    } catch {
      captured.writable = false;
      publish(captured, snapshot.text, 'error');
    }
  };
  const change = (captured: Run, text: string): boolean => {
    if (!validDraft(text) || !current(captured)) return false;
    captured.edited = true;
    publish(captured, text, snapshot.persistence);
    persist(captured, text);
    notify();
    return current(captured);
  };
  let snapshot: GoalDraftSnapshot;
  publish(run, '', 'memory');

  const hydrate = async (captured: Run) => {
    try {
      const saved = await storage!.readUserState(owner!.lease, SLOT);
      if (saved !== null && !validDraft(saved)) throw new Error('INVALID_DRAFT');
      apply(captured, () => {
        captured.hydrated = true;
        captured.writable = true;
        // Typing while hydration waits wins; unowned RAM is never carried into this run.
        publish(captured, captured.edited ? snapshot.text : saved ?? '', 'ready');
        if (captured.edited) persist(captured, snapshot.text);
        notify();
      });
    } catch {
      apply(captured, () => {
        captured.hydrated = true;
        captured.writable = false;
        publish(captured, snapshot.text, 'error'); notify();
      });
    }
  };
  const synchronize = () => {
    if (!active || synchronizing) return;
    synchronizing = true;
    const observed = observe();
    if (observed.scope !== run.scope || observed.generation !== run.generation) {
      run = { ...observed, edited: false, hydrated: false, writable: false };
      const captured = run;
      publish(captured, '', captured.scope ? 'loading' : 'memory');
      // Retire private RAM synchronously. No reset/remove on logout or invalidation.
      if (captured.scope) void hydrate(captured);
      notify();
    }
    synchronizing = false;
  };
  return Object.freeze({
    getSnapshot: (): GoalDraftSnapshot => { synchronize(); return snapshot; },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start: () => {
      if (active) return;
      active = true;
      run = { edited: false, hydrated: false, writable: false };
      publish(run, '', 'memory');
      unsubscribe = owner?.access.subscribe(synchronize);
      synchronize(); notify();
    },
    stop: () => {
      active = false; unsubscribe?.(); unsubscribe = undefined;
      run = { edited: false, hydrated: false, writable: false };
      publish(run, '', 'memory');
    },
  });
}
