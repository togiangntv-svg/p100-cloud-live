import type { M3LanguageAdapter } from './m3/resolver';
import type { M4StubFixture } from './m4/ui-stub';

// M2 presentation contract, not a persisted profile or a production classifier.
// A caller must supply verified facts; missing storage never proves a new person.
export type M2Action = 'continue_workout' | 'adjust_workout' | 'pause_workout'
  | 'end_workout' | 'continue_plan' | 'change_context' | 'review_week' | 'later';
export type M2Evidence = {
  subjectId: string;
  source: 'local_record' | 'user_confirmed' | 'fixture';
  observedAt: number;
  freshness: 'current' | 'stale' | 'conflicted' | 'unknown';
  validUntil?: number; // Only a policy already approved by the host may set this.
};
export type M2Snapshot = {
  revision: string;
  subject: { id: string; loading: 'ready' | 'loading' | 'error' | 'deleted'; profile: 'new' | 'existing' | 'unknown' };
  permission: { status: 'allowed' | 'denied' | 'unknown'; revision: string };
  safety: 'clear' | 'hold' | 'unknown';
  goal: 'none' | 'confirmed' | 'unknown';
  explicitIntent: boolean;
  activeTask: { kind: 'none' | 'unknown' | 'other' } | {
    kind: 'reported_action';
    id: string;
    subjectId: string;
    episode: string;
    phase: 'started' | 'ended_by_user';
  } | {
    kind: 'workout';
    id: string;
    exercise: { id: string; label: string };
    completedSetIds: readonly string[];
    evidence: M2Evidence;
  };
  returning: { kind: 'none' | 'unknown' } | {
    kind: 'after_absence';
    plan: { id: string; title: string } | null;
    evidence: M2Evidence;
  };
};
export type M2Copy = {
  question: string; placeholder: string;
  goals: readonly [string, string, string, string];
  resume: string; returnWithPlan: string;
  actions: Readonly<Record<M2Action, string>>;
  failed: string;
};
export type M2Note = {
  id: string;
  label: string;
  icon: 'heart-pulse' | 'human-handsup' | 'dumbbell' | 'run'
    | 'play' | 'tune' | 'pause' | 'stop' | 'calendar' | 'clock-outline';
  action?: M2Action;
};
export type M2View = {
  kind: 'goal' | 'workout' | 'returning' | 'reported_action';
  phase?: 'started' | 'ended_by_user';
  subjectId: string;
  token: string;
  question: string;
  placeholder: string;
  context: string | null;
  notes: readonly M2Note[];
};
export type M2Executors = Partial<Record<M2Action, () => void | Promise<void>>>;
export type M3Access = Readonly<{
  status: 'allowed' | 'denied' | 'unknown';
  revision: number;
}>;
export type M2Gateway = {
  snapshot: M2Snapshot;
  executors?: M2Executors;
  // Separate, RAM-only external-language permission. Never infer this from
  // the M2 presentation permission or a feature flag.
  m3Access?: M3Access;
  // A fixture adapter is supplied only by the host for stub-only acceptance.
  // Runtime composition remains controlled by the explicit M3 mode; external
  // networking additionally requires the independent M3 access grant.
  m3StubAdapter?: M3LanguageAdapter;
  // RAM-only host projection for deterministic M4 acceptance. Never image data.
  m4StubFixture?: M4StubFixture;
  setM3Access?: (allowed: boolean) => void;
};

function current(e: M2Evidence, s: M2Snapshot, now: number): boolean {
  return e.subjectId === s.subject.id
    && ['local_record', 'user_confirmed', 'fixture'].includes(e.source)
    && e.freshness === 'current'
    && Number.isFinite(e.observedAt) && e.observedAt <= now
    && (e.validUntil === undefined || (Number.isFinite(e.validUntil) && now < e.validUntil));
}

export function resolveM2View(
  s: M2Snapshot | undefined,
  copy: M2Copy | null,
  available: readonly M2Action[],
  now: number,
): M2View | null {
  if (!s || !copy || !Number.isFinite(now) || !s.revision || !s.subject.id
    || s.subject.loading !== 'ready' || s.permission.status !== 'allowed'
    || !s.permission.revision || s.safety !== 'clear') return null;
  const base = {
    subjectId: s.subject.id,
    token: JSON.stringify([s, copy, [...available].sort()]),
    placeholder: copy.placeholder,
  };
  const actionNote = (action: M2Action, icon: M2Note['icon']): M2Note[] =>
    available.includes(action) ? [{ id: action, action, label: copy.actions[action], icon }] : [];
  if (s.activeTask.kind === 'reported_action') {
    const task = s.activeTask;
    if (!task.id || !task.episode || task.subjectId !== s.subject.id
      || !['started', 'ended_by_user'].includes(task.phase)) return null;
    // The current owned host supplies this fact; W01 owns its words and actions.
    // Never turn this intent into workout sets, measured completion, or M7 purpose.
    return { ...base, kind: 'reported_action', phase: task.phase,
      question: '', context: null, notes: [] };
  }
  if (s.activeTask.kind === 'workout') {
    const task = s.activeTask;
    if (!task.id || !task.exercise.id || !task.exercise.label.trim()
      || !current(task.evidence, s, now)
      || !task.completedSetIds.every((id) => typeof id === 'string' && id.length > 0)
      || new Set(task.completedSetIds).size !== task.completedSetIds.length) return null;
    return { ...base, kind: 'workout', question: copy.resume,
      context: task.exercise.label, notes: [
        ...actionNote('continue_workout', 'play'), ...actionNote('adjust_workout', 'tune'),
        ...actionNote('pause_workout', 'pause'), ...actionNote('end_workout', 'stop'),
      ] };
  }
  // An unhandled intent belongs to M3/router after a verified current task.
  if (s.explicitIntent) return null;
  // Never disguise a stale, unsupported, or unknown active task as onboarding.
  if (s.activeTask.kind !== 'none') return null;
  if (s.returning.kind === 'after_absence') {
    if (!current(s.returning.evidence, s, now)) return null;
    const plan = s.returning.plan;
    if (!plan || !plan.id || !plan.title.trim()) return null;
    return { ...base, kind: 'returning',
      question: copy.returnWithPlan,
      context: null, notes: [
        ...actionNote('continue_plan', 'play'),
        ...actionNote('change_context', 'tune'),
        ...actionNote('review_week', 'calendar'), ...actionNote('later', 'clock-outline'),
      ] };
  }
  if (s.returning.kind !== 'none' || s.subject.profile !== 'new' || s.goal !== 'none') return null;
  const icons = ['heart-pulse', 'human-handsup', 'dumbbell', 'run'] as const;
  return { ...base, kind: 'goal', question: copy.question, context: null,
    notes: copy.goals.map((label, i) => ({ id: 'expression-' + i, label, icon: icons[i] })) };
}

export function availableM2Actions(executors: M2Executors | undefined): M2Action[] {
  return Object.keys(executors ?? {}).filter(
    (key) => typeof executors?.[key as M2Action] === 'function',
  ) as M2Action[];
}

export function isM2NoteCurrent(view: M2View, latest: M2View | null, note: M2Note): boolean {
  return latest !== null && view.token === latest.token
    && latest.notes.some((item) => item.id === note.id
      && item.label === note.label && item.action === note.action);
}

// Exactly-once within one rendered context. The executor must preserve its own
// transaction/idempotency boundary; M2 never writes workout or goal state.
export function createM2ActionRunner() {
  const running = new Set<string>();
  const completed = new Set<string>();
  return async (
    view: M2View, note: M2Note,
    latest: () => { view: M2View | null; executors: M2Executors },
  ): Promise<'done' | 'stale' | 'duplicate' | 'unavailable' | 'failed'> => {
    const current = latest();
    if (!isM2NoteCurrent(view, current.view, note)) return 'stale';
    if (!note.action || typeof current.executors[note.action] !== 'function') return 'unavailable';
    const key = view.token + ':' + note.action;
    if (running.size > 0 || completed.has(key)) return 'duplicate';
    running.add(key);
    try {
      await current.executors[note.action]!();
      completed.add(key);
      return 'done';
    } catch {
      return 'failed';
    } finally {
      running.delete(key);
    }
  };
}
