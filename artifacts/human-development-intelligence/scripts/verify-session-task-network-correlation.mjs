import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FakeClock, fakeAuthority, OWNER_A } from './fixtures/local-owner.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.(?:[cm]?js|tsx?)$/u.test(specifier) && context.parentURL) {
      const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
      if (existsSync(`${base}.ts`)) return nextResolve(pathToFileURL(`${base}.ts`).href, context);
      if (existsSync(base) && statSync(base).isDirectory() && existsSync(`${base}/index.ts`)) {
        return nextResolve(pathToFileURL(`${base}/index.ts`).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw Error('NETWORK_FORBIDDEN'); };

const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const { createM3GatewayAdapter } = await import('../domain/m3/gateway-adapter.ts');
const { createM3Handler } = await import('../../api-server/src/ai/m3-operation.ts');
const {
  INTERPRET_REQUEST_MAX_LENGTH, REVOKE_REQUEST_MAX_LENGTH, SESSION_CORRELATION_MAX_LENGTH,
  TASK_CONTEXT_MAX_LENGTH, TASK_CORRELATION_MAX_LENGTH, allocateSessionCorrelationId,
  createInterpretRequestId, createRevokeRequestId, createSessionCorrelationAllocator,
  createTaskContextId, createTaskCorrelationId, isSessionCorrelationId,
} = await import('../domain/session-task/correlation.ts');

const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';
const FIXED_SESSION_A = 's-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa-1';
const FIXED_SESSION_B = 's-bbbbbbbbbbbb4bbb9bbbbbbbbbbbbbbb-1';

const goalMeaning = () => ({
  intent_type: 'GOAL', interpreted_meaning: 'Khỏe hơn', confidence: 0.95,
  uncertainty: null, missing_context: [], clarification_needed: false, clarification_question: null,
  safety_state: 'CLEAR', suggested_next_role: 'M4', task_kind: 'general_health', context_effect: 'NONE',
  used_context_ids: [], response: 'Đã ghi nhận.',
});

const waitFor = async (predicate, message) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(message);
};

async function ownerFixture() {
  const clock = new FakeClock();
  const authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner: OWNER_A, validUntil: 100_000 });
  const lease = await boundary.control.verifySession();
  boundary.control.finishHydration(lease);
  return { clock, binding: Object.freeze({ access: boundary.access, lease }) };
}

function createInMemoryGateway(options = {}) {
  const requests = [];
  const audits = [];
  const handler = createM3Handler({
    enabled: () => true,
    available: () => {},
    principal: () => 'same-principal-fixture',
    acquire: () => {},
    release: () => {},
    reserve: async () => {},
    record: async () => {},
    interpret: options.interpret ?? (async () => ({
      meaning: goalMeaning(), usage: { inputTokens: 1, outputTokens: 1 },
    })),
    audit: code => audits.push(code),
    diagnose: () => {},
  });

  const http = async (url, init) => {
    if (url.endsWith('/api/ai/session')) {
      return { ok: true, status: 200, async json() { return Object.freeze({ ok: true }); } };
    }
    const body = JSON.parse(init.body);
    requests.push(body);
    const req = new EventEmitter();
    req.body = body;
    const res = new EventEmitter();
    res.destroyed = false;
    res.writableEnded = false;
    let status = 200;
    let payload;
    res.status = (value) => { status = value; return res; };
    res.json = (value) => { payload = value; res.writableEnded = true; return res; };
    await handler(req, res);
    return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
  };
  return { http, requests, audits };
}

async function createGatewayPair() {
  const owner = await ownerFixture();
  const gateway = createInMemoryGateway();
  let a; let b;
  const adapterA = createM3GatewayAdapter({
    http: gateway.http, provenance: 'TEST_FIXTURE',
    isSessionCurrent: sessionId => a?.getSnapshot().session_id === sessionId,
  });
  const adapterB = createM3GatewayAdapter({
    http: gateway.http, provenance: 'TEST_FIXTURE',
    isSessionCurrent: sessionId => b?.getSnapshot().session_id === sessionId,
  });
  a = createSessionTaskStore({ ownerSession: owner.binding, now: owner.clock.now, adapter: adapterA });
  b = createSessionTaskStore({ ownerSession: owner.binding, now: owner.clock.now, adapter: adapterB });
  a.start(); b.start();
  return { owner, gateway, a, b };
}

test('01 same-principal A/B requests do not alias in the real in-memory M3 handler', async () => {
  const { gateway, a, b } = await createGatewayPair();
  const taskA = a.submit('Khỏe hơn', { permission_granted: true });
  await waitFor(() => a.getSnapshot().tasks[0]?.status !== 'NEEDS_ROUTING', 'A did not settle');
  assert.equal(a.getSnapshot().tasks[0]?.status, 'READY');
  await new Promise(resolve => setTimeout(resolve, 5));
  const taskB = b.submit('Khỏe hơn', { permission_granted: true });
  await waitFor(() => b.getSnapshot().tasks[0]?.status !== 'NEEDS_ROUTING', 'B did not settle');

  assert.equal(b.getSnapshot().tasks[0]?.status, 'READY',
    `remote collision reproduced: ${gateway.audits.join(',')}`);
  assert.notEqual(a.getSnapshot().session_id, b.getSnapshot().session_id);
  assert.notEqual(taskA, taskB);
  assert.notEqual(gateway.requests[0].requestId, gateway.requests[1].requestId);
  assert.notEqual(gateway.requests[0].taskId, gateway.requests[1].taskId);
  assert.equal(networkCalls, 0);
  a.stop(); b.stop();
});

test('02 same clock and local counters still allocate distinct namespaces', async () => {
  const owner = await ownerFixture();
  const a = createSessionTaskStore({ ownerSession: owner.binding, now: owner.clock.now });
  const b = createSessionTaskStore({ ownerSession: owner.binding, now: owner.clock.now });
  a.start(); b.start();
  assert.notEqual(a.getSnapshot().session_id, b.getSnapshot().session_id);
  assert.equal(owner.clock.now(), owner.clock.now());
  a.stop(); b.stop();
});

test('03 forced identical UUIDs remain unique through the shared allocation serial', () => {
  const allocator = createSessionCorrelationAllocator({ randomUuid: () => UUID_A });
  const first = allocator.allocate(); const second = allocator.allocate();
  assert.equal(first, FIXED_SESSION_A);
  assert.equal(second, 's-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa-2');
  assert.notEqual(first, second);
});

test('04 canonical allocator serial continues across fresh stores in this process', () => {
  const first = allocateSessionCorrelationId();
  const second = allocateSessionCorrelationId();
  const firstSerial = Number.parseInt(first.slice(first.lastIndexOf('-') + 1), 36);
  const secondSerial = Number.parseInt(second.slice(second.lastIndexOf('-') + 1), 36);
  assert.equal(secondSerial, firstSerial + 1);
});

test('05 anonymous stop and restart allocate a new namespace and issuer epoch', () => {
  const ids = [FIXED_SESSION_A, FIXED_SESSION_B];
  const store = createSessionTaskStore({ sessionIdFactory: () => ids.shift() });
  store.start(); const oldId = store.getSnapshot().session_id;
  const oldTask = store.submit('old'); const oldRef = store.reference(oldTask);
  store.stop(); store.start();
  const newTask = store.submit('new'); const newRef = store.reference(newTask);
  assert.notEqual(store.getSnapshot().session_id, oldId);
  assert.equal(store.assessM4GoalReadiness(oldRef).decision.reason, 'STALE_TASK');
  assert.equal(store.assessM4GoalReadiness(newRef).decision.reason, 'TASK_NOT_READY');
  store.stop();
});

test('06 owner-bound retired store is terminal and cannot allocate on restart', async () => {
  const owner = await ownerFixture(); let allocations = 0;
  const store = createSessionTaskStore({ ownerSession: owner.binding,
    sessionIdFactory: () => { allocations++; return FIXED_SESSION_A; } });
  store.start(); store.stop(); store.start();
  assert.equal(allocations, 1);
  assert.equal(store.getSnapshot().session_id, null);
});

test('07 UUIDv4 format, version, variant and lowercase normalization are enforced', () => {
  const valid = createSessionCorrelationAllocator({ randomUuid: () => UUID_A.toUpperCase() });
  assert.equal(valid.allocate(), FIXED_SESSION_A);
  for (const invalid of [
    'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-4aaa-caaa-aaaaaaaaaaaa',
    'not-a-uuid', '',
  ]) {
    assert.throws(() => createSessionCorrelationAllocator({ randomUuid: () => invalid }).allocate(),
      /SESSION_CORRELATION_UUID_INVALID/u);
  }
});

test('08 unavailable UUID primitive fails closed without publishing or retrying', () => {
  let calls = 0; let publications = 0;
  const allocator = createSessionCorrelationAllocator({ randomUuid: () => {
    calls++; throw Error('SESSION_CORRELATION_UUID_UNAVAILABLE');
  } });
  const store = createSessionTaskStore({ sessionIdFactory: allocator.allocate });
  store.subscribe(() => { publications++; });
  assert.throws(() => store.start(), /SESSION_CORRELATION_UUID_UNAVAILABLE/u);
  assert.equal(calls, 1); assert.equal(publications, 0);
  assert.equal(store.getSnapshot().session_id, null);
  assert.equal(store.submit('blocked'), undefined);
});

test('09 invalid full-ID test seam fails before epoch, active state or publication', () => {
  let publications = 0;
  const store = createSessionTaskStore({ sessionIdFactory: () => 'invalid-session' });
  store.subscribe(() => { publications++; });
  assert.throws(() => store.start(), /SESSION_CORRELATION_ID_INVALID/u);
  assert.equal(publications, 0);
  assert.equal(store.getSnapshot().session_id, null);
});

test('10 allocation serial exhaustion never wraps or recycles', () => {
  const allocator = createSessionCorrelationAllocator({
    randomUuid: () => UUID_A, initialSerial: Number.MAX_SAFE_INTEGER - 1,
  });
  const finalId = allocator.allocate();
  assert.equal(Number.parseInt(finalId.slice(finalId.lastIndexOf('-') + 1), 36), Number.MAX_SAFE_INTEGER);
  assert.throws(() => allocator.allocate(), /SESSION_CORRELATION_SERIAL_EXHAUSTED/u);
});

test('11 failure creating B leaves valid A active and unchanged', () => {
  const a = createSessionTaskStore({ sessionIdFactory: () => FIXED_SESSION_A });
  const b = createSessionTaskStore({ sessionIdFactory: () => 'bad' });
  a.start(); const before = a.getSnapshot().session_id;
  assert.throws(() => b.start(), /SESSION_CORRELATION_ID_INVALID/u);
  assert.equal(a.getSnapshot().session_id, before);
  assert.ok(a.submit('A remains usable'));
  a.stop();
});

test('12 no timestamp, Math.random or default-string fallback exists', () => {
  const source = readFileSync(new URL('../domain/session-task/correlation.ts', import.meta.url), 'utf8')
    + readFileSync(new URL('../lib/correlation/random-uuid.ts', import.meta.url), 'utf8')
    + readFileSync(new URL('../lib/correlation/random-uuid.native.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Math\.random|Date\.now/u);
  assert.match(source, /randomUUID/u);
  assert.match(source, /expo-crypto/u);
});

test('13 namespace contains no owner, profile, generation, goal, health, device or locale data', async () => {
  const owner = await ownerFixture();
  const store = createSessionTaskStore({ ownerSession: owner.binding,
    sessionIdFactory: () => FIXED_SESSION_A });
  store.start(); const id = store.getSnapshot().session_id;
  for (const privateValue of [OWNER_A.subjectId, OWNER_A.profileId, 'general_health', 'device', 'vi']) {
    assert.equal(id.includes(privateValue), false);
  }
  store.stop();
});

test('14 namespace is stable during an active epoch and M3 permission changes', async () => {
  const adapter = { provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    async interpret() { return goalMeaning(); }, async revoke() {} };
  const store = createSessionTaskStore({ adapter, sessionIdFactory: () => FIXED_SESSION_A });
  store.start(); const session = store.getSnapshot().session_id;
  const task = store.submit('same', { permission_granted: false });
  let ref = store.reference(task);
  assert.equal(store.setM3Permission(ref, true), true);
  await waitFor(() => store.getSnapshot().tasks[0]?.status === 'READY', 'permission reroute did not settle');
  ref = store.reference(task);
  assert.equal(store.setM3Permission(ref, false), true);
  assert.equal(store.getSnapshot().session_id, session);
  store.start();
  assert.equal(store.getSnapshot().session_id, session);
  store.stop();
});

test('15 derived IDs retain the parent namespace and stay within all wire bounds', () => {
  const allocator = createSessionCorrelationAllocator({
    randomUuid: () => UUID_A, initialSerial: Number.MAX_SAFE_INTEGER - 1,
  });
  const session = allocator.allocate();
  const task = createTaskCorrelationId(session, Number.MAX_SAFE_INTEGER);
  const interpret = createInterpretRequestId(task, Number.MAX_SAFE_INTEGER);
  const revoke = createRevokeRequestId(task, Number.MAX_SAFE_INTEGER);
  const context = createTaskContextId(task, 1_000_000_000);
  assert.ok(session.length <= SESSION_CORRELATION_MAX_LENGTH);
  assert.ok(task.length <= TASK_CORRELATION_MAX_LENGTH);
  assert.ok(interpret.length <= INTERPRET_REQUEST_MAX_LENGTH);
  assert.ok(revoke.length <= REVOKE_REQUEST_MAX_LENGTH);
  assert.ok(context.length <= TASK_CONTEXT_MAX_LENGTH);
  for (const value of [task, interpret, revoke, context]) assert.ok(value.startsWith(session));
});

test('16 revoke A cannot target B and B remains usable through the shared handler', async () => {
  const { gateway, a, b } = await createGatewayPair();
  const taskA = a.submit('same source', { permission_granted: true });
  await waitFor(() => a.getSnapshot().tasks[0]?.status === 'READY', 'A did not become ready');
  const taskB = b.submit('same source', { permission_granted: true });
  await waitFor(() => b.getSnapshot().tasks[0]?.status === 'READY', 'B did not become ready');
  const refA = a.reference(taskA); let refB = b.reference(taskB);
  assert.equal(await a.revoke(refA), true);
  assert.equal(b.getSnapshot().tasks[0]?.status, 'READY');
  assert.equal(b.edit(refB, 'B remains usable'), true);
  await waitFor(() => b.getSnapshot().tasks[0]?.status === 'READY', 'B reroute failed after A revoke');
  refB = b.reference(taskB);
  assert.ok(refB);
  const revokeA = gateway.requests.find(request => request.operation === 'revoke');
  const interpretB = gateway.requests.find(request => request.operation === 'interpret'
    && request.sessionId === b.getSnapshot().session_id);
  assert.notEqual(revokeA.sessionId, interpretB.sessionId);
  assert.notEqual(revokeA.taskId, interpretB.taskId);
  a.stop(); b.stop();
});

test('17 identical retry stays in one namespace and preserves idempotency', async () => {
  const { gateway, a, b } = await createGatewayPair();
  a.submit('retry', { permission_granted: true });
  await waitFor(() => a.getSnapshot().tasks[0]?.status === 'READY', 'A did not settle');
  const body = gateway.requests[0];
  const retry = await gateway.http('http://localhost/api/ai/m3', {
    method: 'POST', headers: {}, body: JSON.stringify(body), credentials: 'include',
    redirect: 'error', signal: new AbortController().signal,
  });
  assert.equal(retry.ok, true);
  assert.equal((await retry.json()).requestId, body.requestId);
  assert.equal(a.getSnapshot().session_id, body.sessionId);
  a.stop(); b.stop();
});

test('18 same request ID with changed body retains M3 idempotency conflict semantics', async () => {
  const { gateway, a, b } = await createGatewayPair();
  a.submit('original', { permission_granted: true });
  await waitFor(() => a.getSnapshot().tasks[0]?.status === 'READY', 'A did not settle');
  const body = gateway.requests[0];
  const changed = { ...body, input: { ...body.input, current_text: 'changed body' } };
  const conflict = await gateway.http('http://localhost/api/ai/m3', {
    method: 'POST', headers: {}, body: JSON.stringify(changed), credentials: 'include',
    redirect: 'error', signal: new AbortController().signal,
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'M3_IDEMPOTENCY_CONFLICT');
  a.stop(); b.stop();
});

test('19 same source text never determines or merges the namespace', async () => {
  const { a, b } = await createGatewayPair();
  const taskA = a.submit('exactly the same text', { permission_granted: false });
  const taskB = b.submit('exactly the same text', { permission_granted: false });
  assert.notEqual(a.getSnapshot().session_id, b.getSnapshot().session_id);
  assert.notEqual(taskA, taskB);
  a.stop(); b.stop();
});

test('20 production files keep local authority, wire schema, server policy and persistence out of scope', () => {
  const store = readFileSync(new URL('../domain/session-task/store.ts', import.meta.url), 'utf8');
  const authority = readFileSync(new URL('../domain/session-task/authority.ts', import.meta.url), 'utf8');
  const handler = readFileSync(new URL('../../api-server/src/ai/m3-operation.ts', import.meta.url), 'utf8');
  const schema = readFileSync(new URL('../../../lib/api-zod/src/m3-contract.ts', import.meta.url), 'utf8');
  assert.match(authority, /WeakMap/u);
  assert.match(handler, /JSON\.stringify\(\[principal, body\.sessionId, body\.taskId\]\)/u);
  assert.match(handler, /JSON\.stringify\(\[principal, body\.requestId\]\)/u);
  assert.doesNotMatch(store, /AsyncStorage|localStorage|secure-store|writeFile/u);
  assert.doesNotMatch(schema, /networkNamespace|correlationNamespace|epochId/u);
});

test('21 verifier uses only local fixtures and does not activate W01 or persistence', () => {
  const walk = readFileSync(new URL('../domain/m6/walk-resource.ts', import.meta.url), 'utf8');
  assert.match(walk, /real_user_activation:\s*false/u);
  assert.equal(networkCalls, 0);
});
