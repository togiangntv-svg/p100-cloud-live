import {C2_POLICY,readVisionScope,type VisionScope} from '../../../../lib/api-zod/src/c2-vision.ts';
/** A headless local necessity check, never a substitute for server facts/consent. */
export function resolveCoachPresenceM4(scope:VisionScope,task:Readonly<{
 taskSessionId:string;taskId:string;taskRevision:number;taskKind:string;status:string;
 safety:'CLEAR'|'HOLD';needsImage:boolean;imageAccepted:boolean;c1Allowed:boolean;
}>):'SUFFICIENT'|'NEED_CONTEXT'|'CONSENT_REQUIRED'|'BLOCKED'{
 try{
  readVisionScope(scope);
  if(task.status!=='READY'||task.safety!=='CLEAR'||task.taskSessionId!==scope.taskSessionId
  ||task.taskId!==scope.taskId||task.taskRevision!==scope.taskRevision
  ||task.taskKind!==C2_POLICY[scope.vision_domain].taskKind||task.needsImage!==true)return 'BLOCKED';
  if(!task.imageAccepted)return 'NEED_CONTEXT';
  if(!task.c1Allowed)return 'CONSENT_REQUIRED';
  return 'SUFFICIENT';
 }catch{return 'BLOCKED';}
}
