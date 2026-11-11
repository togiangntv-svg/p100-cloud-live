export type InteractionRole = 'user' | 'assistant';
export type UnderstandingSource = 'user_statement' | 'user_correction' | 'ai_inference';
export type AiAvailability = 'not_connected' | 'ready' | 'active' | 'offline' | 'quota_exhausted';
export type AiConsent = 'not_asked' | 'declined' | 'granted';

export type InteractionMessage = {
  id: string;
  role: InteractionRole;
  text: string;
  createdAt: string;
  requestId: string | null;
  provenance: 'DEMO_LOCAL' | 'AI_EXTERNAL';
};

export type UnderstandingEntry = {
  id: string;
  text: string;
  source: UnderstandingSource;
  createdAt: string;
  permission: 'local_only' | 'external_ai_allowed';
  revokedAt: string | null;
};

export type UserGoal = {
  text: string;
  action: string;
  createdAt: string;
  authoredBy: 'user';
};

export type PendingAiRequest = {
  requestId: string;
  sequence: number;
  createdAt: string;
  expiresAt: string;
};

export type InteractionState = {
  version: 1;
  messages: InteractionMessage[];
  understandings: UnderstandingEntry[];
  goal: UserGoal | null;
  aiConsent: AiConsent;
  aiConsentUpdatedAt: string | null;
  aiContextConsentAt: string | null;
  aiEverGrantedAt: string | null;
  aiAvailability: AiAvailability;
  latestRequestSequence: number;
  pendingRequest: PendingAiRequest | null;
  updatedAt: string;
};

export type AiSendingStatus = 'never_enabled' | 'enabled' | 'stopped';

export type InteractionHydration =
  | { kind: 'empty'; state: InteractionState }
  | { kind: 'ok'; state: InteractionState }
  | { kind: 'deleted'; state: InteractionState }
  | { kind: 'unreadable'; state: InteractionState };

export const INTERACTION_STORAGE_KEY = '@100-human-development-interaction';
export const INTERACTION_DELETION_KEY = '@100-human-development-interaction-deleted-at';
const PROVENANCE = 'DEMO_LOCAL' as const;
const SCHEMA_VERSION = 1 as const;
const MAX_MESSAGES = 80;
const MAX_UNDERSTANDINGS = 30;

function nowIso(): string {
  return new Date().toISOString();
}

export function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createInitialInteractionState(at = nowIso()): InteractionState {
  return {
    version: SCHEMA_VERSION,
    messages: [],
    understandings: [],
    goal: null,
    aiConsent: 'not_asked',
    aiConsentUpdatedAt: null,
    aiContextConsentAt: null,
    aiEverGrantedAt: null,
    aiAvailability: 'not_connected',
    latestRequestSequence: 0,
    pendingRequest: null,
    updatedAt: at,
  };
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isShortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

function isNullableShortString(value: unknown, max: number): value is string | null {
  return value === null || isShortString(value, max);
}

function isInteractionMessage(value: unknown): value is InteractionMessage {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return isShortString(item.id, 100)
    && (item.role === 'user' || item.role === 'assistant')
    && isShortString(item.text, 4000)
    && isIsoDate(item.createdAt)
    && isNullableShortString(item.requestId, 100)
    && (item.provenance === 'DEMO_LOCAL' || item.provenance === 'AI_EXTERNAL');
}

function isUnderstanding(value: unknown): value is UnderstandingEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return isShortString(item.id, 100)
    && isShortString(item.text, 1000)
    && ['user_statement', 'user_correction', 'ai_inference'].includes(String(item.source))
    && isIsoDate(item.createdAt)
    && ['local_only', 'external_ai_allowed'].includes(String(item.permission))
    && (item.revokedAt === null || isIsoDate(item.revokedAt));
}

export function isInteractionStateValid(value: unknown): value is InteractionState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  const goal = state.goal as Record<string, unknown> | null;
  const pending = state.pendingRequest as Record<string, unknown> | null;
  const goalValid = goal === null || (
    typeof goal === 'object'
    && isShortString(goal.text, 1000)
    && isShortString(goal.action, 1000)
    && isIsoDate(goal.createdAt)
    && goal.authoredBy === 'user'
  );
  const pendingValid = pending === null || (
    typeof pending === 'object'
    && isShortString(pending.requestId, 100)
    && Number.isInteger(pending.sequence)
    && isIsoDate(pending.createdAt)
    && isIsoDate(pending.expiresAt)
  );
  return state.version === SCHEMA_VERSION
    && Array.isArray(state.messages)
    && state.messages.length <= MAX_MESSAGES
    && state.messages.every(isInteractionMessage)
    && Array.isArray(state.understandings)
    && state.understandings.length <= MAX_UNDERSTANDINGS
    && state.understandings.every(isUnderstanding)
    && goalValid
    && ['not_asked', 'declined', 'granted'].includes(String(state.aiConsent))
    && (state.aiConsentUpdatedAt === null || isIsoDate(state.aiConsentUpdatedAt))
    && (state.aiContextConsentAt === undefined
      || state.aiContextConsentAt === null
      || isIsoDate(state.aiContextConsentAt))
    && (state.aiEverGrantedAt === undefined
      || state.aiEverGrantedAt === null
      || isIsoDate(state.aiEverGrantedAt))
    && ['not_connected', 'ready', 'active', 'offline', 'quota_exhausted'].includes(String(state.aiAvailability))
    && Number.isInteger(state.latestRequestSequence)
    && Number(state.latestRequestSequence) >= 0
    && pendingValid
    && isIsoDate(state.updatedAt);
}

export function hydrateInteraction(raw: string | null, deletedAt: string | null): InteractionHydration {
  const initial = createInitialInteractionState();
  if (!raw) return { kind: deletedAt ? 'deleted' : 'empty', state: initial };
  try {
    const envelope = JSON.parse(raw) as Record<string, unknown>;
    if (envelope.schemaVersion !== SCHEMA_VERSION || envelope.provenance !== PROVENANCE || !isInteractionStateValid(envelope.state)) {
      return { kind: 'unreadable', state: initial };
    }
    const storedState = envelope.state;
    const contextConsentAt = storedState.aiContextConsentAt ?? null;
    const everGrantedAt = storedState.aiEverGrantedAt
      ?? contextConsentAt
      ?? storedState.messages.find((message) => message.provenance === 'AI_EXTERNAL')?.createdAt
      ?? null;
    const state: InteractionState = {
      ...storedState,
      aiConsent: storedState.aiConsent === 'granted' && !contextConsentAt
        ? 'declined'
        : storedState.aiConsent,
      aiContextConsentAt: contextConsentAt,
      aiEverGrantedAt: everGrantedAt,
    };
    if (deletedAt && Date.parse(deletedAt) >= Date.parse(state.updatedAt)) {
      return { kind: 'deleted', state: initial };
    }
    return { kind: 'ok', state };
  } catch {
    return { kind: 'unreadable', state: initial };
  }
}

export function serializeInteraction(state: InteractionState): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, provenance: PROVENANCE, state });
}

export function appendUserMessage(state: InteractionState, text: string, at = nowIso()): InteractionState {
  const trimmed = text.trim();
  if (!trimmed) return state;
  const message: InteractionMessage = {
    id: createLocalId('user'),
    role: 'user',
    text: trimmed.slice(0, 2000),
    createdAt: at,
    requestId: null,
    provenance: PROVENANCE,
  };
  const understanding: UnderstandingEntry = {
    id: createLocalId('statement'),
    text: trimmed.slice(0, 1000),
    source: 'user_statement',
    createdAt: at,
    permission: 'local_only',
    revokedAt: null,
  };
  return {
    ...state,
    messages: [...state.messages, message].slice(-MAX_MESSAGES),
    understandings: [...state.understandings, understanding].slice(-MAX_UNDERSTANDINGS),
    pendingRequest: null,
    latestRequestSequence: state.latestRequestSequence + 1,
    updatedAt: at,
  };
}

export function setUserGoal(state: InteractionState, text: string, action: string, at = nowIso()): InteractionState {
  const goal = text.trim();
  const step = action.trim();
  if (!goal || !step) return state;
  return {
    ...state,
    goal: { text: goal.slice(0, 1000), action: step.slice(0, 1000), createdAt: at, authoredBy: 'user' },
    pendingRequest: null,
    latestRequestSequence: state.latestRequestSequence + 1,
    updatedAt: at,
  };
}

export function correctUnderstanding(state: InteractionState, text: string, at = nowIso()): InteractionState {
  const corrected = text.trim();
  if (!corrected) return state;
  const correction: UnderstandingEntry = {
    id: createLocalId('correction'),
    text: corrected.slice(0, 1000),
    source: 'user_correction',
    createdAt: at,
    permission: 'local_only',
    revokedAt: null,
  };
  return {
    ...state,
    understandings: [
      ...state.understandings.map((item) => (
        item.source === 'ai_inference' && item.revokedAt === null ? { ...item, revokedAt: at } : item
      )),
      correction,
    ].slice(-MAX_UNDERSTANDINGS),
    pendingRequest: null,
    latestRequestSequence: state.latestRequestSequence + 1,
    updatedAt: at,
  };
}

export function updateAiConsent(state: InteractionState, consent: Exclude<AiConsent, 'not_asked'>, at = nowIso()): InteractionState {
  return {
    ...state,
    aiConsent: consent,
    aiConsentUpdatedAt: at,
    aiContextConsentAt: consent === 'declined' ? null : state.aiContextConsentAt,
    aiEverGrantedAt: consent === 'granted' ? (state.aiEverGrantedAt ?? at) : state.aiEverGrantedAt,
    pendingRequest: null,
    latestRequestSequence: state.latestRequestSequence + 1,
    updatedAt: at,
  };
}

export function getAiSendingStatus(state: InteractionState): AiSendingStatus {
  if (state.aiConsent === 'granted') return 'enabled';
  if (state.aiEverGrantedAt || state.messages.some((message) => message.provenance === 'AI_EXTERNAL')) {
    return 'stopped';
  }
  return 'never_enabled';
}

export function grantAiContextConsent(state: InteractionState, at = nowIso()): InteractionState {
  return {
    ...updateAiConsent(state, 'granted', at),
    aiContextConsentAt: at,
  };
}

export type AiConversationMessage = {
  role: InteractionRole;
  content: string;
};

const MAX_PRIOR_AI_MESSAGES = 2;

export function buildAiConversationWindow(
  state: InteractionState,
  currentText: string,
): AiConversationMessage[] {
  const current: AiConversationMessage = {
    role: 'user',
    content: currentText.trim().slice(0, 2000),
  };
  if (state.aiConsent !== 'granted' || !state.aiContextConsentAt) return [current];

  const consentAt = Date.parse(state.aiContextConsentAt);
  const prior = state.messages
    .filter((message) => Date.parse(message.createdAt) >= consentAt)
    .slice(-MAX_PRIOR_AI_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.text,
    }));

  return [...prior, current];
}

export function setAiAvailability(state: InteractionState, availability: AiAvailability, at = nowIso()): InteractionState {
  return { ...state, aiAvailability: availability, updatedAt: at };
}

export function beginAiRequest(
  state: InteractionState,
  text: string,
  requestId: string,
  createdAt: string,
  expiresAt: string,
): { state: InteractionState; sequence: number } {
  const withMessage = appendUserMessage(state, text, createdAt);
  if (withMessage === state || withMessage.aiConsent !== 'granted') {
    return { state: withMessage, sequence: withMessage.latestRequestSequence };
  }
  const sequence = withMessage.latestRequestSequence;
  return {
    sequence,
    state: {
      ...withMessage,
      aiAvailability: 'ready',
      pendingRequest: { requestId, sequence, createdAt, expiresAt },
    },
  };
}

export function rejectAiRequest(
  state: InteractionState,
  requestId: string,
  sequence: number,
  availability: Extract<AiAvailability, 'offline' | 'quota_exhausted'>,
  at = nowIso(),
): InteractionState {
  if (!state.pendingRequest
    || state.pendingRequest.requestId !== requestId
    || state.pendingRequest.sequence !== sequence) {
    return state;
  }
  return {
    ...state,
    pendingRequest: null,
    aiAvailability: availability,
    updatedAt: at,
  };
}

export function applyAiResponse(
  state: InteractionState,
  requestId: string,
  sequence: number,
  text: string,
  at = nowIso(),
): InteractionState {
  if (!state.pendingRequest
    || state.pendingRequest.requestId !== requestId
    || state.pendingRequest.sequence !== sequence
    || Date.parse(state.pendingRequest.expiresAt) < Date.parse(at)
    || state.aiConsent !== 'granted') {
    return state;
  }
  const message: InteractionMessage = {
    id: createLocalId('assistant'),
    role: 'assistant',
    text: text.trim().slice(0, 4000),
    createdAt: at,
    requestId,
    provenance: 'AI_EXTERNAL',
  };
  return {
    ...state,
    messages: [...state.messages, message].slice(-MAX_MESSAGES),
    pendingRequest: null,
    aiAvailability: 'active',
    updatedAt: at,
  };
}