import assert from "node:assert/strict";
import {
  GatewayProblem,
  validateInput,
  validateIntentOutput,
  validateProviderOutput,
  validateRequestTiming,
} from "../src/ai/gateway";

function problemCode(run: () => void): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof GatewayProblem);
    return error.code;
  }
  assert.fail("Expected a gateway problem");
}

const safeOutput = validateProviderOutput({
  text: "Bạn muốn được lắng nghe hay muốn tự chọn một bước tiếp theo?",
  suggestions: [
    { kind: "plan.create", label: "Tự chọn một bước" },
    { kind: "understanding.correct", label: "Sửa cách hiểu" },
  ],
  usage: { inputTokens: 80, outputTokens: 24 },
});
assert.equal(safeOutput.suggestions.length, 2);

assert.equal(problemCode(() => validateProviderOutput({
  text: "Bạn chắc chắn bị trầm cảm; hãy bỏ thuốc.",
  suggestions: [],
  usage: { inputTokens: 10, outputTokens: 10 },
})), "AI_OUTPUT_BLOCKED");

assert.equal(problemCode(() => validateProviderOutput({
  text: "Tôi đã đặt lịch và gọi người thân giúp bạn.",
  suggestions: [{ kind: "plan.create", label: "Đã đặt lịch" }],
  usage: { inputTokens: 10, outputTokens: 10 },
})), "AI_OUTPUT_BLOCKED");

assert.equal(problemCode(() => validateProviderOutput({
  text: "Hãy bấm nút này.",
  suggestions: [{ kind: "calendar.book" as never, label: "Đặt lịch" }],
  usage: { inputTokens: 10, outputTokens: 10 },
})), "AI_OUTPUT_BLOCKED");

assert.equal(problemCode(() => validateInput({
  locale: "vi",
  messages: [{ role: "user", content: "Tôi cần hỗ trợ." }],
  relevantContext: [{
    text: "Dữ liệu chưa được phép gửi",
    source: "user_statement",
    permission: "local_only" as never,
    createdAt: new Date().toISOString(),
  }],
})), "AI_CONTEXT_NOT_PERMITTED");

assert.equal(problemCode(() => validateRequestTiming(
  "2026-09-10T07:00:00.000Z",
  "2026-09-10T07:02:00.000Z",
  Date.parse("2026-09-10T08:00:00.000Z"),
)), "AI_REQUEST_STALE");

const intent = validateIntentOutput({
  understanding: {
    status: "needs_clarification",
    intent: "unknown",
    confidence: "low",
    summary: "Chưa đủ thông tin để hiểu bước tiếp theo.",
    clarificationQuestion: "Bạn muốn tiếp tục hay điều chỉnh phần đang làm?",
    suggestedActions: ["continue_current_task", "adjust_current_task"],
  },
  usage: { inputTokens: 30, outputTokens: 18 },
});
assert.equal(intent.understanding.intent, "unknown");
assert.equal(problemCode(() => validateIntentOutput({
  understanding: {
    status: "needs_clarification",
    intent: "unknown",
    confidence: "low",
    summary: "Cần hỏi lại.",
    clarificationQuestion: null,
    suggestedActions: [],
  },
  usage: { inputTokens: 3, outputTokens: 2 },
})), "AI_INTENT_OUTPUT_INVALID");

console.log("safe response and allowed suggestions: PASS");
console.log("medical claim, fake external action, and invalid button: BLOCKED");
console.log("unpermitted context and stale request: BLOCKED");
console.log("gateway validation: PASS");
console.log("M3 structured intent validation: PASS");