// Evidence audit, not a production adapter or a new-user classifier.
// Positive A1 below is a contract fixture, never a claim of real profile creation.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createInitialInteractionState, hydrateInteraction, serializeInteraction,
  appendUserMessage, setUserGoal } from '../domain/interaction.ts';
import { hydrateOpening, initialOpeningState } from '../domain/opening.ts';
import { shouldShowFirstWelcome } from '../domain/welcome.ts';
import { resolveM2View } from '../domain/m2.ts';
import { getM2Copy, m2Messages } from '../i18n-m2.ts';
import { createM2Input, syncM2Input, editM2Input } from '../components/m2InputState.ts';
import { fixtureA1, NOW } from './fixtures/m2.mjs';

let count = 0;
const test = (name, fn) => { fn(); count++; console.log('PASS: ' + name); };
const at = new Date(NOW).toISOString();
const copy = getM2Copy(key => m2Messages.vi[key]);
const resolve = snapshot => resolveM2View(snapshot, copy, [], NOW);
const normalizeTime = value => ({ ...value, state: { ...value.state, updatedAt: at } });

test('new install and returning user with lost cache have identical production hydration evidence', () => {
  // These two real-world histories give exactly the same inputs to the hydrator.
  const genuinelyNew = normalizeTime(hydrateInteraction(null, null));
  const existingWithoutCache = normalizeTime(hydrateInteraction(null, null));
  assert.deepEqual(genuinelyNew, existingWithoutCache);
  assert.equal(genuinelyNew.kind, 'empty');
  assert.equal(genuinelyNew.state.goal, null);
  assert.equal(shouldShowFirstWelcome(null, null, null), true);
});
test('opening new is also the outcome of absent, corrupt, or incompatible storage', () => {
  for (const raw of [null, '{broken', JSON.stringify({ schemaVersion: 999 })]) {
    assert.deepEqual(hydrateOpening(raw), initialOpeningState);
    assert.equal(hydrateOpening(raw).status, 'new');
  }
});
test('storage parse/migration failure gives unreadable plus null goal, never positive identity evidence', () => {
  for (const raw of ['{broken', JSON.stringify({ schemaVersion: 999, state: {} })]) {
    const result = hydrateInteraction(raw, null);
    assert.equal(result.kind, 'unreadable');
    assert.equal(result.state.goal, null);
  }
});
test('deleted interaction data also produces null goal; deletion remains distinguishable', () => {
  const result = hydrateInteraction(null, at);
  assert.equal(result.kind, 'deleted');
  assert.equal(result.state.goal, null);
});
test('valid previous history can have no goal; null goal alone cannot imply A1', () => {
  const prior = appendUserMessage(createInitialInteractionState(at), 'Tôi đã dùng 100 trước đây.', at);
  const result = hydrateInteraction(serializeInteraction(prior), null);
  assert.equal(result.kind, 'ok');
  assert.equal(result.state.goal, null);
  assert.equal(result.state.messages.length, 1);
});
test('history with missing goal is unreadable, not a new profile', () => {
  const prior = appendUserMessage(createInitialInteractionState(at), 'Lịch sử cũ', at);
  const envelope = JSON.parse(serializeInteraction(prior));
  delete envelope.state.goal;
  const result = hydrateInteraction(JSON.stringify(envelope), null);
  assert.equal(result.kind, 'unreadable');
  assert.equal(result.state.goal, null);
});
test('existing goal round-trips without introducing or changing a confirmed-goal model', () => {
  const state = setUserGoal(createInitialInteractionState(at), 'Khỏe hơn', 'Đi bộ', at);
  const result = hydrateInteraction(serializeInteraction(state), null);
  assert.equal(result.kind, 'ok');
  assert.deepEqual(result.state.goal, state.goal);
  assert.equal(result.state.goal.authoredBy, 'user');
});

// Freeze the actual integration boundary: no manufactured gateway in production.
const layoutSource = await readFile(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
const layout = ts.createSourceFile('_layout.tsx', layoutSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let productionFrames = 0;
function inspect(node) {
  if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
    && node.tagName.getText(layout) === 'OpeningGoalFlow') {
    productionFrames++;
    for (const attr of node.attributes.properties) {
      assert.ok(!ts.isJsxSpreadAttribute(attr), 'Review any new indirect production props before relying on this audit');
      assert.notEqual(attr.name.getText(layout), 'm2Gateway', 'A new adapter needs a positive evidence audit, not this old absence-of-evidence result');
    }
  }
  ts.forEachChild(node, inspect);
}
test('current production frame supplies no ungrounded A1 gateway and resolver returns fallback', () => {
  inspect(layout);
  assert.equal(productionFrames, 1);
  assert.equal(resolve(undefined), null);
});

// Existing M2 contract tests. These do not provide the missing production issuer.
const a1 = fixtureA1();
const view = resolve(a1);
test('positive new-profile/no-goal contract resolves A1 (fixture only)', () => {
  assert.equal(view.kind, 'goal');
  assert.equal(view.question, 'Bạn muốn cơ thể mình thay đổi điều gì nhất?');
  assert.equal(view.placeholder, 'Nói với 100 theo cách của bạn…');
  assert.deepEqual(view.notes.map(note => note.label), ['Khỏe hơn', 'Gọn đẹp hơn', 'Mạnh hơn', 'Vận động tốt hơn']);
});
for (const loading of ['loading', 'error', 'deleted']) {
  test(loading + ' profile cannot resolve A1', () => {
    assert.equal(resolve({ ...a1, subject: { ...a1.subject, loading } }), null);
  });
}
for (const profile of ['existing', 'unknown']) {
  test(profile + ' profile with no goal cannot resolve A1', () => {
    assert.equal(resolve({ ...a1, subject: { ...a1.subject, profile } }), null);
  });
}
for (const goal of ['confirmed', 'unknown']) {
  test(goal + ' goal cannot resolve A1', () => assert.equal(resolve({ ...a1, goal }), null));
}
for (const status of ['denied', 'unknown']) {
  test(status + ' permission cannot resolve A1', () => {
    assert.equal(resolve({ ...a1, permission: { ...a1.permission, status } }), null);
  });
}
test('profile switch retires owner A draft, including when switching back', () => {
  let input = editM2Input(createM2Input(a1.subject.id, false), 'Nháp riêng A', view, 'vi');
  input = syncM2Input(input, 'fixture-owner-b', false);
  assert.equal(input.text, '');
  input = syncM2Input(input, a1.subject.id, false);
  assert.equal(input.text, '');
});
test('A1 note has no executor and changes only draft input', () => {
  const state = createInitialInteractionState(at);
  const before = JSON.stringify(state);
  assert.ok(view.notes.every(note => note.action === undefined));
  const input = editM2Input(createM2Input(a1.subject.id, false), view.notes[0].label, view, 'vi');
  assert.equal(input.text, 'Khỏe hơn');
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.goal, null);
});
test('free expression overrides the previous suggestion draft', () => {
  let input = editM2Input(createM2Input(a1.subject.id, false), view.notes[0].label, view, 'vi');
  input = editM2Input(input, 'Tôi muốn leo cầu thang đỡ mệt', view, 'vi');
  assert.equal(input.text, 'Tôi muốn leo cầu thang đỡ mệt');
  assert.equal(input.heldView, view);
});
console.log(`A1 evidence/contract audit: PASS (${count} checks).`);
console.log('Production A1 activation: NOT_SUPPORTED — no durable subject/profile-created authority exists in the inspected architecture.');
console.log('Fixture success and source inspection are not proof of mounted production/native behavior.');
