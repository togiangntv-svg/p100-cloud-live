// TEST ONLY. Never import from app/domain code; no network, auth, disk, or real user data.
export const OWNER_A = Object.freeze({ subjectId: 'fixture-subject-a', profileId: 'fixture-profile-a' });
export const OWNER_B = Object.freeze({ subjectId: 'fixture-subject-b', profileId: 'fixture-profile-b' });
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export class FakeClock {
  time = 1_000;
  timers = new Set();
  now = () => this.time;
  schedule = (callback, delay) => {
    const timer = { at: this.time + delay, callback };
    this.timers.add(timer);
    return () => this.timers.delete(timer);
  };
  advance(ms) {
    const target = this.time + ms;
    while (true) {
      const next = [...this.timers].filter(t => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.time = next.at;
      this.timers.delete(next);
      next.callback();
    }
    this.time = target;
  }
  jumpWithoutTimers(ms) { this.time += ms; }
}
export function fakeAuthority() {
  const results = [];
  const signals = [];
  return {
    results, signals,
    verifier: {
      async verify(signal) {
        signals.push(signal);
        const result = results.shift() ?? { status: 'unknown' };
        return typeof result === 'function' ? result(signal) : result;
      },
    },
  };
}
export class FakeStorage {
  data = new Map();
  calls = [];
  gates = [];
  holdNext(method, failure = false) {
    const started = deferred(), release = deferred();
    this.gates.push({ method, started, release, failure });
    return { started: started.promise, release: release.resolve };
  }
  async wait(method, key) {
    this.calls.push({ method, key });
    const index = this.gates.findIndex(gate => gate.method === method);
    if (index < 0) return;
    const gate = this.gates.splice(index, 1)[0];
    gate.started.resolve();
    await gate.release.promise;
    if (gate.failure) throw new Error('fake backend private payload must not escape');
  }
  async getItem(key) {
    const snapshot = this.data.get(key) ?? null;
    await this.wait('getItem', key);
    return snapshot;
  }
  async setItem(key, value) {
    await this.wait('setItem', key);
    this.data.set(key, value);
  }
  async removeItem(key) {
    await this.wait('removeItem', key);
    this.data.delete(key);
  }
  async getAllKeys() {
    const snapshot = [...this.data.keys()];
    await this.wait('getAllKeys');
    return snapshot;
  }
}
