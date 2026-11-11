import React from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReleaseLocale } from '@/i18n-opening';
import { W01_COPY, localizeW01Content } from '@/i18n-m6';
import {
  actW01Product, answerW01ProductQuestion, type W01Presentation,
} from './w01-product-controller';

type Controller = Readonly<{ presentation: W01Presentation }>;

/** Presentation only: semantic callbacks report explicit choices; domain owns every classification. */
export function W01ProductCard({ controller, locale, color, border }: Readonly<{
  controller: Controller; locale: ReleaseLocale; color: string; border: string;
}>) {
  // Fixed outdoor surface keeps contrast independent of the translucent parent.
  color = '#14261C';
  border = '#68836D';
  const copy = W01_COPY[locale];
  const view = controller.presentation;
  const question = view.question;
  const localizedContent = localizeW01Content(locale, view.content, view.durationMinutes);
  if (question) return <View testID={`w01-question-${question.id}`} style={[styles.card, { borderColor: border }]}>
    <Text style={{ color, fontSize: 16, lineHeight: 24 }}>{copy.questions[question.id]}</Text>
    <View style={styles.options}>{question.options.map((id) => <Pressable key={id}
      testID={`w01-answer-${id}`} accessibilityRole="button" onPress={() => answerW01ProductQuestion(view, id)}
      style={[styles.button, { borderColor: border }]}><Text style={{ color, fontSize: 16, lineHeight: 24 }}>{copy.answers[id]}</Text></Pressable>)}</View>
    <Pressable testID="w01-global-skip" accessibilityRole="button" style={styles.button} onPress={() => view.globalSkip()}>
      <Text style={{ color, fontSize: 16, lineHeight: 24 }}>{copy.global_skip}</Text>
    </Pressable>
  </View>;
  const action = !view.content || localizedContent || view.primaryAction === 'stop' ? view.primaryAction : undefined;
  const outcome = ['URGENT_HELP', 'SAFETY_HOLD', 'NO_ACTION', 'UNSUPPORTED', 'SOURCE_BLOCKED',
    'DISMISSED', 'UNAVAILABLE', 'DENIED', 'CANCELLED', 'STOPPED', 'INVALIDATED'].includes(view.state);
  if (outcome && !action && !view.canEnd) {
    return <Text testID={`w01-outcome-${view.state.toLowerCase()}`} style={[styles.outcome,{ color }]}>
      {view.endedByUser ? copy.ended : copy.outcomes[view.state] ?? copy.outcomes.UNAVAILABLE}
    </Text>;
  }
  if (!action && !view.canEnd) return <Text testID="w01-outcome-unavailable" style={[styles.outcome,{ color }]}>{copy.outcomes.UNAVAILABLE}</Text>;
  return <View testID={`w01-${view.state.toLowerCase()}`} style={[styles.card, { borderColor: border }]}>
    <LivingWalkRing active={view.state === 'STARTED'} color={color} />
    {localizedContent ? <><Text style={{ color, fontSize: 16, lineHeight: 24 }}>{localizedContent.title}</Text><Text style={{ color, fontSize: 16, lineHeight: 24 }}>{localizedContent.instructions}</Text>
      <Text style={{ color, fontSize: 16, lineHeight: 24 }}>{localizedContent.warning}</Text><Text style={{ color, fontSize: 16, lineHeight: 24 }}>{localizedContent.why}</Text></> : view.content ? <Text style={{ color, fontSize: 16, lineHeight: 24 }}>{copy.outcomes.SOURCE_BLOCKED}</Text> : null}
    {view.state === 'ACCEPTED' ? <Text style={{ color, fontSize: 16, lineHeight: 24 }}>{copy.accepted}</Text> : null}
    {view.state === 'STARTED' ? <Text style={{ color, fontSize: 16, lineHeight: 24 }}>{copy.started}</Text> : null}
    {view.state === 'STOPPED' ? <Text style={{ color, fontSize: 16, lineHeight: 24 }}>{copy.outcomes.STOPPED}</Text> : null}
    {action ? <Pressable testID={`w01-${action}`} accessibilityRole="button" onPress={() => actW01Product(view, action)}
      style={[styles.button, { borderColor: border }]}><Text style={{ color, fontSize: 16, lineHeight: 24 }}>{copy.actions[action]}</Text></Pressable> : null}
    {view.canEnd ? <Pressable testID="w01-end" accessibilityRole="button" onPress={() => actW01Product(view, 'end')}
      style={[styles.button, { borderColor: border }]}><Text style={{ color, fontSize: 16, lineHeight: 24 }}>{copy.actions.end}</Text></Pressable> : null}
    {view.canCancel ? <Pressable testID="w01-cancel" accessibilityRole="button" style={styles.button}
      onPress={() => actW01Product(view, 'cancel')}><Text style={{ color, fontSize: 16, lineHeight: 24 }}>{copy.actions.cancel}</Text></Pressable> : null}
  </View>;
}
const styles = StyleSheet.create({ outcome: {backgroundColor:"#FFFBEB",borderRadius:20,padding:18,fontSize:16,lineHeight:24}, card: { width: '100%', backgroundColor: '#FFFBEB', borderWidth: 1, borderRadius: 24, padding: 18, gap: 14 }, options: { gap: 10 }, button: { backgroundColor: '#F3E5C6', minHeight: 52, borderWidth: 2, borderRadius: 26, paddingHorizontal: 18, paddingVertical: 14, justifyContent: 'center' } });

/** Decorative local walk state only; it never represents a sensor or measured progress. */
function LivingWalkRing({active,color}:{active:boolean;color:string}) {
  const pulse=React.useRef(new Animated.Value(0)).current;
  const [reduceMotion,setReduceMotion]=React.useState(true);
  const [foreground,setForeground]=React.useState(Platform.OS==='web'
    ? typeof document==='undefined'||!document.hidden : AppState.currentState==='active');
  React.useEffect(()=>{
    let mounted=true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(mounted)setReduceMotion(value);});
    const motion=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduceMotion);
    const state=AppState.addEventListener('change',value=>setForeground(value==='active'));
    const visibility=()=>setForeground(!document.hidden);
    if(Platform.OS==='web'&&typeof document!=='undefined')document.addEventListener('visibilitychange',visibility);
    return()=>{mounted=false;motion.remove();state.remove();if(Platform.OS==='web'&&typeof document!=='undefined')document.removeEventListener('visibilitychange',visibility);};
  },[]);
  React.useEffect(()=>{
    pulse.setValue(0);
    if(!active||reduceMotion||!foreground)return;
    const animation=Animated.loop(Animated.sequence([
      Animated.timing(pulse,{toValue:1,duration:1800,easing:Easing.inOut(Easing.sin),useNativeDriver:true,isInteraction:false}),
      Animated.timing(pulse,{toValue:0,duration:1800,easing:Easing.inOut(Easing.sin),useNativeDriver:true,isInteraction:false}),
    ]));
    animation.start();
    return()=>{animation.stop();pulse.stopAnimation();};
  },[active,foreground,pulse,reduceMotion]);
  if(!active)return null;
  return <View testID="w01-living-ring" pointerEvents="none" accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{width:112,height:112,alignSelf:'center',alignItems:'center',justifyContent:'center',marginVertical:8}}>
    <Animated.View style={{position:'absolute',width:108,height:108,borderRadius:54,borderWidth:2,
      borderColor:color,opacity:pulse.interpolate({inputRange:[0,1],outputRange:[0.35,0.65]}),
      transform:[{scale:pulse.interpolate({inputRange:[0,1],outputRange:[0.96,1.04]})}]}}/>
    <View style={{width:80,height:80,borderRadius:40,borderWidth:2,borderColor:color,opacity:0.9}}/>
  </View>;
}
