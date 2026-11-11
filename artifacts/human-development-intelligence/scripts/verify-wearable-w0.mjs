import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls += 1;
  throw new Error('NETWORK_FORBIDDEN_IN_WEARABLE_W0');
};

const moduleAt = path => import(new URL(path, import.meta.url));
const { normalizeWearableContext } = await moduleAt('../domain/wearable/contract.ts');
const contractSource = await readFile(
  new URL('../domain/wearable/contract.ts', import.meta.url), 'utf8',
);
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tests = [];
const test = (name, body) => tests.push({ name, body });

const taskScope = Object.freeze({
  session_id: 'session-w0',
  task_id: 'task-w0',
  revision: 3,
  purpose: 'CURRENT_TASK_CONTEXT',
  requested_signal_kinds: Object.freeze(['STEPS', 'ACTIVITY', 'WORKOUT', 'HEART_RATE']),
});
const interval = Object.freeze({
  kind: 'INTERVAL',
  started_at: '2026-09-19T00:00:00.000Z',
  ended_at: '2026-09-19T23:59:59.000Z',
});
const assessed_at = '2026-09-20T00:00:00.000Z';
const stepsInput = source_platform => ({
  state: 'AVAILABLE',
  source_platform,
  scope: taskScope,
  assessed_at,
  signal: {
    signal_kind: 'STEPS',
    value: { quantity: 6200, unit: 'count' },
    observation: interval,
  },
});

test('Apple and Android equivalent steps preserve equal semantics and distinct provenance', () => {
  const apple = normalizeWearableContext(stepsInput('APPLE_HEALTH'));
  const android = normalizeWearableContext(stepsInput('ANDROID_HEALTH_CONNECT'));
  assert.equal(apple.source_platform, 'APPLE_HEALTH');
  assert.equal(android.source_platform, 'ANDROID_HEALTH_CONNECT');
  assert.deepEqual(apple.signal, android.signal);
  assert.deepEqual(apple.scope, android.scope);
  assert.deepEqual(apple.freshness, android.freshness);
});

test('steps and activity use normalized count/minute units and observed intervals', () => {
  const steps = normalizeWearableContext(stepsInput('APPLE_HEALTH'));
  const activity = normalizeWearableContext({
    ...stepsInput('ANDROID_HEALTH_CONNECT'),
    signal: {
      signal_kind: 'ACTIVITY',
      value: { duration: 42, unit: 'minute' },
      observation: interval,
    },
  });
  assert.deepEqual(steps.signal.value, { quantity: 6200, unit: 'count' });
  assert.deepEqual(activity.signal.value, { duration: 42, unit: 'minute' });
  assert.equal(activity.signal.observation.kind, 'INTERVAL');
});

test('completed workout uses only the small shared category denominator', () => {
  const workout = normalizeWearableContext({
    state: 'AVAILABLE',
    source_platform: 'APPLE_HEALTH',
    scope: taskScope,
    assessed_at,
    signal: {
      signal_kind: 'WORKOUT',
      value: {
        category: 'STRENGTH',
        completion: 'COMPLETED',
        duration: 37,
        unit: 'minute',
      },
      observation: interval,
    },
  });
  assert.deepEqual(workout.signal.value, {
    category: 'STRENGTH',
    completion: 'COMPLETED',
    duration: 37,
    unit: 'minute',
  });
});

test('optional heart rate is bounded point context without inference', () => {
  const heartRate = normalizeWearableContext({
    state: 'AVAILABLE',
    source_platform: 'ANDROID_HEALTH_CONNECT',
    scope: taskScope,
    assessed_at,
    signal: {
      signal_kind: 'HEART_RATE',
      value: { quantity: 72, unit: 'bpm' },
      observation: { kind: 'POINT', observed_at: '2026-09-19T12:00:00.000Z' },
    },
  });
  assert.deepEqual(heartRate.signal.value, { quantity: 72, unit: 'bpm' });
  assert.equal(heartRate.authority, 'CONTEXT_ONLY');
  assert.equal(heartRate.source_of_record, 'PLATFORM');
});

test('all five context states remain explicit and non-ambiguous', () => {
  const available = normalizeWearableContext(stepsInput('APPLE_HEALTH'));
  const stale = normalizeWearableContext({ ...stepsInput('APPLE_HEALTH'), state: 'STALE' });
  const unavailable = ['NO_DATA', 'PERMISSION_DENIED', 'PLATFORM_UNAVAILABLE'].map(state =>
    normalizeWearableContext({
      state,
      source_platform: 'APPLE_HEALTH',
      scope: taskScope,
      assessed_at,
      signal_kind: 'STEPS',
    }));
  assert.deepEqual(
    [available.state, ...unavailable.map(value => value.state), stale.state],
    ['AVAILABLE', 'NO_DATA', 'PERMISSION_DENIED', 'PLATFORM_UNAVAILABLE', 'STALE'],
  );
  assert.equal(available.freshness.state, 'CURRENT');
  assert.equal(stale.freshness.state, 'STALE');
  for (const value of unavailable) assert.equal(value.freshness.state, 'NOT_APPLICABLE');
});

test('task purpose bounds requested signals without reading a profile', () => {
  assert.throws(() => normalizeWearableContext({
    ...stepsInput('APPLE_HEALTH'),
    scope: { ...taskScope, requested_signal_kinds: ['WORKOUT'] },
  }), /WEARABLE_SIGNAL_OUTSIDE_TASK_PURPOSE/u);
  assert.doesNotMatch(contractSource, /age|occupation|body_profile|user_profile|health_history/iu);
});

test('normalization is immutable, copies inputs and drops provider-native extras', () => {
  const input = {
    ...stepsInput('APPLE_HEALTH'),
    provider_native_record: { secret: 'not retained' },
  };
  const before = structuredClone(input);
  const output = normalizeWearableContext(input);
  assert.deepEqual(input, before);
  assert.ok(Object.isFrozen(output));
  assert.ok(Object.isFrozen(output.scope));
  assert.ok(Object.isFrozen(output.scope.requested_signal_kinds));
  assert.ok(Object.isFrozen(output.signal));
  assert.ok(Object.isFrozen(output.signal.value));
  assert.ok(Object.isFrozen(output.signal.observation));
  assert.equal('provider_native_record' in output, false);
  assert.notEqual(output.scope, input.scope);
  assert.notEqual(output.signal, input.signal);
});

test('freshness is caller-assessed metadata, not an invented medical threshold', () => {
  const current = normalizeWearableContext(stepsInput('APPLE_HEALTH'));
  const stale = normalizeWearableContext({ ...stepsInput('APPLE_HEALTH'), state: 'STALE' });
  assert.equal(current.freshness.assessed_at, assessed_at);
  assert.equal(stale.freshness.assessed_at, assessed_at);
  assert.doesNotMatch(contractSource, /freshness.*(?:hour|day)|(?:hour|day).*freshness/iu);
});

test('invalid timestamps, intervals, values and scopes fail closed', () => {
  assert.throws(() => normalizeWearableContext({
    ...stepsInput('APPLE_HEALTH'), assessed_at: 'not-a-time',
  }), /INVALID_WEARABLE_ASSESSMENT_TIME/u);
  assert.throws(() => normalizeWearableContext({
    ...stepsInput('APPLE_HEALTH'),
    signal: {
      ...stepsInput('APPLE_HEALTH').signal,
      observation: {
        kind: 'INTERVAL',
        started_at: interval.ended_at,
        ended_at: interval.started_at,
      },
    },
  }), /INVALID_WEARABLE_INTERVAL/u);
  assert.throws(() => normalizeWearableContext({
    ...stepsInput('APPLE_HEALTH'),
    signal: {
      ...stepsInput('APPLE_HEALTH').signal,
      value: { quantity: -1, unit: 'count' },
    },
  }), /INVALID_WEARABLE_STEP_COUNT/u);
  assert.throws(() => normalizeWearableContext({
    ...stepsInput('APPLE_HEALTH'), scope: { ...taskScope, revision: 0 },
  }), /INVALID_WEARABLE_SCOPE/u);
});

test('W0 contains no native SDK, persistence, provider, network or medical inference', () => {
  assert.doesNotMatch(contractSource,
    /HKQuantityType|HKWorkout|HealthConnectClient|StepsRecord|HeartRateRecord/iu);
  assert.doesNotMatch(contractSource,
    /AsyncStorage|database|fetch\s*\(|axios|OpenAI|provider|HealthKit|expo-health/iu);
  assert.doesNotMatch(contractSource,
    /diagnos|medical risk|recovery score|readiness|heart.?rate zone/iu);
  assert.doesNotMatch(contractSource,
    /sleep|blood pressure|SpO2|temperature|glucose|medication|medical record/iu);
  assert.equal(networkCalls, 0);
  assert.equal(packageJson.dependencies?.['expo-health'], undefined);
});


// S30 security tests: real opaque owner lease + actual task issuer; only native ports are fake.
const {createLocalOwnerBoundary}=await moduleAt('../domain/local-owner/boundary.ts');
const {createSessionTaskStore,readWearableTaskProof}=await moduleAt('../domain/session-task/store.ts');
const {createWearableOwnerSession,inspectWearableRead}=await moduleAt('../domain/wearable/contract.ts');
const {createAppleHealthReadAdapter}=await moduleAt('../domain/wearable/apple-health-adapter.ts');
const {createAndroidHealthConnectReadAdapter}=await moduleAt('../domain/wearable/android-health-connect-adapter.ts');
export const S30_GROUPS=[];
const check30=(name,fn)=>test('S30 '+name,async()=>{await fn();S30_GROUPS.push(name)});
const now30=Date.parse('2026-09-20T00:00:00.000Z'),start30='2026-09-19T00:00:00.000Z',end30='2026-09-19T23:59:59.000Z';
async function realSession30(id='A',mode='CODE_OFFLINE_TEST_FIXTURE'){
 let time=now30,identity=id;
 const boundary=createLocalOwnerBoundary({verify:async()=>({status:'verified',owner:{subjectId:identity,profileId:'profile_'+identity},validUntil:time+60000})},{now:()=>time,schedule:()=>()=>{}});
 let lease=await boundary.control.verifySession();boundary.control.finishHydration(lease);let binding={access:boundary.access,lease};
 let store=createSessionTaskStore({ownerSession:binding,now:()=>time});store.start();assert.ok(store.submit('Khỏe hơn',{locale:'vi'}));
 const session=createWearableOwnerSession(()=>binding,{mode,now:()=>time});session.start();session.bindTaskStore(store);
 return {boundary,session,get store(){return store},get binding(){return binding},request:(choice='STEPS_ONLY')=>session.issueRead(choice,start30,end30),advance:ms=>{time+=ms;boundary.access.getSnapshot()},async switchOwner(next){boundary.control.invalidateCurrentSession();identity=next;lease=await boundary.control.verifySession();boundary.control.finishHydration(lease);binding={access:boundary.access,lease};store.stop();store=createSessionTaskStore({ownerSession:binding,now:()=>time});store.start();store.submit('Khỏe hơn',{locale:'vi'});session.bindTaskStore(store);},dispose(){session.dispose();store.stop();boundary.control.invalidateCurrentSession()}};
}
const fake30=(overrides={})=>({isAvailable:()=>true,clearSession:()=>{},requestReadAccess:async()=>({state:'REQUEST_COMPLETED'}),readSteps:async(s,e)=>({state:'AVAILABLE',count:6543,observedStartedAt:s,observedEndedAt:e}),readWorkouts:async(s,e)=>({state:'AVAILABLE',workouts:[{category:'WALK',durationMinutes:15,startedAt:s,endedAt:e}]}),...overrides});
check30('G0_DEFAULT_OFF_AND_NO_PARALLEL_ISSUER',async()=>{
 const x=await realSession30('A','gated_off');try{let calls=0;createAppleHealthReadAdapter(fake30({requestReadAccess:async()=>{calls++;return{state:'REQUEST_COMPLETED'}}}));assert.throws(()=>x.request(),/HEALTH_LIVE_OFF/);assert.equal(calls,0);
 const noOwner=createWearableOwnerSession(()=>undefined,{mode:'CODE_OFFLINE_TEST_FIXTURE',now:()=>now30});assert.throws(()=>noOwner.issueRead('STEPS_ONLY',start30,end30),/INVALID_WEARABLE_AUTHORITY/);noOwner.dispose();}finally{x.dispose()}
});
check30('G1_PRE_EFFECT_PRIVATE_PROOF_SINGLE_METRIC_AND_FORGERY',async()=>{
 const x=await realSession30();try{let calls=0;const seen=[],adapter=createAppleHealthReadAdapter(fake30({requestReadAccess:async wire=>{calls++;seen.push(wire.metric);return{state:'REQUEST_COMPLETED'}}}));
 assert.equal(readWearableTaskProof({},x.binding),undefined);assert.equal(x.store.captureWearableTaskProof({...x.store.reference()}),undefined);
 await assert.rejects(adapter.requestReadAccess({scope:{task_id:'invented',requested_signal_kinds:['STEPS']},permit:{}}),/INVALID_WEARABLE_AUTHORITY/);
 assert.throws(()=>x.request('HEART_RATE'),/WEARABLE_SIGNAL_OUTSIDE_TASK_PURPOSE/);assert.throws(()=>x.session.issueRead('STEPS_ONLY','2026-07-01T00:00:00.000Z',end30),/OUTSIDE_V1_RECENT_CONTEXT/);
 assert.throws(()=>x.session.issueRead('STEPS_ONLY',start30,'2026-09-21T00:00:00.000Z'),/OUTSIDE_V1_RECENT_CONTEXT/);assert.equal(calls,0);
 const step=x.request(),work=x.request('WORKOUT_ONLY');assert.deepEqual(step.scope.requested_signal_kinds,['STEPS']);assert.deepEqual(work.scope.requested_signal_kinds,['WORKOUT']);
 await adapter.requestReadAccess(step);await adapter.requestReadAccess(work);assert.deepEqual(seen,['STEPS','WORKOUT']);assert.equal(calls,2);
 await assert.rejects(adapter.readSteps({...step,scope:{...step.scope}}),/WEARABLE_SIGNAL_OUTSIDE_TASK_PURPOSE/);
 const anonymous=createSessionTaskStore();anonymous.start();anonymous.submit('Khỏe hơn');assert.equal(anonymous.captureWearableTaskProof(anonymous.reference()),undefined);anonymous.stop();
 }finally{x.dispose()}
});
check30('G2_POST_AWAIT_REVOKE_LOGOUT_ERASURE_TASK_AND_OWNER_ABA',async()=>{
 for(const reason of ['clear','logout','erase','task','ownerABA','expiry']){
 const x=await realSession30();try{const request=x.request();let finish,calls=0,cancels=0;const adapter=createAppleHealthReadAdapter(fake30({clearSession:()=>{cancels++},readSteps:(s,e)=>{calls++;return new Promise(r=>finish=()=>r({state:'AVAILABLE',count:6543,observedStartedAt:s,observedEndedAt:e}))}}));const pending=adapter.readSteps(request);assert.equal(calls,1);
 if(reason==='clear')x.session.clearSession();else if(reason==='logout'||reason==='erase')x.session.suspend();else if(reason==='task'){x.store.submit('Tôi muốn ngủ tốt hơn',{locale:'vi'});}else if(reason==='ownerABA'){await x.switchOwner('B');await x.switchOwner('A');}else x.advance(60001);
 finish();await assert.rejects(pending,/DISCARDED_STALE_EPOCH/);assert.equal(cancels,1,'one native clear per held operation '+reason);assert.equal(x.session.getSnapshot().retained,0,reason);
 await assert.rejects(adapter.readSteps(request),/DISCARDED_STALE_EPOCH/);assert.equal(calls,1,'no native call after invalidation '+reason);
 }finally{x.dispose()}
 }
});
check30('E08_SYNCHRONOUS_PURGE_USE_TIME_GUARD_AND_B_ISOLATION',async()=>{
 const a=await realSession30('A'),b=await realSession30('B');try{const av=await createAppleHealthReadAdapter(fake30()).readSteps(a.request()),bv=await createAppleHealthReadAdapter(fake30()).readSteps(b.request());const oldNested=av.signal.value;
 assert.equal(oldNested.quantity,6543);assert.equal(a.session.getSnapshot().retained,1);assert.throws(()=>JSON.stringify(av),/WEARABLE_CONTEXT_RAM_ONLY/);
 a.session.clearSession();assert.equal(a.session.getSnapshot().retained,0);assert.throws(()=>av.signal,/DISCARDED_STALE_EPOCH/);assert.throws(()=>oldNested.quantity,/DISCARDED_STALE_EPOCH/);assert.equal(bv.signal.value.quantity,6543);assert.equal(b.session.getSnapshot().retained,1);
 const current=await createAppleHealthReadAdapter(fake30()).readSteps(a.request());a.boundary.control.invalidateCurrentSession();assert.equal(a.session.getSnapshot().retained,0);assert.throws(()=>current.state,/DISCARDED_STALE_EPOCH/);
 }finally{a.dispose();b.dispose()}
});
check30('IOS_EMPTY_READ_AMBIGUITY_AND_ANDROID_ORIGINS',async()=>{
 const x=await realSession30();try{const no=await createAppleHealthReadAdapter(fake30({readSteps:async()=>({state:'NO_DATA'})})).readSteps(x.request());assert.equal(no.state,'NO_DATA');assert.equal(no.accessAmbiguity,'NO_OBSERVED_RECORDS_OR_ACCESS_NOT_SHARED');assert.equal('signal' in no,false);
 const origins=['com.google.android.healthconnect.synthetic.sensor','watch.sync.fixture'];const value=await createAndroidHealthConnectReadAdapter(fake30({readSteps:async(s,e)=>({state:'AVAILABLE',count:6000,observedStartedAt:s,observedEndedAt:e,dataOrigins:origins})})).readSteps(x.request());assert.deepEqual([...value.dataOrigins],origins);assert.equal(value.signal.value.quantity,6000);
 }finally{x.dispose()}
});
check30('NATIVE_OUTPUT_WINDOW_AND_EMPTY_WORKOUT_FALSIFIERS',async()=>{
 const x=await realSession30();try{const req=x.request();await assert.rejects(createAppleHealthReadAdapter(fake30({readSteps:async()=>({state:'AVAILABLE',count:5,observedStartedAt:'2026-07-01T00:00:00.000Z',observedEndedAt:end30})})).readSteps(req),/OUTSIDE_V1_RECENT_CONTEXT/);assert.equal(x.session.getSnapshot().retained,0);
 const no=await createAppleHealthReadAdapter(fake30({readWorkouts:async()=>({state:'AVAILABLE',workouts:[]})})).readWorkouts(x.request('WORKOUT_ONLY'));assert.equal(no[0].state,'NO_DATA');assert.equal(no[0].accessAmbiguity,'NO_OBSERVED_RECORDS_OR_ACCESS_NOT_SHARED');
 await assert.rejects(createAppleHealthReadAdapter({...fake30(),clearSession:undefined}).readSteps(x.request()),/WEARABLE_NATIVE_GUARD_UNAVAILABLE/);
 }finally{x.dispose()}
});
check30('NATIVE_PRE_EFFECT_ORDER_AND_GATED_OFF_NOT_DEVICE_PROOF',async()=>{
 const swift=await readFile(new URL('../modules/wearable-health/ios/WearableHealthModule.swift',import.meta.url),'utf8'),kt=await readFile(new URL('../modules/wearable-health/android/src/main/java/com/project100/wearablehealth/WearableHealthModule.kt',import.meta.url),'utf8');
 assert.match(swift,/healthLiveEnabled = false/);assert.match(swift,/admittedAuthority:.*nil/);assert.match(kt,/healthLiveEnabled = false/);assert.match(kt,/admittedAuthority:.*null/);
 for(const src of [swift,kt]){assert.match(src,/preEffectAuthority/);assert.match(src,/DISCARDED_STALE_EPOCH/);assert.match(src,/wearableConsentEpoch/);assert.match(src,/clearSession/);}
 assert.match(kt,/Build.VERSION.SDK_INT < 28/);assert.match(kt,/aggregate\(/);assert.match(kt,/StepsRecord.COUNT_TOTAL/);assert.match(kt,/response.dataOrigins/);assert.doesNotMatch(kt,/dataOriginFilter/);
 assert.match(swift,/requestAuthorization\(toShare: \[\], read: readTypes\)/);assert.doesNotMatch(swift,/authorizationStatus\s*\(/);assert.doesNotMatch(kt+swift,/heartRate|HeartRateRecord/);
});
check30('E08_NO_HEALTH_SINK_AND_8_LOCALE_GATEWAY',async()=>{
 const {privacyMessages,PRIVACY_TRANSLATION_KEYS}=await moduleAt('../i18n-privacy.ts');
 const keys=['wearableGatewayTitle','wearableGatewayBody','wearableGatewayScope','wearableGatewayUncertainty','wearableGatewayRevoke','wearableGatewayOff','wearableGatewayClear'];
 for(const loc of ['vi','en','zh-Hans','es','hi','ja','ko','ru'])for(const key of keys){assert.ok(PRIVACY_TRANSLATION_KEYS.includes(key));const v=privacyMessages[loc][key];assert.equal(typeof v,'string');assert.ok(v.length>5);assert.notEqual(v,key);if(!['vi','en'].includes(loc)){assert.notEqual(v,privacyMessages.vi[key]);assert.notEqual(v,privacyMessages.en[key]);}}
 const privacy=await readFile(new URL('../app/(tabs)/privacy.tsx',import.meta.url),'utf8'),owner=await readFile(new URL('../context/OwnerSessionContext.tsx',import.meta.url),'utf8'),hook=await readFile(new URL('../components/useM2Gateway.ts',import.meta.url),'utf8');
 for(const id of ['privacy-wearable-gateway-section','privacy-wearable-gateway-status','privacy-wearable-clear-session'])assert.ok(privacy.includes(id));assert.match(privacy,/onPress=\{\(\)\s*=>\s*ownerSession.wearable\?\.clearSession\(\)\}/);
 assert.match(owner,/const runErase[\s\S]*wearable.suspend\(\)/);assert.match(owner,/const runLogout[\s\S]*wearable.suspend\(\)/);assert.match(hook,/wearableSession\?\.bindTaskStore\(m3Store\)/);
 for(const rel of ['domain/m7/store.ts','lib/identity/web-session.ts','domain/m3/gateway-adapter.ts']){const s=await readFile(new URL('../'+rel,import.meta.url),'utf8');assert.doesNotMatch(s,/wearable|healthPayload|sensorPayload/iu);}
 assert.equal(networkCalls,0);
});

for (const { name, body } of tests) {
  await body();
  console.log('PASS ' + name);
}
assert.equal(networkCalls, 0);
console.log('Wearable W0: ' + tests.length + '/' + tests.length
  + ' PASS; provider/network/native calls = 0; persistence = 0.');
