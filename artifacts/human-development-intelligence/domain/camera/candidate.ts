export type CameraCandidateSource = 'CAMERA' | 'LIBRARY';

export type CameraTaskScope = Readonly<{
  session_id: string;
  task_id: string;
  revision: number;
}>;

export type CameraLocalAsset = Readonly<{
  uri: string;
  width?: number;
  height?: number;
}>;

export type CameraCandidate = Readonly<CameraTaskScope & {
  candidate_id: string;
  source: CameraCandidateSource;
  local_uri: string;
  width?: number;
  height?: number;
}>;

export type CameraAcceptedReceipt = Readonly<CameraTaskScope & {
  candidate_id: string;
  source: CameraCandidateSource;
  local_uri: string;
  choice: 'USE_PHOTO';
}>;

export type CameraIssue = 'PERMISSION_DENIED' | 'UNAVAILABLE';
export type CameraPhase = 'IDLE' | 'PICKING' | 'PREVIEW' | 'ACCEPTED';

export type CameraCandidateSnapshot = Readonly<{
  scope?: CameraTaskScope;
  phase: CameraPhase;
  issue?: CameraIssue;
  candidate?: CameraCandidate;
  receipt?: CameraAcceptedReceipt;
}>;

export type CameraPickerRequest = Readonly<{
  request_id: string;
  source: CameraCandidateSource;
  scope: CameraTaskScope;
}>;

export type CameraPickerResult =
  | Readonly<{ canceled: true }>
  | Readonly<{ canceled: false; asset: CameraLocalAsset }>;

export type CameraPickerPort = Readonly<{
  requestCameraPermission: () => Promise<'granted' | 'denied'>;
  takePhoto: () => Promise<CameraPickerResult>;
  choosePhoto: () => Promise<CameraPickerResult>;
}>;

export type CameraRequestCurrent = (request: CameraPickerRequest) => boolean;

const empty: CameraCandidateSnapshot = Object.freeze({ phase: 'IDLE' });
const sameScope = (a?: CameraTaskScope, b?: CameraTaskScope) => Boolean(a && b
  && a.session_id === b.session_id && a.task_id === b.task_id && a.revision === b.revision);
const freezeScope = (scope: CameraTaskScope): CameraTaskScope => Object.freeze({
  session_id: scope.session_id,
  task_id: scope.task_id,
  revision: scope.revision,
});
const validScope = (scope: CameraTaskScope) => Boolean(
  scope.session_id && scope.task_id && Number.isInteger(scope.revision) && scope.revision > 0,
);
const validLocalUri = (uri: string) => uri.length > 0 && uri.length <= 4096
  && /^(?:file|content|ph|assets-library|blob):/u.test(uri);
const validDimension = (value: number | undefined) => value === undefined
  || (Number.isFinite(value) && value > 0);

export function createCameraCandidateStore() {
  const listeners = new Set<() => void>();
  let snapshot = empty;
  let request: CameraPickerRequest | undefined;
  let nativeOperation: CameraPickerRequest | undefined;
  let sequence = 0;
  const publish = (next: CameraCandidateSnapshot) => {
    snapshot = Object.freeze(next);
    for (const listener of [...listeners]) listener();
  };
  const requestIsCurrent = (value: CameraPickerRequest) => request === value
    && nativeOperation === value && request.scope === value.scope && snapshot.scope === value.scope;
  const clearForScope = (scope?: CameraTaskScope) => {
    request = undefined;
    publish(scope ? { scope: scope === snapshot.scope ? scope : freezeScope(scope), phase: 'IDLE' } : empty);
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    isBusy: () => nativeOperation !== undefined,
    isCurrentRequest: requestIsCurrent,
    bind: (scope?: CameraTaskScope) => {
      if (scope && !validScope(scope)) return false;
      if (sameScope(snapshot.scope, scope)) return true;
      clearForScope(scope);
      return true;
    },
    begin: (scope: CameraTaskScope, source: CameraCandidateSource): CameraPickerRequest | undefined => {
      if (nativeOperation || snapshot.receipt || !snapshot.scope
        || !sameScope(snapshot.scope, scope)) return undefined;
      request = Object.freeze({
        request_id: 'camera-request-' + ++sequence,
        source,
        scope: snapshot.scope,
      });
      nativeOperation = request;
      publish({ scope: snapshot.scope, phase: 'PICKING' });
      return request;
    },
    settle: (value: CameraPickerRequest) => {
      if (nativeOperation !== value) return false;
      nativeOperation = undefined;
      if (request === value) request = undefined;
      publish({ ...snapshot });
      return true;
    },
    deny: (value: CameraPickerRequest) => {
      if (!requestIsCurrent(value)) return false;
      request = undefined;
      publish({ scope: snapshot.scope, phase: 'IDLE', issue: 'PERMISSION_DENIED' });
      return true;
    },
    unavailable: (value: CameraPickerRequest) => {
      if (!requestIsCurrent(value)) return false;
      request = undefined;
      publish({ scope: snapshot.scope, phase: 'IDLE', issue: 'UNAVAILABLE' });
      return true;
    },
    cancelNative: (value: CameraPickerRequest) => {
      if (!requestIsCurrent(value)) return false;
      request = undefined;
      publish({ scope: snapshot.scope, phase: 'IDLE' });
      return true;
    },
    complete: (value: CameraPickerRequest, asset: CameraLocalAsset) => {
      if (!requestIsCurrent(value)) return false;
      if (!validLocalUri(asset.uri)
        || !validDimension(asset.width) || !validDimension(asset.height)) {
        request = undefined;
        publish({ scope: snapshot.scope, phase: 'IDLE', issue: 'UNAVAILABLE' });
        return false;
      }
      request = undefined;
      const candidate: CameraCandidate = Object.freeze({
        ...freezeScope(value.scope),
        candidate_id: 'camera-candidate-' + ++sequence,
        source: value.source,
        local_uri: asset.uri,
        ...(asset.width === undefined ? {} : { width: asset.width }),
        ...(asset.height === undefined ? {} : { height: asset.height }),
      });
      publish({ scope: snapshot.scope, phase: 'PREVIEW', candidate });
      return true;
    },
    accept: (scope: CameraTaskScope, candidateId: string): CameraAcceptedReceipt | undefined => {
      if (!sameScope(snapshot.scope, scope) || !snapshot.candidate
        || snapshot.candidate.candidate_id !== candidateId) return undefined;
      if (snapshot.receipt?.candidate_id === candidateId) return snapshot.receipt;
      const receipt: CameraAcceptedReceipt = Object.freeze({
        ...freezeScope(scope),
        candidate_id: snapshot.candidate.candidate_id,
        source: snapshot.candidate.source,
        local_uri: snapshot.candidate.local_uri,
        choice: 'USE_PHOTO',
      });
      publish({ ...snapshot, phase: 'ACCEPTED', receipt });
      return receipt;
    },
    cancelFlow: (scope: CameraTaskScope) => {
      if (!sameScope(snapshot.scope, scope)) return false;
      clearForScope(scope);
      return true;
    },
    retire: () => clearForScope(),
  };
}

export function createCameraC0Controller(
  store: ReturnType<typeof createCameraCandidateStore>,
  picker: CameraPickerPort,
) {
  const current = (request: CameraPickerRequest, validate: CameraRequestCurrent) => {
    if (!store.isCurrentRequest(request)) return false;
    let valid = false;
    try { valid = validate(request); } catch { return false; }
    return valid && store.isCurrentRequest(request);
  };
  const finish = async (
    request: CameraPickerRequest,
    select: () => Promise<CameraPickerResult>,
    validate: CameraRequestCurrent,
  ) => {
    try {
      if (!current(request, validate)) return false;
      const result = await select();
      if (!current(request, validate)) return false;
      return result.canceled
        ? store.cancelNative(request)
        : store.complete(request, result.asset);
    } catch {
      return current(request, validate) ? store.unavailable(request) : false;
    }
  };
  return Object.freeze({
    takePhoto: async (scope: CameraTaskScope, validate: CameraRequestCurrent = () => true) => {
      const request = store.begin(scope, 'CAMERA');
      if (!request) return false;
      try {
        if (!current(request, validate)) return false;
        const permission = await picker.requestCameraPermission();
        if (!current(request, validate)) return false;
        if (permission !== 'granted') return store.deny(request);
        return await finish(request, picker.takePhoto, validate);
      } catch {
        return current(request, validate) ? store.unavailable(request) : false;
      } finally {
        store.settle(request);
      }
    },
    choosePhoto: async (scope: CameraTaskScope, validate: CameraRequestCurrent = () => true) => {
      const request = store.begin(scope, 'LIBRARY');
      if (!request) return false;
      try {
        return await finish(request, picker.choosePhoto, validate);
      } finally {
        store.settle(request);
      }
    },
  });
}
