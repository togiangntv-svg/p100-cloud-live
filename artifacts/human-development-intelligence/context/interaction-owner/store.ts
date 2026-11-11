import {
  applyAiResponse, beginAiRequest, buildAiConversationWindow, correctUnderstanding,
  createInitialInteractionState, createLocalId, grantAiContextConsent, hydrateInteraction,
  rejectAiRequest, serializeInteraction, setAiAvailability, setUserGoal, updateAiConsent,
  type AiAvailability, type AiConsent, type AiConversationMessage, type InteractionState,
} from '../../domain/interaction';
import type { OwnerAccess, SessionLease, LeaseScope } from '../../domain/local-owner/boundary';
import { createGuardedUserStorage, type LocalStorageBackend } from '../../domain/local-owner/storage';

export type InteractionOwnerBinding = Readonly<{ access: OwnerAccess; lease: SessionLease }>;
type Consent = { granted: true; version: '2026-09-10'; purpose: 'internal_coaching_response' };
type PilotBody = { locale: 'vi' | 'en'; consent: Consent };
type RespondBody = PilotBody & {
  requestId: string; createdAt: string; expiresAt: string;
  messages: AiConversationMessage[]; relevantContext: [];
};
export interface InteractionApi {
  status(options: { signal: AbortSignal }): Promise<{ remainingLiveCalls: number; availability: string }>;
  pilot(body: PilotBody, options: { signal: AbortSignal }): Promise<unknown>;
  respond(body: RespondBody, options: { signal: AbortSignal }): Promise<{ requestId: string; text: string }>;
}
export type InteractionContextValue = Readonly<{
  state: InteractionState;
  projectionRevision: number;
  hydrated: boolean;
  persistenceStatus: 'idle' | 'loading' | 'error' | 'ready';
  unreadableDataPreserved: boolean;
  aiBusy: boolean;
  addUserMessage: (text: string, locale: string) => Promise<boolean>;
  enableAiPilot: (locale: string) => Promise<boolean>;
  saveGoal: (goal: string, action: string) => boolean;
  saveCorrection: (text: string) => boolean;
  setAiConsent: (consent: Exclude<AiConsent, 'not_asked'>) => void;
  deleteData: () => Promise<boolean>;
}>;
type Data = Pick<InteractionContextValue,
  'state' | 'projectionRevision' | 'hydrated' | 'persistenceStatus' | 'unreadableDataPreserved' | 'aiBusy'>;
type Run = Readonly<{ epoch: number; scope: LeaseScope; lease: SessionLease }>;
type AiOperation = { run: Run; controller: AbortController };
const consent = (): Consent => ({
  granted: true, version: '2026-09-10', purpose: 'internal_coaching_response',
});
let nextProjectionRevision = 0;
function mapFailure(error: unknown): Extract<AiAvailability, 'offline' | 'quota_exhausted'> {
  const code = (error as { body?: { code?: string } })?.body?.code;
  return code === 'AI_BUDGET_EXHAUSTED' || code === 'AI_RATE_LIMITED' ? 'quota_exhausted' : 'offline';
}
function freezeState(state: InteractionState): InteractionState {
  for (const message of state.messages) Object.freeze(message);
  for (const entry of state.understandings) Object.freeze(entry);
  Object.freeze(state.messages);
  Object.freeze(state.understandings);
  if (state.goal) Object.freeze(state.goal);
  if (state.pendingRequest) Object.freeze(state.pendingRequest);
  return Object.freeze(state);
}

/**
 * The actual lifecycle used by InteractionContext, testable without React/native/auth.
 * One instance per supplied boundary+lease. Never verifies IDs or acquires credentials.
 * No binding => locked. Only READY (not boundary HYDRATING) may hydrate Interaction.
 */
export function createInteractionStore(options: {
  owner?: InteractionOwnerBinding;
  backend: LocalStorageBackend;
  api: InteractionApi;
  now?: () => number;
  newId?: (prefix: string) => string;
}) {
  const { api } = options;
  const owner = options.owner ? Object.freeze({ ...options.owner }) : undefined;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? createLocalId;
  let lastTimestamp = now() - 1;
  const iso = () => {
    lastTimestamp = Math.max(now(), lastTimestamp + 1);
    return new Date(lastTimestamp).toISOString();
  };
  const storage = owner ? createGuardedUserStorage(owner.access, options.backend) : undefined;
  const listeners = new Set<() => void>();
  const controllers = new Set<AbortController>();
  let started = false;
  let epoch = 0;
  let run: Run | undefined;
  let unsubscribe: (() => void) | undefined;
  let writesLocked = true;
  let deleting = false;
  let persistenceRevision = 0;
  let projectionRevision = ++nextProjectionRevision;
  let activeAi: AiOperation | undefined;
  let data: Data = empty();
  let snapshot: InteractionContextValue = makeSnapshot();

  function empty(): Data {
    return { state: freezeState(createInitialInteractionState(iso())), projectionRevision, hydrated: false,
      persistenceStatus: 'idle', unreadableDataPreserved: false, aiBusy: false };
  }
  function notify() {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observers cannot prevent retirement; no payload logging */ }
    }
  }
  function publish(patch: Partial<Data>) {
    data = { ...data, ...patch };
    snapshot = makeSnapshot();
    notify();
  }
  function readyScope(): LeaseScope | undefined {
    if (!owner || owner.access.getSnapshot().phase !== 'READY') return undefined;
    try { return owner.access.requireLease(owner.lease); } catch { return undefined; }
  }
  function current(captured: Run | undefined): captured is Run {
    return Boolean(started && captured && run === captured && epoch === captured.epoch
      && readyScope() === captured.scope);
  }
  function cancelAi() {
    activeAi = undefined;
    for (const controller of controllers) controller.abort();
    controllers.clear();
  }
  function retire() {
    epoch++;
    projectionRevision = ++nextProjectionRevision;
    run = undefined;
    writesLocked = true;
    deleting = false;
    cancelAi();
    data = empty();
    snapshot = makeSnapshot();
    notify();
  }
  function guarded(captured: Run, update: () => void): boolean {
    if (!current(captured)) return false;
    let applied = false;
    try {
      owner!.access.applyIfCurrent(captured.lease, () => {
        if (!current(captured)) return;
        update();
        applied = true;
      });
    } catch (error) {
      // Expiry can happen between the preliminary check and the atomic publication.
      if (!current(captured)) return false;
      throw error;
    }
    return applied && current(captured);
  }
  function editable(captured: Run | undefined): captured is Run {
    return current(captured) && data.hydrated && !writesLocked && !deleting;
  }
  function persist(captured: Run, state: InteractionState) {
    if (!editable(captured)) return;
    const revision = ++persistenceRevision;
    // Request/busy/availability are session-only, not restart authority or in-flight work.
    const serialized = serializeInteraction({
      ...state, pendingRequest: null, latestRequestSequence: 0, aiAvailability: 'not_connected',
    });
    // Adapter enqueues immediately; delete is ordered behind all already-issued writes.
    void storage!.writeUserState(captured.lease, 'interaction', serialized)
      .then(() => {
        if (!current(captured) || revision !== persistenceRevision) return;
        guarded(captured, () => publish({ persistenceStatus: 'ready' }));
      })
      .catch(() => {
        if (!current(captured) || revision !== persistenceRevision) return;
        guarded(captured, () => {
          writesLocked = true;
          cancelAi();
          publish({ persistenceStatus: 'error', aiBusy: false });
        });
      });
  }
  function commit(captured: Run, state: InteractionState): boolean {
    if (!editable(captured)) return false;
    const accepted = guarded(captured, () => publish({
      state: freezeState(state), persistenceStatus: 'loading',
    }));
    if (accepted) persist(captured, state);
    return accepted;
  }
  function liveAi(operation: AiOperation): boolean {
    return editable(operation.run) && activeAi === operation;
  }
  function beginAi(captured: Run): AiOperation {
    cancelAi(); // Also retires any older gateway-status result.
    const operation = { run: captured, controller: new AbortController() };
    activeAi = operation;
    controllers.add(operation.controller);
    guarded(captured, () => publish({ aiBusy: true }));
    return operation;
  }
  function finishAi(operation: AiOperation) {
    controllers.delete(operation.controller);
    if (!liveAi(operation)) return;
    guarded(operation.run, () => {
      activeAi = undefined;
      publish({ aiBusy: false });
    });
  }
  async function hydrate(captured: Run) {
    try {
      const [saved, deletedAt] = await Promise.all([
        storage!.readUserState(captured.lease, 'interaction'),
        storage!.readUserState(captured.lease, 'interaction-deleted-at'),
      ]);
      if (!current(captured)) return;
      if ((saved !== null && typeof saved !== 'string')
        || (deletedAt !== null && (typeof deletedAt !== 'string'
          || !Number.isFinite(Date.parse(deletedAt))))) throw new Error();
      const result = hydrateInteraction(saved as string | null, deletedAt as string | null);
      if (result.kind === 'unreadable') throw new Error();
      const restored = result.kind === 'ok' ? result.state : createInitialInteractionState(iso());
      // Keep post-delete edits newer than their marker, including within one clock tick.
      lastTimestamp = Math.max(lastTimestamp, Date.parse(restored.updatedAt),
        deletedAt === null ? 0 : Date.parse(deletedAt as string));
      // Do not revive a pending request or gateway availability from an earlier session.
      const state = freezeState({ ...restored,
        pendingRequest: null, latestRequestSequence: 0, aiAvailability: 'not_connected' as const });
      if (!guarded(captured, () => {
        writesLocked = false;
        publish({ state, hydrated: true, persistenceStatus: 'ready', unreadableDataPreserved: false });
      })) return;
    } catch {
      if (!current(captured)) return;
      guarded(captured, () => {
        writesLocked = true;
        publish({ ...empty(), hydrated: true, unreadableDataPreserved: true, persistenceStatus: 'error' });
      });
    }
  }
  function syncBoundary() {
    if (!started) return;
    const scope = readyScope();
    if (!scope) {
      if (run) retire(); // Immediate synchronous RAM retirement on boundary notification.
      return;
    }
    if (run) return;
    epoch++;
    projectionRevision = ++nextProjectionRevision;
    run = Object.freeze({ epoch, scope, lease: owner!.lease });
    writesLocked = true;
    publish({ ...empty(), persistenceStatus: 'loading' });
    if (current(run)) void hydrate(run);
  }
  async function addUserMessage(captured: Run | undefined, text: string, locale: string): Promise<boolean> {
    if (!editable(captured) || !text.trim() || data.aiBusy) return false;
    const at = iso();
    if (data.state.aiConsent !== 'granted') {
      return commit(captured, beginAiRequest(data.state, text, newId('local'), at, at).state);
    }
    const requestId = newId('ai'), expiresAt = new Date(Date.parse(at) + 120_000).toISOString();
    const pending = beginAiRequest(data.state, text, requestId, at, expiresAt);
    const operation = beginAi(captured);
    try {
      if (!commit(captured, pending.state) || !liveAi(operation)) return false;
      const response = await api.respond({
        requestId, createdAt: at, expiresAt, locale: locale === 'vi' ? 'vi' : 'en',
        consent: consent(), messages: buildAiConversationWindow(data.state, text), relevantContext: [],
      }, { signal: operation.controller.signal });
      if (!liveAi(operation)) return false;
      const next = applyAiResponse(data.state, response.requestId, pending.sequence, response.text, iso());
      return next !== data.state && commit(captured, next);
    } catch (error) {
      if (!liveAi(operation)) return false;
      const rejected = rejectAiRequest(data.state, requestId, pending.sequence, mapFailure(error), iso());
      // Preserve sequence guard for consent too; a stale rejection must not revoke a newer consent.
      if (rejected !== data.state) commit(captured, updateAiConsent(rejected, 'declined', iso()));
      return false;
    } finally {
      finishAi(operation);
    }
  }
  async function enableAiPilot(captured: Run | undefined, locale: string): Promise<boolean> {
    if (!editable(captured) || data.aiBusy) return false;
    const operation = beginAi(captured);
    try {
      if (!liveAi(operation)) return false;
      await api.pilot({ locale: locale === 'vi' ? 'vi' : 'en', consent: consent() },
        { signal: operation.controller.signal });
      if (!liveAi(operation)) return false;
      return commit(captured, setAiAvailability(grantAiContextConsent(data.state, iso()), 'ready', iso()));
    } catch (error) {
      if (liveAi(operation)) {
        commit(captured, setAiAvailability(data.state, mapFailure(error), iso()));
      }
      return false;
    } finally {
      finishAi(operation);
    }
  }
  async function deleteData(captured: Run | undefined): Promise<boolean> {
    if (!current(captured) || deleting) return false;
    // Local content epoch invalidates hydration/AI/write callbacks without logging out the owner.
    epoch++;
    projectionRevision = ++nextProjectionRevision;
    cancelAi();
    run = Object.freeze({ epoch, scope: captured.scope, lease: captured.lease });
    const deletion = run, deletedAt = iso();
    deleting = true;
    writesLocked = true;
    publish({ ...empty(), persistenceStatus: 'loading' });
    try {
      if (!current(deletion)) return false;
      await storage!.writeUserState(deletion.lease, 'interaction-deleted-at', deletedAt);
      if (!current(deletion)) return false;
      await storage!.removeUserState(deletion.lease, 'interaction');
      if (!current(deletion)) return false;
      return guarded(deletion, () => {
        deleting = false;
        writesLocked = false;
        publish({ state: freezeState(createInitialInteractionState(deletedAt)), hydrated: true,
          aiBusy: false, unreadableDataPreserved: false, persistenceStatus: 'idle' });
      });
    } catch {
      if (current(deletion)) guarded(deletion, () => {
        deleting = false;
        writesLocked = true;
        publish({ ...empty(), hydrated: true, unreadableDataPreserved: true, persistenceStatus: 'error' });
      });
      return false;
    }
  }
  function makeSnapshot(): InteractionContextValue {
    const captured = run;
    return Object.freeze({
      ...data,
      addUserMessage: (text: string, locale: string) => addUserMessage(captured, text, locale),
      enableAiPilot: (locale: string) => enableAiPilot(captured, locale),
      saveGoal: (goal: string, action: string) => {
        if (!editable(captured) || !goal.trim() || !action.trim()) return false;
        cancelAi();
        publish({ aiBusy: false });
        return commit(captured, setUserGoal(data.state, goal, action, iso()));
      },
      saveCorrection: (text: string) => {
        if (!editable(captured) || !text.trim()) return false;
        cancelAi();
        publish({ aiBusy: false });
        return commit(captured, correctUnderstanding(data.state, text, iso()));
      },
      setAiConsent: (value: Exclude<AiConsent, 'not_asked'>) => {
        if (!editable(captured)) return;
        cancelAi();
        publish({ aiBusy: false });
        commit(captured, updateAiConsent(data.state, value, iso()));
      },
      deleteData: () => deleteData(captured),
    });
  }
  return Object.freeze({
    getSnapshot: () => {
      // Backstop for expiry while JS timers were suspended, before React reads/render.
      if (started && run && !current(run)) retire();
      return snapshot;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start: () => {
      if (started) return;
      started = true;
      unsubscribe = owner?.access.subscribe(syncBoundary);
      syncBoundary();
    },
    stop: () => {
      started = false;
      unsubscribe?.();
      unsubscribe = undefined;
      retire();
    },
  });
}
