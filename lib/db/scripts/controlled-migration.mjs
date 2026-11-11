import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export class ControlledMigrationError extends Error{constructor(code){super(code);this.code=code;}}
const block=code=>{throw new ControlledMigrationError(code);};
const sha=b=>createHash('sha256').update(b).digest('hex');
export function loadControlledSource(id,directory=resolve(dirname(fileURLToPath(import.meta.url)),'../migrations')){
 let manifest;try{manifest=JSON.parse(readFileSync(resolve(directory,id+'.manifest.json'),'utf8'));}catch{block('MIGRATION_SOURCE_UNAVAILABLE');}
 if(manifest.migrationId!==id||manifest.checksumEncoding!=='utf8-lf'||!['identity_v1','ai_pilot_v1'].includes(manifest.ledgerSchema))block('MIGRATION_MANIFEST_INVALID');
 const source={migrationId:id,manifest,checksum:manifest.upSha256};
 for(const kind of ['up','verify','contain']){const name=id+'.'+kind+'.sql';if(manifest.files[kind]!==name)block('MIGRATION_MANIFEST_INVALID');const b=readFileSync(resolve(directory,name));if(b.includes(13)||sha(b)!==manifest.checksums[kind]||(kind==='up'&&sha(b)!==manifest.upSha256))block('MIGRATION_CHECKSUM_MISMATCH');const text=b.toString('utf8');if(/\b(DROP|TRUNCATE|DELETE)\b/i.test(text.replace(/\bON\s+DELETE\s+RESTRICT\b/gi,'')))block('MIGRATION_DESTRUCTIVE_SQL_FORBIDDEN');source[kind+'Sql']=text;}
 return Object.freeze(source);
}
export function validateMigrationDatabase(rawUrl,expectedDatabase){
 let u;try{u=new URL(rawUrl);}catch{block('MIGRATION_DATABASE_CONFIGURATION_INVALID');}
 if(!['postgres:','postgresql:'].includes(u.protocol)||!u.hostname||!expectedDatabase||decodeURIComponent(u.pathname.slice(1))!==expectedDatabase)block('MIGRATION_DATABASE_IDENTITY_MISMATCH');
 const loopback=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
 const modes=u.searchParams.getAll('sslmode');if((!loopback||modes.length)&& (modes.length!==1||!['require','verify-full'].includes(modes[0])))block('MIGRATION_TLS_REQUIRED');
 return {database:expectedDatabase,tls:loopback&&modes.length===0?'LOOPBACK_ONLY':modes[0]};
}
async function readRecord(client,s){const schema=s.manifest.ledgerSchema;const t=await client.query('/* controlled:ledger */ SELECT to_regclass($1)::text AS ledger',[schema+'.schema_migrations']);if(t.rows.length!==1)block('MIGRATION_SCHEMA_DRIFT');if(t.rows[0].ledger===null)return null;if(t.rows[0].ledger!==schema+'.schema_migrations')block('MIGRATION_SCHEMA_DRIFT');const r=await client.query('/* controlled:record */ SELECT checksum FROM '+schema+'.schema_migrations WHERE migration_id=$1',[s.migrationId]);if(r.rows.length>1)block('MIGRATION_SCHEMA_DRIFT');return r.rows.length?r.rows[0].checksum:undefined;}
async function verify(client,s){try{await client.query(s.verifySql);}catch{block('MIGRATION_SCHEMA_DRIFT');}}
export async function applyControlledMigration(pool,s,{verifyOnly=false,expectedDatabase}={}){
 let c,open=false,destroy=false,commitUnknown=false,result;
 try{c=await pool.connect();await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');open=true;if(expectedDatabase){const db=await c.query('/* controlled:database */ SELECT current_database() AS database');if(db.rows.length!==1||db.rows[0].database!==expectedDatabase)block('MIGRATION_DATABASE_IDENTITY_MISMATCH');}await c.query("SET LOCAL lock_timeout = '5s'");await c.query("SET LOCAL statement_timeout = '30s'");await c.query('/* controlled:lock */ SELECT pg_advisory_xact_lock($1::bigint)',[s.manifest.advisoryLock]);
 const checksum=await readRecord(c,s);
 if(typeof checksum==='string'){if(checksum!==s.checksum)block('MIGRATION_SCHEMA_DRIFT');await verify(c,s);result={status:verifyOnly?'VERIFIED':'ALREADY_APPLIED',migrationId:s.migrationId,checksum:s.checksum};}
 else{if(verifyOnly)block('MIGRATION_NOT_APPLIED');if(checksum!==null)block('MIGRATION_SCHEMA_COLLISION');const objects=await c.query('/* controlled:collision */ SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1)+(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1) AS objects',[s.manifest.ledgerSchema]);if(objects.rows.length!==1||Number(objects.rows[0].objects)!==0)block('MIGRATION_SCHEMA_COLLISION');await c.query(s.upSql);
 for(const r of [...(s.manifest.composedMigrations??[]),{migrationId:s.migrationId,checksum:s.checksum}]){const ins=await c.query('/* controlled:insert */ INSERT INTO '+s.manifest.ledgerSchema+'.schema_migrations(migration_id,checksum,applied_at) VALUES($1,$2,transaction_timestamp()) RETURNING migration_id,checksum',[r.migrationId,r.checksum]);if(ins.rows.length!==1||ins.rows[0].migration_id!==r.migrationId||ins.rows[0].checksum!==r.checksum)block('MIGRATION_RECORD_INVALID');}
 await verify(c,s);result={status:'APPLIED',migrationId:s.migrationId,checksum:s.checksum};}
 try{await c.query('COMMIT');open=false;}catch{commitUnknown=true;open=false;destroy=true;}
 }catch(e){if(open){try{await c.query('ROLLBACK');}catch{destroy=true;}}if(e instanceof ControlledMigrationError)throw e;block(['42P01','42703'].includes(e?.code)?'MIGRATION_SCHEMA_DRIFT':e?.code==='55P03'?'MIGRATION_LOCK_TIMEOUT':e?.code==='40001'?'MIGRATION_SERIALIZATION_RETRY_REQUIRED':'MIGRATION_BLOCKED');}
 finally{c?.release(destroy);}
 if(commitUnknown){let recovery;try{recovery=await pool.connect();await recovery.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await recovery.query("SET LOCAL lock_timeout = '5s'");await recovery.query("SET LOCAL statement_timeout = '30s'");await recovery.query('SELECT pg_advisory_xact_lock($1::bigint)',[s.manifest.advisoryLock]);if(await readRecord(recovery,s)!==s.checksum)block('MIGRATION_COMMIT_UNKNOWN');await verify(recovery,s);await recovery.query('ROLLBACK');return {...result,status:'RECONCILED_AFTER_UNKNOWN_COMMIT'};}catch{try{await recovery?.query('ROLLBACK');}catch{}block('MIGRATION_COMMIT_UNKNOWN');}finally{recovery?.release(true);}}
 return result;
}
export async function controlledMigrationCli(id){const command=process.argv[2];const source=loadControlledSource(id);if(command==='--verify-source'){console.log(JSON.stringify({status:'SOURCE_VERIFIED',migrationId:id,checksum:source.checksum}));return;}if(!['--apply','--verify-only'].includes(command))block('MIGRATION_COMMAND_REQUIRED');if(command==='--apply'&&process.env.P100_MIGRATION_ALLOW_APPLY!=='I_ACKNOWLEDGE_CONTROLLED_DATABASE_MIGRATION')block('MIGRATION_EXPLICIT_ACK_REQUIRED');const raw=process.env.P100_MIGRATION_DATABASE_URL,expected=process.env.P100_MIGRATION_EXPECTED_DATABASE;validateMigrationDatabase(raw,expected);const {Pool}=await import('pg');const pool=new Pool({connectionString:raw,max:1});try{console.log(JSON.stringify(await applyControlledMigration(pool,source,{verifyOnly:command==='--verify-only',expectedDatabase:expected})));}finally{await pool.end();}}
