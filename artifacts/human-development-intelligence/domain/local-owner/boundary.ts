/**
 * Local isolation only. Construct at the trusted composition root; give UI access,
 * never the verifier/control. A verifier must validate the app session SERVER-side.
 * Nothing here authenticates IDs, persists authority, or connects to a provider.
 */
declare const leaseBrand: unique symbol;
export type SessionLease = Readonly<{ [leaseBrand]: true }>;
export type LocalOwner = Readonly<{ subjectId: string; profileId: string }>;
export type LeaseScope = Readonly<{
  owner: LocalOwner;
  generation: number;
  validUntil: number;
}>;
export type OwnerSnapshot =
  | Readonly<{ phase: 'LOCKED' | 'VERIFYING'; generation: number }>
  | Readonly<LeaseScope & { phase: 'HYDRATING' | 'READY' }>;
export type VerificationResult =
  | Readonly<{ status: 'verified'; owner: LocalOwner; validUntil: number }>
  | Readonly<{ status: 'missing' | 'expired' | 'revoked' | 'unknown' }>;
export interface OwnerVerifier {
  verify(signal: AbortSignal): Promise<VerificationResult>;
}
export interface BoundaryClock {
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
}
export type IsolationErrorCode =
  | 'INVALID_LEASE' | 'STALE_LEASE' | 'AUTHORITY_UNAVAILABLE'
  | 'INVALID_KEY' | 'INVALID_DATA' | 'CORRUPT_DATA'
  | 'STORAGE_UNAVAILABLE' | 'NAMESPACE_QUARANTINED';

export class LocalIsolationError extends Error {
  readonly code: IsolationErrorCode;
  constructor(code: IsolationErrorCode) {
    super(code); // Never include owner IDs, storage payloads, tokens or backend errors.
    this.name = 'LocalIsolationError';
    this.code = code;
  }
}

export interface OwnerAccess {
  getSnapshot(): OwnerSnapshot;
  subscribe(listener: () => void): () => void;
  requireLease(lease: SessionLease): LeaseScope;
  /** Recheck after every await, immediately before synchronous publication to RAM/cache. */
  applyIfCurrent(lease: SessionLease, apply: () => undefined): void;
}
export interface OwnerControl {
  verifySession(): Promise<SessionLease>;
  finishHydration(lease: SessionLease): void;
  invalidateCurrentSession(): void;
}
const defaultClock: BoundaryClock = {
  now: () => Date.now(),
  schedule: (callback, delay) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  },
};
const MAX_TIMER_DELAY = 2_147_483_647;
// Structural validation only; the injected verifier supplies ownership authority.
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function createLocalOwnerBoundary(
  verifier: OwnerVerifier,
  clock: BoundaryClock = defaultClock,
): Readonly<{ access: OwnerAccess; control: OwnerControl }> {
  let generation = 0;
  let snapshot: OwnerSnapshot = Object.freeze({ phase: 'LOCKED', generation });
  const leases = new WeakMap<object, LeaseScope>();
  const listeners = new Set<() => void>();
  let verification: AbortController | undefined;
  let cancelExpiry: (() => void) | undefined;

  const publish = (next: OwnerSnapshot) => {
    snapshot = Object.freeze(next);
    for (const listener of [...listeners]) {
      // An observer error must not interrupt invalidation of the security boundary.
      try { listener(); } catch { /* no payload logging */ }
    }
  };
  const retire = () => {
    generation++;
    // Retire authority before abort handlers (which may run synchronously).
    snapshot = Object.freeze({ phase: 'LOCKED', generation });
    const previous = verification;
    verification = undefined;
    const cancel = cancelExpiry;
    cancelExpiry = undefined;
    cancel?.();
    previous?.abort();
  };
  const invalidateCurrentSession = () => {
    retire();
    publish(snapshot);
  };
  const getSnapshot = (): OwnerSnapshot => {
    if ((snapshot.phase === 'HYDRATING' || snapshot.phase === 'READY')
      && (!Number.isFinite(clock.now()) || clock.now() >= snapshot.validUntil)) {
      invalidateCurrentSession();
    }
    return snapshot;
  };
  const requireLease = (lease: SessionLease): LeaseScope => {
    const current = getSnapshot();
    const scope = typeof lease === 'object' && lease !== null ? leases.get(lease) : undefined;
    if (!scope) throw new LocalIsolationError('INVALID_LEASE');
    if ((current.phase !== 'HYDRATING' && current.phase !== 'READY')
      || scope.generation !== current.generation) {
      throw new LocalIsolationError('STALE_LEASE');
    }
    return scope;
  };
  const armExpiry = (scope: LeaseScope) => {
    const check = () => {
      if (snapshot.generation !== scope.generation
        || (snapshot.phase !== 'HYDRATING' && snapshot.phase !== 'READY')) return;
      const remaining = scope.validUntil - clock.now();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        invalidateCurrentSession();
      } else {
        cancelExpiry = clock.schedule(check, Math.min(remaining, MAX_TIMER_DELAY));
      }
    };
    check();
  };

  const access: OwnerAccess = Object.freeze({
    getSnapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    requireLease,
    applyIfCurrent: (lease: SessionLease, apply: () => undefined) => {
      requireLease(lease);
      apply();
    },
  });
  const control: OwnerControl = Object.freeze({
    invalidateCurrentSession,
    finishHydration: (lease: SessionLease) => {
      const scope = requireLease(lease);
      publish({ ...scope, phase: 'READY' });
    },
    verifySession: async (): Promise<SessionLease> => {
      retire();
      const ticket = generation;
      const controller = new AbortController();
      verification = controller;
      publish({ phase: 'VERIFYING', generation: ticket });
      try {
        if (snapshot.generation !== ticket || snapshot.phase !== 'VERIFYING') {
          throw new LocalIsolationError('STALE_LEASE');
        }
        // No owner IDs, route props or stored namespace supplied by this caller.
        const result = await verifier.verify(controller.signal);
        if (snapshot.generation !== ticket || snapshot.phase !== 'VERIFYING') {
          throw new LocalIsolationError('STALE_LEASE');
        }
        if (!result || result.status !== 'verified'
          || !result.owner || !validId(result.owner.subjectId) || !validId(result.owner.profileId)
          || !Number.isFinite(clock.now()) || !Number.isFinite(result.validUntil)
          || result.validUntil <= clock.now()) {
          throw new LocalIsolationError('AUTHORITY_UNAVAILABLE');
        }
        const scope: LeaseScope = Object.freeze({
          owner: Object.freeze({ subjectId: result.owner.subjectId, profileId: result.owner.profileId }),
          generation: ticket,
          validUntil: result.validUntil,
        });
        const lease = Object.freeze(Object.create(null)) as SessionLease;
        leases.set(lease, scope);
        verification = undefined;
        publish({ ...scope, phase: 'HYDRATING' });
        requireLease(lease); // A synchronous observer may have locked the session.
        armExpiry(scope);
        requireLease(lease);
        return lease;
      } catch (error) {
        const superseded = generation !== ticket;
        if (!superseded) invalidateCurrentSession();
        if (superseded) throw new LocalIsolationError('STALE_LEASE');
        // Do not expose errors from a future authentication/network implementation.
        throw new LocalIsolationError(
          error instanceof LocalIsolationError ? error.code : 'AUTHORITY_UNAVAILABLE',
        );
      }
    },
  });
  return Object.freeze({ access, control });
}
