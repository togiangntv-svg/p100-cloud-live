import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && (!extname(specifier) || specifier.endsWith('/api.schemas'))) {
      return nextResolve(specifier + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls += 1;
  throw new Error('NETWORK_FORBIDDEN_IN_M3_HOST_PERMISSION_TEST');
};

const { resolveM3HostPermission } = await import('../domain/m3/host-permission.ts');
const { createM3GatewayAdapter } = await import('../domain/m3/gateway-adapter.ts');
const { createM3StubAdapter } = await import('../domain/m3/stub-adapter.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const { presentM4StubDecision, projectM4StubContext } = await import('../domain/m4/ui-stub.ts');

const wait = () => new Promise((resolve) => setTimeout(resolve, 5));
const deniedAccess = Object.freeze({ status: 'denied', revision: 1 });
const allowedAccess = Object.freeze({ status: 'allowed', revision: 2 });
const stubAdapter = createM3StubAdapter(0);

// T02/T17: constructing the production adapter (render/login/task start) and
// locale-only host state cannot mint a grant. GRANT exists only in interpret.
let constructionHttpCalls = 0;
let constructionAuthorizationCalls = 0;
createM3GatewayAdapter({
  origin: 'https://m3-construction.invalid',
  isSessionCurrent: () => true,
  authorization: Object.freeze({
    async withBearer(_signal, use) {
      constructionAuthorizationCalls += 1;
      return use('Bearer never-used-construction-token');
    },
  }),
  async http() {
    constructionHttpCalls += 1;
    throw new Error('CONSTRUCTION_MUST_NOT_SEND');
  },
});
assert.equal(constructionHttpCalls, 0);
assert.equal(constructionAuthorizationCalls, 0);
const gatewaySource = await readFile(new URL('../domain/m3/gateway-adapter.ts', import.meta.url), 'utf8');
const hostSource = await readFile(new URL('../components/useM2Gateway.ts', import.meta.url), 'utf8');
assert.ok(gatewaySource.indexOf('action: "GRANT"') > gatewaySource.indexOf('async interpret'));
assert.doesNotMatch(gatewaySource, /\/api\/ai\/session["']/u);
assert.doesNotMatch(hostSource, /aiM3Permission|action:\s*["']GRANT/u);

// A: ON_DEVICE simulation routes through SessionTask and M4 without borrowing
// the external-AI permission state.
const stubPermission = resolveM3HostPermission(stubAdapter, deniedAccess);
assert.deepEqual(stubPermission, {
  mode: 'stub',
  taskPermissionGranted: true,
  permissionRevision: undefined,
  showExternalPermissionNotice: false,
});
const stubStore = createSessionTaskStore({ adapter: stubAdapter, now: () => 100 });
stubStore.start();
const taskAId = stubStore.submit('Tôi cần đánh giá bữa ăn bằng hình ảnh.', {
  locale: 'vi',
  permission_granted: stubPermission.taskPermissionGranted,
  permission_revision: stubPermission.permissionRevision,
});
await wait();
const taskA = stubStore.getSnapshot().tasks.find((task) => task.task_id === taskAId);
const taskARef = stubStore.reference(taskAId);
assert.equal(taskA?.status, 'READY');
assert.ok(taskARef);
const taskAPrimary = presentM4StubDecision(stubStore.assessM4(
  taskARef,
  projectM4StubContext({
    session_id: taskARef.session_id,
    task_id: taskARef.task_id,
    revision: taskARef.revision,
  }, 'absent'),
).decision, 'vi');
assert.equal(taskAPrimary, 'Mình đã ghi nhận yêu cầu này.');
assert.equal(networkCalls, 0);

let liveCalls = 0;
let revokeCalls = 0;
const liveMeaning = Object.freeze({
  intent_type: 'CURRENT_TASK',
  interpreted_meaning: 'Mocked live boundary',
  confidence: 0.8,
  uncertainty: null,
  missing_context: Object.freeze([]),
  clarification_needed: false,
  clarification_question: null,
  safety_state: 'CLEAR',
  suggested_next_role: 'M4',
  task_kind: 'meal_image_assessment',
  context_effect: 'NONE',
  used_context_ids: Object.freeze([]),
  response: 'Mocked live response',
});
const liveAdapter = Object.freeze({
  provenance: 'TEST_FIXTURE',
  processing: 'EXTERNAL',
  contract: 'M3_GATEWAY_V1',
  async interpret() {
    liveCalls += 1;
    return liveMeaning;
  },
  async revoke() { revokeCalls += 1; },
});
const liveStore = createSessionTaskStore({ adapter: liveAdapter, now: () => 200 });
liveStore.start();

// B: denied live consent fails closed before the adapter boundary.
const liveDenied = resolveM3HostPermission(liveAdapter, deniedAccess);
assert.equal(liveDenied.mode, 'live');
assert.equal(liveDenied.taskPermissionGranted, false);
assert.equal(liveDenied.showExternalPermissionNotice, true);
const deniedId = liveStore.submit('live denied', {
  permission_granted: liveDenied.taskPermissionGranted,
  permission_revision: liveDenied.permissionRevision,
});
await wait();
assert.equal(liveCalls, 0);
assert.equal(liveStore.getSnapshot().tasks.find((task) => task.task_id === deniedId)?.status, 'UNSUPPORTED');

// C: allowed consent reaches a mocked adapter boundary; fetch remains blocked.
const liveAllowed = resolveM3HostPermission(liveAdapter, allowedAccess);
assert.equal(liveAllowed.taskPermissionGranted, true);
assert.equal(liveAllowed.showExternalPermissionNotice, false);
const allowedId = liveStore.submit('live allowed', {
  permission_granted: liveAllowed.taskPermissionGranted,
  permission_revision: liveAllowed.permissionRevision,
});
await wait();
assert.equal(liveCalls, 1);
assert.equal(liveStore.getSnapshot().tasks.find((task) => task.task_id === allowedId)?.status, 'READY');
assert.equal(networkCalls, 0);

// D: revocation stops subsequent live routing while the local fixture remains
// independently runnable under the same denied external-access state.
const allowedRef = liveStore.reference(allowedId);
assert.ok(allowedRef);
assert.equal(await liveStore.revoke(allowedRef), true);
assert.equal(revokeCalls, 1);
const callsBeforeRevokedSubmit = liveCalls;
const revokedPermission = resolveM3HostPermission(liveAdapter, { status: 'denied', revision: 3 });
liveStore.submit('live after revoke', {
  permission_granted: revokedPermission.taskPermissionGranted,
  permission_revision: revokedPermission.permissionRevision,
});
await wait();
assert.equal(liveCalls, callsBeforeRevokedSubmit);
const localAfterRevoke = resolveM3HostPermission(stubAdapter, { status: 'denied', revision: 3 });
assert.equal(localAfterRevoke.taskPermissionGranted, true);
const localAfterRevokeId = stubStore.submit('Tôi cần đánh giá bữa ăn bằng hình ảnh.', {
  locale: 'vi',
  permission_granted: localAfterRevoke.taskPermissionGranted,
  permission_revision: localAfterRevoke.permissionRevision,
});
await wait();
assert.equal(stubStore.getSnapshot().tasks.find((task) => task.task_id === localAfterRevokeId)?.status, 'READY');

// E: a denied live task cannot create a fallback for the independent local
// task, whose scoped M4 presentation remains unchanged.
assert.equal(taskAPrimary, 'Mình đã ghi nhận yêu cầu này.');
assert.equal(stubStore.getSnapshot().tasks.find((task) => task.task_id === taskAId)?.status, 'READY');
const taskAReturnRef = stubStore.reference(taskAId);
assert.ok(taskAReturnRef);
assert.equal(stubStore.switchTask(taskAReturnRef), true);
const taskAActiveRef = stubStore.reference(taskAId);
assert.ok(taskAActiveRef);
const taskAReturnedPrimary = presentM4StubDecision(stubStore.assessM4(
  taskAActiveRef,
  projectM4StubContext({
    session_id: taskAActiveRef.session_id,
    task_id: taskAActiveRef.task_id,
    revision: taskAActiveRef.revision,
  }, 'absent'),
).decision, 'vi');
assert.equal(taskAReturnedPrimary, taskAPrimary);
assert.equal(networkCalls, 0);

liveStore.stop();
stubStore.stop();
console.log('M3 host permission cases A-E: PASS');
console.log('Real network/provider calls: 0');
