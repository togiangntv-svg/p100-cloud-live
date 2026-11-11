import {readVisionScope,sameVisionScope,type VisionScope,type VisionGrant} from '../../../../lib/api-zod/src/c2-vision.ts';
/** Local explicit consent lifetime; no production/server authority can be minted here. */
export function createCoachPresenceConsent(){
 let scope:VisionScope|undefined,revision=0,allowed=false;
 const receipts=new WeakMap<object,{scope:VisionScope;epoch:number}>();
 return Object.freeze({
  bind:(next:VisionScope)=>{const valid=readVisionScope(next);if(scope&&sameVisionScope(scope,valid))return;
   scope=valid;revision++;allowed=false;},
  allow:(explicit:boolean)=>{if(!scope||explicit!==true)return undefined;
   allowed=true;const receipt=Object.freeze({scope,revision:++revision});receipts.set(receipt,{scope,epoch:revision});return receipt;},
  isCurrent:(receipt:object)=>{const r=receipts.get(receipt);return Boolean(allowed&&r&&scope&&sameVisionScope(scope,r.scope)&&r.epoch===revision);},
  revoke:()=>{allowed=false;revision++;},retire:()=>{allowed=false;scope=undefined;revision++;},
 });
}
export type {VisionScope,VisionGrant};
