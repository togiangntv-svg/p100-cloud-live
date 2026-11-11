import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { GoldStandard100 } from '@/components/GoldStandard100';
import { DRAW_DURATION_MS, mechanicalPose } from '@/components/m1-gold-standard';
export { FOUNDER_100_TRACE_PATH, FOUNDER_BORDER_TRACE_PATH } from './Founder100Paths';
type Props = { size: number; motionPreferenceKnown: boolean; reduceMotion: boolean; surfaceColor: string; traceColor: string; traceGlowColor: string; borderGlowColor: string; onDrawComplete: () => void; departing?: boolean; flightProgress?: number; paused?: boolean };
export function WelcomeLogoAnimation(props: Props) {
 const [elapsed,setElapsed]=useState(0), [ready,setReady]=useState(false);
 const [active,setActive]=useState(Platform.OS==='web' ? typeof document==='undefined'||!document.hidden : AppState.currentState==='active');
 const complete=useRef(false), callback=useRef(props.onDrawComplete); callback.current=props.onDrawComplete;
 useEffect(()=>{ const sub=AppState.addEventListener('change',s=>setActive(s==='active'));const visibility=()=>setActive(!document.hidden); if(Platform.OS==='web')document.addEventListener('visibilitychange',visibility); return()=>{sub.remove();if(Platform.OS==='web')document.removeEventListener('visibilitychange',visibility);};},[]);
 useEffect(()=>{
  if(!ready||!props.motionPreferenceKnown)return;
  if(props.reduceMotion){setElapsed(DRAW_DURATION_MS);if(!complete.current){complete.current=true;callback.current();}return;}
  if(!active||props.paused)return;
  let frame:number,previous:number|undefined,live=true;
  const tick=(now:number)=>{if(!live)return;const delta=previous===undefined?0:Math.min(50,Math.max(0,now-previous));previous=now;setElapsed(value=>value+delta);frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>{live=false;cancelAnimationFrame(frame);};
 },[ready,props.motionPreferenceKnown,props.reduceMotion,props.paused,active]);
 useEffect(()=>{if(elapsed>=DRAW_DURATION_MS&&!complete.current){complete.current=true;callback.current();}},[elapsed]);
 const p=props.departing?1:Math.min(1,elapsed/DRAW_DURATION_MS);
 const bob=elapsed>=DRAW_DURATION_MS&&!props.reduceMotion&&!props.departing?mechanicalPose(elapsed-DRAW_DURATION_MS):{y:0,scale:1,rimGain:1,glow:p*0.25,wave:0};
 const fade=props.departing?Math.max(0,1-(props.flightProgress??0)/0.58):1;
 return <View testID="welcome-logo-animation" nativeID={'welcome-logo-progress-'+p.toFixed(4)+'-'+p.toFixed(4)} style={{width:props.size,height:props.size,transform:[{translateY:bob.y},{scale:bob.scale}]}}>
  <View pointerEvents="none" testID="m1-rim-bloom" style={{position:'absolute',top:-5,left:-5,right:-5,bottom:-5,borderRadius:props.size*0.245,opacity:fade*(elapsed>=3000?0.18+0.82*bob.wave:p*0.25),boxShadow:'0 0 22px rgba(255,250,220,0.75), 0 0 44px rgba(255,200,80,0.45)'}}/>
  <GoldStandard100 width={props.size} height={props.size} progress={p} rimProgress={p} rimGain={bob.rimGain*fade} boxAlpha={fade} testID="welcome-logo-draw" onReady={()=>setReady(true)}/>
  <View pointerEvents="none" testID="m1-lake-reflection" style={{position:'absolute',left:props.size*0.05,top:props.size*1.03,width:props.size*0.9,height:props.size*0.21,borderRadius:100,opacity:fade*bob.glow,backgroundColor:'rgba(255,190,75,0.25)',boxShadow:'0 0 24px 14px rgba(255,238,175,0.35)',transform:[{scale:0.88+0.24*bob.wave}]}}/>
 </View>;
}
