import { createGuardedUserStorage, type LocalStorageBackend, type JsonValue } from '../local-owner/storage';
import type { OwnerSessionBinding } from '../identity/owner-session-coordinator';
import type { TaskRef } from '../session-task/store';
import { deriveM7NextCycleFragment } from './next-cycle';
import type { M7NextCycleFragment } from './next-cycle';
import { observeM7Purpose, readM7Purpose, sameM7EpisodeRef, sameM7EpisodeTask,
  sanitizeM7OutcomeInput, sanitizeM7FeedbackInput, reduceM7RecordPurpose,
  withM7PurposePublicationHeld, readM7RecordPurposeState } from './outcome';
import type { M7ActiveOutcome, M7EpisodeIdentity, M7OutcomeEvidence, M7OutcomeRevision,
  M7OutcomeSnapshot, M7PurposeAccess, M7PurposeReceipt, M7FeedbackRevision,
  M7FeedbackSnapshot } from './outcome';

const UNKNOWN = Object.freeze({ state: 'UNKNOWN' as const });
const DENIED = Object.freeze({ state: 'DENIED' as const });
const UNAVAILABLE = Object.freeze({ state: 'UNAVAILABLE' as const });
type Component = 'R' | 'F';
type Revision = M7OutcomeRevision | M7FeedbackRevision;
type Result = M7OutcomeSnapshot | M7FeedbackSnapshot;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_.-]{1,96}$/.test(id);

export function createM7OutcomeStore(options: {
  binding?: OwnerSessionBinding; purpose?: M7PurposeAccess; now: () => number;
  issued: (ref: TaskRef) => boolean;
  episode: (ref: TaskRef) => M7EpisodeIdentity | undefined;
  episodeCurrent: (episode: M7EpisodeIdentity) => boolean;
  episodeRetained?: (episode: M7EpisodeIdentity) => boolean;
  lineageCleared?: (episode: M7EpisodeIdentity) => void;
  holdGuidance: () => void;
  intake: (episode: M7EpisodeIdentity) => object | undefined;
  closeIntake: () => void;
  ended: (ref: TaskRef) => boolean;
}) {
  const binding = options.binding && Object.freeze({ ...options.binding });
  let retired = false, sequence = 0, basisRevision = 0, requestCount = 0, activityVersion = 0;
  let recordReceipt: M7PurposeReceipt | undefined;
  let archiveSignature='',lastArchive:ReturnType<typeof createM7Persistence>|undefined;
  let completedRef:TaskRef|undefined,archiveStop:(()=>void)|undefined,observedArchive:ReturnType<typeof createM7Persistence>|undefined;
  const persistenceState=()=>{const host=archiveFor(binding);if(host!==observedArchive){archiveStop?.();observedArchive=host;archiveStop=host?.subscribe(()=>changed());}return host?.getSnapshot().phase??'RAM_ONLY';};
  const syncArchive=()=>{if(!completedRef||!ownerReady()||!options.issued(completedRef)||!options.ended(completedRef)||!recordReceipt||!permitted(recordReceipt))return;
    const r=heads.R,f=heads.F;if(!r&&!f)return;const host=archiveFor(binding);if(!host||!binding)return;
    const signature=JSON.stringify([r,f]);if(lastArchive===host&&archiveSignature===signature)return;
    const saved=archiveWriters.get(host)?.save({schema:1,owner:binding.access.requireLease(binding.lease).owner,completion:'USER_REPORTED_END',saved_at:options.now(),reuseForNextCycle:false,...(r?{R:r as M7OutcomeRevision}:{}),...(f?{F:f as M7FeedbackRevision}:{})});
    if(saved){lastArchive=host;archiveSignature=signature;}
  };
  const heads: Partial<Record<Component, Revision>> = {};
  const histories: Record<Component, Map<number, Revision>> = { R: new Map(), F: new Map() };
  const deleted = new Set<Component>();
  const requests = new Map<string, Readonly<{ component: Component; signature: string; result: Result }>>();
  const listeners = new Set<() => void>();
  const retained = options.episodeRetained ?? options.episodeCurrent;
  let mutating = false;
  const changed = () => {
    basisRevision++;
    for (const listener of [...listeners]) { try { listener(); } catch { /* observers own no authority */ } }
  };
  const payloadEpisode = () => heads.R?.episode ?? heads.F?.episode;
  const clearData = (close = true, notify = true) => {
    const episode = payloadEpisode();
    const had = !!episode || requests.size > 0 || deleted.size > 0;
    if (close) options.closeIntake();
    delete heads.R; delete heads.F; histories.R.clear(); histories.F.clear();
    requests.clear(); deleted.clear(); recordReceipt = undefined;
    // requestCount is a lifetime admission budget, not erased-content metadata.
    // Erasure never buys another128 requests and never retains erased hashes.
    if (episode) { try { options.lineageCleared?.(episode); } catch { /* private cleanup */ } }
    if (had && notify) changed();
  };
  let unobserve = () => {};
  const retire = () => {
    if (retired) return;
    retired = true; clearData(); unobserve(); archiveStop?.(); listeners.clear();
  };
  const ownerReady = () => {
    if (retired || !binding || !options.purpose) return false;
    try { binding.access.requireLease(binding.lease); return binding.access.getSnapshot().phase === 'READY'; }
    catch { retire(); return false; }
  };
  const refresh = () => {
    if (!ownerReady()) return false;
    const episode = payloadEpisode();
    if (recordReceipt && readM7Purpose(options.purpose, recordReceipt, 'RECORD_OUTCOME') === undefined
      || episode && !retained(episode)) { clearData(); return false; }
    return true;
  };
  let purposeClosure = readM7RecordPurposeState(options.purpose)?.closure;
  unobserve = observeM7Purpose(options.purpose, () => {
    const state = readM7RecordPurposeState(options.purpose);
    if (state?.closure !== purposeClosure) {
      purposeClosure = state?.closure;
      // Purpose closure also invalidates controller-owned drafts when this
      // store has never held a committed head or request. Publish once, after
      // closing intake and clearing all store-owned content.
      clearData(true, false); changed(); return;
    }
    refresh();
  });
  const permitted = (receipt: M7PurposeReceipt | undefined) => ownerReady()
    && readM7Purpose(options.purpose, receipt, 'RECORD_OUTCOME') !== undefined;
  const guarded = (validate: () => boolean, apply: () => void) => {
    if (mutating || !ownerReady() || !binding) return false;
    mutating = true;
    try {
      binding.access.applyIfCurrent(binding.lease, () => {
        if (!ownerReady() || !validate()) throw Error('STALE_RECORD');
        apply();
      });
      return ownerReady();
    } catch { return false; } finally { mutating = false; }
  };
  const head = (component: Component) => refresh() ? heads[component] : undefined;
  const evidence = (episode: M7EpisodeIdentity, receipt: M7PurposeReceipt, time: number,
    occurredAt?: number): M7OutcomeEvidence => Object.freeze({ source: 'USER_REPORT',
    epistemic_role: 'PERSONAL_OBSERVATION_PR0', recorded_at: time,
    ...(occurredAt === undefined ? {} : { occurred_at: occurredAt }),
    task_revision: episode.task_revision, action_version: episode.action_version,
    proposal_revision: episode.proposal_revision, context_revision: episode.context_revision,
    source_revision: episode.source_revision, permission_revision: receipt.revision });
  const replay = (id: string, signature: string): Result | 'NEW' => {
    const prior = requests.get(id);
    if (prior) return prior.signature === signature ? prior.result : DENIED;
    return requestCount < 128 ? 'NEW' : DENIED;
  };
  const commitRequest = (id: string, component: Component, signature: string, result: Result) => {
    requestCount++; requests.set(id, Object.freeze({ component, signature, result }));
  };
  const manage = (component: Component, ref: TaskRef, receipt: M7PurposeReceipt | undefined) => {
    const value = head(component);
    return value && options.issued(ref) && permitted(receipt) && receipt === recordReceipt
      && sameM7EpisodeTask(ref, value.episode) && retained(value.episode) ? value : undefined;
  };
  const newEntry = (component: Component, ref: TaskRef, receipt?: M7PurposeReceipt) => {
    if (!options.issued(ref) || !permitted(receipt) || deleted.has(component)) return undefined;
    refresh();
    const episode = options.episode(ref);
    if (!episode || !sameM7EpisodeRef(ref, episode) || !options.episodeCurrent(episode)) return undefined;
    const intake = options.intake(episode);
    if (!intake || component === 'F' && !options.ended(ref)) return undefined;
    const other = payloadEpisode();
    if (other && (other.episode_key !== episode.episode_key || receipt !== recordReceipt)) return undefined;
    return { episode, intake };
  };
  const mutate = (component: Component, operation: 'report' | 'correct' | 'retract',
    ref: TaskRef, receipt: M7PurposeReceipt | undefined, expected: number | undefined,
    input: Readonly<Record<string, unknown>>): Result => {
    if (mutating || !options.issued(ref) || !permitted(receipt)) return DENIED;
    const previous = operation === 'report' ? undefined : manage(component, ref, receipt);
    const entry = operation === 'report' ? newEntry(component, ref, receipt) : undefined;
    const episode = previous?.episode ?? entry?.episode;
    if (!episode || operation !== 'report' && !previous) return DENIED;
    const parsed = operation === 'retract' ? validId(input.request_id) ? { request_id: input.request_id } : undefined
      : component === 'R' ? sanitizeM7OutcomeInput(input, episode.proposed_minutes) : sanitizeM7FeedbackInput(input);
    if (!parsed) return DENIED;
    const signature = `${component}:${operation}:${expected ?? ''}:${episode.episode_key}:${JSON.stringify(parsed)}`;
    const seen = replay(parsed.request_id, signature);
    if (seen !== 'NEW') return seen;
    if (operation === 'report' ? !!heads[component] : previous?.state !== 'ACTIVE' || previous.revision !== expected) return DENIED;
    const time = options.now(); if (!Number.isFinite(time)) return DENIED;
    const result = Object.freeze({ state: operation === 'retract' ? 'RETRACTED' : 'ACTIVE',
      revision: sequence + 1, ...(previous ? { supersedes_revision: previous.revision } : {}), episode,
      evidence: evidence(episode, receipt!, time, 'occurred_at' in parsed ? parsed.occurred_at as number : undefined),
      ...(operation === 'retract' ? {} : component === 'R'
        ? { outcome: (parsed as ReturnType<typeof sanitizeM7OutcomeInput>)!.facts,
          ...('evidence_text' in parsed && parsed.evidence_text !== undefined ? { evidence_text: parsed.evidence_text } : {}) }
        : { feedback: (parsed as ReturnType<typeof sanitizeM7FeedbackInput>)!.facts }),
    }) as Revision;
    const validate = () => permitted(receipt) && replay(parsed.request_id, signature) === 'NEW'
      && (operation === 'report'
        ? !heads[component] && newEntry(component, ref, receipt)?.intake === entry?.intake
        : manage(component, ref, receipt) === previous && previous!.revision === expected);
    if (!guarded(validate, () => {
      if (previous) histories[component].set(previous.revision, Object.freeze({ ...previous, state: 'SUPERSEDED' }) as Revision);
      sequence++; heads[component] = result; histories[component].set(result.revision, result);
      recordReceipt = receipt; commitRequest(parsed.request_id, component, signature, result);
      if (component === 'R' && 'outcome' in result && result.outcome.safety_disposition !== 'CLEAR') options.holdGuidance();
    })) return DENIED;
    changed();
    // An observer may have erased/revoked/replaced this exact commit.
    if(permitted(receipt)&&head(component)===result){completedRef=ref;syncArchive();return result;}
    return DENIED;
  };
  const erase = (ref: TaskRef, receipt: M7PurposeReceipt | undefined,
    expected: Readonly<Partial<Record<Component, number>>>, requestId: string): Result => {
    if (!validId(requestId) || mutating) return DENIED;
    const components = (['R', 'F'] as const).filter(c => expected[c] !== undefined);
    if (!components.length) return DENIED;
    const previous = components.map(c => manage(c, ref, receipt));
    if (previous.some((v, i) => !v || v.revision !== expected[components[i]])) return DENIED;
    // Reduction does not reserve an increasing slot, but a used ID cannot be relabelled.
    if (requests.has(requestId)) return DENIED;
    const version = activityVersion;
    const publicationRevision = basisRevision;
    let complete = false, final = false, released = false;
    withM7PurposePublicationHeld(options.purpose, () => {
      complete = guarded(() => components.every((c, i) => manage(c, ref, receipt) === previous[i]), () => {
        for (const c of components) {
          delete heads[c]; histories[c].clear(); deleted.add(c);
          for (const [id, value] of requests) if (value.component === c)
            requests.set(id, Object.freeze({ component: c, signature: '', result: DENIED }));
        }
        // A scoped reduction consumes only bounded opaque request identity. It
        // carries no erased payload/signature and cannot be relabelled later.
        if ((heads.R || heads.F) && requestCount < 128) {
          requestCount++;
          requests.set(requestId, Object.freeze({ component: components[0], signature: '', result: DENIED }));
        }
        if (!heads.R && !heads.F) {
          final = true;
          const episode = previous[0]!.episode;
          options.closeIntake(); requests.clear(); deleted.clear(); recordReceipt = undefined;
          try { options.lineageCleared?.(episode); } catch { /* private cleanup */ }
          // Payload and admission closed before any authority observer can run.
          released = reduceM7RecordPurpose(options.purpose, receipt);
        }
      });
    });
    if (!complete || !ownerReady()) return DENIED;
    // Final reduction already publishes its closure after payload removal.
    // Scoped deletion still needs its own publication; never publish a second
    // stale view after a synchronous closure observer has advanced the store.
    if (basisRevision === publicationRevision) changed();
    const archive=archiveFor(binding);if(complete&&archive)archiveWriters.get(archive)?.drop(previous[0]!.episode.episode_key,components);
    return activityVersion === version && components.every(c => !heads[c]) && ownerReady()
      && (final ? released : permitted(receipt) && recordReceipt === receipt) ? UNKNOWN : DENIED;
  };
  const snapshot = (component: Component, receipt?: M7PurposeReceipt): Result => {
    if (!ownerReady()) return UNAVAILABLE;
    if (!permitted(receipt)) return DENIED;
    refresh(); return heads[component] ?? UNKNOWN;
  };
  return Object.freeze({
    getPersistenceState:persistenceState,
    getBasisRevision: () => basisRevision,
    getActivityVersion: () => activityVersion,
    subscribe: (listener: () => void) => { if (retired) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: (receipt?: M7PurposeReceipt) => snapshot('R', receipt) as M7OutcomeSnapshot,
    getFeedbackSnapshot: (receipt?: M7PurposeReceipt) => snapshot('F', receipt) as M7FeedbackSnapshot,
    getRevision: (revision: number, receipt?: M7PurposeReceipt) => permitted(receipt) && refresh() ? histories.R.get(revision) as M7OutcomeRevision | undefined : undefined,
    getFeedbackRevision: (revision: number, receipt?: M7PurposeReceipt) => permitted(receipt) && refresh() ? histories.F.get(revision) as M7FeedbackRevision | undefined : undefined,
    report: (ref: TaskRef, receipt: M7PurposeReceipt | undefined, input: Readonly<Record<string, unknown>>) => mutate('R', 'report', ref, receipt, undefined, input) as M7OutcomeSnapshot,
    correct: (ref: TaskRef, receipt: M7PurposeReceipt | undefined, revision: number, input: Readonly<Record<string, unknown>>) => mutate('R', 'correct', ref, receipt, revision, input) as M7OutcomeSnapshot,
    retract: (ref: TaskRef, receipt: M7PurposeReceipt | undefined, revision: number, id: string) => mutate('R', 'retract', ref, receipt, revision, { request_id: id }) as M7OutcomeSnapshot,
    delete: (ref: TaskRef, receipt: M7PurposeReceipt | undefined, revision: number, id: string) => erase(ref, receipt, { R: revision }, id) as M7OutcomeSnapshot,
    reportFeedback: (ref: TaskRef, receipt: M7PurposeReceipt | undefined, input: Readonly<Record<string, unknown>>) => mutate('F', 'report', ref, receipt, undefined, input) as M7FeedbackSnapshot,
    correctFeedback: (ref: TaskRef, receipt: M7PurposeReceipt | undefined, revision: number, input: Readonly<Record<string, unknown>>) => mutate('F', 'correct', ref, receipt, revision, input) as M7FeedbackSnapshot,
    retractFeedback: (ref: TaskRef, receipt: M7PurposeReceipt | undefined, revision: number, id: string) => mutate('F', 'retract', ref, receipt, revision, { request_id: id }) as M7FeedbackSnapshot,
    erase,
    canRecord: (ref: TaskRef, component: Component) => {
      const episode = options.issued(ref) && options.episode(ref);
      return !!episode && ownerReady() && !deleted.has(component) && !heads[component]
        && options.episodeCurrent(episode) && !!options.intake(episode) && (component === 'R' || options.ended(ref));
    },
    isComponentDeleted: (component: Component) => deleted.has(component),
    hasRetained: () => refresh() && !!payloadEpisode(),
    readNextCycle: (receipt: M7PurposeReceipt | undefined): M7NextCycleFragment | undefined => {
      const record = head('R');
      if (record?.state !== 'ACTIVE' || !('outcome' in record) || readM7Purpose(options.purpose, receipt, 'USE_NEXT_CYCLE') === undefined) return undefined;
      return deriveM7NextCycleFragment(record as M7ActiveOutcome, receipt!);
    },
    // Called only by the same store at a genuine Start, without observers.
    beginActivity: () => { activityVersion++; clearData(false, false); },
    taskChanged: () => { if(refresh())syncArchive(); },
    retire,
  });
}

// Completed report archive: data only. Never rehydrate TaskRef, purpose receipts or next-cycle authority.
export type CompletedM7Report = Readonly<{
  schema: 1; owner: Readonly<{subjectId:string;profileId:string}>;
  completion: 'USER_REPORTED_END'; saved_at:number; reuseForNextCycle:false;
  R?: M7OutcomeRevision; F?: M7FeedbackRevision;
}>;
export type M7ArchiveSnapshot = Readonly<{phase:'RAM_ONLY'|'LOADING'|'EMPTY'|'SAVING'|'SAVED'|'ERROR';report?:CompletedM7Report}>;
const RAM_ARCHIVE:M7ArchiveSnapshot=Object.freeze({phase:'RAM_ONLY'});
const archiveHubs=new WeakMap<OwnerSessionBinding['access'],WeakMap<OwnerSessionBinding['lease'],ReturnType<typeof createM7Persistence>>>();
function ownData(value:unknown,allowed:readonly string[],required:readonly string[]=allowed):Record<string,any>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('M7_ARCHIVE_SCHEMA');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Object.keys(descriptors).length>24||Object.keys(descriptors).some(k=>!allowed.includes(k)||!('value'in descriptors[k]))||required.some(k=>!Object.hasOwn(descriptors,k)))throw Error('M7_ARCHIVE_SCHEMA');
  return value as Record<string,any>;
}
const positiveM7=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>0;
function completedRevision(value:unknown,component:'R'|'F'):{episode:M7EpisodeIdentity}&Record<string,any>{
  const v=ownData(value,['state','revision','supersedes_revision','episode','evidence',component==='R'?'outcome':'feedback','evidence_text'],['state','revision','episode','evidence']);
  if(!['ACTIVE','RETRACTED'].includes(v.state)||v.state==='RETRACTED'&&v.supersedes_revision===undefined||!positiveM7(v.revision)||v.supersedes_revision!==undefined&&(!positiveM7(v.supersedes_revision)||v.supersedes_revision>=v.revision))throw Error('M7_ARCHIVE_REVISION');
  const e=ownData(v.episode,['episode_key','session_id','task_id','task_revision','view_revision','action_id','action_version','proposal_revision','context_revision','source_revision','proposed_minutes']);
  if(!validId(e.session_id)||typeof e.task_id!=='string'||!e.task_id.startsWith(e.session_id+'/task-')||!/^[1-9][0-9]*$/.test(e.task_id.slice((e.session_id+'/task-').length))||e.action_id!=='trainer.self.walk-easy.v0_1'||!['task_revision','view_revision','action_version','proposal_revision','context_revision','source_revision','proposed_minutes'].every(k=>positiveM7(e[k]))||e.proposed_minutes>120)throw Error('M7_ARCHIVE_EPISODE');
  if(e.episode_key!==[e.session_id,e.task_id,e.task_revision,e.view_revision,e.action_id,e.action_version,e.proposal_revision,e.context_revision,e.source_revision].join('|'))throw Error('M7_ARCHIVE_LINEAGE');
  const ev=ownData(v.evidence,['source','epistemic_role','recorded_at','occurred_at','task_revision','action_version','proposal_revision','context_revision','source_revision','permission_revision'],['source','epistemic_role','recorded_at','task_revision','action_version','proposal_revision','context_revision','source_revision','permission_revision']);
  if(ev.source!=='USER_REPORT'||ev.epistemic_role!=='PERSONAL_OBSERVATION_PR0'||!Number.isFinite(ev.recorded_at)||ev.recorded_at<0||ev.occurred_at!==undefined&&(!Number.isFinite(ev.occurred_at)||ev.occurred_at>ev.recorded_at)||!positiveM7(ev.permission_revision)||!['task_revision','action_version','proposal_revision','context_revision','source_revision'].every(k=>ev[k]===e[k]))throw Error('M7_ARCHIVE_EVIDENCE');
  if(v.state==='ACTIVE'){
    if(component==='R'){
      const facts=ownData(v.outcome,['execution_extent','action_change','user_stopped','problem_state','safety_disposition','constraint','performed_minutes'],['execution_extent','action_change','user_stopped','problem_state','safety_disposition','constraint']);
      if(!sanitizeM7OutcomeInput({request_id:'archive',...facts,...(v.evidence_text===undefined?{}:{evidence_text:v.evidence_text})},e.proposed_minutes))throw Error('M7_ARCHIVE_OUTCOME');
    }else{const facts=ownData(v.feedback,['experience','locale','displayed_label']);if(!sanitizeM7FeedbackInput({request_id:'archive',...facts})||v.evidence_text!==undefined)throw Error('M7_ARCHIVE_FEEDBACK');}
  }else if(v.outcome!==undefined||v.feedback!==undefined||v.evidence_text!==undefined)throw Error('M7_ARCHIVE_RETRACTED');
  return v as {episode:M7EpisodeIdentity}&Record<string,any>;
}
export function validateCompletedM7(value:unknown,owner:Readonly<{subjectId:string;profileId:string}>,now:number):CompletedM7Report|undefined{
  try{
    const v=ownData(value,['schema','owner','completion','saved_at','reuseForNextCycle','R','F'],['schema','owner','completion','saved_at','reuseForNextCycle']);
    const o=ownData(v.owner,['subjectId','profileId']);
    if(!Number.isFinite(now)||v.schema!==1||o.subjectId!==owner.subjectId||o.profileId!==owner.profileId||v.completion!=='USER_REPORTED_END'||v.reuseForNextCycle!==false||!Number.isFinite(v.saved_at)||v.saved_at<0||v.saved_at>now||!v.R&&!v.F)throw Error('M7_ARCHIVE_HEADER');
    const r=v.R&&completedRevision(v.R,'R'),f=v.F&&completedRevision(v.F,'F');
    if(r&&f&&JSON.stringify(r.episode)!==JSON.stringify(f.episode)||[r,f].some(x=>x&&x.evidence.recorded_at>v.saved_at))throw Error('M7_ARCHIVE_MISMATCH');
    // Bounded JSON copy prevents a caller changing an accepted report later.
    const json=JSON.stringify(v);if(json.length>30000)throw Error('M7_ARCHIVE_BOUND');
    const freeze=(x:any):any=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
    return freeze(JSON.parse(json));
  }catch{return undefined;}
}
function archiveFor(binding:OwnerSessionBinding|undefined){return binding&&archiveHubs.get(binding.access)?.get(binding.lease);}
export function createM7Persistence(options:Readonly<{binding:OwnerSessionBinding;backend:LocalStorageBackend;persistenceAllowed:boolean;now?:()=>number}>){
  const binding=Object.freeze({...options.binding}),enabled=options.persistenceAllowed===true,now=options.now??Date.now,storage=createGuardedUserStorage(binding.access,options.backend);
  const listeners=new Set<()=>void>();let snapshot:M7ArchiveSnapshot=RAM_ARCHIVE,stopped=false,started=false,epoch=0;
  let pending:Promise<void>=Promise.resolve(),unwatch=()=>{};
  const current=()=>{try{return !stopped&&enabled&&binding.access.getSnapshot().phase==='READY'&&!!binding.access.requireLease(binding.lease);}catch{return false;}};
  const publish=(next:M7ArchiveSnapshot)=>{snapshot=Object.freeze(next);for(const fn of [...listeners])try{fn();}catch{}};
  const dispose=()=>{if(stopped)return;stopped=true;epoch++;unwatch();if(archiveFor(binding)===api)archiveHubs.get(binding.access)?.delete(binding.lease);publish(RAM_ARCHIVE);listeners.clear();};
  const schedule=(report:CompletedM7Report|undefined)=>{
    if(!current())return false;
    const version=++epoch;publish({phase:'SAVING',...(report?{report}:{})});
    pending=pending.then(async()=>{
      if(!current())return;
      try{if(report)await storage.writeCompletedM7(binding.lease,report as unknown as JsonValue);else await storage.removeCompletedM7(binding.lease);
        if(current()&&version===epoch)publish({phase:report?'SAVED':'EMPTY',...(report?{report}:{})});
      }catch{if(current()&&version===epoch)publish({phase:'ERROR'});}
    });return true;
  };
  const api=Object.freeze({
    start:async()=>{if(started||!current())return;started=true;
      let hubs=archiveHubs.get(binding.access);if(!hubs){hubs=new WeakMap();archiveHubs.set(binding.access,hubs);}const old=hubs.get(binding.lease);if(old&&old!==api)old.dispose();hubs.set(binding.lease,api);
      unwatch=binding.access.subscribe(()=>{if(!current())dispose();});
      const version=++epoch;publish({phase:'LOADING'});
      try{const raw=await storage.readCompletedM7(binding.lease);if(!current()||version!==epoch)return;
        const report=raw===null?undefined:validateCompletedM7(raw,binding.access.requireLease(binding.lease).owner,now());
        publish(raw!==null&&!report?{phase:'ERROR'}:report?{phase:'SAVED',report}:{phase:'EMPTY'});
      }catch{if(current()&&version===epoch)publish({phase:'ERROR'});}
    },
    getSnapshot:():M7ArchiveSnapshot=>current()?snapshot:RAM_ARCHIVE,
    subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
    // Only genuine live store commits call these module-private closures below.
    dispose,settle:()=>pending,
    remove:()=>schedule(undefined),
  });
  archiveWriters.set(api,{
    save:(r:CompletedM7Report)=>{if(!current())return false;const clean=validateCompletedM7(r,binding.access.requireLease(binding.lease).owner,now());return !!clean&&schedule(clean);},
    drop:(episode:string,components:readonly Component[])=>{const r=snapshot.report;if(!current()||!r||(r.R??r.F)?.episode.episode_key!==episode)return;
      const copy={...r,saved_at:now()};for(const c of components)delete copy[c];if(copy.R||copy.F)schedule(copy);else schedule(undefined);},
  });
  return api;
}
const archiveWriters=new WeakMap<ReturnType<typeof createM7Persistence>,{save:(r:CompletedM7Report)=>boolean;drop:(episode:string,components:readonly Component[])=>void}>();
