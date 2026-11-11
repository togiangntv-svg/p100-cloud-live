import { productionVisionTaskConsentAuthority } from '../ai/c2-permission';
import { createHash } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  createAccountErasureDispatcher,
  createPostgresIdentitySessionCore,
  createVerifiedControlCapability,
  IdentitySessionError,
  type IdentitySessionCore,
} from "../identity/session-core";
import {
  AppleSignInError,
  createPostgresAppleChallengeIssuanceGate,
  createAppleSignInService,
  createPostgresAppleChallengeStore,
  createRemoteAppleJwkSource,
  requireAppleAudience,
  requireAppleChallengeIssuanceConfig,
  requireAppleChallengeTtlMs,
  requireAppleJwkTimeoutMs,
  type AppleChallengeIssuanceGate,
  type AppleSignInService,
} from "../identity/apple";

type SessionOperations = Pick<IdentitySessionCore, "verifySession" | "revokeSession">;
type LoadSessionOperations = () => Promise<SessionOperations>;
type LoadAppleSignIn = () => Promise<AppleSignInService>;

const productionCapability = createVerifiedControlCapability();
let productionCore: Promise<IdentitySessionCore> | undefined;
let productionApple: Promise<AppleSignInService> | undefined;
let productionChallengeIssuance: Promise<AppleChallengeIssuanceGate> | undefined;

export function requireProductionSessionTtlMs(value: string | undefined): number {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new IdentitySessionError("INTEGRITY_UNAVAILABLE");
  }
  const ttlMs = Number(value);
  if (!Number.isSafeInteger(ttlMs)) {
    throw new IdentitySessionError("INTEGRITY_UNAVAILABLE");
  }
  return ttlMs;
}

const loadProductionCore = async (): Promise<IdentitySessionCore> => {
  const sessionTtlMs = requireProductionSessionTtlMs(process.env["IDENTITY_SESSION_TTL_MS"]);
  productionCore ??= import("@workspace/db").then(({ pool }) =>
    createPostgresIdentitySessionCore(pool, productionCapability.authority, {
      sessionTtlMs,
    }));
  return productionCore;
};

const loadProductionApple: LoadAppleSignIn = async () => {
  const audience = requireAppleAudience(process.env["APPLE_SIGN_IN_AUDIENCE"]);
  const challengeTtlMs = requireAppleChallengeTtlMs(
    process.env["APPLE_SIGN_IN_CHALLENGE_TTL_MS"],
  );
  const jwkTimeoutMs = requireAppleJwkTimeoutMs(process.env["APPLE_JWK_TIMEOUT_MS"]);
  productionApple ??= Promise.all([import("@workspace/db"), loadProductionCore()])
    .then(([{ pool }, sessionCore]) => createAppleSignInService({
      audience,
      challengeTtlMs,
      challengeStore: createPostgresAppleChallengeStore(pool),
      jwkSource: createRemoteAppleJwkSource(fetch, jwkTimeoutMs),
      sessionCore,
      issueVerifiedControl: input => productionCapability.trustedIssuer.issue(input),
    }));
  return productionApple;
};

const productionChallengeGate: AppleChallengeIssuanceGate = Object.freeze({
  async acquire() {
    try {
      const config = requireAppleChallengeIssuanceConfig({
        windowMs: process.env["APPLE_CHALLENGE_ISSUANCE_WINDOW_MS"],
        maxPerWindow: process.env["APPLE_CHALLENGE_ISSUANCE_MAX_PER_WINDOW"],
      });
      productionChallengeIssuance ??= import("@workspace/db").then(({ pool }) =>
        createPostgresAppleChallengeIssuanceGate(pool, config));
      return (await productionChallengeIssuance).acquire();
    } catch {
      return "UNAVAILABLE";
    }
  },
});

function bearer(req: Request): string {
  const value = req.headers.authorization;
  const match = typeof value === "string" ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(value) : null;
  if (!match) throw new IdentitySessionError("INVALID_SESSION");
  return match[1];
}

export type VerifiedIdentityRequest = Readonly<{
  sessionKey: string;
  owner: Readonly<{ subjectId: string; profileId: string }>;
  validUntil: string;
}>;

/** Sole production request-session consumer; authority remains IdentitySessionCore.verifySession. */
export async function verifyIdentityRequest(
  req: Request,
  loadCore: LoadSessionOperations = loadProductionCore,
): Promise<VerifiedIdentityRequest> {
  const token = bearer(req);
  const verified = await (await loadCore()).verifySession(token);
  return Object.freeze({
    sessionKey: createHash("sha256").update(token, "utf8").digest("hex"),
    owner: verified.owner,
    validUntil: verified.validUntil,
  });
}

function denied(error: unknown): { status: number; body: Readonly<{ status: string }> } {
  if (error instanceof IdentitySessionError && error.code === "INVALID_SESSION") {
    return { status: 401, body: Object.freeze({ status: "denied" }) };
  }
  return { status: 503, body: Object.freeze({ status: "unavailable" }) };
}

function appleDenied(error: unknown): { status: number; body: Readonly<{ status: string }> } {
  if (error instanceof AppleSignInError
    && (error.code === "INVALID_CHALLENGE" || error.code === "INVALID_CREDENTIAL")) {
    return { status: 401, body: Object.freeze({ status: "denied" }) };
  }
  return { status: 503, body: Object.freeze({ status: "unavailable" }) };
}

export function createIdentityRouter(
  loadCore: LoadSessionOperations = loadProductionCore,
  loadApple: LoadAppleSignIn = loadProductionApple,
  challengeIssuance: AppleChallengeIssuanceGate = productionChallengeGate,
): IRouter {
  const router: IRouter = Router();

  router.post("/identity/apple/challenge", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const acquisition = await challengeIssuance.acquire();
      if (acquisition === "THROTTLED") {
        res.status(429).json({ status: "throttled" });
        return;
      }
      if (acquisition !== "ACQUIRED") {
        throw new AppleSignInError("AUTHORITY_UNAVAILABLE");
      }
      const challenge = await (await loadApple()).begin();
      res.status(201).json(challenge);
    } catch (error) {
      const response = appleDenied(error);
      res.status(response.status).json(response.body);
    }
  });

  router.post("/identity/apple/session", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
      const session = await (await loadApple()).complete({
        challenge: body.challenge,
        identityToken: body.identityToken,
      });
      res.status(201).json(session);
    } catch (error) {
      const response = appleDenied(error);
      res.status(response.status).json(response.body);
    }
  });

  router.get("/identity/session", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const result = await (await loadCore()).verifySession(bearer(req));
      res.status(200).json({ owner: result.owner, validUntil: result.validUntil });
    } catch (error) {
      const response = denied(error);
      res.status(response.status).json(response.body);
    }
  });

  router.post("/identity/session/logout", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const token = bearer(req);
      productionVisionTaskConsentAuthority.retireSession(createHash("sha256").update(token, "utf8").digest("hex"));
      await (await loadCore()).revokeSession(token);
      res.status(204).end();
    } catch (error) {
      const response = denied(error);
      res.status(response.status).json(response.body);
    }
  });

  router.post('/identity/account/delete', async (req: Request, res: Response) => {
    const dispatch = createAccountErasureDispatcher({eraseAccount: async token => {
      const core = await loadCore();
      if (!('eraseAccount' in core) || typeof core.eraseAccount !== 'function') throw new IdentitySessionError('AUTHORITY_UNAVAILABLE');
      await (core as IdentitySessionCore).eraseAccount(token);
    }});
    try {
      const result = await dispatch({path:'/api/identity/account/delete',method:'POST',headers:{authorization:req.headers.authorization,'content-type':req.headers['content-type']},rawBody:JSON.stringify(req.body??null)});
      res.setHeader('Cache-Control','no-store'); if(result.status===204)res.status(204).end();else res.status(result.status).json(result.body);
    } catch(error) { const response=denied(error);res.status(response.status).json(response.body); }
  });
  router.get('/identity/m2/facts', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control','no-store');
    try {
      const token=bearer(req);const core=await loadCore();
      if(!('readOwnerFacts' in core)||typeof core.readOwnerFacts!=='function')throw new IdentitySessionError('AUTHORITY_UNAVAILABLE');
      res.status(200).json(await (core as IdentitySessionCore).readOwnerFacts(token));
    } catch(error){const response=denied(error);res.status(response.status).json(response.body);}
  });
  return router;
}

export default createIdentityRouter();
