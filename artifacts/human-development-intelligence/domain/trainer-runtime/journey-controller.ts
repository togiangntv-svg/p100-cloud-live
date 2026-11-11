import type { LanguageInput } from '../m3/contract';
import type { M4Result } from '../m4/contract';
import type { GoalM5ChoiceReceipt, GoalM5Decision } from '../m5/goal-choice';
import type { TaskRef } from '../session-task/store';
import type { M7OutcomeFacts, M7PurposeReceipt } from '../m7/outcome';
import type { TrainerTwoCycle, TrainerTwoCycleAdvanceResult, TrainerTwoCycleSnapshot } from './two-cycle';

export type TrainerJourneyExecution = 'DID' | 'PARTIAL' | 'SKIPPED' | 'UNKNOWN';
export type TrainerJourneyDraft = Readonly<{
  execution_extent?: TrainerJourneyExecution;
  user_stopped?: boolean;
  problem_state?: 'NO_PROBLEM_REPORTED' | 'PROBLEM' | 'UNKNOWN';
  safety_disposition?: 'CLEAR' | 'REASSESS' | 'URGENT_HELP';
  action_change?: 'UNCHANGED' | 'CHANGED' | 'UNKNOWN';
  constraint?: 'NONE_REPORTED' | 'TIME_CONSTRAINT' | 'OTHER_CONSTRAINT' | 'UNKNOWN';
}>;

export type TrainerJourneyFixture = Readonly<{
  kind: 'TEST_FIXTURE';
  walk_context: Readonly<Record<string, unknown>>;
}>;

export type TrainerJourneyView =
  | Readonly<{ state: 'UNAVAILABLE'; token: string; simulation: false }>
  | Readonly<{
      state: 'CURRENT';
      token: string;
      simulation: true;
      cycle: 'A' | 'B';
      action_availability: 'AVAILABLE' | 'SAFETY_HOLD' | 'BASIS_STALE' | 'REASSESS_REQUIRED' | 'UNAVAILABLE';
      task?: Readonly<{
        label: string;
        status: 'ROUTING' | 'READY' | 'BLOCKED';
        notice: string;
      }>;
      goal?: Readonly<{ state: 'PROPOSED' | 'ACCEPTED' }>;
      action?: Readonly<{
        state: 'PROPOSED' | 'ACCEPTED' | 'STARTED' | 'STOPPED' | 'CANCELLED' | 'INVALIDATED';
        has_started: boolean;
        duration_minutes: number;
        title: string;
        instructions: string;
        warning: string;
        why: string;
      }>;
      draft?: TrainerJourneyDraft;
      outcome?: Readonly<{
        state: 'ACTIVE' | 'RETRACTED';
        revision: number;
        facts?: M7OutcomeFacts;
      }>;
      next_use: 'OFF' | 'ON';
      next: Readonly<{
        eligible: boolean;
        result?: TrainerTwoCycleAdvanceResult['state'];
        reason?: string;
      }>;
      history?: Readonly<{
        cycle: 'A';
        expanded: boolean;
        outcome?: Readonly<{
          state: 'ACTIVE' | 'RETRACTED';
          revision: number;
          facts?: M7OutcomeFacts;
        }>;
        next_use: 'OFF' | 'ON';
      }>;
      message?: 'NOT_RECORDED' | 'RECORDED' | 'STALE' | 'DENIED' | 'DELETED'
        | 'RETRACTED' | 'CORRECTED' | 'NEXT_USE_ALLOWED' | 'NEXT_USE_REVOKED'
        | 'RECORD_REVOKED' | 'NEXT_CREATED';
    }>;

export type TrainerJourneyCommands = Readonly<{
  submitGoal: (token: string, input: Readonly<{
    text: string;
    locale: LanguageInput['locale'];
    permission_granted: boolean;
    permission_revision?: number;
  }>) => boolean;
  editGoal: (token: string, text: string) => boolean;
  cancelGoal: (token: string) => boolean;
  acceptGoal: (token: string) => boolean;
  acceptAction: (token: string) => boolean;
  startAction: (token: string) => boolean;
  stopAction: (token: string) => boolean;
  openOutcomeDraft: (token: string) => boolean;
  updateOutcomeDraft: (token: string, patch: TrainerJourneyDraft) => boolean;
  discardOutcomeDraft: (token: string) => boolean;
  recordOutcome: (token: string) => boolean;
  allowNextUse: (token: string) => boolean;
  revokeNextUse: (token: string) => boolean;
  createNextCycle: (token: string) => TrainerTwoCycleAdvanceResult | undefined;
  toggleHistory: (token: string) => boolean;
  openHistoryCorrection: (token: string) => boolean;
  retractHistory: (token: string) => boolean;
  deleteHistory: (token: string) => boolean;
  revokeHistoryRecord: (token: string) => boolean;
}>;

export type TrainerJourneyController = Readonly<{
  getView: () => TrainerJourneyView;
  subscribe: (listener: () => void) => () => void;
  commands: TrainerJourneyCommands;
}>;

type WalkProposal = Parameters<TrainerTwoCycle['store']['selfWalk']['accept']>[1];

type CycleState = {
  cycle: TrainerTwoCycle;
  taskId?: string;
  ref?: TaskRef;
  m4?: M4Result;
  m5?: GoalM5Decision;
  goalReceipt?: GoalM5ChoiceReceipt;
  proposal?: WalkProposal;
  recordReceipt?: M7PurposeReceipt;
  nextReceipt?: M7PurposeReceipt;
  outcomeRevision?: number;
  draft?: TrainerJourneyDraft;
  draftMode?: 'NEW' | 'CORRECT';
  expectedOutcomeRevision?: number;
  message?: Extract<TrainerJourneyView, { state: 'CURRENT' }>['message'];
  nextResult?: TrainerTwoCycleAdvanceResult;
};

const unavailable: TrainerJourneyView = Object.freeze({
  state: 'UNAVAILABLE', token: 'journey:unavailable', simulation: false,
});

const validText = (value: unknown): value is string =>
  typeof value === 'string' && Boolean(value.trim()) && value.length <= 1000;

function copyDraft(value: TrainerJourneyDraft): TrainerJourneyDraft {
  return Object.freeze({
    ...(value.execution_extent === undefined ? {} : { execution_extent: value.execution_extent }),
    ...(value.user_stopped === undefined ? {} : { user_stopped: value.user_stopped }),
    ...(value.problem_state === undefined ? {} : { problem_state: value.problem_state }),
    ...(value.safety_disposition === undefined ? {} : { safety_disposition: value.safety_disposition }),
    ...(value.action_change === undefined ? {} : { action_change: value.action_change }),
    ...(value.constraint === undefined ? {} : { constraint: value.constraint }),
  });
}

function completeDraft(draft: TrainerJourneyDraft | undefined): draft is Required<TrainerJourneyDraft> {
  if (!draft || draft.execution_extent === undefined || draft.user_stopped === undefined
    || draft.problem_state === undefined || draft.action_change === undefined
    || draft.constraint === undefined) return false;
  if (draft.problem_state === 'PROBLEM') {
    return draft.safety_disposition === 'REASSESS' || draft.safety_disposition === 'URGENT_HELP';
  }
  return draft.problem_state === 'UNKNOWN' && draft.safety_disposition === 'REASSESS'
    || draft.problem_state === 'NO_PROBLEM_REPORTED' && draft.safety_disposition === 'CLEAR';
}

/**
 * UI-safe, RAM-only facade over the canonical Two-Cycle runtime. Trusted
 * references, receipts and domain objects never leave this closure.
 */
export function createTrainerJourneyController(options: Readonly<{
  getRuntimeSnapshot: () => TrainerTwoCycleSnapshot;
  subscribeRuntime: (listener: () => void) => () => void;
  createNextCycleFromA: () => TrainerTwoCycleAdvanceResult;
  fixture?: TrainerJourneyFixture;
}>): TrainerJourneyController {
  const listeners = new Set<() => void>();
  const cycleStates = new Map<'A' | 'B', CycleState>();
  const storeUnsubscribers = new Map<'A' | 'B', () => void>();
  let view: TrainerJourneyView = unavailable;
  let runtimeA: TrainerTwoCycle | undefined;
  let runtimeB: TrainerTwoCycle | undefined;
  let revision = 0;
  let requestSequence = 0;
  let commandActive = false;
  let historyExpanded = false;

  const notify = () => {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* presentation observers own no domain transition */ }
    }
  };

  const nextRequestId = (cycle: 'A' | 'B', operation: string) => {
    requestSequence += 1;
    return `journey-${cycle}-${operation}-${requestSequence}`;
  };

  const readOutcome = (state: CycleState) => {
    if (!state.recordReceipt) return undefined;
    const result = state.cycle.store.m7Outcome.getSnapshot(state.recordReceipt);
    if (result.state !== 'ACTIVE' && result.state !== 'RETRACTED') return undefined;
    return Object.freeze({
      state: result.state,
      revision: result.revision,
      ...(result.state === 'ACTIVE' ? { facts: result.outcome } : {}),
    });
  };

  const actionView = (state: CycleState) => {
    const snapshot = state.cycle.store.selfWalk.getSnapshot();
    if (!('action_id' in snapshot)) return undefined;
    if (!['PROPOSED', 'ACCEPTED', 'STARTED', 'STOPPED', 'CANCELLED', 'INVALIDATED']
      .includes(snapshot.state)) return undefined;
    return Object.freeze({
      state: snapshot.state as 'PROPOSED' | 'ACCEPTED' | 'STARTED' | 'STOPPED'
        | 'CANCELLED' | 'INVALIDATED',
      has_started: Boolean(snapshot.start),
      duration_minutes: snapshot.duration_minutes,
      title: snapshot.content.title,
      instructions: snapshot.content.instructions,
      warning: snapshot.content.warning,
      why: snapshot.content.why,
    });
  };

  const makeView = (): TrainerJourneyView => {
    const runtime = options.getRuntimeSnapshot();
    if (!options.fixture || runtime.state !== 'READY') return unavailable;
    const currentCycle = runtime.cycle_b ?? runtime.cycle_a;
    const current = cycleStates.get(currentCycle.id);
    if (!current) return unavailable;
    const task = current.taskId
      ? current.cycle.store.getSnapshot().tasks.find(item => item.task_id === current.taskId)
      : undefined;
    const outcome = readOutcome(current);
    const historyState = runtime.cycle_b ? cycleStates.get('A') : undefined;
    const historyOutcome = historyState ? readOutcome(historyState) : undefined;
    const authority = current.cycle.m7.getSnapshot();
    const token = `journey:${++revision}:${currentCycle.id}:${task?.revision ?? 0}:${outcome?.revision ?? 0}`;
    return Object.freeze({
      state: 'CURRENT' as const,
      token,
      simulation: true as const,
      cycle: currentCycle.id,
      action_availability: current.cycle.store.getTrainerActionAvailability(),
      ...(task ? { task: Object.freeze({
        label: task.source_input,
        status: task.status === 'NEEDS_ROUTING' ? 'ROUTING' as const
          : task.status === 'READY' ? 'READY' as const : 'BLOCKED' as const,
        notice: task.interpretation?.response ?? '',
      }) } : {}),
      ...(current.goalReceipt ? { goal: Object.freeze({ state: 'ACCEPTED' as const }) }
        : current.m5?.state === 'PROPOSAL'
          ? { goal: Object.freeze({ state: 'PROPOSED' as const }) } : {}),
      ...(actionView(current) ? { action: actionView(current)! } : {}),
      ...((historyState?.draft ?? current.draft)
        ? { draft: (historyState?.draft ?? current.draft)! } : {}),
      ...(outcome ? { outcome } : {}),
      next_use: authority.use_next_cycle_receipt ? 'ON' as const : 'OFF' as const,
      next: Object.freeze({
        eligible: currentCycle.id === 'A' && outcome?.state === 'ACTIVE'
          && Boolean(authority.use_next_cycle_receipt) && !runtime.cycle_b,
        ...(current.nextResult ? { result: current.nextResult.state } : {}),
        ...(current.nextResult && current.nextResult.state !== 'CREATED'
          ? { reason: current.nextResult.reason } : {}),
      }),
      ...(historyState ? { history: Object.freeze({
        cycle: 'A' as const,
        expanded: historyExpanded,
        ...(historyOutcome ? { outcome: historyOutcome } : {}),
        next_use: historyState.cycle.m7.getSnapshot().use_next_cycle_receipt
          ? 'ON' as const : 'OFF' as const,
      }) } : {}),
      ...(current.message ? { message: current.message } : {}),
    });
  };

  const publish = () => {
    view = makeView();
    notify();
  };

  const syncCurrentCycle = (state: CycleState) => {
    if (!state.taskId) return;
    const task = state.cycle.store.getSnapshot().tasks.find(item => item.task_id === state.taskId);
    if (!task) {
      state.taskId = undefined;
      state.ref = undefined;
      state.m4 = undefined;
      state.m5 = undefined;
      state.goalReceipt = undefined;
      state.proposal = undefined;
      state.draft = undefined;
      return;
    }
    const ref = state.cycle.store.reference(state.taskId);
    if (!ref) return;
    state.ref = ref;
    state.m4 = state.cycle.store.assessM4GoalReadiness(ref);
    state.m5 = state.cycle.store.assessM5Goal(ref, state.m4);
    state.goalReceipt = state.cycle.store.getM5GoalChoiceReceipt(ref) ?? state.goalReceipt;
  };

  const attachStore = (cycle: TrainerTwoCycle) => {
    if (storeUnsubscribers.has(cycle.id)) return;
    storeUnsubscribers.set(cycle.id, cycle.store.subscribe(() => {
      if (commandActive) {
        return;
      }
      const runtime = options.getRuntimeSnapshot();
      // Once B exists A is historical; never reconstruct its retained ref.
      if (runtime.state === 'READY' && (!runtime.cycle_b || cycle.id === 'B')) {
        const state = cycleStates.get(cycle.id);
        if (state) syncCurrentCycle(state);
      }
      publish();
    }));
  };

  const resetAll = () => {
    for (const unsubscribe of storeUnsubscribers.values()) unsubscribe();
    storeUnsubscribers.clear();
    cycleStates.clear();
    runtimeA = undefined;
    runtimeB = undefined;
    historyExpanded = false;
  };

  const reconcileRuntime = () => {
    const runtime = options.getRuntimeSnapshot();
    if (!options.fixture || runtime.state !== 'READY') {
      resetAll();
      publish();
      return;
    }
    if (runtimeA !== runtime.cycle_a) {
      resetAll();
      runtimeA = runtime.cycle_a;
      cycleStates.set('A', { cycle: runtime.cycle_a });
      attachStore(runtime.cycle_a);
    }
    if (runtime.cycle_b && runtimeB !== runtime.cycle_b) {
      runtimeB = runtime.cycle_b;
      cycleStates.set('B', { cycle: runtime.cycle_b });
      attachStore(runtime.cycle_b);
    }
    const current = cycleStates.get(runtime.cycle_b ? 'B' : 'A');
    if (current) syncCurrentCycle(current);
    publish();
  };

  const run = <T>(token: string, denied: T, operation: () => T): T => {
    if (commandActive || view.state !== 'CURRENT' || token !== view.token) return denied;
    commandActive = true;
    try {
      return operation();
    } finally {
      commandActive = false;
      reconcileRuntime();
    }
  };

  // Stop only reduces authority and always targets the controller's current
  // private proposal. A stale presentation token must not prevent a person
  // from stopping an action that has already started.
  const runSafetyReduction = <T>(denied: T, operation: () => T): T => {
    if (commandActive || view.state !== 'CURRENT') return denied;
    commandActive = true;
    try {
      return operation();
    } finally {
      commandActive = false;
      reconcileRuntime();
    }
  };

  const currentState = () => {
    const runtime = options.getRuntimeSnapshot();
    return runtime.state === 'READY' ? cycleStates.get(runtime.cycle_b ? 'B' : 'A') : undefined;
  };

  const historyState = () => {
    const runtime = options.getRuntimeSnapshot();
    return runtime.state === 'READY' && runtime.cycle_b ? cycleStates.get('A') : undefined;
  };

  const submitGoal: TrainerJourneyCommands['submitGoal'] = (token, input) =>
    run(token, false, () => {
      const state = currentState();
      if (!state || !validText(input.text)) return false;
      const taskId = state.cycle.store.submit(input.text.trim(), {
        locale: input.locale,
        permission_granted: input.permission_granted,
        permission_revision: input.permission_revision,
      });
      if (!taskId) return false;
      state.taskId = taskId;
      state.ref = undefined;
      state.m4 = undefined;
      state.m5 = undefined;
      state.goalReceipt = undefined;
      state.proposal = undefined;
      state.draft = undefined;
      state.message = undefined;
      return true;
    });

  const commands: TrainerJourneyCommands = Object.freeze({
    submitGoal,

    editGoal: (token, text) => run(token, false, () => {
      const state = currentState();
      if (!state?.ref || !validText(text) || !state.cycle.store.edit(state.ref, text.trim())) return false;
      state.proposal = undefined;
      state.draft = undefined;
      state.message = undefined;
      return true;
    }),

    cancelGoal: token => run(token, false, () => {
      const state = currentState();
      if (!state?.ref || !state.cycle.store.cancel(state.ref)) return false;
      state.proposal = undefined;
      state.draft = undefined;
      return true;
    }),

    acceptGoal: token => run(token, false, () => {
      const state = currentState();
      if (!state?.ref || state.m5?.state !== 'PROPOSAL') return false;
      const receipt = state.cycle.store.acceptM5Goal(state.ref, state.m5);
      if (!receipt || !state.taskId) return false;
      const ref = state.cycle.store.reference(state.taskId);
      if (!ref || !state.cycle.store.selfWalk.reportContext(ref, options.fixture!.walk_context)) return false;
      const proposal = state.cycle.store.selfWalk.propose(ref,
        nextRequestId(state.cycle.id, 'proposal'));
      if (!('action_id' in proposal) || proposal.state !== 'PROPOSED') return false;
      state.goalReceipt = receipt;
      state.ref = ref;
      state.proposal = proposal as WalkProposal;
      state.message = undefined;
      return true;
    }),

    acceptAction: token => run(token, false, () => {
      const state = currentState();
      if (!state?.ref || !state.proposal) return false;
      const result = state.cycle.store.selfWalk.accept(state.ref, state.proposal,
        nextRequestId(state.cycle.id, 'accept'));
      return result.state === 'ACCEPTED';
    }),

    startAction: token => run(token, false, () => {
      const state = currentState();
      if (!state?.ref || !state.proposal) return false;
      const result = state.cycle.store.selfWalk.start(state.ref, state.proposal,
        nextRequestId(state.cycle.id, 'start'));
      return result.state === 'STARTED';
    }),

    stopAction: _token => runSafetyReduction(false, () => {
      const state = currentState();
      if (!state?.proposal) return false;
      const result = state.cycle.store.selfWalk.stop(state.proposal.scope, state.proposal,
        nextRequestId(state.cycle.id, 'stop'));
      return result.state === 'STOPPED';
    }),

    openOutcomeDraft: token => run(token, false, () => {
      const state = currentState();
      if (!state?.proposal || !state.cycle.store.selfWalk.getEpisode(state.proposal.scope)
        || readOutcome(state)) return false;
      state.draft = Object.freeze({});
      state.draftMode = 'NEW';
      state.message = undefined;
      return true;
    }),

    updateOutcomeDraft: (token, patch) => run(token, false, () => {
      const current = currentState();
      const historical = historyState();
      const state = current?.draft ? current : historical?.draft ? historical : undefined;
      if (!state?.draft) return false;
      if (state === current && (patch.problem_state === 'PROBLEM'
        || patch.problem_state === 'UNKNOWN'
          && state.cycle.store.selfWalk.getSnapshot().state === 'STARTED')) {
        if (!state.ref || !state.cycle.store.signalTrainerSafety(state.ref,
          patch.problem_state === 'PROBLEM' ? 'PROBLEM' : 'UNKNOWN_ACTION_RELEVANT')) return false;
      }
      state.draft = copyDraft({ ...state.draft, ...patch });
      (current ?? state).message = undefined;
      return true;
    }),

    discardOutcomeDraft: token => run(token, false, () => {
      const state = currentState();
      const historical = historyState();
      const target = state?.draft ? state : historical?.draft ? historical : undefined;
      if (!target) return false;
      target.draft = undefined;
      target.draftMode = undefined;
      target.expectedOutcomeRevision = undefined;
      return true;
    }),

    recordOutcome: token => run(token, false, () => {
      const historical = historyState();
      const current = currentState();
      const state = historical?.draftMode === 'CORRECT' ? historical : current;
      if (!state?.ref) return false;
      if (!completeDraft(state.draft)) {
        (current ?? state).message = 'NOT_RECORDED';
        return false;
      }
      const episodeRef = state.draftMode === 'CORRECT' ? state.ref : state.proposal?.scope;
      if (!episodeRef) return false;
      const input = Object.freeze({
        request_id: nextRequestId(state.cycle.id,
          state.draftMode === 'CORRECT' ? 'correct-outcome' : 'record-outcome'),
        ...state.draft,
      });
      if (state.draftMode === 'CORRECT') {
        if (!state.recordReceipt || state.expectedOutcomeRevision === undefined) return false;
        const corrected = state.cycle.store.m7Outcome.correct(episodeRef, state.recordReceipt,
          state.expectedOutcomeRevision, input);
        if (corrected.state !== 'ACTIVE') {
          state.message = 'NOT_RECORDED';
          return false;
        }
        state.outcomeRevision = corrected.revision;
        state.draft = undefined;
        state.draftMode = undefined;
        state.expectedOutcomeRevision = undefined;
        (currentState() ?? state).message = 'CORRECTED';
        return true;
      }
      const grant = state.cycle.m7.submitOutcome(Object.freeze({
        type: 'USER_SUBMITTED_OUTCOME' as const,
        request_id: nextRequestId(state.cycle.id, 'grant-record-outcome'),
      }));
      if (grant.state !== 'GRANTED') {
        state.message = 'NOT_RECORDED';
        return false;
      }
      state.recordReceipt = grant.receipt;
      const result = state.cycle.store.m7Outcome.report(episodeRef, grant.receipt, input);
      if (result.state !== 'ACTIVE') {
        state.message = 'NOT_RECORDED';
        return false;
      }
      state.outcomeRevision = result.revision;
      state.draft = undefined;
      state.draftMode = undefined;
      state.message = 'RECORDED';
      return true;
    }),

    allowNextUse: token => run(token, false, () => {
      const state = currentState();
      if (!state || state.cycle.id !== 'A' || readOutcome(state)?.state !== 'ACTIVE') return false;
      const result = state.cycle.m7.allowNextCycle(Object.freeze({
        type: 'USER_ALLOWED_NEXT_CYCLE' as const,
        request_id: nextRequestId('A', 'allow-next'),
      }));
      if (result.state !== 'GRANTED') return false;
      state.nextReceipt = result.receipt;
      state.message = 'NEXT_USE_ALLOWED';
      return true;
    }),

    revokeNextUse: token => run(token, false, () => {
      const state = historyState() ?? currentState();
      if (!state || state.cycle.m7.getSnapshot().use_next_cycle_receipt === undefined) return false;
      const result = state.cycle.m7.revokeNextCycle(Object.freeze({
        type: 'USER_REVOKED_NEXT_CYCLE' as const,
        request_id: nextRequestId(state.cycle.id, 'revoke-next'),
      }));
      if (result.state !== 'REVOKED') return false;
      state.nextReceipt = undefined;
      (currentState() ?? state).message = 'NEXT_USE_REVOKED';
      return true;
    }),

    createNextCycle: token => run<TrainerTwoCycleAdvanceResult | undefined>(token, undefined, () => {
      const state = currentState();
      if (!state || state.cycle.id !== 'A') return undefined;
      const runtime = options.getRuntimeSnapshot();
      const outcome = readOutcome(state);
      if (runtime.state !== 'READY' || runtime.cycle_b || outcome?.state !== 'ACTIVE'
        || !state.cycle.m7.getSnapshot().use_next_cycle_receipt) return undefined;
      const result = options.createNextCycleFromA();
      state.nextResult = result;
      state.message = result.state === 'CREATED' ? 'NEXT_CREATED' : 'DENIED';
      return result;
    }),

    toggleHistory: token => run(token, false, () => {
      if (!historyState()) return false;
      historyExpanded = !historyExpanded;
      return true;
    }),

    openHistoryCorrection: token => run(token, false, () => {
      const state = historyState();
      const outcome = state && readOutcome(state);
      if (!state || outcome?.state !== 'ACTIVE' || !outcome.facts) return false;
      state.draft = copyDraft(outcome.facts);
      state.draftMode = 'CORRECT';
      state.expectedOutcomeRevision = outcome.revision;
      historyExpanded = true;
      (currentState() ?? state).message = undefined;
      return true;
    }),

    retractHistory: token => run(token, false, () => {
      const state = historyState();
      const outcome = state && readOutcome(state);
      if (!state?.ref || !state.recordReceipt || outcome?.state !== 'ACTIVE') return false;
      const result = state.cycle.store.m7Outcome.retract(state.ref, state.recordReceipt,
        outcome.revision, nextRequestId('A', 'retract-outcome'));
      if (result.state !== 'RETRACTED') return false;
      state.outcomeRevision = result.revision;
      (currentState() ?? state).message = 'RETRACTED';
      return true;
    }),

    deleteHistory: token => run(token, false, () => {
      const state = historyState();
      const outcome = state && readOutcome(state);
      if (!state?.ref || !state.recordReceipt || !outcome) return false;
      const result = state.cycle.store.m7Outcome.delete(state.ref, state.recordReceipt,
        outcome.revision, nextRequestId('A', 'delete-outcome'));
      if (result.state !== 'UNKNOWN') return false;
      state.draft = undefined;
      state.draftMode = undefined;
      state.expectedOutcomeRevision = undefined;
      state.outcomeRevision = undefined;
      (currentState() ?? state).message = 'DELETED';
      return true;
    }),

    revokeHistoryRecord: token => run(token, false, () => {
      const state = historyState();
      if (!state?.recordReceipt) return false;
      const result = state.cycle.m7.revokeRecordOutcome(Object.freeze({
        type: 'TRUSTED_REVOKED_OUTCOME' as const,
        request_id: nextRequestId('A', 'revoke-record'),
      }));
      if (result.state !== 'REVOKED') return false;
      state.recordReceipt = undefined;
      state.draft = undefined;
      state.draftMode = undefined;
      state.expectedOutcomeRevision = undefined;
      state.outcomeRevision = undefined;
      (currentState() ?? state).message = 'RECORD_REVOKED';
      return true;
    }),
  });

  options.subscribeRuntime(() => {
    if (commandActive) {
      return;
    }
    reconcileRuntime();
  });
  reconcileRuntime();

  return Object.freeze({
    getView: () => view,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    commands,
  });
}
