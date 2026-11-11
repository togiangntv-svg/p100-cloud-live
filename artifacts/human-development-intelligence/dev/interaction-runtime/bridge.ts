import { createLocalOwnerBoundary, type SessionLease } from '../../domain/local-owner/boundary';
import type { InteractionOwnerBinding } from '../../context/interaction-owner/store';
import { isRuntimeTestEnabled } from './gate';

const OWNERS = Object.freeze({
  A: Object.freeze({ subjectId: 'test-subject-a', profileId: 'test-profile-a' }),
  B: Object.freeze({ subjectId: 'test-subject-b', profileId: 'test-profile-b' }),
});
type Label = keyof typeof OWNERS;
type View = Readonly<{
  phase: 'LOCKED' | 'VERIFYING' | 'HYDRATING' | 'READY';
  generation: number;
  label?: Label;
  binding?: InteractionOwnerBinding;
}>;

/** Synthetic local test authority ONLY. No persistence, tokens, or caller-provided IDs. */
export function createRuntimeLeaseBridge() {
  let candidate: Label | undefined;
  let lease: SessionLease | undefined;
  let ticket = 0;
  const boundary = createLocalOwnerBoundary({
    async verify() {
      const selected = candidate;
      if (!isRuntimeTestEnabled() || !selected) return { status: 'unknown' };
      return { status: 'verified', owner: OWNERS[selected], validUntil: Date.now() + 15 * 60_000 };
    },
  });
  const listeners = new Set<() => void>();
  let view: View = Object.freeze({ phase: 'LOCKED', generation: 0 });
  function refresh() {
    const state = boundary.access.getSnapshot();
    let binding: InteractionOwnerBinding | undefined;
    if (state.phase === 'READY' && lease && isRuntimeTestEnabled()) {
      try {
        boundary.access.requireLease(lease);
        binding = Object.freeze({ access: boundary.access, lease });
      } catch { /* never publish a stale lease */ }
    }
    view = Object.freeze({ phase: state.phase, generation: state.generation,
      ...(binding ? { label: candidate, binding } : {}) });
    for (const listener of [...listeners]) { try { listener(); } catch { /* no payload logging */ } }
  }
  boundary.access.subscribe(refresh);
  function invalidate() {
    ticket++;
    lease = undefined;
    candidate = undefined;
    boundary.control.invalidateCurrentSession();
  }
  return Object.freeze({
    getSnapshot: () => {
      if (!isRuntimeTestEnabled() && view.phase !== 'LOCKED') invalidate();
      boundary.access.getSnapshot(); // Expiry checks may synchronously refresh.
      return view;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    invalidate,
    select: async (label: unknown): Promise<boolean> => {
      invalidate();
      if (!isRuntimeTestEnabled() || (label !== 'A' && label !== 'B')) return false;
      candidate = label;
      const operation = ticket;
      try {
        const issued = await boundary.control.verifySession();
        if (operation !== ticket || !isRuntimeTestEnabled()) {
          if (operation === ticket) invalidate();
          return false;
        }
        lease = issued;
        boundary.control.finishHydration(issued);
        return Boolean(view.binding);
      } catch {
        if (operation === ticket) invalidate();
        return false;
      }
    },
  });
}
