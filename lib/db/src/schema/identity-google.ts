import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  integer,
  primaryKey,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { identitySchema } from "./identity";

export const providerSessionPolicies = identitySchema.table("provider_session_policies", {
  provider: varchar("provider", { length: 64 }).notNull(),
  credentialNamespaceDigest: char("credential_namespace_digest", { length: 64 }).notNull(),
  enabled: boolean("enabled").notNull(),
  currentEpoch: integer("current_epoch").notNull(),
  reconciliationDigest: char("reconciliation_digest", { length: 64 }),
}, table => [
  primaryKey({
    name: "provider_session_policies_pk",
    columns: [table.provider, table.credentialNamespaceDigest],
  }),
  check(
    "provider_session_policies_provider",
    sql`${table.provider} ~ '^[a-z][a-z0-9._-]{0,63}$'`,
  ),
  check(
    "provider_session_policies_namespace_digest",
    sql`${table.credentialNamespaceDigest} ~ '^[0-9a-f]{64}$'`,
  ),
  check("provider_session_policies_epoch", sql`${table.currentEpoch} > 0`),
  check(
    "provider_session_policies_reconciliation_digest",
    sql`${table.reconciliationDigest} IS NULL OR ${table.reconciliationDigest} ~ '^[0-9a-f]{64}$'`,
  ),
]);

export const googleSignInChallenges = identitySchema.table("google_sign_in_challenges", {
  challengeDigest: char("challenge_digest", { length: 64 }).primaryKey(),
  credentialNamespaceDigest: char("credential_namespace_digest", { length: 64 }).notNull(),
  issuerEpoch: integer("issuer_epoch").notNull(),
  nonceDigest: char("nonce_digest", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
}, table => [
  index("google_sign_in_challenges_namespace_epoch_idx")
    .on(table.credentialNamespaceDigest, table.issuerEpoch),
  index("google_sign_in_challenges_valid_until_idx").on(table.validUntil),
  check(
    "google_sign_in_challenge_digest_hex",
    sql`${table.challengeDigest} ~ '^[0-9a-f]{64}$'`,
  ),
  check(
    "google_sign_in_namespace_digest_hex",
    sql`${table.credentialNamespaceDigest} ~ '^[0-9a-f]{64}$'`,
  ),
  check("google_sign_in_epoch_positive", sql`${table.issuerEpoch} > 0`),
  check("google_sign_in_nonce_digest_hex", sql`${table.nonceDigest} ~ '^[0-9a-f]{64}$'`),
  check("google_sign_in_challenge_valid_window", sql`${table.validUntil} > ${table.createdAt}`),
  check(
    "google_sign_in_challenge_consumed_window",
    sql`${table.consumedAt} IS NULL OR ${table.consumedAt} >= ${table.createdAt}`,
  ),
  check(
    "google_sign_in_challenge_invalidated_window",
    sql`${table.invalidatedAt} IS NULL OR ${table.invalidatedAt} >= ${table.createdAt}`,
  ),
  check(
    "google_sign_in_challenge_terminal_state",
    sql`${table.consumedAt} IS NULL OR ${table.invalidatedAt} IS NULL`,
  ),
]);

export const googleChallengeIssuanceWindows = identitySchema.table(
  "google_challenge_issuance_windows",
  {
    credentialNamespaceDigest: char("credential_namespace_digest", { length: 64 }).notNull(),
    issuerEpoch: integer("issuer_epoch").notNull(),
    bucketName: varchar("bucket_name", { length: 64 }).notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").notNull(),
  },
  table => [
    primaryKey({
      name: "google_challenge_issuance_windows_pk",
      columns: [table.credentialNamespaceDigest, table.issuerEpoch, table.bucketName],
    }),
    check(
      "google_challenge_window_namespace_digest_hex",
      sql`${table.credentialNamespaceDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check("google_challenge_window_epoch_positive", sql`${table.issuerEpoch} > 0`),
    check(
      "google_challenge_window_global_bucket",
      sql`${table.bucketName} = 'GOOGLE_CHALLENGE_GLOBAL_V1'`,
    ),
    check("google_challenge_window_positive_count", sql`${table.requestCount} > 0`),
  ],
);

export const identitySchemaMigrations = identitySchema.table("schema_migrations", {
  migrationId: varchar("migration_id", { length: 128 }).primaryKey(),
  checksum: char("checksum", { length: 64 }).notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull(),
}, table => [
  check(
    "identity_schema_migrations_checksum_hex",
    sql`${table.checksum} ~ '^[0-9a-f]{64}$'`,
  ),
]);
