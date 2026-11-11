import {validateCoachVisionOutput,type VisionDomain,type VisionResult} from '../../../../lib/api-zod/src/c2-vision.ts';
export type CoachPresenceProposal=Readonly<{
 state:'PROPOSAL';vision_domain:VisionDomain;result:VisionResult;
 requires_user_choice:true;M6_STARTED:false;M7_USE_NEXT_CYCLE:false;
}>;
export function proposeCoachPresence(domain:VisionDomain,value:unknown):CoachPresenceProposal|undefined{
 const result=validateCoachVisionOutput(domain,value);
 if(result.state!=='OBSERVATIONS')return undefined;
 return Object.freeze({state:'PROPOSAL',vision_domain:domain,result,requires_user_choice:true,M6_STARTED:false,M7_USE_NEXT_CYCLE:false});
}
