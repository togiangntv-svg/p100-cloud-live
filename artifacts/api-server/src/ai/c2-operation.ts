import {C2Error,failC2,readC2VisionBody,validateCoachVisionOutput} from '../../../../lib/api-zod/src/c2-vision.ts';
import {sanitizeC2Jpeg} from '../../../../lib/api-zod/src/c2-jpeg.ts';
import type {VisionTaskConsentAuthority} from './c2-permission.ts';
import type {M3IdentityContext} from './m3-permission.ts';
import type {C2VisionProvider} from './provider.ts';
type RequestLike={body?:unknown;aborted?:boolean;once?(name:string,f:()=>void):unknown;off?(name:string,f:()=>void):unknown};
type ResponseLike={status(n:number):ResponseLike;json(x:unknown):unknown;setHeader?(k:string,v:string):unknown;destroyed?:boolean};
export function createC2Handlers(deps:Readonly<{
 authority:VisionTaskConsentAuthority;
 verifyIdentity(req:RequestLike):Promise<M3IdentityContext>;
 provider:()=>C2VisionProvider;
 reserve():Promise<void>;
 /** Real decoder must validate sanitized bytes; absent => no processing. */
 decodeJpeg?:(bytes:Uint8Array)=>Promise<Readonly<{width:number;height:number}>>;
 timeoutMs?:number;
}>){
 const error=(res:ResponseLike,e:unknown)=>{
  const known=e instanceof C2Error?e:
   e instanceof Error&&e.name==='IdentitySessionError'?new C2Error('C2_AUTH_REQUIRED',401):
   new C2Error('C2_UNAVAILABLE',503);
  return res.status(known.status).json({code:known.code});
 };
 const identity=async(req:RequestLike)=>{if(req.aborted)failC2('C2_CANCELLED',409);const i=await deps.verifyIdentity(req);if(req.aborted)failC2('C2_CANCELLED',409);if(!i)failC2('C2_AUTH_REQUIRED',401);return i;};
 return Object.freeze({
  permission:async(req:RequestLike,res:ResponseLike)=>{
   res.setHeader?.('Cache-Control','no-store');
   try{return res.status(200).json(deps.authority.permission(await identity(req),req.body));}
   catch(e){return error(res,e);}
  },
  vision:async(req:RequestLike,res:ResponseLike)=>{
   res.setHeader?.('Cache-Control','no-store');
   let guard:ReturnType<VisionTaskConsentAuthority['begin']>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
   const cancel=()=>{if(guard)deps.authority.cancel(guard);};
   try{
    let i=await identity(req);
    const body=readC2VisionBody(req.body);
    guard=deps.authority.begin(i,body.grant);
    req.once?.('aborted',cancel);
    const current=async()=>{i=await identity(req);deps.authority.assertCurrent(guard!,i);};
    const jpeg=sanitizeC2Jpeg(body.image);
    // Reject unstripped metadata rather than silently changing client-signed image contents.
    if(jpeg.removed!==0)failC2('C2_UNSANITIZED_IMAGE',400);
    if(!deps.decodeJpeg)failC2('C2_DECODER_UNAVAILABLE');
    const decoded=await deps.decodeJpeg(jpeg.bytes);
    if(decoded.width!==jpeg.width||decoded.height!==jpeg.height)failC2('C2_JPEG_INVALID',400);
    await current();
    const provider=deps.provider();
    if(provider.mode!=='MOCK_ONLY')failC2('C2_PROVIDER_NOT_ADMITTED',503);
    await deps.reserve();await current(); // immediately before send, after asynchronous budget reservation
    const delay=deps.timeoutMs??12000;
    if(!Number.isFinite(delay)||delay<1||delay>12000)failC2('C2_TIMEOUT_CONFIGURATION',503);
    const controller=guard.signal;
    const interrupted=new Promise<never>((_,reject)=>{
     const stop=()=>reject(new C2Error('C2_CANCELLED',409));
     if(controller.aborted)stop();else controller.addEventListener('abort',stop,{once:true});
    });
    timer=setTimeout(cancel,delay);
    const result=await Promise.race([provider.analyze({grant:guard.grant,jpeg:jpeg.bytes},controller),interrupted]);
    await current();
    const safe=validateCoachVisionOutput(guard.grant.vision_domain,result);
    if(safe.state==='BLOCKED')failC2('C2_UNSAFE_PROVIDER_OUTPUT',502);
    await current(); // last asynchronous identity check before synchronous JSON output
    if(res.destroyed)failC2('C2_CONNECTION_CLOSED',409);
    return res.status(200).json({grant:guard.grant,result:safe});
   }catch(e){return error(res,e);}
   finally{if(timer)clearTimeout(timer);req.off?.('aborted',cancel);if(guard)deps.authority.finish(guard);}
  },
 });
}

/** Byte-level in-memory ingress, not an Express middleware execution claim. */
export const C2_WIRE_LIMITS=Object.freeze({defaultJsonBytes:32*1024,visionJsonBytes:1536*1024,visionLimitSpec:'1536kb',defaultLimitSpec:'32kb'});
export function createC2WireDispatcher(handlers:ReturnType<typeof createC2Handlers>){
 return async(wire:Readonly<{path:string;method?:string;headers?:Readonly<Record<string,string|undefined>>;rawBody:string|Uint8Array;signal?:AbortSignal}>):Promise<{status:number;headers:Record<string,string>;body:unknown}>=>{
  const headers:Record<string,string>={'Cache-Control':'no-store'};
  const reply=(status:number,code:string)=>({status,headers,body:{code}});
  if((wire.method??'POST')!=='POST')return reply(405,'C2_METHOD_NOT_ALLOWED');
  const types=Object.entries(wire.headers??{}).filter(([k])=>k.toLowerCase()==='content-type');
  if(types.length!==1||types[0][1]?.split(';')[0].trim().toLowerCase()!=='application/json')return reply(415,'C2_UNSUPPORTED_MEDIA_TYPE');
  const limit=wire.path==='/api/ai/c2/vision'?C2_WIRE_LIMITS.visionJsonBytes:C2_WIRE_LIMITS.defaultJsonBytes;
  const bytes=typeof wire.rawBody==='string'?new TextEncoder().encode(wire.rawBody):wire.rawBody;
  if(!(bytes instanceof Uint8Array))return reply(400,'C2_MALFORMED_JSON');
  if(bytes.byteLength>limit)return reply(413,'C2_PAYLOAD_TOO_LARGE');
  let body:unknown;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return reply(400,'C2_MALFORMED_JSON');}
  const handler=wire.path==='/api/ai/c2/permission'?handlers.permission:wire.path==='/api/ai/c2/vision'?handlers.vision:undefined;
  if(!handler)return reply(404,'C2_NOT_FOUND');
  if(wire.signal?.aborted)return reply(409,'C2_CANCELLED');
  const aborted=new Set<()=>void>();
  const cancel=()=>{for(const f of [...aborted]){aborted.delete(f);f();}};
  wire.signal?.addEventListener('abort',cancel,{once:true});
  const req={body,headers:wire.headers,method:'POST',path:wire.path,get aborted(){return wire.signal?.aborted??false;},
   once:(name:string,f:()=>void)=>{if(name==='aborted'){if(wire.signal?.aborted)f();else aborted.add(f);}},
   off:(name:string,f:()=>void)=>{if(name==='aborted')aborted.delete(f);}};
  let status=200,result:unknown;
  const res:ResponseLike={status(n){status=n;return this;},json(x){result=x;return this;},setHeader(k,v){headers[k]=v;}};
  try{await handler(req,res);return wire.signal?.aborted?reply(409,'C2_CANCELLED'):{status,headers,body:result};}
  catch{return reply(503,'C2_UNAVAILABLE');}
  finally{wire.signal?.removeEventListener('abort',cancel);aborted.clear();}
 };
}
