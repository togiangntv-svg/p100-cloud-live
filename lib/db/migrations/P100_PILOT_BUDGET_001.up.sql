CREATE SCHEMA IF NOT EXISTS ai_pilot_v1;
CREATE TABLE ai_pilot_v1.schema_migrations (
 migration_id varchar(128) PRIMARY KEY,
 checksum char(64) NOT NULL,
 applied_at timestamptz NOT NULL,
 CONSTRAINT pilot_migration_checksum_hex CHECK(checksum ~ '^[0-9a-f]{64}$')
);
CREATE TABLE ai_pilot_v1.pilot_budget_state (
 pilot_id varchar(64) PRIMARY KEY,
 version integer NOT NULL,
 max_calls integer NOT NULL,
 used_calls integer NOT NULL,
 input_tokens bigint NOT NULL,
 output_tokens bigint NOT NULL,
 live_model_verified boolean NOT NULL,
 updated_at timestamptz NOT NULL,
 CONSTRAINT pilot_singleton CHECK(pilot_id = 'GLOBAL_PILOT_100_V1'),
 CONSTRAINT pilot_version CHECK(version = 1),
 CONSTRAINT pilot_hard_cap CHECK(max_calls BETWEEN 1 AND 21),
 CONSTRAINT pilot_usage CHECK(used_calls BETWEEN 0 AND max_calls),
 CONSTRAINT pilot_input_tokens CHECK(input_tokens BETWEEN 0 AND 9007199254740991),
 CONSTRAINT pilot_output_tokens CHECK(output_tokens BETWEEN 0 AND 9007199254740991)
);
INSERT INTO ai_pilot_v1.pilot_budget_state(pilot_id,version,max_calls,used_calls,input_tokens,output_tokens,live_model_verified,updated_at)
 VALUES('GLOBAL_PILOT_100_V1',1,21,0,0,0,false,transaction_timestamp());
