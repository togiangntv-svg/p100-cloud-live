import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import {C2_POLICY,C2_DOMAINS,C2_IMAGE_LIMIT,readPermissionCommand,validateCoachVisionOutput} from '../../../lib/api-zod/src/c2-vision.ts';
import {sanitizeC2Jpeg} from '../../../lib/api-zod/src/c2-jpeg.ts';
import {createVisionTaskConsentAuthority} from '../../api-server/src/ai/c2-permission.ts';
import {createC2Handlers} from '../../api-server/src/ai/c2-operation.ts';
import {createSanitizedVisionImagePreparer} from '../lib/camera/expo-image-preparer.ts';
import {createCoachPresenceC2Runtime} from '../lib/camera/c2-runtime.ts';
import {createLocalOwnerBoundary} from '../domain/local-owner/boundary.ts';
import {resolveCoachPresenceM4} from '../domain/m4/coach-presence.ts';
import {proposeCoachPresence} from '../domain/m5/coach-presence.ts';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const unit=path.resolve(app,'../../../..');
const admission=JSON.parse(await readFile(path.join(unit,'ACK_AND_ADMISSION.json'),'utf8'));
const decoderBytes=await readFile(admission.jpeg_decoder_path);
assert.equal(crypto.createHash('sha256').update(decoderBytes).digest('hex'),admission.jpeg_decoder_sha256);
const require=createRequire(import.meta.url),Jimp=require(admission.jpeg_decoder_path);
const originalJpeg=new Uint8Array(await new Jimp(2,2,0x2299bbff).getBufferAsync(Jimp.MIME_JPEG));
const decode=async b=>{const x=await Jimp.read(Buffer.from(b));return {width:x.bitmap.width,height:x.bitmap.height};};
const good=domain=>({vision_domain:domain,state:'OBSERVATIONS',cues:[C2_POLICY[domain].cues[0]],
 uncertainty:'LIMITED_2D',limitations:['SINGLE_FRAME_NOT_DIAGNOSTIC'],quality:'CLEAR_STATIC_VIEW'});
const scope=domain=>({taskSessionId:'task_session',taskId:'task_A',taskRevision:1,vision_domain:domain,
 purpose:C2_POLICY[domain].purpose,candidateId:'photo_A',c1Revision:1});
let passed=0,cases=0,now=100000,ids=0,providerCalls=0,budgetCalls=0;
const identity={sessionKey:'session_A',owner:{subjectId:'owner_A',profileId:'profile_A'},validUntil:new Date(now+300000).toISOString()};
const expected=(fn,code)=>assert.throws(fn,e=>e.code===code);
async function check(name,fn){cases++;await fn();passed++;console.log('PASS S21A_REV2 '+name);}
function fixture(domain='meal',options={}){
 let available=true,facts={...scope(domain),owner:{...identity.owner},sessionKey:identity.sessionKey,
 taskKind:C2_POLICY[domain].taskKind,m4Required:true,c1Accepted:true,sourceEpoch:1,validUntil:now+120000,provenance:'TEST_FIXTURE'};
 const listeners=new Set();const reader={read:()=>available?facts:undefined,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);}};
 const authority=createVisionTaskConsentAuthority({reader,topology:'SINGLE_AUTHORITY_PROCESS',now:()=>now,newId:()=> 'grant_'+ ++ids,...options});
 const command=(action='GRANT',extra={})=>({...scope(domain),action,operationId:'op_'+ ++ids,createdAt:now,...(action==='GRANT'?{accepted:true}:{}),...extra});
 const grant=()=>authority.permission(identity,command());
 const mutate=patch=>{facts={...facts,...patch};for(const f of [...listeners])f();};
 return {authority,command,grant,reader,mutate,get facts(){return facts;},unavailable:()=>{available=false;},
 dispose:()=>authority.dispose()};
}
const res=()=>({code:200,body:undefined,headers:{},status(n){this.code=n;return this;},json(x){this.body=x;return this;},setHeader(k,v){this.headers[k]=v;}});
const request=g=>({body:{grant:g,mime:'image/jpeg',imageBase64:Buffer.from(originalJpeg).toString('base64')}});
const handlers=(f,extra={})=>createC2Handlers({authority:f.authority,verifyIdentity:async()=>identity,
 provider:()=>({mode:'MOCK_ONLY',analyze:async input=>{providerCalls++;return good(input.grant.vision_domain);}}),
 reserve:async()=>{budgetCalls++;},decodeJpeg:decode,timeoutMs:100,...extra});
for(const domain of C2_DOMAINS){
 await check('3DOMAIN_POSITIVE_'+domain,async()=>{
  const f=fixture(domain);try{const g=f.grant();assert.equal(Object.keys(g).length,11);
   assert.equal('sessionKey' in g,false);assert.equal('subjectId' in g,false);
   const response=res();await handlers(f).vision(request(g),response);assert.equal(response.code,200);
   const p=proposeCoachPresence(domain,response.body.result);assert.equal(p.state,'PROPOSAL');
   assert.equal(p.requires_user_choice,true);assert.equal(p.M6_STARTED,false);assert.equal(p.M7_USE_NEXT_CYCLE,false);
   assert.equal(resolveCoachPresenceM4(scope(domain),{...scope(domain),taskKind:C2_POLICY[domain].taskKind,status:'READY',
    safety:'CLEAR',needsImage:true,imageAccepted:true,c1Allowed:true}),'SUFFICIENT');
  }finally{f.dispose();}
 });
 for(const quality of ['OCCLUDED','POOR_ANGLE','LOW_QUALITY'])await check('ABSTAIN_'+domain+'_'+quality,async()=>{
  const x=validateCoachVisionOutput(domain,{...good(domain),quality});assert.equal(x.state,'NEED_MORE_INFO');
  assert.equal(proposeCoachPresence(domain,x),undefined);
 });
 for(const claim of ['exact_kcal','grams','macros','spinal_load_3d','injury_diagnosis','body_fat_percent','facial_id','clinical_diagnosis','body_shaming']){
  await check('UNSAFE_'+domain+'_'+claim,async()=>assert.equal(validateCoachVisionOutput(domain,{...good(domain),[claim]:'unsafe'}).state,'BLOCKED'));
 }
}
await check('PRODUCTION_UNCONFIGURED_403_ZERO_PROVIDER',async()=>{
 const authority=createVisionTaskConsentAuthority(),before=providerCalls;
 try{const response=res();await createC2Handlers({authority,verifyIdentity:async()=>({...identity,validUntil:new Date(Date.now()+60000).toISOString()}),
 provider:()=>{throw Error('PROVIDER_MUST_NOT_BE_READ');},reserve:async()=>{throw Error('NO_BUDGET');}})
 .permission({body:{...scope('meal'),action:'GRANT',operationId:'production_req',createdAt:Date.now(),accepted:true}},response);
 assert.equal(response.code,403);assert.equal(response.body.code,'C2_SERVER_TASK_AUTHORITY_UNAVAILABLE');
 assert.equal(authority.inspect().grants,0);assert.equal(providerCalls,before);
 }finally{authority.dispose();}
});
await check('UNCONFIGURED_TOPOLOGY_403',async()=>{
 const f=fixture('meal',{topology:undefined});try{expected(()=>f.grant(),'C2_SERVER_TASK_AUTHORITY_UNAVAILABLE');}finally{f.dispose();}
});
await check('MISSING_IDENTITY_401',async()=>{
 const f=fixture();try{const response=res();await handlers(f,{verifyIdentity:async()=>undefined})
 .permission({body:f.command()},response);assert.equal(response.code,401);assert.equal(f.authority.inspect().grants,0);}finally{f.dispose();}
});
await check('INVALID_IDENTITY_401',async()=>{
 const f=fixture();try{expected(()=>f.authority.permission({...identity,validUntil:new Date(now-1).toISOString()},f.command()),'C2_AUTH_REQUIRED');}finally{f.dispose();}
});
await check('RAW_JSON_IDENTITY_AND_FIXTURE_TOGGLE_REJECTED',async()=>{
 for(const patch of [{owner:identity.owner},{sessionKey:identity.sessionKey},{provenance:'TEST_FIXTURE'},{fixture:true}]){
  const f=fixture();try{expected(()=>f.authority.permission(identity,{...f.command(),...patch}),'C2_SCHEMA');}finally{f.dispose();}
 }
});
for(const patch of [
 {taskId:'wrong'},{taskRevision:2},{candidateId:'wrong'},{c1Revision:2},
 {...scope('exercise_form')},
]){
 await check('SERVER_SCOPE_MISMATCH_'+JSON.stringify(patch),async()=>{
  const f=fixture();try{expected(()=>f.authority.permission(identity,{...f.command(),...patch}),'C2_SERVER_TASK_SCOPE_MISMATCH');}finally{f.dispose();}
 });
}
await check('WRONG_OWNER_FACTS_403',async()=>{
 const f=fixture();try{f.mutate({owner:{subjectId:'foreign',profileId:'foreign'}});expected(()=>f.grant(),'C2_SERVER_TASK_AUTHORITY_UNAVAILABLE');}finally{f.dispose();}
});
await check('MISSING_C1_OR_NECESSITY_403',async()=>{
 for(const patch of [{c1Accepted:false},{m4Required:false},{taskKind:'unrelated'}]){
  const f=fixture();try{f.mutate(patch);expected(()=>f.grant(),'C2_SERVER_TASK_AUTHORITY_UNAVAILABLE');}finally{f.dispose();}
 }
});
await check('EXPLICIT_CONSENT_FALSE_DENIED',async()=>{
 const f=fixture();try{expected(()=>f.authority.permission(identity,f.command('GRANT',{accepted:false})),'C2_EXPLICIT_CONSENT_REQUIRED');}finally{f.dispose();}
});
await check('EXPIRED_COMMAND_CANNOT_REGRANT_AFTER_REPLAY_TOMBSTONE',async()=>{
 const f=fixture();try{expected(()=>f.authority.permission(identity,f.command('GRANT',{createdAt:now-30001})),'C2_COMMAND_EXPIRED');
 expected(()=>f.authority.permission(identity,f.command('GRANT',{createdAt:now+5001})),'C2_COMMAND_EXPIRED');}finally{f.dispose();}
});
await check('REPLAY_REJECTED',async()=>{
 const f=fixture();try{const c=f.command();f.authority.permission(identity,c);expected(()=>f.authority.permission(identity,c),'C2_REPLAY');}finally{f.dispose();}
});
for(const field of ['consentRevision','authorityEpoch','candidateId','taskRevision','c1Revision','c2GrantId']){
 await check('GRANT_TAMPER_'+field,async()=>{
  const f=fixture();try{const g=f.grant();expected(()=>f.authority.begin(identity,{...g,[field]:typeof g[field]==='number'?g[field]+1:'tampered'}),'C2_GRANT_INVALID');}finally{f.dispose();}
 });
}
await check('EXPIRE_RETIRES',async()=>{
 const f=fixture();const saved=now;try{const g=f.grant();now=g.expiresAt+1;expected(()=>f.authority.begin(identity,g),'C2_GRANT_INVALID');assert.equal(f.authority.inspect().grants,0);}finally{now=saved;f.dispose();}
});
await check('OWNER_TASK_ABA_ABORTS_OLD_OPERATION',async()=>{
 const f=fixture();try{const g=f.grant(),op=f.authority.begin(identity,g);
  f.mutate({taskId:'task_B',sourceEpoch:2});f.mutate({taskId:'task_A',sourceEpoch:3});
  assert.equal(op.signal.aborted,true);expected(()=>f.authority.assertCurrent(op,identity),'C2_OPERATION_RETIRED');
  const fresh=f.grant();assert.ok(fresh.authorityEpoch>g.authorityEpoch);expected(()=>f.authority.begin(identity,g),'C2_GRANT_INVALID');
 }finally{f.dispose();}
});
await check('CROSS_DOMAIN_CANDIDATE_REUSE_REQUIRES_NEW_PHOTO',async()=>{
 const f=fixture();try{f.grant();const other={...scope('exercise_form'),taskRevision:2,c1Revision:2};
 f.mutate({...other,taskKind:C2_POLICY.exercise_form.taskKind,sourceEpoch:2});
 expected(()=>f.authority.permission(identity,f.command('GRANT',other)),'C2_CANDIDATE_DOMAIN_REUSE');
 f.mutate({candidateId:'photo_NEW',sourceEpoch:3});
 assert.equal(f.authority.permission(identity,f.command('GRANT',{...other,candidateId:'photo_NEW'})).vision_domain,'exercise_form');
 }finally{f.dispose();}
});
await check('SAME_EPOCH_CHANGED_FACT_FAILS_CLOSED',async()=>{
 const f=fixture();try{f.grant();f.mutate({candidateId:'photo_B'});expected(()=>f.authority.permission(identity,
 f.command('GRANT',{candidateId:'photo_B'})),'C2_TASK_EPOCH_REPLAY');}finally{f.dispose();}
});
await check('REVOKE_WITH_UNAVAILABLE_READER_ABORTS',async()=>{
 const f=fixture();try{const g=f.grant(),op=f.authority.begin(identity,g);f.unavailable();
  assert.equal(f.authority.permission(identity,f.command('REVOKE',{c2GrantId:g.c2GrantId})).revoked,true);
  assert.equal(op.signal.aborted,true);assert.equal(f.authority.inspect().grants,0);
 }finally{f.dispose();}
});
await check('FOREIGN_REVOKE_CANNOT_RETIRE_OWNER',async()=>{
 const f=fixture();try{const g=f.grant();expected(()=>f.authority.permission({...identity,owner:{subjectId:'other',profileId:'other'}},
 f.command('REVOKE',{c2GrantId:g.c2GrantId})),'C2_GRANT_NOT_OWNED');assert.equal(f.authority.inspect().grants,1);}finally{f.dispose();}
});
await check('LOGOUT_RETIRES_ALL_OWN_OPERATIONS',async()=>{
 const f=fixture();try{const g=f.grant(),op=f.authority.begin(identity,g);f.authority.retireSession(identity.sessionKey);assert.equal(op.signal.aborted,true);}finally{f.dispose();}
});
await check('REVOKE_DURING_PROVIDER_IGNORE_ABORT_NO_STALE_OUTPUT',async()=>{
 const f=fixture();try{const g=f.grant();let release,started;
  const began=new Promise(r=>started=r),deferred=new Promise(r=>release=r);
  const response=res(),running=handlers(f,{provider:()=>({mode:'MOCK_ONLY',analyze:async()=>{providerCalls++;started();return deferred;}})}).vision(request(g),response);
  await began;f.authority.permission(identity,f.command('REVOKE',{c2GrantId:g.c2GrantId}));release(good('meal'));await running;
  assert.equal(response.code,409);assert.equal(response.body.result,undefined);
 }finally{f.dispose();}
});
await check('REVOKE_AFTER_RESPONSE_BEFORE_OUTPUT',async()=>{
 const f=fixture();try{const g=f.grant();let reads=0;const response=res();
  await handlers(f,{verifyIdentity:async()=>{reads++;if(reads===4)f.authority.retireSession(identity.sessionKey);return identity;}})
   .vision(request(g),response);assert.equal(response.code,403);assert.equal(response.body.result,undefined);
 }finally{f.dispose();}
});
await check('BUDGET_DENIAL_ZERO_SEND',async()=>{
 const f=fixture();try{const g=f.grant(),before=providerCalls,response=res();
  await handlers(f,{reserve:async()=>{throw Object.assign(new Error('budget'),{name:'UNTRUSTED'});}}).vision(request(g),response);
  assert.equal(response.code,503);assert.equal(providerCalls,before);
 }finally{f.dispose();}
});
await check('TIMEOUT_NO_DANGLING_OPERATION',async()=>{
 const f=fixture();try{const response=res();await handlers(f,{timeoutMs:5,provider:()=>({mode:'MOCK_ONLY',analyze:()=>new Promise(()=>{})})})
 .vision(request(f.grant()),response);assert.equal(response.code,409);assert.equal(f.authority.inspect().operations,0);}finally{f.dispose();}
});
await check('PROVIDER_RATE_OR_ERROR_NO_PAYLOAD_LOG',async()=>{
 const f=fixture();try{const response=res();await handlers(f,{provider:()=>({mode:'MOCK_ONLY',analyze:async()=>{throw Error('429 secret-image-base64');}})})
 .vision(request(f.grant()),response);assert.equal(response.code,503);assert.deepEqual(response.body,{code:'C2_UNAVAILABLE'});}finally{f.dispose();}
});
await check('UNSAFE_PROVIDER_REJECTED',async()=>{
 const f=fixture();try{const response=res();await handlers(f,{provider:()=>({mode:'MOCK_ONLY',analyze:async()=>({...good('meal'),exact_kcal:123})})})
 .vision(request(f.grant()),response);assert.equal(response.code,502);}finally{f.dispose();}
});
await check('BODY_DECODED_LIMIT_HTTP413',async()=>{
 const f=fixture();try{const req=request(f.grant());req.body.imageBase64=Buffer.alloc(C2_IMAGE_LIMIT+1).toString('base64');
 const response=res();await handlers(f).vision(req,response);assert.equal(response.code,413);}finally{f.dispose();}
});
await check('MALFORMED_IMAGE_REJECTED',async()=>{
 const f=fixture();try{const req=request(f.grant());req.body.imageBase64='not_base64';
 const response=res();await handlers(f).vision(req,response);assert.equal(response.code,400);}finally{f.dispose();}
});
function segment(marker,data){const b=Buffer.from(data);return Buffer.concat([Buffer.from([255,marker,(b.length+2)>>8,(b.length+2)&255]),b]);}
function insert(...parts){return new Uint8Array(Buffer.concat([Buffer.from(originalJpeg.slice(0,2)),...parts,Buffer.from(originalJpeg.slice(2))]));}
await check('JPEG_BASELINE_DECODE',async()=>{
 const clean=sanitizeC2Jpeg(originalJpeg);assert.deepEqual(await decode(clean.bytes),{width:2,height:2});
});
await check('EXIF_GPS_XMP_COM_STRIPPED_AND_DECODABLE',async()=>{
 const b=insert(segment(225,Buffer.from('Exif\0GPS TEST_SYNTHETIC')),segment(225,Buffer.from('http://ns.adobe.com/xap/1.0/\0XMP')),segment(254,Buffer.from('private COM')));
 const clean=sanitizeC2Jpeg(b);assert.equal(clean.removed,3);assert.equal(Buffer.from(clean.bytes).includes(Buffer.from('GPS')),false);
 assert.deepEqual(await decode(clean.bytes),{width:2,height:2});assert.deepEqual(clean.bytes,originalJpeg);
});
await check('ICC_BYTES_RETAINED_WITH_DECODABILITY_NOT_COLOR_CLAIM',async()=>{
 const icc=segment(226,Buffer.concat([Buffer.from('ICC_PROFILE\0'),Buffer.from([1,1]),Buffer.from('synthetic-ICC-bytes')]));
 const clean=sanitizeC2Jpeg(insert(icc,segment(225,Buffer.from('Exif\0GPS'))));
 assert.equal(Buffer.from(clean.bytes).includes(icc),true);assert.deepEqual(await decode(clean.bytes),{width:2,height:2});
});
await check('BAD_ICC_PROGRESSIVE_UNKNOWN_OR_TRUNCATED_REJECTED',async()=>{
 for(const b of [insert(segment(226,Buffer.from('bad ICC'))),insert(segment(227,Buffer.from('metadata'))),
  originalJpeg.slice(0,-1),new Uint8Array([0,1,2]),new Uint8Array([...originalJpeg,1])]){
   assert.throws(()=>sanitizeC2Jpeg(b));
 }
});
await check('SERVER_REJECTS_UNSANITIZED_EXIF',async()=>{
 const f=fixture();try{const req=request(f.grant());req.body.imageBase64=Buffer.from(insert(segment(225,Buffer.from('Exif\0GPS')))).toString('base64');
 const response=res();await handlers(f).vision(req,response);assert.equal(response.code,400);assert.equal(response.body.code,'C2_UNSANITIZED_IMAGE');}finally{f.dispose();}
});
function imageFixture({deleteOk=true,saveOriginal=false,failWrite=false}={}){
 let bytes=insert(segment(225,Buffer.from('Exif\0GPS'))),deleted=0;
 const io={canDeleteOwnedCache:uri=>uri===undefined||uri==='file:///cache/owned.jpg',
 deleteOwnedCache:async uri=>{assert.equal(uri,'file:///cache/owned.jpg');deleted++;return deleteOk;},
 readOwnedCache:async()=>bytes.slice(),writeOwnedCache:async(_,b)=>{if(failWrite)throw Error('write failed');bytes=b.slice();},decodeJpeg:decode};
 const rendered={width:2,height:2,saveAsync:async()=>({uri:saveOriginal?'file:///original.jpg':'file:///cache/owned.jpg',width:2,height:2})};
 const runtime={SaveFormat:{JPEG:'jpeg'},ImageManipulator:{manipulate:()=>({resize(){return this;},renderAsync:async()=>rendered})}};
 return {preparer:createSanitizedVisionImagePreparer(io,runtime),deleted:()=>deleted};
}
await check('PREPARER_SANITIZES_READBACK_NEVER_ORIGINAL',async()=>{
 const f=imageFixture(),token=await f.preparer.prepare('file:///original.jpg',()=>true);
 assert.deepEqual(f.preparer.bytes(token),originalJpeg);f.preparer.retire();assert.equal(await f.preparer.settleCleanup(),true);assert.equal(f.deleted(),1);
});
await check('PREPARER_FAIL_CLOSED_NO_IO_OR_ORIGINAL_FALLBACK',async()=>{
 await assert.rejects(createSanitizedVisionImagePreparer().prepare('file:///original.jpg',()=>true));
 const f=imageFixture({saveOriginal:true});await assert.rejects(f.preparer.prepare('file:///original.jpg',()=>true));assert.equal(f.deleted(),0);
});
await check('CLEANUP_FAILURE_HONEST_AND_NO_NEXT_PREPARE',async()=>{
 const f=imageFixture({deleteOk:false}),token=await f.preparer.prepare('file:///original.jpg',()=>true);
 assert.ok(f.preparer.bytes(token));f.preparer.retire();assert.equal(await f.preparer.settleCleanup(),false);
 assert.equal(f.preparer.cleanupStatus().failed,true);await assert.rejects(f.preparer.prepare('file:///original.jpg',()=>true));
});
await check('WRITE_FAILURE_CLEANS_OWNED_ONLY',async()=>{
 const f=imageFixture({failWrite:true});await assert.rejects(f.preparer.prepare('file:///original.jpg',()=>true));await f.preparer.settleCleanup();assert.equal(f.deleted(),1);
});
async function clientFixture(domain='meal'){
 const f=fixture(domain),image=imageFixture();
 const boundary=createLocalOwnerBoundary({verify:async()=>({status:'verified',owner:identity.owner,validUntil:Date.now()+60000})});
 const lease=await boundary.control.verifySession();boundary.control.finishHydration(lease);
 let live={access:boundary.access,lease,scope:scope(domain),localUri:'file:///original.jpg',epoch:1,
 task:{...scope(domain),taskKind:C2_POLICY[domain].taskKind,status:'READY',safety:'CLEAR',needsImage:true,imageAccepted:true,c1Allowed:true}};
 let held,release;
 const controller=await createCoachPresenceC2Runtime({now:()=>now,readCurrent:()=>live,preparer:image.preparer,
 permission:async liveScope=>{const r=res();await handlers(f).permission({body:{...f.command(),...liveScope}},r);if(r.code!==200)throw Error('PERMISSION_'+r.code);return r.body;},
 revokeGrant:async grant=>{const r=res();await handlers(f).permission({body:f.command('REVOKE',{c2GrantId:grant.c2GrantId})},r);return r.code===200&&r.body.revoked===true;},
 send:async(grant,bytes)=>{
  if(held)await held;
  const r=res();await handlers(f).vision({body:{grant,mime:'image/jpeg',imageBase64:Buffer.from(bytes).toString('base64')}},r);
  if(r.code!==200)throw Error('VISION_'+r.code);return r.body;
 }});
 return {controller,f,image,boundary,setLive:x=>{live=x;},get live(){return live;},
 hold:()=>{held=new Promise(r=>release=r);},release:()=>release?.(),dispose:async()=>{controller.retire();boundary.control.invalidateCurrentSession();await controller.settleRevocations();f.dispose();await image.preparer.settleCleanup();}};
}
for(const domain of C2_DOMAINS)await check('HEADLESS_CLIENT_'+domain,async()=>{
 const f=await clientFixture(domain);try{assert.equal(await f.controller.allowAndPrepare(false),false);
  assert.equal(await f.controller.allowAndPrepare(true),true);assert.equal(f.controller.view().state,'READY_NOT_SENT');
  assert.equal(await f.controller.analyze(),true);assert.equal(f.controller.view().proposal.state,'PROPOSAL');
  f.controller.revoke();assert.equal(f.controller.view().proposal,undefined);assert.equal(await f.controller.settleRevocations(),true);assert.equal(f.f.authority.inspect().grants,0);
 }finally{await f.dispose();}
});
await check('CLIENT_OWNER_REVOKE_AND_LATE_RESULT_REJECTED',async()=>{
 const f=await clientFixture();try{await f.controller.allowAndPrepare(true);f.hold();const running=f.controller.analyze();
 f.boundary.control.invalidateCurrentSession();f.release();assert.equal(await running,false);assert.equal(f.controller.view().proposal,undefined);}finally{await f.dispose();}
});
await check('CLIENT_TASK_ABA_AND_STALE_CALLBACK_DOES_NOT_CLEAR_B',async()=>{
 const f=await clientFixture();try{await f.controller.allowAndPrepare(true);f.hold();const old=f.controller.analyze();
 f.setLive({...f.live,epoch:2,scope:{...f.live.scope,taskId:'task_B'}});
 assert.equal(f.controller.view().proposal,undefined);
 f.setLive({...f.live,epoch:3,scope:scope('meal')});
 assert.equal(await f.controller.allowAndPrepare(true),true);
 f.release();assert.equal(await old,false);assert.equal(f.controller.view().state,'READY_NOT_SENT');
 }finally{await f.dispose();}
});
await check('PARSER_ORDER_TEXT_LIMIT_PRESERVED_AND_LOG_REDACTION',async()=>{
 const source=await readFile(path.resolve(app,'../api-server/src/app.ts'),'utf8');
 const image=source.indexOf('app.use("/api/ai/c2/vision", express.json({ limit: "1536kb", type: "application/json" }));');
 const text=source.indexOf('app.use(express.json({ limit: "32kb" }));');
 assert.ok(image>=0&&image<text);assert.ok(text<source.indexOf('app.use("/api", router)'));
 // Configuration/caller proof; no Express listener or real network HTTP is opened.
 const op=await readFile(path.resolve(app,'../api-server/src/ai/c2-operation.ts'),'utf8');
 assert.equal(/\blogger\b|console\./.test(op),false);
 const identitySource=await readFile(path.resolve(app,'../api-server/src/routes/identity.ts'),'utf8');
 assert.ok(identitySource.indexOf('productionVisionTaskConsentAuthority.retireSession')<identitySource.indexOf('revokeSession(token)'));
});
console.log('S21A_REV2_RESULT '+JSON.stringify({status:'PASS_CODE_OFFLINE_HEADLESS',cases,passed,provider_mock_calls:providerCalls,budget_reservations:budgetCalls,
 network_calls:0,production_task_producer:'UNCONFIGURED_FAIL_CLOSED',live_provider_calls:0,source_ui_edits:0,
 limitations:['HTTP413 decoded-size execution + parser-order static proof, not real Express HTTP ingress','Synthetic baseline JPEG decode/metadata/ICC-byte preservation only, native ICC color/device behavior NOT_RUN','Single authority process and TEST_FIXTURE facts only; production, distributed revocation, UI/device/User001 NOT_RUN']}));
