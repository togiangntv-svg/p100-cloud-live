import Svg, { Defs, ClipPath, Polygon, Circle, G, RadialGradient, Stop } from 'react-native-svg';
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, ImageBackground, Platform, Pressable, Modal, Text, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WelcomeLogoAnimation } from '@/components/WelcomeLogoAnimation';
import { PRESS_DURATION_MS, SHRINK_FLIGHT_MS } from '@/components/m1-gold-standard';
import { useLocale } from '@/context/LocalizationContext';
import { RELEASE_LOCALE_OPTIONS } from '@/i18n';
import type { ReleaseLocale } from '@/i18n-opening';
const welcomeImage=require('../assets/images/scene_m2_sunless_golden.jpg');
type Props={reviewing:boolean;onBegin:()=>void;onClose:()=>void};
export function WelcomeExperience({reviewing,onBegin,onClose}:Props){
 const {width,height}=useWindowDimensions(),insets=useSafeAreaInsets(),{locale,setLocale,t}=useLocale();
 const [reduceMotion,setReduceMotion]=useState(() => Platform.OS === 'web' && typeof window !== 'undefined' ? !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches : false),[motionKnown,setMotionKnown]=useState(() => Platform.OS === 'web' && typeof window !== 'undefined'),[backgroundPaused,setBackgroundPaused]=useState(false),[languageOpen,setLanguageOpen]=useState(false),[elapsed,setElapsed]=useState<number|null>(null);
 const flightValue=useRef(new Animated.Value(0)).current,flightDone=useRef(false);
 const retiredRef=useRef(false),leaving=useRef(false),beginRef=useRef(onBegin),focus=useRef<any>(null),overlay=useRef<any>(null);beginRef.current=onBegin;
 useEffect(()=>{retiredRef.current=false;let mounted=true;if(Platform.OS==='web' && typeof window!=='undefined'){const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');const update=()=>{setReduceMotion(!!media?.matches);setMotionKnown(true);};update();media?.addEventListener?.('change',update);return()=>{mounted=false;retiredRef.current=true;media?.removeEventListener?.('change',update);};}void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(mounted){setReduceMotion(value);setMotionKnown(true);}});const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduceMotion);return()=>{mounted=false;retiredRef.current=true;sub.remove();};},[]);
 useEffect(()=>{const timer=setTimeout(()=>focus.current?.focus?.({preventScroll:true}),40);if(Platform.OS!=='web')return()=>clearTimeout(timer);const root=overlay.current as HTMLElement|null;const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&reviewing){event.preventDefault();onClose();}if(event.key==='Tab'&&root){const nodes=Array.from(root.querySelectorAll<HTMLElement>('button,[tabindex="0"]')).filter(e=>!e.hasAttribute('disabled'));if(!nodes.length)return;const at=nodes.indexOf(document.activeElement as HTMLElement);if((!event.shiftKey&&(at===nodes.length-1||at===-1))||(event.shiftKey&&at<=0)){event.preventDefault();nodes[event.shiftKey?nodes.length-1:0].focus();}}};root?.addEventListener('keydown',key);return()=>{clearTimeout(timer);root?.removeEventListener('keydown',key);};},[reviewing,onClose]);
 useEffect(()=>{if(elapsed===null)return;let frame:number,start:number|undefined;const step=(now:number)=>{if(retiredRef.current)return;start??=now;const value=now-start;if(value>=PRESS_DURATION_MS+SHRINK_FLIGHT_MS){setElapsed(PRESS_DURATION_MS+SHRINK_FLIGHT_MS);return;}setElapsed(value);frame=requestAnimationFrame(step);};frame=requestAnimationFrame(step);return()=>cancelAnimationFrame(frame);},[elapsed!==null]);
 const begin=()=>{if(retiredRef.current||leaving.current)return;leaving.current=true;setLocale(locale);if(!motionKnown||reduceMotion){beginRef.current();return;}setElapsed(0);
  Animated.timing(flightValue,{toValue:1,duration:PRESS_DURATION_MS+SHRINK_FLIGHT_MS,useNativeDriver:true}).start(({finished})=>{if(finished&&!retiredRef.current&&!flightDone.current){flightDone.current=true;beginRef.current();}});
 };
 const flight=elapsed===null?0:Math.min(1,Math.max(0,(elapsed-PRESS_DURATION_MS)/SHRINK_FLIGHT_MS));
 const ease=1-Math.pow(1-flight,3);
 const side=width*0.49,targetSide=66*480/380;
 const topInset=Platform.OS==='web'?(height<600?10:67):insets.top;
 const targetLeft=20-50*targetSide/480,targetTop=topInset+4+(40-66*200/380)/2-135*targetSide/480;
 const size=side+(targetSide-side)*ease;
 const depressed=elapsed!==null&&elapsed<PRESS_DURATION_MS;
 useEffect(()=>{if(Platform.OS!=='web'||typeof document.createElement!=='function'||!document.head)return;const tag=document.createElement('style');tag.textContent='[data-testid="welcome-begin"]{outline:none!important;border-radius:22.5%}[data-testid="welcome-begin"]:focus-visible{box-shadow:0 0 0 3px rgba(255,248,222,.94),0 0 22px rgba(255,214,128,.6)}';document.head.appendChild(tag);return()=>tag.remove();},[]);
 return <View ref={overlay} testID="m1-gold-standard-screen" style={styles.root}>
  <StatusBar style="light"/>
  <ImageBackground source={welcomeImage} resizeMode="cover" style={StyleSheet.absoluteFill}/>
  <View pointerEvents="none" style={[StyleSheet.absoluteFill,{backgroundColor:'rgba(3,7,18,0.66)',opacity:1-ease}]}/>
  <View pointerEvents="none" testID="m1-physical-sun" style={[StyleSheet.absoluteFill,{opacity:flight>0?1:0}]}>
    <Svg width={width} height={height} viewBox="0 0 540 960" preserveAspectRatio="xMidYMid slice"><Defs>
      <ClipPath id="s32-welcome-ridge"><Polygon points="0.00,333.98 5.99,333.41 12.04,332.16 18.04,331.10 24.03,331.87 30.08,334.46 36.07,335.62 42.07,336.86 48.11,338.30 54.11,338.02 60.10,338.88 66.10,339.84 72.14,340.70 78.14,341.76 84.13,343.01 90.18,345.12 96.17,343.39 102.17,341.47 108.22,339.26 114.21,338.59 120.20,336.86 126.25,336.38 132.25,335.71 138.24,333.98 144.29,331.39 150.28,328.13 156.28,326.02 162.32,324.29 168.32,321.31 174.31,320.54 180.36,319.97 186.35,317.47 192.35,314.30 198.34,311.62 204.39,309.70 210.38,307.97 216.38,307.58 222.43,307.30 228.42,307.01 234.41,307.97 240.46,310.27 246.46,312.10 252.45,313.15 258.50,314.59 264.49,316.32 270.49,318.53 276.53,319.87 282.53,320.16 288.52,320.54 294.57,319.68 300.56,319.39 306.56,320.16 312.55,321.98 318.60,321.98 324.59,319.39 330.59,318.43 336.64,318.72 342.63,319.30 348.62,321.12 354.67,324.29 360.67,326.30 366.66,328.42 372.71,331.01 378.70,331.39 384.70,334.18 390.74,331.01 396.74,338.59 402.73,340.99 408.78,343.97 414.77,345.89 420.77,347.33 426.82,347.62 432.81,348.58 438.80,341.28 444.80,351.84 450.85,352.90 456.84,353.86 462.83,352.32 468.88,344.26 474.88,338.30 480.87,344.83 486.92,351.17 492.91,354.14 498.91,353.28 504.95,355.01 510.95,351.74 516.94,352.90 522.99,330.24 528.98,280.13 534.98,279.26 540.00,278.30 540.00,0.00 0.00,0.00"/></ClipPath>
      <RadialGradient id="s32-welcome-glow"><Stop offset="0" stopColor="#FFF9D5" stopOpacity="1"/><Stop offset="0.28" stopColor="#FFF3BE" stopOpacity="0.9"/><Stop offset="1" stopColor="#FFD46B" stopOpacity="0"/></RadialGradient>
    </Defs><G clipPath="url(#s32-welcome-ridge)"><Circle cx={262} cy={384-72*ease} r={84} fill="url(#s32-welcome-glow)"/><Circle cx={262} cy={384-72*ease} r={26} fill="#FFF9DC"/></G></Svg>
  </View>
  <View pointerEvents="none" testID="m1-greeting" style={{position:'absolute',top:height*0.485,left:20,right:20,alignItems:'center',opacity:Math.max(0,1-flight/0.45),transform:[{translateY:-14*Math.min(1,flight/0.45)}]}}>
   <Text style={{fontFamily:Platform.select({ios:'Georgia',android:'serif',web:'"Times New Roman", "Noto Serif", Georgia, serif'}),fontSize:30,lineHeight:38,fontWeight:'700',color:'#FFFBEB',textAlign:'center'}}>{t('openingTitleLead').normalize('NFC')}</Text>
   <Text style={{fontSize:16,lineHeight:24,color:'#FFF5E2',marginTop:12,textAlign:'center'}}>{t('welcomeTagline').normalize('NFC')}</Text>
  </View>
  <View pointerEvents="none" style={{position:'absolute',left:width*0.2,top:height*0.2,width:width*0.6,height:height*0.25,borderRadius:200,backgroundColor:'rgba(255,155,55,0.035)',boxShadow:'0 0 36px rgba(255,200,110,0.12)'}}/>
  <Pressable ref={reviewing?undefined:focus} testID="welcome-begin" accessibilityRole="button" accessibilityLabel={t('welcomeBegin').normalize('NFC')} accessibilityState={{disabled:leaving.current}} disabled={leaving.current} onPress={begin} style={{position:'absolute',left:width*0.255+(targetLeft-width*0.255)*ease,top:height*0.195+(targetTop-height*0.195)*ease,width:size,height:size,borderRadius:size*0.225,transform:[{translateY:depressed?7:0},{scale:depressed?0.94:1}],zIndex:10}}>
   <View testID="opening-logo-open" style={{width:size,height:size}}>
    <WelcomeLogoAnimation size={size} motionPreferenceKnown={motionKnown} reduceMotion={reduceMotion} paused={backgroundPaused} departing={elapsed!==null} flightProgress={flight} surfaceColor="#030408" traceColor="#FFFFFF" traceGlowColor="#FFE57F" borderGlowColor="#F5B027" onDrawComplete={()=>undefined}/>
   </View>
  </Pressable>
  {reviewing?<Pressable ref={reviewing?focus:undefined} testID="welcome-close" accessibilityRole="button" accessibilityLabel={t('welcomeClose').normalize('NFC')} onPress={onClose} style={[styles.control,{right:16,top:Math.max(insets.top+8,16)}]}><Feather name="x" size={22} color="#FFF"/></Pressable>:null}
  {motionKnown&&!reduceMotion&&elapsed===null?<Pressable testID="welcome-background-motion-toggle" accessibilityRole="button" accessibilityLabel={backgroundPaused?t('welcomeMotionResume'):t('welcomeMotionPause')} accessibilityState={{ checked: backgroundPaused }} onPress={()=>setBackgroundPaused(v=>!v)} style={[styles.control,{right:16,bottom:Math.max(insets.bottom+12,16)}]}><Feather name={backgroundPaused?'play':'pause'} size={16} color="#FFF"/></Pressable>:null}

  {elapsed===null?<Pressable testID="welcome-language-menu" accessibilityRole="button" accessibilityLabel={t('languageMenuOpen').normalize('NFC')} onPress={()=>setLanguageOpen(true)} style={[styles.control,{left:16,bottom:Math.max(insets.bottom+12,16)}]}><Feather name="globe" size={16} color="#FFF"/></Pressable>:null}
  <Modal visible={languageOpen} transparent animationType="fade" onRequestClose={()=>setLanguageOpen(false)}><View style={{flex:1,backgroundColor:'rgba(3,4,8,0.92)',alignItems:'center',justifyContent:'center'}}><View style={{padding:24,gap:8}}>{RELEASE_LOCALE_OPTIONS.map(option=><Pressable key={option.id} testID={'welcome-language-'+option.id} accessibilityRole="button" accessibilityState={{selected:locale===option.id}} onPress={() => setLocale(option.id as ReleaseLocale)} style={{minHeight:44,padding:10}}><Text style={{color:'#FFF',fontSize:18}}>{option.nativeName}</Text></Pressable>)}<Pressable accessibilityRole="button" accessibilityLabel={t('welcomeClose').normalize('NFC')} onPress={()=>setLanguageOpen(false)} style={{minHeight:44,alignItems:'center',justifyContent:'center'}}><Feather name="x" size={22} color="#FFF"/></Pressable></View></View></Modal>
 </View>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:'#030408'},control:{position:'absolute',width:40,height:40,borderRadius:20,backgroundColor:'rgba(3,4,8,0.5)',alignItems:'center',justifyContent:'center',zIndex:20}});
