import {createC2Handlers} from '../ai/c2-operation';
import {productionVisionTaskConsentAuthority} from '../ai/c2-permission';
import {getC2VisionProvider} from '../ai/provider';
import {C2Error} from '../../../../lib/api-zod/src/c2-vision.ts';
import { createHash, randomUUID } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import {
  AiGatewayStatusResponse,
  AiRespondBody,
  AiRespondResponse,
  AiPilotSessionBody,
  AiPilotSessionResponse,
  AiResolveIntentBody,
  AiResolveIntentResponse,
  AiM3PermissionBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import {
  GatewayProblem,
  hashOpaque,
  validateInput,
  validateIntentOutput,
  validateProviderOutput,
  validateRequestTiming,
} from "../ai/gateway";
import {
  getAiProvider, getM3TimeoutBudgets, type AiIntentInput, type AiIntentOutput, type AiProviderInput, type AiProviderOutput,
} from "../ai/provider";
import { getPilotState, recordProviderSuccess, reserveProviderCall } from "../ai/pilot-store";
import { createM3Handler } from "../ai/m3-operation";
import {
  createM3PermissionAuthority,
  M3PermissionError,
} from "../ai/m3-permission";
import { verifyIdentityRequest } from "./identity";

const router: IRouter = Router();
const CONSENT_VERSION = "2026-09-10";
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 3;
const MAX_CONCURRENT_PER_PRINCIPAL = 1;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 1;
const PILOT_COOKIE = "pilot_100_ai";
const INTENT_COOKIE = "pilot_100_ai_intent";
const M3_COOKIE = "pilot_100_ai_m3";
const SESSION_MAX_AGE_MS = 30 * 60_000;

type CompletedEntry = { requestHash: string; response: unknown; expiresAt: number };
const completed = new Map<string, CompletedEntry>();
const inFlight = new Map<string, string>();
const rateWindows = new Map<string, { startedAt: number; count: number }>();
const concurrency = new Map<string, number>();
const m3Permission = createM3PermissionAuthority();

function problem(res: Parameters<Parameters<IRouter["post"]>[1]>[1], error: GatewayProblem) {
  return res.status(error.status).json({
    code: error.code,
    message: error.code,
    retryable: error.retryable,
  });
}

function assertGatewayAvailable(): void {
  if (process.env["AI_GATEWAY_ENABLED"] !== "true" || !getAiProvider().connected) {
    throw new GatewayProblem(503, "AI_NOT_CONNECTED");
  }
}

type ConsentPurpose = "internal_coaching_response" | "internal_intent_understanding" | "m3_intent_understanding";

function assertConsent(
  consent: { granted: boolean; version: string; purpose: string },
  purpose: ConsentPurpose,
): void {
  const expectedVersion = purpose === "m3_intent_understanding" ? "m3.v1" : CONSENT_VERSION;
  if (!consent.granted || consent.version !== expectedVersion || consent.purpose !== purpose) {
    throw new GatewayProblem(403, "AI_CONSENT_REQUIRED");
  }
}

function cookieForPurpose(purpose: ConsentPurpose): string {
  if (purpose === "m3_intent_understanding") return M3_COOKIE;
  return purpose === "internal_intent_understanding" ? INTENT_COOKIE : PILOT_COOKIE;
}

function principalFromSession(req: Request, purpose: ConsentPurpose): string {
  if (!process.env["SESSION_SECRET"]) {
    throw new GatewayProblem(503, "AI_AUTH_NOT_CONFIGURED");
  }
  const signedCookies = req.signedCookies as Record<string, unknown> | undefined;
  const session = signedCookies?.[cookieForPurpose(purpose)];
  if (typeof session !== "string" || session.length < 16) {
    throw new GatewayProblem(401, "AI_AUTH_REQUIRED");
  }
  return hashOpaque(session).slice(0, 16);
}

function checkRateAndConcurrency(principal: string): void {
  const now = Date.now();
  const window = rateWindows.get(principal);
  if (!window || now - window.startedAt >= WINDOW_MS) {
    rateWindows.set(principal, { startedAt: now, count: 1 });
  } else {
    if (window.count >= MAX_REQUESTS_PER_WINDOW) throw new GatewayProblem(429, "AI_RATE_LIMITED", true);
    window.count += 1;
  }
  if ((concurrency.get(principal) ?? 0) >= MAX_CONCURRENT_PER_PRINCIPAL) {
    throw new GatewayProblem(409, "AI_REQUEST_IN_FLIGHT", true);
  }
  concurrency.set(principal, (concurrency.get(principal) ?? 0) + 1);
}

function requestHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

function isTransient(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /\b(429|500|502|503|504|timeout|network)\b/iu.test(error.message);
}

async function callWithLimits(input: AiProviderInput): Promise<AiProviderOutput> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let attempt = 0;
    while (true) {
      await reserveProviderCall();
      try {
        return await getAiProvider().respond(input, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw new GatewayProblem(504, "AI_TIMEOUT", true);
        if (attempt >= MAX_RETRIES || !isTransient(error)) throw error;
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

async function callIntentOnce(input: AiIntentInput): Promise<AiIntentOutput> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    await reserveProviderCall();
    try {
      return await getAiProvider().resolveIntent(input, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw new GatewayProblem(504, "AI_TIMEOUT", true);
      throw error;
    }
  } finally {
    clearTimeout(timer);
  }
}

router.get("/ai/status", async (_req, res) => {
  let state;
  try {
    state = await getPilotState();
  } catch {
    return res.json(AiGatewayStatusResponse.parse({
      availability: "locked",
      provider: "openai_replit_managed",
      model: getAiProvider().model,
      liveModelVerified: false,
      requiresInternalAuth: true,
      maxLiveCalls: 20,
      usedLiveCalls: 20,
      remainingLiveCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
    }));
  }
  const enabled = process.env["AI_GATEWAY_ENABLED"] === "true";
  const authConfigured = Boolean(process.env["SESSION_SECRET"]);
  const remaining = Math.max(0, state.maxCalls - state.usedCalls);
  return res.json(AiGatewayStatusResponse.parse({
    availability: !enabled || !getAiProvider().connected
      ? "not_connected"
      : authConfigured && remaining > 0 ? "ready" : "locked",
    provider: "openai_replit_managed",
    model: getAiProvider().model,
    liveModelVerified: state.liveModelVerified,
    requiresInternalAuth: true,
    maxLiveCalls: state.maxCalls,
    usedLiveCalls: state.usedCalls,
    remainingLiveCalls: remaining,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
  }));
});

router.post("/ai/session", async (req, res) => {
  try {
    assertGatewayAvailable();
    if (!process.env["SESSION_SECRET"]) throw new GatewayProblem(503, "AI_AUTH_NOT_CONFIGURED");
    const body = AiPilotSessionBody.parse(req.body);
    if (body.consent.purpose === "m3_intent_understanding"
      && process.env["AI_M3_ENABLED"] !== "true") {
      throw new GatewayProblem(503, "M3_NOT_ENABLED");
    }
    assertConsent(body.consent, body.consent.purpose);
    const state = await getPilotState();
    if (state.usedCalls >= state.maxCalls) throw new GatewayProblem(429, "AI_BUDGET_EXHAUSTED");
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
    res.cookie(cookieForPurpose(body.consent.purpose), randomUUID(), {
      httpOnly: true,
      secure: true,
      signed: true,
      sameSite: "none",
      maxAge: SESSION_MAX_AGE_MS,
      path: "/api/ai",
    });
    return res.json(AiPilotSessionResponse.parse({ enabled: true, expiresAt }));
  } catch (error) {
    const gatewayError = error instanceof GatewayProblem
      ? error
      : error instanceof Error && error.name === "ZodError"
        ? new GatewayProblem(400, "AI_REQUEST_INVALID")
        : new GatewayProblem(503, "AI_SESSION_UNAVAILABLE");
    logger.warn({ event: "ai_session_rejected", code: gatewayError.code });
    return problem(res, gatewayError);
  }
});

router.post("/ai/respond", async (req, res) => {
  const requestId = typeof req.body?.requestId === "string" ? req.body.requestId : "unknown";
  let principal = "";
  try {
    assertGatewayAvailable();
    principal = principalFromSession(req, "internal_coaching_response");

    const body = AiRespondBody.parse(req.body);
    assertConsent(body.consent, "internal_coaching_response");
    validateRequestTiming(body.createdAt.toISOString(), body.expiresAt.toISOString());

    const input: AiProviderInput = {
      locale: body.locale,
      messages: body.messages,
      relevantContext: body.relevantContext.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
    };
    validateInput(input);

    const key = `${principal}:${body.requestId}`;
    const hash = requestHash(body);
    const existing = completed.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      if (existing.requestHash !== hash) throw new GatewayProblem(409, "AI_IDEMPOTENCY_CONFLICT");
      return res.json(existing.response);
    }
    if (inFlight.has(key)) {
      if (inFlight.get(key) !== hash) throw new GatewayProblem(409, "AI_IDEMPOTENCY_CONFLICT");
      throw new GatewayProblem(409, "AI_REQUEST_IN_FLIGHT", true);
    }

    const state = await getPilotState();
    if (state.usedCalls >= state.maxCalls) throw new GatewayProblem(429, "AI_BUDGET_EXHAUSTED");
    checkRateAndConcurrency(principal);
    inFlight.set(key, hash);

    try {
      const output = validateProviderOutput(await callWithLimits(input), input.locale);
      await recordProviderSuccess(output.usage.inputTokens, output.usage.outputTokens);
      const response = AiRespondResponse.parse({
        requestId: body.requestId,
        text: output.text,
        suggestions: output.suggestions,
        usage: output.usage,
      });
      completed.set(key, { requestHash: hash, response, expiresAt: Date.now() + 10 * 60_000 });
      logger.info({
        event: "ai_request_complete",
        requestId,
        principal,
        inputTokens: output.usage.inputTokens,
        outputTokens: output.usage.outputTokens,
      });
      return res.json(response);
    } finally {
      inFlight.delete(key);
      concurrency.set(principal, Math.max(0, (concurrency.get(principal) ?? 1) - 1));
    }
  } catch (error) {
    const gatewayError = error instanceof GatewayProblem
      ? error
      : error instanceof Error && error.name === "ZodError"
        ? new GatewayProblem(400, "AI_REQUEST_INVALID")
        : new GatewayProblem(502, "AI_PROVIDER_UNAVAILABLE", true);
    logger.warn({
      event: "ai_request_rejected",
      requestId,
      principal: principal || "unauthenticated",
      code: gatewayError.code,
    });
    return problem(res, gatewayError);
  }
});

router.post("/ai/intent", async (req, res) => {
  const requestId = typeof req.body?.requestId === "string" ? req.body.requestId : "unknown";
  let principal = "";
  try {
    assertGatewayAvailable();
    principal = principalFromSession(req, "internal_intent_understanding");
    const body = AiResolveIntentBody.parse(req.body);
    assertConsent(body.consent, "internal_intent_understanding");
    validateRequestTiming(body.createdAt.toISOString(), body.expiresAt.toISOString());
    const input: AiIntentInput = {
      locale: body.locale,
      text: body.text,
      relevantContext: body.relevantContext.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
    };
    validateInput({ locale: input.locale, messages: [{ role: "user", content: input.text }],
      relevantContext: input.relevantContext });

    const key = `${principal}:intent:${body.requestId}`;
    const hash = requestHash(body);
    const existing = completed.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      if (existing.requestHash !== hash) throw new GatewayProblem(409, "AI_IDEMPOTENCY_CONFLICT");
      return res.json(existing.response);
    }
    if (inFlight.has(key)) {
      if (inFlight.get(key) !== hash) throw new GatewayProblem(409, "AI_IDEMPOTENCY_CONFLICT");
      throw new GatewayProblem(409, "AI_REQUEST_IN_FLIGHT", true);
    }
    const state = await getPilotState();
    if (state.usedCalls >= state.maxCalls) throw new GatewayProblem(429, "AI_BUDGET_EXHAUSTED");
    checkRateAndConcurrency(principal);
    inFlight.set(key, hash);
    try {
      const output = validateIntentOutput(await callIntentOnce(input));
      await recordProviderSuccess(output.usage.inputTokens, output.usage.outputTokens);
      const response = AiResolveIntentResponse.parse({
        requestId: body.requestId,
        sessionId: body.sessionId,
        sessionRevision: body.sessionRevision,
        taskId: body.taskId,
        taskRevision: body.taskRevision,
        inputRevision: body.inputRevision,
        understanding: output.understanding,
        usage: output.usage,
      });
      completed.set(key, { requestHash: hash, response, expiresAt: Date.now() + 10 * 60_000 });
      logger.info({ event: "ai_intent_complete", requestId, principal,
        sessionRevision: hashOpaque(body.sessionRevision).slice(0, 12),
        taskId: hashOpaque(body.taskId).slice(0, 12),
        taskRevision: hashOpaque(body.taskRevision).slice(0, 12),
        inputTokens: output.usage.inputTokens, outputTokens: output.usage.outputTokens });
      return res.json(response);
    } finally {
      inFlight.delete(key);
      concurrency.set(principal, Math.max(0, (concurrency.get(principal) ?? 1) - 1));
    }
  } catch (error) {
    const gatewayError = error instanceof GatewayProblem
      ? error
      : error instanceof Error && error.name === "ZodError"
        ? new GatewayProblem(400, "AI_REQUEST_INVALID")
        : new GatewayProblem(502, "AI_PROVIDER_UNAVAILABLE", true);
    logger.warn({ event: "ai_intent_rejected", requestId,
      principal: principal || "unauthenticated", code: gatewayError.code });
    return problem(res, gatewayError);
  }
});

router.post("/ai/m3/permission", async (req, res) => {
  try {
    const body = AiM3PermissionBody.parse(req.body);
    if (body.action === "GRANT" && process.env["AI_M3_ENABLED"] !== "true") {
      throw new GatewayProblem(503, "M3_NOT_ENABLED");
    }
    const identity = await verifyIdentityRequest(req);
    return res.status(200).json(m3Permission.handle(identity, body));
  } catch (error) {
    const gatewayError = error instanceof GatewayProblem ? error
      : error instanceof M3PermissionError
        ? new GatewayProblem(error.status, error.code, error.retryable)
        : error instanceof Error && error.name === "IdentitySessionError"
          ? new GatewayProblem(error.message === "INVALID_SESSION" ? 401 : 503,
            error.message === "INVALID_SESSION" ? "M3_AUTH_REQUIRED" : "M3_AUTHORITY_UNAVAILABLE")
          : error instanceof Error && error.name === "ZodError"
            ? new GatewayProblem(400, "M3_PERMISSION_REQUEST_INVALID")
            : new GatewayProblem(503, "M3_AUTHORITY_UNAVAILABLE");
    logger.info({ event: "ai_m3_permission", code: gatewayError.code });
    return problem(res, gatewayError);
  }
});

const m3Handler = createM3Handler({
  timeoutMs: getM3TimeoutBudgets().serverTimeoutMs,
  enabled: () => process.env["AI_M3_ENABLED"] === "true",
  available: assertGatewayAvailable,
  verifyIdentity: verifyIdentityRequest,
  permission: m3Permission,
  acquire: checkRateAndConcurrency,
  release: (principal) => concurrency.set(principal, Math.max(0, (concurrency.get(principal) ?? 1) - 1)),
  reserve: async () => { await reserveProviderCall(); },
  record: (input, output) => recordProviderSuccess(input, output),
  interpret: (input, signal) => {
    const selectedProvider = getAiProvider();
    const interpret = selectedProvider.interpretM3;
    if (!interpret) return Promise.reject(new GatewayProblem(503, "M3_NOT_AVAILABLE"));
    return interpret.call(selectedProvider, input, signal);
  },
  audit: (code) => logger.info({ event: "ai_m3_operation", code }),
  diagnose: (metadata) => logger.warn(metadata, "M3 internal diagnostic"),
});

// Canonical M3 path. /ai/intent above remains a deprecated legacy adapter and
// is intentionally not used by the current client.
router.post("/ai/m3", m3Handler);

const c2Handlers=createC2Handlers({
 authority:productionVisionTaskConsentAuthority,
 verifyIdentity:req=>verifyIdentityRequest(req as Request),
 provider:getC2VisionProvider,
 reserve:async()=>{throw new C2Error('C2_BUDGET_NOT_ADMITTED',403);},
 // No real decoder/task producer/provider has been admitted in production.
});
router.post('/ai/c2/permission',c2Handlers.permission);
router.post('/ai/c2/vision',c2Handlers.vision);
export default router;
