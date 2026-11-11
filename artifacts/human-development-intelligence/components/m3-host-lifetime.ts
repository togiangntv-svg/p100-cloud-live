import type { OwnerSessionBinding } from '@/domain/identity/owner-session-coordinator';
import { createTrainerRuntimeCoordinator } from '@/domain/trainer-runtime/coordinator';
import { createSessionTaskStore, type SessionTaskStore, type TaskSnapshot } from '@/domain/session-task/store';
import type { M3LanguageAdapter } from '@/domain/m3/resolver';
import type { CameraC2ActionSource } from '@/lib/camera/c2-runtime';
import { createProductCandidateWalkResource } from '@/domain/m6/walk-resource';
import { createTrainerM7CycleAuthority } from '@/domain/trainer-runtime/m7-cycle-authority';
import { createM7RecordController } from './m7-record-controller';
import { readM7RecordActivation, type M7RecordActivation } from './m7-record-activation';

export type M3HostMode = 'ANONYMOUS' | 'OWNED' | 'BLOCKED';
export type M3HostSlot = Readonly<{
  identity: object;
  id: number;
  mode: 'ANONYMOUS' | 'OWNED';
  store: SessionTaskStore;
  adapter?: M3LanguageAdapter;
  actionSource: CameraC2ActionSource;
  binding?: OwnerSessionBinding;
  record?: ReturnType<typeof createM7RecordController>;
}>;
export type M3HostProjection = Readonly<{
  slot?: M3HostSlot;
  task: TaskSnapshot;
  safety: Readonly<{ state: 'OPEN' | 'HOLD' | 'UNAVAILABLE'; revision: number; session_id: string | null }>;
  availability: 'AVAILABLE' | 'SAFETY_HOLD' | 'BASIS_STALE' | 'REASSESS_REQUIRED' | 'UNAVAILABLE';
}>;

const unavailable: M3HostProjection = Object.freeze({
  task: Object.freeze({ session_id: null, tasks: Object.freeze([]), active_task_id: null, revision: 0 }),
  safety: Object.freeze({ state: 'UNAVAILABLE', revision: 0, session_id: null }),
  availability: 'UNAVAILABLE',
});

/** A pure host shell: no owner subscription, task start, or provider work until activate(). */
export function createM3HostLifetime(retireCamera: () => void) {
  const listeners = new Set<() => void>();
  let projection: M3HostProjection = unavailable;
  let active: (M3HostSlot & { live: boolean; adapterKey: unknown;
    activationKey?: M7RecordActivation; unsubscribe: () => void }) | undefined;
  let installing: typeof active;
  let nextId = 0;
  let adapterKey: unknown;
  let makeAdapter: ((isSessionCurrent: (sessionId: string) => boolean) => M3LanguageAdapter | undefined)
    | undefined;
  let technicalActivation: M7RecordActivation | undefined;

  const publish = (next: M3HostProjection) => {
    if (projection === next) return;
    projection = next;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observer failure never controls authority */ }
    }
  };
  const refresh = () => {
    const slot = active;
    if (!slot?.live) { publish(unavailable); return; }
    const task = slot.store.getSnapshot();
    const safety = slot.store.getTrainerSafetySnapshot();
    const availability = slot.store.getTrainerActionAvailability();
    if (projection.slot === slot
      && (projection.safety.revision !== safety.revision
        || projection.safety.state !== safety.state
        || (projection.availability === 'AVAILABLE' && availability !== 'AVAILABLE'))) {
      // Domain publication closes the live Camera boundary before React renders again.
      retireCamera();
    }
    publish(Object.freeze({ slot, task, safety, availability }));
  };
  const clear = () => {
    const prior = active;
    if (!prior) { publish(unavailable); return; }
    prior.live = false;
    active = undefined;
    prior.unsubscribe();
    prior.record?.retire();
    retireCamera();
    if (prior.mode === 'ANONYMOUS') prior.store.stop();
    publish(unavailable);
  };
  const construct = (mode: 'ANONYMOUS' | 'OWNED', binding?: OwnerSessionBinding) => {
    const slot = {
      identity: Object.freeze({}), id: ++nextId, mode, binding, adapterKey,
      activationKey: technicalActivation,
      live: true, unsubscribe: () => {},
    } as M3HostSlot & { live: boolean; adapterKey: unknown;
      activationKey?: M7RecordActivation; unsubscribe: () => void };
    const adapter = makeAdapter?.((sessionId) => slot.live
      && slot.store?.getSnapshot().session_id === sessionId);
    const walkResource = mode === 'OWNED' ? createProductCandidateWalkResource() : undefined;
    const cycle = mode === 'OWNED' && readM7RecordActivation(technicalActivation, binding)
      ? createTrainerM7CycleAuthority() : undefined;
    const store = createSessionTaskStore({ ...(binding ? { ownerSession: binding } : {}),
      ...(walkResource ? { walkResource: walkResource.access } : {}),
      ...(cycle ? { m7Purpose: cycle.access } : {}),
      ...(adapter ? { adapter } : {}) });
    const actionSource: CameraC2ActionSource = Object.freeze({
      identity: slot.identity,
      current() {
        if (!slot.live) return undefined;
        const snapshot = store.getSnapshot();
        const task = snapshot.tasks.find((item) => item.task_id === snapshot.active_task_id);
        if (!task || !snapshot.session_id) return undefined;
        const safety = store.getTrainerSafetySnapshot();
        if (safety.state === 'UNAVAILABLE') return undefined;
        return Object.freeze({ session_id: snapshot.session_id, task_id: task.task_id,
          revision: task.revision, safety_revision: safety.revision, safety_state: safety.state,
          availability: store.getTrainerActionAvailability() });
      },
    });
    const record = cycle && binding && technicalActivation
      ? createM7RecordController({
        authority: cycle, activation: technicalActivation,
        getLive: () => slot.live && active === slot && store.m7Outcome
          ? { store, outcome: store.m7Outcome, binding } : undefined,
        onChange: () => { if (active === slot) refresh(); },
      }) : undefined;
    Object.assign(slot, { store, adapter, actionSource, record });
    const unsubscribeStore = store.subscribe(() => {
      if (active === slot) { slot.record?.invalidateView(); refresh(); }
    });
    const unsubscribeOutcome = store.m7Outcome?.subscribe(() => {
      if (active === slot) { slot.record?.invalidateView(); refresh(); }
    })
      ?? (() => {});
    slot.unsubscribe = () => { unsubscribeStore(); unsubscribeOutcome(); };
    return slot;
  };
  const coordinator = createTrainerRuntimeCoordinator({
    createStore(binding) {
      installing = construct('OWNED', binding);
      return installing.store;
    },
  });
  coordinator.subscribe(() => {
    const state = coordinator.getSnapshot();
    if (state.state !== 'READY') { clear(); return; }
    if (active?.store === state.store) { refresh(); return; }
    clear();
    if (installing?.store !== state.store) return;
    active = installing;
    installing = undefined;
    refresh();
  });

  return Object.freeze({
    getSnapshot: () => projection,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    currentSlot(): M3HostSlot | undefined {
      const slot = active;
      if (!slot?.live) return undefined;
      if (slot.mode === 'OWNED') {
        const state = coordinator.getSnapshot();
        if (state.state !== 'READY' || state.store !== slot.store) return undefined;
      }
      return slot;
    },
    activate(mode: M3HostMode, binding: OwnerSessionBinding | undefined, key: unknown,
      factory: (isSessionCurrent: (sessionId: string) => boolean) => M3LanguageAdapter | undefined,
      activation?: M7RecordActivation) {
      adapterKey = key;
      makeAdapter = factory;
      technicalActivation = activation;
      if (mode === 'BLOCKED' || (mode === 'OWNED' && !binding)) {
        clear(); coordinator.setBinding(undefined); return;
      }
      if (mode === 'ANONYMOUS') {
        if (active?.mode === 'ANONYMOUS' && active.adapterKey === key) return;
        clear(); coordinator.setBinding(undefined);
        const slot = construct('ANONYMOUS');
        active = slot;
        slot.store.start();
        refresh();
        return;
      }
      if (active?.mode === 'OWNED' && (active.adapterKey !== key
        || active.activationKey !== activation)) {
        clear(); coordinator.setBinding(undefined);
      }
      coordinator.setBinding(binding);
    },
    deactivate() { clear(); coordinator.setBinding(undefined); },
  });
}
