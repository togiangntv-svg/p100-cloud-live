import type { M3LanguageAdapter } from './resolver';
import type { OwnerSessionBinding } from '../identity/owner-session-coordinator';
import { readLocalVerificationBinding } from '../../lib/identity/local-verification';
import { resolveDeterministicM3 } from './deterministic-semantics';
const registered=new WeakMap<object,()=>boolean>();
export function isLocalVerificationAdapter(adapter:unknown):boolean {
  return typeof adapter==='object'&&adapter!==null&&registered.has(adapter);
}
export function localVerificationAdapterCurrent(adapter:unknown):boolean {
  return typeof adapter==='object'&&adapter!==null&&Boolean(registered.get(adapter)?.());
}
export function createLocalVerificationAdapter(
  owner:OwnerSessionBinding, allowed:()=>boolean,
): M3LanguageAdapter | undefined {
  const binding=readLocalVerificationBinding(owner);if(!binding)return undefined;
  let epoch=0;
  const current=()=>readLocalVerificationBinding(owner)===binding&&binding.isCurrent();
  const adapter:M3LanguageAdapter=Object.freeze<M3LanguageAdapter>({
    provenance:'TEST_FIXTURE',processing:'ON_DEVICE',contract:'M3_GATEWAY_V1',
    async interpret({content,operation},signal){
      const ticket=epoch;
      const valid=()=>current()&&allowed()&&operation.isCurrent()&&!signal.aborted&&ticket===epoch;
      if(!valid())throw Error('LOCAL_M3_DENIED');
      if(content.locale!=='vi'&&content.locale!=='en')throw Error('LOCAL_M3_UNSUPPORTED_LOCALE');
      return binding.authorize(signal,async()=>{
        if(!valid())throw Error('LOCAL_M3_STALE');
        const meaning=resolveDeterministicM3(content);
        if(!valid())throw Error('LOCAL_M3_STALE');
        return meaning;
      });
    },
    async revoke(){epoch++;},
  });
  registered.set(adapter,current);return adapter;
}
