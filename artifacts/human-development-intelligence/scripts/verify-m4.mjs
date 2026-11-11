import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";

// Node 24 strips types. Resolve only local extensionless TS imports; no install,
// bundler, application startup, provider SDK, temporary image or fixture storage.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      return nextResolve(specifier + ".ts", context);
    }
    return nextResolve(specifier, context);
  },
});
globalThis.fetch = () => { throw new Error("NETWORK_FORBIDDEN_IN_M4_TEST"); };
const { resolveM4Context, resolveM4GoalReadiness } = await import("../domain/m4/resolver.ts");
const { createSessionTaskStore } = await import("../domain/session-task/store.ts");
const { validateMeaning } = await import("../../../lib/api-zod/src/m3-meaning.ts");

const meaning = (overrides = {}) => ({
  intent_type: "CURRENT_TASK", interpreted_meaning: "Người dùng muốn đánh giá ảnh bữa ăn.",
  confidence: 0.9, uncertainty: null, missing_context: [],
  clarification_needed: false, clarification_question: null, safety_state: "CLEAR",
  suggested_next_role: "M4", task_kind: "meal_image_assessment",
  context_effect: "NONE", used_context_ids: [], response: "Mình hiểu việc bạn muốn làm.",
  ...overrides,
});
const task = (overrides = {}) => ({
  session_id: "fixture-session", task_id: "fixture-task-a", source_input: "Tôi cần đánh giá bữa ăn bằng hình ảnh.",
  revision: 3, status: "READY", permission_revision: 1, permission_granted: true,
  m3_context: {
    locale: "vi", current_text: "Tôi cần đánh giá bữa ăn bằng hình ảnh.",
    relevant_context: [], recent_relevant_turns: [], user_correction: null,
    safety_signal: "CLEAR", asking_stopped: false,
  },
  interpretation: meaning(),
  ...overrides,
});
const input = (t = task(), image = { state: "absent" }) => ({
  scope: { session_id: t.session_id, task_id: t.task_id, revision: t.revision },
  image,
  permission: { purpose: "meal_image_assessment", status: "unknown", revision: 1 },
  boundary: "within_slice",
});
const available = (t = task()) => ({
  ...input(t, { state: "present", id: "fixture-image-a", usable: true, permission_revision: 1 }),
  permission: { purpose: "meal_image_assessment", status: "allowed", revision: 1 },
});
const decision = (t, c, requirement) => resolveM4Context(t, c, requirement).decision;
const goalMeaning = (overrides = {}) => meaning({
  intent_type: "GOAL",
  interpreted_meaning: "Người dùng muốn khỏe hơn.",
  task_kind: "general_health",
  ...overrides,
});
const goalTask = (overrides = {}) => task({ interpretation: goalMeaning(), ...overrides });
const goalDecision = t => resolveM4GoalReadiness(t).decision;
const tests = [];
const test = (phase, name, run) => tests.push({ phase, name, run });
const unit = (name, run) => test("unit", name, run);
const integration = (name, run) => test("integration", name, run);

unit("CASE 1 clear task/no image requests only meal_image, leaves M3 task unchanged", () => {
  const t = task(); const c = input(t); const before = JSON.stringify({ t, c });
  assert.deepEqual(decision(t, c), { state: "CONTEXT_REQUIRED", missing: ["meal_image"] });
  assert.equal(t.interpretation.intent_type, "CURRENT_TASK");
  assert.equal(t.interpretation.clarification_needed, false);
  assert.equal(JSON.stringify({ t, c }), before);
});
unit("CASE 2 valid image is sufficient only at next-step contract level", () => {
  assert.deepEqual(decision(task(), available()), {
    state: "CONTEXT_SUFFICIENT", sufficient_for: "NEXT_STEP_CONTRACT_ONLY",
    used_context_ids: ["fixture-image-a"],
  });
});
unit("CASE 3 denied/unknown/wrong-purpose image permission does not become missing data", () => {
  for (const patch of [{ status: "denied" }, { status: "unknown" }, { purpose: "m3_intent_understanding" }]) {
    const c = available(); Object.assign(c.permission, patch);
    assert.deepEqual(decision(task(), c), { state: "PERMISSION_REQUIRED", item: "meal_image" });
  }
});
unit("CASE 4 refusal keeps a text-description option without another image question", () => {
  const t = task(); const c = input(t, { state: "declined" });
  const expected = { state: "CONTEXT_DECLINED", alternative: "TEXT_DESCRIPTION_OPTION", ask_again: false };
  assert.deepEqual(decision(t, c), expected);
  assert.deepEqual(decision(t, c), expected);
});
unit("CASE 5 profile/goal/raw text never read for M4 requirements", () => {
  const t = task(); const c = input(t);
  for (const key of ["source_input", "profile", "goal", "age", "weight"]) {
    Object.defineProperty(t, key, { get() { throw new Error("IRRELEVANT_DATA_READ"); } });
    Object.defineProperty(c, key, { get() { throw new Error("IRRELEVANT_DATA_READ"); } });
  }
  Object.defineProperty(t.m3_context, "relevant_context", { get() { throw new Error("PROFILE_CONTEXT_READ"); } });
  assert.deepEqual(decision(t, c), { state: "CONTEXT_REQUIRED", missing: ["meal_image"] });
});
unit("CASE 6 M3 ambiguity uses M3 clarification path without inspecting image context", () => {
  for (const m3 of [meaning({ intent_type: "AMBIGUOUS" }), meaning({ clarification_needed: true })]) {
    const t = task({ status: "AWAITING_INPUT", interpretation: m3 });
    assert.deepEqual(decision(t, null), { state: "NEED_CLARIFICATION", next_role: "M3" });
  }
});
unit("CASE 7 context from another task/session cannot satisfy this task", () => {
  for (const patch of [{ task_id: "fixture-task-b" }, { session_id: "different-session" }]) {
    const c = available(); Object.assign(c.scope, patch);
    assert.deepEqual(decision(task(), c), { state: "DEFERRED", reason: "STALE_CONTEXT" });
  }
  const b = task({ task_id: "fixture-task-b", interpretation: meaning({ task_kind: "workout_adjustment" }) });
  assert.deepEqual(decision(b, available()), { state: "DEFERRED", reason: "UNSUPPORTED_TASK" });
});
unit("CASE 8 stale/future/invalid task revisions cannot produce sufficient context", () => {
  for (const revision of [2, 4, 0, NaN]) {
    const c = available(); c.scope.revision = revision;
    assert.deepEqual(decision(task(), c), { state: "DEFERRED", reason: "STALE_CONTEXT" });
  }
});
unit("CASE 9 revoke after sufficient is observed on the next assessment", () => {
  const t = task(); const c = available(t);
  assert.equal(decision(t, c).state, "CONTEXT_SUFFICIENT");
  c.permission = { ...c.permission, status: "denied", revision: 2 };
  assert.deepEqual(decision(t, c), { state: "PERMISSION_REQUIRED", item: "meal_image" });
  // A later grant does not bless an old image permission revision.
  c.permission = { ...c.permission, status: "allowed" };
  assert.equal(decision(t, c).state, "PERMISSION_REQUIRED");
});
unit("CASE 10 already available data reused without upload or another requirement", () => {
  const t = task(); const c = available(t);
  const a = decision(t, c); const b = decision(t, c);
  assert.deepEqual(a, b);
  assert.equal(b.state, "CONTEXT_SUFFICIENT");
  assert.equal("missing" in b, false);
  assert.ok(Object.isFrozen(b.used_context_ids));
});
unit("host-declared professional boundary stops context gathering", () => {
  const c = input(); c.boundary = "professional_required";
  Object.defineProperty(c, "image", { get() { throw new Error("UNNEEDED_IMAGE_READ"); } });
  assert.deepEqual(decision(task(), c), {
    state: "PROFESSIONAL_HANDOFF_NEEDED", reason: "OUTSIDE_AI_AUTHORITY",
  });
});
unit("safety/STOP/refusal never turn into meal context requests", () => {
  for (const patch of [
    { safety_state: "PAIN" }, { suggested_next_role: "STOP" },
    { intent_type: "SAFETY" }, { intent_type: "OUT_OF_SCOPE" },
    { intent_type: "REFUSAL" }, { intent_type: "STOP_PAUSE" },
  ]) {
    assert.deepEqual(decision(task({ interpretation: meaning(patch) }), null),
      { state: "DEFERRED", reason: "M3_BOUNDARY" });
  }
});
unit("host safety and asking_stopped boundaries are respected", () => {
  const t = task(); t.m3_context.safety_signal = "URGENT";
  assert.equal(decision(t, null).state, "DEFERRED");
  t.m3_context.safety_signal = "CLEAR"; t.m3_context.asking_stopped = true;
  assert.equal(decision(t, available(t)).state, "CONTEXT_SUFFICIENT");
});
unit("unusable image, stale consent, missing interpretation, cancelled and pending tasks fail closed", () => {
  const c = available(); c.image.usable = false;
  assert.deepEqual(decision(task(), c), { state: "DEFERRED", reason: "CONTEXT_UNUSABLE" });
  for (const revision of [0, NaN, 2]) {
    const stale = available(); stale.permission.revision = revision;
    assert.equal(decision(task(), stale).state, "PERMISSION_REQUIRED");
  }
  for (const patch of [{ interpretation: undefined }, { permission_granted: false },
    ...["CANCELLED", "PAUSED", "FAILED", "NEEDS_ROUTING", "UNSUPPORTED"].map(status => ({ status }))]) {
    assert.deepEqual(decision(task(patch), null), { state: "DEFERRED", reason: "TASK_NOT_READY" });
  }
});
unit("task_kind is semantic input, not a literal Vietnamese sentence matcher", () => {
  for (const source_input of ["Please assess my meal photo", "Nhờ xem giúp bữa này", "synthetic paraphrase"]) {
    const t = task({ source_input });
    assert.equal(decision(t, input(t)).state, "CONTEXT_REQUIRED");
  }
  const t = task({ interpretation: meaning({ task_kind: "review_meal_photo" }) });
  assert.equal(decision(t, input(t)).state, "DEFERRED");
  assert.equal(decision(t, input(t), { task_kind: "review_meal_photo", item: "meal_image" }).state, "CONTEXT_REQUIRED");
  assert.equal(decision(task({ interpretation: meaning({ intent_type: "GOAL" }) }), input()).state, "DEFERRED");
});
unit("invalid boundary and unsupported next roles do not open later roles", () => {
  const c = input(); c.boundary = "unknown";
  assert.deepEqual(decision(task(), c), { state: "DEFERRED", reason: "INVALID_CONTEXT" });
  for (const suggested_next_role of ["M5", "M6", "M7"]) {
    assert.equal(decision(task({ interpretation: meaning({ suggested_next_role }) }), null).state, "DEFERRED");
  }
});

unit("GOAL CASE 1 clear structured goals are sufficient without gathering context", () => {
  for (const task_kind of ["general_health", "body_composition", "strength", "movement"]) {
    assert.deepEqual(goalDecision(goalTask({ interpretation: goalMeaning({ task_kind }) })), {
      state: "CONTEXT_SUFFICIENT",
      sufficient_for: "NEXT_STEP_CONTRACT_ONLY",
      used_context_ids: [],
    });
  }
});
unit("GOAL CASE 2 readiness never reads raw text, profile, GoalDraft or conversation fields", () => {
  const t = goalTask();
  for (const key of ["source_input", "profile", "goal", "goalDraft", "age", "weight", "occupation"]) {
    Object.defineProperty(t, key, { get() { throw new Error("PROHIBITED_GOAL_DATA_READ"); } });
  }
  for (const key of ["current_text", "relevant_context", "recent_relevant_turns", "user_correction"]) {
    Object.defineProperty(t.m3_context, key, { get() { throw new Error("PROHIBITED_M3_CONTEXT_READ"); } });
  }
  assert.equal(goalDecision(t).state, "CONTEXT_SUFFICIENT");
});
unit("GOAL CASE 3 clarification and ambiguity stay with M3", () => {
  for (const interpretation of [
    goalMeaning({ clarification_needed: true }),
    goalMeaning({ intent_type: "AMBIGUOUS" }),
  ]) {
    assert.deepEqual(goalDecision(goalTask({ status: "AWAITING_INPUT", interpretation })), {
      state: "NEED_CLARIFICATION", next_role: "M3",
    });
  }
});
unit("GOAL CASE 4 safety, stop, refusal and out-of-scope meanings fail closed", () => {
  for (const patch of [
    { safety_state: "PAIN" }, { suggested_next_role: "STOP" },
    { intent_type: "SAFETY" }, { intent_type: "OUT_OF_SCOPE" },
    { intent_type: "REFUSAL" }, { intent_type: "STOP_PAUSE" },
  ]) {
    assert.deepEqual(goalDecision(goalTask({ interpretation: goalMeaning(patch) })), {
      state: "DEFERRED", reason: "M3_BOUNDARY",
    });
  }
  assert.deepEqual(goalDecision(goalTask({ m3_context: { ...goalTask().m3_context, safety_signal: "PAIN" } })), {
    state: "DEFERRED", reason: "M3_BOUNDARY",
  });
});
unit("GOAL CASE 5 only current permitted READY goal tasks may become sufficient", () => {
  for (const patch of [
    { interpretation: undefined }, { permission_granted: false },
    ...["AWAITING_INPUT", "CANCELLED", "PAUSED", "FAILED", "NEEDS_ROUTING", "UNSUPPORTED"]
      .map(status => ({ status })),
  ]) {
    assert.deepEqual(goalDecision(goalTask(patch)), { state: "DEFERRED", reason: "TASK_NOT_READY" });
  }
});
unit("GOAL CASE 6 current tasks and unsupported goal kinds never pass the goal gate", () => {
  for (const interpretation of [
    goalMeaning({ intent_type: "CURRENT_TASK" }),
    goalMeaning({ task_kind: "meal_image_assessment" }),
    goalMeaning({ task_kind: null }),
    goalMeaning({ suggested_next_role: "M5" }),
  ]) {
    assert.deepEqual(goalDecision(goalTask({ interpretation })), {
      state: "DEFERRED", reason: "UNSUPPORTED_TASK",
    });
  }
});

// These are independent signals: stopping questions, declining this item,
// and supplying usable context. A generic stop must never synthesize a decline.
const stopQuestions = (t = task()) => ({
  ...t, m3_context: { ...t.m3_context, asking_stopped: true },
});
unit("CASE A ambiguity still clarifies when questions are allowed", () => {
  const t = task({ interpretation: meaning({
    intent_type: "AMBIGUOUS", clarification_needed: true,
    clarification_question: "Which task?",
  }) });
  assert.deepEqual(decision(t, null), { state: "NEED_CLARIFICATION", next_role: "M3" });
});
unit("CASE B stopped ambiguity defers without repairing intent or reopening questions", () => {
  for (const clarification_needed of [false, true]) {
    const t = stopQuestions(task({ interpretation: meaning({
      intent_type: "AMBIGUOUS", clarification_needed, clarification_question: null,
    }) }));
    const before = JSON.stringify(t);
    assert.deepEqual(decision(t, null), { state: "DEFERRED", reason: "M3_BOUNDARY" });
    assert.deepEqual(decision(t, available(t)), { state: "DEFERRED", reason: "M3_BOUNDARY" });
    assert.equal(JSON.stringify(t), before);
  }
});
unit("CASE C stopped questions with absent image neither ask nor invent refusal", () => {
  const t = stopQuestions();
  const c = input(t, { state: "absent" });
  assert.deepEqual(decision(t, c), { state: "DEFERRED", reason: "M3_BOUNDARY" });
  assert.deepEqual(decision(t, c), { state: "DEFERRED", reason: "M3_BOUNDARY" });
  assert.equal(c.image.state, "absent");
});
unit("CASE D stopped questions reuse permitted usable image without decline", () => {
  const t = stopQuestions(); const c = available(t); const before = JSON.stringify({ t, c });
  const expected = {
    state: "CONTEXT_SUFFICIENT", sufficient_for: "NEXT_STEP_CONTRACT_ONLY",
    used_context_ids: ["fixture-image-a"],
  };
  assert.deepEqual(decision(t, c), expected);
  assert.deepEqual(decision(t, c), expected);
  assert.equal(JSON.stringify({ t, c }), before);
});
unit("CASE E only explicit image-item refusal yields declined, with or without stopped questions", () => {
  for (const t of [task(), stopQuestions()]) {
    // The existing declined union variant carries explicit item refusal, not image bytes.
    const c = input(t, { state: "declined" });
    assert.deepEqual(decision(t, c), {
      state: "CONTEXT_DECLINED", alternative: "TEXT_DESCRIPTION_OPTION", ask_again: false,
    });
  }
});
unit("CASE F refusal of an unrelated question is not image refusal", () => {
  const t = task();
  // An unrelated answer refusal in conversation is not an M3 REFUSAL of this task.
  t.m3_context.recent_relevant_turns = [
    { role: "user", text: "I decline to answer the unrelated schedule question." },
  ];
  assert.deepEqual(decision(t, input(t)), { state: "CONTEXT_REQUIRED", missing: ["meal_image"] });
  assert.equal(decision(t, available(t)).state, "CONTEXT_SUFFICIENT");
  const stopped = stopQuestions(t);
  assert.deepEqual(decision(stopped, input(stopped)), { state: "DEFERRED", reason: "M3_BOUNDARY" });
  assert.equal(decision(stopped, available(stopped)).state, "CONTEXT_SUFFICIENT");
});
unit("CASE G stopped questions do not override revoked or stale image permission", () => {
  const t = stopQuestions(); const c = available(t);
  assert.equal(decision(t, c).state, "CONTEXT_SUFFICIENT");
  c.permission = { ...c.permission, status: "denied", revision: 2 };
  assert.deepEqual(decision(t, c), { state: "PERMISSION_REQUIRED", item: "meal_image" });
  c.permission.status = "allowed";
  assert.deepEqual(decision(t, c), { state: "PERMISSION_REQUIRED", item: "meal_image" });
});
unit("CASE H stopped questions do not admit stale revisions or unusable images", () => {
  const t = stopQuestions(); const c = available(t); c.scope.revision--;
  assert.deepEqual(decision(t, c), { state: "DEFERRED", reason: "STALE_CONTEXT" });
  const unusable = available(t); unusable.image.usable = false;
  assert.deepEqual(decision(t, unusable), { state: "DEFERRED", reason: "CONTEXT_UNUSABLE" });
});
unit("CASE I task A stopping questions cannot consume task B or another session context", () => {
  const a = stopQuestions(); const b = task({ task_id: "fixture-task-b" });
  assert.deepEqual(decision(a, available(b)), { state: "DEFERRED", reason: "STALE_CONTEXT" });
  const other = available(a); other.scope.session_id = "another-session";
  assert.deepEqual(decision(a, other), { state: "DEFERRED", reason: "STALE_CONTEXT" });
  assert.equal(decision(a, available(a)).state, "CONTEXT_SUFFICIENT");
});

integration("canonical M3 stop normalization cannot be reopened by M4", () => {
  const t = stopQuestions();
  const normalized = validateMeaning(meaning({
    intent_type: "AMBIGUOUS", clarification_needed: true,
    clarification_question: "Which task?", missing_context: ["task detail"],
  }), t.m3_context);
  assert.equal(normalized.intent_type, "AMBIGUOUS");
  assert.equal(normalized.clarification_needed, false);
  assert.equal(normalized.clarification_question, null);
  assert.deepEqual(normalized.missing_context, []);
  const before = JSON.stringify(normalized);
  const unresolved = { ...t, interpretation: normalized };
  assert.deepEqual(decision(unresolved, null), { state: "DEFERRED", reason: "M3_BOUNDARY" });
  assert.deepEqual(decision(unresolved, available(unresolved)), { state: "DEFERRED", reason: "M3_BOUNDARY" });
  assert.equal(JSON.stringify(normalized), before);
  const understood = { ...t, interpretation: validateMeaning(meaning(), t.m3_context) };
  assert.equal(decision(understood, available(understood)).state, "CONTEXT_SUFFICIENT");
  assert.deepEqual(decision(understood, input(understood)), { state: "DEFERRED", reason: "M3_BOUNDARY" });
});


const tick = () => new Promise(resolve => setImmediate(resolve));
const makeAdapter = () => ({
  provenance: "TEST_FIXTURE", processing: "ON_DEVICE", contract: "M3_GATEWAY_V1",
  calls: 0, revocations: 0,
  async interpret() { this.calls++; return meaning(); },
  async revoke() { this.revocations++; },
});
const currentTask = (s, id) => s.getSnapshot().tasks.find(t => t.task_id === id);

integration("M3 understood -> store READY -> M4 required is read-only and does not recall M3", async () => {
  const adapter = makeAdapter(); const s = createSessionTaskStore({ adapter, now: () => 100 });
  s.start(); const id = s.submit("fixture meal", { permission_granted: true }); await tick();
  const t = currentTask(s, id); const ref = s.reference(id);
  const snap = s.getSnapshot(); let events = 0; const unsubscribe = s.subscribe(() => events++);
  assert.equal(t.status, "READY");
  assert.equal(s.assessM4(ref, input(t)).decision.state, "CONTEXT_REQUIRED");
  assert.equal(s.assessM4(ref, available(t)).decision.state, "CONTEXT_SUFFICIENT");
  assert.equal(s.getSnapshot(), snap);
  assert.equal(events, 0); assert.equal(adapter.calls, 1);
  unsubscribe(); s.stop();
});
integration("two live SessionTasks retain context isolation across switches", async () => {
  const s = createSessionTaskStore({ adapter: makeAdapter(), now: () => 200 }); s.start();
  const a = s.submit("A", { permission_granted: true }); await tick(); const aContext = available(currentTask(s, a));
  const staleView = s.reference(a);
  const b = s.submit("B", { permission_granted: true }); await tick();
  assert.equal(s.assessM4(staleView, aContext).decision.reason, "STALE_TASK");
  assert.equal(s.assessM4(s.reference(b), aContext).decision.reason, "STALE_CONTEXT");
  assert.equal(s.assessM4(s.reference(a), aContext).decision.state, "CONTEXT_SUFFICIENT");
  assert.equal(s.switchTask(s.reference(a)), true);
  assert.equal(s.assessM4(s.reference(a), aContext).decision.state, "CONTEXT_SUFFICIENT");
  assert.equal(s.assessM4(s.reference(b), input(currentTask(s, b))).decision.state, "CONTEXT_REQUIRED");
  s.stop();
});
integration("edit invalidates old ref/context; cancel, revoke and stop retire prior sufficiency", async () => {
  const adapter = makeAdapter(); const s = createSessionTaskStore({ adapter, now: () => 300 }); s.start();
  const id = s.submit("A", { permission_granted: true }); await tick();
  const old = s.reference(id); const c = available(currentTask(s, id));
  assert.equal(s.assessM4(old, c).decision.state, "CONTEXT_SUFFICIENT");
  assert.equal(s.edit(old, "corrected A"), true); await tick();
  assert.equal(s.assessM4(old, c).decision.reason, "STALE_TASK");
  assert.equal(s.assessM4(s.reference(id), c).decision.reason, "STALE_CONTEXT");
  const ref = s.reference(id); const fresh = available(currentTask(s, id));
  await s.revoke(ref);
  assert.equal(s.assessM4(ref, fresh).decision.reason, "STALE_TASK");
  assert.equal(s.assessM4(s.reference(id), fresh).decision.reason, "TASK_NOT_READY");
  assert.equal(adapter.revocations, 1);
  const b = s.submit("B", { permission_granted: true }); await tick();
  s.cancel(s.reference(b));
  assert.equal(s.assessM4(s.reference(b), available(currentTask(s, b))).decision.reason, "TASK_NOT_READY");
  const last = s.reference(b); s.stop(); s.start();
  assert.equal(s.assessM4(last, c).decision.reason, "STALE_TASK");
  s.stop();
});
integration("late M3 completion after edit/supersede/cancel cannot revive M4", async () => {
  const pending = [];
  const adapter = { ...makeAdapter(), interpret() { return new Promise(resolve => pending.push(resolve)); } };
  const s = createSessionTaskStore({ adapter, now: () => 400 }); s.start();
  const a = s.submit("old A", { permission_granted: true });
  s.edit(s.reference(a), "new A");
  pending[0](meaning()); await tick();
  assert.equal(currentTask(s, a).interpretation, undefined);
  pending[1](meaning()); await tick();
  const c = available(currentTask(s, a));
  assert.equal(s.assessM4(s.reference(a), c).decision.state, "CONTEXT_SUFFICIENT");
  const b = s.submit("B", { permission_granted: true });
  const d = s.submit("D", { permission_granted: true });
  pending[2](meaning()); await tick();
  assert.equal(currentTask(s, b).interpretation, undefined);
  s.cancel(s.reference(d)); pending[3](meaning()); await tick();
  assert.equal(currentTask(s, d).interpretation, undefined);
  s.stop();
});
integration("canonical M3 clarification and safety normalization remain intact", async () => {
  const t = task();
  const clear = validateMeaning(meaning(), t.m3_context);
  assert.equal(clear.clarification_needed, false);
  const ambiguous = validateMeaning(meaning({
    intent_type: "AMBIGUOUS", clarification_needed: true,
    clarification_question: "Bạn muốn xem điều gì?", missing_context: ["Việc cần giúp"],
  }), t.m3_context);
  assert.equal(ambiguous.suggested_next_role, "M4"); // unchanged wire contract
  assert.equal(decision(task({ interpretation: ambiguous, status: "AWAITING_INPUT" }), null).next_role, "M3");
  const safety = validateMeaning(meaning(), { ...t.m3_context, safety_signal: "PAIN" });
  assert.equal(safety.suggested_next_role, "STOP");
  assert.equal(decision(task({ interpretation: safety }), null).reason, "M3_BOUNDARY");
});
integration("without M3 opt-in no M3 fixture call or M4 readiness is fabricated", async () => {
  const adapter = makeAdapter(); const s = createSessionTaskStore({ adapter, now: () => 500 }); s.start();
  const id = s.submit("A"); await tick();
  assert.equal(adapter.calls, 0);
  assert.equal(s.assessM4(s.reference(id), available(currentTask(s, id))).decision.reason, "TASK_NOT_READY");
  s.stop();
});
integration("goal readiness uses the store TaskRef guard and remains read-only", async () => {
  const adapter = {
    ...makeAdapter(),
    async interpret() { this.calls++; return goalMeaning(); },
  };
  const s = createSessionTaskStore({ adapter, now: () => 600 }); s.start();
  const id = s.submit("fixture goal", { permission_granted: true }); await tick();
  const ref = s.reference(id); const snapshot = s.getSnapshot();
  assert.deepEqual(s.assessM4GoalReadiness(ref).decision, {
    state: "CONTEXT_SUFFICIENT", sufficient_for: "NEXT_STEP_CONTRACT_ONLY", used_context_ids: [],
  });
  assert.equal(s.getSnapshot(), snapshot);
  const other = s.submit("another goal", { permission_granted: true }); await tick();
  assert.deepEqual(s.assessM4GoalReadiness(ref).decision, { state: "DEFERRED", reason: "STALE_TASK" });
  s.cancel(s.reference(other));
  assert.deepEqual(s.assessM4GoalReadiness(s.reference(other)).decision, {
    state: "DEFERRED", reason: "TASK_NOT_READY",
  });
  assert.equal(adapter.calls, 2); s.stop();
});

const phase = process.argv[2];
assert.ok(["unit", "integration"].includes(phase), "Pass unit or integration explicitly.");
const selected = tests.filter(t => t.phase === phase);
for (const t of selected) {
  await t.run();
  console.log("PASS " + t.name);
}
console.log("M4 " + phase + ": " + selected.length + "/" + selected.length + " PASS");
