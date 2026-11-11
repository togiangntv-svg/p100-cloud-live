import type { OwnerSessionBinding } from '@/domain/identity/owner-session-coordinator';
import { sameM7EpisodeRef, readM7Purpose, readM7RecordPurposeState, M7_FEEDBACK_KEYS, sanitizeM7FeedbackInput,
  type M7EpisodeIdentity, type M7OutcomeSnapshot, type M7PurposeReceipt,
  type M7FeedbackExperience, type M7FeedbackFacts } from '@/domain/m7/outcome';
import type { SessionTaskStore, TaskRef } from '@/domain/session-task/store';
import { createTrainerM7CycleAuthority } from '@/domain/trainer-runtime/m7-cycle-authority';
import { M7_FEEDBACK_COPY } from '@/i18n-m7-record';
import type { ReleaseLocale } from '@/i18n-opening';
import { readM7RecordActivation, type M7RecordActivation } from './m7-record-activation';

export type M7RecordDraft = Readonly<{
  execution_extent?: 'DID' | 'PARTIAL' | 'SKIPPED' | 'UNKNOWN';
  action_change?: 'UNCHANGED' | 'CHANGED' | 'UNKNOWN'; user_stopped?: boolean;
  problem_report?: 'NONE' | 'PROBLEM' | 'URGENT' | 'UNKNOWN';
  constraint?: 'NONE_REPORTED' | 'TIME_CONSTRAINT' | 'OTHER_CONSTRAINT' | 'UNKNOWN';
  minutes_text: string; evidence_text: string;
}>;
type ChoiceField = 'execution_extent' | 'action_change' | 'user_stopped' | 'problem_report' | 'constraint';
type ChoiceValue = NonNullable<M7RecordDraft[ChoiceField]>;
const choices = { execution_extent: ['DID', 'PARTIAL', 'SKIPPED', 'UNKNOWN'],
  action_change: ['UNCHANGED', 'CHANGED', 'UNKNOWN'], problem_report: ['NONE', 'PROBLEM', 'URGENT', 'UNKNOWN'],
  constraint: ['NONE_REPORTED', 'TIME_CONSTRAINT', 'OTHER_CONSTRAINT', 'UNKNOWN'] } as const;
const emptyDraft = (): M7RecordDraft => Object.freeze({ minutes_text: '', evidence_text: '' });
type Live = Readonly<{ store: SessionTaskStore; outcome: NonNullable<SessionTaskStore['m7Outcome']>; binding: OwnerSessionBinding }>;
type Context = { live: Live; ref: TaskRef; episode: M7EpisodeIdentity; activityVersion: number; taskRevision: number; reportable: boolean };
type Component = 'R' | 'F';

/** Existing host owns this single controller; none of its view callbacks is authority. */
export function createM7RecordController(options: Readonly<{
  getLive(): Live | undefined; activation: M7RecordActivation;
  authority: ReturnType<typeof createTrainerM7CycleAuthority>; onChange(): void;
}>) {
  let draft = emptyDraft(), feedbackDraft: M7FeedbackFacts | undefined;
  let receipt: M7PurposeReceipt | undefined, retainedRef: TaskRef | undefined;
  let editingRevision: number | undefined, feedbackEditing: number | undefined;
  let confirming: 'RETRACT' | 'DELETE' | undefined;
  let confirmingComponent: Component | 'BOTH' | undefined;
  let confirmation: Readonly<{ R?: number; F?: number }> | undefined;
  let serial = 0, token = 0, activity = 0, interaction = 0;
  let retired = false, closedView = false;
  let locale: ReleaseLocale = 'vi';
  let notice: keyof typeof M7_FEEDBACK_COPY.vi | undefined;
  let bound: Live | undefined;
  let purposeClosure = readM7RecordPurposeState(options.authority.access)?.closure;
  let unusedReleaseClosure: number | undefined;
  const resetDrafts = () => {
    draft = emptyDraft(); feedbackDraft = undefined; editingRevision = undefined; feedbackEditing = undefined;
    confirming = undefined; confirmingComponent = undefined; confirmation = undefined; notice = undefined;
  };
  const refreshPurposeClosure = () => {
    const closure = readM7RecordPurposeState(options.authority.access)?.closure;
    if (closure === purposeClosure) return;
    purposeClosure = closure;
    // A failed command releases only its unused acquisition. Its exact closure
    // must not erase a newer independently authored draft. A nested explicit
    // revoke advances closure again and is never covered by this exception.
    if (closure !== unusedReleaseClosure) resetDrafts();
    receipt = undefined; retainedRef = undefined; token++;
  };
  const scopeLive = () => {
    const live = options.getLive();
    if (retired || !live) return undefined;
    if (bound && (bound.store !== live.store || bound.outcome !== live.outcome
      || bound.binding.access !== live.binding.access || bound.binding.lease !== live.binding.lease)) return undefined;
    try { live.binding.access.requireLease(live.binding.lease);
      if (live.binding.access.getSnapshot().phase !== 'READY') return undefined;
    } catch { return undefined; }
    bound ??= live;
    return live;
  };
  // Installed once at construction, but read at Start/use against the actual
  // slot. Construction need not yet have an active slot or an activity.
  options.authority.bindRecordingScope(() => {
    const live = scopeLive(); return !!live && readM7RecordActivation(options.activation, live.binding);
  });
  const notify = () => { interaction++; token++; options.onChange(); };
  const requestId = () => `m7-record-${++serial}`;
  const liveEpisode = (): Context | undefined => {
    refreshPurposeClosure();
    const live = scopeLive(); if (!live) return undefined;
    const version = live.outcome.getActivityVersion();
    if (version !== activity) { activity = version; resetDrafts(); retainedRef = undefined; receipt = undefined; closedView = false; interaction++; token++; }
    const snapshot = live.store.getSnapshot();
    const task = snapshot.tasks.find(t => t.task_id === snapshot.active_task_id);
    if (!task || task.status === 'CANCELLED') return undefined;
    const ref = live.store.reference(task.task_id);
    const episode = ref && live.store.selfWalk.getEpisode(ref);
    if (ref && episode && sameM7EpisodeRef(ref, episode)) return { live, ref, episode, activityVersion: version, taskRevision: task.revision,
      reportable: readM7RecordActivation(options.activation, live.binding) && live.outcome.canRecord(ref, 'R') };
    // Management of already committed local records is independent of M3 consent.
    if (receipt && retainedRef?.task_id === task.task_id) {
      const r = live.outcome.getSnapshot(receipt), f = live.outcome.getFeedbackSnapshot(receipt);
      const retained = 'episode' in r ? r : 'episode' in f ? f : undefined;
      if (retained) return { live, ref: retainedRef, episode: retained.episode, activityVersion: version, taskRevision: task.revision, reportable: false };
    }
    return undefined;
  };
  const read = (context: Context, c: Component) => {
    if (!receipt) return undefined;
    const value = c === 'R' ? context.live.outcome.getSnapshot(receipt) : context.live.outcome.getFeedbackSnapshot(receipt);
    return 'episode' in value && value.episode.episode_key === context.episode.episode_key ? value : undefined;
  };
  const validDraft = () => draft.execution_extent !== undefined && draft.action_change !== undefined
    && draft.user_stopped !== undefined && draft.problem_report !== undefined && draft.constraint !== undefined
    && (draft.minutes_text === '' || /^(0|[1-9][0-9]*)$/u.test(draft.minutes_text)) && draft.evidence_text.length <= 500;
  const makeInput = (id: string) => ({ request_id: id, execution_extent: draft.execution_extent!,
    action_change: draft.action_change!, user_stopped: draft.user_stopped!,
    problem_state: draft.problem_report === 'NONE' ? 'NO_PROBLEM_REPORTED' : draft.problem_report === 'UNKNOWN' ? 'UNKNOWN' : 'PROBLEM',
    safety_disposition: draft.problem_report === 'NONE' ? 'CLEAR' : draft.problem_report === 'URGENT' ? 'URGENT_HELP' : 'REASSESS',
    constraint: draft.constraint!, ...(draft.minutes_text === '' ? {} : { performed_minutes: Number(draft.minutes_text) }),
    ...(draft.evidence_text === '' ? {} : { evidence_text: draft.evidence_text }) });
  const current = (issued: number) => { const context = liveEpisode(); return issued === token ? context : undefined; };
  const sameLive = (context: Context) => {
    const live = scopeLive(); return live?.store === context.live.store && live?.outcome === context.live.outcome
      && live.store.getSnapshot().active_task_id === context.ref.task_id
      && live.store.getSnapshot().tasks.find(t => t.task_id === context.ref.task_id)?.revision === context.taskRevision
      && live.outcome.getActivityVersion() === context.activityVersion;
  };
  const acquire = () => {
    const prior = options.authority.getSnapshot().record_outcome_receipt;
    const grant = options.authority.submitOutcome({ type: 'USER_SUBMITTED_OUTCOME', request_id: requestId() });
    if (grant.state !== 'GRANTED') return undefined;
    receipt = grant.receipt; return { receipt: grant.receipt, newlyAcquired: prior !== grant.receipt };
  };
  const releaseUnused = (context: Context, acquired: ReturnType<typeof acquire>) => {
    if (!acquired?.newlyAcquired || context.live.outcome.hasRetained()) return;
    const priorClosure = unusedReleaseClosure;
    const closure = readM7RecordPurposeState(options.authority.access)?.closure;
    unusedReleaseClosure = closure === undefined ? undefined : closure + 1;
    try {
      options.authority.revokeRecordOutcome({ type: 'TRUSTED_REVOKED_OUTCOME', request_id: requestId(), expected_receipt: acquired.receipt });
    } finally { unusedReleaseClosure = priorClosure; }
    if (receipt === acquired.receipt) receipt = undefined;
  };
  const present = (requestedLocale: ReleaseLocale = locale) => {
    if (requestedLocale !== locale && Object.hasOwn(M7_FEEDBACK_COPY, requestedLocale)) {
      locale = requestedLocale; feedbackDraft = undefined; feedbackEditing = undefined;
      confirming = undefined; confirmingComponent = undefined; confirmation = undefined; interaction++; token++;
    }
    const context = liveEpisode();
    const outcome = context && read(context, 'R') as M7OutcomeSnapshot | undefined;
    const feedback = context && read(context, 'F');
    const closedCurrent = closedView && !!scopeLive() && scopeLive()!.outcome.getActivityVersion() === activity;
    const state = !context ? closedCurrent ? 'DELETED' : 'UNAVAILABLE' : outcome?.state === 'ACTIVE' ? 'ACTIVE'
      : outcome?.state === 'RETRACTED' ? 'RETRACTED'
        : closedView || context.live.outcome.isComponentDeleted('R') ? 'DELETED' : 'READY';
    const feedbackState = !context ? closedCurrent ? 'DELETED' : 'UNAVAILABLE' : feedback?.state === 'ACTIVE' ? 'ACTIVE'
      : feedback?.state === 'RETRACTED' ? 'RETRACTED' : closedView || context.live.outcome.isComponentDeleted('F') ? 'DELETED' : 'READY';
    const issued = token;
    const canFeedback = !!context && readM7RecordActivation(options.activation, context.live.binding)
      && context.live.outcome.canRecord(context.ref, 'F');
    const clearConfirmation = () => { confirming = undefined; confirmingComponent = undefined; confirmation = undefined; };
    const requestConfirmation = (component: Component | 'BOTH', operation: 'DELETE' | 'RETRACT') => {
      const c = current(issued); if (!c) return false;
      const r = read(c, 'R'), f = read(c, 'F');
      const expected = component === 'R' ? r ? { R: r.revision } : undefined
        : component === 'F' ? f ? { F: f.revision } : undefined
          : r && f ? { R: r.revision, F: f.revision } : undefined;
      if (!expected || operation === 'RETRACT' && (component === 'R' ? r?.state : f?.state) !== 'ACTIVE') return false;
      confirming = operation; confirmingComponent = component; confirmation = Object.freeze(expected); notice = undefined; notify(); return true;
    };
    const confirmOperation = (operation: 'DELETE' | 'RETRACT') => {
      const c = current(issued), expected = confirmation, component = confirmingComponent;
      if (!c || confirming !== operation || !expected || !component) return false;
      const oldDraft = draft, oldFeedbackDraft = feedbackDraft, submittedLocale = locale, submittedInteraction = interaction;
      const result = operation === 'DELETE' ? c.live.outcome.erase(c.ref, receipt, expected, requestId())
        : component === 'R' ? c.live.outcome.retract(c.ref, receipt, expected.R!, requestId())
          : c.live.outcome.retractFeedback(c.ref, receipt, expected.F!, requestId());
      if (result.state !== (operation === 'DELETE' ? 'UNKNOWN' : 'RETRACTED') || !sameLive(c)) return false;
      const publicationCurrent = locale === submittedLocale && interaction === submittedInteraction;
      if (component !== 'F' && draft === oldDraft) { draft = emptyDraft(); editingRevision = undefined; }
      if (component !== 'R' && feedbackDraft === oldFeedbackDraft) { feedbackDraft = undefined; feedbackEditing = undefined; }
      if (confirmation === expected) clearConfirmation();
      if (operation === 'DELETE') {
        if (publicationCurrent) notice = component === 'R' ? 'deletedReport' : component === 'F' ? 'deletedFeedback' : 'deletedBoth';
        if (!c.live.outcome.hasRetained()) { closedView = true; receipt = undefined; retainedRef = undefined; }
      } else if (component === 'F' && publicationCurrent) notice = 'retracted';
      notify(); return true;
    };
    return Object.freeze({
      persistence: context?.live.outcome.getPersistenceState()??'RAM_ONLY',
      state, draft, outcome, confirming, confirmingComponent, editing: editingRevision !== undefined,
      feedback, feedbackState, feedbackDraft, feedbackEditing: feedbackEditing !== undefined, canFeedback, notice,
      locale, forLocale: present, proposedMinutes: context?.episode.proposed_minutes,
      canSubmit: !!context && validDraft() && (state === 'READY' && context.reportable
        || state === 'ACTIVE' && outcome?.state === 'ACTIVE' && editingRevision === outcome.revision),
      canSubmitFeedback: !!feedbackDraft && (feedbackEditing !== undefined && feedback?.state === 'ACTIVE'
        && feedback.revision === feedbackEditing || feedbackState === 'READY' && canFeedback),
      choose(field: ChoiceField, value: ChoiceValue) {
        const c = current(issued); if (!c || state === 'DELETED' || state === 'RETRACTED') return false;
        if (field === 'user_stopped' ? typeof value !== 'boolean' : !(choices[field] as readonly string[]).includes(String(value))) return false;
        draft = Object.freeze({ ...draft, [field]: value }); clearConfirmation(); notice = undefined; notify(); return true;
      },
      setMinutes(text: string) {
        if (!current(issued) || state === 'DELETED' || state === 'RETRACTED' || typeof text !== 'string' || text.length > 3) return false;
        draft = Object.freeze({ ...draft, minutes_text: text }); clearConfirmation(); notify(); return true;
      },
      setEvidenceText(text: string) {
        if (!current(issued) || state === 'DELETED' || state === 'RETRACTED' || typeof text !== 'string' || text.length > 500) return false;
        draft = Object.freeze({ ...draft, evidence_text: text }); clearConfirmation(); notify(); return true;
      },
      cancel() {
        if (!current(issued)) return false;
        draft = emptyDraft(); editingRevision = undefined;
        if (confirmingComponent !== 'F') clearConfirmation();
        notify(); return true;
      },
      cancelFeedback() {
        if (!current(issued)) return false;
        feedbackDraft = undefined; feedbackEditing = undefined;
        if (confirmingComponent !== 'R') clearConfirmation();
        notice = undefined; notify(); return true;
      },
      keep() { if (!current(issued)) return false; clearConfirmation(); notify(); return true; },
      beginCorrection() {
        const c = current(issued), value = c && read(c, 'R');
        if (!value || value.state !== 'ACTIVE' || !('outcome' in value)) return false;
        const facts = value.outcome;
        draft = Object.freeze({ execution_extent: facts.execution_extent, action_change: facts.action_change,
          user_stopped: facts.user_stopped, problem_report: facts.problem_state === 'NO_PROBLEM_REPORTED' ? 'NONE'
            : facts.problem_state === 'UNKNOWN' ? 'UNKNOWN' : facts.safety_disposition === 'URGENT_HELP' ? 'URGENT' : 'PROBLEM',
          constraint: facts.constraint, minutes_text: facts.performed_minutes === undefined ? '' : String(facts.performed_minutes),
          evidence_text: value.evidence_text ?? '' }); editingRevision = value.revision;
        clearConfirmation(); notice = undefined; notify(); return true;
      },
      submit() {
        const c = current(issued); if (!c || !validDraft() || state === 'DELETED') return false;
        const submitted = draft, previous = read(c, 'R'), submittedConfirmation = confirmation;
        let acquired: ReturnType<typeof acquire>;
        if (editingRevision === undefined) { if (previous || !c.reportable) return false; acquired = acquire(); if (!acquired) return false; }
        else if (previous?.state !== 'ACTIVE' || previous.revision !== editingRevision) return false;
        // Grant observers can revoke/replace the owner or alter the draft.
        if (!sameLive(c) || draft !== submitted) { releaseUnused(c, acquired); return false; }
        retainedRef = c.ref;
        const result = editingRevision === undefined ? c.live.outcome.report(c.ref, receipt, makeInput(requestId()))
          : c.live.outcome.correct(c.ref, receipt, editingRevision, makeInput(requestId()));
        if (result.state !== 'ACTIVE' || !sameLive(c) || read(c, 'R') !== result) { releaseUnused(c, acquired); return false; }
        if (draft === submitted) { draft = emptyDraft(); editingRevision = undefined; }
        if (confirmation === submittedConfirmation) clearConfirmation(); notify(); return true;
      },
      chooseFeedback(experience: M7FeedbackExperience) {
        const c = current(issued); if (!c || !(canFeedback || feedbackEditing !== undefined)
          || !Object.hasOwn(M7_FEEDBACK_KEYS, experience)) return false;
        feedbackDraft = Object.freeze({ experience, locale, displayed_label: M7_FEEDBACK_COPY[locale][M7_FEEDBACK_KEYS[experience]] });
        clearConfirmation(); notice = undefined; notify(); return true;
      },
      beginFeedbackCorrection() {
        const c = current(issued), value = c && read(c, 'F');
        if (!value || value.state !== 'ACTIVE') return false;
        feedbackEditing = value.revision; feedbackDraft = undefined;
        clearConfirmation(); notice = undefined; notify(); return true;
      },
      submitFeedback() {
        const c = current(issued), submitted = feedbackDraft;
        if (!c || !submitted || submitted.locale !== locale) return false;
        const id = requestId(), input = { request_id: id, ...submitted };
        if (!sanitizeM7FeedbackInput(input)) return false;
        const previous = read(c, 'F'); let acquired: ReturnType<typeof acquire>;
        const correcting = feedbackEditing, submittedConfirmation = confirmation, submittedLocale = locale;
        if (correcting === undefined) {
          if (previous || !readM7RecordActivation(options.activation, c.live.binding) || !c.live.outcome.canRecord(c.ref, 'F')) return false;
          acquired = acquire(); if (!acquired) return false;
        } else if (previous?.state !== 'ACTIVE' || previous.revision !== correcting) return false;
        if (!sameLive(c) || submitted !== feedbackDraft) { releaseUnused(c, acquired); return false; }
        retainedRef = c.ref;
        const result = correcting === undefined ? c.live.outcome.reportFeedback(c.ref, receipt, input)
          : c.live.outcome.correctFeedback(c.ref, receipt, correcting, input);
        if (result.state !== 'ACTIVE' || !sameLive(c) || read(c, 'F') !== result) { releaseUnused(c, acquired); return false; }
        const publicationCurrent = feedbackDraft === submitted && locale === submittedLocale && confirmation === submittedConfirmation;
        if (feedbackDraft === submitted) { feedbackDraft = undefined; feedbackEditing = undefined; }
        if (confirmation === submittedConfirmation) clearConfirmation();
        if (publicationCurrent) notice = correcting === undefined ? 'saved' : 'corrected';
        notify(); return true;
      },
      requestRetraction: () => requestConfirmation('R', 'RETRACT'),
      requestDelete: () => requestConfirmation('R', 'DELETE'),
      requestFeedbackRetraction: () => requestConfirmation('F', 'RETRACT'),
      requestFeedbackDelete: () => requestConfirmation('F', 'DELETE'),
      requestDeleteBoth: () => requestConfirmation('BOTH', 'DELETE'),
      confirmRetraction: () => confirmOperation('RETRACT'),
      confirmDelete: () => confirmOperation('DELETE'),
    });
  };
  return Object.freeze({ presentation: present,
    invalidateView() {
      refreshPurposeClosure();
      token++;
      if (closedView) { closedView = false; notice = undefined; }
      if (receipt && readM7Purpose(options.authority.access, receipt, 'RECORD_OUTCOME') === undefined) {
        resetDrafts(); receipt = undefined; retainedRef = undefined;
      }
      const c = liveEpisode();
      if (c) return;
      resetDrafts(); retainedRef = undefined;
      // A lost current view is not permission to erase a lawful retained record.
      if (receipt && !scopeLive()?.outcome.hasRetained()) receipt = undefined;
    },
    retire() { if (retired) return; retired = true; resetDrafts(); receipt = undefined;
      retainedRef = undefined; bound = undefined; options.authority.retire(); notify(); },
  });
}
export type M7RecordPresentation = ReturnType<ReturnType<typeof createM7RecordController>['presentation']>;
