import { createGuardedUserStorage } from '../domain/local-owner/storage';
import { invalidateUnifiedOwnerFacts } from '../domain/m2/factual-snapshot';
import {createCameraCandidateStore,createCameraC0Controller,type CameraPickerPort} from '../domain/camera/candidate';
import {createCoachPresenceC2Runtime,type CoachPresenceLive} from '../lib/camera/c2-runtime';
import type {OwnerAccess,SessionLease} from '../domain/local-owner/boundary';
import type {VisionImageIO,createSanitizedVisionImagePreparer} from '../lib/camera/expo-image-preparer';
import type {IdentityRequestAuthorization} from '../domain/identity/client-session';
declare const process:{env:{EXPO_PUBLIC_DOMAIN?:string}};
type Domain='meal'|'exercise_form'|'physique_posture';
export const coachTaskDomains:Readonly<Record<string,Domain>>=Object.freeze({
 meal_image_assessment:'meal',exercise_form_observation:'exercise_form',physique_posture_observation:'physique_posture'});
export type CoachSource=Readonly<{key:string;domain:Domain;access:OwnerAccess;lease:SessionLease;
 authorization:IdentityRequestAuthorization;sessionId:string;taskId:string;revision:number;taskKind:string}>;
type Runtime=Awaited<ReturnType<typeof createCoachPresenceC2Runtime>>;
export type CoachFlowSnapshot=Readonly<{token:object;revision:number;sourceKey?:string;domain?:Domain;state:string;previewHandle?:unknown;hasPhoto:boolean;accepted:boolean;c1:boolean;busy:boolean;selected:boolean;cleanup:boolean;proposal?:ReturnType<Runtime['view']>['proposal'];requires_user_choice:true;M6_STARTED:false;M7_USE_NEXT_CYCLE:false}>;
export function createCoachPresenceFlow(options:Readonly<{
 current():CoachSource|undefined;picker:CameraPickerPort;
 preview?:(store:ReturnType<typeof createCameraCandidateStore>,id:string)=>unknown;
 runtime?:(live:()=>CoachPresenceLive|undefined,source:CoachSource)=>Promise<Runtime>;
}>){
 const store=createCameraCandidateStore(),picker=createCameraC0Controller(store,options.picker);
 const listeners=new Set<()=>void>();let offOwner=()=>{};let source:CoachSource|undefined,epoch=0,c1=false,busy=false,selected=false;
 let runtime:Runtime|undefined,state='EMPTY',cleanup=false;
 let snapshot:CoachFlowSnapshot=Object.freeze({token:Object.freeze({}),revision:0,state:'EMPTY',hasPhoto:false,accepted:false,c1:false,busy:false,selected:false,cleanup:false,requires_user_choice:true,M6_STARTED:false,M7_USE_NEXT_CYCLE:false});
 const valid=()=>{try{const next=options.current();if(!source||!next||next.key!==source.key||next.access!==source.access
 ||next.lease!==source.lease||next.domain!==source.domain)return undefined;
 const lease=next.access.requireLease(next.lease),owner=next.access.getSnapshot();
 return owner.phase==='READY'&&lease.generation===owner.generation?next:undefined;}catch{return undefined;}};
 const publish=()=>{const c=store.getSnapshot(),rt=runtime?.view();
 snapshot=Object.freeze({token:Object.freeze({}),revision:(snapshot.revision??0)+1,sourceKey:source?.key,domain:source?.domain,
 state:rt?.state==='PROPOSAL'?'PROPOSAL':rt?.state==='NEED_MORE_INFO'?'NEED_MORE_INFO':state,
 previewHandle:c.candidate?options.preview?.(store,c.candidate.candidate_id):undefined,
 hasPhoto:Boolean(c.candidate),accepted:Boolean(c.receipt),c1,busy,selected,cleanup,
 proposal:rt?.proposal,requires_user_choice:true,M6_STARTED:false,M7_USE_NEXT_CYCLE:false});
 for(const f of [...listeners])f();};
 const retire=()=>{epoch++;const retiredEpoch=epoch;runtime?.retire();const old=runtime;runtime=undefined;
 if(old)void Promise.all([old.settleCleanup(),old.settleRevocations()]).then(results=>{if(epoch===retiredEpoch&&results.some(x=>!x)){cleanup=true;publish();}}).catch(()=>{if(epoch===retiredEpoch){cleanup=true;publish();}});
 store.retire();c1=false;selected=false;busy=false;state='EMPTY';};
 const live=():CoachPresenceLive|undefined=>{
  const s=valid(),receipt=store.getSnapshot().receipt;if(!s||!receipt||!c1)return undefined;
  return {access:s.access,lease:s.lease,localUri:receipt.local_uri,epoch,
   scope:{taskSessionId:s.sessionId,taskId:s.taskId,taskRevision:s.revision,vision_domain:s.domain,
    purpose:s.domain==='meal'?'MEAL_IMAGE_EXTERNAL_ANALYSIS':s.domain==='exercise_form'?'EXERCISE_FORM_EXTERNAL_ANALYSIS':'PHYSIQUE_POSTURE_EXTERNAL_ANALYSIS',
    candidateId:receipt.candidate_id,c1Revision:epoch},
   task:{taskSessionId:s.sessionId,taskId:s.taskId,taskRevision:s.revision,taskKind:s.taskKind,status:'READY',
    safety:'CLEAR',needsImage:true,imageAccepted:true,c1Allowed:true}};
 };
 const pick=async(kind:'CAMERA'|'LIBRARY')=>{
  const s=valid();if(!s||busy||store.isBusy()||store.getSnapshot().receipt)return false;
  const operation=epoch;busy=true;publish();
  try{return await (kind==='CAMERA'?picker.takePhoto:picker.choosePhoto)(
   {session_id:s.sessionId,task_id:s.taskId,revision:s.revision},()=>Boolean(valid()&&epoch===operation));
  }finally{if(operation===epoch){busy=false;publish();}}
 };
 const run=async(action:()=>Promise<boolean>)=>{
  if(!valid()||busy)return false;const operation=epoch;busy=true;publish();
  try{const ok=await action(),current=operation===epoch&&Boolean(valid());if(current){state=ok?runtime?.view().state??state:'BLOCKED';publish();}return current&&ok;}
  catch{if(operation===epoch){state='BLOCKED';publish();}return false;}
  finally{if(operation===epoch){busy=false;publish();}}
 };
 const permitted=(token:unknown)=>token===snapshot.token&&Boolean(valid());
 publish();
 return Object.freeze({
  subscribe:(f:()=>void)=>{listeners.add(f);return()=>listeners.delete(f);},getSnapshot:()=>snapshot,
  bind:()=>{const next=options.current();if(source?.key===next?.key&&source?.lease===next?.lease&&source?.access===next?.access&&source?.revision===next?.revision&&source?.taskId===next?.taskId&&source?.sessionId===next?.sessionId&&source?.domain===next?.domain)return;
   offOwner();offOwner=()=>{};retire();source=next;if(next){store.bind({session_id:next.sessionId,task_id:next.taskId,revision:next.revision});offOwner=next.access.subscribe(()=>{if(source===next&&!valid()){retire();source=undefined;publish();}});}publish();},
  take:(token:unknown)=>permitted(token)?pick('CAMERA'):Promise.resolve(false),choose:(token:unknown)=>permitted(token)?pick('LIBRARY'):Promise.resolve(false),
  use:(token:unknown)=>{if(!permitted(token)||busy)return false;const s=valid(),photo=store.getSnapshot().candidate;if(!s||!photo)return false;
   const receipt=store.accept({session_id:s.sessionId,task_id:s.taskId,revision:s.revision},photo.candidate_id);
   state='C1_REQUIRED';publish();return Boolean(receipt);},
  allowC1:(token:unknown)=>{if(!permitted(token)||busy||!valid()||!store.getSnapshot().receipt)return false;c1=true;epoch++;state='C2_REQUIRED';publish();return true;},
  allowC2:(token:unknown)=>permitted(token)?run(async()=>{const s=valid();if(!s||!c1)return false;
   const operation=epoch;
   const created=await (options.runtime??createProductionCoachRuntime)(live,s);
   if(operation!==epoch||!valid()){created.retire();return false;}
   runtime=created;return runtime.allowAndPrepare(true);
  }):Promise.resolve(false),
  analyze:(token:unknown)=>permitted(token)?run(async()=>Boolean(runtime&&await runtime.analyze())):Promise.resolve(false),
  chooseProposal:(token:unknown)=>{if(!permitted(token)||busy||selected||!valid()||runtime?.view().state!=='PROPOSAL')return false;selected=true;publish();return true;},
  retake:(token:unknown)=>{if(!permitted(token)||busy||!valid())return false;const prior=source;retire();source=prior;
   if(prior)store.bind({session_id:prior.sessionId,task_id:prior.taskId,revision:prior.revision});publish();return true;},
  cancel:(token:unknown)=>{if(!permitted(token))return false;const prior=source;retire();source=prior;if(prior)store.bind({session_id:prior.sessionId,task_id:prior.taskId,revision:prior.revision});publish();return true;},
  revoke:(token:unknown)=>{if(!permitted(token))return false;epoch++;runtime?.revoke();c1=false;busy=false;selected=false;state='C1_REQUIRED';publish();return true;},
  delete:async(token:unknown)=>{if(!permitted(token))return false;const old=runtime,prior=source;retire();const deletionEpoch=epoch;source=prior;if(prior)store.bind({session_id:prior.sessionId,task_id:prior.taskId,revision:prior.revision});publish();
   if(old){const clean=await old.settleCleanup();await old.settleRevocations();if(epoch!==deletionEpoch)return false;cleanup=!clean;publish();}return !cleanup;},
  dispose:()=>{offOwner();retire();source=undefined;listeners.clear();},
 });
}
export async function createProductionCoachRuntime(live:()=>CoachPresenceLive|undefined,source:CoachSource,deps?:Readonly<{domain?:string;fetch?:typeof fetch;preparerIO?:VisionImageIO;preparerRuntime?:Parameters<typeof createSanitizedVisionImagePreparer>[1];now?:()=>number}>):Promise<Runtime>{
 const {createSanitizedVisionImagePreparer}=await import('../lib/camera/expo-image-preparer');
 const preparerIO=deps?.preparerIO??(await import('../lib/camera/expo-vision-io')).createExpoVisionImageIO();
 const raw=deps?.domain??process.env.EXPO_PUBLIC_DOMAIN;
 const fetchImpl=deps?.fetch??fetch,now=deps?.now??Date.now;
 if(!raw)throw Error('C2_AUTHORITY_UNCONFIGURED');
 const origin=new URL(raw.includes('://')?raw:'https://'+raw);
 if(origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(origin.hostname)))throw Error('C2_ORIGIN');
 const request=async(path:string,body:unknown,signal:AbortSignal)=>{
  const controller=new AbortController(),cancel=()=>controller.abort();signal.addEventListener('abort',cancel,{once:true});
  if(signal.aborted)cancel();const timer=setTimeout(cancel,12000);
  try{return await source.authorization.withBearer(controller.signal,async Authorization=>{
   const payload=JSON.stringify(body);if(payload.length>1536*1024)throw Error('C2_BODY_LIMIT');
   const response=await fetchImpl(origin.origin+path,{method:'POST',headers:{Authorization,'Content-Type':'application/json'},body:payload,signal:controller.signal});
   const text=await response.text();if(text.length>32768||!response.ok)throw Error('C2_PERMISSION_OR_SERVICE_UNAVAILABLE');
   return JSON.parse(text);
  });}finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
 };
 let sequence=0;
 const command=(scope:object,action:string,extra:object={})=>({...scope,action,operationId:'c2_'+now()+'_'+ ++sequence,createdAt:now(),...extra});
 const base64=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
 return createCoachPresenceC2Runtime({readCurrent:live,now,preparer:createSanitizedVisionImagePreparer(preparerIO,deps?.preparerRuntime),
 permission:(scope,signal)=>request('/api/ai/c2/permission',command(scope,'GRANT',{accepted:true}),signal),
 revokeGrant:async grant=>{const {c2GrantId,consentRevision,authorityEpoch,expiresAt,...scope}=grant;
  const response=await request('/api/ai/c2/permission',command(scope,'REVOKE',{c2GrantId}),new AbortController().signal);return response.revoked===true;},
 send:async(grant,bytes,signal)=>request('/api/ai/c2/vision',{grant,mime:'image/jpeg',imageBase64:base64(bytes)},signal),
 });
}

export function createAccountErasureOrchestrator(options:Readonly<{
 current():Readonly<{access:OwnerAccess;lease:SessionLease;authorization?:IdentityRequestAuthorization}>|undefined;
 backend:import('../domain/local-owner/storage').LocalStorageBackend;
 invalidate(owner:Readonly<{subjectId:string;profileId:string}>):void;
 send(authorization:string,signal:AbortSignal):Promise<Readonly<{status:number}>>;
}>){
 let state:Readonly<{phase:'IDLE'|'REQUESTING'|'QUARANTINED'|'COMPLETE';serverConfirmed:boolean}>=Object.freeze({phase:'IDLE',serverConfirmed:false});
 let pending:Promise<boolean>|undefined;
 let captured:{owner:Readonly<{subjectId:string;profileId:string}>;binding:NonNullable<ReturnType<typeof options.current>>;store:ReturnType<typeof createGuardedUserStorage>;permit:object;confirmed:boolean}|undefined;
 const listeners=new Set<()=>void>();const publish=(phase:typeof state.phase,confirmed:boolean)=>{state=Object.freeze({phase,serverConfirmed:confirmed});for(const fn of [...listeners])try{fn()}catch{}};
 const run=async()=>{
  try{
   if(!captured){const binding=options.current();if(!binding?.authorization)return false;const scope=binding.access.requireLease(binding.lease);
    const owner=Object.freeze({...scope.owner}),store=createGuardedUserStorage(binding.access,options.backend,{retireAccess:()=>options.invalidate(owner)});
    captured={owner,binding,store,permit:store.prepareOwnerRetirement(binding.lease),confirmed:false};
   }
   const request=captured;publish('REQUESTING',request.confirmed);
   if(!request.confirmed){
    const binding=options.current();if(!binding?.authorization)throw Error('ERASURE_AUTHORITY_MISSING');
    const scope=binding.access.requireLease(binding.lease);if(scope.owner.subjectId!==request.owner.subjectId||scope.owner.profileId!==request.owner.profileId)throw Error('ERASURE_OWNER_CHANGED');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{await binding.authorization.withBearer(controller.signal,async Authorization=>{
      const result=await options.send(Authorization,controller.signal);if(result.status!==204)throw Error('ERASURE_SERVER_UNCONFIRMED');
      request.confirmed=true;return true;
    });}catch(error){if(!request.confirmed)throw error;}finally{clearTimeout(timer);}
   }
   invalidateUnifiedOwnerFacts(request.binding.access,request.binding.lease);
   await request.store.retireOwnerNamespace(request.permit);publish('COMPLETE',true);return true;
  }catch{if(captured){invalidateUnifiedOwnerFacts(captured.binding.access,captured.binding.lease);captured.store.quarantineOwnerNamespace(captured.permit);}
   publish('QUARANTINED',captured?.confirmed??false);return false;
  }
 };
 return Object.freeze({getSnapshot:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}},
  blocks:(binding:ReturnType<typeof options.current>)=>{if(!captured||state.phase==='IDLE'||!binding)return false;try{const scope=binding.access.requireLease(binding.lease);return scope.owner.subjectId===captured.owner.subjectId&&scope.owner.profileId===captured.owner.profileId;}catch{return true;}},
  eraseAccount:()=>{if(pending)return pending;if(state.phase==='COMPLETE'){const binding=options.current();if(!binding)return Promise.resolve(true);try{const scope=binding.access.requireLease(binding.lease);if(scope.owner.subjectId===captured?.owner.subjectId&&scope.owner.profileId===captured?.owner.profileId)return Promise.resolve(true);captured=undefined;}catch{return Promise.resolve(false);}}pending=run().finally(()=>{pending=undefined});return pending;}});
}
