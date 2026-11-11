import * as wearableS30 from '../domain/wearable/contract.ts';
import * as m7Archive28 from '../domain/m7/store.ts';
import * as m7Copy28 from '../i18n-m7-record.ts';
import crypto from 'node:crypto';
import {createVisionTaskConsentAuthority,productionVisionTaskConsentAuthority} from '../../api-server/src/ai/c2-permission.ts';
import {createC2Handlers,createC2WireDispatcher,C2_WIRE_LIMITS} from '../../api-server/src/ai/c2-operation.ts';
import {C2_POLICY} from '../../../lib/api-zod/src/c2-vision.ts';
import {sanitizeC2Jpeg} from '../../../lib/api-zod/src/c2-jpeg.ts';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire,registerHooks} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createCoachPresenceFlow,createProductionCoachRuntime,coachTaskDomains} from '../components/coach-presence-flow.ts';
import {createLocalOwnerBoundary} from '../domain/local-owner/boundary.ts';
import {coachPresenceMessages,coachPresenceCopy} from '../i18n-coach-presence.ts';
import {completedSystemMessages} from '../i18n-system-complete.ts';
import {translate} from '../i18n.ts';
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;},equal=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),unit=path.resolve(app,'../../../..');
const a=JSON.parse(await readFile(path.join(unit,'ACK_AND_ADMISSION.json'),'utf8'));
const require=createRequire(import.meta.url),ts=require(a.typescript.path);
const opening=await readFile(path.join(app,'components/OpeningGoalFlow.tsx'),'utf8'),hook=await readFile(path.join(app,'components/useM2Gateway.ts'),'utf8');
ok(!/m2\.m3Tasks|switchM3Task/.test(opening),'No prototype list in UI');
ok(/hasM3Activity: Boolean\(trainerView\?\.task \|\| presentedM3Tasks.length\)/.test(hook),'Same existing activity fact; no new producer');
ok(/m2\.hasM3Activity/.test(opening),'UI consumes clean fact');
for(const loc of ['vi','en','zh-Hans','es','hi','ja','ko','ru']){
 equal(Object.keys(coachPresenceMessages[loc]).sort(),Object.keys(coachPresenceMessages.en).sort(),'copy shape '+loc);
 for(const [k,v]of Object.entries(coachPresenceMessages[loc])){ok(typeof v==='string'&&v.trim().length>0,loc+k);
 if(!['vi','en'].includes(loc))ok(v!==coachPresenceMessages.en[k]&&v!==coachPresenceMessages.vi[k],'No fallback '+loc+k);}
}
for(const loc of ['zh-Hans','es','hi','ja','ko','ru']){
 equal(Object.keys(completedSystemMessages[loc]).length,84);
 for(const[k,v]of Object.entries(completedSystemMessages[loc])){equal(translate(loc,k),v,'actual translated resource '+loc+k);
 ok(v!==translate('en',k)&&v!==translate('vi',k),'no en/vi base value '+loc+k);
 const placeholders=x=>(x.match(/\{\w+\}/g)||[]).sort();
 equal(placeholders(v),placeholders(translate('en',k)),'placeholders '+loc+k);
 }
}
const active13=['today','understand','statusSaving','statusError','statusReady','interactionUnreadableBody','validation','openValidation','errorDetails','fallbackTitle','fallbackBody','retry','closeDetails'];
for(const loc of ['zh-Hans','es','hi','ja','ko','ru'])for(const k of active13){const v=translate(loc,k);ok(v!==k&&v!==translate('en',k)&&v!==translate('vi',k),'active13 no fallback '+loc+k);}
const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'Fragment'};
const transpile=(file,code)=>ts.transpileModule(code,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const module={exports:{}},panelPath=path.join(app,'components/CoachPresencePanel.tsx');
const code=transpile(panelPath,await readFile(panelPath,'utf8'));
new vm.Script('(function(require,module,exports){'+code+'\n})',{filename:panelPath}).runInNewContext({Object,console})(
 s=>s==='react'?React:s==='react-native'?{View:'View',Text:'Text',Pressable:'Pressable',StyleSheet:{create:x=>x}}:s==='../i18n-coach-presence'?{coachPresenceCopy}:()=>{throw Error('UNADMITTED_PANEL_IMPORT '+s);},module,module.exports);
const flatten=node=>!node||typeof node!=='object'?[]:[node,...(node.props?.children||[]).flat(Infinity).flatMap(flatten)];
for(const loc of Object.keys(coachPresenceMessages))for(const domain of ['meal','exercise_form','physique_posture']){
 const calls=[];const flow=Object.fromEntries(['take','choose','use','allowC1','allowC2','analyze','chooseProposal','retake','cancel','revoke','delete'].map(k=>[k,t=>calls.push([k,t])]));
 const token={};const tree=module.exports.CoachPresencePanel({flow,locale:loc,model:{token,domain,state:'EMPTY',busy:false}});
 const all=flatten(tree),buttons=all.filter(x=>x.type==='Pressable');
 equal(buttons.find(x=>x.props.testID==='coach-take').props.accessibilityLabel,coachPresenceCopy(loc).take);
 buttons.find(x=>x.props.testID==='coach-take').props.onPress();equal(calls[0],['take',token]);
 const busy=flatten(module.exports.CoachPresencePanel({flow,locale:loc,model:{token,domain,state:'ANALYZING',busy:true,hasPhoto:true,c1:true}}));
 equal(busy.find(x=>x.props.testID==='coach-revoke').props.disabled,false,'Revoke available during request');
}
async function fixture(domain){
 const boundary=createLocalOwnerBoundary({verify:async()=>({status:'verified',owner:{subjectId:'test_owner',profileId:'test_profile'},validUntil:Date.now()+60000})});
 const lease=await boundary.control.verifySession();boundary.control.finishHydration(lease);
 let source={key:'A1',domain,access:boundary.access,lease,authorization:{withBearer:async(_,f)=>f('Bearer TEST_FIXTURE')},
 sessionId:'session',taskId:'A',revision:1,taskKind:Object.keys(coachTaskDomains).find(k=>coachTaskDomains[k]===domain)};
 let calls=0,rtState='CONSENT_REQUIRED',deferred,release;
 const runtime={allowAndPrepare:async()=>{calls++;rtState='READY_NOT_SENT';return true;},
 analyze:async()=>{if(deferred)await deferred;rtState='PROPOSAL';return true;},
 view:()=>({state:rtState,proposal:rtState==='PROPOSAL'?{state:'PROPOSAL',result:{cues:[]}}:undefined}),
 revoke:()=>{rtState='CONSENT_REQUIRED';},retire:()=>{rtState='CONSENT_REQUIRED';},
 settleCleanup:async()=>true,settleRevocations:async()=>true};
 const picker={requestCameraPermission:async()=>'granted',takePhoto:async()=>({canceled:false,asset:{uri:'file:///TEST_FIXTURE.jpg',width:2,height:2}}),
 choosePhoto:async()=>({canceled:false,asset:{uri:'file:///TEST_FIXTURE.jpg',width:2,height:2}})};
 const flow=createCoachPresenceFlow({current:()=>source,picker,runtime:async()=>runtime});
 const token=()=>flow.getSnapshot().token;
 flow.bind();
 return{flow,token,boundary,get calls(){return calls;},switch:()=>{source={...source,key:'B2',taskId:'B'};flow.bind();},
 restore:()=>{source={...source,key:'A3',taskId:'A'};flow.bind();},hold:()=>{deferred=new Promise(r=>release=r);},
 release:()=>release?.(),cleanup:()=>{flow.dispose();boundary.control.invalidateCurrentSession();}};
}
for(const domain of ['meal','exercise_form','physique_posture']){
 const f=await fixture(domain);try{
  const stale=f.token();equal(await f.flow.take(stale),true);equal(f.flow.use(stale),false,'stale render event denied');
  equal(f.flow.use(f.token()),true);equal(f.calls,0,'no external consent inferred from C0 choice');
  equal(f.flow.allowC1(f.token()),true);equal(f.calls,0,'C1 is not C2');
  equal(await f.flow.allowC2(f.token()),true);equal(f.calls,1);
  equal(await f.flow.analyze(f.token()),true);equal(f.flow.getSnapshot().selected,false);
  equal(f.flow.chooseProposal(f.token()),true);equal(f.flow.getSnapshot().M6_STARTED,false);
  equal(f.flow.getSnapshot().M7_USE_NEXT_CYCLE,false);
  const old=f.token();f.switch();equal(f.flow.chooseProposal(old),false);equal(f.flow.getSnapshot().hasPhoto,false);
  f.restore();equal(f.flow.getSnapshot().hasPhoto,false,'new A does not reuse old photo or consent');
  equal(f.flow.getSnapshot().c1,false);
 }finally{f.cleanup();}
}
const f=await fixture('meal');try{
 await f.flow.take(f.token());f.flow.use(f.token());f.flow.allowC1(f.token());await f.flow.allowC2(f.token());
 f.hold();const running=f.flow.analyze(f.token());const revoke=f.token();equal(f.flow.revoke(revoke),true);
 f.switch();f.release();await running;equal(f.flow.getSnapshot().sourceKey,'B2');equal(f.flow.getSnapshot().hasPhoto,false);
 f.boundary.control.invalidateCurrentSession();equal(await f.flow.take(f.token()),false,'invalid lease denies picker');
}finally{f.cleanup();}

// Exercise the actual native-IO adapter against bounded SDK doubles (no native image claim).
const ioModule={exports:{}},ioPath=path.join(app,'lib/camera/expo-vision-io.ts');
const ioCode=transpile(ioPath,await readFile(ioPath,'utf8'));
let fsReads=0,fsWrites=0,imageReleases=0,contextReleases=0,renderThrows=false,releaseMissing=false;
const fsDouble={EncodingType:{Base64:'base64'},readAsStringAsync:async()=>{fsReads++;return 'AQID';},writeAsStringAsync:async()=>{fsWrites++;}};
const sdkDouble={ImageManipulator:{manipulate:()=>({release:()=>contextReleases++,renderAsync:async()=>{
 if(renderThrows)throw Error('SDK_RENDER_FAILURE');return {width:2,height:3,...(releaseMissing?{}:{release:()=>imageReleases++})};
}})}};
new vm.Script('(function(require,module,exports){'+ioCode+'\n})',{filename:ioPath}).runInNewContext({Object,Uint8Array,btoa,atob})(
 spec=>{if(spec==='expo-file-system/legacy')return fsDouble;if(spec==='./expo-cache-cleanup')return {createExpoCacheCleanup:()=>({canDeleteOwnedCache:u=>u==='file:///OWNED_CACHE.jpg'})};
 if(spec==='expo-image-manipulator')return sdkDouble;throw Error('UNADMITTED_IO_IMPORT '+spec);},ioModule,ioModule.exports);
const io=ioModule.exports.createExpoVisionImageIO();
await assert.rejects(io.readOwnedCache('file:///ORIGINAL.jpg'),/C2_UNOWNED_CACHE/);checks++;
equal(fsReads,0,'unowned URI never read');
equal([...await io.readOwnedCache('file:///OWNED_CACHE.jpg')],[1,2,3]);
await assert.rejects(io.writeOwnedCache('file:///OWNED_CACHE.jpg',new Uint8Array(1048577)),/C2_IMAGE_LIMIT/);checks++;equal(fsWrites,0);
await io.writeOwnedCache('file:///OWNED_CACHE.jpg',new Uint8Array([1]));equal(fsWrites,1);
equal(JSON.stringify(await io.decodeJpeg(new Uint8Array([1]))),JSON.stringify({width:2,height:3}));equal(imageReleases,1);equal(contextReleases,1);
renderThrows=true;await assert.rejects(io.decodeJpeg(new Uint8Array([1])),/SDK_RENDER_FAILURE/);checks++;equal(contextReleases,2);
renderThrows=false;releaseMissing=true;await assert.rejects(io.decodeJpeg(new Uint8Array([1])),/C2_DECODER_CLEANUP_UNAVAILABLE/);checks++;equal(contextReleases,3);
await assert.rejects(io.decodeJpeg(new Uint8Array(1048577)),/C2_IMAGE_LIMIT/);checks++;


// S24: real byte dispatcher + real production runtime + controlled server composition, zero sockets.
const wireDecoderBytes=await readFile(a.jpeg_decoder_path);
equal(crypto.createHash('sha256').update(wireDecoderBytes).digest('hex'),a.jpeg_decoder_sha256,'pinned decoder');
const WireJimp=require(a.jpeg_decoder_path),wireJpeg=new Uint8Array(await new WireJimp(2,2,0x2299bbff).getBufferAsync(WireJimp.MIME_JPEG));
const wireDecode=async b=>{const image=await WireJimp.read(Buffer.from(b));return{width:image.bitmap.width,height:image.bitmap.height};};
const wireGood=domain=>({vision_domain:domain,state:'OBSERVATIONS',cues:[C2_POLICY[domain].cues[0]],uncertainty:'LIMITED_2D',limitations:['SINGLE_FRAME_NOT_DIAGNOSTIC'],quality:'CLEAR_STATIC_VIEW'});
const wireSegment=(marker,text)=>{const b=Buffer.from(text);return Buffer.concat([Buffer.from([255,marker,(b.length+2)>>8,(b.length+2)&255]),b]);};
const wireInsert=(...parts)=>new Uint8Array(Buffer.concat([Buffer.from(wireJpeg.slice(0,2)),...parts,Buffer.from(wireJpeg.slice(2))]));
let wireCases=0;
async function wireCheck(name,run){await run();wireCases++;console.log('PASS S24 '+name);}
const wireHeaders={'Content-Type':'application/json'};
await wireCheck('REAL_APP_LITERAL_LIMITS',async()=>{const appSource=await readFile(path.resolve(app,'../api-server/src/app.ts'),'utf8');
 const vision=appSource.indexOf('app.use("/api/ai/c2/vision", express.json({ limit: "1536kb", type: "application/json" }));');
 const text=appSource.indexOf('app.use(express.json({ limit: "32kb" }));');ok(vision>=0&&vision<text);equal(C2_WIRE_LIMITS.defaultJsonBytes,32768);equal(C2_WIRE_LIMITS.visionJsonBytes,1572864);
 equal(C2_WIRE_LIMITS.visionLimitSpec,'1536kb');equal(C2_WIRE_LIMITS.defaultLimitSpec,'32kb');});
await wireCheck('RAW_UTF8_LIMITS_PRE_PARSE_AND_HANDLER',async()=>{let permission=0,vision=0;const dispatcher=createC2WireDispatcher({permission:async(req,res)=>{permission++;res.status(200).json({accepted:true});},vision:async(req,res)=>{vision++;res.status(200).json({accepted:true});}});
 const call=(path,rawBody,extra={})=>dispatcher({path,rawBody,headers:wireHeaders,method:'POST',...extra});
 const bodyAt=n=>' '.repeat(n-2)+'{}';
 equal((await call('/api/ai/c2/permission',bodyAt(32768))).status,200);equal(permission,1);
 const largeBad=await call('/api/ai/c2/permission','!'.repeat(32769));equal(largeBad.status,413);equal(largeBad.body.code,'C2_PAYLOAD_TOO_LARGE');equal(permission,1);equal(largeBad.headers['Cache-Control'],'no-store');
 equal((await call('/api/ai/c2/vision',bodyAt(32769))).status,200);equal(vision,1);
 equal((await call('/api/ai/c2/vision',bodyAt(1572864))).status,200);equal(vision,2);
 equal((await call('/api/ai/c2/vision',new Uint8Array(1572865))).status,413);equal(vision,2);
 equal((await call('/api/ai/c2/permission','"'+'é'.repeat(16384)+'"')).status,413);equal(permission,1,'UTF8 bytes, not code units');
 equal((await call('/api/ai/c2/permission','{')).status,400);
 equal((await call('/api/ai/c2/permission',new Uint8Array([0xff]))).status,400);
 equal((await call('/api/ai/c2/permission','{}',{method:'GET'})).status,405);
 equal((await call('/api/ai/c2/permission','{}',{headers:{}})).status,415);
 equal((await call('/api/ai/c2/permission','{}',{headers:{'content-type':'text/plain'}})).status,415);
 equal((await call('/api/not-present','{}')).status,404);
 equal((await call('/api/ai/m3',bodyAt(32769))).status,413);
 const aborted=new AbortController();aborted.abort();equal((await call('/api/ai/c2/permission','{}',{signal:aborted.signal})).status,409);equal(permission,1);
});
async function wireFixture(domain='meal',options={}){
 let clock=Date.now(),facts,epoch=1,providerCalls=0,bytes=wireInsert(wireSegment(225,'Exif\0GPS TEST_SYNTHETIC'),wireSegment(225,'http://ns.adobe.com/xap/1.0/\0XMP'),wireSegment(254,'synthetic COM'));
 if(options.badICC)bytes=wireInsert(wireSegment(226,'invalid ICC'));
 const listeners=new Set(),identity={sessionKey:'wire_session',owner:{subjectId:'wire_owner',profileId:'wire_profile'},validUntil:new Date(clock+300000).toISOString()};
 const authority=options.production?productionVisionTaskConsentAuthority:createVisionTaskConsentAuthority({reader:{read:()=>facts,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);}},topology:'SINGLE_AUTHORITY_PROCESS',now:()=>clock});
 const boundary=createLocalOwnerBoundary({verify:async()=>({status:'verified',owner:identity.owner,validUntil:Date.now()+120000})});
 const lease=await boundary.control.verifySession();boundary.control.finishHydration(lease);
 let source={key:'wire_A',domain,access:boundary.access,lease,authorization:{withBearer:async(signal,read)=>{if(signal.aborted)throw Error('ABORTED');return read('Bearer TEST_FIXTURE_WIRE');}},sessionId:'wire_task_session',taskId:'wire_A',revision:1,taskKind:C2_POLICY[domain].taskKind};
 let startedResolve,holdResolve,hold=false,lastRuntime;
 const started=new Promise(r=>startedResolve=r),held=new Promise(r=>holdResolve=r),requests=[];
 const handlers=createC2Handlers({authority,verifyIdentity:async req=>{if(req.headers?.Authorization!=='Bearer TEST_FIXTURE_WIRE')throw Object.assign(new Error('INVALID_SESSION'),{name:'IdentitySessionError'});return identity;},reserve:async()=>{},decodeJpeg:wireDecode,provider:()=>({mode:'MOCK_ONLY',analyze:async input=>{providerCalls++;equal(sanitizeC2Jpeg(input.jpeg).removed,0,'server sees sanitized bytes');startedResolve();if(hold)await held;return options.unsafe?{...wireGood(domain),exact_kcal:999}:options.uncertain?{...wireGood(domain),quality:'OCCLUDED'}:wireGood(domain);}})});
 const dispatch=createC2WireDispatcher(handlers);
 const bridge=async(url,init)=>{const row={path:new URL(url).pathname,action:JSON.parse(init.body).action,signal:init.signal,body:JSON.parse(init.body)};requests.push(row);
  const response=await dispatch({path:row.path,method:init.method,headers:init.headers,rawBody:options.padVision&&row.path.endsWith('/vision')?' '.repeat(33000)+init.body:init.body,signal:init.signal});row.response=response;
  return{status:response.status,ok:response.status>=200&&response.status<300,text:async()=>JSON.stringify(response.body)};
 };
 const io={canDeleteOwnedCache:uri=>uri===undefined||uri==='file:///wire/owned.jpg',deleteOwnedCache:async uri=>{equal(uri,'file:///wire/owned.jpg');return true;},readOwnedCache:async()=>bytes.slice(),writeOwnedCache:async(_,next)=>{bytes=next.slice();},decodeJpeg:options.badDimensions?async()=>({width:3,height:2}):wireDecode};
 const rendered={width:2,height:2,saveAsync:async()=>({uri:'file:///wire/owned.jpg',width:2,height:2})};
 const nativeDouble={SaveFormat:{JPEG:'jpeg'},ImageManipulator:{manipulate:()=>({resize(){return this;},renderAsync:async()=>rendered})}};
 const flow=createCoachPresenceFlow({current:()=>source,picker:{requestCameraPermission:async()=>'granted',takePhoto:async()=>({canceled:false,asset:{uri:'file:///wire/original.jpg',width:2,height:2}}),choosePhoto:async()=>({canceled:false,asset:{uri:'file:///wire/original.jpg',width:2,height:2}})},runtime:async(live,s)=>{
  const current=live();facts={...current.scope,owner:identity.owner,sessionKey:identity.sessionKey,taskKind:C2_POLICY[domain].taskKind,m4Required:true,c1Accepted:true,sourceEpoch:epoch,validUntil:clock+120000,provenance:'TEST_FIXTURE'};
  if(options.wrongTask)facts={...facts,taskId:'foreign_task'};
  lastRuntime=await createProductionCoachRuntime(live,s,{domain:'http://127.0.0.1:18110',fetch:bridge,preparerIO:io,preparerRuntime:nativeDouble,now:()=>clock});return lastRuntime;
 }});
 const ownerOff=boundary.access.subscribe(()=>flow.bind());flow.bind();const token=()=>flow.getSnapshot().token;
 const prepare=async()=>{equal(await flow.take(token()),true);equal(flow.use(token()),true);equal(flow.allowC1(token()),true);return flow.allowC2(token());};
 return{flow,token,prepare,requests,authority,boundary,identity,dispatch,started,hold:()=>{hold=true;},release:()=>holdResolve(),get providerCalls(){return providerCalls;},get imageBytes(){return bytes;},get runtime(){return lastRuntime;},advance:t=>{clock=t;},switch:()=>{clock++;source={...source,key:'wire_B',taskId:'wire_B'};epoch++;flow.bind();},restore:()=>{clock++;source={...source,key:'wire_A3',taskId:'wire_A'};epoch++;flow.bind();},dispose:async()=>{ownerOff();flow.dispose();boundary.control.invalidateCurrentSession();holdResolve();if(lastRuntime){await lastRuntime.settleCleanup();await lastRuntime.settleRevocations();}if(!options.production)authority.dispose();}};
}
await wireCheck('PRODUCTION_REAL_RUNTIME_WIRE_403_ZERO_PROVIDER',async()=>{const f=await wireFixture('meal',{production:true});try{equal(await f.prepare(),false);equal(f.flow.getSnapshot().state,'BLOCKED');equal(f.requests[0].response.status,403);equal(f.requests[0].response.body.code,'C2_SERVER_TASK_AUTHORITY_UNAVAILABLE');equal(f.providerCalls,0);}finally{await f.dispose();}});
for(const domain of ['meal','exercise_form','physique_posture'])await wireCheck('REAL_RUNTIME_WIRE_FULL_'+domain,async()=>{const f=await wireFixture(domain,{padVision:true});try{equal(await f.prepare(),true);equal(f.requests[0].response.status,200);equal(f.requests[0].action,'GRANT');equal(sanitizeC2Jpeg(f.imageBytes).removed,0);ok(!Buffer.from(f.imageBytes).includes(Buffer.from('GPS')));equal(f.providerCalls,0);equal(await f.flow.analyze(f.token()),true);equal(f.flow.getSnapshot().state,'PROPOSAL');equal(f.providerCalls,1);equal(f.flow.chooseProposal(f.token()),true);equal(f.flow.getSnapshot().selected,true);equal(f.flow.getSnapshot().M6_STARTED,false);equal(f.flow.getSnapshot().M7_USE_NEXT_CYCLE,false);equal(f.flow.revoke(f.token()),true);equal(await f.runtime.settleRevocations(),true);equal(f.authority.inspect().grants,0);ok(f.requests.some(r=>r.action==='REVOKE'&&r.response.status===200));}finally{await f.dispose();}});
for(const mode of ['revoke','switch','session'])await wireCheck('MIDFLIGHT_ABORT_'+mode,async()=>{const f=await wireFixture();try{equal(await f.prepare(),true);f.hold();const running=f.flow.analyze(f.token());await f.started;
 if(mode==='revoke')f.flow.revoke(f.token());else if(mode==='switch')f.switch();else f.boundary.control.invalidateCurrentSession();
 equal(await running,false);const row=f.requests.find(x=>x.path.endsWith('/vision'));equal(row.signal.aborted,true);equal(row.response.status,409);equal(row.response.body.code,'C2_CANCELLED');equal(f.flow.getSnapshot().proposal,undefined);equal(f.authority.inspect().operations,0);f.release();}finally{await f.dispose();}});
for(const option of ['badICC','badDimensions','wrongTask'])await wireCheck('REAL_CLIENT_FAIL_CLOSED_'+option,async()=>{const f=await wireFixture('meal',{[option]:true});try{equal(await f.prepare(),false);equal(f.flow.getSnapshot().state,'BLOCKED');equal(f.requests.filter(x=>x.path.endsWith('/vision')).length,0);equal(f.providerCalls,0);}finally{await f.dispose();}});
for(const option of ['unsafe','uncertain'])await wireCheck('REAL_WIRE_OUTPUT_BOUNDARY_'+option,async()=>{const f=await wireFixture('meal',{[option]:true});try{equal(await f.prepare(),true);const result=await f.flow.analyze(f.token());equal(result,option==='uncertain');equal(f.flow.getSnapshot().state,option==='unsafe'?'BLOCKED':'NEED_MORE_INFO');equal(f.flow.getSnapshot().proposal,undefined);equal(f.flow.chooseProposal(f.token()),false);}finally{await f.dispose();}});
await wireCheck('WIRE_WRONG_DOMAIN_EXPIRED_REVOKED_GRANTS',async()=>{const f=await wireFixture();try{equal(await f.prepare(),true);const grant=f.requests[0].response.body;
 const call=g=>f.dispatch({path:'/api/ai/c2/vision',method:'POST',headers:{...wireHeaders,Authorization:'Bearer TEST_FIXTURE_WIRE'},rawBody:JSON.stringify({grant:g,mime:'image/jpeg',imageBase64:Buffer.from(wireJpeg).toString('base64')})});
 equal((await call({...grant,vision_domain:'exercise_form',purpose:C2_POLICY.exercise_form.purpose})).status,403);equal(f.providerCalls,0);
 f.advance(grant.expiresAt+1);equal((await call(grant)).status,403);equal(f.authority.inspect().grants,0);equal(f.providerCalls,0);
 }finally{await f.dispose();}
 const revoked=await wireFixture();try{equal(await revoked.prepare(),true);const grant=revoked.requests[0].response.body;revoked.flow.revoke(revoked.token());await revoked.runtime.settleRevocations();const response=await revoked.dispatch({path:'/api/ai/c2/vision',headers:{...wireHeaders,Authorization:'Bearer TEST_FIXTURE_WIRE'},rawBody:JSON.stringify({grant,mime:'image/jpeg',imageBase64:Buffer.from(wireJpeg).toString('base64')})});equal(response.status,403);equal(revoked.providerCalls,0);}finally{await revoked.dispose();}
});

await wireCheck('ABORT_DURING_IDENTITY_ISSUES_NO_GRANT',async()=>{let begin,release,authorityCalls=0;const started=new Promise(r=>begin=r),held=new Promise(r=>release=r),controller=new AbortController();
 const handlers=createC2Handlers({authority:{...productionVisionTaskConsentAuthority,permission:(...args)=>{authorityCalls++;return productionVisionTaskConsentAuthority.permission(...args);}},verifyIdentity:async()=>{begin();await held;return{sessionKey:'abort_identity',owner:{subjectId:'abort_owner',profileId:'abort_profile'},validUntil:new Date(Date.now()+60000).toISOString()};},provider:()=>{throw Error('NO_PROVIDER');},reserve:async()=>{throw Error('NO_BUDGET');}});
 const dispatch=createC2WireDispatcher(handlers),running=dispatch({path:'/api/ai/c2/permission',headers:wireHeaders,rawBody:'{}',signal:controller.signal});await started;controller.abort();release();const response=await running;equal(response.status,409);equal(response.body.code,'C2_CANCELLED');equal(authorityCalls,0);
});


await wireCheck('REAL_WIRE_ABA_OLD_COMPLETION_CANNOT_CLEAR_NEW_A',async()=>{const f=await wireFixture();try{equal(await f.prepare(),true);f.hold();const old=f.flow.analyze(f.token());await f.started;const oldToken=f.token();f.switch();equal(f.flow.getSnapshot().sourceKey,'wire_B');f.restore();equal(f.flow.getSnapshot().sourceKey,'wire_A3');equal(f.flow.getSnapshot().hasPhoto,false);equal(f.flow.getSnapshot().c1,false);equal(await f.prepare(),true);equal(f.flow.getSnapshot().state,'READY_NOT_SENT');f.release();equal(await old,false);equal(f.flow.getSnapshot().sourceKey,'wire_A3');equal(f.flow.getSnapshot().state,'READY_NOT_SENT');equal(f.flow.chooseProposal(oldToken),false);equal(await f.flow.analyze(f.token()),true);equal(f.flow.getSnapshot().state,'PROPOSAL');equal(f.requests.filter(r=>r.path.endsWith('/vision'))[0].response.status,409);equal(f.requests.filter(r=>r.path.endsWith('/vision')).at(-1).response.status,200);}finally{await f.dispose();}});

console.log('S24_WIRE_RESULT '+JSON.stringify({cases:wireCases,assertions:checks,network_sockets:0,live_provider:0,proof:'Raw-byte dispatcher -> actual handlers/authority/preparer/decoder and actual production client runtime with injected TEST_FIXTURE IO/fetch; Express middleware and native SDK/device NOT_RUN'}));

console.log('S22_RESULT '+JSON.stringify({checks,status:'PASS_SCOPED_CODE_OFFLINE_COMPOSITION',locales:8,explicit_system_cells:504,active13_cells:78,actual_97_system_keys_english_fallback:0,
 machine_producer_edits:0,provider_network_calls:0,native_browser:0,limits:'React tree + injected ports, not mounted native UI or human linguistic acceptance; production reader remains unconfigured403'}));

// S25: actual session core/SQL port + M3/C2 boundaries + guarded storage. No socket/provider/real-user data.
const erasureCore = await import('../../api-server/src/identity/session-core.ts');
const {createGuardedUserStorage,USER_DATA_KEYS}=await import('../domain/local-owner/storage.ts');
const {EventEmitter}=await import('node:events');
const vmModules55=new Map();
function loadServer55(file){file=path.resolve(file);if(!path.extname(file))file+='.ts';if(file===path.resolve(app,'../api-server/src/identity/session-core.ts'))return erasureCore;if(!file.startsWith(path.resolve(app,'../..')+path.sep)&&!file.startsWith(path.resolve(app,'../..','lib')+path.sep))throw Error('S25_VM_SCOPE');if(vmModules55.has(file))return vmModules55.get(file).exports;const m={exports:{}};vmModules55.set(file,m);const code=transpile(file,require('node:fs').readFileSync(file,'utf8'));new vm.Script('(function(require,module,exports){'+code+'\n})',{filename:file}).runInThisContext()((name)=>name==='express'?{Router:()=>{const routes=new Map();return{routes,post(path,fn){routes.set('POST '+path,fn);return this},get(path,fn){routes.set('GET '+path,fn);return this}}}}:name==='@workspace/api-zod'?loadServer55(path.resolve(app,'../..','lib/api-zod/src/m3-contract.ts')):name.startsWith('.')?loadServer55(path.resolve(path.dirname(file),name)):require(name),m,m.exports);return m.exports;}
const {createM3Handler}=loadServer55(path.resolve(app,'../api-server/src/ai/m3-operation.ts'));
const {createM3PermissionAuthority}=loadServer55(path.resolve(app,'../api-server/src/ai/m3-permission.ts'));
const defer55=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
let s25Groups=0;const s25Cases=[];async function check55(name,fn){await fn();s25Groups++;s25Cases.push(name);console.log('PASS S25 '+name);}
const id55=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
let sequence55=100;
function db55(options={}){
 const base=sequence55;sequence55+=10;const A={subjectId:id55(base),profileId:id55(base+1)},B={subjectId:id55(base+2),profileId:id55(base+3)};
 const tokens={A:Buffer.from('s25-'+base+'-A').toString('base64url').padEnd(43,'A'),A2:Buffer.from('s25-'+base+'-A2').toString('base64url').padEnd(43,'C'),B:Buffer.from('s25-'+base+'-B').toString('base64url').padEnd(43,'B')};
 const digest=t=>crypto.createHash('sha256').update(t).digest('hex');
 const state={owners:[{subject_id:A.subjectId,profile_id:A.profileId,status:'ACTIVE'},{subject_id:B.subjectId,profile_id:B.profileId,status:'ACTIVE'}],controls:[{binding_id:id55(base+4),subject_id:A.subjectId,provider:'apple'},{binding_id:id55(base+5),subject_id:A.subjectId,provider:'google'},{binding_id:id55(base+6),subject_id:B.subjectId,provider:'apple'}],sessions:[]};
 for(const name of ['A','A2','B'])state.sessions.push({session_id:id55(base+7+(name==='A'?0:name==='A2'?1:2)),token_digest:digest(tokens[name]),subject_id:name==='B'?B.subjectId:A.subjectId,valid_until:new Date(Date.now()+600000).toISOString(),revoked_at:null,issuer_provider:null,issuer_namespace_digest:null,issuer_epoch:null,issuer_reconciliation_digest:null,legacy_control_binding_id:id55(base+(name==='B'?6:4))});
 const queries=[];let failCommit=false,failDelete=false,originAllowed=true;
 const pool={async connect(){let tx;return{async query(text,values=[]){queries.push({tag:text.match(/identity(?:55|71):[a-z-]+/)?.[0]??text,values});if(text.startsWith('BEGIN')){tx=structuredClone(state);return{rows:[]}}if(text==='ROLLBACK'){tx=undefined;return{rows:[]}}if(text==='COMMIT'){if(failCommit)throw Error('TEST_COMMIT_FAILURE');Object.assign(state,tx);tx=undefined;return{rows:[]}}const s=tx??state;
 const tag=text.match(/identity(?:55|71):[a-z-]+/)?.[0];
 if(tag==='identity71:verify-session'||tag==='identity55:lock-owner'){if(tag==='identity55:lock-owner')ok(text.includes('FOR UPDATE OF o'),'actual owner/session lock');const session=s.sessions.find(x=>x.token_digest===values[0]&&x.revoked_at===null&&Date.parse(x.valid_until)>+values[1]);const owner=session&&s.owners.find(x=>x.subject_id===session.subject_id&&x.status==='ACTIVE');const binding=session&&s.controls.find(x=>x.binding_id===session.legacy_control_binding_id&&x.subject_id===session.subject_id&&x.provider==='apple');return{rows:owner&&(binding||(session.issuer_provider&&session.legacy_control_binding_id===null))?[{...session,...owner}]:[]}}
 if(tag==='identity55:retire-owner'){ok(text.includes('subject_id=$1 AND profile_id=$2'),'both owner columns bound');const owner=s.owners.find(x=>x.subject_id===values[0]&&x.profile_id===values[1]&&x.status==='ACTIVE');if(owner)owner.status='RETIRED';return{rows:owner?[{subject_id:owner.subject_id}]:[]}}
 if(tag==='identity55:erase-sessions'){if(failDelete)throw Error('TEST_DELETE_FAILURE');ok(text.includes('WHERE subject_id=$1'),'selective sessions');const rows=s.sessions.filter(x=>x.subject_id===values[0]).map(x=>({token_digest:x.token_digest}));s.sessions=s.sessions.filter(x=>x.subject_id!==values[0]);return{rows}}
 if(tag==='identity55:erase-controls'){ok(text.includes('WHERE subject_id=$1'),'selective bindings');s.controls=s.controls.filter(x=>x.subject_id!==values[0]);return{rows:[]}}
 if(tag==='identity71:revoke-session'){const row=s.sessions.find(x=>x.token_digest===values[0]&&!x.revoked_at);if(row)row.revoked_at=values[1];return{rows:row?[row]:[]}}
 throw Error('UNIMPLEMENTED_SQL '+tag);},release(){}}}};
 const core=erasureCore.createPostgresIdentitySessionCore(pool,erasureCore.createVerifiedControlCapability().authority,{sessionTtlMs:60000,taskAuthority:options.taskAuthority,originPolicy:options.google?{assertIssuancePreflight:async()=>{},authorizeIssuance:async()=>{throw Error('NOT_ISSUANCE_TEST')},confirmIssuanceCurrent:async()=>originAllowed,verifySessionOrigin:async()=>originAllowed}:undefined});
 const identity=async name=>({sessionKey:digest(tokens[name]),...await core.verifySession(tokens[name])});
 const dispatch=erasureCore.createAccountErasureDispatcher(core);
 const call=(token=tokens.A,body={confirm:true},extra={})=>dispatch({path:'/api/identity/account/delete',method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},rawBody:JSON.stringify(body),...extra});
 const Bsnapshot=()=>JSON.stringify({owners:state.owners.filter(x=>x.subject_id===B.subjectId),sessions:state.sessions.filter(x=>x.subject_id===B.subjectId),controls:state.controls.filter(x=>x.subject_id===B.subjectId)});
 return{A,B,tokens,state,pool,core,dispatch,call,identity,Bsnapshot,queries,failCommit:()=>failCommit=true,failDelete:()=>failDelete=true,denyOrigin:()=>originAllowed=false};
}
await check55('AUTHENTICATED_SELF_ERASURE_AND_B_ISOLATION',async()=>{const f=db55(),b=f.Bsnapshot();equal((await f.call()).status,204);equal(f.state.owners.find(x=>x.subject_id===f.A.subjectId).status,'RETIRED');equal(f.state.sessions.filter(x=>x.subject_id===f.A.subjectId).length,0);equal(f.state.controls.filter(x=>x.subject_id===f.A.subjectId).length,0);equal(f.Bsnapshot(),b);await assert.rejects(f.core.verifySession(f.tokens.A),/INVALID_SESSION/);await assert.rejects(f.core.verifySession(f.tokens.A2),/INVALID_SESSION/);equal((await f.call()).status,401);equal((await f.core.verifySession(f.tokens.B)).owner,f.B);ok(f.queries.some(x=>x.tag==='COMMIT'));});
await check55('UNAUTHENTICATED_WRONG_OWNER_AND_WIRE_FALSIFIERS',async()=>{const f=db55(),before=JSON.stringify(f.state);for(const body of [{confirm:false},{confirm:true,subjectId:f.B.subjectId},null,[],{confirm:'true'}])equal((await f.call(f.tokens.A,body)).status,400);equal((await f.call('Z'.repeat(43))).status,401);equal((await f.call('',{confirm:true})).status,401);equal((await f.call(f.tokens.A,{confirm:true},{path:'/api/identity/foreign'})).status,404);equal((await f.call(f.tokens.A,{confirm:true},{method:'GET'})).status,405);equal((await f.call(f.tokens.A,{confirm:true},{rawBody:'!'.repeat(1025)})).status,413);equal((await f.call(f.tokens.A,{confirm:true},{rawBody:'{'})).status,400);const ac=new AbortController();ac.abort();equal((await f.call(f.tokens.A,{confirm:true},{signal:ac.signal})).status,409);equal(JSON.stringify(f.state),before);});
await check55('TRANSACTION_FAILURE_NEVER_REPORTS_ERASED',async()=>{for(const failure of ['failDelete','failCommit']){const f=db55(),before=JSON.stringify(f.state);f[failure]();equal((await f.call()).status,503);equal(JSON.stringify(f.state),before);await assert.rejects(f.core.verifySession(f.tokens.A),/INVALID_SESSION/);equal((await f.core.verifySession(f.tokens.B)).owner,f.B);ok(f.queries.some(x=>x.tag==='ROLLBACK'));}});
function m3Body55(grant,id){return{version:'m3.v1',operation:'interpret',requestId:id,sessionId:'s25-session',taskId:'s25-task',taskRevision:1,permissionRevision:1,grantId:grant.grantId,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),locale:'en',consent:{granted:true,version:'m3.v1',purpose:'m3_intent_understanding'},input:{locale:'en',current_text:'Feel healthier',relevant_context:[],recent_relevant_turns:[],user_correction:null,safety_signal:'CLEAR',asking_stopped:false}}}
const m3Meaning55={intent_type:'CURRENT_TASK',interpreted_meaning:'You want to feel healthier.',confidence:0.8,uncertainty:null,missing_context:[],clarification_needed:false,clarification_question:null,safety_state:'CLEAR',suggested_next_role:'M4',task_kind:'self_walk',context_effect:'NONE',used_context_ids:[],response:'Consider a short walk.'};
async function m3Fixture55(f){const permission=createM3PermissionAuthority(),grant=name=>f.identity(name).then(i=>permission.handle(i,{version:'m3.v1',action:'GRANT',purpose:'m3_intent_understanding',operationId:'s25-grant-'+name,taskSessionId:'s25-session',taskId:'s25-task',taskRevision:1,permissionRevision:1,accepted:true,createdAt:new Date().toISOString()}));let calls=0,blocked=false,start=defer55(),release=defer55();const handler=createM3Handler({enabled:()=>true,available(){},verifyIdentity:req=>f.identity(req.ownerName),permission,acquire(){},release(){},reserve:async()=>{},record:async()=>{},interpret:async()=>{calls++;start.resolve();if(blocked)await release.promise;return{meaning:m3Meaning55,usage:{inputTokens:1,outputTokens:1}}},audit(){},diagnose(){}});const invoke=async(name,body)=>{const req=new EventEmitter();req.body=body;req.ownerName=name;const res=new EventEmitter();Object.assign(res,{statusCode:200,destroyed:false,writableEnded:false,status(n){this.statusCode=n;return this},json(v){this.body=v;this.writableEnded=true;return this}});await handler(req,res);return res};return{permission,handler,grant,invoke,get calls(){return calls},hold(){blocked=true},started:start.promise,unblock:()=>release.resolve(),dispose(){handler.dispose();permission.dispose()}}}
await check55('M3_CACHE_PURGED_SYNCHRONOUSLY_B_CACHE_UNTOUCHED',async()=>{const f=db55(),m=await m3Fixture55(f);try{const ga=await m.grant('A'),gb=await m.grant('B'),a=m3Body55(ga,'s25-cache-A'),b=m3Body55(gb,'s25-cache-B');equal((await m.invoke('A',a)).statusCode,200);equal((await m.invoke('B',b)).statusCode,200);equal(m.handler.inspectRetained().entries,2);equal((await f.call()).status,204);equal(m.handler.inspectRetained().entries,1);equal(m.permission.inspect().grants,1);equal(m.permission.inspect().records,1);equal((await m.invoke('A',a)).statusCode,401);equal((await m.invoke('B',b)).statusCode,200);equal(m.calls,2);}finally{m.dispose()}});
await check55('UNUSED_M3_GRANT_RETIRED_AND_OLD_IDENTITY_DENIED',async()=>{const f=db55(),m=await m3Fixture55(f);try{const old=await f.identity('A');await m.grant('A');await m.grant('A2');await m.grant('B');equal(m.permission.inspect().grants,3);equal((await f.call()).status,204);equal(m.permission.inspect().grants,1);assert.throws(()=>m.permission.handle(old,{version:'m3.v1',action:'GRANT',purpose:'m3_intent_understanding',operationId:'s25-late-grant',taskSessionId:'s25-session',taskId:'s25-task',taskRevision:1,permissionRevision:1,accepted:true,createdAt:new Date().toISOString()}),/INVALID_SESSION/);}finally{m.dispose()}});
await check55('M3_LATE_COMPLETION_CANNOT_RETAIN_OR_PUBLISH',async()=>{const f=db55(),m=await m3Fixture55(f);try{const ga=await m.grant('A');m.hold();const pending=m.invoke('A',m3Body55(ga,'s25-late-response'));await m.started;equal((await f.call()).status,204);equal(m.handler.inspectRetained().entries,0);equal(m.permission.inspect().grants,0);equal(m.permission.inspect().operations,0);const response=await pending;ok(response.statusCode===401||response.statusCode===409);m.unblock();await Promise.resolve();equal(m.handler.inspectRetained().entries,0);ok(!response.body?.interpretedMeaning);}finally{m.unblock();m.dispose()}});
await check55('SESSION_REVOCATION_PURGES_ONLY_ITS_CACHE',async()=>{const f=db55(),m=await m3Fixture55(f);try{const ga=await m.grant('A'),gb=await m.grant('B');await m.invoke('A',m3Body55(ga,'s25-revoke-A'));await m.invoke('B',m3Body55(gb,'s25-revoke-B'));await f.core.revokeSession(f.tokens.A);equal(m.handler.inspectRetained().entries,1);equal(m.permission.inspect().grants,1);equal((await f.core.verifySession(f.tokens.A2)).owner,f.A);}finally{m.dispose()}});
await check55('C2_HELD_OUTPUT_ABORTED_AND_B_GRANT_PRESERVED',async()=>{const f=db55(),ia=await f.identity('A'),ib=await f.identity('B'),facts=new Map();for(const i of [ia,ib])facts.set(i.sessionKey,{owner:i.owner,sessionKey:i.sessionKey,taskSessionId:'s25-c2-session',taskId:'s25-c2-task',taskRevision:1,vision_domain:'meal',purpose:C2_POLICY.meal.purpose,candidateId:'s25-candidate-'+i.owner.subjectId,c1Revision:1,taskKind:C2_POLICY.meal.taskKind,m4Required:true,c1Accepted:true,sourceEpoch:1,validUntil:Date.now()+60000,provenance:'TEST_FIXTURE'});const authority=createVisionTaskConsentAuthority({reader:{read:i=>facts.get(i.sessionKey),subscribe:()=>()=>{}},topology:'SINGLE_AUTHORITY_PROCESS'});let begun=defer55(),release=defer55();try{const command=(i,suffix)=>{const f=facts.get(i.sessionKey);return{taskSessionId:f.taskSessionId,taskId:f.taskId,taskRevision:f.taskRevision,vision_domain:f.vision_domain,purpose:f.purpose,candidateId:f.candidateId,c1Revision:f.c1Revision,action:'GRANT',accepted:true,operationId:'s25-c2-grant-'+suffix,createdAt:Date.now()}};const ga=authority.permission(ia,command(ia,'A'));const gb=authority.permission(ib,command(ib,'B'));const handlers=createC2Handlers({authority,verifyIdentity:()=>f.identity('A'),reserve:async()=>{},decodeJpeg:wireDecode,provider:()=>({mode:'MOCK_ONLY',analyze:async()=>{begun.resolve();await release.promise;return wireGood('meal')}})});const dispatch=createC2WireDispatcher(handlers);const pending=dispatch({path:'/api/ai/c2/vision',method:'POST',headers:{'Content-Type':'application/json'},rawBody:JSON.stringify({grant:ga,mime:'image/jpeg',imageBase64:Buffer.from(wireJpeg).toString('base64')})});await begun.promise;equal((await f.call()).status,204);equal(authority.inspect().grants,1);equal((await pending).status,409);release.resolve();const guard=authority.begin(ib,gb);authority.finish(guard);equal(authority.inspect().grants,1);}finally{release.resolve();authority.dispose()}});
await check55('LOCAL_EIGHT_KEYS_TOMBSTONE_AND_M7_WRITE_RACE',async()=>{const f=db55(),map=new Map(),gate=defer55(),begun=defer55();let hold=false;const backend={getItem:async k=>map.get(k)??null,setItem:async(k,v)=>{if(hold&&k.endsWith('/state')){begun.resolve();await gate.promise}map.set(k,v)},removeItem:async k=>{map.delete(k)},getAllKeys:async()=>[...map.keys()]};const ba=createLocalOwnerBoundary({verify:async()=>({status:'verified',owner:f.A,validUntil:Date.now()+60000})}),bb=createLocalOwnerBoundary({verify:async()=>({status:'verified',owner:f.B,validUntil:Date.now()+60000})});const la=await ba.control.verifySession(),lb=await bb.control.verifySession();ba.control.finishHydration(la);bb.control.finishHydration(lb);const A=createGuardedUserStorage(ba.access,backend,{retireAccess:()=>ba.control.invalidateCurrentSession()}),B=createGuardedUserStorage(bb.access,backend);const permit=A.prepareOwnerRetirement(la);for(const key of USER_DATA_KEYS){await A.writeUserState(la,key,'fixture-A');await B.writeUserState(lb,key,'fixture-B')}const bBefore=JSON.stringify([...map].filter(([k])=>k.includes(f.B.subjectId)));hold=true;const late=A.writeUserState(la,'state','LATE_M7').then(()=>false,()=>true);await begun.promise;equal((await f.call()).status,204);const purge=A.retireOwnerNamespace(permit);assert.throws(()=>ba.access.applyIfCurrent(la,()=>undefined));gate.resolve();equal(await late,true);await purge;const prefix='@100/v2/subject/'+f.A.subjectId+'/profile/'+f.A.profileId+'/';for(const key of USER_DATA_KEYS){equal(map.has(prefix+key),false);await assert.rejects(A.writeUserState(la,key,'LATE_CALLBACK'))}equal(map.get(prefix+'__retired_v1'),'RETIRED_V1');equal(JSON.stringify([...map].filter(([k])=>k.includes(f.B.subjectId))),bBefore);const revived=createLocalOwnerBoundary({verify:async()=>({status:'verified',owner:f.A,validUntil:Date.now()+60000})}),lr=await revived.control.verifySession();revived.control.finishHydration(lr);const alias={...backend},restored=createGuardedUserStorage(revived.access,alias);await assert.rejects(restored.writeUserState(lr,'coaching','RESTORE'),/NAMESPACE_QUARANTINED/);await assert.rejects(restored.clearOwnerNamespace(lr),/NAMESPACE_QUARANTINED/);equal(map.get(prefix+'__retired_v1'),'RETIRED_V1');await assert.rejects(A.retireOwnerNamespace({}),/INVALID_LEASE/);ba.control.invalidateCurrentSession();bb.control.invalidateCurrentSession();revived.control.invalidateCurrentSession();});

await check55('REAL_ROUTE_REGISTRATION_LAZY_AUTH_AND_CORE_BRIDGE',async()=>{const f=db55(),routes=loadServer55(path.resolve(app,'../api-server/src/routes/identity.ts'));let loads=0;const router=routes.createIdentityRouter(async()=>{loads++;return f.core});const run=async(headers,body)=>{const req={headers,body};const res={statusCode:200,status(n){this.statusCode=n;return this},setHeader(){},json(body){this.body=body;return this},end(){this.ended=true;return this}};await router.routes.get('POST /identity/account/delete')(req,res);return res};equal((await run({}, {confirm:true})).statusCode,401);equal(loads,0);equal((await run({authorization:'Bearer '+f.tokens.A,'content-type':'application/json'},{confirm:true,subjectId:f.B.subjectId})).statusCode,400);equal(loads,0);const before=f.Bsnapshot();equal((await run({authorization:'Bearer '+f.tokens.A,'content-type':'application/json'},{confirm:true})).statusCode,204);equal(loads,1);equal(f.Bsnapshot(),before);equal((await run({authorization:'Bearer '+f.tokens.A,'content-type':'application/json'},{confirm:true})).statusCode,401);});
await check55('LOCAL_FAILED_PURGE_STAYS_RETIRED_AND_RETRY_IS_SELECTIVE',async()=>{const f=db55(),map=new Map();let fail=true;const backend={getItem:async k=>map.get(k)??null,setItem:async(k,v)=>{map.set(k,v)},removeItem:async k=>{if(fail)throw Error('TEST_LOCAL_IO_FAILURE');map.delete(k)},getAllKeys:async()=>[...map.keys()]};const b=createLocalOwnerBoundary({verify:async()=>({status:'verified',owner:f.A,validUntil:Date.now()+60000})});const l=await b.control.verifySession();b.control.finishHydration(l);const store=createGuardedUserStorage(b.access,backend,{retireAccess:()=>b.control.invalidateCurrentSession()});await store.writeUserState(l,'state','A');map.set('unrelated-B','untouched');const permit=store.prepareOwnerRetirement(l);await assert.rejects(store.retireOwnerNamespace(permit),/NAMESPACE_QUARANTINED/);await assert.rejects(store.writeUserState(l,'state','LATE'));fail=false;await store.retireOwnerNamespace(permit);equal(map.get('unrelated-B'),'untouched');equal([...map.keys()].filter(k=>k.includes(f.A.subjectId)).length,1);b.control.invalidateCurrentSession();});
await check55('SCHEMA_RETIRED_IS_EXPLICIT_NO_DEPLOYMENT_CLAIM',async()=>{const schema=await readFile(path.resolve(app,'../../lib/db/src/schema/identity.ts'),'utf8');ok(schema.includes("IN ('ACTIVE', 'RETIRED')"));ok(!schema.includes("sql`${table.status} = 'ACTIVE'`"));});


await check55('GOOGLE_ORIGIN_SCOPED_AUTH_AND_UNCONFIGURED_FAIL_CLOSED',async()=>{for(const mode of ['allowed','revoked','unconfigured']){const f=db55({google:mode!=='unconfigured'});const session=f.state.sessions.find(x=>x.token_digest===crypto.createHash('sha256').update(f.tokens.A2).digest('hex'));Object.assign(session,{issuer_provider:'google',issuer_namespace_digest:'1'.repeat(64),issuer_epoch:1,issuer_reconciliation_digest:'2'.repeat(64),legacy_control_binding_id:null});if(mode==='revoked')f.denyOrigin();const before=f.Bsnapshot(),response=await f.call(f.tokens.A2);equal(response.status,mode==='allowed'?204:401);equal(f.Bsnapshot(),before);equal(f.state.owners.find(x=>x.subject_id===f.A.subjectId).status,mode==='allowed'?'RETIRED':'ACTIVE');}});
await check55('CAPTURED_A_RETIREMENT_NEVER_INVALIDATES_CURRENT_B',async()=>{const f=db55(),map=new Map(),backend={getItem:async k=>map.get(k)??null,setItem:async(k,v)=>{map.set(k,v)},removeItem:async k=>{map.delete(k)},getAllKeys:async()=>[...map.keys()]};let owner=f.A;const boundary=createLocalOwnerBoundary({verify:async()=>({status:'verified',owner,validUntil:Date.now()+60000})});const a=await boundary.control.verifySession();boundary.control.finishHydration(a);const store=createGuardedUserStorage(boundary.access,backend,{retireAccess:()=>boundary.control.invalidateCurrentSession()});await store.writeUserState(a,'state','A');const permit=store.prepareOwnerRetirement(a);owner=f.B;const b=await boundary.control.verifySession();boundary.control.finishHydration(b);await store.writeUserState(b,'state','B');await store.retireOwnerNamespace(permit);equal(boundary.access.requireLease(b).owner,f.B);equal(await store.readUserState(b,'state'),'B');boundary.control.invalidateCurrentSession();});

console.log('S25_ERASURE_RESULT '+JSON.stringify({status:'PASS_SCOPED_CODE_OFFLINE',groups:s25Groups,cases:s25Cases,checks,SQL:'In-memory strict transaction port; PostgreSQL deployment/migration NOT_RUN',provider:'MOCK_ONLY',network:0,native:0,limits:'No OS physical-memory overwrite/GC, distributed multi-process revocation, backup/deployed inventory, or full #55 production/privacy-policy acceptance claimed.'}));

// S26: one authenticated facts source drives client projection + C2 task authority.
const {createUnifiedOwnerFactsBridge,getUnifiedOwnerFacts,projectUnifiedOwnerM2}=await import('../domain/m2/factual-snapshot.ts');
const {createAccountErasureOrchestrator}=await import('../components/coach-presence-flow.ts');
const {resolveM2View}=await import('../domain/m2.ts');
const wait26=()=>new Promise(r=>setTimeout(r,0));let groups26=0;const cases26=[];
async function check26(name,fn){await fn();groups26++;cases26.push(name);console.log('PASS S26 '+name);}
function fixture26(){
 const records=new Map(),listeners=new Set();
 const source={provenance:'TEST_FIXTURE',read:owner=>records.get(owner.subjectId),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}};
 const authority=erasureCore.createOwnerTaskFactsAuthority({source});const db=db55({taskAuthority:authority});
 const update=(name,change={})=>{const owner=name==='A'?db.A:db.B,prior=records.get(owner.subjectId),version=(prior?.sourceVersion??0)+1;const data={owner,sourceVersion:version,observedAt:Date.now(),validUntil:Date.now()+45000,complete:{profile:true,goal:true,activeTask:true,returning:true},profile:'new',goal:'none',task:null,returning:null,change:null,...prior,...change};data.sourceVersion=version;data.observedAt=Date.now();data.validUntil=Date.now()+45000;records.set(owner.subjectId,data);for(const fn of [...listeners])fn(owner);return data};
 update('A');update('B');const active=[];
 const client=async(name,extra={})=>{const boundary=createLocalOwnerBoundary({verify:async()=>{const v=await db.core.verifySession(db.tokens[name]);return{status:'verified',owner:v.owner,validUntil:Date.parse(v.validUntil)}}});const lease=await boundary.control.verifySession();boundary.control.finishHydration(lease);const binding={access:boundary.access,lease,authorization:{withBearer:async(signal,use)=>{boundary.access.requireLease(lease);if(signal.aborted)throw Error('ABORT');const result=await use('Bearer '+db.tokens[name]);boundary.access.requireLease(lease);return result;}}};
 const own=binding.access.requireLease(lease).owner;const bridge=createUnifiedOwnerFactsBridge({access:binding.access,lease,load:()=>db.core.readOwnerFacts(db.tokens[name]),allowTestFixture:true,subscribeRemote:fn=>authority.subscribe(owner=>{if(!owner||owner.subjectId===own.subjectId&&owner.profileId===own.profileId)fn()}),...extra});await bridge.refresh();const c={boundary,binding,bridge};active.push(c);return c;};
 const base=name=>({revision:'s26-root',subject:{id:(name==='A'?db.A:db.B).subjectId,loading:'ready',profile:'unknown'},permission:{status:'allowed',revision:'1'},safety:'clear',goal:'unknown',explicitIntent:false,activeTask:{kind:'unknown'},returning:{kind:'unknown'}});
 const project=(c,name='A')=>projectUnifiedOwnerM2(base(name),c.binding.access,c.binding.lease);
 return{db,authority,records,update,client,project,dispose(){for(const c of active){c.bridge.dispose();c.boundary.control.invalidateCurrentSession()}authority.dispose()}};
}
const task26=(status,extra={})=>({id:'s26-task-A',sessionId:'s26-session',revision:1,kind:'self_walk',status,safety:'CLEAR',permission:'allowed',...extra});
await check26('ALL_FIVE_STATES_FROM_SCOPED_HISTORY_NO_EMPTY_INFERENCE',async()=>{const f=fixture26();try{const c=await f.client('A');equal(f.project(c).state,'NEW');const copy={question:'q',placeholder:'p',goals:['a','b','c','d'],resume:'r',returnWithPlan:'back',actions:{},failed:'failed'};equal(resolveM2View(f.project(c).snapshot,copy,[],Date.now()).kind,'goal');
 f.update('A',{profile:'existing',goal:'confirmed',task:task26('STARTED',{startKind:'USER_REPORTED_START'})});await c.bridge.refresh();equal(f.project(c).state,'IN_PROGRESS');equal(f.project(c).snapshot.activeTask.phase,'started');
 f.update('A',{task:task26('STOPPED',{startKind:'USER_REPORTED_START'})});await c.bridge.refresh();equal(f.project(c).state,'UNKNOWN');
 f.update('A',{task:task26('ENDED',{startKind:'USER_REPORTED_START',endKind:'USER_REPORTED_END'})});await c.bridge.refresh();equal(f.project(c).state,'JUST_COMPLETED');equal(f.project(c).snapshot.activeTask.phase,'ended_by_user');
 f.update('A',{task:null,returning:{kind:'USER_CONFIRMED_RETURN',planId:'plan-A',title:'Recorded plan'}});await c.bridge.refresh();equal(f.project(c).state,'RETURNING');equal(resolveM2View(f.project(c).snapshot,copy,[],Date.now()).kind,'returning');
 const next=f.records.get(f.db.A.subjectId).sourceVersion+1;f.update('A',{returning:null,change:{kind:'USER_CONFIRMED_CHANGE',revision:next,observedAt:Date.now()}});await c.bridge.refresh();equal(f.project(c).state,'CHANGED');equal(f.project(c).snapshot.explicitIntent,true);
 f.update('A',{change:null,complete:{profile:true,goal:true,activeTask:false,returning:true}});await c.bridge.refresh();equal(f.project(c).state,'UNKNOWN');c.boundary.control.invalidateCurrentSession();equal(getUnifiedOwnerFacts(c.binding.access,c.binding.lease).state,'UNKNOWN');
 }finally{f.dispose()}});
await check26('UNCONFIGURED_AND_FIXTURE_PROVENANCE_FAIL_CLOSED',async()=>{const f=fixture26();try{const c=await f.client('A',{allowTestFixture:false});equal(c.bridge.read().state,'UNKNOWN');const other=db55();equal((await other.core.readOwnerFacts(other.tokens.A)).state,'UNKNOWN');const a=erasureCore.createOwnerTaskFactsAuthority();equal(a.read(await other.identity('A')).state,'UNKNOWN');equal(a.readVisionFacts(await other.identity('A')),undefined);a.dispose();}finally{f.dispose()}});
await check26('ONE_FACTS_BASIS_AUTHORIZES_MATCHING_C2_DOMAINS_AND_SWITCHES',async()=>{const f=fixture26();const c2=createVisionTaskConsentAuthority({taskAuthority:f.authority,topology:'SINGLE_AUTHORITY_PROCESS'});try{const ca=await f.client('A'),cb=await f.client('B');const identity=await f.db.identity('A'),ib=await f.db.identity('B');
 const setImage=(name,domain,taskId)=>f.update(name,{profile:'existing',goal:'confirmed',task:task26('READY',{id:taskId,kind:C2_POLICY[domain].taskKind,image:{candidateId:'candidate-'+taskId,c1Revision:1,c1Accepted:true,m4Required:true}})});
 const command=(i,id)=>{const facts=f.authority.readVisionFacts(i);return{taskSessionId:facts.taskSessionId,taskId:facts.taskId,taskRevision:facts.taskRevision,vision_domain:facts.vision_domain,purpose:facts.purpose,candidateId:facts.candidateId,c1Revision:facts.c1Revision,action:'GRANT',accepted:true,operationId:id,createdAt:Date.now()}};
 setImage('B','meal','B-task');const gb=c2.permission(ib,command(ib,'s26-grant-B'));
 for(const domain of ['meal','exercise_form','physique_posture']){setImage('A',domain,'A-'+domain);await ca.bridge.refresh();const wire=ca.bridge.read().facts,server=f.authority.readVisionFacts(identity);equal(wire.sourceVersion,server.sourceEpoch);equal(wire.task.id,server.taskId);const g=c2.permission(identity,command(identity,'s26-'+domain));const guard=c2.begin(identity,g);c2.finish(guard);const stale=g;setImage('A',domain,'A-other-'+domain);assert.throws(()=>c2.begin(identity,stale));const bg=c2.begin(ib,gb);c2.finish(bg);}
 const beforeB=cb.bridge.read();await f.db.core.eraseAccount(f.db.tokens.A);equal(ca.bridge.read().state,'UNKNOWN');equal(cb.bridge.read(),beforeB);equal(c2.inspect().grants,1);const bg=c2.begin(ib,gb);c2.finish(bg);equal(f.authority.read(identity).state,'UNKNOWN');
 }finally{c2.dispose();f.dispose()}});
await check26('A_B_A_FACTS_RESPONSE_RACE_AND_VERSION_ROLLBACK',async()=>{const f=fixture26();try{const c=await f.client('A'),old=await f.db.core.readOwnerFacts(f.db.tokens.A);const gate=defer55();const late=createUnifiedOwnerFactsBridge({access:c.binding.access,lease:c.binding.lease,allowTestFixture:true,load:()=>gate.promise});const running=late.refresh();c.boundary.control.invalidateCurrentSession();gate.resolve(old);await running;equal(late.read().state,'UNKNOWN');late.dispose();const cb=await f.client('B');equal(cb.bridge.read().state,'NEW');f.update('A',{profile:'existing',goal:'confirmed',task:task26('STARTED',{startKind:'USER_REPORTED_START'})});const a2=await f.client('A');equal(a2.bridge.read().state,'IN_PROGRESS');const current=await f.db.core.readOwnerFacts(f.db.tokens.A);f.records.set(f.db.A.subjectId,{...f.records.get(f.db.A.subjectId),sourceVersion:1});equal((await f.db.core.readOwnerFacts(f.db.tokens.A)).state,'UNKNOWN');equal(a2.bridge.read().facts.basisRevision,current.basisRevision);await a2.bridge.refresh();equal(a2.bridge.read().state,'UNKNOWN');equal(cb.bridge.read().state,'NEW');}finally{f.dispose()}});
function memory26(options={}){const map=new Map();let fail=options.fail===true;return{map,backend:{getItem:async k=>map.get(k)??null,setItem:async(k,v)=>{if(fail)throw Error('TEST_LOCAL_IO');map.set(k,v)},removeItem:async k=>{map.delete(k)},getAllKeys:async()=>[...map.keys()]},fail:v=>fail=v}}
await check26('CLIENT_ERASURE_SERVER_THEN_LOCAL_AND_B_UNAFFECTED',async()=>{const f=fixture26(),mem=memory26();try{const a=await f.client('A'),b=await f.client('B');let current=a.binding,serverCalls=0;const ownerB=b.bridge.read();const orchestrator=createAccountErasureOrchestrator({current:()=>current,backend:mem.backend,invalidate:owner=>{if(owner.subjectId===f.db.A.subjectId)a.boundary.control.invalidateCurrentSession()},send:async Authorization=>{serverCalls++;return f.db.dispatch({path:'/api/identity/account/delete',method:'POST',headers:{Authorization,'Content-Type':'application/json'},rawBody:JSON.stringify({confirm:true})})}});const before=f.db.Bsnapshot();equal(await orchestrator.eraseAccount(),true);equal(serverCalls,1);equal(orchestrator.getSnapshot().phase,'COMPLETE');equal(a.bridge.read().state,'UNKNOWN');equal(b.bridge.read(),ownerB);equal(f.db.Bsnapshot(),before);const prefix='@100/v2/subject/'+f.db.A.subjectId+'/profile/'+f.db.A.profileId+'/';equal(mem.map.get(prefix+'__retired_v1'),'RETIRED_V1');equal(b.binding.access.requireLease(b.binding.lease).owner,f.db.B);for(const key of USER_DATA_KEYS)equal(mem.map.has(prefix+key),false);current=b.binding;equal(await orchestrator.eraseAccount(),true);equal(serverCalls,2);equal(f.db.state.owners.find(x=>x.subject_id===f.db.B.subjectId).status,'RETIRED');equal(mem.map.get('@100/v2/subject/'+f.db.B.subjectId+'/profile/'+f.db.B.profileId+'/__retired_v1'),'RETIRED_V1');}finally{f.dispose()}});
await check26('SERVER_FAILURE_QUARANTINES_WITHOUT_TOMBSTONE_OR_B_ERASURE',async()=>{const f=fixture26(),mem=memory26();try{const a=await f.client('A');const orchestrator=createAccountErasureOrchestrator({current:()=>a.binding,backend:mem.backend,invalidate:()=>a.boundary.control.invalidateCurrentSession(),send:async()=>({status:503})});equal(await orchestrator.eraseAccount(),false);equal(orchestrator.getSnapshot().serverConfirmed,false);equal(orchestrator.getSnapshot().phase,'QUARANTINED');equal(mem.map.size,0);equal(f.db.state.owners.find(x=>x.subject_id===f.db.A.subjectId).status,'ACTIVE');equal((await f.db.core.verifySession(f.db.tokens.B)).owner,f.db.B);equal(a.bridge.read().state,'UNKNOWN');}finally{f.dispose()}});
await check26('CONFIRMED_SERVER_LOCAL_IO_RETRY_DOES_NOT_RESEND',async()=>{const f=fixture26(),mem=memory26({fail:true});try{const a=await f.client('A');let calls=0;const o=createAccountErasureOrchestrator({current:()=>a.binding,backend:mem.backend,invalidate:()=>a.boundary.control.invalidateCurrentSession(),send:async Authorization=>{calls++;return f.db.dispatch({path:'/api/identity/account/delete',method:'POST',headers:{Authorization,'Content-Type':'application/json'},rawBody:'{"confirm":true}'})}});equal(await o.eraseAccount(),false);equal(o.getSnapshot().serverConfirmed,true);equal(o.getSnapshot().phase,'QUARANTINED');mem.fail(false);equal(await o.eraseAccount(),true);equal(calls,1);equal(o.getSnapshot().phase,'COMPLETE');}finally{f.dispose()}});
await check26('ERASE_A_COMPLETION_AFTER_SWITCH_TO_B_IS_OWNER_SCOPED',async()=>{const f=fixture26(),mem=memory26();try{const a=await f.client('A'),b=await f.client('B'),gate=defer55(),started=defer55();let current=a.binding;const o=createAccountErasureOrchestrator({current:()=>current,backend:mem.backend,invalidate:owner=>{if(current===a.binding&&owner.subjectId===f.db.A.subjectId)a.boundary.control.invalidateCurrentSession()},send:async Authorization=>{const response=await f.db.dispatch({path:'/api/identity/account/delete',method:'POST',headers:{Authorization,'Content-Type':'application/json'},rawBody:'{"confirm":true}'});started.resolve();await gate.promise;return response}});const pending=o.eraseAccount();await started.promise;current=b.binding;gate.resolve();equal(await pending,true);equal(b.binding.access.requireLease(b.binding.lease).owner,f.db.B);equal(b.bridge.read().state,'NEW');equal(o.blocks(b.binding),false);}finally{f.dispose()}});
await check26('REAL_GET_ROUTE_CALLS_CANONICAL_CORE_AND_DENIES_MISSING_TOKEN',async()=>{const f=fixture26();try{const routes=loadServer55(path.resolve(app,'../api-server/src/routes/identity.ts')),router=routes.createIdentityRouter(async()=>f.db.core);const request=async authorization=>{const res={statusCode:200,status(n){this.statusCode=n;return this},setHeader(){},json(v){this.body=v;return this}};await router.routes.get('GET /identity/m2/facts')({headers:{authorization}},res);return res};equal((await request(undefined)).statusCode,401);const res=await request('Bearer '+f.db.tokens.A);equal(res.statusCode,200);equal(res.body.state,'NEW');equal(res.body.owner,f.db.A);}finally{f.dispose()}});

await check26('ACTUAL_OWNER_PROVIDER_CONTROL_COMPOSES_ERASURE_AND_FACTS',async()=>{const f=fixture26(),mem=memory26();let providerCleanup=[];try{const realCoordinator=await import('../domain/identity/owner-session-coordinator.ts');const coordinator=realCoordinator.createOwnerSessionCoordinator({session:{ownerVerifier:{verify:async()=>{const v=await f.db.core.verifySession(f.db.tokens.A);return{status:'verified',owner:v.owner,validUntil:Date.parse(v.validUntil)}}},authorization:{withBearer:async(signal,use)=>{if(signal.aborted)throw Error('ABORT');return use('Bearer '+f.db.tokens.A)}},logout:async()=>{}}});await coordinator.refresh();const stableCoordinator={...coordinator,refresh:async()=>true};
 const factsModule=await import('../domain/m2/factual-snapshot.ts'),ctxPath=path.resolve(app,'context/OwnerSessionContext.tsx'),ctxText=await readFile(ctxPath,'utf8'),ctxModule={exports:{}};let cursor=0;const slots=[],effects=[];
 const react={createContext:()=>({Provider:'OwnerContextProvider'}),createElement:(type,props,...children)=>({type,props:{...props,children}}),useState(init){const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]},useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i]},useMemo:fn=>fn(),useCallback:fn=>fn,useContext:()=>undefined,useSyncExternalStore:(_s,get)=>get(),useEffect:fn=>{effects.push(fn)}};
 const mocks={'@/domain/m7/store':m7Archive28,'react':react,'react-native':{AppState:{addEventListener:()=>({remove(){}})},Platform:{OS:'unsupported'}},'@/components/coach-presence-flow':{createAccountErasureOrchestrator},'@/domain/m2/factual-snapshot':factsModule,'@/lib/identity/local-verification':{resolveLocalVerificationConfig:()=>undefined,createLocalVerificationClient:()=>{throw Error('NOT_LOCAL_SESSION_TEST')}},'@/lib/identity/web-session':{resolveWebIdentityConfig:()=>undefined},'@/lib/identity/expo-apple-session':{},'@/domain/identity/owner-session-coordinator':{...realCoordinator,createOwnerSessionCoordinator:()=>stableCoordinator}};
 new vm.Script('(function(require,module,exports){'+transpile(ctxPath,ctxText)+'\n})',{filename:ctxPath}).runInNewContext({process:{env:{}},console,setTimeout,clearTimeout,AbortController})(name=>{if(name==='@/domain/wearable/contract')return wearableS30;if(!(name in mocks))throw Error('UNADMITTED_PROVIDER_VM_IMPORT '+name);return mocks[name]},ctxModule,ctxModule.exports);
 const composition={backend:mem.backend,allowTestFacts:true,factsLoad:()=>f.db.core.readOwnerFacts(f.db.tokens.A),erasureSend:Authorization=>f.db.dispatch({path:'/api/identity/account/delete',method:'POST',headers:{Authorization,'Content-Type':'application/json'},rawBody:'{"confirm":true}'})};
 const render=()=>{cursor=0;effects.length=0;return ctxModule.exports.OwnerSessionProvider({children:null,composition}).props.value};
 let value=render();for(const effect of effects){const off=effect();if(typeof off==='function')providerCleanup.push(off)}await wait26();await wait26();value=render();equal(typeof value.control.eraseAccount,'function');equal(getUnifiedOwnerFacts(value.binding.access,value.binding.lease).state,'NEW');const old=value.binding;equal(await value.control.eraseAccount(),true);value=render();equal(value.binding,undefined);equal(value.control.state,'locked');equal(value.control.erasurePhase,'COMPLETE');equal(getUnifiedOwnerFacts(old.access,old.lease).state,'UNKNOWN');equal((await f.db.core.verifySession(f.db.tokens.B)).owner,f.db.B);coordinator.dispose();
 }finally{for(const off of providerCleanup)off();f.dispose()}});
await check26('OWNER_INVALIDATION_SYNCHRONOUSLY_RETIRES_C2_FLOW_AND_LATE_RESULT',async()=>{const f=fixture26();try{const a=await f.client('A'),gate=defer55(),begun=defer55();let model='CONSENT_REQUIRED';const runtime={allowAndPrepare:async()=>{model='READY_NOT_SENT';return true},analyze:async()=>{begun.resolve();await gate.promise;model='PROPOSAL';return true},view:()=>({state:model}),revoke:()=>{model='CONSENT_REQUIRED'},retire:()=>{model='CONSENT_REQUIRED'},settleCleanup:async()=>true,settleRevocations:async()=>true};const source={key:'s26-source',domain:'meal',access:a.binding.access,lease:a.binding.lease,authorization:a.binding.authorization,sessionId:'s26session',taskId:'s26task',revision:1,taskKind:'meal_image_assessment'};const flow=createCoachPresenceFlow({current:()=>source,picker:{requestCameraPermission:async()=>'granted',takePhoto:async()=>({canceled:false,asset:{uri:'file:///S26_SYNTHETIC.jpg',width:2,height:2}}),choosePhoto:async()=>({canceled:true})},runtime:async()=>runtime});try{flow.bind();await flow.take(flow.getSnapshot().token);flow.use(flow.getSnapshot().token);flow.allowC1(flow.getSnapshot().token);await flow.allowC2(flow.getSnapshot().token);const old=flow.getSnapshot().token,pending=flow.analyze(old);await begun.promise;a.boundary.control.invalidateCurrentSession();equal(flow.getSnapshot().hasPhoto,false);equal(flow.getSnapshot().selected,false);gate.resolve();equal(await pending,false);equal(flow.chooseProposal(old),false);}finally{gate.resolve();flow.dispose()}}finally{f.dispose()}});
await check26('CANONICAL_TASK_CONSENT_SAFETY_AND_FOREIGN_OWNER_FALSIFIERS',async()=>{const f=fixture26();const c2=createVisionTaskConsentAuthority({taskAuthority:f.authority,topology:'SINGLE_AUTHORITY_PROCESS'});try{const i=await f.db.identity('A');const task=task26('READY',{kind:C2_POLICY.meal.taskKind,image:{candidateId:'s26-image',c1Revision:1,c1Accepted:true,m4Required:true}});f.update('A',{task});ok(f.authority.readVisionFacts(i));f.update('A',{task:{...task,permission:'denied'}});equal(f.authority.readVisionFacts(i),undefined);f.update('A',{task:{...task,safety:'HOLD'}});equal(f.authority.readVisionFacts(i),undefined);f.update('A',{task:{...task,image:{...task.image,c1Accepted:false}}});equal(f.authority.readVisionFacts(i),undefined);equal(f.authority.read({...i,owner:f.db.B}).state,'UNKNOWN');const foreign={...i,owner:{...f.db.A,profileId:'foreign-profile'}};equal(f.authority.read(foreign).state,'UNKNOWN');}finally{c2.dispose();f.dispose()}});

console.log('S26_RESULT '+JSON.stringify({groups:groups26,cases:cases26,checks,native:0,provider:0,network:0,provenance:'TEST_FIXTURE for history/SQL controlled composition; default production remains UNCONFIGURED UNKNOWN/403',limits:'No persistence/#181 backend source admitted, no new CHANGED UI copy, no distributed push/deployed account deletion claimed.'}));

// S27: actual PrivacyScreen + OwnerSessionProvider/UI components under an explicit offline hook renderer.
// This is CODE_OFFLINE tree/action composition, NOT ReactDOM/native mounting or store approval.
const s27I18n=await import('../i18n.ts'),s27PrivacyCopy=await import('../i18n-privacy.ts');
const s27Coordinator=await import('../domain/identity/owner-session-coordinator.ts');
let groups27=0;const cases27=[];async function check27(name,fn){await fn();groups27++;cases27.push({name,status:'PASS_CODE_OFFLINE_SOURCE_TREE_ACTIONS'});console.log('PASS S27 '+name);}
function renderer27(){
 const instances=new Map(),contexts=new Set();let current,cursor=0,dirty=true,tree,rootNode;const queued=[];
 const same=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
 const slot=()=>{if(!current)throw Error('HOOK_OUTSIDE_COMPONENT');return[current.slots,cursor++]};
 const React={Fragment:Symbol('Fragment'),createElement:(type,props,...children)=>({type,props:{...props,children:children.length?children:props?.children}}),
 createContext(value){const context={value};context.Provider={context};contexts.add(context);return context},useContext:c=>c.value,
 useState(init){const[s,i]=slot();if(!(i in s))s[i]=typeof init==='function'?init():init;return[s[i],v=>{const next=typeof v==='function'?v(s[i]):v;if(!Object.is(next,s[i])){s[i]=next;dirty=true}}]},
 useRef(value){const[s,i]=slot();if(!(i in s))s[i]={current:value};return s[i]},
 useMemo(fn,deps){const[s,i]=slot();if(!s[i]||!same(s[i].deps,deps))s[i]={deps,value:fn()};return s[i].value},
 useCallback(fn,deps){return this.useMemo(()=>fn,deps)},
 useEffect(fn,deps){const[s,i]=slot();if(!s[i]||!same(s[i].deps,deps)){const old=s[i];s[i]={deps,cleanup:old?.cleanup};queued.push(()=>{s[i].cleanup?.();s[i].cleanup=fn()})}},
 useSyncExternalStore(subscribe,get){const[s,i]=slot();if(!s[i]||s[i].subscribe!==subscribe){s[i]?.cleanup?.();s[i]={subscribe,cleanup:subscribe(()=>{dirty=true})}}return get()}};
 // Transpiled imports call the hook as a free function.
 React.useCallback=(fn,deps)=>React.useMemo(()=>fn,deps);
 function expand(node,key){if(node==null||typeof node==='boolean')return null;if(Array.isArray(node))return node.map((x,i)=>expand(x,key+'.'+i));if(typeof node!=='object')return node;
 if(node.type===React.Fragment)return expand(node.props.children,key+'.fragment');
 if(node.type?.context){node.type.context.value=node.props.value;return expand(node.props.children,key+'.provider')}
 if(typeof node.type==='function'){const previous=current,previousCursor=cursor;current=instances.get(key);if(!current){current={slots:[]};instances.set(key,current)}cursor=0;let out;try{out=node.type(node.props)}finally{current=previous;cursor=previousCursor}return expand(out,key+'.render')}
 return{type:node.type,props:{...node.props,children:expand(node.props.children,key+'.children')}};}
 function render(node=rootNode){rootNode=node;let rounds=0;do{dirty=false;tree=expand(rootNode,'root');while(queued.length)queued.shift()();if(++rounds>24)throw Error('RENDER_NOT_STABLE')}while(dirty);return tree}
 const nodes=(node=tree)=>node==null?[]:Array.isArray(node)?node.flatMap(x=>nodes(x)):typeof node==='object'?[node,...nodes(node.props?.children)]:[];
 const text=node=>node==null?'':Array.isArray(node)?node.map(text).filter(Boolean).join(' '):typeof node==='object'?text(node.props?.children):String(node);
 return{React,render,nodes,text,get tree(){return tree},byId:id=>nodes().find(n=>n.props?.testID===id),async flush(){for(let i=0;i<4;i++){await wait26();render()}},unmount(){for(const instance of instances.values())for(const s of instance.slots)if(s&&typeof s.cleanup==='function')s.cleanup();instances.clear();queued.length=0;tree=undefined}};
}
async function privacyFixture27(options={}){
 const f=fixture26(),mem=options.memory??memory26(),rendered=renderer27();let currentName=options.guest?undefined:'A',locale=options.locale??'vi',posts=[],serverFail=options.serverFail===true,held,releaseHeld,postStartedResolve;
 const postStarted=new Promise(r=>postStartedResolve=r);
 const coordinator=s27Coordinator.createOwnerSessionCoordinator({session:{ownerVerifier:{verify:async()=>{if(!currentName)return{status:'missing'};const v=await f.db.core.verifySession(f.db.tokens[currentName]);return{status:'verified',owner:v.owner,validUntil:Date.parse(v.validUntil)}}},authorization:{withBearer:async(signal,use)=>{if(signal.aborted)throw Error('ABORT');return use('Bearer '+f.db.tokens[currentName])}},logout:async()=>{currentName=undefined}}});
 if(currentName)await coordinator.refresh();
 const native={TextInput:'TextInput',AppState:{addEventListener:()=>({remove(){}})},Platform:{OS:'unsupported',select:x=>x.web??x.default},StyleSheet:{create:x=>x},Alert:{alert(){throw Error('UNADMITTED_ALERT_IN_ACCOUNT_FLOW')}},Image:'Image',Pressable:'Pressable',Text:'Text',View:'View'};
 const colors=new Proxy({},{get:()=> '#112233'}),stubs={'@/domain/m7/store':m7Archive28,'@/i18n-m7-record':m7Copy28,
 react:rendered.React,'react-native':native,'expo-router':{router:{push(){throw Error('ACCOUNT_FLOW_MUST_NOT_NAVIGATE')}}},
 '@/hooks/useColors':{useColors:()=>colors},'@expo/vector-icons':{Feather:'Feather'},
 '@/components/KeyboardAwareScrollViewCompat':{KeyboardAwareScrollViewCompat:'ScrollView'},'@/components/Animated100Signature':{Animated100Signature:'Logo'},
 '@/context/LocalizationContext':{useLocale:()=>({locale,localeCode:locale,t:(key,params)=>s27I18n.translate(locale,key,params),setLocale:v=>{locale=v}})},
 '@/context/DevelopmentContext':{useDevelopment:()=>({state:{},resetLocalState:async()=>true,persistenceStatus:'ready'})},
 '@/context/OpeningContext':{useOpening:()=>({projectionRevision:0,forgetMemory:async()=>true,unreadableDataPreserved:false})},
 '@/context/CoachingContext':{useCoaching:()=>({state:{status:'idle'},projectionRevision:0,unreadableDataPreserved:false,persistenceStatus:'ready',deleteData:async()=>true})},
 '@/context/InteractionContext':{useInteraction:()=>({unreadableDataPreserved:false,deleteData:async()=>true})},
 '@/context/WelcomeContext':{useWelcome:()=>({showWelcome(){}})},
 '@/components/coach-presence-flow':{createAccountErasureOrchestrator},'@/domain/m2/factual-snapshot':await import('../domain/m2/factual-snapshot.ts'),
 '@/lib/identity/local-verification':{resolveLocalVerificationConfig:()=>undefined,createLocalVerificationClient(){throw Error('NOT_TECHNICAL_SESSION')}},
 '@/lib/identity/web-session':{resolveWebIdentityConfig:()=>undefined},'@/lib/identity/expo-apple-session':{},
 '@/domain/identity/owner-session-coordinator':{...s27Coordinator,createOwnerSessionCoordinator:()=>options.technical?Object.freeze({...coordinator,localVerification:{isCurrent:()=>true}}):coordinator},
 '@/i18n':s27I18n,'@/i18n-identity':await import('../i18n-identity.ts'),
 '@/domain/privacy-local-delete':await import('../domain/privacy-local-delete.ts'),
 };
 const cache=new Map();function sourceModule(rel){if(cache.has(rel))return cache.get(rel).exports;const file=path.join(app,rel),m={exports:{}};cache.set(rel,m);const text=options.mutate&&rel==='app/(tabs)/privacy.tsx'?options.mutate(require('node:fs').readFileSync(file,'utf8')):require('node:fs').readFileSync(file,'utf8');new vm.Script('(function(require,module,exports){'+transpile(file,text)+'\n})',{filename:file}).runInNewContext({process:{env:{}},__DEV__:false,console,setTimeout,clearTimeout,AbortController,URL})(name=>{if(name==='@/domain/wearable/contract')return wearableS30;if(name==='../assets/images/icon.png')return{TEST_FIXTURE_ASSET:true};if(name==='@/components/UI')return sourceModule('components/UI.tsx');if(name==='@/components/M7RecordCard')return sourceModule('components/M7RecordCard.tsx');if(name==='@/context/OwnerSessionContext')return sourceModule('context/OwnerSessionContext.tsx');if(!(name in stubs))throw Error('S27_UNADMITTED_MODULE '+name);return stubs[name]},m,m.exports);return m.exports;}
 const owner=sourceModule('context/OwnerSessionContext.tsx'),Privacy=sourceModule('app/(tabs)/privacy.tsx').default;
 const composition={backend:mem.backend,allowTestFacts:true,factsLoad:binding=>{const scope=binding.access.requireLease(binding.lease);return f.db.core.readOwnerFacts(scope.owner.subjectId===f.db.A.subjectId?f.db.tokens.A:f.db.tokens.B)},
 erasureSend:async Authorization=>{posts.push({path:'/api/identity/account/delete',method:'POST'});postStartedResolve();if(serverFail)return{status:503};const response=await f.db.dispatch({path:'/api/identity/account/delete',method:'POST',headers:{Authorization,'Content-Type':'application/json'},rawBody:'{"confirm":true}'});posts.at(-1).status=response.status;if(held)await held;return response}};
 const node=rendered.React.createElement(owner.OwnerSessionProvider,{composition},rendered.React.createElement(Privacy,{}));rendered.render(node);await rendered.flush();
 const press=async id=>{const n=rendered.byId(id);assert.ok(n,'missing real source node '+id);if(n.props.disabled)throw Error('DISABLED_ACTION '+id);n.props.onPress();await rendered.flush()};
 const settle=async phase=>{for(let i=0;i<20;i++){await rendered.flush();const status=rendered.text(rendered.byId('privacy-account-delete-status'));if(status===s27I18n.translate(locale,phase))return status;}throw Error('S27_STATUS_NOT_REACHED '+phase+' '+rendered.text(rendered.byId('privacy-account-delete-status')))};
 return{f,mem,rendered,posts,press,settle,coordinator,copy:key=>s27I18n.translate(locale,key),setServerFailure:v=>serverFail=v,
 async switchOwner(name){currentName=name;await coordinator.refresh();await rendered.flush()},hold(){held=new Promise(r=>releaseHeld=r)},postStarted,release:()=>releaseHeld(),
 dispose(){rendered.unmount();coordinator.dispose();f.dispose()}};
}
const ownerPrefix27=owner=>'@100/v2/subject/'+owner.subjectId+'/profile/'+owner.profileId+'/';
await check27('MOUNTED_PRIVACY_UI_ERASURE_AND_CONFIRMATION_FLOW',async()=>{const x=await privacyFixture27();try{const a=ownerPrefix27(x.f.db.A),b=ownerPrefix27(x.f.db.B);for(const prefix of [a,b])for(const key of USER_DATA_KEYS)await x.mem.backend.setItem(prefix+key,'S27_SYNTHETIC_'+key);const beforeB=x.f.db.Bsnapshot();const trigger=x.rendered.byId('privacy-account-delete-trigger');equal(trigger.props.accessibilityRole,'button');equal(trigger.props.disabled,false);await x.press('privacy-account-delete-trigger');equal(x.posts.length,0);ok(x.rendered.byId('privacy-account-delete-confirm'));equal(x.rendered.byId('privacy-account-delete-confirmation').props.accessibilityRole,'alert');await x.press('privacy-account-delete-cancel');equal(x.posts.length,0);equal(x.rendered.byId('privacy-account-delete-confirm'),undefined);await x.press('privacy-account-delete-trigger');const confirm=x.rendered.byId('privacy-account-delete-confirm');confirm.props.onPress();confirm.props.onPress();await x.settle('privacyAccountDeleteComplete');equal(x.posts.length,1);equal(x.posts[0].status,204);equal(x.mem.map.get(a+'__retired_v1'),'RETIRED_V1');for(const key of USER_DATA_KEYS){equal(x.mem.map.has(a+key),false);equal(x.mem.map.get(b+key),'S27_SYNTHETIC_'+key)}equal(x.f.db.Bsnapshot(),beforeB);equal(x.coordinator.getSnapshot().binding,undefined);equal(x.rendered.byId('privacy-account-delete-trigger').props.disabled,true);equal(x.rendered.byId('privacy-account-delete-status').props.accessibilityLiveRegion,'polite');}finally{x.dispose()}});
await check27('MOUNTED_PRIVACY_UI_SERVER_FAILURE_QUARANTINE_AND_RETRY',async()=>{const x=await privacyFixture27({serverFail:true});try{const a=ownerPrefix27(x.f.db.A),beforeB=x.f.db.Bsnapshot();await x.press('privacy-account-delete-trigger');await x.press('privacy-account-delete-confirm');await x.settle('privacyAccountDeleteFailed');equal(x.posts.length,1);equal(x.mem.map.has(a+'__retired_v1'),false);equal(x.f.db.state.owners.find(o=>o.subject_id===x.f.db.A.subjectId).status,'ACTIVE');equal(x.f.db.Bsnapshot(),beforeB);equal(x.rendered.byId('privacy-account-delete-trigger').props.disabled,false);x.setServerFailure(false);await x.press('privacy-account-delete-trigger');await x.press('privacy-account-delete-confirm');await x.settle('privacyAccountDeleteComplete');equal(x.posts.length,2);equal(x.posts[1].status,204);equal(x.mem.map.get(a+'__retired_v1'),'RETIRED_V1');equal(x.f.db.Bsnapshot(),beforeB);}finally{x.dispose()}});
await check27('GUEST_AND_STALE_CONFIRMATION_CANNOT_DELETE_A_NEW_OWNER',async()=>{const guest=await privacyFixture27({guest:true});try{equal(guest.rendered.byId('privacy-account-delete-trigger').props.disabled,true);equal(guest.posts.length,0);equal(guest.rendered.text(guest.rendered.byId('privacy-account-delete-status')),guest.copy('privacyAccountDeleteGuest'));}finally{guest.dispose()}const technical=await privacyFixture27({technical:true});try{equal(technical.rendered.byId('privacy-account-delete-trigger').props.disabled,true);technical.rendered.byId('privacy-account-delete-trigger').props.onPress();await technical.rendered.flush();equal(technical.posts.length,0);}finally{technical.dispose()}const x=await privacyFixture27();try{await x.press('privacy-account-delete-trigger');const stale=x.rendered.byId('privacy-account-delete-confirm');await x.switchOwner('B');equal(x.rendered.byId('privacy-account-delete-confirm'),undefined);stale.props.onPress();await x.rendered.flush();equal(x.posts.length,0);equal(x.f.db.state.owners.filter(o=>o.status==='ACTIVE').length,2);}finally{x.dispose()}});
await check27('A_COMPLETION_CANNOT_PUBLISH_SUCCESS_ON_OWNER_B_UI',async()=>{const x=await privacyFixture27();try{x.hold();await x.press('privacy-account-delete-trigger');await x.press('privacy-account-delete-confirm');await x.postStarted;await x.switchOwner('B');const before=x.f.db.Bsnapshot();x.release();await x.rendered.flush();await x.rendered.flush();equal(x.f.db.Bsnapshot(),before);equal(x.rendered.byId('privacy-account-delete-trigger').props.disabled,false);ok(!x.rendered.text(x.rendered.byId('privacy-account-delete-status')).includes(x.copy('privacyAccountDeleteComplete')));equal(x.f.db.state.owners.find(o=>o.subject_id===x.f.db.A.subjectId).status,'RETIRED');}finally{x.dispose()}});
await check27('LOCAL_IO_RETRY_AFTER_CONFIRMED_DELETE_DOES_NOT_RESEND',async()=>{const x=await privacyFixture27();try{x.mem.fail(true);await x.press('privacy-account-delete-trigger');await x.press('privacy-account-delete-confirm');await x.settle('privacyAccountDeleteFailed');equal(x.posts.length,1);equal(x.posts[0].status,204);x.mem.fail(false);await x.press('privacy-account-delete-trigger');await x.press('privacy-account-delete-confirm');await x.settle('privacyAccountDeleteComplete');equal(x.posts.length,1);}finally{x.dispose()}});
await check27('EIGHT_LOCALE_PRIVACY_DISCLOSURE_AND_DELETE_UI_PARITY',async()=>{for(const locale of ['vi','en','zh-Hans','es','hi','ja','ko','ru']){const x=await privacyFixture27({locale});try{const all=x.rendered.text(x.rendered.tree);for(const key of s27PrivacyCopy.PRIVACY_TRANSLATION_KEYS.filter(k=>/privacyAccount|privacyWellness|privacyAiEphemeral/.test(k))){const value=s27I18n.translate(locale,key);ok(value&&value!==key,locale+key+'raw');if(!['vi','en'].includes(locale)){ok(value!==s27I18n.translate('en',key),locale+key+'en');ok(value!==s27I18n.translate('vi',key),locale+key+'vi')}}for(const key of ['privacyWellnessTitle','privacyWellnessBody','privacyAiEphemeralTitle','privacyAiEphemeralBody','privacyAccountDeleteTitle','privacyAccountDeleteBody'])ok(all.includes(x.copy(key)),locale+key+'visible');await x.press('privacy-account-delete-trigger');const confirmation=x.rendered.text(x.rendered.byId('privacy-account-delete-confirmation'));ok(confirmation.includes(x.copy('privacyAccountDeleteConfirmBody')));equal(x.rendered.text(x.rendered.byId('privacy-account-delete-confirm')),x.copy('privacyAccountDeleteConfirm'));equal(x.rendered.text(x.rendered.byId('privacy-account-delete-cancel')),x.copy('privacyAccountDeleteCancel'));equal(x.posts.length,0);for(const key of s27PrivacyCopy.PRIVACY_TRANSLATION_KEYS)ok(!all.split(/\s+/).includes(key),'no rendered raw key');}finally{x.dispose()}}});

await check27('NEGATIVE_MUTANTS_CANNOT_BYPASS_CONFIRMATION_OR_OWNER_FENCE',async()=>{
 const patches=[{name:'BYPASS_CONFIRMATION',from:"if(canRequestAccount){setAccountError(false);setAccountConfirmation(ownerSession.erasureScope);}",to:"if(canRequestAccount){void ownerSession.eraseAccount();}",run:async x=>{await x.press('privacy-account-delete-trigger');equal(x.posts.length,0,'original confirmation oracle')}},
 {name:'STALE_OWNER_CONFIRMATION',from:"if(scope==='RETRY'?current.erasurePhase!=='QUARANTINED':current.state!=='ready'||current.erasureScope!==scope)return;",to:"if(false)return;",run:async x=>{await x.press('privacy-account-delete-trigger');const old=x.rendered.byId('privacy-account-delete-confirm');await x.switchOwner('B');old.props.onPress();await x.rendered.flush();equal(x.posts.length,0,'original wrong-owner oracle')}}];
 for(const patch of patches){const x=await privacyFixture27({mutate:text=>{equal(text.split(patch.from).length,2,'exact mutant anchor');return text.replace(patch.from,patch.to)}});try{let rejected=false;try{await patch.run(x)}catch(error){if(error?.code==='ERR_ASSERTION')rejected=true;else throw error;}equal(rejected,true,'mutant must fail '+patch.name);}finally{x.dispose()}}
});


await check27('QUARANTINED_A_DOES_NOT_BLOCK_EXPLICIT_NEW_B_ACCOUNT_ACTION',async()=>{const x=await privacyFixture27({serverFail:true});try{await x.press('privacy-account-delete-trigger');await x.press('privacy-account-delete-confirm');await x.settle('privacyAccountDeleteFailed');equal(x.f.db.state.owners.find(o=>o.subject_id===x.f.db.A.subjectId).status,'ACTIVE');await x.switchOwner('B');equal(x.rendered.byId('privacy-account-delete-trigger').props.disabled,false);equal(x.rendered.text(x.rendered.byId('privacy-account-delete-status')),'');x.setServerFailure(false);await x.press('privacy-account-delete-trigger');await x.press('privacy-account-delete-confirm');await x.settle('privacyAccountDeleteComplete');equal(x.f.db.state.owners.find(o=>o.subject_id===x.f.db.B.subjectId).status,'RETIRED');equal(x.f.db.state.owners.find(o=>o.subject_id===x.f.db.A.subjectId).status,'ACTIVE');}finally{x.dispose()}});

// M7 reload explicitly PARKED by Founder after real-source inspection. No fake serialization test.
const m7Source27=await readFile(path.join(unit,'../P100-CEO1-S27-FINAL-STORE-SHIELD-MOUNTED-PRIVACY-ERASURE-UI-AND-CONNECTED-M7-RELOAD-20261108-01/candidate/source/artifacts/human-development-intelligence/domain/m7/store.ts'),'utf8'),taskSource27=await readFile(path.join(app,'domain/session-task/store.ts'),'utf8');
ok(taskSource27.includes('does not persist task, permission, request, or interpretation.'));
ok(!/writeUserState|readUserState|AsyncStorage|restore\(/.test(m7Source27),'No admitted M7 persistence producer exists');
console.log('S27_RESULT '+JSON.stringify({status:'PASS_CODE_OFFLINE_UI_AND_DISCLOSURE_M7_RELOAD_PARKED',groups:groups27,cases:cases27,checks,locales:8,translatedCells:128,M7_reload:'PARK_FOUNDER_EXPLICIT_AMENDMENT_NO_PERSISTENCE_SOURCE',sourceTree:'Actual PrivacyScreen/OwnerSessionProvider/UI.tsx with deterministic hook renderer and injected context/native/SQL ports; NOT ReactDOM/native/browser runtime',network:0,native:0,provider:0,StoreReadiness:'NOT_ACCEPTED; external deletionURL/provider tokenrevocation/privacy policy/deployed inventory/device/human translation remain separate gates'}));

// Exact candidate-local alias for actual product modules, no package/global fallback.
registerHooks({resolve(spec,context,next){if(spec.startsWith('@/')&&context.parentURL?.startsWith(new URL('../',import.meta.url).href))return next(new URL('../'+spec.slice(2)+(path.extname(spec)?'':'.ts'),import.meta.url).href,context);return next(spec,context);}});
// S28: actual M5/W01/M7 producer + owner-guarded completed-report storage, never a revived task.
const {FakeClock:Clock28,fakeAuthority:authority28,OWNER_A:ownerA28,OWNER_B:ownerB28}=await import('./fixtures/local-owner.mjs');
const {createM3HostLifetime:hostFactory28}=await import('../components/m3-host-lifetime.ts');
const {createM7RecordActivation:activation28}=await import('../components/m7-record-activation.ts');
const {createW01ProductionBinding:walkBinding28,createW01ProductController:walkController28}=await import('../components/w01-product-controller.ts');
const adapter28={provenance:'TEST_FIXTURE',processing:'ON_DEVICE',contract:'M3_GATEWAY_V1',async interpret(){return{intent_type:'GOAL',interpreted_meaning:'Khỏe hơn',confidence:0.95,uncertainty:null,missing_context:[],clarification_needed:false,clarification_question:null,safety_state:'CLEAR',suggested_next_role:'M4',task_kind:'general_health',context_effect:'NONE',used_context_ids:[],response:'Đã ghi nhận.'}},async revoke(){}};
async function ownerFixture28(owner=ownerA28,memory=memory26(),persistent=true){
 const clock=new Clock28(),authority=authority28(),boundary=createLocalOwnerBoundary(authority.verifier,clock);
 authority.results.push({status:'verified',owner,validUntil:100000});const lease=await boundary.control.verifySession();boundary.control.finishHydration(lease);
 const binding={access:boundary.access,lease},archive=m7Archive28.createM7Persistence({binding,backend:memory.backend,persistenceAllowed:persistent,now:Date.now});await archive.start();
 const host=hostFactory28(()=>{});host.activate('OWNED',binding,'fixture',()=>adapter28,activation28(binding,80000,clock.now));const slot=host.currentSlot();ok(slot);
 return {clock,authority,boundary,binding,archive,host,slot,memory,dispose(){archive.dispose();host.deactivate();boundary.control.invalidateCurrentSession()}};
}
async function completeReport28(f,options={}){
 const store=f.slot.store,task=store.submit('Khỏe hơn',{permission_granted:true});await wait26();let ref=store.reference(task);ok(ref);
 ok(store.acceptM5Goal(ref,store.assessM5Goal(ref,store.assessM4GoalReadiness(ref))));ref=store.reference(task);
 const walk=walkController28({onChange(){}});walk.bind(walkBinding28({identity:{ownerAccess:f.binding.access,ownerLease:f.binding.lease,store,ref},current:()=>f.host.currentSlot()===f.slot&&store.reference(task)?.revision===ref.revision,selfWalk:store.selfWalk}));
 for(const answer of ['yes','none','none','adult','independent','supported','none_competing','suitable','5','3'])ok(walk.presentation().answer(answer));
 equal(walk.presentation().state,'PROPOSED');ok(walk.presentation().act('accept'));ok(walk.presentation().act('start'));
 const record=f.slot.record;for(const [field,value]of [['execution_extent','DID'],['action_change','UNCHANGED'],['user_stopped',false],['problem_report','NONE'],['constraint','NONE_REPORTED']])ok(record.presentation().choose(field,value));
 ok(record.presentation().setEvidenceText('S28 synthetic personal report'));ok(record.presentation().submit());
 await f.archive.settle();equal(f.archive.getSnapshot().phase,options.persistent===false?'RAM_ONLY':options.blocked?'ERROR':'EMPTY','no write before explicit End');
 ok(walk.presentation().act('stop'));await f.archive.settle();equal(f.archive.getSnapshot().phase,options.persistent===false?'RAM_ONLY':options.blocked?'ERROR':'EMPTY','STOP is not USER_REPORTED_END');
 ok(walk.presentation().act('end'));await f.archive.settle();
 if(options.persistent!==false){equal(f.archive.getSnapshot().phase,options.blocked||options.saveFailure?'ERROR':'SAVED');if(!options.blocked&&!options.saveFailure)equal(f.archive.getSnapshot().report.R.outcome.execution_extent,'DID');else equal(f.archive.getSnapshot().report,undefined);}
 return {walk,record,task,ref};
}
const groups28=[],check28=async(name,run)=>{const before=checks;await run();groups28.push({name,status:'PASS',checks:checks-before});console.log('S28_GROUP '+name+' PASS '+(checks-before));};
await check28('OWNER_A_M7_PERSISTS_AND_RECOVERS_ACROSS_RELOAD_AND_RELOGIN',async()=>{
 const mem=memory26(),first=await ownerFixture28(ownerA28,mem);let saved;
 try{const live=await completeReport28(first);saved=first.archive.getSnapshot().report;equal(saved.reuseForNextCycle,false);equal(first.slot.store.m7Outcome.readNextCycle(undefined),undefined);ok(mem.map.has(ownerPrefix27(ownerA28)+'m7-completed'));equal(live.record.presentation().persistence,'SAVED');}finally{first.dispose()}
 const next=await ownerFixture28(ownerA28,mem);try{equal(next.archive.getSnapshot().report,saved);equal(next.slot.store.m7Outcome.getSnapshot(undefined).state,'DENIED');equal(next.slot.store.getSnapshot().tasks.length,0);
 const rendered=renderer27(),file=path.join(app,'components/M7RecordCard.tsx'),m={exports:{}};new vm.Script('(function(require,module,exports){'+transpile(file,await readFile(file,'utf8'))+'\n})').runInNewContext({})(name=>name==='react'?rendered.React:name==='react-native'?{Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:x=>x}}:name==='@/i18n-m7-record'?m7Copy28:(()=>{throw Error('S28_CARD_UNADMITTED '+name)})(),m,m.exports);
 for(const locale of ['vi','en','zh-Hans','es','hi','ja','ko','ru']){rendered.render(rendered.React.createElement(m.exports.M7CompletedReportCard,{snapshot:next.archive.getSnapshot(),locale,color:'#111',border:'#222',onDelete:()=>next.archive.remove()}));ok(rendered.byId('m7-completed-history'));ok(rendered.text(rendered.tree).includes(m7Copy28.M7_ARCHIVE_COPY[locale].readOnly));ok(rendered.text(rendered.tree).includes('S28 synthetic personal report'));equal(rendered.byId('m7-record-submit'),undefined);equal(rendered.nodes().filter(x=>x.type==='Pressable').length,0,'restored card is strictly read-only');for(const value of Object.values(m7Copy28.M7_ARCHIVE_COPY[locale]))ok(typeof value==='string'&&value.length>0);if(!['vi','en'].includes(locale))for(const key of Object.keys(m7Copy28.M7_ARCHIVE_COPY[locale])){ok(m7Copy28.M7_ARCHIVE_COPY[locale][key]!==m7Copy28.M7_ARCHIVE_COPY.en[key]);ok(m7Copy28.M7_ARCHIVE_COPY[locale][key]!==m7Copy28.M7_ARCHIVE_COPY.vi[key]);}}rendered.unmount();
 }finally{next.dispose()}
});
await check28('OWNER_B_CANNOT_READ_OR_OVERWRITE_OWNER_A_M7_REPORT',async()=>{
 const mem=memory26(),aa=await ownerFixture28(ownerA28,mem);await completeReport28(aa);const raw=mem.map.get(ownerPrefix27(ownerA28)+'m7-completed');aa.dispose();
 const bb=await ownerFixture28(ownerB28,mem);try{equal(bb.archive.getSnapshot().phase,'EMPTY');await completeReport28(bb);equal(bb.archive.getSnapshot().report.owner,ownerB28);equal(mem.map.get(ownerPrefix27(ownerA28)+'m7-completed'),raw);}finally{bb.dispose()}
 for(const owner of [ownerA28,{...ownerA28,profileId:'another-profile'}]){const f=await ownerFixture28(owner,mem);try{equal(f.archive.getSnapshot().phase,owner===ownerA28?'SAVED':'EMPTY');}finally{f.dispose()}}
 for(const kind of ['GUEST','TECHNICAL']){let calls=0;const backend={getItem:async()=>{calls++;return null},setItem:async()=>{calls++},removeItem:async()=>{calls++},getAllKeys:async()=>{calls++;return[]}},f=await ownerFixture28(ownerA28,{backend},false);try{await completeReport28(f,{persistent:false});equal(f.archive.remove(),false);equal(calls,0,kind+' stays RAM-only');}finally{f.dispose()}}
});
await check28('ERASURE_OF_OWNER_A_PERMANENTLY_PURGES_M7_WITH_NO_RESURRECTION',async()=>{
 const mem=memory26(),x=await privacyFixture27({memory:mem});try{
 const actualA=await ownerFixture28(x.f.db.A,mem),actualB=await ownerFixture28(x.f.db.B,mem);await completeReport28(actualA);await completeReport28(actualB);const bRaw=mem.map.get(ownerPrefix27(x.f.db.B)+'m7-completed');actualA.dispose();actualB.dispose();
 // Reload the mounted, actual S27-inherited PrivacyScreen with the real provider archive hook.
 await x.switchOwner('A');ok(x.rendered.byId('m7-completed-history'));
 for(const key of USER_DATA_KEYS)mem.map.set(ownerPrefix27(x.f.db.A)+key,'S28_SYNTHETIC');
 await x.press('privacy-account-delete-trigger');await x.press('privacy-account-delete-confirm');await x.settle('privacyAccountDeleteComplete');
 for(const key of [...USER_DATA_KEYS,'m7-completed'])equal(mem.map.has(ownerPrefix27(x.f.db.A)+key),false);equal(mem.map.get(ownerPrefix27(x.f.db.A)+'__retired_v1'),'RETIRED_V1');equal(mem.map.get(ownerPrefix27(x.f.db.B)+'m7-completed'),bRaw);equal(x.rendered.byId('m7-completed-history'),undefined);
 // Even a newly verified local boundary cannot bypass the persistent retirement marker.
 const revived=await ownerFixture28(x.f.db.A,mem);try{equal(revived.archive.getSnapshot().phase,'ERROR');equal(revived.archive.getSnapshot().report,undefined);await completeReport28(revived,{blocked:true});equal(mem.map.has(ownerPrefix27(x.f.db.A)+'m7-completed'),false);}finally{revived.dispose()}
 }finally{x.dispose()}
 // Native write already issued: retirement is queued behind it, late completion cannot revive the slot.
 const mem2=memory26(),f=await ownerFixture28(ownerA28,mem2);await completeReport28(f);const baseSet=mem2.backend.setItem;let release,entered;const blocked=new Promise(r=>entered=r),held=new Promise(r=>release=r);
 mem2.backend.setItem=async(k,v)=>{if(k.endsWith('/m7-completed')){entered();await held;}await baseSet(k,v)};
 ok(f.slot.record.presentation().beginCorrection());ok(f.slot.record.presentation().choose('execution_extent','PARTIAL'));ok(f.slot.record.presentation().submit());await blocked;
 const guarded=createGuardedUserStorage(f.binding.access,mem2.backend,{retireAccess:()=>f.boundary.control.invalidateCurrentSession()}),permit=guarded.prepareOwnerRetirement(f.binding.lease),erased=guarded.retireOwnerNamespace(permit);release();await erased;await f.archive.settle();equal(mem2.map.has(ownerPrefix27(ownerA28)+'m7-completed'),false);equal(f.archive.getSnapshot().report,undefined);f.dispose();
});
await check28('NO_REVOKED_PERMISSION_RESTORE_AND_NO_NEXT_CYCLE_REUSE',async()=>{
 const mem=memory26(),f=await ownerFixture28(ownerA28,mem);await completeReport28(f);const old=f.archive.getSnapshot().report;f.dispose();const restored=await ownerFixture28(ownerA28,mem);try{equal(restored.archive.getSnapshot().report,old);equal(restored.archive.getSnapshot().report.reuseForNextCycle,false);equal(restored.slot.store.getSnapshot().tasks.length,0);equal(restored.slot.store.m7Outcome.getSnapshot(undefined).state,'DENIED');equal(restored.slot.store.m7Outcome.readNextCycle(undefined),undefined);equal(restored.slot.record.presentation().state,'UNAVAILABLE');equal(Object.keys(restored.archive.getSnapshot().report).sort(),['R','completion','owner','reuseForNextCycle','saved_at','schema'].sort());}finally{restored.dispose()}
});
await check28('CORRUPT_OR_FOREIGN_M7_PAYLOAD_FAILS_CLOSED',async()=>{
 const mem=memory26(),f=await ownerFixture28(ownerA28,mem);await completeReport28(f);const good=JSON.parse(mem.map.get(ownerPrefix27(ownerA28)+'m7-completed'));f.dispose();
 const variants=['{broken',JSON.stringify({...good,owner:ownerB28}),JSON.stringify({...good,value:{...good.value,owner:ownerB28}}),JSON.stringify({...good,value:{...good.value,reuseForNextCycle:true}}),JSON.stringify({...good,value:{...good.value,authorization:'forged'}})];
 for(const mutate of [x=>{x.R.episode.task_revision++},x=>{x.R.evidence.task_revision++},x=>{x.R.revision=0},x=>{x.R.episode.session_id='foreign'},x=>{x.R.outcome.execution_extent='invented'},x=>{x.saved_at=Infinity}]){const v=JSON.parse(JSON.stringify(good));mutate(v.value);variants.push(JSON.stringify(v));}
 for(const bad of variants){mem.map.set(ownerPrefix27(ownerA28)+'m7-completed',bad);const x=await ownerFixture28(ownerA28,mem);try{equal(x.archive.getSnapshot().phase,'ERROR');equal(x.archive.getSnapshot().report,undefined);}finally{x.dispose()}}
 const identity=await ownerFixture28(ownerA28);let io=0;const input={binding:{...identity.binding},persistenceAllowed:false,backend:{getItem:async()=>{io++;return null},setItem:async()=>{io++},removeItem:async()=>{io++},getAllKeys:async()=>[]}};
 const immutable=m7Archive28.createM7Persistence(input);input.persistenceAllowed=true;input.binding.lease={};await immutable.start();equal(immutable.getSnapshot().phase,'RAM_ONLY');equal(io,0,'caller mutation cannot enable persistence or replace captured lease');immutable.dispose();identity.dispose();
 const getter={...good.value};Object.defineProperty(getter,'R',{get(){throw Error('getter must not execute')}});equal(m7Archive28.validateCompletedM7(getter,ownerA28,100000),undefined);
});
await check28('LEASE_EXPIRY_STALE_HYDRATION_AND_SELECTIVE_DELETE',async()=>{
 const mem=memory26(),f=await ownerFixture28(ownerA28,mem);await completeReport28(f);const report=f.archive.getSnapshot().report;
 f.clock.advance(100001);equal(f.archive.getSnapshot().report,undefined);f.dispose();
 const reload=await ownerFixture28(ownerA28,mem);equal(reload.archive.getSnapshot().report,report);equal(reload.archive.remove(),true);await reload.archive.settle();equal(mem.map.has(ownerPrefix27(ownerA28)+'m7-completed'),false);reload.dispose();
 let release,entered;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r),backend={...mem.backend,getItem:async k=>{if(k.endsWith('/m7-completed')){entered();await held;}return mem.backend.getItem(k)}};
 const authority=authority28(),clock=new Clock28(),boundary=createLocalOwnerBoundary(authority.verifier,clock);authority.results.push({status:'verified',owner:ownerA28,validUntil:100000});let lease=await boundary.control.verifySession();boundary.control.finishHydration(lease);const archive=m7Archive28.createM7Persistence({binding:{access:boundary.access,lease},backend,persistenceAllowed:true,now:clock.now}),job=archive.start();await started;authority.results.push({status:'verified',owner:ownerB28,validUntil:100000});lease=await boundary.control.verifySession();boundary.control.finishHydration(lease);release();await job;equal(archive.getSnapshot().report,undefined);equal(archive.getSnapshot().phase,'RAM_ONLY');archive.dispose();boundary.control.invalidateCurrentSession();
});

await check28('R_F_CORRECTION_RETRACTION_AND_DELETION_STAY_DISTINCT',async()=>{
 const f=await ownerFixture28();try{const {record}=await completeReport28(f);const original=f.archive.getSnapshot().report.R;
 ok(record.presentation().chooseFeedback('VERY_GOOD'));ok(record.presentation().submitFeedback());await f.archive.settle();equal(f.archive.getSnapshot().report.R,original);equal(f.archive.getSnapshot().report.F.feedback.experience,'VERY_GOOD');
 ok(record.presentation().beginCorrection());ok(record.presentation().choose('execution_extent','PARTIAL'));ok(record.presentation().submit());await f.archive.settle();equal(f.archive.getSnapshot().report.R.outcome.execution_extent,'PARTIAL');equal(f.archive.getSnapshot().report.F.feedback.experience,'VERY_GOOD');
 ok(record.presentation().requestRetraction());ok(record.presentation().confirmRetraction());await f.archive.settle();equal(f.archive.getSnapshot().report.R.state,'RETRACTED');equal(f.archive.getSnapshot().report.R.outcome,undefined);equal(f.archive.getSnapshot().report.R.evidence_text,undefined);
 ok(record.presentation().requestDelete());ok(record.presentation().confirmDelete());await f.archive.settle();equal(f.archive.getSnapshot().report.R,undefined);ok(f.archive.getSnapshot().report.F);
 ok(record.presentation().requestFeedbackDelete());ok(record.presentation().confirmDelete());await f.archive.settle();equal(f.archive.getSnapshot().phase,'EMPTY');equal(f.memory.map.has(ownerPrefix27(ownerA28)+'m7-completed'),false);
 }finally{f.dispose()}
});
await check28('STORAGE_FAILURE_IS_EXPLICIT_WITHOUT_FALSE_SAVED_OR_CROSS_OWNER_EFFECT',async()=>{
 const mem=memory26(),f=await ownerFixture28(ownerA28,mem),key=ownerPrefix27(ownerB28)+'m7-completed';mem.map.set(key,'UNCHANGED_B');mem.fail(true);
 try{const {record}=await completeReport28(f,{saveFailure:true});equal(record.presentation().state,'ACTIVE');equal(record.presentation().persistence,'ERROR');equal(mem.map.get(key),'UNCHANGED_B');equal(mem.map.has(ownerPrefix27(ownerA28)+'m7-completed'),false);}finally{f.dispose()}
});
console.log('S28_RESULT '+JSON.stringify({status:'PASS_CODE_OFFLINE_COMPLETED_M7_PERSISTENCE',groups:groups28,sourceFiles:480,namespace:'subject+profile/m7-completed',reuse:false,restoredTasks:0,restoredGrants:0,native:0,provider:0,externalNetwork:0,limits:'Latest completed report per owner/profile on this device. Controlled hook renderer, not ReactDOM/device/runtime acceptance. No protection claimed against an OS-level writer forging a fully internally consistent storage envelope.'}));

// S29 actual RootLayout -> real Provider factory -> real Web composition; only native/HTTP/storage ports are simulated.
const web29=await import('../lib/identity/web-session.ts');
const {resolveProductionIdentityConfig:prodOrigin29}=await import('../domain/identity/owner-session-coordinator.ts');
const SEAM29=web29.CONNECTED_LOOPBACK_SESSION_KEY;
const groups29=[];async function check29(name,run){const before=checks;await run();groups29.push({name,status:'PASS_CODE_OFFLINE_ACTUAL_ROOT',checks:checks-before});console.log('S29_GROUP '+name+' PASS '+(checks-before));}
async function rootFixture29(options={}){
 const localClientFactory39=(await import('../lib/identity/local-verification.ts')).createLocalVerificationClient;
 const f=options.server??fixture26(),mem=options.memory??memory26(),rendered=renderer27();rendered.React.useLayoutEffect=rendered.React.useEffect;
 const origin=options.origin??'http://127.0.0.1:18110',docOrigin=options.documentOrigin??origin;
 let probe={},openingProbe,disposed=false,holdVerify=false;const calls=[],held=[];
 const fetch29=async(url,init={})=>{
   const u=new URL(url),headers=Object.fromEntries(Object.entries(init.headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
   if(u.origin!==origin)throw Error('S29_OFFLINE_ORIGIN_ESCAPE');
   const token=String(headers.authorization??'').replace(/^Bearer /,''),method=init.method??'GET',row={path:u.pathname,method};calls.push(row);
   let response;
   if(options.localAuthority){
     const local=options.localAuthority.handle({url:u.href,method,origin,authorization:headers.authorization,body:typeof init.body==='string'?JSON.parse(init.body):undefined});
     response=new Response(local.status===204?null:JSON.stringify(local.body??{}),{status:local.status,headers:{'content-type':'application/json'}});row.status=response.status;return response;
   }
   try{
    if(u.pathname==='/api/identity/session'&&method==='GET'){
      const verified=await f.db.core.verifySession(token);response=new Response(JSON.stringify(verified),{status:200,headers:{'content-type':'application/json'}});
      if(holdVerify){let release;const promise=new Promise(r=>release=r);held.push({release,token});await promise;}
    }else if(u.pathname==='/api/identity/m2/facts'&&method==='GET'){
      const facts=await f.db.core.readOwnerFacts(token);response=new Response(JSON.stringify(facts),{status:200});
    }else if(u.pathname==='/api/identity/account/delete'){
      const result=await f.db.dispatch({path:u.pathname,method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},rawBody:init.body??''});response=new Response(result.status===204?null:JSON.stringify(result.body??{}),{status:result.status});
    }else if(u.pathname==='/api/identity/session/logout'&&method==='POST')response=new Response(null,{status:204});
    else response=new Response('{}',{status:404});
   }catch{response=new Response('{}',{status:401});}
   row.status=response.status;return response;
 };
 const pass=({children})=>children,colors=new Proxy({},{get:()=> '#123456'}),native={AppState:{addEventListener:()=>({remove(){}})},Platform:{OS:options.platform??'web',select:x=>x.web??x.default},StyleSheet:{create:x=>x},Alert:{alert(){throw Error('UNADMITTED_ALERT')}},Image:'Image',TextInput:'TextInput',Pressable:'Pressable',Text:'Text',View:'View'};
 let welcome={hydrated:true,visible:options.showOpening===true,reviewing:false,resumeGoal:false,runId:1,markWelcomeSeen(){},closeWelcome(){},showWelcome(){}};let currentPath38='/',reviewProbe38;const routes38=[];
 const locale=options.locale??'vi',localization={LocalizationProvider:pass,useLocale:()=>({locale,localeCode:locale,t:(k,x)=>s27I18n.translate(locale,k,x),setLocale(){}})};
 const stubs={react:rendered.React,'react-native':native,'@react-native-async-storage/async-storage':{__esModule:true,default:mem.backend},
 '@/components/coach-presence-flow':{createAccountErasureOrchestrator},'@/domain/m2/factual-snapshot':await import('../domain/m2/factual-snapshot.ts'),
 '@/domain/m2/host-facts-reader':await import('../domain/m2/host-facts-reader.ts'),'@/domain/m7/store':m7Archive28,
 '@/domain/identity/owner-session-coordinator':s27Coordinator,'@/lib/identity/expo-apple-session':{},
 '@/lib/identity/local-verification':{...await import('../lib/identity/local-verification.ts'),createLocalVerificationClient:(config,opts)=>localClientFactory39(config,{...opts,fetchImpl:fetch29})},
 '@/lib/identity/web-session':{...web29,createWebOwnerSessionComposition:config=>web29.createWebOwnerSessionComposition({...config,fetchImpl:fetch29}),createConnectedLoopbackWebCoordinator:(config,opts)=>web29.createConnectedLoopbackWebCoordinator(config,{...opts,fetchImpl:fetch29})},
 '@/context/LocalizationContext':localization,'@/context/DevelopmentContext':{DevelopmentProvider:pass,useDevelopment:()=>({state:{},resetLocalState:async()=>true,persistenceStatus:'ready'})},
 '@/context/OpeningContext':{OpeningProvider:pass,useOpening:()=>({projectionRevision:0,forgetMemory:async()=>true,unreadableDataPreserved:false})},
 '@/context/CoachingContext':{CoachingProvider:pass,useCoaching:()=>({state:{status:'idle'},projectionRevision:0,unreadableDataPreserved:false,persistenceStatus:'ready',deleteData:async()=>true})},
 '@/context/InteractionContext':{InteractionProvider:pass,useInteraction:()=>({unreadableDataPreserved:false,deleteData:async()=>true})},
 '@/context/WelcomeContext':{WelcomeProvider:pass,useWelcome:()=>welcome,FORCE_SLICE_PREVIEW_OPENING:false},
 '@/context/TrainerRuntimeContext':{TrainerRuntimeProvider:pass},'@/domain/welcome':options.realWelcome?await import('../domain/welcome.ts'):{resolveWelcomeInitialPhase:()=> 'welcome'},
 '@/hooks/useColors':{useColors:()=>colors},'@expo/vector-icons':{Feather:'Feather'},'@/components/KeyboardAwareScrollViewCompat':{KeyboardAwareScrollViewCompat:'ScrollView'},'@/components/Animated100Signature':{Animated100Signature:'Logo'},
 '@/i18n':s27I18n,'@/i18n-identity':await import('../i18n-identity.ts'),'@/i18n-m7-record':m7Copy28,'@/i18n-coach-presence':await import('../i18n-coach-presence.ts'),
 '@/domain/privacy-local-delete':await import('../domain/privacy-local-delete.ts'),'@/components/ErrorBoundary':{ErrorBoundary:pass},
 '@tanstack/react-query':{QueryClient:class{},QueryClientProvider:pass},'react-native-gesture-handler':{GestureHandlerRootView:pass},'react-native-keyboard-controller':{KeyboardProvider:pass},'react-native-safe-area-context':{SafeAreaProvider:pass},
 '@expo-google-fonts/inter':{useFonts:()=>[true,undefined]},'expo-status-bar':{StatusBar:()=>null},'expo-splash-screen':{preventAutoHideAsync:async()=>{},hideAsync:async()=>{}},
 '@/components/m7-record-activation':{createM7RecordActivation:activation28},'@/components/OpeningGoalFlow':{OpeningGoalFlow:props=>{if(props.m2Gateway)openingProbe=props;else reviewProbe38=props;return null}},'@/components/WelcomeExperience':{WelcomeExperience:props=>{reviewProbe38=props;return null}},
 '@/domain/m3/stub-adapter':{createM3StubAdapter:()=>adapter28},'@/domain/m3/runtime-mode':await import('../domain/m3/runtime-mode.ts')};
 const publicEnv={EXPO_PUBLIC_DOMAIN:origin,EXPO_PUBLIC_IDENTITY_REQUEST_TIMEOUT_MS:'1000',EXPO_PUBLIC_M3_RUNTIME_MODE:'fixture',EXPO_PUBLIC_CONNECTED_LOOPBACK_HARNESS:options.gate??'1',...(options.env??{})};
 const sandbox={process:{env:publicEnv},location:{origin:docOrigin},console,AbortController,URL,Response,TextEncoder,TextDecoder,setTimeout,clearTimeout,fetch:fetch29,__DEV__:false};vm.createContext(sandbox);
 const cache=new Map();let owner,Privacy;
 function probeComponent(){if(options.realWelcome)welcome=sourceModule('context/WelcomeContext.tsx').useWelcome();probe={binding:owner.useOwnerSessionBinding(),control:owner.useOwnerSessionControl(),history:owner.useM7CompletedHistory()};return rendered.React.createElement(Privacy,{});}
 const Stack=()=>rendered.React.createElement(probeComponent,{});Stack.Screen=()=>null;const nav38={push(href){currentPath38=href;routes38.push(href)},replace(href){currentPath38=href;routes38.push(href)}};stubs['expo-router']={Stack,useRouter:()=>nav38,router:nav38,usePathname:()=>currentPath38};
 function sourceModule(rel){if(cache.has(rel))return cache.get(rel).exports;const file=path.join(app,rel),m={exports:{}};cache.set(rel,m);new vm.Script('(function(require,module,exports){'+transpile(file,require('node:fs').readFileSync(file,'utf8'))+'\n})',{filename:file}).runInContext(sandbox)(name=>{
  if(name==='@/domain/wearable/contract')return wearableS30;if(name==='../assets/images/icon.png')return{TEST_FIXTURE_ASSET:true};
  const aliases={'@/components/UI':'components/UI.tsx','@/context/OwnerSessionContext':'context/OwnerSessionContext.tsx','@/components/M7RecordCard':'components/M7RecordCard.tsx'};
  if(options.realWelcome&&name==='@/context/WelcomeContext')return sourceModule('context/WelcomeContext.tsx');if(aliases[name])return sourceModule(aliases[name]);if(!Object.hasOwn(stubs,name))throw Error('S29_UNADMITTED_IMPORT '+name);return stubs[name];},m,m.exports);return m.exports;}
 owner=sourceModule('context/OwnerSessionContext.tsx');Privacy=sourceModule('app/(tabs)/privacy.tsx').default;const Root=sourceModule('app/_layout.tsx').default;
 rendered.render(rendered.React.createElement(Root,{}));await rendered.flush();
 return {f,mem,rendered,calls,sandbox,origin,get probe(){return probe},get opening(){return openingProbe},get welcome(){return welcome},get settingsReview(){return reviewProbe38},routes38,get seam(){return sandbox[SEAM29]},
 async issued(name){const v=await f.db.core.verifySession(f.db.tokens[name]);return{token:f.db.tokens[name],owner:v.owner,validUntil:v.validUntil}},
 async login(name){const issued=await this.issued(name);const status=await this.seam.accept(issued);await rendered.flush();return status;},
 async press(id){const n=rendered.byId(id);ok(n,'real node '+id);if(n.props.disabled)throw Error('DISABLED '+id);n.props.onPress();await rendered.flush();},
 async settle(){for(let i=0;i<8;i++)await rendered.flush()},
 hold(){holdVerify=true},release(){holdVerify=false;for(const h of held.splice(0))h.release()},held,
 dispose(){if(disposed)return;disposed=true;holdVerify=false;for(const h of held.splice(0))h.release();rendered.unmount();if(!options.server)f.dispose()}};
}
async function completedFromRoot29(x){
 const binding=x.probe.binding;ok(binding);const host=hostFactory28(()=>{}),scope=binding.access.requireLease(binding.lease);host.activate('OWNED',binding,'fixture',()=>adapter28,activation28(binding,scope.validUntil,Date.now));const slot=host.currentSlot();ok(slot);
 const proxy={binding,host,slot,archive:{getSnapshot:()=>x.probe.history.snapshot,settle:()=>x.settle()}};
 try{await completeReport28(proxy);return x.probe.history.snapshot.report;}finally{host.deactivate()}
}
await check29('PRODUCTION_DEFAULT_AND_HTTPS_KEEP_LOOPBACK_HANDOFF_DISABLED',async()=>{
 for(const option of [{gate:'0'},{gate:''},{origin:'https://example.test'},{origin:'http://example.test'},{origin:'https://127.0.0.1:18110'},{origin:'http://127.0.0.1:18110',documentOrigin:'http://localhost:18110'},{platform:'unsupported'},{env:{EXPO_PUBLIC_DOMAIN:undefined}}]){
  const x=await rootFixture29(option);try{equal(x.seam,undefined);equal(x.probe.binding,undefined);equal(x.probe.control.state,'locked');equal(x.calls.length,0);equal(x.rendered.byId('privacy-account-delete-trigger').props.disabled,true);}finally{x.dispose()}}
 const tech=await rootFixture29({env:{EXPO_PUBLIC_M3_RUNTIME_MODE:'local-verification',EXPO_PUBLIC_LOCAL_VERIFICATION:'1',EXPO_PUBLIC_LOCAL_AUTHORITY_ORIGIN:'http://127.0.0.1:18110'}});try{equal(tech.seam,undefined);ok(tech.probe.control.localVerification);equal(tech.probe.history.snapshot.phase,'RAM_ONLY');equal(tech.rendered.byId('privacy-account-delete-trigger').props.disabled,true);}finally{tech.dispose()}
});
await check29('ROOT_WEB_LOOPBACK_CONNECTED_HANDOFF_REACHES_READY_AND_RESOLVES_RUNTIME_ORIGIN',async()=>{
 for(const origin of ['http://127.0.0.1:18110','http://localhost:18110']){const x=await rootFixture29({origin});try{ok(x.seam);equal(x.seam.provenance,'TEST_FIXTURE_CONNECTED_LOOPBACK');equal(x.probe.binding,undefined);equal(x.calls.length,0);equal(await x.login('A'),'ready');equal(x.probe.control.state,'ready');equal(!!x.probe.control.localVerification,false);ok(x.probe.control.erasureScope);equal(x.probe.binding.access.requireLease(x.probe.binding.lease).owner,x.f.db.A);equal(x.probe.history.snapshot.phase,'EMPTY');equal(x.rendered.byId('privacy-account-delete-trigger').props.disabled,false);ok(x.calls.some(r=>r.path==='/api/identity/session'&&r.status===200));ok(x.calls.some(r=>r.path==='/api/identity/m2/facts'&&r.status===200));}finally{x.dispose()}}
 equal(prodOrigin29('http://127.0.0.1:18110','1000'),undefined,'shared HTTPS policy unchanged');
});
await check29('ROOT_CONNECTED_M7_WRITE_RELOAD_LOCKED_THEN_RELOGIN_HYDRATES_HISTORY',async()=>{
 const server=fixture26(),memory=memory26();let x=await rootFixture29({server,memory});try{
 equal(await x.login('A'),'ready');const saved=await completedFromRoot29(x);equal(saved.reuseForNextCycle,false);ok(memory.map.has(ownerPrefix27(server.db.A)+'m7-completed'));ok(x.rendered.byId('m7-completed-history'));const oldSurface=x.seam;x.dispose();equal(await oldSurface.accept({token:server.db.tokens.A,owner:server.db.A,validUntil:new Date(Date.now()+60000).toISOString()}),'unavailable');
 x=await rootFixture29({server,memory});equal(x.probe.control.state,'locked');equal(x.calls.length,0);equal(x.probe.history.snapshot.report,undefined);equal(x.rendered.byId('m7-completed-history'),undefined);equal(await x.login('A'),'ready');equal(x.probe.history.snapshot.report,saved);ok(x.rendered.byId('m7-completed-history'));equal(x.probe.history.snapshot.report.reuseForNextCycle,false);
 const binding=x.probe.binding,host=hostFactory28(()=>{});host.activate('OWNED',binding,'fixture',()=>adapter28,activation28(binding,binding.access.requireLease(binding.lease).validUntil,Date.now));try{equal(host.currentSlot().store.getSnapshot().tasks.length,0);equal(host.currentSlot().store.m7Outcome.readNextCycle(undefined),undefined);equal(host.currentSlot().record.presentation().state,'UNAVAILABLE');}finally{host.deactivate()}
 }finally{x.dispose();server.dispose()}
});
await check29('ROOT_CONNECTED_OWNER_B_ISOLATION_AND_MOUNTED_PRIVACY_UI_ERASURE',async()=>{
 const server=fixture26(),memory=memory26();let x=await rootFixture29({server,memory});try{
 equal(await x.login('A'),'ready');const savedA=await completedFromRoot29(x);equal(await x.login('B'),'ready');equal(x.probe.history.snapshot.report,undefined);const savedB=await completedFromRoot29(x);const bRaw=memory.map.get(ownerPrefix27(server.db.B)+'m7-completed');equal(await x.login('A'),'ready');equal(x.probe.history.snapshot.report,savedA);
 for(const key of USER_DATA_KEYS)memory.map.set(ownerPrefix27(server.db.A)+key,'S29_SYNTHETIC');const beforeB=server.db.Bsnapshot();
 await x.press('privacy-account-delete-trigger');equal(x.calls.filter(r=>r.path==='/api/identity/account/delete').length,0);await x.press('privacy-account-delete-cancel');equal(x.calls.filter(r=>r.path==='/api/identity/account/delete').length,0);ok(memory.map.has(ownerPrefix27(server.db.A)+'m7-completed'));
 await x.press('privacy-account-delete-trigger');await x.press('privacy-account-delete-confirm');await x.settle();equal(x.calls.filter(r=>r.path==='/api/identity/account/delete').length,1);equal(x.calls.find(r=>r.path==='/api/identity/account/delete').status,204);equal(x.probe.binding,undefined);equal(x.rendered.byId('m7-completed-history'),undefined);for(const key of [...USER_DATA_KEYS,'m7-completed'])equal(memory.map.has(ownerPrefix27(server.db.A)+key),false);equal(memory.map.get(ownerPrefix27(server.db.A)+'__retired_v1'),'RETIRED_V1');equal(memory.map.get(ownerPrefix27(server.db.B)+'m7-completed'),bRaw);equal(server.db.Bsnapshot(),beforeB);
 x.dispose();x=await rootFixture29({server,memory});equal(x.probe.binding,undefined);equal(await x.seam.accept({token:server.db.tokens.A,owner:server.db.A,validUntil:new Date(Date.now()+60000).toISOString()}),'unavailable');await x.settle();equal(x.rendered.byId('m7-completed-history'),undefined);equal(await x.login('B'),'ready');equal(x.probe.history.snapshot.report,savedB);
 }finally{x.dispose();server.dispose()}
});
await check29('MALFORMED_EXPIRED_FOREIGN_REVOKED_AND_STALE_HANDOFFS_FAIL_CLOSED',async()=>{
 const x=await rootFixture29();try{const good=await x.issued('A');let getter=0;const malicious={...good};Object.defineProperty(malicious,'token',{get(){getter++;return good.token}});equal(await x.seam.accept(malicious),'unavailable');equal(getter,0);equal(x.calls.length,0);
 for(const bad of [{...good,token:'bad'},{...good,validUntil:new Date(0).toISOString()},{...good,owner:x.f.db.B},{...good,token:'Z'.repeat(43)}]){equal(await x.seam.accept(bad),'unavailable');await x.settle();equal(x.probe.binding,undefined);equal(x.probe.history.snapshot.report,undefined);}
 equal(await x.login('A'),'ready');x.f.db.state.sessions.find(s=>s.token_digest===crypto.createHash('sha256').update(x.f.db.tokens.A).digest('hex')).revoked_at=new Date().toISOString();equal(await x.seam.accept(good),'unavailable');await x.settle();equal(x.probe.binding,undefined);
 }finally{x.dispose()}
 const y=await rootFixture29();try{y.hold();const a=await y.issued('A'),b=await y.issued('B'),first=y.seam.accept(a);for(let i=0;i<4&&!y.held.length;i++)await wait26();equal(y.held.length,1);const second=y.seam.accept(b);for(let i=0;i<4&&y.held.length<2;i++)await wait26();const third=y.seam.accept(a);for(let i=0;i<4&&y.held.length<3;i++)await wait26();y.release();equal(await first,'unavailable');equal(await second,'unavailable');equal(await third,'ready');await y.settle();equal(y.probe.binding.access.requireLease(y.probe.binding.lease).owner,y.f.db.A);
 const old=y.seam;y.dispose();equal(await old.accept(a),'unavailable');equal(y.sandbox[SEAM29],undefined);
 }finally{y.dispose()}
});
await check29('ROOT_LOGOUT_INVALIDATES_PENDING_VERIFICATION_AND_REQUIRES_NEW_HANDOFF',async()=>{
 const x=await rootFixture29();try{const a=await x.issued('A');x.hold();const pending=x.seam.accept(a);for(let i=0;i<4&&!x.held.length;i++)await wait26();equal(x.held.length,1);await x.probe.control.logout();await x.settle();equal(x.probe.binding,undefined);equal(x.probe.history.snapshot.report,undefined);equal(x.calls.filter(r=>r.path==='/api/identity/session/logout').length,0,'no logout HTTP before any credential was accepted');x.release();equal(await pending,'unavailable');await x.settle();equal(x.probe.control.state,'locked');equal(await x.login('A'),'ready');equal(x.probe.control.state,'ready');await x.probe.control.logout();await x.settle();equal(x.probe.binding,undefined);ok(x.calls.some(r=>r.path==='/api/identity/session/logout'&&r.status===204));}finally{x.dispose()}
});
await check29('ROOT_OWNER_A_B_A_REQUIRES_NEW_EXPLICIT_M3_PERMISSION',async()=>{
 const x=await rootFixture29({showOpening:true});try{equal(await x.login('A'),'ready');equal(x.opening.m2Gateway.m3Access.status,'denied');x.opening.m2Gateway.setM3Access(true);await x.settle();equal(x.opening.m2Gateway.m3Access.status,'allowed');const old=x.opening.m2Gateway;equal(await x.login('B'),'ready');equal(x.opening.m2Gateway.m3Access.status,'denied','Owner B cannot inherit Owner A M3 grant');old.setM3Access(true);await x.settle();equal(x.opening.m2Gateway.m3Access.status,'denied','stale owner callback cannot grant B');equal(await x.login('A'),'ready');equal(x.opening.m2Gateway.m3Access.status,'denied','A-B-A new lease does not revive permission');}finally{x.dispose()}
});
console.log('S29_RESULT '+JSON.stringify({status:'PASS_CODE_OFFLINE_CONNECTED_ROOT_SEAM',groups:groups29,root:'Actual candidate app/_layout.tsx and actual Provider/Privacy/M7 historical card; native/layout/router/font/storage and fetch ports deterministic; no ReactDOM/HTTP/browser runtime acceptance',network:0,native:0,provider:0,tokenPersistence:'RAM_ONLY_REAUTH_REQUIRED',reuse:false,globalSeam:SEAM29,gate:'EXPO_PUBLIC_CONNECTED_LOOPBACK_HARNESS=1 + Web HTTP loopback + exact document/config origin'}));

// Actual Provider + mounted offline Privacy tree: clear/logout/erase are exercised, not inferred from source text.
const privacyCopy30=await import('../i18n-privacy.ts');const mounted30=[];
for(const loc of ['vi','en','zh-Hans','es','hi','ja','ko','ru']){
 const x=await rootFixture29({locale:loc});try{const section=x.rendered.byId('privacy-wearable-gateway-section');ok(section,'S30 mounted section '+loc);const text=x.rendered.text(section);
 for(const key of ['wearableGatewayTitle','wearableGatewayBody','wearableGatewayScope','wearableGatewayUncertainty','wearableGatewayRevoke','wearableGatewayOff','wearableGatewayClear'])ok(text.includes(privacyCopy30.privacyMessages[loc][key]),'S30 actual localized tree '+loc+key);
 const control=x.probe.control.wearable;ok(control);const before=control.getSnapshot().epoch,traffic=x.calls.length;await x.press('privacy-wearable-clear-session');ok(control.getSnapshot().epoch>before);equal(x.calls.length,traffic,'clear has no HTTP');equal(control.getSnapshot().retained,0);mounted30.push(loc);
 }finally{x.dispose()}
}
for(const operation of ['logout','eraseAccount']){const x=await rootFixture29();try{equal(await x.login('A'),'ready');const control=x.probe.control.wearable;ok(control);equal(control.getSnapshot().status,'HEALTH_LIVE_OFF');const epoch=control.getSnapshot().epoch;const pending=x.probe.control[operation]();ok(control.getSnapshot().epoch>epoch,'synchronous wearable retirement before await '+operation);await pending;await x.settle();equal(x.probe.binding,undefined);equal(control.getSnapshot().retained,0);ok(![...x.mem.map.keys()].some(k=>/wearable|health|sensor/i.test(k)),'no wearable storage keys');}finally{x.dispose()}}
console.log('S30_MOUNTED_GATEWAY_RESULT '+JSON.stringify({locales:mounted30,clear:true,logout:true,eraseAccount:true,proof:'Actual Provider/Privacy handlers and deterministic React tree; not browser/device',native:0}));
// Execute actual S30 W0 falsifiers after inherited composition groups, never health/live SDK.
const s30Verified=await import('./verify-wearable-w0.mjs');
console.log('S30_RESULT '+JSON.stringify({status:'PASS_CODE_OFFLINE_SCOPED',groups:s30Verified.S30_GROUPS,health_live:'gated_off',native_issuer:'UNCONFIGURED',native_device_gates:'NOT_RUN',actual_native_queries:0,health_network:0,health_persistence:0,limits:'Owned W0 RAM/use-time guard only; no JavaScript primitive-copy zeroization claim; signed native/device G1-G4 still required'}));

// S31 presentation: actual component functions with a deterministic clock/React tree.
// No ReactDOM, native pixels, device layout or UX acceptance is inferred.
const s31Groups=[];
function loadPresentation31(file,rendered,native,extras={},globals={}) {
 const m={exports:{}},s=transpile(file,require('node:fs').readFileSync(file,'utf8'));
 new vm.Script('(function(require,module,exports){'+s+'\n;exports.__core=typeof WelcomeLogoAnimationCore==="function"?WelcomeLogoAnimationCore:undefined;exports.__ring=typeof LivingWalkRing==="function"?LivingWalkRing:undefined;})',{filename:file})
 .runInNewContext({...globals,console})(name=>{
  if(name==='react')return {...rendered.React,Component:class{}};
  if(name==='react-native')return native;
  if(Object.hasOwn(extras,name))return extras[name];
  if(name==='react-native-svg')return {__esModule:true,default:'Svg',Path:'Path',Defs:'Defs',Rect:'Rect',Stop:'Stop',LinearGradient:'Gradient',RadialGradient:'RadialGradient',Mask:'Mask',Image:'SvgImage',ClipPath:'ClipPath',Polygon:'Polygon',Circle:'Circle',G:'G'};
  if(/\.(png|jpg)$/.test(name))return name;
  throw Error('S31_UNADMITTED_IMPORT '+name);
 },m,m.exports);
 return m.exports;
}
function animationFixture31() {
 const rendered=renderer27(),frames=new Map(),listeners=new Map(),motionListeners=new Set(),stateListeners=new Set(),callbacks=[];
 let serial=0,done=0,loopStarts=0,loopStops=0;
 class Value {constructor(value){this.value=value;}setValue(v){this.value=v;}stopAnimation(){}interpolate({inputRange,outputRange}){return outputRange[0];}}
 const animation=()=>({start(cb){if(cb)callbacks.push(cb)},stop(){}});
 const native={View:'View',Text:'Text',Pressable:'Pressable',ScrollView:'ScrollView',ImageBackground:'ImageBackground',
   StyleSheet:{create:x=>x,absoluteFill:{}},Platform:{OS:'web',select:x=>x.web??x.default},
   AppState:{currentState:'active',addEventListener:(_,cb)=>{stateListeners.add(cb);return{remove:()=>stateListeners.delete(cb)}}},
   AccessibilityInfo:{isReduceMotionEnabled:async()=>false,addEventListener:(_,cb)=>{motionListeners.add(cb);return{remove:()=>motionListeners.delete(cb)}},setAccessibilityFocus(){}},
   Animated:{Value,View:'Animated.View',Image:'Animated.Image',timing:animation,spring:animation,delay:animation,
     sequence:animation,parallel:animation,loop:()=>({start(){loopStarts++},stop(){loopStops++}})},
   Easing:{sin:x=>x,quad:x=>x,cubic:x=>x,inOut:x=>x,out:x=>x,in:x=>x},
   useWindowDimensions:()=>({width:390,height:844}),findNodeHandle:()=>null};
 const globals={document:{hidden:false,addEventListener:(name,cb)=>listeners.set(name,cb),removeEventListener:name=>listeners.delete(name)},
   requestAnimationFrame:cb=>{const id=++serial;frames.set(id,cb);return id},cancelAnimationFrame:id=>frames.delete(id),
   setTimeout:()=>++serial,clearTimeout(){},};
 return {rendered,native,globals,callbacks,motionListeners,stateListeners,frames,
   visibility(hidden){globals.document.hidden=hidden;listeners.get('visibilitychange')?.();},
   tick(time){const pending=[...frames.values()];frames.clear();pending.forEach(cb=>cb(time));rendered.render();},
   done:()=>{done++},get doneCount(){return done},get loopStarts(){return loopStarts},get loopStops(){return loopStops}};
}
const lockedGeometry31=await readFile(path.join(app,'components/Founder100Paths.ts'),'utf8');
equal(crypto.createHash('sha256').update(lockedGeometry31).digest('hex'),'14a33b5014de8ca604b335294956748c5e3aaa823eb963a15b77ccd0b7bf5c95','Founder geometry locked');
const pathModule31={exports:{}};
new vm.Script('(function(exports){'+ts.transpileModule(lockedGeometry31,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText+'})').runInNewContext({})(pathModule31.exports);

const goldModelModule={exports:{}};
new vm.Script('(function(exports){'+ts.transpileModule(await readFile(path.join(app,'components/m1-gold-standard.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText+'})').runInNewContext({Uint8ClampedArray,Uint8Array,Int32Array,Float32Array,Math})(goldModelModule.exports);
const goldModel=goldModelModule.exports;
equal(goldModel.DRAW_DURATION_MS,3000);equal(goldModel.SHRINK_FLIGHT_MS,1450);
for(const time of [0,330,960,2300,2849,3499,3500,7000]){const f=goldModel.signatureFrame(time);ok(f.progress>=0&&f.progress<=1&&f.alpha>=0&&f.alpha<=1);equal(JSON.stringify(f),JSON.stringify(goldModel.signatureFrame(time+3500)));}
ok(goldModel.mechanicalPose(525).y < -13,'strong mechanical bob');
for(const kind of ['header','welcome']){
 const f=animationFixture31();
 const GoldStub=props=>{f.rendered.React.useEffect(()=>{props.onReady?.()},[]);return f.rendered.React.createElement('GoldFrame',props);};
 const e=loadPresentation31(path.join(app,'components',kind==='header'?'Animated100Signature.tsx':'WelcomeLogoAnimation.tsx'),f.rendered,f.native,{
  '@/components/GoldStandard100':{GoldStandard100:GoldStub},'@/components/m1-gold-standard':goldModel,
  './Founder100Paths':pathModule31.exports,
 },f.globals);
 let props=kind==='header'?{color:'#FFF5E2'}:{size:184,motionPreferenceKnown:true,reduceMotion:false,onDrawComplete:f.done};
 const Component=kind==='header'?e.Animated100Signature:e.WelcomeLogoAnimation;
 f.rendered.render(f.rendered.React.createElement(Component,props));await f.rendered.flush();f.rendered.render();
 const frame=()=>{let node;function visit(x){if(Array.isArray(x))x.forEach(visit);else if(x?.props){if(x.type==='GoldFrame')node=x;visit(x.props.children);}}visit(f.rendered.tree);return node;};
 f.tick(0);equal(frame().props.progress,0,'S32 no premature complete 100');
 f.tick(330);ok(frame().props.progress>0&&frame().props.progress<.16,'hook only at .33s');
 f.tick(960);ok(Math.abs(frame().props.progress-960/(kind==='header'?2300:3000))<.00001,'canon timing at .96s');
 f.tick(3000);equal(frame().props.progress,1);
 if(kind==='welcome'){equal(f.doneCount,1);f.tick(4200);equal(frame().props.progress,1,'M1 holds full 100');}
 else {f.tick(3499);ok(frame().props.alpha<.002,'corner fully dissolves');f.tick(3500);equal(frame().props.progress,0,'corner restarts');}
 f.stateListeners.forEach(cb=>cb('background'));f.visibility(true);f.rendered.render();equal(f.frames.size,0);
 f.stateListeners.forEach(cb=>cb('active'));f.visibility(false);f.rendered.render();ok(f.frames.size>0);
 if(kind==='header')f.motionListeners.forEach(cb=>cb(true));else props={...props,reduceMotion:true};
 f.rendered.render(f.rendered.React.createElement(Component,props));equal(f.frames.size,0);equal(frame().props.progress,1,'Reduce Motion whole static 100');
 f.rendered.unmount();equal(f.frames.size,0);equal(f.stateListeners.size,0);
 s31Groups.push('S32_'+kind+'_STROKE_BOB_REDUCED_BACKGROUND');
}
for(const locale of ['vi','en','zh-Hans','es','hi','ja','ko','ru']){
 const f=animationFixture31();let begun=0,saved=0;
 f.native.Modal=props=>props.visible?f.rendered.React.createElement('Modal',props):null;
 const e=loadPresentation31(path.join(app,'components/WelcomeExperience.tsx'),f.rendered,f.native,{
  '@expo/vector-icons':{Feather:'Feather'},'expo-status-bar':{StatusBar:'StatusBar'},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0,bottom:0})},
  '@/components/WelcomeLogoAnimation':{WelcomeLogoAnimation:'WelcomeLogoAnimation'},'./m1-gold-standard':goldModel,'@/components/m1-gold-standard':goldModel,
  '@/context/LocalizationContext':{useLocale:()=>({locale,setLocale:()=>saved++,t:(key,args)=>translate(locale,key,args)})},
  '@/i18n':{RELEASE_LOCALE_OPTIONS:(await import('../i18n.ts')).RELEASE_LOCALE_OPTIONS},
 },f.globals);
 f.rendered.render(f.rendered.React.createElement(e.WelcomeExperience,{reviewing:false,onBegin:()=>begun++,onClose(){throw Error('UNEXPECTED_CLOSE')}}));await f.rendered.flush();
 const button=f.rendered.byId('welcome-begin');equal(button.props.accessibilityRole,'button');equal(button.props.accessibilityLabel,translate(locale,'welcomeBegin'));
 ok(f.rendered.byId('m1-greeting'),'greeting below glyph');button.props.onPress();button.props.onPress();equal(saved,1);
 f.callbacks.splice(0).forEach(cb=>cb({finished:true}));equal(begun,1);f.rendered.unmount();f.callbacks.splice(0).forEach(cb=>cb({finished:true}));equal(begun,1);
}
s31Groups.push('S32_EIGHT_LOCALE_BEGIN_SINGLE_WRITER_CALLBACK');

const zlibS32=await import('node:zlib');
function decodeS32Png(bytes){
 let pos=8,parts=[],width,height,depth,ct;
 while(pos<bytes.length){let n=bytes.readUInt32BE(pos),t=bytes.toString('ascii',pos+4,pos+8),d=bytes.subarray(pos+8,pos+8+n);if(t==='IHDR'){width=d.readUInt32BE(0);height=d.readUInt32BE(4);depth=d[8];ct=d[9];}if(t==='IDAT')parts.push(d);pos+=n+12;}
 if(depth!==8||![2,6].includes(ct))throw Error('PNG_FORMAT');let bpp=ct===6?4:3,stride=width*bpp,raw=zlibS32.inflateSync(Buffer.concat(parts)),out=Buffer.alloc(width*height*4),prev=Buffer.alloc(stride),at=0;
 for(let y=0;y<height;y++){let filter=raw[at++],row=Buffer.from(raw.subarray(at,at+stride));at+=stride;for(let x=0;x<stride;x++){let a=x>=bpp?row[x-bpp]:0,b=prev[x],c=x>=bpp?prev[x-bpp]:0,v=0;if(filter===1)v=a;if(filter===2)v=b;if(filter===3)v=(a+b)>>1;if(filter===4){let q=a+b-c,pa=Math.abs(q-a),pb=Math.abs(q-b),pc=Math.abs(q-c);v=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}row[x]=(row[x]+v)&255;}for(let x=0;x<width;x++){let i=(y*width+x)*4,j=x*bpp;out[i]=row[j];out[i+1]=row[j+1];out[i+2]=row[j+2];out[i+3]=bpp===4?row[j+3]:255;}prev=row;}return{width,height,rgba:out};
}
const pixelVis=decodeS32Png(await readFile(path.join(app,'assets/images/m1_molded_white_gold_visual_v2_zero_halo_480.png')));
const pixelTim=decodeS32Png(await readFile(path.join(app,'assets/images/m1_pen_stroke_timing_map_v2_zero_halo_480.png')));
let pixels;const paint=goldModel.createGoldRenderer(pixelVis.rgba,pixelTim.rgba,b=>pixels=Buffer.from(b));
let earlyCount=0,fullCount=0,zeroHaloChecks=0;
paint(.11,1,0,0,0);const early=Buffer.from(pixels);
paint(1,1,0,0,0);
for(let i=0;i<480*480;i++){const k=i*4,t=pixelTim.rgba[k];if(early[k+3])earlyCount++;if(pixels[k+3])fullCount++;
 if(!Math.max(pixelVis.rgba[k],pixelVis.rgba[k+1],pixelVis.rgba[k+2])){equal(pixels[k+3],0,'zero-halo outside stroke');zeroHaloChecks++;}
 if(t&&((t-1)/254)>.126)equal(early[k+3],0,'unwritten stem/zeros stay absent at .33s');
}
ok(earlyCount>0&&earlyCount<fullCount*.3,'real V2 pixels begin only at first hook');
ok(fullCount>1000&&zeroHaloChecks>1000,'real V2 full calligraphy and transparent exterior');
paint(1,0,0,0,0);ok(!pixels.some(Boolean),'full dissolve contains no residual grey rectangle');
s31Groups.push('S32_ACTUAL_V2_PIXEL_NO_EARLY_STEM_AND_ZERO_HALO');

ok(opening.includes('const sunriseImage = welcomeImage;'),'same mountain in both phases');
ok(opening.includes('<ClipPath')&&opening.includes('<Polygon'),'native SVG ridge occlusion');
ok(opening.includes('outputRange: [0, 0, 0]'),'auxiliary sun remains off');
ok(opening.includes('opacity:goalReveal'),'cross fade follows existing transition');
ok(opening.includes('underlineColorAndroid="transparent"'),'native input underline removed');
for(const guard of ['testID="opening-goal-dismiss-area"','disabled={!inputFocused}','keyboardShouldPersistTaps="handled"','automaticallyAdjustKeyboardInsets={false}','if (draftIsCurrent() && !m2.disabled && inputValue.trim())'])ok(opening.includes(guard),'keyboard/currentness guard retained: '+guard);
s31Groups.push('M1_M2_PLATES_AND_EXISTING_KEYBOARD_CURRENTNESS_GUARDS');

{
 const f=animationFixture31();
 const e=loadPresentation31(path.join(app,'components/W01ProductCard.tsx'),f.rendered,f.native,{
  '@/i18n-m6':await import('../i18n-m6.ts'),'./w01-product-controller':await import('../components/w01-product-controller.ts'),
 },f.globals);
 const component=e.__ring;
 f.rendered.render(f.rendered.React.createElement(component,{active:false,color:'#172B20'}));await f.rendered.flush();
 equal(f.rendered.byId('w01-living-ring'),undefined);equal(f.loopStarts,0,'idle cannot imply a live walk');
 f.rendered.render(f.rendered.React.createElement(component,{active:true,color:'#172B20'}));await f.rendered.flush();
 ok(f.rendered.byId('w01-living-ring'));ok(f.loopStarts>0);
 f.visibility(true);f.rendered.render();ok(f.loopStops>0,'background stops ring');
 f.visibility(false);f.rendered.render();
 f.motionListeners.forEach(cb=>cb(true));f.rendered.render();const starts=f.loopStarts;
 f.rendered.render(f.rendered.React.createElement(component,{active:false,color:'#172B20'}));
 equal(f.rendered.byId('w01-living-ring'),undefined);equal(f.loopStarts,starts);
 f.rendered.unmount();equal(f.stateListeners.size,0);equal(f.motionListeners.size,0);
 s31Groups.push('W01_ACTUAL_LOCAL_STATE_RING_START_STOP_REDUCED_UNMOUNT');
}

console.log('S31_RESULT '+JSON.stringify({status:'PASS_CODE_OFFLINE_PRESENTATION',groups:s31Groups,locales:8,native:0,provider:0,network:0,limits:'Actual component functions with controlled React/Animated clock; no pixels, physical device, browser, native layout or visual/UX acceptance.'}));

// S38: actual bounded request interpreter -> actual useM2Gateway -> actual CoachPresencePanel.
const request38=await import('../i18n-coach-presence.ts');
const meaning38=await import('../domain/m3/deterministic-semantics.ts');
function hookRuntime38() {
  const slots = [];
  let cursor = 0;
  const effects = [];
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (next) => {
        slots[index].value = typeof next === 'function' ? next(slots[index].value) : next;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: { current: initial } };
      return slots[index].value;
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      cursor++;
      return getSnapshot();
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || dependencies.some((value, at) => !Object.is(value, previous.dependencies[at]))) {
        effects.push({ index, effect, dependencies });
      }
    },
    useLayoutEffect(effect, dependencies) {
      hooks.useEffect(effect, dependencies);
    },
  };
  return {
    hooks,
    slots,
    cleanupEffects() {
      for (let index = slots.length - 1; index >= 0; index--) {
        if (slots[index]?.cleanup) {
          slots[index].cleanup();
          slots[index] = undefined;
        }
      }
    },
    render(fn) {
      cursor = 0;
      effects.length = 0;
      const view = fn();
      for (const { index, effect, dependencies } of effects) {
        slots[index]?.cleanup?.();
        slots[index] = { dependencies, cleanup: effect() };
      }
      return view;
    },
  };
}


const hooks38=registerHooks({resolve(specifier,context,next){
 if(specifier==='react')return{url:'data:text/javascript,'+encodeURIComponent(['useState','useRef','useEffect','useLayoutEffect','useSyncExternalStore'].map(n=>'export const '+n+'=(...a)=>globalThis.__s38hooks.'+n+'(...a);').join('')),shortCircuit:true};
 if(specifier==='./cameraC0Picker'&&context.parentURL?.endsWith('/useM2Gateway.ts'))return{url:'data:text/javascript,export const expoCameraC0Picker=globalThis.__s38picker;',shortCircuit:true};
 if(specifier==='./CameraLocalPreview.tsx'&&context.parentURL?.endsWith('/useM2Gateway.ts'))return{url:'data:text/javascript,export const createCameraLocalPreviewHandle=()=>()=>null;',shortCircuit:true};
 if(specifier==='./coach-presence-flow'&&context.parentURL?.endsWith('/useM2Gateway.ts'))return{url:'data:text/javascript,'+encodeURIComponent('import {createCoachPresenceFlow as real,coachTaskDomains} from '+JSON.stringify(new URL('../components/coach-presence-flow.ts',import.meta.url).href)+';export {coachTaskDomains};export const createCoachPresenceFlow=o=>real({...o,runtime:globalThis.__s38runtime});'),shortCircuit:true};
 if(specifier==='expo-file-system/legacy')return{url:'data:text/javascript,export const cacheDirectory="file:///s38/";export const getInfoAsync=async()=>({exists:false});export const deleteAsync=async()=>{};',shortCircuit:true};
 if(specifier==='@workspace/api-client-react')return{url:'data:text/javascript,export const aiM3=()=>{throw Error("S38_EXTERNAL_CLIENT_FORBIDDEN")};export const aiM3Permission=aiM3;export const aiPilotSession=aiM3;',shortCircuit:true};
 if(specifier.startsWith('@/'))return next(new URL('../'+specifier.slice(2)+'.ts',import.meta.url).href,context);
 return next(specifier.startsWith('.')&&!path.extname(specifier)?specifier+'.ts':specifier,context);
}});
process.env.EXPO_PUBLIC_M3_RUNTIME_MODE='fixture';
globalThis.__s38hooks=hookRuntime38().hooks;
globalThis.__s38picker={requestCameraPermission:async()=>'granted',takePhoto:async()=>({canceled:false,asset:{uri:'file:///S38_SYNTHETIC.jpg',width:2,height:2}}),choosePhoto:async()=>({canceled:false,asset:{uri:'file:///S38_SYNTHETIC.jpg',width:2,height:2}})};
const gateway38=await import('../components/useM2Gateway.ts');
const input38=(locale,text,patch={})=>({locale,current_text:text,relevant_context:[],user_correction:null,asking_stopped:false,safety_signal:'CLEAR',...patch});
let cases38=0;
for(const locale of Object.keys(request38.coachRequestMessages))for(const [i,row]of request38.coachRequestMessages[locale].entries()){
 const interpreted=meaning38.resolveDeterministicM3(input38(locale,row[0]));
 equal(interpreted.intent_type,'CURRENT_TASK');equal(interpreted.task_kind,['meal_image_assessment','exercise_form_observation','physique_posture_observation'][i]);equal(interpreted.response,row[2]);equal(interpreted.interpreted_meaning,row[1]);equal(interpreted.suggested_next_role,'M4');
 if(!['vi','en'].includes(locale)){ok(row[2]!==request38.coachRequestMessages.en[i][2]);ok(row[2]!==request38.coachRequestMessages.vi[i][2]);}
 equal(request38.readCoachRequest(locale,'not an admitted request'),undefined);
 const boundary=createLocalOwnerBoundary({verify:async()=>({status:'verified',owner:{subjectId:'s38_owner',profileId:'s38_profile'},validUntil:Date.now()+60000})});
 const lease=await boundary.control.verifySession();boundary.control.finishHydration(lease);
 const runtime=hookRuntime38();globalThis.__s38hooks=runtime.hooks;let simulated=0,state='CONSENT_REQUIRED';
 globalThis.__s38runtime=async()=>({allowAndPrepare:async()=>{simulated++;state='READY_NOT_SENT';return true;},analyze:async()=>{state='PROPOSAL';return true;},view:()=>({state,proposal:state==='PROPOSAL'?{result:{state:'OBSERVATIONS',cues:[]}}:undefined}),revoke:()=>{state='CONSENT_REQUIRED'},retire:()=>{state='CONSENT_REQUIRED'},settleCleanup:async()=>true,settleRevocations:async()=>true});
 const gateway={snapshot:{revision:'1',subject:{id:'s38_owner',loading:'ready',profile:'unknown'},permission:{status:'allowed',revision:'1'},safety:'clear',goal:'unknown',explicitIntent:false,activeTask:{kind:'unknown'},returning:{kind:'unknown'}},m3StubAdapter:{provenance:'TEST_FIXTURE',processing:'ON_DEVICE',contract:'M3_GATEWAY_V1',interpret:async ({content,operation},signal)=>{if(signal.aborted||!operation.isCurrent())throw Error('S38_STALE_OPERATION');return meaning38.resolveDeterministicM3(content)},revoke:async()=>{}}};
 const binding38={access:boundary.access,lease,authorization:{withBearer:async(signal,use)=>{boundary.access.requireLease(lease);if(signal.aborted)throw Error('S38_ABORTED');const result=await use('Bearer S38_SYNTHETIC_TEST_FIXTURE');boundary.access.requireLease(lease);if(signal.aborted)throw Error('S38_ABORTED');return result;}}};const render=()=>runtime.render(()=>gateway38.useM2Gateway(gateway,locale,key=>translate(locale,key),binding38,undefined,'OWNED'));
 try{let view=render();view.changeText(row[0]);view=render();await view.submit();await wait26();render();view=render();ok(view.coachPresence,'actual gateway exposes domain '+locale+i);equal(view.coachPresence.model.domain,['meal','exercise_form','physique_posture'][i]);
 const panel=()=>{const v=render();return{v,tree:module.exports.CoachPresencePanel({flow:v.coachPresence.flow,model:v.coachPresence.model,locale})};};
 const press=async id=>{const {tree}=panel(),button=flatten(tree).find(x=>x.props?.testID===id);ok(button,'actual panel button '+id);equal(Boolean(button.props.disabled),false);button.props.onPress();await wait26();render();render();};
 await press('coach-choose');await press('coach-use');equal(simulated,0);await press('coach-c1');equal(simulated,0);await press('coach-c2');equal(simulated,1);await press('coach-analyze');await press('coach-m5-choice');const v=render();equal(v.coachPresence.model.selected,true);equal(v.coachPresence.model.M6_STARTED,false);equal(v.coachPresence.model.M7_USE_NEXT_CYCLE,false);await press('coach-revoke');equal(render().coachPresence.model.c1,false);cases38++;
 }finally{runtime.cleanupEffects();boundary.control.invalidateCurrentSession();}
}
hooks38.deregister();
// M7 question punctuation is checked on the actual current-report component in all8 locales.
{const f=await ownerFixture28(ownerA28,memory26());try{const live=await completeReport28(f),rendered=renderer27(),file=path.join(app,'components/M7RecordCard.tsx'),m={exports:{}};new vm.Script('(function(require,module,exports){'+transpile(file,await readFile(file,'utf8'))+'\n})').runInNewContext({})(name=>name==='react'?rendered.React:name==='react-native'?{Pressable:'Pressable',TextInput:'TextInput',Text:'Text',View:'View',StyleSheet:{create:x=>x}}:name==='@/i18n-m7-record'?m7Copy28:(()=>{throw Error('S38_CARD_IMPORT '+name)})(),m,m.exports);for(const locale of Object.keys(request38.coachRequestMessages)){rendered.render(rendered.React.createElement(m.exports.M7RecordCard,{presentation:live.record.presentation(),locale,color:'#111',border:'#222'}));const text=rendered.text(rendered.tree);ok(rendered.byId('m7-record-current-report'));ok(!/[?？]:/u.test(text),'no doubled question colon '+locale);ok(text.includes(m7Copy28.M7_RECORD_COPY[locale].extent));}rendered.unmount();}finally{f.dispose();}}
console.log('S38_RESULT '+JSON.stringify({camera_gateway_panel_cases:cases38,m7_locales:8,real_provider_calls:0,network:0,scope:'CODE_OFFLINE actual gateway/panel with admitted native/provider ports; not browser or production proof'}));

const settings38=[];
for(const action of ['RETURN','REVOKE','LOGOUT','REVIEW']){
 const x=await rootFixture29({realWelcome:true,showOpening:true});try{
 equal(await x.login('A'),'ready');x.opening.onGoalOpened();await x.settle();const gateway=x.opening.m2Gateway,run=x.welcome.runId,lease=x.probe.binding.lease;
 x.opening.onOpenSettings();await x.settle();equal(x.routes38.at(-1),'/privacy');equal(x.welcome.goalSettingsSuspended,true);equal(x.welcome.goalSettingsActive,true);ok(x.rendered.byId('privacy-return-to-goal'));equal(x.probe.binding.lease,lease);equal(x.opening.m2Gateway,gateway);
 if(action==='REVIEW'){x.welcome.showWelcome();await x.settle();equal(x.welcome.runId,run);ok(x.settingsReview?.reviewing);x.settingsReview.onClose();await x.settle();equal(x.welcome.reviewing,false);equal(x.welcome.goalSettingsSuspended,true);}
 if(action==='REVOKE'){gateway.setM3Access(false);await x.settle();equal(x.opening.m2Gateway.m3Access.status,'denied');}
 if(action==='LOGOUT'){await x.probe.control.logout();await x.settle();equal(x.probe.binding,undefined);}
 await x.press('privacy-return-to-goal');equal(x.routes38.at(-1),'/');equal(x.welcome.goalSettingsSuspended,false);equal(x.welcome.runId,run);
 if(action==='LOGOUT'){equal(x.probe.binding,undefined);ok(x.opening.m3HostMode!=='OWNED');}else equal(x.probe.binding.lease,lease);
 if(action==='RETURN'||action==='REVIEW')equal(x.opening.m2Gateway,gateway,'settings never remounts gateway');settings38.push(action);
 }finally{x.dispose()}
}
console.log('S38_SETTINGS_RESULT '+JSON.stringify({cases:settings38,status:'PASS_CODE_OFFLINE_ACTUAL_WELCOME_ROOT_PRIVACY',scope:'Actual source context/root/privacy with simulated native/HTTP ports; real browser still separate'}));

// S39: exact translated return label + real local technical lease versus real connected owner.
const labels39={"vi":"Quay lại mục tiêu","en":"Back to goal","zh-Hans":"返回目标","es":"Volver al objetivo","hi":"लक्ष्य पर वापस जाएँ","ja":"目標に戻る","ko":"목표로 돌아가기","ru":"Вернуться к цели"};
const authority39=await import('../dev/local-verification/authority.ts');
const random39=(await import('node:crypto')).randomBytes;
const cases39=[];
for(const locale of Object.keys(labels39))for(const realm of ['TECHNICAL','CONNECTED']){
 const origin='http://127.0.0.1:18110';
 const authority=realm==='TECHNICAL'?authority39.createLocalVerificationAuthority({origin,browserOrigin:origin,randomBytes:random39}):undefined;
 const x=await rootFixture29({realWelcome:true,showOpening:true,locale,origin,localAuthority:authority,
   ...(realm==='TECHNICAL'?{env:{EXPO_PUBLIC_LOCAL_VERIFICATION:'1',EXPO_PUBLIC_M3_RUNTIME_MODE:'local-verification',EXPO_PUBLIC_LOCAL_AUTHORITY_ORIGIN:origin}}:{})});
 try{
  if(realm==='TECHNICAL'){
   ok(x.probe.control.localVerification,'actual technical coordinator');equal(await x.probe.control.localVerification.createSession(),true);await x.settle();
  }else equal(await x.login('A'),'ready');
  equal(x.probe.control.state,'ready');ok(x.probe.binding,'opaque live lease, not a mocked state field');
  equal(Boolean(x.probe.control.localVerification),realm==='TECHNICAL');
  x.opening.onGoalOpened();await x.settle();x.opening.onOpenSettings();await x.settle();equal(x.routes38.at(-1),'/privacy');
  const back=x.rendered.byId('privacy-return-to-goal');ok(back);const label=x.rendered.text(back);equal(label,labels39[locale]);equal(translate(locale,'privacyReturnToGoal'),labels39[locale]);ok(label!==translate(locale,'m2Return'));
  if(locale!=='en')ok(label!==labels39.en,'no English fallback '+locale);
  for(const id of ['forget-coaching','settings-change-coaching-direction']){
    const control=x.rendered.byId(id);ok(control,'real private control '+id);equal(control.props.disabled,realm==='TECHNICAL','scoped guard '+locale+realm+id);
  }
  if(realm==='TECHNICAL'){equal(x.rendered.byId('privacy-account-delete-trigger').props.disabled,true);equal(x.probe.history.snapshot.phase,'RAM_ONLY');}
  else ok(x.probe.control.erasureScope,'real connected owner stays authorized');
  await x.press('privacy-return-to-goal');equal(x.routes38.at(-1),'/');equal(x.welcome.goalSettingsSuspended,false);
  cases39.push({locale,realm,label,status:'PASS_ACTUAL_MOUNTED_PRIVACY_WITH_REAL_COORDINATOR_AND_LEASE'});
 }finally{x.dispose();authority?.dispose();}
}
console.log('S39_RESULT '+JSON.stringify({cases:cases39,locales:8,real_provider_calls:0,network:0,scope:'Actual source Root/Welcome/Privacy + real local technical or connected owner client/coordinator; admitted in-memory HTTP transport, not browser proof'}));
