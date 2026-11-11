import { createWebOwnerSessionComposition } from './web-session';
import type { OwnerAccess, SessionLease, BoundaryClock } from '../../domain/local-owner/boundary';
import type { OwnerSessionBinding } from '../../domain/identity/owner-session-coordinator';

export type LocalVerificationConfig = Readonly<{ origin: string; browserOrigin: string; timeoutMs: number }>;
export type LocalVerificationControl = Readonly<{ createSession(): Promise<boolean>; isCurrent(): boolean }>;
const configs = new WeakSet<object>();
export function resolveLocalVerificationConfig(
  flag: string | undefined, browserOrigin: string | undefined,
  authorityOrigin: string | undefined, mode: string | undefined,
): LocalVerificationConfig | undefined {
  const valid=(v: string | undefined): v is string => Boolean(v
    && /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/u.test(v)
    && new URL(v).origin===v && Number(new URL(v).port)<=65535);
  try {
    if(flag!=='1' || mode!=='local-verification' || !valid(browserOrigin) || !valid(authorityOrigin))return undefined;
    const config=Object.freeze({origin:authorityOrigin,browserOrigin,timeoutMs:5000});configs.add(config);return config;
  }catch{return undefined;}
}
type Binding = Readonly<{ access: OwnerAccess; lease: SessionLease; identity: object;
  isCurrent(): boolean; authorize<T>(signal: AbortSignal, use:()=>Promise<T>):Promise<T> }>;
const bindings = new WeakMap<object,Binding>();
export function readLocalVerificationBinding(binding: Pick<OwnerSessionBinding,'access'|'lease'> | undefined): Binding | undefined {
  if(!binding)return undefined;
  const entry=bindings.get(binding.access);
  return entry?.lease===binding.lease && entry.isCurrent()?entry:undefined;
}
export function createLocalVerificationClient(config: LocalVerificationConfig, options: Readonly<{
  fetchImpl?: typeof fetch; clock?: BoundaryClock; now?:()=>number;
  randomValues?: (bytes:Uint8Array<ArrayBuffer>)=>Uint8Array<ArrayBuffer>;
}> = {}) {
  if(!configs.has(config))throw Error('LOCAL_REALM_UNTRUSTED_CONFIG');
  const transport=options.fetchImpl??fetch;
  const composition=createWebOwnerSessionComposition({...config,fetchImpl:transport,clock:options.clock,now:options.now,appleSdk:null});
  let generation=0,pending:AbortController|undefined,disposed=false,attached=true,controlEpoch=0;
  const invalidate=()=>{generation++;pending?.abort();pending=undefined;composition.coordinator.invalidate();};
  const sync=()=>{
    const snapshot=composition.coordinator.getSnapshot(),binding=snapshot.binding;
    if(snapshot.phase!=='READY'||!binding)return;
    const old=bindings.get(binding.access);if(old?.lease===binding.lease)return;
    const ticket=generation,identity=Object.freeze({});
    const current=()=>{try{
      const live=composition.coordinator.getSnapshot();
      binding.access.requireLease(binding.lease);
      return !disposed&&attached&&generation===ticket&&live.phase==='READY'
        &&live.binding?.access===binding.access&&live.binding.lease===binding.lease;
    }catch{return false;}};
    bindings.set(binding.access,Object.freeze({access:binding.access,lease:binding.lease,identity,isCurrent:current,
      async authorize<T>(signal:AbortSignal,use:()=>Promise<T>){
        if(!current()||signal.aborted||!binding.authorization)throw Error('LOCAL_REALM_STALE');
        let entered=false;
        try{return await binding.authorization.withBearer(signal,async authorization=>{
          if(!current()||signal.aborted)throw Error('LOCAL_REALM_STALE');
          const response=await transport(config.origin+'/api/identity/session',{method:'GET',
            headers:{accept:'application/json',authorization},credentials:'omit',redirect:'error',cache:'no-store',signal});
          if(signal.aborted||!current()||!response.ok||response.redirected
            ||(response.url&&new URL(response.url).origin!==config.origin))throw Error('LOCAL_REALM_UNAVAILABLE');
          const stream=response.body?.getReader();if(!stream)throw Error('LOCAL_REALM_UNAVAILABLE');
          let text='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
          try{while(true){const part=await stream.read();if(signal.aborted||!current())throw Error('LOCAL_REALM_STALE');
            if(part.done)break;size+=part.value.byteLength;if(size>32768){await stream.cancel();throw Error('LOCAL_REALM_BODY');}
            text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{stream.releaseLock();}
          const verified:unknown=JSON.parse(text),scope=binding.access.requireLease(binding.lease);
          if(!verified||typeof verified!=='object'||!('owner' in verified)||!verified.owner||typeof verified.owner!=='object'
            ||!('subjectId' in verified.owner)||verified.owner.subjectId!==scope.owner.subjectId
            ||!('profileId' in verified.owner)||verified.owner.profileId!==scope.owner.profileId
            ||!('validUntil' in verified)||typeof verified.validUntil!=='string'
            ||Date.parse(verified.validUntil)!==scope.validUntil)throw Error('LOCAL_REALM_UNAVAILABLE');
          entered=true;
          const result=await use();if(!current()||signal.aborted)throw Error('LOCAL_REALM_STALE');return result;
        });}catch{if(!entered&&current()&&!signal.aborted)invalidate();throw Error('LOCAL_REALM_UNAVAILABLE');}
      }}));
  };
  const unsubscribe=composition.coordinator.subscribe(sync);
  const coordinator=Object.freeze({...composition.coordinator,
    invalidate(){attached=false;controlEpoch++;invalidate();},
    async refresh(){if(disposed)return false;if(!attached){attached=true;controlEpoch++;}return composition.coordinator.refresh();},
    async logout(signal:AbortSignal){controlEpoch++;generation++;pending?.abort();pending=undefined;return composition.coordinator.logout(signal);},
    dispose(){disposed=true;invalidate();unsubscribe();composition.dispose();}});
  const control=Object.freeze({async createSession(){
    if(disposed||!attached||pending)return false;
    controlEpoch++;
    invalidate();const ticket=generation,controller=new AbortController();pending=controller;
    const timer=setTimeout(()=>controller.abort(),config.timeoutMs);
    try{
      const bytes=new Uint8Array(16);
      if(options.randomValues)options.randomValues(bytes);else globalThis.crypto.getRandomValues(bytes);
      const request_id=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
      const response=await transport(config.origin+'/api/identity/local/session',{method:'POST',
        headers:{'content-type':'application/json'},body:JSON.stringify({request_id}),
        credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
      if(controller.signal.aborted||generation!==ticket||response.redirected||!response.ok
        ||(response.url&&new URL(response.url).origin!==config.origin))throw Error('LOCAL_REALM_UNAVAILABLE');
      const reader=response.body?.getReader();if(!reader)throw Error('LOCAL_REALM_UNAVAILABLE');
      const chunks:Uint8Array[]=[];let length=0;
      try{while(true){const part=await reader.read();if(controller.signal.aborted||generation!==ticket)throw Error('LOCAL_REALM_STALE');
        if(part.done)break;length+=part.value.byteLength;if(length>32768){await reader.cancel();throw Error('LOCAL_REALM_BODY');}chunks.push(part.value);}}
      finally{reader.releaseLock();}
      const all=new Uint8Array(length);let at=0;for(const chunk of chunks){all.set(chunk,at);at+=chunk.length;}
      const issued=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
      if(generation!==ticket||controller.signal.aborted)throw Error('LOCAL_REALM_STALE');
      await composition.acceptIssuedSession(issued,controller.signal);
      if(generation!==ticket||controller.signal.aborted)throw Error('LOCAL_REALM_STALE');
      sync();return Boolean(readLocalVerificationBinding(coordinator.getSnapshot().binding));
    }catch{if(generation===ticket)invalidate();return false;}
    finally{clearTimeout(timer);if(pending===controller)pending=undefined;}
  }});
  return Object.freeze({coordinator,get control():LocalVerificationControl {
    const epoch=controlEpoch;
    return Object.freeze({isCurrent:()=>!disposed&&attached&&epoch===controlEpoch,
      createSession:()=>epoch===controlEpoch&&attached?control.createSession():Promise.resolve(false)});
  }});
}
