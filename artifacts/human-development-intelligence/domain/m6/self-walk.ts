import type { OwnerSessionBinding } from '../identity/owner-session-coordinator';
import type { TaskRef } from '../session-task/store';
import type { GoalM6ActionHandoff } from './action-handoff';
import { observeWalkResource, readWalkResource, W01 } from './walk-resource';
import type { WalkResourceAccess } from './walk-resource';

// Non-personal safety information does not require an owner lease.
export const urgentWalkGuidance = 'Dừng vận động và tìm trợ giúp khẩn cấp tại nơi bạn đang ở.';
type Report = Readonly<Record<string, unknown>>;
type Source = NonNullable<ReturnType<typeof readWalkResource>>;
export type SelfWalkProposal = Readonly<{
  state: 'PROPOSED'; action_id: typeof W01.id; proposal_revision: number;
  duration_minutes: number; scope: TaskRef; context_revision: number;
  source_handoff: GoalM6ActionHandoff;
  source: Source; content: Readonly<{ title: string; instructions: string; warning: string; why: string }>;
}>;
type Proposal = SelfWalkProposal;
type Choice = Readonly<{ kind: 'USER_CHOICE'; request_id: string; recorded_at: number }>;
type Start = Readonly<{ kind: 'USER_REPORTED_START'; request_id: string; recorded_at: number }>;
type End = Readonly<{ kind: 'USER_REPORTED_END'; request_id: string; recorded_at: number }>;
export type SelfWalkEpisodeIdentity = Readonly<{
  episode_key: string; session_id: string; task_id: string; task_revision: number; view_revision: number;
  action_id: typeof W01.id; action_version: number; proposal_revision: number;
  context_revision: number; source_revision: number; proposed_minutes: number;
}>;
type Action = Readonly<Omit<Proposal, 'state'> & {
  state: 'PROPOSED' | 'ACCEPTED' | 'STARTED' | 'CANCELLED' | 'STOPPED' | 'INVALIDATED';
  acceptance?: Choice; start?: Start;
}>;
type Status = Readonly<{ state: 'IDLE' | 'UNAVAILABLE' | 'DENIED' | 'NEED_CONTEXT' | 'SAFETY_HOLD'
  | 'URGENT_HELP' | 'NO_ACTION' | 'UNSUPPORTED' | 'SOURCE_BLOCKED'; clarify?: string }>;
type Snapshot = Action | Status;
type Context = Readonly<{
  facts: Report; scope: TaskRef; revision: number;
  metadata: Readonly<{ recorded_at: number; source_ref: string; currentness: 'CURRENT' | 'UNCERTAIN' | 'CONFLICTING'; provenance: 'SYSTEM_METADATA' }>;
}>;
const status = (state: Status['state']): Status => Object.freeze({ state });
// One decision-relevant clarification at a time; presentation is not wired here.
const needs = (clarify: string): Status => Object.freeze({ state: 'NEED_CONTEXT', clarify });
const terminal = (state: string) => ['CANCELLED', 'STOPPED', 'INVALIDATED'].includes(state);
const fields = ['intent', 'walking_choice', 'adult', 'mobility', 'concerns',
  'professional_limits', 'setting', 'competing_activity', 'footwear', 'available_minutes',
  'requested_minutes'] as const;
const validId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_.-]{1,96}$/.test(s);
const sameRef = (a: TaskRef, b: TaskRef) => a.session_id === b.session_id && a.task_id === b.task_id
  && a.revision === b.revision && a.view_revision === b.view_revision;

function eligibility(f: Report): number | Status {
  if (f.concerns === 'URGENT') return status('URGENT_HELP');
  if (['PAIN', 'DIZZY', 'UNUSUAL_BREATHLESSNESS', 'UNRESOLVED'].includes(String(f.concerns))
    || f.professional_limits === 'REPORTED') return status('SAFETY_HOLD');
  if (f.walking_choice === 'DECLINED' || f.intent === 'STRENGTH_SESSION') return status('NO_ACTION');
  if (f.adult === 'NOT_ADULT' || f.mobility === 'NEEDS_SUPPORT'
    || f.setting === 'UNSUITABLE' || f.competing_activity === 'HAZARDOUS'
    || f.footwear === 'UNSUITABLE') return status('UNSUPPORTED');
  const required = [
    ['currency', 'CURRENT'], ['concerns', 'NONE_REPORTED'], ['professional_limits', 'NONE_REPORTED'],
    ['intent', 'SHORT_LIGHT_MOVEMENT'], ['walking_choice', 'WANTS_WALK'], ['adult', 'REPORTED_ADULT'],
    ['mobility', 'INDEPENDENT_COMFORTABLE_WALKING'], ['setting', 'INDOOR_FLAT_CLEAR_LIT_DRY_STOPPABLE'],
    ['competing_activity', 'NONE'], ['footwear', 'FAMILIAR_SECURE'],
  ] as const;
  for (const [field, expected] of required) if (f[field] !== expected) return needs(field);
  const available = f.available_minutes;
  if (typeof available !== 'number' || !Number.isFinite(available) || available < 1) return needs('available_minutes');
  // Source permits shorter 1–4 minutes; 20 minutes available never prescribes 20.
  const duration = f.requested_minutes === undefined ? Math.min(5, Math.floor(available)) : f.requested_minutes;
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 1
    || duration > 5 || duration > available) return needs('requested_minutes');
  return duration;
}

/** Internal RAM-only domain seam. The store binds authority BEFORE creating tasks.
 * Not a route/UI interface: callers cannot supply owner IDs, safe/approved flags,
 * context timestamps/revisions, authority predicates, or replacement leases.
 */
export function createSelfWalk(options: {
  binding?: OwnerSessionBinding; resource?: WalkResourceAccess; now: () => number;
  issued: (ref: TaskRef) => boolean;
  current: (ref: TaskRef) => boolean;
  started?: (ref: TaskRef) => void;
  handoff: (ref: TaskRef, facts: Report) => GoalM6ActionHandoff | undefined;
}) {
  const binding = options.binding && Object.freeze({ ...options.binding });
  let retired = false;
  let context: Context | undefined;
  let displayed: Proposal | undefined;
  let startedProposal: Proposal | undefined;
  let endWitness: End | undefined;
  let episodeInvalidated = false;
  let snapshot: Snapshot = status('IDLE');
  let revision = 0;
  let proposalSequence = 0;
  // Never evict request IDs within a session: deny on capacity, rather than replay.
  const requests = new Map<string, string>();
  let unobserve = () => {};
  const clearPrivate = () => {
    retired = true; context = undefined; displayed = undefined; startedProposal = undefined; endWitness = undefined; requests.clear();
    snapshot = status('UNAVAILABLE'); unobserve();
  };
  const authorized = () => {
    if (retired || !binding) return false;
    try {
      binding.access.requireLease(binding.lease);
      return binding.access.getSnapshot().phase === 'READY';
    } catch { clearPrivate(); return false; }
  };
  const invalidate = (clearContext = false) => {
    endWitness = undefined;
    if (startedProposal) episodeInvalidated = true;
    if ('action_id' in snapshot && !terminal(snapshot.state)) snapshot = Object.freeze({ ...snapshot, state: 'INVALIDATED' });
    displayed = undefined;
    if (clearContext) context = undefined;
  };
  const recheck = () => {
    if (!authorized()) return;
    if (context && !options.current(context.scope)) invalidate(true);
    if (!readWalkResource(options.resource)) invalidate();
  };
  unobserve = observeWalkResource(options.resource, () => invalidate());
  const getSnapshot = (): Snapshot => {
    if (!authorized()) return status('UNAVAILABLE');
    recheck(); return snapshot;
  };
  const fresh = (ref: TaskRef | undefined): ref is TaskRef =>
    authorized() && !!ref && options.current(ref);
  const write = (apply: () => void) => {
    if (!authorized() || !binding) return false;
    try {
      binding.access.applyIfCurrent(binding.lease, () => {
        if (binding.access.getSnapshot().phase !== 'READY') throw Error('UNAVAILABLE');
        apply(); return undefined;
      });
      return authorized();
    } catch { clearPrivate(); return false; }
  };
  const request = (id: string, signature: string): 'NEW' | 'REPEAT' | 'DENIED' => {
    if (!validId(id)) return 'DENIED';
    if (requests.has(id)) return requests.get(id) === signature ? 'REPEAT' : 'DENIED';
    return requests.size < 128 ? 'NEW' : 'DENIED';
  };
  const proposedCurrent = (ref: TaskRef | undefined, p: Proposal) => {
    recheck();
    const source = readWalkResource(options.resource);
    return fresh(ref) && p === displayed && !!context && sameRef(ref, p.scope)
      && context.revision === p.context_revision && source?.revision === p.source.revision
      && typeof eligibility({ ...context.facts, currency: context.metadata.currentness }) === 'number'
      && options.handoff(ref, { ...context.facts, currency: context.metadata.currentness })?.state === 'ACTION_READY';
  };
  // Unlike reducing Stop/getEpisode, this read is authority for CURRENT lifecycle.
  // Ordinary Stop clears displayed, so use the canonical started proposal instead.
  const currentEpisode = (ref: TaskRef | undefined) => {
    recheck();
    const p = startedProposal;
    const source = readWalkResource(options.resource);
    if (!fresh(ref) || !p || episodeInvalidated || !context || !('action_id' in snapshot) || !snapshot.start
      || !['STARTED', 'STOPPED'].includes(snapshot.state)
      || !sameRef(ref, p.scope) || !sameRef(ref, snapshot.scope)
      || snapshot.proposal_revision !== p.proposal_revision
      || context.revision !== p.context_revision || source?.revision !== p.source.revision
      || typeof eligibility({ ...context.facts, currency: context.metadata.currentness }) !== 'number'
      || options.handoff(ref, { ...context.facts, currency: context.metadata.currentness })?.state !== 'ACTION_READY') return undefined;
    return Object.freeze({ action: snapshot, end: endWitness });
  };
  const transition = (op: 'accept' | 'start' | 'chooseAndStart' | 'cancel' | 'stop',
    ref: TaskRef | undefined, p: Proposal, id: string): Snapshot => {
    if (!proposedCurrent(ref, p)) return status('DENIED');
    const signature = `${op}:${p.proposal_revision}`;
    const req = request(id, signature);
    if (req === 'DENIED' || !('action_id' in snapshot)) return status('DENIED');
    if (req === 'REPEAT') return getSnapshot();
    if (terminal(snapshot.state)) return status('DENIED');
    const from = snapshot.state;
    if ((op === 'accept' || op === 'chooseAndStart') && from !== 'PROPOSED') return status('DENIED');
    if (op === 'start' && from !== 'ACCEPTED') return status('DENIED');
    if (op === 'stop' && from !== 'STARTED') return status('DENIED');
    const recordedAt = options.now();
    if (!Number.isFinite(recordedAt)) return status('DENIED');
    const next: Action = Object.freeze({ ...snapshot,
      state: op === 'accept' ? 'ACCEPTED' : op === 'cancel' ? 'CANCELLED' : op === 'stop' ? 'STOPPED' : 'STARTED',
      ...((op === 'accept' || op === 'chooseAndStart') ? { acceptance: Object.freeze({ kind: 'USER_CHOICE' as const, request_id: id, recorded_at: recordedAt }) } : {}),
      ...((op === 'start' || op === 'chooseAndStart') ? { start: Object.freeze({ kind: 'USER_REPORTED_START' as const, request_id: id, recorded_at: recordedAt }) } : {}),
    });
    if (!write(() => {
      if (!proposedCurrent(ref, p)) throw Error('UNAVAILABLE');
      requests.set(id, signature); snapshot = next;
      if (op === 'start' || op === 'chooseAndStart') {
        startedProposal = p;
        // Private same-store issuance, before any dependent presentation.
        options.started?.(ref);
      }
    })) return status('DENIED');
    return getSnapshot();
  };
  return Object.freeze({
    getSnapshot,
    getCurrentEpisode: currentEpisode,
    end: (ref: TaskRef, p: Proposal, id: string): Snapshot => {
      const episode = currentEpisode(ref);
      if (!episode || p !== startedProposal) return status('DENIED');
      const signature = `end:${p.proposal_revision}`;
      const req = request(id, signature);
      if (req === 'DENIED') return status('DENIED');
      if (req === 'REPEAT') return endWitness?.request_id === id ? episode.action : status('DENIED');
      if (endWitness) return status('DENIED');
      const recordedAt = options.now();
      if (!Number.isFinite(recordedAt)) return status('DENIED');
      const witness: End = Object.freeze({ kind: 'USER_REPORTED_END', request_id: id, recorded_at: recordedAt });
      if (!write(() => {
        if (currentEpisode(ref)?.action !== episode.action || p !== startedProposal
          || endWitness || request(id, signature) !== 'NEW') throw Error('UNAVAILABLE');
        // One owner transaction: no STOPPED-without-E intermediate publication.
        requests.set(id, signature);
        snapshot = Object.freeze({ ...episode.action, state: 'STOPPED' as const });
        endWitness = witness;
        displayed = undefined;
      })) return status('DENIED');
      const current = currentEpisode(ref);
      return current?.end === witness ? current.action : status('DENIED');
    },
    /** Read-only canonical episode seam for M7. A caller-supplied ID is never accepted. */
    getEpisode: (ref: TaskRef | undefined): SelfWalkEpisodeIdentity | undefined => {
      if (!authorized() || !ref || !options.issued(ref) || !('action_id' in snapshot) || !snapshot.start
        || !sameRef(ref, snapshot.scope)) return undefined;
      return Object.freeze({
        episode_key: [snapshot.scope.session_id, snapshot.scope.task_id, snapshot.scope.revision,
          snapshot.scope.view_revision, snapshot.action_id, snapshot.source.version,
          snapshot.proposal_revision, snapshot.context_revision, snapshot.source.revision].join('|'),
        session_id: snapshot.scope.session_id, task_id: snapshot.scope.task_id,
        task_revision: snapshot.scope.revision, view_revision: snapshot.scope.view_revision,
        action_id: snapshot.action_id, action_version: snapshot.source.version,
        proposal_revision: snapshot.proposal_revision, context_revision: snapshot.context_revision,
        source_revision: snapshot.source.revision, proposed_minutes: snapshot.duration_minutes,
      });
    },
    // Store calls these synchronously BEFORE observers see task/session changes.
    taskChanged: () => { recheck(); },
    retire: clearPrivate,
    interrupt: () => { if (authorized()) invalidate(true); },
    reportContext: (ref: TaskRef | undefined, input: Report, metadata?: Readonly<{ source_ref?: unknown }>): boolean => {
      const sourceRef = metadata?.source_ref ?? input?.source_ref;
      if (!fresh(ref) || !input || !validId(sourceRef)) return false;
      // Copy only bounded primitive fields: never retain model/user free text,
      // owner IDs, presentation preferences, or caller-mutated input objects.
      const copy: Record<string, unknown> = {};
      for (const field of fields) {
        const value = input[field];
        if (value !== undefined && (typeof value !== 'string' && typeof value !== 'number'
          || typeof value === 'string' && value.length > 96)) return false;
        if (value !== undefined) copy[field] = value;
      }
      const legacyCurrency = input.currency;
      if (legacyCurrency !== undefined && !['CURRENT', 'UNCERTAIN', 'CONFLICTING'].includes(String(legacyCurrency))) return false;
      const currentness = legacyCurrency === 'UNCERTAIN' || legacyCurrency === 'CONFLICTING'
        ? legacyCurrency : 'CURRENT';
      const recordedAt = options.now();
      if (!Number.isFinite(recordedAt)) return false;
      if (context && sameRef(context.scope, ref) && context.metadata.source_ref === sourceRef
        && context.metadata.currentness === currentness
        && JSON.stringify(context.facts) === JSON.stringify(copy)) return true;
      return write(() => {
        if (!options.current(ref)) throw Error('UNAVAILABLE');
        invalidate();
        context = Object.freeze({ facts: Object.freeze(copy), scope: ref, revision: ++revision,
          metadata: Object.freeze({ recorded_at: recordedAt, source_ref: sourceRef,
            currentness, provenance: 'SYSTEM_METADATA' as const }) });
      });
    },
    propose: (ref: TaskRef | undefined, id: string): Snapshot => {
      recheck();
      if (!fresh(ref)) return status('DENIED');
      if (!context || !sameRef(context.scope, ref)) return needs('current_walk_context');
      const currentFacts = Object.freeze({ ...context.facts, currency: context.metadata.currentness });
      const duration = eligibility(currentFacts);
      // Safety/refusal precedes source adoption and action availability.
      if (typeof duration !== 'number') return duration;
      const source = readWalkResource(options.resource);
      if (!source) return status('SOURCE_BLOCKED');
      const handoff = options.handoff(ref, currentFacts);
      if (handoff?.state !== 'ACTION_READY' || handoff.goal_kind !== 'general_health') return status('NO_ACTION');
      const signature = `propose:${context.revision}:${source.revision}`;
      const req = request(id, signature);
      if (req === 'DENIED') return status('DENIED');
      if (req === 'REPEAT') return displayed ? getSnapshot() : status('DENIED');
      if (displayed) return status('DENIED'); // Do not replace an already displayed/started action.
      const p: Proposal = Object.freeze({ state: 'PROPOSED', action_id: W01.id,
        proposal_revision: ++proposalSequence, duration_minutes: duration,
        scope: ref, context_revision: context.revision, source,
        source_handoff: handoff,
        content: Object.freeze({ ...source.content, title: source.content.title.replace('{n}', String(duration)) }),
      });
      if (!write(() => {
        if (!options.current(ref) || !readWalkResource(options.resource)) throw Error('UNAVAILABLE');
        requests.set(id, signature); displayed = p; startedProposal = undefined; endWitness = undefined; episodeInvalidated = false; snapshot = p;
      })) return status('DENIED');
      return getSnapshot();
    },
    accept: (ref: TaskRef, p: Proposal, id: string) => transition('accept', ref, p, id),
    start: (ref: TaskRef, p: Proposal, id: string) => transition('start', ref, p, id),
    chooseAndStart: (ref: TaskRef, p: Proposal, id: string) => transition('chooseAndStart', ref, p, id),
    cancel: (ref: TaskRef, p: Proposal, id: string) => transition('cancel', ref, p, id),
    // Stop only reduces authority. A stale handoff, context or task ledger must
    // not prevent the owner from stopping the exact action already started.
    stop: (ref: TaskRef, p: Proposal, id: string): Snapshot => {
      if (!authorized() || !options.issued(ref) || p !== startedProposal
        || !('action_id' in snapshot) || !snapshot.start
        || !sameRef(ref, snapshot.scope) || !sameRef(ref, p.scope)
        || snapshot.proposal_revision !== p.proposal_revision) return status('DENIED');
      const signature = `stop:${p.proposal_revision}`;
      if (!validId(id) || requests.has(id) && requests.get(id) !== signature) return status('DENIED');
      if (requests.get(id) === signature) return getSnapshot();
      if (snapshot.state !== 'STARTED' && snapshot.state !== 'INVALIDATED') return status('DENIED');
      if (!write(() => {
        // A full action ledger cannot prevent an authority-reducing Stop.
        if (requests.size < 128) requests.set(id, signature);
        snapshot = Object.freeze({ ...(snapshot as Action), state: 'STOPPED' as const });
        displayed = undefined;
      })) return status('DENIED');
      return getSnapshot();
    },
  });
}
