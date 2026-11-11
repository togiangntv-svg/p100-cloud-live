import type { M3Response } from "@workspace/api-client-react";
import type { IntentMeaning, LanguageInput } from "./contract";

export type M3Ticket = Readonly<{
  session_id: string; task_id: string; task_revision: number;
  permission_revision: number; operation_id: string;
}>;
export type M3Operation = Readonly<{
  ticket: M3Ticket; permission: Readonly<{
    external_access: "M3_TEXT"; purpose: "m3_intent_understanding"; revision: number;
  }>; isCurrent: () => boolean;
}>;
export type M3Revocation = Readonly<{ ticket: M3Ticket; permission: Readonly<{ revision: number }> }>;
export interface M3LanguageAdapter {
  readonly provenance: "PRODUCTION" | "TEST_FIXTURE";
  readonly processing: "ON_DEVICE" | "EXTERNAL";
  readonly contract: "M3_GATEWAY_V1";
  interpret(input: Readonly<{ content: LanguageInput; operation: M3Operation }>, signal: AbortSignal): Promise<IntentMeaning>;
  revoke(input: M3Revocation): Promise<void>;
}
export type M3ResolverInput = Readonly<{
  source_input: string;
  ticket: M3Ticket;
  permission_scope: M3Operation["permission"];
  current_task: { task_id: string; revision: number; m3_context?: LanguageInput };
  isCurrent: () => boolean;
}>;
export function createM3IntentResolver(adapter: M3LanguageAdapter) {
  return Object.freeze({
    provenance: adapter.provenance === "TEST_FIXTURE" ? "TEST_FIXTURE" as const : "VERIFIED_RESOLVER" as const,
    contract: "M3_V1" as const,
    async resolve(input: M3ResolverInput, signal: AbortSignal) {
      if (signal.aborted || !input.isCurrent()) return { state: "NEEDS_ROUTING" as const };
      const content = input.current_task.m3_context ?? {
        locale: "vi" as const, current_text: input.source_input, relevant_context: [],
        recent_relevant_turns: [], user_correction: null, safety_signal: "CLEAR" as const, asking_stopped: false,
      };
      if (input.permission_scope.external_access !== "M3_TEXT"
        || input.permission_scope.purpose !== "m3_intent_understanding") {
        return { state: "UNAVAILABLE" as const, reason: "LANGUAGE_ADAPTER_UNAVAILABLE" as const };
      }
      const meaning = await adapter.interpret({
        content,
        operation: { ticket: input.ticket, permission: input.permission_scope, isCurrent: input.isCurrent },
      }, signal);
      if (signal.aborted || !input.isCurrent()) return { state: "NEEDS_ROUTING" as const };
      return { state: "INTERPRETED" as const, interpretation: meaning };
    },
  });
}

export type M3WireResponse = M3Response;