import { M7_FEEDBACK_COPY } from '../../i18n-m7-record';
import type { TaskRef } from '../session-task/store';

export type M7Purpose = 'RECORD_OUTCOME' | 'USE_NEXT_CYCLE';

declare const purposeBrand: unique symbol;
export type M7PurposeAccess = Readonly<{ [purposeBrand]: true }>;
export type M7PurposeReceipt = Readonly<{ purpose: M7Purpose; revision: number }>;

type PurposeEntry = {
  revisions: Record<M7Purpose, number>;
  receipts: Map<M7Purpose, M7PurposeReceipt>;
  listeners: Set<() => void>;
  scope?: { current: () => boolean; seen: boolean; closed: boolean; identity: object };
  notifyDepth: number;
  pendingNotify: boolean;
  recordClosure: number;
};

const authorities = new WeakMap<object, PurposeEntry>();
const receiptOwners = new WeakMap<object, M7PurposeAccess>();

const publishPurpose = (entry: PurposeEntry) => {
  if (entry.notifyDepth) { entry.pendingNotify = true; return; }
  for (const listener of [...entry.listeners]) { try { listener(); } catch { /* observers own no authority */ } }
};

/** Internal composition only: stable private scope, never a grant or an intake. */
export function readM7RecordingScope(access: M7PurposeAccess | undefined): object | undefined {
  const scope = access && authorities.get(access)?.scope;
  if (!scope || scope.closed) return undefined;
  let current = false;
  try { current = scope.current(); } catch { /* fail closed */ }
  if (scope.closed) return undefined;
  if (current) { scope.seen = true; return scope.identity; }
  if (scope.seen) scope.closed = true;
  return undefined;
}

/** Exact-receipt reduction; data owners close/erase before this notification. */
export function reduceM7RecordPurpose(access: M7PurposeAccess | undefined, expected: M7PurposeReceipt | undefined): boolean {
  if (readM7Purpose(access, expected, 'RECORD_OUTCOME') === undefined) return false;
  const entry = authorities.get(access!)!;
  entry.revisions.RECORD_OUTCOME++;
  entry.recordClosure++;
  entry.receipts.delete('RECORD_OUTCOME');
  publishPurpose(entry);
  return true;
}

export function withM7PurposePublicationHeld<T>(access: M7PurposeAccess | undefined, operation: () => T): T {
  const entry = access && authorities.get(access);
  if (!entry) return operation();
  entry.notifyDepth++;
  try { return operation(); } finally {
    entry.notifyDepth--;
    if (!entry.notifyDepth && entry.pendingNotify) { entry.pendingNotify = false; publishPurpose(entry); }
  }
}

/** Trusted local composition seam. Route/model input cannot manufacture a valid receipt. */
export function createLocalM7PurposeAuthority() {
  const access = Object.freeze(Object.create(null)) as M7PurposeAccess;
  const entry: PurposeEntry = {
    revisions: { RECORD_OUTCOME: 0, USE_NEXT_CYCLE: 0 },
    receipts: new Map(),
    listeners: new Set(),
    notifyDepth: 0, pendingNotify: false, recordClosure: 0,
  };
  authorities.set(access, entry);
  return Object.freeze({
    access,
    control: Object.freeze({
      bindRecordingScope: (current: () => boolean): boolean => {
        if (entry.scope || typeof current !== 'function') return false;
        entry.scope = { current, seen: false, closed: false, identity: Object.freeze(Object.create(null)) }; return true;
      },
      closeRecordingScope: () => { if (entry.scope) entry.scope.closed = true; },
      grant: (purpose: M7Purpose): M7PurposeReceipt => {
        const receipt = Object.freeze({ purpose, revision: ++entry.revisions[purpose] });
        entry.receipts.set(purpose, receipt);
        receiptOwners.set(receipt, access);
        publishPurpose(entry);
        return receipt;
      },
      revoke: (purpose: M7Purpose): void => {
        entry.revisions[purpose]++;
        if (purpose === 'RECORD_OUTCOME') entry.recordClosure++;
        entry.receipts.delete(purpose);
        publishPurpose(entry);
      },
    }),
  });
}

export function observeM7Purpose(access: M7PurposeAccess | undefined, listener: () => void) {
  const entry = access ? authorities.get(access) : undefined;
  entry?.listeners.add(listener);
  return () => { entry?.listeners.delete(listener); };
}

export function readM7Purpose(
  access: M7PurposeAccess | undefined,
  receipt: M7PurposeReceipt | undefined,
  purpose: M7Purpose,
): number | undefined {
  if (!access || !receipt || receiptOwners.get(receipt) !== access || receipt.purpose !== purpose) return undefined;
  const entry = authorities.get(access);
  return entry?.receipts.get(purpose) === receipt && entry.revisions[purpose] === receipt.revision
    ? receipt.revision : undefined;
}

export type M7EpisodeIdentity = Readonly<{
  episode_key: string;
  session_id: string;
  task_id: string;
  task_revision: number;
  view_revision: number;
  action_id: 'trainer.self.walk-easy.v0_1';
  action_version: number;
  proposal_revision: number;
  context_revision: number;
  source_revision: number;
  proposed_minutes: number;
}>;

export type M7OutcomeInput = Readonly<{
  request_id: string;
  execution_extent: 'DID' | 'PARTIAL' | 'SKIPPED' | 'UNKNOWN';
  action_change: 'UNCHANGED' | 'CHANGED' | 'UNKNOWN';
  user_stopped: boolean;
  problem_state: 'NO_PROBLEM_REPORTED' | 'PROBLEM' | 'UNKNOWN';
  safety_disposition: 'CLEAR' | 'REASSESS' | 'URGENT_HELP';
  constraint: 'NONE_REPORTED' | 'TIME_CONSTRAINT' | 'OTHER_CONSTRAINT' | 'UNKNOWN';
  performed_minutes?: number;
  occurred_at?: number;
  evidence_text?: string;
}>;

export type M7OutcomeFacts = Readonly<Omit<M7OutcomeInput, 'request_id' | 'occurred_at' | 'evidence_text'>>;

export type M7EvidenceSource = 'USER_REPORT' | 'DEVICE_OBSERVATION' | 'PROFESSIONAL_REPORT' | 'SYSTEM_EVENT' | 'UNKNOWN';

export type M7OutcomeEvidence = Readonly<{
  source: Extract<M7EvidenceSource, 'USER_REPORT'>;
  epistemic_role: 'PERSONAL_OBSERVATION_PR0';
  recorded_at: number;
  occurred_at?: number;
  task_revision: number;
  action_version: number;
  proposal_revision: number;
  context_revision: number;
  source_revision: number;
  permission_revision: number;
}>;

export type M7ActiveOutcome = Readonly<{
  state: 'ACTIVE';
  revision: number;
  supersedes_revision?: number;
  episode: M7EpisodeIdentity;
  outcome: M7OutcomeFacts;
  evidence: M7OutcomeEvidence;
  evidence_text?: string;
}>;

export type M7Retraction = Readonly<{
  state: 'RETRACTED';
  revision: number;
  supersedes_revision: number;
  episode: M7EpisodeIdentity;
  evidence: M7OutcomeEvidence;
}>;

export type M7OutcomeRevision = M7ActiveOutcome | M7Retraction | Readonly<
  Omit<M7ActiveOutcome, 'state'> & { state: 'SUPERSEDED' }
>;

export type M7OutcomeStatus = Readonly<{ state: 'UNKNOWN' | 'DENIED' | 'UNAVAILABLE' }>;
export type M7OutcomeSnapshot = M7OutcomeRevision | M7OutcomeStatus;

const requestPattern = /^[A-Za-z0-9_.-]{1,96}$/;
const execution = new Set(['DID', 'PARTIAL', 'SKIPPED', 'UNKNOWN']);
const change = new Set(['UNCHANGED', 'CHANGED', 'UNKNOWN']);
const problem = new Set(['NO_PROBLEM_REPORTED', 'PROBLEM', 'UNKNOWN']);
const safety = new Set(['CLEAR', 'REASSESS', 'URGENT_HELP']);
const constraint = new Set(['NONE_REPORTED', 'TIME_CONSTRAINT', 'OTHER_CONSTRAINT', 'UNKNOWN']);

export function sanitizeM7OutcomeInput(
  input: Readonly<Record<string, unknown>>,
  proposedMinutes: number,
): Readonly<{ request_id: string; facts: M7OutcomeFacts; occurred_at?: number; evidence_text?: string }> | undefined {
  if (!input || !requestPattern.test(String(input.request_id ?? ''))
    || !execution.has(String(input.execution_extent))
    || !change.has(String(input.action_change))
    || typeof input.user_stopped !== 'boolean'
    || !problem.has(String(input.problem_state))
    || !safety.has(String(input.safety_disposition))
    || !constraint.has(String(input.constraint))) return undefined;
  if (input.problem_state === 'NO_PROBLEM_REPORTED' && input.safety_disposition !== 'CLEAR') return undefined;
  if (input.problem_state === 'PROBLEM' && input.safety_disposition === 'CLEAR') return undefined;
  if (input.problem_state === 'UNKNOWN' && input.safety_disposition !== 'REASSESS') return undefined;
  if (input.performed_minutes !== undefined
    && (!Number.isInteger(input.performed_minutes) || Number(input.performed_minutes) < 0
      || Number(input.performed_minutes) > proposedMinutes)) return undefined;
  if (input.occurred_at !== undefined && !Number.isFinite(input.occurred_at)) return undefined;
  if (input.evidence_text !== undefined
    && (typeof input.evidence_text !== 'string' || input.evidence_text.length > 500)) return undefined;
  const facts = Object.freeze({
    execution_extent: input.execution_extent as M7OutcomeFacts['execution_extent'],
    action_change: input.action_change as M7OutcomeFacts['action_change'],
    user_stopped: input.user_stopped,
    problem_state: input.problem_state as M7OutcomeFacts['problem_state'],
    safety_disposition: input.safety_disposition as M7OutcomeFacts['safety_disposition'],
    constraint: input.constraint as M7OutcomeFacts['constraint'],
    ...(input.performed_minutes === undefined ? {} : { performed_minutes: Number(input.performed_minutes) }),
  });
  return Object.freeze({ request_id: String(input.request_id), facts,
    ...(input.occurred_at === undefined ? {} : { occurred_at: Number(input.occurred_at) }),
    ...(input.evidence_text === undefined ? {} : { evidence_text: input.evidence_text }) });
}

export function sameM7EpisodeRef(ref: TaskRef, episode: M7EpisodeIdentity): boolean {
  return ref.session_id === episode.session_id && ref.task_id === episode.task_id
    && ref.revision === episode.task_revision && ref.view_revision === episode.view_revision;
}

export function sameM7EpisodeTask(ref: TaskRef, episode: M7EpisodeIdentity): boolean {
  return ref.session_id === episode.session_id && ref.task_id === episode.task_id
    && ref.revision === episode.task_revision;
}

export type M7FeedbackExperience = 'VERY_GOOD' | 'FELT_MANAGEABLE' | 'FELT_TOO_MUCH' | 'PROBLEM_REPORTED';
export type M7FeedbackFacts = Readonly<{ experience: M7FeedbackExperience; displayed_label: string;
  locale: keyof typeof M7_FEEDBACK_COPY }>;
export type M7FeedbackRevision = Readonly<{ state: 'ACTIVE' | 'SUPERSEDED' | 'RETRACTED';
  revision: number; supersedes_revision?: number; episode: M7EpisodeIdentity;
  evidence: M7OutcomeEvidence; feedback?: M7FeedbackFacts }>;
export type M7FeedbackSnapshot = M7FeedbackRevision | M7OutcomeStatus;
export const M7_FEEDBACK_KEYS = Object.freeze({ VERY_GOOD: 'veryGood', FELT_MANAGEABLE: 'manageable',
  FELT_TOO_MUCH: 'tooMuch', PROBLEM_REPORTED: 'problem' } as const);
export function sanitizeM7FeedbackInput(input: Readonly<Record<string, unknown>>) {
  if (!input || typeof input.request_id !== 'string' || !requestPattern.test(input.request_id)
    || typeof input.experience !== 'string' || !Object.hasOwn(M7_FEEDBACK_KEYS, input.experience)
    || typeof input.locale !== 'string' || !Object.hasOwn(M7_FEEDBACK_COPY, input.locale)) return undefined;
  // No full-outcome field, severity, source or user text can silently enter F.
  if (Object.keys(input).some(key => !['request_id', 'experience', 'locale', 'displayed_label'].includes(key))) return undefined;
  const experience = input.experience as M7FeedbackExperience;
  const locale = input.locale as keyof typeof M7_FEEDBACK_COPY;
  const label = M7_FEEDBACK_COPY[locale][M7_FEEDBACK_KEYS[experience]];
  if (input.displayed_label !== label) return undefined;
  return Object.freeze({ request_id: input.request_id,
    facts: Object.freeze({ experience, locale, displayed_label: label }) });
}

/** Internal invalidation metadata; never grants permission. */
export function readM7RecordPurposeState(access: M7PurposeAccess | undefined) {
  const entry = access && authorities.get(access);
  return entry ? { revision: entry.revisions.RECORD_OUTCOME, closure: entry.recordClosure, granted: entry.receipts.has('RECORD_OUTCOME') } : undefined;
}
