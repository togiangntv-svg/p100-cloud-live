import type {
  ClientSignInResult,
  IdentityRequestAuthorization,
  ProviderNeutralSessionAdapter,
} from './client-session';
import {
  createLocalOwnerBoundary,
  type BoundaryClock,
  type OwnerAccess,
  type SessionLease,
} from '../local-owner/boundary';

const MAX_REQUEST_TIMEOUT_MS = 60_000;

export type OwnerSessionBinding = Readonly<{
  access: OwnerAccess;
  lease: SessionLease;
  authorization?: IdentityRequestAuthorization;
}>;

export type OwnerSessionSnapshot = Readonly<{
  phase: 'LOCKED' | 'VERIFYING' | 'HYDRATING' | 'READY';
  generation: number;
  binding?: OwnerSessionBinding;
}>;

type SessionAuthority = Pick<
  ProviderNeutralSessionAdapter,
  'ownerVerifier' | 'authorization' | 'logout'
>;
type AppleSignInAuthority = Readonly<{
  signIn(signal: AbortSignal): Promise<ClientSignInResult>;
}>;

export type OwnerSignInOutcome = 'READY' | 'CANCELLED' | 'UNAVAILABLE';

const missingAuthority: SessionAuthority = Object.freeze({
  ownerVerifier: Object.freeze({
    async verify() {
      return Object.freeze({ status: 'missing' as const });
    },
  }),
  authorization: Object.freeze({
    async withBearer() { throw new Error('IDENTITY_AUTHORITY_UNAVAILABLE'); },
  }),
  async logout() {},
});

export function resolveProductionIdentityConfig(
  domainValue: string | undefined,
  timeoutValue: string | undefined,
): Readonly<{ baseUrl: string; requestTimeoutMs: number }> | undefined {
  const domain = domainValue?.trim();
  if (!domain || !timeoutValue || !/^\d+$/u.test(timeoutValue)) return undefined;
  const requestTimeoutMs = Number(timeoutValue);
  if (!Number.isSafeInteger(requestTimeoutMs)
    || requestTimeoutMs < 1
    || requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS) return undefined;
  try {
    const url = new URL(domain.includes('://') ? domain : `https://${domain}`);
    if (url.protocol !== 'https:'
      || !url.hostname
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash) return undefined;
    return Object.freeze({ baseUrl: `${url.origin}/api`, requestTimeoutMs });
  } catch {
    return undefined;
  }
}

export function createOwnerSessionCoordinator(input: Readonly<{
  session?: SessionAuthority;
  apple?: AppleSignInAuthority;
  clock?: BoundaryClock;
}> = {}) {
  const session = input.session ?? missingAuthority;
  const boundary = createLocalOwnerBoundary(session.ownerVerifier, input.clock);
  const listeners = new Set<() => void>();
  let operation = 0;
  let lease: SessionLease | undefined;
  let snapshot: OwnerSessionSnapshot = Object.freeze({ phase: 'LOCKED', generation: 0 });

  const publishBoundarySnapshot = () => {
    const current = boundary.access.getSnapshot();
    let next: OwnerSessionSnapshot = Object.freeze({
      phase: current.phase,
      generation: current.generation,
    });
    if (current.phase === 'READY' && lease) {
      try {
        boundary.access.requireLease(lease);
        next = Object.freeze({
          phase: current.phase,
          generation: current.generation,
          binding: Object.freeze({
            access: boundary.access,
            lease,
            authorization: session.authorization,
          }),
        });
      } catch {
        // A stale lease never becomes visible outside the composition boundary.
      }
    }
    snapshot = next;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* no payload logging */ }
    }
  };
  const stopBoundarySubscription = boundary.access.subscribe(publishBoundarySnapshot);
  publishBoundarySnapshot();

  const invalidate = () => {
    operation++;
    lease = undefined;
    boundary.control.invalidateCurrentSession();
  };

  const verifyForOperation = async (ticket: number): Promise<boolean> => {
    lease = undefined;
    try {
      const issued = await boundary.control.verifySession();
      if (ticket !== operation) return false;
      lease = issued;
      boundary.control.finishHydration(issued);
      return snapshot.phase === 'READY' && snapshot.binding !== undefined;
    } catch {
      if (ticket === operation) {
        lease = undefined;
        publishBoundarySnapshot();
      }
      return false;
    }
  };

  return Object.freeze({
    canSignInWithApple: input.apple !== undefined,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async refresh(): Promise<boolean> {
      const ticket = ++operation;
      return verifyForOperation(ticket);
    },
    async signIn(signal: AbortSignal): Promise<OwnerSignInOutcome> {
      if (!input.apple) return 'UNAVAILABLE';
      const ticket = ++operation;
      lease = undefined;
      boundary.control.invalidateCurrentSession();
      try {
        const result = await input.apple.signIn(signal);
        if (ticket !== operation) return 'UNAVAILABLE';
        if (result.status === 'cancelled') return 'CANCELLED';
        return await verifyForOperation(ticket) ? 'READY' : 'UNAVAILABLE';
      } catch {
        return 'UNAVAILABLE';
      }
    },
    invalidate,
    async logout(signal: AbortSignal): Promise<boolean> {
      invalidate(); // Private RAM loses authority before credential/network work begins.
      if (!input.session) return true;
      try {
        await session.logout(signal);
        return true;
      } catch {
        return false;
      }
    },
    dispose() {
      invalidate();
      stopBoundarySubscription();
      listeners.clear();
    },
  });
}
