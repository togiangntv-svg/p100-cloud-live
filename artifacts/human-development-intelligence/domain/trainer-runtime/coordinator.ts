import type { OwnerSessionBinding } from '../identity/owner-session-coordinator';
import type { LeaseScope } from '../local-owner/boundary';
import { createSessionTaskStore, type SessionTaskStore } from '../session-task/store';

export type TrainerRuntimeSnapshot =
  | Readonly<{ state: 'UNAVAILABLE' }>
  | Readonly<{ state: 'READY'; store: SessionTaskStore }>;

export type TrainerRuntimeStoreFactory = (binding: OwnerSessionBinding) => SessionTaskStore;

type RuntimeKey = Readonly<{
  access: OwnerSessionBinding['access'];
  lease: OwnerSessionBinding['lease'];
  scope: LeaseScope;
}>;

const unavailable: TrainerRuntimeSnapshot = Object.freeze({ state: 'UNAVAILABLE' });

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
 * Trusted owner-lifetime boundary for the RAM-only Trainer store.
 *
 * A binding is validated before construction and fixed for the store's whole
 * lifetime. Replacing or losing authority retires the old store permanently;
 * the coordinator never receives or adopts an anonymous store.
 */
export function createTrainerRuntimeCoordinator(options: Readonly<{
  createStore?: TrainerRuntimeStoreFactory;
}> = {}) {
  const createStore = options.createStore
    ?? ((binding: OwnerSessionBinding) => createSessionTaskStore({ ownerSession: binding }));
  const listeners = new Set<() => void>();
  let snapshot: TrainerRuntimeSnapshot = unavailable;
  let disposed = false;
  let current: Readonly<{
    binding: OwnerSessionBinding;
    key: RuntimeKey;
    store: SessionTaskStore;
    unsubscribeOwner: () => void;
  }> | undefined;

  const publish = (next: TrainerRuntimeSnapshot) => {
    if (snapshot === next) return;
    snapshot = next;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* lifetime retirement is not observer-owned */ }
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
    try { retiring.store.stop(); } catch { /* authority is removed even if cleanup reports */ }
    publish(unavailable);
  };

  const reconcile = () => {
    if (!current) return;
    const key = validateBinding(current.binding);
    if (!key || !sameRuntimeKey(current.key, key)) retireCurrent();
  };

  const install = (binding: OwnerSessionBinding, key: RuntimeKey) => {
    const fixedBinding: OwnerSessionBinding = Object.freeze({
      access: binding.access,
      lease: binding.lease,
    });
    let store: SessionTaskStore | undefined;
    let unsubscribeOwner = () => {};
    try {
      store = createStore(fixedBinding);
      store.start();
      const currentKey = validateBinding(fixedBinding);
      if (!currentKey || !sameRuntimeKey(key, currentKey)) {
        store.stop();
        return;
      }
      unsubscribeOwner = fixedBinding.access.subscribe(reconcile);
      current = Object.freeze({
        binding: fixedBinding,
        key: currentKey,
        store,
        unsubscribeOwner,
      });
      publish(Object.freeze({ state: 'READY', store }));
    } catch {
      unsubscribeOwner();
      try { store?.stop(); } catch { /* remain unavailable */ }
      current = undefined;
      publish(unavailable);
    }
  };

  return Object.freeze({
    getSnapshot(): TrainerRuntimeSnapshot {
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
    dispose() {
      if (disposed) return;
      retireCurrent();
      disposed = true;
      listeners.clear();
    },
  });
}
