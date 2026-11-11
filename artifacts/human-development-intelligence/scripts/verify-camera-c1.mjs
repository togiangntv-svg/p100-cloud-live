import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !extname(specifier)) {
      return nextResolve(specifier + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls += 1;
  throw new Error('NETWORK_FORBIDDEN_IN_CAMERA_C1_TEST');
};

const at = path => new URL(path, import.meta.url);
const read = path => readFile(at(path), 'utf8');
const normalizeSourceForFingerprint = source => source.replace(/\r\n/g, '\n');
const sha256 = value => createHash('sha256').update(value).digest('hex').toUpperCase();
const {
  createCameraM4ContextStore,
  mayOfferCameraForM4,
} = await import(at('../domain/camera/m4-context.ts'));
const c1Source = await read('../domain/camera/m4-context.ts');
const resolverSource = await read('../domain/m4/resolver.ts');
const m5Source = await read('../domain/m5/meal-image-decision.ts');
const packageSource = await read('../package.json');

const scopeA = Object.freeze({ session_id: 'session-a', task_id: 'task-a', revision: 4 });
const scopeA2 = Object.freeze({ session_id: 'session-a', task_id: 'task-a', revision: 5 });
const scopeB = Object.freeze({ session_id: 'session-a', task_id: 'task-b', revision: 1 });
const receipt = (scope, candidateId, uri = 'file:///same-photo.jpg') => Object.freeze({
  ...scope,
  candidate_id: candidateId,
  source: 'CAMERA',
  local_uri: uri,
  choice: 'USE_PHOTO',
});
const task = (scope = scopeA, overrides = {}) => ({
  ...scope,
  source_input: 'Đánh giá ảnh bữa ăn hiện tại.',
  status: 'READY',
  permission_revision: 1,
  permission_granted: true,
  m3_context: {
    locale: 'vi', current_text: 'Đánh giá ảnh bữa ăn hiện tại.', relevant_context: [],
    recent_relevant_turns: [], user_correction: null, safety_signal: 'CLEAR', asking_stopped: false,
  },
  interpretation: {
    intent_type: 'CURRENT_TASK', interpreted_meaning: 'Đánh giá ảnh bữa ăn hiện tại.',
    confidence: 0.9, uncertainty: null, missing_context: [], clarification_needed: false,
    clarification_question: null, safety_state: 'CLEAR', suggested_next_role: 'M4',
    task_kind: 'meal_image_assessment', context_effect: 'NONE', used_context_ids: [],
    response: 'Đã hiểu.',
  },
  ...overrides,
});
const m4 = (scope, decision) => Object.freeze({ scope, decision: Object.freeze(decision) });
const required = scope => m4(scope, { state: 'CONTEXT_REQUIRED', missing: ['meal_image'] });
const tests = [];
const test = (name, body) => tests.push({ name, body });

test('M4-first guard rejects every non-requesting state and mismatched scope', () => {
  const blocked = [
    { state: 'CONTEXT_SUFFICIENT', sufficient_for: 'NEXT_STEP_CONTRACT_ONLY', used_context_ids: [] },
    { state: 'PERMISSION_REQUIRED', item: 'meal_image' },
    { state: 'CONTEXT_DECLINED', alternative: 'TEXT_DESCRIPTION_OPTION', ask_again: false },
    { state: 'DEFERRED', reason: 'TASK_NOT_READY' },
    { state: 'PROFESSIONAL_HANDOFF_NEEDED', reason: 'OUTSIDE_AI_AUTHORITY' },
    { state: 'NEED_CLARIFICATION', next_role: 'M3' },
  ];
  for (const decision of blocked) assert.equal(mayOfferCameraForM4(scopeA, m4(scopeA, decision)), false);
  assert.equal(mayOfferCameraForM4(scopeA, required(scopeB)), false);
  assert.equal(mayOfferCameraForM4(scopeA, m4(scopeA, { state: 'CONTEXT_REQUIRED', missing: [] })), false);
});

test('current exact M4 meal-image requirement enables the camera offer', () => {
  assert.equal(mayOfferCameraForM4(scopeA, required(scopeA)), true);
});

test('one accepted C0 receipt creates one immutable opaque local-only context', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeA);
  const first = store.consume(receipt(scopeA, 'candidate-a'));
  const repeated = store.consume(receipt(scopeA, 'candidate-a'));
  assert.ok(first);
  assert.deepEqual(repeated, first);
  assert.ok(Object.isFrozen(first));
  assert.equal(first.external_readiness, 'LOCAL_ONLY');
  assert.doesNotMatch(first.context_id, /file|same-photo|candidate-a|[\\/]/iu);
  assert.equal(JSON.stringify(first).includes('local_uri'), false);
});

test('M4 projection is immutable and contains no local URI, path, bytes or metadata', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeA);
  store.consume(receipt(scopeA, 'candidate-a'));
  const projection = store.project(scopeA);
  const serialized = JSON.stringify(projection);
  assert.ok(Object.isFrozen(projection));
  assert.equal(serialized.includes('local_uri'), false);
  assert.doesNotMatch(serialized, /same-photo|file:\/\/|base64|bytes|EXIF|provider/iu);
});

test('UNKNOWN permission projects to M4 PERMISSION_REQUIRED', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeA);
  store.consume(receipt(scopeA, 'candidate-a'));
  assert.equal(store.assess(task(), store.project(scopeA)).decision.state, 'PERMISSION_REQUIRED');
});

test('ALLOWED matching permission revision and usable image is sufficient', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeA);
  const ref = store.consume(receipt(scopeA, 'candidate-a'));
  const allowed = store.allow(ref);
  const result = store.assess(task(), store.project(scopeA));
  assert.ok(allowed);
  assert.equal(result.decision.state, 'CONTEXT_SUFFICIENT');
  assert.deepEqual(result.decision.used_context_ids, [allowed.context_id]);
});

test('permission revision mismatch cannot be sufficient', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeA);
  const ref = store.consume(receipt(scopeA, 'candidate-a'));
  store.allow(ref);
  const projection = store.project(scopeA);
  const stale = Object.freeze({
    ...projection,
    image: Object.freeze({ ...projection.image, permission_revision: projection.image.permission_revision - 1 }),
  });
  assert.notEqual(store.assess(task(), stale).decision.state, 'CONTEXT_SUFFICIENT');
});

test('revoke immediately invalidates the previously sufficient projection', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeA);
  const ref = store.consume(receipt(scopeA, 'candidate-a'));
  const allowed = store.allow(ref);
  const prior = store.project(scopeA);
  assert.equal(store.assess(task(), prior).decision.state, 'CONTEXT_SUFFICIENT');
  store.revoke(allowed);
  assert.equal(store.assess(task(), prior).decision.state, 'PERMISSION_REQUIRED');
});

test('DENIED permission fails closed', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeA);
  const ref = store.consume(receipt(scopeA, 'candidate-a'));
  store.deny(ref);
  assert.equal(store.assess(task(), store.project(scopeA)).decision.state, 'PERMISSION_REQUIRED');
});

test('current-task decline produces the existing no-repeat text alternative', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeA);
  store.decline(scopeA);
  assert.deepEqual(store.assess(task(), store.project(scopeA)).decision, {
    state: 'CONTEXT_DECLINED', alternative: 'TEXT_DESCRIPTION_OPTION', ask_again: false,
  });
});

test('task switch retires the old context and grant', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeA);
  const ref = store.consume(receipt(scopeA, 'candidate-a'));
  store.allow(ref);
  store.bind(scopeB);
  assert.equal(store.project(scopeB).image.state, 'absent');
  assert.equal(store.getSnapshot(), undefined);
});

test('revision change retires the old context and grant', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeA);
  const ref = store.consume(receipt(scopeA, 'candidate-a'));
  store.allow(ref);
  store.bind(scopeA2);
  assert.equal(store.project(scopeA2).image.state, 'absent');
  assert.equal(store.getSnapshot(), undefined);
});

test('stale scope reads cannot retire authority for the newer current task', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeB);
  const refB = store.consume(receipt(scopeB, 'candidate-b'));
  const allowedB = store.allow(refB);
  assert.equal(store.project(scopeA).image.state, 'absent');
  assert.equal(store.getSnapshot().context_id, allowedB.context_id);
  assert.equal(store.assess(task(scopeB), store.project(scopeB)).decision.state, 'CONTEXT_SUFFICIENT');
});

test('stale consume cannot rebind from current task B back to task A', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeA);
  const refA = store.consume(receipt(scopeA, 'candidate-a'));
  store.allow(refA);
  store.bind(scopeB);
  const refB = store.consume(receipt(scopeB, 'candidate-b'));
  const allowedB = store.allow(refB);
  const projectionB = store.project(scopeB);
  assert.equal(store.assess(task(scopeB), projectionB).decision.state, 'CONTEXT_SUFFICIENT');
  assert.equal(store.consume(receipt(scopeA, 'candidate-a-late')), undefined);
  assert.equal(store.getSnapshot().context_id, allowedB.context_id);
  assert.equal(store.getSnapshot().permission_revision, allowedB.permission_revision);
  assert.deepEqual(store.project(scopeB), projectionB);
  assert.equal(store.assess(task(scopeB), projectionB).decision.state, 'CONTEXT_SUFFICIENT');
});

test('stale decline cannot rebind from current task B back to task A', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeA);
  const refA = store.consume(receipt(scopeA, 'candidate-a'));
  store.allow(refA);
  store.bind(scopeB);
  const refB = store.consume(receipt(scopeB, 'candidate-b'));
  const allowedB = store.allow(refB);
  const projectionB = store.project(scopeB);
  assert.equal(store.decline(scopeA), false);
  assert.equal(store.getSnapshot().context_id, allowedB.context_id);
  assert.deepEqual(store.project(scopeB), projectionB);
  assert.equal(store.assess(task(scopeB), projectionB).decision.state, 'CONTEXT_SUFFICIENT');
});

test('consume and decline before initial bind fail closed without authority', () => {
  const store = createCameraM4ContextStore();
  assert.equal(store.consume(receipt(scopeA, 'candidate-a')), undefined);
  assert.equal(store.decline(scopeA), false);
  assert.equal(store.getSnapshot(), undefined);
  assert.equal(store.project(scopeA).image.state, 'absent');
});

test('candidate replacement retires the old grant and creates new authority', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeA);
  const oldRef = store.consume(receipt(scopeA, 'candidate-a'));
  store.allow(oldRef);
  const oldProjection = store.project(scopeA);
  const replacement = store.consume(receipt(scopeA, 'candidate-b'));
  assert.notEqual(replacement.context_id, oldRef.context_id);
  assert.equal(store.project(scopeA).permission.status, 'unknown');
  assert.notEqual(store.assess(task(), oldProjection).decision.state, 'CONTEXT_SUFFICIENT');
});

test('cancel or explicit retire leaves no reusable image context', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeA);
  const ref = store.consume(receipt(scopeA, 'candidate-a'));
  store.allow(ref);
  store.retire();
  assert.equal(store.getSnapshot(), undefined);
  assert.equal(store.project(scopeA).image.state, 'absent');
});

test('same URI in a later task gets a new id and independent permission lifecycle', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeA);
  const refA = store.consume(receipt(scopeA, 'candidate-a'));
  store.allow(refA);
  const projectionA = store.project(scopeA);
  store.bind(scopeB);
  const refB = store.consume(receipt(scopeB, 'candidate-b'));
  assert.notEqual(refB.context_id, refA.context_id);
  assert.equal(store.project(scopeB).permission.status, 'unknown');
  assert.notEqual(store.assess(task(scopeB), projectionA).decision.state, 'CONTEXT_SUFFICIENT');
});

test('external readiness remains LOCAL_ONLY with no sanitization claim', () => {
  const store = createCameraM4ContextStore();
  store.bind(scopeA);
  const ref = store.consume(receipt(scopeA, 'candidate-a'));
  assert.equal(ref.external_readiness, 'LOCAL_ONLY');
  assert.doesNotMatch(c1Source, /EXIF_STRIPPED|SANITIZED|EXTERNAL_READY|PROVIDER_READY/u);
});

test('C1 has no network, provider, persistence, storage, base64 or analytics path', () => {
  assert.doesNotMatch(c1Source,
    /fetch\s*\(|axios|OpenAI|provider payload|AsyncStorage|SQLite|database|server|base64|analytics/iu);
  assert.equal(networkCalls, 0);
});

test('source fingerprints are portable across line endings and reject content changes', () => {
  const lf = 'same semantic source\nwith two lines\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(sha256(normalizeSourceForFingerprint(lf)),
    sha256(normalizeSourceForFingerprint(crlf)));
  assert.notEqual(sha256(normalizeSourceForFingerprint(lf)),
    sha256(normalizeSourceForFingerprint(lf + 'substantive change\n')));
});

test('package preserves approved Camera C2 P1 dependency while M4 and M5 remain protected', () => {
  const packageManifest = JSON.parse(packageSource);
  assert.ok(packageManifest.dependencies && typeof packageManifest.dependencies === 'object');
  assert.equal(packageManifest.dependencies['expo-image-manipulator'], '~57.0.19');
  assert.equal(sha256(normalizeSourceForFingerprint(resolverSource)), '2571B5652D38FC0132EA392E74E73608EE39ACFCDE9F7899B95AC87BEF3DF578');
  assert.equal(sha256(normalizeSourceForFingerprint(m5Source)), 'C1D308CFC43A807C6DBB3D21B16055F5A7D9483AD488355D1F71842C290DB207');
  assert.match(m5Source, /meal_image_assessment: "NOT_AVAILABLE"/u);
  assert.doesNotMatch(m5Source, /meal_image_assessment: "AVAILABLE"/u);
});

for (const { name, body } of tests) {
  await body();
  console.log('PASS ' + name);
}
assert.equal(networkCalls, 0);
console.log('Camera C1: ' + tests.length + '/' + tests.length
  + ' PASS; provider/network/persistence calls = 0; device runtime = NOT_RUN.');
