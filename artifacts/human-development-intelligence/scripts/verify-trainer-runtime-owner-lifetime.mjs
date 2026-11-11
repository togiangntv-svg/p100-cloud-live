import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extname } from 'node:path';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { FakeClock, fakeAuthority, OWNER_A, OWNER_B } from './fixtures/local-owner.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context);
  },
});

let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw Error('NETWORK_FORBIDDEN'); };

const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const { createTrainerRuntimeCoordinator } = await import('../domain/trainer-runtime/coordinator.ts');

const tick = () => new Promise(resolve => setImmediate(resolve));

async function authorityFixture(owner = OWNER_A, validUntil = 100_000) {
  const clock = new FakeClock();
  const authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner, validUntil });
  const lease = await boundary.control.verifySession();
  boundary.control.finishHydration(lease);
  return {
    clock, authority, boundary,
    binding: Object.freeze({ access: boundary.access, lease }),
  };
}

async function replaceAuthority(fixture, owner, validUntil = 100_000) {
  fixture.authority.results.push({ status: 'verified', owner, validUntil });
  const lease = await fixture.boundary.control.verifySession();
  fixture.boundary.control.finishHydration(lease);
  return Object.freeze({ access: fixture.boundary.access, lease });
}

function recordingFactory(extra = {}) {
  const records = [];
  return {
    records,
    createStore(binding) {
      const real = createSessionTaskStore({ ownerSession: binding, ...extra });
      const record = { binding, real, starts: 0, stops: 0, store: undefined };
      record.store = Object.freeze({
        ...real,
        start() { record.starts++; real.start(); },
        stop() { record.stops++; real.stop(); },
      });
      records.push(record);
      return record.store;
    },
  };
}

test('01 no owner binding exposes no personal Trainer runtime', () => {
  const factory = recordingFactory();
  const runtime = createTrainerRuntimeCoordinator({ createStore: factory.createStore });
  assert.equal(runtime.getSnapshot().state, 'UNAVAILABLE');
  assert.equal(factory.records.length, 0);
});

test('02 READY owner A creates and starts exactly one bound store', async () => {
  const f = await authorityFixture(); const factory = recordingFactory();
  const runtime = createTrainerRuntimeCoordinator({ createStore: factory.createStore });
  runtime.setBinding(f.binding);
  assert.equal(runtime.getSnapshot().state, 'READY');
  assert.equal(factory.records.length, 1);
  assert.equal(factory.records[0].starts, 1);
  assert.equal(factory.records[0].stops, 0);
});

test('03 wrapper-equivalent binding keeps the same runtime and store', async () => {
  const f = await authorityFixture(); const factory = recordingFactory();
  const runtime = createTrainerRuntimeCoordinator({ createStore: factory.createStore });
  runtime.setBinding(f.binding); const first = runtime.getSnapshot();
  runtime.setBinding(Object.freeze({ access: f.binding.access, lease: f.binding.lease }));
  assert.equal(runtime.getSnapshot(), first);
  assert.equal(factory.records.length, 1);
});

test('04 locale and M3 permission revision changes do not define owner lifetime', async () => {
  const f = await authorityFixture(); const factory = recordingFactory();
  const runtime = createTrainerRuntimeCoordinator({ createStore: factory.createStore });
  runtime.setBinding(f.binding); const first = runtime.getSnapshot().store;
  let locale = 'vi'; let m3PermissionRevision = 1;
  locale = 'en'; m3PermissionRevision++;
  runtime.setBinding({ access: f.binding.access, lease: f.binding.lease });
  assert.equal(runtime.getSnapshot().store, first);
  assert.equal(`${locale}:${m3PermissionRevision}`, 'en:2');
  assert.equal(factory.records.length, 1);
});

test('05 generation replacement retires old before fresh runtime is exposed', async () => {
  const f = await authorityFixture(); const factory = recordingFactory();
  const runtime = createTrainerRuntimeCoordinator({ createStore: factory.createStore });
  runtime.setBinding(f.binding); const old = factory.records[0];
  const replacement = await replaceAuthority(f, OWNER_A);
  assert.equal(runtime.getSnapshot().state, 'UNAVAILABLE');
  assert.equal(old.stops, 1);
  runtime.setBinding(replacement);
  assert.equal(runtime.getSnapshot().state, 'READY');
  assert.equal(factory.records.length, 2);
  assert.notEqual(factory.records[1].store, old.store);
});

test('06 owner A to owner B carries no task or private RAM', async () => {
  const f = await authorityFixture(); const factory = recordingFactory();
  const runtime = createTrainerRuntimeCoordinator({ createStore: factory.createStore });
  runtime.setBinding(f.binding);
  const old = runtime.getSnapshot().store;
  assert.ok(old.submit('PRIVATE A', { permission_granted: false }));
  assert.equal(old.getSnapshot().tasks.length, 1);
  const bindingB = await replaceAuthority(f, OWNER_B);
  runtime.setBinding(bindingB);
  const fresh = runtime.getSnapshot().store;
  assert.notEqual(fresh, old);
  assert.equal(fresh.getSnapshot().tasks.length, 0);
  assert.equal(old.getSnapshot().tasks.length, 0);
});

test('07 logout or invalidation makes runtime unavailable and retires old store', async () => {
  const f = await authorityFixture(); const factory = recordingFactory();
  const runtime = createTrainerRuntimeCoordinator({ createStore: factory.createStore });
  runtime.setBinding(f.binding); const old = factory.records[0];
  f.boundary.control.invalidateCurrentSession();
  assert.equal(runtime.getSnapshot().state, 'UNAVAILABLE');
  assert.equal(old.stops, 1);
});

test('08 silent lease expiry is detected on next read and retires runtime', async () => {
  const f = await authorityFixture(OWNER_A, 1_010); const factory = recordingFactory();
  const runtime = createTrainerRuntimeCoordinator({ createStore: factory.createStore });
  runtime.setBinding(f.binding); const old = factory.records[0];
  f.clock.jumpWithoutTimers(11);
  assert.equal(runtime.getSnapshot().state, 'UNAVAILABLE');
  assert.equal(old.stops, 1);
});

test('09 retired owner-bound store never restarts; valid binding creates a fresh store', async () => {
  const f = await authorityFixture(); const factory = recordingFactory();
  const runtime = createTrainerRuntimeCoordinator({ createStore: factory.createStore });
  runtime.setBinding(f.binding); const old = factory.records[0];
  runtime.setBinding(undefined);
  old.real.start();
  assert.equal(old.real.getSnapshot().session_id, null);
  runtime.setBinding(f.binding);
  assert.equal(factory.records.length, 2);
  assert.notEqual(runtime.getSnapshot().store, old.store);
});

test('10 anonymous task state is never adopted into an authenticated runtime', async () => {
  const anonymous = createSessionTaskStore(); anonymous.start();
  assert.ok(anonymous.submit('ANONYMOUS PRIVATE', { permission_granted: false }));
  const f = await authorityFixture(); const runtime = createTrainerRuntimeCoordinator();
  runtime.setBinding(f.binding);
  assert.equal(runtime.getSnapshot().store.getSnapshot().tasks.length, 0);
  assert.equal(anonymous.getSnapshot().tasks.length, 1);
  anonymous.stop(); runtime.dispose();
});

test('11 Strict Mode equivalent setup-cleanup-setup leaves no abandoned listener or store', async () => {
  const f = await authorityFixture(); let subscriptions = 0;
  const countedAccess = Object.freeze({
    getSnapshot: f.binding.access.getSnapshot,
    requireLease: f.binding.access.requireLease,
    applyIfCurrent: f.binding.access.applyIfCurrent,
    subscribe(listener) {
      subscriptions++;
      const stop = f.binding.access.subscribe(listener);
      return () => { subscriptions--; stop(); };
    },
  });
  const binding = Object.freeze({ access: countedAccess, lease: f.binding.lease });
  const factory = recordingFactory();
  const runtime = createTrainerRuntimeCoordinator({ createStore: factory.createStore });
  runtime.setBinding(binding);
  runtime.setBinding(undefined);
  runtime.setBinding(binding);
  assert.equal(factory.records.length, 2);
  assert.equal(factory.records[0].stops, 1);
  assert.equal(subscriptions, 2); // coordinator + current SessionTaskStore only
  runtime.dispose();
  assert.equal(subscriptions, 0);
});

test('12 dispose is idempotent', async () => {
  const f = await authorityFixture(); const factory = recordingFactory();
  const runtime = createTrainerRuntimeCoordinator({ createStore: factory.createStore });
  runtime.setBinding(f.binding); runtime.dispose(); runtime.dispose();
  assert.equal(factory.records[0].stops, 1);
  assert.equal(runtime.getSnapshot().state, 'UNAVAILABLE');
  runtime.setBinding(f.binding);
  assert.equal(factory.records.length, 1);
});

test('13 late operations from retired store cannot affect a new runtime', async () => {
  let release;
  const adapter = Object.freeze({
    provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    interpret(_input, signal) {
      return new Promise((resolve, reject) => {
        release = () => resolve({ intent_type: 'GOAL', interpreted_meaning: 'PRIVATE A', confidence: 1,
          uncertainty: null, missing_context: [], clarification_needed: false,
          clarification_question: null, safety_state: 'CLEAR', suggested_next_role: 'M4',
          task_kind: 'general_health', context_effect: 'NONE', used_context_ids: [], response: 'A' });
        signal.addEventListener('abort', () => reject(Error('ABORTED')), { once: true });
      });
    },
    async revoke() {},
  });
  const f = await authorityFixture(); const factory = recordingFactory({ adapter });
  const runtime = createTrainerRuntimeCoordinator({ createStore: factory.createStore });
  runtime.setBinding(f.binding);
  const old = runtime.getSnapshot().store;
  old.submit('PRIVATE A', { permission_granted: true });
  runtime.setBinding(undefined); runtime.setBinding(f.binding);
  const fresh = runtime.getSnapshot().store;
  release(); await tick(); await tick();
  assert.equal(fresh.getSnapshot().tasks.length, 0);
  assert.equal(old.getSnapshot().tasks.length, 0);
});

test('14 production runtime grants no M7 purpose and cannot activate W01', async () => {
  const f = await authorityFixture(); const runtime = createTrainerRuntimeCoordinator();
  runtime.setBinding(f.binding); const store = runtime.getSnapshot().store;
  assert.equal(store.m7Outcome.getSnapshot(undefined).state, 'UNAVAILABLE');
  assert.equal(store.selfWalk.chooseAndStart(undefined, {}, 'forbidden-start').state, 'DENIED');
  const source = await readFile(new URL('../domain/trainer-runtime/coordinator.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /createLocalM7PurposeAuthority|\.grant\s*\(/u);
  assert.doesNotMatch(source, /walkResource\s*:|m7Purpose\s*:/u);
});

test('15 provider placement is below owner and independent of welcome, locale and keyboard', async () => {
  const layout = await readFile(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /<OwnerSessionProvider>[\s\S]*<TrainerRuntimeProvider>[\s\S]*<WelcomeProvider>/u);
  const provider = await readFile(new URL('../context/TrainerRuntimeContext.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(provider, /useWelcome|useLocale|runId|m3Access|permission_revision/u);
  assert.doesNotMatch(provider, /useRef\s*\(\s*createSessionTaskStore/u);
});

test('16 tests require no provider or network call', () => {
  assert.equal(networkCalls, 0);
});
