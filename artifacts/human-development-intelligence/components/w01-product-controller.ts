import type { SelfWalkProposal } from '@/domain/m6/self-walk';
import type { SessionTaskStore, TaskRef } from '@/domain/session-task/store';

export type W01QuestionId = 'walking_choice' | 'concerns' | 'professional_limits' | 'adult'
  | 'mobility' | 'setting' | 'competing_activity' | 'footwear'
  | 'available_minutes' | 'requested_minutes';
export type W01AnswerId = 'yes' | 'decline' | 'not_sure' | 'skip' | 'none' | 'pain'
  | 'dizzy' | 'breathless' | 'unresolved' | 'urgent' | 'restricted' | 'adult'
  | 'not_adult' | 'independent' | 'needs_support' | 'supported' | 'unsupported'
  | 'none_competing' | 'hazardous' | 'suitable' | 'unsuitable' | '1' | '2' | '3' | '4' | '5';
type DomainSnapshot = Readonly<{ state: string; clarify?: string; content?: SelfWalkProposal['content']; duration_minutes?: number; start?: unknown; scope?: TaskRef }>;
export type W01ProductOperation = 'accept' | 'start' | 'cancel' | 'stop' | 'end';

export type W01ProductPort = Readonly<{
  current(): boolean;
  snapshot(): DomainSnapshot;
  report(facts: Readonly<Record<string, string | number>>, sourceRef: string): boolean;
  propose(requestId: string): DomainSnapshot;
  act(operation: W01ProductOperation, proposal: SelfWalkProposal, requestId: string): DomainSnapshot;
  currentEpisode?(): ReturnType<SessionTaskStore['selfWalk']['getCurrentEpisode']>;
}>;

export type W01ProductBindingIdentity = Readonly<{
  ownerAccess?: unknown;
  ownerLease?: unknown;
  store: unknown;
  ref: TaskRef;
}>;
export type W01ProductBinding = Readonly<{
  identity: W01ProductBindingIdentity;
  port: W01ProductPort;
}>;
type W01SelfWalk = Pick<SessionTaskStore['selfWalk'],
  'getSnapshot' | 'reportContext' | 'propose' | 'accept' | 'start' | 'cancel' | 'stop'>
  & Partial<Pick<SessionTaskStore['selfWalk'], 'end' | 'getCurrentEpisode'>>;

/** Exact task-bound production binding shared by the product route and bounded verifier. */
export function createW01ProductionBinding(options: Readonly<{
  identity: W01ProductBindingIdentity;
  current(): boolean;
  selfWalk: W01SelfWalk;
}>): W01ProductBinding {
  const { current, selfWalk } = options;
  const ref = options.identity.ref;
  const identity = Object.freeze({ ...options.identity });
  const port: W01ProductPort = Object.freeze({
    current,
    snapshot: () => selfWalk.getSnapshot(),
    report: (facts, sourceRef) => selfWalk.reportContext(ref, facts, { source_ref: sourceRef }),
    propose: (requestId) => selfWalk.propose(ref, requestId),
    currentEpisode: () => current() && typeof selfWalk.end === 'function'
      && typeof selfWalk.getCurrentEpisode === 'function' ? selfWalk.getCurrentEpisode(ref) : undefined,
    act: (operation, proposal, requestId) => {
      if (operation === 'stop') return selfWalk.stop(ref, proposal, requestId);
      if (!current()) return { state: 'DENIED' };
      if (operation === 'accept') return selfWalk.accept(ref, proposal, requestId);
      if (operation === 'start') return selfWalk.start(ref, proposal, requestId);
      if (operation === 'end') return typeof selfWalk.end === 'function'
        && typeof selfWalk.getCurrentEpisode === 'function'
        ? selfWalk.end(ref, proposal, requestId) : { state: 'DENIED' };
      return operation === 'cancel' ? selfWalk.cancel(ref, proposal, requestId) : { state: 'DENIED' };
    },
  });
  return Object.freeze({ identity, port });
}

export type W01Presentation = Readonly<{
  state: string;
  question?: Readonly<{ id: W01QuestionId; options: readonly W01AnswerId[] }>;
  content?: SelfWalkProposal['content'];
  durationMinutes?: number;
  answer(id: W01AnswerId): boolean;
  globalSkip(): boolean;
  primaryAction?: Exclude<W01ProductOperation, 'cancel'>;
  canCancel: boolean;
  canEnd: boolean;
  endedByUser: boolean;
  act(operation: W01ProductOperation): boolean;
}>;

/** Exact question callback used by the production card; kept pure for bounded verification. */
export function answerW01ProductQuestion(view: W01Presentation, id: W01AnswerId): boolean {
  return view.answer(id);
}
/** Exact action callback used by the production card. */
export function actW01Product(view: W01Presentation, operation: W01ProductOperation): boolean {
  return view.act(operation);
}

const sequence: readonly W01QuestionId[] = ['walking_choice', 'concerns', 'professional_limits',
  'adult', 'mobility', 'setting', 'competing_activity', 'footwear', 'available_minutes',
  'requested_minutes'];
const options: Record<W01QuestionId, readonly W01AnswerId[]> = {
  walking_choice: ['yes', 'decline', 'not_sure', 'skip'],
  concerns: ['none', 'pain', 'dizzy', 'breathless', 'unresolved', 'urgent', 'not_sure', 'skip'],
  professional_limits: ['none', 'restricted', 'not_sure', 'skip'],
  adult: ['adult', 'not_adult', 'not_sure', 'skip'],
  mobility: ['independent', 'needs_support', 'not_sure', 'skip'],
  setting: ['supported', 'unsupported', 'not_sure', 'skip'],
  competing_activity: ['none_competing', 'hazardous', 'not_sure', 'skip'],
  footwear: ['suitable', 'unsuitable', 'not_sure', 'skip'],
  available_minutes: ['1', '2', '3', '4', '5', 'not_sure', 'skip'],
  requested_minutes: ['1', '2', '3', '4', '5', 'not_sure', 'skip'],
};
const terminal = new Set(['URGENT_HELP', 'SAFETY_HOLD', 'NO_ACTION', 'UNSUPPORTED',
  'SOURCE_BLOCKED', 'CANCELLED', 'STOPPED', 'INVALIDATED', 'UNAVAILABLE', 'DENIED']);

function explicitFact(question: W01QuestionId, answer: W01AnswerId, available?: number): Record<string, string | number> | undefined {
  if (answer === 'not_sure' || answer === 'skip') return undefined;
  if (question === 'walking_choice') return answer === 'yes'
    ? { intent: 'SHORT_LIGHT_MOVEMENT', walking_choice: 'WANTS_WALK' }
    : answer === 'decline' ? { walking_choice: 'DECLINED' } : undefined;
  const values: Partial<Record<W01QuestionId, Record<string, string>>> = {
    concerns: { none: 'NONE_REPORTED', pain: 'PAIN', dizzy: 'DIZZY', breathless: 'UNUSUAL_BREATHLESSNESS', unresolved: 'UNRESOLVED', urgent: 'URGENT' },
    professional_limits: { none: 'NONE_REPORTED', restricted: 'REPORTED' },
    adult: { adult: 'REPORTED_ADULT', not_adult: 'NOT_ADULT' },
    mobility: { independent: 'INDEPENDENT_COMFORTABLE_WALKING', needs_support: 'NEEDS_SUPPORT' },
    setting: { supported: 'INDOOR_FLAT_CLEAR_LIT_DRY_STOPPABLE', unsupported: 'UNSUITABLE' },
    competing_activity: { none_competing: 'NONE', hazardous: 'HAZARDOUS' },
    footwear: { suitable: 'FAMILIAR_SECURE', unsuitable: 'UNSUITABLE' },
  };
  if (question === 'available_minutes' || question === 'requested_minutes') {
    const value = Number(answer);
    if (!Number.isInteger(value) || value < 1 || value > 5
      || question === 'requested_minutes' && (!available || value > available)) return undefined;
    return { [question]: value };
  }
  const value = values[question]?.[answer];
  return value ? { [question]: value } : undefined;
}

/** Locale-neutral, RAM-only presentation seam. Domain results remain the sole classifier. */
export function createW01ProductController(options: Readonly<{ onChange(): void }>) {
  let binding: W01ProductBinding | undefined;
  let facts: Record<string, string | number> = {};
  let index = 0;
  let dismissed = false;
  let sequenceNumber = 0;
  let generation = 0;
  let proposal: SelfWalkProposal | undefined;
  let startedProposal: SelfWalkProposal | undefined;
  let lastResult: DomainSnapshot | undefined;
  let issued = 0;
  const notify = () => { issued++; try { options.onChange(); } catch { /* observers do not grant action authority */ } };
  const clearInteraction = () => {
    facts = {}; index = 0; dismissed = false; sequenceNumber = 0;
    proposal = undefined; startedProposal = undefined; lastResult = undefined;
  };
  const sameIdentity = (left?: W01ProductBindingIdentity, right?: W01ProductBindingIdentity) =>
    left === right || Boolean(left && right && left.ownerAccess === right.ownerAccess
      && left.ownerLease === right.ownerLease && left.store === right.store
      && left.ref.session_id === right.ref.session_id && left.ref.task_id === right.ref.task_id
      && left.ref.revision === right.ref.revision && left.ref.view_revision === right.ref.view_revision);
  const bind = (next: W01ProductBinding | undefined) => {
    if (sameIdentity(binding?.identity, next?.identity)) {
      binding = next;
      return;
    }
    clearInteraction(); binding = next; generation++; issued++;
  };
  const presentation = (): W01Presentation => {
    const token = issued;
    const port = binding?.port;
    const storedSnapshot = port?.snapshot() ?? { state: 'UNAVAILABLE' };
    const scope = storedSnapshot.scope;
    const ref = binding?.identity.ref;
    // A newly accepted task may coexist with the previous task's retained Stop.
    // Only a CURRENT new binding begins new questions; stale bindings retain Stop.
    const domainSnapshot = scope && ref && port?.current()
      && (scope.session_id !== ref.session_id || scope.task_id !== ref.task_id
        || scope.revision !== ref.revision || scope.view_revision !== ref.view_revision)
      ? { state: 'IDLE' } : storedSnapshot;
    const snapshot = domainSnapshot.state === 'IDLE' && lastResult ? lastResult : domainSnapshot;
    const state = dismissed ? 'DISMISSED' : snapshot.state;
    const question = !dismissed && !terminal.has(state) && !['PROPOSED', 'ACCEPTED', 'STARTED'].includes(state)
      ? sequence[index] : undefined;
    const primaryAction = state === 'PROPOSED' && proposal ? 'accept'
      : state === 'ACCEPTED' && proposal ? 'start'
        : ['STARTED', 'INVALIDATED'].includes(state) && startedProposal ? 'stop' : undefined;
    const canCancel = Boolean(proposal && ['PROPOSED', 'ACCEPTED'].includes(state));
    const episode = port?.currentEpisode?.();
    const endedByUser = Boolean(episode?.end);
    const canEnd = Boolean(startedProposal && episode && !episode.end
      && episode.action.proposal_revision === startedProposal.proposal_revision
      && ['STARTED', 'STOPPED'].includes(state));
    const current = (operation?: string) => token === issued && !dismissed && !!port
      && port === binding?.port && (operation === 'stop' || port.current());
    return Object.freeze({
      state, content: snapshot.content, durationMinutes: snapshot.content ? snapshot.duration_minutes : undefined, primaryAction, canCancel, canEnd, endedByUser,
      ...(question ? { question: Object.freeze({ id: question, options: optionsFor(question, facts) }) } : {}),
      answer(answer: W01AnswerId) {
        if (!question || !current() || !optionsFor(question, facts).includes(answer)) return false;
        if (answer === 'not_sure' || answer === 'skip') {
          lastResult = { state: 'NEED_CONTEXT', clarify: question };
          notify(); return true;
        }
        const fact = explicitFact(question, answer, Number(facts.available_minutes) || undefined);
        if (!fact) return false;
        facts = { ...facts, ...fact };
        const source = `w01-product-${generation}-report-${++sequenceNumber}`;
        if (!port!.report(facts, source)) return false;
        // Available time is reported independently; do not let the domain's
        // legacy bounded fallback stand in for an explicit requested duration.
        const result = question === 'available_minutes'
          ? { state: 'NEED_CONTEXT', clarify: 'requested_minutes' }
          : port!.propose(`w01-product-${generation}-propose-${sequenceNumber}`);
        lastResult = result;
        if (result.state === 'PROPOSED') proposal = result as SelfWalkProposal;
        else if (!terminal.has(result.state) && index < sequence.length - 1) index++;
        notify(); return true;
      },
      globalSkip() {
        if (!current()) return false;
        dismissed = true; notify(); return true;
      },
      act(operation: W01ProductOperation) {
        if (!current(operation)) return false;
        if (operation === 'end' ? !canEnd : operation === 'cancel' ? !canCancel : operation !== primaryAction) return false;
        const p = operation === 'stop' || operation === 'end' ? startedProposal : proposal;
        if (!p) return false;
        const actionGeneration = generation;
        const result = port!.act(operation, p,
          `w01-product-${generation}-${operation}-${++sequenceNumber}`);
        lastResult = result;
        if (result.state === 'STARTED') startedProposal = p;
        const end = operation === 'end' ? port!.currentEpisode?.()?.end : undefined;
        notify();
        if (operation === 'end') return result.state === 'STOPPED' && !!end
          && generation === actionGeneration && port === binding?.port && port!.current()
          && port!.currentEpisode?.()?.end === end;
        return result.state !== 'DENIED';
      },
    });
  };
  return Object.freeze({ bind, presentation, retire() {
    clearInteraction(); binding = undefined; dismissed = true; generation++; notify();
  } });
}

function optionsFor(question: W01QuestionId, facts: Record<string, string | number>) {
  if (question !== 'requested_minutes') return options[question];
  const available = Number(facts.available_minutes);
  return options[question].filter((id) => !/^\d$/u.test(id) || Number(id) <= available);
}
