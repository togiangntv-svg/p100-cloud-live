/** Headless wire contract. No client field creates owner/task authority. */
export const C2_DOMAINS = ['meal','exercise_form','physique_posture'] as const;
export type VisionDomain = typeof C2_DOMAINS[number];
export const C2_POLICY = Object.freeze({
 meal: { taskKind:'meal_image_assessment', purpose:'MEAL_IMAGE_EXTERNAL_ANALYSIS', cues:['VISIBLE_FOOD','MIXED_COMPONENTS'] },
 exercise_form: { taskKind:'exercise_form_observation', purpose:'EXERCISE_FORM_EXTERNAL_ANALYSIS', cues:['VISIBLE_2D_ALIGNMENT','CAPTURE_ANGLE_LIMIT'] },
 physique_posture: { taskKind:'physique_posture_observation', purpose:'PHYSIQUE_POSTURE_EXTERNAL_ANALYSIS', cues:['VISIBLE_STANCE','VISIBLE_SITTING_ALIGNMENT'] },
});
export type VisionScope = Readonly<{
 taskSessionId:string; taskId:string; taskRevision:number; vision_domain:VisionDomain;
 purpose:string; candidateId:string; c1Revision:number;
}>;
export type VisionGrant = Readonly<VisionScope & {
 c2GrantId:string; consentRevision:number; authorityEpoch:number; expiresAt:number;
}>;
export type VisionResult =
 | Readonly<{vision_domain:VisionDomain; state:'OBSERVATIONS'; cues:readonly string[];
 uncertainty:'LIMITED_2D'; limitations:readonly ['SINGLE_FRAME_NOT_DIAGNOSTIC']; quality:'CLEAR_STATIC_VIEW'}>
 | Readonly<{vision_domain:VisionDomain; state:'NEED_MORE_INFO'; reason:'OCCLUDED'|'POOR_ANGLE'|'LOW_QUALITY'|'AMBIGUOUS'}>
 | Readonly<{vision_domain:VisionDomain; state:'BLOCKED'; reason:'INVALID_OR_UNSAFE_OUTPUT'}>;
export type PermissionCommand = Readonly<VisionScope & {
 action:'GRANT'|'REVOKE'; operationId:string; createdAt:number; accepted?:true; c2GrantId?:string;
}>;
export const C2_WIRE_LIMIT = 1536 * 1024;
export const C2_IMAGE_LIMIT = 1024 * 1024;
export class C2Error extends Error {
 readonly code:string;readonly status:number;
 constructor(code:string,status:number){super(code);this.code=code;this.status=status;this.name='C2Error';}
}
export function failC2(code:string,status=403):never {throw new C2Error(code,status);}
export const c2Id=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
export const c2Revision=(x:unknown):x is number=>Number.isSafeInteger(x)&&Number(x)>0;
export function c2Record(x:unknown):Record<string,unknown> {
 if(!x||typeof x!=='object'||Array.isArray(x))return failC2('C2_SCHEMA',400);
 const ds=Object.getOwnPropertyDescriptors(x);
 if(Reflect.ownKeys(ds).length>24||Reflect.ownKeys(ds).some(k=>typeof k!=='string'||!('value' in ds[k])))
  return failC2('C2_SCHEMA',400);
 return x as Record<string,unknown>;
}
export function exactC2(x:Record<string,unknown>,required:readonly string[],optional:readonly string[]=[]):void{
 if(required.some(k=>!Object.hasOwn(x,k))||Object.keys(x).some(k=>!required.includes(k)&&!optional.includes(k)))
  failC2('C2_SCHEMA',400);
}
export const C2_SCOPE_KEYS=['taskSessionId','taskId','taskRevision','vision_domain','purpose','candidateId','c1Revision'] as const;
export function readVisionScope(raw:unknown):VisionScope{
 const x=c2Record(raw),d=x.vision_domain;
 if(!C2_DOMAINS.includes(d as VisionDomain)||!c2Id(x.taskSessionId)||!c2Id(x.taskId)
 ||!c2Id(x.candidateId)||!c2Revision(x.taskRevision)||!c2Revision(x.c1Revision)
 ||x.purpose!==C2_POLICY[d as VisionDomain].purpose)failC2('C2_SCOPE',400);
 return Object.freeze(Object.fromEntries(C2_SCOPE_KEYS.map(k=>[k,x[k]]))) as VisionScope;
}
export const sameVisionScope=(a:VisionScope,b:VisionScope)=>C2_SCOPE_KEYS.every(k=>a[k]===b[k]);
export function readPermissionCommand(raw:unknown):PermissionCommand{
 const x=c2Record(raw);
 exactC2(x,[...C2_SCOPE_KEYS,'action','operationId','createdAt'],['accepted','c2GrantId']);
 const scope=readVisionScope(x);
 if(!c2Id(x.operationId)||!Number.isSafeInteger(x.createdAt)||Number(x.createdAt)<0||!['GRANT','REVOKE'].includes(String(x.action)))failC2('C2_SCHEMA',400);
 if(x.action==='GRANT'&&(x.accepted!==true||x.c2GrantId!==undefined))failC2('C2_EXPLICIT_CONSENT_REQUIRED');
 if(x.action==='REVOKE'&&(!c2Id(x.c2GrantId)||x.accepted!==undefined))failC2('C2_SCHEMA',400);
 return Object.freeze({...scope,action:x.action,operationId:x.operationId,createdAt:x.createdAt,
 ...(x.accepted===true?{accepted:true}:{}),...(x.c2GrantId?{c2GrantId:x.c2GrantId}:{})}) as PermissionCommand;
}
export function readVisionGrant(raw:unknown):VisionGrant{
 const x=c2Record(raw);exactC2(x,[...C2_SCOPE_KEYS,'c2GrantId','consentRevision','authorityEpoch','expiresAt']);
 const scope=readVisionScope(x);
 if(!c2Id(x.c2GrantId)||!c2Revision(x.consentRevision)||!c2Revision(x.authorityEpoch)
 ||!Number.isFinite(x.expiresAt))failC2('C2_GRANT_INVALID');
 return Object.freeze({...scope,c2GrantId:x.c2GrantId,consentRevision:x.consentRevision,
 authorityEpoch:x.authorityEpoch,expiresAt:x.expiresAt}) as VisionGrant;
}
/** Closed semantic vocabulary: no arbitrary model prose/numbers/identity/clinical claims reach M5. */
export function validateCoachVisionOutput(domain:VisionDomain,raw:unknown):VisionResult{
 const blocked=()=>Object.freeze({vision_domain:domain,state:'BLOCKED',reason:'INVALID_OR_UNSAFE_OUTPUT'}) as VisionResult;
 try{
  const x=c2Record(raw);
  if(x.vision_domain!==domain)return blocked();
  if(x.state==='NEED_MORE_INFO'){
   exactC2(x,['vision_domain','state','reason']);
   if(!['OCCLUDED','POOR_ANGLE','LOW_QUALITY','AMBIGUOUS'].includes(String(x.reason)))return blocked();
   return Object.freeze({...x}) as VisionResult;
  }
  exactC2(x,['vision_domain','state','cues','uncertainty','limitations','quality']);
  if(x.state==='OBSERVATIONS'&&['OCCLUDED','POOR_ANGLE','LOW_QUALITY'].includes(String(x.quality)))return Object.freeze({vision_domain:domain,state:'NEED_MORE_INFO',reason:x.quality}) as VisionResult;
  if(x.state!=='OBSERVATIONS'||x.quality!=='CLEAR_STATIC_VIEW'||x.uncertainty!=='LIMITED_2D'
   ||!Array.isArray(x.cues)||x.cues.length<1||x.cues.length>2
   ||x.cues.some(c=>!C2_POLICY[domain].cues.includes(c))
   ||!Array.isArray(x.limitations)||x.limitations.length!==1||x.limitations[0]!=='SINGLE_FRAME_NOT_DIAGNOSTIC')return blocked();
  return Object.freeze({...x,cues:Object.freeze([...x.cues]),limitations:Object.freeze([...x.limitations])}) as VisionResult;
 }catch{return blocked();}
}
export function readC2VisionBody(raw:unknown):Readonly<{grant:VisionGrant; image:Uint8Array}>{
 const x=c2Record(raw);exactC2(x,['grant','mime','imageBase64']);
 const grant=readVisionGrant(x.grant);
 if(x.mime!=='image/jpeg'||typeof x.imageBase64!=='string')failC2('C2_IMAGE_FORMAT',400);
 const text=x.imageBase64 as string;
 if(text.length>4*Math.ceil(C2_IMAGE_LIMIT/3))failC2('C2_IMAGE_TOO_LARGE',413);
 if(!text||text.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))failC2('C2_IMAGE_FORMAT',400);
 let decoded:string;try{decoded=atob(text);}catch{return failC2('C2_IMAGE_FORMAT',400);}
 if(decoded.length>C2_IMAGE_LIMIT)failC2('C2_IMAGE_TOO_LARGE',413);
 const image=Uint8Array.from(decoded,c=>c.charCodeAt(0));
 return Object.freeze({grant,image});
}
