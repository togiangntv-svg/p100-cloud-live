import {normalizeWearableContext,inspectWearableRead,assertWearableObservation,watchWearableRead,retainWearableContext,WearableAuthorityError,type WearableContext,type WearableReadRequest} from './contract.ts';
import type {NativeHealthAuthorizationResult,WearableHealthNativeModule} from '../../modules/wearable-health/src/WearableHealth.types.ts';
export type AndroidHealthConnectReadRequest=WearableReadRequest;
export type AndroidHealthConnectReadAdapter=Readonly<{isAvailable():boolean;requestReadAccess(request?:WearableReadRequest):Promise<NativeHealthAuthorizationResult>;readSteps(request:WearableReadRequest):Promise<WearableContext>;readWorkouts(request:WearableReadRequest):Promise<readonly WearableContext[]>}>;
export function createAndroidHealthConnectReadAdapter(nativeModule:WearableHealthNativeModule|null):AndroidHealthConnectReadAdapter{
 const nativeRead=async<T>(request:WearableReadRequest,read:()=>Promise<T>):Promise<T>=>{if(!nativeModule||typeof nativeModule.clearSession!=='function')throw new WearableAuthorityError('WEARABLE_NATIVE_GUARD_UNAVAILABLE');const off=watchWearableRead(request,()=>nativeModule.clearSession());try{return await read();}finally{off();}};
 const unavailable=(state:'NO_DATA'|'PERMISSION_DENIED'|'PLATFORM_UNAVAILABLE',kind:'STEPS'|'WORKOUT',request:WearableReadRequest)=>normalizeWearableContext({state,source_platform:'ANDROID_HEALTH_CONNECT',scope:request.scope,assessed_at:request.assessed_at,signal_kind:kind,});
 const state=(value:string)=>{if(['HEALTH_LIVE_OFF','DISCARDED_STALE_EPOCH','OUTSIDE_V1_RECENT_CONTEXT'].includes(value))throw new WearableAuthorityError(value);return value==='NO_DATA'?'NO_DATA' as const:value==='PERMISSION_DENIED'?'PERMISSION_DENIED' as const:'PLATFORM_UNAVAILABLE' as const;};
 return Object.freeze({isAvailable:()=>nativeModule?.isAvailable()??false,
 requestReadAccess:async request=>{if(!nativeModule)return Object.freeze({state:'PLATFORM_UNAVAILABLE' as const});const metric=request?.scope.requested_signal_kinds[0];if(metric!=='STEPS'&&metric!=='WORKOUT')throw new WearableAuthorityError('INVALID_WEARABLE_AUTHORITY');const wire=inspectWearableRead(request!,metric),result=await nativeRead(request!,()=>nativeModule.requestReadAccess(wire));inspectWearableRead(request!,metric);if(result.state==='HEALTH_LIVE_OFF'||result.state==='DISCARDED_STALE_EPOCH')throw new WearableAuthorityError(result.state);return result;},
 readSteps:async request=>{const wire=inspectWearableRead(request,'STEPS');if(!nativeModule)return retainWearableContext(request,unavailable('PLATFORM_UNAVAILABLE','STEPS',request));
 const result=await nativeRead(request,()=>nativeModule.readSteps(request.started_at,request.ended_at,wire));inspectWearableRead(request,'STEPS');
 if(result.state!=='AVAILABLE')return retainWearableContext(request,unavailable(state(result.state),'STEPS',request));
 assertWearableObservation(request,result.observedStartedAt,result.observedEndedAt);
 return retainWearableContext(request,normalizeWearableContext({state:'AVAILABLE',source_platform:'ANDROID_HEALTH_CONNECT',scope:request.scope,assessed_at:request.assessed_at,dataOrigins:result.dataOrigins,signal:{signal_kind:'STEPS',value:{quantity:result.count,unit:'count'},observation:{kind:'INTERVAL',started_at:result.observedStartedAt,ended_at:result.observedEndedAt}}}));},
 readWorkouts:async request=>{const wire=inspectWearableRead(request,'WORKOUT');if(!nativeModule)return Object.freeze([retainWearableContext(request,unavailable('PLATFORM_UNAVAILABLE','WORKOUT',request))]);
 const result=await nativeRead(request,()=>nativeModule.readWorkouts(request.started_at,request.ended_at,wire));inspectWearableRead(request,'WORKOUT');
 if(result.state!=='AVAILABLE')return Object.freeze([retainWearableContext(request,unavailable(state(result.state),'WORKOUT',request))]);
 if(result.workouts.length>256)throw new WearableAuthorityError('WEARABLE_CONTEXT_LIMIT');
 if(!result.workouts.length)return Object.freeze([retainWearableContext(request,unavailable('NO_DATA','WORKOUT',request))]);
 for(const workout of result.workouts)assertWearableObservation(request,workout.startedAt,workout.endedAt);
 return Object.freeze(result.workouts.map(workout=>retainWearableContext(request,normalizeWearableContext({state:'AVAILABLE',source_platform:'ANDROID_HEALTH_CONNECT',scope:request.scope,assessed_at:request.assessed_at,signal:{signal_kind:'WORKOUT',value:{category:workout.category,completion:'COMPLETED',duration:workout.durationMinutes,unit:'minute'},observation:{kind:'INTERVAL',started_at:workout.startedAt,ended_at:workout.endedAt}}}))));}
 });
}
export async function getAndroidHealthConnectReadAdapter(){const{getWearableHealthNativeModule}=await import('../../modules/wearable-health/src/WearableHealthModule.ts');return createAndroidHealthConnectReadAdapter(getWearableHealthNativeModule());}
