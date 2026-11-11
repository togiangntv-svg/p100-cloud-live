// CODE_OFFLINE only. Actual candidate resolver, hook, flow, card, host, owner and stores.
// React scheduling/native/storage/provider boundaries below are deterministic doubles.
// This is not mounted React, native IME, device, clinical or production-issuer evidence.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script, createContext } from 'node:vm';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const ts = require('/workspace/100-human-development-Intelligence/node_modules/typescript/lib/typescript.js');
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidate = resolve(app, '../..');
const compiled = new Map();
const loadedSources = new Map();
const observations = [];
const json = value => JSON.parse(JSON.stringify(value));
const same = (a,b) => a && b && a.length === b.length && a.every((v,i)=>Object.is(v,b[i]));
const tick = () => new Promise(resolve => setImmediate(resolve));
const favorable = ['yes','none','none','adult','independent','supported','none_competing','suitable','5','3'];

async function harness({flow=true, mode='OWNED', locale='vi', managed=true, gatewayPatch={}, executors={}, recording=false,onCycleCreated,episodeOverride}={}) {
  const metrics={notifications:0,subscriptions:0,cleanups:0,stateChanges:0,provider:0,storageReadsDenied:0,storageWrites:0,nativeCalls:0,focus:0,blur:0,dismiss:0};
  const trace=[], hosts=[], cycles=[], modules=new Map(), cells=[], timers=new Map();
  let cursor=0, dirty=false, jobs=[], tree, api, phase='INITIAL', disposed=false, taskInputs=[];
  const blocked = name => () => { metrics.nativeCalls++; throw Error('FORBIDDEN_NATIVE_'+name); };
  const react={
    Fragment: 'Fragment',
    createElement(type,props,...children){return {type,props:{...props,children}};},
    useState(initial){const i=cursor++; if(!cells[i])cells[i]={value:typeof initial==='function'?initial():initial};return [cells[i].value,next=>{const value=typeof next==='function'?next(cells[i].value):next;if(!Object.is(value,cells[i].value)){cells[i].value=value;dirty=true;metrics.stateChanges++;}}];},
    useRef(initial){return cells[cursor++]??={current:initial};},
    useMemo(fn,deps){const i=cursor++;if(!same(cells[i]?.deps,deps))cells[i]={deps,value:fn()};return cells[i].value;},
    useCallback(fn,deps){return react.useMemo(()=>fn,deps);},
    useEffect(fn,deps){const i=cursor++;if(!same(cells[i]?.deps,deps)){const prior=cells[i];cells[i]={deps};jobs.push(()=>{prior?.cleanup?.();cells[i].cleanup=fn();});}},
    useLayoutEffect(fn,deps){return react.useEffect(fn,deps);},
    useSyncExternalStore(subscribe,read){react.useLayoutEffect(()=>{metrics.subscriptions++;const off=subscribe(()=>{metrics.notifications++;trace.push({kind:'notify',phase});dirty=true;});return ()=>{metrics.cleanups++;off();};},[subscribe]);return read();},
  };
  const animation=()=>({start:cb=>cb?.({finished:true}),stop(){}});
  class Value {constructor(v){this.value=v;}setValue(v){this.value=v;}stopAnimation(){}interpolate(){return this;}}
  const native={Keyboard:{dismiss(){metrics.dismiss++;}},AccessibilityInfo:{isReduceMotionEnabled:async()=>true,addEventListener:()=>({remove(){}}),setAccessibilityFocus(){}},
    Animated:{Value,View:'Animated.View',Image:'Animated.Image',timing:animation,spring:animation,sequence:animation,parallel:animation,delay:animation,loop:animation},
    AppState:{addEventListener:()=>({remove(){}})},Easing:{out:v=>v,in:v=>v,inOut:v=>v,back:v=>v,quad:1,cubic:1,sin:1},
    Platform:{OS:'ios',select:v=>v.ios},StyleSheet:{create:v=>v,absoluteFill:{},absoluteFillObject:{},hairlineWidth:1},useWindowDimensions:()=>({width:390,height:844}),findNodeHandle:()=>null,
    ...Object.fromEntries(['Image','Modal','Pressable','ScrollView','Text','TextInput','View'].map(v=>[v,v]))};
  const storage={getItem:async()=>{metrics.storageReadsDenied++;throw Error('STORAGE_READ_DENIED');},setItem:async()=>{metrics.storageWrites++;throw Error('STORAGE_WRITE_FORBIDDEN');},removeItem:async()=>{metrics.storageWrites++;throw Error('STORAGE_REMOVE_FORBIDDEN');}};
  const mocks=new Map([
    ['react',react],['react-native',native],['react-native-svg',{__esModule:true,default:'Svg',Defs:'Defs',ClipPath:'ClipPath',Polygon:'Polygon',Circle:'Circle',G:'G',RadialGradient:'RadialGradient',Stop:'Stop'}],['@expo/vector-icons',{Feather:'Feather',MaterialCommunityIcons:'Icons'}],
    ['expo-linear-gradient',{LinearGradient:'Gradient'}],['expo-status-bar',{StatusBar:'StatusBar'}],
    ['@react-native-async-storage/async-storage',storage],
    ['react-native-safe-area-context',{useSafeAreaInsets:()=>({top:47,bottom:34})}],
    ['react-native-keyboard-controller',{KeyboardAvoidingView:'KeyboardAvoidingView',useKeyboardState:select=>select({isVisible:true})}],
    ['@/components/WelcomeLogoAnimation',{WelcomeLogoAnimation:'Logo'}],['@/components/WelcomeExperience',{WelcomeExperience:'WelcomeExperience'}],
    ['@/components/Animated100Signature',{Animated100Signature:'Signature'}],['@/components/TrainerJourneyCard',{TrainerJourneyCard:'TrainerJourneyCard'}],
    ['@/context/TrainerRuntimeContext',{useOptionalTrainerJourney:()=>undefined}],
    ['@/hooks/useColors',{useColors:()=>({})}],
    ['@/context/LocalizationContext',{useLocale:()=>({locale,setLocale:v=>{locale=v;dirty=true;},t:key=>load('i18n.ts').translate(locale,key)})}],
  ]);
  const nativeModules=new Map([
    ['components/cameraC0Picker.ts',{expoCameraC0Picker:{requestCameraPermission:blocked('permission'),takePhoto:blocked('camera'),choosePhoto:blocked('library')}}],
    ['components/CameraLocalPreview.tsx',{createCameraLocalPreviewHandle:blocked('preview')}],
    ['lib/camera/expo-cache-cleanup.ts',{createExpoCacheCleanup:()=>({remove:blocked('cache-remove')})}],
    ['domain/m3/gateway-adapter.ts',{createM3GatewayAdapter:blocked('provider-adapter')}],
  ]);
  const context=createContext({console,crypto:globalThis.crypto,process:{env:Object.freeze({EXPO_PUBLIC_M3_RUNTIME_MODE:'fixture'})},AbortController,URL,TextEncoder,TextDecoder,
    fetch:()=>{metrics.provider++;throw Error('NETWORK_FORBIDDEN');},queueMicrotask,
    setTimeout(fn){const id=Symbol();timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>{const id=Symbol();timers.set(id,fn);return id;},cancelAnimationFrame:id=>timers.delete(id)});
  function load(name,parent=app+'/entry.ts') {
    if(mocks.has(name))return mocks.get(name);
    if(/\.(png|jpg)$/.test(name)){assert.ok(['../assets/images/100-v05-sunless-scene-v1.png','../assets/images/welcome-sunrise.png','../assets/images/scene_m2_sunless_golden.jpg'].includes(name),'S32_EXACT_PRESENTATION_ASSET');return name;}
    let file=name.startsWith('@/')?resolve(app,name.slice(2)):name.startsWith('.')?resolve(dirname(parent),name):resolve(app,name);
    if(!extname(file)){file=['.ts','.tsx','.mjs','.js'].map(ext=>file+ext).find(existsSync);assert.ok(file,'MISSING_DEPENDENCY '+name);}
    assert.ok(file.startsWith(candidate+sep),'OUTSIDE_CANDIDATE '+name);
    const rel=relative(app,file).replaceAll('\\','/');if(nativeModules.has(rel))return nativeModules.get(rel);
    if(modules.has(file))return modules.get(file).exports;
    assert.ok(existsSync(file),'UNKNOWN_DEPENDENCY '+name);
    const mod={exports:{}};modules.set(file,mod);
    if(!compiled.has(file)){const bytes=readFileSync(file);const source=bytes.toString('utf8');loadedSources.set(file,{path:relative(candidate,file),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});compiled.set(file,ts.transpileModule(source,{fileName:file.replace(/\.mjs$/,'.ts'),compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText);}
    const execute=new Script('(function(require,module,exports){'+compiled.get(file)+'\n})',{filename:file}).runInContext(context);
    execute(dep=>load(dep,file),mod,mod.exports);
    // Negative-test seam only: production source and real private ref checks remain loaded.
    if(rel==='domain/m6/self-walk.ts' && episodeOverride){
      const create=mod.exports.createSelfWalk;
      mod.exports.createSelfWalk=(options)=>{const real=create(options);return Object.freeze({...real,getCurrentEpisode:(ref)=>{const episode=real.getCurrentEpisode(ref);return episode ? episodeOverride(episode) : episode;}});};
    }
    if(rel==='domain/m2.ts'){
      const actual=mod.exports.resolveM2View;mod.exports.resolveM2View=(...args)=>{const result=actual(...args);trace.push({kind:'resolve',phase,snapshot:args[0],result});return result;};
    }
    if(rel==='components/useM2Gateway.ts'){
      const actual=mod.exports.useM2Gateway;mod.exports.useM2Gateway=(...args)=>{api=actual(...args);return api;};
    }
    if(rel==='domain/trainer-runtime/m7-cycle-authority.ts'){
      const actual=mod.exports.createTrainerM7CycleAuthority;mod.exports.createTrainerM7CycleAuthority=(...args)=>{const c=actual(...args);cycles.push(c);onCycleCreated?.(c,load);return c;};
    }
    if(rel==='components/m3-host-lifetime.ts'){
      const actual=mod.exports.createM3HostLifetime;mod.exports.createM3HostLifetime=(...args)=>{const h=actual(...args);hosts.push(h);return h;};
    }
    return mod.exports;
  }
  const fixture=load('scripts/fixtures/local-owner.mjs');
  const {createLocalOwnerBoundary}=load('domain/local-owner/boundary.ts');
  const clock=new fixture.FakeClock();const authority=fixture.fakeAuthority();const boundary=createLocalOwnerBoundary(authority.verifier,clock);
  async function session(owner=fixture.OWNER_A){authority.results.push({status:'verified',owner,validUntil:100000});const lease=await boundary.control.verifySession();boundary.control.finishHydration(lease);return {access:boundary.access,lease};}
  let ownerSession=await session();
  const adapter={provenance:'TEST_FIXTURE',processing:'ON_DEVICE',contract:'M3_GATEWAY_V1',async interpret(input){taskInputs.push(input);return {intent_type:'GOAL',interpreted_meaning:'Khỏe hơn',confidence:.95,uncertainty:null,missing_context:[],clarification_needed:false,clarification_question:null,safety_state:'CLEAR',suggested_next_role:'M4',task_kind:'general_health',context_effect:'NONE',used_context_ids:[],response:'Đã ghi nhận.'};},async revoke(){}};
  const props={initialPhase:'goal',reviewing:false,onGoalOpened(){},onClose(){},ownerSession:mode==='OWNED'?ownerSession:undefined,m3HostMode:mode,
    m7RecordActivation:recording?load('components/m7-record-activation.ts').createM7RecordActivation(ownerSession,80000,clock.now):undefined,
    m2Gateway:managed?{snapshot:{revision:'fixture-root-1',subject:{id:fixture.OWNER_A.subjectId,loading:'ready',profile:'new'},permission:{status:'allowed',revision:'1'},safety:'clear',goal:'none',explicitIntent:false,activeTask:{kind:'none'},returning:{kind:'none'},...gatewayPatch},executors,m3Access:{status:'denied',revision:1},m3StubAdapter:adapter}:undefined};
  const hook=load('components/useM2Gateway.ts').useM2Gateway;
  const Flow=flow?load('components/OpeningGoalFlow.tsx').OpeningGoalFlow:undefined;
  const Card=load('components/W01ProductCard.tsx').W01ProductCard;
  const RecordCard=load('components/M7RecordCard.tsx').M7RecordCard;
  const translate=key=>load('i18n.ts').translate(locale,key);
  const nodes=()=>{const result=[];function walk(v){if(Array.isArray(v))v.forEach(walk);else if(v?.props){result.push(v);if(v.type===Card)walk(Card(v.props));else if(v.type===RecordCard)walk(RecordCard(v.props));else walk(v.props.children);}}walk(tree);return result;};
  const find=id=>nodes().find(n=>n.props.testID===id);
  const inputHost={focus(){metrics.focus++;find('opening-goal-input')?.props.onFocus?.();},blur(){metrics.blur++;find('opening-goal-input')?.props.onBlur?.();}};
  function render(){assert.equal(disposed,false);for(let pass=0;pass<35;pass++){dirty=false;cursor=0;tree=flow?Flow(props):(hook(props.m2Gateway,locale,translate,props.ownerSession,undefined,props.m3HostMode,props.m7RecordActivation),null);const input=find('opening-goal-input');if(input?.props.ref)input.props.ref.current=inputHost;const scroll=find('opening-goal-scroll');if(scroll?.props.ref)scroll.props.ref.current={scrollTo(){}};const pending=jobs;jobs=[];pending.forEach(fn=>fn());if(!dirty)return;}assert.fail('UNBOUNDED_RENDER');}
  async function settle(){await tick();if(dirty)render();await tick();if(dirty)render();}
  function press(id){const n=find(id);assert.ok(n,'MISSING_CONTROL '+id);assert.notEqual(n.props.disabled,true,'DISABLED_CONTROL '+id);phase=id;return n.props.onPress();}
  render();await settle();
  if(flow && tree.type==='WelcomeExperience'){tree.props.onBegin();render();await settle();}
  return {load,find,nodes,render,settle,press,metrics,trace,props,clock,boundary,authority,fixture,session,
    get api(){return api;},get cycle(){return cycles.at(-1);},get dirty(){return dirty;},get store(){return hosts.at(-1)?.currentSlot()?.store;},get host(){return hosts.at(-1);},get inputs(){return taskInputs;},
    setPhase(v){phase=v;},setLocale(v){locale=v;render();},
    type(text){phase='TYPE';if(flow)find('opening-goal-input').props.onChangeText(text);else api.changeText(text);render();},
    async submit(text='Khỏe hơn'){this.type(text);phase='SUBMIT';if(flow)press('opening-goal-submit');else api.submit(text);await settle();},
    async accept(){phase='ACCEPT';if(flow)press('m5-goal-use');else assert.equal(api.acceptM5GoalChoice(),true);assert.equal(dirty,true,'ACCEPT_MUST_NOTIFY');await settle();},
    async start(){for(const answer of favorable){if(flow)press('w01-answer-'+answer);else assert.equal(api.w01.presentation.answer(answer),true);assert.equal(dirty,true,'W01_MUST_NOTIFY');await settle();}if(flow)press('w01-accept');else assert.equal(api.w01.presentation.act('accept'),true);await settle();if(flow)press('w01-start');else assert.equal(api.w01.presentation.act('start'),true);assert.equal(dirty,true,'START_MUST_NOTIFY');await settle();},
    async owner(owner){ownerSession=await session(owner);props.ownerSession=ownerSession;if(recording)props.m7RecordActivation=load('components/m7-record-activation.ts').createM7RecordActivation(ownerSession,80000,clock.now);if(props.m2Gateway)props.m2Gateway={...props.m2Gateway,snapshot:{...props.m2Gateway.snapshot,subject:{...props.m2Gateway.snapshot.subject,id:owner.subjectId}}};render();await settle();},
    revoke(){phase='REVOKE';boundary.control.invalidateCurrentSession();},
    dispose(){for(const c of cells)c?.cleanup?.();disposed=true;observations.push({...metrics});assert.equal(metrics.provider,0);assert.equal(metrics.storageWrites,0);assert.equal(metrics.nativeCalls,0);assert.equal(metrics.subscriptions,metrics.cleanups);},
  };
}
const latestResolution=h=>h.trace.filter(x=>x.kind==='resolve').at(-1);
// QA11 helpers stay in this admitted verifier and drive actual card callbacks.
async function qaPress(h,id){const result=h.press('m7-record-'+id);await h.settle();return result;}
async function qaR(h){for(const id of ['execution_extent-DID','action_change-UNCHANGED','user_stopped-false','problem_report-NONE','constraint-NONE_REPORTED'])await qaPress(h,id);assert.equal(await qaPress(h,'submit'),true);}
async function qaF(h){await qaPress(h,'feedback-VERY_GOOD');assert.equal(await qaPress(h,'feedback-submit'),true);}
async function qaNote(h,text){const n=h.find('m7-record-note');assert.ok(n);assert.equal(n.props.onChangeText(text),true);await h.settle();}
function qaComposer(h){const x=h.find('opening-goal-input');const before={value:x.props.value,ref:x.props.ref,key:x.props.key,focus:h.metrics.focus,blur:h.metrics.blur,dismiss:h.metrics.dismiss,inputs:h.inputs.length};return()=>{const y=h.find('opening-goal-input');assert.equal(y.props.value,before.value);assert.equal(y.props.ref,before.ref);assert.equal(y.props.key,before.key);assert.equal(h.metrics.focus,before.focus);assert.equal(h.metrics.blur,before.blur);assert.equal(h.metrics.dismiss,before.dismiss);assert.equal(h.inputs.length,before.inputs);};}
const assertNoGoalFallback=h=>{
  assert.equal(h.find('opening-goal-suggestions'),undefined);
  const question=h.find('opening-goal-focus-block').props.children[0];
  assert.equal(question.props.accessible,true);assert.equal(question.props.accessibilityElementsHidden,false);
  assert.equal(question.props.importantForAccessibility,'auto');assert.ok(question.props.children[0]);
  assert.equal(h.api.view?.kind==='goal',false,'Generic question never fabricates NEW');
  assert.equal(h.find('opening-goal-input').props.accessibilityLabel,h.load('i18n.ts').translate(h.api.effectiveLocale,'s32Placeholder'));
};

test('U1 U-GOAL-P/R/N: real acceptance publishes, stale ref fails, fresh selected getter confirms without NEW/Start',async()=>{
  const h=await harness();try{
    assert.equal(h.api.view,null);assertNoGoalFallback(h);await h.submit();
    const before=h.store.reference();assert.equal(h.store.getM5GoalChoiceReceipt(before),undefined);
    const notifications=h.metrics.notifications;await h.accept();assert.ok(h.metrics.notifications>notifications);
    assert.equal(h.store.getM5GoalChoiceReceipt(before),undefined);
    const after=h.store.reference();assert.ok(h.store.getM5GoalChoiceReceipt(after));assert.notEqual(after.view_revision,before.view_revision);
    assert.equal(latestResolution(h).snapshot.goal,'confirmed');assert.equal(h.api.view,null);
    assert.equal(h.store.selfWalk.getSnapshot().state,'IDLE');assertNoGoalFallback(h);
  }finally{h.dispose();}
});
test('U1 U01/U02/U03/U09: actual card Start, ordinary Stop and distinct End drive the shared raw/use projection',async()=>{
  const h=await harness();try{
    await h.submit();await h.accept();await h.start();
    assert.equal(latestResolution(h).result.kind,'reported_action');assert.equal(latestResolution(h).result.phase,'started');
    const oldView=h.api.view;h.api.beginPress('held');await h.settle();
    const before=h.metrics.stateChanges;h.press('w01-stop');assert.ok(h.metrics.stateChanges>before);await h.settle();
    assert.equal(h.api.w01.presentation.endedByUser,false);assert.ok(h.find('w01-end'));
    assert.equal(latestResolution(h).snapshot.activeTask.kind,'unknown');assert.equal(latestResolution(h).result,null);
    h.press('w01-end');assert.equal(h.dirty,true);await h.settle();
    assert.equal(latestResolution(h).result.phase,'ended_by_user');assert.equal(h.api.w01.presentation.endedByUser,true);
    assert.equal(h.api.acceptPress('held'),false);await h.settle();
    assert.equal(h.api.view.phase,'ended_by_user');assert.notEqual(h.api.view.token,oldView.token);
    assert.equal(h.api.m7Record,undefined);assertNoGoalFallback(h);
  }finally{h.dispose();}
});
test('U1 U06/U10/U-GOAL-UI: actual flow keeps editor identity/value across End in VI and JA',async()=>{
  for(const locale of ['vi','ja']){const h=await harness({locale});try{
    await h.submit();await h.accept();await h.start();h.type(locale==='vi'?'Toi dang go':'入力中');
    const input=h.find('opening-goal-input');input.props.onFocus();await h.settle();
    const before={ref:input.props.ref,key:input.props.key,value:input.props.value,focus:h.metrics.focus,blur:h.metrics.blur,dismiss:h.metrics.dismiss};
    h.press('w01-end');assert.equal(h.dirty,true);await h.settle();const after=h.find('opening-goal-input');
    assert.equal(after.props.ref,before.ref);assert.equal(after.props.key,before.key);assert.equal(after.props.value,before.value);
    assert.equal(h.metrics.focus,before.focus);assert.equal(h.metrics.blur,before.blur);assert.equal(h.metrics.dismiss,before.dismiss);
    assert.ok(after.props.accessibilityLabel.trim());assertNoGoalFallback(h);
  }finally{h.dispose();}}
});

test('U1 U04/U-GOAL-A: actual owner A1/B/A2 retires old editor, submit, choice and End callbacks; fresh A2 works',async()=>{
  const h=await harness();try{
    await h.submit();await h.accept();await h.start();
    const old=h.api, oldInput=h.find('opening-goal-input'), oldEnd=h.find('w01-end').props.onPress, oldStore=h.store;
    await h.owner(h.fixture.OWNER_B);h.type('B independent text');
    const b=h.find('opening-goal-input').props.value, count=h.inputs.length;
    oldInput.props.onChangeText('OLD A');old.changeText('OLD A');old.submit('OLD A');
    assert.equal(old.acceptM5GoalChoice(),false);assert.equal(oldEnd(),false);await h.settle();
    assert.equal(h.find('opening-goal-input').props.value,b);assert.equal(h.inputs.length,count);
    assert.notEqual(h.store,oldStore);assert.equal(latestResolution(h).snapshot.goal,'unknown');assertNoGoalFallback(h);
    await h.owner(h.fixture.OWNER_A);h.type('A2 current text');
    old.changeText('RESURRECT A1');oldInput.props.onChangeText('RESURRECT A1');old.submit('RESURRECT A1');
    assert.equal(oldEnd(),false);await h.settle();assert.equal(h.find('opening-goal-input').props.value,'A2 current text');
    await h.submit('A2 lawful goal');await h.accept();await h.start();
    assert.equal(latestResolution(h).result.phase,'started');assert.equal(h.press('w01-end'),true);await h.settle();
    assert.equal(latestResolution(h).result.phase,'ended_by_user');
  }finally{h.dispose();}
});

test('U1 U02/U04/U-GOAL-V: task edit invalidates current lifecycle but actual retained Stop still reduces authority',async()=>{
  const h=await harness();try{
    await h.submit();await h.accept();await h.start();const old=h.api, end=h.find('w01-end').props.onPress;
    const notifications=h.metrics.notifications;assert.equal(h.api.editM3Task('A revised goal'),true);
    assert.ok(h.metrics.notifications>notifications);assert.equal(h.dirty,true);
    assert.equal(end(),false);old.submit('STALE TASK');await h.settle();
    assert.equal(latestResolution(h).snapshot.goal,'unknown');assert.equal(latestResolution(h).result,null);
    assert.equal(h.find('w01-end'),undefined);assert.ok(h.find('w01-stop'));
    assert.equal(h.press('w01-stop'),true);await h.settle();assert.equal(h.store.selfWalk.getSnapshot().state,'STOPPED');
    assert.equal(h.store.selfWalk.getCurrentEpisode(h.store.reference()),undefined);assertNoGoalFallback(h);
    assert.equal(h.inputs.some(input=>input.content.current_text==='STALE TASK'),false);
    await h.accept();await h.start();assert.equal(latestResolution(h).result.phase,'started');
  }finally{h.dispose();}
});

test('U1 U05/U-GOAL-V: synchronous acceptance notification revokes owner before callback acknowledgement',async()=>{
  const h=await harness();let off;try{
    await h.submit();const store=h.store, before=store.reference();let revoked=false;
    off=store.subscribe(()=>{const ref=store.reference();if(!revoked&&ref&&store.getM5GoalChoiceReceipt(ref)){revoked=true;h.revoke();}});
    assert.equal(h.api.acceptM5GoalChoice(),false);assert.equal(revoked,true);assert.equal(h.dirty,true);
    assert.equal(store.getM5GoalChoiceReceipt(before),undefined);await h.settle();
    assert.equal(latestResolution(h).snapshot.goal,'unknown');assert.equal(latestResolution(h).result,null);assertNoGoalFallback(h);
    off();off=undefined;await h.owner(h.fixture.OWNER_A);await h.submit('Fresh lawful replacement');await h.accept();
    assert.equal(latestResolution(h).snapshot.goal,'confirmed');
  }finally{off?.();h.dispose();}
});

test('U1 U05/U-GOAL-V: reentrant acceptance notification edits selected task; old receipt cannot publish into successor',async()=>{
  const h=await harness();let off;try{
    await h.submit();const store=h.store;let changed=false;
    off=store.subscribe(()=>{const ref=store.reference();if(!changed&&ref&&store.getM5GoalChoiceReceipt(ref)){changed=true;assert.equal(store.edit(ref,'Successor task revision'),true);}});
    assert.equal(h.api.acceptM5GoalChoice(),false);assert.equal(changed,true);assert.equal(h.dirty,true);await h.settle();
    assert.equal(latestResolution(h).snapshot.goal,'unknown');assert.equal(latestResolution(h).result,null);
    off();off=undefined;await h.accept();assert.equal(latestResolution(h).snapshot.goal,'confirmed');
  }finally{off?.();h.dispose();}
});

const workout=subjectId=>({kind:'workout',id:'independent-workout',exercise:{id:'walk',label:'Independent existing workout'},completedSetIds:[],evidence:{subjectId,source:'fixture',observedAt:1,freshness:'current'}});
test('U1 U03/U05/U-GOAL-UI: reachable existing workout executor late rejection cannot publish old notice into A2',async()=>{
  let reject, calls=0;const pending=new Promise((_,no)=>{reject=no;});
  const h=await harness({flow:false,gatewayPatch:{activeTask:workout('fixture-subject-a')},executors:{continue_workout:()=>{calls++;return pending;}}});try{
    assert.equal(h.api.view.kind,'workout');const old=h.api, note=old.view.notes[0];
    const operation=old.choose(note);assert.equal(calls,1);await h.settle();
    await h.owner(h.fixture.OWNER_B);h.type('B text');await h.owner(h.fixture.OWNER_A);h.type('A2 text');
    reject(Error('fixture executor failed'));await operation;await h.settle();
    assert.equal(h.api.notice,'');assert.equal(h.api.text,'A2 text');assert.equal(h.api.disabled,false);
    await old.choose(note);assert.equal(calls,1);
    h.props.m2Gateway={...h.props.m2Gateway,executors:{continue_workout:()=>{calls++;}}};h.render();
    await h.api.choose(h.api.view.notes[0]);await h.settle();assert.equal(calls,2);
  }finally{h.dispose();}
});

test('U1 U03/U06: held workout display cannot authorize choose/press or supply stale submit context after real Start/End',async()=>{
  let calls=0;const h=await harness({flow:false,gatewayPatch:{activeTask:workout('fixture-subject-a')},executors:{continue_workout:()=>{calls++;}}});try{
    const oldView=h.api.view, oldNote=oldView.notes[0];h.type('Held user expression');h.api.beginPress(oldNote.id);await h.settle();
    await h.submit('An independent goal');await h.accept();await h.start();
    assert.equal(latestResolution(h).result.phase,'started');assert.equal(h.api.view.token,oldView.token);
    assert.equal(h.api.w01.presentation.act('end'),true);assert.equal(h.dirty,true);await h.settle();
    assert.equal(latestResolution(h).result.phase,'ended_by_user');assert.equal(h.api.acceptPress(oldNote.id),false);
    await h.api.choose(oldNote);assert.equal(calls,0);
    h.api.submit('New lawful expression after End');await h.settle();
    const submitted=h.inputs.at(-1);assert.equal(submitted.content.current_text,'New lawful expression after End');
    assert.deepEqual(json(submitted.content.recent_relevant_turns),[]);
  }finally{h.dispose();}
});

test('U1 U07/U-GOAL-N/A: anonymous/blocked/root-shaped goal facts never manufacture owned acceptance; free expression stays usable',async()=>{
  for(const mode of ['ANONYMOUS','BLOCKED']){const h=await harness({mode,gatewayPatch:{goal:'confirmed'}});try{
    assert.equal(latestResolution(h).snapshot.goal,'unknown');assert.equal(h.api.view,null);assertNoGoalFallback(h);
    h.type('Independent expression');assert.equal(h.find('opening-goal-input').props.value,'Independent expression');
    if(mode==='ANONYMOUS'){await h.submit();assert.equal(h.inputs.length,1);assert.equal(latestResolution(h).snapshot.goal,'unknown');assert.equal(h.api.w01,undefined);}
  }finally{h.dispose();}}
  const h=await harness({gatewayPatch:{goal:'confirmed'}});try{
    assert.equal(latestResolution(h).snapshot.goal,'unknown');await h.submit();
    assert.equal(latestResolution(h).snapshot.goal,'unknown');assert.equal(h.api.view,null);
    await h.accept();assert.equal(latestResolution(h).snapshot.goal,'confirmed');
  }finally{h.dispose();}
});

test('U1 U07/U-GOAL-C: actual resolver retains separately lawful NEW/workout/returning positives and rejects unsupported lifecycle facts',async()=>{
  const h=await harness({flow:false});try{
    const {resolveM2View}=h.load('domain/m2.ts');const {getM2Copy}=h.load('i18n-m2.ts');
    const copy=getM2Copy(key=>h.load('i18n.ts').translate('en',key));const root=h.props.m2Gateway.snapshot;
    assert.equal(resolveM2View(root,copy,[],Date.now()).kind,'goal');
    assert.equal(resolveM2View({...root,activeTask:workout(root.subject.id)},copy,['continue_workout'],Date.now()).kind,'workout');
    const returning={kind:'after_absence',plan:{id:'independent-plan',title:'Existing verified plan'},evidence:workout(root.subject.id).evidence};
    assert.equal(resolveM2View({...root,returning},copy,['continue_plan'],Date.now()).kind,'returning');
    for(const phase of ['started','ended_by_user']){const activeTask={kind:'reported_action',id:'w01',subjectId:root.subject.id,episode:'nonpersonal-episode',phase};
      const view=resolveM2View({...root,activeTask},copy,['continue_workout'],Date.now());
      assert.equal(view.kind,'reported_action');assert.equal(view.question,'');assert.equal(view.context,null);assert.equal(view.notes.length,0);
      assert.equal(resolveM2View({...root,activeTask:{...activeTask,subjectId:'other'}},copy,[],Date.now()),null);
      assert.equal(resolveM2View({...root,activeTask,safety:'hold'},copy,[],Date.now()),null);
    }
    for(const activeTask of [{kind:'unknown'},{kind:'other'}])assert.equal(resolveM2View({...root,activeTask},copy,[],Date.now()),null);
  }finally{h.dispose();}
});

test('U1 U10/U11: eight locales on actual card have distinct Stop/End, one card, neutral ended copy and no M7 activation',async()=>{
  const h=await harness();try{
    await h.submit();await h.accept();await h.start();
    for(const locale of ['en','vi','zh-Hans','es','hi','ja','ko','ru']){
      h.setLocale(locale);const copy=h.load('i18n-m6.ts').W01_COPY[locale];
      assert.equal(h.nodes().filter(n=>n.props.testID==='w01-started').length,1);
      assert.equal(h.find('w01-stop').props.children[0].props.children[0],copy.actions.stop);
      assert.equal(h.find('w01-end').props.children[0].props.children[0],copy.actions.end);
      assert.notEqual(copy.actions.stop,copy.actions.end);assertNoGoalFallback(h);assert.equal(h.api.m7Record,undefined);
    }
    assert.equal(h.press('w01-end'),true);await h.settle();
    for(const locale of ['en','vi','zh-Hans','es','hi','ja','ko','ru']){
      h.setLocale(locale);const copy=h.load('i18n-m6.ts').W01_COPY[locale];
      assert.equal(h.nodes().filter(n=>n.props.testID==='w01-outcome-stopped').length,1);
      assert.equal(h.find('w01-outcome-stopped').props.children[0],copy.ended);
      assert.equal(h.find('w01-end'),undefined);assertNoGoalFallback(h);
    }
  }finally{h.dispose();}
});

test('U1 U04/U07/U-GOAL-V: actual selected-task A/B/A switch cannot revive old receipt or End',async()=>{
  const h=await harness();try{
    await h.submit('Private goal alpha');await h.accept();await h.start();const old=h.api, taskA=h.store.reference();
    assert.equal(h.press('w01-end'),true);await h.settle();
    assert.equal(JSON.stringify(latestResolution(h).snapshot).includes('Private goal alpha'),false);
    assert.equal(latestResolution(h).snapshot.activeTask.kind,'reported_action');
    await h.submit('Private goal beta');const taskB=h.store.reference();assert.notEqual(taskB.task_id,taskA.task_id);
    assert.equal(h.api.switchM3Task(taskA.task_id),'Private goal alpha');assert.equal(h.dirty,true);await h.settle();
    assert.equal(h.store.getM5GoalChoiceReceipt(taskA),undefined);assert.equal(h.store.selfWalk.getCurrentEpisode(taskA),undefined);
    assert.equal(latestResolution(h).snapshot.goal,'unknown');assert.equal(latestResolution(h).result,null);
    const n=h.inputs.length;old.submit('OLD SWITCH');assert.equal(old.acceptM5GoalChoice(),false);await h.settle();assert.equal(h.inputs.length,n);
    h.type('New current expression');assert.equal(h.find('opening-goal-input').props.value,'New current expression');
    assert.equal(h.api.switchM3Task(taskB.task_id),'Private goal beta');await h.settle();
    await h.accept();await h.start();assert.equal(h.press('w01-end'),true);await h.settle();
    assert.equal(latestResolution(h).result.phase,'ended_by_user');
  }finally{h.dispose();}
});

test('U1 U07/U-GOAL-UI: unmanaged legacy composer and managed-null composer both preserve lawful expression',async()=>{
  for(const managed of [false,true]){const h=await harness({managed});try{
    assert.equal(h.api.managed,managed);
    assert.equal(Boolean(h.find('opening-goal-suggestions')),!managed);
    h.type('Independent current expression');const input=h.find('opening-goal-input');
    assert.equal(input.props.value,'Independent current expression');assert.ok(input.props.accessibilityLabel.trim());
    h.press('opening-goal-submit');assert.equal(h.dirty,true);await h.settle();
    assert.equal(h.store.getSnapshot().tasks.at(-1).source_input,'Independent current expression');
    if(managed)assertNoGoalFallback(h);
  }finally{h.dispose();}}
});

test('U1 U05/U07: actual owner expiry notification removes current End before render',async()=>{
  const h=await harness();try{
    await h.submit();await h.accept();await h.start();h.press('w01-end');await h.settle();
    const old=h.api, store=h.store, ref=store.reference(), notifications=h.metrics.notifications;
    h.clock.advance(100001);assert.ok(h.metrics.notifications>notifications);assert.equal(h.dirty,true);
    assert.equal(store.selfWalk.getCurrentEpisode(ref),undefined);old.submit('EXPIRED');assert.equal(old.acceptM5GoalChoice(),false);
    await h.settle();assert.equal(latestResolution(h).result,null);assertNoGoalFallback(h);
  }finally{h.dispose();}
});

test('U1 U07/U-GOAL-N: root-shaped lifecycle fields cannot substitute for the canonical current episode',async()=>{
  for(const mode of ['OWNED','ANONYMOUS','BLOCKED']){
    const h=await harness({flow:false,mode,gatewayPatch:{goal:'confirmed',activeTask:{kind:'reported_action',id:'forged-w01',subjectId:'fixture-subject-a',episode:'claimed-episode',phase:'ended_by_user'}}});
    try{assert.equal(latestResolution(h).snapshot.goal,'unknown');assert.equal(latestResolution(h).snapshot.activeTask.kind,'unknown');assert.equal(h.api.view,null);}
    finally{h.dispose();}
  }
});

after(()=>console.log('U1_OFFLINE_EVIDENCE '+JSON.stringify({
  tier:'CODE_OFFLINE',compilerVersion:ts.version,fixtures:observations,
  sources:[...loadedSources.values()].sort((a,b)=>a.path.localeCompare(b.path)),
  nativeIME:'NOT_RUN',mountedReact:'NOT_RUN',device:'NOT_RUN',
})));

test('U2 E02/E03/D09 actual flow→hook→host→F card records only explicit End feedback; composer stays independent', async () => {
  for (const locale of ['vi', 'ja']) {
    const h = await harness({ recording: true, locale });
    try {
      await h.submit(); await h.accept(); await h.start();
      assert.equal(h.find('m7-record-feedback-VERY_GOOD'), undefined);
      h.type(locale === 'vi' ? 'Tôi đang tự viết ý riêng' : '自分で入力している');
      const input = h.find('opening-goal-input'); input.props.onFocus(); await h.settle();
      const before = { value: input.props.value, ref: input.props.ref, key: input.props.key,
        focus: h.metrics.focus, blur: h.metrics.blur, dismiss: h.metrics.dismiss, inputs: h.inputs.length };
      h.press('w01-end'); await h.settle();
      assert.ok(h.find('m7-record-feedback-VERY_GOOD'));
      assert.equal(h.find('m7-record-feedback-submit'), undefined);
      h.press('m7-record-feedback-PROBLEM_REPORTED'); await h.settle();
      assert.equal(h.press('m7-record-feedback-submit'), true); await h.settle();
      const actual = h.api.m7Record.presentation.feedback;
      assert.equal(actual.feedback.experience, 'PROBLEM_REPORTED');
      assert.equal(actual.feedback.locale, locale); assert.equal(actual.outcome, undefined);
      assert.equal(h.api.m7Record.presentation.notice, 'saved');
      assert.equal(h.find('m7-feedback-current').props.children[0], h.load('i18n-m7-record.ts').M7_FEEDBACK_COPY[locale].problem);
      const after = h.find('opening-goal-input');
      assert.equal(after.props.value, before.value); assert.equal(after.props.ref, before.ref); assert.equal(after.props.key, before.key);
      assert.equal(h.metrics.focus, before.focus); assert.equal(h.metrics.blur, before.blur); assert.equal(h.metrics.dismiss, before.dismiss);
      assert.equal(h.inputs.length, before.inputs, 'F never submits M3 text');
      // P1 deliberately holds the typing-time display; the fresh projection and
      // actual episode, not that held presentation, must retain End after F.
      assert.equal(h.api.view.phase, 'started');
      assert.equal(latestResolution(h).result.phase, 'ended_by_user');
      assert.equal(h.store.selfWalk.getCurrentEpisode(h.store.reference()).end.kind, 'USER_REPORTED_END');
      assert.equal(h.store.m7Outcome.readNextCycle(undefined), undefined);
    } finally { h.dispose(); }
  }
});

test('U2 P03/D10 held F submit across actual locale render is stale; current card choice succeeds with provenance', async () => {
  const h = await harness({ recording: true });
  try {
    await h.submit(); await h.accept(); await h.start(); h.press('w01-end'); await h.settle();
    h.type('independent current text');
    h.press('m7-record-feedback-VERY_GOOD'); await h.settle();
    const held = h.find('m7-record-feedback-submit').props.onPress;
    h.setLocale('ja'); await h.settle();
    assert.equal(held(), false); assert.equal(h.find('m7-record-feedback-submit'), undefined);
    assert.equal(h.find('opening-goal-input').props.value, 'independent current text');
    h.press('m7-record-feedback-FELT_MANAGEABLE'); await h.settle();
    assert.equal(h.press('m7-record-feedback-submit'), true); await h.settle();
    h.setLocale('en'); await h.settle();
    assert.equal(h.find('m7-feedback-current').props.children[0], '無理なく感じた');
    assert.equal(h.find('m7-feedback-current').props.accessibilityLanguage, 'ja');
    assert.equal(h.api.m7Record.presentation.feedback.feedback.locale, 'ja');
  } finally { h.dispose(); }
});

test('U2 E09/D04 actual card F deletion keeps R and accurate scoped copy; held delete cannot erase newer F', async () => {
  const h = await harness({ recording: true });
  try {
    await h.submit(); await h.accept(); await h.start(); h.press('w01-end'); await h.settle();
    for (const id of ['execution_extent-DID','action_change-UNCHANGED','user_stopped-false','problem_report-NONE','constraint-NONE_REPORTED']) {
      h.press('m7-record-'+id); await h.settle();
    }
    assert.equal(h.press('m7-record-submit'), true); await h.settle();
    const report = h.api.m7Record.presentation.outcome;
    h.press('m7-record-feedback-VERY_GOOD'); await h.settle(); h.press('m7-record-feedback-submit'); await h.settle();
    h.press('m7-record-feedback-delete'); await h.settle(); const held = h.find('m7-record-confirm').props.onPress;
    assert.equal(h.find('m7-record-confirm').props.children[0].props.children[1], 'Xóa phản hồi này');
    h.press('m7-record-keep'); await h.settle();
    h.press('m7-record-feedback-correct'); await h.settle(); h.press('m7-record-feedback-FELT_TOO_MUCH'); await h.settle();
    h.press('m7-record-feedback-submit'); await h.settle(); assert.equal(held(), false);
    h.press('m7-record-feedback-delete'); await h.settle(); assert.equal(h.press('m7-record-confirm'), true); await h.settle();
    assert.equal(h.api.m7Record.presentation.outcome, report);
    assert.equal(h.api.m7Record.presentation.feedback, undefined);
    assert.equal(h.find('m7-feedback-ack').props.children[0], h.load('i18n-m7-record.ts').M7_FEEDBACK_COPY.vi.deletedFeedback);
    assert.equal(h.find('m7-record-feedback-VERY_GOOD'), undefined);
    assert.ok(h.find('m7-record-current-report'));
  } finally { h.dispose(); }
});

test('U2 E11 actual A1→B→A2 host/card callbacks never submit old F into successor', async () => {
  const h = await harness({ recording: true });
  try {
    await h.submit(); await h.accept(); await h.start(); h.press('w01-end'); await h.settle();
    h.press('m7-record-feedback-VERY_GOOD'); await h.settle(); const held = h.find('m7-record-feedback-submit').props.onPress;
    const oldStore = h.store;
    await h.owner(h.fixture.OWNER_B); h.type('B text'); assert.equal(held(), false);
    assert.equal(oldStore.m7Outcome.hasRetained(), false); assert.equal(h.find('opening-goal-input').props.value, 'B text');
    await h.owner(h.fixture.OWNER_A); await h.submit('A2 goal'); await h.accept(); await h.start(); h.press('w01-end'); await h.settle();
    assert.equal(held(), false); assert.equal(h.api.m7Record.presentation.feedback, undefined);
    h.press('m7-record-feedback-FELT_MANAGEABLE'); await h.settle(); assert.equal(h.press('m7-record-feedback-submit'), true); await h.settle();
    assert.equal(h.api.m7Record.presentation.feedback.feedback.experience, 'FELT_MANAGEABLE');
  } finally { h.dispose(); }
});

test('U2 T02 actual card final delete at facade64 erases and settles exact receipt before ACK; USE survives', async () => {
  const h = await harness({ recording: true }); let off;
  try {
    await h.submit(); await h.accept(); await h.start(); h.press('w01-end'); await h.settle();
    h.press('m7-record-feedback-VERY_GOOD'); await h.settle(); h.press('m7-record-feedback-submit'); await h.settle();
    const cycle = h.cycle, receipt = cycle.getSnapshot().record_outcome_receipt;
    const next = cycle.allowNextCycle({ type:'USER_ALLOWED_NEXT_CYCLE', request_id:'u2-test-next' });
    while (cycle.getSnapshot().request_count < 64) {
      const id='u2-fill-'+cycle.getSnapshot().request_count;
      assert.equal(cycle.submitOutcome({type:'USER_SUBMITTED_OUTCOME',request_id:id}).state,'GRANTED');
    }
    const { observeM7Purpose, readM7Purpose } = h.load('domain/m7/outcome.ts');
    const seen=[];
    off=observeM7Purpose(cycle.access,()=>seen.push({old:readM7Purpose(cycle.access,receipt,'RECORD_OUTCOME'),
      retained:h.store.m7Outcome.hasRetained(),notice:h.host.currentSlot().record.presentation().notice}));
    h.press('m7-record-feedback-delete'); await h.settle();
    assert.equal(h.press('m7-record-confirm'),true); await h.settle();
    assert.equal(seen.length,1); assert.equal(seen[0].old,undefined); assert.equal(seen[0].retained,false);
    assert.notEqual(seen[0].notice,'deletedFeedback');
    assert.equal(h.api.m7Record.presentation.notice,'deletedFeedback'); assert.equal(h.api.m7Record.presentation.state,'DELETED');
    assert.ok(h.find('m7-record-deleted'));
    assert.equal(readM7Purpose(cycle.access,next.receipt,'USE_NEXT_CYCLE'),next.receipt.revision);
    assert.equal(cycle.getSnapshot().request_count,64);
  }finally{off?.();h.dispose();}
});

test('U2 T27 explicit independent text after F uses actual M3 once, without automatic F transfer', async () => {
  const h=await harness({recording:true});
  try {
    await h.submit();await h.accept();await h.start();h.press('w01-end');await h.settle();
    h.press('m7-record-feedback-PROBLEM_REPORTED');await h.settle();h.press('m7-record-feedback-submit');await h.settle();
    const count=h.inputs.length;
    h.type('Help me organize tomorrow without exercise advice');
    assert.equal(h.inputs.length,count);
    h.press('opening-goal-submit');await h.settle();
    assert.equal(h.inputs.length,count+1);
    assert.equal(h.inputs.at(-1).content.current_text,'Help me organize tomorrow without exercise advice');
    assert.equal(JSON.stringify(h.inputs.at(-1)).includes('Có vấn đề'),false);
    assert.equal(h.store.selfWalk.getCurrentEpisode(h.store.reference()),undefined);
  }finally{h.dispose();}
});

test('U2 actual purpose purge removes current and pending F display/drafts without granting replacement', async () => {
  const h=await harness({recording:true});
  try {
    await h.submit();await h.accept();await h.start();h.press('w01-end');await h.settle();
    h.press('m7-record-feedback-VERY_GOOD');await h.settle();h.press('m7-record-feedback-submit');await h.settle();
    h.press('m7-record-feedback-correct');await h.settle();h.press('m7-record-feedback-FELT_TOO_MUCH');await h.settle();
    const old=h.find('m7-record-feedback-submit').props.onPress;
    h.cycle.revokeRecordOutcome({type:'TRUSTED_REVOKED_OUTCOME',request_id:'purpose-loss'});await h.settle();
    assert.equal(h.api.m7Record.presentation.feedback,undefined);
    assert.equal(h.api.m7Record.presentation.feedbackDraft,undefined); assert.equal(h.api.m7Record.presentation.notice,undefined);
    assert.equal(old(),false);
    h.cycle.submitOutcome({type:'USER_SUBMITTED_OUTCOME',request_id:'regrant-not-intake'});await h.settle();
    assert.equal(h.api.m7Record.presentation.canFeedback,false); assert.equal(h.find('m7-feedback-current'),undefined);
  }finally{h.dispose();}
});

test('U2 T31 actual eight-locale card shows selected F labels and component-exact controls through both/retracted/deleted', async () => {
  for(const locale of ['vi','en','zh-Hans','es','hi','ja','ko','ru']) {
    const h=await harness({recording:true,locale});
    try {
      await h.submit();await h.accept();await h.start();h.press('w01-end');await h.settle();
      const copy=h.load('i18n-m7-record.ts').M7_FEEDBACK_COPY[locale];
      for(const [enumValue,key] of [['VERY_GOOD','veryGood'],['FELT_MANAGEABLE','manageable'],['FELT_TOO_MUCH','tooMuch'],['PROBLEM_REPORTED','problem']])
        assert.equal(h.find('m7-record-feedback-'+enumValue).props.children[0].props.children[1],copy[key]);
      h.press('m7-record-feedback-VERY_GOOD');await h.settle();h.press('m7-record-feedback-submit');await h.settle();
      assert.equal(h.find('m7-feedback-ack').props.children[0],copy.saved);
      for(const id of ['execution_extent-UNKNOWN','action_change-UNKNOWN','user_stopped-false','problem_report-NONE','constraint-NONE_REPORTED']){h.press('m7-record-'+id);await h.settle();}
      h.press('m7-record-submit');await h.settle();assert.ok(h.find('m7-record-delete-both'));
      h.press('m7-record-feedback-retract');await h.settle();h.press('m7-record-confirm');await h.settle();
      assert.equal(h.find('m7-feedback-ack').props.children[0],copy.retracted);assert.ok(h.find('m7-record-current-report'));
      h.press('m7-record-delete-both');await h.settle();
      assert.equal(h.find('m7-record-confirm').props.children[0].props.children[1],copy.deleteBoth);
      h.press('m7-record-confirm');await h.settle();
      assert.equal(h.api.m7Record.presentation.notice,'deletedBoth');assert.ok(h.find('m7-record-deleted'));
      assert.equal(h.find('m7-feedback-current'),undefined);assert.equal(h.find('m7-record-current-report'),undefined);
    }finally{h.dispose();}
  }
});

test('U2 T30 actual F edit/retract/delete/keep/exit preserve VI/JA composer identity and do not inject text', async () => {
  for(const locale of ['vi','ja']){
    const h=await harness({recording:true,locale});
    try {
      await h.submit();await h.accept();await h.start();h.press('w01-end');await h.settle();
      h.type(locale==='vi'?'Đang gõ nội dung riêng':'まだ入力している');
      const input=h.find('opening-goal-input');input.props.onFocus();await h.settle();
      const before={value:input.props.value,ref:input.props.ref,key:input.props.key,focus:h.metrics.focus,blur:h.metrics.blur,dismiss:h.metrics.dismiss,inputs:h.inputs.length};
      const check=()=>{const x=h.find('opening-goal-input');assert.equal(x.props.value,before.value);assert.equal(x.props.ref,before.ref);assert.equal(x.props.key,before.key);
        assert.equal(h.metrics.focus,before.focus);assert.equal(h.metrics.blur,before.blur);assert.equal(h.metrics.dismiss,before.dismiss);assert.equal(h.inputs.length,before.inputs);};
      for(const id of ['feedback-VERY_GOOD','feedback-submit','feedback-correct','feedback-FELT_TOO_MUCH','feedback-submit',
        'feedback-delete','keep','feedback-retract','confirm','feedback-delete','confirm']) {
        h.press('m7-record-'+id);await h.settle();check();
      }
      assert.equal(h.api.m7Record.presentation.notice,'deletedFeedback');
      assert.equal(h.api.m7Record.presentation.feedback,undefined);
    }finally{h.dispose();}
  }
});

test('U2 T34 F-only mutation/deletion leaves current M5/End/R-derived USE basis unchanged', async () => {
  const h=await harness({recording:true});
  try {
    await h.submit();await h.accept();await h.start();h.press('w01-end');await h.settle();
    for(const id of ['execution_extent-PARTIAL','action_change-UNCHANGED','user_stopped-false','problem_report-NONE','constraint-TIME_CONSTRAINT']){h.press('m7-record-'+id);await h.settle();}
    h.press('m7-record-submit');await h.settle();
    const ref=h.store.reference(),goal=h.store.getM5GoalChoiceReceipt(ref),report=h.api.m7Record.presentation.outcome;
    const next=h.cycle.allowNextCycle({type:'USER_ALLOWED_NEXT_CYCLE',request_id:'independent-use'});
    const basis=json(h.store.m7Outcome.readNextCycle(next.receipt));
    h.press('m7-record-feedback-VERY_GOOD');await h.settle();h.press('m7-record-feedback-submit');await h.settle();
    h.press('m7-record-feedback-delete');await h.settle();h.press('m7-record-confirm');await h.settle();
    assert.equal(h.store.getM5GoalChoiceReceipt(h.store.reference()),goal);
    assert.equal(h.api.m7Record.presentation.outcome,report);
    assert.deepEqual(json(h.store.m7Outcome.readNextCycle(next.receipt)),basis);
    assert.equal(h.cycle.getSnapshot().use_next_cycle_receipt,next.receipt);
    assert.equal(latestResolution(h).result.phase,'ended_by_user');
  }finally{h.dispose();}
});

test('U2 actual card R-scoped erase keeps F controls and truthful R-deleted status across locale change', async () => {
  const h=await harness({recording:true});
  try {
    await h.submit();await h.accept();await h.start();h.press('w01-end');await h.settle();
    for(const id of ['execution_extent-DID','action_change-UNCHANGED','user_stopped-false','problem_report-NONE','constraint-NONE_REPORTED']){h.press('m7-record-'+id);await h.settle();}
    h.press('m7-record-submit');await h.settle();h.press('m7-record-feedback-VERY_GOOD');await h.settle();h.press('m7-record-feedback-submit');await h.settle();
    const f=h.api.m7Record.presentation.feedback;
    h.press('m7-record-delete');await h.settle();h.press('m7-record-confirm');await h.settle();
    assert.equal(h.api.m7Record.presentation.feedback,f);assert.equal(h.api.m7Record.presentation.outcome,undefined);
    assert.equal(h.find('m7-report-status').props.children[0],h.load('i18n-m7-record.ts').M7_FEEDBACK_COPY.vi.deletedReport);
    assert.ok(h.find('m7-record-feedback-correct'));assert.equal(h.find('m7-record-execution_extent-DID'),undefined);
    h.setLocale('ja');await h.settle();
    assert.equal(h.find('m7-report-status').props.children[0],h.load('i18n-m7-record.ts').M7_FEEDBACK_COPY.ja.deletedReport);
    h.press('m7-record-feedback-correct');await h.settle();h.press('m7-record-feedback-FELT_TOO_MUCH');await h.settle();
    assert.equal(h.press('m7-record-feedback-keep'),true);await h.settle();
    assert.equal(h.api.m7Record.presentation.feedback,f);assert.equal(h.api.m7Record.presentation.feedbackDraft,undefined);
  }finally{h.dispose();}
});

for(const order of ['F-first','erase-first'])test('QA11 T17 actual card old R final-delete confirmation '+order,async()=>{
  const h=await harness({recording:true});let off;
  try {
    await h.submit();await h.accept();await h.start();h.press('w01-end');await h.settle();await qaR(h);
    await qaPress(h,'delete');const held=h.find('m7-record-confirm').props.onPress;
    if(order==='F-first'){
      await qaF(h);const f=h.api.m7Record.presentation.feedback,receipt=h.cycle.getSnapshot().record_outcome_receipt;
      const result=held();await h.settle();
      assert.equal(h.api.m7Record.presentation.feedback,f);assert.equal(h.cycle.getSnapshot().record_outcome_receipt,receipt);
      assert.notEqual(h.api.m7Record.presentation.notice,'deletedBoth');
      if(result===false){await qaPress(h,'delete');assert.equal(await qaPress(h,'confirm'),true);}
      assert.equal(h.api.m7Record.presentation.outcome,undefined);assert.equal(h.api.m7Record.presentation.feedback,f);
      assert.equal(h.api.m7Record.presentation.notice,'deletedReport');
    } else {
      const r=h.host.currentSlot().record,store=h.store;let seen=0;const attempts=[];
      off=store.m7Outcome.subscribe(()=>{if(seen++)return;attempts.push(r.presentation().chooseFeedback('VERY_GOOD'));attempts.push(r.presentation().submitFeedback());});
      assert.equal(held(),true);await h.settle();off();off=undefined;
      assert.equal(seen,1);assert.deepEqual(attempts,[false,false]);assert.equal(store.m7Outcome.hasRetained(),false);
      assert.equal(h.api.m7Record.presentation.feedback,undefined);assert.equal(h.api.m7Record.presentation.notice,'deletedReport');
      assert.equal(h.cycle.getSnapshot().record_outcome_receipt,undefined);
    }
  }finally{off?.();h.dispose();}
});

test('QA11 T07 actual rendered reads after pre-Start Stop End and regrant do not mint intake',async()=>{
  const h=await harness({recording:true});try{
    await h.submit();await h.accept();for(const answer of favorable){h.press('w01-answer-'+answer);await h.settle();}
    const store=h.store,ref=store.reference(),p=store.selfWalk.getSnapshot();
    assert.equal(store.selfWalk.stop(ref,p,'qa-ui-stop-before-start').state,'DENIED');
    for(let i=0;i<3;i++){
      h.render();await h.settle();h.api.m7Record.presentation;store.selfWalk.getEpisode(ref);store.selfWalk.getCurrentEpisode(ref);
      h.cycle.submitOutcome({type:'USER_SUBMITTED_OUTCOME',request_id:'qa-render-regrant-'+i});
      assert.equal(store.selfWalk.end(ref,p,'qa-ui-pre-end-'+i).state,'DENIED');
      assert.equal(store.m7Outcome.getActivityVersion(),0);assert.equal(store.m7Outcome.canRecord(ref,'F'),false);
      assert.equal(h.find('m7-record-feedback-submit'),undefined);
    }
    h.press('w01-accept');await h.settle();h.press('w01-start');await h.settle();
    h.press('w01-stop');await h.settle();h.press('w01-end');await h.settle();await qaF(h);
    assert.equal(h.api.m7Record.presentation.feedback.state,'ACTIVE');
  }finally{h.dispose();}
});

const qaLocales=['vi','en','zh-Hans','es','hi','ja','ko','ru'];
for(const submitted of ['R','F'])for(const nestedRevoke of [false,true])test(`QA11 C1 unused ${submitted} acquisition preserves newer drafts nestedExplicitRevoke=${nestedRevoke}`,async()=>{
  const h=await harness({recording:true});let off;try{
    await h.submit();await h.accept();await h.start();h.press('w01-end');await h.settle();
    for(const id of ['execution_extent-DID','action_change-UNCHANGED','user_stopped-false','problem_report-NONE','constraint-NONE_REPORTED'])await qaPress(h,id);
    await qaNote(h,'QA original R');await qaPress(h,'feedback-VERY_GOOD');
    h.type('QA composer independent of acquisition');const check=qaComposer(h);
    const record=h.host.currentSlot().record,store=h.store,cycle=h.cycle;
    const {observeM7Purpose,readM7RecordPurposeState}=h.load('domain/m7/outcome.ts');
    let grantObserved=0,cleanupObserved=0;const errors=[];
    off=observeM7Purpose(cycle.access,()=>{try{
      const state=readM7RecordPurposeState(cycle.access);
      if(state.granted&&state.closure===0&&!grantObserved++){
        assert.equal(record.presentation().setEvidenceText('QA newer R from grant observer'),true);
        assert.equal(record.presentation().chooseFeedback('FELT_TOO_MUCH'),true);
      }else if(!state.granted&&state.closure===1&&!cleanupObserved++){
        if(nestedRevoke)assert.equal(cycle.revokeRecordOutcome({type:'TRUSTED_REVOKED_OUTCOME',request_id:'qa-explicit-nested-loss'}).state,'REVOKED');
      }
    }catch(e){errors.push(e);}});
    const old=h.find(submitted==='R'?'m7-record-submit':'m7-record-feedback-submit').props.onPress;
    assert.equal(old(),false);await h.settle();assert.deepEqual(errors,[]);assert.equal(grantObserved,1);assert.equal(cleanupObserved,1);check();
    const v=record.presentation();assert.equal(store.m7Outcome.hasRetained(),false);assert.equal(v.notice,undefined);
    assert.equal(cycle.getSnapshot().record_outcome_receipt,undefined);assert.equal(store.m7Outcome.canRecord(store.reference(),'F'),false);
    if(nestedRevoke){assert.equal(v.draft.evidence_text,'');assert.equal(v.feedbackDraft,undefined);assert.equal(readM7RecordPurposeState(cycle.access).closure,2);}
    else{
      assert.equal(v.draft.evidence_text,'QA newer R from grant observer');assert.equal(v.feedbackDraft.experience,'FELT_TOO_MUCH');
      assert.equal(readM7RecordPurposeState(cycle.access).closure,1);assert.equal(v.canSubmitFeedback,false);
      off();off=undefined;
      // The temporary cleanup exception cannot mask a later real revocation.
      assert.equal(cycle.revokeRecordOutcome({type:'TRUSTED_REVOKED_OUTCOME',request_id:'qa-explicit-later-loss'}).state,'REVOKED');await h.settle();
      assert.equal(record.presentation().draft.evidence_text,'');assert.equal(record.presentation().feedbackDraft,undefined);check();
    }
  }finally{off?.();h.dispose();}
});

for(const priorReceipt of [false,true])test(`QA11 C1 raw observer before store sees cleared drafts priorReceipt=${priorReceipt}`,async()=>{
  let record,old,off,seen=0;const errors=[];
  const h=await harness({recording:true,onCycleCreated(cycle,load){
    const {observeM7Purpose,readM7RecordPurposeState}=load('domain/m7/outcome.ts');
    off=observeM7Purpose(cycle.access,()=>{if(!record||readM7RecordPurposeState(cycle.access).closure===0)return;try{
      seen++;const view=record.presentation();assert.equal(view.draft.evidence_text,'');assert.equal(view.feedbackDraft,undefined);
      assert.equal(old(),false);assert.equal(view.notice,undefined);
    }catch(e){errors.push(e);}});
  }});
  try{
    await h.submit();await h.accept();await h.start();h.press('w01-end');await h.settle();
    record=h.host.currentSlot().record;await qaNote(h,'QA early observer R');await qaPress(h,'feedback-VERY_GOOD');
    old=record.presentation().submitFeedback;
    if(priorReceipt)assert.equal(h.cycle.submitOutcome({type:'USER_SUBMITTED_OUTCOME',request_id:'qa-early-grant'}).state,'GRANTED');
    assert.equal(h.cycle.revokeRecordOutcome({type:'TRUSTED_REVOKED_OUTCOME',request_id:'qa-early-revoke'}).state,'REVOKED');
    await h.settle();assert.equal(seen,1);assert.deepEqual(errors,[]);
    assert.equal(h.api.m7Record.presentation.draft.evidence_text,'');assert.equal(h.api.m7Record.presentation.feedbackDraft,undefined);
  }finally{off?.();h.dispose();}
});

test('QA11 C1 newer R draft authored after actual closure notification survives outer unwind',async()=>{
  const h=await harness({recording:true});let off;try{
    await h.submit();await h.accept();await h.start();h.press('w01-end');await h.settle();
    await qaNote(h,'QA old R');await qaPress(h,'feedback-VERY_GOOD');h.type('QA independent M2');const check=qaComposer(h);
    const record=h.host.currentSlot().record;let seen=0;const errors=[];
    off=h.store.m7Outcome.subscribe(()=>{if(seen++)return;try{
      assert.equal(record.presentation().draft.evidence_text,'');assert.equal(record.presentation().feedbackDraft,undefined);
      assert.equal(record.presentation().setEvidenceText('QA independently authored after closure'),true);
    }catch(e){errors.push(e);}});
    assert.equal(h.cycle.revokeRecordOutcome({type:'TRUSTED_REVOKED_OUTCOME',request_id:'qa-post-closure-draft'}).state,'REVOKED');
    await h.settle();assert.equal(seen,1);assert.deepEqual(errors,[]);check();
    assert.equal(record.presentation().draft.evidence_text,'QA independently authored after closure');assert.equal(record.presentation().feedbackDraft,undefined);
    assert.equal(record.presentation().notice,undefined);assert.equal(record.presentation().canSubmit,false);
  }finally{off?.();h.dispose();}
});

for(const layout of ['R-new/F-active','R-active/F-new','both-active','drafts-only'])
for(const boundary of ['owner','record-purpose','task-edit','host-deactivate','M3-only','USE-only']){
  // Pure drafts have no retained-record bridge for M3; purpose closure is
  // covered independently with/without an actual facade receipt below.
  if(layout==='drafts-only'&&['M3-only','record-purpose'].includes(boundary))continue;
  test(`QA11 T21 actual owned drafts layout=${layout} boundary=${boundary}`,async()=>{
    const h=await harness({recording:true});try{
      await h.submit();await h.accept();await h.start();h.press('w01-end');await h.settle();
      if(layout==='R-active/F-new'||layout==='both-active')await qaR(h);
      if(layout==='R-new/F-active'||layout==='both-active')await qaF(h);
      if(layout==='R-active/F-new'||layout==='both-active')await qaPress(h,'correct');
      await qaNote(h,'QA retained independent R draft');
      if(layout==='R-new/F-active'||layout==='both-active')await qaPress(h,'feedback-correct');
      await qaPress(h,'feedback-FELT_TOO_MUCH');
      const store=h.store,record=h.host.currentSlot().record,cycle=h.cycle,ref=store.reference();
      const prior=record.presentation(),old=prior.submitFeedback;
      assert.ok(prior.feedbackDraft);assert.equal(prior.draft.evidence_text,'QA retained independent R draft');
      if(boundary==='owner')h.revoke();
      if(boundary==='record-purpose')assert.equal(cycle.revokeRecordOutcome({type:'TRUSTED_REVOKED_OUTCOME',request_id:'qa-draft-matrix-loss'}).state,'REVOKED');
      if(boundary==='task-edit')assert.equal(store.edit(ref,'QA changed task'),true);
      if(boundary==='host-deactivate')h.host.deactivate();
      if(boundary==='M3-only')assert.equal(await store.revoke(ref),true);
      if(boundary==='USE-only'){
        assert.equal(cycle.allowNextCycle({type:'USER_ALLOWED_NEXT_CYCLE',request_id:'qa-use-grant'}).state,'GRANTED');
        assert.equal(cycle.revokeNextCycle({type:'USER_REVOKED_NEXT_CYCLE',request_id:'qa-use-revoke'}).state,'REVOKED');
      }
      await h.settle();const after=record.presentation();
      if(boundary==='M3-only'||boundary==='USE-only'){
        assert.equal(after.outcome,prior.outcome);assert.equal(after.feedback,prior.feedback);
        assert.equal(after.draft,prior.draft);assert.equal(after.feedbackDraft,prior.feedbackDraft);
        if(layout!=='drafts-only'){
          assert.equal(prior.feedback?after.requestFeedbackDelete():after.requestDelete(),true);
          assert.equal(record.presentation().confirmDelete(),true);
        }
      }else{
        assert.equal(after.outcome,undefined);assert.equal(after.feedback,undefined);
        assert.equal(after.draft.evidence_text,'');assert.equal(after.feedbackDraft,undefined);
        assert.equal(store.m7Outcome.hasRetained(),false);assert.equal(old(),false);
      }
    }finally{h.dispose();}
  });
}

test('QA11 T22 actual host deactivate closes grants before purge observer reentry',async()=>{
  const h=await harness({recording:true});let off;try{
    await h.submit();await h.accept();await h.start();h.press('w01-end');await h.settle();await qaR(h);await qaF(h);
    const host=h.host,store=h.store,record=host.currentSlot().record,cycle=h.cycle;
    const receipt=cycle.getSnapshot().record_outcome_receipt,old=record.presentation();
    const observed=[],errors=[];
    off=store.m7Outcome.subscribe(()=>{try{
      const grant=cycle.submitOutcome({type:'USER_SUBMITTED_OUTCOME',request_id:'qa-retire-observer-record'});
      const next=cycle.allowNextCycle({type:'USER_ALLOWED_NEXT_CYCLE',request_id:'qa-retire-observer-next'});
      observed.push({grant:grant.state,next:next.state,retained:store.m7Outcome.hasRetained(),slot:!!host.currentSlot(),
        oldSubmit:old.submitFeedback(),newChoice:record.presentation().chooseFeedback('VERY_GOOD')});
      assert.equal(store.m7Outcome.getRevision(old.outcome.revision,receipt),undefined);
      assert.equal(store.m7Outcome.getFeedbackRevision(old.feedback.revision,receipt),undefined);
    }catch(e){errors.push(e);}});
    host.deactivate();assert.deepEqual(errors,[]);
    assert.deepEqual(observed,[{grant:'DENIED',next:'DENIED',retained:false,slot:false,oldSubmit:false,newChoice:false}]);
    host.deactivate();assert.equal(observed.length,1);assert.equal(cycle.getSnapshot().state,'RETIRED');
    off();off=undefined;await h.settle();
  }finally{off?.();h.dispose();}
});

for(const priorReceipt of [false,true])test(`QA11 T21 draft-only actual RECORD revoke priorReceipt=${priorReceipt}`,async(t)=>{
  const h=await harness({recording:true});const offs=[];try{
    await h.submit();await h.accept();await h.start();h.press('w01-end');await h.settle();
    await qaNote(h,'QA draft-only R');await qaPress(h,'feedback-FELT_TOO_MUCH');
    const store=h.store,record=h.host.currentSlot().record,old=h.find('m7-record-feedback-submit').props.onPress;
    assert.equal(store.m7Outcome.hasRetained(),false);
    if(priorReceipt)assert.equal(h.cycle.submitOutcome({type:'USER_SUBMITTED_OUTCOME',request_id:'qa-draft-grant'}).state,'GRANTED');
    else assert.equal(h.cycle.getSnapshot().record_outcome_receipt,undefined);
    const before=h.metrics.notifications;
    const {readM7RecordPurposeState,observeM7Purpose}=h.load('domain/m7/outcome.ts');
    const closureBefore=readM7RecordPurposeState(h.cycle.access);let outcomeNotifications=0,hostNotifications=0;const raw=[];
    offs.push(store.m7Outcome.subscribe(()=>outcomeNotifications++),h.host.subscribe(()=>hostNotifications++),
      observeM7Purpose(h.cycle.access,()=>raw.push(readM7RecordPurposeState(h.cycle.access))));
    const independent=h.find('opening-goal-input').props.value;
    assert.equal(h.cycle.revokeRecordOutcome({type:'TRUSTED_REVOKED_OUTCOME',request_id:'qa-draft-revoke'}).state,'REVOKED');
    await h.settle();
    const direct=record.presentation(),published=h.api.m7Record.presentation;
    const closureAfter=readM7RecordPurposeState(h.cycle.access);
    assert.ok(closureAfter.closure>closureBefore.closure);assert.equal(closureAfter.granted,false);assert.equal(raw.length,1);
    assert.equal(store.m7Outcome.canRecord(store.reference(),'F'),false);
    assert.equal(h.find('opening-goal-input').props.value,independent);
    t.diagnostic(JSON.stringify({priorReceipt,closureBefore,closureAfter,raw,outcomeNotifications,hostNotifications,
      directRPresent:!!direct.draft.evidence_text,directFPresent:!!direct.feedbackDraft,
      publishedRPresent:!!published.draft.evidence_text,publishedFPresent:!!published.feedbackDraft}));
    assert.deepEqual({directR:direct.draft.evidence_text,directF:!!direct.feedbackDraft,publishedR:published.draft.evidence_text,publishedF:!!published.feedbackDraft},
      {directR:'',directF:false,publishedR:'',publishedF:false},'Actual RECORD closure must clear owned drafts and publish the cleared view');
    assert.ok(h.metrics.notifications>before);assert.equal(old(),false);
    assert.equal(store.m7Outcome.canRecord(store.reference(),'F'),false);
  }finally{offs.forEach(f=>f());h.dispose();}
});
const qaOperations=['F-submit','F-correct','F-retract','F-delete','F-exit','R-submit','R-correct','R-retract','R-delete','R-exit','BOTH-delete','BOTH-keep'];
for(const locale of qaLocales)for(const operation of qaOperations)for(const freshness of ['fresh','held-stale-notify']){
  test(`QA11 T30 locale=${locale} operation=${operation} callback=${freshness}`,async()=>{
    const h=await harness({recording:true,locale});try{
      await h.submit();await h.accept();await h.start();h.press('w01-end');await h.settle();
      if(operation!=='R-submit')await qaR(h);
      if(operation!=='F-submit')await qaF(h);
      const rh=h.api.m7Record.presentation.outcome,fh=h.api.m7Record.presentation.feedback;
      h.type('QA independent composer '+locale);h.find('opening-goal-input').props.onFocus();await h.settle();const check=qaComposer(h);
      const isF=operation.startsWith('F-'),isR=operation.startsWith('R-');
      if(isF||operation.startsWith('BOTH')){await qaPress(h,'correct');await qaNote(h,'QA R draft '+locale);}
      if(isR||operation.startsWith('BOTH')){await qaPress(h,'feedback-correct');await qaPress(h,'feedback-FELT_TOO_MUCH');}
      let target,request;
      if(operation==='F-submit'||operation==='F-correct'||operation==='F-exit'){
        if(operation!=='F-submit')await qaPress(h,'feedback-correct');
        await qaPress(h,'feedback-FELT_MANAGEABLE');target=operation==='F-exit'?'feedback-keep':'feedback-submit';
      }
      if(operation==='R-submit'||operation==='R-correct'||operation==='R-exit'){
        if(operation!=='R-submit')await qaPress(h,'correct');
        for(const id of ['execution_extent-DID','action_change-UNCHANGED','user_stopped-false','problem_report-NONE','constraint-NONE_REPORTED'])await qaPress(h,id);
        await qaNote(h,'QA submitted R '+locale);target=operation==='R-exit'?'cancel':'submit';
      }
      if(operation==='F-retract'||operation==='F-delete')request=operation==='F-retract'?'feedback-retract':'feedback-delete';
      if(operation==='R-retract'||operation==='R-delete')request=operation==='R-retract'?'retract':'delete';
      if(operation.startsWith('BOTH'))request='delete-both';
      if(request){await qaPress(h,request);target=operation==='BOTH-keep'?'keep':'confirm';}
      check();const old=h.find('m7-record-'+target).props.onPress;
      if(freshness==='held-stale-notify'){
        // A real independent choice publishes through host to actual card, then
        // the old action is exercised. No forced token edits or copied guards.
        if(isF)await qaNote(h,'QA newer R '+locale);
        else await qaPress(h,'feedback-PROBLEM_REPORTED');
        const v=h.api.m7Record.presentation,fd=v.feedbackDraft,rd=v.draft;
        assert.equal(old(),false);await h.settle();check();
        assert.equal(h.api.m7Record.presentation.feedbackDraft,fd);assert.equal(h.api.m7Record.presentation.draft,rd);
        if(request)await qaPress(h,request);
      }
      const prior=h.api.m7Record.presentation,rd=prior.draft,fd=prior.feedbackDraft;
      assert.equal(await qaPress(h,target),true);check();const v=h.api.m7Record.presentation;
      if(isF){assert.equal(v.draft,rd);assert.equal(v.outcome,rh);assert.equal(v.feedbackDraft,undefined);
        if(operation==='F-delete'){assert.equal(v.feedback,undefined);assert.equal(v.notice,'deletedFeedback');}
        else if(operation==='F-retract'){assert.equal(v.feedbackState,'RETRACTED');assert.equal(v.notice,'retracted');}
        else if(operation==='F-exit')assert.equal(v.feedback,fh);
        else {assert.equal(v.feedback.feedback.experience,'FELT_MANAGEABLE');assert.equal(v.notice,operation==='F-submit'?'saved':'corrected');}
      }
      if(isR){assert.equal(v.feedbackDraft,fd);assert.equal(v.feedback,fh);assert.equal(v.draft.evidence_text,'');
        if(operation==='R-delete'){assert.equal(v.outcome,undefined);assert.equal(v.notice,'deletedReport');}
        else if(operation==='R-retract')assert.equal(v.state,'RETRACTED');
        else if(operation==='R-exit')assert.equal(v.outcome,rh);
        else assert.equal(v.outcome.state,'ACTIVE');
      }
      if(operation==='BOTH-delete'){assert.equal(v.outcome,undefined);assert.equal(v.feedback,undefined);assert.equal(v.feedbackDraft,undefined);assert.equal(v.draft.evidence_text,'');assert.equal(v.notice,'deletedBoth');}
      if(operation==='BOTH-keep'){assert.equal(v.outcome,rh);assert.equal(v.feedback,fh);assert.equal(v.draft,rd);assert.equal(v.feedbackDraft,fd);assert.equal(v.confirming,undefined);}
    }finally{h.dispose();}
  });
}

// M2 U12: controlled fixture executors, actual owner/host/hook/store composition.
// Promise settlement is transport status, never proof of physical task completion.
test('M2U12 R01 fresh actual A2 request reaches owned store while retired A1 executor remains unsettled',async()=>{
 let finish,settled=false,calls=0,operation;
 const pending=new Promise(resolve=>{finish=()=>{settled=true;resolve();};});
 const h=await harness({flow:false,gatewayPatch:{activeTask:workout('fixture-subject-a')},executors:{continue_workout:()=>{calls++;return pending;}}});try{
  const old=h.api;operation=old.choose(old.view.notes[0]);await h.settle();assert.equal(calls,1);
  await h.owner(h.fixture.OWNER_B);await h.owner(h.fixture.OWNER_A);
  const currentStore=h.store;assert.equal(currentStore.getSnapshot().active_task_id,null);
  h.type('same lawful current request');h.api.submit('same lawful current request');await h.settle();
  assert.equal(settled,false,'predecessor MUST remain pending at fresh-submit observation');
  assert.notEqual(currentStore.getSnapshot().active_task_id,null,'fresh current request must reach actual owned store before old settlement');
  assert.equal(currentStore.getSnapshot().tasks.length,1);assert.equal(h.inputs.length,1,'actual fixture adapter received current request once');
  old.submit('retired callback');await h.settle();assert.equal(currentStore.getSnapshot().tasks.length,1);
 }finally{finish();await operation;await h.settle();h.dispose();}
});

for(const oldResult of ['resolve','reject'])for(const order of ['A1-B','B-A1'])for(const currentResult of ['resolve','reject'])
test(`M2U12 R02 A1 B A2 pending old=${oldResult} order=${order} current=${currentResult}`,async()=>{
 const gates=Array.from({length:3},()=>{let yes,no;const promise=new Promise((resolve,reject)=>{yes=resolve;no=reject;});return {promise,finish:kind=>kind==='reject'?no(Error('controlled fixture rejection')):yes()};});
 let calls=0;const operations=[];
 const h=await harness({flow:false,gatewayPatch:{activeTask:workout('fixture-subject-a')},executors:{continue_workout:()=>gates[calls++].promise}});try{
  const a1=h.api;a1.beginPress(a1.view.notes[0].id);operations.push(a1.choose(a1.view.notes[0]));await h.settle();assert.equal(calls,1);
  await h.owner(h.fixture.OWNER_B);h.props.m2Gateway={...h.props.m2Gateway,snapshot:{...h.props.m2Gateway.snapshot,activeTask:workout(h.fixture.OWNER_B.subjectId)}};h.render();
  assert.equal(h.api.disabled,false);const b=h.api;operations.push(b.choose(b.view.notes[0]));await h.settle();assert.equal(calls,2);
  await h.owner(h.fixture.OWNER_A);h.props.m2Gateway={...h.props.m2Gateway,snapshot:{...h.props.m2Gateway.snapshot,activeTask:workout(h.fixture.OWNER_A.subjectId)}};h.render();
  assert.equal(h.api.disabled,false);const a2=h.api;operations.push(a2.choose(a2.view.notes[0]));await h.settle();assert.equal(calls,3);
  h.type('new independent A2 expression');assert.equal(h.api.disabled,true);
  for(const index of order==='A1-B'?[0,1]:[1,0]){
   gates[index].finish(oldResult);await operations[index];await h.settle();
   assert.equal(h.api.disabled,true,'retired completion cannot release current A2 operation');
   assert.equal(h.api.text,'new independent A2 expression');assert.equal(h.api.notice,'');
   await h.api.choose(h.api.view.notes[0]);h.api.submit('must remain blocked');await h.settle();
   assert.equal(calls,3);assert.equal(h.store.getSnapshot().active_task_id,null);
  }
  assert.equal(a1.acceptPress(a1.view.notes[0].id),false);await a1.choose(a1.view.notes[0]);await b.choose(b.view.notes[0]);a1.submit('old callback');await h.settle();assert.equal(calls,3);assert.equal(h.store.getSnapshot().active_task_id,null);
  gates[2].finish(currentResult);await operations[2];await h.settle();assert.equal(h.api.disabled,false);assert.equal(h.api.text,'new independent A2 expression');
  if(currentResult==='reject')assert.notEqual(h.api.notice,'','own current failure may publish its truthful notice');
  else{assert.equal(h.api.notice,'');await h.api.choose(h.api.view.notes[0]);assert.equal(calls,3,'completed same-epoch action remains duplicate');}
 }finally{gates.forEach(g=>g.finish('resolve'));await Promise.all(operations);await h.settle();h.dispose();}
});
for(const variant of ['locale','wrapper','render','view-token'])test('M2U12 R03 same epoch remains serialized across '+variant,async()=>{
 let finish,calls=0,operation;const pending=new Promise(resolve=>{finish=resolve;});
 const h=await harness({gatewayPatch:{activeTask:workout('fixture-subject-a')},executors:{continue_workout:()=>{calls++;return pending;}}});try{
  operation=h.api.choose(h.api.view.notes[0]);await h.settle();h.type('owned pending expression');
  const input=h.find('opening-goal-input'),before={value:input.props.value,ref:input.props.ref,key:input.props.key,focus:h.metrics.focus,blur:h.metrics.blur,dismiss:h.metrics.dismiss};
  if(variant==='locale')h.setLocale('ja');
  else if(variant==='wrapper'){h.props.ownerSession={...h.props.ownerSession};h.render();}
  else if(variant==='view-token'){h.props.m2Gateway={...h.props.m2Gateway,snapshot:{...h.props.m2Gateway.snapshot,revision:'new-presentation-only-token'}};h.render();}
  else h.render();
  await h.settle();assert.equal(h.api.disabled,true);await h.api.choose(h.api.view.notes[0]);h.api.submit('blocked same epoch');await h.settle();assert.equal(calls,1);assert.equal(h.store.getSnapshot().active_task_id,null);
  const after=h.find('opening-goal-input');assert.deepEqual({value:after.props.value,ref:after.props.ref,key:after.props.key,focus:h.metrics.focus,blur:h.metrics.blur,dismiss:h.metrics.dismiss},before);
  finish();await operation;await h.settle();assert.equal(h.api.disabled,variant==='view-token','view-token retains existing stale-input guard independently of busy');
  h.api.submit('lawful after own settlement');await h.settle();assert.notEqual(h.store.getSnapshot().active_task_id,null);assert.equal(h.inputs.length,1);
 }finally{finish();await operation;await h.settle();h.dispose();}
});
for(const loss of ['revoke','expiry','host-retire'])test('M2U12 R04 actual retirement keeps old pending callbacks dead '+loss,async()=>{
 let finish,operation;const pending=new Promise(resolve=>{finish=resolve;});let calls=0;
 const h=await harness({flow:false,gatewayPatch:{activeTask:workout('fixture-subject-a')},executors:{continue_workout:()=>{calls++;return pending;}}});try{
  const old=h.api;operation=old.choose(old.view.notes[0]);await h.settle();const oldStore=h.store;
  if(loss==='revoke')h.revoke();else if(loss==='expiry')h.clock.jumpWithoutTimers(100000);else h.host.deactivate();
  h.render();await h.settle();const before=h.inputs.length;
  old.submit('retired request');await old.choose(old.view.notes[0]);await h.settle();assert.equal(calls,1);assert.equal(h.inputs.length,before);
  finish();await operation;await h.settle();assert.equal(h.api.notice,'');assert.equal(oldStore.getSnapshot().active_task_id,null);
  if(loss!=='expiry'){await h.owner(h.fixture.OWNER_A);h.api.submit('fresh after retirement');await h.settle();assert.notEqual(h.store.getSnapshot().active_task_id,null);assert.equal(h.inputs.length,before+1);}
 }finally{finish();await operation;await h.settle();h.dispose();}
});
for(const successor of ['B','A2'])test('M2U12 R05 same words fresh actual request while predecessor pending '+successor,async()=>{
 let finish,operation;const pending=new Promise(resolve=>{finish=resolve;});
 const h=await harness({flow:false,gatewayPatch:{activeTask:workout('fixture-subject-a')},executors:{continue_workout:()=>pending}});try{
  await h.submit('same user words');assert.equal(h.inputs.length,1);const oldStore=h.store;
  operation=h.api.choose(h.api.view.notes[0]);await h.settle();await h.owner(h.fixture.OWNER_B);if(successor==='A2')await h.owner(h.fixture.OWNER_A);
  assert.notEqual(h.store,oldStore);h.api.submit('same user words');await h.settle();assert.notEqual(h.store.getSnapshot().active_task_id,null);assert.equal(h.store.getSnapshot().tasks.length,1);assert.equal(h.inputs.length,2);
 }finally{finish();await operation;await h.settle();h.dispose();}
});
for(const oldResult of ['resolve','reject'])for(const currentResult of ['resolve','reject'])
test(`M2U12 R06 current completes before retired predecessor old=${oldResult} current=${currentResult}`,async()=>{
 const gates=Array.from({length:2},()=>{let yes,no;const promise=new Promise((resolve,reject)=>{yes=resolve;no=reject;});return {promise,finish:kind=>kind==='reject'?no(Error('controlled fixture rejection')):yes()};});let calls=0;const ops=[];
 const h=await harness({flow:false,gatewayPatch:{activeTask:workout('fixture-subject-a')},executors:{continue_workout:()=>gates[calls++].promise}});try{
  const old=h.api;ops.push(old.choose(old.view.notes[0]));await h.settle();
  await h.owner(h.fixture.OWNER_B);await h.owner(h.fixture.OWNER_A);
  ops.push(h.api.choose(h.api.view.notes[0]));await h.settle();assert.equal(calls,2);
  gates[1].finish(currentResult);await ops[1];await h.settle();assert.equal(h.api.disabled,false);
  const notice=h.api.notice;if(currentResult==='reject')assert.notEqual(notice,'');else assert.equal(notice,'');
  const beforeText=h.api.text;gates[0].finish(oldResult);await ops[0];await h.settle();
  assert.equal(h.api.notice,notice);assert.equal(h.api.text,beforeText);assert.equal(h.api.disabled,false);
  h.type('newer independent expression');assert.equal(h.api.notice,'','explicit typing keeps existing notice-clear semantics');assert.equal(h.api.text,'newer independent expression');
  old.submit('retired');await old.choose(old.view.notes[0]);await h.settle();assert.equal(calls,2);assert.equal(h.store.getSnapshot().active_task_id,null);
 }finally{gates.forEach(g=>g.finish('resolve'));await Promise.all(ops);await h.settle();h.dispose();}
});

// F04 scope: CODE_OFFLINE on actual hook/store/card, not production OWNED evidence.
test('F04 P01 current canonical STARTED without End keeps reported_action started',async()=>{
 const h=await harness();try{await h.submit();await h.accept();await h.start();const ref=h.store.reference(),episode=h.store.selfWalk.getCurrentEpisode(ref);assert.equal(episode.action.state,'STARTED');assert.equal(episode.action.start.kind,'USER_REPORTED_START');assert.equal(episode.end,undefined);assert.equal(latestResolution(h).result.phase,'started');assert.equal(latestResolution(h).result.kind,'reported_action');}finally{h.dispose();}
});
test('F04 P02 explicit canonical End remains distinct ended_by_user',async()=>{
 const h=await harness();try{await h.submit();await h.accept();await h.start();h.press('w01-end');await h.settle();const episode=h.store.selfWalk.getCurrentEpisode(h.store.reference());assert.equal(episode.action.state,'STOPPED');assert.equal(episode.end.kind,'USER_REPORTED_END');assert.equal(latestResolution(h).result.phase,'ended_by_user');assert.equal(h.api.w01.presentation.endedByUser,true);assert.equal(h.api.m7Record,undefined);}finally{h.dispose();}
});
test('F04 N01 current ordinary Stop not invalidated first must become unknown without forced render',async()=>{
 const h=await harness();try{await h.submit();await h.accept();await h.start();const ref=h.store.reference(),notifications=h.metrics.notifications,changes=h.metrics.stateChanges;assert.equal(h.press('w01-stop'),true);assert.ok(h.dirty||h.metrics.notifications>notifications||h.metrics.stateChanges>changes,'STOP_MUST_NOTIFY_WITHOUT_FORCED_RENDER');await h.settle();const episode=h.store.selfWalk.getCurrentEpisode(ref);assert.ok(episode,'CURRENT_EPISODE_MUST_REMAIN');assert.equal(episode.action.state,'STOPPED');assert.equal(episode.end,undefined);assert.equal(latestResolution(h).snapshot.activeTask.kind,'unknown');assert.equal(latestResolution(h).result,null);assert.equal(h.api.view,null);assert.equal(h.api.w01.presentation.endedByUser,false);assertNoGoalFallback(h);assert.equal(h.api.m7Record,undefined);}finally{h.dispose();}
});
test('F04 N02 repeated retained Stop does not create End completion or M7 purpose',async()=>{
 const h=await harness();try{await h.submit();await h.accept();await h.start();const stop=h.find('w01-stop').props.onPress;assert.equal(stop(),true);await h.settle();stop();await h.settle();const episode=h.store.selfWalk.getCurrentEpisode(h.store.reference());assert.equal(episode.action.state,'STOPPED');assert.equal(episode.end,undefined);assert.equal(latestResolution(h).result,null);assert.equal(h.api.m7Record,undefined);assertNoGoalFallback(h);}finally{h.dispose();}
});
test('F04 N03 PROPOSED and ACCEPTED never project started',async()=>{
 const h=await harness();try{await h.submit();await h.accept();for(const answer of favorable){h.press('w01-answer-'+answer);await h.settle();}assert.equal(h.store.selfWalk.getSnapshot().state,'PROPOSED');assert.notEqual(latestResolution(h).result?.phase,'started');h.press('w01-accept');await h.settle();assert.equal(h.store.selfWalk.getSnapshot().state,'ACCEPTED');assert.notEqual(latestResolution(h).result?.phase,'started');assertNoGoalFallback(h);}finally{h.dispose();}
});
test('F04 N04 contradictory state or witness fails closed',async()=>{
 for(const variant of ['STARTED_WITH_END','STOPPED_WRONG_END']){const h=await harness({episodeOverride:e=>variant==='STARTED_WITH_END'&&e.action.state==='STARTED'?{...e,end:{kind:'USER_REPORTED_END',request_id:'negative-fixture',recorded_at:1}}:variant==='STOPPED_WRONG_END'&&e.action.state==='STOPPED'?{...e,end:{kind:'WRONG_KIND'}}:e});try{await h.submit();await h.accept();await h.start();if(variant==='STOPPED_WRONG_END'){h.press('w01-stop');await h.settle();}assert.equal(latestResolution(h).snapshot.activeTask.kind,'unknown');assert.equal(latestResolution(h).result,null);assertNoGoalFallback(h);}finally{h.dispose();}}
});
test('F04 N05 task invalidation and owner revoke keep guards while retained Stop reduces authority',async()=>{
 const h=await harness();try{await h.submit();await h.accept();await h.start();const stop=h.find('w01-stop').props.onPress,end=h.find('w01-end').props.onPress;assert.equal(h.api.editM3Task('Changed current task'),true);assert.equal(end(),false);assert.equal(stop(),true);await h.settle();assert.equal(h.store.selfWalk.getSnapshot().state,'STOPPED');assert.equal(latestResolution(h).result,null);assertNoGoalFallback(h);await h.accept();await h.start();const ownedEnd=h.find('w01-end').props.onPress;h.revoke();assert.equal(ownedEnd(),false);await h.settle();assert.equal(latestResolution(h).result,null);}finally{h.dispose();}
});
test('F04 R01 retained A callback through owner A-B-A cannot revive current stopped episode',async()=>{
 const h=await harness();try{await h.submit();await h.accept();await h.start();const retired=h.api,oldStop=h.find('w01-stop').props.onPress,oldStore=h.store;await h.owner(h.fixture.OWNER_B);await h.owner(h.fixture.OWNER_A);await h.submit('Current A2');await h.accept();await h.start();h.press('w01-stop');await h.settle();assert.notEqual(h.store,oldStore);const before=h.store.getSnapshot(),text=h.api.text;oldStop();retired.submit('Late A1 callback');await h.settle();assert.equal(h.store.getSnapshot(),before);assert.equal(h.api.text,text);assert.equal(h.store.selfWalk.getCurrentEpisode(h.store.reference()).action.state,'STOPPED');assert.equal(h.store.selfWalk.getCurrentEpisode(h.store.reference()).end,undefined);assert.equal(latestResolution(h).result,null);}finally{h.dispose();}
});
test('F04 R02 Stop then explicit End only publishes End after real witness',async()=>{
 const h=await harness();try{await h.submit();await h.accept();await h.start();h.press('w01-stop');await h.settle();assert.equal(latestResolution(h).result,null);assert.equal(h.store.selfWalk.getCurrentEpisode(h.store.reference()).end,undefined);h.press('w01-end');await h.settle();assert.equal(h.store.selfWalk.getCurrentEpisode(h.store.reference()).end.kind,'USER_REPORTED_END');assert.equal(latestResolution(h).result.phase,'ended_by_user');}finally{h.dispose();}
});
// F04 M01 is a separate controlled run of these same oracles against the exact
// original projection bytes. That run must reject the original ternary.


// S8: real consumer/projector/hook, with explicit TEST_FIXTURE history readers.
// This does not implement a production history authority or authenticate a user.
async function s8Harness(options = {}) {
  const h = await harness(options);
  const validUntil = Date.now() + 600000;
  h.authority.results.push({status:'verified',owner:h.fixture.OWNER_A,validUntil});
  const lease = await h.boundary.control.verifySession();
  h.boundary.control.finishHydration(lease);
  h.props.ownerSession = {access:h.boundary.access,lease};
  h.render(); await h.settle();
  const mod = h.load('domain/m2/factual-snapshot.ts');
  const scope = h.boundary.access.requireLease(lease);
  let value = {status:'known_none',issuer:'VERIFIED_HISTORY_AUTHORITY',
    owner:{...scope.owner},sessionGeneration:scope.generation,basisRevision:'TEST_FIXTURE-history-1',
    completeness:{profile:true,goal:true,activeTask:true,returning:true},
    observedAt:Date.now()-1000,validUntil:validUntil-1000};
  let current = true, onRead;
  const reader = {access:h.boundary.access,lease,readFacts(){onRead?.();return value;},
    isBasisCurrent(basis){return current && basis === value?.basisRevision;}};
  const attach = () => {
    h.props.m2Gateway = {...h.props.m2Gateway,
      snapshot:mod.projectAuthoritativeM2Baseline(h.props.m2Gateway.snapshot,reader)};
    h.render();
  };
  return Object.assign(h,{s8:mod,scope,reader,attach,
    setFacts(v){value=v;},get facts(){return value;},
    revokeBasis(){current=false;},onRead(fn){onRead=fn;}});
}
const s8Missing = h => assert.notEqual(latestResolution(h).result?.kind,'goal');

test('S8 P01 trusted fixture channel opens actual goal view and four suggestions; task retires it, M5/W01 preserve F04',async()=>{
 const h=await s8Harness();try{
  h.attach();await h.settle();
  assert.equal(latestResolution(h).result.kind,'goal');
  assert.ok(h.find('opening-goal-suggestions'));
  assert.equal(latestResolution(h).result.notes.length,4);
  await h.submit();s8Missing(h);await h.accept();await h.start();
  assert.equal(latestResolution(h).result.phase,'started');
  h.press('w01-stop');await h.settle();assert.equal(latestResolution(h).snapshot.activeTask.kind,'unknown');
  h.press('w01-end');await h.settle();assert.equal(latestResolution(h).result.phase,'ended_by_user');
 }finally{h.dispose();}
});

test('S8 N01 self-declared issuer without an independently supplied reader never grants NEW',async()=>{
 const h=await s8Harness();try{
  const base=h.s8.projectAuthoritativeM2Baseline(h.props.m2Gateway.snapshot);
  h.props.m2Gateway={...h.props.m2Gateway,snapshot:base,knownNoneWitness:h.facts};
  h.render();s8Missing(h);assert.equal(latestResolution(h).snapshot.goal,'unknown');
  assert.equal(h.s8.readAuthoritativeKnownNone(base,h.reader.access,h.reader.lease,{}, {session_id:'test',revision:1,tasksEmpty:true},Date.now()),undefined);
 }finally{h.dispose();}
});

for(const status of ['error','missing','unknown','has_history',undefined]){
 test('S8 N02 history status '+String(status)+' is not known-none',async()=>{
  const h=await s8Harness();try{h.setFacts(status===undefined?undefined:{...h.facts,status});h.attach();s8Missing(h);}finally{h.dispose();}
 });
}
for(const key of ['profile','goal','activeTask','returning']){
 test('S8 N03 completeness missing '+key+' fails closed',async()=>{
  const h=await s8Harness();try{h.setFacts({...h.facts,completeness:{...h.facts.completeness,[key]:false}});h.attach();s8Missing(h);}finally{h.dispose();}
 });
}
for(const key of ['wrong-subject','wrong-profile','wrong-generation','empty-basis','space-basis','control-basis','long-basis','future','expired','over-lease','nan','bad-issuer']){
 test('S8 N04 invalid '+key,async()=>{
  const h=await s8Harness();try{
   let v={...h.facts};
   if(key==='wrong-subject')v.owner={...v.owner,subjectId:'other'};
   if(key==='wrong-profile')v.owner={...v.owner,profileId:'other'};
   if(key==='wrong-generation')v.sessionGeneration++;
   if(key==='empty-basis')v.basisRevision='';
   if(key==='space-basis')v.basisRevision=' untrimmed ';
   if(key==='control-basis')v.basisRevision='bad\nline';
   if(key==='long-basis')v.basisRevision='x'.repeat(256);
   if(key==='future')v.observedAt=Date.now()+500000;
   if(key==='expired')v.validUntil=Date.now()-1;
   if(key==='over-lease')v.validUntil=h.scope.validUntil+1;
   if(key==='nan')v.observedAt=NaN;
   if(key==='bad-issuer')v.issuer='SELF_ASSERTED';
   h.setFacts(v);h.attach();s8Missing(h);
  }finally{h.dispose();}
 });
}
for(const mode of ['ANONYMOUS','BLOCKED']){
 test('S8 N05 '+mode+' host never projects NEW',async()=>{
  const h=await s8Harness();try{h.props.m3HostMode=mode;h.attach();await h.settle();s8Missing(h);}finally{h.dispose();}
 });
}
test('S8 N06 missing root producer preserves unknown, not a fake positive',async()=>{
 const h=await s8Harness();try{
  h.props.m2Gateway={...h.props.m2Gateway,snapshot:h.s8.projectAuthoritativeM2Baseline(h.props.m2Gateway.snapshot)};
  h.render();const s=latestResolution(h).snapshot;
  assert.equal(s.goal,'unknown');assert.equal(s.subject.profile,'unknown');s8Missing(h);
  const root=readFileSync(resolve(app,'app/_layout.tsx'),'utf8');
  const ast=ts.createSourceFile('root.tsx',root,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const calls=[];const walk=n=>{if(ts.isCallExpression(n)&&n.expression.getText(ast)==='projectAuthoritativeM2Baseline')calls.push(n);ts.forEachChild(n,walk);};walk(ast);
  assert.equal(calls.length,1);assert.equal(calls[0].arguments.length,2);assert.equal(calls[0].arguments[1].getText(ast),'facts.snapshot.reader');
 }finally{h.dispose();}
});
test('S8 R01 basis revoked after render is rechecked before held UI action; old binding cannot revive',async()=>{
 const h=await s8Harness();try{
  h.attach();assert.equal(latestResolution(h).result.kind,'goal');
  h.api.beginPress('S8-held');h.revokeBasis();
  assert.equal(h.api.acceptPress('S8-held'),false);await h.settle();s8Missing(h);
  h.render();s8Missing(h);
 }finally{h.dispose();}
});
test('S8 R02 expiry at use time cannot be revived by replacing facts later',async()=>{
 const h=await s8Harness();try{
  h.attach();assert.equal(latestResolution(h).result.kind,'goal');
  const fresh=h.facts;h.setFacts({...fresh,validUntil:Date.now()-1});
  h.api.beginPress('expiry');h.render();s8Missing(h);
  h.setFacts(fresh);h.render();s8Missing(h);
 }finally{h.dispose();}
});
test('S8 R03 current owner A-B-A retires old exact lease even with same subject IDs',async()=>{
 const h=await s8Harness();try{
  h.attach();assert.equal(latestResolution(h).result.kind,'goal');
  const old=h.props.m2Gateway.snapshot;
  await h.owner(h.fixture.OWNER_B);await h.owner(h.fixture.OWNER_A);
  h.props.m2Gateway={...h.props.m2Gateway,snapshot:old};h.render();s8Missing(h);
 }finally{h.dispose();}
});
test('S8 R04 actual task-store retirement clears RAM but never resurrects old witness',async()=>{
 const h=await s8Harness();try{
  h.attach();assert.equal(latestResolution(h).result.kind,'goal');
  await h.submit();s8Missing(h);h.store.stop();h.render();await h.settle();s8Missing(h);
 }finally{h.dispose();}
});
test('S8 R05 lifecycle revision/session/lifetime changes and empty-after-task all retire the exact binding',async()=>{
 const h=await s8Harness();try{
  for(const change of [{revision:2},{session_id:'other'},{tasksEmpty:false},{lifetime:{}}]){
   const base=h.s8.projectAuthoritativeM2Baseline(h.props.m2Gateway.snapshot,h.reader),lifetime={};
   const ctx={session_id:'test-session',revision:1,tasksEmpty:true};
   assert.ok(h.s8.readAuthoritativeKnownNone(base,h.reader.access,h.reader.lease,lifetime,ctx,Date.now()));
   const changed={...ctx,...change};
   assert.equal(h.s8.readAuthoritativeKnownNone(base,h.reader.access,h.reader.lease,change.lifetime??lifetime,changed,Date.now()),undefined);
   assert.equal(h.s8.readAuthoritativeKnownNone(base,h.reader.access,h.reader.lease,lifetime,ctx,Date.now()),undefined);
  }
 }finally{h.dispose();}
});
test('S8 R06 snapshot changes inside trusted read are caught by real hook post-read recheck',async()=>{
 const h=await s8Harness();try{
  let once=true;h.onRead(()=>{if(once){once=false;h.api.submit('During facts read');}});
  h.attach();await h.settle();s8Missing(h);assert.ok(h.store.getSnapshot().tasks.length);
 }finally{h.dispose();}
});
test('S8 R07 reader throws or basis currentness denies; no caller data becomes authority',async()=>{
 const h=await s8Harness();try{
  h.onRead(()=>{throw Error('HISTORY_READ_FAILED');});h.attach();s8Missing(h);
 }finally{h.dispose();}
});
test('S8 N07 schema validator exceptions return false, no partial grant',async()=>{
 const h=await s8Harness();try{
  const v=Object.defineProperty({},'status',{get(){throw Error('bad getter');}});
  assert.equal(h.s8.validateKnownNoneWitness(v,h.scope,Date.now()),false);
 }finally{h.dispose();}
});


// S9 explicit opt-in expression UI. Existing 319 tests above remain byte-exact.
async function s9Harness({mode='ANONYMOUS',locale='vi',enabled=true,patch={}}={}) {
 const h=await harness({mode,locale,gatewayPatch:{
  subject:{id:mode==='ANONYMOUS'?'anonymous':'fixture-subject-a',loading:'ready',profile:'unknown'},
  goal:'unknown',activeTask:{kind:'unknown'},returning:{kind:'unknown'},...patch}});
 h.props.neutralGoalPrompt=enabled;h.render();await h.settle();return h;
}
const s9Chips=h=>h.nodes().filter(n=>n.props.testID?.startsWith('opening-neutral-goal-chip-'));
const s9Absent=h=>assert.equal(h.find('opening-neutral-goal-suggestions'),undefined);
for(const locale of ['vi','en','zh-Hans','es','hi','ja','ko','ru']){
 test('S9 P01 neutral guest '+locale+' has four expression choices, tap only fills RAM and keeps M2 unknown',async()=>{
  const h=await s9Harness({locale});try{
   assert.ok(h.find('opening-neutral-goal-suggestions'));assert.equal(s9Chips(h).length,4);
   assert.equal(h.find('opening-goal-suggestions'),undefined);assert.equal(h.api.view,null);
   const translate=key=>h.load('i18n.ts').translate(locale,key);
   assert.equal(h.find('opening-goal-focus-block').props.children[0].props.children[0],translate('s32Question'));
   const labels=['s32Movement','s32Nutrition','s32Body','s32Recovery'].map(translate);
   assert.deepEqual(s9Chips(h).map(x=>x.props.accessibilityLabel),labels);
   const before=h.store?.getSnapshot(),inputs=h.inputs.length,choice=s9Chips(h)[0],label=choice.props.accessibilityLabel;
   assert.equal(h.press(choice.props.testID),true);await h.settle();
   assert.equal(h.find('opening-goal-input').props.value,label);
   assert.equal(h.api.view,null);assert.equal(h.inputs.length,inputs);assert.equal(h.store?.getSnapshot(),before);
   assert.equal(latestResolution(h).snapshot.goal,'unknown');assert.equal(latestResolution(h).snapshot.subject.profile,'unknown');
   assert.equal(h.metrics.storageWrites,0);assert.equal(h.metrics.provider,0);s9Absent(h);
   h.type(label+' edited');assert.equal(h.find('opening-goal-input').props.value,label+' edited');
  }finally{h.dispose();}
 });
}
test('S9 N01 default off preserves the existing managed-null contract',async()=>{
 const h=await s9Harness({enabled:false});try{s9Absent(h);assertNoGoalFallback(h);assert.equal(h.api.view,null);}finally{h.dispose();}
});
for(const mode of ['OWNED','BLOCKED']){
 test('S9 N02 opt-in '+mode+' is not Guest expression authority',async()=>{
  const h=await s9Harness({mode});try{s9Absent(h);assertNoGoalFallback(h);}finally{h.dispose();}
 });
}
for(const key of ['loading','error','deleted','denied','permission-unknown','hold','safety-unknown','explicit-intent','known-goal','active-task','returning','known-profile']){
 test('S9 N03 snapshot guard '+key+' keeps neutral surface absent',async()=>{
  let patch={};
  if(['loading','error','deleted'].includes(key))patch.subject={id:'anonymous',loading:key,profile:'unknown'};
  if(key==='denied'||key==='permission-unknown')patch.permission={status:key==='denied'?'denied':'unknown',revision:'negative'};
  if(key==='hold'||key==='safety-unknown')patch.safety=key==='hold'?'hold':'unknown';
  if(key==='explicit-intent')patch.explicitIntent=true;
  if(key==='known-goal')patch.goal='confirmed';
  if(key==='active-task')patch.activeTask={kind:'other'};
  if(key==='returning')patch.returning={kind:'none'};
  if(key==='known-profile')patch.subject={id:'anonymous',loading:'ready',profile:'existing'};
  const h=await s9Harness({patch});try{s9Absent(h);}finally{h.dispose();}
 });
}
test('S9 N04 focus hides the empty initial choices; blur alone does not classify or retire facts',async()=>{
 const h=await s9Harness();try{
  assert.equal(s9Chips(h).length,4);h.find('opening-goal-input').props.onFocus();await h.settle();s9Absent(h);
  h.find('opening-goal-input').props.onBlur();await h.settle();assert.equal(s9Chips(h).length,4);
  assertNoGoalFallback(h);
 }finally{h.dispose();}
});
test('S9 N05 actual OWNED M5/W01 lifecycle with opt-in never falls into neutral Guest UI',async()=>{
 const h=await harness();try{
  h.props.neutralGoalPrompt=true;h.render();s9Absent(h);await h.submit();s9Absent(h);
  await h.accept();s9Absent(h);await h.start();s9Absent(h);
  h.press('w01-stop');await h.settle();s9Absent(h);h.press('w01-end');await h.settle();s9Absent(h);
  assert.equal(latestResolution(h).result.phase,'ended_by_user');
 }finally{h.dispose();}
});
test('S9 N06 actual S8 verified-known-none fixture remains the original M2 goal UI, not neutral',async()=>{
 const h=await s8Harness();try{
  h.props.neutralGoalPrompt=true;h.attach();await h.settle();
  assert.equal(latestResolution(h).result.kind,'goal');assert.ok(h.find('opening-goal-suggestions'));s9Absent(h);
 }finally{h.dispose();}
});
test('S9 R01 retained old-locale chip cannot write or focus after a presentation epoch change',async()=>{
 const h=await s9Harness();try{
  const old=s9Chips(h)[0].props.onPress;
  h.setLocale('ja');assert.equal(s9Chips(h).length,4);
  const focus=h.metrics.focus;assert.equal(old(),false);await h.settle();
  assert.equal(h.find('opening-goal-input').props.value,'');assert.equal(h.metrics.focus,focus);
  const fresh=s9Chips(h)[0];assert.equal(h.press(fresh.props.testID),true);await h.settle();
  assert.equal(h.find('opening-goal-input').props.value,h.load('i18n.ts').translate('ja','s32Movement'));
 }finally{h.dispose();}
});
test('S9 R02 typing then clearing cannot revive chips or a held callback in the same run',async()=>{
 const h=await s9Harness();try{
  const held=s9Chips(h)[1].props.onPress;h.type('I choose my own words');s9Absent(h);
  h.type('');s9Absent(h);assert.equal(held(),false);assert.equal(h.find('opening-goal-input').props.value,'');
 }finally{h.dispose();}
});
test('S9 R03 Guest-owner-Guest and exact draft store change retire old run; no stale write or focus',async()=>{
 const h=await s9Harness();try{
  const held=s9Chips(h)[2].props.onPress;await h.owner(h.fixture.OWNER_A);
  h.props.m3HostMode='OWNED';h.render();await h.settle();s9Absent(h);
  h.props.ownerSession=undefined;h.props.m3HostMode='ANONYMOUS';
  h.props.m2Gateway={...h.props.m2Gateway,snapshot:{...h.props.m2Gateway.snapshot,
    subject:{id:'anonymous',loading:'ready',profile:'unknown'}}};h.render();await h.settle();
  const before=h.find('opening-goal-input').props.value,focus=h.metrics.focus;s9Absent(h);
  assert.equal(held(),false);await h.settle();assert.equal(h.find('opening-goal-input').props.value,before);
  assert.equal(h.metrics.focus,focus);
 }finally{h.dispose();}
});
test('S9 R04 permission revoke and restore with same IDs cannot revive a retired run',async()=>{
 const h=await s9Harness();try{
  const held=s9Chips(h)[0].props.onPress,original=h.props.m2Gateway.snapshot;
  h.props.m2Gateway={...h.props.m2Gateway,snapshot:{...original,permission:{status:'denied',revision:'withdrawn'}}};
  h.render();await h.settle();s9Absent(h);
  h.props.m2Gateway={...h.props.m2Gateway,snapshot:original};h.render();await h.settle();s9Absent(h);
  assert.equal(held(),false);assert.equal(h.find('opening-goal-input').props.value,'');
 }finally{h.dispose();}
});
test('S9 R05 opt-in withdrawal/re-enable does not reset the run or double-activate a chosen label',async()=>{
 const h=await s9Harness();try{
  const held=s9Chips(h)[0].props.onPress;h.props.neutralGoalPrompt=false;h.render();s9Absent(h);
  h.props.neutralGoalPrompt=true;h.render();s9Absent(h);assert.equal(held(),false);
 }finally{h.dispose();}
 const fresh=await s9Harness();try{
  const action=s9Chips(fresh)[0].props.onPress;assert.equal(action(),true);
  assert.equal(action(),false);await fresh.settle();s9Absent(fresh);
 }finally{fresh.dispose();}
});
test('S9 R06 explicit submit then clear remains the existing submit path, no neutral revival',async()=>{
 const h=await s9Harness();try{
  const held=s9Chips(h)[0].props.onPress;h.type('User typed a goal');
  h.press('opening-goal-submit');await h.settle();h.type('');s9Absent(h);assert.equal(held(),false);
 }finally{h.dispose();}
});
test('S9 ROOT only explicitly locked selected guest without an owner opts in; legacy controls and backdrop retained',async()=>{
 const h=await s9Harness();try{
  const root=readFileSync(resolve(app,'app/_layout.tsx'),'utf8'),source=ts.createSourceFile('root.tsx',root,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const attrs=[];const visit=n=>{if(ts.isJsxAttribute(n)&&n.name.getText(source)==='neutralGoalPrompt')attrs.push(n);ts.forEachChild(n,visit);};visit(source);
  assert.equal(attrs.length,1);
  const expression=attrs[0].initializer.expression.getText(source).replace(/\s+/g,' ');
  assert.equal(expression,"ownerControl.phase === 'LOCKED' && guestSelected && m3HostMode === 'ANONYMOUS' && !ownerSession");
  assert.equal(h.find('opening-goal-suggestions'),undefined);assert.equal(h.find('opening-goal-focus-block').props.children[0].props.children[0],h.load('i18n.ts').translate('vi','s32Question'));
  assert.ok(h.find('opening-goal-dismiss-area'));assert.ok(h.find('opening-goal-panel'));assert.equal(h.metrics.provider,0);
 }finally{h.dispose();}
});

for(const id of ['fat-loss','muscle','shape']){
 test('S9 P02 choosing '+id+' writes that exact expression without sending',async()=>{
  const h=await s9Harness();try{
   const node=h.find('opening-neutral-goal-chip-'+id),label=node.props.accessibilityLabel;
   const snapshot=h.store?.getSnapshot(),count=h.inputs.length;
   assert.equal(h.press(node.props.testID),true);await h.settle();
   assert.equal(h.find('opening-goal-input').props.value,label);
   assert.equal(h.inputs.length,count);assert.equal(h.store?.getSnapshot(),snapshot);
   assert.equal(h.api.view,null);assert.equal(h.metrics.storageWrites,0);
  }finally{h.dispose();}
 });
}


import { randomBytes as s10Entropy } from 'node:crypto';
async function localRealmHarness({flow=true, mode='OWNED', locale='vi', managed=true, gatewayPatch={}, executors={}, recording=false,onCycleCreated,episodeOverride}={}) {
  const metrics={notifications:0,subscriptions:0,cleanups:0,stateChanges:0,provider:0,storageReadsDenied:0,storageWrites:0,nativeCalls:0,focus:0,blur:0,dismiss:0};
  const trace=[], hosts=[], cycles=[], modules=new Map(), cells=[], timers=new Map();
  let cursor=0, dirty=false, jobs=[], tree, api, phase='INITIAL', disposed=false, taskInputs=[];
  const blocked = name => () => { metrics.nativeCalls++; throw Error('FORBIDDEN_NATIVE_'+name); };
  const react={
    Fragment: 'Fragment',
    createElement(type,props,...children){return {type,props:{...props,children}};},
    useState(initial){const i=cursor++; if(!cells[i])cells[i]={value:typeof initial==='function'?initial():initial};return [cells[i].value,next=>{const value=typeof next==='function'?next(cells[i].value):next;if(!Object.is(value,cells[i].value)){cells[i].value=value;dirty=true;metrics.stateChanges++;}}];},
    useRef(initial){return cells[cursor++]??={current:initial};},
    useMemo(fn,deps){const i=cursor++;if(!same(cells[i]?.deps,deps))cells[i]={deps,value:fn()};return cells[i].value;},
    useCallback(fn,deps){return react.useMemo(()=>fn,deps);},
    useEffect(fn,deps){const i=cursor++;if(!same(cells[i]?.deps,deps)){const prior=cells[i];cells[i]={deps};jobs.push(()=>{prior?.cleanup?.();cells[i].cleanup=fn();});}},
    useLayoutEffect(fn,deps){return react.useEffect(fn,deps);},
    useSyncExternalStore(subscribe,read){react.useLayoutEffect(()=>{metrics.subscriptions++;const off=subscribe(()=>{metrics.notifications++;trace.push({kind:'notify',phase});dirty=true;});return ()=>{metrics.cleanups++;off();};},[subscribe]);return read();},
  };
  const animation=()=>({start:cb=>cb?.({finished:true}),stop(){}});
  class Value {constructor(v){this.value=v;}setValue(v){this.value=v;}stopAnimation(){}interpolate(){return this;}}
  const native={Keyboard:{dismiss(){metrics.dismiss++;}},AccessibilityInfo:{isReduceMotionEnabled:async()=>true,addEventListener:()=>({remove(){}}),setAccessibilityFocus(){}},
    Animated:{Value,View:'Animated.View',Image:'Animated.Image',timing:animation,spring:animation,sequence:animation,parallel:animation,delay:animation,loop:animation},
    AppState:{addEventListener:()=>({remove(){}})},Easing:{out:v=>v,in:v=>v,inOut:v=>v,back:v=>v,quad:1,cubic:1,sin:1},
    Platform:{OS:'ios',select:v=>v.ios},StyleSheet:{create:v=>v,absoluteFill:{},absoluteFillObject:{},hairlineWidth:1},useWindowDimensions:()=>({width:390,height:844}),findNodeHandle:()=>null,
    ...Object.fromEntries(['Image','Modal','Pressable','ScrollView','Text','TextInput','View'].map(v=>[v,v]))};
  const storage={getItem:async()=>{metrics.storageReadsDenied++;throw Error('STORAGE_READ_DENIED');},setItem:async()=>{metrics.storageWrites++;throw Error('STORAGE_WRITE_FORBIDDEN');},removeItem:async()=>{metrics.storageWrites++;throw Error('STORAGE_REMOVE_FORBIDDEN');}};
  const mocks=new Map([
    ['react',react],['react-native',native],['react-native-svg',{__esModule:true,default:'Svg',Defs:'Defs',ClipPath:'ClipPath',Polygon:'Polygon',Circle:'Circle',G:'G',RadialGradient:'RadialGradient',Stop:'Stop'}],['@expo/vector-icons',{Feather:'Feather',MaterialCommunityIcons:'Icons'}],
    ['expo-linear-gradient',{LinearGradient:'Gradient'}],['expo-status-bar',{StatusBar:'StatusBar'}],
    ['@react-native-async-storage/async-storage',storage],
    ['react-native-safe-area-context',{useSafeAreaInsets:()=>({top:47,bottom:34})}],
    ['react-native-keyboard-controller',{KeyboardAvoidingView:'KeyboardAvoidingView',useKeyboardState:select=>select({isVisible:true})}],
    ['@/components/WelcomeLogoAnimation',{WelcomeLogoAnimation:'Logo'}],['@/components/WelcomeExperience',{WelcomeExperience:'WelcomeExperience'}],
    ['@/components/Animated100Signature',{Animated100Signature:'Signature'}],['@/components/TrainerJourneyCard',{TrainerJourneyCard:'TrainerJourneyCard'}],
    ['@/context/TrainerRuntimeContext',{useOptionalTrainerJourney:()=>undefined}],
    ['@/hooks/useColors',{useColors:()=>({})}],
    ['@/context/LocalizationContext',{useLocale:()=>({locale,setLocale:v=>{locale=v;dirty=true;},t:key=>load('i18n.ts').translate(locale,key)})}],
  ]);
  const nativeModules=new Map([
    ['components/cameraC0Picker.ts',{expoCameraC0Picker:{requestCameraPermission:blocked('permission'),takePhoto:blocked('camera'),choosePhoto:blocked('library')}}],
    ['components/CameraLocalPreview.tsx',{createCameraLocalPreviewHandle:blocked('preview')}],
    ['lib/camera/expo-cache-cleanup.ts',{createExpoCacheCleanup:()=>({remove:blocked('cache-remove')})}],
    ['domain/m3/gateway-adapter.ts',{createM3GatewayAdapter:blocked('provider-adapter')}],
  ]);
  const context=createContext({console,crypto:globalThis.crypto,process:{env:Object.freeze({EXPO_PUBLIC_M3_RUNTIME_MODE:'local-verification'})},AbortController,URL,TextEncoder,TextDecoder,
    fetch:()=>{metrics.provider++;throw Error('NETWORK_FORBIDDEN');},queueMicrotask,
    setTimeout(fn){const id=Symbol();timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>{const id=Symbol();timers.set(id,fn);return id;},cancelAnimationFrame:id=>timers.delete(id)});
  function load(name,parent=app+'/entry.ts') {
    if(mocks.has(name))return mocks.get(name);
    if(/\.(png|jpg)$/.test(name)){assert.ok(['../assets/images/100-v05-sunless-scene-v1.png','../assets/images/welcome-sunrise.png','../assets/images/scene_m2_sunless_golden.jpg'].includes(name),'S32_EXACT_PRESENTATION_ASSET');return name;}
    let file=name.startsWith('@/')?resolve(app,name.slice(2)):name.startsWith('.')?resolve(dirname(parent),name):resolve(app,name);
    if(!extname(file)){file=['.ts','.tsx','.mjs','.js'].map(ext=>file+ext).find(existsSync);assert.ok(file,'MISSING_DEPENDENCY '+name);}
    assert.ok(file.startsWith(candidate+sep),'OUTSIDE_CANDIDATE '+name);
    const rel=relative(app,file).replaceAll('\\','/');if(nativeModules.has(rel))return nativeModules.get(rel);
    if(modules.has(file))return modules.get(file).exports;
    assert.ok(existsSync(file),'UNKNOWN_DEPENDENCY '+name);
    const mod={exports:{}};modules.set(file,mod);
    if(!compiled.has(file)){const bytes=readFileSync(file);const source=bytes.toString('utf8');loadedSources.set(file,{path:relative(candidate,file),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});compiled.set(file,ts.transpileModule(source,{fileName:file.replace(/\.mjs$/,'.ts'),compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText);}
    const execute=new Script('(function(require,module,exports){'+compiled.get(file)+'\n})',{filename:file}).runInContext(context);
    execute(dep=>load(dep,file),mod,mod.exports);
    // Negative-test seam only: production source and real private ref checks remain loaded.
    if(rel==='domain/m6/self-walk.ts' && episodeOverride){
      const create=mod.exports.createSelfWalk;
      mod.exports.createSelfWalk=(options)=>{const real=create(options);return Object.freeze({...real,getCurrentEpisode:(ref)=>{const episode=real.getCurrentEpisode(ref);return episode ? episodeOverride(episode) : episode;}});};
    }
    if(rel==='domain/m2.ts'){
      const actual=mod.exports.resolveM2View;mod.exports.resolveM2View=(...args)=>{const result=actual(...args);trace.push({kind:'resolve',phase,snapshot:args[0],result});return result;};
    }
    if(rel==='components/useM2Gateway.ts'){
      const actual=mod.exports.useM2Gateway;mod.exports.useM2Gateway=(...args)=>{api=actual(...args);return api;};
    }
    if(rel==='domain/trainer-runtime/m7-cycle-authority.ts'){
      const actual=mod.exports.createTrainerM7CycleAuthority;mod.exports.createTrainerM7CycleAuthority=(...args)=>{const c=actual(...args);cycles.push(c);onCycleCreated?.(c,load);return c;};
    }
    if(rel==='components/m3-host-lifetime.ts'){
      const actual=mod.exports.createM3HostLifetime;mod.exports.createM3HostLifetime=(...args)=>{const h=actual(...args);hosts.push(h);return h;};
    }
    return mod.exports;
  }
  const fixture=load('scripts/fixtures/local-owner.mjs');
  const {createLocalOwnerBoundary}=load('domain/local-owner/boundary.ts');
  const clock=new fixture.FakeClock();const authority=fixture.fakeAuthority();const boundary=createLocalOwnerBoundary(authority.verifier,clock);
  async function session(owner=fixture.OWNER_A){authority.results.push({status:'verified',owner,validUntil:100000});const lease=await boundary.control.verifySession();boundary.control.finishHydration(lease);return {access:boundary.access,lease};}
  const localAuthority=load('dev/local-verification/authority.ts').createLocalVerificationAuthority({
    origin:'http://127.0.0.1:63339',browserOrigin:'http://127.0.0.1:63338',now:clock.now,randomBytes:n=>s10Entropy(n)});
  const localWire={hold:false,queue:[],delivered:0};
  const transport=async(url,init)=>{const deliver=()=>{localWire.delivered++;const result=localAuthority.handle({url,method:init.method,
    origin:'http://127.0.0.1:63338',authorization:init.headers?.authorization,
    body:init.body?JSON.parse(init.body):undefined});return new Response(result.body===undefined?null:JSON.stringify(result.body),{status:result.status});};
    return localWire.hold&&init.method==='GET'?new Promise(resolve=>localWire.queue.push(()=>resolve(deliver()))):deliver();};
  const localModule=load('lib/identity/local-verification.ts');
  const localConfig=localModule.resolveLocalVerificationConfig('1','http://127.0.0.1:63338','http://127.0.0.1:63339','local-verification');
  const localClient=localModule.createLocalVerificationClient(localConfig,{clock,now:clock.now,fetchImpl:transport});
  assert.equal(await localClient.control.createSession(),true);
  let ownerSession=localClient.coordinator.getSnapshot().binding;
  const adapter={provenance:'TEST_FIXTURE',processing:'ON_DEVICE',contract:'M3_GATEWAY_V1',async interpret(input){taskInputs.push(input);return {intent_type:'GOAL',interpreted_meaning:'Khỏe hơn',confidence:.95,uncertainty:null,missing_context:[],clarification_needed:false,clarification_question:null,safety_state:'CLEAR',suggested_next_role:'M4',task_kind:'general_health',context_effect:'NONE',used_context_ids:[],response:'Đã ghi nhận.'};},async revoke(){}};
  const props={initialPhase:'goal',reviewing:false,onGoalOpened(){},onClose(){},ownerSession:mode==='OWNED'?ownerSession:undefined,m3HostMode:mode,
    m7RecordActivation:recording?load('components/m7-record-activation.ts').createM7RecordActivation(ownerSession,80000,clock.now):undefined,
    m2Gateway:managed?{snapshot:{revision:'fixture-root-1',subject:{id:ownerSession.access.requireLease(ownerSession.lease).owner.subjectId,loading:'ready',profile:'unknown'},permission:{status:'allowed',revision:'1'},safety:'clear',goal:'unknown',explicitIntent:false,activeTask:{kind:'unknown'},returning:{kind:'unknown'},...gatewayPatch},executors,m3Access:{status:'denied',revision:1},m3StubAdapter:adapter}:undefined};
  props.localVerification=localClient.control;props.localVerificationReady=true;
  props.localVerificationLogout=()=>localClient.coordinator.logout(new AbortController().signal);
  props.m2Gateway.setM3Access=allowed=>{props.m2Gateway.m3Access={status:allowed?'allowed':'denied',revision:props.m2Gateway.m3Access.revision+1};dirty=true;};
  const LocalControls=load('components/LocalVerificationControls.tsx').LocalVerificationControls;
  const hook=load('components/useM2Gateway.ts').useM2Gateway;
  const Flow=flow?load('components/OpeningGoalFlow.tsx').OpeningGoalFlow:undefined;
  const Card=load('components/W01ProductCard.tsx').W01ProductCard;
  const RecordCard=load('components/M7RecordCard.tsx').M7RecordCard;
  const translate=key=>load('i18n.ts').translate(locale,key);
  const nodes=()=>{const result=[];function walk(v){if(Array.isArray(v))v.forEach(walk);else if(v?.props){result.push(v);if(v.type===Card)walk(Card(v.props));else if(v.type===RecordCard)walk(RecordCard(v.props));else if(v.type===LocalControls)walk(LocalControls(v.props));else walk(v.props.children);}}walk(tree);return result;};
  const find=id=>nodes().find(n=>n.props.testID===id);
  const inputHost={focus(){metrics.focus++;find('opening-goal-input')?.props.onFocus?.();},blur(){metrics.blur++;find('opening-goal-input')?.props.onBlur?.();}};
  function render(){assert.equal(disposed,false);for(let pass=0;pass<35;pass++){dirty=false;cursor=0;tree=flow?Flow(props):(hook(props.m2Gateway,locale,translate,props.ownerSession,undefined,props.m3HostMode,props.m7RecordActivation),null);const input=find('opening-goal-input');if(input?.props.ref)input.props.ref.current=inputHost;const scroll=find('opening-goal-scroll');if(scroll?.props.ref)scroll.props.ref.current={scrollTo(){}};const pending=jobs;jobs=[];pending.forEach(fn=>fn());if(!dirty)return;}assert.fail('UNBOUNDED_RENDER');}
  async function settle(){await tick();if(dirty)render();await tick();if(dirty)render();}
  function press(id){const n=find(id);assert.ok(n,'MISSING_CONTROL '+id);assert.notEqual(n.props.disabled,true,'DISABLED_CONTROL '+id);phase=id;return n.props.onPress();}
  render();await settle();
  if(flow && tree.type==='WelcomeExperience'){tree.props.onBegin();render();await settle();}
  return {localAuthority,localWire,localClient,load,find,nodes,render,settle,press,metrics,trace,props,clock,boundary,authority,fixture,session,
    get api(){return api;},get cycle(){return cycles.at(-1);},get dirty(){return dirty;},get store(){return hosts.at(-1)?.currentSlot()?.store;},get host(){return hosts.at(-1);},get inputs(){return taskInputs;},
    setPhase(v){phase=v;},setLocale(v){locale=v;render();},
    type(text){phase='TYPE';if(flow)find('opening-goal-input').props.onChangeText(text);else api.changeText(text);render();},
    async submit(text='Khỏe hơn'){this.type(text);phase='SUBMIT';if(flow)press('opening-goal-submit');else api.submit(text);await settle();},
    async accept(){phase='ACCEPT';if(flow)press('m5-goal-use');else assert.equal(api.acceptM5GoalChoice(),true);assert.equal(dirty,true,'ACCEPT_MUST_NOTIFY');await settle();},
    async start(){for(const answer of favorable){if(flow)press('w01-answer-'+answer);else assert.equal(api.w01.presentation.answer(answer),true);assert.equal(dirty,true,'W01_MUST_NOTIFY');await settle();}if(flow)press('w01-accept');else assert.equal(api.w01.presentation.act('accept'),true);await settle();if(flow)press('w01-start');else assert.equal(api.w01.presentation.act('start'),true);assert.equal(dirty,true,'START_MUST_NOTIFY');await settle();},
    async owner(owner){ownerSession=await session(owner);props.ownerSession=ownerSession;if(recording)props.m7RecordActivation=load('components/m7-record-activation.ts').createM7RecordActivation(ownerSession,80000,clock.now);if(props.m2Gateway)props.m2Gateway={...props.m2Gateway,snapshot:{...props.m2Gateway.snapshot,subject:{...props.m2Gateway.snapshot.subject,id:owner.subjectId}}};render();await settle();},
    revoke(){phase='REVOKE';boundary.control.invalidateCurrentSession();},
    dispose(){for(const c of cells)c?.cleanup?.();disposed=true;observations.push({...metrics});assert.equal(metrics.provider,0);assert.equal(metrics.storageWrites,0);assert.equal(metrics.nativeCalls,0);assert.equal(metrics.subscriptions,metrics.cleanups);},
  };
}

test('S10 P01 actual technical authority + actual deterministic engine, explicit local grant -> M5/W01/End/M7',async()=>{
 const h=await localRealmHarness({recording:true});try{
  assert.ok(h.find('local-verification-panel'));assert.equal(h.api.m3Mode,'stub');
  assert.equal(h.props.m2Gateway.m3Access.status,'denied');assert.equal(h.api.view,null);
  await h.api.setM3Access(true);await h.settle();
  await h.submit('Khỏe hơn');assert.ok(h.find('m5-goal-use'));
  await h.accept();await h.start();assert.equal(latestResolution(h).result.phase,'started');
  h.press('w01-stop');await h.settle();assert.equal(latestResolution(h).result,null);
  h.press('w01-end');await h.settle();assert.equal(latestResolution(h).result.phase,'ended_by_user');
  assert.ok(h.find('m7-record-card')||h.find('m7-record-submit')||h.api.m7Record);
  await qaR(h);await qaF(h);
  assert.equal(h.metrics.storageWrites,0);assert.equal(h.metrics.provider,0);
 }finally{h.dispose();h.localClient.coordinator.dispose();h.localAuthority.dispose();}
});
test('S10 N01 ON_DEVICE local adapter never auto-grants missing local consent',async()=>{
 const h=await localRealmHarness();try{
  await h.submit('Khỏe hơn');assert.equal(h.find('m5-goal-use'),undefined);
  assert.equal(h.store.getSnapshot().tasks.at(-1).permission_granted,false);
 }finally{h.dispose();h.localClient.coordinator.dispose();h.localAuthority.dispose();}
});
test('S10 R01 delayed actual server verification delivered after revoke cannot publish meaning',async()=>{
 const h=await localRealmHarness();try{
  await h.api.setM3Access(true);await h.settle();h.localWire.hold=true;
  await h.submit('Khỏe hơn');assert.ok(h.localWire.queue.length);
  await h.api.setM3Access(false);await h.settle();const snapshot=h.store.getSnapshot(),before=h.localWire.delivered;
  h.localWire.hold=false;for(const release of h.localWire.queue.splice(0))release();await h.settle();
  assert.ok(h.localWire.delivered>before);assert.equal(h.store.getSnapshot(),snapshot);
  assert.equal(h.find('m5-goal-use'),undefined);
 }finally{h.dispose();h.localClient.coordinator.dispose();h.localAuthority.dispose();}
});
test('S10 N02 unsupported semantic locale is not silently treated as English',async()=>{
 const h=await localRealmHarness({locale:'ja'});try{
  await h.api.setM3Access(true);await h.settle();await h.submit('Khỏe hơn');
  assert.equal(h.find('m5-goal-use'),undefined);assert.ok(h.find('local-verification-language'));
 }finally{h.dispose();h.localClient.coordinator.dispose();h.localAuthority.dispose();}
});
test('S10 N03 technical draft/persistence and realm notices remain separate from Apple/NEW',async()=>{
 const h=await localRealmHarness();try{
  h.type('Synthetic technical text');assert.equal(h.metrics.storageWrites,0);
  assert.ok(h.find('local-verification-title'));assert.equal(h.find('opening-goal-suggestions'),undefined);
  assert.equal(latestResolution(h).snapshot.goal,'unknown');
 }finally{h.dispose();h.localClient.coordinator.dispose();h.localAuthority.dispose();}
});

/* S19B: 16 explicitly admitted falsifier groups. CODE_OFFLINE hook scheduling,
 * actual candidate root function/reader/consumer/domain code. Not browser UI. */
function bSource(h, lease=h.reader.lease, access=h.reader.access) {
  const scope=access.requireLease(lease), listeners=new Set(), timers=new Map();
  let at=Date.now(), onRead, current=true, raw;
  const witness=()=>({status:'known_none',issuer:'VERIFIED_HISTORY_AUTHORITY',owner:{...scope.owner},
    sessionGeneration:scope.generation,basisRevision:'TEST_FIXTURE-S19B-1',
    completeness:{profile:true,goal:true,activeTask:true,returning:true},observedAt:at-1,validUntil:scope.validUntil-1});
  const envelope=v=>({sourceVersion:1,state:'KNOWN_NONE',authorization:'allowed',owner:{...scope.owner},
    sessionGeneration:scope.generation,basisRevision:v.basisRevision,observedAt:v.observedAt,validUntil:v.validUntil,knownNone:v});
  raw=envelope(witness());
  const source={provenance:'TEST_FIXTURE',scenario:'S19B_EXPLICIT_KNOWN_NONE',
    getSnapshot(){onRead?.();return raw;},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    isBasisCurrent(b){return current&&b===raw?.basisRevision;}};
  const mod=h.load('domain/m2/host-facts-reader.ts');
  const port=mod.admitOwnerScopedFixturePort(access,lease,source);
  const clock={now:()=>at,schedule(fn,ms){const id={fn,ms};timers.set(id,id);return()=>timers.delete(id);}};
  const host=mod.createHostFactsReader(access,lease,port,clock);
  return {mod,port,host,clock,scope,access,lease,envelope,source,listeners,timers,
    get raw(){return raw;},set(v,notify=true){raw=v;if(notify)for(const f of [...listeners])f();},
    onRead(fn){onRead=fn;},deny(){current=false;},advance(ms,run=true){at+=ms;if(run)for(const t of [...timers.values()]){timers.delete(t);t.fn();}},
    close(){host.dispose();assert.equal(listeners.size,0);assert.equal(timers.size,0);}};
}
async function bHarness() {
  const h=await s8Harness(),f=bSource(h);f.host.start();
  const attach=()=>{const state=f.host.getSnapshot();
    const base=h.s8.projectAuthoritativeM2Baseline(h.props.m2Gateway.snapshot,state.reader);
    f.host.trackBaseline(base,state.epoch);h.props.m2Gateway={...h.props.m2Gateway,snapshot:base};h.render();return base;};
  return {h,f,attach,close(){f.close();h.dispose();}};
}
test('S19B PF01 actual admitted reader -> NEW four suggestions, provenance TEST_FIXTURE_SCOPED',async()=>{
 const b=await bHarness();try{const base=b.attach();assert.equal(b.f.host.getSnapshot().scope,'TEST_FIXTURE_SCOPED');
  assert.equal(b.f.host.getSnapshot().provenance,'TEST_FIXTURE');assert.equal(latestResolution(b.h).result.kind,'goal');
  assert.equal(latestResolution(b.h).result.notes.length,4);assert.ok(b.h.find('opening-goal-suggestions'));
  assert.ok(base!==b.h.props.m2Gateway);assert.equal(b.h.metrics.provider,0);
 }finally{b.close();}
});
test('S19B PF02 unconfigured production never turns ready owner/empty RAM into NEW',async()=>{
 const h=await s8Harness();try{const m=h.load('domain/m2/host-facts-reader.ts');
  for(const port of [undefined,{}, {provenance:'PRODUCTION_OWNED'},{provenance:'TEST_FIXTURE'}]){
   const x=m.createHostFactsReader(h.reader.access,h.reader.lease,port);x.start();
   assert.equal(x.getSnapshot().reader,undefined);assert.equal(x.getSnapshot().phase,'UNKNOWN');x.dispose();
  }
  h.props.m2Gateway.snapshot=h.s8.projectAuthoritativeM2Baseline(h.props.m2Gateway.snapshot);h.render();s8Missing(h);
 }finally{h.dispose();}
});
test('S19B PF03 actual W01 STARTED remains IN_PROGRESS; STOP not End; canonical End separate',async()=>{
 const b=await bHarness();try{b.attach();await b.h.submit();await b.h.accept();await b.h.start();
  assert.equal(latestResolution(b.h).result.phase,'started');b.h.press('w01-stop');await b.h.settle();
  assert.equal(latestResolution(b.h).result,null);b.h.press('w01-end');await b.h.settle();
  assert.equal(latestResolution(b.h).result.phase,'ended_by_user');
 }finally{b.close();}
});
test('S19B NF01 label/issuer/plain caller object cannot self-admit a reader',async()=>{
 const b=await bHarness();try{for(const port of [{...b.f.port},{...b.f.port,provenance:'PRODUCTION_OWNED'},null]){
  const x=b.f.mod.createHostFactsReader(b.f.access,b.f.lease,port);x.start();assert.equal(x.getSnapshot().phase,'UNKNOWN');x.dispose();}
  assert.throws(()=>b.f.mod.admitOwnerScopedFixturePort(b.f.access,b.f.lease,{...b.f.source,provenance:'PRODUCTION_OWNED'}));
 }finally{b.close();}
});
test('S19B NF02 each required witness/completeness, unknown/error/throw/accessor/proxy fails closed',async()=>{
 const h=await s8Harness();try{
 const variants=[];
 for(const k of ['status','issuer','owner','sessionGeneration','basisRevision','completeness','observedAt','validUntil'])
  variants.push(s=>{const v={...s.knownNone};delete v[k];return {...s,knownNone:v};});
 for(const k of ['profile','goal','activeTask','returning'])variants.push(s=>({...s,knownNone:{...s.knownNone,completeness:{...s.knownNone.completeness,[k]:false}}}));
 for(const state of ['UNCONFIGURED','UNKNOWN','HAS_HISTORY','CONFLICTED','ERROR'])variants.push(s=>({...s,state}));
 variants.push(s=>Object.defineProperty({...s},'knownNone',{get(){throw Error('getter');}}));
 variants.push(s=>new Proxy(s,{ownKeys(){throw Error('proxy trap');}}));
 for(const change of variants){const f=bSource(h);try{f.set(change(f.raw),false);f.host.start();assert.equal(f.host.getSnapshot().reader,undefined);}finally{f.close();}}
 const f=bSource(h);try{f.onRead(()=>{throw Error('source failure');});f.host.start();assert.equal(f.host.getSnapshot().reader,undefined);}finally{f.close();}
 }finally{h.dispose();}
});
test('S19B NF03 exact subject/profile/generation/access/opaque lease required',async()=>{
 const h=await s8Harness();try{
 for(const change of [s=>({...s,owner:{...s.owner,subjectId:'foreign'}}),s=>({...s,owner:{...s.owner,profileId:'foreign'}}),
 s=>({...s,sessionGeneration:s.sessionGeneration+1}),s=>({...s,knownNone:{...s.knownNone,owner:{...s.owner,profileId:'foreign'}}})]){
 const f=bSource(h);try{f.set(change(f.raw),false);f.host.start();assert.equal(f.host.getSnapshot().reader,undefined);}finally{f.close();}}
 const f=bSource(h);try{for(const [a,l]of [[f.access,{}],[{...f.access},f.lease]]){const x=f.mod.createHostFactsReader(a,l,f.port);x.start();assert.equal(x.getSnapshot().reader,undefined);x.dispose();}}finally{f.close();}
 }finally{h.dispose();}
});
test('S19B NF04 invalid/conflicting basis, version rollback and same-version payload collision rejected',async()=>{
 const h=await s8Harness();try{
 for(const basis of ['', ' bad ', 'bad\ncontrol', 'x'.repeat(256)]){
 const f=bSource(h);try{const v={...f.raw.knownNone,basisRevision:basis};f.set({...f.raw,basisRevision:basis,knownNone:v},false);f.host.start();assert.equal(f.host.getSnapshot().reader,undefined);}finally{f.close();}}
 const f=bSource(h);try{f.host.start();const old=f.host.getSnapshot().reader;assert.ok(old.readFacts());
 f.set({...f.raw,sourceVersion:3,state:'CONFLICTED'});f.set({...f.raw,sourceVersion:2,state:'KNOWN_NONE'});assert.equal(f.host.getSnapshot().reader,undefined);assert.equal(old.readFacts(),undefined);
 }finally{f.close();}
 const g=bSource(h);try{g.host.start();const r=g.host.getSnapshot().reader;g.set({...g.raw,knownNone:{...g.raw.knownNone,observedAt:g.raw.observedAt-1}},false);assert.equal(r.readFacts(),undefined);}finally{g.close();}
 for(const value of [false,1,'true',{},Promise.resolve(true)]){const f=bSource(h);try{f.source.isBasisCurrent=()=>value;f.host.start();assert.equal(f.host.getSnapshot().reader,undefined);}finally{f.close();}}
 const collision=bSource(h);try{collision.host.start();collision.set({...collision.raw,sourceVersion:2,state:'UNKNOWN'});collision.set({...collision.raw,state:'KNOWN_NONE'});assert.equal(collision.host.getSnapshot().reader,undefined);}finally{collision.close();}
 }finally{h.dispose();}
});
test('S19B NF05 future/nonfinite/expired/over-lease times fail closed',async()=>{
 const h=await s8Harness();try{for(const pair of [['observedAt',Infinity],['observedAt',Date.now()+900000],['validUntil',Date.now()-1],['validUntil',h.scope.validUntil+1]]){
 const f=bSource(h);try{const [k,v]=pair;f.set({...f.raw,[k]:v,knownNone:{...f.raw.knownNone,[k]:v}},false);f.host.start();assert.equal(f.host.getSnapshot().reader,undefined);}finally{f.close();}}
 }finally{h.dispose();}
});
test('S19B RF01 same binding basis notification retires old carrier BEFORE observer, fresh epoch reader',async()=>{
 const b=await bHarness();try{const base=b.attach(),old=b.f.host.getSnapshot().reader;let observed;
 const off=b.f.host.subscribe(()=>{observed=old.readFacts();});
 const v={...b.f.raw.knownNone,basisRevision:'TEST_FIXTURE-S19B-2'};
 b.f.set({...b.f.raw,sourceVersion:2,basisRevision:v.basisRevision,knownNone:v});
 assert.equal(observed,undefined);assert.equal(old.readFacts(),undefined);
 assert.equal(b.h.s8.readAuthoritativeKnownNone(base,b.f.access,b.f.lease,{}, {session_id:'x',revision:1,tasksEmpty:true},Date.now()),undefined);
 assert.notEqual(b.f.host.getSnapshot().reader,old);b.attach();assert.equal(latestResolution(b.h).result.kind,'goal');off();
 }finally{b.close();}
});
test('S19B RF02 revoke/logout/ownerABA and reentrant read reject old results',async()=>{
 const b=await bHarness();try{b.attach();const old=b.f.host.getSnapshot().reader;b.h.revoke();assert.equal(old.readFacts(),undefined);
 await b.h.owner(b.h.fixture.OWNER_B);await b.h.owner(b.h.fixture.OWNER_A);assert.equal(old.readFacts(),undefined);
 b.f.host.dispose();b.f.host.start();assert.equal(old.readFacts(),undefined);
 }finally{b.close();}
 const c=await bHarness();try{const old=c.f.host.getSnapshot().reader;let once=true;c.f.onRead(()=>{if(once){once=false;c.f.host.invalidate();}});assert.equal(old.readFacts(),undefined);}finally{c.close();}
});
test('S19B RF03 expiry while event-loop timer delayed and during read fails closed',async()=>{
 const b=await bHarness();try{b.attach();const r=b.f.host.getSnapshot().reader;b.f.advance(700000,false);assert.equal(r.readFacts(),undefined);assert.equal(b.f.host.getSnapshot().phase,'UNKNOWN');}finally{b.close();}
 const c=await bHarness();try{const r=c.f.host.getSnapshot().reader;let once=true;c.f.onRead(()=>{if(once){once=false;c.f.advance(700000,false);}});assert.equal(r.readFacts(),undefined);}finally{c.close();}
});
test('S19B RF04 subscribe-gap, registration-gap, source replacement, StrictMode lifecycle cleanup',async()=>{
 const h=await s8Harness();try{
 const f=bSource(h);try{
 const original=f.source.subscribe;f.source.subscribe=fn=>{const off=original(fn);f.set({...f.raw,sourceVersion:2},false);return off;};
 f.host.start();assert.equal(f.host.getSnapshot().sourceVersion,2);
 const old=f.host.getSnapshot(),base=h.s8.projectAuthoritativeM2Baseline(h.props.m2Gateway.snapshot,old.reader);
 f.host.invalidate();f.host.trackBaseline(base,old.epoch);assert.equal(old.reader.readFacts(),undefined);
 f.host.dispose();assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);
 f.host.start();assert.equal(f.host.getSnapshot().phase,'UNKNOWN'); // same retired version cannot be renewed
 f.set({...f.raw,sourceVersion:3});assert.equal(f.host.getSnapshot().phase,'KNOWN_NONE');
 }finally{f.close();}
 }finally{h.dispose();}
});
test('S19B RF05 pristine task lifecycle mandatory; empty-after-task cannot resurrect NEW',async()=>{
 const b=await bHarness();try{b.attach();await b.h.submit();b.h.store.stop();b.h.render();s8Missing(b.h);
 b.f.set({...b.f.raw,sourceVersion:2});b.attach();s8Missing(b.h);
 }finally{b.close();}
});
test('S19B RF06 silent mutation/missing notifications and deleted facts cannot revive stale cache',async()=>{
 const b=await bHarness();try{const old=b.f.host.getSnapshot().reader;
 b.f.set({...b.f.raw,state:'UNKNOWN'},false);assert.equal(old.readFacts(),undefined);
 b.f.set({...b.f.raw,sourceVersion:2,state:'KNOWN_NONE'});const newer=b.f.host.getSnapshot().reader;assert.ok(newer);
 b.f.set({...b.f.raw,sourceVersion:3,state:'UNKNOWN'});assert.equal(newer.readFacts(),undefined);
 b.f.set({...b.f.raw,sourceVersion:2,state:'KNOWN_NONE'});assert.equal(b.f.host.getSnapshot().reader,undefined);
 }finally{b.close();}
});
// Compile the EXACT root function/hook AST into a modeled React frame. Explicit imports
// only: actual candidate reader, projector and local-binding registry; no ambient exports.
function bRootFrame(h, port, sourceOverride) {
 const text=sourceOverride ?? readFileSync(resolve(app,'app/_layout.tsx'),'utf8'),ast=ts.createSourceFile('root.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const imported=new Set();for(const n of ast.statements){if(ts.isImportDeclaration(n)){const c=n.importClause;if(c?.name)imported.add(c.name.text);if(c?.namedBindings&&ts.isNamedImports(c.namedBindings))for(const e of c.namedBindings.elements)if(!e.isTypeOnly)imported.add(e.name.text);}}
 for(const name of ['createHostFactsReader','projectAuthoritativeM2Baseline','readLocalVerificationBinding','useSyncExternalStore','useMemo','useLayoutEffect'])if(!imported.has(name))throw new ReferenceError('ROOT_IMPORT_MISSING '+name);
 const selected=['useHostM2Facts','AppSurface'].map(name=>{const n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(n);return n.getText(ast).replace(/^export\s+/,'');}).join('\n');
 let cells=[],cursor=0,jobs=[],dirty=false,tree;
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),
 useState(v){const i=cursor++;if(!cells[i])cells[i]={value:typeof v==='function'?v():v};return[cells[i].value,n=>{const v=typeof n==='function'?n(cells[i].value):n;if(!Object.is(v,cells[i].value)){cells[i].value=v;dirty=true;}}];},
 useRef(v){return cells[cursor++]??={current:v};},
 useMemo(fn,deps){const i=cursor++;if(!same(cells[i]?.deps,deps))cells[i]={deps,value:fn()};return cells[i].value;},
 useLayoutEffect(fn,deps){const i=cursor++;if(!same(cells[i]?.deps,deps)){const old=cells[i];cells[i]={deps};jobs.push(()=>{old?.cleanup?.();cells[i].cleanup=fn();});}},
 useEffect(fn,deps){return react.useLayoutEffect(fn,deps);},
 useSyncExternalStore(sub,read){react.useLayoutEffect(()=>sub(()=>dirty=true),[sub]);return read();}};
 const facts=h.load('domain/m2/host-facts-reader.ts'),project=h.load('domain/m2/factual-snapshot.ts'),local=h.load('lib/identity/local-verification.ts');
 const context=createContext({React:react,...react,createHostFactsReader:facts.createHostFactsReader,projectAuthoritativeM2Baseline:project.projectAuthoritativeM2Baseline,
 readLocalVerificationBinding:local.readLocalVerificationBinding,useOwnerSessionBinding:()=>h.localClient.coordinator.getSnapshot().binding,
 useOwnerSessionControl:()=>({phase:h.localClient.coordinator.getSnapshot().phase,localVerification:h.localClient.control,logout:()=>h.localClient.coordinator.logout(new AbortController().signal)}),
 useWelcome:()=>({hydrated:true,visible:true,reviewing:false,runId:1,markWelcomeSeen(){},closeWelcome(){}}),useRouter:()=>({}),
 resolveWelcomeInitialPhase:()=> 'goal',FORCE_SLICE_PREVIEW_OPENING:false,
 createM7RecordActivation:()=>undefined,selectM3RuntimeAdapter:()=>undefined,createM3StubAdapter:()=>undefined,M3_RUNTIME_MODE:'off',
 Platform:{OS:'ios'},SplashScreen:{hideAsync:async()=>{}},View:'View',Text:'Text',PrivateOwnerProviders:'PrivateOwnerProviders',
 GestureHandlerRootView:'GestureHandlerRootView',StatusBar:'StatusBar',RootLayoutNav:'RootLayoutNav',OpeningGoalFlow:'OpeningGoalFlow',
 styles:{surface:{},welcomeOverlay:{}},console,Date,Promise});
 const compiled=ts.transpileModule(selected+'\n;globalThis.root=AppSurface;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
 new Script(compiled,{filename:'actual-root-fragment.js'}).runInContext(context);
 const nodes=()=>{const a=[];function walk(x){if(Array.isArray(x))x.forEach(walk);else if(x?.props){a.push(x);walk(x.props.children);}}walk(tree);return a;};
 const render=()=>{for(let n=0;n<30;n++){dirty=false;cursor=0;tree=context.root({factsPort:port});const q=jobs;jobs=[];q.forEach(f=>f());if(!dirty)return;}assert.fail('ROOT_RENDER_LOOP');};
 render();return {render,nodes,get gateway(){return nodes().find(n=>n.type==='OpeningGoalFlow').props.m2Gateway;},
 close(){cells.forEach(c=>c.cleanup?.());}};
}
test('S19B IS01 actual root lexical fragment propagates port epochs, invalidates revoke and renders fixture watermark',async()=>{
 const h=await localRealmHarness();let root,f;
 try{
 h.clock.time=Date.now();assert.equal(await h.localClient.control.createSession(),true);
 const binding=h.localClient.coordinator.getSnapshot().binding;
 f=bSource(h,binding.lease,binding.access); // explicit corpus bound to actual local-client opaque lease
 const mutant=readFileSync(resolve(app,'app/_layout.tsx'),'utf8').replace('createHostFactsReader, type OwnerScopedFactsPort','type OwnerScopedFactsPort');
 assert.throws(()=>bRootFrame(h,f.port,mutant),ReferenceError);
 root=bRootFrame(h,f.port);const base=root.gateway.snapshot;
 assert.ok(root.nodes().some(n=>n.props.testID==='m2-history-provenance-test-fixture'));
 const mod=h.load('domain/m2/factual-snapshot.ts'),scope=binding.access.requireLease(binding.lease),life={};
 assert.ok(mod.readAuthoritativeKnownNone(base,binding.access,binding.lease,life,{session_id:'root-test',revision:1,tasksEmpty:true},Date.now()));
 const v={...f.raw.knownNone,basisRevision:'TEST_FIXTURE-root-next'};
 f.set({...f.raw,sourceVersion:2,basisRevision:v.basisRevision,knownNone:v});root.render();
 assert.notEqual(root.gateway.snapshot,base);
 assert.equal(mod.readAuthoritativeKnownNone(base,binding.access,binding.lease,life,{session_id:'root-test',revision:1,tasksEmpty:true},Date.now()),undefined);
 root.gateway.setM3Access(false);root.render();
 assert.equal(root.nodes().some(n=>n.props.testID==='m2-history-provenance-test-fixture'),false);
 assert.equal(root.gateway.snapshot.goal,'unknown');
 }finally{root?.close();f?.close();h.dispose();h.localClient.coordinator.dispose();h.localAuthority.dispose();}
});
test('S19B IS02 production-root default absent port stays UNKNOWN; no shell/task/fixture fallback',async()=>{
 const h=await localRealmHarness();let root;
 try{root=bRootFrame(h,undefined);assert.equal(root.gateway.snapshot.goal,'unknown');assert.equal(root.nodes().some(n=>n.props.testID==='m2-history-provenance-test-fixture'),false);
 const text=readFileSync(resolve(app,'app/_layout.tsx'),'utf8');assert.doesNotMatch(text,/admitOwnerScopedFixturePort\(/);
 assert.match(text,/facts\.snapshot\.reader/);
 assert.equal(h.metrics.provider,0);assert.equal(h.metrics.storageWrites,0);
 }finally{root?.close();h.dispose();h.localClient.coordinator.dispose();h.localAuthority.dispose();}
});

test('S32 expression scope preserves user words, rejects retired owner/locale callbacks, and never submits',async()=>{
 const h=await s9Harness();try{
  h.type('Lời của riêng tôi');await h.settle();
  const p=h.find('opening-pillar-fat-loss');assert.ok(p);
  const held=p.props.onPress;
  h.type('Câu mới vừa sửa');held();await h.settle();
  assert.equal(h.find('opening-goal-input').props.value,'Câu mới vừa sửa','use-time text wins over captured draft');
  assert.ok(h.find('opening-attached-pillar'));assert.equal(h.inputs.length,0);assert.equal(h.api.view,null);
  h.setLocale('ja');assert.equal(held(),false,'retired locale callback cannot fill old-language text');
  const jp=h.find('opening-pillar-health').props.onPress;
  await h.owner(h.fixture.OWNER_B);assert.equal(jp(),false,'old owner callback fails closed');
  assert.equal(h.inputs.length,0);
 }finally{h.dispose();}
});
