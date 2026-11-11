import type { CameraTaskScope } from './candidate.ts';
import type { CameraC1ContextRef } from './m4-context.ts';
import type { M4ContextInput } from '../m4/contract.ts';

export const MEAL_IMAGE_EXTERNAL_ANALYSIS = 'MEAL_IMAGE_EXTERNAL_ANALYSIS' as const;

type ImageBinding = Readonly<CameraTaskScope & {
  candidate_id: string;
  context_id: string;
}>;

type ConsentBinding = Readonly<ImageBinding & {
  c1_permission_revision: number;
}>;

export type MealExternalConsentReceipt = Readonly<ConsentBinding & {
  purpose: typeof MEAL_IMAGE_EXTERNAL_ANALYSIS;
  consent_revision: number;
  status: 'ALLOWED';
}>;

export type PreparedMealImage =
  | Readonly<ImageBinding & {
      state: 'LOCAL_ONLY';
    }>
  | Readonly<ImageBinding & {
      state: 'EXTERNAL_READY';
      prepared_image_id: string;
      readiness_basis: 'SYNTHETIC_TEST_FIXTURE';
    }>;

export type MealVisionRequest = Readonly<{
  scope: CameraTaskScope;
  context_id: string;
  candidate_id: string;
  consent: MealExternalConsentReceipt;
  prepared_image: PreparedMealImage;
  current_c1: M4ContextInput;
  purpose: 'meal_image_assessment';
  locale?: string;
}>;

export type VisibleMealContext = Readonly<{
  state: 'VISIBLE_MEAL_CONTEXT';
  visible_items: readonly string[];
  qualitative_observations: readonly string[];
  uncertainty: 'LOW' | 'MEDIUM' | 'HIGH';
  evidence_limitations: readonly string[];
}>;

export type NeedMoreInfo = Readonly<{
  state: 'NEED_MORE_INFO';
  reason: 'AMBIGUOUS_MIXED_MEAL' | 'LOW_QUALITY' | 'OCCLUDED' | 'MISSING_DETAIL';
  missing_detail_request: string;
}>;

export type MealVisionResult =
  | VisibleMealContext
  | NeedMoreInfo
  | Readonly<{ state: 'OUTSIDE_SCOPE'; reason: 'NON_MEAL_IMAGE' | 'UNSUPPORTED_REQUEST' }>
  | Readonly<{ state: 'UNSAFE'; reason: 'MEDICAL_OR_IDENTITY_INFERENCE' }>
  | Readonly<{
      state: 'INVALID_PROVIDER_OUTPUT';
      reason: 'MALFORMED_OUTPUT' | 'FORBIDDEN_PIXEL_ONLY_CLAIM';
    }>;

export type MealVisionBlocked = Readonly<{
  state: 'BLOCKED';
  reason:
    | 'INVALID_REQUEST'
    | 'STALE_SCOPE'
    | 'STALE_CONTEXT'
    | 'CONSENT_REQUIRED'
    | 'IMAGE_NOT_EXTERNAL_READY';
}>;

export type MealVisionOfflinePort = Readonly<{
  analyze(request: MealVisionRequest): unknown | Promise<unknown>;
}>;

const positiveRevision = (value: number): boolean => Number.isSafeInteger(value) && value > 0;
const nonEmpty = (value: unknown, max = 160): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasExactEnumerableKeys = (
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean => {
  const keys = Object.keys(value);
  return requiredKeys.every(key => keys.includes(key))
    && keys.every(key => requiredKeys.includes(key) || optionalKeys.includes(key));
};

const REQUEST_KEYS = Object.freeze([
  'scope', 'context_id', 'candidate_id', 'consent', 'prepared_image', 'current_c1', 'purpose',
]);
const REQUEST_OPTIONAL_KEYS = Object.freeze(['locale']);
const SCOPE_KEYS = Object.freeze(['session_id', 'task_id', 'revision']);
const CONSENT_KEYS = Object.freeze([
  ...SCOPE_KEYS, 'candidate_id', 'context_id', 'c1_permission_revision',
  'purpose', 'consent_revision', 'status',
]);
const LOCAL_ONLY_IMAGE_KEYS = Object.freeze([
  ...SCOPE_KEYS, 'candidate_id', 'context_id', 'state',
]);
const EXTERNAL_READY_IMAGE_KEYS = Object.freeze([
  ...LOCAL_ONLY_IMAGE_KEYS, 'prepared_image_id', 'readiness_basis',
]);
const CURRENT_C1_KEYS = Object.freeze(['scope', 'image', 'permission', 'boundary']);
const CURRENT_C1_PERMISSION_KEYS = Object.freeze(['purpose', 'status', 'revision']);
const CURRENT_C1_EMPTY_IMAGE_KEYS = Object.freeze(['state']);
const CURRENT_C1_PRESENT_IMAGE_KEYS = Object.freeze([
  'state', 'id', 'usable', 'permission_revision',
]);
const hasValidScopeFields = (value: unknown): value is CameraTaskScope => isRecord(value)
  && nonEmpty(value.session_id)
  && nonEmpty(value.task_id)
  && positiveRevision(value.revision as number);
const validScope = (value: unknown): value is CameraTaskScope => isRecord(value)
  && hasExactEnumerableKeys(value, SCOPE_KEYS)
  && hasValidScopeFields(value);
const sameScope = (a: CameraTaskScope, b: CameraTaskScope): boolean =>
  a.session_id === b.session_id && a.task_id === b.task_id && a.revision === b.revision;
const sameImageBinding = (a: ImageBinding, b: ImageBinding): boolean =>
  sameScope(a, b) && a.candidate_id === b.candidate_id && a.context_id === b.context_id;
const sameConsentBinding = (a: ConsentBinding, b: ConsentBinding): boolean =>
  sameImageBinding(a, b) && a.c1_permission_revision === b.c1_permission_revision;
const freezeScope = (scope: CameraTaskScope): CameraTaskScope => Object.freeze({
  session_id: scope.session_id,
  task_id: scope.task_id,
  revision: scope.revision,
});
const validImageBinding = (value: unknown): value is ImageBinding => isRecord(value)
  && nonEmpty(value.candidate_id)
  && nonEmpty(value.context_id)
  && hasValidScopeFields(value);
const validConsentBinding = (value: unknown): value is ConsentBinding => isRecord(value)
  && positiveRevision(value.c1_permission_revision as number)
  && validImageBinding(value);
const validConsentReceipt = (value: unknown): value is MealExternalConsentReceipt => {
  if (!isRecord(value)) return false;
  return hasExactEnumerableKeys(value, CONSENT_KEYS)
    && value.purpose === MEAL_IMAGE_EXTERNAL_ANALYSIS
    && value.status === 'ALLOWED'
    && positiveRevision(value.consent_revision as number)
    && validConsentBinding(value);
};
const validPreparedImage = (value: unknown): value is PreparedMealImage => {
  if (!isRecord(value)) return false;
  const stateValid = (value.state === 'LOCAL_ONLY'
      && hasExactEnumerableKeys(value, LOCAL_ONLY_IMAGE_KEYS))
    || (value.state === 'EXTERNAL_READY'
      && hasExactEnumerableKeys(value, EXTERNAL_READY_IMAGE_KEYS)
      && nonEmpty(value.prepared_image_id)
      && value.readiness_basis === 'SYNTHETIC_TEST_FIXTURE');
  return stateValid && validImageBinding(value);
};
const bindingFromContext = (context: CameraC1ContextRef): ConsentBinding => Object.freeze({
  ...freezeScope(context),
  candidate_id: context.candidate_id,
  context_id: context.context_id,
  c1_permission_revision: context.permission_revision,
});

const validCurrentC1Projection = (value: unknown): value is M4ContextInput => {
  if (!isRecord(value) || !validScope(value.scope)
    || !hasExactEnumerableKeys(value, CURRENT_C1_KEYS)
    || !isRecord(value.image) || !isRecord(value.permission)
    || !hasExactEnumerableKeys(value.permission, CURRENT_C1_PERMISSION_KEYS)) return false;
  const imageState = value.image.state;
  const imageShapeValid = ((imageState === 'absent' || imageState === 'declined')
      && hasExactEnumerableKeys(value.image, CURRENT_C1_EMPTY_IMAGE_KEYS))
    || (imageState === 'present'
      && hasExactEnumerableKeys(value.image, CURRENT_C1_PRESENT_IMAGE_KEYS)
      && nonEmpty(value.image.id)
      && typeof value.image.usable === 'boolean'
      && positiveRevision(value.image.permission_revision as number));
  return imageShapeValid
    && value.permission.purpose === 'meal_image_assessment'
    && ['allowed', 'denied', 'unknown'].includes(String(value.permission.status))
    && positiveRevision(value.permission.revision as number)
    && ['within_slice', 'professional_required'].includes(String(value.boundary));
};

/** Separate external-processing authority; C0/C1 choices never create this consent. */
export function createMealExternalConsentStore() {
  let active: ConsentBinding | undefined;
  let current: MealExternalConsentReceipt | undefined;
  let consentRevision = 0;

  const bind = (context: CameraC1ContextRef): boolean => {
    const next = bindingFromContext(context);
    if (!validConsentBinding(next)) return false;
    if (active && sameConsentBinding(active, next)) return true;
    active = next;
    current = undefined;
    return true;
  };

  return Object.freeze({
    bind,
    allow: (context: CameraC1ContextRef): MealExternalConsentReceipt | undefined => {
      const requested = bindingFromContext(context);
      if (!active || !sameConsentBinding(active, requested)) return undefined;
      current = Object.freeze({
        ...active,
        purpose: MEAL_IMAGE_EXTERNAL_ANALYSIS,
        consent_revision: ++consentRevision,
        status: 'ALLOWED' as const,
      });
      return current;
    },
    revoke: (receipt: MealExternalConsentReceipt): boolean => {
      if (!current || !sameConsentBinding(current, receipt)
        || current.consent_revision !== receipt.consent_revision
        || receipt.purpose !== MEAL_IMAGE_EXTERNAL_ANALYSIS) return false;
      current = undefined;
      consentRevision += 1;
      return true;
    },
    retire: () => {
      active = undefined;
      current = undefined;
      consentRevision += 1;
    },
    isCurrent: (receipt: MealExternalConsentReceipt): boolean => Boolean(
      active && current
      && receipt.status === 'ALLOWED'
      && receipt.purpose === MEAL_IMAGE_EXTERNAL_ANALYSIS
      && positiveRevision(receipt.consent_revision)
      && sameConsentBinding(active, receipt)
      && sameConsentBinding(current, receipt)
      && current.consent_revision === receipt.consent_revision,
    ),
    getCurrent: (): MealExternalConsentReceipt | undefined => current,
  });
}

export type MealExternalConsentStore = ReturnType<typeof createMealExternalConsentStore>;

const blocked = (reason: MealVisionBlocked['reason']): MealVisionBlocked =>
  Object.freeze({ state: 'BLOCKED', reason });

export function validateMealVisionRequest(
  request: unknown,
  consentStore: MealExternalConsentStore,
): Readonly<{ ok: true }> | Readonly<{ ok: false; result: MealVisionBlocked }> {
  if (!isRecord(request)
    || !hasExactEnumerableKeys(request, REQUEST_KEYS, REQUEST_OPTIONAL_KEYS)
    || !validScope(request.scope)
    || !nonEmpty(request.context_id)
    || !nonEmpty(request.candidate_id)
    || !validConsentReceipt(request.consent)
    || !validPreparedImage(request.prepared_image)
    || !validCurrentC1Projection(request.current_c1)
    || request.purpose !== 'meal_image_assessment'
    || ('locale' in request && !nonEmpty(request.locale))) {
    return Object.freeze({ ok: false, result: blocked('INVALID_REQUEST') });
  }
  if (!sameScope(request.scope, request.consent)
    || !sameScope(request.scope, request.prepared_image)
    || !sameScope(request.scope, request.current_c1.scope)) {
    return Object.freeze({ ok: false, result: blocked('STALE_SCOPE') });
  }
  const requestBinding = { ...request.scope, candidate_id: request.candidate_id, context_id: request.context_id };
  if (!sameImageBinding(requestBinding, request.consent)
    || !sameImageBinding(requestBinding, request.prepared_image)
    || request.current_c1.image.state !== 'present'
    || request.current_c1.image.id !== request.context_id) {
    return Object.freeze({ ok: false, result: blocked('STALE_CONTEXT') });
  }
  if (!request.current_c1.image.usable) {
    return Object.freeze({ ok: false, result: blocked('IMAGE_NOT_EXTERNAL_READY') });
  }
  if (request.current_c1.boundary !== 'within_slice') {
    return Object.freeze({ ok: false, result: blocked('INVALID_REQUEST') });
  }
  if (request.current_c1.permission.status !== 'allowed'
    || request.current_c1.permission.revision !== request.current_c1.image.permission_revision
    || request.current_c1.permission.revision !== request.consent.c1_permission_revision) {
    return Object.freeze({ ok: false, result: blocked('CONSENT_REQUIRED') });
  }
  if (!consentStore.isCurrent(request.consent)) {
    return Object.freeze({ ok: false, result: blocked('CONSENT_REQUIRED') });
  }
  if (request.prepared_image.state !== 'EXTERNAL_READY'
    || request.prepared_image.readiness_basis !== 'SYNTHETIC_TEST_FIXTURE'
    || !nonEmpty(request.prepared_image.prepared_image_id)) {
    return Object.freeze({ ok: false, result: blocked('IMAGE_NOT_EXTERNAL_READY') });
  }
  return Object.freeze({ ok: true });
}

const FORBIDDEN_PIXEL_CLAIM = new RegExp([
  String.raw`\b(?:exact(?:ly)?\s*)?\d+(?:\.\d+)?\s*(?:kcal|calories?|grams?|g)\b`,
  String.raw`\b(?:protein|carbs?|carbohydrates?|fat)\b[^\n]{0,40}\b\d+(?:\.\d+)?\s*g\b`,
  String.raw`\b(?:diagnos(?:is|e)|treat(?:ment)?|disease\s+risk)\b`,
  String.raw`\b(?:face|body)\s+identit(?:y|ification)\b`,
  String.raw`\b(?:body[- ]?fat|body\s+composition)\b`,
].join('|'), 'iu');

const stringList = (value: unknown, maxItems: number): value is readonly string[] =>
  Array.isArray(value) && value.length > 0 && value.length <= maxItems
  && value.every(item => nonEmpty(item));

const VISIBLE_MEAL_CONTEXT_KEYS = Object.freeze([
  'state', 'visible_items', 'qualitative_observations', 'uncertainty', 'evidence_limitations',
]);
const NEED_MORE_INFO_KEYS = Object.freeze(['state', 'reason', 'missing_detail_request']);
const STATE_REASON_KEYS = Object.freeze(['state', 'reason']);

export function validateMealVisionOutput(value: unknown): MealVisionResult {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return Object.freeze({ state: 'INVALID_PROVIDER_OUTPUT', reason: 'MALFORMED_OUTPUT' });
  }
  if (!serialized || FORBIDDEN_PIXEL_CLAIM.test(serialized)) {
    return Object.freeze({
      state: 'INVALID_PROVIDER_OUTPUT', reason: 'FORBIDDEN_PIXEL_ONLY_CLAIM',
    });
  }
  if (!value || typeof value !== 'object') {
    return Object.freeze({ state: 'INVALID_PROVIDER_OUTPUT', reason: 'MALFORMED_OUTPUT' });
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.state === 'VISIBLE_MEAL_CONTEXT'
    && hasExactEnumerableKeys(candidate, VISIBLE_MEAL_CONTEXT_KEYS)
    && stringList(candidate.visible_items, 12)
    && stringList(candidate.qualitative_observations, 8)
    && ['LOW', 'MEDIUM', 'HIGH'].includes(String(candidate.uncertainty))
    && stringList(candidate.evidence_limitations, 6)) {
    return Object.freeze({
      state: 'VISIBLE_MEAL_CONTEXT',
      visible_items: Object.freeze([...candidate.visible_items]),
      qualitative_observations: Object.freeze([...candidate.qualitative_observations]),
      uncertainty: candidate.uncertainty as VisibleMealContext['uncertainty'],
      evidence_limitations: Object.freeze([...candidate.evidence_limitations]),
    });
  }
  if (candidate.state === 'NEED_MORE_INFO'
    && hasExactEnumerableKeys(candidate, NEED_MORE_INFO_KEYS)
    && ['AMBIGUOUS_MIXED_MEAL', 'LOW_QUALITY', 'OCCLUDED', 'MISSING_DETAIL']
      .includes(String(candidate.reason))
    && nonEmpty(candidate.missing_detail_request)) {
    return Object.freeze({
      state: 'NEED_MORE_INFO',
      reason: candidate.reason as NeedMoreInfo['reason'],
      missing_detail_request: candidate.missing_detail_request,
    });
  }
  if (candidate.state === 'OUTSIDE_SCOPE'
    && hasExactEnumerableKeys(candidate, STATE_REASON_KEYS)
    && ['NON_MEAL_IMAGE', 'UNSUPPORTED_REQUEST'].includes(String(candidate.reason))) {
    return Object.freeze({
      state: 'OUTSIDE_SCOPE', reason: candidate.reason as 'NON_MEAL_IMAGE' | 'UNSUPPORTED_REQUEST',
    });
  }
  if (candidate.state === 'UNSAFE'
    && hasExactEnumerableKeys(candidate, STATE_REASON_KEYS)
    && candidate.reason === 'MEDICAL_OR_IDENTITY_INFERENCE') {
    return Object.freeze({ state: 'UNSAFE', reason: 'MEDICAL_OR_IDENTITY_INFERENCE' });
  }
  return Object.freeze({ state: 'INVALID_PROVIDER_OUTPUT', reason: 'MALFORMED_OUTPUT' });
}

export async function runMealVisionOfflineFixture(
  request: MealVisionRequest,
  consentStore: MealExternalConsentStore,
  port: MealVisionOfflinePort,
): Promise<MealVisionResult | MealVisionBlocked> {
  const validation = validateMealVisionRequest(request, consentStore);
  if (!validation.ok) return validation.result;
  return validateMealVisionOutput(await port.analyze(request));
}
