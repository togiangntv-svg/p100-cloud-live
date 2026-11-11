import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { GatewayProblem } from "./gateway";

const HARD_MAX_CALLS = 21;
const STORE_PATH = process.env["AI_PILOT_STATE_PATH"]
  ?? path.join(process.cwd(), ".data", "ai-pilot-state.json");

type PilotState = {
  version: 1;
  maxCalls: number;
  usedCalls: number;
  inputTokens: number;
  outputTokens: number;
  liveModelVerified: boolean;
  updatedAt: string;
};

const initialState = (): PilotState => ({
  version: 1,
  maxCalls: readPilotMaxCalls(),
  usedCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  liveModelVerified: false,
  updatedAt: new Date().toISOString(),
});

let queue = Promise.resolve();

function isState(value: unknown): value is PilotState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return state.version === 1
    && Number.isInteger(state.maxCalls) && Number(state.maxCalls) >= 1 && Number(state.maxCalls) <= HARD_MAX_CALLS
    && Number.isInteger(state.usedCalls)
    && Number(state.usedCalls) >= 0
    && Number(state.usedCalls) <= HARD_MAX_CALLS
    && Number.isSafeInteger(state.inputTokens)
    && Number(state.inputTokens) >= 0
    && Number.isSafeInteger(state.outputTokens)
    && Number(state.outputTokens) >= 0
    && typeof state.liveModelVerified === "boolean"
    && typeof state.updatedAt === "string";
}

async function loadState(): Promise<PilotState> {
  try {
    const parsed = JSON.parse(await readFile(STORE_PATH, "utf8")) as unknown;
    if (!isState(parsed)) throw new Error("invalid state");
    return { ...parsed, maxCalls: Math.min(parsed.maxCalls, readPilotMaxCalls()) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new GatewayProblem(503, "AI_BUDGET_STATE_UNAVAILABLE");
    }
    const state = initialState();
    await saveState(state);
    return state;
  }
}

async function saveState(state: PilotState): Promise<void> {
  try {
    await mkdir(path.dirname(STORE_PATH), { recursive: true });
    const temporary = `${STORE_PATH}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, STORE_PATH);
  } catch {
    throw new GatewayProblem(503, "AI_BUDGET_STATE_UNAVAILABLE");
  }
}

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

export async function getPilotState(): Promise<PilotState> {
  assertBackend(); readPilotMaxCalls();
  if (process.env['AI_PILOT_STORE_BACKEND'] === 'postgres') return (await productionPostgresStore()).getState();
  return serialized(loadState);
}

export async function reserveProviderCall(): Promise<PilotState> {
  assertBackend(); readPilotMaxCalls();
  if (process.env['AI_PILOT_STORE_BACKEND'] === 'postgres') return (await productionPostgresStore()).reserve();
  return serialized(async () => {
    const state = await loadState();
    if (state.usedCalls >= state.maxCalls) {
      throw new GatewayProblem(429, "AI_BUDGET_EXHAUSTED");
    }
    const next = {
      ...state,
      usedCalls: state.usedCalls + 1,
      updatedAt: new Date().toISOString(),
    };
    await saveState(next);
    return next;
  });
}

export async function recordProviderSuccess(inputTokens: number, outputTokens: number): Promise<PilotState> {
  assertBackend(); readPilotMaxCalls(); assertTokens(inputTokens, outputTokens);
  if (process.env['AI_PILOT_STORE_BACKEND'] === 'postgres') return (await productionPostgresStore()).record(inputTokens, outputTokens);
  return serialized(async () => {
    const state = await loadState();
    const next = {
      ...state,
      inputTokens: state.inputTokens + inputTokens,
      outputTokens: state.outputTokens + outputTokens,
      liveModelVerified: true,
      updatedAt: new Date().toISOString(),
    };
    await saveState(next);
    return next;
  });
}
export function readPilotMaxCalls(env: Readonly<Record<string,string|undefined>> = process.env): number {
 const raw=env['AI_PILOT_MAX_CALLS']; if(raw===undefined)return HARD_MAX_CALLS;
 if(!/^[1-9][0-9]*$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)>HARD_MAX_CALLS)throw new GatewayProblem(503,'AI_BUDGET_STATE_UNAVAILABLE');
 return Number(raw);
}
function assertBackend(){const b=process.env['AI_PILOT_STORE_BACKEND']??'file';if(b!=='file'&&b!=='postgres')throw new GatewayProblem(503,'AI_BUDGET_STATE_UNAVAILABLE');}
function assertTokens(input:number,output:number){if(!Number.isSafeInteger(input)||input<0||!Number.isSafeInteger(output)||output<0)throw new GatewayProblem(503,'AI_BUDGET_STATE_UNAVAILABLE');}
type PilotSqlResult={rows:Record<string,unknown>[]};
export type PilotSqlPool={connect():Promise<{query(sql:string,values?:unknown[]):Promise<PilotSqlResult>;release(destroy?:boolean):void}>};
const PILOT_VERIFY_SQL="DO $pilot_verify$\nDECLARE mismatch boolean;\nBEGIN\n WITH expected AS(SELECT * FROM jsonb_to_recordset('[{\"t\":\"schema_migrations\",\"n\":\"migration_id\",\"ty\":\"character varying(128)\"},{\"t\":\"schema_migrations\",\"n\":\"checksum\",\"ty\":\"character(64)\"},{\"t\":\"schema_migrations\",\"n\":\"applied_at\",\"ty\":\"timestamp with time zone\"},{\"t\":\"pilot_budget_state\",\"n\":\"pilot_id\",\"ty\":\"character varying(64)\"},{\"t\":\"pilot_budget_state\",\"n\":\"version\",\"ty\":\"integer\"},{\"t\":\"pilot_budget_state\",\"n\":\"max_calls\",\"ty\":\"integer\"},{\"t\":\"pilot_budget_state\",\"n\":\"used_calls\",\"ty\":\"integer\"},{\"t\":\"pilot_budget_state\",\"n\":\"input_tokens\",\"ty\":\"bigint\"},{\"t\":\"pilot_budget_state\",\"n\":\"output_tokens\",\"ty\":\"bigint\"},{\"t\":\"pilot_budget_state\",\"n\":\"live_model_verified\",\"ty\":\"boolean\"},{\"t\":\"pilot_budget_state\",\"n\":\"updated_at\",\"ty\":\"timestamp with time zone\"}]'::jsonb) x(t text,n text,ty text)), actual AS(\n SELECT r.relname t,a.attname n,format_type(a.atttypid,a.atttypmod) ty,a.attnotnull,a.atthasdef,a.attidentity,a.attgenerated FROM pg_attribute a JOIN pg_class r ON r.oid=a.attrelid JOIN pg_namespace s ON s.oid=r.relnamespace WHERE s.nspname='ai_pilot_v1' AND r.relkind='r' AND r.relname IN('schema_migrations','pilot_budget_state') AND a.attnum>0 AND NOT a.attisdropped)\n SELECT EXISTS(SELECT 1 FROM expected e FULL JOIN actual a USING(t,n) WHERE e.t IS NULL OR a.t IS NULL OR e.ty<>a.ty OR NOT a.attnotnull OR a.atthasdef OR a.attidentity<>'' OR a.attgenerated<>'') INTO mismatch;\n IF mismatch THEN RAISE EXCEPTION 'PILOT_SCHEMA_DRIFT columns'; END IF;\n WITH e AS(SELECT * FROM jsonb_to_recordset('[{\"name\":\"pilot_migration_checksum_hex\",\"def\":\"checkchecksum~''^[0-9a-f]{64}) x(name text,def text)), a AS(SELECT c.conname name,c.convalidated,replace(regexp_replace(lower(pg_get_constraintdef(c.oid,true)),'[[:space:]()]','','g'),'::text','') def FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='ai_pilot_v1' AND c.contype='c')\n SELECT EXISTS(SELECT 1 FROM e FULL JOIN a USING(name,def) WHERE e.name IS NULL OR a.name IS NULL OR NOT a.convalidated) INTO mismatch;\n IF mismatch THEN RAISE EXCEPTION 'PILOT_SCHEMA_DRIFT checks'; END IF;\n IF (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='ai_pilot_v1')<>9 THEN RAISE EXCEPTION 'PILOT_SCHEMA_DRIFT constraints'; END IF;\n IF (SELECT count(*) FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_am a ON a.oid=i.relam JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='ai_pilot_v1' AND x.indisprimary AND x.indisunique AND x.indisvalid AND x.indisready AND x.indnatts=1 AND x.indnkeyatts=1 AND x.indpred IS NULL AND x.indexprs IS NULL AND a.amname='btree' AND x.indkey::text='1')<>2 THEN RAISE EXCEPTION 'PILOT_SCHEMA_DRIFT primary indexes'; END IF;\n IF (SELECT count(*) FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='ai_pilot_v1')<>2 THEN RAISE EXCEPTION 'PILOT_SCHEMA_DRIFT indexes'; END IF;\n IF EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='ai_pilot_v1' AND NOT g.tgisinternal) THEN RAISE EXCEPTION 'PILOT_SCHEMA_DRIFT triggers'; END IF;\n IF NOT EXISTS(SELECT 1 FROM ai_pilot_v1.schema_migrations WHERE migration_id='P100_PILOT_BUDGET_001' AND checksum='aea079c308b56434929494b3a0ed479e82a93d130aa1b2e9c7f1ad1792e2cebf') THEN RAISE EXCEPTION 'PILOT_SCHEMA_DRIFT ledger'; END IF;\n IF (SELECT count(*) FROM ai_pilot_v1.pilot_budget_state)<>1 OR NOT EXISTS(SELECT 1 FROM ai_pilot_v1.pilot_budget_state WHERE pilot_id='GLOBAL_PILOT_100_V1' AND version=1 AND max_calls BETWEEN 1 AND 21 AND used_calls BETWEEN 0 AND max_calls AND input_tokens BETWEEN 0 AND 9007199254740991 AND output_tokens BETWEEN 0 AND 9007199254740991) THEN RAISE EXCEPTION 'PILOT_STATE_UNAVAILABLE'; END IF;\nEND;\n$pilot_verify$;\n'\"},{\"name\":\"pilot_singleton\",\"def\":\"checkpilot_id=''global_pilot_100_v1''\"},{\"name\":\"pilot_version\",\"def\":\"checkversion=1\"},{\"name\":\"pilot_hard_cap\",\"def\":\"checkmax_calls>=1andmax_calls<=21\"},{\"name\":\"pilot_usage\",\"def\":\"checkused_calls>=0andused_calls<=max_calls\"},{\"name\":\"pilot_input_tokens\",\"def\":\"checkinput_tokens>=0andinput_tokens<=9007199254740991\"},{\"name\":\"pilot_output_tokens\",\"def\":\"checkoutput_tokens>=0andoutput_tokens<=9007199254740991\"}]'::jsonb) x(name text,def text)), a AS(SELECT c.conname name,c.convalidated,replace(regexp_replace(lower(pg_get_constraintdef(c.oid,true)),'[[:space:]()]','','g'),'::text','') def FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='ai_pilot_v1' AND c.contype='c')\n SELECT EXISTS(SELECT 1 FROM e FULL JOIN a USING(name,def) WHERE e.name IS NULL OR a.name IS NULL OR NOT a.convalidated) INTO mismatch;\n IF mismatch THEN RAISE EXCEPTION 'PILOT_SCHEMA_DRIFT checks'; END IF;\n IF (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='ai_pilot_v1')<>9 THEN RAISE EXCEPTION 'PILOT_SCHEMA_DRIFT constraints'; END IF;\n IF (SELECT count(*) FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_am a ON a.oid=i.relam JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='ai_pilot_v1' AND x.indisprimary AND x.indisunique AND x.indisvalid AND x.indisready AND x.indnatts=1 AND x.indnkeyatts=1 AND x.indpred IS NULL AND x.indexprs IS NULL AND a.amname='btree' AND x.indkey::text='1')<>2 THEN RAISE EXCEPTION 'PILOT_SCHEMA_DRIFT primary indexes'; END IF;\n IF (SELECT count(*) FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='ai_pilot_v1')<>2 THEN RAISE EXCEPTION 'PILOT_SCHEMA_DRIFT indexes'; END IF;\n IF EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='ai_pilot_v1' AND NOT g.tgisinternal) THEN RAISE EXCEPTION 'PILOT_SCHEMA_DRIFT triggers'; END IF;\n IF NOT EXISTS(SELECT 1 FROM ai_pilot_v1.schema_migrations WHERE migration_id='P100_PILOT_BUDGET_001' AND checksum='UP_CHECKSUM') THEN RAISE EXCEPTION 'PILOT_SCHEMA_DRIFT ledger'; END IF;\n IF (SELECT count(*) FROM ai_pilot_v1.pilot_budget_state)<>1 OR NOT EXISTS(SELECT 1 FROM ai_pilot_v1.pilot_budget_state WHERE pilot_id='GLOBAL_PILOT_100_V1' AND version=1 AND max_calls BETWEEN 1 AND 21 AND used_calls BETWEEN 0 AND max_calls AND input_tokens BETWEEN 0 AND 9007199254740991 AND output_tokens BETWEEN 0 AND 9007199254740991) THEN RAISE EXCEPTION 'PILOT_STATE_UNAVAILABLE'; END IF;\nEND;\n$pilot_verify$;\n";
const PILOT_ID='GLOBAL_PILOT_100_V1';
const SELECT_PILOT='SELECT version,max_calls,used_calls,input_tokens,output_tokens,live_model_verified,updated_at FROM ai_pilot_v1.pilot_budget_state WHERE pilot_id=$1';
function readPostgresState(row:Record<string,unknown>|undefined,cap:number):PilotState {
 if(!row)throw new GatewayProblem(503,'AI_BUDGET_STATE_UNAVAILABLE');
 const state={version:Number(row.version),maxCalls:Number(row.max_calls),usedCalls:Number(row.used_calls),inputTokens:Number(row.input_tokens),outputTokens:Number(row.output_tokens),liveModelVerified:row.live_model_verified,updatedAt:row.updated_at instanceof Date?row.updated_at.toISOString():row.updated_at};
 if(!isState(state)||state.usedCalls>state.maxCalls||!Number.isFinite(Date.parse(state.updatedAt)))throw new GatewayProblem(503,'AI_BUDGET_STATE_UNAVAILABLE');
 return {...state,maxCalls:Math.min(state.maxCalls,cap)};
}
/** Pool is injected only at composition/test boundary; every operation verifies existing catalog. No DDL/reset/session scope. */
export function createPostgresPilotStore(pool:PilotSqlPool,env:()=>Readonly<Record<string,string|undefined>>=()=>process.env){
 const transact=async(kind:'read'|'reserve'|'record',tokens?:{input:number;output:number})=>{
  const cap=readPilotMaxCalls(env());let c:Awaited<ReturnType<PilotSqlPool['connect']>>|undefined,open=false,destroy=false;
  try{c=await pool.connect();await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');open=true;
   await c.query("SET LOCAL lock_timeout = '5s'");await c.query("SET LOCAL statement_timeout = '30s'");
   await c.query(PILOT_VERIFY_SQL);
   let result:PilotSqlResult;
   if(kind==='reserve'){
    result=await c.query('/* pilot:reserve */ UPDATE ai_pilot_v1.pilot_budget_state SET max_calls=LEAST(max_calls,$2),used_calls=used_calls+1,updated_at=transaction_timestamp() WHERE pilot_id=$1 AND used_calls<LEAST(max_calls,$2) RETURNING version,max_calls,used_calls,input_tokens,output_tokens,live_model_verified,updated_at',[PILOT_ID,cap]);
    if(result.rows.length===0){const current=await c.query(SELECT_PILOT,[PILOT_ID]);if(current.rows.length!==1)throw new GatewayProblem(503,'AI_BUDGET_STATE_UNAVAILABLE');const state=readPostgresState(current.rows[0],cap);if(state.usedCalls>=state.maxCalls)throw new GatewayProblem(429,'AI_BUDGET_EXHAUSTED');throw new GatewayProblem(503,'AI_BUDGET_STATE_UNAVAILABLE');}
   }else if(kind==='record'){
    if(!tokens)throw new GatewayProblem(503,'AI_BUDGET_STATE_UNAVAILABLE');assertTokens(tokens.input,tokens.output);
    result=await c.query('/* pilot:record */ UPDATE ai_pilot_v1.pilot_budget_state SET input_tokens=input_tokens+$2,output_tokens=output_tokens+$3,live_model_verified=true,updated_at=transaction_timestamp() WHERE pilot_id=$1 AND used_calls>0 AND input_tokens<=9007199254740991-$2 AND output_tokens<=9007199254740991-$3 RETURNING version,max_calls,used_calls,input_tokens,output_tokens,live_model_verified,updated_at',[PILOT_ID,tokens.input,tokens.output]);
   }else result=await c.query(SELECT_PILOT,[PILOT_ID]);
   if(result.rows.length!==1)throw new GatewayProblem(503,'AI_BUDGET_STATE_UNAVAILABLE');
   const state=readPostgresState(result.rows[0],cap);
   // Unknown commit fails closed: no caller/provider success is granted or retried automatically.
   try{await c.query('COMMIT');open=false;}catch{open=false;destroy=true;throw new GatewayProblem(503,'AI_BUDGET_STATE_UNAVAILABLE');}
   return state;
  }catch(e){if(open){try{await c?.query('ROLLBACK');}catch{destroy=true;}}if(e instanceof GatewayProblem)throw e;throw new GatewayProblem(503,'AI_BUDGET_STATE_UNAVAILABLE');}
  finally{c?.release(destroy);}
 };
 return Object.freeze({getState:()=>transact('read'),reserve:()=>transact('reserve'),record:(input:number,output:number)=>transact('record',{input,output})});
}
let postgresStore:ReturnType<typeof createPostgresPilotStore>|undefined;
async function productionPostgresStore(){
 if(postgresStore)return postgresStore;
 try{const raw=process.env['DATABASE_URL'];if(!raw)throw Error('MISSING_DB');const u=new URL(raw);if(!['postgres:','postgresql:'].includes(u.protocol))throw Error('DB_URL');const modes=u.searchParams.getAll('sslmode');if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&(modes.length!==1||!['require','verify-full'].includes(modes[0]!)))throw Error('DB_TLS');
  const db=await import('@workspace/db');postgresStore=createPostgresPilotStore(db.pool as unknown as PilotSqlPool);return postgresStore;
 }catch{throw new GatewayProblem(503,'AI_BUDGET_STATE_UNAVAILABLE');}
}
