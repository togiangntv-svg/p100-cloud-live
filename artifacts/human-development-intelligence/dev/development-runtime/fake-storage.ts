import { isRuntimeTestEnabled } from '../interaction-runtime/gate';

type Method = 'getItem' | 'setItem' | 'removeItem';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
type Hold = { method: Method; started: ReturnType<typeof deferred>; finish: ReturnType<typeof deferred>; fail: boolean };
const prefix = (label: 'A' | 'B') => '@100/v2/subject/test-subject-' + label.toLowerCase()
  + '/profile/test-profile-' + label.toLowerCase() + '/';
export const fixtureKey = (label: 'A' | 'B', name: 'state' | 'interaction-deleted-at' = 'state') => prefix(label) + name;
export const legacyKey = '@100-human-development-state';
const allowed = new Set([fixtureKey('A'), fixtureKey('B'), fixtureKey('A', 'interaction-deleted-at'),
  fixtureKey('B', 'interaction-deleted-at'), legacyKey]);
function guard(key?: string) {
  if (!isRuntimeTestEnabled()) throw new Error('TEST_BRIDGE_DISABLED');
  if (key !== undefined && !allowed.has(key)) throw new Error('NON_SYNTHETIC_STORAGE_KEY');
}

// One in-memory backend shared with the ACTUAL provider via the isolated Metro resolver.
// No AsyncStorage import, browser storage, disk, network or persisted session authority.
class SyntheticStorage {
  private values = new Map<string, string>();
  private holds: Hold[] = [];
  readonly calls: Array<{ method: Method; key: string }> = [];
  private async wait(method: Method, key: string) {
    guard(key);
    this.calls.push({ method, key });
    const index = this.holds.findIndex(hold => hold.method === method);
    if (index < 0) return;
    const hold = this.holds.splice(index, 1)[0];
    hold.started.resolve();
    await hold.finish.promise;
    guard(key);
    if (hold.fail) throw new Error('SYNTHETIC_IO_FAILURE');
  }
  getItem = async (key: string): Promise<string | null> => {
    guard(key);
    const raw = this.values.get(key) ?? null;
    await this.wait('getItem', key);
    return raw;
  };
  setItem = async (key: string, value: string): Promise<void> => {
    guard(key);
    await this.wait('setItem', key);
    this.values.set(key, value);
  };
  removeItem = async (key: string): Promise<void> => {
    guard(key);
    await this.wait('removeItem', key);
    this.values.delete(key);
  };
  getAllKeys = async (): Promise<string[]> => { guard(); return [...this.values.keys()]; };
  holdNext(method: Method, fail = false) {
    guard();
    const hold = { method, fail, started: deferred(), finish: deferred() };
    this.holds.push(hold);
    return { started: hold.started.promise, release: hold.finish.resolve };
  }
  inspect(key: string) { guard(key); return this.values.get(key) ?? null; }
  seed(key: string, raw: string) { guard(key); this.values.set(key, raw); }
}
export const syntheticStorage = new SyntheticStorage();
export default syntheticStorage;
