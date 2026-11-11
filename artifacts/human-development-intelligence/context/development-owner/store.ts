import {
  buildDecisionBundle, failClosedState, hydrateState, initialState, reduceGate7State,
  runAcceptanceSuite, serializeState,
  type AppState, type DecisionBundle, type Gate7Action, type TodayMode, type Tradeoff,
} from '../../domain/gate7';
import type { LeaseScope, OwnerAccess, SessionLease } from '../../domain/local-owner/boundary';
import { createGuardedUserStorage, type LocalStorageBackend } from '../../domain/local-owner/storage';

export type DevelopmentOwnerBinding = Readonly<{ access: OwnerAccess; lease: SessionLease }>;
export type DevelopmentContextValue = Readonly<{
  state: AppState;
  decisionBundle: DecisionBundle;
  hydrated: boolean;
  persistenceStatus: 'loading' | 'ready' | 'error';
  persistenceError: string | null;
  setMode: (mode: TodayMode) => void;
  correctInference: (value: string) => void;
  revokeCalendar: () => void;
  chooseTradeoff: (value: Tradeoff) => void;
  reduceLoad: () => void;
  recoverLoad: () => void;
  completeAction: () => void;
  recordOutcome: (note?: string) => void;
  startNewCycle: () => void;
  createLearning: () => void;
  contestClaim: () => void;
  retractClaim: () => void;
  runValidation: () => void;
  resetLocalState: () => Promise<boolean>;
}>;
type Data = Pick<DevelopmentContextValue, 'state' | 'hydrated' | 'persistenceStatus' | 'persistenceError'>;
type Run = Readonly<{ epoch: number; scope: LeaseScope; lease: SessionLease }>;
// The sealed adapter's existing Development slot. Namespace construction stays in that adapter.
const DEVELOPMENT_DATA_KEY = 'state';
const INVALID_DATA = 'Local state không hợp lệ. Recommendation đã bị tắt an toàn.';
const READ_ERROR = 'Không thể đọc local state. Recommendation đã bị tắt an toàn.';
const WRITE_ERROR = 'Không thể lưu local state. Thay đổi chưa được xác nhận là đã lưu.';
const RESET_ERROR = 'Không thể xóa local state. Recommendation đã bị tắt an toàn.';

function freezeState(state: AppState): AppState {
  // Copy nested validation state: never freeze/mutate the shared domain defaults.
  return Object.freeze({ ...state, validationLog: Object.freeze({ ...state.validationLog }) });
}
function freezeBundle(bundle: DecisionBundle): DecisionBundle {
  Object.freeze(bundle.goal);
  Object.freeze(bundle.relevantContext.sources);
  Object.freeze(bundle.relevantContext);
  Object.freeze(bundle.understanding);
  if (bundle.recommendation) Object.freeze(bundle.recommendation);
  Object.freeze(bundle.userDecision);
  Object.freeze(bundle.userAction);
  return Object.freeze(bundle);
}

/** Actual DevelopmentContext lifecycle. No owner lookup, credentials, network or legacy fallback. */
export function createDevelopmentStore(options: {
  owner?: DevelopmentOwnerBinding;
  backend: LocalStorageBackend;
  now?: () => number;
  onSelection?: () => void | Promise<void>;
}) {
  const owner = options.owner ? Object.freeze({ ...options.owner }) : undefined;
  const now = options.now ?? Date.now;
  const onSelection = options.onSelection;
  const storage = owner ? createGuardedUserStorage(owner.access, options.backend) : undefined;
  const listeners = new Set<() => void>();
  let started = false;
  let epoch = 0;
  let run: Run | undefined;
  let unsubscribe: (() => void) | undefined;
  let writesLocked = true;
  let resetting = false;
  let persistenceRevision = 0;
  let data = empty();
  let snapshot: DevelopmentContextValue = makeSnapshot();

  function empty(): Data {
    return { state: freezeState(failClosedState), hydrated: false,
      persistenceStatus: 'loading', persistenceError: null };
  }
  function notify() {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* An observer cannot prevent retirement. No payload logging. */ }
    }
  }
  function publish(patch: Partial<Data>, notifyNow = true) {
    data = { ...data, ...patch };
    snapshot = makeSnapshot();
    if (notifyNow) notify();
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
    epoch++;
    run = undefined;
    writesLocked = true;
    resetting = false;
    data = empty();
    snapshot = makeSnapshot();
    notify();
  }
  function guarded(captured: Run, update: () => void): boolean {
    if (!current(captured)) return false;
    let applied = false;
    try {
      owner!.access.applyIfCurrent(captured.lease, () => {
        if (!current(captured)) return;
        update();
        applied = true;
      });
    } catch (error) {
      if (!current(captured)) return false;
      throw error;
    }
    return applied && current(captured);
  }
  function editable(captured: Run | undefined): captured is Run {
    return current(captured) && data.hydrated && !writesLocked && !resetting;
  }
  function persist(captured: Run, state: AppState) {
    if (!editable(captured)) return;
    const revision = ++persistenceRevision;
    void storage!.writeUserState(captured.lease, DEVELOPMENT_DATA_KEY, serializeState(state))
      .then(() => {
        if (!current(captured) || revision !== persistenceRevision) return;
        guarded(captured, () => publish({ persistenceStatus: 'ready', persistenceError: null }));
      })
      .catch(() => {
        if (!current(captured) || revision !== persistenceRevision) return;
        guarded(captured, () => {
          writesLocked = true;
          publish({ persistenceStatus: 'error', persistenceError: WRITE_ERROR });
        });
      });
  }
  function dispatch(captured: Run | undefined, action: Gate7Action) {
    if (!editable(captured)) return;
    guarded(captured, () => {
      const next = freezeState(reduceGate7State(data.state, action));
      publish({ state: next, persistenceStatus: 'loading', persistenceError: null }, false);
      // Enqueue before notifying observers: a reentrant action/reset must follow this write.
      persist(captured, next);
      notify();
    });
    if (editable(captured) && onSelection) {
      try { void Promise.resolve(onSelection()).catch(() => undefined); } catch { /* Optional haptics. */ }
    }
  }
  async function hydrate(captured: Run) {
    if (!current(captured)) return;
    try {
      const saved = await storage!.readUserState(captured.lease, DEVELOPMENT_DATA_KEY);
      if (!current(captured)) return;
      // Empty string is corrupt, not "missing"; preserve unreadable data until explicit reset.
      const next = saved === null ? initialState
        : typeof saved === 'string' && saved.length > 0 ? hydrateState(saved) : failClosedState;
      guarded(captured, () => {
        writesLocked = next === failClosedState;
        publish({ state: freezeState(next), hydrated: true,
          persistenceStatus: writesLocked ? 'error' : 'ready',
          persistenceError: writesLocked ? INVALID_DATA : null });
      });
    } catch {
      if (current(captured)) guarded(captured, () => {
        writesLocked = true;
        publish({ ...empty(), hydrated: true, persistenceStatus: 'error', persistenceError: READ_ERROR });
      });
    }
  }
  function syncBoundary() {
    if (!started) return;
    const scope = readyScope();
    if (!scope) { if (run) retire(); return; }
    if (run?.scope === scope) return;
    epoch++;
    const captured = Object.freeze({ epoch, scope, lease: owner!.lease });
    run = captured;
    writesLocked = true;
    resetting = false;
    publish(empty());
    void hydrate(captured);
  }
  async function resetLocalState(captured: Run | undefined): Promise<boolean> {
    if (!current(captured) || resetting) return false;
    let deletion: Run | undefined;
    guarded(captured, () => {
      // Retire old hydration/actions/write callbacks without changing the session generation.
      epoch++;
      deletion = Object.freeze({ epoch, scope: captured.scope, lease: captured.lease });
      run = deletion;
      resetting = true;
      writesLocked = true;
      publish(empty(), false);
    });
    if (!deletion || !current(deletion)) return false;
    const resetRun = deletion;
    try {
      // Same sealed queue as pending writes; remove only Development, never other keys/markers.
      const removal = storage!.removeUserState(resetRun.lease, DEVELOPMENT_DATA_KEY);
      notify();
      await removal;
      if (!current(resetRun)) return false;
      return guarded(resetRun, () => {
        resetting = false;
        writesLocked = false;
        publish({ state: freezeState(initialState), hydrated: true,
          persistenceStatus: 'ready', persistenceError: null });
      });
    } catch {
      if (current(resetRun)) guarded(resetRun, () => {
        resetting = false;
        writesLocked = true;
        publish({ ...empty(), hydrated: true, persistenceStatus: 'error', persistenceError: RESET_ERROR });
      });
      return false;
    }
  }
  function makeSnapshot(): DevelopmentContextValue {
    const captured = run;
    const bundle = buildDecisionBundle(data.persistenceStatus === 'error' ? failClosedState : data.state);
    if (data.persistenceStatus === 'error') {
      bundle.recommendation = null;
      bundle.silenceReason = 'persistence_unavailable';
    }
    return Object.freeze({
      ...data, decisionBundle: freezeBundle(bundle),
      setMode: (mode: TodayMode) => dispatch(captured, { type: 'SET_MODE', mode }),
      correctInference: (value: string) => dispatch(captured, { type: 'CORRECT_INFERENCE', value }),
      revokeCalendar: () => { if (editable(captured)) dispatch(captured, { type: 'REVOKE_CALENDAR', at: now() }); },
      chooseTradeoff: (value: Tradeoff) => dispatch(captured, { type: 'CHOOSE_TRADEOFF', value }),
      reduceLoad: () => dispatch(captured, { type: 'REDUCE_LOAD' }),
      recoverLoad: () => dispatch(captured, { type: 'RECOVER_LOAD' }),
      completeAction: () => dispatch(captured, { type: 'COMPLETE_ACTION' }),
      recordOutcome: (note = 'Có đủ khoảng trống để làm việc theo cách phù hợp.') =>
        dispatch(captured, { type: 'RECORD_OUTCOME', note }),
      startNewCycle: () => dispatch(captured, { type: 'START_NEW_CYCLE' }),
      createLearning: () => dispatch(captured, { type: 'ADD_POSITIVE_EPISODE' }),
      contestClaim: () => dispatch(captured, { type: 'CONTEST_CLAIM' }),
      retractClaim: () => dispatch(captured, { type: 'RETRACT_CLAIM' }),
      runValidation: () => {
        if (!editable(captured)) return;
        const suite = runAcceptanceSuite();
        dispatch(captured, { type: 'SET_VALIDATION', log: Object.fromEntries(suite.results.map(result => {
          const fault = suite.faultDetection.find(item => item.testId === result.id);
          return [result.id, result.pass && Boolean(fault?.detected)];
        })) });
      },
      resetLocalState: () => resetLocalState(captured),
    });
  }
  return Object.freeze({
    getSnapshot: () => {
      // Expiry backstop if native/JS timers were suspended.
      if (started && run && !current(run)) retire();
      return snapshot;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start: () => {
      if (started) return;
      started = true;
      unsubscribe = owner?.access.subscribe(syncBoundary);
      syncBoundary();
    },
    stop: () => {
      started = false;
      unsubscribe?.();
      unsubscribe = undefined;
      retire();
    },
  });
}
