DO $verify$
DECLARE
  matched integer;
BEGIN
  WITH expected(table_name) AS (VALUES
    ('sessions'),
    ('schema_migrations'),
    ('provider_session_policies'),
    ('google_sign_in_challenges'),
    ('google_challenge_issuance_windows')
  )
  SELECT count(*) INTO matched
  FROM expected
  JOIN pg_namespace namespace ON namespace.nspname = 'identity_v1'
  JOIN pg_class relation
    ON relation.relnamespace = namespace.oid
    AND relation.relname = expected.table_name
    AND relation.relkind = 'r';
  IF matched <> 5 THEN
    RAISE EXCEPTION 'P100_A1_GOOGLE_001 required table missing or drifted';
  END IF;

  WITH expected(table_name, column_name, data_type, maximum_length, is_nullable) AS (VALUES
    ('sessions', 'issuer_provider', 'character varying', 64, 'YES'),
    ('sessions', 'issuer_namespace_digest', 'character', 64, 'YES'),
    ('sessions', 'issuer_epoch', 'integer', NULL::integer, 'YES'),
    ('sessions', 'issuer_reconciliation_digest', 'character', 64, 'YES'),
    ('sessions', 'legacy_control_binding_id', 'uuid', NULL::integer, 'YES'),
    ('schema_migrations', 'migration_id', 'character varying', 128, 'NO'),
    ('schema_migrations', 'checksum', 'character', 64, 'NO'),
    ('schema_migrations', 'applied_at', 'timestamp with time zone', NULL::integer, 'NO'),
    ('provider_session_policies', 'provider', 'character varying', 64, 'NO'),
    ('provider_session_policies', 'credential_namespace_digest', 'character', 64, 'NO'),
    ('provider_session_policies', 'enabled', 'boolean', NULL::integer, 'NO'),
    ('provider_session_policies', 'current_epoch', 'integer', NULL::integer, 'NO'),
    ('provider_session_policies', 'reconciliation_digest', 'character', 64, 'YES'),
    ('google_sign_in_challenges', 'challenge_digest', 'character', 64, 'NO'),
    ('google_sign_in_challenges', 'credential_namespace_digest', 'character', 64, 'NO'),
    ('google_sign_in_challenges', 'issuer_epoch', 'integer', NULL::integer, 'NO'),
    ('google_sign_in_challenges', 'nonce_digest', 'character', 64, 'NO'),
    ('google_sign_in_challenges', 'created_at', 'timestamp with time zone', NULL::integer, 'NO'),
    ('google_sign_in_challenges', 'valid_until', 'timestamp with time zone', NULL::integer, 'NO'),
    ('google_sign_in_challenges', 'consumed_at', 'timestamp with time zone', NULL::integer, 'YES'),
    ('google_sign_in_challenges', 'invalidated_at', 'timestamp with time zone', NULL::integer, 'YES'),
    ('google_challenge_issuance_windows', 'credential_namespace_digest', 'character', 64, 'NO'),
    ('google_challenge_issuance_windows', 'issuer_epoch', 'integer', NULL::integer, 'NO'),
    ('google_challenge_issuance_windows', 'bucket_name', 'character varying', 64, 'NO'),
    ('google_challenge_issuance_windows', 'window_started_at', 'timestamp with time zone', NULL::integer, 'NO'),
    ('google_challenge_issuance_windows', 'request_count', 'integer', NULL::integer, 'NO')
  )
  SELECT count(*) INTO matched
  FROM expected
  JOIN information_schema.columns column_catalog
    ON column_catalog.table_schema = 'identity_v1'
    AND column_catalog.table_name = expected.table_name
    AND column_catalog.column_name = expected.column_name
    AND column_catalog.data_type = expected.data_type
    AND column_catalog.character_maximum_length IS NOT DISTINCT FROM expected.maximum_length
    AND column_catalog.is_nullable = expected.is_nullable;
  IF matched <> 26 THEN
    RAISE EXCEPTION 'P100_A1_GOOGLE_001 required column semantics drifted';
  END IF;

  WITH expected(table_name, constraint_name, constraint_type, normalized_definition) AS (VALUES
    ('schema_migrations', 'schema_migrations_pkey', 'p', 'primarykeymigration_id'),
    ('schema_migrations', 'identity_schema_migrations_checksum_hex', 'c', 'checkchecksum~''^[0-9a-f]{64}$'''),
    ('provider_session_policies', 'provider_session_policies_pk', 'p', 'primarykeyprovider,credential_namespace_digest'),
    ('provider_session_policies', 'provider_session_policies_provider', 'c', 'checkprovider~''^[a-z][a-z0-9._-]{0,63}$'''),
    ('provider_session_policies', 'provider_session_policies_namespace_digest', 'c', 'checkcredential_namespace_digest~''^[0-9a-f]{64}$'''),
    ('provider_session_policies', 'provider_session_policies_epoch', 'c', 'checkcurrent_epoch>0'),
    ('provider_session_policies', 'provider_session_policies_reconciliation_digest', 'c', 'checkreconciliation_digestisnullorreconciliation_digest~''^[0-9a-f]{64}$'''),
    ('sessions', 'identity_sessions_origin_all_or_none', 'c', 'checkissuer_providerisnullandissuer_namespace_digestisnullandissuer_epochisnullandissuer_reconciliation_digestisnullorissuer_providerisnotnullandissuer_namespace_digestisnotnullandissuer_epochisnotnullandissuer_reconciliation_digestisnotnull'),
    ('sessions', 'identity_sessions_origin_provider', 'c', 'checkissuer_providerisnullorissuer_provider~''^[a-z][a-z0-9._-]{0,63}$'''),
    ('sessions', 'identity_sessions_origin_digest', 'c', 'checkissuer_namespace_digestisnullorissuer_namespace_digest~''^[0-9a-f]{64}$'''),
    ('sessions', 'identity_sessions_origin_epoch', 'c', 'checkissuer_epochisnullorissuer_epoch>0'),
    ('sessions', 'identity_sessions_origin_reconciliation_digest', 'c', 'checkissuer_reconciliation_digestisnullorissuer_reconciliation_digest~''^[0-9a-f]{64}$'''),
    ('sessions', 'identity_sessions_legacy_control_binding_origin', 'c', 'checklegacy_control_binding_idisnullorissuer_providerisnullandissuer_namespace_digestisnullandissuer_epochisnullandissuer_reconciliation_digestisnull'),
    ('google_sign_in_challenges', 'google_sign_in_challenges_pkey', 'p', 'primarykeychallenge_digest'),
    ('google_sign_in_challenges', 'google_sign_in_challenge_digest_hex', 'c', 'checkchallenge_digest~''^[0-9a-f]{64}$'''),
    ('google_sign_in_challenges', 'google_sign_in_namespace_digest_hex', 'c', 'checkcredential_namespace_digest~''^[0-9a-f]{64}$'''),
    ('google_sign_in_challenges', 'google_sign_in_epoch_positive', 'c', 'checkissuer_epoch>0'),
    ('google_sign_in_challenges', 'google_sign_in_nonce_digest_hex', 'c', 'checknonce_digest~''^[0-9a-f]{64}$'''),
    ('google_sign_in_challenges', 'google_sign_in_challenge_valid_window', 'c', 'checkvalid_until>created_at'),
    ('google_sign_in_challenges', 'google_sign_in_challenge_consumed_window', 'c', 'checkconsumed_atisnullorconsumed_at>=created_at'),
    ('google_sign_in_challenges', 'google_sign_in_challenge_invalidated_window', 'c', 'checkinvalidated_atisnullorinvalidated_at>=created_at'),
    ('google_sign_in_challenges', 'google_sign_in_challenge_terminal_state', 'c', 'checkconsumed_atisnullorinvalidated_atisnull'),
    ('google_challenge_issuance_windows', 'google_challenge_issuance_windows_pk', 'p', 'primarykeycredential_namespace_digest,issuer_epoch,bucket_name'),
    ('google_challenge_issuance_windows', 'google_challenge_window_namespace_digest_hex', 'c', 'checkcredential_namespace_digest~''^[0-9a-f]{64}$'''),
    ('google_challenge_issuance_windows', 'google_challenge_window_epoch_positive', 'c', 'checkissuer_epoch>0'),
    ('google_challenge_issuance_windows', 'google_challenge_window_global_bucket', 'c', 'checkbucket_name=''google_challenge_global_v1'''),
    ('google_challenge_issuance_windows', 'google_challenge_window_positive_count', 'c', 'checkrequest_count>0')
  ), actual AS (
    SELECT
      relation.relname AS table_name,
      constraint_catalog.conname AS constraint_name,
      constraint_catalog.contype AS constraint_type,
      constraint_catalog.convalidated,
      replace(
        regexp_replace(
          lower(pg_get_constraintdef(constraint_catalog.oid, TRUE)),
          '[[:space:]()]',
          '',
          'g'
        ),
        '::text',
        ''
      ) AS normalized_definition
    FROM pg_constraint constraint_catalog
    JOIN pg_class relation ON relation.oid = constraint_catalog.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'identity_v1'
  )
  SELECT count(*) INTO matched
  FROM expected
  JOIN actual USING (table_name, constraint_name, constraint_type, normalized_definition)
  WHERE actual.convalidated;
  IF matched <> 27 THEN
    RAISE EXCEPTION 'P100_A1_GOOGLE_001 required constraint semantics drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint foreign_key_catalog
    WHERE foreign_key_catalog.conname = 'identity_sessions_legacy_control_binding_fk'
      AND foreign_key_catalog.contype = 'f'
      AND foreign_key_catalog.convalidated
      AND foreign_key_catalog.conrelid = 'identity_v1.sessions'::regclass
      AND foreign_key_catalog.confrelid = 'identity_v1.verified_control_bindings'::regclass
      AND foreign_key_catalog.conkey = ARRAY[(
        SELECT attribute.attnum::smallint
        FROM pg_attribute attribute
        WHERE attribute.attrelid = 'identity_v1.sessions'::regclass
          AND attribute.attname = 'legacy_control_binding_id'
          AND NOT attribute.attisdropped
      )]::smallint[]
      AND foreign_key_catalog.confkey = ARRAY[(
        SELECT attribute.attnum::smallint
        FROM pg_attribute attribute
        WHERE attribute.attrelid = 'identity_v1.verified_control_bindings'::regclass
          AND attribute.attname = 'binding_id'
          AND NOT attribute.attisdropped
      )]::smallint[]
      AND foreign_key_catalog.confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'P100_A1_GOOGLE_001 legacy binding foreign key semantics drifted';
  END IF;

  WITH expected(table_name, index_name, column_names) AS (VALUES
    ('sessions', 'identity_sessions_origin_idx', ARRAY[
      'issuer_provider', 'issuer_namespace_digest', 'issuer_epoch', 'issuer_reconciliation_digest'
    ]::text[]),
    ('google_sign_in_challenges', 'google_sign_in_challenges_namespace_epoch_idx', ARRAY[
      'credential_namespace_digest', 'issuer_epoch'
    ]::text[]),
    ('google_sign_in_challenges', 'google_sign_in_challenges_valid_until_idx', ARRAY[
      'valid_until'
    ]::text[])
  ), actual AS (
    SELECT
      table_relation.relname AS table_name,
      index_relation.relname AS index_name,
      ARRAY(
        SELECT attribute.attname
        FROM unnest(index_catalog.indkey::smallint[]) WITH ORDINALITY AS key(attnum, ordinal)
        JOIN pg_attribute attribute
          ON attribute.attrelid = table_relation.oid AND attribute.attnum = key.attnum
        ORDER BY key.ordinal
      ) AS column_names,
      index_catalog.indisunique,
      index_catalog.indisprimary,
      index_catalog.indisvalid,
      index_catalog.indisready,
      index_catalog.indpred,
      index_catalog.indexprs,
      index_catalog.indnkeyatts,
      index_catalog.indnatts,
      access_method.amname
    FROM pg_index index_catalog
    JOIN pg_class table_relation ON table_relation.oid = index_catalog.indrelid
    JOIN pg_namespace namespace ON namespace.oid = table_relation.relnamespace
    JOIN pg_class index_relation ON index_relation.oid = index_catalog.indexrelid
    JOIN pg_am access_method ON access_method.oid = index_relation.relam
    WHERE namespace.nspname = 'identity_v1'
  )
  SELECT count(*) INTO matched
  FROM expected
  JOIN actual USING (table_name, index_name, column_names)
  WHERE NOT actual.indisunique
    AND NOT actual.indisprimary
    AND actual.indisvalid
    AND actual.indisready
    AND actual.indpred IS NULL
    AND actual.indexprs IS NULL
    AND actual.indnkeyatts = cardinality(expected.column_names)
    AND actual.indnatts = cardinality(expected.column_names)
    AND actual.amname = 'btree';
  IF matched <> 3 THEN
    RAISE EXCEPTION 'P100_A1_GOOGLE_001 required index semantics drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger trigger_catalog
    WHERE trigger_catalog.tgrelid = 'identity_v1.provider_session_policies'::regclass
      AND trigger_catalog.tgname = 'provider_session_policies_monotonic'
      AND trigger_catalog.tgfoid = 'identity_v1.enforce_provider_session_policy_monotonic()'::regprocedure
      AND trigger_catalog.tgtype = 19
      AND trigger_catalog.tgenabled = 'O'
      AND NOT trigger_catalog.tgisinternal
  ) THEN
    RAISE EXCEPTION 'P100_A1_GOOGLE_001 monotonic policy trigger semantics drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure_catalog
    JOIN pg_namespace namespace ON namespace.oid = procedure_catalog.pronamespace
    JOIN pg_language language_catalog ON language_catalog.oid = procedure_catalog.prolang
    WHERE namespace.nspname = 'identity_v1'
      AND procedure_catalog.proname = 'enforce_provider_session_policy_monotonic'
      AND procedure_catalog.pronargs = 0
      AND procedure_catalog.prorettype = 'trigger'::regtype
      AND procedure_catalog.provolatile = 'v'
      AND NOT procedure_catalog.prosecdef
      AND language_catalog.lanname = 'plpgsql'
      AND regexp_replace(lower(btrim(procedure_catalog.prosrc)), '[[:space:]]+', ' ', 'g') =
        'begin if new.provider <> old.provider or new.credential_namespace_digest <> old.credential_namespace_digest or new.current_epoch < old.current_epoch or (old.enabled and not new.enabled and new.current_epoch <= old.current_epoch) or (not old.enabled and new.enabled and new.current_epoch <= old.current_epoch) then raise exception ''provider session policy rollback is not monotonic'' using errcode = ''check_violation''; end if; return new; end;'
  ) THEN
    RAISE EXCEPTION 'P100_A1_GOOGLE_001 monotonic policy function semantics drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM identity_v1.schema_migrations
    WHERE migration_id = 'P100_A1_GOOGLE_001'
      AND checksum = '7268a1d3a54477318f289deae81d08ed6247a0750b949dd74c65759776c32773'
  ) THEN
    RAISE EXCEPTION 'P100_A1_GOOGLE_001 migration record checksum drifted';
  END IF;
END;
$verify$;

SELECT 'P100_A1_GOOGLE_001'::text AS migration_id, TRUE AS verified;
