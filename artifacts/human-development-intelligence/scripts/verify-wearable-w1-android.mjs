import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls += 1;
  throw new Error('NETWORK_FORBIDDEN_IN_WEARABLE_W1_ANDROID');
};

const at = path => new URL(path, import.meta.url);
const read = path => readFile(at(path), 'utf8');
const { createAndroidHealthConnectReadAdapter } = await import(
  at('../domain/wearable/android-health-connect-adapter.ts')
);
const kotlin = await read('../modules/wearable-health/android/src/main/java/com/project100/wearablehealth/WearableHealthModule.kt');
const manifest = await read('../modules/wearable-health/android/src/main/AndroidManifest.xml');
const gradle = await read('../modules/wearable-health/android/build.gradle');
const adapterSource = await read('../domain/wearable/android-health-connect-adapter.ts');
const bridge = await read('../modules/wearable-health/src/WearableHealthModule.ts');
const moduleConfig = JSON.parse(await read('../modules/wearable-health/expo-module.config.json'));
const appPackage = JSON.parse(await read('../package.json'));

const tests = [];
const test = (name, body) => tests.push({ name, body });

// CODE_OFFLINE fixture: use the real owner boundary and actual SessionTaskStore issuer.
const {createLocalOwnerBoundary}=await import(at('../domain/local-owner/boundary.ts'));
const {createSessionTaskStore}=await import(at('../domain/session-task/store.ts'));
const {createWearableOwnerSession}=await import(at('../domain/wearable/contract.ts'));
const fixtureNow=Date.parse('2026-09-20T00:00:00.000Z');
const boundary30=createLocalOwnerBoundary({verify:async()=>({status:'verified',owner:{subjectId:'wearable_fixture_owner',profileId:'wearable_fixture_profile'},validUntil:fixtureNow+60000})},{now:()=>fixtureNow,schedule:()=>()=>{}});
const lease30=await boundary30.control.verifySession();boundary30.control.finishHydration(lease30);
const binding30=Object.freeze({access:boundary30.access,lease:lease30});
const store30=createSessionTaskStore({ownerSession:binding30,now:()=>fixtureNow});store30.start();assert.ok(store30.submit('Khỏe hơn',{locale:'vi'}));
const session30=createWearableOwnerSession(()=>binding30,{mode:'CODE_OFFLINE_TEST_FIXTURE',now:()=>fixtureNow});session30.start();session30.bindTaskStore(store30);
const request=session30.issueRead('STEPS_ONLY','2026-09-19T00:00:00.000Z','2026-09-19T23:59:59.000Z');
const workoutRequest=session30.issueRead('WORKOUT_ONLY',request.started_at,request.ended_at);
const native = overrides => ({
  isAvailable: () => true,
  clearSession: () => {},
  requestReadAccess: async () => ({ state: 'REQUEST_COMPLETED' }),
  readSteps: async () => ({
    state: 'AVAILABLE',
    count: 6789,
    observedStartedAt: request.started_at,
    observedEndedAt: request.ended_at,
  }),
  readWorkouts: async () => ({
    state: 'AVAILABLE',
    workouts: [{
      category: 'WALK',
      startedAt: '2026-09-19T08:00:00.000Z',
      endedAt: '2026-09-19T08:45:00.000Z',
      durationMinutes: 45,
    }],
  }),
  ...overrides,
});

test('existing local Expo module autolinks apple and Android', async () => {
  assert.deepEqual(moduleConfig.platforms, ['apple', 'android']);
  assert.deepEqual(moduleConfig.apple.modules, ['WearableHealthModule']);
  assert.deepEqual(moduleConfig.android.modules,
    ['com.project100.wearablehealth.WearableHealthModule']);
  const files = await readdir(at('../modules/wearable-health/android'));
  assert.ok(files.includes('build.gradle'));
  assert.ok(files.includes('src'));
});

test('uses only official stable Health Connect client 1.1.0', () => {
  assert.match(gradle, /androidx\.health\.connect:connect-client:1\.1\.0/u);
  assert.doesNotMatch(gradle, /alpha|beta|rc/iu);
  assert.equal(appPackage.dependencies?.['react-native-health'], undefined);
  assert.doesNotMatch([gradle, adapterSource, kotlin].join('\n'),
    /react-native-health|expo-health|health-connect-wrapper/iu);
});

test('availability distinguishes available, unavailable, and provider update required', () => {
  assert.match(kotlin, /HealthConnectClient\.getSdkStatus\(/u);
  assert.match(kotlin, /SDK_AVAILABLE -> Availability\.AVAILABLE/u);
  assert.match(kotlin, /SDK_UNAVAILABLE -> Availability\.UNAVAILABLE/u);
  assert.match(kotlin,
    /SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED[\s\S]*Availability\.PROVIDER_UPDATE_REQUIRED/u);
  assert.doesNotMatch(kotlin, /market:\/\/|ACTION_HEALTH_CONNECT_SETTINGS|startActivity\(Intent/u);
});

test('manifest declares exactly steps and exercise health permissions', () => {
  const permissions = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/gu)]
    .map(match => match[1]);
  assert.deepEqual(permissions, [
    'android.permission.health.READ_STEPS',
    'android.permission.health.READ_EXERCISE',
  ]);
  assert.match(manifest, /com\.google\.android\.apps\.healthdata/u);
  assert.doesNotMatch(manifest, /WRITE_|HEART_RATE|HISTORY|BACKGROUND|ROUTE|MEDICAL/iu);
});

test('permission request is explicit and never occurs on module creation', async () => {
  assert.match(kotlin, /AsyncFunction\("requestReadAccess"\)/u);
  assert.match(kotlin, /createRequestPermissionResultContract\(\)/u);
  assert.match(kotlin, /startActivityForResult\(intent, PERMISSION_REQUEST_CODE\)/u);
  assert.doesNotMatch(kotlin, /OnCreate[\s\S]*launchPermissionRequest/u);
  assert.doesNotMatch(bridge, /requestReadAccess\s*\(\s*\)/u);
  let calls = 0;
  const adapter = createAndroidHealthConnectReadAdapter(native({
    requestReadAccess: async () => {
      calls += 1;
      return { state: 'REQUEST_COMPLETED' };
    },
  }));
  assert.equal(calls, 0);
  assert.equal((await adapter.requestReadAccess(request)).state, 'REQUEST_COMPLETED');
  assert.equal(calls, 1);
});

test('every read checks its exact granted permission first', () => {
  const checks = kotlin.match(/permissionController\.getGrantedPermissions\(\)/gu) ?? [];
  assert.equal(checks.length, 2);
  assert.match(kotlin,
    /getReadPermission\(StepsRecord::class\)[\s\S]*getGrantedPermissions\(\)[\s\S]*PERMISSION_DENIED/u);
  assert.match(kotlin,
    /getReadPermission\(ExerciseSessionRecord::class\)[\s\S]*getGrantedPermissions\(\)[\s\S]*PERMISSION_DENIED/u);
});

test('missing steps permission maps to W0 PERMISSION_DENIED', async () => {
  const result = await createAndroidHealthConnectReadAdapter(native({
    readSteps: async () => ({ state: 'PERMISSION_DENIED' }),
  })).readSteps(request);
  assert.equal(result.state, 'PERMISSION_DENIED');
  assert.equal(result.signal_kind, 'STEPS');
  assert.equal(result.source_platform, 'ANDROID_HEALTH_CONNECT');
});

test('missing exercise permission maps to W0 PERMISSION_DENIED', async () => {
  const [result] = await createAndroidHealthConnectReadAdapter(native({
    readWorkouts: async () => ({ state: 'PERMISSION_DENIED' }),
  })).readWorkouts(workoutRequest);
  assert.equal(result.state, 'PERMISSION_DENIED');
  assert.equal(result.signal_kind, 'WORKOUT');
});

test('no records remain NO_DATA for both signals', async () => {
  const adapter = createAndroidHealthConnectReadAdapter(native({
    readSteps: async () => ({ state: 'NO_DATA' }),
    readWorkouts: async () => ({ state: 'NO_DATA' }),
  }));
  assert.equal((await adapter.readSteps(request)).state, 'NO_DATA');
  assert.equal((await adapter.readWorkouts(workoutRequest))[0].state, 'NO_DATA');
});

test('unavailable and update-required native paths map to PLATFORM_UNAVAILABLE', async () => {
  const absent = createAndroidHealthConnectReadAdapter(null);
  assert.equal(absent.isAvailable(), false);
  assert.equal((await absent.requestReadAccess()).state, 'PLATFORM_UNAVAILABLE');
  assert.equal((await absent.readSteps(request)).state, 'PLATFORM_UNAVAILABLE');
  assert.equal((await absent.readWorkouts(workoutRequest))[0].state, 'PLATFORM_UNAVAILABLE');
  assert.match(kotlin,
    /Availability\.UNAVAILABLE,[\s\S]*Availability\.PROVIDER_UPDATE_REQUIRED[\s\S]*PLATFORM_UNAVAILABLE/u);
});

test('StepsRecord aggregate maps to W0 steps count and platform authority', async () => {
  assert.match(kotlin, /StepsRecord\.COUNT_TOTAL/u);
  assert.match(kotlin, /AggregateRequest\(/u);
  const result = await createAndroidHealthConnectReadAdapter(native()).readSteps(request);
  assert.equal(result.state, 'AVAILABLE');
  assert.equal(result.source_platform, 'ANDROID_HEALTH_CONNECT');
  assert.equal(result.signal.signal_kind, 'STEPS');
  assert.deepEqual(result.signal.value, { quantity: 6789, unit: 'count' });
  assert.equal(result.authority, 'CONTEXT_ONLY');
  assert.equal(result.source_of_record, 'PLATFORM');
});

test('ExerciseSessionRecord maps common categories and unknown to OTHER', async () => {
  for (const token of ['WALKING', 'RUNNING', 'BIKING', 'STRENGTH_TRAINING']) {
    assert.match(kotlin, new RegExp(`EXERCISE_TYPE_${token}`));
  }
  assert.match(kotlin, /else -> "OTHER"/u);
  const [walk] = await createAndroidHealthConnectReadAdapter(native()).readWorkouts(workoutRequest);
  assert.equal(walk.signal.value.category, 'WALK');
  assert.equal(walk.signal.value.completion, 'COMPLETED');
  const [other] = await createAndroidHealthConnectReadAdapter(native({
    readWorkouts: async () => ({
      state: 'AVAILABLE',
      workouts: [{
        category: 'OTHER',
        startedAt: request.started_at,
        endedAt: request.ended_at,
        durationMinutes: 10,
      }],
    }),
  })).readWorkouts(workoutRequest);
  assert.equal(other.signal.value.category, 'OTHER');
});

test('v1 recent-context policy rejects every interval outside 30 days before effects',()=>{
 assert.match(kotlin,/interval\.first >= v1WindowStart && interval\.second <= now && Duration\.between\(interval\.first, interval\.second\) <= V1_RECENT_CONTEXT_WINDOW/u);
 assert.match(kotlin,/return interval\.first/u);
 assert.match(kotlin,/V1_RECENT_CONTEXT_WINDOW: Duration = Duration\.ofDays\(30\)/u);
 assert.match(kotlin,/ERR_WEARABLE_V1_HISTORY_WINDOW = "ERR_WEARABLE_V1_HISTORY_WINDOW"/u);
 assert.match(kotlin,/"observedStartedAt" to effectiveStart\.toString\(\)/u);
 assert.throws(()=>session30.issueRead('STEPS_ONLY','2026-07-01T00:00:00.000Z',request.ended_at),/OUTSIDE_V1_RECENT_CONTEXT/);
 assert.throws(()=>session30.issueRead('STEPS_ONLY',request.started_at,'2026-09-21T00:00:00.000Z'),/OUTSIDE_V1_RECENT_CONTEXT/);
});

test('v1 window is product policy, not a claimed platform authorization boundary', () => {
  assert.match(kotlin, /Product policy for 100 v1/u);
  assert.match(kotlin, /not Health Connect's permission or authorization boundary/u);
  assert.doesNotMatch(kotlin,
    /platform's documented default window|conservativeHistoryBoundary|DEFAULT_HISTORY_WINDOW/u);
  assert.doesNotMatch(manifest, /READ_HEALTH_DATA_HISTORY/u);
  assert.doesNotMatch(kotlin,
    /HealthPermission\.PERMISSION_READ_HEALTH_DATA_HISTORY|permission\.health\.READ_HEALTH_DATA_HISTORY/u);
});

test('native records never cross the provider-neutral W0 boundary', () => {
  assert.doesNotMatch(adapterSource,
    /HealthConnectClient|StepsRecord|ExerciseSessionRecord|ReadRecordsRequest/u);
  assert.doesNotMatch(adapterSource, /provider_native_record|metadata\.id|exerciseRoute/u);
});

test('adapter has no persistence, network, provider, route, background, or medical access', () => {
  const combined = [kotlin, adapterSource, bridge].join('\n');
  assert.doesNotMatch(combined,
    /AsyncStorage|SQLite|database|SharedPreferences|URLSession|fetch\s*\(|axios|OpenAI|analytics/iu);
  assert.doesNotMatch(combined,
    /HeartRateRecord|ExerciseRoute|READ_HEALTH_DATA_IN_BACKGROUND|medical/iu);
  assert.equal(networkCalls, 0);
});

for (const { name, body } of tests) {
  await body();
  console.log('PASS ' + name);
}
session30.dispose();store30.stop();boundary30.control.invalidateCurrentSession();
assert.equal(networkCalls, 0);
console.log('Wearable W1-Android: ' + tests.length + '/' + tests.length
  + ' PASS; provider/network calls = 0; native compile/device = NOT_RUN.');
