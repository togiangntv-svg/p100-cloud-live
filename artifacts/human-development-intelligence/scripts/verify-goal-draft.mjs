// Synthetic authority/storage only. Actual component and M2 hook, deterministic
// React hooks/native-host doubles: this is not native/device certification.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { Script } from 'node:vm';
import ts from 'typescript';
import { OWNER_A as A, OWNER_B as B, FakeClock, FakeStorage, fakeAuthority } from './fixtures/local-owner.mjs';
import { fixtureA1, fixtureB2, NOW } from './fixtures/m2.mjs';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@workspace/api-client-react') {
    return next(new URL('../../../lib/api-client-react/src/index.ts', import.meta.url).href, context);
  }
  if (specifier.startsWith('.') && (!extname(specifier) || specifier.endsWith('/api.schemas'))) specifier += '.ts';
  return next(specifier, context);
} });
let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw new Error('NETWORK_FORBIDDEN_IN_GOAL_DRAFT_TEST'); };
// Exercise real task lifecycle, permissions and decisions; only native hosts are doubled.
const taskModule = await import('../domain/session-task/store.ts');
const m3Gateway = await import('../domain/m3/gateway-adapter.ts');
const m3Permission = await import('../domain/m3/host-permission.ts');
const m3RuntimeMode = await import('../domain/m3/runtime-mode.ts');
const m4Ui = await import('../domain/m4/ui-stub.ts');
const m5Decision = await import('../domain/m5/meal-image-decision.ts');
const m5Goal = await import('../domain/m5/goal-choice.ts');
const cameraCandidate = await import('../domain/camera/candidate.ts');
const taskCopy = await import('../i18n-task.ts');
const m3Presentation = await import('../components/m3Presentation.ts');
const draftModule = await import('../components/goal-draft/store.ts');
const { createGoalDraftStore } = draftModule;
const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const m2Domain = await import('../domain/m2.ts');
const m2Input = await import('../components/m2InputState.ts');
const m2Copy = await import('../i18n-m2.ts');
const i18n = await import('../i18n.ts');
const flowSource = await readFile(new URL('../components/OpeningGoalFlow.tsx', import.meta.url), 'utf8');
const hookSource = await readFile(new URL('../components/useM2Gateway.ts', import.meta.url), 'utf8');
const storeSource = await readFile(new URL('../components/goal-draft/store.ts', import.meta.url), 'utf8');
const legacy = '@100-human-development-opening-goal-draft';
const legacyBytes = '  SYNTHETIC_UNOWNED_PERSON_A\r\n';
const key = owner => '@100/v2/subject/' + owner.subjectId + '/profile/' + owner.profileId + '/opening-goal-draft';
const envelope = (owner, value) => JSON.stringify({ schemaVersion: 1, owner, value });
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
const seed = (f, owner, value) => f.backend.data.set(key(owner), envelope(owner, value));
const disk = (f, owner) => { const raw = f.backend.data.get(key(owner)); return raw ? JSON.parse(raw).value : undefined; };
const tests = [];
const test = (name, body) => tests.push({ name, body });
function fixture() {
  const backend = new FakeStorage(), clock = new FakeClock(), authority = fakeAuthority();
  backend.data.set(legacy, legacyBytes);
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  const stores = [], screens = [];
  async function lease(owner, ready = true) {
    authority.results.push({ status: 'verified', owner, validUntil: clock.now() + 1_000_000 });
    const value = await boundary.control.verifySession();
    if (ready) boundary.control.finishHydration(value);
    return value;
  }
  const binding = value => value ? { access: boundary.access, lease: value } : undefined;
  const mount = (value, extras = {}) => {
    const store = createGoalDraftStore({ backend, owner: binding(value), ...extras });
    stores.push(store); store.start(); return store;
  };
  const f = { backend, clock, authority, boundary, lease, binding, mount,
    screen(props = {}) { const s = componentFixture(backend, props); screens.push(s); return s; },
    cleanup() { for (const s of screens) s.unmount(); for (const s of stores) s.stop(); },
  };
  return f;
}

test('Legacy key is absent from component/helper operations; no delete, enumeration or fallback', () => {
  assert.doesNotMatch(flowSource + storeSource, /OPENING_GOAL_DRAFT_STORAGE_KEY|@100-human-development-opening-goal-(draft|flow)/);
  assert.doesNotMatch(flowSource, /AsyncStorage\.(getItem|setItem|removeItem|clear)/);
  assert.doesNotMatch(storeSource, /removeUserState|clearOwnerNamespace|getAllKeys\(/);
});
test('No owner: free text and empty edits use RAM with zero storage operations', async f => {
  const s = f.mount(); assert.equal(s.getSnapshot().text, '');
  assert.ok(s.getSnapshot().changeText('SYNTHETIC_A_DRAFT'));
  assert.equal(s.getSnapshot().text, 'SYNTHETIC_A_DRAFT');
  assert.ok(s.getSnapshot().changeText('')); await settle();
  assert.equal(f.backend.calls.length, 0);
});
test('No owner: remount/restart does not restore previous RAM or global bytes', async f => {
  const a = f.mount(); a.getSnapshot().changeText('SYNTHETIC_A_DRAFT'); a.stop();
  const b = f.mount(); await settle(); assert.equal(b.getSnapshot().text, '');
  assert.equal(f.backend.calls.length, 0);
});
test('Valid A: persist only under verified Subject/Profile namespace', async f => {
  const s = f.mount(await f.lease(A)); await settle();
  s.getSnapshot().changeText('SYNTHETIC_A_DRAFT'); await settle();
  assert.equal(disk(f, A), 'SYNTHETIC_A_DRAFT');
  assert.ok(f.backend.calls.every(call => call.key === key(A)));
});
test('A to B to A with new generation: independent restoration and every snapshot isolated', async f => {
  const leaseA = await f.lease(A), a = f.mount(leaseA); await settle();
  a.getSnapshot().changeText('SYNTHETIC_A_DRAFT'); await settle();
  const savedA = f.backend.data.get(key(A));
  f.boundary.control.invalidateCurrentSession();
  assert.equal(a.getSnapshot().text, '');
  assert.equal(f.backend.data.get(key(A)), savedA);
  const b = f.mount(await f.lease(B)), seenB = [b.getSnapshot().text];
  b.subscribe(() => seenB.push(b.getSnapshot().text)); await settle();
  b.getSnapshot().changeText('SYNTHETIC_B_DRAFT'); await settle();
  assert.equal(disk(f, B), 'SYNTHETIC_B_DRAFT');
  assert.ok(!seenB.includes('SYNTHETIC_A_DRAFT'));
  f.boundary.control.invalidateCurrentSession();
  const returnLease = await f.lease(A);
  assert.notEqual(returnLease, leaseA);
  const returned = f.mount(returnLease), seenA = [returned.getSnapshot().text];
  returned.subscribe(() => seenA.push(returned.getSnapshot().text)); await settle();
  assert.equal(returned.getSnapshot().text, 'SYNTHETIC_A_DRAFT');
  assert.ok(!seenA.includes('SYNTHETIC_B_DRAFT'));
});
test('Late A hydration cannot publish or change B RAM/storage/status', async f => {
  seed(f, A, 'SYNTHETIC_A_DRAFT'); seed(f, B, 'SYNTHETIC_B_DRAFT');
  const gate = f.backend.holdNext('getItem');
  const a = f.mount(await f.lease(A)); await gate.started;
  f.boundary.control.invalidateCurrentSession();
  const b = f.mount(await f.lease(B)); await settle();
  const before = b.getSnapshot(), bytes = f.backend.data.get(key(B));
  gate.release(); await settle();
  assert.equal(a.getSnapshot().text, '');
  assert.equal(b.getSnapshot(), before); assert.equal(f.backend.data.get(key(B)), bytes);
});
test('Late A write: captured A cleanup only; B snapshot/status/storage untouched', async f => {
  const a = f.mount(await f.lease(A)); await settle();
  const gate = f.backend.holdNext('setItem');
  a.getSnapshot().changeText('SYNTHETIC_A_LATE'); await gate.started;
  f.boundary.control.invalidateCurrentSession();
  const b = f.mount(await f.lease(B)); await settle();
  b.getSnapshot().changeText('SYNTHETIC_B_DRAFT'); await settle();
  const before = b.getSnapshot(), bytes = f.backend.data.get(key(B));
  gate.release(); await settle();
  assert.equal(b.getSnapshot(), before); assert.equal(f.backend.data.get(key(B)), bytes);
  assert.equal(disk(f, A), undefined);
  assert.deepEqual(f.backend.calls.filter(c => c.method === 'removeItem').map(c => c.key), [key(A)]);
});
test('Stale same-Subject generation callback is rejected and old settled draft survives', async f => {
  const a = f.mount(await f.lease(A)); await settle();
  a.getSnapshot().changeText('SYNTHETIC_SETTLED'); await settle();
  const stale = a.getSnapshot();
  const returned = f.mount(await f.lease(A)); await settle();
  assert.equal(stale.changeText('SYNTHETIC_STALE'), false);
  assert.equal(returned.getSnapshot().text, 'SYNTHETIC_SETTLED');
  assert.equal(disk(f, A), 'SYNTHETIC_SETTLED');
});
test('Fake and copied leases cannot persist, but RAM typing works', async f => {
  const lease = await f.lease(A);
  for (const fake of [{ subjectId: A.subjectId, profileId: A.profileId }, { ...lease }]) {
    const s = f.mount(fake); assert.ok(s.getSnapshot().changeText('SYNTHETIC_RAM'));
    assert.equal(s.getSnapshot().text, 'SYNTHETIC_RAM');
  }
  await settle(); assert.equal(f.backend.calls.length, 0);
});
test('Malformed verified-owner result is rejected by sealed authority; RAM remains usable', async f => {
  await assert.rejects(f.lease({ subjectId: '../bad', profileId: '' }));
  const s = f.mount({}); assert.ok(s.getSnapshot().changeText('SYNTHETIC_RAM'));
  await settle(); assert.equal(f.backend.calls.length, 0);
});
test('HYDRATING is not READY; session text is not imported on READY', async f => {
  seed(f, A, 'SYNTHETIC_OWNED');
  const lease = await f.lease(A, false), s = f.mount(lease);
  s.getSnapshot().changeText('SYNTHETIC_UNOWNED');
  assert.equal(f.backend.calls.length, 0);
  f.boundary.control.finishHydration(lease);
  assert.equal(s.getSnapshot().text, ''); await settle();
  assert.equal(s.getSnapshot().text, 'SYNTHETIC_OWNED');
  assert.equal(f.backend.calls.filter(c => c.method === 'setItem').length, 0);
});
test('Same Subject with different Profile restores only that Profile', async f => {
  const other = { ...A, profileId: 'fixture-second-profile' };
  seed(f, A, 'SYNTHETIC_PROFILE_ONE'); seed(f, other, 'SYNTHETIC_PROFILE_TWO');
  const a = f.mount(await f.lease(A)); await settle();
  const b = f.mount(await f.lease(other)); assert.equal(b.getSnapshot().text, ''); await settle();
  assert.equal(b.getSnapshot().text, 'SYNTHETIC_PROFILE_TWO'); assert.equal(a.getSnapshot().text, '');
});
test('Invalidation synchronously clears RAM without deleting settled owned bytes', async f => {
  seed(f, A, 'SYNTHETIC_OWNED'); const s = f.mount(await f.lease(A)); await settle();
  const before = new Map(f.backend.data); let observed;
  s.subscribe(() => { observed = s.getSnapshot().text; });
  f.boundary.control.invalidateCurrentSession();
  assert.equal(observed, ''); assert.deepEqual(f.backend.data, before);
  assert.ok(s.getSnapshot().changeText('SYNTHETIC_NEW_SESSION')); await settle();
  assert.deepEqual(f.backend.data, before);
});
test('Expiry backstop clears draft and rejects old callbacks even without timer delivery', async f => {
  seed(f, A, 'SYNTHETIC_OWNED'); const s = f.mount(await f.lease(A)); await settle();
  const stale = s.getSnapshot(); f.clock.jumpWithoutTimers(1_000_001);
  assert.equal(stale.changeText('SYNTHETIC_STALE'), false); assert.equal(s.getSnapshot().text, '');
  assert.equal(disk(f, A), 'SYNTHETIC_OWNED');
});
test('Absent/null/empty all mean empty text, with no auto-write or identity inference', async f => {
  for (const value of [undefined, null, '']) {
    if (value === undefined) f.backend.data.delete(key(A)); else seed(f, A, value);
    const s = f.mount(await f.lease(A)); await settle();
    assert.equal(s.getSnapshot().text, ''); assert.equal(s.getSnapshot().persistence, 'ready'); s.stop();
  }
  assert.ok(f.backend.calls.every(c => c.method === 'getItem'));
});
test('Corrupt owner/schema/value fail closed for persistence; session UX continues', async f => {
  for (const raw of ['{', envelope(B, 'SYNTHETIC_B'), '{"schemaVersion":2}',
    envelope(A, { text: 'SYNTHETIC_BAD' }), envelope(A, 'x'.repeat(1001))]) {
    f.backend.data.set(key(A), raw); const s = f.mount(await f.lease(A)); await settle();
    assert.equal(s.getSnapshot().text, ''); assert.equal(s.getSnapshot().persistence, 'error');
    assert.ok(s.getSnapshot().changeText('SYNTHETIC_RAM')); await settle();
    assert.equal(f.backend.data.get(key(A)), raw); s.stop();
  }
});
test('Read error cannot trigger fallback/global writes or block typing', async f => {
  const gate = f.backend.holdNext('getItem', true), s = f.mount(await f.lease(A));
  await gate.started; gate.release(); await settle();
  assert.equal(s.getSnapshot().persistence, 'error'); s.getSnapshot().changeText('SYNTHETIC_RAM');
  await settle(); assert.ok(f.backend.calls.every(c => c.method === 'getItem'));
});
test('Input before slow hydration wins and persists after validated read', async f => {
  seed(f, A, 'SYNTHETIC_OLD'); const gate = f.backend.holdNext('getItem');
  const s = f.mount(await f.lease(A)); await gate.started;
  s.getSnapshot().changeText('SYNTHETIC_TYPED'); gate.release(); await settle();
  assert.equal(s.getSnapshot().text, 'SYNTHETIC_TYPED'); assert.equal(disk(f, A), 'SYNTHETIC_TYPED');
});
test('Unmount rejects delayed hydration and stale input without deleting owned bytes', async f => {
  seed(f, A, 'SYNTHETIC_A'); const gate = f.backend.holdNext('getItem');
  const s = f.mount(await f.lease(A)); await gate.started;
  const stale = s.getSnapshot(); s.stop(); gate.release(); await settle();
  assert.equal(s.getSnapshot().text, ''); assert.equal(stale.changeText('SYNTHETIC_STALE'), false);
  assert.equal(disk(f, A), 'SYNTHETIC_A');
});
test('Strict effect stop/start creates fresh run and rejects prior callback', async f => {
  const s = f.mount(await f.lease(A)); await settle(); const stale = s.getSnapshot();
  s.stop(); s.start(); await settle();
  assert.equal(stale.changeText('SYNTHETIC_STALE'), false);
  assert.ok(s.getSnapshot().changeText('SYNTHETIC_FRESH')); await settle();
  assert.equal(disk(f, A), 'SYNTHETIC_FRESH');
});
test('Reentrant subscriber input retains write ordering', async f => {
  const s = f.mount(await f.lease(A)); await settle(); let nested = false;
  s.subscribe(() => { if (!nested) { nested = true; s.getSnapshot().changeText('SYNTHETIC_LATEST'); } });
  s.getSnapshot().changeText('SYNTHETIC_FIRST'); await settle();
  assert.equal(disk(f, A), 'SYNTHETIC_LATEST');
});
test('Observer failure cannot interrupt invalidation or subsequent generation hydration', async f => {
  seed(f, A, 'SYNTHETIC_A'); const s = f.mount(await f.lease(A)); await settle();
  s.subscribe(() => { throw new Error('SYNTHETIC_OBSERVER_FAILURE'); });
  let visible; s.subscribe(() => { visible = s.getSnapshot().text; });
  f.boundary.control.invalidateCurrentSession(); assert.equal(visible, '');
  await f.lease(B); assert.equal(s.getSnapshot().text, '');
});
test('Late failed A write cannot change B persistence status or payload', async f => {
  const a = f.mount(await f.lease(A)); await settle();
  const gate = f.backend.holdNext('setItem', true);
  a.getSnapshot().changeText('SYNTHETIC_A_LATE'); await gate.started;
  const b = f.mount(await f.lease(B)); await settle();
  b.getSnapshot().changeText('SYNTHETIC_B'); await settle();
  const before = b.getSnapshot(), bytes = f.backend.data.get(key(B));
  gate.release(); await settle();
  assert.equal(b.getSnapshot(), before); assert.equal(f.backend.data.get(key(B)), bytes);
});
test('Same owner new generation waits for stale write cleanup, then saves only new input', async f => {
  const a = f.mount(await f.lease(A)); await settle();
  const gate = f.backend.holdNext('setItem');
  a.getSnapshot().changeText('SYNTHETIC_OLD_GENERATION'); await gate.started;
  const returned = f.mount(await f.lease(A));
  returned.getSnapshot().changeText('SYNTHETIC_NEW_GENERATION');
  gate.release(); await settle();
  assert.equal(returned.getSnapshot().text, 'SYNTHETIC_NEW_GENERATION');
  assert.equal(disk(f, A), 'SYNTHETIC_NEW_GENERATION');
});
test('Binding captures its lease and cannot be retargeted by mutating the caller object', async f => {
  const bound = f.binding(await f.lease(A)), s = f.mount(undefined, { owner: bound }); await settle();
  const stale = s.getSnapshot(); bound.lease = await f.lease(B);
  assert.equal(stale.changeText('SYNTHETIC_STALE'), false);
  assert.ok(s.getSnapshot().changeText('SYNTHETIC_RAM')); await settle();
  assert.equal(disk(f, B), undefined);
});
test('Gateway hint mismatch/denial cannot grant persistence', async f => {
  const lease = await f.lease(A);
  const s = f.mount(lease, { subjectHint: B.subjectId }), denied = f.mount(lease, { persistenceAllowed: false });
  s.getSnapshot().changeText('SYNTHETIC_RAM'); denied.getSnapshot().changeText('SYNTHETIC_RAM');
  await settle(); assert.equal(f.backend.calls.length, 0);
});

// Execute the actual OpeningGoalFlow and useM2Gateway without altering their source.
// Record every render (including state-adjustment passes), not just settled snapshots.
const transpile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const flowCode = transpile(flowSource), hookCode = transpile(hookSource);
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
function componentFixture(backend, initialProps) {
  const cells = [], timers = new Map(), frames = [];
  let cursor = 0, pending = [], dirty = false, tree, props = initialProps, opened = 0;
  const renders = [];
  const cameraEffects = { native: 0, c1Grant: 0, c2Action: 0, cacheDelete: 0 };
  const react = {
    createElement: (type, input, ...children) => ({ type, props: { ...input, children } }),
    useState(initial) {
      const index = cursor++;
      if (!cells[index]) cells[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [cells[index].value, next => {
        const value = typeof next === 'function' ? next(cells[index].value) : next;
        if (!Object.is(value, cells[index].value)) { cells[index].value = value; dirty = true; }
      }];
    },
    useRef(initial) { const i = cursor++; return cells[i] ??= { current: initial }; },
    useMemo(run, deps) {
      const i = cursor++; if (!same(cells[i]?.deps, deps)) cells[i] = { deps, value: run() };
      return cells[i].value;
    },
    useCallback(run, deps) { return react.useMemo(() => run, deps); },
    useEffect(run, deps) {
      const i = cursor++;
      if (!same(cells[i]?.deps, deps)) {
        const prior = cells[i]; cells[i] = { deps };
        pending.push(() => { prior?.cleanup?.(); cells[i].cleanup = run(); });
      }
    },
    useLayoutEffect(run, deps) { return react.useEffect(run, deps); },
    useSyncExternalStore(subscribe, getSnapshot) {
      react.useEffect(() => subscribe(() => { dirty = true; }), [subscribe]);
      return getSnapshot();
    },
  };
  const animation = () => ({ start: callback => callback?.({ finished: true }), stop() {} });
  class Value { constructor(v) { this.value = v; } setValue(v) { this.value = v; }
    stopAnimation() {} interpolate() { return this; } }
  const native = {
    AccessibilityInfo: { isReduceMotionEnabled: async () => true, addEventListener: () => ({ remove() {} }) },
    Animated: { Value, View: 'Animated.View', Image: 'Animated.Image', timing: animation, spring: animation, sequence: animation,
      parallel: animation, delay: animation, loop: animation },
    AppState: { addEventListener: () => ({ remove() {} }) },
    Keyboard: { dismiss() {} },
    Easing: { out: v => v, in: v => v, inOut: v => v, back: v => v, quad: 1, cubic: 1 },
    Platform: { OS: 'ios', select: v => v.ios },
    StyleSheet: { create: v => v, absoluteFillObject: {}, hairlineWidth: 1 },
    useWindowDimensions: () => ({ width: 390, height: 844 }), findNodeHandle: () => null,
    ...Object.fromEntries(['Image', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(x => [x, x])),
  };
  function load(code, deps) {
    const mod = { exports: {} };
    new Script(code).runInNewContext({
      exports: mod.exports, module: mod, Date: class extends Date { static now() { return NOW; } },
      process: { env: { EXPO_PUBLIC_M3_RUNTIME_MODE: 'fixture' } },
      require(name) { assert.ok(Object.hasOwn(deps, name), 'Unexpected component dependency: ' + name); return deps[name]; },
      setTimeout(fn) { const id = Symbol(); timers.set(id, fn); return id; },
      clearTimeout(id) { timers.delete(id); }, requestAnimationFrame(fn) { frames.push(fn); },
    });
    return mod.exports;
  }
  const hook = load(hookCode, {
    react, '@/domain/m2': m2Domain, '@/i18n-m2': m2Copy, './m2InputState': m2Input,
    '@/domain/session-task/store': taskModule,
    '@/domain/m3/gateway-adapter': m3Gateway,
    '@/domain/m3/host-permission': m3Permission,
    '@/domain/m3/runtime-mode': m3RuntimeMode,
    '@/domain/m4/ui-stub': m4Ui,
    '@/domain/m5/meal-image-decision': m5Decision,
    '@/domain/m5/goal-choice': m5Goal,
    '@/domain/camera/candidate': cameraCandidate,
    '@/domain/camera/m4-context': { createCameraM4ContextStore: () => Object.freeze({
      retire() {}, bind() { return false; }, getSnapshot() { return undefined; },
      project() { return undefined; },
      assess() { return { decision: { state: 'DEFERRED' } }; },
      consume() { cameraEffects.c1Grant++; return false; },
      allow() { cameraEffects.c1Grant++; return false; },
      decline() { cameraEffects.c1Grant++; return false; },
      revoke() { cameraEffects.c1Grant++; return false; },
    }) },
    '@/i18n-task': taskCopy,
    './cameraC0Picker': { expoCameraC0Picker: Object.freeze({
      requestCameraPermission: async () => { cameraEffects.native++; return 'denied'; },
      takePhoto: async () => { cameraEffects.native++; return { canceled: true }; },
      choosePhoto: async () => { cameraEffects.native++; return { canceled: true }; },
    }) },
    './CameraLocalPreview.tsx': { createCameraLocalPreviewHandle: () => () => null },
    '@/lib/camera/c2-runtime': { createCameraC2RuntimeController: () => {
      const unavailable = Object.freeze({ state: 'UNAVAILABLE', view_token: Object.freeze({}),
        external_consent: 'OFF', external_transfer: 'NOT_SENT' });
      const reject = () => { cameraEffects.c2Action++; return false; };
      return Object.freeze({ view: () => unavailable, retire() {},
        allowExternalProcessingAndPrepare: async () => reject(),
        declineExternalProcessing: reject, revokeExternalProcessing: reject,
        retryLocalPreparation: async () => reject(),
      });
    } },
    '@/lib/camera/expo-cache-cleanup': { createExpoCacheCleanup: () => Object.freeze({
      canDeleteOwnedCache: () => false,
      deleteOwnedCache: async () => { cameraEffects.cacheDelete++; return false; },
    }) },
    './m3-host-lifetime': { createM3HostLifetime: () => {
      const unavailable = Object.freeze({ task: Object.freeze({ session_id: null, tasks: Object.freeze([]),
        active_task_id: null, revision: 0 }), safety: Object.freeze({ state: 'UNAVAILABLE', revision: 0,
        session_id: null }), availability: 'UNAVAILABLE' });
      return Object.freeze({ subscribe: () => () => {}, getSnapshot: () => unavailable,
        currentSlot: () => undefined, activate() {}, deactivate() {} });
    } },
    './m3Presentation': m3Presentation,
  });
  const component = load(flowCode, {
    react, 'react-native': native, '@expo/vector-icons': { Feather: 'Feather', MaterialCommunityIcons: 'Icons' },
    'expo-linear-gradient': { LinearGradient: 'Gradient' }, 'expo-status-bar': { StatusBar: 'StatusBar' },
    '@react-native-async-storage/async-storage': backend,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 20, bottom: 20 }) },
    'react-native-keyboard-controller': {
      KeyboardAvoidingView: 'KeyboardAvoidingView',
      useKeyboardState: selector => selector({ isVisible: false }),
    },
    '@/components/WelcomeLogoAnimation': { WelcomeLogoAnimation: 'Logo' },
    '@/components/Animated100Signature': { Animated100Signature: 'Signature' },
    '@/components/TrainerJourneyCard': { TrainerJourneyCard: 'TrainerJourneyCard' },
    '@/context/TrainerRuntimeContext': { useOptionalTrainerJourney: () => undefined },
    '@/context/LocalizationContext': { useLocale: () => ({ locale: 'vi', setLocale() {}, t: k => i18n.translate('vi', k) }) },
    './goal-draft/store': draftModule, '@/hooks/useColors': { useColors: () => ({}) },
    '@/components/useM2Gateway': hook, '@/domain/m2': m2Domain, '@/i18n': i18n,
    '../assets/images/100-v05-sunless-scene-v1.png': 1,
  }).OpeningGoalFlow;
  const walk = (node, found = []) => {
    if (Array.isArray(node)) { node.forEach(n => walk(n, found)); return found; }
    if (!node || typeof node !== 'object') return found;
    found.push(node); walk(node.props?.children, found); return found;
  };
  const nodes = () => walk(tree);
  const find = id => nodes().find(n => n.props?.testID === id);
  const render = (effects = true) => {
    for (let count = 0; ; count++) {
      assert.ok(count < 30, 'Component render did not settle');
      cursor = 0; dirty = false;
      tree = component({ initialPhase: 'goal', reviewing: false, onGoalOpened: () => opened++, onClose() {}, ...props });
      renders.push(find('opening-goal-input')?.props.value ?? '');
      if (effects) { const jobs = pending; pending = []; jobs.forEach(job => job()); }
      if (!dirty) break;
    }
  };
  render();
  return {
    renders, find, get text() { return find('opening-goal-input')?.props.value; }, get opened() { return opened; },
    get cameraEffects() { return { ...cameraEffects }; },
    update(next, effects = true) { props = next; render(effects); },
    type(value) { find('opening-goal-input').props.onChangeText(value); render(); },
    chips() { return nodes().filter(n => n.props?.testID?.startsWith('opening-goal-chip-')); },
    press(node) { node.props.onPressIn?.(); node.props.onPressOut?.(); node.props.onPress(); render(); },
    async flush() { await settle(); render(); },
    render,
    unmount() { for (const cell of cells) cell?.cleanup?.(); },
  };
}
const gateway = owner => { const snapshot = fixtureA1(); snapshot.subject.id = owner.subjectId; return { snapshot }; };

test('GoalDraft render keeps Camera doubles inert and performs no network call', async f => {
  const s = f.screen({ m2Gateway: gateway(A), ownerSession: f.binding(await f.lease(A)) });
  await s.flush();
  assert.deepEqual(s.cameraEffects, { native: 0, c1Grant: 0, c2Action: 0, cacheDelete: 0 });
  assert.equal(networkCalls, 0);
});

test('Actual component: no-owner M1 to M2, free typing, suggestions and remount', async f => {
  const s = f.screen({ initialPhase: 'opening' });
  s.press(s.find('opening-logo-open')); assert.equal(s.opened, 1);
  s.type('SYNTHETIC_TYPED'); assert.equal(s.text, 'SYNTHETIC_TYPED');
  const chip = s.chips()[0]; s.press(chip); assert.equal(s.text, chip.props.accessibilityLabel);
  await s.flush(); assert.equal(f.backend.calls.length, 0); s.unmount();
  const next = f.screen(); assert.equal(next.text, '');
});
test('Actual component: managed M2 gateway alone grants no storage authority; both inputs work', async f => {
  const s = f.screen({ m2Gateway: gateway(A) });
  s.type('SYNTHETIC_TYPED'); assert.equal(s.text, 'SYNTHETIC_TYPED');
  const chip = s.chips()[0]; s.press(chip); assert.equal(s.text, chip.props.accessibilityLabel);
  await s.flush(); assert.equal(f.backend.calls.length, 0);
});
for (const managed of [false, true]) {
  test('Actual component A/B/A: both callbacks reject old owner; every render clean; managed=' + managed, async f => {
    const makeProps = lease => ({ ownerSession: f.binding(lease), ...(managed ? { m2Gateway: gateway(A) } : {}) });
    const leaseA = await f.lease(A), s = f.screen(makeProps(leaseA)); await s.flush();
    s.type('SYNTHETIC_A_DRAFT'); await s.flush();
    const oldInput = s.find('opening-goal-input').props.onChangeText, oldChip = s.chips()[0];
    f.boundary.control.invalidateCurrentSession(); s.render(); assert.equal(s.text, '');
    const leaseB = await f.lease(B), bProps = { ownerSession: f.binding(leaseB), ...(managed ? { m2Gateway: gateway(B) } : {}) };
    const startB = s.renders.length; s.update(bProps, false);
    assert.equal(s.text, ''); oldInput('SYNTHETIC_STALE_FREE'); oldChip.props.onPress();
    s.render(); await s.flush(); assert.equal(s.text, '');
    assert.ok(!s.renders.slice(startB).includes('SYNTHETIC_A_DRAFT'));
    const bChip = s.chips()[0]; s.press(bChip); await s.flush();
    assert.equal(disk(f, B), bChip.props.accessibilityLabel);
    s.type('SYNTHETIC_B_DRAFT'); await s.flush(); assert.equal(disk(f, B), 'SYNTHETIC_B_DRAFT');
    const staleB = s.find('opening-goal-input').props.onChangeText;
    const returned = await f.lease(A), startA = s.renders.length;
    s.update(makeProps(returned)); staleB('SYNTHETIC_STALE_B'); await s.flush();
    assert.equal(s.text, 'SYNTHETIC_A_DRAFT');
    assert.ok(!s.renders.slice(startA).includes('SYNTHETIC_B_DRAFT'));
  });
}
test('Actual component: same-Subject new generation rejects typing and suggestion callbacks', async f => {
  const s = f.screen({ ownerSession: f.binding(await f.lease(A)), m2Gateway: gateway(A) }); await s.flush();
  const staleInput = s.find('opening-goal-input').props.onChangeText, staleChip = s.chips()[0];
  s.update({ ownerSession: f.binding(await f.lease(A)), m2Gateway: gateway(A) });
  staleInput('SYNTHETIC_STALE'); staleChip.props.onPress(); await s.flush();
  assert.equal(s.text, ''); assert.equal(disk(f, A), undefined);
  s.press(s.chips()[0]); await s.flush(); assert.equal(disk(f, A), s.text);
});
test('Actual component: owner prop replacement without invalidating old boundary has no render flash', async f => {
  const otherAuthority = fakeAuthority(), other = createLocalOwnerBoundary(otherAuthority.verifier, f.clock);
  otherAuthority.results.push({ status: 'verified', owner: B, validUntil: 999999 });
  const leaseB = await other.control.verifySession(); other.control.finishHydration(leaseB);
  const s = f.screen({ ownerSession: f.binding(await f.lease(A)) }); await s.flush();
  s.type('SYNTHETIC_A_DRAFT'); await s.flush();
  const stale = s.find('opening-goal-input').props.onChangeText, from = s.renders.length;
  s.update({ ownerSession: { access: other.access, lease: leaseB } }, false);
  stale('SYNTHETIC_STALE'); s.render(); await s.flush();
  assert.ok(s.renders.slice(from).every(text => text === ''));
  assert.equal(disk(f, A), 'SYNTHETIC_A_DRAFT'); assert.equal(disk(f, B), undefined);
});
test('Actual component: late hydration never renders A after B replacement', async f => {
  seed(f, A, 'SYNTHETIC_A_DRAFT'); seed(f, B, 'SYNTHETIC_B_DRAFT');
  const gate = f.backend.holdNext('getItem');
  const s = f.screen({ ownerSession: f.binding(await f.lease(A)) }); await gate.started;
  const from = s.renders.length; s.update({ ownerSession: f.binding(await f.lease(B)) });
  await s.flush(); assert.equal(s.text, 'SYNTHETIC_B_DRAFT');
  gate.release(); await s.flush();
  assert.equal(s.text, 'SYNTHETIC_B_DRAFT'); assert.ok(!s.renders.slice(from).includes('SYNTHETIC_A_DRAFT'));
});
test('Actual component: adaptive view changes still reject an old suggestion press', async f => {
  const initial = gateway(A), s = f.screen({ m2Gateway: initial });
  const old = s.chips()[0]; old.props.onPressIn();
  const changed = gateway(A); changed.snapshot.permission.revision = 'fixture-permission-new';
  s.update({ m2Gateway: changed }); old.props.onPressOut(); old.props.onPress(); s.render();
  assert.equal(s.text, ''); assert.equal(f.backend.calls.length, 0);
});
test('Actual component: B2 actions retain existing executor boundary without draft writes', async f => {
  let executions = 0;
  const snapshot = fixtureB2();
  const s = f.screen({ m2Gateway: { snapshot, executors: {
    pause_workout: async () => { executions++; return 'completed'; },
  } } });
  const chip = s.chips()[0]; assert.ok(chip); s.press(chip); await s.flush();
  assert.equal(executions, 1); assert.equal(s.text, ''); assert.equal(f.backend.calls.length, 0);
});

let passed = 0;
for (const { name, body } of tests) {
  const f = fixture();
  try {
    await body(f); await settle();
    assert.equal(f.backend.data.get(legacy), legacyBytes, 'Legacy fixture bytes changed');
    assert.ok(f.backend.calls.every(call => call.key !== legacy), 'Legacy key accessed');
    assert.equal(networkCalls, 0, 'Goal draft verification must not call providers/network');
    console.log('PASS ' + name); passed++;
  } finally { f.cleanup(); }
}
console.log('Goal draft boundary: ' + passed + '/' + tests.length + ' PASS; legacy fixtures byte-identical.');
console.log('Provider/network calls: ' + networkCalls);
