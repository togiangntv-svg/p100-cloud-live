import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw Error('NETWORK_FORBIDDEN'); };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'expo-file-system/legacy') return {
      url: 'data:text/javascript,export const cacheDirectory=null;export const getInfoAsync=async()=>{throw Error("UNINJECTED_FILESYSTEM")};export const deleteAsync=async()=>{throw Error("UNINJECTED_FILESYSTEM")}',
      shortCircuit: true,
    };
    return nextResolve(specifier, context);
  },
});

const at = path => new URL(path, import.meta.url);
const { createExpoCacheCleanup } = await import(at('../lib/camera/expo-cache-cleanup.ts'));
const { createExpoImagePreparer } = await import(at('../lib/camera/expo-image-preparer.ts'));
const cache = 'file:///app/cache/';
const owned = `${cache}ImageManipulator/prepared.jpg`;
const original = 'file:///app/photos/original.jpg';

function cleanupFixture(cacheDirectory, fail = false, info = { exists: true, isDirectory: false }) {
  const calls = [];
  const infoCalls = [];
  const filesystem = {
    cacheDirectory: arguments.length === 0 ? cache : cacheDirectory,
    async getInfoAsync(uri) {
      infoCalls.push(uri);
      if (info instanceof Error) throw info;
      return info;
    },
    async deleteAsync(uri, options) {
      calls.push({ uri, options });
      if (fail) throw Error('SYNTHETIC_DELETE_FAILURE');
    },
  };
  return { port: createExpoCacheCleanup(filesystem), calls, infoCalls };
}

test('valid child JPEG calls exact idempotent delete once', async () => {
  const h = cleanupFixture();
  assert.equal(h.port.canDeleteOwnedCache(owned), true);
  assert.equal(await h.port.deleteOwnedCache(owned), true);
  assert.deepEqual(h.infoCalls, [owned]);
  assert.deepEqual(h.calls, [{ uri: owned, options: { idempotent: true } }]);
});

test('real JPEG-named directory is rejected without a delete call', async () => {
  const h = cleanupFixture(cache, false, { exists: true, isDirectory: true });
  assert.equal(h.port.canDeleteOwnedCache(owned), true);
  assert.equal(await h.port.deleteOwnedCache(owned), false);
  assert.deepEqual(h.infoCalls, [owned]);
  assert.equal(h.calls.length, 0);
});

test('already missing child succeeds without a delete call', async () => {
  const h = cleanupFixture(cache, false, { exists: false, isDirectory: false });
  assert.equal(await h.port.deleteOwnedCache(`${cache}already-missing.jpg`), true);
  assert.deepEqual(h.infoCalls, [`${cache}already-missing.jpg`]);
  assert.equal(h.calls.length, 0);
});

test('metadata lookup error fails closed without a delete call', async () => {
  const h = cleanupFixture(cache, false, Error('SYNTHETIC_INFO_FAILURE'));
  assert.equal(await h.port.deleteOwnedCache(owned), false);
  assert.deepEqual(h.infoCalls, [owned]);
  assert.equal(h.calls.length, 0);
});

test('delete error returns false without exposing the URI', async () => {
  const h = cleanupFixture(cache, true);
  assert.equal(await h.port.deleteOwnedCache(owned), false);
  assert.deepEqual(h.infoCalls, [owned]);
  assert.equal(h.calls.length, 1);
});

for (const [name, uri] of [
  ['cache directory itself', cache],
  ['cache directory without trailing slash', cache.slice(0, -1)],
  ['child subdirectory', `${cache}ImageManipulator/`],
  ['directory-like JPEG target', `${cache}ImageManipulator/prepared.jpg/`],
  ['child path with no JPEG file leaf', `${cache}ImageManipulator`],
  ['raw traversal', `${cache}../outside.jpg`],
  ['encoded traversal', `${cache}%2e%2e/outside.jpg`],
  ['double-encoded traversal', `${cache}%252e%252e/outside.jpg`],
  ['encoded slash', `${cache}other%2foutside.jpg`],
  ['outside cache', 'file:///app/other/outside.jpg'],
  ['cache prefix collision', 'file:///app/cache-other/outside.jpg'],
  ['document directory', 'file:///app/documents/photo.jpg'],
  ['content URI', 'content://provider/photo.jpg'],
  ['photo-library URI', 'ph://photo.jpg'],
  ['assets-library URI', 'assets-library://photo.jpg'],
  ['blob URI', 'blob://photo.jpg'],
  ['HTTP URI', 'https://example.invalid/photo.jpg'],
]) {
  test(`${name} is rejected before any delete call`, async () => {
    const h = cleanupFixture();
    assert.equal(h.port.canDeleteOwnedCache(uri), false);
    assert.equal(await h.port.deleteOwnedCache(uri), false);
    assert.equal(h.infoCalls.length, 0);
    assert.equal(h.calls.length, 0);
  });
}

test('unavailable or non-file cache root blocks deletion', async () => {
  for (const value of [null, undefined, 'content://cache/', 'file:///app/cache/../photos/']) {
    const h = cleanupFixture(value);
    assert.equal(h.port.canDeleteOwnedCache(), false);
    assert.equal(await h.port.deleteOwnedCache(owned), false);
    assert.equal(h.infoCalls.length, 0);
    assert.equal(h.calls.length, 0);
  }
});

test('cacheDirectory access error fails closed without deletion', async () => {
  let deletes = 0;
  const port = createExpoCacheCleanup({
    get cacheDirectory() { throw Error('CACHE_DIRECTORY_UNAVAILABLE'); },
    async getInfoAsync() { throw Error('INFO_MUST_NOT_RUN'); },
    async deleteAsync() { deletes++; },
  });
  assert.equal(port.canDeleteOwnedCache(), false);
  assert.equal(await port.deleteOwnedCache(owned), false);
  assert.equal(deletes, 0);
});

const scope = Object.freeze({ session_id: 'session-a', task_id: 'task-a', revision: 1 });
const c1 = Object.freeze({ ...scope, context_id: 'context-a', candidate_id: 'candidate-a',
  permission_revision: 1 });
const consent = Object.freeze({ consent_revision: 1 });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function preparationFixture(savedUri = owned, saveGate, cacheDirectory = cache, sourceUri = original) {
  const cleanup = cleanupFixture(cacheDirectory);
  let saves = 0;
  const runtime = {
    SaveFormat: { JPEG: 'jpeg' },
    ImageManipulator: { manipulate() {
      return { async renderAsync() {
        return { width: 800, height: 600, async saveAsync() {
          saves++;
          if (saveGate) await saveGate.promise;
          return { uri: savedUri, width: 800, height: 600 };
        } };
      } };
    } },
  };
  const preparer = createExpoImagePreparer(runtime, cleanup.port);
  assert.equal(preparer.bind(scope), true);
  const receipt = Object.freeze({ ...scope, candidate_id: 'candidate-a', source: 'CAMERA',
    local_uri: sourceUri, choice: 'USE_PHOTO' });
  const source = preparer.bindAcceptedPhoto(receipt);
  assert.ok(source);
  const request = { source, c1_context: c1, consent };
  return { preparer, request, calls: cleanup.calls, get saves() { return saves; } };
}

test('cache root unavailable blocks before saveAsync', async () => {
  const h = preparationFixture(owned, undefined, null);
  assert.equal(h.preparer.nativeCleanupAvailable, false);
  await assert.rejects(h.preparer.port.prepare(h.request), /BLOCKED_NATIVE_CLEANUP/);
  assert.equal(h.saves, 0);
});

test('saveAsync URI outside cache cannot publish an artifact or be deleted', async () => {
  const h = preparationFixture('file:///app/documents/not-owned.jpg');
  await assert.rejects(h.preparer.port.prepare(h.request), /UNOWNED_LOCAL_CACHE_RESULT/);
  assert.equal(h.preparer.cleanupStatus().failed, true);
  assert.equal(h.calls.length, 0);
});

test('original photo URI is never deleted, even if saveAsync returns it', async () => {
  const originalInCache = `${cache}original.jpg`;
  const h = preparationFixture(originalInCache, undefined, cache, originalInCache);
  await assert.rejects(h.preparer.port.prepare(h.request), /ORIGINAL_IMAGE_NOT_REENCODED/);
  h.preparer.retire();
  assert.equal(h.preparer.cleanupStatus().failed, true);
  assert.equal(h.calls.length, 0);
});

test('late save after retirement cleans only its exact generated cache file', async () => {
  const gate = deferred();
  const h = preparationFixture(owned, gate);
  const pending = h.preparer.port.prepare(h.request);
  for (let i = 0; i < 20 && h.saves === 0; i++) await new Promise(done => setImmediate(done));
  assert.equal(h.saves, 1);
  h.preparer.retire();
  gate.resolve();
  await assert.rejects(pending, /SUPERSEDED/);
  assert.equal(await h.preparer.settleCleanup(), true);
  assert.deepEqual(h.calls, [{ uri: owned, options: { idempotent: true } }]);
  assert.equal(h.calls.some(call => call.uri === original), false);
});

test('retiring A leaves B generated artifact untouched', async () => {
  const a = preparationFixture(`${cache}A.jpg`);
  await a.preparer.port.prepare(a.request);
  a.preparer.retire();
  assert.equal(await a.preparer.settleCleanup(), true);
  const b = preparationFixture(`${cache}B.jpg`);
  const descriptorB = await b.preparer.port.prepare(b.request);
  assert.equal(b.preparer.port.resolvePrivate(descriptorB), `${cache}B.jpg`);
  assert.deepEqual(a.calls.map(call => call.uri), [`${cache}A.jpg`]);
  assert.equal(b.calls.length, 0);
});

test('delete failure after retirement remains a truthful failed cleanup', async () => {
  const h = cleanupFixture(cache, true);
  const runtime = { SaveFormat: { JPEG: 'jpeg' }, ImageManipulator: { manipulate() {
    return { async renderAsync() { return { width: 800, height: 600,
      async saveAsync() { return { uri: owned, width: 800, height: 600 }; },
    }; } };
  } } };
  const preparer = createExpoImagePreparer(runtime, h.port);
  preparer.bind(scope);
  const source = preparer.bindAcceptedPhoto(Object.freeze({ ...scope, candidate_id: 'candidate-a',
    source: 'CAMERA', local_uri: original, choice: 'USE_PHOTO' }));
  await preparer.port.prepare({ source, c1_context: c1, consent });
  preparer.retire();
  assert.equal(await preparer.settleCleanup(), false);
  assert.equal(preparer.cleanupStatus().failed, true);
});

test('production source uses legacy deleteAsync and no broad deletion primitive', async () => {
  const adapter = await readFile(at('../lib/camera/expo-cache-cleanup.ts'), 'utf8');
  const host = await readFile(at('../components/useM2Gateway.ts'), 'utf8');
  assert.match(adapter, /import \* as FileSystem from 'expo-file-system\/legacy'/);
  assert.match(adapter, /filesystem\.deleteAsync\(uri, \{ idempotent: true \}\)/);
  assert.match(adapter, /filesystem\.getInfoAsync\(uri\)/);
  assert.doesNotMatch(adapter, /from 'expo-file-system'/);
  assert.doesNotMatch(adapter + host, /deleteDirectory|deleteRecursive|readDirectory|uploadAsync|fetch\(/);
  assert.match(host, /cleanup: createExpoCacheCleanup\(\)/);
  assert.equal(networkCalls, 0);
});
