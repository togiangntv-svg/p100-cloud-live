import { subscribeOwnerRevocation, assertIdentityNotRetired } from '../identity/session-core';
import {randomUUID} from 'node:crypto';
import {C2_POLICY,C2Error,c2Id,c2Revision,readPermissionCommand,readVisionGrant,readVisionScope,
 sameVisionScope,failC2,type VisionScope,type VisionGrant,type PermissionCommand,type VisionDomain} from '../../../../lib/api-zod/src/c2-vision.ts';
import type {M3IdentityContext} from './m3-permission.ts';
export type ServerVisionTaskFacts=Readonly<VisionScope & {
 owner:Readonly<{subjectId:string;profileId:string}>; sessionKey:string;
 taskKind:string; m4Required:true; c1Accepted:true; sourceEpoch:number; validUntil:number;
 provenance:'PRODUCTION_OWNED'|'TEST_FIXTURE';
}>;
/** Trusted composition injection ONLY. Never constructed from request JSON/env/header. */
export interface ServerVisionTaskFactReader {
 read(identity:M3IdentityContext):ServerVisionTaskFacts|undefined;
 subscribe(retired:()=>void):()=>void;
}
export type VisionTaskBinding=Readonly<{
 subjectId:string;profileId:string;sessionKey:string;taskSessionId:string;taskId:string;taskRevision:number;
 vision_domain:VisionDomain;purpose:string;candidateId:string;c1Revision:number;
 c2GrantId:string;consentRevision:number;authorityEpoch:number;expiresAt:number;
}>;
type Entry={identity:M3IdentityContext;binding:VisionTaskBinding;grant:VisionGrant;identityUntil:string;facts:ServerVisionTaskFacts;
 controllers:Set<AbortController>;timer:ReturnType<typeof setTimeout>};
type Guard=Readonly<{grant:VisionGrant;signal:AbortSignal}>;
export function createVisionTaskConsentAuthority(options:Readonly<{
 reader?:ServerVisionTaskFactReader;
 taskAuthority?:Readonly<{readVisionFacts(identity:M3IdentityContext):unknown;subscribe(fn:()=>void):()=>void}>;
 /** No distributed revocation claims; composition must guarantee a single trusted authority process. */
 topology?:'SINGLE_AUTHORITY_PROCESS';now?:()=>number;newId?:()=>string;
}>={}){
 const now=options.now??Date.now,newId=options.newId??randomUUID;
 const reader:ServerVisionTaskFactReader|undefined=options.taskAuthority?{read:i=>options.taskAuthority!.readVisionFacts(i) as ServerVisionTaskFacts|undefined,subscribe:fn=>options.taskAuthority!.subscribe(fn)}:options.reader;
 const entries=new Map<string,Entry>(),active=new Map<string,string>(),replays=new Map<string,number>();
 const watermarks=new Map<string,{epoch:number;key:string}>(),guards=new WeakMap<object,{entry:Entry;controller:AbortController}>();
 const candidateDomains=new Map<string,VisionDomain>();
 let sequence=0,disposed=false;
 const clock=()=>{const t=now();if(!Number.isFinite(t))return failC2('C2_CLOCK_UNAVAILABLE');return t;};
 const identityKey=(i:M3IdentityContext)=>JSON.stringify([i.sessionKey,i.owner.subjectId,i.owner.profileId]);
 const validIdentity=(i:M3IdentityContext)=>{if(!i||!c2Id(i.sessionKey)||!c2Id(i.owner?.subjectId)
 ||!c2Id(i.owner?.profileId)||Date.parse(i.validUntil)<=clock()||!Number.isFinite(Date.parse(i.validUntil)))
 failC2('C2_AUTH_REQUIRED',401);assertIdentityNotRetired(i.owner,i.sessionKey);};
 const retire=(e:Entry)=>{entries.delete(e.grant.c2GrantId);if(active.get(e.binding.sessionKey)===e.grant.c2GrantId)active.delete(e.binding.sessionKey);
 clearTimeout(e.timer);for(const c of e.controllers)c.abort();e.controllers.clear();};
 const prune=()=>{const t=clock();for(const e of entries.values())if(e.binding.expiresAt<=t)retire(e);
 for(const [k,end]of replays)if(end<=t)replays.delete(k);};
 const factsKey=(f:ServerVisionTaskFacts)=>JSON.stringify([f.owner.subjectId,f.owner.profileId,f.sessionKey,
 f.taskSessionId,f.taskId,f.taskRevision,f.vision_domain,f.purpose,f.candidateId,f.c1Revision,
 f.taskKind,f.m4Required,f.c1Accepted,f.sourceEpoch,f.validUntil,f.provenance]);
 const read=(i:M3IdentityContext):ServerVisionTaskFacts=>{
  validIdentity(i);if(disposed||!reader||options.topology!=='SINGLE_AUTHORITY_PROCESS')failC2('C2_SERVER_TASK_AUTHORITY_UNAVAILABLE');
  let f:ServerVisionTaskFacts|undefined;try{f=reader.read(i);}catch{failC2('C2_SERVER_TASK_AUTHORITY_UNAVAILABLE');}
  if(!f||!['TEST_FIXTURE','PRODUCTION_OWNED'].includes(f.provenance)
   ||f.owner.subjectId!==i.owner.subjectId||f.owner.profileId!==i.owner.profileId||f.sessionKey!==i.sessionKey
   ||!c2Revision(f.sourceEpoch)||f.validUntil<=clock()||!Number.isFinite(f.validUntil)
   ||f.m4Required!==true||f.c1Accepted!==true||!C2_POLICY[f.vision_domain]
   ||f.taskKind!==C2_POLICY[f.vision_domain].taskKind)failC2('C2_SERVER_TASK_AUTHORITY_UNAVAILABLE');
  // Validate field bounds without elevating any caller request into a task fact.
  const scope=readVisionScope(f);
  void scope;
  return Object.freeze({...f,owner:Object.freeze({...f.owner})});
 };
 const current=(e:Entry,i:M3IdentityContext)=>{
  if(!entries.has(e.grant.c2GrantId)||active.get(e.binding.sessionKey)!==e.grant.c2GrantId
  ||e.binding.expiresAt<=clock()||e.binding.subjectId!==i.owner.subjectId||e.binding.profileId!==i.owner.profileId
  ||e.binding.sessionKey!==i.sessionKey||e.identityUntil!==i.validUntil)failC2('C2_GRANT_RETIRED');
  const f=read(i);
  if(factsKey(f)!==factsKey(e.facts))failC2('C2_TASK_DRIFT');
 };
 const synchronize=()=>{for(const e of [...entries.values()])try{current(e,e.identity);}catch{retire(e);}};
 const unsubscribe=reader?.subscribe(synchronize);
 const offRetirement=subscribeOwnerRevocation(event=>{
  for(const e of [...entries.values()])if((event.retired&&e.binding.subjectId===event.owner.subjectId&&e.binding.profileId===event.owner.profileId)||event.sessionKeys.includes(e.binding.sessionKey))retire(e);
  const matches=(key:string)=>{try{const a=JSON.parse(key.slice(0,key.indexOf(']')+1));return event.retired?a[1]===event.owner.subjectId&&a[2]===event.owner.profileId:event.sessionKeys.includes(a[0]);}catch{return false;}};
  for(const key of [...watermarks.keys()])if(matches(key))watermarks.delete(key);
  for(const key of [...replays.keys()])if(matches(key))replays.delete(key);
  for(const key of [...candidateDomains.keys()])if(matches(key))candidateDomains.delete(key);
 });
 const remember=(i:M3IdentityContext,c:PermissionCommand)=>{
  prune();const key=identityKey(i)+'/'+c.operationId;if(replays.has(key))failC2('C2_REPLAY',409);
  if(replays.size>=256)failC2('C2_AUTHORITY_CAPACITY',429);replays.set(key,clock()+120000);
 };
 return Object.freeze({
  permission:(identity:M3IdentityContext,raw:unknown)=>{
   validIdentity(identity);const c=readPermissionCommand(raw);
   if(c.createdAt>clock()+5000||c.createdAt<clock()-30000)failC2('C2_COMMAND_EXPIRED',400);
   remember(identity,c);
   if(c.action==='REVOKE'){
    // Revoke does NOT depend on the task reader still being available.
    const e=entries.get(c.c2GrantId!);
    if(!e||e.binding.sessionKey!==identity.sessionKey||e.binding.subjectId!==identity.owner.subjectId
     ||e.binding.profileId!==identity.owner.profileId||!sameVisionScope(e.grant,c))failC2('C2_GRANT_NOT_OWNED');
    retire(e);return Object.freeze({revoked:true,c2GrantId:c.c2GrantId});
   }
   const f=read(identity);
   if(!sameVisionScope(f,c))failC2('C2_SERVER_TASK_SCOPE_MISMATCH');
   const imageKey=identityKey(identity)+'/'+f.candidateId;
   const previousDomain=candidateDomains.get(imageKey);
   if(previousDomain&&previousDomain!==f.vision_domain)failC2('C2_CANDIDATE_DOMAIN_REUSE');
   if(!previousDomain&&candidateDomains.size>=256)failC2('C2_AUTHORITY_CAPACITY',429);
   candidateDomains.set(imageKey,f.vision_domain);
   const key=identityKey(identity),old=watermarks.get(key),fk=factsKey(f);
   if(old&&(f.sourceEpoch<old.epoch||f.sourceEpoch===old.epoch&&fk!==old.key))failC2('C2_TASK_EPOCH_REPLAY');
   if(!old&&watermarks.size>=256)failC2('C2_AUTHORITY_CAPACITY',429);
   watermarks.set(key,{epoch:f.sourceEpoch,key:fk});
   const previous=active.get(identity.sessionKey);if(previous){const e=entries.get(previous);if(e)retire(e);}
   if(entries.size>=64)failC2('C2_AUTHORITY_CAPACITY',429);
   const c2GrantId=newId();if(!c2Id(c2GrantId)||entries.has(c2GrantId))failC2('C2_AUTHORITY_ID_INVALID');
   const expiresAt=Math.min(clock()+60000,Date.parse(identity.validUntil),f.validUntil);
   const publicScope:VisionScope={taskSessionId:f.taskSessionId,taskId:f.taskId,taskRevision:f.taskRevision,
    vision_domain:f.vision_domain,purpose:f.purpose,candidateId:f.candidateId,c1Revision:f.c1Revision};
   const epoch=++sequence;const grant=Object.freeze({...publicScope,c2GrantId,consentRevision:epoch,authorityEpoch:epoch,expiresAt});
   const binding=Object.freeze({subjectId:identity.owner.subjectId,profileId:identity.owner.profileId,
    sessionKey:identity.sessionKey,...grant});
   const entry:Entry={identity:Object.freeze({...identity}),binding,grant,identityUntil:identity.validUntil,facts:f,controllers:new Set(),
    timer:setTimeout(()=>{const e=entries.get(c2GrantId);if(e)retire(e);},Math.max(1,expiresAt-clock()))};
   entries.set(c2GrantId,entry);active.set(identity.sessionKey,c2GrantId);
   return grant; // Identity/sessionKey never leave the server grant registry.
  },
  begin:(identity:M3IdentityContext,raw:unknown):Guard=>{
   validIdentity(identity);prune();const grant=readVisionGrant(raw),e=entries.get(grant.c2GrantId);
   if(!e||JSON.stringify(e.grant)!==JSON.stringify(grant))failC2('C2_GRANT_INVALID');
   try{current(e,identity);}catch(error){retire(e);throw error;}
   if(e.controllers.size)failC2('C2_OPERATION_IN_FLIGHT',409);
   const controller=new AbortController();e.controllers.add(controller);
   const guard=Object.freeze({grant:e.grant,signal:controller.signal});guards.set(guard,{entry:e,controller});return guard;
  },
  assertCurrent:(guard:Guard,identity:M3IdentityContext)=>{
   const g=guards.get(guard);if(!g||g.controller.signal.aborted)failC2('C2_OPERATION_RETIRED');
   try{validIdentity(identity);current(g.entry,identity);}catch(error){retire(g.entry);throw error;}
  },
  finish:(guard:Guard)=>{const g=guards.get(guard);if(g){g.entry.controllers.delete(g.controller);guards.delete(guard);}},
  cancel:(guard:Guard)=>{const g=guards.get(guard);g?.controller.abort();},
  retireSession:(sessionKey:string)=>{for(const e of [...entries.values()])if(e.binding.sessionKey===sessionKey)retire(e);},
  dispose:()=>{disposed=true;unsubscribe?.();offRetirement();for(const e of [...entries.values()])retire(e);watermarks.clear();replays.clear();candidateDomains.clear();},
  inspect:()=>{prune();return Object.freeze({grants:entries.size,operations:[...entries.values()].reduce((n,e)=>n+e.controllers.size,0),configured:Boolean(reader)&&options.topology==='SINGLE_AUTHORITY_PROCESS'});},
 });
}
export type VisionTaskConsentAuthority=ReturnType<typeof createVisionTaskConsentAuthority>;

/** Production deliberately has no Tier-B task producer. No env/header fixture switch. */
export const productionVisionTaskConsentAuthority=createVisionTaskConsentAuthority();
