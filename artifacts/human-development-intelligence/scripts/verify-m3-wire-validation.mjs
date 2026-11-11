import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { after, test } from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@workspace/api-client-react') {
      return {
        url: 'data:text/javascript,export const aiM3=()=>{throw Error("CLIENT_FORBIDDEN")};export const aiM3Permission=aiM3',
        shortCircuit: true,
      };
    }
    return nextResolve(specifier.startsWith('.') && (!extname(specifier) || specifier.endsWith('/api.schemas'))
      ? specifier + '.ts' : specifier, context);
  },
});

let networkCalls = 0;
globalThis.fetch = () => { networkCalls += 1; throw new Error('NETWORK_FORBIDDEN_IN_M3_WIRE_TEST'); };

const { readM3Response } = await import('../../../lib/api-zod/src/m3-contract.ts');
const { createM3GatewayAdapter } = await import('../domain/m3/gateway-adapter.ts');

const input = (changes = {}) => ({
  locale: 'vi', current_text: 'Tôi muốn tiếp tục', relevant_context: [], recent_relevant_turns: [],
  user_correction: null, safety_signal: 'CLEAR', asking_stopped: false, ...changes,
});
const ticket = Object.freeze({
  session_id: 'session-1', task_id: 'task-1', task_revision: 1,
  permission_revision: 2, operation_id: 'operation-1',
});
const operation = (changes = {}) => ({
  ticket, permission: { external_access: 'M3_TEXT', purpose: 'm3_intent_understanding', revision: 2 },
  isCurrent: () => true, ...changes,
});
const wire = (body, changes = {}) => ({
  version: body.version, requestId: body.requestId, sessionId: body.sessionId, taskId: body.taskId,
  taskRevision: body.taskRevision, permissionRevision: body.permissionRevision,
  intentType: 'CURRENT_TASK', interpretedMeaning: 'The user wants to continue', confidence: 0.9,
  uncertainty: null, missingContext: [], clarificationNeeded: false, clarificationQuestion: null,
  safetyState: 'CLEAR', suggestedNextRole: 'M4', taskKind: null, contextEffect: 'NONE',
  usedContextIds: [], response: 'I understand the request.', usage: { inputTokens: 1, outputTokens: 1 },
  ...changes,
});

function deferred() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return { promise, resolve };
}

function harness({ content = input(), wireChanges = {}, current = () => true, op = operation() } = {}) {
  let request;
  let permissionRequest;
  let response;
  let httpCalls = 0;
  let authorizationCalls = 0;
  const adapter = createM3GatewayAdapter({
    origin: 'https://m3-wire.invalid', provenance: 'TEST_FIXTURE', isSessionCurrent: current,
    authorization: Object.freeze({
      async withBearer(signal, use) {
        authorizationCalls += 1;
        assert.equal(signal.aborted, false);
        return use('Bearer fixture-identity-token');
      },
    }),
    async http(url, init) {
      httpCalls += 1;
      assert.equal(init.headers.Authorization, 'Bearer fixture-identity-token');
      if (url.endsWith('/api/ai/m3/permission')) {
        permissionRequest = JSON.parse(init.body);
        const grant = {
          version: permissionRequest.version,
          action: 'GRANT',
          purpose: permissionRequest.purpose,
          operationId: permissionRequest.operationId,
          grantId: 'server-grant-0001',
          taskSessionId: permissionRequest.taskSessionId,
          taskId: permissionRequest.taskId,
          taskRevision: permissionRequest.taskRevision,
          permissionRevision: permissionRequest.permissionRevision,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
        return { ok: true, status: 200, async json() { return grant; } };
      }
      request = JSON.parse(init.body);
      response = wire(request, typeof wireChanges === 'function' ? wireChanges(request) : wireChanges);
      return { ok: true, status: 200, async json() { return response; } };
    },
  });
  return {
    run: () => adapter.interpret({ content, operation: op }, new AbortController().signal),
    capture: () => ({ request, permissionRequest, response, httpCalls, authorizationCalls }),
  };
}

const safety = (meaning, state) => {
  assert.equal(meaning.safety_state, state);
  assert.equal(meaning.intent_type, 'SAFETY');
  assert.equal(meaning.suggested_next_role, 'STOP');
};

test('RED: real gateway raises current VI chest pain despite CLEAR wire', async () => {
  const h = harness({ content: input({ current_text: 'Tôi đang đau ngực' }) });
  safety(await h.run(), 'URGENT');
});
test('RED: wire rejects hidden missing context without clarification', async () => {
  const h = harness({ wireChanges: { missingContext: ['More context is needed'] } });
  await assert.rejects(h.run(), /M3_RESPONSE_INVALID/u);
  const { request, response } = h.capture();
  assert.throws(() => readM3Response(response, request), /M3_RESPONSE_INVALID/u);
});
test('RED: wire rejects ADJUST_CURRENT with other context only', async () => {
  const h = harness({
    content: input({ relevant_context: [{ id: 'other-1', kind: 'other', text: 'Prior outcome' }] }),
    wireChanges: { contextEffect: 'ADJUST_CURRENT', usedContextIds: ['other-1'] },
  });
  await assert.rejects(h.run(), /M3_RESPONSE_INVALID/u);
  const { request, response } = h.capture();
  assert.throws(() => readM3Response(response, request), /M3_RESPONSE_INVALID/u);
});
test('real gateway raises current EN chest pain despite CLEAR wire', async () => {
  const h = harness({ content: input({ locale: 'en', current_text: 'I have chest pain while walking' }) });
  safety(await h.run(), 'URGENT');
});
test('host URGENT cannot be downgraded by benign text and CLEAR wire', async () => {
  const h = harness({ content: input({ current_text: 'Tôi muốn tiếp tục', safety_signal: 'URGENT' }) });
  safety(await h.run(), 'URGENT');
});
test('host PAIN cannot be downgraded by CLEAR wire', async () => {
  const h = harness({ content: input({ current_text: 'Tôi muốn tiếp tục', safety_signal: 'PAIN' }) });
  safety(await h.run(), 'PAIN');
});
for (const [name, currentText] of [
  ['hypothetical', 'What if I have chest pain while walking'],
  ['third party', 'My friend passed out while walking'],
  ['historical', 'Last year I passed out while walking'],
  ['negated', 'I do not have chest pain while walking'],
]) {
  test(`${name} EN text does not create a false safety floor`, async () => {
    const h = harness({ content: input({ locale: 'en', current_text: currentText }) });
    const meaning = await h.run();
    assert.equal(meaning.safety_state, 'CLEAR');
    assert.equal(meaning.suggested_next_role, 'M4');
  });
}
test('provider may raise a CLEAR floor', async () => {
  const h = harness({ wireChanges: { safetyState: 'PAIN' } });
  safety(await h.run(), 'PAIN');
});
test('response scope mismatch remains rejected', async () => {
  const h = harness({ wireChanges: { taskId: 'wrong-task' } });
  await assert.rejects(h.run(), /M3_RESPONSE_SCOPE_MISMATCH/u);
});
test('ADJUST_CURRENT with projected workout context is accepted', async () => {
  const h = harness({
    content: input({ relevant_context: [{ id: 'workout-1', kind: 'active_task:workout', text: 'Current workout' }] }),
    wireChanges: { contextEffect: 'ADJUST_CURRENT', usedContextIds: ['workout-1'] },
  });
  assert.equal((await h.run()).context_effect, 'ADJUST_CURRENT');
  assert.equal(h.capture().request.input.relevant_context[0].kind, 'workout');
  assert.equal(h.capture().permissionRequest.action, 'GRANT');
  assert.equal(h.capture().request.grantId, 'server-grant-0001');
  assert.equal(h.capture().httpCalls, 2);
  assert.equal(h.capture().authorizationCalls, 2);
});
test('stale task and revoked M3 permission cannot reach HTTP', async () => {
  const stale = harness({ op: operation({ isCurrent: () => false }) });
  await assert.rejects(stale.run(), /M3_STALE_SCOPE/u);
  assert.equal(stale.capture().httpCalls, 0);
  const revoked = harness({ op: operation({ permission: { external_access: 'M3_TEXT', purpose: 'm3_intent_understanding', revision: 3 } }) });
  await assert.rejects(revoked.run(), /M3_PERMISSION_DENIED/u);
  assert.equal(revoked.capture().httpCalls, 0);
});
test('REVOKE during a pending GRANT prevents late grant success and M3 send', async () => {
  const pendingGrant = deferred();
  const requests = [];
  const adapter = createM3GatewayAdapter({
    origin: 'https://m3-wire.invalid', provenance: 'TEST_FIXTURE', isSessionCurrent: () => true,
    authorization: Object.freeze({ async withBearer(_signal, use) { return use('Bearer bounded'); } }),
    async http(url, init) {
      const body = JSON.parse(init.body);
      requests.push([url, body]);
      assert.ok(url.endsWith('/api/ai/m3/permission'), 'late grant must not reach /api/ai/m3');
      if (body.action === 'REVOKE') {
        return { ok: true, status: 200, async json() {
          return {
            version: body.version, action: 'REVOKE', purpose: body.purpose,
            operationId: body.operationId, grantOperationId: body.grantOperationId,
            taskSessionId: body.taskSessionId, taskId: body.taskId,
            taskRevision: body.taskRevision, permissionRevision: body.permissionRevision,
            revoked: true,
          };
        } };
      }
      return { ok: true, status: 200, async json() { return pendingGrant.promise; } };
    },
  });
  const interpret = adapter.interpret({ content: input(), operation: operation() }, new AbortController().signal);
  await new Promise(resolve => setImmediate(resolve));
  await adapter.revoke({
    ticket: { ...ticket, operation_id: 'revoke-operation-1', task_revision: 2, permission_revision: 3 },
    permission: { revision: 3 },
  });
  pendingGrant.resolve({
    version: 'm3.v1', action: 'GRANT', purpose: 'm3_intent_understanding',
    operationId: ticket.operation_id, grantId: 'server-grant-late',
    taskSessionId: ticket.session_id, taskId: ticket.task_id,
    taskRevision: ticket.task_revision, permissionRevision: ticket.permission_revision,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await assert.rejects(interpret, /M3_STALE_SCOPE/u);
  assert.deepEqual(requests.map(([, body]) => body.action), ['GRANT', 'REVOKE']);
});
test('M7 prior context remains bounded other and cannot authorize ADJUST_CURRENT', async () => {
  const h = harness({
    content: input({ relevant_context: [{ id: 'private-episode-1', kind: 'prior_episode:m7_outcome', text: 'PARTIAL_OUTCOME' }] }),
    wireChanges: (body) => ({ contextEffect: 'ADJUST_CURRENT', usedContextIds: [body.input.relevant_context[0].id] }),
  });
  await assert.rejects(h.run(), /M3_RESPONSE_INVALID/u);
  const { request } = h.capture();
  assert.deepEqual(request.input.relevant_context, [{
    id: 'm7-prior:partial-outcome', kind: 'other', text: 'PARTIAL_OUTCOME', permission: 'external_ai_allowed',
  }]);
});

after(() => assert.equal(networkCalls, 0, 'No live provider or network calls'));
