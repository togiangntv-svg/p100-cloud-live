import type { DevelopmentContextValue, DevelopmentOwnerBinding } from '../../context/development-owner/store';
import { initialState, serializeState } from '../../domain/gate7';
import { createRuntimeLeaseBridge } from '../interaction-runtime/bridge';
import { isRuntimeTestEnabled } from '../interaction-runtime/gate';
import { syntheticStorage as storage, fixtureKey, legacyKey } from './fake-storage';

export type ProbePort = { current: { value: DevelopmentContextValue; generation: number } | undefined };
type Bridge = ReturnType<typeof createRuntimeLeaseBridge>;
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 10));
function check(value: unknown, name: string): asserts value {
  if (!value) throw new Error('CHECK: ' + name);
}
async function until(predicate: () => boolean, name: string) {
  for (let i = 0; i < 500; i++) { if (predicate()) return; await tick(); }
  throw new Error('CHECK: timeout ' + name);
}
export async function runScenarios(bridge: Bridge, port: ProbePort,
  override: (binding: DevelopmentOwnerBinding | undefined) => void) {
  check(isRuntimeTestEnabled(), 'gate required');
  const results: string[] = [];
  const pass = (name: string) => results.push(name);
  const value = () => { check(port.current, 'actual provider mounted'); return port.current.value; };
  const idle = async () => {
    await tick(); // Wait for the actual React commit, not the previous ready probe snapshot.
    await until(() => Boolean(port.current
      && port.current.generation === bridge.getSnapshot().generation && port.current.value.hydrated
      && port.current.value.persistenceStatus === 'ready'), 'current owner hydration/persistence');
    await tick();
  };
  const locked = () => until(() => Boolean(port.current && !port.current.value.hydrated
    && port.current.value.state.reviewNote === '' && port.current.value.state.inferenceCorrection === null
    && port.current.value.decisionBundle.recommendation === null), 'private state retired');
  const select = async (label: 'A' | 'B') => {
    check(await bridge.select(label), 'synthetic lease issued'); await idle();
    return bridge.getSnapshot().generation;
  };
  const write = async (note: string) => { value().recordOutcome(note); await idle(); };
  const noteOnDisk = (label: 'A' | 'B') => {
    const raw = storage.inspect(fixtureKey(label));
    if (raw === null) return null;
    const envelope = JSON.parse(raw);
    check(envelope.owner.subjectId === 'test-subject-' + label.toLowerCase()
      && envelope.owner.profileId === 'test-profile-' + label.toLowerCase(), 'persisted owner envelope');
    return JSON.parse(envelope.value).state.reviewNote;
  };
  await locked();
  check(bridge.getSnapshot().phase === 'LOCKED' && storage.calls.length === 0, 'startup no stored authority/read');
  pass('Startup mounted provider LOCKED; no storage read');
  const legacy = serializeState({ ...initialState, reviewNote: 'SYNTHETIC LEGACY UNOWNED', outcomeRecorded: true });
  storage.seed(legacyKey, legacy);
  storage.seed(fixtureKey('A', 'interaction-deleted-at'), 'SYNTHETIC A MARKER');
  storage.seed(fixtureKey('B', 'interaction-deleted-at'), 'SYNTHETIC B MARKER');

  const aGeneration = await select('A');
  check(value().state.reviewNote === '', 'legacy not imported');
  await write('SYNTHETIC A DEVELOPMENT');
  const oldA = value();
  check(noteOnDisk('A') === 'SYNTHETIC A DEVELOPMENT' && storage.inspect(fixtureKey('B')) === null,
    'A persists only A');
  pass('A mutation/persistence via actual provider only in A namespace');
  bridge.invalidate(); await locked();
  pass('Invalidation retires rendered A content');
  const bGeneration = await select('B');
  check(value().state.reviewNote === '' && value().state.inferenceCorrection === null, 'B starts with ZERO A content');
  await write('SYNTHETIC B DEVELOPMENT');
  const count = storage.calls.length;
  oldA.recordOutcome('SYNTHETIC STALE A');
  check(await oldA.resetLocalState() === false, 'old A reset rejected'); await tick();
  check(storage.calls.length === count && value().state.reviewNote === 'SYNTHETIC B DEVELOPMENT', 'old A callbacks rejected in B');
  pass('B has zero A content; B writes distinct data; old A callbacks rejected');
  bridge.invalidate(); await locked();
  const aReturn = await select('A');
  check(aReturn > bGeneration && bGeneration > aGeneration, 'new generation each session');
  check(value().state.reviewNote === 'SYNTHETIC A DEVELOPMENT' && noteOnDisk('B') === 'SYNTHETIC B DEVELOPMENT', 'A restores only A');
  oldA.recordOutcome('SYNTHETIC OLD GENERATION');
  check(await oldA.resetLocalState() === false, 'same owner old reset rejected'); await tick();
  check(value().state.reviewNote === 'SYNTHETIC A DEVELOPMENT', 'same subject new generation rejects old action');
  pass('A→B→A generations ' + aGeneration + '→' + bGeneration + '→' + aReturn + '; only A restored');

  const read = storage.holdNext('getItem');
  check(await bridge.select('A'), 'new A lease for held read'); await read.started;
  await select('B'); const beforeRead = JSON.stringify(value().state);
  read.release(); await tick(); await tick();
  check(JSON.stringify(value().state) === beforeRead && value().state.reviewNote === 'SYNTHETIC B DEVELOPMENT', 'late A read cannot publish to B');
  pass('Late A hydration discarded after B starts');

  await select('A');
  const writeHold = storage.holdNext('setItem');
  value().recordOutcome('SYNTHETIC LATE A WRITE'); await writeHold.started;
  await select('B'); await write('SYNTHETIC CURRENT B');
  const bRaw = storage.inspect(fixtureKey('B')), bRam = JSON.stringify(value().state);
  writeHold.release();
  await until(() => storage.inspect(fixtureKey('A')) === null, 'sealed stale A write cleanup');
  check(storage.inspect(fixtureKey('B')) === bRaw && JSON.stringify(value().state) === bRam
    && value().persistenceStatus === 'ready', 'late A write leaves B RAM/storage/status unchanged');
  check(storage.calls.some(call => call.method === 'removeItem' && call.key === fixtureKey('A')), 'cleanup captured A key');
  pass('Late A write cleaned only A; B storage/RAM/status unchanged');
  await select('A'); await write('SYNTHETIC A AFTER CLEANUP');
  check(noteOnDisk('A') === 'SYNTHETIC A AFTER CLEANUP', 'stale cleanup queue permits fresh A');
  pass('Sealed cleanup barrier admits a fresh A generation after stale write');

  const resetOld = value();
  check(await value().resetLocalState(), 'current A reset succeeds'); await idle();
  check(storage.inspect(fixtureKey('A')) === null && storage.inspect(fixtureKey('B')) === bRaw, 'reset A never B');
  check(storage.inspect(fixtureKey('A', 'interaction-deleted-at')) === 'SYNTHETIC A MARKER'
    && storage.inspect(fixtureKey('B', 'interaction-deleted-at')) === 'SYNTHETIC B MARKER', 'reset preserves interaction markers');
  check(bridge.getSnapshot().phase === 'READY', 'reset is not logout');
  resetOld.recordOutcome('SYNTHETIC PRE RESET');
  check(await resetOld.resetLocalState() === false, 'pre-reset callbacks retired'); await tick();
  check(storage.inspect(fixtureKey('A')) === null, 'old callback cannot recreate after reset');
  pass('A reset only Development; B and Interaction markers unchanged; session stays READY');

  await select('A'); // Hydrate genuinely absent owned key.
  const absent = JSON.stringify({ state: value().state, bundle: value().decisionBundle });
  bridge.invalidate(); await locked();
  const nullEnvelope = JSON.stringify({ schemaVersion: 1,
    owner: { subjectId: 'test-subject-a', profileId: 'test-profile-a' }, value: null });
  storage.seed(fixtureKey('A'), nullEnvelope);
  await select('A');
  check(JSON.stringify({ state: value().state, bundle: value().decisionBundle }) === absent, 'null equals absent current Development semantics');
  check(storage.inspect(fixtureKey('A')) === nullEnvelope && value().state.reviewNote === '', 'null hydration does not overwrite or import');
  await write('SYNTHETIC AFTER NULL');
  check(noteOnDisk('A') === 'SYNTHETIC AFTER NULL', 'valid current action persists after null');
  pass('Absent and value:null yield identical empty/demo state; no import/overwrite; explicit action remains valid');

  const real = bridge.getSnapshot().binding;
  check(real, 'binding present');
  const copied = { ...real, lease: { ...real.lease } };
  override(copied); await locked();
  const copiedCount = storage.calls.length;
  value().recordOutcome('SYNTHETIC COPIED LEASE');
  check(await value().resetLocalState() === false, 'copied lease reset rejected'); await tick();
  check(storage.calls.length === copiedCount, 'copied lease cannot read/write');
  override(undefined); await idle();
  pass('Copied/fake lease rejected by actual provider; valid binding restores');
  check(await bridge.select({ subjectId: 'test-subject-a', profileId: 'test-profile-a' }) === false, 'malformed caller owner rejected');
  await locked();
  let staleRejected = false;
  try { real.access.requireLease(real.lease); } catch { staleRejected = true; }
  check(staleRejected, 'old lease rejected by boundary');
  pass('Malformed owner leaves mounted provider LOCKED; stale lease rejected');

  await select('A');
  const failure = storage.holdNext('setItem', true);
  value().recordOutcome('SYNTHETIC FAILED A WRITE'); await failure.started;
  await select('B'); const safeB = storage.inspect(fixtureKey('B'));
  failure.release(); await tick(); await tick();
  check(storage.inspect(fixtureKey('B')) === safeB && value().persistenceStatus === 'ready', 'A IO failure cannot lock B');
  check(await bridge.select('A'), 'new A authority still valid');
  await until(() => Boolean(port.current && port.current.generation === bridge.getSnapshot().generation
    && value().hydrated && value().persistenceStatus === 'error'), 'quarantined A fails closed');
  check(value().state.reviewNote === '' && value().decisionBundle.recommendation === null, 'quarantine no private data/recommendation');
  check(await value().resetLocalState() === false, 'no broad quarantine recovery');
  check(storage.inspect(fixtureKey('B')) === safeB
    && storage.inspect(fixtureKey('A', 'interaction-deleted-at')) === 'SYNTHETIC A MARKER', 'quarantine preserves B/markers');
  pass('A IO failure quarantines only A; fresh A fails closed; B/markers remain intact');

  check(storage.inspect(legacyKey) === legacy && !storage.calls.some(call => call.key === legacyKey), 'legacy never accessed');
  check(storage.calls.every(call => call.key === fixtureKey('A') || call.key === fixtureKey('B')), 'provider operations limited to Development slots');
  pass('Legacy sentinel byte-identical; no global fallback or marker operation');
  return results;
}
