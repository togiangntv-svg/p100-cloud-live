import type { M2Snapshot } from '../m2';
import type { OwnerAccess, SessionLease, LeaseScope } from '../local-owner/boundary';
import { retireAuthoritativeM2Baseline, validateKnownNoneWitness,
  type KnownNoneWitness, type TrustedM2FactsReader } from './factual-snapshot';

export type OwnerScopedFactsPort = Readonly<{
  mode: 'ADMITTED_LOCAL_VERIFICATION_FIXTURE_PORT'; provenance: 'TEST_FIXTURE';
  access: OwnerAccess; lease: SessionLease; admission: object;
  getSnapshot(): unknown; subscribe(listener: () => void): () => void;
  isBasisCurrent(basis: string): boolean;
}>;
type Source = Pick<OwnerScopedFactsPort, 'getSnapshot' | 'subscribe' | 'isBasisCurrent'>;
const admitted = new WeakMap<object, Readonly<{ access: OwnerAccess; lease: SessionLease; source: Source }>>();
/** Trusted composition seam, not authentication. Never called from session issuance.
 * Caller must explicitly supply the admitted synthetic history scenario; no empty-store inference. */
export function admitOwnerScopedFixturePort(
  access: OwnerAccess, lease: SessionLease,
  source: Source & Readonly<{ provenance: 'TEST_FIXTURE'; scenario: 'S19B_EXPLICIT_KNOWN_NONE' }>,
): OwnerScopedFactsPort {
  if (source.provenance !== 'TEST_FIXTURE' || source.scenario !== 'S19B_EXPLICIT_KNOWN_NONE'
    || typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function'
    || typeof source.isBasisCurrent !== 'function') throw Error('M2_FIXTURE_NOT_ADMITTED');
  access.requireLease(lease);
  const port: OwnerScopedFactsPort = Object.freeze({
    mode: 'ADMITTED_LOCAL_VERIFICATION_FIXTURE_PORT', provenance: 'TEST_FIXTURE',
    access, lease, admission: Object.freeze({}),
    getSnapshot: () => source.getSnapshot(), subscribe: (fn: () => void) => source.subscribe(fn),
    isBasisCurrent: (basis: string) => source.isBasisCurrent(basis),
  });
  admitted.set(port, Object.freeze({ access, lease, source }));
  return port;
}
export type HostFactsSnapshot = Readonly<{
  epoch: number; phase: 'UNKNOWN' | 'KNOWN_NONE'; sourceVersion: number | null;
  basisRevision: string | null; provenance: 'UNCONFIGURED' | 'TEST_FIXTURE';
  scope: 'UNKNOWN' | 'TEST_FIXTURE_SCOPED'; reader: TrustedM2FactsReader | undefined;
}>;
export const UNKNOWN_HOST_FACTS: HostFactsSnapshot = Object.freeze({
  epoch: 0, phase: 'UNKNOWN', sourceVersion: null, basisRevision: null,
  provenance: 'UNCONFIGURED', scope: 'UNKNOWN', reader: undefined,
});
type Clock = { now(): number; schedule(fn: () => void, ms: number): () => void };
const clockDefault: Clock = { now: () => Date.now(), schedule(fn, ms) {
  const timer = setTimeout(fn, ms); return () => clearTimeout(timer);
} };
// Copy data descriptors; never evaluate payload getters. Exceptions/proxy traps fail closed.
// A transparent proxy cannot be distinguished mathematically in user-space; only copied,
// validated data from the explicitly admitted source can become a fixture witness.
function data(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error('M2_DATA');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length > 24) throw Error('M2_DATA_BOUND');
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') throw Error('M2_DATA_KEY');
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor)) throw Error('M2_DATA_ACCESSOR');
    copy[key] = descriptor.value;
  }
  return copy;
}
export function createHostFactsReader(
  access: OwnerAccess | undefined, lease: SessionLease | undefined,
  upstream: OwnerScopedFactsPort | undefined, clock: Clock = clockDefault,
) {
  let epoch = 0, active = false, busy = false, ownerDead = false;
  let highVersion = -1, observedVersion = -1, observedRaw: unknown, lastTime = -Infinity;
  let state = UNKNOWN_HOST_FACTS;
  let offOwner: () => void = () => {}, offSource: () => void = () => {}, cancel: () => void = () => {};
  const listeners = new Set<() => void>(), baselines = new Set<M2Snapshot>();
  const emit = () => { for (const fn of [...listeners]) { try { fn(); } catch { /* scope remains retired */ } } };
  const invalidate = () => {
    epoch++;
    cancel(); cancel = () => {};
    for (const base of baselines) retireAuthoritativeM2Baseline(base);
    baselines.clear();
    state = Object.freeze({ ...UNKNOWN_HOST_FACTS, epoch });
  };
  const now = () => {
    const at = clock.now();
    if (!Number.isFinite(at) || at < lastTime) throw Error('M2_CLOCK');
    lastTime = at; return at;
  };
  const inspect = () => {
    if (!active || ownerDead || !access || !lease || !upstream) throw Error('M2_UNCONFIGURED');
    const admission = admitted.get(upstream);
    if (!admission || admission.access !== access || admission.lease !== lease
      || upstream.provenance !== 'TEST_FIXTURE') throw Error('M2_PROVENANCE');
    let scope: LeaseScope;
    try { scope = access.requireLease(lease); } catch { ownerDead = true; throw Error('M2_LEASE'); }
    const owner = access.getSnapshot(), at = now();
    if (owner.phase !== 'READY' || owner.generation !== scope.generation
      || owner.owner.subjectId !== scope.owner.subjectId || owner.owner.profileId !== scope.owner.profileId
      || at >= scope.validUntil) throw Error('M2_OWNER');
    const raw = upstream.getSnapshot(), s = data(raw);
    if (!Number.isSafeInteger(s.sourceVersion) || (s.sourceVersion as number) < 1
      || (s.sourceVersion as number) < observedVersion) throw Error('M2_VERSION_ROLLBACK');
    if (s.sourceVersion === observedVersion && raw !== observedRaw) throw Error('M2_VERSION_COLLISION');
    observedVersion = s.sourceVersion as number; observedRaw = raw;
    if (s.state !== 'KNOWN_NONE' || s.authorization !== 'allowed') throw Error('M2_UNKNOWN');
    const v = data(s.knownNone), own = data(v.owner), complete = data(v.completeness);
    const witness = Object.freeze({ ...v, owner: Object.freeze(own),
      completeness: Object.freeze(complete) }) as unknown as KnownNoneWitness;
    if (!validateKnownNoneWitness(witness, scope, at)
      || s.basisRevision !== witness.basisRevision || s.sessionGeneration !== scope.generation
      || s.observedAt !== witness.observedAt || s.validUntil !== witness.validUntil) throw Error('M2_FACTS');
    const envelopeOwner = data(s.owner);
    if (envelopeOwner.subjectId !== scope.owner.subjectId || envelopeOwner.profileId !== scope.owner.profileId
      || upstream.isBasisCurrent(witness.basisRevision) !== true
      || upstream.getSnapshot() !== raw || access.requireLease(lease) !== scope
      || access.getSnapshot().phase !== 'READY'
      || !validateKnownNoneWitness(witness, scope, now())) throw Error('M2_READ_RACE');
    const fingerprint = JSON.stringify(witness);
    if (fingerprint.length > 4096) throw Error('M2_FACTS_BOUND');
    return { scope, witness, version: s.sourceVersion as number, fingerprint, raw };
  };
  const reject = () => { invalidate(); emit(); };
  const refresh = () => {
    invalidate();
    if (!active || busy) { emit(); return; }
    const ticket = epoch;
    busy = true;
    try {
      const facts = inspect();
      if (epoch !== ticket || facts.version <= highVersion) throw Error('M2_VERSION');
      highVersion = facts.version;
      const current = () => {
        if (!active || epoch !== ticket || state.phase !== 'KNOWN_NONE') return false;
        try {
          const latest = inspect();
          if (epoch === ticket && latest.scope === facts.scope && latest.version === facts.version
            && latest.fingerprint === facts.fingerprint && latest.raw === facts.raw) return true;
        } catch { /* negative observation retires permanently */ }
        if (epoch === ticket) reject();
        return false;
      };
      const reader: TrustedM2FactsReader = Object.freeze({
        access: access!, lease: lease!,
        readFacts: () => current() ? facts.witness : undefined,
        isBasisCurrent: (basis: string) => basis === facts.witness.basisRevision && current(),
      });
      state = Object.freeze({ epoch: ticket, phase: 'KNOWN_NONE', sourceVersion: facts.version,
        basisRevision: facts.witness.basisRevision, provenance: 'TEST_FIXTURE',
        scope: 'TEST_FIXTURE_SCOPED', reader });
      const delay = Math.min(facts.witness.validUntil, facts.scope.validUntil) - now();
      cancel = clock.schedule(() => { if (active && epoch === ticket) reject(); }, Math.min(delay, 2147483647));
      if (epoch !== ticket || delay <= 0) { cancel(); cancel = () => {}; throw Error('M2_EXPIRY_RACE'); }
    } catch { if (epoch === ticket) invalidate(); }
    finally { busy = false; emit(); }
  };
  return Object.freeze({
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => state,
    start() {
      if (active) return;
      active = true;
      try {
        offOwner = access?.subscribe(refresh) ?? (() => {});
        offSource = upstream && admitted.has(upstream) ? upstream.subscribe(refresh) : (() => {});
        refresh(); // Read AFTER subscription; captured readers recheck at every use.
      } catch { offOwner(); offSource(); offOwner = offSource = () => {}; reject(); }
    },
    trackBaseline(base: M2Snapshot, capturedEpoch: number) {
      if (!active || capturedEpoch !== epoch || !state.reader
        || !state.reader.isBasisCurrent(state.basisRevision!)) retireAuthoritativeM2Baseline(base);
      else baselines.add(base);
      return () => { baselines.delete(base); retireAuthoritativeM2Baseline(base); };
    },
    invalidate: reject,
    dispose() {
      active = false; offOwner(); offSource(); offOwner = offSource = () => {};
      invalidate(); emit();
    },
  });
}

