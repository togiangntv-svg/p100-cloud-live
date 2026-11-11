import type { CameraTaskScope } from './candidate.ts';
import type { CameraC1ContextRef } from './m4-context.ts';
import type { M4ContextInput } from '../m4/contract.ts';
import {
  MEAL_IMAGE_EXTERNAL_ANALYSIS,
  type MealExternalConsentReceipt,
  type MealExternalConsentStore,
} from './meal-vision.ts';

export type LocalImageSourceRef = Readonly<{
  scope: CameraTaskScope;
  candidate_id: string;
  source_ref_id: string;
  choice: 'USE_PHOTO';
}>;

export type LocalImagePreparationRequest = Readonly<{
  source: LocalImageSourceRef;
  c1_context: CameraC1ContextRef;
  current_c1: M4ContextInput;
  consent: MealExternalConsentReceipt;
}>;

export type ReencodedLocalImage = Readonly<{
  scope: CameraTaskScope;
  context_id: string;
  candidate_id: string;
  source_ref_id: string;
  c1_permission_revision: number;
  consent_revision: number;
  prepared_image_id: string;
  state: 'REENCODED_LOCAL';
  width: number;
  height: number;
  mime: 'image/jpeg';
}>;

/** Local-only boundary. This is neither an external-send permit nor M5 authority. */
export type PreparedMealBoundaryReceipt = Readonly<{
  kind: 'MEAL_IMAGE_PREPARATION_RECEIPT';
  version: 1;
  state: 'PREPARED_NOT_SENT';
  purpose: typeof MEAL_IMAGE_EXTERNAL_ANALYSIS;
  preparation_revision: number;
  artifact: ReencodedLocalImage;
}>;

export type LocalImagePreparationResult = ReencodedLocalImage | Readonly<{
  state: 'BLOCKED';
  reason: 'INVALID_AUTHORITY' | 'PREPARATION_FAILED';
}>;

export type LocalImagePreparationPort = Readonly<{
  isCurrentSource(ref: LocalImageSourceRef): boolean;
  prepare(request: LocalImagePreparationRequest): Promise<unknown>;
  resolvePrivate(descriptor: ReencodedLocalImage): string | undefined;
  retireArtifacts(): void;
  retire(): void;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
const positiveRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const positiveDimension = (value: unknown): value is number =>
  Number.isFinite(value) && Number(value) > 0 && Number(value) <= 1280;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
};
const sameScope = (a: CameraTaskScope, b: CameraTaskScope): boolean =>
  a.session_id === b.session_id && a.task_id === b.task_id && a.revision === b.revision;
const validScope = (value: unknown): value is CameraTaskScope => isRecord(value)
  && exactKeys(value, ['session_id', 'task_id', 'revision'])
  && nonEmpty(value.session_id) && nonEmpty(value.task_id) && positiveRevision(value.revision);
const validSource = (value: unknown): value is LocalImageSourceRef => isRecord(value)
  && exactKeys(value, ['scope', 'candidate_id', 'source_ref_id', 'choice'])
  && validScope(value.scope) && nonEmpty(value.candidate_id) && nonEmpty(value.source_ref_id)
  && value.choice === 'USE_PHOTO';
const validContext = (value: unknown): value is CameraC1ContextRef => isRecord(value)
  && exactKeys(value, [
    'session_id', 'task_id', 'revision', 'context_id', 'candidate_id',
    'permission_revision', 'external_readiness',
  ])
  && nonEmpty(value.session_id) && nonEmpty(value.task_id) && positiveRevision(value.revision)
  && nonEmpty(value.context_id) && nonEmpty(value.candidate_id)
  && positiveRevision(value.permission_revision) && value.external_readiness === 'LOCAL_ONLY';
const validCurrentC1 = (value: unknown): value is M4ContextInput => {
  if (!isRecord(value) || !exactKeys(value, ['scope', 'image', 'permission', 'boundary'])
    || !validScope(value.scope) || !isRecord(value.image) || !isRecord(value.permission)
    || !exactKeys(value.image, ['state', 'id', 'usable', 'permission_revision'])
    || !exactKeys(value.permission, ['purpose', 'status', 'revision'])) return false;
  return value.image.state === 'present' && nonEmpty(value.image.id)
    && typeof value.image.usable === 'boolean' && positiveRevision(value.image.permission_revision)
    && value.permission.purpose === 'meal_image_assessment'
    && ['allowed', 'denied', 'unknown'].includes(String(value.permission.status))
    && positiveRevision(value.permission.revision)
    && ['within_slice', 'professional_required'].includes(String(value.boundary));
};
const validConsent = (value: unknown): value is MealExternalConsentReceipt => isRecord(value)
  && exactKeys(value, [
    'session_id', 'task_id', 'revision', 'candidate_id', 'context_id',
    'c1_permission_revision', 'purpose', 'consent_revision', 'status',
  ])
  && nonEmpty(value.session_id) && nonEmpty(value.task_id) && positiveRevision(value.revision)
  && nonEmpty(value.candidate_id) && nonEmpty(value.context_id)
  && positiveRevision(value.c1_permission_revision) && positiveRevision(value.consent_revision)
  && value.purpose === MEAL_IMAGE_EXTERNAL_ANALYSIS && value.status === 'ALLOWED';

const validAuthority = (
  value: unknown,
  consentStore: MealExternalConsentStore,
): value is LocalImagePreparationRequest => {
  if (!isRecord(value)
    || !exactKeys(value, ['source', 'c1_context', 'current_c1', 'consent'])
    || !validSource(value.source)
    || !validContext(value.c1_context)
    || !validCurrentC1(value.current_c1)
    || !validConsent(value.consent)) return false;
  const source = value.source;
  const context = value.c1_context;
  const current = value.current_c1;
  const consent = value.consent;
  return sameScope(source.scope, context)
    && sameScope(source.scope, current.scope)
    && sameScope(source.scope, consent)
    && source.candidate_id === context.candidate_id
    && source.candidate_id === consent.candidate_id
    && context.context_id === consent.context_id
    && context.external_readiness === 'LOCAL_ONLY'
    && current.image.state === 'present'
    && current.image.id === context.context_id
    && current.image.usable === true
    && current.permission.purpose === 'meal_image_assessment'
    && current.permission.status === 'allowed'
    && current.boundary === 'within_slice'
    && current.permission.revision === current.image.permission_revision
    && current.permission.revision === context.permission_revision
    && current.permission.revision === consent.c1_permission_revision
    && consent.purpose === MEAL_IMAGE_EXTERNAL_ANALYSIS
    && consent.status === 'ALLOWED'
    && consentStore.isCurrent(consent);
};

const descriptorKeys = Object.freeze([
  'scope', 'context_id', 'candidate_id', 'source_ref_id', 'c1_permission_revision',
  'consent_revision', 'prepared_image_id', 'state', 'width', 'height', 'mime',
]);
const validDescriptor = (
  value: unknown,
  request: LocalImagePreparationRequest,
): value is ReencodedLocalImage => isRecord(value)
  && exactKeys(value, descriptorKeys)
  && validScope(value.scope)
  && sameScope(value.scope, request.source.scope)
  && value.context_id === request.c1_context.context_id
  && value.candidate_id === request.source.candidate_id
  && value.source_ref_id === request.source.source_ref_id
  && value.c1_permission_revision === request.c1_context.permission_revision
  && value.consent_revision === request.consent.consent_revision
  && nonEmpty(value.prepared_image_id)
  && value.state === 'REENCODED_LOCAL'
  && positiveDimension(value.width)
  && positiveDimension(value.height)
  && value.mime === 'image/jpeg';

const authorityKey = (request: LocalImagePreparationRequest): string => [
  request.source.scope.session_id,
  request.source.scope.task_id,
  request.source.scope.revision,
  request.source.candidate_id,
  request.source.source_ref_id,
  request.c1_context.context_id,
  request.c1_context.permission_revision,
  request.consent.consent_revision,
].join('\u0000');

const blocked = (reason: 'INVALID_AUTHORITY' | 'PREPARATION_FAILED') =>
  Object.freeze({ state: 'BLOCKED' as const, reason });

/**
 * Authorizes local preparation only. It never promotes a rendered artifact to
 * EXTERNAL_READY and never receives a filesystem URI from the private port.
 */
export function createLocalImagePreparationService(
  consentStore: MealExternalConsentStore,
  port: LocalImagePreparationPort,
) {
  let activeKey: string | undefined;
  let prepareSequence = 0;
  let currentPrepareOperationId = 0;

  const synchronize = (value: unknown): value is LocalImagePreparationRequest => {
    if (!validAuthority(value, consentStore) || !port.isCurrentSource(value.source)) return false;
    const nextKey = authorityKey(value);
    if (activeKey && activeKey !== nextKey) port.retireArtifacts();
    activeKey = nextKey;
    return true;
  };

  return Object.freeze({
    synchronize,
    prepare: async (value: unknown): Promise<LocalImagePreparationResult> => {
      if (!synchronize(value)) return blocked('INVALID_AUTHORITY');
      const operationId = ++prepareSequence;
      currentPrepareOperationId = operationId;
      const capturedKey = authorityKey(value);
      port.retireArtifacts();
      const stillCurrent = (): boolean => operationId === currentPrepareOperationId
        && validAuthority(value, consentStore)
        && port.isCurrentSource(value.source)
        && activeKey === capturedKey;
      try {
        const result = await port.prepare(value);
        if (!stillCurrent()) return blocked('INVALID_AUTHORITY');
        if (!validDescriptor(result, value)) {
          port.retireArtifacts();
          return blocked('PREPARATION_FAILED');
        }
        return Object.freeze(result);
      } catch {
        if (!stillCurrent()) return blocked('INVALID_AUTHORITY');
        port.retireArtifacts();
        return blocked('PREPARATION_FAILED');
      }
    },
    resolvePrivate: (value: unknown, descriptor: ReencodedLocalImage): string | undefined => {
      if (!validAuthority(value, consentStore)
        || !port.isCurrentSource(value.source)
        || activeKey !== authorityKey(value)
        || !validDescriptor(descriptor, value)) return undefined;
      return port.resolvePrivate(descriptor);
    },
    retire: () => {
      currentPrepareOperationId = ++prepareSequence;
      port.retire();
      activeKey = undefined;
    },
  });
}
