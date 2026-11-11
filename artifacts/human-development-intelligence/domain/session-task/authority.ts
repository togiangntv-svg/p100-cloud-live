declare const sessionEpochBrand: unique symbol;
export type SessionTaskEpoch = Readonly<{ [sessionEpochBrand]: true }>;

const objectValue = (value: unknown): value is object =>
  (typeof value === 'object' && value !== null) || typeof value === 'function';

/**
 * Store-private RAM authority for one active SessionTask epoch.
 *
 * Public ID fields remain correlation data only. Authority belongs to the
 * exact immutable object issued by this registry in its current epoch; copies,
 * serialized values and objects issued by another store have no authority.
 */
export function createSessionTaskAuthority() {
  const references = new WeakMap<object, SessionTaskEpoch>();
  const derived = new WeakMap<object, SessionTaskEpoch>();
  let currentEpoch: SessionTaskEpoch | undefined;

  const epochCurrent = (epoch: SessionTaskEpoch | undefined): epoch is SessionTaskEpoch =>
    !!epoch && epoch === currentEpoch;

  return Object.freeze({
    beginSession(): SessionTaskEpoch {
      currentEpoch = Object.freeze(Object.create(null)) as SessionTaskEpoch;
      return currentEpoch;
    },
    retireSession(): void {
      currentEpoch = undefined;
    },
    captureEpoch(): SessionTaskEpoch | undefined {
      return currentEpoch;
    },
    isCurrentEpoch: epochCurrent,
    issueReference<T extends object>(value: T): T {
      if (!currentEpoch) throw Error('SESSION_EPOCH_UNAVAILABLE');
      const issued = Object.freeze(value) as T;
      references.set(issued, currentEpoch);
      return issued;
    },
    belongsToCurrentEpoch(value: unknown): boolean {
      return !!currentEpoch && objectValue(value) && references.get(value) === currentEpoch;
    },
    registerDerived<T extends object>(value: T): T {
      if (!currentEpoch) throw Error('SESSION_EPOCH_UNAVAILABLE');
      derived.set(value, currentEpoch);
      return value;
    },
    ownsDerived(value: unknown): boolean {
      return !!currentEpoch && objectValue(value) && derived.get(value) === currentEpoch;
    },
  });
}
