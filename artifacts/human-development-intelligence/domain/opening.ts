export type FocusArea = 'work' | 'health' | 'worry' | 'other';
export type Need = 'stuck' | 'overloaded' | 'depleted' | 'ready' | 'unclear';
export type OpeningPath =
  | 'clarify'
  | 'small_start'
  | 'reduce'
  | 'protect'
  | 'rest'
  | 'gentle'
  | 'outdoor'
  | 'indoor'
  | 'name_worry'
  | 'self';
export type WeatherScenario = 'none' | 'heavy_rain_run' | 'high_uv_outdoor' | 'unavailable';
export type HealthResponse = 'well' | 'different' | 'not_sure';
export type ActionStatus = 'not_started' | 'done' | 'partly' | 'not_yet';
export type Usefulness = 'useful' | 'unclear' | 'not_fit';

export type OpeningStatus = 'new' | 'guided' | 'completed' | 'skipped';

export type OpeningState = {
  status: OpeningStatus;
  focusArea: FocusArea | null;
  need: Need | null;
  path: OpeningPath | null;
  weatherScenario: WeatherScenario;
  healthDemoHistory: boolean;
  healthResponse: HealthResponse | null;
  actionStatus: ActionStatus;
  usefulness: Usefulness | null;
};

export const OPENING_STORAGE_KEY = '@100-human-development-opening';
export const OPENING_GOAL_DRAFT_STORAGE_KEY = '@100-human-development-opening-goal-draft';
export const OPENING_GOAL_FLOW_STORAGE_KEY = '@100-human-development-opening-goal-flow';
export const OPENING_GOAL_FLOW_VALUE = 'goal';
const PROVENANCE = 'DEMO_LOCAL' as const;
const SCHEMA_VERSION = 1;

export const initialOpeningState: OpeningState = {
  status: 'new',
  focusArea: null,
  need: null,
  path: null,
  weatherScenario: 'none',
  healthDemoHistory: false,
  healthResponse: null,
  actionStatus: 'not_started',
  usefulness: null,
};

export function serializeOpening(state: OpeningState): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, provenance: PROVENANCE, state });
}

export function hydrateOpening(raw: string | null): OpeningState {
  if (!raw) return initialOpeningState;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.schemaVersion !== SCHEMA_VERSION || parsed.provenance !== PROVENANCE || !isOpeningState(parsed.state)) {
      return initialOpeningState;
    }
    return parsed.state;
  } catch {
    return initialOpeningState;
  }
}

export function shouldResumeOpeningGoal(flowValue: string | null, draftValue: string | null): boolean {
  return flowValue === OPENING_GOAL_FLOW_VALUE || Boolean(draftValue?.trim());
}

export function pathsFor(focusArea: FocusArea, need: Need): OpeningPath[] {
  if (focusArea === 'work') {
    if (need === 'stuck') return ['clarify', 'small_start', 'self'];
    if (need === 'overloaded') return ['reduce', 'protect', 'self'];
    return ['small_start', 'protect', 'self'];
  }
  if (focusArea === 'health') {
    if (need === 'depleted') return ['rest', 'gentle', 'self'];
    if (need === 'ready') return ['outdoor', 'indoor', 'self'];
    return ['rest', 'gentle', 'self'];
  }
  if (focusArea === 'worry') return ['name_worry', 'small_start', 'self'];
  return ['self'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOpeningState(value: unknown): value is OpeningState {
  if (!isRecord(value)) return false;
  const statuses: OpeningStatus[] = ['new', 'guided', 'completed', 'skipped'];
  const focusAreas: FocusArea[] = ['work', 'health', 'worry', 'other'];
  const needs: Need[] = ['stuck', 'overloaded', 'depleted', 'ready', 'unclear'];
  const paths: Array<OpeningPath | null> = ['clarify', 'small_start', 'reduce', 'protect', 'rest', 'gentle', 'outdoor', 'indoor', 'name_worry', 'self', null];
  const weather: WeatherScenario[] = ['none', 'heavy_rain_run', 'high_uv_outdoor', 'unavailable'];
  const responses: Array<HealthResponse | null> = ['well', 'different', 'not_sure', null];
  const actionStatuses: ActionStatus[] = ['not_started', 'done', 'partly', 'not_yet'];
  const usefulness: Array<Usefulness | null> = ['useful', 'unclear', 'not_fit', null];
  return statuses.includes(value.status as OpeningStatus)
    && (value.focusArea === null || focusAreas.includes(value.focusArea as FocusArea))
    && (value.need === null || needs.includes(value.need as Need))
    && paths.includes(value.path as OpeningPath | null)
    && weather.includes(value.weatherScenario as WeatherScenario)
    && typeof value.healthDemoHistory === 'boolean'
    && responses.includes(value.healthResponse as HealthResponse | null)
    && actionStatuses.includes(value.actionStatus as ActionStatus)
    && usefulness.includes(value.usefulness as Usefulness | null);
}

export function inspectOpening(raw: string | null): {
  kind: 'empty' | 'ok' | 'unreadable';
  state: OpeningState;
} {
  if (raw === null) return { kind: 'empty', state: initialOpeningState };
  if (raw.length === 0) return { kind: 'unreadable', state: initialOpeningState };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.schemaVersion !== SCHEMA_VERSION
      || parsed.provenance !== PROVENANCE || !isOpeningState(parsed.state)) {
      return { kind: 'unreadable', state: initialOpeningState };
    }
    return { kind: 'ok', state: parsed.state };
  } catch {
    return { kind: 'unreadable', state: initialOpeningState };
  }
}
