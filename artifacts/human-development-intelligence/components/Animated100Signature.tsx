import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, Platform, View } from 'react-native';
import { GoldStandard100 } from '@/components/GoldStandard100';
import { signatureFrame } from '@/components/m1-gold-standard';
type Props={width?:number;height?:number;color:string;testID?:string};
export function Animated100Signature({width=66,height=40,testID='animated-100-signature'}:Props){
 const [elapsed,setElapsed]=useState(0),[reduced,setReduced]=useState(() => Platform.OS==='web' && typeof window!=='undefined' ? !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches : false),[active,setActive]=useState(true),[ready,setReady]=useState(false);
 useEffect(()=>{let live=true;const media=Platform.OS==='web' && typeof window!=='undefined'?window.matchMedia?.('(prefers-reduced-motion: reduce)'):undefined;const update=()=>setReduced(!!media?.matches);if(Platform.OS==='web'){update();media?.addEventListener?.('change',update);}else void AccessibilityInfo.isReduceMotionEnabled().then(v=>{if(live)setReduced(v);});const motion=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);const app=AppState.addEventListener('change',s=>setActive(s==='active'));const visibility=()=>setActive(!document.hidden);if(Platform.OS==='web'){setActive(!document.hidden);document.addEventListener('visibilitychange',visibility);}return()=>{live=false;motion.remove();media?.removeEventListener?.('change',update);app.remove();if(Platform.OS==='web')document.removeEventListener('visibilitychange',visibility);};},[]);
 useEffect(()=>{if(reduced||!active||!ready)return;let frame:number,previous:number|undefined,live=true;const step=(now:number)=>{if(!live)return;const delta=previous===undefined?0:now-previous;previous=now;setElapsed(t=>t+delta);frame=requestAnimationFrame(step);};frame=requestAnimationFrame(step);return()=>{live=false;cancelAnimationFrame(frame);};},[reduced,active,ready]);
 const value=reduced?{progress:1,alpha:1}:signatureFrame(elapsed);
 return <View accessible accessibilityLabel="Logo 100" testID={testID} nativeID={'animated-100-progress-'+value.progress.toFixed(4)} style={{width,height,justifyContent:'center'}}>
  <GoldStandard100 width={width} height={height} signature progress={value.progress} alpha={value.alpha} testID="m1-corner-signature" onReady={()=>setReady(true)}/>
 </View>;
}
