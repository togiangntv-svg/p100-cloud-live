-- LOCAL DB CONTAINMENT ONLY: this does not retire the external Google namespace authority.
-- It is an emergency identity-database projection and cannot establish global F2 retirement.
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

SELECT provider, credential_namespace_digest, current_epoch
FROM identity_v1.provider_session_policies
WHERE provider = 'google'
FOR UPDATE;

UPDATE identity_v1.provider_session_policies
SET enabled = FALSE,
    current_epoch = current_epoch + 1,
    reconciliation_digest = NULL
WHERE provider = 'google'
  AND enabled = TRUE;

UPDATE identity_v1.sessions
SET revoked_at = transaction_timestamp()
WHERE issuer_provider = 'google'
  AND revoked_at IS NULL;

UPDATE identity_v1.google_sign_in_challenges
SET invalidated_at = transaction_timestamp()
WHERE consumed_at IS NULL
  AND invalidated_at IS NULL;

COMMIT;
