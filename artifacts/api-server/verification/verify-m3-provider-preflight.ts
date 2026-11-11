import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import type { M3DiagnosticMetadata } from "../src/ai/m3-diagnostics";

// Run against this checkout's shared contract without install/bundling.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@workspace/api-zod") {
    return nextResolve(new URL("../../../lib/api-zod/src/index.ts", import.meta.url).href, context);
  }
  if (specifier === "@workspace/integrations-openai-ai-server") {
    return { url: "data:text/javascript," + encodeURIComponent(
      "export const openai = { chat: { completions: { create: async () => { throw new Error('UNMOCKED_PROVIDER'); } } } };"
    ), shortCircuit: true };
  }
  if (specifier.endsWith("/generated/types")) return nextResolve(specifier + "/index.ts", context);
  return nextResolve(specifier.startsWith(".") && (!extname(specifier) || specifier.endsWith("/api.schemas"))
    ? specifier + ".ts" : specifier, context);
} });

process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"] = "https://offline.invalid";
process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] = "offline-placeholder";

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("OFFLINE_PREFLIGHT_BLOCKED_NETWORK");
};

const meaning = {
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

type FakeCompletion = {
  choices: Array<{
    finish_reason: string;
    message: { content: string | null; refusal?: string | null };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
};

async function main() {
  const {
    M3_MODEL_SCHEMA, makeM3Response, m3LanguageInput, parseM3Request, readM3Response,
  } = await import("../../../lib/api-zod/src/index.ts");
  const { createM3Handler } = await import("../src/ai/m3-operation.ts");
  const { M3DiagnosticFailure } = await import("../src/ai/m3-diagnostics.ts");
  function request(locale: "vi" | "en" = "vi", currentText?: string) {
    const now = Date.now();
    return parseM3Request({
      version: "m3.v1", operation: "interpret", requestId: "offline-provider-001",
      sessionId: "offline-session", taskId: "offline-task",
      taskRevision: 1, permissionRevision: 1,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
      locale,
      consent: { granted: true, version: "m3.v1", purpose: "m3_intent_understanding" },
      input: {
        locale,
        current_text: currentText ?? (locale === "vi" ? "Nội dung ngoại tuyến" : "Offline content"),
        relevant_context: [],
        recent_relevant_turns: [], user_correction: null,
        safety_signal: "CLEAR", asking_stopped: false,
      },
    });
  }
  const [{ openai }, { getAiProvider }] = await Promise.all([
    import("@workspace/integrations-openai-ai-server"),
    import("../src/ai/provider"),
  ]);
  const completions = openai.chat.completions as unknown as {
    create: (body: unknown, options?: unknown) => Promise<FakeCompletion>;
  };
  const originalCreate = completions.create;
  const calls: Array<{ body: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const queue: FakeCompletion[] = [
    {
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(meaning), refusal: null } }],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    },
    {
      choices: [{
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            ...meaning,
            intent_type: "GOAL",
            interpreted_meaning: "The user wants to define a goal",
            response: "I understand the goal you want to define.",
          }),
          refusal: null,
        },
      }],
      usage: { prompt_tokens: 11, completion_tokens: 8 },
    },
    {
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(meaning), refusal: null } }],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    },
    {
      choices: [{ finish_reason: "stop", message: { content: null, refusal: null } }],
    },
    {
      choices: [{ finish_reason: "length", message: { content: JSON.stringify(meaning), refusal: null } }],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    },
    {
      choices: [{
        finish_reason: "stop",
        message: { content: JSON.stringify(meaning), refusal: "SENSITIVE_REFUSAL_SENTINEL" },
      }],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    },
    {
      choices: [{ finish_reason: "content_filter", message: { content: JSON.stringify(meaning) } }],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    },
    {
      choices: [{ finish_reason: undefined as unknown as string, message: { content: JSON.stringify(meaning) } }],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    },
  ];
  completions.create = async (rawBody, rawOptions) => {
    calls.push({
      body: rawBody as Record<string, unknown>,
      options: rawOptions as Record<string, unknown>,
    });
    const next = queue.shift();
    assert.ok(next, "unexpected provider invocation");
    return next;
  };

  try {
    const contractRequest = request();
    const input = m3LanguageInput(contractRequest);
    const signal = new AbortController().signal;
    const provider = getAiProvider();

    const valid = await provider.interpretM3!(input, signal);
    const response = makeM3Response(contractRequest, valid.meaning, valid.usage);
    assert.equal(response.usage.inputTokens, 12);
    assert.equal(response.usage.outputTokens, 7);

    const first = calls[0]!;
    assert.equal(first.body.model, "gpt-5.6-sol");
    assert.equal(first.body.max_completion_tokens, 1200);
    assert.deepEqual(first.body.response_format, {
      type: "json_schema",
      json_schema: M3_MODEL_SCHEMA,
    });
    assert.equal(first.options.maxRetries, 0);
    assert.equal(first.options.signal, signal);
    const messages = first.body.messages as Array<{ role: string; content: string }>;
    assert.equal(messages.length, 2);
    assert.match(messages[0]!.content, /natural Vietnamese/u);
    assert.match(messages[0]!.content, /Understanding an intent does not mean enough information or permission/u);
    assert.match(messages[0]!.content, /exactly one missing_context item/u);
    assert.match(messages[0]!.content, /exact id from relevant_context/u);
    assert.match(messages[0]!.content, /current user in the current scoped episode/u);
    assert.match(messages[0]!.content, /at least URGENT safety_state and STOP/u);
    assert.match(messages[0]!.content, /Never downgrade input.safety_signal/u);
    assert.deepEqual(JSON.parse(messages[1]!.content), input);

    const englishRequest = request("en");
    const englishInput = m3LanguageInput(englishRequest);
    const english = await provider.interpretM3!(englishInput, new AbortController().signal);
    const englishResponse = makeM3Response(englishRequest, english.meaning, english.usage);
    assert.equal(englishResponse.intentType, "GOAL");
    const englishMessages = calls[1]!.body.messages as Array<{ role: string; content: string }>;
    assert.match(englishMessages[0]!.content, /natural English/u);
    assert.deepEqual(JSON.parse(englishMessages[1]!.content), englishInput);

    const urgentRequest = request("en", "I have chest pain while walking");
    const urgentInput = m3LanguageInput(urgentRequest);
    const ignoredUrgent = await provider.interpretM3!(urgentInput, new AbortController().signal);
    const urgentResponse = makeM3Response(urgentRequest, ignoredUrgent.meaning, ignoredUrgent.usage);
    assert.equal(urgentResponse.safetyState, "URGENT");
    assert.equal(urgentResponse.intentType, "SAFETY");
    assert.equal(urgentResponse.suggestedNextRole, "STOP");
    assert.equal(urgentResponse.response,
      "Stop the current action and seek urgent medical help where you are.");
    const downgradedWire = {
      ...urgentResponse, intentType: "CURRENT_TASK", safetyState: "CLEAR",
      suggestedNextRole: "M4", response: "I understand the current task.",
    };
    const clientMeaning = readM3Response(downgradedWire, urgentRequest);
    assert.equal(clientMeaning.safetyState, "URGENT");
    assert.equal(clientMeaning.intentType, "SAFETY");
    assert.equal(clientMeaning.suggestedNextRole, "STOP");

    const hostUrgent = parseM3Request({
      ...contractRequest,
      input: { ...contractRequest.input, safety_signal: "URGENT" },
    });
    const hostUrgentResult = makeM3Response(hostUrgent, meaning, { inputTokens: 1, outputTokens: 1 });
    assert.equal(hostUrgentResult.safetyState, "URGENT");
    assert.equal(hostUrgentResult.suggestedNextRole, "STOP");
    const hostPain = parseM3Request({
      ...contractRequest,
      input: { ...contractRequest.input, safety_signal: "PAIN" },
    });
    assert.equal(makeM3Response(hostPain, meaning, { inputTokens: 1, outputTokens: 1 }).safetyState, "PAIN");
    assert.equal(makeM3Response(contractRequest, { ...meaning, safety_state: "SENSITIVE" },
      { inputTokens: 1, outputTokens: 1 }).safetyState, "SENSITIVE");
    const stoppedInput = parseM3Request({
      ...urgentRequest,
      input: { ...urgentRequest.input, asking_stopped: true },
    });
    const stoppedResult = makeM3Response(stoppedInput, meaning, { inputTokens: 1, outputTokens: 1 });
    assert.equal(stoppedResult.safetyState, "URGENT");
    assert.equal(stoppedResult.suggestedNextRole, "STOP");
    assert.equal(stoppedResult.clarificationNeeded, false);
    const stoppedBenign = parseM3Request({
      ...contractRequest,
      input: { ...contractRequest.input, asking_stopped: true },
    });
    const stoppedBenignResult = makeM3Response(stoppedBenign, meaning,
      { inputTokens: 1, outputTokens: 1 });
    assert.equal(stoppedBenignResult.suggestedNextRole, "M4");
    assert.equal(stoppedBenignResult.clarificationNeeded, false);

    const missing = await provider.interpretM3!(input, new AbortController().signal)
      .catch((error) => error);
    assert.ok(missing instanceof M3DiagnosticFailure);
    assert.equal(missing.detail.stage, "provider_content_missing");

    const truncated = await provider.interpretM3!(input, new AbortController().signal)
      .catch((error) => error);
    assert.ok(truncated instanceof M3DiagnosticFailure);
    assert.equal(truncated.detail.stage, "provider_finish_reason_invalid");
    assert.equal(truncated.detail.finishReason, "length");

    const refused = await provider.interpretM3!(input, new AbortController().signal)
      .catch((error) => error);
    assert.ok(refused instanceof M3DiagnosticFailure);
    assert.equal(refused.detail.stage, "provider_refusal");
    assert.ok(!JSON.stringify(refused.detail).includes("SENSITIVE_REFUSAL_SENTINEL"));

    const filtered = await provider.interpretM3!(input, new AbortController().signal)
      .catch((error) => error);
    assert.ok(filtered instanceof M3DiagnosticFailure);
    assert.equal(filtered.detail.stage, "provider_finish_reason_invalid");
    assert.equal(filtered.detail.finishReason, "content_filter");

    const missingMetadata = await provider.interpretM3!(input, new AbortController().signal)
      .catch((error) => error);
    assert.ok(missingMetadata instanceof M3DiagnosticFailure);
    assert.equal(missingMetadata.detail.stage, "provider_finish_reason_invalid");
    assert.equal(missingMetadata.detail.finishReason, "missing");

    assert.equal(calls.length, 8);
    assert.equal(queue.length, 0);

    const properties = M3_MODEL_SCHEMA.schema.properties;
    assert.deepEqual(properties.confidence, { type: "number", minimum: 0, maximum: 1 });
    assert.equal(properties.missing_context.maxItems, 1);
    assert.equal(properties.used_context_ids.maxItems, 4);
    assert.equal(properties.task_kind.pattern, "^[a-z][a-z0-9_]{0,79}$");
    assert.equal(properties.interpreted_meaning.pattern, "\\S");
    assert.ok(!("maxLength" in properties.interpreted_meaning));

    const make = (nextMeaning: typeof meaning) =>
      makeM3Response(contractRequest, nextMeaning, { inputTokens: 1, outputTokens: 1 });
    assert.doesNotThrow(() => make({ ...meaning, confidence: 0 }));
    assert.doesNotThrow(() => make({ ...meaning, confidence: 1 }));
    assert.throws(() => make({ ...meaning, confidence: -0.01 }), /M3_OUTPUT_INVALID/u);
    assert.throws(() => make({ ...meaning, confidence: 1.01 }), /M3_OUTPUT_INVALID/u);
    assert.doesNotThrow(() => make({
      ...meaning,
      task_kind: `a${"1".repeat(79)}`,
    }));
    assert.throws(() => make({
      ...meaning,
      task_kind: `a${"1".repeat(80)}`,
    }), /M3_OUTPUT_INVALID/u);
    assert.doesNotThrow(() => make({
      ...meaning,
      interpreted_meaning: "a".repeat(400),
      uncertainty: "a".repeat(240),
      response: "a".repeat(320),
    }));
    assert.throws(() => make({
      ...meaning,
      interpreted_meaning: "a".repeat(401),
    }), /M3_OUTPUT_INVALID/u);
    assert.throws(() => make({
      ...meaning,
      missing_context: ["Một", "Hai"],
    }), /M3_OUTPUT_INVALID/u);
    assert.doesNotThrow(() => make({
      ...meaning,
      intent_type: "CORRECTION",
      interpreted_meaning: "Người dùng đang sửa lại điều vừa nói",
      response: "Mình hiểu phần bạn vừa sửa.",
    }));
    assert.doesNotThrow(() => makeM3Response(englishRequest, {
      ...meaning,
      intent_type: "AMBIGUOUS",
      interpreted_meaning: "The user has not specified which task to continue",
      uncertainty: "The intended task is unclear",
      missing_context: ["Which task they want to continue"],
      clarification_needed: true,
      clarification_question: "Which task would you like to continue?",
      response: "I need one detail before interpreting this.",
    }, { inputTokens: 1, outputTokens: 1 }));

    const executeGateway = async (
      requestId: string,
      completion: FakeCompletion,
      currentText?: string,
    ) => {
      queue.push(completion);
      let providerCalls = 0;
      let reserves = 0;
      let records = 0;
      let status = 0;
      let payload: unknown;
      const logs: M3DiagnosticMetadata[] = [];
      const handler = createM3Handler({
        enabled: () => true,
        available: () => undefined,
        principal: () => "offline-principal",
        acquire: () => undefined,
        release: () => undefined,
        reserve: async () => { reserves += 1; },
        record: async () => { records += 1; },
        interpret: async (providerInput, providerSignal) => {
          providerCalls += 1;
          return provider.interpretM3!(providerInput, providerSignal);
        },
        audit: () => undefined,
        diagnose: (metadata) => logs.push(metadata),
      });
      const requestBody = {
        ...contractRequest,
        requestId,
        taskId: `task-${requestId}`,
        input: { ...contractRequest.input!, current_text: currentText ?? contractRequest.input!.current_text },
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
      const req = {
        body: requestBody,
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
    };
    const completion = (
      nextMeaning: unknown,
      usage = { prompt_tokens: 12, completion_tokens: 7 },
    ): FakeCompletion => ({
      choices: [{
        finish_reason: "stop",
        message: { content: JSON.stringify(nextMeaning), refusal: null },
      }],
      usage,
    });
    const gatewayCases = [
      await executeGateway("gateway-success", completion(meaning)),
      await executeGateway("gateway-usage", completion(meaning, {
        prompt_tokens: -1, completion_tokens: 7,
      })),
      await executeGateway("gateway-shape", completion({})),
      await executeGateway("gateway-relation", completion({
        ...meaning,
        clarification_needed: false,
        clarification_question: "Bạn muốn tiếp tục?",
      })),
      await executeGateway("gateway-validator", completion({
        ...meaning,
        response: "Bạn muốn tiếp tục?",
      })),
      await executeGateway("gateway-content", completion({
        ...meaning,
        response: "You can continue",
      })),
    ];
    const [gatewaySuccess, usageInvalid, shapeInvalid, relationInvalid,
      schemaAllowedValidatorRejected, contentInvalid] = gatewayCases;
    assert.equal(gatewaySuccess!.status, 200);
    assert.equal(gatewaySuccess!.records, 1);
    assert.equal(gatewaySuccess!.logs.length, 0);
    for (const rejected of gatewayCases.slice(1)) {
      assert.equal(rejected.status, 502);
      assert.deepEqual(rejected.payload, {
        code: "M3_RESPONSE_OR_PROVIDER_INVALID",
        message: "M3_RESPONSE_OR_PROVIDER_INVALID",
        retryable: false,
      });
      assert.equal(rejected.providerCalls, 1);
      assert.equal(rejected.reserves, 1);
      assert.equal(rejected.records, 0);
      assert.equal(rejected.logs.length, 1);
    }
    assert.equal(usageInvalid!.logs[0]!.validationBranch, "usage");
    assert.equal(usageInvalid!.logs[0]!.rule, "SAFE_INTEGER_NONNEGATIVE");
    assert.equal(shapeInvalid!.logs[0]!.validationBranch, "meaning_shape");
    assert.equal(shapeInvalid!.logs[0]!.rule, "SHAPE_OR_FIELD_INVALID");
    assert.equal(relationInvalid!.logs[0]!.validationBranch, "meaning_relation");
    assert.equal(relationInvalid!.logs[0]!.rule, "QUESTION_MUST_BE_NULL");
    assert.equal(schemaAllowedValidatorRejected!.logs[0]!.validationBranch, "meaning_shape");
    assert.equal(schemaAllowedValidatorRejected!.logs[0]!.rule, "SHAPE_OR_FIELD_INVALID");
    assert.equal(contentInvalid!.logs[0]!.validationBranch, "content");
    assert.equal(contentInvalid!.logs[0]!.field, "response");
    assert.equal(contentInvalid!.logs[0]!.rule, "LOCALE_MISMATCH");
    const gatewayUrgent = await executeGateway("gateway-urgent-floor", completion(meaning),
      "Đang đi tôi tức ngực");
    assert.equal(gatewayUrgent.status, 200);
    assert.equal(gatewayUrgent.providerCalls, 1);
    assert.equal(gatewayUrgent.records, 1);
    assert.equal(gatewayUrgent.logs.length, 0);
    const urgentPayload = gatewayUrgent.payload as Record<string, unknown>;
    assert.equal(urgentPayload.safetyState, "URGENT");
    assert.equal(urgentPayload.intentType, "SAFETY");
    assert.equal(urgentPayload.suggestedNextRole, "STOP");
    assert.equal(queue.length, 0);

    console.log("M3 provider offline preflight: product request construction and no-retry PASS");
    console.log("M3 provider offline preflight: complete response and missing-content handling PASS");
    console.log("M3 provider offline preflight: non-stop/missing finish reason rejected PASS");
    console.log("M3 provider offline preflight: refusal rejected without content leakage PASS");
    console.log("M3 provider offline preflight: real provider to validator with fake ledger PASS");
    console.log("M3 provider offline preflight: usage/shape/relation/content rejection PASS");
  } finally {
    completions.create = originalCreate;
    globalThis.fetch = originalFetch;
    delete process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
    delete process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  }
}

void main().catch((error) => {
  globalThis.fetch = originalFetch;
  console.error(error instanceof Error ? error.name : "OfflinePreflightError");
  process.exitCode = 1;
});
