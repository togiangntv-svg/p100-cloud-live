// Real component, hook and domain stores; deterministic React/native-host doubles.
// This checks focus/state/wiring, NOT UIKit geometry or User 001 acceptance.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { Script } from 'node:vm';
import ts from 'typescript';
import { fixtureA1 } from './fixtures/m2.mjs';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) ? specifier + '.ts' : specifier, context);
} });
let providerCalls = 0;
globalThis.fetch = () => { providerCalls++; throw new Error('NETWORK_FORBIDDEN_IN_COMPOSER_TEST'); };
const moduleAt = path => import(new URL(path, import.meta.url));
const cameraFixture = {
  permission: 'denied', camera: { canceled: true }, library: { canceled: true },
  calls: { permission: 0, camera: 0, library: 0 },
};
const dependencies = {
  '@/domain/m2': await moduleAt('../domain/m2.ts'),
  '@/i18n-m2': await moduleAt('../i18n-m2.ts'),
  './m2InputState': await moduleAt('../components/m2InputState.ts'),
  '@/domain/m3/host-permission': await moduleAt('../domain/m3/host-permission.ts'),
  '@/domain/m3/runtime-mode': await moduleAt('../domain/m3/runtime-mode.ts'),
  '@/domain/m4/ui-stub': await moduleAt('../domain/m4/ui-stub.ts'),
  '@/domain/m5/meal-image-decision': await moduleAt('../domain/m5/meal-image-decision.ts'),
  '@/domain/m5/goal-choice': await moduleAt('../domain/m5/goal-choice.ts'),
  '@/domain/camera/candidate': await moduleAt('../domain/camera/candidate.ts'),
  '@/i18n-task': await moduleAt('../i18n-task.ts'),
  './cameraC0Picker': { expoCameraC0Picker: Object.freeze({
    requestCameraPermission: async () => { cameraFixture.calls.permission++; return cameraFixture.permission; },
    takePhoto: async () => { cameraFixture.calls.camera++; return cameraFixture.camera; },
    choosePhoto: async () => { cameraFixture.calls.library++; return cameraFixture.library; },
  }) },
  './m3Presentation': await moduleAt('../components/m3Presentation.ts'),
  './goal-draft/store': await moduleAt('../components/goal-draft/store.ts'),
  '@/i18n': await moduleAt('../i18n.ts'),
};
const { createSessionTaskStore } = await moduleAt('../domain/session-task/store.ts');
const { createM3StubAdapter } = await moduleAt('../domain/m3/stub-adapter.ts');
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const flowSource = await read('../components/OpeningGoalFlow.tsx');
const hookSource = await read('../components/useM2Gateway.ts');
const layoutSource = await read('../app/_layout.tsx');
const transpile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const flowCode = transpile(flowSource), hookCode = transpile(hookSource);
assert.match(flowSource, /duration:\s*140/u);
assert.match(flowSource, /!motionPreferenceKnown \|\| reduceMotion/u);
assert.match(flowSource, /systemPresentationFade\.stopAnimation\(\)/u);
const flattenStyle = style => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean));
const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
const tests = [];
const test = (name, body) => tests.push({ name, body });

function screen({ locale: initialLocale = 'vi', os = 'ios', reviewing = false, withOwner = false } = {}) {
  const cells = [], stores = [], frames = [], timers = new Map();
  let cursor = 0, jobs = [], dirty = false, tree, keyboardVisible = false, focusCount = 0;
  let blurCount = 0, dismissCount = 0, scrollY = 0;
  let locale = initialLocale;
  let ownerGeneration = 1;
  let ownerReady = true;
  const ownerListeners = new Set();
  const ownerLease = Object.freeze({ fixtureLease: true });
  const ownerScope = Object.freeze({
    owner: Object.freeze({ subjectId: 'fixture-person', profileId: 'fixture-profile' }),
    generation: ownerGeneration,
    validUntil: 4_000_000_000_000,
  });
  const ownerAccess = Object.freeze({
    getSnapshot: () => ownerReady
      ? Object.freeze({ ...ownerScope, phase: 'READY' })
      : Object.freeze({ phase: 'LOCKED', generation: ownerGeneration }),
    subscribe(listener) { ownerListeners.add(listener); return () => ownerListeners.delete(listener); },
    requireLease(lease) {
      if (!ownerReady || lease !== ownerLease || ownerGeneration !== ownerScope.generation) {
        throw new Error('STALE_FIXTURE_LEASE');
      }
      return ownerScope;
    },
    applyIfCurrent(lease, apply) { ownerAccess.requireLease(lease); apply(); },
  });
  const ownerSession = withOwner ? Object.freeze({ access: ownerAccess, lease: ownerLease }) : undefined;
  const scrollCommands = [];
  let dimensions = { width: 390, height: 844 }, insets = { top: 47, bottom: 34 };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const i = cursor++;
      if (!cells[i]) cells[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [cells[i].value, next => {
        const value = typeof next === 'function' ? next(cells[i].value) : next;
        if (!Object.is(value, cells[i].value)) { cells[i].value = value; dirty = true; }
      }];
    },
    useRef(initial) { return cells[cursor++] ??= { current: initial }; },
    useMemo(run, deps) {
      const i = cursor++;
      if (!same(cells[i]?.deps, deps)) cells[i] = { deps, value: run() };
      return cells[i].value;
    },
    useCallback(run, deps) { return react.useMemo(() => run, deps); },
    useEffect(run, deps) {
      const i = cursor++;
      if (!same(cells[i]?.deps, deps)) {
        const previous = cells[i]; cells[i] = { deps };
        jobs.push(() => { previous?.cleanup?.(); cells[i].cleanup = run(); });
      }
    },
    useSyncExternalStore(subscribe, snapshot) {
      react.useEffect(() => subscribe(() => { dirty = true; }), [subscribe]);
      return snapshot();
    },
  };
  const animation = () => ({ start: callback => callback?.({ finished: true }), stop() {} });
  class Value {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    stopAnimation() {}
    interpolate() { return this; }
  }
  const native = {
    Keyboard: { dismiss() { dismissCount++; } },
    AccessibilityInfo: { isReduceMotionEnabled: async () => true, addEventListener: () => ({ remove() {} }) },
    Animated: { Value, View: 'Animated.View', Image: 'Animated.Image', timing: animation, spring: animation,
      sequence: animation, parallel: animation, delay: animation, loop: animation },
    AppState: { addEventListener: () => ({ remove() {} }) },
    Easing: { out: v => v, in: v => v, inOut: v => v, back: v => v, quad: 1, cubic: 1 },
    Platform: { OS: os, select: values => values[os] },
    StyleSheet: { create: v => v, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 },
    useWindowDimensions: () => dimensions, findNodeHandle: () => null,
    ...Object.fromEntries(['Image', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(v => [v, v])),
  };
  const forbidden = () => { throw new Error('PERSISTENCE_OR_LIVE_ADAPTER_FORBIDDEN'); };
  const storage = { getItem: forbidden, setItem: forbidden, removeItem: forbidden };
  const load = (code, deps) => {
    const mod = { exports: {} };
    new Script(code).runInNewContext({
      module: mod, exports: mod.exports,
      process: { env: Object.freeze({ EXPO_PUBLIC_M3_RUNTIME_MODE: 'fixture' }) },
      require(name) { assert.ok(Object.hasOwn(deps, name), 'Unexpected dependency: ' + name); return deps[name]; },
      setTimeout(fn) { const id = Symbol(); timers.set(id, fn); return id; },
      clearTimeout(id) { timers.delete(id); }, requestAnimationFrame(fn) { frames.push(fn); },
    });
    return mod.exports;
  };
  const hook = load(hookCode, {
    ...dependencies, react,
    '@/domain/session-task/store': { createSessionTaskStore(options) {
      const store = createSessionTaskStore(options); stores.push(store); return store;
    } },
    '@/domain/m3/gateway-adapter': { createM3GatewayAdapter: forbidden },
  });
  const { OpeningGoalFlow } = load(flowCode, {
    ...dependencies, react, 'react-native': native,
    '@expo/vector-icons': { Feather: 'Feather', MaterialCommunityIcons: 'Icons' },
    'expo-linear-gradient': { LinearGradient: 'Gradient' }, 'expo-status-bar': { StatusBar: 'StatusBar' },
    '@react-native-async-storage/async-storage': storage,
    'react-native-safe-area-context': { useSafeAreaInsets: () => insets },
    'react-native-keyboard-controller': { KeyboardAvoidingView: 'KeyboardAvoidingView', useKeyboardState: select => select({ isVisible: keyboardVisible }) },
    '@/components/WelcomeLogoAnimation': { WelcomeLogoAnimation: 'Logo' },
    '@/components/Animated100Signature': { Animated100Signature: 'Signature' },
    '@/components/TrainerJourneyCard': { TrainerJourneyCard: 'TrainerJourneyCard' },
    '@/context/TrainerRuntimeContext': { useOptionalTrainerJourney: () => undefined },
    '@/context/LocalizationContext': { useLocale: () => ({ locale, setLocale(value) { locale = value; dirty = true; },
      t: key => dependencies['@/i18n'].translate(locale, key) }) },
    '@/hooks/useColors': { useColors: () => ({}) }, '@/components/useM2Gateway': hook,
    '../assets/images/100-v05-sunless-scene-v1.png': 1,
  });
  const stubAdapter = createM3StubAdapter(0);
  const props = { initialPhase: 'goal', reviewing, onGoalOpened() {}, onClose() {},
    ownerSession,
    m2Gateway: { snapshot: fixtureA1(), m3Access: { status: 'denied', revision: 1 },
      m3StubAdapter: stubAdapter, m4StubFixture: 'absent' } };
  const nodes = () => {
    const result = [];
    const walk = value => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value?.props) { result.push(value); walk(value.props.children); }
    };
    walk(tree); return result;
  };
  const find = id => nodes().find(node => node.props.testID === id);
  const inputHost = {
    focus() { focusCount++; find('opening-goal-input').props.onFocus(); },
    blur() { blurCount++; find('opening-goal-input').props.onBlur(); },
  };
  const scrollHost = { scrollTo(command) { scrollY = command.y; scrollCommands.push(command); } };
  const render = () => {
    for (let pass = 0; pass < 30; pass++) {
      dirty = false; cursor = 0;
      tree = OpeningGoalFlow(props);
      find('opening-goal-input').props.ref.current = inputHost;
      const scrollRef = find('opening-goal-scroll').props.ref;
      if (scrollRef) scrollRef.current = scrollHost;
      const pending = jobs; jobs = []; pending.forEach(job => job());
      if (!dirty) return;
    }
    assert.fail('Focus/layout render loop');
  };
  render();
  return {
    find, nodes, render,
    get focusCount() { return focusCount; },
    get blurCount() { return blurCount; },
    get dismissCount() { return dismissCount; },
    get scrollY() { return scrollY; },
    get locale() { return locale; },
    scrollCommands,
    setLocale(value) { locale = value; render(); },
    setCameraFixture(patch) { Object.assign(cameraFixture, patch); },
    resetCameraCalls() { cameraFixture.calls = { permission: 0, camera: 0, library: 0 }; },
    get cameraCalls() { return { ...cameraFixture.calls }; },
    changeSubject(id, loading = 'ready') {
      props.m2Gateway = {
        ...props.m2Gateway,
        snapshot: {
          ...props.m2Gateway.snapshot,
          subject: { ...props.m2Gateway.snapshot.subject, id, loading },
        },
      };
      render();
    },
    setStubAvailable(available) {
      props.m2Gateway = {
        ...props.m2Gateway,
        m3StubAdapter: available ? stubAdapter : undefined,
      };
      render();
    },
    invalidateOwner() {
      ownerReady = false;
      ownerGeneration += 1;
      for (const listener of [...ownerListeners]) listener();
      render();
    },
    manualScroll(y) { scrollY = y; },
    layout(height, panelY = 0) {
      find('opening-goal-scroll').props.onLayout?.({ nativeEvent: { layout: { height } } });
      find('opening-goal-panel').props.onLayout?.({ nativeEvent: { layout: { y: panelY } } });
      render();
    },
    get store() { return stores.find(store => store.getSnapshot().session_id) ?? stores[0]; },
    focus() { inputHost.focus(); render(); },
    blur() { find('opening-goal-input').props.onBlur(); render(); },
    keyboard(visible) { keyboardVisible = visible; render(); },
    rotate() { dimensions = { width: 844, height: 390 }; insets = { top: 0, bottom: 21 }; render(); },
    type(value) { find('opening-goal-input').props.onChangeText(value); render(); },
    press(id) {
      const node = find(id); assert.ok(node, 'Missing control: ' + id);
      assert.ok(!node.props.disabled, 'Disabled control: ' + id);
      node.props.onPress(); render();
    },
    measure(height, y = 80) { find('opening-goal-composer').props.onLayout?.({ nativeEvent: { layout: { height, y } } }); render(); },
    async flush() { for (let i = 0; i < 4; i++) { await new Promise(resolve => setTimeout(resolve, 5)); render(); } },
    unmount() { cells.forEach(cell => cell?.cleanup?.()); assert.ok(stores.every(store => !store.getSnapshot().session_id)); },
  };
}

test('A single keyboard provider covers the welcome overlay and navigation', () => {
  const source = ts.createSourceFile('layout.tsx', layoutSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const paths = [];
  const walk = (node, ancestors = []) => {
    let next = ancestors;
    if (ts.isFunctionDeclaration(node)) next = [...ancestors, node.name.text];
    if (ts.isJsxElement(node)) next = [...next, node.openingElement.tagName.getText(source)];
    if (ts.isJsxSelfClosingElement(node)) paths.push([...next, node.tagName.getText(source)]);
    ts.forEachChild(node, child => walk(child, next));
  };
  walk(source);
  assert.ok(paths.some(path => path.includes('RootLayout') && path.includes('KeyboardProvider') && path.at(-1) === 'AppSurface'));
  assert.ok(paths.some(path => path.includes('AppSurface') && path.at(-1) === 'OpeningGoalFlow'));
  assert.equal((layoutSource.match(/<KeyboardProvider>/g) ?? []).length, 1);
});

// A bounded flex-column model, not UIKit certification. Read the real rendered
// hierarchy/styles: scrolling context must never be an ancestor of the composer.
function dockGeometry(s, safeHeight, contextHeight) {
  const panel = s.find('opening-goal-panel');
  const focusBlock = s.find('opening-goal-focus-block');
  const scroll = s.find('opening-goal-scroll');
  const composer = s.find('opening-goal-composer');
  const children = panel.props.children.flat().filter(Boolean);
  assert.deepEqual(children, [focusBlock, scroll], 'Question and composer must remain fixed above scrollable context');
  const focusChildren = focusBlock.props.children.flat().filter(Boolean);
  assert.equal(focusChildren[1], composer, 'Composer must sit immediately below the question');
  assert.ok(!scroll.props.children.flat().includes(composer), 'Context scrolling must not move the active composer');
  const ps = flattenStyle(panel.props.style), cs = flattenStyle(composer.props.style);
  const fs = flattenStyle(focusBlock.props.style);
  const ss = flattenStyle(scroll.props.style);
  const avoidance = s.find('opening-goal-keyboard-viewport');
  const dock = avoidance.props.children.flat()[0];
  assert.ok(dock.props.children.flat().includes(panel), 'Panel must be inside the resized keyboard-safe dock');
  assert.equal(scroll.type, 'ScrollView', 'No second keyboard-aware scroll controller');
  const ds = flattenStyle(dock.props.style);
  assert.equal(ds.flex, 1);
  assert.equal(ds.minHeight, 0);
  assert.equal(ds.justifyContent, 'flex-end');
  assert.equal(ps.maxHeight, '100%');
  assert.equal(ps.flexShrink, 1);
  assert.equal(fs.flexShrink, 0);
  assert.equal(ss.flexGrow, 0);
  assert.equal(ss.flexShrink, 1);
  assert.equal(ss.minHeight, 0);
  assert.equal(cs.flexShrink, 0, 'Context must yield space before the composer');
  assert.equal(cs.position, undefined);
  assert.equal(cs.transform, undefined);
  const surface = composer.props.children.flat()[0];
  const surfaceStyle = flattenStyle(surface.props.style);
  const input = s.find('opening-goal-input'), submit = s.find('opening-goal-submit');
  assert.ok(surface.props.children.flat().includes(input));
  assert.ok(surface.props.children.flat().includes(submit));
  const inputHeight = flattenStyle(input.props.style).height;
  const submitHeight = flattenStyle(submit.props.style).height;
  const questionHeight = flattenStyle(focusChildren[0].props.style).lineHeight;
  const composerHeight = Math.max(surfaceStyle.minHeight, inputHeight, submitHeight) + 2 * cs.padding;
  const panelEdges = 2 * (ps.padding + ps.borderWidth);
  const available = safeHeight - ds.paddingBottom;
  const fixed = panelEdges + questionHeight + cs.marginTop + composerHeight;
  assert.ok(available >= fixed, 'Synthetic keyboard-safe region must fit the bounded input');
  const panelHeight = Math.min(available, fixed + contextHeight);
  const panelTop = available - panelHeight;
  const composerTop = panelTop + ps.padding + ps.borderWidth + questionHeight + cs.marginTop;
  const composerBottom = composerTop + composerHeight;
  assert.ok(panelTop >= 0 && composerTop >= 0, 'Composer cannot leave the top clipping plane');
  assert.ok(composerBottom <= safeHeight, 'Composer, typed text and Send must remain above keyboard');
  assert.ok(inputHeight <= composerHeight && submitHeight <= composerHeight);
  assert.equal(s.scrollCommands.length, 0, 'Focus/layout/caret must never issue an outer scroll correction');
  return { composerTop, composerBottom, panelTop };
}

test('Resting -> focus -> keyboard -> resized viewport -> delayed layouts keeps composer and Send visible', () => {
  for (const contextHeight of [66, 600, 1400]) {
    const s = screen();
    try {
      const check = height => dockGeometry(s, height, contextHeight);
      s.layout(721, 400); s.measure(66, 80); check(721);
      s.type('Yêu cầu thử nghiệm'); s.focus(); check(721);
      s.keyboard(true); check(721); // Visibility arrives before the native resize.
      for (const height of [500, 321, 260]) {
        s.layout(height, 400); check(height);
        // Old panel/composer measurements can arrive after viewport shrink.
        s.measure(114, 480); check(height);
        s.layout(height, 0); check(height);
      }
      s.find('opening-goal-input').props.onContentSizeChange({ nativeEvent: { contentSize: { height: 900 } } });
      s.render(); check(260);
      s.manualScroll(1200); check(260); // Context scrolling cannot move the sibling input.
      assert.equal(s.find('opening-goal-input').props.value, 'Yêu cầu thử nghiệm');
      assert.equal(s.find('opening-goal-submit').props.disabled, false);
      const scroll = s.find('opening-goal-scroll').props;
      assert.equal(scroll.bottomOffset, undefined);
      assert.equal(scroll.automaticallyAdjustKeyboardInsets, false);
      assert.equal(scroll.keyboardShouldPersistTaps, 'handled');
      const avoidance = s.find('opening-goal-keyboard-viewport').props;
      assert.equal(avoidance.behavior, 'padding');
      assert.equal(avoidance.automaticOffset, true);
      assert.equal(s.nodes().filter(n => n.type === 'KeyboardAvoidingView').length, 1);
      assert.doesNotMatch(flowSource, /scrollTo\(|scrollToEnd\(|revealComposer|onSelectionChange=/);
    } finally { s.unmount(); }
  }
});

test('Suggestions release context space while typing; keyboard hide restores them even without blur', () => {
  const s = screen();
  try {
    const grid = () => s.find('opening-goal-suggestions').props;
    const before = flattenStyle(grid().style);
    s.focus(); s.keyboard(true);
    const during = flattenStyle(grid().style);
    assert.equal(during.display, 'none');
    delete during.display;
    assert.deepEqual(during, before, 'Restoration retains the original suggestion styles');
    assert.equal(grid().pointerEvents, 'none');
    assert.equal(grid().accessibilityElementsHidden, true);
    assert.equal(grid()['aria-hidden'], true);
    assert.equal(grid().importantForAccessibility, 'no-hide-descendants');
    assert.ok(s.nodes().filter(node => node.props.testID?.startsWith('opening-goal-chip-')).every(node => node.props.disabled));
    s.keyboard(false); // iOS may dismiss without a TextInput blur.
    assert.deepEqual(flattenStyle(grid().style), before);
    assert.equal(grid().pointerEvents, 'auto');
    assert.equal(grid().accessibilityElementsHidden, false);
    assert.ok(s.nodes().filter(node => node.props.testID?.startsWith('opening-goal-chip-')).every(node => !node.props.disabled));
    s.keyboard(true); s.blur();
    assert.equal(grid().pointerEvents, 'auto', 'A different focused field must not hide these suggestions');
  } finally { s.unmount(); }
});

test('Top safe boundary belongs to the clipped viewport, outside keyboard-driven content scrolling', () => {
  const s = screen();
  try {
    const viewportNode = () => s.find('opening-goal-viewport');
    const viewport = () => flattenStyle(viewportNode().props.style);
    const sun = () => s.find('goal-sun-disc').props;
    const content = () => flattenStyle(s.find('opening-goal-scroll').props.contentContainerStyle);
    const header = () => flattenStyle(s.find('opening-goal-header').props.style);
    const measureHeader = height => {
      s.find('opening-goal-header').props.onLayout({ nativeEvent: { layout: { height } } });
      s.render();
    };
    measureHeader(46);
    assert.equal(viewport().top, 47 + 76, 'Preserve resting safe-area/header gap');
    assert.equal(viewportNode().type, 'View', 'The clipping plane must not be an animated layer');
    assert.equal(viewportNode().props.collapsable, false, 'Retain a real native clipping view');
    assert.equal(viewport().position, 'absolute');
    assert.equal(viewport().bottom, 0);
    assert.equal(viewport().transform, undefined, 'Content animation must not move the exclusion boundary');
    assert.equal(viewport().marginTop, undefined);
    assert.equal(viewport().overflow, 'hidden', 'Automatic scroll and iOS bounce must not paint over header');
    assert.ok(viewport().zIndex > flattenStyle(sun().style).zIndex,
      'All scrolling goal text and controls must paint above the sun');
    assert.equal(sun().pointerEvents, 'none', 'The background sun must never intercept touch');
    assert.equal(sun().accessibilityElementsHidden, true);
    assert.equal(sun().importantForAccessibility, 'no-hide-descendants');
    assert.equal(sun()['aria-hidden'], true);
    assert.equal(content().paddingTop, undefined, 'Top protection cannot disappear with scroll offset');
    assert.ok(viewportNode().props.children.flat().includes(s.find('opening-goal-panel-layer')),
      'Native clipping must enclose the animated layer as well as scroll contents');
    assert.ok(s.find('opening-goal-panel-layer').props.children.flat().includes(s.find('opening-goal-keyboard-viewport')));
    dockGeometry(s, 321, 900); // Clip encloses the keyboard-safe dock and its scroll sibling.
    const scroll = s.find('opening-goal-scroll').props;
    assert.equal(flattenStyle(scroll.style).overflow, 'hidden', 'Native scroll clips its own content too');
    assert.equal(scroll.contentInsetAdjustmentBehavior, 'never');
    assert.equal(scroll.automaticallyAdjustContentInsets, false, 'Safe area has one owner, outside scroll');
    s.measure(114); s.focus(); s.keyboard(true);
    const beforeDismiss = viewport().top;
    assert.equal(s.find('opening-goal-scroll').props.bottomOffset, undefined, 'No duplicate caret-based avoidance');
    s.keyboard(false);
    assert.equal(viewport().top, beforeDismiss, 'No keyboard-dependent top offset or dismissal jump');
    s.keyboard(true); s.rotate(); measureHeader(96);
    assert.ok(viewport().top >= header().top + 96 + 8, 'Respect measured controls and touch area after layout changes');
    assert.equal(header().top, 4, 'Use the new landscape safe area');
    measureHeader(46);
    assert.equal(viewport().top, 76, 'Release old measured height when controls shrink');
  } finally { s.unmount(); }
});

test('Review close control remains outside the scroll viewport, including its touch area', () => {
  const s = screen({ reviewing: true });
  try {
    const close = s.find('welcome-close').props;
    close.onLayout({ nativeEvent: { layout: { height: 80 } } }); s.render();
    const closeStyle = flattenStyle(close.style({ pressed: false }));
    const viewport = flattenStyle(s.find('opening-goal-viewport').props.style);
    assert.ok(viewport.top >= closeStyle.top + 80 + close.hitSlop);
    assert.equal(viewport.overflow, 'hidden');
  } finally { s.unmount(); }
});

test('Web focus/blur preserves the existing plain ScrollView fallback', () => {
  const s = screen({ os: 'web' });
  try {
    assert.equal(s.find('opening-goal-scroll').type, 'ScrollView');
    assert.equal(s.find('opening-goal-keyboard-viewport').props.enabled, false);
    s.focus();
    assert.equal(s.find('opening-goal-suggestions').props.pointerEvents, 'none');
    s.blur();
    assert.equal(s.find('opening-goal-suggestions').props.pointerEvents, 'auto');
  } finally { s.unmount(); }
});

for (const locale of ['vi', 'en']) test(`${locale}: real edit/resubmit/cancel preserves routing and never revives the cancelled task`, async () => {
  const s = screen({ locale });
  try {
    // The existing deterministic meal fixture recognizes this exact Vietnamese
    // sentence only. English checks the current generic-task path, not new NLU.
    const input = locale === 'vi' ? 'Tôi cần đánh giá bữa ăn bằng hình ảnh.' : 'Help me with my current request.';
    s.type(input); s.focus(); s.keyboard(true);
    s.press('opening-goal-submit'); await s.flush();
    assert.equal(s.blurCount, 1, 'Submit ends text entry');
    assert.equal(s.dismissCount, 1, 'Submit dismisses the keyboard');
    assert.equal(s.focusCount, 1, 'Submit/result must not immediately refocus');
    assert.equal(s.find('opening-goal-input').props.value, input, 'Submit preserves the visible draft');
    assert.equal(s.find('opening-goal-dismiss-area').props.disabled, true, 'Typing mode ends before keyboard hide arrives');
    s.keyboard(false);
    assert.ok(s.find('m3-stub-edit-task'));
    assert.ok(s.find('m4-primary-response'));
    const taskId = s.store.getSnapshot().active_task_id;
    const taskBefore = s.store.getSnapshot().tasks.find(task => task.task_id === taskId);
    s.press('m3-stub-edit-task'); s.keyboard(true); await s.flush();
    assert.equal(s.focusCount, 2, 'Edit must focus the actual input');
    assert.equal(s.find('opening-goal-input').props.value, input);
    const revised = locale === 'vi' ? input.toLocaleUpperCase('vi') : 'I have updated my current request.';
    s.type(revised); s.press('opening-goal-submit'); await s.flush();
    assert.equal(s.blurCount, 2, 'Resubmit also ends text entry');
    assert.equal(s.dismissCount, 2);
    assert.equal(s.focusCount, 2, 'No delayed result may refocus');
    s.keyboard(false);
    assert.equal(s.find('opening-goal-input').props.value, revised);
    const currentId = s.store.getSnapshot().active_task_id;
    const task = s.store.getSnapshot().tasks.find(item => item.task_id === currentId);
    assert.equal(task.source_input, revised);
    assert.equal(task.interpretation.task_kind, locale === 'vi' ? 'meal_image_assessment' : null);
    assert.equal(taskBefore.interpretation.task_kind, task.interpretation.task_kind);
    if (locale === 'vi') {
      assert.ok(!s.find('opening-goal-suggestions'), 'An active meal task must not regain A1 presets');
      assert.match(JSON.stringify(s.find('m4-primary-response').props.children), /chưa được bật/);
    }
    const staleEdit = s.find('m3-stub-edit-task').props.onPress;
    s.press('m3-stub-cancel-task'); s.keyboard(false); await s.flush();
    assert.equal(s.blurCount, 3, 'Successful Cancel still explicitly blurs the input');
    assert.equal(s.dismissCount, 3, 'Successful Cancel still explicitly dismisses the keyboard');
    staleEdit(); s.render(); await s.flush();
    assert.equal(s.store.getSnapshot().active_task_id, null);
    assert.equal(s.store.getSnapshot().tasks.find(item => item.task_id === currentId).status, 'CANCELLED');
    assert.equal(s.focusCount, 2, 'Stale Edit after cancel must not reopen the keyboard');
    assert.equal(s.find('opening-goal-input').props.value, '');
    assert.ok(!s.find('m3-stub-edit-task') && !s.find('m3-stub-cancel-task'));
    const text = JSON.stringify(s.nodes().filter(node => node.type === 'Text').map(node => node.props.children));
    assert.doesNotMatch(text, /prototype|simulation|\bstub\b|Bản thử|giả lập|mô phỏng|\bM[345]\b|intent_type|UNSUPPORTED/iu);
  } finally { s.unmount(); }
});

test('Safe outside tap exits typing without submitting, cancelling or clearing the draft', async () => {
  const s = screen();
  try {
    for (const withTask of [false, true]) {
      const text = 'Keep this draft\nincluding earlier lines';
      s.type(text);
      if (withTask) { s.press('opening-goal-submit'); await s.flush(); }
      s.focus(); s.keyboard(true);
      const snapshot = s.store.getSnapshot();
      const blurCount = s.blurCount, dismissCount = s.dismissCount, focusCount = s.focusCount;
      const area = s.find('opening-goal-dismiss-area');
      assert.equal(area.type, 'Pressable');
      assert.equal(area.props.accessible, false, 'Do not group or obscure descendant accessibility controls');
      assert.equal(area.props.focusable, false);
      assert.equal(area.props.onStartShouldSetResponderCapture, undefined, 'Outside handler must not steal child controls');
      assert.equal(area.props.onTouchStart, undefined, 'Touching input/Send/Edit is not an outside tap');
      assert.ok(area.props.children.flat().includes(s.find('opening-goal-panel')));
      s.press('opening-goal-dismiss-area'); await s.flush();
      assert.equal(s.blurCount, blurCount + 1);
      assert.equal(s.dismissCount, dismissCount + 1);
      assert.equal(s.focusCount, focusCount);
      assert.equal(s.find('opening-goal-input').props.value, text);
      assert.equal(s.store.getSnapshot(), snapshot, 'Dismissal must not mutate tasks or interpretations');
      assert.equal(s.find('opening-goal-suggestions').props.pointerEvents, 'auto');
      assert.notEqual(flattenStyle(s.find('opening-goal-suggestions').props.style).display, 'none');
      dockGeometry(s, 300, 600);
      s.keyboard(false); s.layout(721); await s.flush();
      assert.equal(s.focusCount, focusCount, 'Keyboard/layout completion must not restore focus');
    }
  } finally { s.unmount(); }
});

test('Empty Submit stays disabled and multiline Return remains newline, never Submit', async () => {
  const s = screen();
  try {
    s.focus(); s.keyboard(true);
    s.type('   ');
    assert.equal(s.find('opening-goal-submit').props.disabled, true);
    s.find('opening-goal-submit').props.onPress(); s.render();
    assert.equal(s.blurCount, 0);
    assert.equal(s.dismissCount, 0);
    assert.equal(s.store.getSnapshot().active_task_id, null);
    const input = s.find('opening-goal-input').props;
    assert.equal(input.multiline, true);
    assert.equal(input.submitBehavior, 'newline');
    assert.equal(input.onSubmitEditing, undefined);
    s.type('First line\nSecond line'); await s.flush();
    assert.equal(s.find('opening-goal-input').props.value, 'First line\nSecond line');
    assert.equal(s.store.getSnapshot().active_task_id, null);
    assert.equal(s.blurCount, 0);
    assert.equal(s.dismissCount, 0);
  } finally { s.unmount(); }
});

test('Dismiss/reopen and both layout event orders retain a visible dock with no stale outer offset', () => {
  for (const visibilityFirst of [true, false]) {
    const s = screen();
    try {
      s.focus(); s.keyboard(true); s.layout(300); s.measure(114, 250);
      const initial = dockGeometry(s, 300, 900);
      s.manualScroll(500);
      if (visibilityFirst) s.keyboard(false);
      s.layout(721, 400); dockGeometry(s, 721, 900);
      if (!visibilityFirst) s.keyboard(false);
      assert.equal(s.find('opening-goal-suggestions').props.pointerEvents, 'auto');
      if (visibilityFirst) s.keyboard(true);
      s.layout(300, 400); s.measure(114, 480);
      assert.deepEqual(dockGeometry(s, 300, 900), initial, 'Same safe viewport produces the same dock position');
      if (!visibilityFirst) s.keyboard(true);
      assert.deepEqual(dockGeometry(s, 300, 900), initial);
      assert.equal(s.focusCount, 1, 'Layout updates never refocus automatically');
      assert.equal(s.scrollCommands.length, 0, 'No reset/reveal feedback loop on keyboard transitions');
    } finally { s.unmount(); }
  }
});

test('Long text stays inside a bounded, internally scrollable native input', () => {
  const s = screen();
  try {
    const text = Array.from({ length: 25 }, (_, i) => `Dòng ${i + 1}`).join('\n');
    s.type(text); s.focus(); s.keyboard(true);
    s.find('opening-goal-input').props.onContentSizeChange({ nativeEvent: { contentSize: { height: 900 } } });
    s.render();
    const input = s.find('opening-goal-input').props;
    assert.equal(input.multiline, true);
    assert.equal(input.scrollEnabled, true);
    assert.equal(flattenStyle(input.style).height, 112, 'Use the existing input cap, not unbounded text height');
    assert.equal(flattenStyle(input.style).textAlignVertical, 'top');
    assert.equal(input.value, text, 'Earlier lines remain in the input');
    assert.equal(input.selection, undefined, 'Do not force the cursor to the last line');
    assert.equal(input.onSelectionChange, undefined, 'Caret selection must not scroll the outer surface');
    s.find('opening-goal-input').props.onContentSizeChange({ nativeEvent: { contentSize: { height: 30 } } });
    s.render();
    assert.equal(flattenStyle(s.find('opening-goal-input').props.style).height, 60);
  } finally { s.unmount(); }
});


for (const locale of ['vi','en','zh-Hans','es','hi','ja','ko','ru']) test(`Localization v1 ${locale}: real surface, picker, controls and cancellation stay localized`, async () => {
 const s=screen({locale});
 try {
  const {translate,RELEASE_LOCALE_OPTIONS,COMPACT_LOCALE_LABELS}=dependencies['@/i18n'];
  const {taskMessages}=await moduleAt('../i18n-task.ts');
  const collect=node=>JSON.stringify(node?.props.children);
  const textNode = label => s.nodes().find(node => node.type === 'Text'
    && node.props.children.flat(Infinity).join('') === label);
  const compactLabel = COMPACT_LOCALE_LABELS[locale];
  const compactLabelNode = textNode(compactLabel);
  assert.ok(compactLabelNode, `Missing compact locale label: ${compactLabel}`);
  assert.equal(compactLabelNode.props.numberOfLines, 1);
  assert.equal(compactLabelNode.props.adjustsFontSizeToFit, true);
  assert.ok(compactLabelNode.props.minimumFontScale >= 0.8);
  const languageButton = s.find('opening-language-menu');
  assert.ok(flattenStyle(languageButton.props.style({ pressed: false })).minHeight >= 42);
  assert.ok(languageButton.props.hitSlop >= 8);
  for (const key of ['m2Health','m2Appearance','m2Strength','m2Movement']) {
    const label = translate(locale, key);
    const labelNode = textNode(label);
    assert.ok(labelNode, `Missing goal label: ${label}`);
    assert.equal(labelNode.props.numberOfLines, 2);
    assert.equal(labelNode.props.adjustsFontSizeToFit, true);
    assert.ok(labelNode.props.minimumFontScale >= 0.8);
  }
  for (const chip of s.nodes().filter(node => node.props.testID?.startsWith('opening-goal-chip-'))) {
    assert.ok(flattenStyle(chip.props.style).minHeight >= 44);
  }
  assert.ok(collect(s.find('opening-language-menu')).includes(COMPACT_LOCALE_LABELS[locale]));
  assert.equal(s.find('opening-goal-input').props.placeholder,translate(locale,'m2Placeholder'));
  assert.equal(s.find('opening-goal-submit').props.accessibilityLabel,translate(locale,'m2Submit'));
  assert.ok(collect(s.find('opening-goal-focus-block')).includes(translate(locale,'m2Question')));
  const suggestions=collect(s.find('opening-goal-suggestions'));
  for(const key of ['m2Health','m2Appearance','m2Strength','m2Movement']) assert.ok(suggestions.includes(translate(locale,key)));
  s.press('opening-language-menu');
  const options=s.nodes().filter(n=>n.props.testID?.startsWith('language-option-')).map(n=>n.props.testID.slice(16));
  assert.deepEqual(options.sort(),RELEASE_LOCALE_OPTIONS.map(x=>x.id).sort());
  s.press('language-menu-close');
  s.type('Khỏe hơn');s.press('opening-goal-submit');await s.flush();
  assert.ok(s.find('m5-goal-choice'));
  assert.ok(collect(s.find('m4-primary-response')).includes(taskMessages[locale].goalUnderstood));
  assert.ok(collect(s.find('m5-goal-use')).includes(taskMessages[locale].goalUse));
  assert.ok(collect(s.find('m5-goal-change')).includes(taskMessages[locale].goalChange));
  assert.ok(!s.find('m3-stub-edit-task'));
  assert.ok(collect(s.find('m3-stub-cancel-task')).includes(translate(locale,'m2CancelRequest')));
  if(['hi','ru'].includes(locale)) {
   for(const id of ['m5-goal-use','m5-goal-change','m3-stub-cancel-task']) {
    const control=s.find(id), style=typeof control.props.style==='function'
      ? control.props.style({pressed:false}) : control.props.style;
    assert.ok(flattenStyle(style).minHeight>=44,`${locale}:${id} touch target`);
    const label=control.props.children.flat(Infinity).find(node=>node?.type==='Text');
    assert.equal(label.props.numberOfLines,2);
    assert.equal(label.props.adjustsFontSizeToFit,true);
    assert.ok(label.props.minimumFontScale>=0.8);
   }
  }
  const task=s.store.getSnapshot().tasks.find(t=>t.task_id===s.store.getSnapshot().active_task_id);
  assert.equal(task.m3_context.locale,locale);
  assert.equal(task.m3_context.recent_relevant_turns[0].text,translate(locale,'m2Question'));
  if(!['vi','en'].includes(locale)) {
   const response=collect(s.find('m4-primary-response'));
   assert.ok(Object.values(taskMessages[locale]).some(text=>response.includes(text)));
   assert.doesNotMatch(response,/I understand|I am not|Mình|Bạn|Please|request|prototype|simulation/iu);
  }
  s.press('m3-stub-cancel-task');await s.flush();
  assert.ok(collect(s.find('m4-primary-response')).includes(translate(locale,'m2Cancelled')));
  assert.equal(s.store.getSnapshot().tasks.find(t=>t.task_id===task.task_id).status,'CANCELLED');
 } finally {s.unmount();}
});

test('M5 goal choice follows the current locale, records one explicit choice and preserves user text', async () => {
 const s=screen({locale:'vi'});
 try {
  const {taskMessages}=await moduleAt('../i18n-task.ts');
  const input='Khỏe hơn';
  const collect=node=>JSON.stringify(node?.props.children);
  s.type(input);s.press('opening-goal-submit');await s.flush();
  const taskId=s.store.getSnapshot().active_task_id;
  assert.ok(taskId);
  assert.equal(s.find('opening-goal-input').props.value,input);
  assert.ok(!s.find('opening-goal-suggestions'),'M5 owns this single decision moment');
  for(const locale of ['vi','ko','zh-Hans','ja','vi']) {
   s.setLocale(locale);await s.flush();
   assert.equal(s.find('opening-goal-input').props.value,input,'Locale changes must not translate user text');
   assert.ok(collect(s.find('m4-primary-response')).includes(taskMessages[locale].goalUnderstood));
   assert.ok(collect(s.find('m5-goal-use')).includes(taskMessages[locale].goalUse));
   assert.ok(collect(s.find('m5-goal-change')).includes(taskMessages[locale].goalChange));
  }
  const visibleText=JSON.stringify(s.nodes().filter(node=>node.type==='Text').map(node=>node.props.children));
  assert.doesNotMatch(
   visibleText,
   /\bM[345]\b|task_kind|CLEAR_GOAL_READY|REVERSIBLE_USER_CHOICE|CONTEXT_SUFFICIENT/iu,
   'Internal decision codes must stay behind the user surface',
  );
  const primaryStyle=s.find('m5-goal-use').props.style({pressed:false});
  assert.equal(flattenStyle(primaryStyle).width,'100%');
  const before=s.store.getSnapshot().tasks.find(task=>task.task_id===taskId);
  assert.equal(s.store.getM5GoalChoiceReceipt(s.store.reference(taskId)),undefined);
  s.press('m5-goal-use');await s.flush();
  const after=s.store.getSnapshot().tasks.find(task=>task.task_id===taskId);
  assert.deepEqual(after,before,'Accept must not mutate the task or user-authored input');
  const receipt=s.store.getM5GoalChoiceReceipt(s.store.reference(taskId));
  assert.equal(receipt.choice,'ACCEPTED');
  assert.equal(receipt.task_id,taskId);
  assert.equal(s.find('opening-goal-input').props.value,input);
  assert.equal(s.find('m5-goal-use').props.disabled,true);
  assert.equal(s.find('m5-goal-use').props.accessibilityState.selected,true);
  assert.equal(s.find('m5-goal-use').props.accessibilityState.disabled,true);
  assert.ok(collect(s.find('m5-goal-use')).includes(taskMessages.vi.goalSelected));
  s.press('m5-goal-change');await s.flush();
  assert.equal(s.find('opening-goal-input').props.value,input);
  assert.equal(s.store.getM5GoalChoiceReceipt(s.store.reference(taskId)),undefined);
  assert.ok(!s.find('m5-goal-choice'),'Changing the task must retire the old choice surface');
  assert.ok(s.find('m3-stub-edit-task'),'The existing edit path remains available');
  s.press('m3-stub-cancel-task');await s.flush();
  assert.equal(s.store.getM5GoalChoiceReceipt(s.store.reference(taskId)),undefined);
  assert.ok(!s.find('m5-goal-choice'));
 } finally {s.unmount();}
});

test('A stale M5 button cannot accept a newer active task', async () => {
 const s=screen({locale:'vi'});
 try {
  s.type('Khỏe hơn');s.press('opening-goal-submit');await s.flush();
  const firstId=s.store.getSnapshot().active_task_id;
  const staleAccept=s.find('m5-goal-use').props.onPress;
  s.type('Mạnh hơn');s.press('opening-goal-submit');await s.flush();
  const secondId=s.store.getSnapshot().active_task_id;
  assert.notEqual(secondId,firstId);
  assert.equal(s.store.getM5GoalChoiceReceipt(s.store.reference(secondId)),undefined);
  staleAccept();s.render();await s.flush();
  assert.equal(s.store.getM5GoalChoiceReceipt(s.store.reference(secondId)),undefined);
  assert.equal(s.find('m5-goal-use').props.disabled,false);
 } finally {s.unmount();}
});

test('Changing owner authority retires the M5 session receipt and rejects its stale action', async () => {
 const s=screen({locale:'vi'});
 try {
  s.type('Khỏe hơn');s.press('opening-goal-submit');await s.flush();
  const staleAccept=s.find('m5-goal-use').props.onPress;
  s.press('m5-goal-use');await s.flush();
  const oldSession=s.store.getSnapshot().session_id;
  assert.ok(s.store.getM5GoalChoiceReceipt(s.store.reference()));
  s.changeSubject('other-fixture-person');await s.flush();
  assert.notEqual(s.store.getSnapshot().session_id,oldSession);
  assert.equal(s.store.getSnapshot().active_task_id,null);
  assert.ok(!s.find('m5-goal-choice'));
  staleAccept();s.render();await s.flush();
  assert.equal(s.store.getSnapshot().tasks.length,0);
 } finally {s.unmount();}
});

test('Invalidating the real owner lease retires M5 even when the subject id is unchanged', async () => {
 const s=screen({locale:'vi',withOwner:true});
 try {
  s.type('Khỏe hơn');s.press('opening-goal-submit');await s.flush();
  const staleAccept=s.find('m5-goal-use').props.onPress;
  s.press('m5-goal-use');await s.flush();
  const oldSession=s.store.getSnapshot().session_id;
  assert.ok(s.store.getM5GoalChoiceReceipt(s.store.reference()));
  s.invalidateOwner();await s.flush();
  assert.equal(s.store.getSnapshot().session_id,null);
  assert.notEqual(s.store.getSnapshot().session_id,oldSession);
  assert.ok(!s.find('m5-goal-choice'));
  staleAccept();s.render();await s.flush();
  assert.equal(s.store.getSnapshot().tasks.length,0);
 } finally {s.unmount();}
});

test('Removing and restoring local M3 authority cannot resurrect an accepted receipt', async () => {
 const s=screen({locale:'vi'});
 try {
  s.type('Khỏe hơn');s.press('opening-goal-submit');await s.flush();
  s.press('m5-goal-use');await s.flush();
  assert.ok(s.store.getM5GoalChoiceReceipt(s.store.reference()));
  s.setStubAvailable(false);await s.flush();
  assert.ok(!s.find('m5-goal-choice'));
  assert.equal(s.store.getM5GoalChoiceReceipt(s.store.reference()),undefined);
  s.setStubAvailable(true);await s.flush();
  assert.ok(s.find('m5-goal-choice'));
  assert.equal(s.find('m5-goal-use').props.disabled,false);
  assert.equal(s.store.getM5GoalChoiceReceipt(s.store.reference()),undefined);
 } finally {s.unmount();}
});
test('Camera C0 real surface waits for explicit action, previews locally and preserves task text', async () => {
 const s=screen({locale:'vi'});
 try {
  const {taskMessages}=await moduleAt('../i18n-task.ts');
  const input='Tôi cần đánh giá bữa ăn bằng hình ảnh.';
  const collect=node=>JSON.stringify(node?.props.children);
  s.resetCameraCalls();
  s.type(input);s.press('opening-goal-submit');await s.flush();
  assert.ok(s.find('camera-c0-panel'));
  assert.deepEqual(s.cameraCalls,{permission:0,camera:0,library:0});
  s.setCameraFixture({permission:'denied'});
  s.press('camera-c0-take');await s.flush();
  assert.deepEqual(s.cameraCalls,{permission:1,camera:0,library:0});
  assert.ok(collect(s.find('m4-primary-response')).includes(taskMessages.vi.cameraPermissionDenied));
  s.setCameraFixture({library:{canceled:false,asset:{uri:'ph://fixture-meal',width:1200,height:900}}});
  s.press('camera-c0-choose');await s.flush();
  assert.deepEqual(s.cameraCalls,{permission:1,camera:0,library:1});
  assert.equal(s.find('camera-c0-preview').props.source.uri,'ph://fixture-meal');
  assert.equal(s.find('opening-goal-input').props.value,input);
  for(const locale of ['vi','ko','zh-Hans','ja','vi']) {
   s.setLocale(locale);await s.flush();
   assert.equal(s.find('opening-goal-input').props.value,input);
   assert.ok(collect(s.find('camera-c0-use')).includes(taskMessages[locale].cameraUse));
  }
  s.press('camera-c0-use');await s.flush();
  assert.equal(s.find('camera-c0-use').props.disabled,true);
  assert.ok(collect(s.find('camera-c0-use')).includes(taskMessages.vi.cameraSelected));
  assert.ok(collect(s.find('m4-primary-response')).includes(taskMessages.vi.cameraSelectedNotice));
  assert.equal(s.find('opening-goal-input').props.value,input);
  s.press('camera-c0-cancel');await s.flush();
  assert.ok(!s.find('camera-c0-preview'));
  assert.ok(s.find('camera-c0-take') && s.find('camera-c0-choose'));
  assert.ok(s.store.getSnapshot().active_task_id,'Cancelling the photo must not cancel the task');
 } finally {s.unmount();}
});

for (const { name, body } of tests) { await body(); console.log('PASS ' + name); }
assert.equal(providerCalls, 0);
console.log(`Keyboard/composer: ${tests.length}/${tests.length} PASS; provider calls = 0; iPhone runtime NOT_RUN.`);
