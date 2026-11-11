export type GoogleNamespaceAuthorityKey = Readonly<{
  deploymentEnvironment: string;
  provider: "google";
  credentialNamespaceDigest: string;
}>;

export type GoogleNamespaceAuthoritySnapshot = Readonly<{
  schemaVersion: 1;
  deploymentEnvironment: string;
  provider: "google";
  credentialNamespaceDigest: string;
  admittedIncarnation: string;
  monotonicGeneration: number;
  status: "ENABLED" | "DISABLED";
  lastControlOperationId: string;
  lastControlAction: "ENABLE" | "DISABLE" | "RETIRE";
}>;

export type TrustedGoogleNamespaceBinding = Readonly<{
  deploymentEnvironment: string;
  admittedIncarnation: string;
}>;

export type GoogleNamespaceRetirementCas = Readonly<{
  key: GoogleNamespaceAuthorityKey;
  expectedIncarnation: string;
  expectedGeneration: number;
  expectedStatus: "ENABLED";
  operationId: string;
}>;

export interface GoogleNamespaceAuthority {
  readCurrent(key: GoogleNamespaceAuthorityKey): Promise<unknown>;
  compareAndSetRetirement(input: GoogleNamespaceRetirementCas): Promise<unknown>;
}

const DIGEST = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const AUTHORITY_FIELDS = new Set([
  "schemaVersion",
  "deploymentEnvironment",
  "provider",
  "credentialNamespaceDigest",
  "admittedIncarnation",
  "monotonicGeneration",
  "status",
  "lastControlOperationId",
  "lastControlAction",
]);

function safeScope(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function validateGoogleNamespaceAuthorityRecord(
  value: unknown,
  key: GoogleNamespaceAuthorityKey,
  binding: TrustedGoogleNamespaceBinding,
): GoogleNamespaceAuthoritySnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !safeScope(key.deploymentEnvironment)
    || !DIGEST.test(key.credentialNamespaceDigest)
    || key.provider !== "google"
    || binding.deploymentEnvironment !== key.deploymentEnvironment
    || !safeScope(binding.admittedIncarnation)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const fields = Object.keys(record);
  if (fields.length !== AUTHORITY_FIELDS.size
    || fields.some(field => !AUTHORITY_FIELDS.has(field))
    || record.schemaVersion !== 1
    || record.deploymentEnvironment !== key.deploymentEnvironment
    || record.provider !== "google"
    || record.credentialNamespaceDigest !== key.credentialNamespaceDigest
    || record.admittedIncarnation !== binding.admittedIncarnation
    || !Number.isSafeInteger(record.monotonicGeneration)
    || Number(record.monotonicGeneration) < 1
    || (record.status !== "ENABLED" && record.status !== "DISABLED")
    || typeof record.lastControlOperationId !== "string"
    || !SAFE_ID.test(record.lastControlOperationId)
    || (record.lastControlAction !== "ENABLE"
      && record.lastControlAction !== "DISABLE"
      && record.lastControlAction !== "RETIRE")) {
    return null;
  }

  return Object.freeze({
    schemaVersion: 1,
    deploymentEnvironment: key.deploymentEnvironment,
    provider: "google",
    credentialNamespaceDigest: key.credentialNamespaceDigest,
    admittedIncarnation: binding.admittedIncarnation,
    monotonicGeneration: Number(record.monotonicGeneration),
    status: record.status,
    lastControlOperationId: record.lastControlOperationId,
    lastControlAction: record.lastControlAction,
  });
}

export function sameGoogleNamespaceAuthorityState(
  left: GoogleNamespaceAuthoritySnapshot,
  right: GoogleNamespaceAuthoritySnapshot,
): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.deploymentEnvironment === right.deploymentEnvironment
    && left.provider === right.provider
    && left.credentialNamespaceDigest === right.credentialNamespaceDigest
    && left.admittedIncarnation === right.admittedIncarnation
    && left.monotonicGeneration === right.monotonicGeneration
    && left.status === right.status
    && left.lastControlOperationId === right.lastControlOperationId
    && left.lastControlAction === right.lastControlAction;
}

export const unavailableGoogleNamespaceAuthority: GoogleNamespaceAuthority = Object.freeze({
  async readCurrent(): Promise<unknown> {
    return null;
  },
  async compareAndSetRetirement(): Promise<unknown> {
    throw new Error("Google namespace authority is unavailable");
  },
});
