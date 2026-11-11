import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { dirname, extname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
registerHooks({ resolve(s,c,n) { return n(s.startsWith('.') && !extname(s) ? s+'.ts' : s,c); } });
let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw new Error('NETWORK_FORBIDDEN'); };
const { LOCALE_OPTIONS, RELEASE_LOCALE_OPTIONS, COMPACT_LOCALE_LABELS, openingMessages } = await import('../i18n-opening.ts');
const { m2Messages } = await import('../i18n-m2.ts');
const { privacyMessages } = await import('../i18n-privacy.ts');
const { translate, RELEASE_SYSTEM_TRANSLATION_KEYS } = await import('../i18n.ts');
const expected = ['vi','en','zh-Hans','es','hi','ja','ko','ru'];
assert.equal(LOCALE_OPTIONS.length,20);
assert.deepEqual(RELEASE_LOCALE_OPTIONS.map(x=>x.id).sort(),[...expected].sort());
const chips = [
 ['Sức khỏe','Vóc dáng','Cơ bắp','Vận động'],
 ['Health','Body shape','Muscles','Movement'],
 ['健康','身材','肌肉','活动能力'],
 ['Salud','Figura','Músculos','Movilidad'],
 ['स्वास्थ्य','शरीर का आकार','मांसपेशियाँ','गतिशीलता'],
 ['健康','体型','筋肉','動き'],
 ['건강','체형','근육','움직임'],
 ['Здоровье','Форма тела','Мышцы','Подвижность'],
];
const compact=['VI - EN','EN','中文 - EN','ES - EN','हिन्दी - EN','日本語 - EN','한국어 - EN','Русский - EN'];
for(const [i,l] of expected.entries()) {
 assert.equal(COMPACT_LOCALE_LABELS[l],compact[i]);
 assert.deepEqual(['m2Health','m2Appearance','m2Strength','m2Movement'].map(k=>translate(l,k)),chips[i]);
 for(const k of Object.keys(m2Messages.vi)) {
  assert.equal(typeof m2Messages[l][k],'string',l+':'+k);
  assert.ok(m2Messages[l][k].trim());
  assert.equal(translate(l,k),m2Messages[l][k]);
 }
 for(const k of Object.keys(openingMessages.vi)) assert.ok(openingMessages[l][k].trim());
}
const healthCopy={vi:'Khỏe hơn',en:'Feel healthier','zh-Hans':'改善健康',es:'Mejorar mi salud',
 hi:'स्वास्थ्य बेहतर करना',ja:'健康を整える',ko:'건강 개선',ru:'Улучшить здоровье'};
for(const l of expected) {
 assert.equal(openingMessages[l].goalSuggestionHealth,healthCopy[l],`R8-T04 ${l} Health != Strength`);
 for(const key of RELEASE_SYSTEM_TRANSLATION_KEYS) {
  const value=translate(l,key);
  assert.ok(value.trim()&&value!==key,`R8-T03 ${l}:${key}`);
 }
 assert.equal(new Set(['interactionStop','interactionPause','cancel','interactionCorrect']
  .map(key=>translate(l,key))).size,4,`R8-T05 distinct controls ${l}`);
 assert.equal(new Set(['privacyDeleteConfirmed','privacyDeletePartial','privacyDeleteFailed']
  .map(key=>privacyMessages[l][key])).size,3,`R8-T08 delete results ${l}`);
 assert.notEqual(privacyMessages[l].privacyLocalDeleteBoundary,
  privacyMessages[l].privacyExternalAiBoundary,`R8-T08 local delete vs recall ${l}`);
}
for(const l of expected.filter(l=>!['vi','en'].includes(l))) {
 for(const key of RELEASE_SYSTEM_TRANSLATION_KEYS) {
  assert.notEqual(translate(l,key),translate('en',key),`R8-T03 English fallback ${l}:${key}`);
  assert.notEqual(translate(l,key),translate('vi',key),`R8-T03 Vietnamese fallback ${l}:${key}`);
 }
}
assert.equal(networkCalls,0);
console.log('R8-T01 exact release set/hidden-12: PASS');
console.log('R8-T03 selected-locale audited system copy/no en-vi fallback: PASS');
console.log('R8-T04 Health != Strength; R8-T05 distinct controls: PASS');
console.log('R8-T08 local/server/delete-result/revoke-vs-recall copy remains distinct: PASS');
console.log('Localization registry/resources: PASS; provider/network AI calls: 0');

const { resolveInitialLocale, PRODUCTION_IP_COUNTRY_STATUS } = await import('../locale-bootstrap.ts');
const { M3_LOCALES, M3_LOCALE_CONFIG } = await import('../../../lib/api-zod/src/m3-locales.ts');
const { parseM3Request, makeM3Response, m3LanguageInput } = await import('../../../lib/api-zod/src/m3-contract.ts');
const { m3Instructions } = await import('../../../lib/api-zod/src/m3-instructions.ts');
assert.deepEqual(M3_LOCALES,expected);
assert.equal(PRODUCTION_IP_COUNTRY_STATUS,'PENDING');
for(const [country,locale] of Object.entries({VN:'vi',CN:'zh-Hans',JP:'ja',KR:'ko',RU:'ru',IN:'hi',ES:'es',MX:'es',AR:'es',US:'en'})) {
 assert.equal(resolveInitialLocale({trustedCountryCode:country,deviceLocale:'ja-JP'}),locale);
 assert.equal(resolveInitialLocale({manualChoice:'ko',trustedCountryCode:country,deviceLocale:'ja-JP'}),'ko');
}
assert.equal(resolveInitialLocale({trustedCountryCode:'FR',deviceLocale:'ja-JP'}),'en');
for(const tag of ['fr-FR','zh-Hant-TW','unknown']) assert.equal(resolveInitialLocale({deviceLocale:tag}),'en');
for(const [tag,l] of [['vi-VN','vi'],['zh-CN','zh-Hans'],['ja-JP','ja'],['es-MX','es'],['hi-IN','hi'],['ru-RU','ru'],['ko-KR','ko'],['en-US','en']])
 assert.equal(resolveInitialLocale({deviceLocale:tag}),l);
assert.equal(resolveInitialLocale({manualChoice:'fr',deviceLocale:'ja-JP'}),'ja');

// Exercise the actual transport and SessionTask using a synthetic in-memory
// HTTP boundary. Fixtures prove locale/context/routing preservation, not model
// comprehension; live linguistic acceptance remains a separate authorized gate.
registerHooks({ resolve(s,c,n) {
 if(s==='@workspace/api-client-react') return n(new URL('../../../lib/api-client-react/src/index.ts',import.meta.url).href,c);
 return n(s.startsWith('.') && (!extname(s)||s.endsWith('/api.schemas')) ? s+'.ts':s,c);
} });
const { createM3GatewayAdapter } = await import('../domain/m3/gateway-adapter.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const { AiM3Body } = await import('../../../lib/api-zod/src/generated/api.ts');
const samples={"vi":["Tôi muốn cải thiện sức khỏe.","Còn 20 phút.","Không, tôi nói bụng khó chịu.","Thôi.","Đầu gối tôi đau nhói khi squat.","Cái đó."],"en":["I want to improve my health.","Only 20 minutes left.","No, I meant abdominal discomfort.","Stop.","My knee hurts sharply when I squat.","That thing."],"zh-Hans":["我想改善健康。","只剩20分钟。","不，我说的是腹部不适。","停下。","深蹲时我的膝盖刺痛。","那个。"],"es":["Quiero mejorar mi salud.","Quedan 20 minutos.","No, me refiero a molestias abdominales.","Basta.","Siento un dolor agudo en la rodilla al hacer sentadillas.","Eso."],"hi":["मैं अपना स्वास्थ्य सुधारना चाहता हूँ।","केवल 20 मिनट बचे हैं।","नहीं, मेरा मतलब पेट में तकलीफ़ है।","बस।","स्क्वाट करते समय मेरे घुटने में तेज़ दर्द होता है।","वह चीज़।"],"ja":["健康を改善したいです。","あと20分です。","いいえ、お腹の不快感のことです。","やめます。","スクワットをすると膝に鋭い痛みがあります。","あれ。"],"ko":["건강을 개선하고 싶어요.","20분 남았어요.","아니요, 배가 불편하다는 뜻이에요.","그만해요.","스쿼트를 할 때 무릎이 날카롭게 아파요.","그거요."],"ru":["Я хочу улучшить здоровье.","Осталось 20 минут.","Нет, я имел в виду дискомфорт в животе.","Хватит.","При приседании я чувствую резкую боль в колене.","Это."]};
const questions={"vi":"Bạn đang nói đến điều gì?","en":"What do you mean?","zh-Hans":"你指的是什么？","es":"¿A qué te refieres?","hi":"आपका क्या मतलब है?","ja":"何のことですか？","ko":"무엇을 말하는 건가요?","ru":"Что вы имеете в виду?"};
const fixture = (l,kind,extra={}) => ({
 intent_type:kind, interpreted_meaning:samples[l][0], confidence:.9,
 uncertainty:null, missing_context:[], clarification_needed:false,clarification_question:null,
 safety_state:'CLEAR', suggested_next_role:['STOP_PAUSE','REFUSAL','SAFETY'].includes(kind)?'STOP':'M4',
 task_kind:null,context_effect:'NONE',used_context_ids:[],response:m2Messages[l].m2Acknowledged,...extra,
});
const input = (l,text,extra={}) => ({locale:l,current_text:text,relevant_context:[],recent_relevant_turns:[],
 user_correction:null,safety_signal:'CLEAR',asking_stopped:false,...extra});
const envelope = (l,content) => ({version:'m3.v1',operation:'interpret',requestId:'localization-request',sessionId:'localization-session',
 taskId:'task-1',taskRevision:2,permissionRevision:1,grantId:'localization-grant',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),
 locale:l,consent:{granted:true,version:'m3.v1',purpose:'m3_intent_understanding'},input:content});
for(const hidden of LOCALE_OPTIONS.filter(x=>!expected.includes(x.id))) {
 const request=envelope(hidden.id,input(hidden.id,'test'));
 assert.throws(()=>parseM3Request(request));
 assert.equal(AiM3Body.safeParse(request).success,false);
}
let semanticCases=0,chipCases=0;
for(const [i,l] of expected.entries()) {
 assert.ok(m3Instructions(l).includes(M3_LOCALE_CONFIG[l].language));
 assert.ok(m3Instructions(l).includes('visible question in recent_relevant_turns'));
 const cases=[
  [input(l,samples[l][0]),fixture(l,'GOAL')],
  [input(l,samples[l][1],{relevant_context:[{id:'workout-1',kind:'workout',text:samples[l][0],permission:'external_ai_allowed'}]}),
   fixture(l,'CURRENT_TASK',{context_effect:'ADJUST_CURRENT',used_context_ids:['workout-1']})],
  [input(l,samples[l][2],{user_correction:{text:samples[l][2],replaces_revision:1}}),fixture(l,'CORRECTION')],
  [input(l,samples[l][3]),fixture(l,'STOP_PAUSE')],
  [input(l,samples[l][4],{safety_signal:'PAIN'}),fixture(l,'GOAL')],
  [input(l,samples[l][5]),fixture(l,'AMBIGUOUS',{uncertainty:questions[l].slice(0,-1),missing_context:[questions[l].slice(0,-1)],
   clarification_needed:true,clarification_question:questions[l]})],
 ];
 for(const [content,meaning] of cases) {
  const request=parseM3Request(envelope(l,content));
  assert.equal(AiM3Body.safeParse(request).success,true);
  const response=makeM3Response(request,meaning,{inputTokens:0,outputTokens:0});
  assert.equal(m3LanguageInput(request).locale,l);
  assert.equal(response.intentType,content.safety_signal==='PAIN'?'SAFETY':meaning.intent_type);
  assert.equal(response.suggestedNextRole,content.safety_signal==='PAIN'?'STOP':meaning.suggested_next_role);
  assert.equal(response.clarificationNeeded,meaning.clarification_needed);
  if(content.safety_signal==='PAIN') assert.equal(response.response,M3_LOCALE_CONFIG[l].safety);
  if(meaning.intent_type==='STOP_PAUSE') assert.equal(response.response,M3_LOCALE_CONFIG[l].stop);
  semanticCases++;
 }
 for(const chip of chips[i]) {
  const seen=[];
  const adapter=createM3GatewayAdapter({provenance:'TEST_FIXTURE',isSessionCurrent:()=>true,
   authorization:Object.freeze({async withBearer(signal,use){assert.equal(signal.aborted,false);return use('Bearer localization-fixture');}}),
   http:async(url,init)=>{
   const body=JSON.parse(init.body); seen.push({url,body});
   assert.equal(init.headers.Authorization,'Bearer localization-fixture');
   if(url.endsWith('/api/ai/m3/permission')) {
    assert.equal(body.action,'GRANT');
    return {ok:true,status:200,json:async()=>({
     version:body.version,action:'GRANT',purpose:body.purpose,operationId:body.operationId,
     grantId:'localization-grant',taskSessionId:body.taskSessionId,taskId:body.taskId,
     taskRevision:body.taskRevision,permissionRevision:body.permissionRevision,
     expiresAt:new Date(Date.now()+60000).toISOString(),
    })};
   }
   const request=parseM3Request(body);
   assert.equal(request.locale,l);assert.equal(request.input.locale,l);
   assert.equal(request.input.current_text,chip);
   assert.equal(request.input.recent_relevant_turns[0].text,m2Messages[l].m2Question);
   return {ok:true,status:200,json:async()=>makeM3Response(request,fixture(l,'GOAL'),{inputTokens:0,outputTokens:0})};
  }});
  const store=createSessionTaskStore({adapter});
  store.start();
  const id=store.submit(chip,{locale:l,permission_granted:true,permission_revision:1,recent_relevant_turns:[{role:'assistant',text:m2Messages[l].m2Question}]});
  for(let k=0;k<20&&!store.getSnapshot().tasks.find(t=>t.task_id===id)?.interpretation;k++) await new Promise(r=>setTimeout(r,1));
  const task=store.getSnapshot().tasks.find(t=>t.task_id===id);
  assert.equal(task.m3_context.locale,l);
  assert.equal(task.interpretation?.intent_type,'GOAL',l+':'+chip);
  assert.equal(task.interpretation.clarification_needed,false);
  assert.equal(task.interpretation.suggested_next_role,'M4');
  assert.equal(seen.length,2);
  assert.equal(store.cancel(store.reference(id)),true);
  assert.equal(store.getSnapshot().tasks.find(t=>t.task_id===id).status,'CANCELLED');
  store.stop(); chipCases++;
 }
}
assert.equal(semanticCases,48); assert.equal(chipCases,32); assert.equal(networkCalls,0);
console.log('Locale bootstrap/country/manual precedence: PASS');
console.log('Exact-8 generated/request/transport contract and hidden-12 rejection: PASS');
console.log('48 synthetic semantic contract cases + 32 contextual chip transport cases: PASS');
console.log('Live model comprehension: NOT_RUN; provider/network AI calls: 0');

const { readFile } = await import('node:fs/promises');
const { Script } = await import('node:vm');
const { default: ts } = await import('typescript');
const source = await readFile(new URL('../context/LocalizationContext.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const openingModule=await import('../i18n-opening.ts');
const i18nModule=await import('../i18n.ts');
const bootstrapModule=await import('../locale-bootstrap.ts');
async function boot(saved,fail=false) {
 const cells=[],effects=[],writes=[];let cursor=0,first=true,resolveRead,rejectRead;
 const storage={getItem:()=>new Promise((r,j)=>{resolveRead=r;rejectRead=j;}),setItem:async(k,v)=>{writes.push([k,v]);}};
 const react={createContext:()=>({Provider:'Provider'}),createElement:(type,props,...children)=>({type,props,children}),
  useState(initial){const i=cursor++;if(first)cells[i]=typeof initial==='function'?initial():initial;return[cells[i],v=>{cells[i]=v;}];},
  useRef(value){const i=cursor++;if(first)cells[i]={current:value};return cells[i];},
  useEffect(fn){if(first)effects.push(fn);},useMemo:fn=>fn()};
 const mod={exports:{}};
 const deps={react,'@react-native-async-storage/async-storage':storage,
  '@/i18n':{...i18nModule,detectDeviceLocale:()=> 'ja'},
  '../i18n-opening':openingModule,'../locale-bootstrap':bootstrapModule};
 new Script(code).runInNewContext({module:mod,exports:mod.exports,require:n=>{assert.ok(deps[n],n);return deps[n];}});
 const render=()=>{cursor=0;const result=mod.exports.LocalizationProvider({children:'LOCALIZED_M1'});first=false;return result;};
 assert.equal(render(),null,'No localized child before manual choice resolves');
 effects.forEach(fn=>fn());
 if(fail)rejectRead(new Error('synthetic storage read failure'));else resolveRead(saved);
 for(let i=0;i<8;i++)await Promise.resolve();
 const ready=render();
 assert.equal(ready.children[0],'LOCALIZED_M1');
 assert.equal(ready.props.value.locale,openingModule.isReleaseLocale(saved)?saved:'ja');
 assert.equal(writes.length,0,'Automatic fallback must not become a persisted manual choice');
 ready.props.value.setLocale('ru');
 ready.props.value.setLocale('ko');
 for(let i=0;i<16;i++)await Promise.resolve();
 assert.deepEqual(writes.map(x=>x[1]),['ru','ko'],'Manual choices persist in order');
 assert.equal(render().props.value.locale,'ko');
 assert.equal(resolveInitialLocale({manualChoice:writes.at(-1)[1],trustedCountryCode:'VN',deviceLocale:'ja'}),'ko');
}
await boot('vi'); await boot(null); await boot('fr'); await boot(null,true);
console.log('Actual LocalizationProvider: no wrong-language first frame; manual storage/order; read failure fallback PASS');

const welcomeSource=await readFile(new URL('../components/WelcomeExperience.tsx',import.meta.url),'utf8');
const privacySource=await readFile(new URL('../app/(tabs)/privacy.tsx',import.meta.url),'utf8');
for(const locale of expected) {
 assert.match(welcomeSource,new RegExp('RELEASE_LOCALE_OPTIONS'),`R8-T02 welcome exact8 ${locale}`);
 assert.match(privacySource,new RegExp('RELEASE_LOCALE_OPTIONS'),`R8-T02 settings exact8 ${locale}`);
}
assert.doesNotMatch(privacySource,/\bisEn\b|localeCode === ['"]en-US['"]/u);
assert.match(welcomeSource,/onPress=\{\(\) => setLocale\(option\.id as ReleaseLocale\)\}/u);
assert.match(privacySource,/onPress=\{\(\) => setDisplayLocale\(option\.id as ReleaseLocale\)\}/u);
for(const forbidden of ['submit','accept','start','stop','pause','cancel','record','correct','retract','revoke','delete','send','retry']) {
 const localeHandlers=[...welcomeSource.matchAll(/onPress=\{\(\) => setLocale\([^\n]+/gu),
  ...privacySource.matchAll(/onPress=\{\(\) => (?:setLocale|setDisplayLocale)\([^\n]+/gu)].map(match=>match[0]).join('\n');
 assert.doesNotMatch(localeHandlers,new RegExp(`\\b${forbidden}\\s*\\(`,'u'),`R8-T06 locale handler ${forbidden}`);
}
console.log('R8-T02 welcome/settings exact8 selectors: PASS');
console.log('R8-T06 locale handlers are presentation/preference only; action counters: 0 PASS');
console.log('R8-T07 TEST_FIXTURE rapid switch/switch-back persistence only; no authority/user-text callback surface: PASS');

const { taskMessages } = await import('../i18n-task.ts');
const { resolveDeterministicM3 } = await import('../domain/m3/deterministic-semantics.ts');
const { createM3StubAdapter } = await import('../domain/m3/stub-adapter.ts');
const fixtureAdapter = createM3StubAdapter(0);
assert.equal(fixtureAdapter.provenance,'TEST_FIXTURE');
const semanticOnly=({response,clarification_question,...semantic})=>semantic;
for(const l of expected) {
 for(const k of Object.keys(taskMessages.en)) assert.ok(taskMessages[l][k].trim());
 for(const text of samples[l]) {
  const content=input(l,text);
  const original=resolveDeterministicM3(content);
  const localized=await fixtureAdapter.interpret({content,operation:{isCurrent:()=>true}},new AbortController().signal);
  assert.deepEqual(semanticOnly(localized),semanticOnly(original),'Fixture localization must preserve all semantic fields');
 }
}
console.log('Fixture presentation: semantic fields unchanged, TEST_FIXTURE preserved; 48 cases PASS');
console.log('R8-T15 provider/network calls=0; R8-T16 M3 exact8/hidden12 regression: PASS');
console.log('R8-T18 synthetic cases explicitly TEST_FIXTURE; rendered composition assertions are separate: PASS');
console.log('R8-T19 source evidence only; native-language/device review: NOT_RUN');

// CP9 actual production composition harness. All TSX is read and transpiled in
// memory with the admitted TypeScript; Node never imports native TSX directly.
 const compositionRoot=realpathSync(resolvePath(import.meta.dirname,'..'));
 const compositionLibRoot=realpathSync(resolvePath(compositionRoot,'..','..','lib','api-zod','src'));
 const compositionLibNames=['m3-text-safety-floor.ts','trainer-safety-policy.ts',
  'm3-locales.ts','m3-contract.ts','m3-meaning.ts'];
 const compositionLibFiles=new Set(compositionLibNames.map(name=>realpathSync(resolvePath(compositionLibRoot,name))));
 const compositionEntrypoints=new Set(['app/_layout.tsx','app/(tabs)/privacy.tsx',
  'domain/local-owner/boundary.ts','i18n-m2.ts'].map(path=>realpathSync(resolvePath(compositionRoot,path))));
 const within=(root,file)=>{
  const path=relative(root,file);
  return path!==''&&path!=='..'&&!path.startsWith(`..${sep}`)&&!isAbsolute(path);
 };
 const admittedCompositionFile=(file)=>within(compositionRoot,file)||compositionLibFiles.has(file);
 const canonicalCompositionFile=(file)=>{
  if(!existsSync(file)||!statSync(file).isFile())return undefined;
  const canonical=realpathSync(file);
  if(canonical!==resolvePath(file)||!admittedCompositionFile(canonical))
   throw Error(`OUT_OF_SCOPE_COMPOSITION_FILE:${file}`);
  return canonical;
 };
 const hashBytes=(bytes)=>createHash('sha256').update(bytes).digest('hex');
 const sealedCompositionLib=new Map([...compositionLibFiles].map(file=>[file,hashBytes(readFileSync(file))]));
 const compositionLoaded=new Map();
 const compositionVariant=(url)=>{
  const parsed=new URL(url);
  if(parsed.searchParams.size!==1||!parsed.searchParams.has('composition'))
   throw Error(`INVALID_COMPOSITION_IDENTITY:${url}`);
  const variant=parsed.searchParams.get('composition');
  if(variant!=='baseline'&&!compositionOverrides.has(variant))
   throw Error(`UNKNOWN_COMPOSITION_VARIANT:${variant}`);
  return variant;
 };
 const compositionModuleAt=(path,variant)=>{
  const file=canonicalCompositionFile(resolvePath(compositionRoot,path));
  assert.ok(compositionEntrypoints.has(file),`UNKNOWN_COMPOSITION_ENTRYPOINT:${path}`);
  const url=pathToFileURL(file);
  url.searchParams.set('composition',variant);
 return url.href;
};
const compositionData=(source)=>'data:text/javascript,'+encodeURIComponent(source);
const mutantExecution=new Map();
const compositionState={current:null,networkCalls:0,providerCalls:0,
 recordMutant(name,observation){
  if(!mutantExecution.has(name))mutantExecution.set(name,[]);
  mutantExecution.get(name).push(observation);
 }};
const compositionOverrides=new Map();
const compositionOverrideLoads=new Map();
const declaredOverrideTargets=new Map([
 ['connected-owner','context/OwnerSessionContext.tsx'],
 ['mutant-1','components/OpeningGoalFlow.tsx'],
 ['mutant-2','app/_layout.tsx'],
 ['mutant-3','components/OpeningGoalFlow.tsx'],
 ['mutant-4','components/OpeningGoalFlow.tsx'],
 ['mutant-5','components/OpeningGoalFlow.tsx'],
]);
const overrideComposition=(variant,path,source)=>{
 assert.equal(path,declaredOverrideTargets.get(variant),`UNDECLARED_OVERRIDE:${variant}:${path}`);
 const target=canonicalCompositionFile(resolvePath(compositionRoot,path));
 assert.ok(target&&within(compositionRoot,target),`INVALID_OVERRIDE_TARGET:${path}`);
 assert.equal(compositionOverrides.get(variant)?.size??0,0,`MULTIPLE_OVERRIDES:${variant}`);
 if(!compositionOverrides.has(variant))compositionOverrides.set(variant,new Map());
 compositionOverrides.get(variant).set(target,source);
};
 const compositionUrl=(file,parentURL)=>{
  const url=pathToFileURL(file);
  url.searchParams.set('composition',compositionVariant(parentURL));
  return url.href;
 };
globalThis.__welcomeComposition=compositionState;
globalThis.__DEV__=false;
process.env.EXPO_PUBLIC_M3_RUNTIME_MODE='fixture';

const elementSymbol=Symbol('composition-element');
const fragmentSymbol=Symbol('composition-fragment');
let contextSequence=0;
class CompositionComponent {
 constructor(props){this.props=props;this.state=this.state??{};this.__runtime=null;}
 setState(next){
  const value=typeof next==='function'?next(this.state,this.props):next;
  this.state={...this.state,...value};
  this.__runtime?.markDirty();
 }
}
const compositionReact={
 Fragment:fragmentSymbol,
 Component:CompositionComponent,
 createElement(type,props,...children){
  const normalized=children.length===0?props?.children:children.length===1?children[0]:children;
  return {$$typeof:elementSymbol,type,key:props?.key??null,props:{...(props??{}),children:normalized}};
 },
 cloneElement(element,props,...children){
  return compositionReact.createElement(element.type,{...element.props,...props,key:props?.key??element.key},
   ...(children.length?children:[element.props.children]));
 },
 isValidElement:value=>Boolean(value?.$$typeof===elementSymbol),
 createContext(defaultValue){
  const context={id:++contextSequence,defaultValue,stack:[]};
  context.Provider={__compositionProvider:context};
  return context;
 },
 useContext(context){return context.stack.length?context.stack.at(-1):context.defaultValue;},
 useState(...args){return compositionState.current.hooks.useState(...args);},
 useReducer(...args){return compositionState.current.hooks.useReducer(...args);},
 useRef(...args){return compositionState.current.hooks.useRef(...args);},
 useMemo(...args){return compositionState.current.hooks.useMemo(...args);},
 useCallback(...args){return compositionState.current.hooks.useCallback(...args);},
 useEffect(...args){return compositionState.current.hooks.useEffect(...args);},
 useLayoutEffect(...args){return compositionState.current.hooks.useLayoutEffect(...args);},
 useSyncExternalStore(...args){return compositionState.current.hooks.useSyncExternalStore(...args);},
 useImperativeHandle(...args){return compositionState.current.hooks.useImperativeHandle(...args);},
 useId(){return compositionState.current.hooks.useId();},
 memo:component=>component,
 forwardRef:render=>function Forwarded(props){return render(props,props.ref);},
 Children:{toArray:value=>Array.isArray(value)?value:value==null?[]:[value]},
};
globalThis.__welcomeCompositionReact=compositionReact;

const host=(name)=>(props)=>compositionReact.createElement(name,props,props.children);
const Icon=host('Icon'); Icon.glyphMap={};
const wrapper=(props)=>props.children??null;
const Stack=(props)=>compositionReact.createElement(fragmentSymbol,null,
 props.children,compositionState.privacyScreen
  ? compositionReact.createElement(compositionState.privacyScreen,{}) : null);
Stack.Screen=()=>null;
const nativeModule=compositionData(`
 const N=globalThis.__welcomeCompositionNative;
 export const AccessibilityInfo=N.AccessibilityInfo,Animated=N.Animated,AppState=N.AppState,Easing=N.Easing;
 export const Keyboard=N.Keyboard,Modal=N.Modal,Platform=N.Platform,Pressable=N.Pressable;
 export const ScrollView=N.ScrollView,StyleSheet=N.StyleSheet,Text=N.Text,TextInput=N.TextInput,View=N.View;
 export const Image=N.Image,ImageBackground=N.ImageBackground,Alert=N.Alert,ActivityIndicator=N.ActivityIndicator;
 export const findNodeHandle=N.findNodeHandle,useWindowDimensions=N.useWindowDimensions,useColorScheme=N.useColorScheme;
 `);
const reactModule=compositionData(`
 const R=globalThis.__welcomeCompositionReact;
 export default R; export const Fragment=R.Fragment,Component=R.Component,createElement=R.createElement;
 export const cloneElement=R.cloneElement,isValidElement=R.isValidElement,createContext=R.createContext;
 export const useContext=R.useContext,useState=R.useState,useReducer=R.useReducer,useRef=R.useRef;
 export const useMemo=R.useMemo,useCallback=R.useCallback,useEffect=R.useEffect,useLayoutEffect=R.useLayoutEffect;
 export const useSyncExternalStore=R.useSyncExternalStore,useImperativeHandle=R.useImperativeHandle,useId=R.useId;
 export const memo=R.memo,forwardRef=R.forwardRef,Children=R.Children;
 `);
const jsxRuntimeModule=compositionData(`
 const R=globalThis.__welcomeCompositionReact;
 const make=(type,props,key)=>R.createElement(type,{...(props??{}),key:key??props?.key});
 export const Fragment=R.Fragment,jsx=make,jsxs=make;
 `);
const stubModules=new Map([
 ['react',reactModule],['react/jsx-runtime',jsxRuntimeModule],['react-native',nativeModule],
 ['@/components/GoldStandard100',compositionData("const R=globalThis.__welcomeCompositionReact;export function GoldStandard100(p){R.useEffect(()=>{p.onReady?.()},[]);return R.createElement('PixelPresentationDouble',p);} ")],
 ['@react-native-async-storage/async-storage',compositionData(`
  const S={getItem:(...a)=>globalThis.__welcomeComposition.current.storage.getItem(...a),
   setItem:(...a)=>globalThis.__welcomeComposition.current.storage.setItem(...a),
   removeItem:(...a)=>globalThis.__welcomeComposition.current.storage.removeItem(...a)};
  export default S;`)],
 ['@expo/vector-icons',compositionData('const I=globalThis.__welcomeCompositionIcon;export const Feather=I,MaterialCommunityIcons=I;')],
 ['expo-linear-gradient',compositionData('export const LinearGradient=globalThis.__welcomeCompositionHost("LinearGradient");')],
 ['expo-status-bar',compositionData('export const StatusBar=globalThis.__welcomeCompositionHost("StatusBar");')],
 ['react-native-svg',compositionData(`
  const h=globalThis.__welcomeCompositionHost;const Svg=h('Svg');export default Svg;
  export const Defs=h('Defs'),Image=h('SvgImage'),LinearGradient=h('SvgLinearGradient'),Mask=h('Mask'),Path=h('Path'),Rect=h('Rect'),Stop=h('Stop'),ClipPath=h('ClipPath'),Polygon=h('Polygon'),Circle=h('Circle'),G=h('G'),RadialGradient=h('RadialGradient');`)],
 ['react-native-safe-area-context',compositionData(`
  export const SafeAreaProvider=globalThis.__welcomeCompositionWrapper;
  export const useSafeAreaInsets=()=>({top:0,right:0,bottom:0,left:0});`)],
 ['react-native-keyboard-controller',compositionData(`
  const h=globalThis.__welcomeCompositionHost;
  export const KeyboardProvider=globalThis.__welcomeCompositionWrapper,KeyboardAvoidingView=h('KeyboardAvoidingView'),KeyboardAwareScrollView=h('KeyboardAwareScrollView');
  export const useKeyboardState=(select)=>select({isVisible:false});`)],
 ['react-native-gesture-handler',compositionData('export const GestureHandlerRootView=globalThis.__welcomeCompositionHost("GestureHandlerRootView");')],
 ['@tanstack/react-query',compositionData(`
  export class QueryClient{};export const QueryClientProvider=globalThis.__welcomeCompositionWrapper;`)],
 ['@expo-google-fonts/inter',compositionData(`
  export const Inter_400Regular={},Inter_500Medium={},Inter_600SemiBold={},Inter_700Bold={};export const useFonts=()=>[true,null];`)],
 ['expo-router',compositionData(`
  const Stack=globalThis.__welcomeCompositionStack;export {Stack};
  export const router={push:()=>{},replace:()=>{},back:()=>{}},useRouter=()=>router;`)],
 ['expo-splash-screen',compositionData('export const preventAutoHideAsync=async()=>{},hideAsync=async()=>{};')],
 ['expo-haptics',compositionData('export const selectionAsync=async()=>{};')],
 ['expo-apple-authentication',compositionData(`
  export const isAvailableAsync=async()=>false,signInAsync=async()=>{throw Error('APPLE_FORBIDDEN')};`)],
 ['expo-crypto',compositionData(`
  export const CryptoDigestAlgorithm={SHA256:'SHA256'},CryptoEncoding={HEX:'hex'};
  export const digestStringAsync=async()=>{throw Error('CRYPTO_FORBIDDEN')};`)],
 ['expo-secure-store',compositionData(`
  export const WHEN_UNLOCKED_THIS_DEVICE_ONLY='device';
  export const getItemAsync=async()=>null,setItemAsync=async()=>{},deleteItemAsync=async()=>{};`)],
 ['expo-image-picker',compositionData(`
  export const requestCameraPermissionsAsync=async()=>({granted:true});
  export const launchCameraAsync=(...a)=>globalThis.__welcomeComposition.current.native.take(...a);
  export const launchImageLibraryAsync=(...a)=>globalThis.__welcomeComposition.current.native.choose(...a);`)],
 ['expo-file-system/legacy',compositionData(`
  export const cacheDirectory='file:///composition-cache/';
  export const getInfoAsync=async()=>({exists:false,isDirectory:false});export const deleteAsync=async()=>{};`)],
 ['expo-image-manipulator',compositionData(`
  export const SaveFormat={JPEG:'jpeg'};export const ImageManipulator={manipulate(){return{async renderAsync(){return{width:800,height:600,async saveAsync(){return{uri:'file:///composition-cache/prepared.jpg',width:800,height:600}}}}}}};`)],
 ['expo',compositionData('export const reloadAppAsync=async()=>{};')],
 ['@workspace/api-client-react',compositionData(`
  const deny=()=>{globalThis.__welcomeComposition.providerCalls++;throw Error('PROVIDER_FORBIDDEN')};
  export const aiM3=deny,aiM3Permission=deny,aiGatewayStatus=deny,aiPilotSession=deny,aiRespond=deny;
  export const setBaseUrl=()=>{};`)],
]);
globalThis.__welcomeCompositionHost=host;
globalThis.__welcomeCompositionIcon=Icon;
globalThis.__welcomeCompositionWrapper=wrapper;
globalThis.__welcomeCompositionStack=Stack;

 const resolveCompositionFile=(base)=>{
  const candidates=[base,`${base}.ts`,`${base}.tsx`,resolvePath(base,'index.ts'),resolvePath(base,'index.tsx')];
  for(const candidate of candidates){
   if(!['.ts','.tsx'].includes(extname(candidate)))continue;
   if(within(compositionRoot,candidate)||compositionLibFiles.has(candidate)){
    const canonical=canonicalCompositionFile(candidate);
    if(canonical)return canonical;
   }else if(existsSync(candidate))throw Error(`OUT_OF_SCOPE_COMPOSITION_IMPORT:${candidate}`);
  }
 };
 const compositionIdentity=(href)=>{
  const url=new URL(href);
  const variant=compositionVariant(href);
  if(url.protocol!=='file:'||url.hash)throw Error(`INVALID_COMPOSITION_URL:${href}`);
  const file=canonicalCompositionFile(fileURLToPath(url));
  if(!file)throw Error(`MISSING_COMPOSITION_FILE:${href}`);
  return {file,variant};
 };
 registerHooks({
  resolve(specifier,context,nextResolve){
   if(specifier.startsWith('file:')&&context.parentURL===import.meta.url){
    const {file,variant}=compositionIdentity(specifier);
    if(!compositionEntrypoints.has(file))
     throw Error(`UNKNOWN_COMPOSITION_ENTRYPOINT:${specifier}`);
    const url=pathToFileURL(file);url.searchParams.set('composition',variant);
    return {url:url.href,shortCircuit:true};
   }
   if(!context.parentURL?.startsWith('file:')
    || !new URL(context.parentURL).searchParams.has('composition'))
    return nextResolve(specifier,context);
   compositionIdentity(context.parentURL);
   const stub=stubModules.get(specifier);
   if(stub) return {url:stub,shortCircuit:true};
   if(specifier==='@/components/ErrorBoundary') return {url:compositionData('export const ErrorBoundary=globalThis.__welcomeCompositionWrapper;'),shortCircuit:true};
   if(specifier.includes('?')||specifier.includes('#')||specifier.includes('\\')
    ||isAbsolute(specifier)||specifier.startsWith('file:'))
    throw Error(`INVALID_COMPOSITION_SPECIFIER:${specifier}`);
  if(specifier.startsWith('@/')) {
   const file=resolveCompositionFile(resolvePath(compositionRoot,specifier.slice(2)));
   if(!file) throw Error(`UNKNOWN_COMPOSITION_ALIAS:${specifier}`);
   return {url:compositionUrl(file,context.parentURL),shortCircuit:true};
  }
   if(specifier.startsWith('.')) {
   const base=fileURLToPath(new URL(specifier,context.parentURL));
   const file=resolveCompositionFile(base);
   if(!file) throw Error(`UNKNOWN_COMPOSITION_RELATIVE:${specifier}:${context.parentURL}`);
   return {url:compositionUrl(file,context.parentURL),shortCircuit:true};
  }
   throw Error(`UNKNOWN_COMPOSITION_IMPORT:${specifier}`);
  },
  load(url,context,nextLoad){
   if(!url.startsWith('file:')||!new URL(url).searchParams.has('composition'))return nextLoad(url,context);
   const {file:filename,variant}=compositionIdentity(url);
   if(!['.ts','.tsx'].includes(extname(filename)))throw Error(`OUT_OF_SCOPE_COMPOSITION_LOAD:${url}`);
   if(!compositionLoaded.has(variant))compositionLoaded.set(variant,new Set());
   compositionLoaded.get(variant).add(filename);
   if(compositionLibFiles.has(filename))
    assert.equal(hashBytes(readFileSync(filename)),sealedCompositionLib.get(filename),`LIB_BYTES_CHANGED:${filename}`);
   const overridden=compositionOverrides.get(variant)?.get(filename);
   if(compositionLibFiles.has(filename))assert.equal(overridden,undefined,`LIB_OVERRIDE_FORBIDDEN:${filename}`);
  if(overridden!==undefined)compositionOverrideLoads.set(variant,(compositionOverrideLoads.get(variant)??0)+1);
  let tsx=overridden??readFileSync(filename,'utf8');
  if(filename===resolvePath(compositionRoot,'app','_layout.tsx')) {
   const callback='onGoalOpened={() => {';
   assert.equal(tsx.split(callback).length,2,'APP_SURFACE_CALLBACK_INSTRUMENTATION_ANCHOR');
   tsx=tsx.replace(callback,`${callback} globalThis.__welcomeComposition.current.goalOpenedCalls++;`);
   tsx+='\nexport { AppSurface };\n';
  }
  tsx='const require=globalThis.__welcomeCompositionRequire;const __DEV__=globalThis.__DEV__;\n'+tsx;
  const output=ts.transpileModule(tsx,{fileName:filename,compilerOptions:{
   module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,
  }}).outputText;
  return {format:'module',source:output,shortCircuit:true};
 },
});

const sameDependencies=(left,right)=>Boolean(left&&right&&left.length===right.length
 && left.every((value,index)=>Object.is(value,right[index])));
class CompositionTimers {
 constructor(){this.next=0;this.tasks=new Map();}
 set(fn,ms=0){const id=++this.next;this.tasks.set(id,{fn,ms});return id;}
 clear(id){this.tasks.delete(id);}
 count(ms){return [...this.tasks.values()].filter(task=>task.ms===ms).length;}
 run(ms){
  const ready=[...this.tasks].filter(([,task])=>task.ms===ms);
  for(const [id,task] of ready){this.tasks.delete(id);withCompositionRuntime(this.owner,task.fn);}
  return ready.length;
 }
}
class CompositionAnimations {
 constructor(){this.pending=[];this.values=[];}
 value(initial){
  const controller=this;
  return new class {
   constructor(){this.value=initial;controller.values.push(this);}
   setValue(next){this.value=next;}
   stopAnimation(callback){callback?.(this.value);}
   interpolate(config){return {__compositionInterpolation:true,value:this,config};}
  }();
 }
 animation(kind){
  const controller=this;
  return {kind,stopped:false,start(callback){
    const record={kind,callback,done:false,animation:this,owner:compositionState.current};
   controller.pending.push(record);return record;
  },stop(){this.stopped=true;}};
 }
 latestCallback(){return [...this.pending].reverse().find(record=>typeof record.callback==='function'&&!record.done);}
 finish(record,finished=true,{force=false}={}){
  if(!record||record.done) return false;
  record.done=true;
   withCompositionRuntime(record.owner,()=>{
    if(record.animation.stopped&&!force) record.callback?.({finished:false});
    else record.callback?.({finished});
   });
  return true;
 }
}
class CompositionAccessibility {
 constructor(mode='resolved-false'){
  this.listeners=new Set();this.focusCalls=0;this.mode=mode;this.pending=[];
 }
 isReduceMotionEnabled(){
  if(this.mode==='unknown') return new Promise(resolve=>this.pending.push(resolve));
  return Promise.resolve(this.mode==='resolved-true');
 }
 addEventListener(_name,listener){this.listeners.add(listener);return{remove:()=>this.listeners.delete(listener)};}
 setAccessibilityFocus(){this.focusCalls++;return Promise.resolve();}
 resolve(value){this.mode=value?'resolved-true':'resolved-false';for(const done of this.pending.splice(0))done(value);}
 emit(value){this.mode=value?'resolved-true':'resolved-false';for(const listener of [...this.listeners])listener(value);}
}
class CompositionDocument {
 constructor(){this.activeElement=null;this.hidden=false;this.listeners=new Map();}
 addEventListener(name,listener){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(listener);}
 removeEventListener(name,listener){this.listeners.get(name)?.delete(listener);}
 dispatch(name,event={}){for(const listener of [...(this.listeners.get(name)??[])])listener(event);}
}
class CompositionHostHandle {
 constructor(runtime,path,type){this.runtime=runtime;this.path=path;this.type=type;this.node=null;this.attributes=new Map();this.listeners=new Map();this.focusCount=0;}
 focus(){this.focusCount++;this.runtime.document.activeElement=this;}
 blur(){if(this.runtime.document.activeElement===this)this.runtime.document.activeElement=null;}
 addEventListener(name,listener){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(listener);}
 removeEventListener(name,listener){this.listeners.get(name)?.delete(listener);}
 dispatch(name,event){for(const listener of [...(this.listeners.get(name)??[])])listener(event);}
 toggleAttribute(name,force){if(force)this.attributes.set(name,'');else this.attributes.delete(name);}
 removeAttribute(name){this.attributes.delete(name);}
 hasAttribute(name){return this.attributes.has(name)||Boolean(this.node?.props?.[name]);}
 getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):this.node?.props?.[name]??null;}
 querySelectorAll(){
  const found=[];
  const visit=node=>{
   if(!node||typeof node!=='object')return;
   if(node.handle&&node!==this.node){
    const role=node.props?.accessibilityRole;
    const focusable=['Pressable','TextInput','button','a','input','select','textarea'].includes(node.type)
     || ['button','radio'].includes(role)||node.props?.tabIndex>=0;
    if(focusable&&!node.props?.disabled&&node.props?.['aria-hidden']!==true)found.push(node.handle);
   }
   for(const child of node.children??[])visit(child);
  };
  visit(this.node);return found;
 }
}
class CompositionRenderer {
 constructor(rootFactory,runtime){
  this.rootFactory=rootFactory;this.runtime=runtime;this.instances=new Map();this.hosts=new Map();
  this.nextMount=0;this.nextType=0;this.typeIds=new WeakMap();this.currentInstance=null;
  this.dirty=true;this.tree=null;
  this.hooks={
   useState:(...a)=>this.useState(...a),useReducer:(...a)=>this.useReducer(...a),
   useRef:(...a)=>this.useRef(...a),useMemo:(...a)=>this.useMemo(...a),
   useCallback:(...a)=>this.useCallback(...a),useEffect:(...a)=>this.useEffect(...a),
   useLayoutEffect:(...a)=>this.useEffect(...a),useSyncExternalStore:(...a)=>this.useSyncExternalStore(...a),
   useImperativeHandle:(...a)=>this.useImperativeHandle(...a),useId:()=>this.useId(),
  };
  runtime.hooks=this.hooks;
 }
 markDirty(){this.dirty=true;}
 typeId(type){
  if((typeof type!=='object'&&typeof type!=='function')||type===null)return String(type);
  if(!this.typeIds.has(type))this.typeIds.set(type,++this.nextType);
  return this.typeIds.get(type);
 }
 slot(){assert.ok(this.currentInstance,'HOOK_OUTSIDE_COMPONENT');return this.currentInstance.slots[this.currentInstance.cursor++];}
 slotAt(){assert.ok(this.currentInstance,'HOOK_OUTSIDE_COMPONENT');const index=this.currentInstance.cursor++;return{instance:this.currentInstance,index,slot:this.currentInstance.slots[index]};}
 useState(initial){
  const {instance,index,slot}=this.slotAt();
  if(!slot){
   const created={kind:'state',value:typeof initial==='function'?initial():initial};
   created.set=next=>{if(!instance.active)return;const value=typeof next==='function'?next(created.value):next;if(!Object.is(value,created.value)){created.value=value;this.markDirty();}};
   instance.slots[index]=created;
  }
  const current=instance.slots[index];return[current.value,current.set];
 }
 useReducer(reducer,initial,init){
  const [value,setValue]=this.useState(()=>init?init(initial):initial);
  return[value,action=>setValue(current=>reducer(current,action))];
 }
 useRef(initial){
  const {instance,index,slot}=this.slotAt();
  if(!slot)instance.slots[index]={kind:'ref',value:{current:initial}};
  return instance.slots[index].value;
 }
 useMemo(factory,dependencies){
  const {instance,index,slot}=this.slotAt();
  if(!slot||!sameDependencies(slot.dependencies,dependencies))instance.slots[index]={kind:'memo',dependencies,value:factory()};
  return instance.slots[index].value;
 }
 useCallback(callback,dependencies){
  const {instance,index,slot}=this.slotAt();
  if(!slot||!sameDependencies(slot.dependencies,dependencies))instance.slots[index]={kind:'callback',dependencies,value:callback};
  return instance.slots[index].value;
 }
 useEffect(effect,dependencies){
  const {instance,index,slot}=this.slotAt();
  if(!slot||!sameDependencies(slot.dependencies,dependencies))this.pendingEffects.push({instance,index,effect,dependencies});
 }
 useSyncExternalStore(subscribe,getSnapshot){
  const {instance,index,slot}=this.slotAt();
  if(!slot||slot.subscribe!==subscribe)this.pendingEffects.push({instance,index,dependencies:[subscribe],
   effect:()=>subscribe(()=>this.markDirty()),subscribe});
  return getSnapshot();
 }
 useImperativeHandle(ref,create,dependencies){
  this.useEffect(()=>{const value=create();if(typeof ref==='function')ref(value);else if(ref)ref.current=value;return()=>{if(typeof ref==='function')ref(null);else if(ref)ref.current=null;};},dependencies);
 }
 useId(){const ref=this.useRef();if(!ref.current)ref.current=`composition-${this.currentInstance.mountId}-${this.currentInstance.cursor}`;return ref.current;}
 render(){
  this.dirty=false;this.visitedInstances=new Set();this.visitedHosts=new Set();this.pendingEffects=[];
  compositionState.current=this.runtime;
  this.tree=this.renderElement(this.rootFactory(),'root');
  for(const [key,instance] of [...this.instances])if(!this.visitedInstances.has(key))this.unmountInstance(key,instance);
  for(const [key,entry] of [...this.hosts])if(!this.visitedHosts.has(key))this.unmountHost(key,entry);
   for(const pending of this.pendingEffects){
    if(!pending.instance.active)continue;
    const prior=pending.instance.slots[pending.index];
    if(prior?.cleanup)withCompositionRuntime(this.runtime,prior.cleanup);
    pending.instance.slots[pending.index]={kind:'effect',dependencies:pending.dependencies,
     subscribe:pending.subscribe,cleanup:withCompositionRuntime(this.runtime,pending.effect)};
  }
  return this.tree;
 }
 renderElement(element,path){
  if(element==null||typeof element==='boolean')return null;
  if(typeof element==='string'||typeof element==='number')return element;
  if(Array.isArray(element))return element.map((child,index)=>this.renderElement(child,`${path}.${index}`)).filter(child=>child!==null);
  assert.equal(element.$$typeof,elementSymbol,`INVALID_ELEMENT:${path}`);
  const {type,props,key}=element;
  if(type===fragmentSymbol)return this.renderElement(props.children,`${path}.f`);
  if(type?.__compositionProvider){
   const context=type.__compositionProvider;context.stack.push(props.value);
   try{return this.renderElement(props.children,`${path}.p${context.id}`);}finally{context.stack.pop();}
  }
  if(typeof type==='function'){
   const identity=`${path}|${this.typeId(type)}|${String(key??'')}`;
   let instance=this.instances.get(identity);
   if(!instance){instance={identity,type,key,mountId:++this.nextMount,slots:[],cursor:0,active:true,classInstance:null};this.instances.set(identity,instance);}
   instance.active=true;instance.cursor=0;instance.props=props;this.visitedInstances.add(identity);
   let output;
   if(type.prototype?.render){
    if(!instance.classInstance){instance.classInstance=new type(props);instance.classInstance.__runtime=this;}
    instance.classInstance.props=props;output=instance.classInstance.render();
   }else{
    const prior=this.currentInstance;this.currentInstance=instance;
    try{output=type(props);}finally{this.currentInstance=prior;}
   }
    return this.renderElement(output,`${identity}.r`);
  }
  const identity=`${path}|${String(type)}|${String(key??'')}`;
  let entry=this.hosts.get(identity);
  if(!entry){entry={handle:new CompositionHostHandle(this.runtime,identity,type),ref:null};this.hosts.set(identity,entry);}
  this.visitedHosts.add(identity);
   const children=this.renderElement(props.children,`${identity}.h`);
  const node={type,props:{...props},children:Array.isArray(children)?children:children==null?[]:[children],handle:entry.handle};
  entry.handle.node=node;
  if(entry.ref!==props.ref){
   if(typeof entry.ref==='function')entry.ref(null);else if(entry.ref)entry.ref.current=null;
   entry.ref=props.ref;
   if(typeof entry.ref==='function')entry.ref(entry.handle);else if(entry.ref)entry.ref.current=entry.handle;
  }
  return node;
 }
 unmountInstance(key,instance){
  instance.active=false;
  for(let index=instance.slots.length-1;index>=0;index--){
   const cleanup=instance.slots[index]?.cleanup;
   if(cleanup)withCompositionRuntime(this.runtime,cleanup);
  }
  if(instance.classInstance?.componentWillUnmount)
   withCompositionRuntime(this.runtime,()=>instance.classInstance.componentWillUnmount());
  this.instances.delete(key);
 }
 unmountHost(key,entry){
  if(typeof entry.ref==='function')entry.ref(null);else if(entry.ref)entry.ref.current=null;
  this.hosts.delete(key);
 }
 unmount(){withCompositionRuntime(this.runtime,()=>{
  for(const [key,value] of [...this.instances])this.unmountInstance(key,value);
  for(const [key,value] of [...this.hosts])this.unmountHost(key,value);
  this.tree=null;
 });}
 instance(name){return [...this.instances.values()].find(item=>item.type.name===name);}
 listenerCount(name){let count=0;for(const {handle} of this.hosts.values())count+=handle.listeners.get(name)?.size??0;return count;}
}

const originalTimers={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,
 requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
function withCompositionRuntime(runtime,run){
 const prior=compositionState.current,priorDocument=globalThis.document,priorWindow=globalThis.window;
 compositionState.current=runtime;
 if(runtime?.document)globalThis.document=runtime.document;
 if(runtime?.window)globalThis.window=runtime.window;
 try{return run();}finally{
  compositionState.current=prior;globalThis.document=priorDocument;globalThis.window=priorWindow;
 }
}
const ownedTimer=(kind,fn,ms)=>{
 const owner=compositionState.current;
 assert.ok(owner,`NO_COMPOSITION_RUNTIME:${kind}`);
 return Object.freeze({kind,owner,id:owner[kind].set(fn,ms)});
};
const clearOwnedTimer=(kind,handle)=>{
 assert.equal(handle?.kind,kind,`INVALID_TIMER_HANDLE:${kind}`);
 handle.owner[kind].clear(handle.id);
};
globalThis.setTimeout=(fn,ms=0)=>ownedTimer('timers',fn,ms);
globalThis.clearTimeout=(handle)=>clearOwnedTimer('timers',handle);
globalThis.requestAnimationFrame=(fn)=>ownedTimer('frames',fn,16);
globalThis.cancelAnimationFrame=(handle)=>clearOwnedTimer('frames',handle);
globalThis.fetch=()=>{compositionState.networkCalls++;throw Error('NETWORK_FORBIDDEN_IN_WELCOME_COMPOSITION');};
globalThis.__welcomeCompositionRequire=(specifier)=>{
 if(specifier==='react-native')return globalThis.__welcomeCompositionNative;
 if(specifier==='../assets/images/welcome-sunrise.png')return Object.freeze({asset:'welcome-sunrise.png'});
 if(specifier==='../assets/images/scene_m2_sunless_golden.jpg')return Object.freeze({asset:'scene_m2_sunless_golden.jpg'});
 if(specifier==='../assets/images/100-v05-sunless-scene-v1.png')return Object.freeze({asset:'100-v05-sunless-scene-v1.png'});
 if(specifier==='../assets/images/icon.png')return Object.freeze({asset:'icon.png'});
 throw Error(`UNKNOWN_COMPOSITION_REQUIRE:${specifier}`);
};
const animatedFacade={
 Value:class {constructor(initial){return compositionState.current.animations.value(initial);}},
 timing:()=>compositionState.current.animations.animation('timing'),
 spring:()=>compositionState.current.animations.animation('spring'),
 delay:()=>compositionState.current.animations.animation('delay'),
 parallel:()=>compositionState.current.animations.animation('parallel'),
 sequence:()=>compositionState.current.animations.animation('sequence'),
 loop:()=>compositionState.current.animations.animation('loop'),
 View:'Animated.View',Image:'Animated.Image',Text:'Animated.Text',
};
const easingIdentity=value=>value;
const nativeFacade={
 AccessibilityInfo:{
  isReduceMotionEnabled:()=>compositionState.current.accessibility.isReduceMotionEnabled(),
  addEventListener:(...args)=>compositionState.current.accessibility.addEventListener(...args),
  setAccessibilityFocus:(...args)=>compositionState.current.accessibility.setAccessibilityFocus(...args),
 },
 Animated:animatedFacade,
 AppState:{currentState:'active',addEventListener:(name,listener)=>compositionState.current.appState.add(name,listener)},
 Easing:{linear:easingIdentity,sin:easingIdentity,quad:easingIdentity,cubic:easingIdentity,
  in:easingIdentity,out:easingIdentity,inOut:easingIdentity,back:()=>easingIdentity},
 Keyboard:{dismiss:()=>{compositionState.current.keyboardDismisses++;}},
 Modal:(props)=>props.visible===false?null:compositionReact.createElement('Modal',props),Platform:{OS:'web',select:value=>value.web??value.default},
 Pressable:'Pressable',ScrollView:'ScrollView',StyleSheet:{absoluteFill:{position:'absolute'},create:value=>value},
 Text:'Text',TextInput:'TextInput',View:'View',Image:'Image',ImageBackground:'ImageBackground',
 Alert:{alert:()=>{compositionState.current.alertCalls++;}},ActivityIndicator:'ActivityIndicator',
 findNodeHandle:value=>value,useWindowDimensions:()=>({width:390,height:844}),useColorScheme:()=> 'light',
};
globalThis.__welcomeCompositionNative=nativeFacade;
globalThis.HTMLElement=CompositionHostHandle;

const deferredValue=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};};
const allNodes=(tree,found=[])=>{
 if(Array.isArray(tree)){for(const child of tree)allNodes(child,found);return found;}
 if(!tree||typeof tree!=='object')return found;
 if(tree.handle)found.push(tree);
 for(const child of tree.children??[])allNodes(child,found);
 return found;
};
const byTestId=(tree,id)=>allNodes(tree).find(node=>node.props?.testID===id);
const textOf=(tree)=>{
 if(Array.isArray(tree))return tree.map(textOf).join('');
 if(tree==null)return'';
 if(typeof tree==='string'||typeof tree==='number')return String(tree);
 return (tree.children??[]).map(textOf).join('');
};
const press=(fixture,id)=>{
 const node=byTestId(fixture.renderer.tree,id);assert.ok(node,`MISSING_RENDERED_NODE:${id}`);
 assert.equal(node.props.disabled===true,false,`DISABLED_RENDERED_NODE:${id}`);
 return withCompositionRuntime(fixture.runtime,()=>node.props.onPress?.());
};
const changeText=(fixture,id,value)=>{
 const node=byTestId(fixture.renderer.tree,id);assert.ok(node,`MISSING_RENDERED_NODE:${id}`);
 withCompositionRuntime(fixture.runtime,()=>node.props.onChangeText(value));
};
const keyEvent=(key)=>({key,shiftKey:false,prevented:false,preventDefault(){this.prevented=true;}});

function makeCompositionRuntime({welcomeSeen=false,locale='en',motion='resolved-false'}={}){
 const welcomeKey='@100-human-development-welcome';
 const localeKey='@100-human-development-locale';
 const data=new Map([[localeKey,locale],...(welcomeSeen?[[welcomeKey,'seen-v1']]:[])]);
 const calls=[];
 const timers=new CompositionTimers();
 const frames=new CompositionTimers();
 const document=new CompositionDocument();
 const accessibility=new CompositionAccessibility(motion);
 const animations=new CompositionAnimations();
 const appStateListeners=new Set();
 const runtime={data,calls,timers,frames,document,accessibility,animations,keyboardDismisses:0,alertCalls:0,
   goalOpenedCalls:0,
  storage:{
   getItem(key){calls.push({method:'getItem',key});return Promise.resolve(data.get(key)??null);},
   setItem(key,value){calls.push({method:'setItem',key,value});data.set(key,value);return Promise.resolve();},
   removeItem(key){calls.push({method:'removeItem',key});data.delete(key);return Promise.resolve();},
  },
  native:{
   choose:async()=>({canceled:true}),take:async()=>({canceled:true}),
  },
  appState:{add(_name,listener){appStateListeners.add(listener);return{remove:()=>appStateListeners.delete(listener)};},
   emit(value){for(const listener of [...appStateListeners])listener(value);}},
 };
 timers.owner=runtime;frames.owner=runtime;
 runtime.window={matchMedia:()=>({matches:motion==='resolved-true',addEventListener(){},removeEventListener(){}})};
 return runtime;
}

const installCompositionGlobals=(runtime)=>{
 compositionState.current=runtime;
 globalThis.document=runtime.document;
 globalThis.window=runtime.window;
 try{Object.defineProperty(globalThis,'navigator',{value:{language:'en-US'},configurable:true,writable:true});}catch{}
};

const compositionModules=new Map();
async function loadCompositionModules(variant){
 if(compositionModules.has(variant)){
  const modules=compositionModules.get(variant);
  compositionState.privacyScreen=modules.privacy.default;
  return modules;
 }
 const layout=await import(compositionModuleAt('app/_layout.tsx',variant));
 const privacy=await import(compositionModuleAt('app/(tabs)/privacy.tsx',variant));
 const owner=await import(compositionModuleAt('domain/local-owner/boundary.ts',variant));
 const m2Copy=await import(compositionModuleAt('i18n-m2.ts',variant));
 assert.equal(typeof layout.AppSurface,'function','AppSurface private export exists only in transpiled memory');
 compositionState.privacyScreen=privacy.default;
 const modules={layout,privacy,owner,m2Copy};
 compositionModules.set(variant,modules);
 return modules;
}

async function compositionFixture(options={}){
 const variant=options.variant??'baseline';
 const runtime=makeCompositionRuntime(options);installCompositionGlobals(runtime);
 const modules=await loadCompositionModules(variant);
 const renderer=new CompositionRenderer(()=>compositionReact.createElement(modules.layout.default,{}),runtime);
 const render=()=>{installCompositionGlobals(runtime);return renderer.render();};
 const settle=async(iterations=12)=>{
  for(let index=0;index<iterations;index++){
   await Promise.resolve();await Promise.resolve();
   if(renderer.dirty||index<2)render();
  }
  return renderer.tree;
 };
 render();await settle();
 return {runtime,renderer,modules,render,settle,unmount:()=>withCompositionRuntime(runtime,()=>renderer.unmount())};
}

const hookObjects=(instance)=>{
 const values=[];
 for(const slot of instance?.slots??[]){
  if(slot?.value&&typeof slot.value==='object')values.push(slot.value);
  if(slot?.value?.current&&typeof slot.value.current==='object')values.push(slot.value.current);
 }
 return [...new Set(values)];
};
const realStores=(fixture)=>{
 const instance=fixture.renderer.instance('OpeningGoalFlow');assert.ok(instance,'OpeningGoalFlow instance');
 const objects=hookObjects(instance);
 const find=(label,predicate)=>{const value=objects.find(predicate);assert.ok(value,`REAL_STORE_NOT_FOUND:${label}`);return value;};
 const goalStore=value=>{
  if(typeof value.getSnapshot!=='function'||typeof value.start!=='function'||typeof value.stop!=='function')return false;
  try{const snapshot=value.getSnapshot();return typeof snapshot?.text==='string'&&typeof snapshot?.isCurrent==='function';}catch{return false;}
 };
 return {
  instance,
  goal:find('goal',goalStore),
  c0:find('camera-c0',value=>typeof value.accept==='function'&&typeof value.cancelFlow==='function'),
  c1:find('camera-c1',value=>typeof value.consume==='function'&&typeof value.project==='function'&&typeof value.assess==='function'),
  c2:find('camera-c2',value=>typeof value.currentReceipt==='function'&&typeof value.settleCleanup==='function'),
  m3:find('m3-lifetime',value=>typeof value.currentSlot==='function'&&typeof value.deactivate==='function'),
 };
};

const exactWelcomeCopy={
 vi:['Bắt đầu cùng 100','Tạm dừng chuyển động nền','Tiếp tục chuyển động nền'],
 en:['Begin with 100','Pause background motion','Resume background motion'],
 'zh-Hans':['与 100 一起开始','暂停背景动画','继续播放背景动画'],
 es:['Comenzar con 100','Pausar la animación decorativa de fondo','Reanudar la animación decorativa de fondo'],
 hi:['100 के साथ शुरुआत करें','सजावटी पृष्ठभूमि ऐनिमेशन को विराम दें','सजावटी पृष्ठभूमि ऐनिमेशन फिर चलाएँ'],
 ja:['100と一緒に始める','背景の装飾アニメーションを一時停止','背景の装飾アニメーションを再開'],
 ko:['100과 함께 시작하기','배경 장식 애니메이션 일시 정지','배경 장식 애니메이션 재개'],
 ru:['Начать вместе с 100','Приостановить декоративную фоновую анимацию','Возобновить декоративную фоновую анимацию'],
};
assert.deepEqual(Object.keys(exactWelcomeCopy),expected);
for(const [locale,copy] of Object.entries(exactWelcomeCopy)){
 assert.deepEqual(['welcomeBegin','welcomeMotionPause','welcomeMotionResume'].map(key=>translate(locale,key)),copy);
 const translated=key=>translate(locale,key);
 assert.equal((await import('../i18n-m2.ts')).getM2Copy(translated).goals[0],translate(locale,'m2Health'));
 assert.equal(translate(locale,'m2Health'),m2Messages[locale].m2Health);
}

const functionDeclaration=(sourceFile,name)=>{
 let found;
 const visit=node=>{
  if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node;
  ts.forEachChild(node,visit);
 };
 visit(sourceFile);return found;
};
const variableDeclaration=(node,name)=>{
 let found;
 const visit=current=>{
  if(ts.isVariableDeclaration(current)&&ts.isIdentifier(current.name)&&current.name.text===name)found=current;
  ts.forEachChild(current,visit);
 };
 visit(node);return found;
};
function assertCompositionSource(openingText,layoutText,welcomeText){
 const openingAst=ts.createSourceFile('OpeningGoalFlow.tsx',openingText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const opening=functionDeclaration(openingAst,'OpeningGoalFlow');assert.ok(opening?.body);
 const begin=variableDeclaration(opening,'beginWelcome')?.initializer;assert.ok(begin);
 const close=variableDeclaration(opening,'closeWelcome')?.initializer;assert.ok(close);
 const beginText=begin.getText(openingAst),closeText=close.getText(openingAst),bodyText=opening.body.getText(openingAst);
 assert.match(beginText,/if \(!welcomeRunActiveRef\.current\) return;/u);
 assert.match(beginText,/if \(reviewing\)[\s\S]*closeWelcome\(\)/u);
 assert.doesNotMatch(beginText,/openGoal\s*\(/u);
 assert.match(beginText,/setWelcomeVisible\(false\)[\s\S]*onGoalOpened\(\)/u);
 assert.match(closeText,/if \(!welcomeRunActiveRef\.current\) return;[\s\S]*welcomeRunActiveRef\.current = false;[\s\S]*onClose\(\)/u);
 assert.match(bodyText,/useEffect\(\(\) => \(\) => \{[\s\S]*welcomeRunActiveRef\.current = false;/u);
 let welcomeCount=0,welcomeFence=false;
 const visit=node=>{
  if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(openingAst)==='WelcomeExperience')welcomeCount++;
  if(ts.isIfStatement(node)&&node.expression.getText(openingAst)==='welcomeVisible'
   && node.thenStatement.getText(openingAst).includes('<WelcomeExperience'))welcomeFence=true;
  ts.forEachChild(node,visit);
 };
 visit(opening.body);assert.equal(welcomeCount,1);assert.equal(welcomeFence,true);
 const layoutAst=ts.createSourceFile('_layout.tsx',layoutText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let keyExpression;
 const visitLayout=node=>{
  if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(layoutAst)==='OpeningGoalFlow'){
   const key=node.attributes.properties.find(item=>ts.isJsxAttribute(item)&&item.name.getText(layoutAst)==='key');
   keyExpression=key?.initializer?.expression?.getText(layoutAst);
  }
  ts.forEachChild(node,visitLayout);
 };
 visitLayout(layoutAst);assert.equal(keyExpression,'welcome.runId');
 const welcomeAst=ts.createSourceFile('WelcomeExperience.tsx',welcomeText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const welcome=functionDeclaration(welcomeAst,'WelcomeExperience');assert.ok(welcome?.body);
 const welcomeBody=welcome.body.getText(welcomeAst);
 assert.match(welcomeBody,/retiredRef\.current/u);
 assert.match(welcomeBody,/t\('welcomeMotionResume'\)/u);
 assert.match(welcomeBody,/t\('welcomeMotionPause'\)/u);
 assert.match(welcomeBody,/accessibilityState=\{\{ checked: backgroundPaused \}\}/u);
}
const openingProduction=await readFile(new URL('../components/OpeningGoalFlow.tsx',import.meta.url),'utf8');
const layoutProduction=await readFile(new URL('../app/_layout.tsx',import.meta.url),'utf8');
assertCompositionSource(openingProduction,layoutProduction,welcomeSource);
console.log('CP9 static production provenance/structure: PASS');
const mutateWithin=(source,anchor,search,replacement)=>{
 const start=source.indexOf(anchor);assert.ok(start>=0,`MUTATION_ANCHOR:${anchor}`);
 const before=source.slice(0,start),tail=source.slice(start),mutated=tail.replace(search,replacement);
 assert.notEqual(mutated,tail,`MUTATION_NOT_APPLIED:${anchor}`);return before+mutated;
};
const mutants=[
 {name:'review routes through openGoal',path:'components/OpeningGoalFlow.tsx',source:mutateWithin(openingProduction,'const beginWelcome',
   'if (reviewing) {\n      closeWelcome();',
   'if (reviewing) {\n      globalThis.__welcomeComposition.recordMutant("mutant-1", "review");\n      openGoal();'),oracle:'ORACLE_REVIEW_CLOSE'},
 {name:'host key changes on first Begin',path:'app/_layout.tsx',source:layoutProduction.replace(
   'key={welcome.runId}',
   "key={(globalThis.__welcomeComposition.recordMutant('mutant-2', m3HostMode), `${welcome.runId}-${m3HostMode}`)}"),oracle:'ORACLE_FIRST_HOST_IDENTITY'},
 {name:'hidden legacy layer fence removed',path:'components/OpeningGoalFlow.tsx',source:openingProduction.replace(
   'if (welcomeVisible) {',
   "if ((globalThis.__welcomeComposition.recordMutant('mutant-3', 'fence'), false)) {"),oracle:'ORACLE_WELCOME_FENCE'},
 {name:'Begin guard removed at repeated completion callback',path:'components/OpeningGoalFlow.tsx',source:mutateWithin(openingProduction,'const beginWelcome',
   'if (!welcomeRunActiveRef.current) return;',
   "globalThis.__welcomeComposition.recordMutant('mutant-4', 'begin');"),oracle:'ORACLE_DUPLICATE_BEGIN'},
 {name:'retired callback schedules foreign focus return',path:'components/OpeningGoalFlow.tsx',source:openingProduction.replace(
   'useEffect(() => () => {\n    welcomeRunActiveRef.current = false;\n  }, []);',
   "useEffect(() => () => { globalThis.__welcomeComposition.recordMutant('mutant-5', 'retire'); }, []);"),oracle:'ORACLE_RETIRED_BEGIN'},
];
for(const [index,mutant] of mutants.entries()){
 const production=mutant.path==='app/_layout.tsx'?layoutProduction:openingProduction;
 assert.notEqual(mutant.source,production,`MUTATION_NOT_APPLIED:${mutant.name}`);
 mutant.variant=`mutant-${index+1}`;
 overrideComposition(mutant.variant,mutant.path,mutant.source);
}

let compositionCases=0;
const collisionA=makeCompositionRuntime(),collisionB=makeCompositionRuntime();
let collisionFired=0;
const oldTimer=withCompositionRuntime(collisionA,()=>setTimeout(()=>{collisionFired+=100;},0));
const newTimer=withCompositionRuntime(collisionB,()=>setTimeout(()=>{collisionFired++;},0));
assert.equal(oldTimer.id,newTimer.id,'timer IDs deliberately collide');
withCompositionRuntime(collisionB,()=>clearTimeout(oldTimer));
assert.equal(collisionA.timers.count(0),0,'old owner timer cleared');
assert.equal(collisionB.timers.count(0),1,'new owner timer survives ID collision');
collisionB.timers.run(0);
assert.equal(collisionFired,1,'only current owner timer executes');
console.log('CP9 timer handle isolation: identical numeric IDs, distinct owners; old clear cannot cancel new callback');
const welcomeWrites=fixture=>fixture.runtime.calls.filter(call=>call.method==='setItem'
 && call.key==='@100-human-development-welcome');
const modalOwners=fixture=>allNodes(fixture.renderer.tree).filter(node=>node.props?.accessibilityViewIsModal).length;
const forbiddenWrites=fixture=>fixture.runtime.calls.filter(call=>call.method!=='getItem'
 && !['@100-human-development-welcome','@100-human-development-locale'].includes(call.key));

// CP9 addresses semantic state, never a positional boolean slot.
const cp9GuestStateSlots = new WeakMap();
function guestSelectedValue(fixture) {
 const instance=fixture.renderer.instance('AppSurface');
 assert.ok(instance?.active,'CP9_GUEST_ACTIVE_APP_SURFACE');
 const hostSlot=instance.slots[0];
 assert.equal(hostSlot?.kind,'memo','CP9_M2_HOST_MEMO_KIND');
 const host=hostSlot.value;
 for(const method of ['getSnapshot','subscribe','trackBaseline','dispose'])
  assert.equal(typeof host?.[method],'function','CP9_M2_HOST_READER:'+method);
 const candidates=instance.slots.filter(slot=>slot?.kind==='state'&&typeof slot.value==='boolean');
 const boolBindings=[];
 const guestAst=ts.createSourceFile('layout.tsx',layoutProduction,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const guestFn=functionDeclaration(guestAst,'AppSurface');
 for(const statement of guestFn.body.statements)if(ts.isVariableStatement(statement))for(const d of statement.declarationList.declarations)
  if(ts.isArrayBindingPattern(d.name)&&ts.isCallExpression(d.initializer)&&d.initializer.expression.getText(guestAst)==='useState'&&['true','false'].includes(d.initializer.arguments[0]?.getText(guestAst)))boolBindings.push(d.name.elements[0].name.text);
 assert.equal(candidates.length,boolBindings.length,'CP9_BOOLEAN_DECLARATION_COHERENCE');
 const guestOrdinal=boolBindings.indexOf('guestSelected');assert.ok(guestOrdinal>=0,'CP9_NAMED_GUEST_BINDING');
 const state=candidates[guestOrdinal];
 assert.equal(typeof state.set,'function','CP9_GUEST_STATE_SETTER');
 const previous=cp9GuestStateSlots.get(instance);
 if(previous)assert.equal(state,previous,'CP9_GUEST_STATE_IDENTITY_STABLE');
 else cp9GuestStateSlots.set(instance,state);
 const opening=fixture.renderer.instance('OpeningGoalFlow');
 if(opening !== undefined) {
  assert.equal(opening.active,true,'CP9_GUEST_ACTIVE_OPENING');
  const props=opening.props;
  assert.equal(typeof props.neutralGoalPrompt,'boolean','CP9_GUEST_NEUTRAL_PROP_BOOLEAN');
  if(!props.ownerSession) {
   assert.ok(['BLOCKED','ANONYMOUS'].includes(props.m3HostMode),'CP9_GUEST_HOST_MODE');
   assert.equal(props.m3HostMode,state.value?'ANONYMOUS':'BLOCKED','CP9_GUEST_MODE_COHERENCE');
   assert.equal(props.neutralGoalPrompt,state.value,'CP9_GUEST_NEUTRAL_COHERENCE');
  }
 } else {
  assert.equal(byTestId(fixture.renderer.tree,'welcome-begin'),undefined,'CP9_GUEST_UNMOUNTED_NO_WELCOME');
  assert.equal(byTestId(fixture.renderer.tree,'opening-goal-input'),undefined,'CP9_GUEST_UNMOUNTED_NO_GOAL');
 }
 return state.value;
}

// First-run composition: exact locale UI, one Welcome owner, same host and operative stores.
const first=await compositionFixture({locale:'en',motion:'resolved-false'});
assert.ok(byTestId(first.renderer.tree,'welcome-begin'));
assert.equal(guestSelectedValue(first),false,'actual guestSelected starts false');
assert.equal(first.renderer.instance('OpeningGoalFlow').props.m3HostMode,'BLOCKED');
assert.equal(first.renderer.instance('OpeningGoalFlow').props.ownerSession,undefined);
assert.ok(byTestId(first.renderer.tree,'opening-logo-open'),'S32 first visible glyph');
assert.equal(byTestId(first.renderer.tree,'opening-goal-input'),undefined);
assert.equal(modalOwners(first),1);
assert.equal(first.renderer.listenerCount('keydown'),1);
const hiddenApp=allNodes(first.renderer.tree).find(node=>node.props?.['aria-hidden']===true);
assert.ok(hiddenApp&&hiddenApp.props.accessibilityElementsHidden===true
 && hiddenApp.props.importantForAccessibility==='no-hide-descendants');
const appMount=first.renderer.instance('AppSurface').mountId;
const beforeFirst=realStores(first);
press(first,'welcome-language-menu');await first.settle();
for(const [locale,copy] of Object.entries(exactWelcomeCopy)){
 press(first,`welcome-language-${locale}`);await first.settle();
 const begin=byTestId(first.renderer.tree,'welcome-begin');assert.equal(begin.props.accessibilityLabel,copy[0]);
 assert.ok(byTestId(first.renderer.tree,'m1-greeting'),'S32 greeting below the glyph');
 const motion=byTestId(first.renderer.tree,'welcome-background-motion-toggle');
 assert.equal(motion.props.accessibilityLabel,copy[1]);assert.equal(motion.props.accessibilityState.checked,false);
}
const motionToggle=byTestId(first.renderer.tree,'welcome-background-motion-toggle');
motionToggle.props.onPress();await first.settle();
assert.equal(byTestId(first.renderer.tree,'welcome-background-motion-toggle').props.accessibilityLabel,
 exactWelcomeCopy.ru[2]);
assert.equal(byTestId(first.renderer.tree,'welcome-background-motion-toggle').props.accessibilityState.checked,true);
first.runtime.accessibility.emit(true);await first.settle();
assert.equal(byTestId(first.renderer.tree,'welcome-background-motion-toggle'),undefined);
first.runtime.accessibility.emit(false);await first.settle();
assert.equal(byTestId(first.renderer.tree,'welcome-background-motion-toggle').props.accessibilityLabel,
 exactWelcomeCopy.ru[2],'Reduce Motion dominates the retained manual pause');
const beginNode=byTestId(first.renderer.tree,'welcome-begin');
beginNode.props.onPress();beginNode.props.onPress();
const firstExit=first.runtime.animations.latestCallback();assert.ok(firstExit,'animated first Begin completion');
first.runtime.animations.finish(firstExit,true);await first.settle();
const afterFirst=realStores(first);
assert.equal(first.renderer.instance('AppSurface').mountId,appMount);
assert.equal(afterFirst.instance.mountId,beforeFirst.instance.mountId);
for(const name of ['goal','c0','c1','c2','m3'])assert.equal(afterFirst[name],beforeFirst[name],`retained operative ${name}`);
assert.ok(byTestId(first.renderer.tree,'opening-goal-input'));
assert.equal(byTestId(first.renderer.tree,'opening-logo-open'),undefined,'no old-logo frame after Begin');
assert.equal(welcomeWrites(first).length,1,'actual AppSurface onGoalOpened marks Welcome once');
assert.equal(guestSelectedValue(first),true,'actual onGoalOpened selects guest');
assert.equal(first.runtime.goalOpenedCalls,1,'actual AppSurface onGoalOpened fires once');
assert.equal(first.renderer.instance('OpeningGoalFlow').props.m3HostMode,'ANONYMOUS');
assert.equal(first.renderer.instance('OpeningGoalFlow').props.m2Gateway.snapshot.subject.id,'anonymous');
assert.equal(first.renderer.instance('OpeningGoalFlow').props.m2Gateway.snapshot.permission.status,'allowed');
assert.equal(first.renderer.instance('OpeningGoalFlow').props.m2Gateway.m3Access.status,'denied');
assert.equal(afterFirst.m3.currentSlot()?.mode,'ANONYMOUS');
assert.ok(textOf(first.renderer.tree).includes(m2Messages.ru.s32Movement),'S32 rendered expression pillar is localized without fabricating NEW');
assert.equal(first.renderer.listenerCount('keydown'),1);assert.equal(modalOwners(first),1);
console.log('CP9 AppSurface first Begin: guestSelected false->true; onGoalOpened calls=1; host BLOCKED->ANONYMOUS; welcome write=1; ownerSession absent; M2 allowed; M3 denied');
compositionCases++;

// Unknown and reduced motion cannot block or duplicate Begin.
for(const motion of ['unknown','resolved-true']){
 const fixture=await compositionFixture({motion});
 const button=byTestId(fixture.renderer.tree,'welcome-begin');button.props.onPress();button.props.onPress();
 await fixture.settle();
 assert.ok(byTestId(fixture.renderer.tree,'opening-goal-input'),`${motion} enters goal`);
 assert.equal(welcomeWrites(fixture).length,1,`${motion} Begin exactly once`);
 if(motion==='unknown'){fixture.runtime.accessibility.resolve(false);await fixture.settle();}
 assert.equal(compositionState.networkCalls,0);fixture.unmount();compositionCases++;
}

// Returning install and review Close/Escape/Begin all route through the actual Settings node.
const review=await compositionFixture({welcomeSeen:true,motion:'resolved-false'});
assert.equal(byTestId(review.renderer.tree,'welcome-begin'),undefined,'returning user bypasses Welcome');
const reviewAction=byTestId(review.renderer.tree,'review-welcome');assert.ok(reviewAction,'actual PrivacyScreen review action');
reviewAction.handle.focus();reviewAction.props.onPress();await review.settle();
assert.ok(byTestId(review.renderer.tree,'welcome-close'));assert.equal(modalOwners(review),1);
review.runtime.timers.run(40);
const closeNode=byTestId(review.renderer.tree,'welcome-close');closeNode.props.onPress();closeNode.props.onPress();
assert.equal(review.runtime.timers.count(0),1,'duplicate Close schedules one focus return');
await review.settle();assert.equal(byTestId(review.renderer.tree,'welcome-begin'),undefined);
assert.equal(review.runtime.document.activeElement,closeNode.handle,'focus does not return before removal timer');
review.runtime.timers.run(0);assert.equal(review.runtime.document.activeElement,reviewAction.handle);

// Review1 Begin -> Review2 Close.
reviewAction.handle.focus();reviewAction.props.onPress();await review.settle();
press(review,'welcome-begin');const reviewBeginExit=review.runtime.animations.latestCallback();
review.runtime.animations.finish(reviewBeginExit,true);await review.settle();review.runtime.timers.run(0);
assert.equal(byTestId(review.renderer.tree,'welcome-begin'),undefined);
reviewAction.props.onPress();await review.settle();press(review,'welcome-close');await review.settle();review.runtime.timers.run(0);

// Review1 Escape -> Review2 Begin, with only one active trap each run.
reviewAction.props.onPress();await review.settle();
const escapeRoot=[...review.renderer.hosts.values()].map(item=>item.handle)
 .find(handle=>(handle.listeners.get('keydown')?.size??0)>0);assert.ok(escapeRoot);
const escape=keyEvent('Escape');escapeRoot.dispatch('keydown',escape);assert.equal(escape.prevented,true);
await review.settle();review.runtime.timers.run(0);
reviewAction.props.onPress();await review.settle();assert.equal(review.renderer.listenerCount('keydown'),1);
press(review,'welcome-begin');const review2Exit=review.runtime.animations.latestCallback();
review.runtime.animations.finish(review2Exit,true);await review.settle();review.runtime.timers.run(0);
assert.equal(byTestId(review.renderer.tree,'welcome-begin'),undefined);
assert.equal(welcomeWrites(review).length,0,'review never marks Welcome seen');
assert.equal(review.runtime.goalOpenedCalls,0,'review never invokes AppSurface onGoalOpened');
assert.equal(forbiddenWrites(review).length,0,'review locale/presentation produces no domain write');
compositionCases++;

// Seed a real M3/Camera task, hold the native picker, then rebind through Settings review.
changeText(first,'opening-goal-input','Tôi cần đánh giá bữa ăn bằng hình ảnh.');await first.settle();
press(first,'opening-goal-submit');first.runtime.timers.run(180);await first.settle(20);
assert.ok(byTestId(first.renderer.tree,'camera-c0-choose'),'real M3 store exposes Camera C0');
const picker=deferredValue();first.runtime.native.choose=()=>picker.promise;
const pendingPhoto=press(first,'camera-c0-choose');
const oldStores=realStores(first);const oldSlot=oldStores.m3.currentSlot();assert.ok(oldSlot);
const settings=byTestId(first.renderer.tree,'review-welcome');assert.ok(settings);settings.handle.focus();settings.props.onPress();
await first.settle();
const reboundStores=realStores(first);
assert.notEqual(reboundStores.instance.mountId,oldStores.instance.mountId,'runId review legitimately remounts host');
assert.equal(oldStores.m3.currentSlot(),undefined,'old SessionTask lifetime retired on rebind');
for(const name of ['goal','c0','c1','c2','m3'])assert.notEqual(reboundStores[name],oldStores[name],`fresh review ${name}`);
picker.resolve({canceled:false,assets:[{uri:'file:///late-photo.jpg',width:800,height:600}]});
assert.equal(await pendingPhoto,false,'late native result rejected by retired real Camera store');
await first.settle();
assert.equal(reboundStores.c0.getSnapshot().candidate,undefined);
assert.ok(byTestId(first.renderer.tree,'welcome-begin'));
assert.equal(compositionState.networkCalls,0);assert.equal(compositionState.providerCalls,0);
assert.equal(forbiddenWrites(first).length,0);
compositionCases++;

// Exercise the owner authority created by the connected OwnerSessionProvider.
const ownerContextPath='context/OwnerSessionContext.tsx';
const ownerContextProduction=await readFile(new URL('../context/OwnerSessionContext.tsx',import.meta.url),'utf8');
const nonIosCoordinatorAnchor="if (Platform.OS !== 'ios') return createOwnerSessionCoordinator();";
assert.equal(ownerContextProduction.split(nonIosCoordinatorAnchor).length,2,'CONNECTED_OWNER_NON_IOS_ANCHOR');
const ownerFactoryAst=ts.createSourceFile(ownerContextPath,ownerContextProduction,ts.ScriptTarget.Latest,true);
const ownerFactories=ownerFactoryAst.statements.filter(node=>ts.isFunctionDeclaration(node)
 && node.name?.text==='createProductionCoordinator');
assert.equal(ownerFactories.length,1,'CONNECTED_OWNER_SINGLE_FACTORY');
assert.ok(ownerFactories[0].body,'CONNECTED_OWNER_FACTORY_BODY');
const ownerFactoryEntry=ownerFactories[0].body.getStart(ownerFactoryAst)+1;
const ownerFixtureInjection='\n  if (globalThis.__welcomeCompositionOwnerInput) return createOwnerSessionCoordinator(globalThis.__welcomeCompositionOwnerInput);\n';
const ownerContextFixture=ownerContextProduction.slice(0,ownerFactoryEntry)+ownerFixtureInjection
 +ownerContextProduction.slice(ownerFactoryEntry);
assert.equal(ownerContextFixture.split(nonIosCoordinatorAnchor).length,2,'CONNECTED_OWNER_NON_IOS_FALLBACK_PRESERVED');
assert.ok(ownerContextFixture.indexOf(ownerFixtureInjection)
 <ownerContextFixture.indexOf("if (Platform.OS === 'web'"),'CONNECTED_OWNER_FIXTURE_BEFORE_WEB');
assert.notEqual(ownerContextFixture,ownerContextProduction,'CONNECTED_OWNER_FIXTURE_SEAM');
overrideComposition('connected-owner',ownerContextPath,ownerContextFixture);
let ownerVerifications=0;
globalThis.__welcomeCompositionOwnerInput={session:{
 ownerVerifier:{async verify(){ownerVerifications++;return {status:'verified',
  owner:{subjectId:'composition-owner',profileId:'profile'},validUntil:Date.now()+60000};}},
 authorization:{async withBearer(){throw Error('PROVIDER_FORBIDDEN');}},
 async logout(){},
}};
const owned=await compositionFixture({variant:'connected-owner',motion:'resolved-false'});
const ownerProvider=owned.renderer.instance('OwnerSessionProvider');
assert.ok(ownerProvider,'actual connected OwnerSessionProvider');
const connectedCoordinator=ownerProvider.slots[0].value;
assert.equal(connectedCoordinator.getSnapshot().phase,'READY');
assert.ok(ownerVerifications>0,'connected authority verified through provider refresh');
const connectedHost=owned.renderer.instance('OpeningGoalFlow');
const connectedBinding=connectedCoordinator.getSnapshot().binding;
assert.equal(connectedHost.props.ownerSession,connectedBinding,'host uses provider binding instance');
assert.equal(connectedHost.props.m3HostMode,'OWNED');
assert.equal(connectedHost.props.m2Gateway.snapshot.subject.id,'composition-owner');
assert.equal(connectedHost.props.m2Gateway.snapshot.permission.status,'allowed');
assert.equal(connectedHost.props.m2Gateway.m3Access.status,'denied');
const connectedScope=connectedBinding.access.requireLease(connectedBinding.lease);
assert.equal(connectedScope.owner.subjectId,'composition-owner');
assert.equal(connectedBinding.access.getSnapshot().phase,'READY');
assert.equal(connectedBinding.access.getSnapshot().generation,connectedScope.generation);
assert.equal(connectedHost.props.m2Gateway.snapshot.revision,`owner-${connectedScope.generation}`);
assert.equal(connectedHost.props.m2Gateway.snapshot.permission.revision,`owner-${connectedScope.generation}-m2`);
const connectedFactsHost=owned.renderer.instance('AppSurface').slots[0].value;
assert.equal(typeof connectedFactsHost.getSnapshot,'function','CONNECTED_OWNER_HOST_FACTS_READER');
const connectedFacts=connectedFactsHost.getSnapshot();
assert.equal(connectedFacts.phase,'UNKNOWN','CONNECTED_OWNER_HISTORY_UNCONFIGURED');
assert.equal(connectedFacts.provenance,'UNCONFIGURED');
assert.equal(connectedFacts.reader,undefined,'CONNECTED_OWNER_NO_IMPLICIT_FACTS_READER');
assert.equal(connectedHost.props.m2Gateway.snapshot.activeTask.kind,'unknown');
assert.equal(connectedHost.props.m2Gateway.snapshot.returning.kind,'unknown');
assert.equal(connectedHost.props.m2Gateway.snapshot.goal,'unknown');
assert.equal(connectedHost.props.m2Gateway.snapshot.subject.profile,'unknown');
const connectedStores=realStores(owned);
const connectedSlot=connectedStores.m3.currentSlot();
assert.equal(connectedSlot?.mode,'OWNED');
assert.equal(connectedSlot.binding.access,connectedBinding.access,'connected store receives provider access');
assert.equal(connectedSlot.binding.lease,connectedBinding.lease,'connected store receives provider lease');
assert.ok(connectedSlot.store.getSnapshot().session_id,'connected owned session current');
assert.equal(connectedSlot.store.getSnapshot().active_task_id,null);
assert.deepEqual(connectedSlot.store.getSnapshot().tasks,[]);
assert.equal(connectedSlot.actionSource.current(),undefined,'no task authority without active task');
const connectedStore=connectedSlot.store;
const taskOne=withCompositionRuntime(owned.runtime,()=>connectedStore.submit('I want to improve my health.',
 {locale:'en',permission_granted:true}));
assert.ok(taskOne,'connected store accepted first synthetic task');
const taskOneRef=connectedStore.reference(taskOne);
assert.ok(taskOneRef&&connectedSlot.actionSource.current(),'first task current through connected host');
const taskTwo=withCompositionRuntime(owned.runtime,()=>connectedStore.submit('I want to move more.',
 {locale:'en',permission_granted:true}));
assert.ok(taskTwo&&taskTwo!==taskOne,'second task supersedes first');
const taskTwoRef=connectedStore.reference(taskTwo);
assert.ok(taskTwoRef,'second task reference current');
assert.equal(connectedStore.assessM4GoalReadiness(taskOneRef).decision.reason,'STALE_TASK',
 'task invalidation rejects prior reference');
assert.equal(connectedStore.getSnapshot().session_id,taskOneRef.session_id,
 'task change retains session');
assert.equal(connectedSlot.actionSource.current()?.task_id,taskTwo,
 'task change retains a current connected task');
assert.equal(connectedBinding.access.requireLease(connectedBinding.lease).generation,connectedScope.generation,
 'task change retains owner');
assert.equal(owned.renderer.instance('OpeningGoalFlow').props.m2Gateway.snapshot.permission.status,'allowed',
 'task change retains host permission');
const beforePermission=connectedStore.getSnapshot().tasks.find(task=>task.task_id===taskTwo);
assert.equal(beforePermission?.permission_granted,true,'synthetic local fixture task starts permitted');
assert.equal(withCompositionRuntime(owned.runtime,()=>connectedStore.setM3Permission(taskTwoRef,false)),true,
 'connected store revokes task permission');
const afterPermission=connectedStore.getSnapshot().tasks.find(task=>task.task_id===taskTwo);
assert.equal(afterPermission?.permission_granted,false);
assert.equal(afterPermission.permission_revision,beforePermission.permission_revision+1);
assert.equal(connectedStore.assessM4GoalReadiness(taskTwoRef).decision.reason,'STALE_TASK',
 'permission revision invalidates prior reference');
assert.equal(connectedStore.getSnapshot().session_id,taskTwoRef.session_id,
 'permission change retains session');
assert.equal(connectedStore.getSnapshot().active_task_id,taskTwo,
 'permission change retains task identity');
assert.equal(connectedBinding.access.requireLease(connectedBinding.lease).generation,connectedScope.generation,
 'permission change retains owner');
assert.equal(owned.renderer.instance('OpeningGoalFlow').props.m2Gateway.snapshot.permission.status,'allowed',
 'permission change retains separate M2 host permission');
const sessionBeforeRebind=connectedStore.getSnapshot().session_id;
press(owned,'review-welcome');await owned.settle();
const reboundConnectedStores=realStores(owned);
const reboundSlot=reboundConnectedStores.m3.currentSlot();
assert.ok(reboundSlot&&reboundSlot!==connectedSlot,'review run replaces connected host slot');
assert.equal(owned.renderer.instance('OwnerSessionProvider'),ownerProvider,
 'session replacement retains actual provider');
assert.equal(owned.renderer.instance('OpeningGoalFlow').props.ownerSession,connectedBinding,
 'session replacement retains exact owner binding');
assert.equal(owned.renderer.instance('OpeningGoalFlow').props.m3HostMode,'OWNED');
assert.equal(owned.renderer.instance('OpeningGoalFlow').props.m2Gateway.snapshot.permission.status,'allowed');
assert.ok(reboundSlot.store.getSnapshot().session_id);
assert.notEqual(reboundSlot.store.getSnapshot().session_id,sessionBeforeRebind,
 'new host owns a fresh session');
assert.equal(connectedStore.getSnapshot().session_id,null,'prior session retired');
assert.equal(connectedStore.assessM4GoalReadiness(taskTwoRef).decision.reason,'STALE_TASK',
 'prior session reference rejected');
assert.equal(reboundSlot.actionSource.current(),undefined,'fresh session has no borrowed task');
connectedCoordinator.invalidate();await owned.settle();
assert.throws(()=>connectedBinding.access.requireLease(connectedBinding.lease));
assert.equal(connectedCoordinator.getSnapshot().binding,undefined);
assert.equal(owned.renderer.instance('OpeningGoalFlow').props.ownerSession,undefined);
assert.equal(owned.renderer.instance('OpeningGoalFlow').props.m3HostMode,'BLOCKED');
assert.equal(owned.renderer.instance('OpeningGoalFlow').props.m2Gateway.snapshot.subject.id,'anonymous');
assert.equal(owned.renderer.instance('OpeningGoalFlow').props.m2Gateway.snapshot.permission.revision,'anonymous-m2-1');
assert.equal(connectedStores.m3.currentSlot(),undefined,'connected task lifetime retired');
assert.equal(reboundConnectedStores.m3.currentSlot(),undefined,'rebound session retired on owner invalidation');
assert.equal(connectedSlot.actionSource.current(),undefined,'retired task source stays unavailable');
assert.equal(forbiddenWrites(owned).length,0);
assert.equal(compositionState.networkCalls,0);assert.equal(compositionState.providerCalls,0);
console.log(`CP9 connected OwnerSessionProvider: verify=${ownerVerifications}; task supersession, permission revocation, fresh session rebind independently stale while owner and M2 permission valid; owner invalidation OWNED->BLOCKED; forbidden writes=0`);
compositionCases++;

const ownedSentinelTimer=withCompositionRuntime(owned.runtime,()=>setTimeout(()=>{},0));
const ownedSentinelFrame=withCompositionRuntime(owned.runtime,()=>requestAnimationFrame(()=>{}));
first.unmount();review.unmount();
assert.ok(owned.runtime.timers.tasks.has(ownedSentinelTimer.id),
 'other fixture cleanup preserves current fixture timer');
assert.ok(owned.runtime.frames.tasks.has(ownedSentinelFrame.id),
 'other fixture cleanup preserves current fixture frame');
withCompositionRuntime(owned.runtime,()=>{
 clearTimeout(ownedSentinelTimer);cancelAnimationFrame(ownedSentinelFrame);
});
owned.unmount();
delete globalThis.__welcomeCompositionOwnerInput;
console.log('CP9 fixture cleanup isolation: first/review unmount leaves owned timer and frame intact');

const behavioralOracles={
 async ORACLE_REVIEW_CLOSE(variant){
  const fixture=await compositionFixture({variant,welcomeSeen:true});
  try{
   press(fixture,'review-welcome');await fixture.settle();
   assert.equal(guestSelectedValue(fixture),false,'review setup guest starts false');
   assert.equal(fixture.runtime.goalOpenedCalls,0,'review setup callback count starts zero');
   press(fixture,'welcome-begin');
   const completion=fixture.runtime.animations.latestCallback();assert.ok(completion,'review completion captured');
   fixture.runtime.animations.finish(completion,true);
   await fixture.settle();
   const observed={goalOpenedCalls:fixture.runtime.goalOpenedCalls,
    guestSelected:guestSelectedValue(fixture),
    hostMode:fixture.renderer.instance('OpeningGoalFlow')?.props.m3HostMode??'UNMOUNTED',
    welcomeWrites:welcomeWrites(fixture).length};
   behavioralObservations.set(variant,observed);
   assert.deepEqual({goalOpenedCalls:observed.goalOpenedCalls,guestSelected:observed.guestSelected},
    {goalOpenedCalls:0,guestSelected:false},'ORACLE_REVIEW_CLOSE');
   assert.equal(observed.welcomeWrites,0,'review cannot mark first Welcome seen');
  }finally{fixture.unmount();}
 },
 async ORACLE_FIRST_HOST_IDENTITY(variant){
  const fixture=await compositionFixture({variant});
  try{
   const before=realStores(fixture);
   press(fixture,'welcome-begin');
   const completion=fixture.runtime.animations.latestCallback();assert.ok(completion,'first Begin completion captured');
   fixture.runtime.animations.finish(completion,true);
   await fixture.settle();
   const after=realStores(fixture);
   const observed={hostSame:after.instance.mountId===before.instance.mountId,
    storesSame:['goal','c0','c1','c2','m3'].every(name=>after[name]===before[name]),
    hostMode:after.instance.props.m3HostMode,
    goalVisible:Boolean(byTestId(fixture.renderer.tree,'opening-goal-input'))};
   behavioralObservations.set(variant,observed);
   assert.deepEqual({hostSame:observed.hostSame,storesSame:observed.storesSame},
    {hostSame:true,storesSame:true},'ORACLE_FIRST_HOST_IDENTITY');
   assert.equal(observed.goalVisible,true,'first Begin goal presentation');
  }finally{fixture.unmount();}
 },
 async ORACLE_WELCOME_FENCE(variant){
  const fixture=await compositionFixture({variant});
  try{
   const observed={welcomeVisible:Boolean(byTestId(fixture.renderer.tree,'welcome-begin')),
    legacyVisible:Boolean(byTestId(fixture.renderer.tree,'welcome-logo-shimmer'))};
   behavioralObservations.set(variant,observed);
   assert.deepEqual(observed,{welcomeVisible:true,legacyVisible:false},'ORACLE_WELCOME_FENCE');
  }finally{fixture.unmount();}
 },
 async ORACLE_DUPLICATE_BEGIN(variant){
  const fixture=await compositionFixture({variant});
  try{
   const actualHostBegin=fixture.renderer.instance('WelcomeExperience').props.onBegin;
   press(fixture,'welcome-begin');
   const completion=fixture.runtime.animations.latestCallback();assert.ok(completion);
   completion.callback({finished:true});completion.callback({finished:true});
   // Test the actual lower callback boundary as well: the new visual one-shot must not mask a broken host guard.
   withCompositionRuntime(fixture.runtime,()=>{actualHostBegin();actualHostBegin();});
   await fixture.settle();
   const observed={goalOpenedCalls:fixture.runtime.goalOpenedCalls,
    welcomeWrites:welcomeWrites(fixture).length,
    guestSelected:guestSelectedValue(fixture)};
   behavioralObservations.set(variant,observed);
   assert.deepEqual({goalOpenedCalls:observed.goalOpenedCalls,welcomeWrites:observed.welcomeWrites},
    {goalOpenedCalls:1,welcomeWrites:1},'ORACLE_DUPLICATE_BEGIN');
  }finally{fixture.unmount();}
 },
  async ORACLE_RETIRED_BEGIN(variant){
   const fixture=await compositionFixture({variant,welcomeSeen:true});
   try{
    const action=byTestId(fixture.renderer.tree,'review-welcome');assert.ok(action);
    action.handle.focus();action.props.onPress();await fixture.settle();
    const provider=fixture.renderer.instance('WelcomeProvider');
    const retiredHost=fixture.renderer.instance('OpeningGoalFlow');
    const retiredWelcome=fixture.renderer.instance('WelcomeExperience');
    assert.ok(retiredHost?.active&&retiredWelcome?.props?.onBegin,'active review callback captured');
    const staleBegin=retiredWelcome.props.onBegin;
    // Deliver a second queued Settings action in the same provider. Its runId
    // replaces the keyed host while the first review is still open.
    action.props.onPress();await fixture.settle();
    const laterHost=fixture.renderer.instance('OpeningGoalFlow');
    assert.equal(fixture.renderer.instance('WelcomeProvider'),provider,'same live provider lineage');
    assert.ok(laterHost?.active&&laterHost!==retiredHost&&byTestId(fixture.renderer.tree,'welcome-begin'),
     'new keyed review host active');
    assert.equal(retiredHost.active,false,'old host retired on keyed replacement');
    assert.equal(retiredWelcome.active,false,'old Welcome child retired with host');
    const before=fixture.runtime.timers.count(0);
    staleBegin(); // Actual callback from the retired Welcome-to-host boundary.
    await fixture.settle();
    const observed={sameProvider:fixture.renderer.instance('WelcomeProvider')===provider,
     foreignFocusTimers:fixture.runtime.timers.count(0)-before,
     laterHostSame:fixture.renderer.instance('OpeningGoalFlow')===laterHost,
     laterReviewVisible:Boolean(byTestId(fixture.renderer.tree,'welcome-begin')),
     goalOpenedCalls:fixture.runtime.goalOpenedCalls,
     guestSelected:guestSelectedValue(fixture)};
    behavioralObservations.set(variant,observed);
    assert.deepEqual({foreignFocusTimers:observed.foreignFocusTimers,
     laterHostSame:observed.laterHostSame,laterReviewVisible:observed.laterReviewVisible,
     goalOpenedCalls:observed.goalOpenedCalls,guestSelected:observed.guestSelected},
    {foreignFocusTimers:0,laterHostSame:true,laterReviewVisible:true,
     goalOpenedCalls:0,guestSelected:false},'ORACLE_RETIRED_BEGIN');
    const currentWelcome=fixture.renderer.instance('WelcomeExperience');
    assert.ok(currentWelcome?.active&&currentWelcome!==retiredWelcome,
     'replacement Welcome supplies the current callback');
    withCompositionRuntime(fixture.runtime,()=>currentWelcome.props.onBegin());
    const currentCompletion=fixture.runtime.animations.latestCallback();
    if(currentCompletion) fixture.runtime.animations.finish(currentCompletion,true);
    await fixture.settle();
    observed.currentReviewClosed=!byTestId(fixture.renderer.tree,'welcome-begin');
    observed.currentGoalOpenedCalls=fixture.runtime.goalOpenedCalls;
    observed.currentGuestSelected=guestSelectedValue(fixture);
    assert.equal(observed.currentReviewClosed,true,'current review Begin closes replacement run');
    assert.equal(observed.currentGoalOpenedCalls,0,'review Begin does not open goal');
    assert.equal(observed.currentGuestSelected,false,'review Begin does not select guest');
   }finally{fixture.unmount();}
  },
 };
 const behavioralObservations=new Map();
 const baselineObservations=new Map();
 for(const mutant of mutants){
  const oracle=behavioralOracles[mutant.oracle];
  await oracle('baseline');
  baselineObservations.set(mutant.oracle,structuredClone(behavioralObservations.get('baseline')));
  console.log(`PASS baseline behavioral oracle: ${mutant.oracle} ${JSON.stringify(behavioralObservations.get('baseline'))}`);
 }
 console.log('CP9 baseline composition and 5/5 behavioral oracles: PASS before mutant inference');
 for(const mutant of mutants){
  const oracle=behavioralOracles[mutant.oracle];
  let rejection;
  try{await oracle(mutant.variant);}catch(error){rejection=error;}
  assert.ok(behavioralObservations.has(mutant.variant),`MUTANT_BEHAVIOR_NOT_OBSERVED:${mutant.name}`);
 assert.equal(rejection?.code,'ERR_ASSERTION',`BEHAVIORAL_FALSIFIER_NOT_REJECTED:${mutant.name}`);
 assert.match(String(rejection.message),new RegExp(mutant.oracle),
  `NON_BEHAVIORAL_MUTANT_ERROR:${mutant.name}`);
 assert.ok(compositionOverrideLoads.get(mutant.variant)>0,`MUTANT_SOURCE_NOT_LOADED:${mutant.name}`);
 const execution=mutantExecution.get(mutant.variant)??[];
 assert.ok(execution.length>0,`MUTANT_MECHANISM_NOT_EXECUTED:${mutant.name}`);
 if(mutant.variant==='mutant-2')assert.ok(execution.includes('BLOCKED')&&execution.includes('ANONYMOUS'));
 if(mutant.variant==='mutant-4')assert.ok(execution.length>=2,'DUPLICATE_COMPLETION_NOT_EXECUTED');
 console.log(`PASS behavioral falsifier: ${mutant.name} -> ${mutant.oracle}; loaded=${compositionOverrideLoads.get(mutant.variant)}; executed=${JSON.stringify(execution)}; observed=${JSON.stringify(behavioralObservations.get(mutant.variant))}`);
}
for(const mutant of mutants){
 await behavioralOracles[mutant.oracle]('baseline');
 assert.deepEqual(behavioralObservations.get('baseline'),baselineObservations.get(mutant.oracle),
  `POST_MUTANT_BASELINE_CONTAMINATION:${mutant.oracle}`);
 console.log(`PASS final clean baseline oracle: ${mutant.oracle}`);
}
for(const variant of ['baseline','connected-owner',...mutants.map(mutant=>mutant.variant)]){
 const loaded=compositionLoaded.get(variant);
 assert.ok(loaded?.size,`NO_COMPOSITION_SOURCE_LOADED:${variant}`);
 for(const file of compositionLibFiles)
  assert.equal(hashBytes(readFileSync(file)),sealedCompositionLib.get(file),
   `LIB_BYTES_CHANGED_IN_VARIANT:${variant}:${file}`);
 const names=[...loaded].map(file=>compositionLibFiles.has(file)
  ? `lib/api-zod/src/${relative(compositionLibRoot,file).replaceAll('\\','/')}`
  : `artifacts/human-development-intelligence/${relative(compositionRoot,file).replaceAll('\\','/')}`).sort();
 console.log(`CP9 manifest loaded ${variant}: ${JSON.stringify(names)}`);
}
assert.equal(networkCalls,0,'release-8 network calls');
assert.equal(compositionState.networkCalls,0,'composition network calls');
assert.equal(compositionState.providerCalls,0,'composition provider calls');
globalThis.setTimeout=originalTimers.setTimeout;globalThis.clearTimeout=originalTimers.clearTimeout;
globalThis.requestAnimationFrame=originalTimers.requestAnimationFrame;globalThis.cancelAnimationFrame=originalTimers.cancelAnimationFrame;
console.log(`CP9 actual AppSurface/Welcome/Settings/Opening/useM2Gateway real-store composition: ${compositionCases}/6 PASS`);
console.log('CP9 falsifiers: 5/5 behavioral rejections; repeated completion callback boundary only; locale8/motion/first/review/focus/rebind/late-native/owner invalidation PASS');
console.log('CP9 provider/network calls: 0; native/device/User001/linguistic-human: NOT_RUN');
