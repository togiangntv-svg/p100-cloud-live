import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createM3IntentGuard } from '../domain/m3-intent.ts';

const base = {
  requestId: 'request-001',
  sessionId: 'session-001',
  sessionRevision: 'session-rev-1',
  taskId: 'task-001',
  taskRevision: 'task-rev-1',
  inputRevision: 'input-rev-1',
};
const understanding = {
  status: 'understood',
  intent: 'continue_current_task',
  confidence: 'high',
  summary: 'Tiếp tục công việc hiện tại.',
  clarificationQuestion: null,
  suggestedActions: ['continue_current_task'],
};
const result = (changes = {}) => ({
  ...base, understanding, usage: { inputTokens: 1, outputTokens: 1 }, ...changes,
});

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
test('current binding applies once', () => {
  const guard = createM3IntentGuard(); guard.begin(base);
  assert.equal(guard.apply(result()).status, 'applied');
  assert.equal(guard.apply(result()).status, 'stale');
});
for (const field of ['sessionId', 'sessionRevision', 'taskId', 'taskRevision', 'inputRevision']) {
  test(`changed ${field} rejects late result`, () => {
    const guard = createM3IntentGuard(); guard.begin({ ...base, [field]: `${field}-new` });
    assert.equal(guard.apply(result()).status, 'stale');
  });
}
test('user correction creates new input revision and retires old result', () => {
  const guard = createM3IntentGuard(); guard.begin(base);
  guard.begin({ ...base, requestId: 'request-002', inputRevision: 'input-rev-2' });
  assert.equal(guard.apply(result()).status, 'stale');
});
test('cancel rejects late result', () => {
  const guard = createM3IntentGuard(); guard.begin(base); guard.cancel(base.requestId);
  assert.equal(guard.apply(result()).status, 'cancelled');
});
test('task switch invalidation rejects late result', () => {
  const guard = createM3IntentGuard(); guard.begin(base); guard.invalidate();
  assert.equal(guard.apply(result()).status, 'stale');
});
test('guard has no persistence or goal/task mutation API', () => {
  const guard = createM3IntentGuard();
  assert.deepEqual(Object.keys(guard).sort(), ['apply', 'begin', 'cancel', 'invalidate', 'isCurrent']);
});
test('server route uses dedicated purpose and exactly-one provider attempt', async () => {
  // Git may check out CRLF on Windows. Inspect the same source and assertions
  // on both platforms without changing the route or its line endings on disk.
  const route = (await readFile(new URL('../../api-server/src/routes/ai.ts', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const provider = await readFile(new URL('../../api-server/src/ai/provider.ts', import.meta.url), 'utf8');
  assert.match(route, /router\.post\("\/ai\/intent"/u);
  assert.match(route, /callIntentOnce/u);
  const start = route.indexOf('async function callIntentOnce');
  const end = route.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(route.slice(start, end), /while\s*\(/u);
  assert.match(route, /internal_intent_understanding/u);
  assert.match(provider, /human_development_intent_understanding/u);
  assert.match(provider, /maxRetries:\s*0/u);
});
test('coaching route and provider remain separate', async () => {
  const route = await readFile(new URL('../../api-server/src/routes/ai.ts', import.meta.url), 'utf8');
  assert.match(route, /router\.post\("\/ai\/respond"/u);
  assert.match(route, /internal_coaching_response/u);
  assert.match(route, /callWithLimits/u);
});

for (const [name, fn] of tests) {
  await fn();
  console.log(`PASS ${name}`);
}
console.log(`M3 IntentResolver contract: ${tests.length}/${tests.length} PASS`);
