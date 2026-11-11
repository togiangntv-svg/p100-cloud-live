// Gate/resolver/source checks complement the mounted Expo browser scenarios.
// This script alone is NOT proof that React/native runtime tests passed.
import assert from 'node:assert/strict';
import { registerHooks, createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && /\/(boundary|gate)$/.test(specifier)) return nextResolve(specifier + '.ts', context);
  return nextResolve(specifier, context);
} });
const { createRuntimeLeaseBridge } = await import('../dev/interaction-runtime/bridge.ts');
const { isRuntimeTestEnabled } = await import('../dev/interaction-runtime/gate.ts');
const { syntheticStorage: storage, fixtureKey } = await import('../dev/development-runtime/fake-storage.ts');
const oldDev = globalThis.__DEV__, oldFlag = process.env.EXPO_PUBLIC_LOCAL_ISOLATION_TEST;
const bridges = [], tests = [];
const test = (name, run) => tests.push({ name, run });
function mode(dev, flag) {
  globalThis.__DEV__ = dev;
  if (flag === undefined) delete process.env.EXPO_PUBLIC_LOCAL_ISOLATION_TEST;
  else process.env.EXPO_PUBLIC_LOCAL_ISOLATION_TEST = flag;
}
function bridge() { const b = createRuntimeLeaseBridge(); bridges.push(b); return b; }
for (const [name, dev, flag] of [
  ['missing flag', true, undefined], ['wrong flag', true, 'true'],
  ['release/non-dev with flag', false, 'enabled'], ['missing __DEV__', undefined, 'enabled'],
  ['truthy non-boolean __DEV__', 'true', 'enabled'],
]) test(name + ': shared bridge and fake storage fail closed', async () => {
  mode(dev, flag); const b = bridge();
  assert.equal(isRuntimeTestEnabled(), false); assert.equal(await b.select('A'), false);
  assert.equal(b.getSnapshot().phase, 'LOCKED'); assert.equal(b.getSnapshot().binding, undefined);
  await assert.rejects(storage.getItem(fixtureKey('A')), /TEST_BRIDGE_DISABLED/);
  await assert.rejects(storage.setItem(fixtureKey('A'), 'synthetic'), /TEST_BRIDGE_DISABLED/);
  await assert.rejects(storage.removeItem(fixtureKey('A')), /TEST_BRIDGE_DISABLED/);
  await assert.rejects(storage.getAllKeys(), /TEST_BRIDGE_DISABLED/);
});
test('only sealed synthetic owners; each selection receives a fresh generation', async () => {
  const b = bridge(); assert.equal(await b.select('A'), true); const a = b.getSnapshot();
  assert.deepEqual(a.binding.access.requireLease(a.binding.lease).owner,
    { subjectId: 'test-subject-a', profileId: 'test-profile-a' });
  assert.equal(await b.select('B'), true); const second = b.getSnapshot();
  assert.ok(second.generation > a.generation);
  assert.deepEqual(second.binding.access.requireLease(second.binding.lease).owner,
    { subjectId: 'test-subject-b', profileId: 'test-profile-b' });
  assert.throws(() => a.binding.access.requireLease(a.binding.lease));
});
test('malformed caller owner and copied lease cannot manufacture authority', async () => {
  const b = bridge(); await b.select('A'); const a = b.getSnapshot().binding;
  assert.throws(() => a.access.requireLease({ ...a.lease }));
  assert.equal(await b.select({ subjectId: 'test-subject-a', profileId: 'test-profile-a' }), false);
  assert.equal(b.getSnapshot().phase, 'LOCKED'); assert.throws(() => a.access.requireLease(a.lease));
});
test('bridge restart starts LOCKED and never reuses earlier leases', async () => {
  const b = bridge(); await b.select('A'); const a = b.getSnapshot().binding;
  const fresh = bridge(); assert.equal(fresh.getSnapshot().phase, 'LOCKED');
  assert.equal(fresh.getSnapshot().generation, 0); assert.equal(fresh.getSnapshot().binding, undefined);
  await fresh.select('A'); assert.throws(() => fresh.getSnapshot().binding.access.requireLease(a.lease));
});
test('fake backend rejects keys outside fixed synthetic fixtures', async () => {
  await assert.rejects(storage.getItem('@100/v2/subject/real/profile/real/state'), /NON_SYNTHETIC_STORAGE_KEY/);
  await assert.rejects(storage.setItem('global-fallback', 'synthetic'), /NON_SYNTHETIC_STORAGE_KEY/);
  assert.throws(() => storage.seed('other', 'synthetic'), /NON_SYNTHETIC_STORAGE_KEY/);
});
test('ACTUAL sealed provider/store hashes unchanged; harness imports provider directly', async () => {
  for (const [path, hash] of [
    ['context/DevelopmentContext.tsx', '30df968f2a16894ad3df02b81350d00b95f03167fa4c81c2f21614d1d31275a3'],
    ['context/development-owner/store.ts', '6d21a5b8b4dcb636a2166aaf1150cde0419aae7f65349e5b742b1b20b50abc37'],
  ]) assert.equal(createHash('sha256').update(await readFile(new URL('../' + path, import.meta.url))).digest('hex'), hash);
  const harness = await readFile(new URL('../dev/development-runtime/Harness.tsx', import.meta.url), 'utf8');
  assert.match(harness, /import \{ DevelopmentProvider, useDevelopment \} from '..\/..\/context\/DevelopmentContext'/);
  assert.match(harness, /<DevelopmentProvider ownerSession=/);
  assert.match(harness, /from '..\/interaction-runtime\/bridge'/);
  for (const name of ['Harness.tsx', 'scenarios.ts', 'fake-storage.ts']) {
    const source = await readFile(new URL('../dev/development-runtime/' + name, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /createLocalOwnerBoundary|reduceGate7State|createDevelopmentStore|fetch\(|localStorage|console\./);
  }
});
test('standalone resolver replaces storage only for actual DevelopmentProvider', async () => {
  const require = createRequire(import.meta.url), config = require('../dev/development-runtime/metro.config.js');
  const marker = { type: 'fallback' }, context = {
    originModulePath: fileURLToPath(new URL('../context/DevelopmentContext.tsx', import.meta.url)),
    resolveRequest: () => marker,
  };
  assert.equal(config.resolver.resolveRequest(context, '@react-native-async-storage/async-storage', 'web').filePath,
    fileURLToPath(new URL('../dev/development-runtime/fake-storage.ts', import.meta.url)));
  assert.equal(config.resolver.resolveRequest({ ...context, originModulePath: 'InteractionContext.tsx' },
    '@react-native-async-storage/async-storage', 'web'), marker);
  assert.equal(config.resolver.resolveRequest(context, 'react', 'web'), marker);
});
test('no production imports, added dependency, auth or signing configuration', async () => {
  async function scan(url) {
    for (const entry of await readdir(url, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
      if (entry.isDirectory()) await scan(child);
      else if (/\.[jt]sx?$/.test(entry.name)) assert.doesNotMatch(await readFile(child, 'utf8'), /(?:from\s*|import\s*\(|require\s*\()\s*['"][^'"]*(?:dev\/development-runtime|dev\/interaction-runtime)/);
    }
  }
  for (const folder of ['app', 'context', 'components', 'domain']) await scan(new URL('../' + folder + '/', import.meta.url));
  const pkg = JSON.parse(await readFile(new URL('../dev/development-runtime/package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies, undefined); assert.equal(pkg.devDependencies, undefined);
  assert.doesNotMatch(await readFile(new URL('../dev/development-runtime/app.config.js', import.meta.url), 'utf8'), /projectId|bundleIdentifier|credentials/);
});
let passed = 0;
try {
  for (const { name, run } of tests) {
    mode(true, 'enabled');
    try { await run(); passed++; console.log('PASS ' + name); }
    finally { for (const b of bridges.splice(0)) b.invalidate(); }
  }
  console.log(`Development runtime guard/integration checks: ${passed}/${tests.length} PASS`);
  console.log('Release gate is simulated. Mounted Expo scenarios must be run separately.');
} finally {
  if (oldDev === undefined) delete globalThis.__DEV__; else globalThis.__DEV__ = oldDev;
  if (oldFlag === undefined) delete process.env.EXPO_PUBLIC_LOCAL_ISOLATION_TEST;
  else process.env.EXPO_PUBLIC_LOCAL_ISOLATION_TEST = oldFlag;
}
