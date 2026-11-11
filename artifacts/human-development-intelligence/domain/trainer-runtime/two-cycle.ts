import type { OwnerSessionBinding } from '../identity/owner-session-coordinator';
import type { LeaseScope } from '../local-owner/boundary';
import { createM7NextCycleConsumer } from '../m7/next-cycle';
import type { M7NextCycleConsumerAccess } from '../m7/next-cycle';
import { observeM7Purpose } from '../m7/outcome';
import type { M7PurposeAccess } from '../m7/outcome';
import { createSessionTaskStore } from '../session-task/store';
import type { SessionTaskStore } from '../session-task/store';
import { createTrainerM7CycleAuthority } from './m7-cycle-authority';

export type TrainerTwoCycleId = 'A' | 'B';
export type TrainerTwoCycleAuthority = ReturnType<typeof createTrainerM7CycleAuthority>;

export type TrainerTwoCycle = Readonly<{
  id: TrainerTwoCycleId;
  store: SessionTaskStore;
  m7: TrainerTwoCycleAuthority;
}>;

export type TrainerTwoCycleSnapshot =
  | Readonly<{ state: 'UNAVAILABLE' }>
  | Readonly<{ state: 'READY'; cycle_a: TrainerTwoCycle; cycle_b?: TrainerTwoCycle }>;

export type TrainerTwoCycleStoreFactory = (input: Readonly<{
  cycle: TrainerTwoCycleId;
  binding: OwnerSessionBinding;
  m7Purpose: M7PurposeAccess;
  m7NextCycle?: M7NextCycleConsumerAccess;
}>) => SessionTaskStore;

export type TrainerTwoCycleAdvanceResult =
  | Readonly<{ state: 'CREATED'; cycle: TrainerTwoCycle }>
  | Readonly<{
      state: 'DENIED';
      reason: 'OWNER_UNAVAILABLE' | 'OUTCOME_UNAVAILABLE' | 'USE_NEXT_CYCLE_REQUIRED'
        | 'CURRENT_FRAGMENT_UNAVAILABLE' | 'ISOLATION_FAILURE';
    }>
  | Readonly<{ state: 'UNSUPPORTED'; reason: 'TWO_CYCLE_LIMIT' }>;

type RuntimeKey = Readonly<{
  access: OwnerSessionBinding['access'];
  lease: OwnerSessionBinding['lease'];
  scope: LeaseScope;
}>;

type CurrentRuntime = {
  binding: OwnerSessionBinding;
  key: RuntimeKey;
  cycleA: TrainerTwoCycle;
  cycleB?: TrainerTwoCycle;
  unsubscribeOwner: () => void;
};

const unavailable: TrainerTwoCycleSnapshot = Object.freeze({ state: 'UNAVAILABLE' });

function validateBinding(binding: OwnerSessionBinding): RuntimeKey | undefined {
  try {
    const scope = binding.access.requireLease(binding.lease);
    const snapshot = binding.access.getSnapshot();
    if (snapshot.phase !== 'READY'
      || snapshot.generation !== scope.generation
      || snapshot.owner.subjectId !== scope.owner.subjectId
      || snapshot.owner.profileId !== scope.owner.profileId
      || snapshot.validUntil !== scope.validUntil) return undefined;
    return Object.freeze({ access: binding.access, lease: binding.lease, scope });
  } catch {
    return undefined;
  }
}
function sameRuntimeKey(left: RuntimeKey, right: RuntimeKey): boolean {
  return left.access === right.access
    && left.lease === right.lease
    && left.scope.generation === right.scope.generation
    && left.scope.owner.subjectId === right.scope.owner.subjectId
    && left.scope.owner.profileId === right.scope.owner.profileId
    && left.scope.validUntil === right.scope.validUntil;
}

/**
 * Trusted, RAM-only composition boundary for exactly two Trainer cycles.
 *
 * Cycle A stays alive after Cycle B is created so its outcome can still be
 * corrected, retracted, deleted or have either M7 purpose revoked. Cycle B
 * receives only an uncached M7 consumer capability; no fragment, task, M5/M6
 * receipt, M7 receipt, request ledger or outcome store is copied across.
 */
export function createTrainerTwoCycleRuntime(options: Readonly<{
  createStore?: TrainerTwoCycleStoreFactory;
}> = {}) {
  const createStore = options.createStore ?? ((input) => createSessionTaskStore({
    ownerSession: input.binding,
    m7Purpose: input.m7Purpose,
    m7NextCycle: input.m7NextCycle,
  }));
  const listeners = new Set<() => void>();
  let snapshot: TrainerTwoCycleSnapshot = unavailable;
  let current: CurrentRuntime | undefined;
  let disposed = false;
  let advancing = false;

  const publish = (next: TrainerTwoCycleSnapshot) => {
    if (snapshot === next) return;
    snapshot = next;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* lifetime retirement is not observer-owned */ }
    }
  };

  const publishReady = (runtime: CurrentRuntime) => publish(Object.freeze({
    state: 'READY' as const,
    cycle_a: runtime.cycleA,
    ...(runtime.cycleB ? { cycle_b: runtime.cycleB } : {}),
  }));

  const retireCycle = (cycle: TrainerTwoCycle | undefined) => {
    if (!cycle) return;
    try { cycle.store.stop(); } catch { /* authority is removed below */ }
    try { cycle.m7.retire(); } catch { /* retirement remains fail closed */ }
  };

  const retireCandidate = (candidate: TrainerTwoCycle | undefined, source: TrainerTwoCycle) => {
    if (!candidate) return;
    if (candidate.store !== source.store) {
      try { candidate.store.stop(); } catch { /* candidate cleanup remains best effort */ }
    }
    if (candidate.m7 !== source.m7) {
      try { candidate.m7.retire(); } catch { /* candidate authority remains isolated */ }
    }
  };

  const retireCurrent = () => {
    const retiring = current;
    current = undefined;
    if (!retiring) {
      publish(unavailable);
      return;
    }
    retiring.unsubscribeOwner();
    retireCycle(retiring.cycleB);
    retireCycle(retiring.cycleA);
    publish(unavailable);
  };

  const reconcile = () => {
    if (!current) return;
    const key = validateBinding(current.binding);
    if (!key || !sameRuntimeKey(current.key, key)) retireCurrent();
  };

  const constructCycle = (
    id: TrainerTwoCycleId,
    binding: OwnerSessionBinding,
    m7NextCycle?: M7NextCycleConsumerAccess,
  ): TrainerTwoCycle => {
    const m7 = createTrainerM7CycleAuthority();
    let store: SessionTaskStore | undefined;
    try {
      store = createStore({ cycle: id, binding, m7Purpose: m7.access, m7NextCycle });
      store.start();
      return Object.freeze({ id, store, m7 });
    } catch (error) {
      try { store?.stop(); } catch { /* keep original construction failure */ }
      m7.retire();
      throw error;
    }
  };

  const install = (binding: OwnerSessionBinding, key: RuntimeKey) => {
    const fixedBinding: OwnerSessionBinding = Object.freeze({
      access: binding.access,
      lease: binding.lease,
    });
    let cycleA: TrainerTwoCycle | undefined;
    let unsubscribeOwner = () => {};
    try {
      cycleA = constructCycle('A', fixedBinding);
      const currentKey = validateBinding(fixedBinding);
      if (!currentKey || !sameRuntimeKey(key, currentKey)) {
        retireCycle(cycleA);
        return;
      }
      unsubscribeOwner = fixedBinding.access.subscribe(reconcile);
      current = { binding: fixedBinding, key: currentKey, cycleA, unsubscribeOwner };
      publishReady(current);
    } catch {
      unsubscribeOwner();
      retireCycle(cycleA);
      current = undefined;
      publish(unavailable);
    }
  };

  const deny = (reason: Extract<TrainerTwoCycleAdvanceResult,
    { state: 'DENIED' }>['reason']): TrainerTwoCycleAdvanceResult => Object.freeze({
      state: 'DENIED' as const,
      reason,
    });

  return Object.freeze({
    getSnapshot(): TrainerTwoCycleSnapshot {
      if (!disposed) reconcile();
      return snapshot;
    },

    subscribe(listener: () => void) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    setBinding(binding: OwnerSessionBinding | undefined) {
      if (disposed) return;
      if (!binding) {
        retireCurrent();
        return;
      }
      const key = validateBinding(binding);
      if (!key) {
        retireCurrent();
        return;
      }
      if (current && sameRuntimeKey(current.key, key)) return;
      retireCurrent();
      install(binding, key);
    },

    createNextCycle(source: TrainerTwoCycleId): TrainerTwoCycleAdvanceResult {
      if (disposed) return deny('OWNER_UNAVAILABLE');
      reconcile();
      const runtime = current;
      if (!runtime) return deny('OWNER_UNAVAILABLE');
      if (source === 'B' || runtime.cycleB) {
        return Object.freeze({ state: 'UNSUPPORTED' as const, reason: 'TWO_CYCLE_LIMIT' as const });
      }
      if (advancing) return deny('ISOLATION_FAILURE');

      const a = runtime.cycleA;
      const authority = a.m7.getSnapshot();
      const recordReceipt = authority.record_outcome_receipt;
      if (!recordReceipt || a.store.m7Outcome.getSnapshot(recordReceipt).state !== 'ACTIVE') {
        return deny('OUTCOME_UNAVAILABLE');
      }
      const nextReceipt = authority.use_next_cycle_receipt;
      if (!nextReceipt) return deny('USE_NEXT_CYCLE_REQUIRED');
      const initialFragment = a.store.m7Outcome.readNextCycle(nextReceipt);
      if (!initialFragment) {
        return deny('CURRENT_FRAGMENT_UNAVAILABLE');
      }
      const initialFragmentSignature = JSON.stringify(initialFragment);

      const readCurrentFragment = () => {
        if (current !== runtime || runtime.cycleA !== a) return undefined;
        const activeAuthority = a.m7.getSnapshot();
        if (!activeAuthority.record_outcome_receipt || !activeAuthority.use_next_cycle_receipt
          || a.store.m7Outcome.getSnapshot(activeAuthority.record_outcome_receipt).state !== 'ACTIVE') {
          return undefined;
        }
        return a.store.m7Outcome.readNextCycle(activeAuthority.use_next_cycle_receipt);
      };
      const readBasis = () => {
        const authorityNow = a.m7.getSnapshot();
        const record = authorityNow.record_outcome_receipt
          ? a.store.m7Outcome.getSnapshot(authorityNow.record_outcome_receipt) : undefined;
        const episode = record?.state === 'ACTIVE' ? record.episode : undefined;
        const safety = a.store.getTrainerSafetySnapshot();
        const source = readCurrentFragment();
        // Technical stamp only. No outcome facts or deleted health payload.
        return JSON.stringify([runtime.key.scope.generation, safety.session_id,
          episode?.task_revision ?? null, episode?.context_revision ?? null,
          safety.revision, a.store.m7Outcome.getBasisRevision(),
          source?.state === 'AVAILABLE', record?.state === 'ACTIVE' ? record.revision : null,
          authorityNow.record_outcome_receipt?.revision ?? null,
          authorityNow.use_next_cycle_receipt?.revision ?? null]);
      };
      const observeBasis = (listener: () => void) => {
        const unsubs = [a.store.subscribe(listener), a.store.m7Outcome.subscribe(listener),
          observeM7Purpose(a.m7.access, listener)];
        return () => { for (const unsubscribe of unsubs) unsubscribe(); };
      };

      let cycleB: TrainerTwoCycle | undefined;
      let sealed = false;
      advancing = true;
      try {
        const consumer = createM7NextCycleConsumer(runtime.binding, readCurrentFragment,
          { basis: readBasis, observe: observeBasis });
        cycleB = constructCycle('B', runtime.binding, consumer);
        const currentKey = validateBinding(runtime.binding);
        const aSession = a.store.getSnapshot().session_id;
        const bSession = cycleB.store.getSnapshot().session_id;
        if (current !== runtime || !currentKey || !sameRuntimeKey(runtime.key, currentKey)) {
          retireCandidate(cycleB, a);
          if (!currentKey || current !== runtime || !sameRuntimeKey(runtime.key, currentKey)) {
            retireCurrent();
          }
          return deny('OWNER_UNAVAILABLE');
        }
        if (cycleB.store === a.store || cycleB.m7 === a.m7
          || !aSession || !bSession || aSession === bSession) {
          retireCandidate(cycleB, a);
          return deny('ISOLATION_FAILURE');
        }

        const currentAuthority = a.m7.getSnapshot();
        const currentFragment = readCurrentFragment();
        if (currentAuthority.record_outcome_receipt !== recordReceipt
          || currentAuthority.use_next_cycle_receipt !== nextReceipt
          || !currentFragment || JSON.stringify(currentFragment) !== initialFragmentSignature) {
          retireCandidate(cycleB, a);
          return deny('CURRENT_FRAGMENT_UNAVAILABLE');
        }
        if (!a.store.enterRetainedSourceMode(recordReceipt)) {
          retireCandidate(cycleB, a);
          const latestKey = validateBinding(runtime.binding);
          if (current !== runtime || !latestKey || !sameRuntimeKey(runtime.key, latestKey)) {
            retireCurrent();
            return deny('OWNER_UNAVAILABLE');
          }
          return deny('OUTCOME_UNAVAILABLE');
        }
        sealed = true;
        runtime.cycleB = cycleB;
        publishReady(runtime);
        return Object.freeze({ state: 'CREATED' as const, cycle: cycleB });
      } catch {
        retireCandidate(cycleB, a);
        // A retained-source transition is irreversible even when publication fails.
        void sealed;
        return deny('ISOLATION_FAILURE');
      } finally {
        advancing = false;
      }
    },

    dispose() {
      if (disposed) return;
      retireCurrent();
      disposed = true;
      listeners.clear();
    },
  });
}
