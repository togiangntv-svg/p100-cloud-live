import assert from "node:assert/strict";
import { createM3Handler } from "../src/ai/m3-operation";
import {
  fixedFailure, type M3DiagnosticMetadata, type M3FailureStage,
} from "../src/ai/m3-diagnostics";
import {
  readM3ProviderCompletion, runM3ProviderCall,
} from "../src/ai/provider";

const secretText = "SENSITIVE_SENTINEL_DO_NOT_LOG";

function body(requestId: string) {
  const now = Date.now();
  return {
    version: "m3.v1", operation: "interpret", requestId,
    sessionId: "session-diagnostic", taskId: `task-${requestId}`,
    taskRevision: 1, permissionRevision: 1,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    locale: "vi",
    consent: { granted: true, version: "m3.v1", purpose: "m3_intent_understanding" },
    input: {
      locale: "vi", current_text: secretText, relevant_context: [],
      recent_relevant_turns: [], user_correction: null,
      safety_signal: "CLEAR", asking_stopped: false,
    },
  };
}

const validMeaning = {
  intent_type: "CURRENT_TASK",
  interpreted_meaning: "Người dùng muốn tiếp tục nhiệm vụ hiện tại",
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
  response: "Mình hiểu nhiệm vụ hiện tại.",
};

type Scenario = {
  stage: M3FailureStage | "success";
  interpret: () => Promise<{ meaning: unknown; usage: { inputTokens: number; outputTokens: number } }>;
  recordFails?: boolean;
  loggerFails?: boolean;
};

async function execute(requestId: string, scenario: Scenario) {
  let providerCalls = 0;
  let reserves = 0;
  let records = 0;
  const logs: M3DiagnosticMetadata[] = [];
  let status = 0;
  let payload: unknown;
  const handler = createM3Handler({
    enabled: () => true,
    available: () => undefined,
    principal: () => "principal",
    acquire: () => undefined,
    release: () => undefined,
    reserve: async () => { reserves += 1; },
    record: async () => {
      records += 1;
      if (scenario.recordFails) throw new Error(secretText);
    },
    interpret: async () => {
      providerCalls += 1;
      return scenario.interpret();
    },
    audit: () => undefined,
    diagnose: (metadata) => {
      if (scenario.loggerFails) throw new Error(secretText);
      logs.push(metadata);
    },
  });
  const req = {
    body: body(requestId),
    once: () => undefined,
    removeListener: () => undefined,
  };
  const res = {
    destroyed: false, writableEnded: false,
    once: () => undefined,
    removeListener: () => undefined,
    status(value: number) { status = value; return this; },
    json(value: unknown) { payload = value; this.writableEnded = true; return this; },
  };
  await handler(req as never, res as never);
  return { providerCalls, reserves, records, logs, status: status || 200, payload };
}

async function main() {
  const providerError = Object.assign(new Error(secretText), { status: 429 });
  const providerFailure = await runM3ProviderCall(async () => { throw providerError; })
    .catch((error) => error);
  const missingFailure = (() => {
    try {
      readM3ProviderCompletion({
        choices: [{ finish_reason: "stop", message: { content: null } }],
      });
    } catch (error) { return error; }
  })();
  const jsonFailure = (() => {
    try {
      readM3ProviderCompletion({
        choices: [{ finish_reason: "stop", message: { content: "not-json" } }],
      });
    } catch (error) { return error; }
  })();
  const finishReasonFailure = (() => {
    try {
      readM3ProviderCompletion({
        choices: [{ finish_reason: "length", message: { content: JSON.stringify(validMeaning) } }],
      });
    } catch (error) { return error; }
  })();
  const refusalFailure = (() => {
    try {
      readM3ProviderCompletion({
        choices: [{
          finish_reason: "stop",
          message: { content: JSON.stringify(validMeaning), refusal: secretText },
        }],
      });
    } catch (error) { return error; }
  })();

  const cases: Scenario[] = [
    { stage: "provider_call", interpret: async () => { throw providerFailure; } },
    { stage: "provider_content_missing", interpret: async () => { throw missingFailure; } },
    { stage: "provider_json_parse", interpret: async () => { throw jsonFailure; } },
    { stage: "provider_finish_reason_invalid", interpret: async () => { throw finishReasonFailure; } },
    { stage: "provider_refusal", interpret: async () => { throw refusalFailure; } },
    { stage: "response_structure_or_usage", interpret: async () => ({ meaning: {}, usage: { inputTokens: 1, outputTokens: 1 } }) },
    { stage: "response_structure_or_usage", interpret: async () => ({ meaning: validMeaning, usage: { inputTokens: -1, outputTokens: 1 } }) },
    { stage: "response_structure_or_usage", interpret: async () => ({
      meaning: { ...validMeaning, clarification_question: "Bạn muốn tiếp tục?", clarification_needed: false },
      usage: { inputTokens: 1, outputTokens: 1 },
    }) },
    { stage: "response_structure_or_usage", interpret: async () => ({
      meaning: { ...validMeaning, context_effect: "ADJUST_CURRENT", used_context_ids: [] },
      usage: { inputTokens: 1, outputTokens: 1 },
    }) },
    { stage: "response_content_validation", interpret: async () => ({ meaning: { ...validMeaning, response: "Tôi đã gọi bác sĩ." }, usage: { inputTokens: 1, outputTokens: 1 } }) },
    { stage: "record_usage", interpret: async () => ({ meaning: validMeaning, usage: { inputTokens: 1, outputTokens: 1 } }), recordFails: true },
  ];

  const results = await Promise.all(cases.map((scenario, index) => execute(`failure-${index}`, scenario)));
  for (let index = 0; index < cases.length; index += 1) {
    const result = results[index]!;
    assert.equal(result.status, 502);
    assert.deepEqual(result.payload, {
      code: "M3_RESPONSE_OR_PROVIDER_INVALID",
      message: "M3_RESPONSE_OR_PROVIDER_INVALID",
      retryable: false,
    });
    assert.equal(result.providerCalls, 1);
    assert.equal(result.reserves, 1);
    assert.equal(result.records, cases[index]!.stage === "record_usage" ? 1 : 0);
    assert.equal(result.logs.length, 1);
    assert.equal(result.logs[0]!.stage, cases[index]!.stage);
  }
  assert.equal(results[0]!.logs[0]!.status, 429);
  assert.equal(results[0]!.logs[0]!.errorCode, "PROVIDER_RATE_LIMITED");
  assert.deepEqual(
    {
      branch: results[5]!.logs[0]!.validationBranch,
      field: results[5]!.logs[0]!.field,
      rule: results[5]!.logs[0]!.rule,
    },
    { branch: "meaning_shape", field: "meaning", rule: "SHAPE_OR_FIELD_INVALID" },
  );
  assert.deepEqual(
    {
      branch: results[6]!.logs[0]!.validationBranch,
      field: results[6]!.logs[0]!.field,
      rule: results[6]!.logs[0]!.rule,
    },
    { branch: "usage", field: "usage", rule: "SAFE_INTEGER_NONNEGATIVE" },
  );
  assert.equal(results[7]!.logs[0]!.validationBranch, "meaning_relation");
  assert.equal(results[7]!.logs[0]!.rule, "QUESTION_MUST_BE_NULL");
  assert.equal(results[8]!.logs[0]!.validationBranch, "meaning_relation");
  assert.equal(results[8]!.logs[0]!.rule, "CONTEXT_IDS_REQUIRED");
  assert.equal(results[9]!.logs[0]!.validationBranch, "content");
  assert.equal(results[9]!.logs[0]!.field, "response");
  assert.equal(results[9]!.logs[0]!.rule, "CONTENT_BLOCKED");

  const success = await execute("success-001", {
    stage: "success",
    interpret: async () => ({ meaning: validMeaning, usage: { inputTokens: 12, outputTokens: 7 } }),
  });
  assert.equal(success.status, 200);
  assert.equal(success.providerCalls, 1);
  assert.equal(success.reserves, 1);
  assert.equal(success.records, 1);
  assert.equal(success.logs.length, 0);

  const loggerFailure = await execute("logger-failure", {
    stage: "provider_call",
    interpret: async () => { throw fixedFailure("provider_json_parse"); },
    loggerFails: true,
  });
  assert.equal(loggerFailure.status, 502);
  assert.equal(loggerFailure.providerCalls, 1, "logger failure must not retry provider");
  assert.equal(loggerFailure.reserves, 1);
  assert.equal(loggerFailure.records, 0);

  const serializedLogs = JSON.stringify(results.flatMap((result) => result.logs));
  assert.ok(!serializedLogs.includes(secretText));
  assert.ok(!serializedLogs.includes("current_text"));
  assert.ok(!serializedLogs.includes("cookie"));
  assert.ok(!serializedLogs.includes("authorization"));
  const correlations = results.map((result) => result.logs[0]!.correlationHash);
  assert.equal(new Set(correlations).size, correlations.length);
  assert.ok(correlations.every((value) => /^[a-f0-9]{64}$/u.test(value)));

  console.log("M3 diagnostics verifier: stages plus usage/meaning/relation/content reasons PASS");
  console.log("M3 diagnostics verifier: public response/reservation/record ordering PASS");
  console.log("M3 diagnostics verifier: success/no cross-request trace/logger isolation PASS");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});