import type { OwnerSessionBinding } from '@/domain/identity/owner-session-coordinator';

declare const activationBrand: unique symbol;
export type M7RecordActivation = Readonly<{ [activationBrand]: true }>;

const issued = new WeakMap<object, Readonly<{
  binding: OwnerSessionBinding;
  expiresAt: number;
  now: () => number;
}>>();

/** Trusted technical composition seam. Production supplies no activation. */
export function createM7RecordActivation(
  binding: OwnerSessionBinding, expiresAt: number, now: () => number = Date.now,
): M7RecordActivation {
  const token = Object.freeze(Object.create(null)) as M7RecordActivation;
  issued.set(token, Object.freeze({ binding: Object.freeze({ ...binding }), expiresAt, now }));
  return token;
}

export function readM7RecordActivation(
  token: M7RecordActivation | undefined, binding: OwnerSessionBinding | undefined,
): boolean {
  const entry = token && typeof token === 'object' ? issued.get(token) : undefined;
  if (!entry || !binding || entry.binding.access !== binding.access
    || entry.binding.lease !== binding.lease) return false;
  try {
    const scope = binding.access.requireLease(binding.lease);
    const snapshot = binding.access.getSnapshot();
    const now = entry.now();
    return snapshot.phase === 'READY' && snapshot.generation === scope.generation
      && snapshot.owner.subjectId === scope.owner.subjectId
      && snapshot.owner.profileId === scope.owner.profileId
      && Number.isFinite(now) && Number.isFinite(entry.expiresAt)
      && now < entry.expiresAt && entry.expiresAt <= scope.validUntil;
  } catch { return false; }
}
