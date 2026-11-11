import {
  initialCoachingState, inspectCoaching, serializeCoaching,
  transitionAcceptCorrection, transitionChangeDirection, transitionCreativeDetail,
  transitionCreativeDirection, transitionCreativeInterpretation, transitionCreativeNext,
  transitionCreativePractice, transitionCreativeReturn, transitionPause, transitionResume,
  transitionSelectMovementContext, transitionSelectPath, transitionSelectRelContext,
  transitionSelectWorkContext, transitionStandardPractice, transitionStandardReturn,
  transitionStartStory, transitionStop,
  type CoachingState, type DomainPath, type MovementContext, type RelContext, type WorkContext,
} from '../../domain/coaching';
import type { LeaseScope, OwnerAccess, SessionLease } from '../../domain/local-owner/boundary';
import { createGuardedUserStorage, type LocalStorageBackend } from '../../domain/local-owner/storage';

export type CoachingOwnerBinding = Readonly<{ access: OwnerAccess; lease: SessionLease }>;
export type CoachingOwnerStorageState = 'LOCKED' | 'LOADING' | 'EMPTY' | 'READY'
  | 'ERROR' | 'DELETING' | 'DELETED';
export type CoachingContextValue = Readonly<{
  state: CoachingState;
  hydrated: boolean;
  hasPersistedMemory: boolean;
  persistenceStatus: 'idle' | 'loading' | 'error' | 'ready';
  unreadableDataPreserved: boolean;
  ownerStorageState: CoachingOwnerStorageState;
  projectionRevision: number;
  startStory(value: string): void;
  acceptCorrection(): void;
  changeDirection(): void;
  selectPath(value: DomainPath): void;
  selectWorkContext(value: WorkContext): void;
  selectMovementContext(value: MovementContext): void;
  selectRelContext(value: RelContext): void;
  submitCreativeDetail(value: string): void;
  submitCreativeInterpretation(value: string): void;
  submitCreativeDirection(value: string): void;
  requestExample(): void;
  selectCreativePractice(value: string): void;
  returnFromPractice(): void;
  submitCreativeReturn(value: string, didNotDoIt: boolean): void;
  selectNextTraining(value: string): void;
  selectStandardPractice(value: string): void;
  returnFromStandardPractice(): void;
  submitStandardReturn(value: string, didNotDoIt: boolean): void;
  pause(): void;
  resume(): void;
  skip(): void;
  stop(): void;
  reset(): void;
  update(changes: Partial<CoachingState>): void;
  deleteData(): Promise<boolean>;
}>;
type Run = Readonly<{ epoch: number; scope: LeaseScope; lease: SessionLease }>;
type Data = Pick<CoachingContextValue, 'state' | 'hydrated' | 'hasPersistedMemory'
  | 'persistenceStatus' | 'unreadableDataPreserved' | 'ownerStorageState' | 'projectionRevision'>;
const KEY = 'coaching';
let nextProjectionRevision = 0;
const freezeState = (state: CoachingState): CoachingState => Object.freeze({ ...state });

export function createCoachingStore(options: { owner?: CoachingOwnerBinding; backend: LocalStorageBackend }) {
  const owner = options.owner ? Object.freeze({ ...options.owner }) : undefined;
  const storage = owner ? createGuardedUserStorage(owner.access, options.backend) : undefined;
  const listeners = new Set<() => void>();
  let started = false, epoch = 0, persistenceRevision = 0;
  let run: Run | undefined, unsubscribe: (() => void) | undefined;
  let writesLocked = true, deleting = false;
  let projectionRevision = ++nextProjectionRevision;
  let data = empty('LOCKED');
  let snapshot = makeSnapshot();

  function empty(ownerStorageState: CoachingOwnerStorageState): Data {
    return { state: freezeState(initialCoachingState), hydrated: false, hasPersistedMemory: false,
      persistenceStatus: ownerStorageState === 'ERROR' ? 'error' : 'idle',
      unreadableDataPreserved: false, ownerStorageState, projectionRevision };
  }
  function notify() { for (const listener of [...listeners]) { try { listener(); } catch {} } }
  function publish(patch: Partial<Data>, notifyNow = true) {
    data = { ...data, ...patch }; snapshot = makeSnapshot(); if (notifyNow) notify();
  }
  function readyScope(): LeaseScope | undefined {
    if (!owner || owner.access.getSnapshot().phase !== 'READY') return undefined;
    try { return owner.access.requireLease(owner.lease); } catch { return undefined; }
  }
  function current(captured: Run | undefined): captured is Run {
    return Boolean(started && captured && run === captured && epoch === captured.epoch
      && readyScope() === captured.scope);
  }
  function retire() {
    epoch++; run = undefined; writesLocked = true; deleting = false; projectionRevision = ++nextProjectionRevision;
    data = empty('LOCKED'); snapshot = makeSnapshot(); notify();
  }
  function guarded(captured: Run, callback: () => void): boolean {
    if (!current(captured)) return false;
    let applied = false;
    try {
      owner!.access.applyIfCurrent(captured.lease, () => {
        if (!current(captured)) return; callback(); applied = true;
      });
    } catch { return false; }
    return applied && current(captured);
  }
  function editable(captured: Run | undefined): captured is Run {
    return current(captured) && data.hydrated && !writesLocked && !deleting;
  }
  function persist(captured: Run, state: CoachingState) {
    if (!editable(captured)) return;
    const revision = ++persistenceRevision;
    void storage!.writeUserState(captured.lease, KEY, serializeCoaching(state)).then(() => {
      if (!current(captured) || revision !== persistenceRevision) return;
      guarded(captured, () => publish({ hasPersistedMemory: state.status !== 'idle',
        persistenceStatus: 'ready', ownerStorageState: 'READY' }));
    }).catch(() => {
      if (!current(captured) || revision !== persistenceRevision) return;
      guarded(captured, () => { writesLocked = true; publish({ persistenceStatus: 'error',
        ownerStorageState: 'ERROR' }); });
    });
  }
  function mutate(captured: Run | undefined, reduce: (state: CoachingState) => CoachingState) {
    if (!editable(captured)) return;
    guarded(captured, () => {
      const reduced = reduce(data.state);
      if (reduced === data.state) return;
      const next = freezeState(reduced);
      publish({ state: next, persistenceStatus: 'loading', ownerStorageState: 'LOADING' }, false);
      persist(captured, next); notify();
    });
  }
  async function hydrate(captured: Run) {
    try {
      const raw = await storage!.readUserState(captured.lease, KEY);
      if (!current(captured)) return;
      const result = typeof raw === 'string' || raw === null
        ? inspectCoaching(raw) : { kind: 'unreadable' as const, state: initialCoachingState };
      guarded(captured, () => {
        writesLocked = result.kind === 'unreadable';
        publish({ state: freezeState(result.state), hydrated: true,
          hasPersistedMemory: result.kind === 'ok' && result.state.status !== 'idle',
          unreadableDataPreserved: result.kind === 'unreadable',
          persistenceStatus: result.kind === 'unreadable' ? 'error' : result.kind === 'ok' ? 'ready' : 'idle',
          ownerStorageState: result.kind === 'unreadable' ? 'ERROR' : result.kind === 'ok' ? 'READY' : 'EMPTY' });
      });
    } catch {
      if (current(captured)) guarded(captured, () => {
        writesLocked = true; publish({ ...empty('ERROR'), hydrated: true,
          unreadableDataPreserved: true, persistenceStatus: 'error' });
      });
    }
  }
  function syncBoundary() {
    if (!started) return;
    const scope = readyScope();
    if (!scope) { if (run) retire(); return; }
    if (run?.scope === scope) return;
    epoch++; projectionRevision = ++nextProjectionRevision;
    const captured = Object.freeze({ epoch, scope, lease: owner!.lease });
    run = captured; writesLocked = true; deleting = false;
    publish(empty('LOADING')); void hydrate(captured);
  }
  async function deleteData(captured: Run | undefined): Promise<boolean> {
    if (!current(captured) || deleting) return false;
    let deletion: Run | undefined;
    guarded(captured, () => {
      epoch++; projectionRevision = ++nextProjectionRevision; deletion = Object.freeze({ epoch, scope: captured.scope, lease: captured.lease });
      run = deletion; deleting = true; writesLocked = true;
      publish({ ...empty('DELETING'), persistenceStatus: 'loading' }, false);
    });
    if (!deletion || !current(deletion)) return false;
    const deletionRun = deletion;
    try {
      const removal = storage!.removeUserState(deletionRun.lease, KEY); notify(); await removal;
      if (!current(deletionRun)) return false;
      return guarded(deletionRun, () => {
        deleting = false; writesLocked = false;
        publish({ ...empty('DELETED'), hydrated: true, ownerStorageState: 'DELETED' });
      });
    } catch {
      if (current(deletionRun)) guarded(deletionRun, () => {
        deleting = false; writesLocked = true;
        publish({ ...empty('ERROR'), hydrated: true, unreadableDataPreserved: true,
          persistenceStatus: 'error' });
      });
      return false;
    }
  }
  function makeSnapshot(): CoachingContextValue {
    const captured = run;
    const change = (reduce: (state: CoachingState) => CoachingState) => () => mutate(captured, reduce);
    return Object.freeze({ ...data,
      startStory: (value: string) => mutate(captured, state => transitionStartStory(state, value)),
      acceptCorrection: change(transitionAcceptCorrection), changeDirection: change(transitionChangeDirection),
      selectPath: (value: DomainPath) => mutate(captured, state => transitionSelectPath(state, value)),
      selectWorkContext: (value: WorkContext) => mutate(captured, state => transitionSelectWorkContext(state, value)),
      selectMovementContext: (value: MovementContext) => mutate(captured, state => transitionSelectMovementContext(state, value)),
      selectRelContext: (value: RelContext) => mutate(captured, state => transitionSelectRelContext(state, value)),
      submitCreativeDetail: (value: string) => mutate(captured, state => transitionCreativeDetail(state, value)),
      submitCreativeInterpretation: (value: string) => mutate(captured, state => transitionCreativeInterpretation(state, value)),
      submitCreativeDirection: (value: string) => mutate(captured, state => transitionCreativeDirection(state, value)),
      requestExample: () => mutate(captured, state => ({ ...state, isExampleRequested: true })),
      selectCreativePractice: (value: string) => mutate(captured, state => transitionCreativePractice(state, value)),
      returnFromPractice: () => mutate(captured, state => ({ ...state, status: 'creative_return' })),
      submitCreativeReturn: (value: string, didNotDoIt: boolean) =>
        mutate(captured, state => transitionCreativeReturn(state, value, didNotDoIt)),
      selectNextTraining: (value: string) => mutate(captured, state => transitionCreativeNext(state, value)),
      selectStandardPractice: (value: string) => mutate(captured, state => transitionStandardPractice(state, value)),
      returnFromStandardPractice: () => mutate(captured, state => ({ ...state, status: 'standard_return' })),
      submitStandardReturn: (value: string, didNotDoIt: boolean) =>
        mutate(captured, state => transitionStandardReturn(state, value, didNotDoIt)),
      pause: change(transitionPause), resume: change(transitionResume), skip: change(transitionChangeDirection),
      stop: change(transitionStop), reset: () => mutate(captured, () => initialCoachingState),
      update: (changes: Partial<CoachingState>) => mutate(captured, state => ({ ...state, ...changes })),
      deleteData: () => deleteData(captured),
    });
  }
  return Object.freeze({
    getSnapshot: () => { if (started && run && !current(run)) retire(); return snapshot; },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    start: () => { if (started) return; started = true; unsubscribe = owner?.access.subscribe(syncBoundary); syncBoundary(); },
    stop: () => { started = false; unsubscribe?.(); unsubscribe = undefined; retire(); },
  });
}
