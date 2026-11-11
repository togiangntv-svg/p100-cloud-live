import {createWearableOwnerSession,type WearableOwnerSession} from '@/domain/wearable/contract';
// Expo substitutes public env fields at build time; this module needs only their string contract.
declare const process: { readonly env: Readonly<Record<string,string|undefined>> };
import { createM7Persistence, type M7ArchiveSnapshot } from '@/domain/m7/store';
import { createAccountErasureOrchestrator } from '@/components/coach-presence-flow';
import { createUnifiedOwnerFactsBridge } from '@/domain/m2/factual-snapshot';
import type { LocalStorageBackend } from '@/domain/local-owner/storage';
import { createLocalVerificationClient, resolveLocalVerificationConfig, type LocalVerificationControl } from '@/lib/identity/local-verification';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { createIosIdentityClient } from '@/lib/identity/expo-apple-session';
import { createWebOwnerSessionComposition, resolveWebIdentityConfig, createConnectedLoopbackWebCoordinator } from '@/lib/identity/web-session';
import {
  createOwnerSessionCoordinator,
  resolveProductionIdentityConfig,
  type OwnerSessionBinding,
  type OwnerSignInOutcome,
} from '@/domain/identity/owner-session-coordinator';

export type OwnerSessionControl = Readonly<{
  state: 'locked' | 'verifying' | 'ready';
  phase: 'BOOTSTRAPPING' | 'LOCKED' | 'VERIFYING' | 'HYDRATING' | 'READY';
  canSignInWithApple: boolean;
  localVerification?: LocalVerificationControl;
  signIn(): Promise<'ready' | 'cancelled' | 'unavailable'>;
  logout(): Promise<'signed-out' | 'remote-unavailable'>;
  eraseAccount(): Promise<boolean>;
  erasurePhase: 'IDLE'|'REQUESTING'|'QUARANTINED'|'COMPLETE';
  /** Opaque current binding identity; changes retire UI confirmation, never grants authority. */
  erasureScope?: object;
  wearable?:WearableOwnerSession;
}>;

type OwnerSessionContextValue = Readonly<{
  binding?: OwnerSessionBinding;
  control: OwnerSessionControl;
  m7Archive?:ReturnType<typeof createM7Persistence>;
  wearable?:WearableOwnerSession;
}>;

const publicOwnerConfig = Object.freeze({
  EXPO_PUBLIC_LOCAL_VERIFICATION: process.env.EXPO_PUBLIC_LOCAL_VERIFICATION,
  EXPO_PUBLIC_LOCAL_AUTHORITY_ORIGIN: process.env.EXPO_PUBLIC_LOCAL_AUTHORITY_ORIGIN,
  EXPO_PUBLIC_M3_RUNTIME_MODE: process.env.EXPO_PUBLIC_M3_RUNTIME_MODE,
  EXPO_PUBLIC_DOMAIN: process.env.EXPO_PUBLIC_DOMAIN,
  EXPO_PUBLIC_CONNECTED_LOOPBACK_HARNESS: process.env.EXPO_PUBLIC_CONNECTED_LOOPBACK_HARNESS,
  EXPO_PUBLIC_IDENTITY_REQUEST_TIMEOUT_MS: process.env.EXPO_PUBLIC_IDENTITY_REQUEST_TIMEOUT_MS,
});

const OwnerSessionContext = createContext<OwnerSessionContextValue | undefined>(undefined);

function createProductionCoordinator(): ReturnType<typeof createOwnerSessionCoordinator> & { readonly localVerification?: LocalVerificationControl; readonly connectedLoopback?: {mount():()=>void} } {
  if (Platform.OS === 'web' && publicOwnerConfig.EXPO_PUBLIC_M3_RUNTIME_MODE === 'local-verification') {
    const config = resolveLocalVerificationConfig(publicOwnerConfig.EXPO_PUBLIC_LOCAL_VERIFICATION,
      globalThis.location?.origin, publicOwnerConfig.EXPO_PUBLIC_LOCAL_AUTHORITY_ORIGIN,
      publicOwnerConfig.EXPO_PUBLIC_M3_RUNTIME_MODE);
    if (!config) return createOwnerSessionCoordinator();
    const client = createLocalVerificationClient(config);
    return Object.freeze({ ...client.coordinator, get localVerification() { return client.control; } });
  }
  if (Platform.OS === 'web') {
    const config = resolveWebIdentityConfig(
      publicOwnerConfig.EXPO_PUBLIC_DOMAIN,
      publicOwnerConfig.EXPO_PUBLIC_IDENTITY_REQUEST_TIMEOUT_MS,
      process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID,
      process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI,
    );
    if (!config) return createOwnerSessionCoordinator();
    try {
      const connected=createConnectedLoopbackWebCoordinator(config,{gate:publicOwnerConfig.EXPO_PUBLIC_CONNECTED_LOOPBACK_HARNESS,host:globalThis});
      if(connected)return connected;
      return createWebOwnerSessionComposition(config).coordinator;
    }
    catch { return createOwnerSessionCoordinator(); }
  }
  if (Platform.OS !== 'ios') return createOwnerSessionCoordinator();
  const config = resolveProductionIdentityConfig(
    publicOwnerConfig.EXPO_PUBLIC_DOMAIN,
    publicOwnerConfig.EXPO_PUBLIC_IDENTITY_REQUEST_TIMEOUT_MS,
  );
  if (!config) return createOwnerSessionCoordinator();
  try {
    const client = createIosIdentityClient(config);
    return createOwnerSessionCoordinator({ session: client.session, apple: client.apple });
  } catch {
    return createOwnerSessionCoordinator();
  }
}

/**
 * Production composition owner. It exposes only a current bounded access/lease pair;
 * verifier, credentials and raw boundary control remain inside this provider.
 */
export type OwnerCompositionPorts=Readonly<{backend?:LocalStorageBackend;
 factsLoad?:(binding:OwnerSessionBinding,signal:AbortSignal)=>Promise<unknown>;
 factsSubscribe?:(binding:OwnerSessionBinding,fn:()=>void)=>()=>void;allowTestFacts?:boolean;
 erasureSend?:(authorization:string,signal:AbortSignal)=>Promise<Readonly<{status:number}>>}>;
export function OwnerSessionProvider({ children, composition }: { children: React.ReactNode; composition?:OwnerCompositionPorts }) {
  const [coordinator] = useState(createProductionCoordinator);
  const [wearable]=useState(()=>createWearableOwnerSession(()=>coordinator.getSnapshot().binding,{mode:'gated_off',subscribeOwner:coordinator.subscribe}));
  const wearableState=useSyncExternalStore(wearable.subscribe,wearable.getSnapshot,wearable.getSnapshot);
  useEffect(()=>wearable.start(),[wearable]);
  const session = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  );
  useEffect(()=>coordinator.connectedLoopback?.mount(),[coordinator]);
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const [signInPending, setSignInPending] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const erasure=useRef<ReturnType<typeof createAccountErasureOrchestrator>|undefined>(undefined);
  const erasureJobs=useRef(new Map<string,ReturnType<typeof createAccountErasureOrchestrator>>());
  const erasureStops=useRef(new Map<ReturnType<typeof createAccountErasureOrchestrator>,()=>void>());
  const accountKey=(binding:OwnerSessionBinding|undefined)=>{try{if(!binding)return undefined;const scope=binding.access.requireLease(binding.lease);return JSON.stringify([scope.owner.subjectId,scope.owner.profileId]);}catch{return undefined;}};
  const [erasureEpoch,setErasureEpoch]=useState(0);
  const compositionRef=useRef(composition);compositionRef.current=composition;
  const runtimeOrigin=()=>{
    const local=resolveLocalVerificationConfig(publicOwnerConfig.EXPO_PUBLIC_LOCAL_VERIFICATION,globalThis.location?.origin,publicOwnerConfig.EXPO_PUBLIC_LOCAL_AUTHORITY_ORIGIN,publicOwnerConfig.EXPO_PUBLIC_M3_RUNTIME_MODE);
    if(local)return local.origin;
    if(Platform.OS==='web')return resolveWebIdentityConfig(publicOwnerConfig.EXPO_PUBLIC_DOMAIN,publicOwnerConfig.EXPO_PUBLIC_IDENTITY_REQUEST_TIMEOUT_MS)?.origin;
    return resolveProductionIdentityConfig(publicOwnerConfig.EXPO_PUBLIC_DOMAIN,publicOwnerConfig.EXPO_PUBLIC_IDENTITY_REQUEST_TIMEOUT_MS)?.baseUrl.replace(/\/api$/,'');
  };
  const runErase=useCallback(async()=>{
    wearable.suspend(); // synchronous E08 purge BEFORE the first await/server effect

    const intended=coordinator.getSnapshot().binding;
    if(!intended){
      const prior=erasure.current;if(!prior)return false;
      const state=prior.getSnapshot();
      if(!state.serverConfirmed){
        if(state.phase!=='QUARANTINED'||!await coordinator.refresh())return false;
      }
      // The existing job rechecks the captured owner after reauthentication.
      // A fresh different owner cannot authorize retry of the retired/quarantined owner.
      return prior.eraseAccount();
    }
    const key=accountKey(intended);if(!key)return false;
    let job=erasureJobs.current.get(key);
    if(!job){
      const backend=compositionRef.current?.backend??(await import('@react-native-async-storage/async-storage')).default;
      if(coordinator.getSnapshot().binding!==intended)return false;
      for(const [old,value]of erasureJobs.current)if(value.getSnapshot().phase==='COMPLETE'){erasureStops.current.get(value)?.();erasureStops.current.delete(value);erasureJobs.current.delete(old);}
      if(erasureJobs.current.size>=16)return false; // Never discard unresolved cleanup to admit more jobs.
      job=createAccountErasureOrchestrator({current:()=>coordinator.getSnapshot().binding,backend,
        invalidate:owner=>{const binding=coordinator.getSnapshot().binding;try{if(binding){const scope=binding.access.requireLease(binding.lease);if(scope.owner.subjectId===owner.subjectId&&scope.owner.profileId===owner.profileId)coordinator.invalidate();}}catch{}},
        send:async(Authorization,signal)=>{const custom=compositionRef.current?.erasureSend;if(custom)return custom(Authorization,signal);
          const origin=runtimeOrigin();if(!origin)throw Error('ERASURE_UNCONFIGURED');return fetch(origin+'/api/identity/account/delete',{method:'POST',headers:{Authorization,'Content-Type':'application/json'},body:JSON.stringify({confirm:true}),signal});},
      });
      erasureJobs.current.set(key,job);
      erasureStops.current.set(job,job.subscribe(()=>setErasureEpoch(v=>v+1)));
    }
    erasure.current=job;
    return job.eraseAccount();
  },[coordinator,wearable]);
  const selectedErasure=session.binding?erasureJobs.current.get(accountKey(session.binding)??''):erasure.current;
  const erasureBlocked=selectedErasure?.blocks(session.binding)??false;
  const [m7Archive,setM7Archive]=useState<ReturnType<typeof createM7Persistence>|undefined>(undefined);
  useEffect(()=>{const binding=session.binding;let cancelled=false,archive:ReturnType<typeof createM7Persistence>|undefined;
    setM7Archive(undefined);
    if(binding&&!erasureBlocked&&!coordinator.localVerification){
      void (async()=>{try{const backend=compositionRef.current?.backend??(await import('@react-native-async-storage/async-storage')).default;
        if(cancelled||coordinator.getSnapshot().binding!==binding)return;
        binding.access.requireLease(binding.lease);
        archive=createM7Persistence({binding,backend,persistenceAllowed:true});setM7Archive(archive);await archive.start();
      }catch{ /* unavailable storage never opens authority */ }})();
    }
    return()=>{cancelled=true;archive?.dispose();};
  },[coordinator,session.binding,erasureBlocked]);
  useEffect(()=>{const binding=session.binding;if(!binding||erasureBlocked)return;
    const load=compositionRef.current?.factsLoad,origin=runtimeOrigin();if(!load&&!origin)return;
    const bridge=createUnifiedOwnerFactsBridge({access:binding.access,lease:binding.lease,allowTestFixture:compositionRef.current?.allowTestFacts===true,
      load:signal=>load?load(binding,signal):binding.authorization!.withBearer(signal,async Authorization=>{const response=await fetch(origin+'/api/identity/m2/facts',{headers:{Authorization},signal});if(!response.ok)throw Error('OWNER_FACTS_UNAVAILABLE');const text=await response.text();if(text.length>16000)throw Error('OWNER_FACTS_BOUND');return JSON.parse(text);}),
      subscribeRemote:compositionRef.current?.factsSubscribe?fn=>compositionRef.current!.factsSubscribe!(binding,fn):undefined});
    void bridge.refresh();return()=>bridge.dispose();
  },[coordinator,session.binding,erasureBlocked]);

  useEffect(() => {
    let mounted = true;
    void coordinator.refresh().finally(() => { if (mounted) setBootstrapped(true); });
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active' && !activeRequest.current) void coordinator.refresh();
    });
    return () => {
      mounted = false;
      activeRequest.current?.abort();
      appState.remove();
      for(const stop of erasureStops.current.values())stop();
      erasureStops.current.clear();
      erasureJobs.current.clear();
      wearable.dispose();
      coordinator.invalidate();
    };
  }, [coordinator]);

  const runSignIn = useCallback(async () => {
    if (activeRequest.current) return 'unavailable' as const;
    const controller = new AbortController();
    activeRequest.current = controller;
    setSignInPending(true);
    try {
      const result: OwnerSignInOutcome = await coordinator.signIn(controller.signal);
      return result === 'READY' ? 'ready' : result === 'CANCELLED' ? 'cancelled' : 'unavailable';
    } finally {
      if (activeRequest.current === controller) activeRequest.current = undefined;
      setSignInPending(false);
    }
  }, [coordinator]);

  const runLogout = useCallback(async () => {
    wearable.suspend(); // retire wearable consent/RAM before abort/logout awaits

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      return await coordinator.logout(controller.signal) ? 'signed-out' as const : 'remote-unavailable' as const;
    } finally {
      if (activeRequest.current === controller) activeRequest.current = undefined;
    }
  }, [coordinator]);

  const value = useMemo<OwnerSessionContextValue>(() => Object.freeze({
    wearable,
    binding: erasureBlocked ? undefined : session.binding,
    m7Archive: erasureBlocked?undefined:m7Archive,
    control: Object.freeze({
      state: erasureBlocked ? 'locked' : signInPending || session.phase === 'VERIFYING' || session.phase === 'HYDRATING'
        ? 'verifying'
        : session.phase === 'READY' ? 'ready' : 'locked',
      phase: erasureBlocked ? 'LOCKED' : signInPending ? 'VERIFYING' : !bootstrapped && session.phase === 'LOCKED'
        ? 'BOOTSTRAPPING' : session.phase,
      canSignInWithApple: coordinator.canSignInWithApple,
      ...(coordinator.localVerification ? { localVerification: coordinator.localVerification } : {}),
      wearable,
      signIn: runSignIn,
      logout: runLogout,
      eraseAccount: runErase,
      erasurePhase: selectedErasure?.getSnapshot().phase??'IDLE',
      erasureScope: !coordinator.localVerification&&!erasureBlocked?session.binding:undefined,
    }),
  }), [bootstrapped, coordinator, runLogout, runSignIn, runErase, erasureBlocked, erasureEpoch, selectedErasure, session.binding, session.phase, session.generation, signInPending,m7Archive,wearable,wearableState]);

  return (
    <OwnerSessionContext.Provider value={value}>
      {children}
    </OwnerSessionContext.Provider>
  );
}

export function useOwnerSessionBinding(): OwnerSessionBinding | undefined {
  return useContext(OwnerSessionContext)?.binding;
}

export function useOwnerSessionControl(): OwnerSessionControl {
  const value = useContext(OwnerSessionContext);
  if (!value) throw new Error('OWNER_SESSION_PROVIDER_REQUIRED');
  return value.control;
}

const EMPTY_M7_ARCHIVE:M7ArchiveSnapshot=Object.freeze({phase:'RAM_ONLY'});
const emptyM7Snapshot=()=>EMPTY_M7_ARCHIVE;
const emptyM7Subscribe=()=>()=>{};
/** Display-only completed history; no TaskRef, purpose receipt or reuse permission is restored. */
export function useM7CompletedHistory(){
  const archive=useContext(OwnerSessionContext)?.m7Archive;
  const snapshot=useSyncExternalStore(archive?.subscribe??emptyM7Subscribe,archive?.getSnapshot??emptyM7Snapshot,emptyM7Snapshot);
  return {snapshot};
}

/** Read-only access to the same provider's session; no fallback issuer. */
export function useWearableOwnerSession(){return useContext(OwnerSessionContext)?.wearable;}
