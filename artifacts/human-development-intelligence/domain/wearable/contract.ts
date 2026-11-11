import type {OwnerSessionBinding} from '../identity/owner-session-coordinator';
import {readWearableTaskProof,type SessionTaskStore} from '../session-task/store';
export const WEARABLE_SOURCE_PLATFORMS = ['APPLE_HEALTH', 'ANDROID_HEALTH_CONNECT'] as const;
export type WearableSourcePlatform = typeof WEARABLE_SOURCE_PLATFORMS[number];

export const WEARABLE_SIGNAL_KINDS = ['STEPS', 'ACTIVITY', 'WORKOUT', 'HEART_RATE'] as const;
export type WearableSignalKind = typeof WEARABLE_SIGNAL_KINDS[number];

export const WEARABLE_CONTEXT_STATES = [
  'AVAILABLE', 'NO_DATA', 'PERMISSION_DENIED', 'PLATFORM_UNAVAILABLE', 'STALE',
] as const;
export type WearableContextState = typeof WEARABLE_CONTEXT_STATES[number];

export type WearableTaskScope = Readonly<{
  session_id: string;
  task_id: string;
  revision: number;
  purpose: 'CURRENT_TASK_CONTEXT';
  requested_signal_kinds: readonly WearableSignalKind[];
}>;

export type WearablePointObservation = Readonly<{
  kind: 'POINT';
  observed_at: string;
}>;

export type WearableIntervalObservation = Readonly<{
  kind: 'INTERVAL';
  started_at: string;
  ended_at: string;
}>;

export type WearableNormalizedSignal =
  | Readonly<{
    signal_kind: 'STEPS';
    value: Readonly<{ quantity: number; unit: 'count' }>;
    observation: WearableIntervalObservation;
  }>
  | Readonly<{
    signal_kind: 'ACTIVITY';
    value: Readonly<{ duration: number; unit: 'minute' }>;
    observation: WearableIntervalObservation;
  }>
  | Readonly<{
    signal_kind: 'WORKOUT';
    value: Readonly<{
      category: 'GENERAL' | 'WALK' | 'RUN' | 'CYCLE' | 'STRENGTH' | 'OTHER';
      completion: 'COMPLETED';
      duration: number;
      unit: 'minute';
    }>;
    observation: WearableIntervalObservation;
  }>
  | Readonly<{
    signal_kind: 'HEART_RATE';
    value: Readonly<{ quantity: number; unit: 'bpm' }>;
    observation: WearablePointObservation;
  }>;

export type WearableAvailableInput = Readonly<{
  state: 'AVAILABLE' | 'STALE';
  source_platform: WearableSourcePlatform;
  scope: WearableTaskScope;
  assessed_at: string;
  signal: WearableNormalizedSignal;
  dataOrigins?: readonly string[];
}>;

export type WearableUnavailableInput = Readonly<{
  state: 'NO_DATA' | 'PERMISSION_DENIED' | 'PLATFORM_UNAVAILABLE';
  source_platform: WearableSourcePlatform;
  scope: WearableTaskScope;
  assessed_at: string;
  signal_kind: WearableSignalKind;
  accessAmbiguity?: 'NO_OBSERVED_RECORDS_OR_ACCESS_NOT_SHARED';
  dataOrigins?: readonly string[];
}>;

export type WearableContextInput = WearableAvailableInput | WearableUnavailableInput;

export type WearableSignalContext = Readonly<{
  state: 'AVAILABLE' | 'STALE';
  source_platform: WearableSourcePlatform;
  scope: WearableTaskScope;
  signal: WearableNormalizedSignal;
  freshness: Readonly<{ state: 'CURRENT' | 'STALE'; assessed_at: string }>;
  authority: 'CONTEXT_ONLY';
  source_of_record: 'PLATFORM';
  accessAmbiguity?: 'NO_OBSERVED_RECORDS_OR_ACCESS_NOT_SHARED';
  dataOrigins?: readonly string[];
}>;

export type WearableUnavailableContext = Readonly<{
  state: 'NO_DATA' | 'PERMISSION_DENIED' | 'PLATFORM_UNAVAILABLE';
  source_platform: WearableSourcePlatform;
  scope: WearableTaskScope;
  signal_kind: WearableSignalKind;
  freshness: Readonly<{ state: 'NOT_APPLICABLE'; assessed_at: string }>;
  authority: 'CONTEXT_ONLY';
  source_of_record: 'PLATFORM';
  accessAmbiguity?: 'NO_OBSERVED_RECORDS_OR_ACCESS_NOT_SHARED';
  dataOrigins?: readonly string[];
}>;

export type WearableContext = WearableSignalContext | WearableUnavailableContext;

const includes = <T extends string>(values: readonly T[], value: string): value is T =>
  (values as readonly string[]).includes(value);
const validTimestamp = (value: string) => value.trim().length > 0
  && Number.isFinite(Date.parse(value));
const requireTimestamp = (value: string, name: string) => {
  if (!validTimestamp(value)) throw new Error('INVALID_WEARABLE_' + name);
  return value;
};
const requireNumber = (value: number, name: string, allowZero = false) => {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error('INVALID_WEARABLE_' + name);
  }
  return value;
};

const freezeScope = (scope: WearableTaskScope): WearableTaskScope => {
  if (!scope.session_id.trim() || !scope.task_id.trim()
    || !Number.isInteger(scope.revision) || scope.revision <= 0
    || scope.purpose !== 'CURRENT_TASK_CONTEXT'
    || scope.requested_signal_kinds.length === 0
    || scope.requested_signal_kinds.some(kind => !includes(WEARABLE_SIGNAL_KINDS, kind))
    || new Set(scope.requested_signal_kinds).size !== scope.requested_signal_kinds.length) {
    throw new Error('INVALID_WEARABLE_SCOPE');
  }
  return Object.freeze({
    session_id: scope.session_id,
    task_id: scope.task_id,
    revision: scope.revision,
    purpose: 'CURRENT_TASK_CONTEXT',
    requested_signal_kinds: Object.freeze([...scope.requested_signal_kinds]),
  });
};

const freezeInterval = (
  observation: WearableIntervalObservation,
): WearableIntervalObservation => {
  const started_at = requireTimestamp(observation.started_at, 'START_TIME');
  const ended_at = requireTimestamp(observation.ended_at, 'END_TIME');
  if (Date.parse(started_at) > Date.parse(ended_at)) {
    throw new Error('INVALID_WEARABLE_INTERVAL');
  }
  return Object.freeze({ kind: 'INTERVAL', started_at, ended_at });
};

const freezeSignal = (signal: WearableNormalizedSignal): WearableNormalizedSignal => {
  switch (signal.signal_kind) {
    case 'STEPS':
      return Object.freeze({
        signal_kind: 'STEPS',
        value: Object.freeze({
          quantity: requireNumber(signal.value.quantity, 'STEP_COUNT', true),
          unit: 'count',
        }),
        observation: freezeInterval(signal.observation),
      });
    case 'ACTIVITY':
      return Object.freeze({
        signal_kind: 'ACTIVITY',
        value: Object.freeze({
          duration: requireNumber(signal.value.duration, 'ACTIVITY_DURATION', true),
          unit: 'minute',
        }),
        observation: freezeInterval(signal.observation),
      });
    case 'WORKOUT':
      return Object.freeze({
        signal_kind: 'WORKOUT',
        value: Object.freeze({
          category: signal.value.category,
          completion: 'COMPLETED',
          duration: requireNumber(signal.value.duration, 'WORKOUT_DURATION', true),
          unit: 'minute',
        }),
        observation: freezeInterval(signal.observation),
      });
    case 'HEART_RATE':
      return Object.freeze({
        signal_kind: 'HEART_RATE',
        value: Object.freeze({
          quantity: requireNumber(signal.value.quantity, 'HEART_RATE'),
          unit: 'bpm',
        }),
        observation: Object.freeze({
          kind: 'POINT',
          observed_at: requireTimestamp(signal.observation.observed_at, 'OBSERVED_TIME'),
        }),
      });
  }
};

export function normalizeWearableContext(input: WearableContextInput): WearableContext {
  if (!includes(WEARABLE_SOURCE_PLATFORMS, input.source_platform)
    || !includes(WEARABLE_CONTEXT_STATES, input.state)) {
    throw new Error('INVALID_WEARABLE_PROVENANCE');
  }
  const scope = freezeScope(input.scope);
  const assessed_at = requireTimestamp(input.assessed_at, 'ASSESSMENT_TIME');
  const signal_kind = 'signal' in input ? input.signal.signal_kind : input.signal_kind;
  if (!scope.requested_signal_kinds.includes(signal_kind)) {
    throw new Error('WEARABLE_SIGNAL_OUTSIDE_TASK_PURPOSE');
  }
  const stateCarriesSignal = input.state === 'AVAILABLE' || input.state === 'STALE';
  if (stateCarriesSignal !== ('signal' in input)) {
    throw new Error('INVALID_WEARABLE_STATE_SHAPE');
  }
  if ('signal' in input) {
    return Object.freeze({
      state: input.state,
      source_platform: input.source_platform,
      scope,
      signal: freezeSignal(input.signal),
      ...('dataOrigins' in input && input.dataOrigins ? {dataOrigins:Object.freeze(input.dataOrigins.filter(x=>typeof x==='string'&&x.length<=255).slice(0,32))}:{}),
      freshness: Object.freeze({
        state: input.state === 'STALE' ? 'STALE' : 'CURRENT',
        assessed_at,
      }),
      authority: 'CONTEXT_ONLY',
      source_of_record: 'PLATFORM',
    });
  }
  return Object.freeze({
    state: input.state,
    source_platform: input.source_platform,
    scope,
    signal_kind: input.signal_kind,
    ...(input.accessAmbiguity ? {accessAmbiguity:input.accessAmbiguity}:{}),
    freshness: Object.freeze({ state: 'NOT_APPLICABLE', assessed_at }),
    authority: 'CONTEXT_ONLY',
    source_of_record: 'PLATFORM',
  });
}


/** V1 effect gate. This consumes the existing owner+task issuers; it never verifies/mints identity. */
// EXPO_PUBLIC_WEARABLE_V1_MODE is not authority to bypass signed device admission.
export const WEARABLE_LIVE_DEFAULT='gated_off' as const;
export type WearableChoice='STEPS_ONLY'|'WORKOUT_ONLY';
export class WearableAuthorityError extends Error {readonly code:string;constructor(code:string){super(code);this.code=code;this.name='WearableAuthorityError';}}
declare const readPermitBrand:unique symbol;
export type WearableReadPermit=Readonly<{[readPermitBrand]:true}>;
export type WearableWireAuthority=Readonly<{subjectId:string;profileId:string;generation:number;validUntil:number;taskId:string;taskRevision:number;wearableConsentEpoch:number;metric:'STEPS'|'WORKOUT';startedAt:string;endedAt:string;provenance:'CODE_OFFLINE_TEST_FIXTURE'}>;
export type WearableReadRequest=Readonly<{scope:WearableTaskScope;started_at:string;ended_at:string;assessed_at:string;permit:WearableReadPermit}>;
type Cell={value:WearableContext|undefined};
type PermitEntry={wire:WearableWireAuthority;scope:WearableTaskScope;assessedAt:string;assert:()=>void;cells:Set<Cell>;cancellers:Set<()=>void>;publish:()=>void};
const readPermits=new WeakMap<object,PermitEntry>();
const ownerWearableSessions=new WeakMap<object,{lease:object;session:WearableOwnerSession}>();
export function getWearableOwnerSession(binding:OwnerSessionBinding|undefined){if(!binding)return undefined;const entry=ownerWearableSessions.get(binding.access);return entry?.lease===binding.lease?entry.session:undefined;}

export function inspectWearableRead(request:WearableReadRequest,metric:'STEPS'|'WORKOUT'){
 const entry=request&&readPermits.get(request.permit);if(!entry)throw new WearableAuthorityError('INVALID_WEARABLE_AUTHORITY');entry.assert();
 if(entry.wire.metric!==metric||request.scope!==entry.scope||request.started_at!==entry.wire.startedAt||request.ended_at!==entry.wire.endedAt||request.assessed_at!==entry.assessedAt)throw new WearableAuthorityError('WEARABLE_SIGNAL_OUTSIDE_TASK_PURPOSE');
 return entry.wire;
}
export function watchWearableRead(request:WearableReadRequest,cancel:()=>void){const entry=readPermits.get(request.permit);if(!entry)throw new WearableAuthorityError('INVALID_WEARABLE_AUTHORITY');entry.assert();entry.cancellers.add(cancel);return()=>{entry.cancellers.delete(cancel);};}
export function assertWearableObservation(request:WearableReadRequest,startedAt:string,endedAt:string){
 const start=Date.parse(startedAt),end=Date.parse(endedAt);if(!Number.isFinite(start)||!Number.isFinite(end)||start>end||start<Date.parse(request.started_at)||end>Date.parse(request.ended_at))throw new WearableAuthorityError('OUTSIDE_V1_RECENT_CONTEXT');
}
export function retainWearableContext(request:WearableReadRequest,value:WearableContext):WearableContext{
 const entry=readPermits.get(request.permit);if(!entry)throw new WearableAuthorityError('INVALID_WEARABLE_AUTHORITY');entry.assert();if(entry.cells.size>=256)throw new WearableAuthorityError('WEARABLE_CONTEXT_LIMIT');const cell:Cell={value};entry.cells.add(cell);entry.publish();
 const currentValue=(path:readonly string[])=>{entry.assert();if(!cell.value)throw new WearableAuthorityError('DISCARDED_STALE_EPOCH');let node:unknown=cell.value;for(const key of path)node=(node as Record<string,unknown>)[key];return node;};
 const guarded=(path:readonly string[]):unknown=>{const current=currentValue(path);if(!current||typeof current!=='object')return current;
  if(Array.isArray(current))return new Proxy(Object.freeze([...current]),{get(target,key,receiver){currentValue(path);return Reflect.get(target,key,receiver);}});
  const result:Record<string,unknown>={};for(const key of Object.keys(current))Object.defineProperty(result,key,{enumerable:true,get:()=>guarded([...path,key])});
  Object.defineProperty(result,'toJSON',{value:()=>{throw new WearableAuthorityError('WEARABLE_CONTEXT_RAM_ONLY');}});return Object.freeze(result);
 };return guarded([]) as WearableContext;
}
export function createWearableOwnerSession(current:()=>OwnerSessionBinding|undefined,options:Readonly<{mode?:'gated_off'|'CODE_OFFLINE_TEST_FIXTURE';now?:()=>number;subscribeOwner?:(fn:()=>void)=>()=>void}>={}){
 const now=options.now??Date.now,cells=new Set<Cell>(),cancellers=new Set<()=>void>(),listeners=new Set<()=>void>();let epoch=0,binding:OwnerSessionBinding|undefined,store:SessionTaskStore|undefined,stopOwner=()=>{},stopAccess=()=>{},stopStore=()=>{},blockedLease:object|undefined;
 let snapshot:Readonly<{epoch:number;status:'HEALTH_LIVE_OFF';retained:number}>=Object.freeze({epoch,status:'HEALTH_LIVE_OFF',retained:0});
 const publish=()=>{snapshot=Object.freeze({epoch,status:'HEALTH_LIVE_OFF' as const,retained:cells.size});for(const fn of [...listeners])try{fn()}catch{}};
 const clear=()=>{epoch++;for(const cell of cells)cell.value=undefined;cells.clear();const pending=[...cancellers];cancellers.clear();for(const cancel of pending)try{cancel()}catch{}publish();};
 const validBinding=()=>{try{const b=current();if(!b)return undefined;const s=b.access.requireLease(b.lease);if(b.access.getSnapshot().phase!=='READY'||s.validUntil<=now())return undefined;return b;}catch{return undefined;}};
 const sync=()=>{const next=validBinding();if(next?.access!==binding?.access||next?.lease!==binding?.lease){if(binding&&ownerWearableSessions.get(binding.access)?.session===api)ownerWearableSessions.delete(binding.access);stopAccess();binding=next;if(next){const prior=ownerWearableSessions.get(next.access);if(prior&&prior.session!==api)throw new WearableAuthorityError('WEARABLE_SESSION_ALREADY_REGISTERED');ownerWearableSessions.set(next.access,{lease:next.lease,session:api});}stopAccess=next?.access.subscribe(()=>sync())??(()=>{});clear();}return next;};
 const api={
  start(){stopOwner();stopOwner=options.subscribeOwner?.(()=>sync())??(()=>{});sync();return()=>{stopOwner();stopAccess();stopStore();clear();};},
  clearSession:clear,
  suspend(){const b=sync();blockedLease=b?.lease;clear();},
  bindTaskStore(next:SessionTaskStore|undefined){if(next!==store){stopStore();clear();store=next;stopStore=next?.subscribe(()=>clear())??(()=>{});}return()=>{if(store===next){stopStore();store=undefined;clear();}};},
  issueRead(choice:WearableChoice,started_at:string,ended_at:string):WearableReadRequest{
   const b=sync();if(!b||b.lease===blockedLease)throw new WearableAuthorityError('INVALID_WEARABLE_AUTHORITY');
   if(options.mode!=='CODE_OFFLINE_TEST_FIXTURE')throw new WearableAuthorityError('HEALTH_LIVE_OFF');
   if(choice!=='STEPS_ONLY'&&choice!=='WORKOUT_ONLY')throw new WearableAuthorityError('WEARABLE_SIGNAL_OUTSIDE_TASK_PURPOSE');
   const at=now(),start=Date.parse(started_at),end=Date.parse(ended_at),window=30*24*60*60*1000;
   if(!Number.isFinite(start)||!Number.isFinite(end)||start>end||end>at||start<at-window||end-start>window)throw new WearableAuthorityError('OUTSIDE_V1_RECENT_CONTEXT');
   const ref=store?.reference(),proof=ref&&store?.captureWearableTaskProof(ref),task=proof&&readWearableTaskProof(proof,b);if(!proof||!task)throw new WearableAuthorityError('INVALID_WEARABLE_TASK_AUTHORITY');
   const scope=b.access.requireLease(b.lease),captured=epoch;const metric:'STEPS'|'WORKOUT'=choice==='STEPS_ONLY'?'STEPS':'WORKOUT';
   const wire=Object.freeze({subjectId:scope.owner.subjectId,profileId:scope.owner.profileId,generation:scope.generation,validUntil:scope.validUntil,taskId:task.task_id,taskRevision:task.revision,wearableConsentEpoch:captured,metric,startedAt:started_at,endedAt:ended_at,provenance:'CODE_OFFLINE_TEST_FIXTURE' as const});
   const taskScope:WearableTaskScope=Object.freeze({...task,purpose:'CURRENT_TASK_CONTEXT',requested_signal_kinds:Object.freeze([metric])});
   const assert=()=>{const next=sync();if(Date.parse(wire.startedAt)<now()-window||Date.parse(wire.endedAt)>now()){clear();throw new WearableAuthorityError('OUTSIDE_V1_RECENT_CONTEXT');}if(!next||next.access!==b.access||next.lease!==b.lease||epoch!==captured||b.lease===blockedLease||!readWearableTaskProof(proof,b)||now()>=wire.validUntil){clear();throw new WearableAuthorityError('DISCARDED_STALE_EPOCH');}};
   const permit=Object.freeze({}) as WearableReadPermit;readPermits.set(permit,{wire,scope:taskScope,assessedAt:new Date(at).toISOString(),assert,cells,cancellers,publish});
   return Object.freeze({scope:taskScope,started_at,ended_at,assessed_at:new Date(at).toISOString(),permit});
  },
  getSnapshot:()=>{sync();return snapshot;},subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},dispose(){stopOwner();stopAccess();stopStore();if(binding&&ownerWearableSessions.get(binding.access)?.session===api)ownerWearableSessions.delete(binding.access);clear();binding=undefined;store=undefined;}
 };return Object.freeze(api);
}
export type WearableOwnerSession=ReturnType<typeof createWearableOwnerSession>;
