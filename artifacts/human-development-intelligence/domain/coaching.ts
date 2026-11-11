export type DomainPath = 'work' | 'movement' | 'relationships' | 'creativity' | 'learning' | 'joy' | 'other';
export type WorkContext = 'job_seeking' | 'selling' | 'no_task_today' | 'overloaded' | 'ineffective';
export type MovementContext = 'no_plan' | 'busy' | 'physical_limitation';
export type RelContext = 'children' | 'parents' | 'friends' | 'colleagues' | 'partner' | 'unspecified';
export type PathSource = 'inferred' | 'chosen';
export type CompletionKind = 'creative' | 'standard' | 'stopped';

export type CoachingStatus = 
  | 'idle'
  | 'correction' 
  | 'domain_select'
  | 'subdomain_select'
  | 'creative_detail'
  | 'creative_interpretation'
  | 'creative_direction'
  | 'creative_feedback'
  | 'creative_practice'
  | 'creative_return'
  | 'next_training'
  | 'standard_reflection'
  | 'standard_practice'
  | 'standard_return'
  | 'paused'
  | 'completed';

export type CoachingState = {
  version: number;
  status: CoachingStatus;
  pausedFrom: CoachingStatus | null;
  
  freeformStory: string;
  userCorrection: string;
  
  path: DomainPath | null;
  pathSource: PathSource | null;
  workContext: WorkContext | null;
  movementContext: MovementContext | null;
  relContext: RelContext | null;

  creativeDetail: string;
  creativeInterpretation: string;
  creativeDirection: string;
  creativePractice: string;
  creativeReturnMaterial: string;
  creativeNextTraining: string;
  creativeDidNotDoIt: boolean;
  isExampleRequested: boolean;
  lowSupport: boolean;
  
  standardPractice: string;
  standardReturnMaterial: string;
  standardDidNotDoIt: boolean;
  completionKind: CompletionKind | null;
};

export const COACHING_STORAGE_KEY = '@100-human-development-coaching';
const PROVENANCE = 'DEMO_LOCAL' as const;
const SCHEMA_VERSION = 3;

export const initialCoachingState: CoachingState = {
  version: SCHEMA_VERSION,
  status: 'idle',
  pausedFrom: null,
  freeformStory: '',
  userCorrection: '',
  path: null,
  pathSource: null,
  workContext: null,
  movementContext: null,
  relContext: null,
  creativeDetail: '',
  creativeInterpretation: '',
  creativeDirection: '',
  creativePractice: '',
  creativeReturnMaterial: '',
  creativeNextTraining: '',
  creativeDidNotDoIt: false,
  isExampleRequested: false,
  lowSupport: false,
  standardPractice: '',
  standardReturnMaterial: '',
  standardDidNotDoIt: false,
  completionKind: null,
};

export function analyzeStory(story: string): { inferredPath: DomainPath | null, inferredContext: string | null } {
  const lower = story.toLowerCase();
  
  if (lower.includes('buồn') && lower.includes('con')) {
    return { inferredPath: 'relationships', inferredContext: 'children' };
  }
  if (lower.includes('thất nghiệp') || lower.includes('tìm việc')) {
    return { inferredPath: 'work', inferredContext: 'job_seeking' };
  }
  if (lower.includes('khách') || lower.includes('bán')) {
    return { inferredPath: 'work', inferredContext: 'selling' };
  }
  if (lower.includes('không có việc hôm nay') || lower.includes('chưa có việc cụ thể')) {
    return { inferredPath: 'work', inferredContext: 'no_task_today' };
  }
  if (lower.includes('đau') || lower.includes('mệt') || lower.includes('yếu') || lower.includes('thể chất')) {
    return { inferredPath: 'movement', inferredContext: 'physical_limitation' };
  }
  const movementWords = lower.includes('tập') || lower.includes('vận động') || lower.includes('thể dục') || lower.includes('đi bộ');
  if (movementWords && (lower.includes('chưa có kế hoạch') || lower.includes('không có kế hoạch'))) {
    return { inferredPath: 'movement', inferredContext: 'no_plan' };
  }
  if (movementWords && lower.includes('bận')) {
    return { inferredPath: 'movement', inferredContext: 'busy' };
  }
  if (lower.includes('quá nhiều việc') || lower.includes('quá tải') || lower.includes('bận công việc')) {
    return { inferredPath: 'work', inferredContext: 'overloaded' };
  }
  if (lower.includes('không hiệu quả') || lower.includes('chưa hiệu quả')) {
    return { inferredPath: 'work', inferredContext: 'ineffective' };
  }
  if (lower.includes('sáng tạo') || lower.includes('ý tưởng') || lower.includes('viết') || lower.includes('vẽ')) {
    return { inferredPath: 'creativity', inferredContext: null };
  }
  if (lower.includes('vui')) {
    return { inferredPath: 'joy', inferredContext: null };
  }
  if (lower.includes('học') || lower.includes('mới') || lower.includes('tò mò')) {
    return { inferredPath: 'learning', inferredContext: null };
  }
  
  return { inferredPath: null, inferredContext: null };
}

export function getCreativeFeedback(detail: string, interpretation: string, direction: string) {
  return {
    observation: detail,
    meaning: interpretation,
    direction: direction,
  };
}

function stringField(value: unknown, max = 500): boolean {
  return typeof value === 'string' && value.length <= max;
}

export function isCoachingStateValid(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const envelope = obj as Record<string, unknown>;
  if (envelope.schemaVersion !== SCHEMA_VERSION || envelope.provenance !== PROVENANCE) return false;
  
  const statuses: CoachingStatus[] = [
    'idle', 'correction', 'domain_select', 'subdomain_select', 
    'creative_detail', 'creative_interpretation', 'creative_direction', 
    'creative_feedback', 'creative_practice', 'creative_return', 'next_training', 
    'standard_reflection', 'standard_practice', 'standard_return', 'paused', 'completed'
  ];
  
  const state = envelope.state;
  if (!state || typeof state !== 'object') return false;
  const value = state as Record<string, unknown>;
  const paths: Array<DomainPath | null> = ['work', 'movement', 'relationships', 'creativity', 'learning', 'joy', 'other', null];
  const work: Array<WorkContext | null> = ['job_seeking', 'selling', 'no_task_today', 'overloaded', 'ineffective', null];
  const movement: Array<MovementContext | null> = ['no_plan', 'busy', 'physical_limitation', null];
  const relationships: Array<RelContext | null> = ['children', 'parents', 'friends', 'colleagues', 'partner', 'unspecified', null];
  const paused: Array<CoachingStatus | null> = [...statuses, null];
  const sources: Array<PathSource | null> = ['inferred', 'chosen', null];
  const completions: Array<CompletionKind | null> = ['creative', 'standard', 'stopped', null];
  const strings = [
    value.freeformStory, value.userCorrection, value.creativeDetail, value.creativeInterpretation,
    value.creativeDirection, value.creativePractice, value.creativeReturnMaterial,
    value.creativeNextTraining, value.standardPractice, value.standardReturnMaterial,
  ];
  return value.version === SCHEMA_VERSION
    && statuses.includes(value.status as CoachingStatus)
    && paused.includes(value.pausedFrom as CoachingStatus | null)
    && paths.includes(value.path as DomainPath | null)
    && sources.includes(value.pathSource as PathSource | null)
    && work.includes(value.workContext as WorkContext | null)
    && movement.includes(value.movementContext as MovementContext | null)
    && relationships.includes(value.relContext as RelContext | null)
    && completions.includes(value.completionKind as CompletionKind | null)
    && typeof value.creativeDidNotDoIt === 'boolean'
    && typeof value.isExampleRequested === 'boolean'
    && typeof value.lowSupport === 'boolean'
    && typeof value.standardDidNotDoIt === 'boolean'
    && strings.every((item) => stringField(item));
}

export function hydrateCoaching(raw: string | null): CoachingState {
  if (!raw) return initialCoachingState;
  try {
    const parsed = JSON.parse(raw);
    if (!isCoachingStateValid(parsed)) {
      return initialCoachingState;
    }
    return { ...initialCoachingState, ...parsed.state };
  } catch {
    return initialCoachingState;
  }
}

export function inspectCoaching(raw: string | null): {
  kind: 'empty' | 'ok' | 'unreadable';
  state: CoachingState;
} {
  if (raw === null) return { kind: 'empty', state: initialCoachingState };
  try {
    const parsed = JSON.parse(raw);
    if (!isCoachingStateValid(parsed)) {
      return { kind: 'unreadable', state: initialCoachingState };
    }
    return { kind: 'ok', state: { ...initialCoachingState, ...parsed.state } };
  } catch {
    return { kind: 'unreadable', state: initialCoachingState };
  }
}

export function serializeCoaching(state: CoachingState): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, provenance: PROVENANCE, state });
}

// Pure domain transitions for rigorous verification
export function transitionStartStory(state: CoachingState, story: string): CoachingState {
  if (!story.trim()) return state;
  const { inferredPath, inferredContext } = analyzeStory(story);
  return {
    ...state,
    freeformStory: story,
    path: inferredPath,
    pathSource: inferredPath ? 'inferred' : null,
    workContext: inferredPath === 'work' ? inferredContext as WorkContext : null,
    movementContext: inferredPath === 'movement' ? inferredContext as MovementContext : null,
    relContext: inferredPath === 'relationships' ? inferredContext as RelContext : null,
    status: inferredPath ? 'correction' : 'domain_select'
  };
}

export function transitionAcceptCorrection(state: CoachingState): CoachingState {
  if (state.path === 'creativity') return { ...state, status: 'creative_detail' };
  if (state.path === 'learning' || state.path === 'joy' || state.path === 'other') return { ...state, status: 'standard_reflection' };
  if (state.path === 'work' && state.workContext) return { ...state, status: 'standard_reflection' };
  if (state.path === 'movement' && state.movementContext) return { ...state, status: 'standard_reflection' };
  if (state.path === 'relationships' && state.relContext) return { ...state, status: 'standard_reflection' };
  return { ...state, status: 'subdomain_select' };
}

export function transitionSelectPath(state: CoachingState, path: DomainPath): CoachingState {
  const next = {
    ...state,
    path,
    pathSource: 'chosen' as const,
    workContext: null,
    movementContext: null,
    relContext: null,
  };
  if (path === 'creativity') return { ...next, status: 'creative_detail' };
  if (path === 'learning' || path === 'joy' || path === 'other') return { ...next, status: 'standard_reflection' };
  return { ...next, status: 'subdomain_select' };
}

export function transitionSelectWorkContext(state: CoachingState, context: WorkContext): CoachingState {
  return { ...state, path: 'work', workContext: context, status: 'standard_reflection' };
}

export function transitionSelectMovementContext(state: CoachingState, context: MovementContext): CoachingState {
  return { ...state, path: 'movement', movementContext: context, status: 'standard_reflection' };
}

export function transitionSelectRelContext(state: CoachingState, context: RelContext): CoachingState {
  return { ...state, path: 'relationships', relContext: context, status: 'standard_reflection' };
}

export function transitionCreativeDetail(state: CoachingState, detail: string): CoachingState {
  return detail.trim() ? { ...state, creativeDetail: detail.trim(), status: 'creative_interpretation' } : state;
}

export function transitionCreativeInterpretation(state: CoachingState, interpretation: string): CoachingState {
  return interpretation.trim() ? { ...state, creativeInterpretation: interpretation.trim(), status: 'creative_direction' } : state;
}

export function transitionCreativeDirection(state: CoachingState, direction: string): CoachingState {
  return direction.trim() ? { ...state, creativeDirection: direction.trim(), status: 'creative_feedback' } : state;
}

export function transitionCreativePractice(state: CoachingState, practice: string): CoachingState {
  return practice.trim() ? { ...state, creativePractice: practice.trim(), status: 'creative_practice' } : state;
}

export function transitionCreativeReturn(state: CoachingState, material: string, didNotDoIt: boolean): CoachingState {
  return {
    ...state,
    creativeReturnMaterial: didNotDoIt ? '' : material.trim(),
    creativeDidNotDoIt: didNotDoIt,
    status: 'next_training',
  };
}

export function transitionCreativeNext(state: CoachingState, training: string): CoachingState {
  return training.trim()
    ? { ...state, creativeNextTraining: training.trim(), status: 'completed', completionKind: 'creative' }
    : state;
}

export function transitionStandardPractice(state: CoachingState, practice: string): CoachingState {
  return practice.trim() ? { ...state, standardPractice: practice.trim(), status: 'standard_practice' } : state;
}

export function transitionStandardReturn(state: CoachingState, material: string, didNotDoIt: boolean): CoachingState {
  return {
    ...state,
    standardReturnMaterial: didNotDoIt ? '' : material.trim(),
    standardDidNotDoIt: didNotDoIt,
    status: 'completed',
    completionKind: 'standard',
  };
}

export function transitionChangeDirection(state: CoachingState): CoachingState {
  return {
    ...initialCoachingState,
    freeformStory: state.freeformStory,
    userCorrection: state.userCorrection,
    status: 'domain_select',
  };
}

export function transitionPause(state: CoachingState): CoachingState {
  if (state.status === 'paused' || state.status === 'idle' || state.status === 'completed') return state;
  return { ...state, status: 'paused', pausedFrom: state.status };
}

export function transitionResume(state: CoachingState): CoachingState {
  if (state.status !== 'paused') return state;
  return { ...state, status: state.pausedFrom || 'idle', pausedFrom: null };
}

export function transitionStop(state: CoachingState): CoachingState {
  return { ...state, status: 'completed', completionKind: 'stopped' };
}
