import { resolveM4Context, resolveM4GoalReadiness } from "../m4/resolver";
import type { M4ContextInput, M4Requirement, M4Result } from "../m4/contract";
import { createM5NoAction, resolveMealImageM5Decision } from "../m5/meal-image-decision";
import type { M5CapabilityState, M5Decision } from "../m5/meal-image-decision";
import { createGoalM5NoAction, resolveGoalM5Decision } from "../m5/goal-choice";
import type { GoalM5ChoiceReceipt, GoalM5Decision } from "../m5/goal-choice";
import { resolveGoalM6ActionHandoff } from "../m6/action-handoff";
import type { GoalM6ActionContext, GoalM6ActionHandoff } from "../m6/action-handoff";
import { createSelfWalk } from "../m6/self-walk";
import type { WalkResourceAccess } from "../m6/walk-resource";
import { createM7OutcomeStore } from "../m7/store";
import { readM7RecordingScope, readM7RecordPurposeState } from "../m7/outcome";
import type { M7EpisodeIdentity, M7PurposeAccess, M7PurposeReceipt } from "../m7/outcome";
import { observeM7NextCycleBasis, readM7NextCycleBasis, readM7NextCycleContext } from "../m7/next-cycle";
import type { M7NextCycleConsumerAccess } from "../m7/next-cycle";
import type { OwnerSessionBinding } from "../identity/owner-session-coordinator";
import type { M3LanguageAdapter } from "../m3/resolver";
import { createM3IntentResolver } from "../m3/resolver";
import { m3FollowUpKind } from "../m3/deterministic-semantics";
import type { LanguageInput, IntentMeaning, SafetyState } from "../m3/contract";
import { deriveM3TextSafetyFloor } from "../../../../lib/api-zod/src/m3-text-safety-floor";
import { composeTrainerSafetyClarificationAnswer,
  evaluateTrainerSafetyText } from "../../../../lib/api-zod/src/trainer-safety-policy";
import type { TrainerSafetyDecision } from "../../../../lib/api-zod/src/trainer-safety-policy";
import { M3_LOCALE_CONFIG } from "../../../../lib/api-zod/src/m3-locales";
import { createSessionTaskAuthority } from "./authority";
import type { SessionTaskEpoch } from "./authority";
import {
  allocateSessionCorrelationId, createInterpretRequestId, createRevokeRequestId,
  createTaskContextId, createTaskCorrelationId, isSessionCorrelationId,
} from "./correlation";
import type { SessionIdFactory } from "./correlation";

export type TaskStatus = "NEEDS_ROUTING" | "AWAITING_INPUT" | "READY" | "PAUSED" | "CANCELLED" | "FAILED" | "UNSUPPORTED";
export type SessionTask = Readonly<{
  task_id: string; session_id: string; source_input: string; revision: number;
  status: TaskStatus; permission_revision: number; permission_granted: boolean;
  m3_context: LanguageInput; interpretation?: IntentMeaning; operation_id?: string;
}>;
export type TaskSnapshot = Readonly<{ session_id: string | null; tasks: readonly SessionTask[]; active_task_id: string | null; revision: number }>;
export type TaskRef = Readonly<{ session_id: string; task_id: string; revision: number; view_revision: number }>;


/** Unforgeable read-only view from this store's existing owner/task authority. */
declare const wearableTaskBrand: unique symbol;
export type WearableTaskProof=Readonly<{[wearableTaskBrand]:true}>;
const wearableTaskProofs=new WeakMap<object,{binding:OwnerSessionBinding;read:()=>Readonly<{session_id:string;task_id:string;revision:number}>|undefined}>();
export function readWearableTaskProof(proof:WearableTaskProof,binding:OwnerSessionBinding){
 const entry=wearableTaskProofs.get(proof);if(!entry||entry.binding.access!==binding.access||entry.binding.lease!==binding.lease)return undefined;
 try{binding.access.requireLease(binding.lease);return entry.read();}catch{return undefined;}
}
const empty: TaskSnapshot = Object.freeze({ session_id: null, tasks: Object.freeze([]), active_task_id: null, revision: 0 });
const validText = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 1000;
const safetyPriority: readonly SafetyState[] = ["CLEAR", "SENSITIVE", "PAIN", "URGENT"];
const retainSafety = (previous: SafetyState, incoming: SafetyState): SafetyState =>
  safetyPriority.indexOf(incoming) > safetyPriority.indexOf(previous) ? incoming : previous;
const enforceSafetyFloor = (meaning: IntentMeaning, floor: SafetyState, locale: LanguageInput['locale']) => {
  const safety = retainSafety(floor, meaning.safety_state);
  if (safety === meaning.safety_state) return meaning;
  return Object.freeze({ ...meaning, safety_state: safety, intent_type: 'SAFETY' as const,
    suggested_next_role: 'STOP' as const, clarification_needed: false,
    clarification_question: null, missing_context: Object.freeze([]),
    response: M3_LOCALE_CONFIG[locale][safety === 'URGENT' ? 'urgentSafety' : 'safety'] });
};
const localSafetyMeaning = (decision: TrainerSafetyDecision, locale: LanguageInput['locale']): IntentMeaning => {
  const clarification = decision.clarification;
  const response = M3_LOCALE_CONFIG[locale][decision.level === 'URGENT' ? 'urgentSafety' : 'safety'];
  return Object.freeze({
    intent_type: 'SAFETY', interpreted_meaning: `LOCAL_SAFETY_${decision.level}`,
    confidence: 1, uncertainty: clarification ? 'LOCAL_SAFETY_CONTEXT_UNKNOWN' : null,
    missing_context: Object.freeze(clarification ? [clarification.kind] : []),
    clarification_needed: Boolean(clarification), clarification_question: clarification?.question ?? null,
    safety_state: decision.level, suggested_next_role: 'STOP', task_kind: null,
    context_effect: 'NONE', used_context_ids: Object.freeze([]),
    response: clarification ? `${response} ${clarification.question}` : response,
  });
};

/**
 * SessionTask is deliberately RAM-only. The store never receives a storage
 * backend and does not persist task, permission, request, or interpretation.
 */
export function createSessionTaskStore(options: {
  resolver?: ReturnType<typeof createM3IntentResolver>;
  adapter?: M3LanguageAdapter;
  now?: () => number;
  // Trusted composition only, fixed BEFORE any task is created. Existing
  // anonymous M2 stores stay anonymous and cannot later adopt an owner's M6.
  ownerSession?: OwnerSessionBinding;
  walkResource?: WalkResourceAccess;
  m7Purpose?: M7PurposeAccess;
  // Trusted composition capability from a prior cycle. It is never copied
  // into task state; every use revalidates the source M7 authority.
  m7NextCycle?: M7NextCycleConsumerAccess;
  // Trusted construction/test seam only. Production omits this and uses the
  // module-scoped correlation allocator. Never source it from UI/wire/model.
  sessionIdFactory?: SessionIdFactory;
} = {}) {
  const ownerBinding = options.ownerSession && Object.freeze({ ...options.ownerSession });
  let ownerRetired = false;
  let unsubscribeOwner = () => {};
  let unsubscribeSource = () => {};
  let selfWalk: ReturnType<typeof createSelfWalk> | undefined;
  let m7Outcome: ReturnType<typeof createM7OutcomeStore> | undefined;
  let recordingIntake: Readonly<{ episode: M7EpisodeIdentity; scope: object; closure: number }> | undefined;
  const closeRecordingIntake = () => { recordingIntake = undefined; };
  const currentRecordingIntake = (episode: M7EpisodeIdentity) => {
    const intake = recordingIntake;
    return intake && intake.episode.episode_key === episode.episode_key
      && readM7RecordingScope(options.m7Purpose) === intake.scope
      && readM7RecordPurposeState(options.m7Purpose)?.closure === intake.closure ? intake : undefined;
  };
  const resolver = options.resolver ?? (options.adapter ? createM3IntentResolver(options.adapter) : undefined);
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  const tasks = new Map<string, SessionTask>();
  const taskAuthority = createSessionTaskAuthority();
  type PendingOperation = Readonly<{
    controller: AbortController;
    operation_id: string;
    epoch: SessionTaskEpoch;
  }>;
  const pending = new Map<string, PendingOperation>();
  let snapshot: TaskSnapshot = empty;
  let sequence = 0;
  let active = false;
  let actionAuthority: "OPEN" | "RETAINED_SOURCE_ONLY" = "OPEN";
  let retainedM7Episode: M7EpisodeIdentity | undefined;
  let retainedRecordReceipt: M7PurposeReceipt | undefined;
  let goalChoiceReceipt: GoalM5ChoiceReceipt | undefined;
  let safetyRevision = 0;
  let safetyState: 'OPEN' | 'HOLD' = 'OPEN';
  type SafetyReassessment = Readonly<{
    session_id: string;
    task_id: string;
    task_revision: number;
    safety_revision: number;
    decision: TrainerSafetyDecision;
  }>;
  let safetyReassessment: SafetyReassessment | undefined;
  let nonReleasableSafetyHold = false;
  let sourceBasis: string | undefined;
  let sourceBasisStale = false;
  // A task depends on A only when its committed M3 decision names the prior
  // context (or the prior safety signal actually raised its safety decision).
  const taskSourceBases = new Map<string, string>();
  const decisionBases = new WeakMap<object, string | undefined>();
  let receiptBasis: string | undefined;
  // A completed M7 report belongs to the action episode that produced it, not
  // to the later M3 permission revision. Remember only that episode key while
  // this task changes through the M3 permission/routing path. Real task edits
  // clear the bridge before publishing and therefore retain the strict guard.
  const m7PermissionOnlyEpisodes = new Map<string, string>();
  const clearGoalChoiceReceipt = (taskId?: string) => {
    if (!taskId || goalChoiceReceipt?.task_id === taskId) { goalChoiceReceipt = undefined; receiptBasis = undefined; }
  };
  const nextSequence = () => {
    if (sequence >= Number.MAX_SAFE_INTEGER) throw Error('SESSION_CORRELATION_SEQUENCE_EXHAUSTED');
    sequence += 1;
    return sequence;
  };
  const retainM7EpisodeAcrossM3 = (ref: TaskRef) => {
    if (m7PermissionOnlyEpisodes.has(ref.task_id)) return;
    const episode = selfWalk?.getEpisode(ref);
    if (episode) m7PermissionOnlyEpisodes.set(ref.task_id, episode.episode_key);
  };
  const invalidateM7EpisodeRetention = (taskId: string) => {
    m7PermissionOnlyEpisodes.delete(taskId);
  };
  const closeActionForSafety = () => {
    clearGoalChoiceReceipt();
    const operations = [...pending.values()];
    pending.clear();
    selfWalk?.interrupt();
    for (const operation of operations) operation.controller.abort();
  };
  const holdTrainerSafety = () => {
    nonReleasableSafetyHold = true;
    safetyReassessment = undefined;
    if (safetyState === 'HOLD') return false;
    safetyRevision++;
    safetyState = 'HOLD';
    closeActionForSafety();
    return true;
  };
  const holdTrainerSafetyReassessment = (task: SessionTask, decision: TrainerSafetyDecision) => {
    if (!decision.clarification || !snapshot.session_id || task.session_id !== snapshot.session_id) {
      return holdTrainerSafety();
    }
    if (safetyState === 'HOLD') {
      const sameSource = safetyReassessment?.session_id === task.session_id
        && safetyReassessment.task_id === task.task_id;
      if (nonReleasableSafetyHold || safetyReassessment && !sameSource) {
        nonReleasableSafetyHold = true;
        safetyReassessment = undefined;
        return false;
      }
    } else {
      safetyRevision++;
      safetyState = 'HOLD';
      nonReleasableSafetyHold = false;
      closeActionForSafety();
    }
    safetyReassessment = Object.freeze({
      session_id: task.session_id, task_id: task.task_id, task_revision: task.revision,
      safety_revision: safetyRevision, decision,
    });
    return true;
  };
  const notifyObservers = () => {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observers cannot control domain transitions */ }
    }
  };
  const publish = (advanceViewRevision = true) => {
    snapshot = Object.freeze({
      session_id: snapshot.session_id, tasks: Object.freeze([...tasks.values()]),
      active_task_id: snapshot.active_task_id,
      revision: snapshot.revision + (advanceViewRevision ? 1 : 0),
    });
    selfWalk?.taskChanged();
    m7Outcome?.taskChanged();
    notifyObservers();
  };
  const retire = () => {
    unsubscribeSource();
    taskAuthority.retireSession();
    safetyState = 'OPEN'; safetyRevision = 0; safetyReassessment = undefined;
    nonReleasableSafetyHold = false; sourceBasis = undefined; sourceBasisStale = false;
    taskSourceBases.clear();
    const operations = [...pending.values()];
    pending.clear(); tasks.clear(); m7PermissionOnlyEpisodes.clear(); clearGoalChoiceReceipt(); active = false;
    snapshot = empty;
    selfWalk?.retire();
    m7Outcome?.retire();
    for (const operation of operations) operation.controller.abort();
    publish();
  };
  const ownerAllowed = () => {
    if (!ownerBinding) return true; // Not an M6 authority path.
    if (ownerRetired) return false;
    try {
      ownerBinding.access.requireLease(ownerBinding.lease);
      return ownerBinding.access.getSnapshot().phase === 'READY';
    } catch {
      ownerRetired = true; unsubscribeOwner(); retire(); return false;
    }
  };
  const actionOpen = () => actionAuthority === "OPEN";
  const currentSourceBasis = () => readM7NextCycleBasis(options.m7NextCycle, ownerBinding)
    ?? readM7NextCycleContext(options.m7NextCycle, ownerBinding)?.id;
  const sourceAvailable = () => !options.m7NextCycle
    || readM7NextCycleContext(options.m7NextCycle, ownerBinding)?.state === 'AVAILABLE';
  const dependentActionOpen = (taskId: string) => {
    if (!actionOpen() || safetyState !== 'OPEN') return false;
    const basis = taskSourceBases.get(taskId);
    return basis === undefined || basis === currentSourceBasis() && sourceAvailable();
  };
  const abortPending = (exceptTaskId?: string) => {
    for (const [taskId, operation] of pending) {
      if (taskId === exceptTaskId) continue;
      operation.controller.abort();
      pending.delete(taskId);
      const task = tasks.get(taskId);
      if (task && task.status === "NEEDS_ROUTING") {
        update(task, { status: "PAUSED", operation_id: undefined });
      }
    }
  };
  const historicalCurrent = (ref: TaskRef) => taskAuthority.belongsToCurrentEpoch(ref) && ownerAllowed() && active
    && ref.session_id === snapshot.session_id
    && ref.view_revision === snapshot.revision && tasks.get(ref.task_id)?.revision === ref.revision;
  const current = (ref: TaskRef) => actionOpen() && historicalCurrent(ref);
  const currentActive = (ref: TaskRef) => current(ref) && snapshot.active_task_id === ref.task_id;
  const update = (task: SessionTask, patch: Partial<SessionTask>) => {
    clearGoalChoiceReceipt(task.task_id);
    const next = Object.freeze({ ...task, ...patch, revision: task.revision + 1 });
    tasks.set(task.task_id, next); return next;
  };
  const holdLocalTrainerSafety = (task: SessionTask, explicitSafety: SafetyState) => {
    if (explicitSafety !== 'CLEAR') {
      holdTrainerSafety();
      return;
    }
    const localDecision = evaluateTrainerSafetyText(task.m3_context.locale,
      task.source_input, task.revision);
    if (localDecision.clarification) holdTrainerSafetyReassessment(task, localDecision);
    else if (localDecision.level !== 'CLEAR') holdTrainerSafety();
  };
  const route = (task: SessionTask) => {
    if (!actionOpen()) return;
    sourceBasis = currentSourceBasis();
    sourceBasisStale = false;
    const localDecision = evaluateTrainerSafetyText(task.m3_context.locale,
      task.source_input, task.revision);
    const priorContext = readM7NextCycleContext(options.m7NextCycle, ownerBinding);
    if (priorContext?.state === 'URGENT_HELP' || priorContext?.state === 'SAFETY_HOLD') {
      holdTrainerSafety();
    }
    // A current urgent observation is already at the maximum local safety
    // level. UNKNOWN context gets exactly one local question after authority
    // is held. Neither path waits for, or delegates its question to, M3.
    if (localDecision.level === 'URGENT' || localDecision.clarification) {
      const latest = tasks.get(task.task_id);
      if (!latest) return;
      if (localDecision.clarification) holdTrainerSafetyReassessment(latest, localDecision);
      else holdTrainerSafety();
      const next = update(latest, { interpretation: localSafetyMeaning(localDecision, task.m3_context.locale),
        status: localDecision.clarification ? 'AWAITING_INPUT' : 'PAUSED', operation_id: undefined });
      if (localDecision.clarification) holdTrainerSafetyReassessment(next, localDecision);
      publish();
      return;
    }
    if (localDecision.level !== 'CLEAR') holdTrainerSafety();
    if (!resolver || !task.permission_granted || snapshot.active_task_id !== task.task_id) {
      if (!resolver || !task.permission_granted) {
        update(task, { status: task.m3_context.asking_stopped
          || task.m3_context.safety_signal !== 'CLEAR' || safetyState === 'HOLD'
          ? "PAUSED" : "UNSUPPORTED", operation_id: undefined });
        publish();
      }
      return;
    }
    const operation_id = createInterpretRequestId(task.task_id, nextSequence());
    const controller = new AbortController();
    const epoch = taskAuthority.captureEpoch();
    if (!epoch) return;
    const next = update(task, { status: "NEEDS_ROUTING", operation_id });
    const routeContext = priorContext ? Object.freeze({ ...next.m3_context,
      relevant_context: Object.freeze([...next.m3_context.relevant_context, priorContext]),
      // A structured prior safety state is not a current diagnosis. It keeps
      // the current path fail-closed until reassessment instead of becoming
      // ordinary movement context merely because a new task was created.
      // A prior urgent event is historical context, not a current emergency.
      // Both prior safety states require current reassessment without erasing
      // the factual M7 history or lowering a current text observation.
      safety_signal: priorContext.state === 'URGENT_HELP' || priorContext.state === 'SAFETY_HOLD'
          ? retainSafety(next.m3_context.safety_signal, 'SENSITIVE') : next.m3_context.safety_signal,
    }) : next.m3_context;
    const priorContextCurrent = () => sourceBasis === currentSourceBasis() && !sourceBasisStale
      && (sourceBasis !== undefined || !priorContext
        || readM7NextCycleContext(options.m7NextCycle, ownerBinding)?.id === priorContext.id);
    const operation: PendingOperation = Object.freeze({ controller, operation_id, epoch });
    const operationCurrent = () => taskAuthority.isCurrentEpoch(operation.epoch)
      && actionOpen()
      && pending.get(task.task_id) === operation
      && snapshot.active_task_id === task.task_id
      && tasks.get(task.task_id)?.revision === next.revision;
    const routeInputCurrent = () => operationCurrent() && priorContextCurrent();
    pending.set(task.task_id, operation); publish();
    const ref = { session_id: snapshot.session_id!, task_id: task.task_id, revision: next.revision, view_revision: snapshot.revision, operation_id };
    void resolver.resolve({
      source_input: next.source_input,
      ticket: { session_id: ref.session_id, task_id: ref.task_id, task_revision: ref.revision, permission_revision: next.permission_revision, operation_id },
      permission_scope: {
        external_access: "M3_TEXT", purpose: "m3_intent_understanding", revision: next.permission_revision,
      },
      current_task: { task_id: next.task_id, revision: next.revision, m3_context: routeContext },
      isCurrent: () => ownerAllowed() && routeInputCurrent(),
    }, controller.signal).then((result) => {
      if (!ownerAllowed() || !operationCurrent() || controller.signal.aborted) return;
      if (!priorContextCurrent()) {
        pending.delete(task.task_id);
        const stale = tasks.get(task.task_id);
        if (stale?.revision === next.revision && snapshot.active_task_id === task.task_id) route(stale);
        return;
      }
      pending.delete(task.task_id);
      const latest = tasks.get(task.task_id);
      if (!latest) return;
      if (result.state === "INTERPRETED") {
        const interpretation = enforceSafetyFloor(result.interpretation,
          routeContext.safety_signal, routeContext.locale);
        // The production M3 adapter projects the private episode ID to this
        // semantic wire ID. Accept either trusted fixture form or the existing
        // wire form; neither ID is used as authority (the private basis is).
        const priorWireId = priorContext
          ? `m7-prior:${priorContext.text.toLowerCase().replaceAll('_', '-')}` : undefined;
        const usedPrior = !!priorContext && (interpretation.used_context_ids.includes(priorContext.id)
          || !!priorWireId && interpretation.used_context_ids.includes(priorWireId)
          || routeContext.safety_signal !== next.m3_context.safety_signal
            && interpretation.safety_state !== 'CLEAR');
        if (usedPrior && sourceBasis !== undefined) taskSourceBases.set(task.task_id, sourceBasis);
        else taskSourceBases.delete(task.task_id);
        if (interpretation.safety_state !== 'CLEAR') holdTrainerSafety();
        update(latest, {
          interpretation,
          status: interpretation.clarification_needed ? "AWAITING_INPUT"
            : interpretation.suggested_next_role === "STOP" ? "PAUSED" : "READY",
          operation_id: undefined,
        });
      } else update(latest, { status: latest.m3_context.safety_signal !== 'CLEAR'
        ? "PAUSED" : result.state === "UNAVAILABLE" ? "UNSUPPORTED" : "FAILED", operation_id: undefined });
      publish();
    }).catch(() => {
      if (!ownerAllowed() || !operationCurrent()) return;
      pending.delete(task.task_id);
      const latest = tasks.get(task.task_id);
      if (latest) { update(latest, { status: latest.m3_context.safety_signal !== 'CLEAR'
        ? "PAUSED" : "FAILED", operation_id: undefined }); publish(); }
    });
  };
  const start = () => {
    if (!ownerAllowed() || active || !actionOpen()) return;
    const session_id = (options.sessionIdFactory ?? allocateSessionCorrelationId)();
    if (!isSessionCorrelationId(session_id)) throw Error('SESSION_CORRELATION_ID_INVALID');
    taskAuthority.beginSession();
    safetyState = 'OPEN'; safetyRevision = 0; safetyReassessment = undefined;
    nonReleasableSafetyHold = false; sourceBasis = currentSourceBasis(); sourceBasisStale = false;
    active = true;
    snapshot = Object.freeze({ session_id, tasks: Object.freeze([]), active_task_id: null, revision: 0 });
    publish();
  };
  const api = Object.freeze({
    getSnapshot: () => { ownerAllowed(); return snapshot; },
    getTrainerSafetySnapshot: () => {
      ownerAllowed();
      return Object.freeze({ state: active ? safetyState : 'UNAVAILABLE' as const,
        revision: safetyRevision, session_id: snapshot.session_id });
    },
    getTrainerActionAvailability: () => {
      ownerAllowed();
      if (!active || !actionOpen()) return 'UNAVAILABLE' as const;
      if (safetyState === 'HOLD') return 'SAFETY_HOLD' as const;
      const taskId = snapshot.active_task_id;
      const basis = taskId ? taskSourceBases.get(taskId) : undefined;
      if (basis !== undefined && basis !== currentSourceBasis()) return 'BASIS_STALE' as const;
      if (basis !== undefined || !taskId) return sourceAvailable()
        ? 'AVAILABLE' as const : 'REASSESS_REQUIRED' as const;
      return 'AVAILABLE' as const;
    },
    signalTrainerSafety: (ref: TaskRef, signal: 'PROBLEM' | 'UNKNOWN_ACTION_RELEVANT'): boolean => {
      if (signal !== 'PROBLEM' && signal !== 'UNKNOWN_ACTION_RELEVANT') return false;
      if (!ownerBinding || !currentActive(ref) || !taskAuthority.captureEpoch()) return false;
      if (!holdTrainerSafety()) return true;
      // Scope -> revision -> close -> detach -> interrupt -> abort -> publish.
      publish();
      return true;
    },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    start, stop: () => { if (ownerBinding) ownerRetired = true; unsubscribeOwner(); retire(); },
    enterRetainedSourceMode: (recordReceipt: M7PurposeReceipt | undefined): boolean => {
      if (!ownerAllowed() || !active || !m7Outcome || !selfWalk) return false;
      if (!actionOpen()) return actionAuthority === "RETAINED_SOURCE_ONLY"
        && recordReceipt === retainedRecordReceipt
        && m7Outcome.getSnapshot(recordReceipt).state === "ACTIVE";
      const outcome = m7Outcome.getSnapshot(recordReceipt);
      if (outcome.state !== "ACTIVE") return false;
      if (safetyState === 'HOLD' && outcome.outcome.safety_disposition === 'CLEAR') return false;
      const episode = outcome.episode;
      const walk = selfWalk.getSnapshot();
      if (!("action_id" in walk) || !walk.start
        || walk.scope.session_id !== episode.session_id
        || walk.scope.task_id !== episode.task_id
        || walk.scope.revision !== episode.task_revision
        || walk.scope.view_revision !== episode.view_revision
        || walk.action_id !== episode.action_id
        || walk.source.version !== episode.action_version
        || walk.proposal_revision !== episode.proposal_revision
        || walk.context_revision !== episode.context_revision
        || walk.source.revision !== episode.source_revision
        || walk.duration_minutes !== episode.proposed_minutes
        || snapshot.session_id !== episode.session_id
        || !tasks.has(episode.task_id)) return false;

      // Close action authority before any abort callback or observer can re-enter.
      actionAuthority = "RETAINED_SOURCE_ONLY";
      retainedM7Episode = episode;
      retainedRecordReceipt = recordReceipt;
      const operations = [...pending.values()];
      pending.clear();
      clearGoalChoiceReceipt();
      selfWalk.interrupt();
      for (const operation of operations) operation.controller.abort();
      publish();
      return true;
    },
    submit: (source_input: string, details: {
      locale?: LanguageInput["locale"];
      safety_signal?: SafetyState;
      permission_granted?: boolean;
      permission_revision?: number;
      recent_relevant_turns?: LanguageInput["recent_relevant_turns"];
    } = {}) => {
      if (!ownerAllowed() || !active || !actionOpen() || !validText(source_input) || !snapshot.session_id) return undefined;
      if (sourceBasisStale) { sourceBasis = currentSourceBasis(); sourceBasisStale = false; }
      const focused = snapshot.active_task_id ? tasks.get(snapshot.active_task_id) : undefined;
      const reassessment = safetyReassessment;
      if (focused && focused.status === 'AWAITING_INPUT' && !nonReleasableSafetyHold
        && safetyState === 'HOLD' && reassessment
        && reassessment.session_id === snapshot.session_id
        && reassessment.task_id === focused.task_id
        && reassessment.task_revision === focused.revision
        && reassessment.safety_revision === safetyRevision
        && (details.locale === undefined || details.locale === focused.m3_context.locale)) {
        const epoch = taskAuthority.captureEpoch();
        const sessionId = snapshot.session_id;
        const viewRevision = snapshot.revision;
        const priorContext = readM7NextCycleContext(options.m7NextCycle, ownerBinding);
        const sourceAtCapture = currentSourceBasis();
        const dependsOnPriorSource = taskSourceBases.has(focused.task_id);
        const independentSafety = retainSafety(details.safety_signal ?? 'CLEAR',
          dependsOnPriorSource && (priorContext?.state === 'URGENT_HELP'
            || priorContext?.state === 'SAFETY_HOLD' || sourceBasisStale
            || sourceBasis !== sourceAtCapture || !sourceAvailable()) ? 'SENSITIVE' : 'CLEAR');
        const composition = composeTrainerSafetyClarificationAnswer(focused.m3_context.locale,
          reassessment.decision, source_input, focused.revision + 1, independentSafety);
        // An unrelated task or Manual Stop keeps its existing submit path;
        // neither is a clarification answer or a fresh Safety observation.
        if (composition.correctedPrior || composition.freshObservations.length
          || independentSafety !== 'CLEAR') {
          const decision = composition.effective;
          // A correction proves release only for the prior concern. A fresh
          // observation or independent source can still require HOLD.
          const release = composition.correctionResolved && decision.level === 'CLEAR'
            && independentSafety === 'CLEAR'
            && (!dependsOnPriorSource || sourceBasis === sourceAtCapture);
          if (!epoch || !ownerAllowed() || !taskAuthority.isCurrentEpoch(epoch)
            || !active || !actionOpen() || snapshot.session_id !== sessionId
            || snapshot.revision !== viewRevision || snapshot.active_task_id !== focused.task_id
            || tasks.get(focused.task_id) !== focused || focused.revision !== reassessment.task_revision
            || safetyState !== 'HOLD' || safetyRevision !== reassessment.safety_revision
            || safetyReassessment !== reassessment || nonReleasableSafetyHold
            || currentSourceBasis() !== sourceAtCapture) return undefined;

          // No callback runs between the final decision and the authority
          // commit. Old operations/receipts are detached before abort reentry.
          const operations = [...pending.values()];
          pending.clear();
          clearGoalChoiceReceipt(focused.task_id);
          invalidateM7EpisodeRetention(focused.task_id);
          const next = update(focused, {
            source_input,
            interpretation: decision.level === 'CLEAR'
              ? undefined : localSafetyMeaning(decision, focused.m3_context.locale),
            status: decision.clarification ? 'AWAITING_INPUT' : 'PAUSED',
            operation_id: undefined,
            permission_granted: false,
            m3_context: {
              locale: focused.m3_context.locale,
              current_text: source_input,
              relevant_context: Object.freeze([{ id: createTaskContextId(focused.task_id, focused.revision),
                kind: 'active_task:safety_reassessment', text: focused.source_input }]),
              recent_relevant_turns: Object.freeze([]),
              user_correction: composition.correctionText
                ? { text: composition.correctionText, replaces_revision: focused.revision } : null,
              safety_signal: decision.level,
              asking_stopped: false,
            },
          });
          safetyRevision++;
          safetyState = release ? 'OPEN' : 'HOLD';
          nonReleasableSafetyHold = !release && !decision.clarification;
          safetyReassessment = !release && decision.clarification ? Object.freeze({
            session_id: next.session_id, task_id: next.task_id, task_revision: next.revision,
            safety_revision: safetyRevision, decision,
          }) : undefined;
          selfWalk?.interrupt();
          for (const operation of operations) operation.controller.abort();
          if (!ownerAllowed() || !taskAuthority.isCurrentEpoch(epoch)
            || snapshot.session_id !== sessionId || tasks.get(next.task_id) !== next
            || snapshot.active_task_id !== next.task_id) return undefined;
          publish();
          return next.task_id;
        }
      }
      const followUp = m3FollowUpKind(source_input);
      if (focused && focused.status !== "CANCELLED" && followUp) {
        // Reuse only the focused RAM task, never another task or a cancelled one.
        // Retire its old ticket and interpretation before publishing replacement.
        abortPending();
        const latest = tasks.get(focused.task_id)!;
        invalidateM7EpisodeRetention(latest.task_id);
        const localFloor = deriveM3TextSafetyFloor(details.locale ?? focused.m3_context.locale, source_input);
        const next = update(latest, {
          source_input, interpretation: undefined, status: "NEEDS_ROUTING", operation_id: undefined,
          permission_granted: Boolean(resolver && details.permission_granted),
          permission_revision: Number.isSafeInteger(details.permission_revision) && Number(details.permission_revision) > 0
            ? Number(details.permission_revision) : latest.permission_revision,
          m3_context: {
            locale: details.locale ?? focused.m3_context.locale, current_text: source_input,
            relevant_context: [{ id: createTaskContextId(focused.task_id, focused.revision),
              kind: `active_task:${focused.interpretation?.task_kind ?? 'unknown'}`,
              text: focused.interpretation?.interpreted_meaning ?? focused.source_input }],
            recent_relevant_turns: [],
            user_correction: followUp === "CORRECTION" ? { text: source_input, replaces_revision: focused.revision } : null,
            // A time limit cannot turn an existing safety concern into CLEAR.
            safety_signal: followUp === "CONSTRAINT"
              ? retainSafety(focused.interpretation?.safety_state ?? focused.m3_context.safety_signal, details.safety_signal ?? "CLEAR")
              : retainSafety(details.safety_signal ?? "CLEAR", localFloor),
            asking_stopped: followUp === "STOP",
          },
        });
        if (followUp === "STOP") { clearGoalChoiceReceipt(); selfWalk?.interrupt(); }
        holdLocalTrainerSafety(next, details.safety_signal ?? 'CLEAR');
        publish(); route(next); return next.task_id;
      }
      // A new submission supersedes the focused operation before the new
      // ticket is published. Late provider results can therefore never apply.
      abortPending();
      clearGoalChoiceReceipt();
      const task_id = createTaskCorrelationId(snapshot.session_id, nextSequence());
      const locale = details.locale ?? "vi";
      const localFloor = deriveM3TextSafetyFloor(locale, source_input);
      const task: SessionTask = Object.freeze({
        task_id, session_id: snapshot.session_id, source_input, revision: 1, status: "NEEDS_ROUTING",
        permission_revision: Number.isSafeInteger(details.permission_revision)
          && Number(details.permission_revision) > 0 ? Number(details.permission_revision) : 1,
        permission_granted: Boolean(resolver && details.permission_granted),
        m3_context: {
          locale, current_text: source_input, relevant_context: [],
          recent_relevant_turns: Object.freeze([...(details.recent_relevant_turns ?? [])]),
          user_correction: null, safety_signal: retainSafety(details.safety_signal ?? "CLEAR", localFloor),
          asking_stopped: followUp === "STOP",
        },
      });
      tasks.set(task_id, task); snapshot = Object.freeze({ ...snapshot, active_task_id: task_id });
      if (followUp === "STOP") selfWalk?.interrupt();
      holdLocalTrainerSafety(task, details.safety_signal ?? 'CLEAR');
      publish(); route(task); return task_id;
    },
    reference: (taskId = snapshot.active_task_id): TaskRef | undefined => {
      if (!ownerAllowed()) return undefined;
      const task = taskId ? tasks.get(taskId) : undefined;
      return task && snapshot.session_id ? taskAuthority.issueReference({ session_id: snapshot.session_id,
        task_id: task.task_id, revision: task.revision, view_revision: snapshot.revision }) : undefined;
    },
    captureWearableTaskProof:(ref:TaskRef):WearableTaskProof|undefined=>{
      if(!ownerBinding||!currentActive(ref))return undefined;const epoch=taskAuthority.captureEpoch();if(!epoch)return undefined;
      const proof=Object.freeze({}) as WearableTaskProof;
      wearableTaskProofs.set(proof,{binding:ownerBinding,read:()=>{
        if(!ownerAllowed()||!taskAuthority.isCurrentEpoch(epoch)||!currentActive(ref))return undefined;
        const task=tasks.get(ref.task_id);if(!task||task.status==='CANCELLED')return undefined;
        return Object.freeze({session_id:ref.session_id,task_id:ref.task_id,revision:ref.revision});
      }});return proof;
    },
    // Read-only, uncached seam. IDs correlate a RAM task; they do not prove ownership.
    assessM4: (ref: TaskRef, context: M4ContextInput, requirement?: M4Requirement): M4Result => {
      if (!current(ref)) return Object.freeze({
        scope: Object.freeze({ session_id: ref.session_id, task_id: ref.task_id, revision: ref.revision }),
        decision: Object.freeze({ state: "DEFERRED" as const, reason: "STALE_TASK" as const }),
      });
      return taskAuthority.registerDerived(resolveM4Context(tasks.get(ref.task_id)!, context, requirement));
    },
    // Read-only goal seam. Freshness stays a host/store responsibility.
    assessM4GoalReadiness: (ref: TaskRef): M4Result => {
      if (!current(ref)) return Object.freeze({
        scope: Object.freeze({ session_id: ref.session_id, task_id: ref.task_id, revision: ref.revision }),
        decision: Object.freeze({ state: "DEFERRED" as const, reason: "STALE_TASK" as const }),
      });
      return taskAuthority.registerDerived(resolveM4GoalReadiness(tasks.get(ref.task_id)!));
    },
    // Read-only, uncached M5 seam. It reuses the same current TaskRef guard.
    assessM5: (
      ref: TaskRef,
      m4: M4Result,
      capability: M5CapabilityState,
    ): M5Decision => {
      const scope = { session_id: ref.session_id, task_id: ref.task_id, revision: ref.revision };
      if (!current(ref)) return createM5NoAction(scope, "STALE_TASK");
      if (!taskAuthority.ownsDerived(m4)) return createM5NoAction(scope, "STALE_CONTEXT");
      return resolveMealImageM5Decision(tasks.get(ref.task_id)!, m4, capability);
    },
    // Read-only goal-choice seam. It cannot accept, persist or execute a proposal.
    assessM5Goal: (ref: TaskRef, m4: M4Result): GoalM5Decision => {
      const scope = { session_id: ref.session_id, task_id: ref.task_id, revision: ref.revision };
      if (!currentActive(ref) || !dependentActionOpen(ref.task_id)) return createGoalM5NoAction(scope, "STALE_TASK");
      if (!taskAuthority.ownsDerived(m4)) return createGoalM5NoAction(scope, "STALE_CONTEXT");
      const decision = taskAuthority.registerDerived(resolveGoalM5Decision(tasks.get(ref.task_id)!, m4));
      decisionBases.set(decision, taskSourceBases.get(ref.task_id));
      return decision;
    },
    acceptM5Goal: (ref: TaskRef, decision: GoalM5Decision): GoalM5ChoiceReceipt | undefined => {
      if (!currentActive(ref) || !dependentActionOpen(ref.task_id)
        || decisionBases.get(decision) !== taskSourceBases.get(ref.task_id)
        || !taskAuthority.ownsDerived(decision) || decision.state !== "PROPOSAL"
        || decision.scope.session_id !== ref.session_id
        || decision.scope.task_id !== ref.task_id
        || decision.scope.revision !== ref.revision) return undefined;
      const task = tasks.get(ref.task_id)!;
      const canonical = resolveGoalM5Decision(task, resolveM4GoalReadiness(task));
      if (canonical.state !== "PROPOSAL"
        || canonical.proposal.kind !== decision.proposal.kind
        || canonical.proposal.goal_kind !== decision.proposal.goal_kind
        || canonical.proposal.why_code !== decision.proposal.why_code
        || canonical.proposal.tradeoff_code !== decision.proposal.tradeoff_code
        || canonical.proposal.requires_user_choice !== decision.proposal.requires_user_choice) return undefined;
      if (goalChoiceReceipt
        && goalChoiceReceipt.session_id === ref.session_id
        && goalChoiceReceipt.task_id === ref.task_id
        && goalChoiceReceipt.revision === ref.revision
        && goalChoiceReceipt.proposal_kind === canonical.proposal.kind
        && goalChoiceReceipt.goal_kind === canonical.proposal.goal_kind) return goalChoiceReceipt;
      goalChoiceReceipt = Object.freeze({
        session_id: ref.session_id,
        task_id: ref.task_id,
        revision: ref.revision,
        proposal_kind: canonical.proposal.kind,
        goal_kind: canonical.proposal.goal_kind,
        choice: "ACCEPTED" as const,
      });
      receiptBasis = taskSourceBases.get(ref.task_id);
      publish();
      return goalChoiceReceipt;
    },
    getM5GoalChoiceReceipt: (ref: TaskRef): GoalM5ChoiceReceipt | undefined => {
      if (!currentActive(ref) || !dependentActionOpen(ref.task_id)
        || receiptBasis !== taskSourceBases.get(ref.task_id) || !goalChoiceReceipt
        || goalChoiceReceipt.session_id !== ref.session_id
        || goalChoiceReceipt.task_id !== ref.task_id
        || goalChoiceReceipt.revision !== ref.revision) return undefined;
      const canonical = resolveGoalM5Decision(
        tasks.get(ref.task_id)!,
        resolveM4GoalReadiness(tasks.get(ref.task_id)!),
      );
      return canonical.state === "PROPOSAL"
        && canonical.proposal.kind === goalChoiceReceipt.proposal_kind
        && canonical.proposal.goal_kind === goalChoiceReceipt.goal_kind
        ? goalChoiceReceipt : undefined;
    },
    // Read-only current-task seam for M4/host composition. The returned item
    // is a fresh projection, never stored as an independent current fact.
    readM7NextCycleContext: (ref: TaskRef) => current(ref)
      ? readM7NextCycleContext(options.m7NextCycle, ownerBinding) : undefined,
    resolveM6GoalAction: (
      ref: TaskRef,
      receipt: GoalM5ChoiceReceipt | undefined,
      context: GoalM6ActionContext = {},
    ): GoalM6ActionHandoff | undefined => {
      if (!currentActive(ref) || !dependentActionOpen(ref.task_id) || !receipt || receipt !== goalChoiceReceipt
        || receipt.session_id !== goalChoiceReceipt.session_id
        || receipt.task_id !== goalChoiceReceipt.task_id
        || receipt.revision !== goalChoiceReceipt.revision
        || receipt.proposal_kind !== goalChoiceReceipt.proposal_kind
        || receipt.goal_kind !== goalChoiceReceipt.goal_kind
        || receipt.choice !== goalChoiceReceipt.choice) return undefined;
      const task = tasks.get(ref.task_id)!;
      const m4 = resolveM4GoalReadiness(task);
      const m5 = resolveGoalM5Decision(task, m4);
      return resolveGoalM6ActionHandoff(task, m4, m5, receipt, context);
    },
    retireM5GoalChoice: (ref: TaskRef) => {
      if (!currentActive(ref) || !goalChoiceReceipt) return false;
      clearGoalChoiceReceipt(ref.task_id);
      publish();
      return true;
    },
    edit: (ref: TaskRef, source_input: string) => {
      if (!current(ref) || !validText(source_input) || tasks.get(ref.task_id)?.status === "CANCELLED") return false;
      const task = tasks.get(ref.task_id)!; pending.get(task.task_id)?.controller.abort(); pending.delete(task.task_id);
      invalidateM7EpisodeRetention(task.task_id);
      const localFloor = deriveM3TextSafetyFloor(task.m3_context.locale, source_input);
      const next = update(task, {
        source_input, interpretation: undefined, status: "NEEDS_ROUTING", operation_id: undefined,
        m3_context: { ...task.m3_context, current_text: source_input,
          safety_signal: retainSafety(task.m3_context.safety_signal, localFloor),
          user_correction: { text: source_input, replaces_revision: task.revision } },
      });
      if (next.m3_context.safety_signal !== 'CLEAR') holdTrainerSafety();
      publish(); route(next); return true;
    },
    cancel: (ref: TaskRef) => {
      if (!current(ref)) return false;
      const task = tasks.get(ref.task_id)!; pending.get(task.task_id)?.controller.abort(); pending.delete(task.task_id);
      invalidateM7EpisodeRetention(task.task_id);
      update(task, { status: "CANCELLED", operation_id: undefined });
      if (snapshot.active_task_id === task.task_id) {
        snapshot = Object.freeze({ ...snapshot, active_task_id: null });
      }
      publish(); return true;
    },
    setM3Permission: (ref: TaskRef, granted: boolean) => {
      if (typeof granted !== "boolean") return false;
      if (!actionOpen() && (granted || !historicalCurrent(ref))) return false;
      if (actionOpen() && !current(ref)) return false;
      const task = tasks.get(ref.task_id)!;
      pending.get(task.task_id)?.controller.abort(); pending.delete(task.task_id);
      retainM7EpisodeAcrossM3(ref);
      const cancelled = task.status === "CANCELLED";
      const next = update(task, {
        permission_granted: granted, permission_revision: task.permission_revision + 1,
        interpretation: cancelled ? task.interpretation : undefined,
        status: cancelled ? "CANCELLED" : granted ? "NEEDS_ROUTING" : "PAUSED",
        operation_id: undefined,
      });
      publish();
      if (granted && !cancelled) route(next);
      else if (options.adapter) void options.adapter.revoke({
        ticket: {
          session_id: next.session_id, task_id: next.task_id, task_revision: next.revision,
          permission_revision: next.permission_revision,
          operation_id: createRevokeRequestId(next.task_id, nextSequence()),
        },
        permission: { revision: next.permission_revision },
      });
      return true;
    },
    switchTask: (ref: TaskRef) => {
      if (!current(ref) || tasks.get(ref.task_id)?.status === "CANCELLED") return false;
      abortPending(ref.task_id);
      if (snapshot.active_task_id !== ref.task_id) clearGoalChoiceReceipt();
      snapshot = Object.freeze({ ...snapshot, active_task_id: ref.task_id }); publish();
      const task = tasks.get(ref.task_id);
      if (task?.status === "NEEDS_ROUTING" && !pending.has(ref.task_id)) route(task);
      return true;
    },
    revoke: async (ref: TaskRef) => {
      if (!(actionOpen() ? current(ref) : historicalCurrent(ref))) return false;
      pending.get(ref.task_id)?.controller.abort(); pending.delete(ref.task_id);
      const task = tasks.get(ref.task_id)!;
      retainM7EpisodeAcrossM3(ref);
      const updated = update(task, {
        permission_granted: false, permission_revision: task.permission_revision + 1,
        status: task.status === "CANCELLED" ? "CANCELLED" : "PAUSED", operation_id: undefined,
      });
      publish();
      if (options.adapter) await options.adapter.revoke({
        ticket: {
          session_id: updated.session_id, task_id: updated.task_id, task_revision: updated.revision,
          permission_revision: updated.permission_revision,
          operation_id: createRevokeRequestId(task.task_id, nextSequence()),
        },
        permission: { revision: updated.permission_revision },
      });
      return true;
    },
  });
  const selfWalkCore = createSelfWalk({
    binding: ownerBinding, resource: options.walkResource, now,
    issued: (ref) => taskAuthority.belongsToCurrentEpoch(ref),
    current: (ref) => currentActive(ref) && !!api.getM5GoalChoiceReceipt(ref),
    started: (ref) => {
      // A genuine guarded Start is the only issuer. No grant, getter or End can
      // recover an intake missed at Start. Retained management uses its own guard.
      closeRecordingIntake();
      m7Outcome?.beginActivity();
      const episode = selfWalk?.getEpisode(ref);
      const scope = readM7RecordingScope(options.m7Purpose);
      if (episode && scope) recordingIntake = Object.freeze({ episode, scope, closure: readM7RecordPurposeState(options.m7Purpose)!.closure });
    },
    handoff: (ref, facts) => {
      const receipt = api.getM5GoalChoiceReceipt(ref);
      const handoff = api.resolveM6GoalAction(ref, receipt, {
        available_time_minutes: facts.available_minutes as number | undefined,
        current_constraints: facts.concerns === 'NONE_REPORTED'
          && facts.professional_limits === 'NONE_REPORTED' ? 'NONE_REPORTED' : 'UNKNOWN',
      });
      return handoff?.state === 'ACTION_READY' && handoff.goal_kind === 'general_health' ? handoff : undefined;
    },
  });
  selfWalk=Object.freeze({...selfWalkCore,end:(...args:Parameters<typeof selfWalkCore.end>)=>{
    const result=selfWalkCore.end(...args);
    // Persist a completed human report at the actual End transaction, not on a later UI read.
    m7Outcome?.taskChanged();notifyObservers();return result;
  }});
  m7Outcome = createM7OutcomeStore({
    binding: ownerBinding, purpose: options.m7Purpose, now,
    issued: (ref) => taskAuthority.belongsToCurrentEpoch(ref),
    episode: (ref) => selfWalk?.getEpisode(ref),
    intake: currentRecordingIntake,
    closeIntake: closeRecordingIntake,
    ended: (ref) => !!selfWalk?.getCurrentEpisode(ref)?.end,
    episodeCurrent: (episode: M7EpisodeIdentity) => ownerAllowed() && active && actionOpen()
      && snapshot.session_id === episode.session_id
      && tasks.get(episode.task_id)?.revision === episode.task_revision,
    episodeRetained: (episode: M7EpisodeIdentity) => ownerAllowed() && active
      && snapshot.session_id === episode.session_id
      && (actionAuthority === "RETAINED_SOURCE_ONLY"
        ? episode === retainedM7Episode
        : tasks.get(episode.task_id)?.revision === episode.task_revision
          || m7PermissionOnlyEpisodes.get(episode.task_id) === episode.episode_key),
    lineageCleared: (episode: M7EpisodeIdentity) => {
      if (episode === retainedM7Episode) {
        retainedM7Episode = undefined;
        retainedRecordReceipt = undefined;
      }
      if (m7PermissionOnlyEpisodes.get(episode.task_id) === episode.episode_key) {
        invalidateM7EpisodeRetention(episode.task_id);
      }
    },
    holdGuidance: () => { selfWalk?.interrupt(); },
  });
  unsubscribeSource = observeM7NextCycleBasis(options.m7NextCycle, ownerBinding, () => {
    if (!active || !actionOpen()) return;
    const currentBasis = currentSourceBasis();
    const staleTaskIds = [...taskSourceBases].filter(([taskId, basis]) =>
      basis !== currentBasis && tasks.get(taskId)?.interpretation).map(([taskId]) => taskId);
    const activeTaskId = snapshot.active_task_id;
    const dependent = !!activeTaskId && taskSourceBases.has(activeTaskId)
      && taskSourceBases.get(activeTaskId) !== currentBasis;
    const rerouteTask = snapshot.active_task_id && pending.has(snapshot.active_task_id)
      ? tasks.get(snapshot.active_task_id) : undefined;
    if (!dependent && !rerouteTask && staleTaskIds.length === 0) { notifyObservers(); return; }
    if (sourceBasis !== currentBasis) sourceBasisStale = true;
    if (dependent) clearGoalChoiceReceipt(activeTaskId!);
    const operations = [...pending.values()]; pending.clear();
    if (dependent) selfWalk?.interrupt();
    for (const operation of operations) operation.controller.abort();
    for (const taskId of staleTaskIds) {
      const task = tasks.get(taskId)!;
      // A stale M3 claim is removed even when another task is active. Keep the
      // task revision for factual M7 history; its old source basis still blocks
      // future action. Do not retire the active independent task's handles.
      tasks.set(taskId, Object.freeze({ ...task, interpretation: undefined,
        status: 'PAUSED' as const, operation_id: undefined }));
    }
    if (dependent || staleTaskIds.length > 0) publish(dependent);
    // A pending interpretation has never authorized an action. It may be
    // re-evaluated against the new source; completed old actions stay stale.
    if (rerouteTask && tasks.get(rerouteTask.task_id) === rerouteTask
      && ownerAllowed() && active && actionOpen()) route(rerouteTask);
  });
  if (ownerBinding) unsubscribeOwner = ownerBinding.access.subscribe(() => { ownerAllowed(); });
  ownerAllowed();
  return Object.freeze({ ...api, selfWalk, m7Outcome });
}
export type SessionTaskStore = ReturnType<typeof createSessionTaskStore>;
