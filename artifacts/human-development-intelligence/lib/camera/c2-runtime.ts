import type { CameraAcceptedReceipt } from '../../domain/camera/candidate.ts';
import type { CameraC1ContextRef } from '../../domain/camera/m4-context.ts';
import type { M4ContextInput } from '../../domain/m4/contract.ts';
import type { OwnerAccess, SessionLease } from '../../domain/local-owner/boundary.ts';
import {
  createLocalImagePreparationService,
  type PreparedMealBoundaryReceipt,
} from '../../domain/camera/image-preparation.ts';
import {
  createMealExternalConsentStore,
  MEAL_IMAGE_EXTERNAL_ANALYSIS,
} from '../../domain/camera/meal-vision.ts';
import { createExpoImagePreparer, type OwnedCacheCleanupPort } from './expo-image-preparer.ts';

export type CameraC2ActionSource = Readonly<{
  identity: object;
  current(): Readonly<{
    session_id: string; task_id: string; revision: number;
    safety_revision: number; safety_state: 'OPEN' | 'HOLD';
    availability: string;
  }> | undefined;
}>;

export type CameraC2Live = Readonly<{
  actionSource: CameraC2ActionSource;
  safety_revision: number;
  owner: Readonly<{ access: OwnerAccess; lease: SessionLease; subject_id: string }>;
  accepted: CameraAcceptedReceipt;
  c1: CameraC1ContextRef;
  projection: M4ContextInput;
  m4_sufficient: true;
}>;

export type CameraC2ViewToken = Readonly<{ readonly cameraC2View: unique symbol }>;
export type CameraC2State = 'UNAVAILABLE' | 'CONSENT_REQUIRED' | 'LOCAL_ONLY_DECLINED'
  | 'PREPARING_LOCAL' | 'PREPARED_NOT_SENT' | 'BLOCKED';
export type CameraC2View = Readonly<{
  state: CameraC2State;
  view_token: CameraC2ViewToken;
  external_consent: 'OFF' | 'ON';
  external_transfer: 'NOT_SENT';
  reason_code?: 'BLOCKED_NATIVE_CLEANUP' | 'PREPARATION_FAILED' | 'CLEANUP_PENDING_OR_FAILED';
}>;

type ImageRuntime = Parameters<typeof createExpoImagePreparer>[0];
type CameraC2Options = Readonly<{
  getLive(): CameraC2Live | undefined;
  runtime?: ImageRuntime;
  cleanup?: OwnedCacheCleanupPort;
  onChange?(): void;
}>;

/** Separate, ephemeral C2 authority. No provider or send operation exists here. */
export function createCameraC2RuntimeController(options: CameraC2Options) {
  const consent = createMealExternalConsentStore();
  const preparer = createExpoImagePreparer(options.runtime, options.cleanup);
  const preparation = createLocalImagePreparationService(consent, preparer.port);
  let operationEpoch = 0;
  let preparationRevision = 0;
  let token = Object.freeze({}) as CameraC2ViewToken;
  let state: CameraC2State = 'CONSENT_REQUIRED';
  let reason: CameraC2View['reason_code'];
  let bound: CameraC2Live | undefined;
  let receipt: PreparedMealBoundaryReceipt | undefined;
  let pending: Promise<boolean> | undefined;

  const publish = () => {
    token = Object.freeze({}) as CameraC2ViewToken;
    options.onChange?.();
  };
  const sameLive = (a: CameraC2Live, b: CameraC2Live): boolean =>
    a.actionSource === b.actionSource
    && a.actionSource.identity === b.actionSource.identity
    && a.safety_revision === b.safety_revision
    && a.owner.access === b.owner.access
    && a.owner.lease === b.owner.lease
    && a.accepted === b.accepted
    && a.c1.session_id === b.c1.session_id
    && a.c1.task_id === b.c1.task_id
    && a.c1.revision === b.c1.revision
    && a.c1.context_id === b.c1.context_id
    && a.c1.candidate_id === b.c1.candidate_id
    && a.c1.permission_revision === b.c1.permission_revision
    && b.projection.image.state === 'present'
    && b.projection.image.id === b.c1.context_id
    && b.projection.image.usable
    && b.projection.image.permission_revision === b.c1.permission_revision
    && b.projection.permission.status === 'allowed'
    && b.projection.permission.revision === b.c1.permission_revision
    && b.projection.boundary === 'within_slice'
    && b.m4_sufficient === true;
  const current = (): CameraC2Live | undefined => {
    const live = options.getLive();
    if (!live?.owner || !live.actionSource) return undefined;
    let action: ReturnType<CameraC2ActionSource['current']>;
    try { action = live.actionSource.current(); } catch { return undefined; }
    if (!action || action.safety_state !== 'OPEN' || action.availability !== 'AVAILABLE'
      || action.safety_revision !== live.safety_revision
      || action.session_id !== live.accepted.session_id
      || action.task_id !== live.accepted.task_id
      || action.revision !== live.accepted.revision) return undefined;
    try {
      const scope = live.owner.access.requireLease(live.owner.lease);
      const snapshot = live.owner.access.getSnapshot();
      if (snapshot.phase !== 'READY' || snapshot.generation !== scope.generation
        || snapshot.owner.subjectId !== scope.owner.subjectId
        || snapshot.owner.profileId !== scope.owner.profileId
        || live.owner.subject_id !== scope.owner.subjectId) return undefined;
    } catch { return undefined; }
    if (live.projection.image.state !== 'present'
      || live.projection.image.id !== live.c1.context_id
      || !live.projection.image.usable
      || live.projection.image.permission_revision !== live.c1.permission_revision
      || live.projection.permission.status !== 'allowed'
      || live.projection.permission.revision !== live.c1.permission_revision
      || live.projection.boundary !== 'within_slice'
      || live.m4_sufficient !== true) return undefined;
    return live;
  };
  const invalidate = (next: CameraC2State = 'CONSENT_REQUIRED') => {
    operationEpoch += 1;
    receipt = undefined;
    bound = undefined;
    consent.retire();
    preparation.retire();
    state = next;
    reason = undefined;
    publish();
  };
  const verify = (): CameraC2Live | undefined => {
    const live = current();
    if (bound && (!live || !sameLive(bound, live) || !consent.getCurrent())) {
      invalidate(live ? 'CONSENT_REQUIRED' : 'UNAVAILABLE');
    }
    if (live && !bound && state === 'UNAVAILABLE') state = 'CONSENT_REQUIRED';
    return live;
  };
  const authorizedToken = (value: unknown): boolean => value === token;

  const prepareCurrent = (live: CameraC2Live): Promise<boolean> => {
    const activeConsent = consent.getCurrent();
    if (!activeConsent || !consent.isCurrent(activeConsent)) return Promise.resolve(false);
    state = 'PREPARING_LOCAL';
    reason = undefined;
    receipt = undefined;
    const epoch = ++operationEpoch;
    publish();
    const task = (async (): Promise<boolean> => {
      // Retire A's exact cache before B may produce an artifact, even if A
      // completed late after revocation.
      if (pending) await pending;
      if (!(await preparer.settleCleanup())) {
        if (epoch === operationEpoch) {
          state = 'BLOCKED'; reason = 'CLEANUP_PENDING_OR_FAILED'; publish();
        }
        return false;
      }
      const before = current();
      if (epoch !== operationEpoch || !bound || !before || !sameLive(bound, before)
        || !consent.isCurrent(activeConsent)) return false;
      if (!preparer.nativeCleanupAvailable && !options.runtime) {
        state = 'BLOCKED'; reason = 'BLOCKED_NATIVE_CLEANUP'; publish();
        return false;
      }
      const result = await preparation.prepare({
        source: sourceRef,
        c1_context: live.c1,
        current_c1: live.projection,
        consent: activeConsent,
      });
      const after = current();
      if (epoch !== operationEpoch || !bound || !after || !sameLive(bound, after)
        || !consent.isCurrent(activeConsent)) return false;
      if (result.state === 'BLOCKED') {
        state = 'BLOCKED'; reason = 'PREPARATION_FAILED'; publish();
        return false;
      }
      receipt = Object.freeze({
        kind: 'MEAL_IMAGE_PREPARATION_RECEIPT',
        version: 1,
        state: 'PREPARED_NOT_SENT',
        purpose: MEAL_IMAGE_EXTERNAL_ANALYSIS,
        preparation_revision: ++preparationRevision,
        artifact: result,
      });
      state = 'PREPARED_NOT_SENT';
      publish();
      return true;
    })();
    pending = task;
    void task.finally(() => { if (pending === task) pending = undefined; });
    return task;
  };
  let sourceRef: NonNullable<ReturnType<typeof preparer.bindAcceptedPhoto>>;

  return Object.freeze({
    view: (): CameraC2View => {
      const live = verify();
      return Object.freeze({
        state: live ? state : 'UNAVAILABLE',
        view_token: token,
        external_consent: consent.getCurrent() && live ? 'ON' : 'OFF',
        external_transfer: 'NOT_SENT',
        ...(reason && live ? { reason_code: reason } : {}),
      });
    },
    allowExternalProcessingAndPrepare: (viewToken: unknown): Promise<boolean> => {
      const live = verify();
      if (!authorizedToken(viewToken) || !live
        || !['CONSENT_REQUIRED', 'LOCAL_ONLY_DECLINED'].includes(state)) return Promise.resolve(false);
      if (!consent.bind(live.c1) || !preparer.bind({
        session_id: live.accepted.session_id,
        task_id: live.accepted.task_id,
        revision: live.accepted.revision,
      })) return Promise.resolve(false);
      const source = preparer.bindAcceptedPhoto(live.accepted);
      const granted = consent.allow(live.c1);
      if (!source || !granted) { invalidate(); return Promise.resolve(false); }
      sourceRef = source;
      bound = live;
      return prepareCurrent(live);
    },
    declineExternalProcessing: (viewToken: unknown): boolean => {
      if (!authorizedToken(viewToken) || !verify()) return false;
      invalidate('LOCAL_ONLY_DECLINED');
      return true;
    },
    revokeExternalProcessing: (viewToken: unknown): boolean => {
      if (!authorizedToken(viewToken) || !verify() || !consent.getCurrent()) return false;
      invalidate();
      return true;
    },
    retryLocalPreparation: (viewToken: unknown): Promise<boolean> => {
      const live = verify();
      if (!authorizedToken(viewToken) || !live || !bound || !sameLive(bound, live)
        || !consent.getCurrent() || state !== 'BLOCKED') return Promise.resolve(false);
      return prepareCurrent(live);
    },
    isCurrentReceipt: (candidate: unknown): boolean => {
      const live = verify();
      return Boolean(live && bound && sameLive(bound, live)
        && candidate === receipt && receipt?.state === 'PREPARED_NOT_SENT'
        && consent.getCurrent() && preparer.port.resolvePrivate(receipt.artifact));
    },
    currentReceipt: (): PreparedMealBoundaryReceipt | undefined => {
      const live = verify();
      return live && bound && sameLive(bound, live) ? receipt : undefined;
    },
    retire: () => invalidate('UNAVAILABLE'),
    cleanupStatus: preparer.cleanupStatus,
    settleCleanup: preparer.settleCleanup,
  });
}


// S21A-REV2 data-only capability: constructing this controller performs no I/O.
import type {VisionScope,VisionGrant} from '../../../../lib/api-zod/src/c2-vision.ts';
import type {resolveCoachPresenceM4} from '../../domain/m4/coach-presence.ts';
import type {CoachPresenceProposal} from '../../domain/m5/coach-presence.ts';
import type {createSanitizedVisionImagePreparer} from './expo-image-preparer.ts';
export type CoachPresenceLive=Readonly<{
 access:OwnerAccess;lease:SessionLease;scope:VisionScope;localUri:string;epoch:number;
 task:Parameters<typeof resolveCoachPresenceM4>[1];
}>;
export async function createCoachPresenceC2Runtime(options:Readonly<{
 readCurrent():CoachPresenceLive|undefined;
 preparer:ReturnType<typeof createSanitizedVisionImagePreparer>;
 permission(scope:VisionScope,signal:AbortSignal):Promise<VisionGrant>;
 revokeGrant(grant:VisionGrant):Promise<boolean>;
 send(grant:VisionGrant,bytes:Uint8Array,signal:AbortSignal):Promise<Readonly<{grant:VisionGrant;result:unknown}>>;
 now?:()=>number;
}>){
 const [{readVisionGrant,sameVisionScope,validateCoachVisionOutput},{createCoachPresenceConsent},{resolveCoachPresenceM4},{proposeCoachPresence}]=await Promise.all([
  import('../../../../lib/api-zod/src/c2-vision.ts'),import('../../domain/camera/coach-presence.ts'),
  import('../../domain/m4/coach-presence.ts'),import('../../domain/m5/coach-presence.ts')]);
 const now=options.now??Date.now,consent=createCoachPresenceConsent();
 let epoch=0,bound:CoachPresenceLive|undefined,grant:VisionGrant|undefined,prepared:object|undefined;
 let proposal:CoachPresenceProposal|undefined,controller:AbortController|undefined,unsubscribe:(()=>void)|undefined;
 let state='CONSENT_REQUIRED';
 let revokeFailed=false;const pendingRevokes=new Set<Promise<void>>();
 const invalidate=()=>{
  const previousGrant=grant;
  if(previousGrant){const pending=Promise.resolve().then(()=>options.revokeGrant(previousGrant)).then(ok=>{if(ok!==true)revokeFailed=true;}).catch(()=>{revokeFailed=true;});pendingRevokes.add(pending);void pending.finally(()=>pendingRevokes.delete(pending));}
  epoch++;controller?.abort();controller=undefined;grant=undefined;prepared=undefined;proposal=undefined;
  bound=undefined;consent.retire();options.preparer.retire();unsubscribe?.();unsubscribe=undefined;state='CONSENT_REQUIRED';
 };
 const live=()=>{
  try{
   const value=options.readCurrent();if(!value||resolveCoachPresenceM4(value.scope,value.task)!=='SUFFICIENT')return undefined;
   const lease=value.access.requireLease(value.lease),owner=value.access.getSnapshot();
   if(owner.phase!=='READY'||lease.generation!==owner.generation||lease.validUntil<=now())return undefined;
   return value;
  }catch{return undefined;}
 };
 const same=(a:CoachPresenceLive,b:CoachPresenceLive)=>a.access===b.access&&a.lease===b.lease
  &&a.epoch===b.epoch&&a.localUri===b.localUri&&sameVisionScope(a.scope,b.scope);
 const check=(captured:CoachPresenceLive,operation:number,receipt:object)=>{
  const current=live();return epoch===operation&&bound===captured&&current&&same(captured,current)&&consent.isCurrent(receipt);
 };
 return Object.freeze({
  allowAndPrepare:async(explicitHumanChoice:boolean)=>{
   const current=live();if(!current||explicitHumanChoice!==true)return false;
   invalidate();bound=current;consent.bind(current.scope);const receipt=consent.allow(true)!;
   const operation=++epoch;controller=new AbortController();const signal=controller.signal;
   unsubscribe=current.access.subscribe(()=>{const latest=live();if(!latest||!bound||!same(bound,latest))invalidate();});
   try{
    const issued=readVisionGrant(await options.permission(current.scope,signal));
    if(!check(current,operation,receipt)||!sameVisionScope(issued,current.scope)||issued.expiresAt<=now())return false;
    grant=issued;const token=await options.preparer.prepare(current.localUri,()=>Boolean(check(current,operation,receipt)&&grant&&grant.expiresAt>now()));
    if(!check(current,operation,receipt))return false;
    prepared=token;state='READY_NOT_SENT';return true;
   }catch{if(epoch===operation){invalidate();state='BLOCKED';}return false;}
  },
  analyze:async()=>{
   const current=live(),captured=bound,capturedGrant=grant,capturedPrepared=prepared,operation=epoch;
   if(!current||!captured||!same(captured,current)||!capturedGrant||!capturedPrepared||capturedGrant.expiresAt<=now()||state!=='READY_NOT_SENT'){
    invalidate();return false;
   }
   const bytes=options.preparer.bytes(capturedPrepared);if(!bytes){invalidate();return false;}
   controller=new AbortController();const signal=controller.signal;state='ANALYZING';
   const stillCurrent=()=>{const x=live();return epoch===operation&&x&&bound===captured&&same(captured,x)
    &&grant===capturedGrant&&capturedGrant.expiresAt>now()&&!signal.aborted;};
   try{
    if(!stillCurrent())return false;
    const result=await options.send(capturedGrant,bytes,signal);
    if(!stillCurrent())return false;
    const returned=readVisionGrant(result.grant);
    if(JSON.stringify(returned)!==JSON.stringify(capturedGrant))throw Error('C2_RESPONSE_SCOPE');
    const safe=validateCoachVisionOutput(capturedGrant.vision_domain,result.result);
    if(!stillCurrent())return false;
    if(safe.state==='BLOCKED')throw Error('C2_UNSAFE_OUTPUT');
    proposal=proposeCoachPresence(capturedGrant.vision_domain,safe);
    state=proposal?'PROPOSAL':'NEED_MORE_INFO';return true;
   }catch{if(epoch===operation){invalidate();state='BLOCKED';}return false;}
  },
  view:()=>{const x=live();if(bound&&(!x||!same(bound,x)||grant&&grant.expiresAt<=now()))invalidate();
   return Object.freeze({state,proposal,requires_user_choice:true,M6_STARTED:false,M7_USE_NEXT_CYCLE:false,serverRevocation:pendingRevokes.size?'PENDING':revokeFailed?'UNCONFIRMED':'NO_FAILURE_OBSERVED'});},
  revoke:invalidate,logout:invalidate,retire:invalidate,settleCleanup:options.preparer.settleCleanup,
  settleRevocations:async()=>{await Promise.all([...pendingRevokes]);return !revokeFailed;},
 });
}
