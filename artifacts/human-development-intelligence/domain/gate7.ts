export type TodayMode = 'recommendation' | 'silence';
export type ClaimStatus = 'none' | 'active' | 'contested' | 'retracted';
export type Tradeoff = 'depth' | 'recovery' | 'connection';
export type DependentClaimStatus = 'clear' | 'review_required';

export type Recommendation = {
  id: string;
  kind: 'recommendation';
  text: string;
  provenance: 'DEMO_LOCAL';
};

export type UserDecision = {
  id: string;
  kind: 'user_decision';
  choice: Tradeoff;
  authoredBy: 'user';
  unaidedCheckpointRequired: boolean;
};

export type UserAction = {
  id: string;
  kind: 'user_action';
  status: 'pending' | 'completed';
  initiatedBy: 'user';
};

export type DecisionBundle = {
  id: string;
  provenance: 'DEMO_LOCAL';
  goal: { id: string; text: string };
  relevantContext: {
    sources: Array<'goal' | 'self_report' | 'local_episode' | 'calendar_demo'>;
    calendarRevoked: boolean;
  };
  understanding: {
    kind: 'inference';
    text: string;
    contestable: true;
    correctedByUser: boolean;
    provenance: 'system_inference' | 'user_correction';
    highStakesCategory: 'medical' | 'legal' | null;
  };
  recommendation: Recommendation | null;
  silenceReason: 'manual' | 'insufficient_relevance' | 'high_stakes' | 'persistence_unavailable' | null;
  userDecision: UserDecision;
  userAction: UserAction;
  dependentClaimStatus: DependentClaimStatus;
};

export type AppState = {
  todayMode: TodayMode;
  relevanceSufficient: boolean;
  calendarConnected: boolean;
  calendarRevokedAt: number | null;
  inferenceCorrection: string | null;
  selectedTradeoff: Tradeoff;
  loadReduced: boolean;
  actionCompleted: boolean;
  outcomeRecorded: boolean;
  reviewNote: string;
  episodes: number;
  learningVersion: number;
  claimStatus: ClaimStatus;
  dependentClaimStatus: DependentClaimStatus;
  validationRun: boolean;
  validationLog: Record<string, boolean>;
};

export type Gate7Action =
  | { type: 'SET_MODE'; mode: TodayMode }
  | { type: 'SET_RELEVANCE'; sufficient: boolean }
  | { type: 'CORRECT_INFERENCE'; value: string }
  | { type: 'REVOKE_CALENDAR'; at: number }
  | { type: 'CHOOSE_TRADEOFF'; value: Tradeoff }
  | { type: 'REDUCE_LOAD' }
  | { type: 'RECOVER_LOAD' }
  | { type: 'COMPLETE_ACTION' }
  | { type: 'RECORD_OUTCOME'; note: string }
  | { type: 'START_NEW_CYCLE' }
  | { type: 'ADD_POSITIVE_EPISODE' }
  | { type: 'CONTEST_CLAIM' }
  | { type: 'RETRACT_CLAIM' }
  | { type: 'SET_VALIDATION'; log: Record<string, boolean> };

export type FaultId =
  | 'DROP_LOCAL_CONTEXT'
  | 'FORCE_SEND_WITHOUT_RELEVANCE'
  | 'MISLABEL_INFERENCE_AS_FACT'
  | 'IGNORE_CORRECTION'
  | 'IGNORE_REVOCATION'
  | 'OVERRIDE_USER_DECISION'
  | 'IGNORE_REDUCE_LOAD'
  | 'PROMOTE_SINGLE_EPISODE'
  | 'SKIP_VERSIONED_LEARNING'
  | 'LOCK_LEARNING_CLAIM'
  | 'COLLAPSE_RECOMMENDATION_DECISION_ACTION'
  | 'SKIP_UNAIDED_CHECKPOINT'
  | 'SKIP_HIGH_STAKES_ROUTE'
  | 'ALLOW_DIAGNOSIS'
  | 'ENABLE_A4_A5'
  | 'MARK_REAL_DATA'
  | 'DROP_PERSISTED_REVOCATION';

export type AcceptanceResult = {
  id: string;
  title: string;
  blocking: boolean;
  pass: boolean;
  detail: string;
};

export type FaultDetectionResult = {
  testId: string;
  fault: FaultId;
  detected: boolean;
};

export const STORAGE_KEY = '@100-human-development-state';
export const CORE_AUTONOMY_LEVELS = ['A0', 'A1', 'A2', 'A3'] as const;
export const DEMO_PROVENANCE = 'DEMO_LOCAL' as const;
export const MAX_CORRECTION_LENGTH = 500;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const STATE_KEYS = [
  'todayMode', 'relevanceSufficient', 'calendarConnected', 'calendarRevokedAt',
  'inferenceCorrection', 'selectedTradeoff', 'loadReduced', 'actionCompleted',
  'outcomeRecorded', 'reviewNote', 'episodes', 'learningVersion', 'claimStatus',
  'dependentClaimStatus', 'validationRun', 'validationLog',
] as const;

export const initialState: AppState = {
  todayMode: 'recommendation',
  relevanceSufficient: true,
  calendarConnected: true,
  calendarRevokedAt: null,
  inferenceCorrection: null,
  selectedTradeoff: 'depth',
  loadReduced: false,
  actionCompleted: false,
  outcomeRecorded: false,
  reviewNote: '',
  episodes: 0,
  learningVersion: 0,
  claimStatus: 'none',
  dependentClaimStatus: 'clear',
  validationRun: false,
  validationLog: {},
};

export const failClosedState: AppState = {
  ...initialState,
  todayMode: 'silence',
  relevanceSufficient: false,
  calendarConnected: false,
  calendarRevokedAt: 0,
  dependentClaimStatus: 'review_required',
};

function isSafeText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength && !CONTROL_CHARACTERS.test(value);
}

export function classifyHighStakesText(value: string): 'medical' | 'legal' | null {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('vi');
  const medical = /\b(chẩn đoán|bệnh|thuốc|liều|tự tử|tự hại|cấp cứu|medical|diagnos|medication|suicide|self[- ]?harm)\b/u;
  const legal = /\b(pháp lý|luật sư|khởi kiện|hợp đồng|tòa án|legal|lawyer|lawsuit|court)\b/u;
  if (medical.test(normalized)) return 'medical';
  if (legal.test(normalized)) return 'legal';
  return null;
}

export function reduceGate7State(state: AppState, action: Gate7Action, fault?: FaultId): AppState {
  switch (action.type) {
    case 'SET_MODE':
      return { ...state, todayMode: action.mode };
    case 'SET_RELEVANCE':
      return { ...state, relevanceSufficient: action.sufficient };
    case 'CORRECT_INFERENCE':
      if (fault === 'IGNORE_CORRECTION') return state;
      if (!isSafeText(action.value, MAX_CORRECTION_LENGTH)) return state;
      return { ...state, inferenceCorrection: action.value.normalize('NFC'), actionCompleted: false };
    case 'REVOKE_CALENDAR':
      if (fault === 'IGNORE_REVOCATION') return state;
      return {
        ...state,
        calendarConnected: false,
        calendarRevokedAt: action.at,
        dependentClaimStatus: 'review_required',
      };
    case 'CHOOSE_TRADEOFF':
      return {
        ...state,
        selectedTradeoff: fault === 'OVERRIDE_USER_DECISION' ? 'depth' : action.value,
      };
    case 'REDUCE_LOAD':
      if (fault === 'IGNORE_REDUCE_LOAD') return state;
      return { ...state, loadReduced: true, todayMode: 'silence' };
    case 'RECOVER_LOAD':
      return { ...state, loadReduced: false, todayMode: 'recommendation' };
    case 'COMPLETE_ACTION':
      return { ...state, actionCompleted: true };
    case 'RECORD_OUTCOME':
      return { ...state, outcomeRecorded: true, reviewNote: action.note };
    case 'START_NEW_CYCLE':
      return {
        ...state,
        todayMode: 'recommendation',
        relevanceSufficient: true,
        loadReduced: false,
        actionCompleted: false,
        outcomeRecorded: false,
        reviewNote: '',
      };
    case 'ADD_POSITIVE_EPISODE': {
      const episodes = state.episodes + 1;
      const supported = fault === 'PROMOTE_SINGLE_EPISODE' ? episodes >= 1 : episodes >= 3;
      const versioned = fault !== 'SKIP_VERSIONED_LEARNING';
      return {
        ...state,
        episodes,
        learningVersion: supported && versioned ? state.learningVersion + 1 : state.learningVersion,
        claimStatus: supported && versioned ? 'active' : 'none',
      };
    }
    case 'CONTEST_CLAIM':
      return fault === 'LOCK_LEARNING_CLAIM' ? state : { ...state, claimStatus: 'contested' };
    case 'RETRACT_CLAIM':
      return fault === 'LOCK_LEARNING_CLAIM' ? state : { ...state, claimStatus: 'retracted' };
    case 'SET_VALIDATION':
      return { ...state, validationRun: true, validationLog: action.log };
  }
}

export function buildDecisionBundle(state: AppState, fault?: FaultId): DecisionBundle {
  const sources: DecisionBundle['relevantContext']['sources'] =
    fault === 'DROP_LOCAL_CONTEXT'
      ? []
      : ['goal', 'self_report', 'local_episode'];

  if (state.calendarConnected || fault === 'IGNORE_REVOCATION') {
    sources.push('calendar_demo');
  }

  const corrected = Boolean(state.inferenceCorrection);
  const highStakesCategory = state.inferenceCorrection
    ? classifyHighStakesText(state.inferenceCorrection)
    : null;
  const highStakesRoute = highStakesCategory ? routeHighStakes(highStakesCategory, fault) : null;
  const understandingText =
    fault === 'IGNORE_CORRECTION'
      ? 'Bạn có thể cần một khoảng tập trung ngắn'
      : state.inferenceCorrection ?? 'Bạn có thể cần một khoảng tập trung ngắn';
  const shouldSilence =
    state.todayMode === 'silence' ||
    (!state.relevanceSufficient && fault !== 'FORCE_SEND_WITHOUT_RELEVANCE') ||
    highStakesRoute?.route === 'M8/A6';
  const recommendationText = corrected && fault !== 'IGNORE_CORRECTION'
    ? 'Thử 15 phút cho việc nhỏ nhất, không cần đạt “deep work”.'
    : state.selectedTradeoff === 'recovery'
      ? 'Giữ lại một khoảng hồi phục trước khi nhận thêm việc.'
      : state.selectedTradeoff === 'connection'
        ? 'Chủ động dành một khoảng kết nối trước khi quay lại công việc.'
        : 'Dành 25 phút cho việc quan trọng nhất, rồi dừng để kiểm tra lại.';

  const recommendation: Recommendation | null = shouldSilence ? null : {
    id: 'rec-current',
    kind: 'recommendation',
    text: recommendationText,
    provenance: fault === 'MARK_REAL_DATA' ? ('REAL' as Recommendation['provenance']) : DEMO_PROVENANCE,
  };
  const userDecision: UserDecision = {
    id: 'decision-current',
    kind: 'user_decision',
    choice: state.selectedTradeoff,
    authoredBy: 'user',
    unaidedCheckpointRequired: fault !== 'SKIP_UNAIDED_CHECKPOINT',
  };
  const userAction: UserAction = {
    id: 'action-current',
    kind: 'user_action',
    status: state.actionCompleted ? 'completed' : 'pending',
    initiatedBy: 'user',
  };

  if (fault === 'COLLAPSE_RECOMMENDATION_DECISION_ACTION' && recommendation) {
    userDecision.id = recommendation.id;
    userAction.id = recommendation.id;
  }

  return {
    id: 'bundle-current',
    provenance: fault === 'MARK_REAL_DATA' ? ('REAL' as DecisionBundle['provenance']) : DEMO_PROVENANCE,
    goal: { id: 'goal-depth', text: 'Giữ nhịp làm việc sâu' },
    relevantContext: {
      sources,
      calendarRevoked: !state.calendarConnected,
    },
    understanding: {
      kind: fault === 'MISLABEL_INFERENCE_AS_FACT' ? ('fact' as 'inference') : 'inference',
      text: understandingText,
      contestable: true,
      correctedByUser: corrected,
      provenance: corrected ? 'user_correction' : 'system_inference',
      highStakesCategory,
    },
    recommendation,
    silenceReason: shouldSilence
      ? highStakesRoute?.route === 'M8/A6'
        ? 'high_stakes'
        : state.todayMode === 'silence' ? 'manual' : 'insufficient_relevance'
      : null,
    userDecision,
    userAction,
    dependentClaimStatus: state.dependentClaimStatus,
  };
}

export function routeHighStakes(
  category: 'medical' | 'legal',
  fault?: FaultId,
): { route: 'M8/A6' | 'NONE'; diagnosis: boolean; decidesForUser: boolean } {
  return {
    route: fault === 'SKIP_HIGH_STAKES_ROUTE' ? 'NONE' : 'M8/A6',
    diagnosis: fault === 'ALLOW_DIAGNOSIS',
    decidesForUser: fault === 'ALLOW_DIAGNOSIS',
  };
}

export function serializeState(state: AppState, fault?: FaultId): string {
  const value = fault === 'DROP_PERSISTED_REVOCATION'
    ? { ...state, calendarConnected: true, calendarRevokedAt: null, dependentClaimStatus: 'clear' as const }
    : state;
  return JSON.stringify({ schemaVersion: 1, provenance: DEMO_PROVENANCE, state: value });
}

export function hydrateState(raw: string | null): AppState {
  if (!raw) return initialState;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed) || !hasExactKeys(parsed, ['schemaVersion', 'provenance', 'state'])) return failClosedState;
    if (parsed.schemaVersion !== 1 || parsed.provenance !== DEMO_PROVENANCE || !isValidPersistedState(parsed.state)) {
      return failClosedState;
    }
    return { ...parsed.state, validationRun: false, validationLog: {} };
  } catch {
    return failClosedState;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function isValidPersistedState(value: unknown): value is AppState {
  if (!isPlainRecord(value) || !hasExactKeys(value, STATE_KEYS)) return false;
  const enumValue = <T extends string>(candidate: unknown, values: readonly T[]): candidate is T =>
    typeof candidate === 'string' && values.includes(candidate as T);
  const valid =
    enumValue(value.todayMode, ['recommendation', 'silence']) &&
    typeof value.relevanceSufficient === 'boolean' &&
    typeof value.calendarConnected === 'boolean' &&
    (value.calendarRevokedAt === null || (Number.isSafeInteger(value.calendarRevokedAt) && (value.calendarRevokedAt as number) >= 0)) &&
    (value.inferenceCorrection === null || isSafeText(value.inferenceCorrection, MAX_CORRECTION_LENGTH)) &&
    enumValue(value.selectedTradeoff, ['depth', 'recovery', 'connection']) &&
    typeof value.loadReduced === 'boolean' &&
    typeof value.actionCompleted === 'boolean' &&
    typeof value.outcomeRecorded === 'boolean' &&
    isSafeText(value.reviewNote, 1000) &&
    Number.isSafeInteger(value.episodes) && (value.episodes as number) >= 0 &&
    Number.isSafeInteger(value.learningVersion) && (value.learningVersion as number) >= 0 &&
    enumValue(value.claimStatus, ['none', 'active', 'contested', 'retracted']) &&
    enumValue(value.dependentClaimStatus, ['clear', 'review_required']) &&
    typeof value.validationRun === 'boolean' &&
    isPlainRecord(value.validationLog) &&
    Object.values(value.validationLog).every((entry) => typeof entry === 'boolean');
  if (!valid) return false;
  if (value.calendarConnected) {
    if (value.calendarRevokedAt !== null || value.dependentClaimStatus !== 'clear') return false;
  } else if (value.calendarRevokedAt === null || value.dependentClaimStatus !== 'review_required') {
    return false;
  }
  if (value.loadReduced && value.todayMode !== 'silence') return false;
  return true;
}

type Evaluation = {
  id: string;
  title: string;
  fault: FaultId;
  detail: string;
  evaluate: (fault?: FaultId) => boolean;
};

function createEvaluations(): Evaluation[] {
  return [
    {
      id: 'R1',
      title: 'Không connector vẫn tạo relevant context local',
      fault: 'DROP_LOCAL_CONTEXT',
      detail: 'Goal, self-report và local episode vẫn tạo Decision Bundle.',
      evaluate: (fault) => buildDecisionBundle({ ...initialState, calendarConnected: false }, fault).relevantContext.sources.length >= 3,
    },
    {
      id: 'R2',
      title: 'SEND / SILENCE tuân theo relevance',
      fault: 'FORCE_SEND_WITHOUT_RELEVANCE',
      detail: 'Thiếu relevance phải trả Silence, không gửi recommendation.',
      evaluate: (fault) => {
        const bundle = buildDecisionBundle({ ...initialState, relevanceSufficient: false }, fault);
        return bundle.recommendation === null && bundle.silenceReason === 'insufficient_relevance';
      },
    },
    {
      id: 'R3',
      title: 'Fact và inference được tách nhãn',
      fault: 'MISLABEL_INFERENCE_AS_FACT',
      detail: 'Understanding phải là inference có thể contest.',
      evaluate: (fault) => {
        const understanding = buildDecisionBundle(initialState, fault).understanding;
        return understanding.kind === 'inference' && understanding.contestable;
      },
    },
    {
      id: 'R4',
      title: 'Correction đổi recommendation tương lai',
      fault: 'IGNORE_CORRECTION',
      detail: 'Correction phải đổi understanding và recommendation được build sau đó.',
      evaluate: (fault) => {
        const before = buildDecisionBundle(initialState).recommendation?.text;
        const correctedState = reduceGate7State(initialState, { type: 'CORRECT_INFERENCE', value: 'Tôi cần bắt đầu nhỏ hơn' }, fault);
        const after = buildDecisionBundle(correctedState, fault);
        return after.understanding.correctedByUser && after.recommendation?.text !== before;
      },
    },
    {
      id: 'R5',
      title: 'Calendar revocation đổi future Decision Bundle',
      fault: 'IGNORE_REVOCATION',
      detail: 'Calendar phải biến mất và claim phụ thuộc phải được flag review.',
      evaluate: (fault) => {
        const revoked = reduceGate7State(initialState, { type: 'REVOKE_CALENDAR', at: 1000 }, fault);
        const bundle = buildDecisionBundle(revoked, fault);
        return !bundle.relevantContext.sources.includes('calendar_demo') && bundle.dependentClaimStatus === 'review_required';
      },
    },
    {
      id: 'R6',
      title: 'Whole-Human conflict giữ user authorship',
      fault: 'OVERRIDE_USER_DECISION',
      detail: 'Lựa chọn recovery của người dùng không bị recommendation ghi đè.',
      evaluate: (fault) => {
        const chosen = reduceGate7State(initialState, { type: 'CHOOSE_TRADEOFF', value: 'recovery' }, fault);
        return buildDecisionBundle(chosen).userDecision.choice === 'recovery';
      },
    },
    {
      id: 'R7',
      title: 'Overload có Reduce Load và Recover',
      fault: 'IGNORE_REDUCE_LOAD',
      detail: 'Reduce Load tạo Silence; Recover phục hồi recommendation.',
      evaluate: (fault) => {
        const reduced = reduceGate7State(initialState, { type: 'REDUCE_LOAD' }, fault);
        const recovered = reduceGate7State(reduced, { type: 'RECOVER_LOAD' }, fault);
        return reduced.loadReduced && reduced.todayMode === 'silence' && !recovered.loadReduced && recovered.todayMode === 'recommendation';
      },
    },
    {
      id: 'R8',
      title: 'Một positive episode không tạo durable truth',
      fault: 'PROMOTE_SINGLE_EPISODE',
      detail: 'Một episode chỉ là tín hiệu, claim vẫn none và version vẫn 0.',
      evaluate: (fault) => {
        const once = reduceGate7State(initialState, { type: 'ADD_POSITIVE_EPISODE' }, fault);
        return once.episodes === 1 && once.claimStatus === 'none' && once.learningVersion === 0;
      },
    },
    {
      id: 'R9',
      title: 'Repeated support mới tạo versioned learning',
      fault: 'SKIP_VERSIONED_LEARNING',
      detail: 'Đủ ba episode mới tạo active claim có version.',
      evaluate: (fault) => {
        let state = initialState;
        for (let i = 0; i < 3; i += 1) state = reduceGate7State(state, { type: 'ADD_POSITIVE_EPISODE' }, fault);
        return state.episodes === 3 && state.claimStatus === 'active' && state.learningVersion === 1;
      },
    },
    {
      id: 'R10',
      title: 'Learning claim contestable và retractable',
      fault: 'LOCK_LEARNING_CLAIM',
      detail: 'Active claim phải chuyển được sang contested và retracted.',
      evaluate: (fault) => {
        const active = { ...initialState, episodes: 3, learningVersion: 1, claimStatus: 'active' as const };
        const contested = reduceGate7State(active, { type: 'CONTEST_CLAIM' }, fault);
        const retracted = reduceGate7State(active, { type: 'RETRACT_CLAIM' }, fault);
        return contested.claimStatus === 'contested' && retracted.claimStatus === 'retracted';
      },
    },
    {
      id: 'A1',
      title: 'Recommendation, decision và action là object tách biệt',
      fault: 'COLLAPSE_RECOMMENDATION_DECISION_ACTION',
      detail: 'Ba object có kind và identity riêng.',
      evaluate: (fault) => {
        const bundle = buildDecisionBundle(initialState, fault);
        const recommendation = bundle.recommendation;
        return Boolean(recommendation)
          && recommendation?.id !== bundle.userDecision.id
          && recommendation?.id !== bundle.userAction.id
          && bundle.userDecision.id !== bundle.userAction.id
          && recommendation?.kind === 'recommendation'
          && bundle.userDecision.kind === 'user_decision'
          && bundle.userAction.kind === 'user_action';
      },
    },
    {
      id: 'A2',
      title: 'Anti-dependency unaided checkpoint là bắt buộc',
      fault: 'SKIP_UNAIDED_CHECKPOINT',
      detail: 'Decision giữ cờ unaided checkpoint và user authorship.',
      evaluate: (fault) => {
        const decision = buildDecisionBundle(initialState, fault).userDecision;
        return decision.unaidedCheckpointRequired === true && decision.authoredBy === 'user';
      },
    },
    {
      id: 'A3',
      title: 'High-stakes route M8/A6',
      fault: 'SKIP_HIGH_STAKES_ROUTE',
      detail: 'Medical/legal luôn chuyển M8/A6.',
      evaluate: (fault) => routeHighStakes('medical', fault).route === 'M8/A6' && routeHighStakes('legal', fault).route === 'M8/A6',
    },
    {
      id: 'A4',
      title: 'Không chẩn đoán hoặc quyết định thay chuyên gia',
      fault: 'ALLOW_DIAGNOSIS',
      detail: 'High-stakes route không chẩn đoán và không quyết định thay.',
      evaluate: (fault) => {
        const route = routeHighStakes('medical', fault);
        return !route.diagnosis && !route.decidesForUser;
      },
    },
    {
      id: 'A5',
      title: 'Autonomy chỉ có A0–A3, không A4/A5',
      fault: 'ENABLE_A4_A5',
      detail: 'Core autonomy levels không chứa A4/A5.',
      evaluate: (fault) => {
        const levels: readonly string[] = fault === 'ENABLE_A4_A5'
          ? [...CORE_AUTONOMY_LEVELS, 'A4', 'A5']
          : CORE_AUTONOMY_LEVELS;
        return !levels.includes('A4') && !levels.includes('A5');
      },
    },
    {
      id: 'A6',
      title: 'Tất cả dữ liệu là DEMO/LOCAL',
      fault: 'MARK_REAL_DATA',
      detail: 'Decision Bundle và recommendation đều có provenance DEMO_LOCAL.',
      evaluate: (fault) => {
        const bundle = buildDecisionBundle(initialState, fault);
        return bundle.provenance === DEMO_PROVENANCE && bundle.recommendation?.provenance === DEMO_PROVENANCE;
      },
    },
    {
      id: 'A7',
      title: 'State quan trọng tồn tại đúng lifecycle',
      fault: 'DROP_PERSISTED_REVOCATION',
      detail: 'Correction, revocation, decision và claim status sống qua hydrate; validation log là session-only.',
      evaluate: (fault) => {
        const changed: AppState = {
          ...initialState,
          calendarConnected: false,
          calendarRevokedAt: 1000,
          dependentClaimStatus: 'review_required',
          inferenceCorrection: 'Tôi cần bắt đầu nhỏ hơn',
          selectedTradeoff: 'recovery',
          episodes: 3,
          learningVersion: 1,
          claimStatus: 'contested',
          validationRun: true,
          validationLog: { R1: true },
        };
        const hydrated = hydrateState(serializeState(changed, fault));
        return !hydrated.calendarConnected
          && hydrated.calendarRevokedAt === 1000
          && hydrated.dependentClaimStatus === 'review_required'
          && hydrated.inferenceCorrection === changed.inferenceCorrection
          && hydrated.selectedTradeoff === 'recovery'
          && hydrated.claimStatus === 'contested'
          && !hydrated.validationRun
          && Object.keys(hydrated.validationLog).length === 0;
      },
    },
  ];
}

export const validationTests = createEvaluations().map(({ id, title }) => ({ id, title }));

export function runAcceptanceSuite(): {
  results: AcceptanceResult[];
  faultDetection: FaultDetectionResult[];
  passCandidate: boolean;
} {
  const evaluations = createEvaluations();
  const results = evaluations.map<AcceptanceResult>((test) => ({
    id: test.id,
    title: test.title,
    blocking: true,
    pass: test.evaluate(),
    detail: test.detail,
  }));
  const faultDetection = evaluations.map<FaultDetectionResult>((test) => ({
    testId: test.id,
    fault: test.fault,
    detected: test.evaluate() && !test.evaluate(test.fault),
  }));
  const passCandidate = results.every((result) => result.pass)
    && faultDetection.every((result) => result.detected);
  return { results, faultDetection, passCandidate };
}