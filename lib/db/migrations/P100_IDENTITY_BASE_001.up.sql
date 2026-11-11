-- Blank-schema bootstrap: Identity base, then the exact admitted A1 SQL below.
CREATE SCHEMA IF NOT EXISTS identity_v1;
CREATE TABLE identity_v1.owners (
 subject_id uuid PRIMARY KEY,
 profile_id uuid NOT NULL CONSTRAINT owners_profile_id_unique UNIQUE,
 status varchar(16) NOT NULL,
 created_at timestamptz NOT NULL,
 CONSTRAINT identity_owners_status CHECK (status IN ('ACTIVE','RETIRED'))
);
CREATE TABLE identity_v1.verified_control_bindings (
 binding_id uuid PRIMARY KEY,
 provider varchar(64) NOT NULL,
 credential_namespace_digest char(64) NOT NULL,
 provider_subject_digest char(64) NOT NULL,
 subject_id uuid NOT NULL CONSTRAINT verified_control_bindings_subject_id_owners_subject_id_fk REFERENCES identity_v1.owners(subject_id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL,
 CONSTRAINT verified_control_namespace_digest_hex CHECK (credential_namespace_digest ~ '^[0-9a-f]{64}$'),
 CONSTRAINT verified_control_subject_digest_hex CHECK (provider_subject_digest ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX verified_control_namespace_subject_uq ON identity_v1.verified_control_bindings(provider,credential_namespace_digest,provider_subject_digest);
CREATE INDEX verified_control_subject_idx ON identity_v1.verified_control_bindings(subject_id);
CREATE TABLE identity_v1.sessions (
 session_id uuid PRIMARY KEY,
 token_digest char(64) NOT NULL CONSTRAINT sessions_token_digest_unique UNIQUE,
 subject_id uuid NOT NULL CONSTRAINT sessions_subject_id_owners_subject_id_fk REFERENCES identity_v1.owners(subject_id) ON DELETE RESTRICT,
 issued_at timestamptz NOT NULL,
 valid_until timestamptz NOT NULL,
 revoked_at timestamptz,
 CONSTRAINT identity_sessions_valid_window CHECK (valid_until > issued_at),
 CONSTRAINT identity_sessions_token_digest_hex CHECK (token_digest ~ '^[0-9a-f]{64}$')
);
CREATE INDEX identity_sessions_subject_idx ON identity_v1.sessions(subject_id);
CREATE TABLE identity_v1.apple_sign_in_challenges (
 challenge_digest char(64) PRIMARY KEY,
 nonce_digest char(64) NOT NULL,
 created_at timestamptz NOT NULL,
 valid_until timestamptz NOT NULL,
 consumed_at timestamptz,
 CONSTRAINT apple_sign_in_challenge_digest_hex CHECK (challenge_digest ~ '^[0-9a-f]{64}$'),
 CONSTRAINT apple_sign_in_nonce_digest_hex CHECK (nonce_digest ~ '^[0-9a-f]{64}$'),
 CONSTRAINT apple_sign_in_challenge_valid_window CHECK (valid_until > created_at),
 CONSTRAINT apple_sign_in_challenge_consumed_window CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);
CREATE INDEX apple_sign_in_challenges_valid_until_idx ON identity_v1.apple_sign_in_challenges(valid_until);
CREATE INDEX apple_sign_in_challenges_consumed_at_idx ON identity_v1.apple_sign_in_challenges(consumed_at);
CREATE TABLE identity_v1.apple_challenge_issuance_windows (
 bucket_name varchar(64) PRIMARY KEY,
 window_started_at timestamptz NOT NULL,
 request_count integer NOT NULL,
 CONSTRAINT apple_challenge_issuance_global_bucket CHECK (bucket_name = 'APPLE_CHALLENGE_GLOBAL_V1'),
 CONSTRAINT apple_challenge_issuance_positive_count CHECK (request_count > 0)
);

-- BEGIN_EXACT_P100_A1_GOOGLE_001_UP
CREATE SCHEMA IF NOT EXISTS identity_v1;

CREATE TABLE identity_v1.schema_migrations (
  migration_id varchar(128) PRIMARY KEY,
  checksum char(64) NOT NULL,
  applied_at timestamptz NOT NULL,
  CONSTRAINT identity_schema_migrations_checksum_hex
    CHECK (checksum ~ '^[0-9a-f]{64}$')
);

CREATE TABLE identity_v1.provider_session_policies (
  provider varchar(64) NOT NULL,
  credential_namespace_digest char(64) NOT NULL,
  enabled boolean NOT NULL,
  current_epoch integer NOT NULL,
  reconciliation_digest char(64),
  CONSTRAINT provider_session_policies_pk
    PRIMARY KEY (provider, credential_namespace_digest),
  CONSTRAINT provider_session_policies_provider
    CHECK (provider ~ '^[a-z][a-z0-9._-]{0,63}$'),
  CONSTRAINT provider_session_policies_namespace_digest
    CHECK (credential_namespace_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT provider_session_policies_epoch CHECK (current_epoch > 0),
  CONSTRAINT provider_session_policies_reconciliation_digest CHECK (
    reconciliation_digest IS NULL OR reconciliation_digest ~ '^[0-9a-f]{64}$'
  )
);

CREATE FUNCTION identity_v1.enforce_provider_session_policy_monotonic()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provider <> OLD.provider
    OR NEW.credential_namespace_digest <> OLD.credential_namespace_digest
    OR NEW.current_epoch < OLD.current_epoch
    OR (OLD.enabled AND NOT NEW.enabled AND NEW.current_epoch <= OLD.current_epoch)
    OR (NOT OLD.enabled AND NEW.enabled AND NEW.current_epoch <= OLD.current_epoch) THEN
    RAISE EXCEPTION 'provider session policy rollback is not monotonic'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER provider_session_policies_monotonic
BEFORE UPDATE ON identity_v1.provider_session_policies
FOR EACH ROW EXECUTE FUNCTION identity_v1.enforce_provider_session_policy_monotonic();

ALTER TABLE identity_v1.sessions
  ADD COLUMN issuer_provider varchar(64),
  ADD COLUMN issuer_namespace_digest char(64),
  ADD COLUMN issuer_epoch integer,
  ADD COLUMN issuer_reconciliation_digest char(64),
  ADD COLUMN legacy_control_binding_id uuid;

ALTER TABLE identity_v1.sessions
  ADD CONSTRAINT identity_sessions_origin_all_or_none CHECK (
    (issuer_provider IS NULL AND issuer_namespace_digest IS NULL AND issuer_epoch IS NULL
      AND issuer_reconciliation_digest IS NULL)
    OR
    (issuer_provider IS NOT NULL AND issuer_namespace_digest IS NOT NULL AND issuer_epoch IS NOT NULL
      AND issuer_reconciliation_digest IS NOT NULL)
  ),
  ADD CONSTRAINT identity_sessions_origin_provider CHECK (
    issuer_provider IS NULL OR issuer_provider ~ '^[a-z][a-z0-9._-]{0,63}$'
  ),
  ADD CONSTRAINT identity_sessions_origin_digest CHECK (
    issuer_namespace_digest IS NULL OR issuer_namespace_digest ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT identity_sessions_origin_epoch CHECK (
    issuer_epoch IS NULL OR issuer_epoch > 0
  ),
  ADD CONSTRAINT identity_sessions_origin_reconciliation_digest CHECK (
    issuer_reconciliation_digest IS NULL OR issuer_reconciliation_digest ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT identity_sessions_legacy_control_binding_fk
    FOREIGN KEY (legacy_control_binding_id)
    REFERENCES identity_v1.verified_control_bindings(binding_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT identity_sessions_legacy_control_binding_origin CHECK (
    legacy_control_binding_id IS NULL OR (
      issuer_provider IS NULL
      AND issuer_namespace_digest IS NULL
      AND issuer_epoch IS NULL
      AND issuer_reconciliation_digest IS NULL
    )
  );

CREATE INDEX identity_sessions_origin_idx
  ON identity_v1.sessions (
    issuer_provider,
    issuer_namespace_digest,
    issuer_epoch,
    issuer_reconciliation_digest
  );

CREATE TABLE identity_v1.google_sign_in_challenges (
  challenge_digest char(64) PRIMARY KEY,
  credential_namespace_digest char(64) NOT NULL,
  issuer_epoch integer NOT NULL,
  nonce_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  CONSTRAINT google_sign_in_challenge_digest_hex
    CHECK (challenge_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT google_sign_in_namespace_digest_hex
    CHECK (credential_namespace_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT google_sign_in_epoch_positive CHECK (issuer_epoch > 0),
  CONSTRAINT google_sign_in_nonce_digest_hex
    CHECK (nonce_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT google_sign_in_challenge_valid_window CHECK (valid_until > created_at),
  CONSTRAINT google_sign_in_challenge_consumed_window
    CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CONSTRAINT google_sign_in_challenge_invalidated_window
    CHECK (invalidated_at IS NULL OR invalidated_at >= created_at),
  CONSTRAINT google_sign_in_challenge_terminal_state
    CHECK (consumed_at IS NULL OR invalidated_at IS NULL)
);

CREATE INDEX google_sign_in_challenges_namespace_epoch_idx
  ON identity_v1.google_sign_in_challenges (credential_namespace_digest, issuer_epoch);
CREATE INDEX google_sign_in_challenges_valid_until_idx
  ON identity_v1.google_sign_in_challenges (valid_until);

CREATE TABLE identity_v1.google_challenge_issuance_windows (
  credential_namespace_digest char(64) NOT NULL,
  issuer_epoch integer NOT NULL,
  bucket_name varchar(64) NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL,
  CONSTRAINT google_challenge_issuance_windows_pk
    PRIMARY KEY (credential_namespace_digest, issuer_epoch, bucket_name),
  CONSTRAINT google_challenge_window_namespace_digest_hex
    CHECK (credential_namespace_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT google_challenge_window_epoch_positive CHECK (issuer_epoch > 0),
  CONSTRAINT google_challenge_window_global_bucket
    CHECK (bucket_name = 'GOOGLE_CHALLENGE_GLOBAL_V1'),
  CONSTRAINT google_challenge_window_positive_count CHECK (request_count > 0)
);
-- END_EXACT_P100_A1_GOOGLE_001_UP
