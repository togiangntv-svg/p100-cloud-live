// Test-only: synthetic authority, in-memory storage, fake API. No network/native services.
import assert from 'node:assert/strict';
import { registerHooks, createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { FakeStorage } from './fixtures/local-owner.mjs';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && /\/(interaction|boundary|storage|gate)$/.test(specifier)) {
      return nextResolve(specifier + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});
const { createRuntimeLeaseBridge } = await import('../dev/interaction-runtime/bridge.ts');
const { isRuntimeTestEnabled } = await import('../dev/interaction-runtime/gate.ts');
const fake = await import('../dev/interaction-runtime/fake-api.ts');
const { createInteractionStore } = await import('../context/interaction-owner/store.ts');
const savedDev = globalThis.__DEV__, savedFlag = process.env.EXPO_PUBLIC_LOCAL_ISOLATION_TEST;
const bridges = [], stores = [];
function mode(dev, flag) {
  globalThis.__DEV__ = dev;
  if (flag === undefined) delete process.env.EXPO_PUBLIC_LOCAL_ISOLATION_TEST;
  else process.env.EXPO_PUBLIC_LOCAL_ISOLATION_TEST = flag;
}
function bridge() { const b = createRuntimeLeaseBridge(); bridges.push(b); return b; }
function mount(b, backend) {
  const store = createInteractionStore({
    owner: b.getSnapshot().binding, backend,
    api: { status: fake.aiGatewayStatus, pilot: fake.aiPilotSession, respond: fake.aiRespond },
  });
  stores.push(store); store.start(); return store;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function idle(store) {
  for (let i = 0; i < 100; i++) {
    const s = store.getSnapshot();
    if (s.hydrated && s.persistenceStatus !== 'loading') { await tick(); return; }
    await tick();
  }
  assert.fail('Store did not settle');
}
const tests = [];
const test = (name, run) => tests.push({ name, run });
for (const [name, dev, flag] of [
  ['flag absent', true, undefined],
  ['flag wrong', true, 'true'],
  ['release with explicit flag', false, 'enabled'],
  ['missing development constant', undefined, 'enabled'],
  ['truthy non-boolean development value', 'true', 'enabled'],
]) {
  test(name + ' stays LOCKED with no synthetic lease', async () => {
    mode(dev, flag); assert.equal(isRuntimeTestEnabled(), false);
    const b = bridge();
    assert.equal(await b.select('A'), false);
    assert.equal(b.getSnapshot().phase, 'LOCKED');
    assert.equal(b.getSnapshot().binding, undefined);
    await assert.rejects(fake.aiGatewayStatus(), /TEST_BRIDGE_DISABLED/);
    await assert.rejects(fake.aiRespond({ requestId: 'disabled' }), /TEST_BRIDGE_DISABLED/);
    assert.equal(fake.delayedApi.getSnapshot(), 0);
  });
}
test('both gates permit only the two fixed synthetic Subject/Profile pairs', async () => {
  const b = bridge(); assert.equal(await b.select('A'), true);
  const a = b.getSnapshot().binding;
  assert.deepEqual(a.access.requireLease(a.lease).owner, { subjectId: 'test-subject-a', profileId: 'test-profile-a' });
  assert.equal(await b.select('B'), true);
  const second = b.getSnapshot().binding;
  assert.deepEqual(second.access.requireLease(second.lease).owner, { subjectId: 'test-subject-b', profileId: 'test-profile-b' });
});
test('malformed labels and supplied person-shaped objects retire old authority', async () => {
  const b = bridge();
  for (const invalid of [null, {}, 'C', '../A', { subjectId: 'test-subject-a', profileId: 'test-profile-a' }]) {
    await b.select('A'); const previous = b.getSnapshot().binding;
    assert.equal(await b.select(invalid), false);
    assert.equal(b.getSnapshot().phase, 'LOCKED');
    assert.throws(() => previous.access.requireLease(previous.lease));
  }
});
test('copied/fabricated/cross-boundary lease cannot impersonate test authority', async () => {
  const b = bridge(); await b.select('A'); const { access, lease } = b.getSnapshot().binding;
  for (const fakeLease of [{}, { ...lease }, JSON.parse(JSON.stringify(lease))]) {
    assert.throws(() => access.requireLease(fakeLease));
  }
  const other = bridge(); await other.select('A');
  assert.throws(() => other.getSnapshot().binding.access.requireLease(lease));
});
test('A to B to A issues a new generation and rejects prior lease', async () => {
  const b = bridge(); await b.select('A');
  const first = b.getSnapshot().binding, firstGeneration = b.getSnapshot().generation;
  b.invalidate(); assert.equal(b.getSnapshot().phase, 'LOCKED');
  await b.select('B'); await b.select('A');
  assert.ok(b.getSnapshot().generation > firstGeneration);
  assert.notEqual(b.getSnapshot().binding.lease, first.lease);
  assert.throws(() => first.access.requireLease(first.lease));
});
test('runtime restart begins LOCKED, no restored authority and no reusable old lease', async () => {
  const old = bridge(); await old.select('A'); const previous = old.getSnapshot().binding; old.invalidate();
  const fresh = bridge(); assert.equal(fresh.getSnapshot().phase, 'LOCKED');
  await fresh.select('A');
  assert.throws(() => fresh.getSnapshot().binding.access.requireLease(previous.lease));
});
test('gate disabled during verification cannot issue lease; concurrent selection retires A', async () => {
  const b = bridge(), pending = b.select('A');
  mode(false, 'enabled'); assert.equal(await pending, false);
  assert.equal(b.getSnapshot().phase, 'LOCKED');
  mode(true, 'enabled');
  const a = b.select('A'), second = b.select('B');
  assert.equal(await a, false); assert.equal(await second, true); assert.equal(b.getSnapshot().label, 'B');
});
test('gate disabled after activation locks on access and retires existing store', async () => {
  const b = bridge(); await b.select('A');
  const s = mount(b, new FakeStorage()); await idle(s);
  await s.getSnapshot().addUserMessage('SYNTHETIC A', 'vi'); await idle(s);
  mode(false, 'enabled'); assert.equal(b.getSnapshot().phase, 'LOCKED');
  assert.deepEqual(s.getSnapshot().state.messages, []);
});
test('real sealed lifecycle A to B to A restores only each owner; legacy untouched', async () => {
  const b = bridge(), backend = new FakeStorage();
  const legacy = '@100-human-development-interaction';
  backend.data.set(legacy, 'UNOWNED_FIXTURE'); backend.data.set(legacy + '-deleted-at', 'UNOWNED_MARKER');
  await b.select('A'); const a = mount(b, backend); await idle(a);
  assert.equal(await a.getSnapshot().addUserMessage('SYNTHETIC A ONLY', 'vi'), true); await idle(a);
  const previous = a.getSnapshot();
  b.invalidate(); assert.deepEqual(a.getSnapshot().state.messages, []);
  await b.select('B'); const second = mount(b, backend); await idle(second);
  assert.deepEqual(second.getSnapshot().state.messages, []);
  assert.equal(await second.getSnapshot().addUserMessage('SYNTHETIC B ONLY', 'vi'), true); await idle(second);
  await b.select('A'); const again = mount(b, backend); await idle(again);
  assert.deepEqual(again.getSnapshot().state.messages.map(m => m.text), ['SYNTHETIC A ONLY']);
  assert.equal(previous.saveCorrection('OLD_CALLBACK'), false);
  assert.ok(backend.calls.every(call => call.key.startsWith('@100/v2/subject/test-subject-')));
  assert.equal(backend.data.get(legacy), 'UNOWNED_FIXTURE');
  assert.equal(backend.data.get(legacy + '-deleted-at'), 'UNOWNED_MARKER');
});
for (const outcome of ['success', 'error']) {
  test('controlled late A ' + outcome + '/consent/finally cannot alter busy B', async () => {
    const b = bridge(), backend = new FakeStorage();
    await b.select('A'); const a = mount(b, backend); await idle(a);
    await a.getSnapshot().enableAiPilot('vi');
    const old = a.getSnapshot().addUserMessage('SYNTHETIC A DELAYED', 'vi');
    assert.equal(fake.delayedApi.getSnapshot(), 1);
    b.invalidate(); await b.select('B'); const second = mount(b, backend); await idle(second);
    await second.getSnapshot().enableAiPilot('vi');
    const next = second.getSnapshot().addUserMessage('SYNTHETIC B DELAYED', 'vi'); await idle(second);
    const before = second.getSnapshot();
    fake.delayedApi.settle(outcome); assert.equal(await old, false); await tick();
    assert.equal(second.getSnapshot(), before);
    assert.equal(second.getSnapshot().aiBusy, true);
    assert.equal(second.getSnapshot().state.aiConsent, 'granted');
    fake.delayedApi.settle('success'); assert.equal(await next, true); await idle(second);
    assert.equal(second.getSnapshot().aiBusy, false);
    assert.ok(!JSON.stringify(second.getSnapshot().state).includes('SYNTHETIC A'));
  });
}
test('sealed InteractionProvider bytes unchanged and harness mounts it directly', async () => {
  const source = await readFile(new URL('../context/InteractionContext.tsx', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'),
    '086b5eddbdbd1c8c4e0154f7b5b9f994519c6c987911985d62511a0a48a00ee8');
  const harness = await readFile(new URL('../dev/interaction-runtime/Harness.tsx', import.meta.url), 'utf8');
  assert.match(harness, /import \{ InteractionProvider, useInteraction \} from '..\/..\/context\/InteractionContext'/);
  assert.match(harness, /<InteractionProvider ownerSession=\{session.binding\}>/);
});
test('production source imports no test bridge or harness; gate never accepts caller flags', async () => {
  async function scan(url) {
    for (const item of await readdir(url, { withFileTypes: true })) {
      const child = new URL(item.name + (item.isDirectory() ? '/' : ''), url);
      if (item.isDirectory()) await scan(child);
      else if (/\.[jt]sx?$/.test(item.name)) {
        const source = await readFile(child, 'utf8');
        assert.doesNotMatch(source, /(?:from\s*|import\s*\(|require\s*\()\s*['"][^'"]*(?:dev\/interaction-runtime|runtime-lease|\/bridge)/);
      }
    }
  }
  for (const folder of ['app', 'context', 'components', 'domain']) await scan(new URL('../' + folder + '/', import.meta.url));
  const gate = await readFile(new URL('../dev/interaction-runtime/gate.ts', import.meta.url), 'utf8');
  assert.match(gate, /__DEV__ === true/);
  assert.match(gate, /process.env.EXPO_PUBLIC_LOCAL_ISOLATION_TEST === 'enabled'/);
  assert.match(gate, /isRuntimeTestEnabled\(\)/);
});
test('standalone Metro sends actual provider API to fake, leaves unrelated imports alone', async () => {
  const require = createRequire(import.meta.url);
  const config = require('../dev/interaction-runtime/metro.config.js');
  const provider = fileURLToPath(new URL('../context/InteractionContext.tsx', import.meta.url));
  const marker = { type: 'fallback' };
  const context = { originModulePath: provider, resolveRequest: () => marker };
  assert.equal(config.resolver.resolveRequest(context, '@workspace/api-client-react', 'web').filePath,
    fileURLToPath(new URL('../dev/interaction-runtime/fake-api.ts', import.meta.url)));
  assert.equal(config.resolver.resolveRequest(context, 'react', 'web'), marker);
  assert.equal(config.resolver.resolveRequest({ ...context, originModulePath: 'other.ts' }, '@workspace/api-client-react', 'web'), marker);
});
let passed = 0;
try {
  for (const { name, run } of tests) {
    mode(true, 'enabled');
    try { await run(); passed++; console.log('PASS ' + name); }
    finally {
      stores.splice(0).forEach(s => s.stop());
      bridges.splice(0).forEach(b => b.invalidate());
      fake.delayedApi.discard(); await tick();
    }
  }
  console.log('Runtime bridge: ' + passed + '/' + tests.length + ' PASS');
  console.log('Release gating is deterministically simulated, not a signed release build or device test.');
} finally {
  if (savedDev === undefined) delete globalThis.__DEV__; else globalThis.__DEV__ = savedDev;
  if (savedFlag === undefined) delete process.env.EXPO_PUBLIC_LOCAL_ISOLATION_TEST;
  else process.env.EXPO_PUBLIC_LOCAL_ISOLATION_TEST = savedFlag;
}
