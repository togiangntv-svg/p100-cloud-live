import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls += 1;
  throw new Error('NETWORK_FORBIDDEN_IN_CAMERA_C2_PREPARATION');
};

const at = path => new URL(path, import.meta.url);
const read = path => readFile(at(path), 'utf8');
const { createMealExternalConsentStore } = await import(at('../domain/camera/meal-vision.ts'));
const { createLocalImagePreparationService } =
  await import(at('../domain/camera/image-preparation.ts'));
const { createExpoImagePreparer } = await import(at('../lib/camera/expo-image-preparer.ts'));
const domainSource = await read('../domain/camera/image-preparation.ts');
const adapterSource = await read('../lib/camera/expo-image-preparer.ts');

const scopeA = Object.freeze({ session_id: 'session-a', task_id: 'task-a', revision: 4 });
const scopeA2 = Object.freeze({ session_id: 'session-a', task_id: 'task-a', revision: 5 });
const scopeB = Object.freeze({ session_id: 'session-a', task_id: 'task-b', revision: 1 });

const makeRuntime = ({ width = 800, height = 600, failure } = {}) => {
  const calls = { manipulate: [], resize: [], save: [], failure };
  const image = (imageWidth, imageHeight) => Object.freeze({
    width: imageWidth,
    height: imageHeight,
    saveAsync: async options => {
      calls.save.push(options);
      return { uri: 'file:///app-cache/reencoded-meal.jpg', width: imageWidth, height: imageHeight };
    },
  });
  const context = (source, initialWidth, initialHeight) => {
    let resize;
    return {
      resize: value => { resize = value; calls.resize.push(value); return contextRef; },
      renderAsync: async () => {
        if (calls.failure) throw new Error(calls.failure);
        if (!resize) return image(initialWidth, initialHeight);
        if (resize.width) return image(resize.width, Math.round(initialHeight * resize.width / initialWidth));
        return image(Math.round(initialWidth * resize.height / initialHeight), resize.height);
      },
    };
    function contextRef() {}
  };
  const runtime = Object.freeze({
    SaveFormat: Object.freeze({ JPEG: 'jpeg' }),
    ImageManipulator: Object.freeze({
      manipulate: source => {
        calls.manipulate.push(source);
        const sourceWidth = typeof source === 'string' ? width : source.width;
        const sourceHeight = typeof source === 'string' ? height : source.height;
        const value = context(source, sourceWidth, sourceHeight);
        value.resize = size => {
          calls.resize.push(size);
          const nextWidth = size.width ?? Math.round(sourceWidth * size.height / sourceHeight);
          const nextHeight = size.height ?? Math.round(sourceHeight * size.width / sourceWidth);
          value.renderAsync = async () => {
            if (calls.failure) throw new Error(calls.failure);
            return image(nextWidth, nextHeight);
          };
          return value;
        };
        return value;
      },
    }),
  });
  return { runtime, calls };
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const makeDeferredRuntime = (stage, pauseAt = 1) => {
  const gate = deferred();
  const entered = deferred();
  const calls = { manipulate: [], resize: [], save: [] };
  let paused = false;
  let matchingCalls = 0;
  const pauseOnce = async currentStage => {
    if (stage !== currentStage) return;
    matchingCalls += 1;
    if (paused || matchingCalls !== pauseAt) return;
    paused = true;
    entered.resolve();
    await gate.promise;
  };
  const image = (width, height) => Object.freeze({
    width,
    height,
    saveAsync: async options => {
      calls.save.push(options);
      await pauseOnce('save');
      return { uri: 'file:///app-cache/deferred.jpg', width, height };
    },
  });
  const runtime = Object.freeze({
    SaveFormat: Object.freeze({ JPEG: 'jpeg' }),
    ImageManipulator: Object.freeze({
      manipulate: source => {
        calls.manipulate.push(source);
        const width = typeof source === 'string' ? 800 : source.width;
        const height = typeof source === 'string' ? 600 : source.height;
        const context = {
          resize: size => {
            calls.resize.push(size);
            return context;
          },
          renderAsync: async () => {
            await pauseOnce('render');
            return image(width, height);
          },
        };
        return context;
      },
    }),
  });
  return { runtime, calls, entered: entered.promise, release: gate.resolve, fail: gate.reject };
};

const receipt = (scope, candidateId = 'candidate-a', uri = 'file:///private/source.jpg') =>
  Object.freeze({ ...scope, candidate_id: candidateId, source: 'CAMERA', local_uri: uri,
    choice: 'USE_PHOTO' });
const c1 = (scope, candidateId = 'candidate-a', contextId = 'context-a', permissionRevision = 2) =>
  Object.freeze({ ...scope, candidate_id: candidateId, context_id: contextId,
    permission_revision: permissionRevision, external_readiness: 'LOCAL_ONLY' });
const projection = (ref, status = 'allowed', patch = {}) => Object.freeze({
  scope: Object.freeze({ session_id: ref.session_id, task_id: ref.task_id, revision: ref.revision }),
  image: Object.freeze({ state: 'present', id: ref.context_id, usable: true,
    permission_revision: ref.permission_revision }),
  permission: Object.freeze({ purpose: 'meal_image_assessment', status,
    revision: ref.permission_revision }),
  boundary: 'within_slice',
  ...patch,
});

const harness = (options = {}) => {
  const native = options.native ?? makeRuntime(options);
  const adapter = createExpoImagePreparer(native.runtime);
  adapter.bind(options.scope ?? scopeA);
  const ref = c1(options.scope ?? scopeA, options.candidateId, options.contextId,
    options.permissionRevision);
  const source = adapter.bindAcceptedPhoto(receipt(options.scope ?? scopeA,
    options.candidateId, options.uri));
  const consentStore = createMealExternalConsentStore();
  consentStore.bind(ref);
  const consent = consentStore.allow(ref);
  const service = createLocalImagePreparationService(consentStore, adapter.port);
  const request = Object.freeze({ source, c1_context: ref, current_c1: projection(ref), consent });
  return { ...native, adapter, ref, source, consentStore, consent, service, request };
};

const prepareTaskB = async h => {
  const refB = c1(scopeB, 'candidate-b', 'context-b', 3);
  assert.equal(h.adapter.bind(scopeB), true);
  const sourceB = h.adapter.bindAcceptedPhoto(
    receipt(scopeB, 'candidate-b', 'file:///private/task-b.jpg'),
  );
  h.consentStore.bind(refB);
  const consentB = h.consentStore.allow(refB);
  const requestB = Object.freeze({ source: sourceB, c1_context: refB,
    current_c1: projection(refB), consent: consentB });
  const descriptorB = await h.service.prepare(requestB);
  assert.equal(descriptorB.state, 'REENCODED_LOCAL');
  return { refB, sourceB, consentB, requestB, descriptorB };
};

const twoTaskHarness = async () => {
  const h = harness();
  const descriptorA = await h.service.prepare(h.request);
  const refB = c1(scopeB, 'candidate-b', 'context-b', 3);
  assert.equal(h.adapter.bind(scopeB), true);
  const sourceB = h.adapter.bindAcceptedPhoto(
    receipt(scopeB, 'candidate-b', 'file:///private/task-b.jpg'),
  );
  h.consentStore.bind(refB);
  const consentB = h.consentStore.allow(refB);
  const requestB = Object.freeze({ source: sourceB, c1_context: refB,
    current_c1: projection(refB), consent: consentB });
  const descriptorB = await h.service.prepare(requestB);
  assert.equal(descriptorB.state, 'REENCODED_LOCAL');
  return { ...h, descriptorA, refB, sourceB, consentB, requestB, descriptorB };
};

const tests = [];
const test = (name, body) => tests.push({ name, body });

test('exact current C0, C1 and external consent prepare exactly once', async () => {
  const h = harness();
  const result = await h.service.prepare(h.request);
  assert.equal(result.state, 'REENCODED_LOCAL');
  assert.equal(h.calls.save.length, 1);
});

test('only an accepted local C0 photo can create a private source binding', () => {
  const native = makeRuntime();
  const adapter = createExpoImagePreparer(native.runtime);
  assert.equal(adapter.bindAcceptedPhoto(receipt(scopeA)), undefined);
  assert.equal(adapter.bind(scopeA), true);
  assert.equal(adapter.bindAcceptedPhoto({ ...receipt(scopeA), choice: 'CANCEL' }), undefined);
  assert.equal(adapter.bindAcceptedPhoto({ ...receipt(scopeA), source: 'INVALID' }), undefined);
  assert.equal(adapter.bindAcceptedPhoto(receipt(scopeA, 'candidate-a', 'https://remote/image.jpg')),
    undefined);
  assert.ok(adapter.bindAcceptedPhoto(receipt(scopeA)));
  assert.equal(native.calls.manipulate.length, 0);
});

test('stale task fails closed before preparation', async () => {
  const h = harness();
  const stale = { ...h.request, source: { ...h.source, scope: scopeB } };
  assert.deepEqual(await h.service.prepare(stale), { state: 'BLOCKED', reason: 'INVALID_AUTHORITY' });
  assert.equal(h.calls.manipulate.length, 0);
});

test('candidate or context replacement fails closed before preparation', async () => {
  for (const patch of [
    { source: { candidate_id: 'candidate-replaced' } },
    { c1_context: { context_id: 'context-replaced' } },
  ]) {
    const h = harness();
    const changed = patch.source
      ? { ...h.request, source: { ...h.source, ...patch.source } }
      : { ...h.request, c1_context: { ...h.ref, ...patch.c1_context } };
    assert.equal((await h.service.prepare(changed)).state, 'BLOCKED');
    assert.equal(h.calls.manipulate.length, 0);
  }
});

test('C1 denied or revoked authority fails closed before preparation', async () => {
  for (const status of ['denied', 'unknown']) {
    const h = harness();
    const changed = { ...h.request, current_c1: projection(h.ref, status) };
    assert.equal((await h.service.prepare(changed)).reason, 'INVALID_AUTHORITY');
    assert.equal(h.calls.manipulate.length, 0);
  }
});

test('changed C1 permission revision fails closed before preparation', async () => {
  const h = harness();
  const changedRef = { ...h.ref, permission_revision: h.ref.permission_revision + 1 };
  const changed = { ...h.request, c1_context: changedRef, current_c1: projection(changedRef) };
  assert.equal((await h.service.prepare(changed)).reason, 'INVALID_AUTHORITY');
  assert.equal(h.calls.manipulate.length, 0);
});

test('absent or revoked external consent fails closed before preparation', async () => {
  const absent = harness();
  assert.equal((await absent.service.prepare({ ...absent.request, consent: undefined })).reason,
    'INVALID_AUTHORITY');
  assert.equal(absent.calls.manipulate.length, 0);
  const revoked = harness();
  revoked.consentStore.revoke(revoked.consent);
  assert.equal((await revoked.service.prepare(revoked.request)).reason, 'INVALID_AUTHORITY');
  assert.equal(revoked.calls.manipulate.length, 0);
});

test('public descriptor exposes no URI, path, base64, bytes, EXIF or GPS', async () => {
  const h = harness();
  const result = await h.service.prepare(h.request);
  assert.deepEqual(Object.keys(result).sort(), [
    'scope', 'context_id', 'candidate_id', 'source_ref_id', 'c1_permission_revision',
    'consent_revision', 'prepared_image_id', 'state', 'width', 'height', 'mime',
  ].sort());
  assert.doesNotMatch(JSON.stringify(result), /uri|path|base64|bytes|exif|gps|sanitized|external_ready/iu);
});

test('private registry resolves cache URI only for exact current descriptor and authority', async () => {
  const h = harness();
  const result = await h.service.prepare(h.request);
  assert.equal(h.service.resolvePrivate(h.request, result), 'file:///app-cache/reencoded-meal.jpg');
  assert.equal(h.service.resolvePrivate(h.request, { ...result, prepared_image_id: 'wrong' }), undefined);
});

test('explicit retire and stale scope remove private URI authority', async () => {
  const h = harness();
  const result = await h.service.prepare(h.request);
  h.service.retire();
  assert.equal(h.service.resolvePrivate(h.request, result), undefined);
  const later = harness({ scope: scopeA2, candidateId: 'candidate-later', contextId: 'context-later' });
  assert.equal(later.service.synchronize(later.request), true);
  assert.equal(later.service.resolvePrivate(h.request, result), undefined);
});

test('same source URI in a later task creates new opaque ids', async () => {
  const first = harness({ uri: 'file:///private/same.jpg' });
  const firstResult = await first.service.prepare(first.request);
  const laterRef = c1(scopeB, 'candidate-b', 'context-b');
  first.adapter.bind(scopeB);
  const laterSource = first.adapter.bindAcceptedPhoto(
    receipt(scopeB, 'candidate-b', 'file:///private/same.jpg'),
  );
  first.consentStore.bind(laterRef);
  const laterConsent = first.consentStore.allow(laterRef);
  const laterRequest = Object.freeze({ source: laterSource, c1_context: laterRef,
    current_c1: projection(laterRef), consent: laterConsent });
  const laterResult = await first.service.prepare(laterRequest);
  assert.equal(laterResult.state, 'REENCODED_LOCAL');
  assert.notEqual(laterSource.source_ref_id, first.source.source_ref_id);
  assert.notEqual(laterResult.prepared_image_id, firstResult.prepared_image_id);
  assert.equal(first.service.resolvePrivate(first.request, firstResult), undefined);
});

test('late stale receipt cannot replace current Task B source or artifact', async () => {
  const h = await twoTaskHarness();
  assert.equal(h.adapter.bindAcceptedPhoto(receipt(scopeA, 'candidate-a-late')), undefined);
  assert.equal(h.service.resolvePrivate(h.requestB, h.descriptorB),
    'file:///app-cache/reencoded-meal.jpg');
});

test('late stale prepare is blocked without mutating current Task B artifact', async () => {
  const h = await twoTaskHarness();
  assert.equal((await h.service.prepare(h.request)).reason, 'INVALID_AUTHORITY');
  assert.equal(h.service.resolvePrivate(h.requestB, h.descriptorB),
    'file:///app-cache/reencoded-meal.jpg');
});

test('late stale private resolve is side-effect free for current Task B', async () => {
  const h = await twoTaskHarness();
  assert.equal(h.service.resolvePrivate(h.request, h.descriptorA), undefined);
  assert.equal(h.service.resolvePrivate(h.requestB, h.descriptorB),
    'file:///app-cache/reencoded-meal.jpg');
});

test('spoofed current source_ref_id is blocked without mutating Task B', async () => {
  const h = await twoTaskHarness();
  const spoofed = { ...h.requestB, source: { ...h.sourceB, source_ref_id: 'spoofed-source' } };
  assert.equal((await h.service.prepare(spoofed)).reason, 'INVALID_AUTHORITY');
  assert.equal(h.service.resolvePrivate(h.requestB, h.descriptorB),
    'file:///app-cache/reencoded-meal.jpg');
});

test('malformed same-scope receipt is rejected without mutating current artifact', async () => {
  const h = await twoTaskHarness();
  assert.equal(h.adapter.bindAcceptedPhoto({ ...receipt(scopeB, 'bad'), source: 'INVALID' }), undefined);
  assert.equal(h.adapter.bindAcceptedPhoto({ ...receipt(scopeB, 'bad'), unexpected: true }), undefined);
  assert.equal(h.service.resolvePrivate(h.requestB, h.descriptorB),
    'file:///app-cache/reencoded-meal.jpg');
});

test('same-scope candidate replacement invalidates old artifact and permits new preparation', async () => {
  const h = await twoTaskHarness();
  assert.equal(h.adapter.bind(scopeB), true);
  const replacementRef = c1(scopeB, 'candidate-b2', 'context-b2', 4);
  const replacementSource = h.adapter.bindAcceptedPhoto(
    receipt(scopeB, 'candidate-b2', 'file:///private/task-b2.jpg'),
  );
  h.consentStore.bind(replacementRef);
  const replacementConsent = h.consentStore.allow(replacementRef);
  const replacementRequest = Object.freeze({ source: replacementSource,
    c1_context: replacementRef, current_c1: projection(replacementRef),
    consent: replacementConsent });
  assert.equal(h.service.resolvePrivate(h.requestB, h.descriptorB), undefined);
  assert.equal((await h.service.prepare(replacementRequest)).state, 'REENCODED_LOCAL');
});

test('trusted bind to a new task retires prior source and artifacts', async () => {
  const h = await twoTaskHarness();
  assert.equal(h.adapter.bind(scopeA2), true);
  assert.equal(h.adapter.port.isCurrentSource(h.sourceB), false);
  assert.equal(h.service.resolvePrivate(h.requestB, h.descriptorB), undefined);
});

test('explicit retire clears current source and artifacts', async () => {
  const h = await twoTaskHarness();
  h.service.retire();
  assert.equal(h.adapter.port.isCurrentSource(h.sourceB), false);
  assert.equal(h.service.resolvePrivate(h.requestB, h.descriptorB), undefined);
});

test('late render completion from Task A cannot register or clear Task B', async () => {
  const native = makeDeferredRuntime('render');
  const h = harness({ native });
  const pendingA = h.service.prepare(h.request);
  await native.entered;
  const b = await prepareTaskB(h);
  native.release();
  assert.deepEqual(await pendingA, { state: 'BLOCKED', reason: 'INVALID_AUTHORITY' });
  assert.equal(h.service.resolvePrivate(b.requestB, b.descriptorB),
    'file:///app-cache/deferred.jpg');
});

test('late save completion from Task A cannot register or clear Task B', async () => {
  const native = makeDeferredRuntime('save');
  const h = harness({ native });
  const pendingA = h.service.prepare(h.request);
  await native.entered;
  const b = await prepareTaskB(h);
  native.release();
  assert.deepEqual(await pendingA, { state: 'BLOCKED', reason: 'INVALID_AUTHORITY' });
  assert.equal(h.service.resolvePrivate(b.requestB, b.descriptorB),
    'file:///app-cache/deferred.jpg');
});

test('late consent-revision work cannot replace the current consent artifact', async () => {
  const native = makeDeferredRuntime('render');
  const h = harness({ native });
  const pendingOld = h.service.prepare(h.request);
  await native.entered;
  assert.equal(h.consentStore.revoke(h.consent), true);
  const renewedConsent = h.consentStore.allow(h.ref);
  const renewedRequest = Object.freeze({ ...h.request, consent: renewedConsent });
  const renewedDescriptor = await h.service.prepare(renewedRequest);
  assert.equal(renewedDescriptor.state, 'REENCODED_LOCAL');
  native.release();
  assert.deepEqual(await pendingOld, { state: 'BLOCKED', reason: 'INVALID_AUTHORITY' });
  assert.equal(h.service.resolvePrivate(renewedRequest, renewedDescriptor),
    'file:///app-cache/deferred.jpg');
  assert.equal(h.service.resolvePrivate(renewedRequest,
    { ...renewedDescriptor, consent_revision: h.consent.consent_revision }), undefined);
});

test('late source-ref work cannot replace a same-scope photo replacement', async () => {
  const native = makeDeferredRuntime('render');
  const h = harness({ native });
  const pendingOld = h.service.prepare(h.request);
  await native.entered;
  const sourceB = h.adapter.bindAcceptedPhoto(
    receipt(scopeA, 'candidate-a', 'file:///private/replacement.jpg'),
  );
  const requestB = Object.freeze({ ...h.request, source: sourceB });
  const descriptorB = await h.service.prepare(requestB);
  assert.equal(descriptorB.state, 'REENCODED_LOCAL');
  native.release();
  assert.deepEqual(await pendingOld, { state: 'BLOCKED', reason: 'INVALID_AUTHORITY' });
  assert.equal(h.service.resolvePrivate(requestB, descriptorB),
    'file:///app-cache/deferred.jpg');
  assert.notEqual(descriptorB.source_ref_id, h.source.source_ref_id);
});

test('late stale native failure cannot clear Task B source or artifact', async () => {
  const native = makeDeferredRuntime('render');
  const h = harness({ native });
  const pendingA = h.service.prepare(h.request);
  await native.entered;
  const b = await prepareTaskB(h);
  native.fail(new Error('LATE_TASK_A_NATIVE_FAILURE'));
  assert.deepEqual(await pendingA, { state: 'BLOCKED', reason: 'INVALID_AUTHORITY' });
  assert.equal(h.adapter.port.isCurrentSource(b.sourceB), true);
  assert.equal(h.service.resolvePrivate(b.requestB, b.descriptorB),
    'file:///app-cache/deferred.jpg');
});

test('same-authority latest render operation wins and remains resolvable', async () => {
  const native = makeDeferredRuntime('render');
  const h = harness({ native });
  const pendingFirst = h.service.prepare(h.request);
  await native.entered;
  const latest = await h.service.prepare(h.request);
  assert.equal(latest.state, 'REENCODED_LOCAL');
  native.release();
  assert.deepEqual(await pendingFirst, { state: 'BLOCKED', reason: 'INVALID_AUTHORITY' });
  assert.equal(h.service.resolvePrivate(h.request, latest), 'file:///app-cache/deferred.jpg');
});

test('same-authority late native failure cannot clear the latest artifact', async () => {
  const native = makeDeferredRuntime('render');
  const h = harness({ native });
  const pendingFirst = h.service.prepare(h.request);
  await native.entered;
  const latest = await h.service.prepare(h.request);
  assert.equal(latest.state, 'REENCODED_LOCAL');
  native.fail(new Error('SUPERSEDED_NATIVE_FAILURE'));
  assert.deepEqual(await pendingFirst, { state: 'BLOCKED', reason: 'INVALID_AUTHORITY' });
  assert.equal(h.adapter.port.isCurrentSource(h.source), true);
  assert.equal(h.service.resolvePrivate(h.request, latest), 'file:///app-cache/deferred.jpg');
});

test('same-authority latest save operation wins without duplicate stale authority', async () => {
  const native = makeDeferredRuntime('save');
  const h = harness({ native });
  const pendingFirst = h.service.prepare(h.request);
  await native.entered;
  const latest = await h.service.prepare(h.request);
  assert.equal(latest.state, 'REENCODED_LOCAL');
  native.release();
  assert.deepEqual(await pendingFirst, { state: 'BLOCKED', reason: 'INVALID_AUTHORITY' });
  assert.equal(h.service.resolvePrivate(h.request, latest), 'file:///app-cache/deferred.jpg');
  assert.equal(h.service.resolvePrivate(h.request,
    { ...latest, prepared_image_id: `${latest.prepared_image_id}-stale` }), undefined);
});

test('invalid request cannot supersede a valid in-flight preparation', async () => {
  const native = makeDeferredRuntime('render');
  const h = harness({ native });
  const pendingCurrent = h.service.prepare(h.request);
  await native.entered;
  const invalid = { ...h.request, source: { ...h.source, source_ref_id: 'invalid-source' } };
  assert.deepEqual(await h.service.prepare(invalid),
    { state: 'BLOCKED', reason: 'INVALID_AUTHORITY' });
  native.release();
  const current = await pendingCurrent;
  assert.equal(current.state, 'REENCODED_LOCAL');
  assert.equal(h.service.resolvePrivate(h.request, current), 'file:///app-cache/deferred.jpg');
});

test('starting a new valid prepare immediately invalidates the prior completed artifact', async () => {
  const native = makeDeferredRuntime('render', 2);
  const h = harness({ native });
  const first = await h.service.prepare(h.request);
  assert.equal(h.service.resolvePrivate(h.request, first), 'file:///app-cache/deferred.jpg');
  const pendingLatest = h.service.prepare(h.request);
  await native.entered;
  assert.equal(h.service.resolvePrivate(h.request, first), undefined);
  native.release();
  const latest = await pendingLatest;
  assert.equal(latest.state, 'REENCODED_LOCAL');
  assert.equal(h.service.resolvePrivate(h.request, first), undefined);
  assert.equal(h.service.resolvePrivate(h.request, latest), 'file:///app-cache/deferred.jpg');
});

test('invalid prepare preserves the prior completed artifact', async () => {
  const h = harness();
  const first = await h.service.prepare(h.request);
  const invalid = { ...h.request, source: { ...h.source, source_ref_id: 'invalid-source' } };
  assert.deepEqual(await h.service.prepare(invalid),
    { state: 'BLOCKED', reason: 'INVALID_AUTHORITY' });
  assert.equal(h.service.resolvePrivate(h.request, first),
    'file:///app-cache/reencoded-meal.jpg');
});

test('image at or below 1280 is rendered without upscaling', async () => {
  const h = harness({ width: 900, height: 600 });
  const result = await h.service.prepare(h.request);
  assert.equal(result.width, 900);
  assert.equal(result.height, 600);
  assert.equal(h.calls.resize.length, 0);
  assert.equal(h.calls.save.length, 1);
});

test('large image longest edge becomes 1280 with aspect ratio preserved', async () => {
  const h = harness({ width: 4000, height: 2250 });
  const result = await h.service.prepare(h.request);
  assert.deepEqual(h.calls.resize, [{ width: 1280 }]);
  assert.equal(result.width, 1280);
  assert.equal(result.height, 720);
});

test('Expo adapter saves JPEG at 0.80 compression without base64', async () => {
  const h = harness();
  await h.service.prepare(h.request);
  assert.deepEqual(h.calls.save, [{ format: 'jpeg', compress: 0.80, base64: false }]);
});

test('ImageManipulator failure returns PREPARATION_FAILED without original fallback', async () => {
  const h = harness({ failure: 'IMAGE_MANIPULATOR_FAILED' });
  assert.deepEqual(await h.service.prepare(h.request),
    { state: 'BLOCKED', reason: 'PREPARATION_FAILED' });
  assert.equal(h.calls.manipulate.length, 1);
  assert.equal(h.calls.save.length, 0);
});

test('current manipulation failure clears artifacts but preserves current source authority', async () => {
  const h = harness();
  const prior = await h.service.prepare(h.request);
  h.calls.failure = 'ERR_IMAGE_CONTEXT_LOST';
  const pendingFailure = h.service.prepare(h.request);
  assert.equal(h.service.resolvePrivate(h.request, prior), undefined);
  assert.equal((await pendingFailure).reason, 'PREPARATION_FAILED');
  assert.equal(h.service.resolvePrivate(h.request, prior), undefined);
  assert.equal(h.adapter.port.isCurrentSource(h.source), true);
  h.calls.failure = undefined;
  const retry = await h.service.prepare(h.request);
  assert.equal(retry.state, 'REENCODED_LOCAL');
  assert.equal(h.service.resolvePrivate(h.request, prior), undefined);
  assert.equal(h.service.resolvePrivate(h.request, retry),
    'file:///app-cache/reencoded-meal.jpg');
});

test('HDR HEIC and ERR_IMAGE_CONTEXT_LOST errors fail closed', async () => {
  for (const failure of ['HDR_HEIC_LIKE failure', 'ERR_IMAGE_CONTEXT_LOST']) {
    const h = harness({ failure });
    assert.equal((await h.service.prepare(h.request)).reason, 'PREPARATION_FAILED');
    assert.equal(h.calls.save.length, 0);
  }
});

test('preparation remains local-only with no provider, persistence or external-ready claim', () => {
  assert.doesNotMatch(domainSource, /fetch\s*\(|axios|OpenAI|Anthropic|AsyncStorage|SQLite|analytics/iu);
  assert.doesNotMatch(adapterSource, /fetch\s*\(|axios|OpenAI|Anthropic|AsyncStorage|SQLite|analytics/iu);
  assert.doesNotMatch(domainSource + adapterSource, /EXIF_STRIPPED|GPS_REMOVED|SANITIZED/u);
  assert.equal(networkCalls, 0);
});

for (const { name, body } of tests) {
  await body();
  console.log('PASS ' + name);
}
assert.equal(networkCalls, 0);
console.log('Camera C2 local preparation: ' + tests.length + '/' + tests.length
  + ' PASS; provider/network/persistence calls = 0; device runtime NOT_RUN.');
