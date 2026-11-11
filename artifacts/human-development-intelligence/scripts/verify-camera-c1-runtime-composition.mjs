import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { OWNER_A, OWNER_B, FakeClock, fakeAuthority } from './fixtures/local-owner.mjs';

process.env.EXPO_PUBLIC_M3_RUNTIME_MODE = 'fixture';

const appRoot = resolve(import.meta.dirname, '..');
const moduleAt = (path) => pathToFileURL(resolve(appRoot, path)).href;
const openingFlowSource = readFileSync(resolve(appRoot, 'components/OpeningGoalFlow.tsx'), 'utf8');

function loadCameraRenderHarness() {
  const start = openingFlowSource.indexOf('// CAMERA_RENDER_HARNESS_START');
  const end = openingFlowSource.indexOf('// CAMERA_RENDER_HARNESS_END');
  assert.ok(start >= 0 && end > start, 'Camera render harness must remain in the actual component');
  const source = openingFlowSource.slice(start, end).replaceAll('export function', 'function');
  const output = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const React = {
    Fragment: 'Fragment',
    createElement(type, props, ...children) {
      if (typeof type === 'function') return type({ ...(props ?? {}), children });
      return { type, props: { ...(props ?? {}), children } };
    },
  };
  const styles = new Proxy({}, { get: (_target, key) => String(key) });
  return Function('React', 'View', 'Text', 'Pressable', 'styles', `${output}
    return { CameraAcquisitionControls, CameraReplacementControl, CameraRetainedControls,
      CameraC0Panel, CameraCleanupWarning };`)(
    React, 'View', 'Text', 'Pressable', styles,
  );
}

const renderedTestIds = (tree, found = []) => {
  if (Array.isArray(tree)) {
    for (const child of tree) renderedTestIds(child, found);
    return found;
  }
  if (!tree || typeof tree !== 'object') return found;
  if (tree.props?.testID) found.push(tree.props.testID);
  for (const child of tree.props?.children ?? []) renderedTestIds(child, found);
  return found;
};

function assertCameraC0PanelWiring() {
  const sourceFile = ts.createSourceFile('OpeningGoalFlow.tsx', openingFlowSource,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let openingGoalFlow;
  const findOpeningGoalFlow = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'OpeningGoalFlow') {
      openingGoalFlow = node;
    }
    ts.forEachChild(node, findOpeningGoalFlow);
  };
  findOpeningGoalFlow(sourceFile);
  assert.ok(openingGoalFlow?.body, 'OpeningGoalFlow must remain a function declaration with a body');

  const invocations = [];
  let rawEntryInParent = false;
  const inspect = (node) => {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(sourceFile) === 'CameraC0Panel') {
      invocations.push(node);
    } else if (ts.isJsxSelfClosingElement(node)
      && node.tagName.getText(sourceFile) === 'CameraC0Panel') {
      invocations.push(node);
    }
    if (ts.isPropertyAccessExpression(node)
      && node.getText(sourceFile) === 'm2.cameraC0.entry') {
      rawEntryInParent = true;
    }
    ts.forEachChild(node, inspect);
  };
  inspect(openingGoalFlow.body);
  assert.equal(invocations.length, 1, 'OpeningGoalFlow must invoke CameraC0Panel exactly once');

  const attributes = new Map();
  for (const attribute of invocations[0].attributes.properties) {
    if (ts.isJsxAttribute(attribute)) {
      attributes.set(attribute.name.text, attribute.initializer?.getText(sourceFile) ?? '');
    }
  }
  assert.match(attributes.get('active') ?? '', /m2\.activeM3Task/);
  assert.match(attributes.get('camera') ?? '', /m2\.cameraC0/);
  assert.match(attributes.get('colors') ?? '', /colors/);
  assert.match(attributes.get('takePhoto') ?? '', /m2\.takeCameraPhoto/);
  assert.match(attributes.get('choosePhoto') ?? '', /m2\.chooseCameraPhoto/);
  assert.match(attributes.get('cancelPhoto') ?? '', /m2\.cancelCameraPhoto/);
  assert.match(attributes.get('usePhoto') ?? '', /m2\.useCameraPhoto/);
  assert.equal(rawEntryInParent, false,
    'OpeningGoalFlow parent must not render m2.cameraC0.entry outside CameraC0Panel');
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'expo-file-system/legacy') return {
      url: 'data:text/javascript,export const cacheDirectory="file:///app/cache/";export const getInfoAsync=async()=>({exists:true,isDirectory:false});export const deleteAsync=async(uri,options)=>{globalThis.__cameraFileDeletes.push({uri,options});if(globalThis.__cameraDeleteGate)await globalThis.__cameraDeleteGate.promise;if(globalThis.__cameraDeleteFailure)throw Error("DELETE_FAILED")}',
      shortCircuit: true,
    };
    if (specifier === 'expo-image-manipulator') return {
      url: 'data:text/javascript,export const SaveFormat=globalThis.__cameraImageRuntime.SaveFormat;export const ImageManipulator=globalThis.__cameraImageRuntime.ImageManipulator',
      shortCircuit: true,
    };
    if (specifier === 'react') return {
      url: 'data:text/javascript,' + encodeURIComponent(
        'export const useState=(...a)=>globalThis.__cameraHooks.useState(...a);'
        + 'export const useRef=(...a)=>globalThis.__cameraHooks.useRef(...a);'
        + 'export const useEffect=(...a)=>globalThis.__cameraHooks.useEffect(...a);'
        + 'export const useLayoutEffect=(...a)=>globalThis.__cameraHooks.useLayoutEffect(...a);'
        + 'export const useSyncExternalStore=(...a)=>globalThis.__cameraHooks.useSyncExternalStore(...a);'),
      shortCircuit: true,
    };
    if (specifier === '@workspace/api-client-react') return {
      url: 'data:text/javascript,export const aiM3=()=>{throw Error("CLIENT_FORBIDDEN")};export const aiM3Permission=aiM3;export const aiPilotSession=aiM3',
      shortCircuit: true,
    };
    if (specifier === './cameraC0Picker' && context.parentURL?.endsWith('/useM2Gateway.ts')) return {
      url: 'data:text/javascript,export const expoCameraC0Picker=globalThis.__cameraPicker',
      shortCircuit: true,
    };
    if (specifier === './CameraLocalPreview.tsx' && context.parentURL?.endsWith('/useM2Gateway.ts')) return {
      url: 'data:text/javascript,export const createCameraLocalPreviewHandle=()=>()=>null',
      shortCircuit: true,
    };
    if (specifier.startsWith('@/')) return nextResolve(moduleAt(specifier.slice(2) + '.ts'), context);
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? specifier + '.ts' : specifier, context);
  },
});

let networkCalls = 0;
globalThis.fetch = () => { networkCalls += 1; throw new Error('NETWORK_FORBIDDEN_IN_CAMERA_COMPOSITION'); };
globalThis.__cameraFileDeletes = [];
globalThis.__cameraDeleteFailure = false;
globalThis.__cameraDeleteGate = undefined;
let preparedSequence = 0;
let saveGate;
globalThis.__cameraImageRuntime = Object.freeze({
  SaveFormat: Object.freeze({ JPEG: 'jpeg' }),
  ImageManipulator: Object.freeze({ manipulate() {
    return { async renderAsync() {
      return { width: 800, height: 600, async saveAsync() {
        if (saveGate) await saveGate.promise;
        return { uri: `file:///app/cache/prepared-${++preparedSequence}.jpg`,
          width: 800, height: 600 };
      } };
    } };
  } }),
});
let choosePhotoResult = async () => ({ canceled: false, asset: { uri: 'ph://library-photo' } });
globalThis.__cameraPicker = Object.freeze({
  async requestCameraPermission() { return 'granted'; },
  async takePhoto() { return { canceled: false, asset: { uri: 'file:///camera-photo.jpg' } }; },
  async choosePhoto() { return choosePhotoResult(); },
});

function hookRuntime() {
  const slots = [];
  let cursor = 0;
  const effects = [];
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (next) => {
        slots[index].value = typeof next === 'function' ? next(slots[index].value) : next;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: { current: initial } };
      return slots[index].value;
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      cursor++;
      return getSnapshot();
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || dependencies.some((value, at) => !Object.is(value, previous.dependencies[at]))) {
        effects.push({ index, effect, dependencies });
      }
    },
    useLayoutEffect(effect, dependencies) {
      hooks.useEffect(effect, dependencies);
    },
  };
  return {
    hooks,
    slots,
    cleanupEffects() {
      for (let index = slots.length - 1; index >= 0; index--) {
        if (slots[index]?.cleanup) {
          slots[index].cleanup();
          slots[index] = undefined;
        }
      }
    },
    render(fn) {
      cursor = 0;
      effects.length = 0;
      const view = fn();
      for (const { index, effect, dependencies } of effects) {
        slots[index]?.cleanup?.();
        slots[index] = { dependencies, cleanup: effect() };
      }
      return view;
    },
  };
}

globalThis.__cameraHooks = hookRuntime().hooks;
const { useM2Gateway } = await import(moduleAt('components/useM2Gateway.ts'));
const { m2Messages } = await import(moduleAt('i18n-m2.ts'));
const { taskMessages } = await import(moduleAt('i18n-task.ts'));
const { M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE } = await import(moduleAt('domain/m5/meal-image-decision.ts'));
const { createLocalOwnerBoundary } = await import(moduleAt('domain/local-owner/boundary.ts'));
const t = (key) => m2Messages.vi[key] ?? key;
const mealMeaning = Object.freeze({
  intent_type: 'CURRENT_TASK', interpreted_meaning: 'Đánh giá bữa ăn bằng ảnh', confidence: 0.9,
  uncertainty: null, missing_context: [], clarification_needed: false, clarification_question: null,
  safety_state: 'CLEAR', suggested_next_role: 'M4', task_kind: 'meal_image_assessment',
  context_effect: 'NONE', used_context_ids: [], response: 'Đã hiểu yêu cầu.',
});
const adapter = Object.freeze({
  provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
  async interpret() { return mealMeaning; }, async revoke() {},
});
const gateway = {
  snapshot: {
    revision: '1', subject: { id: 'test-person', loading: 'ready', profile: 'unknown' },
    permission: { status: 'allowed', revision: '1' }, safety: 'clear', goal: 'none',
    explicitIntent: false, activeTask: { kind: 'none' }, returning: { kind: 'none' },
  },
  m3StubAdapter: adapter,
};

function fixture({ withOwner = false } = {}) {
  const runtime = hookRuntime();
  globalThis.__cameraHooks = runtime.hooks;
  let locale = 'vi';
  let ownerReady = true;
  const ownerScope = Object.freeze({ owner: { subjectId: 'test-person', profileId: 'profile-1' },
    generation: 1, validUntil: Date.now() + 60_000 });
  const ownerSession = withOwner ? {
    lease: Object.freeze({}),
    access: Object.freeze({
      subscribe: () => () => {},
      getSnapshot: () => ownerReady ? { phase: 'READY', ...ownerScope }
        : { phase: 'LOCKED', generation: 2 },
      requireLease: () => {
        if (!ownerReady) throw Error('STALE_LEASE');
        return ownerScope;
      },
    }),
  } : undefined;
  const render = () => runtime.render(() => useM2Gateway(gateway, locale, t, ownerSession,
    undefined, withOwner ? 'OWNED' : 'ANONYMOUS'));
  const findC1 = () => runtime.slots.map((slot) => slot?.value?.current)
    .find((value) => value && typeof value.consume === 'function' && typeof value.project === 'function'
      && typeof value.assess === 'function');
  const findTaskStore = () => runtime.slots.map((slot) => slot?.value?.current)
    .find((value) => value && typeof value.assessM4 === 'function' && typeof value.assessM5 === 'function')
    ?? runtime.slots.map((slot) => slot?.value).find((value) => value
      && typeof value.currentSlot === 'function')?.currentSlot()?.store;
  const findC0 = () => runtime.slots.map((slot) => slot?.value?.current)
    .find((value) => value && typeof value.accept === 'function' && typeof value.cancelFlow === 'function');
  const findC2 = () => runtime.slots.map((slot) => slot?.value?.current ?? slot?.value)
    .find((value) => value && typeof value.currentReceipt === 'function'
      && typeof value.settleCleanup === 'function');
  return { render, findC1, findC0, findC2, findTaskStore,
    cleanupEffects: runtime.cleanupEffects,
    setLocale(value) { locale = value; }, retireOwner() { ownerReady = false; } };
}

// The cross-layer fixture keeps the real hook, task/C0/C1/C2 stores, and owner boundary.
// Only native photo/preparation/cache ports above are deterministic doubles.
function realOwnerFixture() {
  const runtime = hookRuntime();
  globalThis.__cameraHooks = runtime.hooks;
  const clock = new FakeClock();
  let authority = fakeAuthority();
  let boundary = createLocalOwnerBoundary(authority.verifier, clock);
  let ownerSession, currentGateway, locale = 'vi', mode = 'BLOCKED';
  const gatewayFor = (owner) => ({
    ...gateway,
    snapshot: { ...gateway.snapshot, subject: { ...gateway.snapshot.subject, id: owner.subjectId } },
  });
  const find = (predicate) => runtime.slots.map((slot) => slot?.value?.current ?? slot?.value).find(predicate);
  return {
    startAnonymous(owner) {
      ownerSession = undefined;
      mode = 'ANONYMOUS';
      currentGateway = gatewayFor(owner);
    },
    async verify(owner) {
      authority.results.push({ status: 'verified', owner, validUntil: clock.now() + 1_000_000 });
      const lease = await boundary.control.verifySession();
      boundary.control.finishHydration(lease);
      ownerSession = Object.freeze({ access: boundary.access, lease });
      mode = 'OWNED';
      currentGateway = gatewayFor(owner);
      return ownerSession;
    },
    logout() { boundary.control.invalidateCurrentSession(); mode = 'BLOCKED'; },
    currentSession() { return ownerSession; },
    replaceAuthorization() {
      ownerSession = Object.freeze({ ...ownerSession, authorization: Object.freeze({}) });
    },
    replaceBoundary() {
      authority = fakeAuthority();
      boundary = createLocalOwnerBoundary(authority.verifier, clock);
    },
    setLocale(value) { locale = value; },
    setMode(value) { mode = value; },
    cleanupEffects: runtime.cleanupEffects,
    render() { return runtime.render(() => useM2Gateway(currentGateway, locale, t, ownerSession,
      undefined, mode)); },
    findC0: () => find((value) => value && typeof value.accept === 'function'
      && typeof value.cancelFlow === 'function'),
    findC1: () => find((value) => value && typeof value.consume === 'function'
      && typeof value.project === 'function' && typeof value.assess === 'function'),
    findC2: () => find((value) => value && typeof value.currentReceipt === 'function'
      && typeof value.settleCleanup === 'function'),
    findM3Lifetime: () => find((value) => value && typeof value.currentSlot === 'function'),
    findTaskStore: () => find((value) => value && typeof value.currentSlot === 'function')
      ?.currentSlot()?.store,
  };
}

async function readyRealOwnerA() {
  const h = realOwnerFixture();
  await h.verify(OWNER_A);
  h.render();
  let view = h.render();
  view.submit('Đánh giá ảnh bữa ăn');
  await tick();
  view = h.render(); view = h.render();
  assert.ok(view.cameraC0);
  assert.equal(view.cameraC0.acquisitionAllowed, true);
  return { h, view };
}

async function preparedRealOwnerA() {
  const { h, view: ready } = await readyRealOwnerA();
  let view = ready;
  assert.equal(await view.chooseCameraPhoto(), true);
  view = h.render();
  assert.equal(view.cameraC0.phase, 'PREVIEW');
  assert.equal(view.useCameraPhoto(), true);
  view = h.render();
  assert.equal(view.allowCameraPhotoForTask(), true);
  view = h.render();
  assert.equal(view.cameraC2?.state, 'CONSENT_REQUIRED');
  assert.equal(await view.allowExternalProcessingAndPrepare(view.cameraC2.view_token), true);
  view = h.render();
  assert.equal(view.cameraC2?.state, 'PREPARED_NOT_SENT');
  return { h, view };
}

async function locallyAllowedRealOwnerA() {
  const { h, view: ready } = await readyRealOwnerA();
  let view = ready;
  assert.equal(await view.chooseCameraPhoto(), true);
  view = h.render();
  assert.equal(view.useCameraPhoto(), true);
  view = h.render();
  assert.equal(view.allowCameraPhotoForTask(), true);
  view = h.render();
  assert.equal(view.cameraC1?.state, 'LOCAL_ALLOWED');
  return { h, view };
}

const tick = () => new Promise((done) => setImmediate(done));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
async function acceptedMealFixture(options) {
  const h = await readyMealFixture(options);
  let view = h.view;
  assert.equal(await view.chooseCameraPhoto(), true);
  view = h.render();
  assert.equal(view.cameraC0.phase, 'PREVIEW');
  assert.equal(view.useCameraPhoto(), true);
  view = h.render();
  assert.equal(view.cameraC0.accepted, true);
  return { ...h, view };
}

async function readyMealFixture(options) {
  const h = fixture(options);
  h.render();
  let view = h.render();
  view.submit('Đánh giá ảnh bữa ăn');
  await tick();
  view = h.render();
  view = h.render();
  assert.ok(view.cameraC0, 'real host offers C0 for the current meal-image task');
  assert.equal(view.cameraC0.acquisitionAllowed, true);
  return { ...h, view };
}

const scopeOf = (h) => {
  const scope = h.findC0().getSnapshot().scope;
  assert.ok(scope);
  return scope;
};
const activeTask = (h) => {
  const snapshot = h.findTaskStore().getSnapshot();
  return snapshot.tasks.find((task) => task.task_id === snapshot.active_task_id);
};
const m4 = (h, projection) => h.findC1().assess(activeTask(h), projection).decision.state;

test('actual Camera panel gates invitation while preserving retained controls and children', () => {
  assertCameraC0PanelWiring();
  const rendered = loadCameraRenderHarness();
  const colors = {
    welcomeGoalChipBorder: '#111', welcomeGoalChipPressed: '#222',
    welcomeGoalChip: '#333', welcomeText: '#444',
    welcomeGoalInputFocus: '#555', welcomeGoalChipSelected: '#666',
  };
  const calls = { take: 0, choose: 0, cancel: 0, use: 0 };
  const takePhoto = async () => { calls.take += 1; return true; };
  const choosePhoto = async () => { calls.choose += 1; return true; };
  const cancelPhoto = () => { calls.cancel += 1; return true; };
  const usePhoto = () => { calls.use += 1; return true; };
  const previewHandle = (props) => ({
    type: 'Preview',
    props: { ...props, testID: 'camera-preview-probe', children: [] },
  });
  const baseCamera = {
    acquisitionAllowed: true, replacementAllowed: false, busy: false,
    entry: 'Add a current meal photo', take_photo: 'Take', choose_photo: 'Choose',
    retake: 'Retake', choose_again: 'Choose again', cancel: 'Cancel',
    selected: 'Selected', use_photo: 'Use', preview: 'Preview',
  };

  assert.equal(rendered.CameraC0Panel({
    active: false, camera: baseCamera, colors, takePhoto, choosePhoto, cancelPhoto, usePhoto,
  }), null);
  assert.equal(rendered.CameraC0Panel({
    active: true, camera: undefined, colors, takePhoto, choosePhoto, cancelPhoto, usePhoto,
  }), null);

  const acquisition = rendered.CameraC0Panel({
    active: true, camera: baseCamera, colors, takePhoto, choosePhoto, cancelPhoto, usePhoto,
  });
  assert.deepEqual(renderedTestIds(acquisition), [
    'camera-c0-panel', 'camera-c0-entry',
    'camera-c0-acquisition-actions', 'camera-c0-take', 'camera-c0-choose',
  ]);

  const unavailable = rendered.CameraC0Panel({
    active: true, camera: { ...baseCamera, acquisitionAllowed: false },
    colors, takePhoto, choosePhoto, cancelPhoto, usePhoto,
  });
  assert.deepEqual(renderedTestIds(unavailable), ['camera-c0-panel']);

  const childProbe = { type: 'View', props: { testID: 'camera-child-probe', children: [] } };
  const retainedWithoutAcquisition = rendered.CameraC0Panel({
    active: true,
    camera: {
      ...baseCamera, acquisitionAllowed: false, replacementAllowed: false,
      candidate: { source: 'LIBRARY', previewHandle }, accepted: false,
    },
    colors, takePhoto, choosePhoto, cancelPhoto, usePhoto, children: [childProbe],
  });
  assert.deepEqual(renderedTestIds(retainedWithoutAcquisition), [
    'camera-c0-panel', 'camera-preview-probe', 'camera-c0-cancel', 'camera-c0-use',
    'camera-child-probe',
  ]);

  const replaceable = rendered.CameraC0Panel({
    active: true,
    camera: {
      ...baseCamera, acquisitionAllowed: true, replacementAllowed: true,
      candidate: { source: 'LIBRARY', previewHandle }, accepted: false,
    },
    colors, takePhoto, choosePhoto, cancelPhoto, usePhoto,
  });
  assert.deepEqual(renderedTestIds(replaceable), [
    'camera-c0-panel', 'camera-c0-entry', 'camera-preview-probe',
    'camera-c0-replace', 'camera-c0-cancel', 'camera-c0-use',
  ]);

  const accepted = rendered.CameraC0Panel({
    active: true,
    camera: {
      ...baseCamera, acquisitionAllowed: false, replacementAllowed: false,
      candidate: { source: 'LIBRARY', previewHandle }, accepted: true,
    },
    colors, takePhoto, choosePhoto, cancelPhoto, usePhoto,
  });
  assert.deepEqual(renderedTestIds(accepted), [
    'camera-c0-panel', 'camera-preview-probe', 'camera-c0-cancel', 'camera-c0-use',
  ]);

  const warning = rendered.CameraCleanupWarning({
    cleanup: { status: 'UNCONFIRMED', copy: 'Cleanup not confirmed' }, colors,
  });
  assert.deepEqual(renderedTestIds(warning), ['camera-cleanup-warning']);
  assert.equal(rendered.CameraCleanupWarning({ cleanup: undefined, colors }), null);
  assert.deepEqual(calls, { take: 0, choose: 0, cancel: 0, use: 0 },
    'render-only panel checks must not invoke Camera callbacks');
});

test('C0 acceptance creates one C1 UNKNOWN context; real M4 requires permission', async () => {
  const h = await acceptedMealFixture();
  const c1 = h.findC1();
  assert.ok(c1, 'current host must instantiate C1');
  assert.equal(c1.getSnapshot()?.external_readiness, 'LOCAL_ONLY');
  const projection = c1.project(scopeOf(h));
  assert.equal(projection.permission.status, 'unknown');
  assert.equal(m4(h, projection), 'PERMISSION_REQUIRED');
  assert.equal(h.view.cameraC1?.state, 'NEEDS_LOCAL_PERMISSION');
  assert.equal(h.view.m3Notice, taskMessages.vi.imagePermission);
  const contextId = c1.getSnapshot()?.context_id;
  assert.equal(h.view.useCameraPhoto(), false);
  assert.equal(c1.getSnapshot()?.context_id, contextId);
  assert.equal(JSON.stringify(projection).match(/file:|ph:|uri|path|base64|bytes|EXIF|GPS/i), null);
  assert.equal(JSON.stringify(h.view.cameraC1).match(/file:|ph:|uri|context_id|permission_revision/i), null);
  assert.equal(networkCalls, 0);
});

test('render, pick and preview never grant C1; accepted image does not imply external consent', async () => {
  const h = fixture();
  h.render();
  let view = h.render();
  view.submit('Đánh giá ảnh bữa ăn');
  await tick();
  view = h.render(); view = h.render();
  assert.equal(h.findC1().getSnapshot(), undefined);
  assert.equal(await view.takeCameraPhoto(), true);
  view = h.render();
  assert.equal(view.cameraC0.phase, 'PREVIEW');
  assert.equal(h.findC1().getSnapshot(), undefined);
  assert.equal(view.cameraC1, undefined);
  assert.equal(networkCalls, 0);
});

test('explicit allow makes M4 sufficient, M5 still unsupported, double allow is inert', async () => {
  const h = await acceptedMealFixture();
  const before = h.findC1().getSnapshot();
  assert.equal(h.view.allowCameraPhotoForTask(), true);
  const view = h.render();
  const after = h.findC1().getSnapshot();
  const projection = h.findC1().project(scopeOf(h));
  assert.equal(view.cameraC1.state, 'LOCAL_ALLOWED');
  assert.equal(m4(h, projection), 'CONTEXT_SUFFICIENT');
  const store = h.findTaskStore();
  const ref = store.reference(activeTask(h).task_id);
  const m5 = store.assessM5(ref, store.assessM4(ref, projection), M5_MEAL_IMAGE_CAPABILITY_UNAVAILABLE);
  assert.equal(m5.state, 'UNSUPPORTED');
  assert.equal(m5.reason, 'MEAL_IMAGE_CAPABILITY_NOT_AVAILABLE');
  assert.equal(view.allowCameraPhotoForTask(), false);
  assert.equal(h.findC1().getSnapshot()?.permission_revision, after.permission_revision);
  assert.ok(after.permission_revision > before.permission_revision);
  assert.match(view.m3Notice, /chưa thể đánh giá bữa ăn từ ảnh/);
  assert.equal(networkCalls, 0);
});

test('explicit decline is final for current scope, M4 declined without re-ask', async () => {
  const h = await acceptedMealFixture();
  assert.equal(h.view.declineCameraPhotoForTask(), true);
  const view = h.render();
  assert.equal(view.cameraC1.state, 'LOCAL_DECLINED');
  assert.equal(m4(h, h.findC1().project(scopeOf(h))), 'CONTEXT_DECLINED');
  assert.equal(view.m3Notice, taskMessages.vi.imageDeclined);
  assert.equal(view.allowCameraPhotoForTask(), false);
  assert.equal(view.declineCameraPhotoForTask(), false);
});

test('revoke invalidates old sufficient projection and current M4 is not sufficient', async () => {
  const h = await acceptedMealFixture();
  assert.equal(h.view.allowCameraPhotoForTask(), true);
  let view = h.render();
  const old = h.findC1().project(scopeOf(h));
  assert.equal(m4(h, old), 'CONTEXT_SUFFICIENT');
  assert.equal(view.revokeCameraPhotoForTask(), true);
  view = h.render();
  assert.notEqual(m4(h, old), 'CONTEXT_SUFFICIENT');
  assert.notEqual(m4(h, h.findC1().project(scopeOf(h))), 'CONTEXT_SUFFICIENT');
  assert.equal(view.cameraC1.state, 'LOCAL_DECLINED');
});

test('accepted photo cannot be replaced; withdrawal preserves a negative C1 fact', async () => {
  const h = await acceptedMealFixture();
  assert.equal(h.view.allowCameraPhotoForTask(), true);
  let view = h.render();
  const old = h.findC1().getSnapshot();
  const oldProjection = h.findC1().project(scopeOf(h));
  assert.equal(view.cameraC0.replacementAllowed, false);
  assert.equal(await view.chooseCameraPhoto(), false);
  assert.deepEqual(h.findC1().getSnapshot(), old);
  assert.equal(m4(h, oldProjection), 'CONTEXT_SUFFICIENT');
  assert.equal(view.cancelCameraPhoto(), true);
  view = h.render();
  assert.equal(h.findC1().getSnapshot(), undefined);
  assert.equal(h.findC0().getSnapshot().receipt, undefined);
  assert.equal(h.findC1().project(scopeOf(h)).image.state, 'declined');
  assert.equal(view.cameraC0, undefined);
  assert.equal(await view.chooseCameraPhoto(), false);
});

test('locale changes presentation without mutating C1 authority', async () => {
  const h = await acceptedMealFixture();
  const before = h.findC1().getSnapshot();
  const vi = h.view.cameraC1.prompt;
  h.setLocale('en');
  const view = h.render();
  assert.notEqual(view.cameraC1.prompt, vi);
  assert.deepEqual(h.findC1().getSnapshot(), before);
  assert.equal(view.cameraC1.state, 'NEEDS_LOCAL_PERMISSION');
});

test('edit and cancel each retire C0 and C1 authority', async () => {
  for (const action of ['edit', 'cancel']) {
    const h = await acceptedMealFixture();
    assert.equal(h.view.allowCameraPhotoForTask(), true);
    const old = h.findC1().getSnapshot();
    const changed = action === 'edit'
      ? h.view.editM3Task('Đánh giá ảnh bữa trưa')
      : h.view.cancelM3Task();
    assert.equal(changed, true);
    assert.equal(h.findC1().getSnapshot(), undefined);
    assert.equal(h.findC0().getSnapshot().receipt, undefined);
    assert.equal(h.findC1().allow(old), undefined);
    const view = h.render();
    assert.equal(view.cameraC1, undefined);
  }
});

test('switching tasks cannot carry old C1 permission or receipt', async () => {
  const h = fixture();
  h.render();
  let view = h.render();
  view.submit('Đánh giá ảnh bữa sáng');
  await tick(); view = h.render(); view = h.render();
  const first = view.activeM3Task.id;
  view.submit('Đánh giá ảnh bữa tối');
  await tick(); view = h.render(); view = h.render();
  const second = view.activeM3Task.id;
  assert.notEqual(first, second);
  assert.equal(typeof view.switchM3Task(first), 'string');
  view = h.render(); view = h.render();
  assert.equal(await view.chooseCameraPhoto(), true);
  view = h.render();
  assert.equal(view.useCameraPhoto(), true);
  view = h.render();
  assert.equal(view.allowCameraPhotoForTask(), true);
  const old = h.findC1().getSnapshot();
  assert.equal(typeof view.switchM3Task(second), 'string');
  assert.equal(h.findC1().getSnapshot(), undefined);
  view = h.render(); view = h.render();
  assert.equal(view.cameraC1, undefined);
  assert.equal(h.findC1().allow(old), undefined);
});

test('owner loss and M3 permission revocation each retire camera authority', async () => {
  const owned = await acceptedMealFixture({ withOwner: true });
  assert.equal(owned.view.allowCameraPhotoForTask(), true);
  const staleAction = owned.view.revokeCameraPhotoForTask;
  owned.retireOwner();
  assert.equal(staleAction(), false);
  const afterOwner = owned.render();
  assert.equal(afterOwner.cameraC1, undefined);
  assert.equal(owned.findC1().getSnapshot(), undefined);
  const h = await acceptedMealFixture();
  assert.equal(h.view.allowCameraPhotoForTask(), true);
  await h.view.setM3Access(false);
  assert.equal(h.findC1().getSnapshot(), undefined);
  assert.equal(h.findC0().getSnapshot().receipt, undefined);
  assert.equal(h.render().cameraC1, undefined);
});

test('late picker result after owner loss cannot publish usable Camera authority', async () => {
  const h = await readyMealFixture({ withOwner: true });
  let finish;
  choosePhotoResult = () => new Promise((resolve) => { finish = resolve; });
  try {
    const pending = h.view.chooseCameraPhoto();
    h.retireOwner();
    finish({ canceled: false, asset: { uri: 'ph://late-photo' } });
    assert.equal(await pending, false);
    assert.equal(h.findC0().getSnapshot().candidate, undefined);
    assert.equal(h.findC1().getSnapshot(), undefined);
    assert.equal(h.render().cameraC1, undefined);
  } finally {
    choosePhotoResult = async () => ({ canceled: false, asset: { uri: 'ph://library-photo' } });
  }
});

test('stale C0 candidate cannot be accepted after replacement into C1', async () => {
  const h = await acceptedMealFixture();
  const old = h.findC0().getSnapshot().candidate;
  assert.equal(await h.view.chooseCameraPhoto(), false);
  const view = h.render();
  assert.equal(h.findC0().getSnapshot().candidate, old);
  assert.equal(h.findC0().accept(scopeOf(h), old.candidate_id), h.findC0().getSnapshot().receipt);
  assert.ok(h.findC1().getSnapshot());
  assert.equal(view.cameraC1.state, 'NEEDS_LOCAL_PERMISSION');
});

test('accept publication rebind cannot consume C1 or clear the successor lifetime', async () => {
  const h = await readyMealFixture();
  assert.equal(await h.view.chooseCameraPhoto(), true);
  const view = h.render();
  const store = h.findC0();
  const scope = store.getSnapshot().scope;
  const successor = Object.freeze({ ...scope });
  let rebound = false;
  const unsubscribe = store.subscribe(() => {
    if (!rebound && store.getSnapshot().receipt) {
      rebound = true;
      store.retire();
      store.bind(successor);
    }
  });
  assert.equal(view.useCameraPhoto(), false);
  unsubscribe();
  assert.deepEqual(store.getSnapshot().scope, successor);
  assert.equal(store.getSnapshot().receipt, undefined);
  assert.equal(h.findC1().getSnapshot(), undefined);
});

test('release 8 copy keeps local permission distinct from future external AI permission', () => {
  assert.equal(Object.keys(taskMessages).length, 8);
  for (const [locale, copy] of Object.entries(taskMessages)) {
    for (const key of ['cameraC1Ask', 'cameraC1Allow', 'cameraC1Decline', 'cameraC1Allowed',
      'cameraC1Revoke', 'cameraC1ExternalBoundary', 'cameraC1ReadyNoAnalysis']) {
      assert.ok(copy[key]?.length > 0, `${locale}: ${key}`);
    }
    assert.notEqual(copy.cameraC1Allow, copy.cameraC1ExternalBoundary);
  }
});

test('C2 is absent until exact owner/C0/C1/M4 authority; trusted native port prepares locally', async () => {
  const h = await acceptedMealFixture({ withOwner: true });
  assert.equal(h.view.cameraC2, undefined);
  assert.equal(h.view.allowCameraPhotoForTask(), true);
  let view = h.render();
  assert.equal(view.cameraC2?.state, 'CONSENT_REQUIRED');
  assert.equal(view.cameraC2?.external_consent, 'OFF');
  const token = view.cameraC2.view_token;
  assert.equal(await view.allowExternalProcessingAndPrepare(token), true);
  view = h.render();
  assert.equal(view.cameraC2?.state, 'PREPARED_NOT_SENT');
  assert.equal(view.cameraC2?.external_transfer, 'NOT_SENT');
  assert.equal(await view.allowExternalProcessingAndPrepare(token), false);
  assert.equal(view.revokeExternalProcessing(view.cameraC2.view_token), true);
  view = h.render();
  assert.equal(view.cameraC2?.external_consent, 'OFF');
  assert.ok(view.cameraCleanup, 'cleanup warning is independent of C2 availability/state');
  assert.equal(view.cameraC1.state, 'LOCAL_ALLOWED');
  await tick();
  assert.equal(h.render().cameraCleanup, undefined);
  assert.equal(networkCalls, 0);
});

test('anonymous C0/C1 stays local and never exposes C2 consent or preparation', async () => {
  const h = await acceptedMealFixture();
  assert.equal(h.view.allowCameraPhotoForTask(), true);
  const view = h.render();
  assert.equal(view.cameraC1.state, 'LOCAL_ALLOWED');
  assert.equal(m4(h, h.findC1().project(scopeOf(h))), 'CONTEXT_SUFFICIENT');
  assert.equal(view.cameraC2, undefined);
  assert.equal(await view.allowExternalProcessingAndPrepare(Object.freeze({})), false);
  assert.equal(h.render().cameraC2, undefined);
});

test('failed and no-op M3 edits or switches preserve C2 consent', async () => {
  const h = await acceptedMealFixture({ withOwner: true });
  assert.equal(h.view.allowCameraPhotoForTask(), true);
  let view = h.render();
  assert.equal(await view.allowExternalProcessingAndPrepare(view.cameraC2.view_token), true);
  view = h.render();
  assert.equal(view.cameraC2.state, 'PREPARED_NOT_SENT');
  assert.equal(view.cameraC2.external_consent, 'ON');
  const token = view.cameraC2.view_token;
  assert.equal(view.editM3Task('  '), false);
  assert.equal(view.editM3Task(activeTask(h).source_input), false);
  assert.equal(view.switchM3Task('missing-task'), false);
  assert.equal(view.switchM3Task(view.activeM3Task.id), false);
  view = h.render();
  assert.equal(view.cameraC2.state, 'PREPARED_NOT_SENT');
  assert.equal(view.cameraC2.external_consent, 'ON');
  assert.equal(view.cameraC2.view_token, token);
  assert.equal(view.editM3Task('Đánh giá bữa trưa bằng ảnh'), true);
  assert.equal(h.render().cameraC2, undefined);
});

test('successful M3 task switch retires C2 authority', async () => {
  const h = fixture({ withOwner: true });
  h.render();
  let view = h.render();
  view.submit('Đánh giá ảnh bữa sáng');
  await tick(); view = h.render(); view = h.render();
  const first = view.activeM3Task.id;
  view.submit('Đánh giá ảnh bữa tối');
  await tick(); view = h.render(); view = h.render();
  const second = view.activeM3Task.id;
  assert.notEqual(first, second);
  assert.equal(typeof view.switchM3Task(first), 'string');
  view = h.render(); view = h.render();
  assert.equal(await view.chooseCameraPhoto(), true);
  view = h.render();
  assert.equal(view.useCameraPhoto(), true);
  view = h.render();
  assert.equal(view.allowCameraPhotoForTask(), true);
  view = h.render();
  assert.equal(await view.allowExternalProcessingAndPrepare(view.cameraC2.view_token), true);
  view = h.render();
  assert.equal(view.cameraC2.external_consent, 'ON');
  const preparedUri = `file:///app/cache/prepared-${preparedSequence}.jpg`;
  const deletesBefore = globalThis.__cameraFileDeletes.length;
  assert.equal(typeof view.switchM3Task(second), 'string');
  assert.equal(h.render().cameraC2, undefined);
  assert.equal(await h.findC2().settleCleanup(), true);
  assert.deepEqual(globalThis.__cameraFileDeletes.slice(deletesBefore).map((call) => call.uri), [preparedUri]);
});

test('prepared accepted photo cannot open replacement picker or retire C2', async () => {
  const h = await acceptedMealFixture({ withOwner: true });
  assert.equal(h.view.allowCameraPhotoForTask(), true);
  let view = h.render();
  assert.equal(await view.allowExternalProcessingAndPrepare(view.cameraC2.view_token), true);
  const c2 = h.findC2().currentReceipt();
  assert.equal(view.cameraC0.replacementAllowed, false);
  assert.equal(await view.chooseCameraPhoto(), false);
  assert.equal(h.findC2().currentReceipt(), c2);
  assert.equal(h.render().cameraC2?.state, 'PREPARED_NOT_SENT');
});

test('C1 revoke and owner loss remove C2 UI without changing M5 availability', async () => {
  const h = await acceptedMealFixture({ withOwner: true });
  assert.equal(h.view.allowCameraPhotoForTask(), true);
  let view = h.render();
  assert.equal(view.cameraC2?.state, 'CONSENT_REQUIRED');
  assert.equal(view.revokeCameraPhotoForTask(), true);
  view = h.render();
  assert.equal(view.cameraC2, undefined);
  const second = await acceptedMealFixture({ withOwner: true });
  assert.equal(second.view.allowCameraPhotoForTask(), true);
  assert.equal(second.render().cameraC2?.state, 'CONSENT_REQUIRED');
  second.retireOwner();
  assert.equal(second.render().cameraC2, undefined);
  assert.equal(networkCalls, 0);
});

test('current cleanup warning renders without C2 and clears only after confirmed settlement', async () => {
  const { h, view } = await preparedRealOwnerA();
  const c2 = h.findC2();
  assert.equal(view.revokeCameraPhotoForTask(), true);
  let after = h.render();
  assert.equal(after.cameraC2, undefined);
  assert.ok(after.cameraCleanup);
  assert.ok(['PENDING', 'UNCONFIRMED'].includes(after.cameraCleanup.status));
  assert.equal(await c2.settleCleanup(), true);
  await tick();
  after = h.render();
  assert.equal(after.cameraCleanup, undefined);
});

test('failed cleanup remains a current-scope RAM-only warning and never reopens acquisition', async () => {
  const { h, view } = await preparedRealOwnerA();
  globalThis.__cameraDeleteFailure = true;
  try {
    assert.equal(view.revokeCameraPhotoForTask(), true);
    await tick();
    const after = h.render();
    assert.equal(after.cameraC2, undefined);
    assert.equal(after.cameraCleanup?.status, 'FAILED');
    assert.equal(await after.chooseCameraPhoto(), false);
    assert.equal(h.findC2().cleanupStatus().failed, true);
  } finally {
    globalThis.__cameraDeleteFailure = false;
  }
});

test('stale cleanup settlement cannot clear or publish into a retired task lifetime', async () => {
  const { h, view } = await preparedRealOwnerA();
  const gate = deferred();
  globalThis.__cameraDeleteGate = gate;
  try {
    assert.equal(view.revokeCameraPhotoForTask(), true);
    assert.ok(h.render().cameraCleanup);
    assert.equal(view.cancelM3Task(), true);
    assert.equal(h.render().cameraCleanup, undefined);
    gate.resolve();
    assert.equal(await h.findC2().settleCleanup(), true);
    await tick();
    assert.equal(h.render().cameraCleanup, undefined);
  } finally {
    globalThis.__cameraDeleteGate = undefined;
  }
});

test('host does not compose external consent, preparation, offline fixture or provider', () => {
  const source = readFileSync(resolve(appRoot, 'components/useM2Gateway.ts'), 'utf8');
  for (const forbidden of ['createMealExternalConsentStore', 'createLocalImagePreparationService',
    'createExpoImagePreparer', 'runMealVisionOfflineFixture']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.equal(networkCalls, 0);
});

test('real owner logout retires prepared Camera authority and cleans only A cache', async () => {
  const { h, view } = await preparedRealOwnerA();
  const c0 = h.findC0().getSnapshot(), c1 = h.findC1().getSnapshot();
  const task = h.findTaskStore().getSnapshot().tasks.find((item) =>
    item.task_id === h.findTaskStore().getSnapshot().active_task_id);
  const c2 = h.findC2(), receipt = c2.currentReceipt();
  const token = view.cameraC2.view_token;
  const preparedUri = `file:///app/cache/prepared-${preparedSequence}.jpg`;
  assert.ok(task?.task_id && c0.candidate && c0.receipt && c1 && receipt);
  assert.equal(c2.isCurrentReceipt(receipt), true);
  assert.equal(receipt.artifact.prepared_image_id.length > 0, true);
  const beforeDeletes = globalThis.__cameraFileDeletes.length;
  h.logout();
  assert.equal(c2.currentReceipt(), undefined);
  assert.equal(c2.isCurrentReceipt(receipt), false);
  assert.equal(await view.chooseCameraPhoto(), false);
  assert.equal(view.useCameraPhoto(), false);
  assert.equal(view.allowCameraPhotoForTask(), false);
  assert.equal(view.revokeCameraPhotoForTask(), false);
  assert.equal(await view.allowExternalProcessingAndPrepare(token), false);
  assert.equal(view.revokeExternalProcessing(token), false);
  const after = h.render();
  assert.equal(after.cameraC0, undefined);
  assert.equal(after.cameraC1, undefined);
  assert.equal(after.cameraC2, undefined);
  assert.equal(h.findC0().getSnapshot().candidate, undefined);
  assert.equal(h.findC0().getSnapshot().receipt, undefined);
  assert.equal(h.findC1().getSnapshot(), undefined);
  assert.equal(c2.view().external_consent, 'OFF');
  assert.equal(await c2.settleCleanup(), true);
  const deleted = globalThis.__cameraFileDeletes.slice(beforeDeletes).map((call) => call.uri);
  assert.deepEqual(deleted, [preparedUri]);
  assert.ok(!deleted.includes(c0.candidate.local_uri));
  assert.equal(networkCalls, 0);
});

async function realAtoPreparedB() {
  const { h, view: aView } = await preparedRealOwnerA();
  const aTask = h.findTaskStore().getSnapshot().active_task_id;
  const aCandidate = h.findC0().getSnapshot().candidate;
  const aReceipt = h.findC0().getSnapshot().receipt;
  const aC1 = h.findC1().getSnapshot();
  const aC2 = h.findC2().currentReceipt();
  const aPreparedUri = `file:///app/cache/prepared-${preparedSequence}.jpg`;
  assert.ok(aTask && aCandidate && aReceipt && aC1 && aC2);
  h.logout();
  h.render();
  assert.equal(await h.findC2().settleCleanup(), true);
  await h.verify(OWNER_B);
  h.render();
  let bView = h.render();
  assert.equal(bView.activeM3Task, undefined);
  assert.equal(bView.cameraC0, undefined);
  assert.equal(bView.cameraC1, undefined);
  assert.equal(bView.cameraC2, undefined);
  assert.equal(h.findC0().getSnapshot().candidate, undefined);
  assert.equal(h.findC0().getSnapshot().receipt, undefined);
  assert.equal(h.findC1().getSnapshot(), undefined);
  assert.equal(h.findC2().currentReceipt(), undefined);
  assert.equal(h.findC2().isCurrentReceipt(aC2), false);
  bView.submit('Đánh giá ảnh bữa tối');
  await tick();
  bView = h.render(); bView = h.render();
  assert.ok(bView.cameraC0);
  assert.equal(await bView.chooseCameraPhoto(), true);
  bView = h.render();
  assert.equal(bView.useCameraPhoto(), true);
  bView = h.render();
  assert.equal(bView.allowCameraPhotoForTask(), true);
  bView = h.render();
  assert.equal(await bView.allowExternalProcessingAndPrepare(bView.cameraC2.view_token), true);
  bView = h.render();
  assert.equal(bView.cameraC2?.state, 'PREPARED_NOT_SENT');
  return { h, aView, bView, aTask, aCandidate, aReceipt, aC1, aC2, aPreparedUri };
}

test('real A logout then B READY inherits no Camera authority or prepared cache', async () => {
  const { h, aTask, aCandidate, aReceipt, aC1, aC2, aPreparedUri } = await realAtoPreparedB();
  const bTask = h.findTaskStore().getSnapshot().active_task_id;
  const bCandidate = h.findC0().getSnapshot().candidate;
  const bReceipt = h.findC0().getSnapshot().receipt;
  const bC1 = h.findC1().getSnapshot();
  const bC2 = h.findC2().currentReceipt();
  assert.ok(bTask && bCandidate && bReceipt && bC1 && bC2);
  assert.notEqual(bTask, aTask);
  assert.notEqual(bCandidate.candidate_id, aCandidate.candidate_id);
  assert.notEqual(bReceipt, aReceipt);
  assert.notEqual(bC1, aC1);
  assert.notEqual(bC1.context_id, aC1.context_id);
  assert.notEqual(bC2, aC2);
  assert.notEqual(bC2.artifact.prepared_image_id, aC2.artifact.prepared_image_id);
  assert.equal(h.findC2().isCurrentReceipt(aC2), false);
  assert.equal(h.findC2().isCurrentReceipt(bC2), true);
  const bPreparedUri = `file:///app/cache/prepared-${preparedSequence}.jpg`;
  const deleted = globalThis.__cameraFileDeletes.map((call) => call.uri);
  assert.ok(deleted.includes(aPreparedUri));
  assert.ok(!deleted.includes(bPreparedUri));
  assert.ok(!deleted.includes(aCandidate.local_uri));
  assert.ok(!deleted.includes(bCandidate.local_uri));
  assert.equal(networkCalls, 0);
});

test('late A picker result after real A-to-B owner transition cannot alter B Camera', async () => {
  const h = realOwnerFixture();
  await h.verify(OWNER_A);
  h.render();
  let aView = h.render();
  aView.submit('Đánh giá ảnh bữa ăn');
  await tick();
  aView = h.render(); aView = h.render();
  let finishA;
  choosePhotoResult = () => new Promise((resolve) => { finishA = resolve; });
  try {
    const pendingA = aView.chooseCameraPhoto();
    assert.equal(h.findC0().getSnapshot().phase, 'PICKING');
    h.logout();
    h.render();
    await h.verify(OWNER_B);
    h.render();
    let bView = h.render();
    bView.submit('Đánh giá ảnh bữa tối');
    await tick();
    bView = h.render(); bView = h.render();
    choosePhotoResult = async () => ({ canceled: false, asset: { uri: 'ph://b-photo' } });
    assert.equal(await bView.chooseCameraPhoto(), false, 'A native operation keeps the shared slot busy');
    finishA({ canceled: false, asset: { uri: 'ph://late-a-photo' } });
    assert.equal(await pendingA, false);
    bView = h.render();
    assert.equal(h.findC0().getSnapshot().candidate, undefined);
    assert.equal(await bView.chooseCameraPhoto(), true);
    bView = h.render();
    assert.equal(bView.useCameraPhoto(), true);
    bView = h.render();
    assert.equal(bView.allowCameraPhotoForTask(), true);
    bView = h.render();
    assert.equal(await bView.allowExternalProcessingAndPrepare(bView.cameraC2.view_token), true);
    h.render();
    const bTask = h.findTaskStore().getSnapshot();
    const bC0 = h.findC0().getSnapshot();
    const bC1 = h.findC1().getSnapshot();
    const bC2 = h.findC2().currentReceipt();
    const bPreparedUri = `file:///app/cache/prepared-${preparedSequence}.jpg`;
    const deletedBefore = globalThis.__cameraFileDeletes.length;
    assert.equal(h.findTaskStore().getSnapshot(), bTask);
    assert.equal(h.findC0().getSnapshot(), bC0);
    assert.deepEqual(h.findC1().getSnapshot(), bC1);
    assert.equal(h.findC2().currentReceipt(), bC2);
    assert.equal(h.findC2().isCurrentReceipt(bC2), true);
    assert.equal(globalThis.__cameraFileDeletes.length, deletedBefore);
    assert.ok(!globalThis.__cameraFileDeletes.some((call) => call.uri === bPreparedUri));
    assert.equal(networkCalls, 0);
  } finally {
    choosePhotoResult = async () => ({ canceled: false, asset: { uri: 'ph://library-photo' } });
  }
});

test('stale A Camera and task callbacks cannot change B after real owner transition', async () => {
  const { h, aView, aTask } = await realAtoPreparedB();
  const aToken = aView.cameraC2.view_token;
  const bTask = h.findTaskStore().getSnapshot();
  const bC0 = h.findC0().getSnapshot();
  const bC1 = h.findC1().getSnapshot();
  const bC2 = h.findC2().currentReceipt();
  const bToken = h.findC2().view().view_token;
  const bPreparedUri = `file:///app/cache/prepared-${preparedSequence}.jpg`;
  const deletedBefore = globalThis.__cameraFileDeletes.length;
  const unchangedB = (name) => {
    assert.equal(h.findTaskStore().getSnapshot(), bTask, `${name}: B task changed`);
    assert.equal(h.findC0().getSnapshot(), bC0, `${name}: B C0 changed`);
    assert.deepEqual(h.findC1().getSnapshot(), bC1, `${name}: B C1 changed`);
    assert.equal(h.findC2().currentReceipt(), bC2, `${name}: B C2 receipt changed`);
    assert.equal(h.findC2().view().view_token, bToken, `${name}: B C2 token changed`);
    assert.equal(globalThis.__cameraFileDeletes.length, deletedBefore, `${name}: cache deletion changed`);
    assert.ok(!globalThis.__cameraFileDeletes.some((call) => call.uri === bPreparedUri));
  };
  const stale = [
    ['take', () => aView.takeCameraPhoto()],
    ['choose', () => aView.chooseCameraPhoto()],
    ['accept', () => aView.useCameraPhoto()],
    ['cancel photo', () => aView.cancelCameraPhoto()],
    ['allow C1', () => aView.allowCameraPhotoForTask()],
    ['decline C1', () => aView.declineCameraPhotoForTask()],
    ['revoke C1', () => aView.revokeCameraPhotoForTask()],
    ['allow C2', () => aView.allowExternalProcessingAndPrepare(aToken)],
    ['revoke C2', () => aView.revokeExternalProcessing(aToken)],
    ['retry C2', () => aView.retryLocalPreparation(aToken)],
    ['edit task', () => aView.editM3Task('Đánh giá ảnh bữa trưa')],
    ['cancel task', () => aView.cancelM3Task()],
    ['switch task', () => aView.switchM3Task(aTask)],
  ];
  for (const [name, action] of stale) {
    const result = await action();
    unchangedB(name);
    assert.equal(result, false, `${name}: stale A action succeeded`);
  }
  assert.equal(networkCalls, 0);
});

test('RED isolated stale A edit cannot retarget B task', async () => {
  const { h, aView } = await realAtoPreparedB();
  const before = h.findTaskStore().getSnapshot();
  const result = aView.editM3Task('Đánh giá ảnh bữa trưa');
  const after = h.findTaskStore().getSnapshot();
  assert.equal(result, false, `stale edit returned ${String(result)}; B ${before.tasks.find(x => x.task_id === before.active_task_id)?.source_input} -> ${after.tasks.find(x => x.task_id === after.active_task_id)?.source_input}`);
  assert.equal(after, before, 'stale edit changed B task snapshot');
});

test('RED isolated stale A cancel cannot revoke B prepared Camera', async () => {
  const { h, aView } = await realAtoPreparedB();
  const task = h.findTaskStore().getSnapshot();
  const c0 = h.findC0().getSnapshot();
  const c1 = h.findC1().getSnapshot();
  const c2 = h.findC2().currentReceipt();
  const token = h.findC2().view().view_token;
  const deletes = globalThis.__cameraFileDeletes.length;
  const result = aView.cancelM3Task();
  const after = h.findTaskStore().getSnapshot();
  const afterC2 = h.findC2().currentReceipt();
  await h.findC2().settleCleanup();
  assert.equal(result, false, `stale cancel returned ${String(result)}; B status ${task.tasks.find(x => x.task_id === task.active_task_id)?.status} -> ${after.tasks.find(x => x.task_id === task.active_task_id)?.status}; C2 receipt ${Boolean(c2)} -> ${Boolean(afterC2)}; deletes ${deletes} -> ${globalThis.__cameraFileDeletes.length}`);
  assert.equal(after, task);
  assert.equal(h.findC0().getSnapshot(), c0);
  assert.deepEqual(h.findC1().getSnapshot(), c1);
  assert.equal(afterC2, c2);
  assert.equal(h.findC2().view().view_token, token);
  assert.equal(globalThis.__cameraFileDeletes.length, deletes);
});

test('RED isolated stale A switch cannot target B option or old A option', async () => {
  const { h, aView, aTask, bView } = await realAtoPreparedB();
  const bFirst = bView.activeM3Task.id;
  bView.submit('Đánh giá ảnh bữa trưa');
  await tick(); h.render(); const current = h.render();
  assert.notEqual(current.activeM3Task.id, bFirst);
  const before = h.findTaskStore().getSnapshot();
  const oldResult = aView.switchM3Task(aTask);
  const bResult = aView.switchM3Task(bFirst);
  const after = h.findTaskStore().getSnapshot();
  assert.equal(oldResult, false);
  assert.equal(bResult, false, `stale switch(B) returned ${String(bResult)}; active ${before.active_task_id} -> ${after.active_task_id}`);
  assert.equal(after, before);
});

test('same public owner after logout with new lease cannot reuse old M3 callbacks', async () => {
  const { h, view: old } = await preparedRealOwnerA();
  const prior = h.currentSession();
  h.logout(); h.render();
  await h.verify(OWNER_A);
  const next = h.currentSession();
  assert.equal(next.access, prior.access);
  assert.notEqual(next.lease, prior.lease);
  assert.equal(old.editM3Task('Đánh giá ảnh bữa trưa'), false,
    'new lease blocks old callback even before React rerenders');
  h.render(); let view = h.render();
  view.submit('Đánh giá ảnh bữa tối');
  await tick(); h.render(); view = h.render();
  const before = h.findTaskStore().getSnapshot();
  assert.equal(old.editM3Task('Đánh giá ảnh bữa trưa'), false);
  assert.equal(old.cancelM3Task(), false);
  assert.equal(old.switchM3Task(view.activeM3Task.id), false);
  assert.equal(h.findTaskStore().getSnapshot(), before);
});

test('new access boundary with identical public owner IDs cannot reuse old M3 callbacks', async () => {
  const { h, view: old } = await preparedRealOwnerA();
  const prior = h.currentSession();
  h.replaceBoundary();
  await h.verify(OWNER_A);
  const next = h.currentSession();
  assert.notEqual(next.access, prior.access);
  assert.notEqual(next.lease, prior.lease);
  assert.deepEqual(next.access.requireLease(next.lease).owner, prior.access.requireLease(prior.lease).owner);
  h.render(); let view = h.render();
  view.submit('Đánh giá ảnh bữa tối');
  await tick(); h.render(); view = h.render();
  const before = h.findTaskStore().getSnapshot();
  assert.equal(old.editM3Task('Đánh giá ảnh bữa trưa'), false);
  assert.equal(old.cancelM3Task(), false);
  assert.equal(old.switchM3Task(view.activeM3Task.id), false);
  assert.equal(h.findTaskStore().getSnapshot(), before);
});

test('authorization capability replacement retires Camera binding and stale callbacks', async () => {
  const { h, view } = await readyRealOwnerA();
  const staleChoose = view.chooseCameraPhoto;
  const priorStore = h.findTaskStore();
  h.replaceAuthorization();
  h.render();
  let fresh = h.render();
  assert.equal(await staleChoose(), false);
  assert.notEqual(h.findTaskStore(), priorStore);
  fresh.submit('Đánh giá ảnh bữa ăn mới');
  await tick();
  fresh = h.render(); fresh = h.render();
  assert.equal(await fresh.chooseCameraPhoto(), true);
});

test('anonymous M3 callback cannot cross into a signed-in owner generation', async () => {
  const h = realOwnerFixture();
  h.startAnonymous(OWNER_A);
  h.render(); let view = h.render();
  view.submit('Đánh giá ảnh bữa sáng');
  await tick(); h.render(); view = h.render();
  const anonymous = view;
  await h.verify(OWNER_B);
  h.render(); view = h.render();
  view.submit('Đánh giá ảnh bữa tối');
  await tick(); h.render(); view = h.render();
  const before = h.findTaskStore().getSnapshot();
  assert.equal(anonymous.editM3Task('Đánh giá ảnh bữa trưa'), false);
  assert.equal(anonymous.cancelM3Task(), false);
  assert.equal(anonymous.switchM3Task(view.activeM3Task.id), false);
  assert.equal(h.findTaskStore().getSnapshot(), before);
});

test('old M3 callbacks fail after task revision changes', async () => {
  const h = fixture();
  h.render(); let view = h.render();
  view.submit('Đánh giá ảnh bữa sáng');
  await tick(); h.render(); view = h.render();
  const old = view;
  const beforeRevision = activeTask(h).revision;
  assert.equal(view.editM3Task('Đánh giá ảnh bữa trưa'), true);
  assert.ok(activeTask(h).revision > beforeRevision);
  const after = h.findTaskStore().getSnapshot();
  assert.equal(old.editM3Task('Đánh giá ảnh bữa tối'), false);
  assert.equal(old.cancelM3Task(), false);
  assert.equal(old.switchM3Task(old.activeM3Task.id), false);
  assert.equal(h.findTaskStore().getSnapshot(), after);
});

test('view revision change and switch away/back stale old M3 refs without task revision change', async () => {
  const h = fixture();
  h.render(); let view = h.render();
  view.submit('Đánh giá ảnh bữa sáng');
  await tick(); h.render(); view = h.render();
  const first = view.activeM3Task.id;
  view.submit('Đánh giá ảnh bữa tối');
  await tick(); h.render(); view = h.render();
  const old = view, second = view.activeM3Task.id;
  const taskRevision = activeTask(h).revision;
  const store = h.findTaskStore();
  assert.equal(store.switchTask(store.reference(first)), true);
  assert.equal(store.switchTask(store.reference(second)), true);
  assert.equal(activeTask(h).revision, taskRevision);
  const after = store.getSnapshot();
  assert.equal(old.editM3Task('Đánh giá ảnh bữa trưa'), false);
  assert.equal(old.cancelM3Task(), false);
  assert.equal(old.switchM3Task(first), false);
  assert.equal(store.getSnapshot(), after);
});

test('pure rerender and locale-only rerender preserve issued current M3 callback', async () => {
  for (const localeChange of [false, true]) {
    const h = fixture();
    h.render(); let view = h.render();
    view.submit('Đánh giá ảnh bữa sáng');
    await tick(); h.render(); view = h.render();
    const old = view;
    const snapshot = h.findTaskStore().getSnapshot();
    h.render();
    if (localeChange) { h.setLocale('en'); h.render(); }
    assert.equal(h.findTaskStore().getSnapshot(), snapshot);
    assert.equal(old.editM3Task('Đánh giá ảnh bữa trưa'), true);
    assert.equal(activeTask(h).source_input, 'Đánh giá ảnh bữa trưa');
  }
});

test('old switch sees only presented targets, not a task created later or a cancelled target', async () => {
  const h = fixture();
  h.render(); let view = h.render();
  view.submit('Đánh giá ảnh bữa sáng');
  await tick(); h.render(); view = h.render();
  const old = view;
  view.submit('Đánh giá ảnh bữa tối');
  await tick(); h.render(); view = h.render();
  const second = view.activeM3Task.id;
  const store = h.findTaskStore();
  const before = store.getSnapshot();
  assert.equal(old.switchM3Task(second), false);
  assert.equal(store.getSnapshot(), before);
  const presented = view;
  const first = presented.m3Tasks.find((task) => task.id !== second).id;
  assert.equal(store.cancel(store.reference(first)), true);
  const after = store.getSnapshot();
  assert.equal(presented.switchM3Task(first), false);
  assert.equal(presented.switchM3Task(second), false);
  assert.equal(store.getSnapshot(), after);
});

test('logout blocks captured task callbacks before React effects or rerender', async () => {
  const { h, view } = await preparedRealOwnerA();
  const store = h.findTaskStore();
  const task = store.getSnapshot();
  h.logout();
  assert.equal(view.editM3Task('Đánh giá ảnh bữa trưa'), false);
  assert.equal(view.cancelM3Task(), false);
  assert.equal(view.switchM3Task(view.activeM3Task.id), false);
  assert.notEqual(store.getSnapshot(), task);
  assert.equal(store.getTrainerActionAvailability(), 'UNAVAILABLE');
  assert.equal(store.getSnapshot().session_id, null);
});

test('current cancel retires only its prepared C2 cache after successful task mutation', async () => {
  const { h, view } = await preparedRealOwnerA();
  const preparedUri = `file:///app/cache/prepared-${preparedSequence}.jpg`;
  const deletesBefore = globalThis.__cameraFileDeletes.length;
  assert.equal(view.cancelM3Task(), true);
  assert.equal(h.findTaskStore().getSnapshot().active_task_id, null);
  assert.equal(h.findC0().getSnapshot().scope, undefined);
  assert.equal(h.findC1().getSnapshot(), undefined);
  assert.equal(h.findC2().currentReceipt(), undefined);
  assert.equal(await h.findC2().settleCleanup(), true);
  assert.deepEqual(globalThis.__cameraFileDeletes.slice(deletesBefore).map((call) => call.uri), [preparedUri]);
  assert.equal(networkCalls, 0);
});

test('reentrant new C0/C1 binding survives cleanup of a valid prior M3 edit', async () => {
  for (const withContext of [false, true]) {
    const { h, view } = await preparedRealOwnerA();
    const store = h.findTaskStore();
    const oldScope = h.findC0().getSnapshot().scope;
    const nextScope = { ...oldScope, task_id: `reentrant-${withContext}` };
    let fired = false;
    const unsubscribe = store.subscribe(() => {
      if (fired) return;
      fired = true;
      assert.equal(h.findC0().bind(nextScope), true);
      assert.equal(h.findC1().bind(nextScope), true);
      if (withContext) {
        const request = h.findC0().begin(nextScope, 'LIBRARY');
        assert.equal(h.findC0().complete(request, { uri: 'ph://reentrant-photo' }), true);
        const receipt = h.findC0().accept(nextScope, h.findC0().getSnapshot().candidate.candidate_id);
        assert.ok(h.findC1().consume(receipt));
      }
    });
    try {
      assert.equal(view.editM3Task('Đánh giá ảnh bữa trưa'), true);
      assert.equal(fired, true);
      assert.deepEqual(h.findC0().getSnapshot().scope, nextScope);
      if (withContext) assert.deepEqual(h.findC1().getSnapshot().task_id, nextScope.task_id);
      else {
        assert.equal(h.findC1().getSnapshot(), undefined);
        assert.equal(h.findC1().decline(nextScope), true,
          'new C1 binding without a context must not be retired speculatively');
      }
      assert.notDeepEqual(h.findC0().getSnapshot().scope, oldScope);
    } finally { unsubscribe(); }
  }
});

test('current presented switch works after cancelling the active task', async () => {
  const h = realOwnerFixture();
  await h.verify(OWNER_A);
  h.render(); let view = h.render();
  view.submit('Đánh giá ảnh bữa sáng');
  await tick(); h.render(); view = h.render();
  const targetId = view.activeM3Task.id;
  view.submit('Đánh giá ảnh bữa tối');
  await tick(); h.render(); view = h.render();
  assert.notEqual(view.activeM3Task.id, targetId);
  assert.equal(view.cancelM3Task(), true);
  h.render(); view = h.render();
  const before = h.findTaskStore().getSnapshot();
  const target = before.tasks.find((task) => task.task_id === targetId);
  assert.equal(before.active_task_id, null);
  assert.ok(target && target.status !== 'CANCELLED');
  assert.ok(view.m3Tasks.some((task) => task.id === targetId && !task.active));
  assert.equal(view.activeM3Task, undefined);
  assert.equal(h.findC0().getSnapshot().scope, undefined);
  const deletesBefore = globalThis.__cameraFileDeletes.length;
  const result = view.switchM3Task(targetId);
  assert.equal(result, target.source_input,
    `presented target with no active task returned ${String(result)}; active=${h.findTaskStore().getSnapshot().active_task_id}`);
  assert.equal(h.findTaskStore().getSnapshot().active_task_id, targetId);
  assert.equal(globalThis.__cameraFileDeletes.length, deletesBefore);
});

async function pendingInactiveSwitchFixture() {
  const h = realOwnerFixture();
  await h.verify(OWNER_A);
  h.render(); let view = h.render();
  view.submit('Đánh giá ảnh bữa sáng');
  await tick(); h.render(); view = h.render();
  const targetId = view.activeM3Task.id;
  view.submit('Đánh giá ảnh bữa tối');
  await tick(); h.render(); view = h.render();
  const store = h.findTaskStore();
  assert.notEqual(store.getSnapshot().active_task_id, targetId);
  assert.equal(store.edit(store.reference(targetId), 'Đánh giá ảnh bữa trưa'), true);
  h.render(); view = h.render();
  const before = store.getSnapshot();
  const target = before.tasks.find((task) => task.task_id === targetId);
  assert.equal(target?.status, 'NEEDS_ROUTING');
  assert.ok(view.m3Tasks.some((task) => task.id === targetId && !task.active));
  return { h, view, store, targetId, target };
}

test('successful current switch can synchronously advance target routing revision', async () => {
  const domain = await pendingInactiveSwitchFixture();
  const domainRef = domain.store.reference(domain.targetId);
  assert.equal(domain.store.switchTask(domainRef), true);
  const domainAfter = domain.store.getSnapshot();
  const routed = domainAfter.tasks.find((task) => task.task_id === domain.targetId);
  assert.equal(domainAfter.active_task_id, domain.targetId);
  assert.equal(routed.status, 'NEEDS_ROUTING');
  assert.ok(routed.revision > domain.target.revision,
    `domain target revision ${domain.target.revision} -> ${routed.revision}`);

  const host = await pendingInactiveSwitchFixture();
  const result = host.view.switchM3Task(host.targetId);
  const after = host.store.getSnapshot();
  const target = after.tasks.find((task) => task.task_id === host.targetId);
  assert.equal(after.active_task_id, host.targetId);
  assert.equal(target.status, 'NEEDS_ROUTING');
  assert.ok(target.revision > host.target.revision);
  assert.equal(result, target.source_input,
    `host returned ${String(result)} after valid switch routed target revision ${host.target.revision} -> ${target.revision}`);
});

test('Camera-owned task must enter Trainer Safety HOLD through its real SessionTaskStore', async () => {
  const { h, view } = await preparedRealOwnerA();
  const store = h.findTaskStore();
  const task = activeTask(h);
  const ref = store.reference(task.task_id);
  const c2 = h.findC2();
  const receipt = c2.currentReceipt();
  const before = store.getTrainerSafetySnapshot();
  const availabilityBefore = store.getTrainerActionAvailability();
  assert.ok(ref && receipt);
  assert.equal(view.cameraC2?.state, 'PREPARED_NOT_SENT');
  assert.equal(c2.isCurrentReceipt(receipt), true);
  const signalAccepted = store.signalTrainerSafety(ref, 'PROBLEM');
  const after = store.getTrainerSafetySnapshot();
  const availabilityAfter = store.getTrainerActionAvailability();
  const fresh = h.render();
  console.log('SAFETY_CAMERA_BLOCKED_PRECONDITION', JSON.stringify({
    taskStatus: task.status, taskRevision: task.revision,
    signalAccepted, safetyState: [before.state, after.state],
    safetyRevision: [before.revision, after.revision],
    availability: [availabilityBefore, availabilityAfter],
    c2Presentation: fresh.cameraC2?.state,
    c2ReceiptStillCurrent: c2.isCurrentReceipt(receipt),
    networkCalls,
  }));
  assert.equal(networkCalls, 0);
  assert.equal(signalAccepted, true,
    'Camera-owned task must accept a real Trainer Safety signal before HOLD behavior can be tested');
  assert.equal(after.state, 'HOLD');
  assert.equal(availabilityAfter, 'SAFETY_HOLD');
  assert.equal(c2.isCurrentReceipt(receipt), false,
    'Safety HOLD must stale the prepared C2 receipt');
});

test('Safety HOLD retires C0/C1 use while the meal task remains READY', async () => {
  const { h, view } = await locallyAllowedRealOwnerA();
  const store = h.findTaskStore();
  const task = activeTask(h);
  const ref = store.reference(task.task_id);
  assert.equal(store.getTrainerActionAvailability(), 'AVAILABLE');
  assert.ok(h.findC0().getSnapshot().receipt);
  assert.equal(h.findC1().project(scopeOf(h)).permission.status, 'allowed');
  assert.equal(store.signalTrainerSafety(ref, 'PROBLEM'), true);
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(store.getTrainerSafetySnapshot().revision, 1);
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
  assert.equal(activeTask(h).status, 'READY');
  assert.equal(activeTask(h).revision, task.revision);
  assert.equal(h.findC0().getSnapshot().receipt, undefined);
  assert.equal(h.findC0().getSnapshot().candidate, undefined);
  assert.equal(h.findC1().getSnapshot(), undefined);
  assert.equal(await view.takeCameraPhoto(), false);
  assert.equal(await view.chooseCameraPhoto(), false);
  assert.equal(view.useCameraPhoto(), false);
  assert.equal(view.allowCameraPhotoForTask(), false);
  assert.equal(view.declineCameraPhotoForTask(), false);
  assert.equal(view.revokeCameraPhotoForTask(), false);
  const fresh = h.render();
  assert.equal(fresh.cameraC0, undefined);
  assert.equal(fresh.cameraC1, undefined);
  assert.equal(await fresh.chooseCameraPhoto(), false);
  assert.equal(view.cancelM3Task(), false, 'pre-HOLD callback is stale after Safety publication');
  assert.equal(fresh.cancelM3Task(), true, 'new current task cancellation may narrow authority during HOLD');
  assert.equal(activeTask(h), undefined);
  assert.equal(networkCalls, 0);
});

test('Safety HOLD retires prepared C2 receipt and cleans only its generated cache', async () => {
  const { h, view } = await preparedRealOwnerA();
  const store = h.findTaskStore();
  const task = activeTask(h);
  const ref = store.reference(task.task_id);
  const c2 = h.findC2();
  const receipt = c2.currentReceipt();
  const token = view.cameraC2.view_token;
  const ownedCache = `file:///app/cache/prepared-${preparedSequence}.jpg`;
  const deletesBefore = globalThis.__cameraFileDeletes.length;
  assert.equal(c2.isCurrentReceipt(receipt), true);
  assert.equal(view.cameraC2.external_consent, 'ON');
  assert.equal(store.signalTrainerSafety(ref, 'PROBLEM'), true);
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
  assert.equal(activeTask(h).status, 'READY');
  assert.equal(c2.currentReceipt(), undefined);
  assert.equal(c2.isCurrentReceipt(receipt), false);
  assert.equal(c2.view().external_consent, 'OFF');
  assert.equal(h.render().cameraC2, undefined);
  assert.equal(await view.allowExternalProcessingAndPrepare(token), false);
  assert.equal(await view.retryLocalPreparation(token), false);
  assert.equal(view.revokeExternalProcessing(token), false);
  assert.equal(view.allowCameraPhotoForTask(), false);
  assert.equal(await view.chooseCameraPhoto(), false);
  assert.equal(await c2.settleCleanup(), true);
  const deleted = globalThis.__cameraFileDeletes.slice(deletesBefore).map((call) => call.uri);
  assert.deepEqual(deleted, [ownedCache]);
  assert.ok(deleted.every((uri) => uri !== 'ph://library-photo'));
  assert.equal(networkCalls, 0);
});

test('anonymous Camera lifetime cannot be adopted by verified A', async () => {
  const h = realOwnerFixture();
  h.startAnonymous(OWNER_A);
  h.render(); let view = h.render();
  view.submit('Đánh giá ảnh bữa ăn');
  await tick(); h.render(); view = h.render();
  const anonymousStore = h.findTaskStore();
  const anonymousSession = anonymousStore.getSnapshot().session_id;
  assert.ok(anonymousSession);
  assert.equal(anonymousStore.signalTrainerSafety(anonymousStore.reference(), 'PROBLEM'), false);
  assert.equal(view.cameraC2, undefined);
  await h.verify(OWNER_A);
  h.render(); view = h.render();
  const ownedStore = h.findTaskStore();
  assert.notEqual(ownedStore, anonymousStore);
  assert.notEqual(ownedStore.getSnapshot().session_id, anonymousSession);
  assert.equal(ownedStore.getSnapshot().tasks.length, 0);
  assert.equal(anonymousStore.getTrainerActionAvailability(), 'UNAVAILABLE');
  assert.equal(view.cameraC0, undefined);
});

test('anonymous local Safety recognition blocks Camera without a fake owner lease', async () => {
  const h = realOwnerFixture();
  h.startAnonymous(OWNER_A);
  h.setLocale('en');
  h.render(); let view = h.render();
  view.submit('Assess my meal photo. Chest pressure.');
  await tick(); view = h.render();
  const store = h.findTaskStore();
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
  assert.equal(view.cameraC0, undefined);
  assert.equal(view.cameraC2, undefined);
  assert.equal(await view.chooseCameraPhoto(), false);
  assert.equal(networkCalls, 0);
});

test('legitimate clarification release cannot revive Camera authority from the earlier Safety revision', async () => {
  const h = realOwnerFixture();
  await h.verify(OWNER_A);
  h.setLocale('en');
  h.render(); let view = h.render();
  view.submit('Assess my meal photo');
  await tick(); view = h.render(); view = h.render();
  assert.equal(await view.chooseCameraPhoto(), true);
  view = h.render(); assert.equal(view.useCameraPhoto(), true);
  view = h.render(); assert.equal(view.allowCameraPhotoForTask(), true);
  view = h.render();
  assert.equal(await view.allowExternalProcessingAndPrepare(view.cameraC2.view_token), true);
  view = h.render();
  const store = h.findTaskStore();
  const c2 = h.findC2();
  const oldReceipt = c2.currentReceipt();
  const oldSafetyRevision = store.getTrainerSafetySnapshot().revision;
  assert.equal(c2.isCurrentReceipt(oldReceipt), true);
  const heldTaskId = store.submit('Chest pressure.', { locale: 'en' });
  assert.ok(heldTaskId);
  await tick(); await tick();
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(store.getTrainerSafetySnapshot().revision, oldSafetyRevision + 1);
  assert.equal(c2.isCurrentReceipt(oldReceipt), false);
  assert.equal(store.submit('That happened last year, not now.', { locale: 'en' }), heldTaskId);
  assert.equal(store.getTrainerSafetySnapshot().state, 'OPEN');
  assert.equal(store.getTrainerSafetySnapshot().revision, oldSafetyRevision + 2);
  assert.equal(store.getTrainerActionAvailability(), 'AVAILABLE');
  view = h.render();
  assert.equal(c2.isCurrentReceipt(oldReceipt), false);
  assert.equal(c2.currentReceipt(), undefined);
  assert.equal(view.cameraC1, undefined);
  assert.equal(view.cameraC2, undefined);
  assert.equal(networkCalls, 0);
});

test('fresh Safety signal during clarification publishes no transient Camera-ready projection', async () => {
  const { h } = await preparedRealOwnerA();
  const store = h.findTaskStore();
  const c2 = h.findC2();
  const receipt = c2.currentReceipt();
  const lifetime = h.findM3Lifetime();
  const observed = [];
  const unsubscribe = store.subscribe(() => {
    const projection = lifetime.getSnapshot();
    observed.push({ safety: projection.safety.state, availability: projection.availability,
      receiptCurrent: c2.isCurrentReceipt(receipt) });
  });
  try {
    const heldTaskId = store.submit('Chest pressure.', { locale: 'en' });
    assert.ok(heldTaskId);
    assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
    assert.equal(store.submit('I just fainted while running.', { locale: 'en' }), heldTaskId);
    assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
    assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
    assert.ok(observed.length >= 2);
    assert.ok(observed.every((state) => state.safety === 'HOLD'
      && state.availability === 'SAFETY_HOLD' && !state.receiptCurrent),
    `observed publication: ${JSON.stringify(observed)}`);
    assert.equal(h.render().cameraC0, undefined);
  } finally { unsubscribe(); }
});

test('A-to-B, new lease and new access each create a new owned Camera task store', async () => {
  const h = realOwnerFixture();
  await h.verify(OWNER_A);
  h.render(); h.render();
  const first = h.findTaskStore();
  const firstSession = first.getSnapshot().session_id;
  await h.verify(OWNER_B);
  h.render(); h.render();
  const second = h.findTaskStore();
  assert.notEqual(second, first);
  assert.notEqual(second.getSnapshot().session_id, firstSession);
  assert.equal(first.getTrainerActionAvailability(), 'UNAVAILABLE');
  await h.verify(OWNER_B);
  h.render(); h.render();
  const newLease = h.findTaskStore();
  assert.notEqual(newLease, second);
  assert.notEqual(newLease.getSnapshot().session_id, second.getSnapshot().session_id);
  h.replaceBoundary();
  await h.verify(OWNER_B);
  h.render(); h.render();
  const newAccess = h.findTaskStore();
  assert.notEqual(newAccess, newLease);
  assert.equal(newLease.getTrainerActionAvailability(), 'UNAVAILABLE');
  assert.equal(newAccess.getTrainerActionAvailability(), 'AVAILABLE');
});

test('blocked owner mode cannot start a task; locale and rerender preserve one owned store', async () => {
  const h = realOwnerFixture();
  await h.verify(OWNER_A);
  for (const pending of ['VERIFYING', 'HYDRATING']) {
    h.setMode('BLOCKED');
    h.render(); const view = h.render();
    assert.equal(h.findTaskStore(), undefined, pending);
    view.submit('Đánh giá ảnh bữa ăn');
    assert.equal(view.cameraC0, undefined);
  }
  h.setMode('OWNED');
  h.render(); h.render();
  const store = h.findTaskStore();
  assert.ok(store?.getSnapshot().session_id);
  h.render(); h.setLocale('en'); h.render();
  assert.equal(h.findTaskStore(), store);
  assert.equal(store.getTrainerActionAvailability(), 'AVAILABLE');
});

test('Strict Mode cleanup retires old owned store instead of restarting it', async () => {
  const h = realOwnerFixture();
  await h.verify(OWNER_A);
  h.render(); h.render();
  const old = h.findTaskStore();
  const oldSession = old.getSnapshot().session_id;
  h.cleanupEffects();
  assert.equal(old.getTrainerActionAvailability(), 'UNAVAILABLE');
  h.render(); h.render();
  const fresh = h.findTaskStore();
  assert.notEqual(fresh, old);
  assert.notEqual(fresh.getSnapshot().session_id, oldSession);
  assert.equal(fresh.getTrainerActionAvailability(), 'AVAILABLE');
});

test('Safety HOLD during a pending picker blocks its late candidate', async () => {
  const { h, view } = await readyRealOwnerA();
  const store = h.findTaskStore();
  const ref = store.reference(activeTask(h).task_id);
  const gate = deferred();
  choosePhotoResult = () => gate.promise;
  try {
    const pending = view.chooseCameraPhoto();
    assert.equal(h.findC0().getSnapshot().phase, 'PICKING');
    assert.equal(store.signalTrainerSafety(ref, 'PROBLEM'), true);
    gate.resolve({ canceled: false, asset: { uri: 'ph://late-held-photo' } });
    assert.equal(await pending, false);
    assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
    assert.equal(h.findC0().getSnapshot().candidate, undefined);
    assert.equal(h.findC0().getSnapshot().receipt, undefined);
    assert.equal(h.findC1().getSnapshot(), undefined);
  } finally {
    choosePhotoResult = async () => ({ canceled: false, asset: { uri: 'ph://library-photo' } });
  }
});

test('Safety HOLD during local save rejects late artifact and cleans only generated cache', async () => {
  const { h, view } = await locallyAllowedRealOwnerA();
  const store = h.findTaskStore();
  const ref = store.reference(activeTask(h).task_id);
  const gate = deferred();
  const expectedUri = `file:///app/cache/prepared-${preparedSequence + 1}.jpg`;
  const deletesBefore = globalThis.__cameraFileDeletes.length;
  saveGate = gate;
  try {
    const pending = view.allowExternalProcessingAndPrepare(view.cameraC2.view_token);
    await tick();
    assert.equal(store.signalTrainerSafety(ref, 'PROBLEM'), true);
    gate.resolve();
    assert.equal(await pending, false);
    assert.equal(h.findC2().currentReceipt(), undefined);
    assert.equal(await h.findC2().settleCleanup(), true);
    assert.deepEqual(globalThis.__cameraFileDeletes.slice(deletesBefore).map((call) => call.uri),
      [expectedUri]);
    assert.ok(!globalThis.__cameraFileDeletes.some((call) => call.uri === 'ph://library-photo'));
  } finally { saveGate = undefined; }
});

test('failed owned-cache cleanup never reopens Camera after Safety HOLD', async () => {
  const { h, view } = await preparedRealOwnerA();
  const store = h.findTaskStore();
  const ref = store.reference(activeTask(h).task_id);
  globalThis.__cameraDeleteFailure = true;
  try {
    assert.equal(store.signalTrainerSafety(ref, 'PROBLEM'), true);
    assert.equal(await h.findC2().settleCleanup(), false);
    assert.equal(h.findC2().cleanupStatus().failed, true);
    assert.equal(h.findC2().currentReceipt(), undefined);
    assert.equal(await view.chooseCameraPhoto(), false);
    assert.equal(store.getTrainerActionAvailability(), 'SAFETY_HOLD');
  } finally { globalThis.__cameraDeleteFailure = false; }
});

test('owner logout during Safety HOLD retires the bound store without clearing HOLD by replacement', async () => {
  const { h, view } = await preparedRealOwnerA();
  const store = h.findTaskStore();
  const c2 = h.findC2();
  const receipt = c2.currentReceipt();
  const ref = store.reference(activeTask(h).task_id);
  assert.equal(store.signalTrainerSafety(ref, 'PROBLEM'), true);
  assert.equal(store.getTrainerSafetySnapshot().state, 'HOLD');
  h.logout();
  assert.equal(store.getTrainerSafetySnapshot().state, 'UNAVAILABLE');
  assert.equal(store.getTrainerActionAvailability(), 'UNAVAILABLE');
  assert.equal(c2.isCurrentReceipt(receipt), false);
  assert.equal(await view.chooseCameraPhoto(), false);
  assert.equal(h.render().cameraC0, undefined);
  assert.equal(h.findTaskStore(), undefined);
  assert.ok(!globalThis.__cameraFileDeletes.some((call) => call.uri === 'ph://library-photo'));
});
