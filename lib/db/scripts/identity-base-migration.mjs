import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {controlledMigrationCli,loadControlledSource,applyControlledMigration} from './controlled-migration.mjs';
export const MIGRATION_ID='P100_IDENTITY_BASE_001';
export const loadSource=()=>loadControlledSource(MIGRATION_ID);
export const applyMigration=(pool,options)=>applyControlledMigration(pool,loadSource(),options);
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))controlledMigrationCli(MIGRATION_ID).catch(e=>{console.error(e.code??'MIGRATION_BLOCKED');process.exitCode=1;});
