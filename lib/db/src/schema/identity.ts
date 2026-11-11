import { sql } from "drizzle-orm";
import {
  char,
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const identitySchema = pgSchema("identity_v1");

export const identityOwners = identitySchema.table("owners", {
  subjectId: uuid("subject_id").primaryKey(),
  profileId: uuid("profile_id").notNull().unique(),
  status: varchar("status", { length: 16 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, table => [
  check("identity_owners_status", sql`${table.status} IN ('ACTIVE', 'RETIRED')`),
]);

export const verifiedControlBindings = identitySchema.table("verified_control_bindings", {
  bindingId: uuid("binding_id").primaryKey(),
  provider: varchar("provider", { length: 64 }).notNull(),
  credentialNamespaceDigest: char("credential_namespace_digest", { length: 64 }).notNull(),
  providerSubjectDigest: char("provider_subject_digest", { length: 64 }).notNull(),
  subjectId: uuid("subject_id").notNull()
    .references(() => identityOwners.subjectId, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, table => [
  uniqueIndex("verified_control_namespace_subject_uq")
    .on(table.provider, table.credentialNamespaceDigest, table.providerSubjectDigest),
  index("verified_control_subject_idx").on(table.subjectId),
  check(
    "verified_control_namespace_digest_hex",
    sql`${table.credentialNamespaceDigest} ~ '^[0-9a-f]{64}$'`,
  ),
  check(
    "verified_control_subject_digest_hex",
    sql`${table.providerSubjectDigest} ~ '^[0-9a-f]{64}$'`,
  ),
]);

export const identitySessions = identitySchema.table("sessions", {
  sessionId: uuid("session_id").primaryKey(),
  tokenDigest: char("token_digest", { length: 64 }).notNull().unique(),
  subjectId: uuid("subject_id").notNull()
    .references(() => identityOwners.subjectId, { onDelete: "restrict" }),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  issuerProvider: varchar("issuer_provider", { length: 64 }),
  issuerNamespaceDigest: char("issuer_namespace_digest", { length: 64 }),
  issuerEpoch: integer("issuer_epoch"),
  issuerReconciliationDigest: char("issuer_reconciliation_digest", { length: 64 }),
  legacyControlBindingId: uuid("legacy_control_binding_id"),
}, table => [
  index("identity_sessions_subject_idx").on(table.subjectId),
  index("identity_sessions_origin_idx")
    .on(
      table.issuerProvider,
      table.issuerNamespaceDigest,
      table.issuerEpoch,
      table.issuerReconciliationDigest,
    ),
  check("identity_sessions_valid_window", sql`${table.validUntil} > ${table.issuedAt}`),
  check("identity_sessions_token_digest_hex", sql`${table.tokenDigest} ~ '^[0-9a-f]{64}$'`),
  check(
    "identity_sessions_origin_all_or_none",
    sql`(
      (${table.issuerProvider} IS NULL AND ${table.issuerNamespaceDigest} IS NULL AND ${table.issuerEpoch} IS NULL AND ${table.issuerReconciliationDigest} IS NULL)
      OR
      (${table.issuerProvider} IS NOT NULL AND ${table.issuerNamespaceDigest} IS NOT NULL AND ${table.issuerEpoch} IS NOT NULL AND ${table.issuerReconciliationDigest} IS NOT NULL)
    )`,
  ),
  check(
    "identity_sessions_origin_provider",
    sql`${table.issuerProvider} IS NULL OR ${table.issuerProvider} ~ '^[a-z][a-z0-9._-]{0,63}$'`,
  ),
  check(
    "identity_sessions_origin_digest",
    sql`${table.issuerNamespaceDigest} IS NULL OR ${table.issuerNamespaceDigest} ~ '^[0-9a-f]{64}$'`,
  ),
  check(
    "identity_sessions_origin_epoch",
    sql`${table.issuerEpoch} IS NULL OR ${table.issuerEpoch} > 0`,
  ),
  check(
    "identity_sessions_origin_reconciliation_digest",
    sql`${table.issuerReconciliationDigest} IS NULL OR ${table.issuerReconciliationDigest} ~ '^[0-9a-f]{64}$'`,
  ),
  foreignKey({
    name: "identity_sessions_legacy_control_binding_fk",
    columns: [table.legacyControlBindingId],
    foreignColumns: [verifiedControlBindings.bindingId],
  }).onDelete("restrict"),
  check(
    "identity_sessions_legacy_control_binding_origin",
    sql`${table.legacyControlBindingId} IS NULL OR (
      ${table.issuerProvider} IS NULL
      AND ${table.issuerNamespaceDigest} IS NULL
      AND ${table.issuerEpoch} IS NULL
      AND ${table.issuerReconciliationDigest} IS NULL
    )`,
  ),
]);

export const appleSignInChallenges = identitySchema.table("apple_sign_in_challenges", {
  challengeDigest: char("challenge_digest", { length: 64 }).primaryKey(),
  nonceDigest: char("nonce_digest", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
}, table => [
  index("apple_sign_in_challenges_valid_until_idx").on(table.validUntil),
  index("apple_sign_in_challenges_consumed_at_idx").on(table.consumedAt),
  check(
    "apple_sign_in_challenge_digest_hex",
    sql`${table.challengeDigest} ~ '^[0-9a-f]{64}$'`,
  ),
  check(
    "apple_sign_in_nonce_digest_hex",
    sql`${table.nonceDigest} ~ '^[0-9a-f]{64}$'`,
  ),
  check("apple_sign_in_challenge_valid_window", sql`${table.validUntil} > ${table.createdAt}`),
  check(
    "apple_sign_in_challenge_consumed_window",
    sql`${table.consumedAt} IS NULL OR ${table.consumedAt} >= ${table.createdAt}`,
  ),
]);

export const appleChallengeIssuanceWindows = identitySchema.table("apple_challenge_issuance_windows", {
  bucketName: varchar("bucket_name", { length: 64 }).primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  requestCount: integer("request_count").notNull(),
}, table => [
  check(
    "apple_challenge_issuance_global_bucket",
    sql`${table.bucketName} = 'APPLE_CHALLENGE_GLOBAL_V1'`,
  ),
  check(
    "apple_challenge_issuance_positive_count",
    sql`${table.requestCount} > 0`,
  ),
]);
