import type { M4Decision, M4ContextInput } from "../domain/m4/contract";

// Compile-time exhaustiveness: a host must distinguish context from intent.
export function classify(decision: M4Decision): string {
  switch (decision.state) {
    case "CONTEXT_SUFFICIENT": return decision.sufficient_for;
    case "CONTEXT_REQUIRED": return decision.missing.join(",");
    case "PERMISSION_REQUIRED": return decision.item;
    case "CONTEXT_DECLINED": return decision.alternative;
    case "PROFESSIONAL_HANDOFF_NEEDED": return decision.reason;
    case "NEED_CLARIFICATION": return decision.next_role;
    case "DEFERRED": return decision.reason;
    default: { const never: never = decision; return never; }
  }
}

const imageConsent: M4ContextInput["permission"] = {
  // @ts-expect-error Consent to M3 text must never be accepted as image consent.
  purpose: "m3_intent_understanding", status: "allowed", revision: 1,
};
void imageConsent;
