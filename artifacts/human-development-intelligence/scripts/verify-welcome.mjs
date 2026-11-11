// Actual Welcome provider executed with deterministic fake hooks/timers/storage.
// These checks are not mounted React/native runtime certification.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import ts from 'typescript';
import * as welcome from '../domain/welcome.ts';

const { resolveWelcomeInitialPhase, resolveWelcomeLaunch, shouldShowFirstWelcome,
  WELCOME_SEEN_VALUE, WELCOME_STORAGE_KEY } = welcome;
const providerSource = await readFile(new URL('../context/WelcomeContext.tsx', import.meta.url), 'utf8');
const providerCode = ts.transpileModule(providerSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const legacyKeys = [
  '@100-human-development-opening',
  '@100-human-development-state',
  '@100-human-development-opening-goal-draft',
  '@100-human-development-opening-goal-flow',
];
const syntheticLegacy = [
  [legacyKeys[0], '{"synthetic":"A-opening"}\r\n'],
  [legacyKeys[1], '{"synthetic":"A-development"}'],
  [legacyKeys[2], '  Synthetic A draft — kiểm thử\n'],
  [legacyKeys[3], 'goal'],
];
const tests = [];
const test = (name, run) => tests.push({ name, run });
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

function providerFixture(entries = [], { dev = false, holdRead = false, rejectRead = false,
  rejectWrite = false, web = false } = {}) {
  const data = new Map(entries), calls = [], cells = [], timers = new Map();
  let cursor = 0, timerId = 0, value, effects = [], setterCalls = 0, focusCalls = 0;
  let resolveRead;
  const readWait = holdRead ? new Promise(resolve => { resolveRead = resolve; }) : null;
  const backend = {
    getItem(key) {
      calls.push({ method: 'getItem', key });
      if (rejectRead) return Promise.reject(new Error('SYNTHETIC_READ_FAILURE'));
      return readWait ?? Promise.resolve(data.get(key) ?? null);
    },
    setItem(key, next) {
      calls.push({ method: 'setItem', key });
      if (rejectWrite) return Promise.reject(new Error('SYNTHETIC_WRITE_FAILURE'));
      data.set(key, next);
      return Promise.resolve();
    },
    removeItem(key) {
      calls.push({ method: 'removeItem', key });
      data.delete(key);
      return Promise.resolve();
    },
  };
  const storage = new Proxy(backend, { get(target, key) {
    if (key === '__esModule') return false;
    assert.ok(Object.hasOwn(target, key), 'Unexpected storage operation: ' + String(key));
    return target[key];
  } });
  const react = {
    createContext: () => ({ Provider: Symbol('WelcomeProvider') }),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useContext: () => { throw new Error('Unexpected consumer in provider-only fixture'); },
    useState(initial) {
      const index = cursor++;
      if (!cells[index]) cells[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [cells[index].value, next => {
        setterCalls++;
        cells[index].value = typeof next === 'function' ? next(cells[index].value) : next;
      }];
    },
    useEffect(run, deps) {
      const index = cursor++;
      if (!sameDeps(cells[index]?.deps, deps)) {
        const previous = cells[index];
        cells[index] = { deps };
        effects.push(() => { previous?.cleanup?.(); cells[index].cleanup = run(); });
      }
    },
    useMemo(run, deps) {
      const index = cursor++;
      if (!sameDeps(cells[index]?.deps, deps)) cells[index] = { deps, value: run() };
      return cells[index].value;
    },
  };
  class FixtureElement { focus() { focusCalls++; } }
  const module = { exports: {} };
  new Script(providerCode, { filename: 'WelcomeContext.fixture.cjs' }).runInNewContext({
    module, exports: module.exports, __DEV__: dev,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react-native') return { Platform: { OS: web ? 'web' : 'ios' } };
      if (name === '@react-native-async-storage/async-storage') return storage;
      if (name === '@/domain/welcome') return welcome;
      throw new Error('Unexpected provider dependency: ' + name);
    },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    ...(web ? { document: { activeElement: new FixtureElement() }, HTMLElement: FixtureElement } : {}),
  });
  const render = () => {
    cursor = 0;
    value = module.exports.WelcomeProvider({ children: null }).props.value;
    const pending = effects; effects = [];
    for (const effect of pending) effect();
  };
  render();
  return {
    data, calls, timers,
    get value() { return value; },
    get setterCalls() { return setterCalls; },
    get focusCalls() { return focusCalls; },
    async flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); render(); },
    settleRead(next) { assert.ok(resolveRead); resolveRead(next); },
    fireTimer(ms) {
      const found = [...timers].find(([, timer]) => timer.ms === ms);
      assert.ok(found, 'Expected timer: ' + ms);
      timers.delete(found[0]); found[1].fn();
    },
    unmount() { for (const cell of cells) cell.cleanup?.(); },
  };
}

function assertPresentationOnly(fixture) {
  assert.equal(fixture.value.resumeGoal, false);
  assert.deepEqual(Object.keys(fixture.value).sort(), [
    'hydrated', 'visible', 'reviewing', 'resumeGoal', 'runId',
    'completeWelcome', 'markWelcomeSeen', 'showWelcome', 'closeWelcome',
  ].sort());
  assert.ok(fixture.calls.every(call => call.key === WELCOME_STORAGE_KEY
    && ['getItem', 'setItem'].includes(call.method)), 'Only Welcome presentation storage may be accessed');
}

test('missing/invalid device marker shows presentation, never proves a new person', () => {
  for (const raw of [null, '', 'unknown', '{broken']) assert.equal(shouldShowFirstWelcome(raw), true);
  assert.equal(shouldShowFirstWelcome(WELCOME_SEEN_VALUE), false);
});
test('legacy opening/development parameters cannot suppress presentation', () => {
  for (const raw of ['{"synthetic":true}', '{broken', 'null', '   ']) {
    assert.equal(shouldShowFirstWelcome(null, raw, raw), true);
    assert.equal(shouldShowFirstWelcome(WELCOME_SEEN_VALUE, raw, raw), false);
  }
});
test('legacy resume flag never creates goal phase in release, dev or review', () => {
  for (const dev of [false, true]) for (const show of [false, true]) for (const legacyResume of [false, true]) {
    assert.deepEqual(resolveWelcomeLaunch(dev, show, legacyResume), { showWelcome: dev || show, resumeGoal: false });
    for (const reviewing of [false, true]) assert.equal(resolveWelcomeInitialPhase(dev, reviewing, legacyResume), 'opening');
  }
});

for (const [name, entries] of [
  ['all storage missing', []],
  ['legacy Opening present', [syntheticLegacy[0]]],
  ['legacy Development present', [syntheticLegacy[1]]],
  ['non-empty global goal draft', [syntheticLegacy[2]]],
  ['global goal-flow=goal', [syntheticLegacy[3]]],
  ['malformed non-empty legacy JSON', legacyKeys.map(key => [key, '{broken\r\n'])],
  ['all personal legacy keys present', syntheticLegacy],
]) test(name + ': actual provider ignores legacy; bytes unchanged', async () => {
  for (const dev of [false, true]) for (const marker of [null, WELCOME_SEEN_VALUE, 'invalid']) {
    const seed = [...entries, ...(marker === null ? [] : [[WELCOME_STORAGE_KEY, marker]])];
    const fixture = providerFixture(seed, { dev });
    assert.equal(fixture.value.hydrated, false);
    await fixture.flush();
    assert.equal(fixture.value.hydrated, true);
    assert.equal(fixture.value.visible, dev || marker !== WELCOME_SEEN_VALUE);
    assert.equal(fixture.value.reviewing, false);
    assert.equal(fixture.value.runId, 0);
    assert.deepEqual(fixture.calls, [{ method: 'getItem', key: WELCOME_STORAGE_KEY }]);
    assert.deepEqual([...fixture.data], seed); // exact strings, including whitespace and malformed bytes
    assertPresentationOnly(fixture);
    fixture.unmount();
  }
});

test('markWelcomeSeen writes only seen-v1 and cannot create global goal-flow', async () => {
  for (const seed of [[], syntheticLegacy]) {
    const fixture = providerFixture(seed);
    await fixture.flush();
    fixture.value.markWelcomeSeen(); await fixture.flush();
    assert.equal(fixture.value.visible, true); // existing M1→M2 stays mounted
    assert.equal(fixture.value.runId, 0);
    assert.deepEqual([...fixture.data], [...seed, [WELCOME_STORAGE_KEY, WELCOME_SEEN_VALUE]]);
    assert.deepEqual(fixture.calls.map(call => call.method), ['getItem', 'setItem']);
    assertPresentationOnly(fixture);
    fixture.unmount();
  }
});
test('completeWelcome changes presentation only; review cannot write legacy state', async () => {
  const fixture = providerFixture(syntheticLegacy);
  await fixture.flush();
  fixture.value.completeWelcome(); await fixture.flush();
  assert.equal(fixture.value.visible, false);
  fixture.value.showWelcome(); await fixture.flush();
  assert.equal(fixture.value.visible, true);
  assert.equal(fixture.value.reviewing, true);
  assert.equal(fixture.value.runId, 1);
  const callsBefore = fixture.calls.length;
  fixture.value.markWelcomeSeen(); await fixture.flush();
  assert.equal(fixture.calls.length, callsBefore);
  fixture.value.closeWelcome(); await fixture.flush();
  assert.equal(fixture.value.visible, false);
  assert.deepEqual([...fixture.data], [...syntheticLegacy, [WELCOME_STORAGE_KEY, WELCOME_SEEN_VALUE]]);
  assertPresentationOnly(fixture);
  fixture.unmount();
});
test('A→B same install shares device marker only; changed A legacy cannot affect B', async () => {
  const a = providerFixture(syntheticLegacy); await a.flush();
  a.value.markWelcomeSeen(); await a.flush(); a.unmount();
  const changedLegacy = legacyKeys.map(key => [key, 'DIFFERENT_SYNTHETIC_A_VALUE']);
  const b = providerFixture([...changedLegacy, [WELCOME_STORAGE_KEY, WELCOME_SEEN_VALUE]]);
  const cleanDevice = providerFixture([[WELCOME_STORAGE_KEY, WELCOME_SEEN_VALUE]]);
  await b.flush(); await cleanDevice.flush();
  for (const key of ['visible', 'resumeGoal', 'reviewing', 'runId']) assert.equal(b.value[key], cleanDevice.value[key]);
  b.value.showWelcome(); await b.flush();
  b.value.markWelcomeSeen(); await b.flush();
  assert.equal(resolveWelcomeInitialPhase(false, b.value.reviewing, b.value.resumeGoal), 'opening');
  assert.deepEqual(legacyKeys.map(key => [key, b.data.get(key)]), changedLegacy);
  assertPresentationOnly(b);
  b.unmount(); cleanDevice.unmount();
});
test('read failure opens presentation without identity or resume evidence', async () => {
  const fixture = providerFixture(syntheticLegacy, { rejectRead: true });
  await fixture.flush();
  assert.equal(fixture.value.hydrated, true); assert.equal(fixture.value.visible, true);
  assert.deepEqual([...fixture.data], syntheticLegacy); assert.equal(fixture.timers.size, 0);
  assertPresentationOnly(fixture); fixture.unmount();
});
test('900ms deadline shows opening; late saved marker cannot change settled launch', async () => {
  const fixture = providerFixture(syntheticLegacy, { holdRead: true });
  fixture.fireTimer(900); await fixture.flush();
  assert.equal(fixture.value.hydrated, true); assert.equal(fixture.value.visible, true);
  const setters = fixture.setterCalls;
  fixture.settleRead(WELCOME_SEEN_VALUE); await fixture.flush();
  assert.equal(fixture.setterCalls, setters); assert.equal(fixture.value.visible, true);
  assert.deepEqual([...fixture.data], syntheticLegacy); assertPresentationOnly(fixture); fixture.unmount();
});
test('unmount retires pending hydration and clears deadline', async () => {
  const fixture = providerFixture(syntheticLegacy, { holdRead: true });
  fixture.unmount(); const setters = fixture.setterCalls;
  fixture.settleRead(WELCOME_SEEN_VALUE); await fixture.flush();
  assert.equal(fixture.setterCalls, setters); assert.equal(fixture.timers.size, 0);
  assert.deepEqual([...fixture.data], syntheticLegacy); assertPresentationOnly(fixture);
});
test('failed device writes are handled and leave personal legacy unchanged', async () => {
  const fixture = providerFixture(syntheticLegacy, { rejectWrite: true });
  await fixture.flush(); fixture.value.markWelcomeSeen(); await fixture.flush();
  fixture.value.completeWelcome(); await fixture.flush();
  assert.equal(fixture.value.visible, false);
  assert.deepEqual([...fixture.data], syntheticLegacy); assertPresentationOnly(fixture); fixture.unmount();
});
test('web review returns focus without storage reset', async () => {
  const fixture = providerFixture([[WELCOME_STORAGE_KEY, WELCOME_SEEN_VALUE]], { web: true });
  await fixture.flush(); fixture.value.showWelcome(); await fixture.flush();
  fixture.value.closeWelcome(); await fixture.flush(); fixture.fireTimer(0);
  assert.equal(fixture.focusCalls, 1); assert.equal(fixture.value.visible, false);
  assert.deepEqual(fixture.calls, [{ method: 'getItem', key: WELCOME_STORAGE_KEY }]);
  assertPresentationOnly(fixture); fixture.unmount();
});

test('provider stays presentation-only; layout injects one explicit accepted M2 gateway', async () => {
  const ast = ts.createSourceFile('WelcomeContext.tsx', providerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = ast.statements.filter(ts.isImportDeclaration).map(node => node.moduleSpecifier.text).sort();
  assert.deepEqual(imports, ['@react-native-async-storage/async-storage', '@/domain/welcome', 'react', 'react-native'].sort());
  const layout = ts.createSourceFile('layout.tsx', await readFile(new URL('../app/_layout.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let frames = 0, m2GatewayProps = 0;
  function visit(node) {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(layout) === 'OpeningGoalFlow') {
      frames++;
      for (const attr of node.attributes.properties) {
        assert.equal(ts.isJsxSpreadAttribute(attr), false);
        if (ts.isJsxAttribute(attr) && attr.name.getText(layout) === 'm2Gateway') {
          m2GatewayProps++;
          assert.equal(attr.initializer?.kind, ts.SyntaxKind.JsxExpression);
          assert.equal(attr.initializer.expression?.getText(layout), 'm2Gateway');
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(layout); assert.equal(frames, 1); assert.equal(m2GatewayProps, 1);
});
test('existing logo animation lifecycle guards remain present', async () => {
  const logo = await readFile(new URL('../components/WelcomeLogoAnimation.tsx', import.meta.url), 'utf8');
  assert.ok(logo.includes('const onDrawCompleteRef = useRef(onDrawComplete);'));
  assert.ok(logo.includes('}, [motionPreferenceKnown, reduceMotion]);'));
  assert.ok(!logo.includes('[motionPreferenceKnown, onDrawComplete, reduceMotion]'));
  assert.ok(!logo.includes('startedRef'));
});

let passed = 0;
for (const { name, run } of tests) { await run(); passed++; console.log('PASS ' + name); }
console.log('Welcome split/quarantine verification: ' + passed + '/' + tests.length + ' PASS');
console.log('Scope: policy + actual provider under fake hooks/storage; no real storage or native certification.');
console.log('OpeningGoalFlow global draft exposure remains outside this slice. No A1 authority is created.');
