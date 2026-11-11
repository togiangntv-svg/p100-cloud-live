import assert from "node:assert/strict";
import {
  AiPilotSessionBody,
  AiPilotSessionResponse,
  makeM3Response,
  parseM3Request,
  readM3Response,
} from "@workspace/api-zod";

const exactKeys = (value: unknown, keys: readonly string[]): void => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
};

const validateM3SessionRequest = (raw: unknown) => {
  exactKeys(raw, ["locale", "consent"]);
  const body = AiPilotSessionBody.parse(raw);
  exactKeys(body.consent, ["granted", "version", "purpose"]);
  assert.deepEqual(body.consent, {
    granted: true,
    version: "m3.v1",
    purpose: "m3_intent_understanding",
  });
  return body;
};

const validateM3SessionResponse = (raw: unknown) => {
  exactKeys(raw, ["enabled", "expiresAt"]);
  const response = AiPilotSessionResponse.parse(raw);
  assert.equal(response.enabled, true);
  assert.ok(response.expiresAt.getTime() > Date.now());
  return response;
};

const now = Date.now();
const sessionRequest = {
  locale: "vi",
  consent: {
    granted: true,
    version: "m3.v1",
    purpose: "m3_intent_understanding",
  },
};
const sessionResponse = {
  enabled: true,
  expiresAt: new Date(now + 5 * 60_000).toISOString(),
};

const interpretRequest = {
  version: "m3.v1",
  operation: "interpret",
  requestId: "fixture-request-001",
  sessionId: "fixture-session-001",
  taskId: "fixture-task-001",
  taskRevision: 1,
  permissionRevision: 2,
  createdAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 60_000).toISOString(),
  locale: "vi",
  consent: {
    granted: true,
    version: "m3.v1",
    purpose: "m3_intent_understanding",
  },
  input: {
    locale: "vi",
    current_text: "Tôi cần đánh giá bữa ăn bằng hình ảnh.",
    relevant_context: [],
    recent_relevant_turns: [],
    user_correction: null,
    safety_signal: "CLEAR",
    asking_stopped: false,
  },
};
const meaning = {
  intent_type: "CURRENT_TASK",
  interpreted_meaning: "Người dùng muốn đánh giá bữa ăn bằng hình ảnh.",
  confidence: 0.95,
  uncertainty: null,
  missing_context: [],
  clarification_needed: false,
  clarification_question: null,
  safety_state: "CLEAR",
  suggested_next_role: "STOP",
  task_kind: null,
  context_effect: "NONE",
  used_context_ids: [],
  response: "Kết quả kiểm vận chuyển giả lập đã được áp dụng đúng công việc.",
};

validateM3SessionRequest(sessionRequest);
validateM3SessionResponse(sessionResponse);
validateM3SessionRequest({ ...sessionRequest, locale: "en" });
assert.throws(
  () => validateM3SessionRequest({ ...sessionRequest, operation: "session" }),
  /Expected values to be strictly deep-equal/u,
);
assert.throws(
  () => validateM3SessionRequest({ locale: "vi", consent: { granted: true } }),
);

const parsedInterpret = parseM3Request(interpretRequest);
const interpretResponse = makeM3Response(
  parsedInterpret,
  meaning,
  { inputTokens: 1, outputTokens: 1 },
);
assert.deepEqual(readM3Response(interpretResponse, parsedInterpret), meaning);
const parsedEnglishInterpret = parseM3Request({
  ...interpretRequest,
  locale: "en",
  input: { ...interpretRequest.input, locale: "en" },
});
assert.deepEqual(
  readM3Response(
    makeM3Response(parsedEnglishInterpret, meaning, { inputTokens: 1, outputTokens: 1 }),
    parsedEnglishInterpret,
  ),
  meaning,
);
assert.throws(
  () => parseM3Request({ ...interpretRequest, consent: sessionRequest.consent, operation: undefined }),
  /M3_SCHEMA_INVALID/u,
);
assert.throws(
  () => readM3Response({ ...interpretResponse, taskId: "wrong-task" }, parsedInterpret),
  /M3_RESPONSE_SCOPE_MISMATCH/u,
);

console.log("P3.4B browser session fixture contract PASS");
console.log("P3.4B browser interpret fixture contract PASS");