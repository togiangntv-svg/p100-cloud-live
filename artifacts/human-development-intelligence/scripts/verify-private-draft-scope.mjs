// Deterministic presentation seam: real owner stores supply the scope tokens.
// React keys remount the editor when these tokens change; the component wiring
// is checked below. This is not a native React render or device test.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { OWNER_A as A, OWNER_B as B, FakeClock, FakeStorage, fakeAuthority } from './fixtures/local-owner.mjs';

registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { createInteractionStore } = await import('../context/interaction-owner/store.ts');
const { createCoachingStore } = await import('../context/coaching-owner/store.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settled(store) {
  for (let i = 0; i < 100; i++) {
    const snap = store.getSnapshot();
    if (snap.hydrated && snap.persistenceStatus !== 'loading') return;
    await tick();
  }
  assert.fail('owner store did not settle');
}
function fixture() {
  const clock = new FakeClock(), backend = new FakeStorage(), authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock), stores = [];
  let nextId = 0, apiCalls = 0;
  const api = {
    status: async () => { apiCalls++; return { availability: 'not_connected', remainingLiveCalls: 4 }; },
    pilot: async () => { apiCalls++; return {}; },
    respond: async ({ requestId }) => { apiCalls++; return { requestId, text: 'fixture-response' }; },
  };
  async function lease(owner) {
    authority.results.push({ status: 'verified', owner, validUntil: clock.now() + 1_000_000 });
    const value = await boundary.control.verifySession();
    boundary.control.finishHydration(value);
    return value;
  }
  function mount(kind, value) {
    const owner = value ? { access: boundary.access, lease: value } : undefined;
    const store = kind === 'interaction'
      ? createInteractionStore({ owner, backend, api, now: clock.now, newId: p => `${p}-${++nextId}` })
      : createCoachingStore({ owner, backend });
    stores.push(store); store.start(); return store;
  }
  return { boundary, lease, mount, backend, apiCalls: () => apiCalls,
    cleanup: () => stores.forEach(store => store.stop()) };
}
const emptyDraft = () => ({ composerMode: 'conversation', message: '', goal: '', action: '', correction: '', outcome: '', inputText: '' });
function renderEditor(previous, projectionRevision) {
  assert.ok((typeof projectionRevision === 'number' && Number.isFinite(projectionRevision))
    || (typeof projectionRevision === 'string' && /^\d+:\d+$/u.test(projectionRevision)),
  'trusted presentation revision required');
  return previous?.key === projectionRevision ? previous : { key: projectionRevision, draft: emptyDraft() };
}
const naturalScope = (interaction, coaching) =>
  `${interaction.getSnapshot().projectionRevision}:${coaching.getSnapshot().projectionRevision}`;
const tests = [];
const test = (name, body) => tests.push({ name, body });

test('component state is inside keyed editors, with no effect-only Coaching reset', async () => {
  const natural = await readFile(new URL('../components/NaturalInteractionExperience.tsx', import.meta.url), 'utf8');
  const coaching = await readFile(new URL('../components/CoachingExperience.tsx', import.meta.url), 'utf8');
  assert.ok(/<NaturalInteractionEditor key=\{`\$\{interaction\.projectionRevision\}:\$\{coaching\.projectionRevision\}`\}/u.test(natural), 'Natural editor is not keyed by both relevant scopes');
  assert.ok(/<CoachingEditor key=\{coaching\.projectionRevision\}/u.test(coaching), 'Coaching editor is not keyed');
  assert.doesNotMatch(coaching, /useEffect\(\(\) =>\s*\{\s*setInputText\(''\)/u);
  assert.ok(natural.indexOf('function NaturalInteractionEditor') < natural.indexOf("useState<ComposerMode>('conversation')"));
  assert.ok(coaching.indexOf('function CoachingEditor') < coaching.indexOf("useState('')"));
  const optInStart = natural.indexOf("{interaction.state.aiConsent !== 'granted'");
  const optInEnd = natural.indexOf('</Card>', optInStart);
  assert.ok(optInStart >= 0 && optInEnd > optInStart, 'explicit AI opt-in block missing');
  const optIn = natural.slice(optInStart, optInEnd);
  assert.match(optIn, /aiAvailability === 'not_connected'/u,
    'explicit opt-in must be reachable before any passive provider probe');
  assert.match(optIn, /interaction\.enableAiPilot\(locale\)/u,
    'user press must remain the explicit provider-facing action');
  assert.doesNotMatch(optIn, /aiAvailability === 'ready'/u,
    'ready-only gating would make opt-in unreachable after provider-silent hydration');
});
test('A message, goal/action, correction and outcome drafts are empty at B scope', async f => {
  const a = f.mount('interaction', await f.lease(A)); await settled(a);
  const scopes = [
    { composerMode: 'conversation', message: 'PRIVATE-A' },
    { composerMode: 'goal', goal: 'PRIVATE-GOAL-A', action: 'PRIVATE-ACTION-A' },
    { composerMode: 'correction', correction: 'PRIVATE-CORRECTION-A' },
    { composerMode: 'conversation', outcome: 'PRIVATE-OUTCOME-A' },
  ];
  const views = scopes.map(draft => {
    const view = renderEditor(undefined, a.getSnapshot().projectionRevision);
    Object.assign(view.draft, draft); return view;
  });
  f.boundary.control.invalidateCurrentSession();
  for (const view of views) {
    const locked = renderEditor(view, a.getSnapshot().projectionRevision);
    assert.notEqual(locked, view); assert.deepEqual(locked.draft, emptyDraft());
  }
  const b = f.mount('interaction', await f.lease(B)); await settled(b);
  for (const view of views) assert.deepEqual(renderEditor(view, b.getSnapshot().projectionRevision).draft, emptyDraft());
});
test('same-run updates and synthetic AI response preserve an in-progress draft', async f => {
  const store = f.mount('interaction', await f.lease(A)); await settled(store);
  const view = renderEditor(undefined, store.getSnapshot().projectionRevision);
  view.draft.message = 'NEXT-PRIVATE-DRAFT';
  assert.equal(await store.getSnapshot().addUserMessage('first', 'vi'), true);
  assert.equal(renderEditor(view, store.getSnapshot().projectionRevision), view);
  store.getSnapshot().setAiConsent('granted'); await tick();
  assert.equal(await store.getSnapshot().addUserMessage('second', 'vi'), true); await tick();
  assert.equal(renderEditor(view, store.getSnapshot().projectionRevision), view);
  assert.equal(view.draft.message, 'NEXT-PRIVATE-DRAFT');
  assert.ok(f.apiCalls() > 0);
});
test('Interaction delete invalidates drafts before async storage resolves and old send fails', async f => {
  const store = f.mount('interaction', await f.lease(A)); await settled(store);
  const old = store.getSnapshot(), view = renderEditor(undefined, old.projectionRevision);
  view.draft.message = 'PRE-DELETE'; view.draft.goal = 'PRE-DELETE-GOAL';
  const gate = f.backend.holdNext('setItem');
  const deleting = old.deleteData(); await gate.started;
  assert.deepEqual(renderEditor(view, store.getSnapshot().projectionRevision).draft, emptyDraft());
  assert.equal(await old.addUserMessage('STALE', 'vi'), false);
  assert.equal(old.saveGoal('STALE', 'STALE'), false);
  assert.equal(old.saveCorrection('STALE'), false);
  gate.release(); assert.equal(await deleting, true);
});
test('Coaching delete invalidates Natural outcome draft without changing Interaction authority', async f => {
  const lease = await f.lease(A);
  const interaction = f.mount('interaction', lease), coaching = f.mount('coaching', lease);
  await settled(interaction); await settled(coaching);
  const interactionRevision = interaction.getSnapshot().projectionRevision;
  const view = renderEditor(undefined, naturalScope(interaction, coaching));
  view.draft.outcome = 'PRIVATE-OUTCOME-A';
  const deleting = coaching.getSnapshot().deleteData();
  assert.equal(interaction.getSnapshot().projectionRevision, interactionRevision);
  assert.deepEqual(renderEditor(view, naturalScope(interaction, coaching)).draft, emptyDraft());
  assert.equal(await deleting, true);
});
test('same owner relogin creates a fresh Interaction editor scope', async f => {
  const first = f.mount('interaction', await f.lease(A)); await settled(first);
  const old = first.getSnapshot(), view = renderEditor(undefined, old.projectionRevision);
  view.draft.correction = 'PRIVATE-A';
  f.boundary.control.invalidateCurrentSession();
  const again = f.mount('interaction', await f.lease(A)); await settled(again);
  assert.deepEqual(renderEditor(view, again.getSnapshot().projectionRevision).draft, emptyDraft());
  assert.equal(old.saveCorrection('STALE'), false);
});
test('Coaching A-to-B, logout, delete and relogin have distinct scope keys', async f => {
  const a = f.mount('coaching', await f.lease(A)); await settled(a);
  const first = renderEditor(undefined, a.getSnapshot().projectionRevision);
  first.draft.inputText = 'PRIVATE-A';
  const same = a.getSnapshot().projectionRevision;
  a.getSnapshot().startStory('persisted A'); await tick();
  assert.equal(a.getSnapshot().projectionRevision, same);
  assert.equal(renderEditor(first, same).draft.inputText, 'PRIVATE-A');
  const old = a.getSnapshot();
  const deleting = old.deleteData();
  const postDelete = renderEditor(first, a.getSnapshot().projectionRevision);
  assert.deepEqual(postDelete.draft, emptyDraft());
  assert.equal(await deleting, true);
  old.startStory('STALE');
  old.submitStandardReturn('STALE-OUTCOME', false);
  f.boundary.control.invalidateCurrentSession();
  const locked = renderEditor(postDelete, a.getSnapshot().projectionRevision);
  assert.deepEqual(locked.draft, emptyDraft());
  const b = f.mount('coaching', await f.lease(B)); await settled(b);
  assert.notEqual(b.getSnapshot().projectionRevision, locked.key);
  assert.notEqual(b.getSnapshot().projectionRevision, postDelete.key);
  assert.deepEqual(renderEditor(first, b.getSnapshot().projectionRevision).draft, emptyDraft());
  b.getSnapshot().startStory('B'); await tick();
  f.boundary.control.invalidateCurrentSession();
  const again = f.mount('coaching', await f.lease(A)); await settled(again);
  assert.notEqual(again.getSnapshot().projectionRevision, first.key);
  assert.deepEqual(renderEditor(first, again.getSnapshot().projectionRevision).draft, emptyDraft());
});

let passed = 0;
for (const { name, body } of tests) {
  const f = fixture();
  try { await body(f); console.log(`PASS ${name}`); passed++; }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
  finally { f.cleanup(); }
}
console.log(`Private draft scope seam: ${passed}/${tests.length} PASS`);
