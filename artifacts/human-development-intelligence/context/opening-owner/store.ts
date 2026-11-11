import {
  initialOpeningState, inspectOpening, serializeOpening,
  type ActionStatus, type FocusArea, type HealthResponse, type Need,
  type OpeningPath, type OpeningState, type Usefulness, type WeatherScenario,
} from '../../domain/opening';
import type { LeaseScope, OwnerAccess, SessionLease } from '../../domain/local-owner/boundary';
import { createGuardedUserStorage, type LocalStorageBackend } from '../../domain/local-owner/storage';

export type OpeningOwnerBinding = Readonly<{ access: OwnerAccess; lease: SessionLease }>;
export type OwnerStorageState = 'LOCKED' | 'LOADING' | 'EMPTY' | 'READY'
  | 'ERROR' | 'DELETING' | 'DELETED';
export type OpeningContextValue = Readonly<{
  state: OpeningState;
  hydrated: boolean;
  hasPersistedMemory: boolean;
  unreadableDataPreserved: boolean;
  persistenceStatus: 'idle' | 'loading' | 'error' | 'ready';
  ownerStorageState: OwnerStorageState;
  projectionRevision: number;
  selectFocus(value: FocusArea): void;
  selectNeed(value: Need): void;
  selectPath(value: OpeningPath): void;
  editFocus(): void;
  skip(): void;
  startDifferentTopic(): void;
  chooseWeather(value: WeatherScenario): void;
  setHealthDemo(value: boolean): void;
  setHealthResponse(value: HealthResponse): void;
  setActionStatus(value: ActionStatus): void;
  setUsefulness(value: Usefulness): void;
  forgetMemory(): Promise<boolean>;
}>;
type Run = Readonly<{ epoch: number; scope: LeaseScope; lease: SessionLease }>;
type Data = Pick<OpeningContextValue, 'state' | 'hydrated' | 'hasPersistedMemory'
  | 'unreadableDataPreserved' | 'persistenceStatus' | 'ownerStorageState' | 'projectionRevision'>;
const KEY = 'opening';
let nextProjectionRevision = 0;

const freezeState = (state: OpeningState): OpeningState => Object.freeze({ ...state });

export function createOpeningStore(options: { owner?: OpeningOwnerBinding; backend: LocalStorageBackend }) {
  const owner = options.owner ? Object.freeze({ ...options.owner }) : undefined;
  const storage = owner ? createGuardedUserStorage(owner.access, options.backend) : undefined;
  const listeners = new Set<() => void>();
  let started = false, epoch = 0, persistenceRevision = 0;
  let run: Run | undefined, unsubscribe: (() => void) | undefined;
  let writesLocked = true, deleting = false;
  let projectionRevision = ++nextProjectionRevision;
  let data = empty('LOCKED');
  let snapshot = makeSnapshot();

  function empty(ownerStorageState: OwnerStorageState): Data {
    return { state: freezeState(initialOpeningState), hydrated: false, hasPersistedMemory: false,
      unreadableDataPreserved: false, persistenceStatus: ownerStorageState === 'ERROR' ? 'error' : 'idle',
      ownerStorageState, projectionRevision };
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
    epoch++; run = undefined; writesLocked = true; deleting = false; projectionRevision++;
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
  function persist(captured: Run, state: OpeningState) {
    if (!editable(captured)) return;
    const revision = ++persistenceRevision;
    void storage!.writeUserState(captured.lease, KEY, serializeOpening(state)).then(() => {
      if (!current(captured) || revision !== persistenceRevision) return;
      guarded(captured, () => publish({ hasPersistedMemory: true,
        persistenceStatus: 'ready', ownerStorageState: 'READY' }));
    }).catch(() => {
      if (!current(captured) || revision !== persistenceRevision) return;
      guarded(captured, () => { writesLocked = true; publish({ persistenceStatus: 'error',
        ownerStorageState: 'ERROR' }); });
    });
  }
  function mutate(captured: Run | undefined, reduce: (state: OpeningState) => OpeningState) {
    if (!editable(captured)) return;
    guarded(captured, () => {
      const next = freezeState(reduce(data.state));
      if (next === data.state) return;
      publish({ state: next, persistenceStatus: 'loading', ownerStorageState: 'LOADING' }, false);
      persist(captured, next); notify();
    });
  }
  async function hydrate(captured: Run) {
    try {
      const raw = await storage!.readUserState(captured.lease, KEY);
      if (!current(captured)) return;
      const result = typeof raw === 'string' || raw === null
        ? inspectOpening(raw) : { kind: 'unreadable' as const, state: initialOpeningState };
      guarded(captured, () => {
        writesLocked = result.kind === 'unreadable';
        publish({ state: freezeState(result.state), hydrated: true,
          hasPersistedMemory: result.kind === 'ok', unreadableDataPreserved: result.kind === 'unreadable',
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
    epoch++; projectionRevision++;
    const captured = Object.freeze({ epoch, scope, lease: owner!.lease });
    run = captured; writesLocked = true; deleting = false;
    publish(empty('LOADING')); void hydrate(captured);
  }
  async function forgetMemory(captured: Run | undefined): Promise<boolean> {
    if (!current(captured) || deleting) return false;
    let deletion: Run | undefined;
    guarded(captured, () => {
      epoch++; projectionRevision++; deletion = Object.freeze({ epoch, scope: captured.scope, lease: captured.lease });
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
  function makeSnapshot(): OpeningContextValue {
    const captured = run;
    return Object.freeze({ ...data,
      selectFocus: (focusArea: FocusArea) => mutate(captured, () => ({ ...initialOpeningState,
        status: 'guided', focusArea })),
      selectNeed: (need: Need) => mutate(captured, state => ({ ...state, status: 'guided', need, path: null })),
      selectPath: (path: OpeningPath) => mutate(captured, state => ({ ...state, status: 'completed', path })),
      editFocus: () => mutate(captured, state => ({ ...state, status: state.focusArea ? 'guided' : 'new',
        need: null, path: null, weatherScenario: 'none', healthDemoHistory: false,
        healthResponse: null, actionStatus: 'not_started', usefulness: null })),
      skip: () => mutate(captured, state => ({ ...state, status: 'skipped', path: null })),
      startDifferentTopic: () => mutate(captured, () => initialOpeningState),
      chooseWeather: (weatherScenario: WeatherScenario) => mutate(captured, state => ({ ...state, weatherScenario })),
      setHealthDemo: (healthDemoHistory: boolean) => mutate(captured, state => ({ ...state,
        healthDemoHistory, healthResponse: null })),
      setHealthResponse: (healthResponse: HealthResponse) => mutate(captured, state => ({ ...state, healthResponse })),
      setActionStatus: (actionStatus: ActionStatus) => mutate(captured, state => ({ ...state, actionStatus })),
      setUsefulness: (usefulness: Usefulness) => mutate(captured, state => ({ ...state, usefulness })),
      forgetMemory: () => forgetMemory(captured),
    });
  }
  return Object.freeze({
    getSnapshot: () => { if (started && run && !current(run)) retire(); return snapshot; },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    start: () => { if (started) return; started = true; unsubscribe = owner?.access.subscribe(syncBoundary); syncBoundary(); },
    stop: () => { started = false; unsubscribe?.(); unsubscribe = undefined; retire(); },
  });
}
