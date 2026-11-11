import type { M2Snapshot } from '../m2';
import type { LeaseScope, OwnerAccess, SessionLease } from '../local-owner/boundary';

// Consumer only. No history authority is implemented here. A matching issuer
// string and completeness flags validate a claim, never its provenance.
export type KnownNoneWitness = Readonly<{
  status: 'known_none'; issuer: 'VERIFIED_HISTORY_AUTHORITY';
  owner: Readonly<{ subjectId: string; profileId: string }>;
  sessionGeneration: number; basisRevision: string;
  completeness: Readonly<{ profile: true; goal: true; activeTask: true; returning: true }>;
  observedAt: number; validUntil: number;
}>;
export type TrustedM2FactsReader = Readonly<{
  access: OwnerAccess; lease: SessionLease;
  // Supplied only by a host that has independently admitted the upstream source.
  // Production root supplies none. Test readers remain TEST_FIXTURE evidence.
  readFacts(): unknown;
  isBasisCurrent(basisRevision: string): boolean;
}>;
type Lifecycle = Readonly<{ session_id: string | null; revision: number; tasksEmpty: boolean }>;
type Entry = { reader: TrustedM2FactsReader; retired: boolean; lifetime?: object;
  session?: string; revision?: number; basis?: string; scope?: LeaseScope };
const entries = new WeakMap<M2Snapshot, Entry>();
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export function validateKnownNoneWitness(
  value: unknown, scope: LeaseScope, now: number,
): value is KnownNoneWitness {
  try {
    if (!record(value) || value.status !== 'known_none'
      || value.issuer !== 'VERIFIED_HISTORY_AUTHORITY') return false;
    const owner = value.owner, complete = value.completeness;
    if (!record(owner) || !record(complete)
      || owner.subjectId !== scope.owner.subjectId || owner.profileId !== scope.owner.profileId
      || value.sessionGeneration !== scope.generation
      || typeof value.basisRevision !== 'string' || value.basisRevision.length < 1
      || value.basisRevision.length > 255 || value.basisRevision.trim() !== value.basisRevision
      || /[\u0000-\u001f\u007f-\u009f]/u.test(value.basisRevision)
      || complete.profile !== true || complete.goal !== true
      || complete.activeTask !== true || complete.returning !== true) return false;
    const at = value.observedAt, until = value.validUntil;
    return typeof at === 'number' && typeof until === 'number'
      && Number.isFinite(at) && Number.isFinite(until) && Number.isFinite(now)
      && Number.isFinite(scope.validUntil) && at <= now && now < until
      && until <= scope.validUntil;
  } catch { return false; }
}

export function projectAuthoritativeM2Baseline(
  base: M2Snapshot, reader?: TrustedM2FactsReader,
): M2Snapshot {
  const snapshot: M2Snapshot = Object.freeze({ ...base,
    subject: Object.freeze({ ...base.subject, profile: 'unknown' as const }),
    goal: 'unknown', activeTask: Object.freeze({ kind: 'unknown' as const }),
    returning: Object.freeze({ kind: 'unknown' as const }) });
  if (reader) entries.set(snapshot, { reader: Object.freeze({ ...reader }), retired: false });
  return snapshot;
}

export function retireAuthoritativeM2Baseline(base: M2Snapshot): void {
  const entry = entries.get(base);
  if (entry) entry.retired = true;
}

// Exact snapshot-object carrier avoids a fifth-file M2Gateway type change.
// Entries are private RAM, not serializable grants and not cryptographic proof.
export function readAuthoritativeKnownNone(
  base: M2Snapshot, access: OwnerAccess, lease: SessionLease,
  lifetime: object, lifecycle: Lifecycle, now: number,
): KnownNoneWitness | undefined {
  const entry = entries.get(base);
  if (!entry || entry.retired) return undefined;
  const fail = () => { entry.retired = true; return undefined; };
  try {
    const reader = entry.reader;
    if (reader.access !== access || reader.lease !== lease) return fail();
    const scope = access.requireLease(lease);
    if (access.getSnapshot().phase !== 'READY' || base.subject.id !== scope.owner.subjectId
      || !lifecycle.tasksEmpty || !lifecycle.session_id) return fail();
    if (entry.lifetime === undefined) {
      // SessionTaskStore.start publishes the pristine snapshot at revision 1.
      // A later revision is conservatively rejected, even when RAM is empty.
      if (lifecycle.revision !== 1) return fail();
      entry.lifetime = lifetime; entry.session = lifecycle.session_id;
      entry.revision = lifecycle.revision; entry.scope = scope;
    }
    if (entry.lifetime !== lifetime || entry.session !== lifecycle.session_id
      || entry.revision !== lifecycle.revision || entry.scope !== scope) return fail();
    const value = reader.readFacts();
    if (!validateKnownNoneWitness(value, scope, now)) return fail();
    // Freeze a value copy so subsequent mutations cannot change the issued view.
    const witness: KnownNoneWitness = Object.freeze({ ...value,
      owner: Object.freeze({ ...value.owner }),
      completeness: Object.freeze({ ...value.completeness }) });
    if (!validateKnownNoneWitness(witness, scope, Math.max(now, Date.now()))
      || (entry.basis !== undefined && entry.basis !== witness.basisRevision)
      || !reader.isBasisCurrent(witness.basisRevision)
      || access.requireLease(lease) !== scope || access.getSnapshot().phase !== 'READY') return fail();
    entry.basis = witness.basisRevision;
    return witness;
  } catch { return fail(); }
}

export type UnifiedM2State='UNKNOWN'|'NEW'|'IN_PROGRESS'|'RETURNING'|'CHANGED'|'JUST_COMPLETED';
export type UnifiedOwnerFacts = Readonly<{state:UnifiedM2State;epoch:number;facts?:Readonly<Record<string,any>>}>;
const EMPTY_UNIFIED:UnifiedOwnerFacts=Object.freeze({state:'UNKNOWN',epoch:0});
type UnifiedBridge={getSnapshot():UnifiedOwnerFacts;read():UnifiedOwnerFacts;refresh():Promise<void>;invalidate():void;dispose():void};
const unifiedBridges=new WeakMap<OwnerAccess,Map<SessionLease,UnifiedBridge>>();
const unifiedListeners=new WeakMap<OwnerAccess,Set<()=>void>>();
function emitUnified(access:OwnerAccess){for(const fn of [...(unifiedListeners.get(access)??[])])try{fn()}catch{}}
export function subscribeUnifiedOwnerFacts(access:OwnerAccess|undefined,fn:()=>void):()=>void{
 if(!access)return()=>{};let set=unifiedListeners.get(access);if(!set){set=new Set();unifiedListeners.set(access,set);}set.add(fn);return()=>{set!.delete(fn)};
}
export function getUnifiedOwnerFacts(access?:OwnerAccess,lease?:SessionLease):UnifiedOwnerFacts{
 return access&&lease?unifiedBridges.get(access)?.get(lease)?.read()??EMPTY_UNIFIED:EMPTY_UNIFIED;
}
export function invalidateUnifiedOwnerFacts(access:OwnerAccess,lease:SessionLease):void{unifiedBridges.get(access)?.get(lease)?.invalidate();}
/** Only the trusted owner composition supplies authenticated transport. TEST_FIXTURE remains explicit. */
export function createUnifiedOwnerFactsBridge(options:Readonly<{access:OwnerAccess;lease:SessionLease;load(signal:AbortSignal):Promise<unknown>;allowTestFixture?:boolean;subscribeRemote?:(fn:()=>void)=>()=>void;now?:()=>number}>):UnifiedBridge{
 const {access,lease}=options,now=options.now??Date.now;let state=EMPTY_UNIFIED,epoch=0,dead=false,ticket=0,highVersion=0,highFingerprint:string|undefined,binding:string|undefined;let controller:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 const unknown=()=>{epoch++;state=Object.freeze({state:'UNKNOWN',epoch});if(timer)clearTimeout(timer);emitUnified(access);};
 const invalidate=()=>{ticket++;controller?.abort();controller=undefined;unknown();};
 const current=()=>{const scope=access.requireLease(lease),owner=access.getSnapshot();if(owner.phase!=='READY'||owner.generation!==scope.generation||now()>=scope.validUntil)throw Error('OWNER_FACTS_STALE');return scope;};
 const read=()=>{if(dead)return EMPTY_UNIFIED;try{const scope=current(),f=state.facts;if(f&&(f.owner.subjectId!==scope.owner.subjectId||f.owner.profileId!==scope.owner.profileId||now()>=f.validUntil)){invalidate();}}catch{if(state.state!=='UNKNOWN'||state.facts)invalidate();}return state;};
 const refresh=async()=>{if(dead)return;const sequence=++ticket;controller?.abort();const signal=new AbortController();controller=signal;unknown();try{const scope=current(),raw=await options.load(signal.signal);if(sequence!==ticket||dead||signal.signal.aborted)return;
  const text=JSON.stringify(raw);if(text.length>16000)throw Error('OWNER_FACTS_BOUND');const f=JSON.parse(text);
  if(f.version!=='owner-facts.v1'||!['TEST_FIXTURE','PRODUCTION_OWNED'].includes(f.provenance)||(f.provenance==='TEST_FIXTURE'&&!options.allowTestFixture))throw Error('OWNER_FACTS_PROVENANCE');
  if(f.owner?.subjectId!==scope.owner.subjectId||f.owner?.profileId!==scope.owner.profileId||!Number.isSafeInteger(f.sourceVersion)||f.sourceVersion<1||f.sourceVersion<highVersion
   ||typeof f.sessionBinding!=='string'||!f.sessionBinding||binding&&binding!==f.sessionBinding||f.basisRevision!==f.sourceVersion+':'+f.sessionBinding
   ||!Number.isFinite(f.observedAt)||f.observedAt>now()||!Number.isFinite(f.validUntil)||f.validUntil<=now()||f.validUntil>scope.validUntil)throw Error('OWNER_FACTS_SCOPE');
  if(f.sourceVersion===highVersion&&highFingerprint!==text)throw Error('OWNER_FACTS_COLLISION');
  const taskValid=f.task&&typeof f.task.id==='string'&&f.task.id.length>0&&typeof f.task.sessionId==='string'&&Number.isSafeInteger(f.task.revision)&&f.task.revision>0;
  const c=f.complete,complete=c?.profile===true&&c.goal===true&&c.activeTask===true&&c.returning===true,t=f.task;let derived:UnifiedM2State='UNKNOWN';
  if(complete&&['new','existing'].includes(f.profile)&&['none','confirmed'].includes(f.goal)){
   if(taskValid&&t.status==='ENDED'&&t.endKind==='USER_REPORTED_END')derived='JUST_COMPLETED';
   else if(f.change?.kind==='USER_CONFIRMED_CHANGE'&&f.change.revision===f.sourceVersion&&f.change.observedAt<=now())derived='CHANGED';
   else if(taskValid&&t.status==='STARTED'&&t.startKind==='USER_REPORTED_START')derived='IN_PROGRESS';
   else if(t===null&&f.returning?.kind==='USER_CONFIRMED_RETURN'&&f.returning.planId&&f.returning.title)derived='RETURNING';
   else if(t===null&&f.returning===null&&f.profile==='new'&&f.goal==='none')derived='NEW';
  }
  if(f.state!==derived||current()!==scope)throw Error('OWNER_FACTS_STATE');
  highVersion=f.sourceVersion;highFingerprint=text;binding=f.sessionBinding;state=Object.freeze({state:derived,epoch:++epoch,facts:Object.freeze(f)});
  timer=setTimeout(invalidate,Math.max(1,Math.min(2147483647,f.validUntil-now())));emitUnified(access);
 }catch{if(sequence===ticket&&!dead)unknown();}finally{if(controller===signal)controller=undefined;}};
 let map=unifiedBridges.get(access);if(!map){map=new Map();unifiedBridges.set(access,map);}map.get(lease)?.dispose();
 const offOwner=access.subscribe(()=>{try{current()}catch{invalidate()}});const offRemote=options.subscribeRemote?.(()=>{invalidate();void refresh()});
 const bridge:UnifiedBridge={getSnapshot:()=>state,read,refresh,invalidate,dispose:()=>{dead=true;invalidate();offOwner();offRemote?.();if(map!.get(lease)===bridge)map!.delete(lease);emitUnified(access);}};map.set(lease,bridge);emitUnified(access);return bridge;
}
export function projectUnifiedOwnerM2(base:M2Snapshot,access?:OwnerAccess,lease?:SessionLease):Readonly<{state:UnifiedM2State;snapshot:M2Snapshot}>|undefined{
 if(!access||!lease||!unifiedBridges.get(access)?.has(lease))return undefined;const result=getUnifiedOwnerFacts(access,lease),f=result.facts;
 const unknown: M2Snapshot={...base,subject:{...base.subject,profile:'unknown'},goal:'unknown',activeTask:{kind:'unknown'},returning:{kind:'unknown'}};
 if(!f||result.state==='UNKNOWN')return{state:'UNKNOWN',snapshot:unknown};
 const snapshot:M2Snapshot={...base,revision:base.revision+'|canonical:'+f.basisRevision,subject:{...base.subject,id:f.owner.subjectId,profile:f.profile},goal:f.goal,activeTask:{kind:'none'},returning:{kind:'none'},explicitIntent:false};
 if(result.state==='IN_PROGRESS'||result.state==='JUST_COMPLETED')snapshot.activeTask={kind:'reported_action',id:f.task.actionId??f.task.id,subjectId:f.owner.subjectId,episode:f.task.sessionId+':'+f.task.id+':'+f.task.revision,phase:result.state==='IN_PROGRESS'?'started':'ended_by_user'};
 if(result.state==='RETURNING')snapshot.returning={kind:'after_absence',plan:{id:f.returning.planId,title:f.returning.title},evidence:{subjectId:f.owner.subjectId,source:f.provenance==='TEST_FIXTURE'?'fixture':'user_confirmed',observedAt:f.observedAt,validUntil:f.validUntil,freshness:'current'}};
 if(result.state==='CHANGED'){snapshot.explicitIntent=true;snapshot.activeTask={kind:'other'};}
 return{state:result.state,snapshot};
}
