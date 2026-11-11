import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolveM2View, availableM2Actions, isM2NoteCurrent, createM2ActionRunner } from '../domain/m2.ts';
// The copy module uses type-only imports, erased by Node's strip-types.
import { getM2Copy, m2Messages } from '../i18n-m2.ts';
import { createM2Input, isM2PressCurrent, syncM2Input, editM2Input, pressM2Input, releaseM2Input, presentM2Input } from '../components/m2InputState.ts';
import { fixtureA1, fixtureB2, fixtureB4, NOW } from './fixtures/m2.mjs';

let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
// Resolve only the two extensionless imports in the real production i18n module.
const i18nURL = new URL('../i18n.ts', import.meta.url).href;
const loader = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === i18nURL && ['./i18n-m2', './i18n-opening'].includes(specifier)) specifier += '.ts';
  return nextResolve(specifier, context);
} });
const { translate, LOCALE_OPTIONS } = await import(i18nURL);
loader.deregister();
const copyFor = (locale) => getM2Copy(key => translate(locale, key));
for (const locale of LOCALE_OPTIONS.map(option => option.id)) {
  for (const key of Object.keys(m2Messages.vi)) {
    assert.equal(translate(locale, key), (m2Messages[locale] ?? m2Messages.en)[key]);
  }
}

const copy = copyFor('vi');
const actions = Object.keys(copy.actions);
const select = (s, available = actions, now = NOW) => resolveM2View(s, copy, available, now);
const clone = (s) => structuredClone(s);
const a = fixtureA1();
const before = JSON.stringify(a);
const av = select(a);
assert.equal(av.question, 'Bạn muốn cơ thể mình thay đổi điều gì nhất?');
assert.equal(av.placeholder, 'Nói với 100 theo cách của bạn…');
assert.deepEqual(av.notes.map(n => n.label), ['Sức khỏe', 'Vóc dáng', 'Cơ bắp', 'Vận động']);
check(av.notes.every(n => !n.action), 'A1 notes express intent; they do not execute');
assert.equal(JSON.stringify(a), before);
for (const loading of ['loading', 'error', 'deleted']) {
  const s = clone(a); s.subject.loading = loading;
  check(select(s) === null, loading + ' never proves A1');
}
for (const profile of ['existing', 'unknown']) {
  const s = clone(a); s.subject.profile = profile;
  check(select(s) === null, 'profile must be verified new');
}
for (const goal of ['confirmed', 'unknown']) {
  check(select({ ...a, goal }) === null, 'goal must be known absent');
}
for (const safety of ['hold', 'unknown']) check(select({ ...a, safety }) === null, 'safety boundary');
for (const status of ['denied', 'unknown']) {
  const s = clone(a); s.permission.status = status;
  check(select(s) === null, 'permission boundary');
}
check(select({ ...a, explicitIntent: true }) === null, 'no keyword router');
assert.deepEqual(copyFor('ja'), getM2Copy(key => m2Messages.ja[key]));
assert.notDeepEqual(copyFor('ja'), copyFor('en')); // release locales must not fall back to English
check(copyFor('en').goals.length === 4, 'English fixture');

const b = fixtureB2();
const originalWorkout = JSON.stringify(b);
const bv = select(b);
assert.equal(bv.question, 'Mình tiếp tục từ chỗ vừa dừng nhé.');
assert.deepEqual(bv.notes.map(n => n.action), ['continue_workout', 'adjust_workout', 'pause_workout', 'end_workout']);
check(select({ ...b, goal: 'none', subject: a.subject }).kind === 'workout', 'active task outranks onboarding');
check(select({ ...b, returning: fixtureB4().returning }).kind === 'workout', 'active task outranks return');
check(select({ ...b, explicitIntent: true }).kind === 'workout', 'verified active task precedes unhandled intent');
check(select(b, []).notes.length === 0, 'no fabricated destinations');
check(select(b, ['pause_workout']).notes.length === 1, 'no padding to four');
for (const freshness of ['stale', 'conflicted', 'unknown']) {
  const s = clone(b); s.activeTask.evidence.freshness = freshness;
  check(select(s) === null, 'invalid workout never becomes A1/B4');
}
for (const mutate of [
  s => { s.activeTask.evidence.subjectId = 'someone-else'; },
  s => { s.activeTask.evidence.observedAt = NOW + 1; },
  s => { s.activeTask.evidence.validUntil = NOW; },
  s => { s.activeTask.completedSetIds.push('fixture-set-1'); },
  s => { s.activeTask.exercise.id = ''; },
]) {
  const s = clone(b); mutate(s); check(select(s) === null, 'reject unusable workout evidence');
}
assert.equal(JSON.stringify(b), originalWorkout);
const c = fixtureB4();
check(select(c).kind === 'returning', 'explicit B4 fixture');
const withoutPlan = clone(c); withoutPlan.returning.plan = null;
check(select(withoutPlan) === null, 'missing return plan falls back without a new experience');
check(select({ ...c, returning: { kind: 'unknown' } }) === null, 'absence of history stays unknown');
const longAgo = clone(c); longAgo.returning.evidence.observedAt = NOW - 90 * 86400000;
check(select(longAgo).kind === 'returning', 'no unapproved calendar threshold');
check(!JSON.stringify(select(c)).match(/bỏ tập|mất động lực|streak|kém đi/), 'no activity or motivation inference');

for (const mutate of [
  s => { s.revision = 'new'; },
  s => { s.permission.revision = 'new'; },
  s => { s.permission.status = 'denied'; },
  s => { s.subject.id = 'new-person'; },
  s => { s.activeTask.id = 'new-session'; },
  s => { s.activeTask.completedSetIds.push('another-set'); },
]) {
  const s = clone(b); mutate(s);
  check(!isM2NoteCurrent(bv, select(s), bv.notes[0]), 'render-to-click changes invalidate action');
}
check(!isM2NoteCurrent(bv, resolveM2View(b, copyFor('en'), actions, NOW), bv.notes[0]), 'locale changes invalidate an in-progress tap');
check(!isM2NoteCurrent(bv, select(b, []), bv.notes[0]), 'removed executor invalidates action');
check(select({ ...a, activeTask: { kind: 'other' } }) === null, 'generic coaching is not a Trainer session');
check(select({ ...a, activeTask: { kind: 'unknown' } }) === null, 'unknown task is not onboarding');
let calls = 0;
let release;
const pending = new Promise(resolve => { release = resolve; });
const executors = Object.fromEntries(actions.map(id => [id, () => {}]));
executors.continue_workout = async () => { calls++; await pending; };
const live = () => ({ view: select(b, availableM2Actions(executors)), executors });
const run = createM2ActionRunner();
const first = run(bv, bv.notes[0], live);
check(await run(bv, bv.notes[2], () => ({
  view: select(b), executors: { pause_workout: () => { throw Error('must not run concurrently'); } },
})) === 'duplicate', 'serialize different actions on one M2 frame');
check(await run(bv, bv.notes[0], live) === 'duplicate', 'double tap while pending');
release();
check(await first === 'done', 'executor result');
check(await run(bv, bv.notes[0], live) === 'duplicate', 'same rendered action not repeated');
check(calls === 1, 'one execution');
assert.equal(JSON.stringify(b), originalWorkout);
const failing = createM2ActionRunner();
check(await failing(bv, bv.notes[0], () => ({
  view: select(b), executors: { continue_workout: () => { throw Error('offline'); } },
})) === 'failed', 'failed action is not completion');
check(await failing(bv, bv.notes[0], () => ({
  view: select(b), executors: { continue_workout: () => {} },
})) === 'done', 'retry after failure');
// Drive the same input lifecycle helpers used by the mounted M2 hook.
let input = editM2Input(createM2Input(b.subject.id, false), 'Nháp riêng của tôi', bv, 'vi');
const updated = select({ ...b, revision: 'background-update' });
check(syncM2Input(input, b.subject.id, false) === input, 'background updates preserve draft');
check(presentM2Input(input, updated, 'vi') === bv, 'typing holds note meaning');
check(presentM2Input(input, updated, 'vi').token !== updated.token, 'held context is disabled after revision change');
const fewerActions = select(b, ['pause_workout']);
check(presentM2Input(input, fewerActions, 'vi').token !== fewerActions.token, 'removed executor disables held notes while typing');
input = syncM2Input(input, b.subject.id, true);
check(input.text === '', 'deletion or revoked permission clears the draft immediately');
input = syncM2Input(input, b.subject.id, false);
check(input.text === '' && input.heldView === null, 'restoring the same id never resurrects a draft');
input = editM2Input(input, 'Owner A', bv, 'vi');
input = syncM2Input(input, 'owner-b', false);
check(input.text === '', 'owner B does not receive owner A draft');
input = syncM2Input(input, b.subject.id, false);
check(input.text === '', 'switching back to owner A does not restore retired data');
input = pressM2Input(input, bv);
check(presentM2Input(input, select(c), 'vi') === bv, 'case change cannot replace buttons during a press');
check(!isM2NoteCurrent(bv, select(c), bv.notes[0]), 'held press cannot execute against a different case');
check(presentM2Input(input, null, 'vi') === bv, 'stale evidence holds disabled button identities until release');
input = releaseM2Input(input);
check(presentM2Input(input, select(c), 'vi').kind === 'returning', 'release/cancel reveals current case');
input = editM2Input(input, 'Keep this text', bv, 'vi');
check(presentM2Input(input, resolveM2View(b, copyFor('en'), actions, NOW), 'en').question === copyFor('en').resume,
  'locale switch uses translated copy without losing expression');
check(input.text === 'Keep this text', 'locale switch preserves draft');
input = pressM2Input(createM2Input(b.subject.id, false), null);
for (const next of [av, bv]) {
  const held = presentM2Input(input, next, 'vi');
  check(held === null && held?.token !== next.token, 'fallback buttons stay in place and disabled during hydration');
  check(!isM2PressCurrent({ id: 'health', token: null, cancelled: false }, held, next, 'health'),
    'fallback tap does not silently become an adaptive action or draft');
}
check(presentM2Input(releaseM2Input(input), bv, 'vi') === bv, 'fallback release reveals verified context');
check(!isM2PressCurrent({ id: bv.notes[0].id, token: bv.token, cancelled: true }, bv, bv, bv.notes[0].id),
  'deleted/revoked then restored context cannot revive an interrupted gesture');
check(isM2PressCurrent({ id: 'health', token: null, cancelled: false }, null, null, 'health'),
  'unchanged legacy fallback remains interactive');
const domain = await readFile(new URL('../domain/m2.ts', import.meta.url), 'utf8');
const hook = await readFile(new URL('../components/useM2Gateway.ts', import.meta.url), 'utf8');
check(!/(fetch\s*\(|aiRespond|addUserMessage|saveGoal|AsyncStorage)/.test(domain + hook), 'M2 module has no provider or state writers');
console.log('M2 deterministic checks: PASS (' + assertions + ' boundary checks plus exact-copy/state assertions)');
