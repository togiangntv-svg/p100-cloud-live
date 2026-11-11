import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import ts from 'typescript';
import { registerHooks } from 'node:module';
import { FakeClock, fakeAuthority, OWNER_A, OWNER_B } from './fixtures/local-owner.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier,
      context);
  },
});

let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw Error('NETWORK_FORBIDDEN_IN_TRAINER_JOURNEY'); };

const { createLocalOwnerBoundary } = await import('../domain/local-owner/boundary.ts');
const { createLocalWalkResource, W01 } = await import('../domain/m6/walk-resource.ts');
const { createSessionTaskStore } = await import('../domain/session-task/store.ts');
const { readM7NextCycleBasis } = await import('../domain/m7/next-cycle.ts');
const { createTrainerRuntimeAppHost } = await import('../domain/trainer-runtime/app-host.ts');
const i18nJourney = await import('../i18n-trainer-journey.ts');

const tick = () => new Promise(resolve => setImmediate(resolve));
const meaning = Object.freeze({
  intent_type: 'GOAL', interpreted_meaning: 'Khỏe hơn', confidence: 0.95,
  uncertainty: null, missing_context: [], clarification_needed: false,
  clarification_question: null, safety_state: 'CLEAR', suggested_next_role: 'M4',
  task_kind: 'general_health', context_effect: 'NONE', used_context_ids: [],
  response: 'Đã hiểu mục tiêu fixture.',
});
const walkContext = Object.freeze({
  source_ref: 'journey-fixture-context', intent: 'SHORT_LIGHT_MOVEMENT',
  walking_choice: 'WANTS_WALK', adult: 'REPORTED_ADULT',
  mobility: 'INDEPENDENT_COMFORTABLE_WALKING', concerns: 'NONE_REPORTED',
  professional_limits: 'NONE_REPORTED', setting: 'INDOOR_FLAT_CLEAR_LIT_DRY_STOPPABLE',
  competing_activity: 'NONE', footwear: 'FAMILIAR_SECURE', available_minutes: 20,
  requested_minutes: 5, currency: 'CURRENT',
});
const basicOutcome = Object.freeze({
  execution_extent: 'DID', user_stopped: false,
  problem_state: 'NO_PROBLEM_REPORTED', safety_disposition: 'CLEAR',
  action_change: 'UNCHANGED', constraint: 'NONE_REPORTED',
});

async function ownerFixture(identity = OWNER_A) {
  const clock = new FakeClock();
  const authority = fakeAuthority();
  const boundary = createLocalOwnerBoundary(authority.verifier, clock);
  authority.results.push({ status: 'verified', owner: identity, validUntil: 100_000 });
  const lease = await boundary.control.verifySession();
  boundary.control.finishHydration(lease);
  return { clock, authority, boundary,
    binding: Object.freeze({ access: boundary.access, lease }) };
}

async function replaceOwner(owner, identity) {
  owner.authority.results.push({ status: 'verified', owner: identity, validUntil: 100_000 });
  const lease = await owner.boundary.control.verifySession();
  owner.boundary.control.finishHydration(lease);
  return Object.freeze({ access: owner.boundary.access, lease });
}

function adapter(captures, cycle, options = {}) {
  return Object.freeze({
    provenance: 'TEST_FIXTURE', processing: 'ON_DEVICE', contract: 'M3_GATEWAY_V1',
    interpret(input) {
      captures[cycle].push(input.content);
      const prior = input.content.relevant_context.find(item => item.kind.startsWith('prior_episode:'));
      const usesPrior = options.usesPriorInBDecision?.(input.content) ?? !options.independentB;
      return Promise.resolve(Object.freeze({ ...meaning,
        used_context_ids: prior && cycle === 'B' && usesPrior
          ? [options.wirePriorId ? `m7-prior:${prior.text.toLowerCase().replaceAll('_', '-')}`
            : prior.id] : [],
      }));
    },
    async revoke() {},
  });
}

async function fixture(options = {}) {
  const owner = await ownerFixture();
  const resource = createLocalWalkResource();
  const captures = { A: [], B: [] };
  const stores = [];
  const host = createTrainerRuntimeAppHost({
    journeyFixture: Object.freeze({ kind: 'TEST_FIXTURE', walk_context: walkContext }),
    createStore(input) {
      const real = createSessionTaskStore({
        adapter: adapter(captures, input.cycle, options), ownerSession: input.binding,
        walkResource: resource.access, m7Purpose: input.m7Purpose,
        m7NextCycle: input.m7NextCycle, now: owner.clock.now,
      });
      let store = real;
      if (options.failReport && input.cycle === 'A') {
        store = Object.freeze({ ...store, m7Outcome: Object.freeze({ ...store.m7Outcome,
          report: () => Object.freeze({ state: 'DENIED' }) }) });
      }
      if (options.failSeal && input.cycle === 'A') {
        store = Object.freeze({ ...store, enterRetainedSourceMode: () => false });
      }
      stores.push({ cycle: input.cycle, real, store, consumer: input.m7NextCycle });
      return store;
    },
  });
  host.setBinding(owner.binding);
  assert.equal(host.journey.getView().state, 'CURRENT');
  return { owner, resource, captures, stores, host, journey: host.journey };
}

const token = f => {
  const view = f.journey.getView();
  assert.equal(view.state, 'CURRENT');
  return view.token;
};
const command = (f, name, ...args) => f.journey.commands[name](token(f), ...args);

async function submitGoal(f, text = 'Khỏe hơn') {
  assert.equal(command(f, 'submitGoal', {
    text, locale: 'vi', permission_granted: true, permission_revision: 1,
  }), true);
  await tick(); await tick();
  const view = f.journey.getView();
  assert.equal(view.state, 'CURRENT');
  assert.equal(view.goal?.state, 'PROPOSED');
  return view;
}

async function prepareAction(f) {
  await submitGoal(f);
  assert.equal(command(f, 'acceptGoal'), true);
  const view = f.journey.getView();
  assert.equal(view.state, 'CURRENT');
  assert.equal(view.goal?.state, 'ACCEPTED');
  assert.equal(view.action?.state, 'PROPOSED');
  return view;
}

async function prepareStarted(f) {
  await prepareAction(f);
  assert.equal(command(f, 'acceptAction'), true);
  assert.equal(f.journey.getView().action?.state, 'ACCEPTED');
  assert.equal(command(f, 'startAction'), true);
  assert.equal(f.journey.getView().action?.state, 'STARTED');
  return f.journey.getView();
}

function fillDraft(f, changes = {}) {
  assert.equal(command(f, 'updateOutcomeDraft', { ...basicOutcome, ...changes }), true);
}

async function recordOutcome(f, changes = {}) {
  await prepareStarted(f);
  assert.equal(command(f, 'openOutcomeDraft'), true);
  fillDraft(f, changes);
  assert.equal(command(f, 'recordOutcome'), true);
  const view = f.journey.getView();
  assert.equal(view.outcome?.state, 'ACTIVE');
  return view;
}

async function readyForB(f) {
  await recordOutcome(f);
  assert.equal(command(f, 'allowNextUse'), true);
  assert.equal(f.journey.getView().next_use, 'ON');
  return f;
}

test('01 same current cycle store handles Trainer input and M5 receipt', async () => {
  const f = await fixture(); await prepareAction(f);
  const a = f.host.getSnapshot().cycle_a;
  assert.equal(f.captures.A.length, 1);
  assert.equal(f.captures.A[0].current_text, 'Khỏe hơn');
  assert.equal(a.store.getSnapshot().tasks.length, 1);
  const ref = a.store.reference();
  assert.ok(ref && a.store.getM5GoalChoiceReceipt(ref));
});

test('02 Trainer composition performs one submit and returns before legacy submit', async () => {
  const f = await fixture(); await submitGoal(f);
  assert.equal(f.captures.A.length, 1);
  const source = await readFile(new URL('../components/useM2Gateway.ts', import.meta.url), 'utf8');
  assert.match(source, /trainerJourney\.commands\.submitGoal[\s\S]*?return;[\s\S]*?m3Store\.submit/u);
});

test('03 M5 acceptance produces a proposal but does not start it', async () => {
  const f = await fixture(); await prepareAction(f);
  assert.equal(f.journey.getView().action.state, 'PROPOSED');
  assert.equal(f.host.getSnapshot().cycle_a.store.selfWalk.getSnapshot().start, undefined);
});

test('04 explicit Start records start only and grants no M7 purpose', async () => {
  const f = await fixture(); await prepareStarted(f);
  assert.equal(f.host.getSnapshot().cycle_a.m7.getSnapshot().request_count, 0);
  assert.equal(f.journey.getView().outcome, undefined);
});

test('05 double tap accept/start/report/createB has one domain effect each', async () => {
  const f = await fixture(); await submitGoal(f); command(f, 'acceptGoal');
  let stale = token(f); assert.equal(f.journey.commands.acceptAction(stale), true);
  assert.equal(f.journey.commands.acceptAction(stale), false);
  stale = token(f); assert.equal(f.journey.commands.startAction(stale), true);
  assert.equal(f.journey.commands.startAction(stale), false);
  command(f, 'openOutcomeDraft'); fillDraft(f);
  stale = token(f); assert.equal(f.journey.commands.recordOutcome(stale), true);
  assert.equal(f.journey.commands.recordOutcome(stale), false);
  assert.equal(f.host.getSnapshot().cycle_a.m7.getSnapshot().request_count, 1);
  command(f, 'allowNextUse'); stale = token(f);
  assert.equal(f.journey.commands.createNextCycle(stale).state, 'CREATED');
  assert.equal(f.journey.commands.createNextCycle(stale), undefined);
});

test('06 reads, subscriptions, rerender equivalents and locale copy cause zero effects', async () => {
  const f = await fixture(); const before = f.host.getSnapshot().cycle_a.m7.getSnapshot();
  const unsubscribe = f.journey.subscribe(() => {});
  for (const locale of ['vi', 'en', 'ja']) {
    i18nJourney.trainerJourneyCopy(locale); f.journey.getView();
  }
  unsubscribe();
  assert.deepEqual(f.host.getSnapshot().cycle_a.m7.getSnapshot(), before);
  assert.equal(f.captures.A.length, 0);
});

test('07 stale displayed token and stale proposal command are rejected', async () => {
  const f = await fixture(); await prepareAction(f);
  const stale = token(f); command(f, 'editGoal', 'Khỏe hơn nữa'); await tick(); await tick();
  assert.equal(f.journey.commands.acceptAction(stale), false);
  assert.notEqual(f.journey.getView().action?.state, 'STARTED');
});

test('08 logout, lease generation and owner replacement invalidate old commands', async () => {
  const f = await fixture(); await prepareAction(f); const stale = token(f);
  const nextBinding = await replaceOwner(f.owner, OWNER_B);
  f.host.setBinding(nextBinding);
  assert.equal(f.journey.commands.acceptAction(stale), false);
  assert.equal(f.journey.getView().task, undefined);
  f.host.setBinding(undefined);
  assert.equal(f.journey.getView().state, 'UNAVAILABLE');
});

test('09 no-start can leave without ghost episode or M7 grant', async () => {
  const f = await fixture(); await prepareAction(f); command(f, 'acceptAction');
  const a = f.host.getSnapshot().cycle_a;
  assert.equal(a.store.selfWalk.getEpisode(a.store.reference()), undefined);
  f.host.setBinding(undefined);
  assert.equal(a.m7.getSnapshot().state, 'RETIRED');
});

test('10 STARTED plus SKIPPED stores exactly the user report', async () => {
  const f = await fixture(); await recordOutcome(f, { execution_extent: 'SKIPPED', user_stopped: true });
  assert.equal(f.journey.getView().outcome.facts.execution_extent, 'SKIPPED');
  assert.equal(f.journey.getView().outcome.facts.user_stopped, true);
});

test('11 PARTIAL plus problem preserves both facts and explicit disposition', async () => {
  const f = await fixture(); await recordOutcome(f, {
    execution_extent: 'PARTIAL', problem_state: 'PROBLEM', safety_disposition: 'REASSESS',
    action_change: 'CHANGED', user_stopped: true,
  });
  const facts = f.journey.getView().outcome.facts;
  assert.equal(facts.execution_extent, 'PARTIAL');
  assert.equal(facts.problem_state, 'PROBLEM');
  assert.equal(facts.safety_disposition, 'REASSESS');
});

test('12 outcome draft without Record grants nothing', async () => {
  const f = await fixture(); await prepareStarted(f); command(f, 'openOutcomeDraft'); fillDraft(f);
  assert.equal(f.host.getSnapshot().cycle_a.m7.getSnapshot().request_count, 0);
  assert.equal(f.journey.getView().outcome, undefined);
});

test('13 Record grants RECORD_OUTCOME only', async () => {
  const f = await fixture(); await recordOutcome(f);
  const authority = f.host.getSnapshot().cycle_a.m7.getSnapshot();
  assert.ok(authority.record_outcome_receipt);
  assert.equal(authority.use_next_cycle_receipt, undefined);
});

test('14 grant success plus report failure remains honestly NOT_RECORDED', async () => {
  const f = await fixture({ failReport: true }); await prepareStarted(f);
  command(f, 'openOutcomeDraft'); fillDraft(f);
  assert.equal(command(f, 'recordOutcome'), false);
  assert.equal(f.journey.getView().message, 'NOT_RECORDED');
  assert.equal(f.journey.getView().outcome, undefined);
  assert.ok(f.host.getSnapshot().cycle_a.m7.getSnapshot().record_outcome_receipt);
});

test('15 USE_NEXT_CYCLE is default OFF', async () => {
  const f = await fixture(); await recordOutcome(f);
  assert.equal(f.journey.getView().next_use, 'OFF');
});

test('16 recorded outcome with next-use OFF cannot create B', async () => {
  const f = await fixture(); await recordOutcome(f);
  assert.equal(command(f, 'createNextCycle'), undefined);
  assert.equal(f.host.getSnapshot().cycle_b, undefined);
});

test('17 allowing next-use does not create B', async () => {
  const f = await fixture(); await recordOutcome(f); command(f, 'allowNextUse');
  assert.equal(f.host.getSnapshot().cycle_b, undefined);
});

test('18 revoking next-use removes its dependent fragment', async () => {
  const f = await fixture(); await readyForB(f);
  const a = f.host.getSnapshot().cycle_a;
  const receipt = a.m7.getSnapshot().use_next_cycle_receipt;
  assert.ok(a.store.m7Outcome.readNextCycle(receipt));
  command(f, 'revokeNextUse');
  assert.equal(a.store.m7Outcome.readNextCycle(receipt), undefined);
});

test('19 only explicit next click creates B', async () => {
  const f = await fixture(); await readyForB(f);
  assert.equal(f.host.getSnapshot().cycle_b, undefined);
  assert.equal(command(f, 'createNextCycle').state, 'CREATED');
  assert.equal(f.host.getSnapshot().cycle_b.id, 'B');
});

test('20 B starts with zero M7 grants', async () => {
  const f = await fixture(); await readyForB(f); command(f, 'createNextCycle');
  assert.deepEqual(f.host.getSnapshot().cycle_b.m7.getSnapshot(), {
    state: 'ACTIVE', request_count: 0,
    record_outcome_receipt: undefined, use_next_cycle_receipt: undefined,
  });
});

test('21 B receives no TaskRef, M5 or M6 receipt from A', async () => {
  const f = await fixture(); await readyForB(f);
  const a = f.host.getSnapshot().cycle_a;
  const oldRef = a.store.reference();
  command(f, 'createNextCycle');
  const b = f.host.getSnapshot().cycle_b;
  assert.equal(b.store.getSnapshot().tasks.length, 0);
  assert.equal(b.store.assessM4GoalReadiness(oldRef).decision.reason, 'STALE_TASK');
  assert.equal(b.store.getM5GoalChoiceReceipt(oldRef), undefined);
});

test('22 after B, A is history-only and cannot regain action controls', async () => {
  const f = await fixture(); await readyForB(f); command(f, 'createNextCycle');
  const view = f.journey.getView();
  assert.equal(view.cycle, 'B'); assert.ok(view.history); assert.equal(view.action, undefined);
  assert.equal(f.host.getSnapshot().cycle_a.store.submit('forbidden'), undefined);
});

async function bContextFixture() {
  const f = await fixture(); await readyForB(f); command(f, 'createNextCycle');
  command(f, 'submitGoal', { text: 'B goal', locale: 'vi', permission_granted: true });
  await tick(); await tick();
  const b = f.host.getSnapshot().cycle_b;
  return { f, b, ref: b.store.reference() };
}

test('23 retained A correction updates B dependent context', async () => {
  const { f, b, ref } = await bContextFixture();
  const before = b.store.readM7NextCycleContext(ref);
  command(f, 'openHistoryCorrection');
  command(f, 'updateOutcomeDraft', { constraint: 'TIME_CONSTRAINT' });
  assert.equal(command(f, 'recordOutcome'), true);
  // Source invalidation publishes a new B view; the old TaskRef is intentionally stale.
  assert.equal(b.store.readM7NextCycleContext(ref), undefined);
  const after = b.store.readM7NextCycleContext(b.store.reference());
  assert.notEqual(after.id, before.id);
  assert.equal(after.reported_constraint.kind, 'PRIOR_EPISODE_TIME_CONSTRAINT');
});

test('24 retained A retract/delete/revoke invalidate dependent presentation', async () => {
  for (const operation of ['retractHistory', 'deleteHistory', 'revokeHistoryRecord']) {
    const { f, b, ref } = await bContextFixture();
    assert.ok(b.store.readM7NextCycleContext(ref));
    assert.equal(command(f, operation), true);
    assert.equal(b.store.readM7NextCycleContext(ref), undefined);
  }
});

test('25 domain DENIED on create B causes no retry or new grant', async () => {
  const f = await fixture({ failSeal: true }); await readyForB(f); const staleDisplay = token(f);
  const a = f.host.getSnapshot().cycle_a;
  const before = a.m7.getSnapshot().request_count;
  const result = f.journey.commands.createNextCycle(staleDisplay);
  assert.equal(result.state, 'DENIED');
  assert.equal(a.m7.getSnapshot().request_count, before);
  assert.equal(f.host.getSnapshot().cycle_b, undefined);
});

test('26 external M3 permission remains independent from all M7 purposes', async () => {
  const f = await fixture(); await prepareStarted(f);
  const a = f.host.getSnapshot().cycle_a;
  assert.equal(a.store.getSnapshot().tasks[0].permission_granted, true);
  assert.equal(a.m7.getSnapshot().request_count, 0);
});

test('27 W01 production activation remains false', () => {
  assert.equal(W01.real_user_activation, false);
  assert.equal(W01.independent_clinical_review, 'NOT_RUN');
});

test('28 fixture cannot leak into default production app-host path', async () => {
  const owner = await ownerFixture(); const host = createTrainerRuntimeAppHost();
  host.setBinding(owner.binding);
  assert.equal(host.journey.getView().state, 'UNAVAILABLE');
  assert.equal(host.getSnapshot().cycle_a.store.selfWalk.getSnapshot().state, 'IDLE');
  assert.equal(host.getSnapshot().cycle_a.store.selfWalk.chooseAndStart(undefined, {},
    'production-fixture-forbidden').state, 'DENIED');
});

test('29 RELEASE 8 catalogs contain every semantic key', () => {
  for (const locale of ['vi', 'en', 'zh-Hans', 'es', 'hi', 'ja', 'ko', 'ru']) {
    const copy = i18nJourney.trainerJourneyCopy(locale);
    for (const key of i18nJourney.TRAINER_JOURNEY_KEYS) {
      assert.equal(typeof copy[key], 'string'); assert.ok(copy[key].trim());
    }
  }
});

test('30 locale change changes copy only and performs no domain operation', async () => {
  const f = await fixture(); await prepareAction(f);
  const a = f.host.getSnapshot().cycle_a;
  const action = a.store.selfWalk.getSnapshot();
  const requests = a.m7.getSnapshot().request_count;
  for (const locale of ['vi', 'en', 'zh-Hans', 'es', 'hi', 'ja', 'ko', 'ru']) {
    i18nJourney.trainerJourneyCopy(locale);
  }
  assert.equal(a.store.selfWalk.getSnapshot(), action);
  assert.equal(a.m7.getSnapshot().request_count, requests);
});

function cardRenderer(journey, locale = 'vi') {
  const sourcePromise = readFile(new URL('../components/TrainerJourneyCard.tsx', import.meta.url), 'utf8');
  return sourcePromise.then(source => {
    const code = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React, esModuleInterop: true,
    } }).outputText;
    const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
    const native = { Pressable: 'Pressable', Text: 'Text', View: 'View',
      StyleSheet: { create: value => value } };
    const mod = { exports: {} };
    new Script(code).runInNewContext({ exports: mod.exports, module: mod,
      require(name) {
        if (name === 'react') return { __esModule: true, default: react, ...react };
        if (name === 'react-native') return native;
        if (name === '@/i18n-trainer-journey') return i18nJourney;
        if (name === '@/hooks/useColors') return { useColors: () => ({}) };
        throw Error(`Unexpected card dependency: ${name}`);
      } });
    let tree;
    const walk = (node, found = []) => {
      if (Array.isArray(node)) { for (const child of node) walk(child, found); return found; }
      if (!node || typeof node !== 'object') return found;
      found.push(node); walk(node.props?.children, found); return found;
    };
    const render = () => { tree = mod.exports.TrainerJourneyCard({
      journey: Object.freeze({ view: journey.getView(), commands: journey.commands }), locale,
    }); };
    const find = id => walk(tree).find(node => node.props?.testID === id);
    const textValues = () => walk(tree).filter(node => node.type === 'Text')
      .flatMap(node => node.props.children.flat(Infinity)).filter(value => typeof value === 'string');
    const press = id => { const node = find(id); assert.ok(node, `Missing ${id}`); node.props.onPress(); render(); };
    render();
    return { find, press, render, textValues, locale(value) { locale = value; render(); } };
  });
}

test('31 actual TrainerJourneyCard render/click path covers accept through B and stale click', async () => {
  const f = await fixture(); await submitGoal(f); command(f, 'acceptGoal');
  const card = await cardRenderer(f.journey);
  assert.ok(card.find('trainer-journey-fixture-badge'));
  const staleAccept = card.find('trainer-journey-accept-action').props.onPress;
  card.press('trainer-journey-accept-action'); staleAccept();
  card.press('trainer-journey-start-action');
  card.press('trainer-journey-open-outcome');
  assert.equal(card.find('trainer-outcome-record').props.disabled, true);
  for (const id of ['trainer-outcome-did', 'trainer-outcome-stopped-no',
    'trainer-outcome-problem-none', 'trainer-outcome-unchanged',
    'trainer-outcome-constraint-none']) card.press(id);
  assert.equal(card.find('trainer-outcome-record').props.disabled, false);
  card.press('trainer-outcome-record');
  card.locale('ja');
  card.press('trainer-journey-allow-next');
  card.press('trainer-journey-revoke-next');
  card.press('trainer-journey-allow-next');
  card.press('trainer-journey-create-next');
  assert.equal(f.journey.getView().cycle, 'B');
  assert.ok(card.find('trainer-journey-history'));
  assert.equal(networkCalls, 0);
});

test('S1 manual Stop is available immediately after Start without M7', async () => {
  const f = await fixture(); await prepareStarted(f);
  assert.equal(command(f, 'stopAction'), true);
  assert.equal(f.journey.getView().action?.state, 'STOPPED');
  assert.equal(f.host.getSnapshot().cycle_a.m7.getSnapshot().request_count, 0);
});

test('S1 PROBLEM selection holds started guidance before Record', async () => {
  const f = await fixture(); await prepareStarted(f);
  assert.equal(command(f, 'openOutcomeDraft'), true);
  assert.equal(command(f, 'updateOutcomeDraft', { problem_state: 'PROBLEM' }), true);
  assert.notEqual(f.host.getSnapshot().cycle_a.store.selfWalk.getSnapshot().state, 'STARTED');
  assert.equal(f.host.getSnapshot().cycle_a.m7.getSnapshot().request_count, 0);
});

test('S1 UNKNOWN with REASSESS round-trips without becoming CLEAR', async () => {
  const f = await fixture(); await prepareStarted(f);
  assert.equal(command(f, 'openOutcomeDraft'), true);
  fillDraft(f, { problem_state: 'UNKNOWN', safety_disposition: 'REASSESS' });
  assert.equal(command(f, 'recordOutcome'), true);
  assert.equal(f.journey.getView().outcome?.facts?.problem_state, 'UNKNOWN');
  assert.equal(f.journey.getView().outcome?.facts?.safety_disposition, 'REASSESS');
});

test('S1 A adverse correction permanently invalidates raw accepted B Start', async () => {
  const f = await fixture(); await readyForB(f);
  assert.equal(command(f, 'createNextCycle').state, 'CREATED');
  await submitGoal(f, 'B goal');
  assert.equal(command(f, 'acceptGoal'), true);
  const b = f.host.getSnapshot().cycle_b;
  const bRef = b.store.reference();
  const proposal = b.store.selfWalk.getSnapshot();
  assert.equal(command(f, 'acceptAction'), true);
  assert.equal(command(f, 'openHistoryCorrection'), true);
  assert.equal(command(f, 'updateOutcomeDraft', {
    problem_state: 'PROBLEM', safety_disposition: 'REASSESS',
  }), true);
  assert.equal(command(f, 'recordOutcome'), true);
  assert.equal(b.store.selfWalk.start(bRef, proposal, 'red-stale-b-start').state, 'DENIED');
});

test('S1 Stop while editor is open keeps an optional episode and no inferred outcome', async () => {
  const f = await fixture(); await prepareStarted(f);
  const a = f.host.getSnapshot().cycle_a;
  const ref = a.store.reference();
  const proposal = a.store.selfWalk.getSnapshot();
  assert.equal(command(f, 'openOutcomeDraft'), true);
  assert.equal(command(f, 'stopAction'), true);
  assert.equal(a.store.selfWalk.getSnapshot().state, 'STOPPED');
  assert.ok(a.store.selfWalk.getEpisode(ref));
  assert.equal(a.m7.getSnapshot().request_count, 0);
  assert.equal(a.store.selfWalk.start(ref, proposal, 'after-stop').state, 'DENIED');
  assert.equal(command(f, 'recordOutcome'), false);
  fillDraft(f, { execution_extent: 'SKIPPED', user_stopped: true });
  assert.equal(command(f, 'recordOutcome'), true);
  assert.equal(f.journey.getView().outcome.facts.user_stopped, true);
});

test('S2 manual Stop remains available through a stale presentation token after Start', async () => {
  const f = await fixture(); await prepareStarted(f);
  const staleToken = token(f);
  assert.equal(command(f, 'openOutcomeDraft'), true);
  assert.notEqual(token(f), staleToken);
  assert.equal(f.journey.commands.stopAction(staleToken), true);
  const a = f.host.getSnapshot().cycle_a;
  assert.equal(a.store.selfWalk.getSnapshot().state, 'STOPPED');
  assert.equal(a.m7.getSnapshot().request_count, 0);
});

test('S2 current text signal after Start locally retires guidance before model result', async () => {
  const f = await fixture(); await prepareStarted(f);
  const a = f.host.getSnapshot().cycle_a;
  assert.equal(command(f, 'submitGoal', { text: 'Đang chạy thì tôi tức ngực.', locale: 'vi',
    permission_granted: true }), true);
  assert.equal(a.store.getTrainerActionAvailability(), 'SAFETY_HOLD');
  assert.equal(a.store.selfWalk.getSnapshot().state, 'INVALIDATED');
  await tick(); await tick();
  const task = a.store.getSnapshot().tasks.find(item => item.task_id === a.store.getSnapshot().active_task_id);
  assert.equal(task.interpretation.safety_state, 'URGENT');
  assert.equal(task.status, 'PAUSED');
  assert.equal(a.m7.getSnapshot().request_count, 0);
});

test('S1 unrecorded PROBLEM survives discard, locale, and a new task', async () => {
  const f = await fixture(); await prepareStarted(f);
  assert.equal(command(f, 'openOutcomeDraft'), true);
  assert.equal(command(f, 'updateOutcomeDraft', { problem_state: 'PROBLEM' }), true);
  const a = f.host.getSnapshot().cycle_a;
  const safety = a.store.getTrainerSafetySnapshot();
  assert.equal(safety.state, 'HOLD');
  assert.equal(command(f, 'discardOutcomeDraft'), true);
  i18nJourney.trainerJourneyCopy('ja');
  assert.equal(a.store.getTrainerSafetySnapshot().revision, safety.revision);
  assert.equal(a.store.getTrainerActionAvailability(), 'SAFETY_HOLD');
  assert.equal(command(f, 'submitGoal', { text: 'Cứ cho tôi tiếp tục', locale: 'vi',
    permission_granted: true }), true);
  await tick(); await tick();
  assert.equal(a.store.getTrainerActionAvailability(), 'SAFETY_HOLD');
  assert.equal(command(f, 'acceptGoal'), false);
  assert.equal(a.m7.getSnapshot().request_count, 0);
});

test('S1 UNKNOWN action-relevant holds but unrelated execution UNKNOWN does not', async () => {
  const f = await fixture(); await prepareStarted(f);
  assert.equal(command(f, 'openOutcomeDraft'), true);
  assert.equal(command(f, 'updateOutcomeDraft', { execution_extent: 'UNKNOWN' }), true);
  assert.equal(f.host.getSnapshot().cycle_a.store.getTrainerSafetySnapshot().state, 'OPEN');
  assert.equal(command(f, 'updateOutcomeDraft', { problem_state: 'UNKNOWN',
    safety_disposition: 'REASSESS' }), true);
  assert.equal(f.host.getSnapshot().cycle_a.store.getTrainerSafetySnapshot().state, 'HOLD');
  assert.equal(command(f, 'discardOutcomeDraft'), true);
  assert.equal(f.host.getSnapshot().cycle_a.store.getTrainerSafetySnapshot().state, 'HOLD');
});

test('S1 UNKNOWN + CLEAR is rejected by the M7 contract', async () => {
  const f = await fixture(); await prepareStarted(f);
  assert.equal(command(f, 'openOutcomeDraft'), true);
  fillDraft(f, { problem_state: 'UNKNOWN', safety_disposition: 'CLEAR' });
  assert.equal(command(f, 'recordOutcome'), false);
  assert.equal(f.journey.getView().outcome, undefined);
});

test('S1 recorded adverse permits B reassessment but no new B action', async () => {
  const f = await fixture(); await recordOutcome(f, { problem_state: 'PROBLEM',
    safety_disposition: 'REASSESS' });
  assert.equal(command(f, 'allowNextUse'), true);
  assert.equal(command(f, 'createNextCycle').state, 'CREATED');
  const b = f.host.getSnapshot().cycle_b;
  assert.equal(b.store.getTrainerActionAvailability(), 'REASSESS_REQUIRED');
  assert.equal(command(f, 'submitGoal', { text: 'B reassessment', locale: 'vi',
    permission_granted: true }), true);
  await tick(); await tick();
  assert.equal(command(f, 'acceptGoal'), false);
  assert.equal(b.store.selfWalk.getSnapshot().state, 'IDLE');
});

test('S1 A correction invalidates proposed B; observer throw cannot prevent it', async () => {
  const f = await fixture(); await readyForB(f);
  assert.equal(command(f, 'createNextCycle').state, 'CREATED');
  await submitGoal(f, 'B goal');
  assert.equal(command(f, 'acceptGoal'), true);
  const b = f.host.getSnapshot().cycle_b;
  const oldRef = b.store.reference();
  const oldProposal = b.store.selfWalk.getSnapshot();
  const a = f.host.getSnapshot().cycle_a;
  let laterObserver = 0;
  a.store.m7Outcome.subscribe(() => { throw Error('observer'); });
  a.store.m7Outcome.subscribe(() => { laterObserver++; });
  assert.equal(command(f, 'openHistoryCorrection'), true);
  assert.equal(command(f, 'updateOutcomeDraft', { problem_state: 'PROBLEM',
    safety_disposition: 'REASSESS' }), true);
  assert.equal(command(f, 'recordOutcome'), true);
  assert.equal(b.store.getTrainerActionAvailability(), 'BASIS_STALE');
  assert.equal(b.store.selfWalk.accept(oldRef, oldProposal, 'stale-proposal').state, 'DENIED');
  assert.ok(laterObserver >= 1);
});

test('S1 A correction interrupts started B guidance and cannot revive on re-grant', async () => {
  const f = await fixture(); await readyForB(f);
  assert.equal(command(f, 'createNextCycle').state, 'CREATED');
  await prepareStarted(f);
  const b = f.host.getSnapshot().cycle_b;
  const old = b.store.selfWalk.getSnapshot();
  const oldRef = old.scope;
  assert.equal(command(f, 'openHistoryCorrection'), true);
  assert.equal(command(f, 'updateOutcomeDraft', { problem_state: 'PROBLEM',
    safety_disposition: 'REASSESS' }), true);
  assert.equal(command(f, 'recordOutcome'), true);
  assert.equal(b.store.selfWalk.getSnapshot().state, 'INVALIDATED');
  assert.equal(b.store.selfWalk.start(oldRef, old, 'stale-start-again').state, 'DENIED');
  assert.equal(command(f, 'stopAction'), true);
  assert.equal(b.store.selfWalk.getSnapshot().state, 'STOPPED');
});

test('S1 direct A correction invalidates B while preserving completed B facts', async () => {
  const f = await fixture(); await readyForB(f);
  assert.equal(command(f, 'createNextCycle').state, 'CREATED');
  await prepareStarted(f);
  assert.equal(command(f, 'openOutcomeDraft'), true);
  fillDraft(f);
  assert.equal(command(f, 'recordOutcome'), true);
  const b = f.host.getSnapshot().cycle_b;
  const before = f.journey.getView().outcome;
  const a = f.host.getSnapshot().cycle_a;
  const aState = f.stores.find(item => item.cycle === 'A');
  assert.ok(aState);
  const aRef = a.store.reference();
  const aReceipt = a.m7.getSnapshot().record_outcome_receipt;
  const aOutcome = a.store.m7Outcome.getSnapshot(aReceipt);
  assert.equal(a.store.m7Outcome.correct(aRef, aReceipt, aOutcome.revision, {
    request_id: 'direct-a-adverse', ...basicOutcome,
    problem_state: 'PROBLEM', safety_disposition: 'REASSESS',
  }).state, 'ACTIVE');
  assert.equal(b.store.getTrainerActionAvailability(), 'BASIS_STALE');
  assert.equal(b.store.selfWalk.getSnapshot().state, 'INVALIDATED');
  assert.deepEqual(f.journey.getView().outcome?.facts, before.facts);
});

test('S1 owner retirement removes volatile Safety and started action', async () => {
  const f = await fixture(); await prepareStarted(f);
  const a = f.host.getSnapshot().cycle_a;
  assert.equal(command(f, 'openOutcomeDraft'), true);
  assert.equal(command(f, 'updateOutcomeDraft', { problem_state: 'PROBLEM' }), true);
  assert.equal(a.store.getTrainerSafetySnapshot().state, 'HOLD');
  f.host.setBinding(undefined);
  assert.equal(a.store.getTrainerSafetySnapshot().state, 'UNAVAILABLE');
  assert.equal(a.store.selfWalk.getSnapshot().state, 'UNAVAILABLE');
  assert.equal(f.journey.getView().state, 'UNAVAILABLE');
});

test('S1 RELEASE 8 present Stop and hold without issuing a command on locale switch', async () => {
  const f = await fixture(); await prepareStarted(f);
  const a = f.host.getSnapshot().cycle_a;
  const card = await cardRenderer(f.journey);
  for (const locale of ['vi', 'en', 'zh-Hans', 'es', 'hi', 'ja', 'ko', 'ru']) {
    card.locale(locale);
    assert.ok(card.find('trainer-journey-stop-action'));
    assert.notEqual(i18nJourney.trainerJourneyCopy(locale)['trainerJourney.action.stop'], '');
  }
  assert.equal(a.store.selfWalk.getSnapshot().state, 'STARTED');
  card.press('trainer-journey-open-outcome');
  card.press('trainer-outcome-problem');
  assert.ok(card.find('trainer-journey-safety-hold'));
  assert.equal(card.find('trainer-journey-action-title'), undefined);
  assert.ok(card.find('trainer-journey-stop-action'));
  assert.equal(a.m7.getSnapshot().request_count, 0);
});

test('S1 urgent draft keeps medical help visible while HOLD hides executable guidance', async () => {
  const f = await fixture(); await prepareStarted(f);
  const a = f.host.getSnapshot().cycle_a;
  const card = await cardRenderer(f.journey);
  card.press('trainer-journey-open-outcome');
  card.press('trainer-outcome-problem');
  card.press('trainer-outcome-urgent');
  const safety = a.store.getTrainerSafetySnapshot();
  const action = a.store.selfWalk.getSnapshot();
  assert.equal(f.journey.getView().action_availability, 'SAFETY_HOLD');
  assert.equal(card.find('trainer-journey-action-title'), undefined);
  assert.equal(card.find('trainer-journey-start-action'), undefined);
  assert.equal(card.textValues().includes(i18nJourney.trainerJourneyCopy('vi')
    ['trainerJourney.action.instructions']), false);
  assert.equal(card.textValues().includes(i18nJourney.trainerJourneyCopy('vi')
    ['trainerJourney.action.warning']), false);
  assert.ok(card.find('trainer-journey-stop-action'));
  assert.equal(card.find('trainer-journey-urgent-help').props.children[0],
    i18nJourney.trainerJourneyCopy('vi')['trainerJourney.safety.urgentHelp']);
  assert.equal(f.journey.getView().outcome, undefined);
  assert.equal(a.m7.getSnapshot().request_count, 0);
  assert.equal(a.m7.getSnapshot().record_outcome_receipt, undefined);
  assert.equal(a.m7.getSnapshot().use_next_cycle_receipt, undefined);
  for (const locale of ['vi', 'en', 'zh-Hans', 'es', 'hi', 'ja', 'ko', 'ru']) {
    card.locale(locale);
    assert.equal(card.find('trainer-journey-urgent-help').props.children[0],
      i18nJourney.trainerJourneyCopy(locale)['trainerJourney.safety.urgentHelp']);
    assert.deepEqual(a.store.getTrainerSafetySnapshot(), safety);
    assert.equal(a.store.selfWalk.getSnapshot(), action);
    assert.equal(a.m7.getSnapshot().request_count, 0);
    assert.equal(a.m7.getSnapshot().record_outcome_receipt, undefined);
    assert.equal(a.m7.getSnapshot().use_next_cycle_receipt, undefined);
  }
  card.press('trainer-outcome-reassess');
  assert.equal(card.find('trainer-journey-urgent-help'), undefined);
  assert.equal(f.journey.getView().action_availability, 'SAFETY_HOLD');
  card.press('trainer-outcome-problem-unknown');
  assert.equal(f.journey.getView().draft.problem_state, 'UNKNOWN');
  assert.equal(f.journey.getView().draft.safety_disposition, 'REASSESS');
  assert.equal(card.find('trainer-journey-urgent-help'), undefined);
  card.press('trainer-outcome-cancel');
  assert.equal(f.journey.getView().action_availability, 'SAFETY_HOLD');
  assert.equal(card.find('trainer-journey-action-title'), undefined);
  assert.ok(card.find('trainer-journey-stop-action'));
  card.press('trainer-journey-stop-action');
  assert.equal(a.store.selfWalk.getSnapshot().state, 'STOPPED');
  assert.equal(a.m7.getSnapshot().request_count, 0);
});

test('S1 recorded urgent outcome retains medical help on HOLD without executable action', async () => {
  const f = await fixture(); await prepareStarted(f);
  assert.equal(command(f, 'openOutcomeDraft'), true);
  fillDraft(f, { problem_state: 'PROBLEM', safety_disposition: 'URGENT_HELP' });
  assert.equal(command(f, 'recordOutcome'), true);
  const card = await cardRenderer(f.journey);
  assert.equal(f.journey.getView().action_availability, 'SAFETY_HOLD');
  assert.equal(card.find('trainer-journey-urgent-help').props.children[0],
    i18nJourney.trainerJourneyCopy('vi')['trainerJourney.safety.urgentHelp']);
  assert.equal(card.find('trainer-journey-action-title'), undefined);
  assert.equal(card.find('trainer-journey-start-action'), undefined);
});

test('S1 RELEASE 8 urgent medical copy keeps urgent and review meanings distinct', () => {
  const expected = {
    vi: ['Hãy tìm trợ giúp y tế khẩn cấp tại nơi bạn đang ở.', 'Cần trợ giúp y tế khẩn cấp',
      'cơn đau mới hoặc đáng lo', 'đột ngột yếu một bên'],
    en: ['Seek urgent medical help where you are.', 'Urgent medical help needed',
      'new or concerning pain', 'sudden one-sided weakness'],
    'zh-Hans': ['请立即在您所在地区寻求紧急医疗帮助。', '需要紧急医疗帮助',
      '新的或令人担忧的疼痛', '突然单侧无力'],
    es: ['Busca atención médica urgente donde te encuentres.', 'Se necesita atención médica urgente',
      'dolor nuevo o preocupante', 'debilidad repentina de un lado'],
    hi: ['आप जहाँ हैं, वहीं तुरंत आपातकालीन चिकित्सा सहायता लें।', 'आपातकालीन चिकित्सा सहायता आवश्यक है',
      'नया या चिंताजनक दर्द', 'अचानक शरीर के एक तरफ कमजोरी'],
    ja: ['今いる場所で、すぐに緊急の医療支援を求めてください。', '緊急の医療支援が必要',
      '新たな痛みや気になる痛み', '突然の片側の脱力'],
    ko: ['현재 있는 곳에서 즉시 응급 의료 도움을 받으세요.', '응급 의료 도움이 필요해요',
      '새롭거나 걱정되는 통증', '갑작스러운 한쪽 몸의 힘 빠짐'],
    ru: ['Немедленно обратитесь за экстренной медицинской помощью по месту нахождения.',
      'Требуется экстренная медицинская помощь', 'новая или тревожная боль',
      'внезапной слабости с одной стороны тела'],
  };
  for (const [locale, [help, label, newPain, suddenWeakness]] of Object.entries(expected)) {
    const copy = i18nJourney.trainerJourneyCopy(locale);
    assert.equal(copy['trainerJourney.safety.urgentHelp'], help);
    assert.equal(copy['trainerJourney.outcome.urgent'], label);
    assert.ok(copy['trainerJourney.action.warning'].includes(newPain));
    assert.ok(copy['trainerJourney.action.warning'].includes(suddenWeakness));
    assert.doesNotMatch(label,
      /or professional|或专业|o profesional|या पेशेवर|または専門|또는 전문|или профессион/iu);
    assert.notEqual(copy['trainerJourney.outcome.reassess'], label);
  }
});

test('S1 A revoke then regrant cannot revive an accepted B proposal', async () => {
  const f = await fixture(); await readyForB(f);
  assert.equal(command(f, 'createNextCycle').state, 'CREATED');
  await submitGoal(f, 'B goal');
  assert.equal(command(f, 'acceptGoal'), true);
  const b = f.host.getSnapshot().cycle_b;
  const oldRef = b.store.reference();
  const oldProposal = b.store.selfWalk.getSnapshot();
  assert.equal(command(f, 'acceptAction'), true);
  const a = f.host.getSnapshot().cycle_a;
  assert.equal(a.m7.revokeNextCycle({ type: 'USER_REVOKED_NEXT_CYCLE',
    request_id: 's1-revoke-source' }).state, 'REVOKED');
  assert.equal(a.m7.allowNextCycle({ type: 'USER_ALLOWED_NEXT_CYCLE',
    request_id: 's1-regrant-source' }).state, 'GRANTED');
  assert.equal(b.store.getTrainerActionAvailability(), 'BASIS_STALE');
  assert.equal(b.store.selfWalk.start(oldRef, oldProposal, 's1-regrant-old-start').state, 'DENIED');
});

test('S1 same-looking A correction advances basis and invalidates B old Start', async () => {
  const f = await fixture(); await readyForB(f);
  assert.equal(command(f, 'createNextCycle').state, 'CREATED');
  await submitGoal(f, 'B goal');
  assert.equal(command(f, 'acceptGoal'), true);
  const b = f.host.getSnapshot().cycle_b;
  const oldRef = b.store.reference();
  const oldProposal = b.store.selfWalk.getSnapshot();
  assert.equal(command(f, 'acceptAction'), true);
  const a = f.host.getSnapshot().cycle_a;
  const receipt = a.m7.getSnapshot().record_outcome_receipt;
  const prior = a.store.m7Outcome.getSnapshot(receipt);
  const corrected = a.store.m7Outcome.correct(a.store.reference(), receipt,
    prior.revision, { request_id: 's1-same-looking', ...basicOutcome });
  assert.equal(corrected.state, 'ACTIVE');
  assert.equal(b.store.selfWalk.start(oldRef, oldProposal, 's1-old-start').state, 'DENIED');
  assert.equal(b.store.getTrainerActionAvailability(), 'BASIS_STALE');
});

test('S1 manual Stop succeeds with a full action request ledger', async () => {
  const f = await fixture(); await prepareAction(f);
  const a = f.host.getSnapshot().cycle_a;
  const ref = a.store.reference();
  let proposal = a.store.selfWalk.getSnapshot();
  for (let index = 2; index <= 126; index++) {
    assert.equal(a.store.selfWalk.reportContext(ref, { ...walkContext,
      source_ref: `ledger-${index}` }), true);
    proposal = a.store.selfWalk.propose(ref, `ledger-propose-${index}`);
    assert.equal(proposal.state, 'PROPOSED');
  }
  assert.equal(a.store.selfWalk.accept(ref, proposal, 'ledger-accept').state, 'ACCEPTED');
  assert.equal(a.store.selfWalk.start(ref, proposal, 'ledger-start').state, 'STARTED');
  assert.equal(a.store.selfWalk.stop(ref, proposal, 'ledger-stop').state, 'STOPPED');
  assert.equal(a.m7.getSnapshot().request_count, 0);
});

test('S1 selective dependent B provenance invalidates old accepted action', async () => {
  const f = await fixture(); await readyForB(f);
  assert.equal(command(f, 'createNextCycle').state, 'CREATED');
  await submitGoal(f, 'B dependent goal');
  const b = f.host.getSnapshot().cycle_b;
  const task = b.store.getSnapshot().tasks.find(item => item.task_id === b.store.getSnapshot().active_task_id);
  const prior = b.store.readM7NextCycleContext(b.store.reference());
  assert.deepEqual(task.interpretation.used_context_ids, [prior.id]);
  assert.equal(command(f, 'acceptGoal'), true);
  const oldRef = b.store.reference();
  const oldProposal = b.store.selfWalk.getSnapshot();
  assert.equal(command(f, 'acceptAction'), true);
  const a = f.host.getSnapshot().cycle_a;
  const receipt = a.m7.getSnapshot().record_outcome_receipt;
  const outcome = a.store.m7Outcome.getSnapshot(receipt);
  assert.equal(a.store.m7Outcome.correct(a.store.reference(), receipt, outcome.revision, {
    request_id: 'selective-dependent-change', ...basicOutcome,
    problem_state: 'PROBLEM', safety_disposition: 'REASSESS',
  }).state, 'ACTIVE');
  assert.equal(b.store.selfWalk.start(oldRef, oldProposal, 'selective-dependent-start').state, 'DENIED');
});

async function inactiveDependentPair({ historicalOutcome = false } = {}) {
  const f = await fixture({ usesPriorInBDecision: content => content.current_text === 'B dependent D' });
  await readyForB(f);
  assert.equal(command(f, 'createNextCycle').state, 'CREATED');
  await submitGoal(f, 'B dependent D');
  const b = f.host.getSnapshot().cycle_b;
  const dId = b.store.getSnapshot().active_task_id;
  const prior = b.store.readM7NextCycleContext(b.store.reference());
  assert.deepEqual(b.store.getSnapshot().tasks.find(task => task.task_id === dId)
    .interpretation.used_context_ids, [prior.id]);
  assert.equal(command(f, 'acceptGoal'), true);
  assert.equal(command(f, 'acceptAction'), true);
  const dRef = b.store.reference();
  const dProposal = b.store.selfWalk.getSnapshot();
  let historical;
  if (historicalOutcome) {
    assert.equal(command(f, 'startAction'), true);
    assert.equal(command(f, 'openOutcomeDraft'), true);
    fillDraft(f);
    assert.equal(command(f, 'recordOutcome'), true);
    const recordReceipt = b.m7.getSnapshot().record_outcome_receipt;
    historical = { recordReceipt, before: b.store.m7Outcome.getSnapshot(recordReceipt) };
    assert.equal(historical.before.state, 'ACTIVE');
  }

  await submitGoal(f, 'B independent I');
  const iId = b.store.getSnapshot().active_task_id;
  const iBefore = b.store.getSnapshot().tasks.find(task => task.task_id === iId);
  assert.notEqual(iId, dId);
  assert.deepEqual(iBefore.interpretation.used_context_ids, []);
  assert.equal(command(f, 'acceptGoal'), true);
  const iRef = b.store.reference();
  const iProposal = b.store.selfWalk.getSnapshot();
  assert.equal(command(f, 'acceptAction'), true);
  const beforeRevision = b.store.getSnapshot().revision;
  const beforeRoutes = f.captures.B.length;
  return { f, b, dId, dRef, dProposal, iId, iBefore, iRef, iProposal,
    beforeRevision, beforeRoutes, historical, prior };
}

function assertInactivePairAfterSourceChange(pair, requestId) {
  const { f, b, dId, dRef, dProposal, iId, iBefore, iRef, iProposal,
    beforeRevision, beforeRoutes, historical, prior } = pair;
  const after = b.store.getSnapshot();
  const dAfter = after.tasks.find(task => task.task_id === dId);
  assert.equal(dAfter.interpretation, undefined);
  assert.equal(dAfter.status, 'PAUSED');
  assert.equal(dAfter.revision, dRef.revision);
  assert.equal(JSON.stringify(dAfter).includes(prior.id), false);
  assert.equal(after.tasks.find(task => task.task_id === iId).interpretation, iBefore.interpretation);
  assert.equal(after.tasks.find(task => task.task_id === iId).revision, iBefore.revision);
  assert.equal(after.revision, beforeRevision);
  assert.equal(f.captures.B.length, beforeRoutes);
  assert.equal(b.store.getTrainerSafetySnapshot().state, 'OPEN');
  assert.equal(b.store.getTrainerActionAvailability(), 'AVAILABLE');
  assert.equal(b.store.selfWalk.start(iRef, iProposal, `${requestId}-independent-start`).state, 'STARTED');
  if (historical) {
    const retained = b.store.m7Outcome.getSnapshot(historical.recordReceipt);
    assert.equal(retained.state, 'ACTIVE');
    assert.deepEqual(retained.outcome, historical.before.outcome);
  }
  assert.equal(b.store.selfWalk.start(dRef, dProposal, `${requestId}-dependent-old-start`).state, 'DENIED');
  assert.equal(b.store.switchTask(b.store.reference(dId)), true);
  assert.equal(b.store.getTrainerActionAvailability(), 'BASIS_STALE');
  assert.equal(f.captures.B.length, beforeRoutes);
}

test('S1 inactive dependent B claim is removed while active independent B remains usable', async () => {
  const pair = await inactiveDependentPair();
  const { f } = pair;
  const a = f.host.getSnapshot().cycle_a;
  const receipt = a.m7.getSnapshot().record_outcome_receipt;
  const outcome = a.store.m7Outcome.getSnapshot(receipt);
  assert.equal(a.store.m7Outcome.correct(a.store.reference(), receipt, outcome.revision, {
    request_id: 'inactive-dependent-adverse', ...basicOutcome,
    problem_state: 'PROBLEM', safety_disposition: 'REASSESS',
  }).state, 'ACTIVE');
  assertInactivePairAfterSourceChange(pair, 'adverse');
});

test('S1 inactive D cleanup survives same-looking revision, revoke/regrant, delete and RECORD revoke', async () => {
  for (const operation of ['SAME_VALUE', 'REGRANT', 'DELETE', 'RECORD_REVOKE']) {
    const pair = await inactiveDependentPair();
    const { f, b } = pair;
    const a = f.host.getSnapshot().cycle_a;
    const receipt = a.m7.getSnapshot().record_outcome_receipt;
    const outcome = a.store.m7Outcome.getSnapshot(receipt);
    if (operation === 'SAME_VALUE') {
      assert.equal(a.store.m7Outcome.correct(a.store.reference(), receipt, outcome.revision,
        { request_id: 'inactive-same-value', ...basicOutcome }).state, 'ACTIVE');
    } else if (operation === 'REGRANT') {
      assert.equal(a.m7.revokeNextCycle({ type: 'USER_REVOKED_NEXT_CYCLE',
        request_id: 'inactive-revoke' }).state, 'REVOKED');
      assert.equal(a.m7.allowNextCycle({ type: 'USER_ALLOWED_NEXT_CYCLE',
        request_id: 'inactive-regrant' }).state, 'GRANTED');
    } else if (operation === 'DELETE') {
      assert.equal(a.store.m7Outcome.delete(a.store.reference(), receipt, outcome.revision,
        'inactive-delete').state, 'UNKNOWN');
      assert.equal(b.store.readM7NextCycleContext(pair.iRef), undefined);
    } else {
      a.m7.revokeRecordOutcome({ type: 'TRUSTED_REVOKED_OUTCOME', request_id: 'inactive-record-revoke' });
      assert.equal(b.store.readM7NextCycleContext(pair.iRef), undefined);
    }
    assertInactivePairAfterSourceChange(pair, operation.toLowerCase());
  }
});

test('S1 inactive D cleanup retains an already recorded B outcome as history', async () => {
  const pair = await inactiveDependentPair({ historicalOutcome: true });
  const a = pair.f.host.getSnapshot().cycle_a;
  const receipt = a.m7.getSnapshot().record_outcome_receipt;
  const outcome = a.store.m7Outcome.getSnapshot(receipt);
  assert.equal(a.store.m7Outcome.correct(a.store.reference(), receipt, outcome.revision,
    { request_id: 'inactive-history-adverse', ...basicOutcome,
      problem_state: 'PROBLEM', safety_disposition: 'REASSESS' }).state, 'ACTIVE');
  assertInactivePairAfterSourceChange(pair, 'history');
});

test('S1 owner loss retires both tasks in the same B store', async () => {
  const pair = await inactiveDependentPair();
  pair.f.host.setBinding(undefined);
  assert.equal(pair.b.store.getSnapshot().tasks.length, 0);
  assert.equal(pair.b.store.getTrainerSafetySnapshot().state, 'UNAVAILABLE');
  assert.equal(pair.b.store.selfWalk.getSnapshot().state, 'UNAVAILABLE');
});

test('S1 selective independent B provenance survives A adverse change', async () => {
  const f = await fixture({ independentB: true }); await readyForB(f);
  assert.equal(command(f, 'createNextCycle').state, 'CREATED');
  await submitGoal(f, 'B independent goal');
  const b = f.host.getSnapshot().cycle_b;
  const task = b.store.getSnapshot().tasks.find(item => item.task_id === b.store.getSnapshot().active_task_id);
  assert.deepEqual(task.interpretation.used_context_ids, []);
  assert.equal(command(f, 'acceptGoal'), true);
  const oldRef = b.store.reference();
  const oldProposal = b.store.selfWalk.getSnapshot();
  assert.equal(command(f, 'acceptAction'), true);
  const before = b.store.getSnapshot();
  const bRoutes = f.captures.B.length;
  const a = f.host.getSnapshot().cycle_a;
  const receipt = a.m7.getSnapshot().record_outcome_receipt;
  const outcome = a.store.m7Outcome.getSnapshot(receipt);
  assert.equal(a.store.m7Outcome.correct(a.store.reference(), receipt, outcome.revision, {
    request_id: 'selective-independent-change', ...basicOutcome,
    problem_state: 'PROBLEM', safety_disposition: 'REASSESS',
  }).state, 'ACTIVE');
  assert.equal(b.store.getSnapshot().revision, before.revision);
  assert.equal(f.captures.B.length, bRoutes);
  assert.equal(b.store.getTrainerActionAvailability(), 'AVAILABLE');
  assert.equal(b.store.selfWalk.start(oldRef, oldProposal, 'selective-independent-start').state, 'STARTED');
});

test('S1 independent B survives A revoke/regrant, same-looking correction, and delete', async () => {
  for (const operation of ['REGRANT', 'SAME_VALUE', 'DELETE']) {
    const f = await fixture({ independentB: true }); await readyForB(f);
    assert.equal(command(f, 'createNextCycle').state, 'CREATED');
    await submitGoal(f, `B independent ${operation}`);
    const b = f.host.getSnapshot().cycle_b;
    const taskId = b.store.getSnapshot().active_task_id;
    assert.deepEqual(b.store.getSnapshot().tasks.find(item => item.task_id === taskId)
      .interpretation.used_context_ids, []);
    assert.equal(command(f, 'acceptGoal'), true);
    const oldRef = b.store.reference();
    const oldProposal = b.store.selfWalk.getSnapshot();
    assert.equal(command(f, 'acceptAction'), true);
    const beforeRevision = b.store.getSnapshot().revision;
    const beforeRoutes = f.captures.B.length;
    const a = f.host.getSnapshot().cycle_a;
    const receipt = a.m7.getSnapshot().record_outcome_receipt;
    const prior = a.store.m7Outcome.getSnapshot(receipt);
    if (operation === 'REGRANT') {
      assert.equal(a.m7.revokeNextCycle({ type: 'USER_REVOKED_NEXT_CYCLE',
        request_id: 'selective-revoke' }).state, 'REVOKED');
      assert.equal(a.m7.allowNextCycle({ type: 'USER_ALLOWED_NEXT_CYCLE',
        request_id: 'selective-regrant' }).state, 'GRANTED');
    } else if (operation === 'SAME_VALUE') {
      assert.equal(a.store.m7Outcome.correct(a.store.reference(), receipt, prior.revision,
        { request_id: 'selective-same-value', ...basicOutcome }).state, 'ACTIVE');
    } else {
      assert.equal(a.store.m7Outcome.delete(a.store.reference(), receipt, prior.revision,
        'selective-delete').state, 'UNKNOWN');
      assert.equal(b.store.readM7NextCycleContext(oldRef), undefined);
    }
    assert.equal(b.store.getSnapshot().active_task_id, taskId);
    assert.equal(b.store.getSnapshot().revision, beforeRevision);
    assert.equal(f.captures.B.length, beforeRoutes);
    assert.equal(b.store.getTrainerActionAvailability(), 'AVAILABLE');
    assert.equal(b.store.selfWalk.start(oldRef, oldProposal,
      `selective-start-${operation}`).state, 'STARTED');
  }
});

test('S1 A delete invalidates dependent B action without retaining deleted payload', async () => {
  const f = await fixture(); await readyForB(f);
  assert.equal(command(f, 'createNextCycle').state, 'CREATED');
  await submitGoal(f, 'B dependent deletion');
  const b = f.host.getSnapshot().cycle_b;
  const priorContext = b.store.readM7NextCycleContext(b.store.reference());
  assert.deepEqual(b.store.getSnapshot().tasks.find(item => item.task_id === b.store.getSnapshot().active_task_id)
    .interpretation.used_context_ids, [priorContext.id]);
  assert.equal(command(f, 'acceptGoal'), true);
  const oldRef = b.store.reference();
  const oldProposal = b.store.selfWalk.getSnapshot();
  assert.equal(command(f, 'acceptAction'), true);
  const a = f.host.getSnapshot().cycle_a;
  const receipt = a.m7.getSnapshot().record_outcome_receipt;
  const prior = a.store.m7Outcome.getSnapshot(receipt);
  assert.equal(a.store.m7Outcome.correct(a.store.reference(), receipt, prior.revision,
    { request_id: 'selective-dependent-adverse', ...basicOutcome,
      problem_state: 'PROBLEM', safety_disposition: 'URGENT_HELP' }).state, 'ACTIVE');
  const bConsumer = f.stores.find(entry => entry.cycle === 'B').consumer;
  const basisHasPayload = readM7NextCycleBasis(bConsumer, f.owner.binding).includes('URGENT_HELP');
  const current = a.store.m7Outcome.getSnapshot(receipt);
  assert.equal(a.store.m7Outcome.delete(a.store.reference(), receipt, current.revision,
    'selective-dependent-delete').state, 'UNKNOWN');
  assert.equal(b.store.readM7NextCycleContext(b.store.reference()), undefined);
  const derivedStillPresent = b.store.getSnapshot().tasks.find(item => item.task_id === b.store.getSnapshot().active_task_id)
    .interpretation !== undefined;
  assert.deepEqual({ basisHasPayload, derivedStillPresent },
    { basisHasPayload: false, derivedStillPresent: false });
  assert.equal(b.store.getTrainerActionAvailability(), 'BASIS_STALE');
  assert.equal(b.store.selfWalk.start(oldRef, oldProposal,
    'selective-deleted-old-start').state, 'DENIED');
});

test('S1 owner loss retires both dependent and independent B authority', async () => {
  for (const independentB of [false, true]) {
    const f = await fixture({ independentB }); await readyForB(f);
    assert.equal(command(f, 'createNextCycle').state, 'CREATED');
    await submitGoal(f, `B ${independentB ? 'independent' : 'dependent'} owner`);
    assert.equal(command(f, 'acceptGoal'), true);
    const b = f.host.getSnapshot().cycle_b;
    f.host.setBinding(undefined);
    assert.equal(b.store.getTrainerActionAvailability(), 'UNAVAILABLE');
    assert.equal(b.store.selfWalk.getSnapshot().state, 'UNAVAILABLE');
    assert.equal(f.host.getSnapshot().state, 'UNAVAILABLE');
  }
});

test('S1 independent B proposal remains acceptable after A source change', async () => {
  const f = await fixture({ independentB: true }); await readyForB(f);
  assert.equal(command(f, 'createNextCycle').state, 'CREATED');
  await submitGoal(f, 'B independent proposed');
  assert.equal(command(f, 'acceptGoal'), true);
  const b = f.host.getSnapshot().cycle_b;
  const oldRef = b.store.reference();
  const proposal = b.store.selfWalk.getSnapshot();
  const beforeRevision = b.store.getSnapshot().revision;
  const a = f.host.getSnapshot().cycle_a;
  const receipt = a.m7.getSnapshot().record_outcome_receipt;
  const prior = a.store.m7Outcome.getSnapshot(receipt);
  assert.equal(a.store.m7Outcome.correct(a.store.reference(), receipt, prior.revision,
    { request_id: 'independent-proposed-source', ...basicOutcome,
      problem_state: 'PROBLEM', safety_disposition: 'REASSESS' }).state, 'ACTIVE');
  assert.equal(b.store.getSnapshot().revision, beforeRevision);
  assert.equal(b.store.selfWalk.accept(oldRef, proposal,
    'independent-accept-after-source').state, 'ACCEPTED');
  assert.equal(b.store.selfWalk.start(oldRef, proposal,
    'independent-start-after-source').state, 'STARTED');
});

test('S1 production-projected prior ID still marks B as dependent', async () => {
  const f = await fixture({ wirePriorId: true }); await readyForB(f);
  assert.equal(command(f, 'createNextCycle').state, 'CREATED');
  await submitGoal(f, 'B uses projected prior');
  const b = f.host.getSnapshot().cycle_b;
  const prior = b.store.readM7NextCycleContext(b.store.reference());
  const used = b.store.getSnapshot().tasks.find(item => item.task_id === b.store.getSnapshot().active_task_id)
    .interpretation.used_context_ids;
  assert.deepEqual(used, [`m7-prior:${prior.text.toLowerCase().replaceAll('_', '-')}`]);
  assert.notEqual(used[0], prior.id);
  assert.equal(command(f, 'acceptGoal'), true);
  const ref = b.store.reference();
  const proposal = b.store.selfWalk.getSnapshot();
  assert.equal(command(f, 'acceptAction'), true);
  const a = f.host.getSnapshot().cycle_a;
  const receipt = a.m7.getSnapshot().record_outcome_receipt;
  const outcome = a.store.m7Outcome.getSnapshot(receipt);
  assert.equal(a.store.m7Outcome.correct(a.store.reference(), receipt, outcome.revision, {
    request_id: 'projected-prior-change', ...basicOutcome,
    problem_state: 'PROBLEM', safety_disposition: 'REASSESS',
  }).state, 'ACTIVE');
  assert.equal(b.store.selfWalk.start(ref, proposal, 'projected-prior-old-start').state, 'DENIED');
});
