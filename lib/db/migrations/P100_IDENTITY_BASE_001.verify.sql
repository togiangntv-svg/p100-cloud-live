DO $base_verify$
DECLARE mismatch boolean;
BEGIN
 WITH expected AS (SELECT * FROM jsonb_to_recordset('[{"table_name":"owners","column_name":"subject_id","formatted_type":"uuid","not_null":true},{"table_name":"owners","column_name":"profile_id","formatted_type":"uuid","not_null":true},{"table_name":"owners","column_name":"status","formatted_type":"character varying(16)","not_null":true},{"table_name":"owners","column_name":"created_at","formatted_type":"timestamp with time zone","not_null":true},{"table_name":"verified_control_bindings","column_name":"binding_id","formatted_type":"uuid","not_null":true},{"table_name":"verified_control_bindings","column_name":"provider","formatted_type":"character varying(64)","not_null":true},{"table_name":"verified_control_bindings","column_name":"credential_namespace_digest","formatted_type":"character(64)","not_null":true},{"table_name":"verified_control_bindings","column_name":"provider_subject_digest","formatted_type":"character(64)","not_null":true},{"table_name":"verified_control_bindings","column_name":"subject_id","formatted_type":"uuid","not_null":true},{"table_name":"verified_control_bindings","column_name":"created_at","formatted_type":"timestamp with time zone","not_null":true},{"table_name":"sessions","column_name":"session_id","formatted_type":"uuid","not_null":true},{"table_name":"sessions","column_name":"token_digest","formatted_type":"character(64)","not_null":true},{"table_name":"sessions","column_name":"subject_id","formatted_type":"uuid","not_null":true},{"table_name":"sessions","column_name":"issued_at","formatted_type":"timestamp with time zone","not_null":true},{"table_name":"sessions","column_name":"valid_until","formatted_type":"timestamp with time zone","not_null":true},{"table_name":"sessions","column_name":"revoked_at","formatted_type":"timestamp with time zone","not_null":false},{"table_name":"sessions","column_name":"issuer_provider","formatted_type":"character varying(64)","not_null":false},{"table_name":"sessions","column_name":"issuer_namespace_digest","formatted_type":"character(64)","not_null":false},{"table_name":"sessions","column_name":"issuer_epoch","formatted_type":"integer","not_null":false},{"table_name":"sessions","column_name":"issuer_reconciliation_digest","formatted_type":"character(64)","not_null":false},{"table_name":"sessions","column_name":"legacy_control_binding_id","formatted_type":"uuid","not_null":false},{"table_name":"apple_sign_in_challenges","column_name":"challenge_digest","formatted_type":"character(64)","not_null":true},{"table_name":"apple_sign_in_challenges","column_name":"nonce_digest","formatted_type":"character(64)","not_null":true},{"table_name":"apple_sign_in_challenges","column_name":"created_at","formatted_type":"timestamp with time zone","not_null":true},{"table_name":"apple_sign_in_challenges","column_name":"valid_until","formatted_type":"timestamp with time zone","not_null":true},{"table_name":"apple_sign_in_challenges","column_name":"consumed_at","formatted_type":"timestamp with time zone","not_null":false},{"table_name":"apple_challenge_issuance_windows","column_name":"bucket_name","formatted_type":"character varying(64)","not_null":true},{"table_name":"apple_challenge_issuance_windows","column_name":"window_started_at","formatted_type":"timestamp with time zone","not_null":true},{"table_name":"apple_challenge_issuance_windows","column_name":"request_count","formatted_type":"integer","not_null":true}]'::jsonb) AS x(table_name text,column_name text,formatted_type text,not_null boolean)), actual AS (
 SELECT c.relname table_name,a.attname column_name,format_type(a.atttypid,a.atttypmod) formatted_type,a.attnotnull not_null,a.atthasdef,a.attidentity,a.attgenerated
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
 WHERE n.nspname='identity_v1' AND c.relname IN ('owners','verified_control_bindings','sessions','apple_sign_in_challenges','apple_challenge_issuance_windows') AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped)
 SELECT EXISTS(SELECT 1 FROM expected e FULL JOIN actual a USING(table_name,column_name) WHERE e.table_name IS NULL OR a.table_name IS NULL OR e.formatted_type<>a.formatted_type OR e.not_null<>a.not_null OR a.atthasdef OR a.attidentity<>'' OR a.attgenerated<>'') INTO mismatch;
 IF mismatch THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT columns'; END IF;
 WITH expected AS (SELECT * FROM jsonb_to_recordset('[{"table_name":"owners","constraint_name":"owners_pkey","constraint_type":"p","definition":"primarykeysubject_id"},{"table_name":"owners","constraint_name":"owners_profile_id_unique","constraint_type":"u","definition":"uniqueprofile_id"},{"table_name":"owners","constraint_name":"identity_owners_status","constraint_type":"c","definition":"checkstatus=anyarray[''active''::charactervarying,''retired''::charactervarying][]"},{"table_name":"verified_control_bindings","constraint_name":"verified_control_bindings_pkey","constraint_type":"p","definition":"primarykeybinding_id"},{"table_name":"verified_control_bindings","constraint_name":"verified_control_namespace_digest_hex","constraint_type":"c","definition":"checkcredential_namespace_digest~''^[0-9a-f]{64}) AS x(table_name text,constraint_name text,constraint_type text,definition text)), actual AS (
 SELECT r.relname table_name,c.conname constraint_name,c.contype::text constraint_type,c.convalidated,
 replace(regexp_replace(lower(pg_get_constraintdef(c.oid,true)),'[[:space:]()]','','g'),'::text','') definition
 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='identity_v1')
 SELECT EXISTS(SELECT 1 FROM expected e LEFT JOIN actual a USING(table_name,constraint_name,constraint_type,definition) WHERE a.constraint_name IS NULL OR NOT a.convalidated) INTO mismatch;
 IF mismatch THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT constraints'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='identity_v1' AND r.relname IN ('owners','verified_control_bindings','sessions','apple_sign_in_challenges','apple_challenge_issuance_windows') GROUP BY r.relname HAVING count(*)<>CASE r.relname WHEN 'owners' THEN 3 WHEN 'verified_control_bindings' THEN 4 WHEN 'sessions' THEN 12 WHEN 'apple_sign_in_challenges' THEN 5 ELSE 3 END) THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT constraint count'; END IF;
 IF (SELECT count(*) FROM pg_constraint f WHERE f.conrelid IN ('identity_v1.sessions'::regclass,'identity_v1.verified_control_bindings'::regclass) AND f.contype='f' AND f.confrelid='identity_v1.owners'::regclass AND f.confdeltype='r' AND f.confupdtype='a' AND NOT f.condeferrable AND f.confmatchtype='s' AND f.convalidated AND f.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=f.conrelid AND attname='subject_id')]::smallint[] AND f.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=f.confrelid AND attname='subject_id')]::smallint[])<>2 THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT owner foreign keys'; END IF;
 WITH expected AS (SELECT * FROM jsonb_to_recordset('[{"table_name":"owners","index_name":"owners_pkey","columns":["subject_id"],"unique":true,"primary":true},{"table_name":"owners","index_name":"owners_profile_id_unique","columns":["profile_id"],"unique":true,"primary":false},{"table_name":"verified_control_bindings","index_name":"verified_control_bindings_pkey","columns":["binding_id"],"unique":true,"primary":true},{"table_name":"verified_control_bindings","index_name":"verified_control_namespace_subject_uq","columns":["provider","credential_namespace_digest","provider_subject_digest"],"unique":true,"primary":false},{"table_name":"verified_control_bindings","index_name":"verified_control_subject_idx","columns":["subject_id"],"unique":false,"primary":false},{"table_name":"sessions","index_name":"sessions_pkey","columns":["session_id"],"unique":true,"primary":true},{"table_name":"sessions","index_name":"sessions_token_digest_unique","columns":["token_digest"],"unique":true,"primary":false},{"table_name":"sessions","index_name":"identity_sessions_subject_idx","columns":["subject_id"],"unique":false,"primary":false},{"table_name":"sessions","index_name":"identity_sessions_origin_idx","columns":["issuer_provider","issuer_namespace_digest","issuer_epoch","issuer_reconciliation_digest"],"unique":false,"primary":false},{"table_name":"apple_sign_in_challenges","index_name":"apple_sign_in_challenges_pkey","columns":["challenge_digest"],"unique":true,"primary":true},{"table_name":"apple_sign_in_challenges","index_name":"apple_sign_in_challenges_valid_until_idx","columns":["valid_until"],"unique":false,"primary":false},{"table_name":"apple_sign_in_challenges","index_name":"apple_sign_in_challenges_consumed_at_idx","columns":["consumed_at"],"unique":false,"primary":false},{"table_name":"apple_challenge_issuance_windows","index_name":"apple_challenge_issuance_windows_pkey","columns":["bucket_name"],"unique":true,"primary":true}]'::jsonb) AS x(table_name text,index_name text,columns jsonb,"unique" boolean,"primary" boolean)), actual AS (
 SELECT t.relname table_name,i.relname index_name,x.*,am.amname,ARRAY(SELECT a.attname::text FROM unnest(x.indkey::smallint[]) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum ORDER BY ord) columns
 FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_am am ON am.oid=i.relam WHERE n.nspname='identity_v1' AND t.relname IN ('owners','verified_control_bindings','sessions','apple_sign_in_challenges','apple_challenge_issuance_windows'))
 SELECT EXISTS(SELECT 1 FROM expected e FULL JOIN actual a USING(table_name,index_name) WHERE e.index_name IS NULL OR a.index_name IS NULL OR a.columns<>ARRAY(SELECT jsonb_array_elements_text(e.columns)) OR a.indisunique<>e."unique" OR a.indisprimary<>e."primary" OR NOT a.indisvalid OR NOT a.indisready OR a.amname<>'btree' OR a.indpred IS NOT NULL OR a.indexprs IS NOT NULL OR a.indnkeyatts<>jsonb_array_length(e.columns) OR a.indnatts<>jsonb_array_length(e.columns) OR EXISTS(SELECT 1 FROM unnest(a.indoption::smallint[]) opt WHERE opt<>0) OR COALESCE((to_jsonb(a)->>'indnullsnotdistinct')::boolean,false) OR EXISTS(SELECT 1 FROM unnest(a.indclass::oid[]) cls JOIN pg_opclass opc ON opc.oid=cls WHERE NOT opc.opcdefault)) INTO mismatch;
 IF mismatch THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT indexes'; END IF;

 IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='identity_v1.owners'::regclass AND c.conname='identity_owners_status' AND pg_get_constraintdef(c.oid,true) LIKE '%''ACTIVE''%' AND pg_get_constraintdef(c.oid,true) LIKE '%''RETIRED''%') THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT case-sensitive status literals'; END IF;
END;
$base_verify$;
'"},{"table_name":"verified_control_bindings","constraint_name":"verified_control_subject_digest_hex","constraint_type":"c","definition":"checkprovider_subject_digest~''^[0-9a-f]{64}) AS x(table_name text,constraint_name text,constraint_type text,definition text)), actual AS (
 SELECT r.relname table_name,c.conname constraint_name,c.contype::text constraint_type,c.convalidated,
 replace(regexp_replace(lower(pg_get_constraintdef(c.oid,true)),'[[:space:]()]','','g'),'::text','') definition
 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='identity_v1')
 SELECT EXISTS(SELECT 1 FROM expected e LEFT JOIN actual a USING(table_name,constraint_name,constraint_type,definition) WHERE a.constraint_name IS NULL OR NOT a.convalidated) INTO mismatch;
 IF mismatch THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT constraints'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='identity_v1' AND r.relname IN ('owners','verified_control_bindings','sessions','apple_sign_in_challenges','apple_challenge_issuance_windows') GROUP BY r.relname HAVING count(*)<>CASE r.relname WHEN 'owners' THEN 3 WHEN 'verified_control_bindings' THEN 4 WHEN 'sessions' THEN 12 WHEN 'apple_sign_in_challenges' THEN 5 ELSE 3 END) THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT constraint count'; END IF;
 IF (SELECT count(*) FROM pg_constraint f WHERE f.conrelid IN ('identity_v1.sessions'::regclass,'identity_v1.verified_control_bindings'::regclass) AND f.contype='f' AND f.confrelid='identity_v1.owners'::regclass AND f.confdeltype='r' AND f.confupdtype='a' AND NOT f.condeferrable AND f.convalidated AND f.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=f.conrelid AND attname='subject_id')]::smallint[] AND f.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=f.confrelid AND attname='subject_id')]::smallint[])<>2 THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT owner foreign keys'; END IF;
 WITH expected AS (SELECT * FROM jsonb_to_recordset(INDEX_JSON) AS x(table_name text,index_name text,columns jsonb,"unique" boolean,"primary" boolean)), actual AS (
 SELECT t.relname table_name,i.relname index_name,x.*,am.amname,ARRAY(SELECT a.attname::text FROM unnest(x.indkey::smallint[]) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum ORDER BY ord) columns
 FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_am am ON am.oid=i.relam WHERE n.nspname='identity_v1' AND t.relname IN ('owners','verified_control_bindings','sessions','apple_sign_in_challenges','apple_challenge_issuance_windows'))
 SELECT EXISTS(SELECT 1 FROM expected e FULL JOIN actual a USING(table_name,index_name) WHERE e.index_name IS NULL OR a.index_name IS NULL OR a.columns<>ARRAY(SELECT jsonb_array_elements_text(e.columns)) OR a.indisunique<>e."unique" OR a.indisprimary<>e."primary" OR NOT a.indisvalid OR NOT a.indisready OR a.amname<>'btree' OR a.indpred IS NOT NULL OR a.indexprs IS NOT NULL OR a.indnkeyatts<>jsonb_array_length(e.columns) OR a.indnatts<>jsonb_array_length(e.columns)) INTO mismatch;
 IF mismatch THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT indexes'; END IF;
END;
$base_verify$;
'"},{"table_name":"sessions","constraint_name":"sessions_pkey","constraint_type":"p","definition":"primarykeysession_id"},{"table_name":"sessions","constraint_name":"sessions_token_digest_unique","constraint_type":"u","definition":"uniquetoken_digest"},{"table_name":"sessions","constraint_name":"identity_sessions_valid_window","constraint_type":"c","definition":"checkvalid_until>issued_at"},{"table_name":"sessions","constraint_name":"identity_sessions_token_digest_hex","constraint_type":"c","definition":"checktoken_digest~''^[0-9a-f]{64}) AS x(table_name text,constraint_name text,constraint_type text,definition text)), actual AS (
 SELECT r.relname table_name,c.conname constraint_name,c.contype::text constraint_type,c.convalidated,
 replace(regexp_replace(lower(pg_get_constraintdef(c.oid,true)),'[[:space:]()]','','g'),'::text','') definition
 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='identity_v1')
 SELECT EXISTS(SELECT 1 FROM expected e LEFT JOIN actual a USING(table_name,constraint_name,constraint_type,definition) WHERE a.constraint_name IS NULL OR NOT a.convalidated) INTO mismatch;
 IF mismatch THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT constraints'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='identity_v1' AND r.relname IN ('owners','verified_control_bindings','sessions','apple_sign_in_challenges','apple_challenge_issuance_windows') GROUP BY r.relname HAVING count(*)<>CASE r.relname WHEN 'owners' THEN 3 WHEN 'verified_control_bindings' THEN 4 WHEN 'sessions' THEN 12 WHEN 'apple_sign_in_challenges' THEN 5 ELSE 3 END) THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT constraint count'; END IF;
 IF (SELECT count(*) FROM pg_constraint f WHERE f.conrelid IN ('identity_v1.sessions'::regclass,'identity_v1.verified_control_bindings'::regclass) AND f.contype='f' AND f.confrelid='identity_v1.owners'::regclass AND f.confdeltype='r' AND f.confupdtype='a' AND NOT f.condeferrable AND f.convalidated AND f.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=f.conrelid AND attname='subject_id')]::smallint[] AND f.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=f.confrelid AND attname='subject_id')]::smallint[])<>2 THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT owner foreign keys'; END IF;
 WITH expected AS (SELECT * FROM jsonb_to_recordset(INDEX_JSON) AS x(table_name text,index_name text,columns jsonb,"unique" boolean,"primary" boolean)), actual AS (
 SELECT t.relname table_name,i.relname index_name,x.*,am.amname,ARRAY(SELECT a.attname::text FROM unnest(x.indkey::smallint[]) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum ORDER BY ord) columns
 FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_am am ON am.oid=i.relam WHERE n.nspname='identity_v1' AND t.relname IN ('owners','verified_control_bindings','sessions','apple_sign_in_challenges','apple_challenge_issuance_windows'))
 SELECT EXISTS(SELECT 1 FROM expected e FULL JOIN actual a USING(table_name,index_name) WHERE e.index_name IS NULL OR a.index_name IS NULL OR a.columns<>ARRAY(SELECT jsonb_array_elements_text(e.columns)) OR a.indisunique<>e."unique" OR a.indisprimary<>e."primary" OR NOT a.indisvalid OR NOT a.indisready OR a.amname<>'btree' OR a.indpred IS NOT NULL OR a.indexprs IS NOT NULL OR a.indnkeyatts<>jsonb_array_length(e.columns) OR a.indnatts<>jsonb_array_length(e.columns)) INTO mismatch;
 IF mismatch THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT indexes'; END IF;
END;
$base_verify$;
'"},{"table_name":"apple_sign_in_challenges","constraint_name":"apple_sign_in_challenges_pkey","constraint_type":"p","definition":"primarykeychallenge_digest"},{"table_name":"apple_sign_in_challenges","constraint_name":"apple_sign_in_challenge_digest_hex","constraint_type":"c","definition":"checkchallenge_digest~''^[0-9a-f]{64}) AS x(table_name text,constraint_name text,constraint_type text,definition text)), actual AS (
 SELECT r.relname table_name,c.conname constraint_name,c.contype::text constraint_type,c.convalidated,
 replace(regexp_replace(lower(pg_get_constraintdef(c.oid,true)),'[[:space:]()]','','g'),'::text','') definition
 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='identity_v1')
 SELECT EXISTS(SELECT 1 FROM expected e LEFT JOIN actual a USING(table_name,constraint_name,constraint_type,definition) WHERE a.constraint_name IS NULL OR NOT a.convalidated) INTO mismatch;
 IF mismatch THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT constraints'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='identity_v1' AND r.relname IN ('owners','verified_control_bindings','sessions','apple_sign_in_challenges','apple_challenge_issuance_windows') GROUP BY r.relname HAVING count(*)<>CASE r.relname WHEN 'owners' THEN 3 WHEN 'verified_control_bindings' THEN 4 WHEN 'sessions' THEN 12 WHEN 'apple_sign_in_challenges' THEN 5 ELSE 3 END) THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT constraint count'; END IF;
 IF (SELECT count(*) FROM pg_constraint f WHERE f.conrelid IN ('identity_v1.sessions'::regclass,'identity_v1.verified_control_bindings'::regclass) AND f.contype='f' AND f.confrelid='identity_v1.owners'::regclass AND f.confdeltype='r' AND f.confupdtype='a' AND NOT f.condeferrable AND f.convalidated AND f.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=f.conrelid AND attname='subject_id')]::smallint[] AND f.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=f.confrelid AND attname='subject_id')]::smallint[])<>2 THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT owner foreign keys'; END IF;
 WITH expected AS (SELECT * FROM jsonb_to_recordset(INDEX_JSON) AS x(table_name text,index_name text,columns jsonb,"unique" boolean,"primary" boolean)), actual AS (
 SELECT t.relname table_name,i.relname index_name,x.*,am.amname,ARRAY(SELECT a.attname::text FROM unnest(x.indkey::smallint[]) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum ORDER BY ord) columns
 FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_am am ON am.oid=i.relam WHERE n.nspname='identity_v1' AND t.relname IN ('owners','verified_control_bindings','sessions','apple_sign_in_challenges','apple_challenge_issuance_windows'))
 SELECT EXISTS(SELECT 1 FROM expected e FULL JOIN actual a USING(table_name,index_name) WHERE e.index_name IS NULL OR a.index_name IS NULL OR a.columns<>ARRAY(SELECT jsonb_array_elements_text(e.columns)) OR a.indisunique<>e."unique" OR a.indisprimary<>e."primary" OR NOT a.indisvalid OR NOT a.indisready OR a.amname<>'btree' OR a.indpred IS NOT NULL OR a.indexprs IS NOT NULL OR a.indnkeyatts<>jsonb_array_length(e.columns) OR a.indnatts<>jsonb_array_length(e.columns)) INTO mismatch;
 IF mismatch THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT indexes'; END IF;
END;
$base_verify$;
'"},{"table_name":"apple_sign_in_challenges","constraint_name":"apple_sign_in_nonce_digest_hex","constraint_type":"c","definition":"checknonce_digest~''^[0-9a-f]{64}) AS x(table_name text,constraint_name text,constraint_type text,definition text)), actual AS (
 SELECT r.relname table_name,c.conname constraint_name,c.contype::text constraint_type,c.convalidated,
 replace(regexp_replace(lower(pg_get_constraintdef(c.oid,true)),'[[:space:]()]','','g'),'::text','') definition
 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='identity_v1')
 SELECT EXISTS(SELECT 1 FROM expected e LEFT JOIN actual a USING(table_name,constraint_name,constraint_type,definition) WHERE a.constraint_name IS NULL OR NOT a.convalidated) INTO mismatch;
 IF mismatch THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT constraints'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='identity_v1' AND r.relname IN ('owners','verified_control_bindings','sessions','apple_sign_in_challenges','apple_challenge_issuance_windows') GROUP BY r.relname HAVING count(*)<>CASE r.relname WHEN 'owners' THEN 3 WHEN 'verified_control_bindings' THEN 4 WHEN 'sessions' THEN 12 WHEN 'apple_sign_in_challenges' THEN 5 ELSE 3 END) THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT constraint count'; END IF;
 IF (SELECT count(*) FROM pg_constraint f WHERE f.conrelid IN ('identity_v1.sessions'::regclass,'identity_v1.verified_control_bindings'::regclass) AND f.contype='f' AND f.confrelid='identity_v1.owners'::regclass AND f.confdeltype='r' AND f.confupdtype='a' AND NOT f.condeferrable AND f.convalidated AND f.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=f.conrelid AND attname='subject_id')]::smallint[] AND f.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=f.confrelid AND attname='subject_id')]::smallint[])<>2 THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT owner foreign keys'; END IF;
 WITH expected AS (SELECT * FROM jsonb_to_recordset(INDEX_JSON) AS x(table_name text,index_name text,columns jsonb,"unique" boolean,"primary" boolean)), actual AS (
 SELECT t.relname table_name,i.relname index_name,x.*,am.amname,ARRAY(SELECT a.attname::text FROM unnest(x.indkey::smallint[]) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum ORDER BY ord) columns
 FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_am am ON am.oid=i.relam WHERE n.nspname='identity_v1' AND t.relname IN ('owners','verified_control_bindings','sessions','apple_sign_in_challenges','apple_challenge_issuance_windows'))
 SELECT EXISTS(SELECT 1 FROM expected e FULL JOIN actual a USING(table_name,index_name) WHERE e.index_name IS NULL OR a.index_name IS NULL OR a.columns<>ARRAY(SELECT jsonb_array_elements_text(e.columns)) OR a.indisunique<>e."unique" OR a.indisprimary<>e."primary" OR NOT a.indisvalid OR NOT a.indisready OR a.amname<>'btree' OR a.indpred IS NOT NULL OR a.indexprs IS NOT NULL OR a.indnkeyatts<>jsonb_array_length(e.columns) OR a.indnatts<>jsonb_array_length(e.columns)) INTO mismatch;
 IF mismatch THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT indexes'; END IF;
END;
$base_verify$;
'"},{"table_name":"apple_sign_in_challenges","constraint_name":"apple_sign_in_challenge_valid_window","constraint_type":"c","definition":"checkvalid_until>created_at"},{"table_name":"apple_sign_in_challenges","constraint_name":"apple_sign_in_challenge_consumed_window","constraint_type":"c","definition":"checkconsumed_atisnullorconsumed_at>=created_at"},{"table_name":"apple_challenge_issuance_windows","constraint_name":"apple_challenge_issuance_windows_pkey","constraint_type":"p","definition":"primarykeybucket_name"},{"table_name":"apple_challenge_issuance_windows","constraint_name":"apple_challenge_issuance_global_bucket","constraint_type":"c","definition":"checkbucket_name=''apple_challenge_global_v1''"},{"table_name":"apple_challenge_issuance_windows","constraint_name":"apple_challenge_issuance_positive_count","constraint_type":"c","definition":"checkrequest_count>0"}]'::jsonb) AS x(table_name text,constraint_name text,constraint_type text,definition text)), actual AS (
 SELECT r.relname table_name,c.conname constraint_name,c.contype::text constraint_type,c.convalidated,
 replace(regexp_replace(lower(pg_get_constraintdef(c.oid,true)),'[[:space:]()]','','g'),'::text','') definition
 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='identity_v1')
 SELECT EXISTS(SELECT 1 FROM expected e LEFT JOIN actual a USING(table_name,constraint_name,constraint_type,definition) WHERE a.constraint_name IS NULL OR NOT a.convalidated) INTO mismatch;
 IF mismatch THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT constraints'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='identity_v1' AND r.relname IN ('owners','verified_control_bindings','sessions','apple_sign_in_challenges','apple_challenge_issuance_windows') GROUP BY r.relname HAVING count(*)<>CASE r.relname WHEN 'owners' THEN 3 WHEN 'verified_control_bindings' THEN 4 WHEN 'sessions' THEN 12 WHEN 'apple_sign_in_challenges' THEN 5 ELSE 3 END) THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT constraint count'; END IF;
 IF (SELECT count(*) FROM pg_constraint f WHERE f.conrelid IN ('identity_v1.sessions'::regclass,'identity_v1.verified_control_bindings'::regclass) AND f.contype='f' AND f.confrelid='identity_v1.owners'::regclass AND f.confdeltype='r' AND f.confupdtype='a' AND NOT f.condeferrable AND f.convalidated AND f.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=f.conrelid AND attname='subject_id')]::smallint[] AND f.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=f.confrelid AND attname='subject_id')]::smallint[])<>2 THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT owner foreign keys'; END IF;
 WITH expected AS (SELECT * FROM jsonb_to_recordset(INDEX_JSON) AS x(table_name text,index_name text,columns jsonb,"unique" boolean,"primary" boolean)), actual AS (
 SELECT t.relname table_name,i.relname index_name,x.*,am.amname,ARRAY(SELECT a.attname::text FROM unnest(x.indkey::smallint[]) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum ORDER BY ord) columns
 FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_am am ON am.oid=i.relam WHERE n.nspname='identity_v1' AND t.relname IN ('owners','verified_control_bindings','sessions','apple_sign_in_challenges','apple_challenge_issuance_windows'))
 SELECT EXISTS(SELECT 1 FROM expected e FULL JOIN actual a USING(table_name,index_name) WHERE e.index_name IS NULL OR a.index_name IS NULL OR a.columns<>ARRAY(SELECT jsonb_array_elements_text(e.columns)) OR a.indisunique<>e."unique" OR a.indisprimary<>e."primary" OR NOT a.indisvalid OR NOT a.indisready OR a.amname<>'btree' OR a.indpred IS NOT NULL OR a.indexprs IS NOT NULL OR a.indnkeyatts<>jsonb_array_length(e.columns) OR a.indnatts<>jsonb_array_length(e.columns)) INTO mismatch;
 IF mismatch THEN RAISE EXCEPTION 'MIGRATION_SCHEMA_DRIFT indexes'; END IF;
END;
$base_verify$;
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
