-- Containment is observational only. Keep application provider admission disabled; no destructive rollback.
SELECT current_database() AS database, to_regclass('identity_v1.schema_migrations') AS migration_ledger;
