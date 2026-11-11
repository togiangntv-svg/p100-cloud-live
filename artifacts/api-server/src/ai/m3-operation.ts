import { getM3TimeoutBudgets } from './provider';
import { subscribeOwnerRevocation, assertIdentityNotRetired } from '../identity/session-core';
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import {
  makeM3Response, m3LanguageInput, parseM3Request,
  type LanguageInput, type M3Usage,
} from "@workspace/api-zod";
import { GatewayProblem, validateProviderOutput, validateRequestTiming } from "./gateway";
import {
  type M3IdentityContext,
  type M3OperationGuard,
  type M3PermissionAuthority,
  M3PermissionError,
} from "./m3-permission";
import {
  contentValidationFailure, fixedFailure, M3DiagnosticFailure, providerFailure,
  responseValidationFailure,
  type M3DiagnosticMetadata,
} from "./m3-diagnostics";

type HandlerFailureStage = "provider_call" | "response_structure_or_usage"
  | "response_content_validation" | "record_usage";
type Entry = {
  owner: M3IdentityContext["owner"];
  sessionKey: string;
  retired?: boolean;
  eviction?: ReturnType<typeof setTimeout>;
  cancel?: () => void;
  hash: string;
  pending: boolean;
  response?: unknown;
  error?: GatewayProblem;
};

/**
 * Production M3 operation boundary. Identity and permission currentness are
 * re-read around every provider/cache/publication boundary; process RAM is
 * never a substitute for either authority.
 */
export function createM3Handler(deps: {
  enabled: () => boolean;
  available: () => void;
  verifyIdentity: (req: Request) => Promise<M3IdentityContext>;
  permission: M3PermissionAuthority;
  acquire: (principal: string) => void;
  release: (principal: string) => void;
  reserve: (requestKeyHash: string) => Promise<unknown>;
  record: (input: number, output: number) => Promise<unknown>;
  interpret: (input: LanguageInput, signal: AbortSignal) => Promise<{ meaning: unknown; usage: M3Usage }>;
  audit: (code: string) => void;
  diagnose: (metadata: M3DiagnosticMetadata) => void;
  timeoutMs?: number;
}) {
  const entries = new Map<string, Entry>();
  const retireEntries = (owner: M3IdentityContext['owner'], sessions?: readonly string[]) => {
    let count=0;for(const [key,entry] of [...entries]) if(entry.owner.subjectId===owner.subjectId&&entry.owner.profileId===owner.profileId&&(!sessions||sessions.includes(entry.sessionKey))){
      entry.retired=true;entry.response=undefined;entry.error=undefined;entry.hash='';if(entry.eviction)clearTimeout(entry.eviction);entries.delete(key);entry.cancel?.();entry.cancel=undefined;count++;
    }return count;
  };
  const unsubscribe = subscribeOwnerRevocation(event => { retireEntries(event.owner, event.retired?undefined:event.sessionKeys); });
  const sendProblem = (res: Response, error: GatewayProblem) => {
    if (!res.destroyed && !res.writableEnded) {
      res.status(error.status).json({ code: error.code, message: error.code, retryable: error.retryable });
    }
  };
  const fail = (code: string, status = 409, retryable = false) =>
    new GatewayProblem(status, code, retryable);
  const permissionFailure = (error: M3PermissionError) =>
    fail(error.code, error.status, error.retryable);

  const handler = async (req: Request, res: Response) => {
    let held = false;
    let principal = "";
    let entry: Entry | undefined;
    let guard: M3OperationGuard | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let providerController: AbortController | undefined;
    let clientCancelled = false;
    let timeoutExpired = false;
    let correlationHash: string | undefined;
    let failureStage: HandlerFailureStage | undefined;
    const cancel = () => {
      clientCancelled = true;
      if (guard) deps.permission.cancelOperation(guard);
      providerController?.abort();
    };
    const onClientAbort = () => cancel();
    const onResponseClose = () => { if (!res.writableEnded) cancel(); };
    req.once("aborted", onClientAbort);
    res.once("close", onResponseClose);
    try {
      if (!deps.enabled()) throw fail("M3_NOT_ENABLED", 503);
      const body = parseM3Request(req.body);
      if (body.operation !== "interpret" || body.input === null) throw fail("M3_SCHEMA_INVALID", 400);
      validateRequestTiming(body.createdAt, body.expiresAt);
      let identity = await deps.verifyIdentity(req);
      if (clientCancelled) throw fail("M3_CANCELLED");
      assertIdentityNotRetired(identity.owner, identity.sessionKey);
      principal = identity.sessionKey;
      const key = JSON.stringify([principal, body.requestId]);
      const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
      const existing = entries.get(key);
      if (existing) {
        if (existing.hash !== hash) throw fail("M3_IDEMPOTENCY_CONFLICT");
        if (existing.error) throw existing.error;
        if (existing.pending) throw fail("M3_REQUEST_IN_FLIGHT", 409, true);
        if (existing.response) {
          guard = deps.permission.beginOperation(identity, {
            operationId: body.requestId,
            grantId: body.grantId,
            taskSessionId: body.sessionId,
            taskId: body.taskId,
            taskRevision: body.taskRevision,
            permissionRevision: body.permissionRevision,
          });
          deps.permission.assertCurrent(guard, identity);
          res.json(existing.response);
          return;
        }
        throw fail("M3_REQUEST_FINISHED");
      }
      guard = deps.permission.beginOperation(identity, {
        operationId: body.requestId,
        grantId: body.grantId,
        taskSessionId: body.sessionId,
        taskId: body.taskId,
        taskRevision: body.taskRevision,
        permissionRevision: body.permissionRevision,
      });
      deps.available();
      deps.acquire(principal);
      held = true;
      entry = { hash, pending: true, owner: Object.freeze({...identity.owner}), sessionKey: principal, cancel };
      entries.set(key, entry);
      const eviction = setTimeout(() => entries.delete(key), 30 * 60_000);
      entry.eviction = eviction; eviction.unref?.();
      correlationHash = createHash("sha256").update(key).digest("hex");
      await deps.reserve(correlationHash);

      // Permission is fenced before budget reservation. Fresh Identity and
      // grant currentness follow that await, before any provider invocation.
      identity = await deps.verifyIdentity(req);
      assertIdentityNotRetired(identity.owner, identity.sessionKey);
      if(entry?.retired)throw fail("M3_AUTH_REQUIRED",401);
      if (identity.sessionKey !== principal) throw fail("M3_IDENTITY_DRIFT");
      if (clientCancelled) throw fail("M3_CANCELLED");
      deps.permission.assertCurrent(guard, identity);
      providerController = new AbortController();
      const abortProvider = () => providerController?.abort();
      guard.signal.addEventListener("abort", abortProvider, { once: true });
      timer = setTimeout(() => {
        timeoutExpired = true;
        cancel();
      }, deps.timeoutMs ?? getM3TimeoutBudgets().serverTimeoutMs);
      const cancelled = new Promise<never>((_, reject) => {
        providerController!.signal.addEventListener("abort", () => reject(
          timeoutExpired ? fail("M3_TIMEOUT", 504, true) : fail("M3_CANCELLED"),
        ), { once: true });
      });
      failureStage = "provider_call";
      const provider = deps.interpret(m3LanguageInput(body), providerController.signal);
      const output = await Promise.race([provider, cancelled]);

      identity = await deps.verifyIdentity(req);
      assertIdentityNotRetired(identity.owner, identity.sessionKey);
      if(entry?.retired)throw fail("M3_AUTH_REQUIRED",401);
      deps.permission.assertCurrent(guard, identity);
      validateRequestTiming(body.createdAt, body.expiresAt);
      failureStage = "response_structure_or_usage";
      let response;
      try {
        response = makeM3Response(body, output.meaning, output.usage);
      } catch (error) {
        throw responseValidationFailure(error);
      }
      failureStage = "response_content_validation";
      const contentFields = [
        ["interpreted_meaning", response.interpretedMeaning],
        ["response", response.response],
        ["uncertainty", response.uncertainty],
        ["clarification_question", response.clarificationQuestion],
        ...response.missingContext.map((text) => ["missing_context", text] as const),
      ] as const;
      for (const [field, text] of contentFields) {
        if (typeof text !== "string") continue;
        try {
          validateProviderOutput({ text, suggestions: [], usage: output.usage }, body.locale);
        } catch (error) {
          throw contentValidationFailure(error, field);
        }
      }
      identity = await deps.verifyIdentity(req);
      assertIdentityNotRetired(identity.owner, identity.sessionKey);
      if(entry?.retired)throw fail("M3_AUTH_REQUIRED",401);
      deps.permission.assertCurrent(guard, identity);
      failureStage = "record_usage";
      try {
        await deps.record(output.usage.inputTokens, output.usage.outputTokens);
      } catch {
        throw fixedFailure("record_usage");
      }
      identity = await deps.verifyIdentity(req);
      assertIdentityNotRetired(identity.owner, identity.sessionKey);
      if(entry?.retired)throw fail("M3_AUTH_REQUIRED",401);
      deps.permission.assertCurrent(guard, identity);
      validateRequestTiming(body.createdAt, body.expiresAt);
      failureStage = undefined;
      entry.response = response;
      res.json(response);
      deps.audit("M3_REQUEST_COMPLETE");
    } catch (error) {
      if (entry && correlationHash && (error instanceof M3DiagnosticFailure
        || (failureStage && !(error instanceof GatewayProblem)
          && !(error instanceof M3PermissionError)))) {
        const detail = error instanceof M3DiagnosticFailure
          ? error.detail
          : failureStage === "provider_call"
            ? providerFailure(error).detail
            : fixedFailure(failureStage as Exclude<HandlerFailureStage, "provider_call">).detail;
        try {
          deps.diagnose({ event: "ai_m3_internal_failure", correlationHash, ...detail });
        } catch {
          // Diagnostics must never alter the request outcome or trigger another attempt.
        }
      }
      const code = error instanceof Error ? error.message : "";
      const gatewayError = error instanceof GatewayProblem ? error
        : error instanceof M3PermissionError ? permissionFailure(error)
          : error instanceof Error && error.name === "IdentitySessionError"
            ? fail(code === "INVALID_SESSION" ? "M3_AUTH_REQUIRED" : "M3_AUTHORITY_UNAVAILABLE",
              code === "INVALID_SESSION" ? 401 : 503)
            : /M3_(SCHEMA_INVALID|CONSENT_REQUIRED|CONTEXT_NOT_PERMITTED|INPUT_TOO_LARGE)/u.test(code)
              ? fail(code, code.includes("CONSENT") || code.includes("PERMITTED") ? 403 : 400)
              : fail("M3_RESPONSE_OR_PROVIDER_INVALID", 502);
      if (entry && !entry.retired) entry.error = gatewayError;
      deps.audit(gatewayError.code);
      sendProblem(res, gatewayError);
    } finally {
      req.removeListener("aborted", onClientAbort);
      res.removeListener("close", onResponseClose);
      if (timer) clearTimeout(timer);
      providerController?.abort();
      if (guard) deps.permission.finishOperation(guard);
      if (entry) { entry.pending = false; entry.cancel=undefined; }
      if (held) deps.release(principal);
    }
  };
  return Object.assign(handler, { dispose: () => { unsubscribe(); for(const entry of [...entries.values()])retireEntries(entry.owner); }, inspectRetained: () => Object.freeze({entries:entries.size, pending:[...entries.values()].filter(e=>e.pending).length}) });
}
