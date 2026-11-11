import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { readFile } from "node:fs/promises";

// Match the other domain verifiers: load real TS on Node 22.15+/24,
// without POSIX-only executable paths or shared /tmp bundle files.
registerHooks({
  resolve(specifier, context, nextResolve) {
    // Workspace dependency junctions may point at another checkout on Windows.
    // Exercise this worktree's real client, not a sibling checkout or a mock.
    if (specifier === '@workspace/api-client-react') {
      return nextResolve(new URL('../../../lib/api-client-react/src/index.ts', import.meta.url).href, context);
    }
    // `.schemas` is part of the generated TS basename, not a loadable extension.
    return nextResolve(specifier.startsWith('.') && (!extname(specifier) || specifier.endsWith('/api.schemas'))
      ? specifier + '.ts' : specifier, context);
  },
});
let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls++;
  throw new Error('NETWORK_FORBIDDEN_IN_M3_RECONCILIATION_TEST');
};
const { createSessionTaskStore } = await import("../domain/session-task/store.ts");
const { createM3GatewayAdapter } = await import("../domain/m3/gateway-adapter.ts");
const {
  isSameM3Submission,
  presentM3LifecycleNotice,
  presentM3SemanticState,
} = await import("../components/m3Presentation.ts");
const { taskMessages } = await import("../i18n-task.ts");
const { M3_LOCALE_CONFIG } = await import("../../../lib/api-zod/src/m3-locales.ts");

const meaning = {
  intent_type: "CURRENT_TASK",
  interpreted_meaning: "Người dùng muốn tiếp tục việc hiện tại",
  confidence: 0.8,
  uncertainty: null,
  missing_context: [],
  clarification_needed: false,
  clarification_question: null,
  safety_state: "CLEAR",
  suggested_next_role: "M4",
  task_kind: null,
  context_effect: "NONE",
  used_context_ids: [],
  response: "Mình hiểu điều bạn muốn tiếp tục.",
};
const presentationTask = Object.freeze({
  task_id: "presentation-task",
  session_id: "presentation-session",
  source_input: "Mạnh hơn",
  revision: 1,
  status: "READY",
  permission_revision: 1,
  permission_granted: true,
  m3_context: Object.freeze({
    locale: "vi",
    current_text: "Mạnh hơn",
    relevant_context: Object.freeze([]),
    recent_relevant_turns: Object.freeze([]),
    user_correction: null,
    safety_signal: "CLEAR",
    asking_stopped: false,
  }),
  interpretation: Object.freeze({ ...meaning }),
});
const originalDraft = "Mạnh hơn";
for (const activeLocale of ["vi", "ko", "zh-Hans", "ja", "vi"]) {
  assert.equal(presentM3SemanticState(presentationTask, activeLocale),
    {
      vi: "Mình đã ghi nhận yêu cầu này.",
      ko: "요청을 확인했어요.",
      "zh-Hans": "我已记下这个请求。",
      ja: "ご依頼を受け止めました。",
    }[activeLocale]);
  assert.equal(originalDraft, "Mạnh hơn", "locale projection must not mutate the user draft");
  assert.equal(presentationTask.m3_context.locale, "vi", "task source locale is immutable provenance");
}
assert.equal(isSameM3Submission(presentationTask, "Mạnh hơn", "vi"), true);
assert.equal(isSameM3Submission(presentationTask, "Mạnh hơn", "ko"), false,
  "same text under a new selected locale must create a new submission");
assert.equal(presentM3LifecycleNotice("m2PermissionGranted", "ko"),
  "이 세션에서는 인공지능에 내용을 보내도록 허용했어요.");
assert.equal(presentM3LifecycleNotice("m2Acknowledged", "zh-Hans"),
  "我已记下你刚才写的内容。");
assert.equal(presentM3LifecycleNotice("m2Cancelled", "ja"), "依頼を取り消しました。");
const safetyTask = Object.freeze({
  ...presentationTask,
  interpretation: Object.freeze({ ...meaning, intent_type: "SAFETY", safety_state: "PAIN",
    suggested_next_role: "STOP" }),
});
assert.equal(presentM3SemanticState(safetyTask, "ko"),
  "안전을 우선하기 위해 지금의 안내를 잠시 멈출게요.");
assert.equal(presentM3SemanticState(safetyTask, "zh-Hans"),
  "为了你的安全，我会先暂停当前指导。");
const urgentTask = Object.freeze({
  ...safetyTask,
  interpretation: Object.freeze({ ...safetyTask.interpretation, safety_state: "URGENT" }),
});
assert.equal(presentM3SemanticState(urgentTask, "vi"),
  "Dừng hành động hiện tại và tìm trợ giúp y tế khẩn cấp tại nơi bạn đang ở.");
const urgentCopy = {
  vi: "Dừng hành động hiện tại và tìm trợ giúp y tế khẩn cấp tại nơi bạn đang ở.",
  en: "Stop the current action and seek urgent medical help where you are.",
  "zh-Hans": "立即停止当前行动，并在您所在地区寻求紧急医疗帮助。",
  es: "Detén la acción actual y busca atención médica urgente donde te encuentres.",
  hi: "मौजूदा गतिविधि तुरंत रोकें और जहाँ हैं वहीं आपातकालीन चिकित्सा सहायता लें।",
  ja: "現在の行動をすぐに中止し、今いる場所で緊急の医療支援を求めてください。",
  ko: "현재 행동을 즉시 중단하고, 현재 있는 곳에서 응급 의료 도움을 받으세요.",
  ru: "Немедленно прекратите текущее действие и обратитесь за экстренной медицинской помощью по месту нахождения.",
};
for (const [locale, expected] of Object.entries(urgentCopy)) {
  assert.equal(taskMessages[locale].urgentSafety, expected);
  assert.equal(M3_LOCALE_CONFIG[locale].urgentSafety, expected);
  assert.equal(presentM3SemanticState(urgentTask, locale), expected);
  assert.equal(presentM3SemanticState(safetyTask, locale), taskMessages[locale].safety);
  assert.notEqual(expected, taskMessages[locale].safety);
  assert.doesNotMatch(expected, /heart attack|stroke|nhồi máu|đột quỵ|\b(?:911|112|115|999)\b/iu);
  assert.equal(urgentTask.interpretation.safety_state, "URGENT");
  assert.equal(urgentTask.m3_context.safety_signal, "CLEAR");
}
const stopTask = Object.freeze({
  ...presentationTask,
  m3_context: Object.freeze({ ...presentationTask.m3_context, asking_stopped: true }),
  interpretation: Object.freeze({ ...meaning, intent_type: "STOP_PAUSE", suggested_next_role: "STOP" }),
});
assert.equal(presentM3SemanticState(stopTask, "ja"),
  "ここで質問を止めます。続けたいときに再開できます。");
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
let localeInterpretCalls = 0;
const localeAdapter = {
  provenance: "TEST_FIXTURE",
  processing: "LOCAL",
  contract: "M3_GATEWAY_V1",
  async interpret() {
    localeInterpretCalls += 1;
    return meaning;
  },
};
const localeStore = createSessionTaskStore({ adapter: localeAdapter, now: () => 900 });
localeStore.start();
const viSubmission = localeStore.submit("same text", {
  locale: "vi", permission_granted: true, permission_revision: 1,
});
await wait();
const viTask = localeStore.getSnapshot().tasks.find((task) => task.task_id === viSubmission);
assert.ok(viTask);
assert.equal(isSameM3Submission(viTask, "same text", "vi"), true);
assert.equal(isSameM3Submission(viTask, "same text", "ko"), false);
const koSubmission = localeStore.submit("same text", {
  locale: "ko", permission_granted: true, permission_revision: 1,
});
await wait();
assert.notEqual(koSubmission, viSubmission);
assert.equal(localeStore.getSnapshot().tasks.find((task) => task.task_id === koSubmission)?.m3_context.locale, "ko");
assert.equal(localeStore.getSnapshot().tasks.find((task) => task.task_id === viSubmission)?.m3_context.locale, "vi");
assert.equal(localeInterpretCalls, 2, "locale switch must reinterpret identical text under the new locale");
localeStore.stop();
let interpretCalls = 0;
let revokeCalls = 0;
const pending = [];
const adapter = {
  provenance: "TEST_FIXTURE",
  processing: "EXTERNAL",
  contract: "M3_GATEWAY_V1",
  interpret({ operation }, signal) {
    interpretCalls += 1;
    return new Promise((resolve, reject) => {
      pending.push({ resolve: () => resolve(meaning), signal });
      signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    });
  },
  async revoke() { revokeCalls += 1; },
};

const disabled = createSessionTaskStore();
disabled.start();
const disabledId = disabled.submit("fallback");
await wait();
assert.equal(disabled.getSnapshot().tasks.find((task) => task.task_id === disabledId)?.status, "UNSUPPORTED");
assert.equal(disabled.getSnapshot().tasks.find((task) => task.task_id === disabledId)?.permission_granted, false);
disabled.stop();

const store = createSessionTaskStore({ adapter, now: () => 1000 });
store.start();
const blocked = store.submit("blocked without explicit permission", { locale: "vi" });
await wait();
assert.equal(interpretCalls, 0, "an adapter and feature path do not imply M3 permission");
assert.equal(store.getSnapshot().tasks.find((task) => task.task_id === blocked)?.permission_granted, false);
const first = store.submit("first", { locale: "vi", permission_granted: true, permission_revision: 7 });
await wait();
const second = store.submit("second", { locale: "vi", permission_granted: true, permission_revision: 7 });
assert.ok(first && second);
assert.equal(interpretCalls, 2, "a superseding submit creates a new scoped attempt");
assert.ok(pending[0].signal.aborted, "previous pending task is aborted before routing");
pending[1].resolve();
await wait();
let current = store.getSnapshot();
assert.equal(current.active_task_id, second);

const firstRef = store.reference(first);
assert.ok(firstRef, "inactive task retains a fresh session reference");
assert.equal(store.switchTask(firstRef), true);
assert.equal(store.getSnapshot().active_task_id, first);

const lateRef = store.reference(first);
assert.ok(lateRef);
const lateId = store.submit("late", { permission_granted: true, permission_revision: 7 });
assert.ok(lateId);
const latePending = pending.at(-1);
const lateTaskRef = store.reference(lateId);
assert.ok(lateTaskRef);
assert.equal(store.cancel(lateTaskRef), true);
assert.equal(store.getSnapshot().active_task_id, null,
  "cancelling the focused task clears active presentation ownership");
latePending.resolve();
await wait();
assert.equal(store.getSnapshot().tasks.find((task) => task.task_id === lateId)?.interpretation, undefined);

const revokeRef = store.reference(first);
assert.ok(revokeRef);
assert.equal(await store.revoke(revokeRef), true);
assert.equal(revokeCalls, 1);
assert.equal(store.getSnapshot().tasks.find((task) => task.task_id === first)?.permission_granted, false);
const cancelledId = store.submit("cancelled remains cancelled", {
  permission_granted: true,
  permission_revision: 8,
});
await wait();
const cancelledRef = store.reference(cancelledId);
assert.ok(cancelledRef);
assert.equal(store.cancel(cancelledRef), true);
const cancelledAfterCancel = store.reference(cancelledId);
assert.ok(cancelledAfterCancel);
assert.equal(await store.revoke(cancelledAfterCancel), true);
assert.equal(store.getSnapshot().tasks.find((task) => task.task_id === cancelledId)?.status, "CANCELLED");

const wrongTaskAdapter = {
  ...adapter,
  async interpret({ operation }, signal) {
    await wait();
    if (signal.aborted || !operation.isCurrent()) throw new Error("wrong task rejected");
    throw new Error("M3_RESPONSE_SCOPE_MISMATCH");
  },
};
const isolated = createSessionTaskStore({ adapter: wrongTaskAdapter, now: () => 2000 });
isolated.start();
const wrongTaskId = isolated.submit("wrong task fixture", {
  permission_granted: true,
  permission_revision: 3,
});
await wait();
assert.equal(isolated.getSnapshot().tasks.find((task) => task.task_id === wrongTaskId)?.status, "FAILED");
isolated.stop();

const staleStore = createSessionTaskStore({ adapter, now: () => 3000 });
staleStore.start();
const staleId = staleStore.submit("stale revision fixture", {
  permission_granted: true,
  permission_revision: 4,
});
await wait();
const staleRef = staleStore.reference(staleId);
assert.ok(staleRef);
assert.equal(staleStore.edit(staleRef, "fresh revision fixture"), true);
assert.equal(staleStore.cancel(staleRef), false, "a pre-edit task revision must be stale");
staleStore.stop();

const wireContent = {
  locale: "vi",
  current_text: "wrong task wire fixture",
  relevant_context: [],
  recent_relevant_turns: [],
  user_correction: null,
  safety_signal: "CLEAR",
  asking_stopped: false,
};
const wireTicket = {
  session_id: "stub-session",
  task_id: "expected-task",
  task_revision: 1,
  permission_revision: 1,
  operation_id: "stub-operation",
};
const wireAdapter = createM3GatewayAdapter({
  origin: "https://stub.invalid",
  provenance: "TEST_FIXTURE",
  isSessionCurrent: () => true,
  async http(url, init) {
    if (url.endsWith("/api/ai/session")) {
      return { ok: true, status: 200, async json() { return {}; } };
    }
    const request = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          version: request.version,
          requestId: request.requestId,
          sessionId: request.sessionId,
          taskId: "wrong-task",
          taskRevision: request.taskRevision,
          permissionRevision: request.permissionRevision,
          intentType: meaning.intent_type,
          interpretedMeaning: meaning.interpreted_meaning,
          confidence: meaning.confidence,
          uncertainty: meaning.uncertainty,
          missingContext: meaning.missing_context,
          clarificationNeeded: meaning.clarification_needed,
          clarificationQuestion: meaning.clarification_question,
          safetyState: meaning.safety_state,
          suggestedNextRole: meaning.suggested_next_role,
          taskKind: meaning.task_kind,
          contextEffect: meaning.context_effect,
          usedContextIds: meaning.used_context_ids,
          response: meaning.response,
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
  },
});
await assert.rejects(
  wireAdapter.interpret({
    content: wireContent,
    operation: {
      ticket: wireTicket,
      permission: {
        external_access: "M3_TEXT",
        purpose: "m3_intent_understanding",
        revision: 1,
      },
      isCurrent: () => true,
    },
  }, new AbortController().signal),
  /M3_RESPONSE_SCOPE_MISMATCH/u,
);

store.stop();
assert.equal(store.getSnapshot().tasks.length, 0, "stop retires the RAM-only SessionTask lifetime");

const adapterSource = await readFile(new URL("../domain/m3/gateway-adapter.ts", import.meta.url), "utf8");
const uiSource = await readFile(new URL("../components/useM2Gateway.ts", import.meta.url), "utf8");
const lifetimeSource = await readFile(new URL("../components/m3-host-lifetime.ts", import.meta.url), "utf8");
const goalFlowSource = await readFile(new URL("../components/OpeningGoalFlow.tsx", import.meta.url), "utf8");
const hostSource = await readFile(new URL("../app/_layout.tsx", import.meta.url), "utf8");
const stubSource = await readFile(new URL("../domain/m3/stub-adapter.ts", import.meta.url), "utf8");
assert.match(adapterSource, /\/api\/ai\/session/u);
assert.match(adapterSource, /M3_PURPOSE/u);
assert.match(adapterSource, /M3_VERSION/u);
assert.match(adapterSource, /M3_PATH/u);
assert.match(uiSource, /EXPO_PUBLIC_M3_RUNTIME_MODE/u);
assert.doesNotMatch(uiSource, /EXPO_PUBLIC_AI_M3_ENABLED/u);
assert.match(uiSource, /createM3HostLifetime/u);
assert.match(lifetimeSource, /createSessionTaskStore/u);
assert.match(lifetimeSource, /createTrainerRuntimeCoordinator/u);
assert.doesNotMatch(uiSource, /aiResolveIntent/u);
assert.match(goalFlowSource, /m2\.submit\(inputValue\)/u);
assert.match(uiSource, /resolveM3HostPermission/u);
assert.doesNotMatch(uiSource, /m3StubOnly/u);
assert.match(hostSource, /m2Gateway=\{m2Gateway\}/u);
assert.match(hostSource, /createM3StubAdapter/u);
assert.match(hostSource, /status: 'denied'/u);
assert.match(goalFlowSource, /m3-stub-edit-task/u);
assert.match(goalFlowSource, /m3-stub-cancel-task/u);
assert.match(goalFlowSource, /m2\.m3Mode !== 'off'/u);
assert.match(goalFlowSource, /!m2\.adaptiveHandoff/u);
assert.doesNotMatch(goalFlowSource,
  /Prototype status|Trạng thái bản thử|Simulation|Mô phỏng|m2\.m3Tasks|m3-stub-task-|switchM3Task/u);
assert.doesNotMatch(goalFlowSource,
  /m3-stub-access-toggle|m3-stub-active-response|M3 AI thật|Live AI M3|NEEDS_ROUTING|intent_type/u);
assert.match(stubSource, /provenance: 'TEST_FIXTURE'/u);
assert.doesNotMatch(stubSource, /aiM3|aiPilotSession|fetch/u);
console.log("M3 mobile verifier: disabled fallback and RAM lifetime PASS");
console.log("M3 mobile verifier: explicit permission/supersede/cancel/revoke/switch PASS");
console.log("M3 mobile verifier: canonical session purpose/path and UI adapter PASS");
console.log("M3 host verifier: local stub/edit/cancel/task isolation PASS");
console.log("M3 boundary verifier: stale revision and wrong-task wire response PASS");
assert.equal(networkCalls, 0);
console.log("M3 dynamic presentation locale, immutable provenance and locale-aware dedupe PASS");
console.log("M3 reconciliation provider calls: 0");
