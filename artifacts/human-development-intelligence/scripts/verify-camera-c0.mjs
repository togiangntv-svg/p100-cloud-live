import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls += 1;
  throw new Error('NETWORK_FORBIDDEN_IN_CAMERA_C0_TEST');
};

const moduleAt = path => import(new URL(path, import.meta.url));
const {
  createCameraCandidateStore,
  createCameraC0Controller,
} = await moduleAt('../domain/camera/candidate.ts');
const { taskMessages } = await moduleAt('../i18n-task.ts');
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const domainSource = await read('../domain/camera/candidate.ts');
const pickerSource = await read('../components/cameraC0Picker.ts');
const hookSource = await read('../components/useM2Gateway.ts');
const flowSource = await read('../components/OpeningGoalFlow.tsx');
const previewSource = await read('../components/CameraLocalPreview.tsx');
const mealM5Source = await read('../domain/m5/meal-image-decision.ts');
const packageJson = JSON.parse(await read('../package.json'));
const appJson = JSON.parse(await read('../app.json'));

const scopeA = Object.freeze({ session_id: 'session-a', task_id: 'task-a', revision: 4 });
const scopeA2 = Object.freeze({ session_id: 'session-a', task_id: 'task-a', revision: 5 });
const scopeB = Object.freeze({ session_id: 'session-a', task_id: 'task-b', revision: 1 });
const localAsset = uri => Object.freeze({ uri, width: 1200, height: 900 });
const tests = [];
const test = (name, body) => tests.push({ name, body });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixturePicker(overrides = {}) {
  const calls = { permission: 0, camera: 0, library: 0 };
  const port = Object.freeze({
    requestCameraPermission: async () => {
      calls.permission += 1;
      return 'granted';
    },
    takePhoto: async () => {
      calls.camera += 1;
      return { canceled: false, asset: localAsset('file:///camera.jpg') };
    },
    choosePhoto: async () => {
      calls.library += 1;
      return { canceled: false, asset: localAsset('ph://library-photo') };
    },
    ...overrides,
  });
  return { calls, port };
}

test('creation requests no permission and opens no picker', () => {
  const store = createCameraCandidateStore();
  const { calls, port } = fixturePicker();
  createCameraC0Controller(store, port);
  assert.deepEqual(calls, { permission: 0, camera: 0, library: 0 });
  assert.deepEqual(store.getSnapshot(), { phase: 'IDLE' });
});

test('unbound or mismatched scope cannot start a native action', () => {
  const store = createCameraCandidateStore();
  assert.equal(store.begin(scopeA, 'CAMERA'), undefined);
  store.bind(scopeA);
  assert.equal(store.begin(scopeB, 'LIBRARY'), undefined);
});

test('camera denial is honest and never opens the camera', async () => {
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  const { calls, port } = fixturePicker({
    requestCameraPermission: async () => {
      calls.permission += 1;
      return 'denied';
    },
  });
  const controller = createCameraC0Controller(store, port);
  assert.equal(await controller.takePhoto(scopeA), true);
  assert.deepEqual(calls, { permission: 1, camera: 0, library: 0 });
  assert.equal(store.getSnapshot().issue, 'PERMISSION_DENIED');
  assert.equal(store.getSnapshot().candidate, undefined);
});

test('camera action requests only camera permission after explicit action', async () => {
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  const { calls, port } = fixturePicker();
  const controller = createCameraC0Controller(store, port);
  assert.deepEqual(calls, { permission: 0, camera: 0, library: 0 });
  assert.equal(await controller.takePhoto(scopeA), true);
  assert.deepEqual(calls, { permission: 1, camera: 1, library: 0 });
});

test('photo-library action uses the system picker without broad permission request', async () => {
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  const { calls, port } = fixturePicker();
  const controller = createCameraC0Controller(store, port);
  assert.equal(await controller.choosePhoto(scopeA), true);
  assert.deepEqual(calls, { permission: 0, camera: 0, library: 1 });
});

for (const source of ['CAMERA', 'LIBRARY']) test(source + ' native cancel creates no candidate', async () => {
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  const { port } = fixturePicker({
    ...(source === 'CAMERA' ? { takePhoto: async () => ({ canceled: true }) } : {}),
    ...(source === 'LIBRARY' ? { choosePhoto: async () => ({ canceled: true }) } : {}),
  });
  const controller = createCameraC0Controller(store, port);
  const result = source === 'CAMERA'
    ? await controller.takePhoto(scopeA)
    : await controller.choosePhoto(scopeA);
  assert.equal(result, true);
  assert.equal(store.getSnapshot().phase, 'IDLE');
  assert.equal(store.getSnapshot().candidate, undefined);
});

for (const source of ['CAMERA', 'LIBRARY']) test(source + ' success binds one local preview to exact task revision', async () => {
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  const { port } = fixturePicker();
  const controller = createCameraC0Controller(store, port);
  assert.equal(source === 'CAMERA'
    ? await controller.takePhoto(scopeA)
    : await controller.choosePhoto(scopeA), true);
  const candidate = store.getSnapshot().candidate;
  assert.ok(candidate);
  assert.equal(store.getSnapshot().phase, 'PREVIEW');
  assert.equal(candidate.session_id, scopeA.session_id);
  assert.equal(candidate.task_id, scopeA.task_id);
  assert.equal(candidate.revision, scopeA.revision);
  assert.equal(candidate.source, source);
  assert.match(candidate.local_uri, /^(?:file|ph):/u);
  assert.ok(Object.isFrozen(candidate));
});

test('Use photo requires explicit action and creates one exact local receipt', async () => {
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  const { port } = fixturePicker();
  await createCameraC0Controller(store, port).choosePhoto(scopeA);
  const before = store.getSnapshot();
  assert.equal(before.receipt, undefined);
  const receipt = store.accept(scopeA, before.candidate.candidate_id);
  assert.ok(receipt);
  assert.deepEqual(receipt, {
    session_id: scopeA.session_id,
    task_id: scopeA.task_id,
    revision: scopeA.revision,
    candidate_id: before.candidate.candidate_id,
    source: 'LIBRARY',
    local_uri: 'ph://library-photo',
    choice: 'USE_PHOTO',
  });
  assert.ok(Object.isFrozen(receipt));
  assert.equal(store.getSnapshot().phase, 'ACCEPTED');
});

test('duplicate Use photo is idempotent and publishes no second effect', async () => {
  const store = createCameraCandidateStore();
  let publishes = 0;
  store.subscribe(() => { publishes += 1; });
  store.bind(scopeA);
  const { port } = fixturePicker();
  await createCameraC0Controller(store, port).takePhoto(scopeA);
  const candidate = store.getSnapshot().candidate;
  const first = store.accept(scopeA, candidate.candidate_id);
  const beforeDuplicate = publishes;
  const duplicate = store.accept(scopeA, candidate.candidate_id);
  assert.equal(duplicate, first);
  assert.equal(publishes, beforeDuplicate);
});

test('retake after Use photo is blocked and preserves the accepted receipt', async () => {
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  let cameraSequence = 0;
  const { port } = fixturePicker({
    takePhoto: async () => ({
      canceled: false,
      asset: localAsset('file:///camera-' + ++cameraSequence + '.jpg'),
    }),
  });
  const controller = createCameraC0Controller(store, port);
  await controller.takePhoto(scopeA);
  const first = store.getSnapshot().candidate;
  store.accept(scopeA, first.candidate_id);
  const receipt = store.getSnapshot().receipt;
  assert.equal(await controller.takePhoto(scopeA), false);
  assert.equal(store.getSnapshot().candidate, first);
  assert.equal(store.getSnapshot().receipt, receipt);
});

test('reselect replaces the prior local candidate without accumulating a gallery', async () => {
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  let librarySequence = 0;
  const { port } = fixturePicker({
    choosePhoto: async () => ({
      canceled: false,
      asset: localAsset('ph://library-' + ++librarySequence),
    }),
  });
  const controller = createCameraC0Controller(store, port);
  await controller.choosePhoto(scopeA);
  const first = store.getSnapshot().candidate;
  await controller.choosePhoto(scopeA);
  const second = store.getSnapshot().candidate;
  assert.notEqual(second.candidate_id, first.candidate_id);
  assert.equal(store.getSnapshot().candidate, second);
  assert.equal(store.getSnapshot().receipt, undefined);
});

test('Cancel photo retires candidate and accepted receipt', async () => {
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  const { port } = fixturePicker();
  await createCameraC0Controller(store, port).choosePhoto(scopeA);
  store.accept(scopeA, store.getSnapshot().candidate.candidate_id);
  assert.equal(store.cancelFlow(scopeA), true);
  assert.equal(store.getSnapshot().phase, 'IDLE');
  assert.equal(store.getSnapshot().candidate, undefined);
  assert.equal(store.getSnapshot().receipt, undefined);
});

for (const [name, nextScope] of [
  ['revision change', scopeA2],
  ['task switch', scopeB],
  ['task cancel/inactive state', undefined],
]) test(name + ' retires candidate and receipt', async () => {
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  const { port } = fixturePicker();
  await createCameraC0Controller(store, port).choosePhoto(scopeA);
  store.accept(scopeA, store.getSnapshot().candidate.candidate_id);
  store.bind(nextScope);
  assert.equal(store.getSnapshot().candidate, undefined);
  assert.equal(store.getSnapshot().receipt, undefined);
  assert.equal(store.getSnapshot().scope?.task_id, nextScope?.task_id);
});

test('old native completion cannot attach to a newer task', async () => {
  let resolveCamera;
  const pendingCamera = new Promise(resolve => { resolveCamera = resolve; });
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  const { port } = fixturePicker({ takePhoto: () => pendingCamera });
  const pending = createCameraC0Controller(store, port).takePhoto(scopeA);
  await Promise.resolve();
  await Promise.resolve();
  store.bind(scopeB);
  resolveCamera({ canceled: false, asset: localAsset('file:///stale.jpg') });
  assert.equal(await pending, false);
  assert.equal(store.getSnapshot().scope.task_id, scopeB.task_id);
  assert.equal(store.getSnapshot().candidate, undefined);
});

test('permission completion after retire and same-task revision change launches no camera', async () => {
  const permission = deferred();
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  const { calls, port } = fixturePicker({
    requestCameraPermission: async () => {
      calls.permission += 1;
      return permission.promise;
    },
  });
  const pending = createCameraC0Controller(store, port).takePhoto(scopeA);
  await Promise.resolve();
  store.retire();
  store.bind(scopeA2);
  permission.resolve('granted');
  assert.equal(await pending, false);
  assert.deepEqual(calls, { permission: 1, camera: 0, library: 0 });
  assert.equal(store.getSnapshot().scope.revision, scopeA2.revision);
  assert.equal(store.getSnapshot().issue, undefined);
});

for (const [label, settle] of [
  ['denial', gate => gate.resolve('denied')],
  ['error', gate => gate.reject(new Error('stale permission'))],
]) test('stale permission ' + label + ' cannot publish into successor', async () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  const gate = { resolve, reject };
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  const { port } = fixturePicker({ requestCameraPermission: () => promise });
  const pending = createCameraC0Controller(store, port).takePhoto(scopeA);
  await Promise.resolve();
  store.retire();
  store.bind(scopeB);
  settle(gate);
  assert.equal(await pending, false);
  assert.equal(store.getSnapshot().scope.task_id, scopeB.task_id);
  assert.equal(store.getSnapshot().issue, undefined);
  assert.equal(store.getSnapshot().candidate, undefined);
});

test('one native operation serializes camera and library until exact settlement', async () => {
  const gate = deferred();
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  const { calls, port } = fixturePicker({ choosePhoto: async () => {
    calls.library += 1;
    return gate.promise;
  } });
  const controller = createCameraC0Controller(store, port);
  const first = controller.choosePhoto(scopeA);
  assert.equal(store.isBusy(), true);
  assert.equal(await controller.takePhoto(scopeA), false);
  assert.equal(await controller.choosePhoto(scopeA), false);
  store.retire();
  store.bind(scopeA2);
  assert.equal(store.isBusy(), true);
  assert.equal(await controller.choosePhoto(scopeA2), false);
  gate.resolve({ canceled: false, asset: localAsset('ph://stale-operation') });
  assert.equal(await first, false);
  assert.equal(store.isBusy(), false);
  assert.deepEqual(calls, { permission: 0, camera: 0, library: 1 });
});

test('copied request and reentrant publication cannot borrow current request identity', async () => {
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  const issued = store.begin(scopeA, 'LIBRARY');
  const copied = Object.freeze({ ...issued, scope: Object.freeze({ ...issued.scope }) });
  assert.equal(store.isCurrentRequest(copied), false);
  assert.equal(store.cancelNative(copied), false);
  store.settle(issued);
  let reentered = false;
  const unsubscribe = store.subscribe(() => {
    if (!reentered && store.getSnapshot().phase === 'PICKING') {
      reentered = true;
      store.retire();
      store.bind(scopeA2);
    }
  });
  const { calls, port } = fixturePicker();
  assert.equal(await createCameraC0Controller(store, port).choosePhoto(scopeA), false);
  unsubscribe();
  assert.equal(calls.library, 0);
  assert.equal(store.getSnapshot().scope.revision, scopeA2.revision);
});

test('stale preview action cannot attach or accept against another task', async () => {
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  const { port } = fixturePicker();
  await createCameraC0Controller(store, port).choosePhoto(scopeA);
  const staleCandidateId = store.getSnapshot().candidate.candidate_id;
  store.bind(scopeB);
  assert.equal(store.accept(scopeA, staleCandidateId), undefined);
  assert.equal(store.accept(scopeB, staleCandidateId), undefined);
});

test('remote or inline image data is rejected', () => {
  for (const uri of ['https://example.com/image.jpg', 'data:image/jpeg;base64,AAAA']) {
    const store = createCameraCandidateStore();
    store.bind(scopeA);
    const request = store.begin(scopeA, 'LIBRARY');
    assert.equal(store.complete(request, localAsset(uri)), false);
    assert.equal(store.getSnapshot().candidate, undefined);
    assert.equal(store.getSnapshot().issue, 'UNAVAILABLE');
  }
});

test('native error becomes recoverable unavailable state', async () => {
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  const { port } = fixturePicker({ choosePhoto: async () => { throw new Error('fixture'); } });
  assert.equal(await createCameraC0Controller(store, port).choosePhoto(scopeA), true);
  assert.equal(store.getSnapshot().issue, 'UNAVAILABLE');
  assert.equal(store.getSnapshot().candidate, undefined);
});

test('component/session retirement clears all local image authority', async () => {
  const store = createCameraCandidateStore();
  store.bind(scopeA);
  const { port } = fixturePicker();
  await createCameraC0Controller(store, port).takePhoto(scopeA);
  store.accept(scopeA, store.getSnapshot().candidate.candidate_id);
  store.retire();
  assert.deepEqual(store.getSnapshot(), { phase: 'IDLE' });
});

test('domain and adapter contain no network, persistence, logging, EXIF or base64 collection', () => {
  assert.doesNotMatch(domainSource, /\bfetch\s*\(|AsyncStorage|database|console\.|provider|OpenAI/iu);
  assert.doesNotMatch(pickerSource, /\bfetch\s*\(|AsyncStorage|database|console\.|provider|OpenAI/iu);
  assert.match(pickerSource, /base64:\s*false/u);
  assert.match(pickerSource, /exif:\s*false/u);
  assert.match(pickerSource, /mediaTypes:\s*\['images'\]/u);
  assert.doesNotMatch(pickerSource, /requestMediaLibraryPermissionsAsync/u);
});

test('installed picker and native permission config are minimal and microphone-free', () => {
  assert.equal(packageJson.dependencies?.['expo-image-picker'] ?? packageJson.devDependencies?.['expo-image-picker'], '~57.0.16');
  const plugin = appJson.expo.plugins.find(value => Array.isArray(value)
    && value[0] === 'expo-image-picker');
  assert.ok(plugin);
  assert.equal(plugin[1].microphonePermission, false);
  assert.match(plugin[1].cameraPermission, /camera/iu);
  assert.match(plugin[1].photosPermission, /photo/iu);
});

test('all 8 release locales contain complete Camera C0 static copy', () => {
  const locales = ['vi', 'en', 'zh-Hans', 'es', 'hi', 'ja', 'ko', 'ru'];
  const keys = [
    'cameraEntry', 'cameraTake', 'cameraChoose', 'cameraPreview', 'cameraRetake',
    'cameraChooseAgain', 'cameraCancel', 'cameraUse', 'cameraSelected',
    'cameraSelectedNotice', 'cameraPermissionDenied', 'cameraUnavailable',
  ];
  assert.deepEqual(Object.keys(taskMessages).sort(), locales.sort());
  for (const locale of locales) {
    for (const key of keys) assert.ok(taskMessages[locale][key]?.trim(), locale + ':' + key);
  }
  assert.notEqual(taskMessages.vi.cameraUse, taskMessages.ko.cameraUse);
  assert.notEqual(taskMessages.ko.cameraUse, taskMessages['zh-Hans'].cameraUse);
  assert.notEqual(taskMessages['zh-Hans'].cameraUse, taskMessages.ja.cameraUse);
});

test('UI exposes explicit local preview/use/replace/cancel controls with accessible sizing', () => {
  for (const id of [
    'camera-c0-panel', 'camera-c0-take', 'camera-c0-choose',
    'camera-c0-replace', 'camera-c0-cancel', 'camera-c0-use',
  ]) assert.match(flowSource, new RegExp('testID="' + id + '"', 'u'));
  assert.doesNotMatch(flowSource, /m2\.cameraC0\.candidate\.local_uri/u);
  assert.match(flowSource, /React\.createElement\(camera\.candidate\.previewHandle/u);
  assert.match(previewSource, /testID="camera-c0-preview"/u);
  assert.match(flowSource, /usePhoto=\{m2\.useCameraPhoto\}/u);
  assert.match(flowSource, /minHeight:\s*44/u);
  assert.match(flowSource, /minHeight:\s*48/u);
  assert.match(flowSource, /numberOfLines=\{2\}/u);
  assert.match(flowSource, /minimumFontScale=\{0\.82\}/u);
});

test('host exposes Camera only at the existing meal-image task seam', () => {
  const eligibilitySource = hookSource.slice(
    hookSource.indexOf('const cameraEligible'), hookSource.indexOf('const cameraScope'),
  );
  assert.match(eligibilitySource, /task_kind === 'meal_image_assessment'/u);
  assert.match(eligibilitySource, /intent_type === 'CURRENT_TASK'/u);
  assert.match(eligibilitySource, /\['READY', 'AWAITING_INPUT'\]\.includes\(activeTask\.status\)/u);
  assert.match(hookSource, /cameraStore\.retire\(\)/u);
  assert.doesNotMatch(eligibilitySource, /general_health|body_composition|strength|movement/iu);
  assert.match(hookSource, /mayOfferCameraForM4\(current\.scope, assessment\)/u);
});

test('meal-image analysis capability remains unavailable', () => {
  assert.match(mealM5Source, /meal_image_assessment:\s*"NOT_AVAILABLE"/u);
  assert.doesNotMatch(mealM5Source, /meal_image_assessment:\s*"AVAILABLE"/u);
});

for (const { name, body } of tests) {
  await body();
  console.log('PASS ' + name);
}
assert.equal(networkCalls, 0);
console.log('Camera C0: ' + tests.length + '/' + tests.length + ' PASS; provider/network calls = 0; device runtime NOT_RUN.');
