import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls += 1;
  throw new Error('NETWORK_FORBIDDEN_IN_CAMERA_C2_OFFLINE');
};

const at = path => new URL(path, import.meta.url);
const read = path => readFile(at(path), 'utf8');
const normalizeSourceForFingerprint = source => source.replace(/\r\n/g, '\n');
const sha256 = value => createHash('sha256').update(value).digest('hex').toUpperCase();
const {
  createMealExternalConsentStore,
  runMealVisionOfflineFixture,
  validateMealVisionOutput,
} = await import(at('../domain/camera/meal-vision.ts'));
const source = await read('../domain/camera/meal-vision.ts');
const packageSource = await read('../package.json');
const m4Source = await read('../domain/m4/resolver.ts');
const m5Source = await read('../domain/m5/meal-image-decision.ts');

const scopeA = Object.freeze({ session_id: 'session-a', task_id: 'task-a', revision: 4 });
const scopeB = Object.freeze({ session_id: 'session-a', task_id: 'task-b', revision: 1 });
const context = (scope = scopeA, patch = {}) => Object.freeze({
  ...scope,
  context_id: 'camera-c1-context-a',
  candidate_id: 'camera-candidate-a',
  permission_revision: 2,
  external_readiness: 'LOCAL_ONLY',
  ...patch,
});
const prepared = (ref, state = 'EXTERNAL_READY') => state === 'EXTERNAL_READY'
  ? Object.freeze({
      session_id: ref.session_id, task_id: ref.task_id, revision: ref.revision,
      candidate_id: ref.candidate_id, context_id: ref.context_id,
      state, prepared_image_id: 'synthetic-prepared-meal-a',
      readiness_basis: 'SYNTHETIC_TEST_FIXTURE',
    })
  : Object.freeze({
      session_id: ref.session_id, task_id: ref.task_id, revision: ref.revision,
      candidate_id: ref.candidate_id, context_id: ref.context_id, state: 'LOCAL_ONLY',
    });
const currentC1 = (ref, status = 'allowed', patch = {}) => Object.freeze({
  scope: Object.freeze({ session_id: ref.session_id, task_id: ref.task_id, revision: ref.revision }),
  image: Object.freeze({
    state: 'present', id: ref.context_id, usable: true,
    permission_revision: ref.permission_revision,
  }),
  permission: Object.freeze({
    purpose: 'meal_image_assessment', status, revision: ref.permission_revision,
  }),
  boundary: 'within_slice',
  ...patch,
});
const request = (ref, consent, image = prepared(ref), patch = {}) => Object.freeze({
  scope: Object.freeze({ session_id: ref.session_id, task_id: ref.task_id, revision: ref.revision }),
  context_id: ref.context_id,
  candidate_id: ref.candidate_id,
  consent,
  prepared_image: image,
  current_c1: currentC1(ref),
  purpose: 'meal_image_assessment',
  locale: 'vi',
  ...patch,
});
const visible = Object.freeze({
  state: 'VISIBLE_MEAL_CONTEXT',
  visible_items: ['cơm', 'rau xanh', 'món đạm'],
  qualitative_observations: ['Có nhiều nhóm thực phẩm nhìn thấy được'],
  uncertainty: 'MEDIUM',
  evidence_limitations: ['Không thể xác định khối lượng hay dinh dưỡng chính xác chỉ từ ảnh'],
});
const tests = [];
const test = (name, body) => tests.push({ name, body });

test('C0 USE_PHOTO and C1 allowed do not create external consent', () => {
  const store = createMealExternalConsentStore();
  assert.equal(store.getCurrent(), undefined);
  assert.equal(store.allow(context()), undefined);
});

test('external consent is explicit, purpose-specific, positive-revision and exact-bound', () => {
  const store = createMealExternalConsentStore();
  const ref = context();
  assert.equal(store.bind(ref), true);
  const consent = store.allow(ref);
  assert.ok(consent.consent_revision > 0);
  assert.equal(consent.revision, ref.revision);
  assert.equal(consent.c1_permission_revision, ref.permission_revision);
  assert.equal(consent.purpose, 'MEAL_IMAGE_EXTERNAL_ANALYSIS');
  assert.equal(store.isCurrent(consent), true);
  assert.equal(store.allow(context(scopeB)), undefined);
});

test('revoked and retired consent fail closed', () => {
  const store = createMealExternalConsentStore();
  const ref = context(); store.bind(ref);
  const consent = store.allow(ref);
  assert.equal(store.revoke(consent), true);
  assert.equal(store.isCurrent(consent), false);
  const renewed = store.allow(ref);
  store.retire();
  assert.equal(store.isCurrent(renewed), false);
});

test('clear simple meal yields bounded visible meal context', () => {
  assert.deepEqual(validateMealVisionOutput(visible), visible);
});

test('every accepted state requires its exact top-level schema', () => {
  const accepted = [
    visible,
    {
      state: 'NEED_MORE_INFO', reason: 'MISSING_DETAIL',
      missing_detail_request: 'Món này có thêm thành phần nào bị che khuất không?',
    },
    { state: 'OUTSIDE_SCOPE', reason: 'NON_MEAL_IMAGE' },
    { state: 'UNSAFE', reason: 'MEDICAL_OR_IDENTITY_INFERENCE' },
  ];
  for (const fixture of accepted) {
    assert.equal(validateMealVisionOutput(fixture).state, fixture.state);
  }
});

test('valid-looking outputs with hidden extra fields fail closed', () => {
  const cases = [
    { ...visible, exact_calories: 742 },
    { ...visible, exact_grams: 240 },
    { ...visible, macros: { protein: 38.4 } },
    { ...visible, person_name: 'Alex' },
    { ...visible, identity_hint: 'possible returning user' },
    {
      state: 'NEED_MORE_INFO', reason: 'MISSING_DETAIL',
      missing_detail_request: 'Món này có thành phần nào bị che khuất không?',
      task_id: 'foreign-task',
    },
    { state: 'OUTSIDE_SCOPE', reason: 'NON_MEAL_IMAGE', context_id: 'foreign-context' },
    { state: 'UNSAFE', reason: 'MEDICAL_OR_IDENTITY_INFERENCE', metadata: { arbitrary: true } },
  ];
  for (const fixture of cases) {
    assert.deepEqual(validateMealVisionOutput(fixture), {
      state: 'INVALID_PROVIDER_OUTPUT', reason: 'MALFORMED_OUTPUT',
    });
  }
});

test('ambiguous mixed meal asks for one bounded detail', () => {
  const result = validateMealVisionOutput({
    state: 'NEED_MORE_INFO', reason: 'AMBIGUOUS_MIXED_MEAL',
    missing_detail_request: 'Món trộn này gồm những thành phần chính nào?',
  });
  assert.equal(result.state, 'NEED_MORE_INFO');
  assert.equal(result.reason, 'AMBIGUOUS_MIXED_MEAL');
});

test('occluded or low-quality image asks for more information', () => {
  for (const reason of ['OCCLUDED', 'LOW_QUALITY']) {
    const result = validateMealVisionOutput({
      state: 'NEED_MORE_INFO', reason,
      missing_detail_request: 'Vui lòng cung cấp ảnh rõ hơn của toàn bộ bữa ăn.',
    });
    assert.equal(result.state, 'NEED_MORE_INFO');
  }
});

test('exact calories and exact grams from pixels are rejected', () => {
  for (const claim of ['742 kcal exactly', 'protein 38.4g exactly', 'portion weight 240 grams']) {
    const result = validateMealVisionOutput({ ...visible, qualitative_observations: [claim] });
    assert.deepEqual(result, {
      state: 'INVALID_PROVIDER_OUTPUT', reason: 'FORBIDDEN_PIXEL_ONLY_CLAIM',
    });
  }
});

test('medical diagnosis, treatment and disease risk claims are rejected', () => {
  for (const claim of ['diagnosis: diabetes', 'treatment is required', 'disease risk is high']) {
    assert.equal(validateMealVisionOutput({ ...visible, qualitative_observations: [claim] }).state,
      'INVALID_PROVIDER_OUTPUT');
  }
});

test('face identity and body-composition inference are rejected', () => {
  for (const claim of ['face identity is Alex', 'body identity confirmed', 'body-fat is 18%']) {
    assert.equal(validateMealVisionOutput({ ...visible, qualitative_observations: [claim] }).state,
      'INVALID_PROVIDER_OUTPUT');
  }
});

test('no external consent blocks before the offline port', async () => {
  const store = createMealExternalConsentStore();
  const ref = context(); store.bind(ref);
  const fakeConsent = Object.freeze({
    ...scopeA, candidate_id: ref.candidate_id, context_id: ref.context_id,
    c1_permission_revision: ref.permission_revision,
    purpose: 'MEAL_IMAGE_EXTERNAL_ANALYSIS', consent_revision: 1, status: 'ALLOWED',
  });
  let calls = 0;
  const result = await runMealVisionOfflineFixture(request(ref, fakeConsent), store, {
    analyze: () => { calls += 1; return visible; },
  });
  assert.equal(result.reason, 'CONSENT_REQUIRED');
  assert.equal(calls, 0);
});

test('revoked consent blocks before the offline port', async () => {
  const store = createMealExternalConsentStore();
  const ref = context(); store.bind(ref);
  const consent = store.allow(ref); store.revoke(consent);
  let calls = 0;
  const result = await runMealVisionOfflineFixture(request(ref, consent), store, {
    analyze: () => { calls += 1; return visible; },
  });
  assert.equal(result.reason, 'CONSENT_REQUIRED');
  assert.equal(calls, 0);
});

test('stale task, context and candidate bindings are blocked', async () => {
  const store = createMealExternalConsentStore();
  const ref = context(); store.bind(ref);
  const consent = store.allow(ref);
  const fixtures = [
    request(ref, consent, prepared(ref), { scope: scopeB }),
    request(ref, consent, prepared(ref), { context_id: 'stale-context' }),
    request(ref, consent, prepared(ref), { candidate_id: 'stale-candidate' }),
  ];
  for (const fixture of fixtures) {
    const result = await runMealVisionOfflineFixture(fixture, store, { analyze: () => visible });
    assert.equal(result.state, 'BLOCKED');
  }
});

test('LOCAL_ONLY image is blocked before the offline port', async () => {
  const store = createMealExternalConsentStore();
  const ref = context(); store.bind(ref);
  const consent = store.allow(ref);
  let calls = 0;
  const result = await runMealVisionOfflineFixture(request(ref, consent, prepared(ref, 'LOCAL_ONLY')),
    store, { analyze: () => { calls += 1; return visible; } });
  assert.equal(result.reason, 'IMAGE_NOT_EXTERNAL_READY');
  assert.equal(calls, 0);
});

test('current C1 ALLOWED plus current external consent and EXTERNAL_READY runs mock once', async () => {
  const store = createMealExternalConsentStore();
  const ref = context(); store.bind(ref);
  const consent = store.allow(ref);
  let mockCalls = 0;
  const result = await runMealVisionOfflineFixture(request(ref, consent), store, {
    analyze: value => {
      mockCalls += 1;
      assert.equal(value.prepared_image.readiness_basis, 'SYNTHETIC_TEST_FIXTURE');
      assert.deepEqual(Object.keys(value).sort(), [
        'scope', 'context_id', 'candidate_id', 'consent', 'prepared_image',
        'current_c1', 'purpose', 'locale',
      ].sort());
      assert.doesNotMatch(JSON.stringify(value), /local_uri|base64|metadata|provider|private/iu);
      return visible;
    },
  });
  assert.equal(result.state, 'VISIBLE_MEAL_CONTEXT');
  assert.equal(mockCalls, 1);
});

test('privacy-bearing runtime objects reject extra fields and professional boundary', async () => {
  const store = createMealExternalConsentStore();
  const ref = context(); store.bind(ref);
  const consent = store.allow(ref);
  const exactPrepared = prepared(ref);
  const exactC1 = currentC1(ref);
  const cases = [
    request(ref, consent, { ...exactPrepared, local_uri: 'file:///private-meal.jpg' }),
    request(ref, consent, { ...exactPrepared, base64: 'forbidden-inline-data' }),
    request(ref, consent, { ...exactPrepared, metadata: { exif: true } }),
    request(ref, { ...consent, arbitrary_extra: true }),
    request(ref, consent, exactPrepared, {
      current_c1: { ...exactC1, image: { ...exactC1.image, local_uri: 'file:///private.jpg' } },
    }),
    request(ref, consent, exactPrepared, {
      current_c1: { ...exactC1, image: { ...exactC1.image, metadata: { exif: true } } },
    }),
    request(ref, consent, exactPrepared, { arbitrary_extra: true }),
    request(ref, consent, exactPrepared, {
      current_c1: { ...exactC1, boundary: 'professional_required' },
    }),
  ];
  let calls = 0;
  for (const fixture of cases) {
    const result = await runMealVisionOfflineFixture(fixture, store, {
      analyze: () => { calls += 1; return visible; },
    });
    assert.deepEqual(result, { state: 'BLOCKED', reason: 'INVALID_REQUEST' });
  }
  assert.equal(calls, 0);
});

test('C1 revoked or denied after external consent blocks before the mock port', async () => {
  for (const status of ['denied', 'unknown']) {
    const store = createMealExternalConsentStore();
    const ref = context(); store.bind(ref);
    const consent = store.allow(ref);
    const changed = context(scopeA, { permission_revision: ref.permission_revision + 1 });
    let calls = 0;
    const result = await runMealVisionOfflineFixture(
      request(ref, consent, prepared(ref), { current_c1: currentC1(changed, status) }),
      store,
      { analyze: () => { calls += 1; return visible; } },
    );
    assert.equal(result.reason, 'CONSENT_REQUIRED');
    assert.equal(calls, 0);
  }
});

test('current C1 UNKNOWN or DENIED blocks even while external consent is current', async () => {
  for (const status of ['unknown', 'denied']) {
    const store = createMealExternalConsentStore();
    const ref = context(); store.bind(ref);
    const consent = store.allow(ref);
    let calls = 0;
    const result = await runMealVisionOfflineFixture(
      request(ref, consent, prepared(ref), { current_c1: currentC1(ref, status) }),
      store,
      { analyze: () => { calls += 1; return visible; } },
    );
    assert.equal(result.reason, 'CONSENT_REQUIRED');
    assert.equal(calls, 0);
  }
});

test('changed C1 permission revision invalidates the old external consent', async () => {
  const store = createMealExternalConsentStore();
  const ref = context(); store.bind(ref);
  const consent = store.allow(ref);
  const changed = context(scopeA, { permission_revision: ref.permission_revision + 1 });
  let calls = 0;
  const result = await runMealVisionOfflineFixture(
    request(ref, consent, prepared(ref), { current_c1: currentC1(changed) }),
    store,
    { analyze: () => { calls += 1; return visible; } },
  );
  assert.equal(result.reason, 'CONSENT_REQUIRED');
  assert.equal(calls, 0);
});

test('C1 context or candidate replacement blocks the old external consent', async () => {
  const store = createMealExternalConsentStore();
  const ref = context(); store.bind(ref);
  const consent = store.allow(ref);
  const replacement = context(scopeA, {
    context_id: 'camera-c1-context-replacement',
    candidate_id: 'camera-candidate-replacement',
    permission_revision: ref.permission_revision + 1,
  });
  let calls = 0;
  const result = await runMealVisionOfflineFixture(
    request(ref, consent, prepared(ref), { current_c1: currentC1(replacement) }),
    store,
    { analyze: () => { calls += 1; return visible; } },
  );
  assert.equal(result.reason, 'STALE_CONTEXT');
  assert.equal(calls, 0);
});

test('malformed request shapes return INVALID_REQUEST without throwing', async () => {
  const store = createMealExternalConsentStore();
  const ref = context(); store.bind(ref);
  const consent = store.allow(ref);
  const malformed = [
    undefined,
    null,
    request(ref, undefined),
    request(ref, consent, prepared(ref), { prepared_image: undefined }),
    request(ref, consent, prepared(ref), { scope: undefined }),
    request(ref, consent, prepared(ref), { scope: 'wrong-primitive' }),
    request(ref, consent, prepared(ref), { current_c1: null }),
  ];
  let calls = 0;
  for (const fixture of malformed) {
    const result = await runMealVisionOfflineFixture(fixture, store, {
      analyze: () => { calls += 1; return visible; },
    });
    assert.deepEqual(result, { state: 'BLOCKED', reason: 'INVALID_REQUEST' });
  }
  assert.equal(calls, 0);
});

test('contract exposes no image material, provider implementation or side effect path', () => {
  assert.doesNotMatch(source,
    /local_uri|file:\/\/|filesystem|raw bytes|base64|EXIF|AsyncStorage|SQLite|database|server|analytics/iu);
  assert.doesNotMatch(source, /fetch\s*\(|axios|OpenAI|Anthropic|Gemini|VisionClient/iu);
  assert.equal(networkCalls, 0);
});

test('protected-source fingerprints are portable and detect substantive changes', () => {
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
  assert.equal(sha256(normalizeSourceForFingerprint(m4Source)), '2571B5652D38FC0132EA392E74E73608EE39ACFCDE9F7899B95AC87BEF3DF578');
  assert.equal(sha256(normalizeSourceForFingerprint(m5Source)), 'C1D308CFC43A807C6DBB3D21B16055F5A7D9483AD488355D1F71842C290DB207');
  assert.match(m5Source, /meal_image_assessment: "NOT_AVAILABLE"/u);
  assert.doesNotMatch(m5Source, /meal_image_assessment: "AVAILABLE"/u);
});

for (const { name, body } of tests) {
  await body();
  console.log('PASS ' + name);
}
assert.equal(networkCalls, 0);
console.log('Camera C2 offline: ' + tests.length + '/' + tests.length
  + ' PASS; provider/network/persistence/paid calls = 0; device/live evaluation = NOT_RUN.');
