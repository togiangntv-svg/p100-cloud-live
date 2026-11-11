import {
  LocalIsolationError,
  type OwnerAccess,
  type SessionLease,
  type LeaseScope,
} from './boundary';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const USER_DATA_KEYS = Object.freeze([
  'state', 'opening', 'coaching', 'interaction', 'interaction-deleted-at',
  'opening-goal-draft', 'opening-goal-flow', 'welcome',
] as const);
export type UserDataKey = typeof USER_DATA_KEYS[number];
/** Structural subset of AsyncStorage. No real backend is imported/instantiated here. */
export interface LocalStorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}
type Coordinator = { tails: Map<string, Promise<void>>; quarantined: Set<string>; retired: Set<string>; erasurePending: Set<string> };
// Share barriers when multiple adapters receive the SAME backend instance.
// No personal payloads/credentials in this registry; backend lifetime is weakly held.
const coordinators = new WeakMap<LocalStorageBackend, Coordinator>();

function prefixFor(scope: LeaseScope): string {
  return '@100/v2/subject/' + scope.owner.subjectId + '/profile/' + scope.owner.profileId + '/';
}
function assertKey(key: UserDataKey): void {
  if (!(USER_DATA_KEYS as readonly unknown[]).includes(key)) throw new LocalIsolationError('INVALID_KEY');
}
function encode(scope: LeaseScope, value: JsonValue): string {
  try {
    return JSON.stringify({ schemaVersion: 1, owner: scope.owner, value }, (_key, item: unknown) => {
      if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
      if (typeof item === 'number' && Number.isFinite(item)) return item;
      if (Array.isArray(item)) return item;
      if (typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) return item;
      throw new Error();
    });
  } catch {
    throw new LocalIsolationError('INVALID_DATA');
  }
}
function decode(scope: LeaseScope, raw: string | null): JsonValue | null {
  if (raw === null) return null;
  try {
    const envelope = JSON.parse(raw);
    if (!envelope || Array.isArray(envelope) || envelope.schemaVersion !== 1
      || envelope.owner?.subjectId !== scope.owner.subjectId
      || envelope.owner?.profileId !== scope.owner.profileId
      || !Object.prototype.hasOwnProperty.call(envelope, 'value')) throw new Error();
    // Reject non-finite numbers (e.g. JSON 1e400); consumers still validate domain schema.
    encode(scope, envelope.value);
    return envelope.value as JsonValue;
  } catch {
    throw new LocalIsolationError('CORRUPT_DATA');
  }
}

export function createGuardedUserStorage(access: OwnerAccess, backend: LocalStorageBackend, options: Readonly<{ retireAccess?: () => void }> = {}) {
  let coordinator = coordinators.get(backend);
  if (!coordinator) {
    coordinator = { tails: new Map(), quarantined: new Set(), retired: new Set(), erasurePending: new Set() };
    coordinators.set(backend, coordinator);
  }
  const { tails, quarantined, retired, erasurePending } = coordinator;
  const retirementKey = '__retired_v1';
  const permits = new WeakMap<object, LeaseScope>();
  const requireCurrent = (lease: SessionLease): LeaseScope => {
    const scope=access.requireLease(lease);
    if(retired.has(prefixFor(scope))||erasurePending.has(prefixFor(scope)))throw new LocalIsolationError('NAMESPACE_QUARANTINED');
    return scope;
  };
  const assertOpen = async(prefix:string) => {
    if(retired.has(prefix)||erasurePending.has(prefix))throw new LocalIsolationError('NAMESPACE_QUARANTINED');
    if(await backend.getItem(prefix+retirementKey)!==null){retired.add(prefix);throw new LocalIsolationError('NAMESPACE_QUARANTINED');}
    if(retired.has(prefix))throw new LocalIsolationError('NAMESPACE_QUARANTINED');
  };

  const enqueue = <T>(
    lease: SessionLease,
    scope: LeaseScope,
    operation: (prefix: string) => Promise<T>,
    recovery = false,
  ): Promise<T> => {
    requireCurrent(lease); // Before enqueue.
    const prefix = prefixFor(scope); // Immutable captured owner, never current owner lookup.
    const previous = tails.get(prefix) ?? Promise.resolve();
    const result = previous.then(async () => {
      requireCurrent(lease); // Before backend work, after queue wait.
      await assertOpen(prefix); requireCurrent(lease);
      if (!recovery && quarantined.has(prefix)) throw new LocalIsolationError('NAMESPACE_QUARANTINED');
      try {
        const value = await operation(prefix);
        await assertOpen(prefix);
        requireCurrent(lease); // Before promise result is delivered.
        return value;
      } catch (error) {
        if (error instanceof LocalIsolationError) throw error;
        throw new LocalIsolationError('STORAGE_UNAVAILABLE');
      }
    });
    const tail = result.then(() => undefined, () => undefined);
    tails.set(prefix, tail);
    void tail.then(() => { if (tails.get(prefix) === tail) tails.delete(prefix); });
    return result;
  };

  return Object.freeze({
    /** Mint while current; capability survives loss of lease ONLY to erase its captured namespace. */
    prepareOwnerRetirement: (lease: SessionLease): object => {
      if(typeof options.retireAccess!=='function')throw new LocalIsolationError('AUTHORITY_UNAVAILABLE');
      const scope=requireCurrent(lease),permit=Object.freeze(Object.create(null));permits.set(permit,scope);return permit;
    },
    quarantineOwnerNamespace: (permit:object):void => {
      const scope=permit&&typeof permit==='object'?permits.get(permit):undefined;if(!scope)throw new LocalIsolationError('INVALID_LEASE');
      const prefix=prefixFor(scope);erasurePending.add(prefix);quarantined.add(prefix);
      const current=access.getSnapshot();if((current.phase==='READY'||current.phase==='HYDRATING')&&current.owner.subjectId===scope.owner.subjectId&&current.owner.profileId===scope.owner.profileId)options.retireAccess!();
    },
    retireOwnerNamespace: async(permit: object): Promise<void> => {
      const scope=permit&&typeof permit==='object'?permits.get(permit):undefined;
      if(!scope)throw new LocalIsolationError('INVALID_LEASE');
      const prefix=prefixFor(scope);retired.add(prefix);quarantined.add(prefix);
      const current=access.getSnapshot();
      if((current.phase==='READY'||current.phase==='HYDRATING')&&current.owner.subjectId===scope.owner.subjectId&&current.owner.profileId===scope.owner.profileId)options.retireAccess!();
      const previous=tails.get(prefix)??Promise.resolve();
      const result=previous.then(async()=>{
        try{
          // Marker is durable before success; it is outside the eight erasable keys and never cleared.
          await backend.setItem(prefix+retirementKey,'RETIRED_V1');
          for(const key of [...USER_DATA_KEYS,'m7-completed'])await backend.removeItem(prefix+key);
        }catch{throw new LocalIsolationError('NAMESPACE_QUARANTINED');}
      });
      const tail=result.then(()=>undefined,()=>undefined);tails.set(prefix,tail);
      void tail.then(()=>{if(tails.get(prefix)===tail)tails.delete(prefix);});
      return result;
    },
    // Dedicated completed-report slot; it is not a task/grant or an extra generic user key.
    readCompletedM7: async (lease: SessionLease): Promise<JsonValue | null> => {
      const scope = requireCurrent(lease);
      return enqueue(lease, scope, async prefix => {
        const raw = await backend.getItem(prefix + 'm7-completed');
        requireCurrent(lease);
        if (raw !== null && raw.length > 32768) throw new LocalIsolationError('CORRUPT_DATA');
        return decode(scope, raw);
      });
    },
    writeCompletedM7: async (lease: SessionLease, value: JsonValue): Promise<void> => {
      const scope = requireCurrent(lease), serialized = encode(scope, value);
      if (serialized.length > 32768) throw new LocalIsolationError('INVALID_DATA');
      return enqueue(lease, scope, async prefix => {
        const path = prefix + 'm7-completed';
        try { await backend.setItem(path, serialized); requireCurrent(lease); }
        catch (error) {
          quarantined.add(prefix);
          try { await backend.removeItem(path); } catch { throw new LocalIsolationError('NAMESPACE_QUARANTINED'); }
          if (error instanceof LocalIsolationError) { if (!retired.has(prefix)) quarantined.delete(prefix); throw error; }
          throw new LocalIsolationError('STORAGE_UNAVAILABLE');
        }
      });
    },
    removeCompletedM7: async (lease: SessionLease): Promise<void> => {
      const scope = requireCurrent(lease);
      return enqueue(lease, scope, prefix => backend.removeItem(prefix + 'm7-completed'));
    },
    readUserState: async (lease: SessionLease, key: UserDataKey): Promise<JsonValue | null> => {
      const scope = requireCurrent(lease);
      assertKey(key);
      return enqueue(lease, scope, async prefix => {
        const raw = await backend.getItem(prefix + key);
        requireCurrent(lease); // Do not even decode stale personal data.
        return decode(scope, raw);
      });
    },
    writeUserState: async (lease: SessionLease, key: UserDataKey, value: JsonValue): Promise<void> => {
      const scope = requireCurrent(lease);
      assertKey(key);
      const serialized = encode(scope, value); // Snapshot before queue; caller cannot change it later.
      return enqueue(lease, scope, async prefix => {
        const path = prefix + key;
        try {
          await backend.setItem(path, serialized);
          requireCurrent(lease);
        } catch (error) {
          // Native writes already issued cannot be cancelled. Remove only the captured
          // key BEFORE releasing this namespace's queue, including same-owner relogin.
          quarantined.add(prefix);
          try {
            await backend.removeItem(path);
          } catch {
            // Do not admit this namespace again until an explicit verified clear succeeds.
            throw new LocalIsolationError('NAMESPACE_QUARANTINED');
          }
          // Keep quarantine after I/O uncertainty; invalidation alone is recoverable.
          if (error instanceof LocalIsolationError) {
            if(!retired.has(prefix))quarantined.delete(prefix);
            throw error;
          }
          throw new LocalIsolationError('STORAGE_UNAVAILABLE');
        }
      });
    },
    removeUserState: async (lease: SessionLease, key: UserDataKey): Promise<void> => {
      const scope = requireCurrent(lease);
      assertKey(key);
      return enqueue(lease, scope, async prefix => {
        try {
          await backend.removeItem(prefix + key);
        } catch {
          quarantined.add(prefix);
          throw new LocalIsolationError('STORAGE_UNAVAILABLE');
        }
      });
    },
    clearOwnerNamespace: async (lease: SessionLease): Promise<void> => {
      const scope = requireCurrent(lease);
      return enqueue(lease, scope, async prefix => {
        // Recovery is explicit and owner-authorized. Never clear all app storage.
        quarantined.add(prefix);
        const keys = await backend.getAllKeys();
        requireCurrent(lease);
        for (const key of keys) {
          if (!key.startsWith(prefix)) continue;
          requireCurrent(lease); // Between each remove, not just before enumeration.
          await backend.removeItem(key);
        }
        requireCurrent(lease);
        quarantined.delete(prefix);
      }, true);
    },
  });
}
