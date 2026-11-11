import { isRuntimeTestEnabled } from './gate';

// Metro replaces only InteractionContext's API import in this standalone harness.
// No real API client, fetch, tokens, cookies or provider is reachable from this module.
type Pending = { requestId: string; resolve: (v: { requestId: string; text: string }) => void;
  reject: (e: Error) => void };
const pending: Pending[] = [];
const listeners = new Set<() => void>();
const notify = () => { for (const fn of [...listeners]) fn(); };
function requireTest() {
  if (!isRuntimeTestEnabled()) throw new Error('TEST_BRIDGE_DISABLED');
}
export function setBaseUrl(_url: string) { /* deliberately no network configuration */ }
export async function aiGatewayStatus() {
  requireTest();
  return { availability: 'ready', remainingLiveCalls: 100 };
}
export async function aiPilotSession(_body: unknown) { requireTest(); return {}; }
export async function aiRespond(body: { requestId: string }, _options?: { signal?: AbortSignal }) {
  requireTest();
  // Ignore cancellation deliberately: tests must prove the sealed generation guard.
  // Retain request ID only, never message/history payloads.
  return new Promise<{ requestId: string; text: string }>((resolve, reject) => {
    pending.push({ requestId: body.requestId, resolve, reject }); notify();
  });
}
export const delayedApi = Object.freeze({
  getSnapshot: () => pending.length,
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  settle: (result: 'success' | 'error') => {
    requireTest();
    const work = pending.shift();
    if (!work) return false;
    if (result === 'success') work.resolve({ requestId: work.requestId, text: 'SYNTHETIC delayed answer' });
    else work.reject(new Error('SYNTHETIC_DELAYED_FAILURE'));
    notify(); return true;
  },
  discard: () => {
    for (const work of pending.splice(0)) work.reject(new Error('SYNTHETIC_HARNESS_CLOSED'));
    notify();
  },
});
