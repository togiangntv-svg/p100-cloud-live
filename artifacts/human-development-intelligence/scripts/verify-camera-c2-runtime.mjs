import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw Error('NETWORK_FORBIDDEN'); };
const at = path => new URL(path, import.meta.url);
const { createCameraC2RuntimeController } = await import(at('../lib/camera/c2-runtime.ts'));
const { createMealExternalConsentStore, validateMealVisionRequest } =
  await import(at('../domain/camera/meal-vision.ts'));
const { cameraC2Messages } = await import(at('../i18n-task.ts'));
const source = async path => readFile(at(path), 'utf8');
const scope = Object.freeze({ session_id: 'session-a', task_id: 'task-a', revision: 1 });
const accepted = Object.freeze({ ...scope, candidate_id: 'photo-a', source: 'CAMERA',
  local_uri: 'file:///original.jpg', choice: 'USE_PHOTO' });
const c1 = Object.freeze({ ...scope, context_id: 'context-a', candidate_id: 'photo-a',
  permission_revision: 2, external_readiness: 'LOCAL_ONLY' });
const projection = Object.freeze({ scope, image: Object.freeze({ state: 'present', id: 'context-a',
  usable: true, permission_revision: 2 }), permission: Object.freeze({ purpose: 'meal_image_assessment',
  status: 'allowed', revision: 2 }), boundary: 'within_slice' });
const ownerScope = Object.freeze({ owner: Object.freeze({ subjectId: 'subject-a', profileId: 'profile-a' }),
  generation: 1, validUntil: Date.now() + 60_000 });
function ownerFixture() {
  let ready = true;
  const lease = Object.freeze({});
  const access = Object.freeze({
    getSnapshot: () => ready ? { phase: 'READY', ...ownerScope } : { phase: 'LOCKED', generation: 2 },
    requireLease: (candidate) => {
      if (!ready || candidate !== lease) throw Error('STALE_LEASE');
      return ownerScope;
    },
  });
  return { binding: Object.freeze({ access, lease, subject_id: 'subject-a' }),
    retire: () => { ready = false; } };
}
const owner = ownerFixture();
const actionSource = Object.freeze({ identity: Object.freeze({}), current: () => Object.freeze({
  ...scope, safety_revision: 0, safety_state: 'OPEN', availability: 'AVAILABLE',
}) });
const live = Object.freeze({ owner: owner.binding, accepted, c1, projection,
  actionSource, safety_revision: 0, m4_sufficient: true });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function fixture({ saveGate, deleteResult = true, failFirstSave = false, malformedFirst = false } = {}) {
  const currentOwner = ownerFixture();
  let current;
  let safetyState = 'OPEN', safetyRevision = 0;
  const fixtureActionSource = Object.freeze({ identity: Object.freeze({}), current: () => current
    ? Object.freeze({ session_id: current.accepted.session_id, task_id: current.accepted.task_id,
      revision: current.accepted.revision, safety_revision: safetyRevision,
      safety_state: safetyState, availability: safetyState === 'OPEN' ? 'AVAILABLE' : 'SAFETY_HOLD' })
    : undefined });
  current = { ...live, owner: currentOwner.binding, actionSource: fixtureActionSource };
  let nextId = 0;
  const calls = { save: [], deleted: [], resize: [], render: 0 };
  const image = (width, height) => ({ width, height,
    async saveAsync(options) {
      calls.save.push(options);
      if (saveGate && calls.save.length === 1) await saveGate.promise;
      if (failFirstSave && calls.save.length === 1) throw Error('SYNTHETIC_SAVE_FAILURE');
      return { uri: `file:///cache/prepared-${++nextId}.jpg`,
        width: malformedFirst && calls.save.length === 1 ? 2048 : width, height };
    } });
  const runtime = {
    SaveFormat: { JPEG: 'jpeg' },
    ImageManipulator: { manipulate(input) {
      const initial = typeof input === 'string' ? { width: 1600, height: 800 } : input;
      let size;
      return {
        resize(next) { size = next; calls.resize.push(next); return this; },
        async renderAsync() {
          calls.render++;
          return size ? image(size.width ?? 1280, size.height ?? 640)
            : image(initial.width, initial.height);
        },
      };
    } },
  };
  const cleanup = { async deleteOwnedCache(uri) {
    calls.deleted.push(uri);
    return deleteResult;
  } };
  const controller = createCameraC2RuntimeController({ getLive: () => current, runtime, cleanup });
  return { controller, calls, owner: currentOwner,
    setSafety: (state) => { safetyState = state; safetyRevision += 1; },
    setLive: value => { current = value ? { ...value,
      actionSource: value.actionSource === actionSource ? fixtureActionSource
        : 'actionSource' in value ? value.actionSource : fixtureActionSource,
      safety_revision: value.safety_revision ?? safetyRevision } : undefined; },
    replaceOwner: binding => { current = { ...current, owner: binding }; } };
}

test('verified owner permits C2 consent; UI DTO has no private material', () => {
  const h = fixture();
  const view = h.controller.view();
  assert.equal(view.state, 'CONSENT_REQUIRED');
  assert.equal(view.external_consent, 'OFF');
  assert.equal(view.external_transfer, 'NOT_SENT');
  assert.equal(h.calls.save.length, 0);
  assert.deepEqual(Object.keys(view).sort(), ['external_consent', 'external_transfer', 'state', 'view_token']);
  assert.doesNotMatch(JSON.stringify(view), /session-a|task-a|photo-a|context-a|file:|uri|base64|bytes/i);
});

test('ownerless C0/C1/M4 cannot grant C2 consent or preparation', async () => {
  const h = fixture();
  h.setLive({ ...live, owner: undefined });
  const view = h.controller.view();
  assert.equal(view.state, 'UNAVAILABLE');
  assert.equal(view.external_consent, 'OFF');
  assert.equal(await h.controller.allowExternalProcessingAndPrepare(view.view_token), false);
  assert.equal(h.calls.save.length, 0);
});

test('missing action source fails closed before C2 consent', async () => {
  const h = fixture();
  h.setLive({ ...live, actionSource: undefined });
  const view = h.controller.view();
  assert.equal(view.state, 'UNAVAILABLE');
  assert.equal(await h.controller.allowExternalProcessingAndPrepare(view.view_token), false);
  assert.equal(h.calls.save.length, 0);
});

test('raw C2 receipt cannot survive Safety HOLD or same-looking OPEN at a new revision', async () => {
  const h = fixture();
  assert.equal(await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token), true);
  const receipt = h.controller.currentReceipt();
  assert.equal(h.controller.isCurrentReceipt(receipt), true);
  h.setSafety('HOLD');
  assert.equal(h.controller.isCurrentReceipt(receipt), false);
  assert.equal(h.controller.currentReceipt(), undefined);
  assert.equal(h.controller.view().external_consent, 'OFF');
  assert.equal(await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token), false);
  h.setSafety('OPEN');
  assert.equal(h.controller.isCurrentReceipt(receipt), false);
  assert.equal(h.controller.currentReceipt(), undefined);
  assert.equal(await h.controller.settleCleanup(), true);
  assert.equal(h.calls.deleted.length, 1);
  assert.equal(networkCalls, 0);
});

test('access and lease replacement invalidate old receipt despite identical public owner IDs', async () => {
  for (const binding of [ownerFixture().binding,
    { ...owner.binding, lease: Object.freeze({}) }]) {
    const h = fixture();
    assert.equal(await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token), true);
    const old = h.controller.currentReceipt();
    h.replaceOwner(binding);
    assert.equal(h.controller.isCurrentReceipt(old), false);
    assert.equal(h.controller.currentReceipt(), undefined);
    assert.equal(h.controller.view().external_consent, 'OFF');
  }
});

test('owner loss after preparation immediately retires consent and receipt', async () => {
  const h = fixture();
  assert.equal(await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token), true);
  const receipt = h.controller.currentReceipt();
  h.owner.retire();
  assert.equal(h.controller.view().state, 'UNAVAILABLE');
  assert.equal(h.controller.view().external_consent, 'OFF');
  assert.equal(h.controller.isCurrentReceipt(receipt), false);
  assert.equal(h.controller.currentReceipt(), undefined);
});

test('access or lease replacement during native preparation blocks late publication', async () => {
  for (const binding of [ownerFixture().binding,
    { ...owner.binding, lease: Object.freeze({}) }]) {
    const gate = deferred();
    const h = fixture({ saveGate: gate });
    const pending = h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token);
    for (let i = 0; i < 20 && h.calls.save.length === 0; i++) {
      await new Promise(done => setImmediate(done));
    }
    assert.equal(h.calls.save.length, 1);
    h.replaceOwner(binding);
    assert.equal(h.controller.view().external_consent, 'OFF');
    gate.resolve();
    assert.equal(await pending, false);
    assert.equal(h.controller.currentReceipt(), undefined);
    await h.controller.settleCleanup();
    assert.deepEqual(h.calls.deleted, ['file:///cache/prepared-1.jpg']);
  }
});

test('C1 unknown/denied and insufficient M4 cannot grant or prepare', async () => {
  for (const modified of [
    { ...live, projection: { ...projection, permission: { ...projection.permission, status: 'unknown' } } },
    { ...live, projection: { ...projection, permission: { ...projection.permission, status: 'denied' } } },
    { ...live, m4_sufficient: false },
  ]) {
    const h = fixture(); h.setLive(modified);
    assert.equal(h.controller.view().state, 'UNAVAILABLE');
    assert.equal(await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token), false);
    assert.equal(h.calls.save.length, 0);
  }
});

test('one explicit grant prepares once; double tap and stale token are inert', async () => {
  const h = fixture();
  const token = h.controller.view().view_token;
  const first = h.controller.allowExternalProcessingAndPrepare(token);
  assert.equal(await h.controller.allowExternalProcessingAndPrepare(token), false);
  assert.equal(await first, true, JSON.stringify({ view: h.controller.view(), calls: h.calls }));
  const view = h.controller.view();
  assert.equal(view.state, 'PREPARED_NOT_SENT');
  assert.equal(view.external_consent, 'ON');
  assert.equal(view.external_transfer, 'NOT_SENT');
  assert.equal(h.calls.save.length, 1);
  assert.deepEqual(h.calls.save[0], { format: 'jpeg', compress: 0.8, base64: false });
  assert.deepEqual(h.calls.resize, [{ width: 1280 }]);
  const receipt = h.controller.currentReceipt();
  assert.equal(receipt.kind, 'MEAL_IMAGE_PREPARATION_RECEIPT');
  assert.equal(receipt.version, 1);
  assert.equal(receipt.state, 'PREPARED_NOT_SENT');
  assert.equal(receipt.artifact.width, 1280);
  assert.equal(receipt.artifact.height, 640);
  assert.equal(receipt.artifact.consent_revision, 1);
  assert.equal(h.controller.isCurrentReceipt(receipt), true);
  assert.equal(h.controller.isCurrentReceipt({ ...receipt }), false);
  assert.equal(h.controller.isCurrentReceipt(JSON.parse(JSON.stringify(receipt))), false);
  assert.equal(await h.controller.retryLocalPreparation(token), false);
});

test('decline preserves C1 and grants no C2', () => {
  const h = fixture();
  assert.equal(h.controller.declineExternalProcessing(h.controller.view().view_token), true);
  assert.equal(h.controller.view().state, 'LOCAL_ONLY_DECLINED');
  assert.equal(h.controller.view().external_consent, 'OFF');
  assert.equal(h.calls.save.length, 0);
  assert.equal(live.projection.permission.status, 'allowed');
});

test('forged or stale view token cannot consent, decline or retry', async () => {
  const h = fixture();
  const old = h.controller.view().view_token;
  assert.equal(await h.controller.allowExternalProcessingAndPrepare(Object.freeze({})), false);
  assert.equal(h.controller.declineExternalProcessing(Object.freeze({})), false);
  assert.equal(h.controller.declineExternalProcessing(old), true);
  assert.equal(await h.controller.allowExternalProcessingAndPrepare(old), false);
  assert.equal(await h.controller.retryLocalPreparation(old), false);
  assert.equal(h.calls.save.length, 0);
});

test('declining after preparation removes C2 but leaves local C1 context', async () => {
  const h = fixture();
  await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token);
  const old = h.controller.currentReceipt();
  assert.equal(h.controller.declineExternalProcessing(h.controller.view().view_token), true);
  assert.equal(h.controller.isCurrentReceipt(old), false);
  assert.equal(h.controller.view().external_consent, 'OFF');
  assert.equal(live.projection.permission.status, 'allowed');
});

test('revoke kills receipt immediately; regrant has a new revision and exact cleanup', async () => {
  const h = fixture();
  assert.equal(await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token), true);
  const old = h.controller.currentReceipt();
  assert.equal(h.controller.revokeExternalProcessing(h.controller.view().view_token), true);
  assert.equal(h.controller.isCurrentReceipt(old), false);
  assert.equal(h.controller.currentReceipt(), undefined);
  assert.equal(await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token), true);
  const next = h.controller.currentReceipt();
  assert.equal(next.artifact.consent_revision > old.artifact.consent_revision, true);
  assert.equal(h.controller.isCurrentReceipt(old), false);
  assert.equal(h.controller.isCurrentReceipt(next), true);
  assert.deepEqual(h.calls.deleted, ['file:///cache/prepared-1.jpg']);
  assert.ok(!h.calls.deleted.includes('file:///original.jpg'));
});

test('C1 permission revision change or owner loss invalidates without regrant', async () => {
  const h = fixture();
  await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token);
  const old = h.controller.currentReceipt();
  h.setLive({ ...live, c1: { ...c1, permission_revision: 3 },
    projection: { ...projection, image: { ...projection.image, permission_revision: 3 },
      permission: { ...projection.permission, revision: 3 } } });
  assert.equal(h.controller.isCurrentReceipt(old), false);
  assert.equal(h.controller.view().external_consent, 'OFF');
  h.setLive(undefined);
  assert.equal(h.controller.view().state, 'UNAVAILABLE');
});

test('C1 revoke after preparation immediately makes the old artifact unusable', async () => {
  const h = fixture();
  await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token);
  const old = h.controller.currentReceipt();
  h.setLive({ ...live, projection: { ...projection,
    permission: { ...projection.permission, status: 'denied', revision: 3 },
    image: { ...projection.image, permission_revision: 3 } },
    c1: { ...c1, permission_revision: 3 } });
  assert.equal(h.controller.isCurrentReceipt(old), false);
  assert.equal(h.controller.view().state, 'UNAVAILABLE');
  assert.equal(h.controller.currentReceipt(), undefined);
});

test('C1 context replacement with same photo does not retain old C2', async () => {
  const h = fixture();
  await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token);
  const old = h.controller.currentReceipt();
  h.setLive({ ...live, c1: { ...c1, context_id: 'context-b' },
    projection: { ...projection, image: { ...projection.image, id: 'context-b' } } });
  assert.equal(h.controller.isCurrentReceipt(old), false);
  assert.equal(h.controller.view().external_consent, 'OFF');
});

test('task revision change cannot reuse local preparation authority', async () => {
  const h = fixture();
  await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token);
  const old = h.controller.currentReceipt();
  const nextScope = { ...scope, revision: 2 };
  h.setLive({ accepted: { ...accepted, revision: 2 },
    owner: h.owner.binding, c1: { ...c1, revision: 2 }, projection: { ...projection, scope: nextScope },
    m4_sufficient: true });
  assert.equal(h.controller.isCurrentReceipt(old), false);
  assert.equal(h.controller.view().state, 'CONSENT_REQUIRED');
});

test('task switch cannot reuse old preparation even with unchanged image URI', async () => {
  const h = fixture();
  await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token);
  const old = h.controller.currentReceipt();
  const nextScope = { ...scope, task_id: 'task-b' };
  h.setLive({ accepted: { ...accepted, task_id: 'task-b' },
    owner: h.owner.binding, c1: { ...c1, task_id: 'task-b' }, projection: { ...projection, scope: nextScope },
    m4_sufficient: true });
  assert.equal(h.controller.isCurrentReceipt(old), false);
  assert.equal(h.controller.view().external_consent, 'OFF');
});

test('same-looking URI replacement is a new C0 receipt and cannot reuse old C2', async () => {
  const h = fixture();
  await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token);
  const old = h.controller.currentReceipt();
  h.setLive({ ...live, accepted: Object.freeze({ ...accepted }) });
  assert.equal(h.controller.isCurrentReceipt(old), false);
  assert.equal(h.controller.view().external_consent, 'OFF');
  assert.equal(h.controller.currentReceipt(), undefined);
  assert.equal(h.controller.view().state, 'CONSENT_REQUIRED');
});

test('rerender and locale copy lookup have no consent or preparation effect', () => {
  const h = fixture();
  const token = h.controller.view().view_token;
  for (const locale of Object.keys(cameraC2Messages)) {
    assert.ok(cameraC2Messages[locale].ask);
    assert.equal(h.controller.view().view_token, token);
  }
  assert.equal(h.controller.view().external_consent, 'OFF');
  assert.equal(h.calls.save.length, 0);
});

test('late save after revoke is cleaned and cannot recreate receipt', async () => {
  const gate = deferred();
  const h = fixture({ saveGate: gate });
  const task = h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token);
  for (let i = 0; i < 20 && h.calls.save.length === 0; i++) {
    await new Promise(done => setImmediate(done));
  }
  assert.equal(h.calls.save.length, 1);
  assert.equal(h.controller.revokeExternalProcessing(h.controller.view().view_token), true);
  gate.resolve();
  assert.equal(await task, false);
  assert.equal(h.controller.currentReceipt(), undefined);
  await h.controller.settleCleanup();
  assert.deepEqual(h.calls.deleted, ['file:///cache/prepared-1.jpg']);
});

test('owner loss during pending native result cannot publish receipt', async () => {
  const gate = deferred(); const h = fixture({ saveGate: gate });
  const pending = h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token);
  for (let i = 0; i < 20 && h.calls.save.length === 0; i++) await new Promise(done => setImmediate(done));
  assert.equal(h.calls.save.length, 1);
  h.owner.retire();
  assert.equal(h.controller.view().state, 'UNAVAILABLE');
  gate.resolve();
  assert.equal(await pending, false);
  assert.equal(h.controller.currentReceipt(), undefined);
  await h.controller.settleCleanup();
  assert.deepEqual(h.calls.deleted, ['file:///cache/prepared-1.jpg']);
});

test('late A cleanup completes before B can prepare; B artifact survives', async () => {
  const gate = deferred();
  const h = fixture({ saveGate: gate });
  const a = h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token);
  for (let i = 0; i < 20 && h.calls.save.length === 0; i++) {
    await new Promise(done => setImmediate(done));
  }
  assert.equal(h.calls.save.length, 1);
  assert.equal(h.controller.revokeExternalProcessing(h.controller.view().view_token), true);
  const b = h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token);
  assert.equal(h.calls.save.length, 1);
  gate.resolve();
  assert.equal(await a, false);
  assert.equal(await b, true);
  assert.deepEqual(h.calls.deleted, ['file:///cache/prepared-1.jpg']);
  assert.equal(h.controller.currentReceipt().artifact.prepared_image_id,
    'camera-reencoded-local-1');
  assert.equal(h.controller.isCurrentReceipt(h.controller.currentReceipt()), true);
});

test('retry after save failure does not renew C2 consent', async () => {
  const h = fixture({ failFirstSave: true });
  assert.equal(await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token), false);
  assert.equal(h.controller.view().state, 'BLOCKED');
  assert.equal(h.controller.currentReceipt(), undefined);
  assert.equal(await h.controller.retryLocalPreparation(h.controller.view().view_token), true);
  assert.equal(h.calls.save.length, 2);
  assert.equal(h.controller.currentReceipt().artifact.consent_revision, 1);
});

test('malformed save result creates no receipt and retires exact cache output', async () => {
  const h = fixture({ malformedFirst: true });
  assert.equal(await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token), false);
  assert.equal(h.controller.currentReceipt(), undefined);
  await h.controller.settleCleanup();
  assert.deepEqual(h.calls.deleted, ['file:///cache/prepared-1.jpg']);
  assert.equal(h.controller.view().external_transfer, 'NOT_SENT');
});

test('runtime replacement with identical public IDs cannot inherit a receipt', async () => {
  const a = fixture(); const b = fixture();
  await a.controller.allowExternalProcessingAndPrepare(a.controller.view().view_token);
  const receipt = a.controller.currentReceipt();
  assert.equal(b.controller.isCurrentReceipt(receipt), false);
  a.controller.retire();
  assert.equal(a.controller.isCurrentReceipt(receipt), false);
  assert.equal(b.controller.view().state, 'CONSENT_REQUIRED');
});

test('background retirement blocks old token and never auto-regrants on resume', async () => {
  const h = fixture();
  await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token);
  const oldToken = h.controller.view().view_token;
  const oldReceipt = h.controller.currentReceipt();
  h.controller.retire();
  assert.equal(h.controller.isCurrentReceipt(oldReceipt), false);
  assert.equal(h.controller.view().external_consent, 'OFF');
  assert.equal(await h.controller.allowExternalProcessingAndPrepare(oldToken), false);
  assert.equal(h.controller.view().state, 'CONSENT_REQUIRED');
});

test('revoke blocks retry with old artifact and needs a fresh explicit consent', async () => {
  const h = fixture({ failFirstSave: true });
  await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token);
  const token = h.controller.view().view_token;
  assert.equal(h.controller.revokeExternalProcessing(token), true);
  assert.equal(await h.controller.retryLocalPreparation(token), false);
  assert.equal(h.controller.view().external_consent, 'OFF');
  assert.equal(h.calls.save.length, 1);
});

test('revoked authority is blocked even while exact cache deletion is pending', async () => {
  const deleteGate = deferred();
  let current = live;
  const calls = { saved: 0 };
  const runtime = { SaveFormat: { JPEG: 'jpeg' }, ImageManipulator: {
    manipulate() { return { async renderAsync() { return { width: 800, height: 600,
      async saveAsync() { calls.saved++; return { uri: 'file:///cache/pending.jpg', width: 800, height: 600 }; },
    }; } }; },
  } };
  const h = createCameraC2RuntimeController({ getLive: () => current, runtime,
    cleanup: { deleteOwnedCache: () => deleteGate.promise } });
  await h.allowExternalProcessingAndPrepare(h.view().view_token);
  const old = h.currentReceipt();
  assert.equal(h.revokeExternalProcessing(h.view().view_token), true);
  assert.equal(h.isCurrentReceipt(old), false);
  assert.equal(h.cleanupStatus().pending, true);
  assert.equal(calls.saved, 1);
  deleteGate.resolve(true);
  assert.equal(await h.settleCleanup(), true);
  current = undefined;
});

test('cleanup failure is not described as successful deletion', async () => {
  const h = fixture({ deleteResult: false });
  await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token);
  h.controller.revokeExternalProcessing(h.controller.view().view_token);
  await h.controller.settleCleanup();
  assert.equal(h.controller.cleanupStatus().failed, true);
  assert.equal(h.controller.currentReceipt(), undefined);
  assert.equal(await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token), false);
  assert.equal(h.controller.view().reason_code, 'CLEANUP_PENDING_OR_FAILED');
});

test('native path without verified deletion blocks before cache creation', async () => {
  const controller = createCameraC2RuntimeController({ getLive: () => live });
  assert.equal(await controller.allowExternalProcessingAndPrepare(controller.view().view_token), false);
  assert.equal(controller.view().reason_code, 'BLOCKED_NATIVE_CLEANUP');
  assert.equal(controller.currentReceipt(), undefined);
});

test('PREPARED_NOT_SENT cannot masquerade as synthetic EXTERNAL_READY', async () => {
  const h = fixture();
  await h.controller.allowExternalProcessingAndPrepare(h.controller.view().view_token);
  const external = createMealExternalConsentStore();
  assert.equal(external.bind(c1), true);
  const grant = external.allow(c1);
  const result = validateMealVisionRequest({
    scope, context_id: c1.context_id, candidate_id: c1.candidate_id,
    consent: grant, prepared_image: h.controller.currentReceipt(),
    current_c1: projection, purpose: 'meal_image_assessment',
  }, external);
  assert.equal(result.ok, false);
  assert.equal(result.result.state, 'BLOCKED');
});

test('release copy, preview isolation and M5 boundary remain explicit', async () => {
  assert.equal(Object.keys(cameraC2Messages).length, 8);
  for (const copy of Object.values(cameraC2Messages)) {
    for (const key of ['ask', 'allow', 'decline', 'preparing', 'prepared', 'blocked',
      'cleanup', 'revoke', 'retry', 'revoked']) assert.ok(copy[key]?.length > 0, key);
  }
  const host = await source('../components/useM2Gateway.ts');
  const flow = await source('../components/OpeningGoalFlow.tsx');
  const leaf = await source('../components/CameraLocalPreview.tsx');
  const m5 = await source('../domain/m5/meal-image-decision.ts');
  assert.doesNotMatch(host, /candidate:\s*cameraSnapshot\.candidate\s*[,}]/);
  assert.doesNotMatch(flow, /candidate\.local_uri|source=\{\{ uri:/);
  assert.match(leaf, /source=\{\{ uri: candidate\.local_uri \}\}/);
  assert.match(flow, /m2\.retireCameraC2\(\)/);
  assert.match(m5, /MEAL_IMAGE_CAPABILITY_NOT_AVAILABLE/);
  assert.doesNotMatch(host + flow, /EXTERNAL_READY|runMealVisionOfflineFixture/);
  assert.equal(networkCalls, 0);
});
