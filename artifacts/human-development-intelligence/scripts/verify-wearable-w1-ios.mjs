import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls += 1;
  throw new Error('NETWORK_FORBIDDEN_IN_WEARABLE_W1_IOS');
};

const at = path => new URL(path, import.meta.url);
const read = path => readFile(at(path), 'utf8');
const { createAppleHealthReadAdapter } = await import(
  at('../domain/wearable/apple-health-adapter.ts')
);
const swift = await read('../modules/wearable-health/ios/WearableHealthModule.swift');
const bridge = await read('../modules/wearable-health/src/WearableHealthModule.ts');
const adapterSource = await read('../domain/wearable/apple-health-adapter.ts');
const moduleConfig = JSON.parse(await read('../modules/wearable-health/expo-module.config.json'));
const modulePackage = JSON.parse(await read('../modules/wearable-health/package.json'));
const podspec = await read('../modules/wearable-health/ios/WearableHealth.podspec');
const appConfig = JSON.parse(await read('../app.json'));
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
    count: 4321,
    observedStartedAt: request.started_at,
    observedEndedAt: request.ended_at,
  }),
  readWorkouts: async () => ({
    state: 'AVAILABLE',
    workouts: [{
      category: 'RUN',
      startedAt: '2026-09-19T08:00:00.000Z',
      endedAt: '2026-09-19T08:30:00.000Z',
      durationMinutes: 30,
    }],
  }),
  ...overrides,
});

const swiftBlock = marker => {
  const start = swift.indexOf(marker);
  assert.notEqual(start, -1, `Missing Swift block: ${marker}`);
  const opening = swift.indexOf('{', start + marker.length);
  assert.notEqual(opening, -1, `Missing opening brace: ${marker}`);
  let depth = 0;
  for (let index = opening; index < swift.length; index += 1) {
    if (swift[index] === '{') depth += 1;
    if (swift[index] === '}') depth -= 1;
    if (depth === 0) return swift.slice(opening + 1, index);
  }
  assert.fail(`Unclosed Swift block: ${marker}`);
};

const assertNativeUnavailableGuard = name => {
  const body = swiftBlock(`AsyncFunction("${name}")`);
  assert.match(body,
    /^\s*\([^)]*\) in\s*guard self\.supportsHealthReadIntegration\(\) else \{\s*return promise\.resolve\(\["state": "PLATFORM_UNAVAILABLE"\]\)\s*\}/u,
    `${name} must fail closed before any native operation`);
  return body;
};

test('local Expo 57 module has the discoverable apple module structure', async () => {
  assert.equal(modulePackage.name, '@100/wearable-health');
  assert.deepEqual(moduleConfig.platforms, ['apple', 'android']);
  assert.deepEqual(moduleConfig.apple.modules, ['WearableHealthModule']);
  assert.match(podspec, /s\.dependency 'ExpoModulesCore'/u);
  assert.match(podspec, /s\.frameworks = 'HealthKit'/u);
  const moduleFiles = await readdir(at('../modules/wearable-health'));
  assert.ok(moduleFiles.includes('package.json'));
  assert.ok(moduleFiles.includes('expo-module.config.json'));
  assert.ok(moduleFiles.includes('ios'));
  assert.ok(moduleFiles.includes('src'));
});

test('V1 app config excludes archived HealthKit without changing Identity or Camera', async () => {
  const packageConfig = JSON.parse(await read('../package.json'));
  assert.deepEqual(packageConfig.expo.autolinking.exclude, ['@100/wearable-health']);
  assert.equal(appConfig.expo.ios.entitlements['com.apple.developer.healthkit'], undefined);
  assert.equal(Object.keys(appConfig.expo.ios.entitlements).length, 0);
  assert.equal(appConfig.expo.ios.infoPlist.NSHealthShareUsageDescription, undefined);
  assert.equal(appConfig.expo.ios.infoPlist.NSHealthUpdateUsageDescription, undefined);
  assert.equal(appConfig.expo.ios.usesAppleSignIn, true);
  assert.equal(appConfig.expo.ios.bundleIdentifier, 'com.togiang.hdi100');
  assert.equal(appConfig.expo.android.package, 'com.togiang.hdi100');
  assert.doesNotMatch(JSON.stringify(appConfig.expo.ios), /NSHealth|healthkit|health-records|background|fall.?detection/iu);
});

test('all eight V1 locales exclude Health purpose keys and retain Camera and Photo copy', async () => {
  const locales = ['vi', 'en', 'zh-Hans', 'es', 'hi', 'ja', 'ko', 'ru'];
  assert.deepEqual(Object.keys(appConfig.expo.locales), locales);
  for (const locale of locales) {
    const document = JSON.parse(await read(`../native-locales/${locale}.json`));
    const strings = document.ios['Localizable.strings'];
    assert.equal(strings.NSHealthShareUsageDescription, undefined, locale);
    assert.equal(strings.NSHealthUpdateUsageDescription, undefined, locale);
    assert.doesNotMatch(JSON.stringify(strings), /NSHealth/iu);
    assert.equal(typeof strings.NSCameraUsageDescription, 'string', locale);
    assert.ok(strings.NSCameraUsageDescription.length > 20, locale);
    assert.equal(typeof strings.NSPhotoLibraryUsageDescription, 'string', locale);
    assert.ok(strings.NSPhotoLibraryUsageDescription.length > 20, locale);
  }
});

test('authorization is explicit, read-only, least-privilege, and never inferred from status', () => {
  assert.match(swift, /AsyncFunction\("requestReadAccess"\)/u);
  assert.match(swift, /requestAuthorization\(toShare: \[\], read: readTypes\)/u);
  assert.match(swift, /quantityType\(forIdentifier: \.stepCount\)/u);
  assert.match(swift, /HKObjectType\.workoutType\(\)/u);
  assert.doesNotMatch(swift, /authorizationStatus\s*\(/u);
  assert.doesNotMatch(swift, /heartRate|HKQuantityTypeIdentifierHeartRate/iu);
  assert.doesNotMatch(swift, /save\s*\(|delete\s*\(|clinical|correlation/iu);
  assert.doesNotMatch(bridge, /requestReadAccess\s*\(\s*\)/u);
  assert.doesNotMatch(swift, /OnCreate[\s\S]*requestAuthorization/u);
  assert.match(adapterSource, /inspectWearableRead\(request!,metric\)[\s\S]*nativeRead\(request!,[\s\S]*nativeModule\.requestReadAccess\(wire\)[\s\S]*inspectWearableRead\(request!,metric\)/u);
});

test('one native capability boundary disables all iOS 27+ versions and unavailable HealthKit', () => {
  const capability = swiftBlock('private func supportsHealthReadIntegration() -> Bool');
  assert.match(capability,
    /^\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*if #available\(iOS 27\.0, \*\) \{\s*return false\s*\}\s*return HKHealthStore\.isHealthDataAvailable\(\)\s*$/u);
  assert.equal((swift.match(/HKHealthStore\.isHealthDataAvailable\(\)/gu) ?? []).length, 1);
  const modeledCapability = (major, minor, healthKitAvailable) => major < 27 && healthKitAvailable;
  for (const major of [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]) {
    assert.equal(modeledCapability(major, 0, true), true);
    assert.equal(modeledCapability(major, 9, false), false);
  }
  for (const [major, minor] of [[27, 0], [27, 1], [27, 9], [28, 0], [29, 4]]) {
    assert.equal(modeledCapability(major, minor, true), false);
    assert.equal(modeledCapability(major, minor, false), false);
  }
  // This model checks the written boundary, not a device or native Swift execution.
});

test('all four native entrypoints use capability before authorization or query side effects', () => {
  assert.match(swiftBlock('Function("isAvailable")'), /^\s*self\.supportsHealthReadIntegration\(\)\s*$/u);
  const authorization = assertNativeUnavailableGuard('requestReadAccess');
  const steps = assertNativeUnavailableGuard('readSteps');
  const workouts = assertNativeUnavailableGuard('readWorkouts');
  assert.ok(authorization.indexOf('requestAuthorization(') > authorization.indexOf('guard self.supportsHealthReadIntegration()'));
  assert.ok(steps.indexOf('self.executeStepsQuery(') > steps.indexOf('guard self.supportsHealthReadIntegration()'));
  assert.ok(workouts.indexOf('self.executeWorkoutQuery(') > workouts.indexOf('guard self.supportsHealthReadIntegration()'));
  assert.doesNotMatch(steps + workouts, /self\.isAvailable\(\)/u);
  assert.doesNotMatch(authorization + steps + workouts, /HKStatisticsQuery|HKSampleQuery|healthStore\.execute/u);
});

test('direct native reads cannot rely on a prior isAvailable call', () => {
  for (const name of ['readSteps', 'readWorkouts']) {
    const body = assertNativeUnavailableGuard(name);
    assert.doesNotMatch(body, /self\.isAvailable\(\)|requestReadAccess\(/u);
  }
});

test('static iOS 27+ control flow returns before authorization or query construction', () => {
  const capability = swiftBlock('private func supportsHealthReadIntegration() -> Bool');
  assert.match(capability, /if #available\(iOS 27\.0, \*\) \{\s*return false\s*\}/u);
  for (const name of ['requestReadAccess', 'readSteps', 'readWorkouts']) {
    const body = assertNativeUnavailableGuard(name);
    const guardEnd = body.indexOf('return promise.resolve(["state": "PLATFORM_UNAVAILABLE"])');
    assert.ok(guardEnd >= 0);
    assert.doesNotMatch(body.slice(0, guardEnd), /requestAuthorization|HKStatisticsQuery|HKSampleQuery|healthStore\.execute|self\.execute(?:Steps|Workout)Query/u);
  }
  // Static proof of ordering only; native side-effect counters require Apple SDK/device execution.
});

test('iOS 27 API and runtime reflection are absent from production Swift', () => {
  assert.doesNotMatch(swift, /getEarliestAuthorizedSampleDate|resolveEffectiveStart|earliestPermittedSampleDate/u);
  assert.doesNotMatch(swift, /NSSelectorFromString|Selector\s*\(|responds\s*\(|perform\s*\(|unsafeBitCast|objc_msgSend|#if\s+compiler|\.success\(requestedStart\)/u);
});

test('adapter creation never requests authorization; only the explicit method does', async () => {
  let authorizationCalls = 0;
  const adapter = createAppleHealthReadAdapter(native({
    requestReadAccess: async () => {
      authorizationCalls += 1;
      return { state: 'REQUEST_COMPLETED' };
    },
  }));
  assert.equal(authorizationCalls, 0);
  assert.equal((await adapter.requestReadAccess(request)).state, 'REQUEST_COMPLETED');
  assert.equal(authorizationCalls, 1);
});

test('bounded steps aggregation maps to W0 APPLE_HEALTH STEPS count', async () => {
  assert.match(swift, /HKStatisticsQuery/u);
  assert.match(swift, /options: \.cumulativeSum/u);
  const query = swiftBlock('private func executeStepsQuery(');
  assert.match(query, /withStart: start,[\s\S]*end: end,[\s\S]*options: \[\.strictStartDate, \.strictEndDate\]/u);
  assert.match(query, /"observedStartedAt": self\.isoString\(start\),[\s\S]*"observedEndedAt": self\.isoString\(end\)/u);
  assert.match(query, /guard let sum = statistics\?\.sumQuantity\(\) else \{\s*return promise\.resolve\(\["state": "NO_DATA"\]\)/u);
  assert.match(query, /"count": count/u);
  assert.doesNotMatch(query, /"count":\s*0|max\(0, count\)/u);
  const result = await createAppleHealthReadAdapter(native()).readSteps(request);
  assert.equal(result.state, 'AVAILABLE');
  assert.equal(result.source_platform, 'APPLE_HEALTH');
  assert.equal(result.signal.signal_kind, 'STEPS');
  assert.deepEqual(result.signal.value, { quantity: 4321, unit: 'count' });
  assert.deepEqual(result.signal.observation, {
    kind: 'INTERVAL', started_at: request.started_at, ended_at: request.ended_at,
  });
  assert.equal(result.authority, 'CONTEXT_ONLY');
  assert.equal(result.source_of_record, 'PLATFORM');
});

test('adapter contract preserves a narrower native observation interval', async () => {
  const authorizedStart = '2026-09-19T00:00:00.000Z';
  const sevenDayRequest=session30.issueRead('STEPS_ONLY','2026-09-13T00:00:00.000Z','2026-09-20T00:00:00.000Z');
  const result = await createAppleHealthReadAdapter(native({
    readSteps: async (startedAt, endedAt) => {
      assert.equal(startedAt, sevenDayRequest.started_at);
      assert.equal(endedAt, sevenDayRequest.ended_at);
      return {
        state: 'AVAILABLE',
        count: 900,
        observedStartedAt: authorizedStart,
        observedEndedAt: endedAt,
      };
    },
  })).readSteps(sevenDayRequest);
  assert.equal(result.signal.observation.started_at, authorizedStart);
  assert.equal(result.signal.observation.ended_at, sevenDayRequest.ended_at);
  assert.notEqual(result.signal.observation.started_at, sevenDayRequest.started_at);
});

test('supported native query uses the validated requested interval without inferring permission', async () => {
  const result = await createAppleHealthReadAdapter(native()).readSteps(request);
  assert.equal(result.signal.observation.started_at, request.started_at);
  assert.doesNotMatch(swift, /authorizationStatus\s*\(/u);
  assert.doesNotMatch(swift, /PERMISSION_DENIED/u);
  const steps = swiftBlock('AsyncFunction("readSteps")');
  assert.match(steps, /start: interval\.start,[\s\S]*end: interval\.end/u);
});

test('invalid or future-ended intervals reject before either native query', () => {
  const interval = swiftBlock('private func requestedInterval(');
  assert.match(interval, /guard let requestedStart = parseISODate\(startedAt\),[\s\S]*let requestedEnd = parseISODate\(endedAt\),[\s\S]*requestedStart <= requestedEnd,[\s\S]*requestedEnd <= Date\(\),[\s\S]*requestedStart >= Date\(\)\.addingTimeInterval\(-30 \* 24 \* 60 \* 60\),[\s\S]*requestedEnd.timeIntervalSince\(requestedStart\) <= 30 \* 24 \* 60 \* 60 else \{\s*return nil/u);
  for (const name of ['readSteps', 'readWorkouts']) {
    const body = swiftBlock(`AsyncFunction("${name}")`);
    assert.match(body, /self\.requestedInterval\(startedAt: startedAt, endedAt: endedAt\)/u);
    assert.match(body, /return promise\.reject\("ERR_WEARABLE_INTERVAL", "The requested wearable interval is invalid\."\)/u);
    assert.ok(body.indexOf('self.requestedInterval(') < body.indexOf(name === 'readSteps'
      ? 'self.executeStepsQuery(' : 'self.executeWorkoutQuery('));
  }
  assert.doesNotMatch(interval, /min\(|clamp/u);
});

test('workout query preserves sample start/end and empty results mean NO_DATA', () => {
  const query = swiftBlock('private func executeWorkoutQuery(');
  assert.match(query, /withStart: start,[\s\S]*end: end,[\s\S]*options: \[\.strictStartDate, \.strictEndDate\]/u);
  assert.match(query, /"startedAt": self\.isoString\(workout\.startDate\),[\s\S]*"endedAt": self\.isoString\(workout\.endDate\)/u);
  assert.match(query, /guard !workouts\.isEmpty else \{\s*return promise\.resolve\(\["state": "NO_DATA"\]\)/u);
});

test('native query errors never become successful reads', () => {
  for (const marker of ['private func executeStepsQuery(', 'private func executeWorkoutQuery(']) {
    const query = swiftBlock(marker);
    assert.match(query, /if let error \{[\s\S]*?isHealthDataRestricted\(error\)[\s\S]*?return promise\.resolve\(\["state": "PLATFORM_UNAVAILABLE"\]\)[\s\S]*?return promise\.reject\(error\)/u);
  }
});

test('bounded completed workouts map into W0 without HealthKit objects', async () => {
  assert.match(swift, /HKSampleQuery/u);
  assert.match(swift, /case \.walking:[\s\S]*return "WALK"/u);
  assert.match(swift, /case \.running:[\s\S]*return "RUN"/u);
  assert.match(swift, /case \.cycling:[\s\S]*return "CYCLE"/u);
  assert.match(swift, /traditionalStrengthTraining[\s\S]*return "STRENGTH"/u);
  assert.match(swift, /default:[\s\S]*return "OTHER"/u);
  const [result] = await createAppleHealthReadAdapter(native()).readWorkouts(workoutRequest);
  assert.equal(result.state, 'AVAILABLE');
  assert.equal(result.source_platform, 'APPLE_HEALTH');
  assert.deepEqual(result.signal.value, {
    category: 'RUN', completion: 'COMPLETED', duration: 30, unit: 'minute',
  });
  assert.equal('HKWorkoutActivityType' in result, false);
  assert.doesNotMatch(adapterSource, /HKWorkout|HKQuantitySample|HKHealthStore/u);
  const [other] = await createAppleHealthReadAdapter(native({
    readWorkouts: async () => ({
      state: 'AVAILABLE',
      workouts: [{
        category: 'OTHER',
        startedAt: '2026-09-19T09:00:00.000Z',
        endedAt: '2026-09-19T09:15:00.000Z',
        durationMinutes: 15,
      }],
    }),
  })).readWorkouts(workoutRequest);
  assert.equal(other.signal.value.category, 'OTHER');
});

test('empty Apple reads remain NO_DATA and never become PERMISSION_DENIED', async () => {
  const adapter = createAppleHealthReadAdapter(native({
    readSteps: async () => ({ state: 'NO_DATA' }),
    readWorkouts: async () => ({ state: 'NO_DATA' }),
  }));
  const steps = await adapter.readSteps(request);
  const [workouts] = await adapter.readWorkouts(workoutRequest);
  assert.equal(steps.state, 'NO_DATA');
  assert.equal(workouts.state, 'NO_DATA');
  assert.doesNotMatch(swift, /PERMISSION_DENIED/u);
  assert.doesNotMatch(adapterSource, /PERMISSION_DENIED/u);
});

test('unavailable native platform maps honestly for both requested signals', async () => {
  const absent = createAppleHealthReadAdapter(null);
  assert.equal(absent.isAvailable(), false);
  assert.equal((await absent.requestReadAccess()).state, 'PLATFORM_UNAVAILABLE');
  assert.equal((await absent.readSteps(request)).state, 'PLATFORM_UNAVAILABLE');
  assert.equal((await absent.readWorkouts(workoutRequest))[0].state, 'PLATFORM_UNAVAILABLE');
});

test('adapter has no persistence, network, provider, third-party health wrapper, or raw retention', () => {
  const combined = [swift, bridge, adapterSource].join('\n');
  assert.doesNotMatch(combined, /AsyncStorage|SQLite|database|UserDefaults|URLSession|fetch\s*\(|axios|OpenAI|provider/iu);
  assert.doesNotMatch(combined, /react-native-health|expo-health|healthkit-wrapper/iu);
  assert.equal(appPackage.dependencies?.['react-native-health'], undefined);
  assert.equal(appPackage.devDependencies?.['react-native-health'], undefined);
  assert.equal(networkCalls, 0);
});

for (const { name, body } of tests) {
  await body();
  console.log('PASS ' + name);
}
session30.dispose();store30.stop();boundary30.control.invalidateCurrentSession();
assert.equal(networkCalls, 0);
console.log('Wearable W1-iOS: ' + tests.length + '/' + tests.length
  + ' PASS; provider/network calls = 0; native compile/device = NOT_RUN.');
