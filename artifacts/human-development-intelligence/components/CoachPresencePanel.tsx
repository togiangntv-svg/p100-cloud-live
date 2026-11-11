import React from 'react';
import {View,Text,Pressable,StyleSheet} from 'react-native';
import {coachPresenceCopy,type CoachLocale} from '../i18n-coach-presence';
import type {createCoachPresenceFlow,CoachFlowSnapshot} from './coach-presence-flow';
export function CoachPresencePanel({flow,model,locale}:{flow:ReturnType<typeof createCoachPresenceFlow>;model:CoachFlowSnapshot;locale:CoachLocale}){
 const c=coachPresenceCopy(locale);if(!model?.domain)return null;
 const button=(id:string,label:string,action:()=>unknown,disabled=false,interrupt=false)=><Pressable key={id} testID={'coach-'+id}
  accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:disabled||(!interrupt&&model.busy)}}
  disabled={disabled||(!interrupt&&model.busy)} onPress={()=>{void action();}}
  style={[styles.button, interrupt||id==='retake'?styles.secondary:styles.primary, (disabled||(!interrupt&&model.busy))&&styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
 return <View testID="coach-presence-panel" style={styles.card}>
  <View style={styles.header}><Text testID="coach-domain" style={styles.domain}>{c[model.domain as 'meal'|'exercise_form'|'physique_posture']}</Text>
  <Text style={styles.limits}>{c.limits}</Text></View>
  <View style={[styles.viewfinder, model.accepted&&styles.accepted]}>{model.previewHandle?React.createElement(model.previewHandle as React.ElementType,{accessibilityLabel:c[model.domain as 'meal'],style:{width:200,height:200}}):null}</View>
  {!model.hasPhoto?<>{button('take',c.take,()=>flow.take(model.token))}{button('choose',c.choose,()=>flow.choose(model.token))}</>:null}
  {model.hasPhoto&&!model.accepted?button('use',c.use,()=>flow.use(model.token)):null}
  {model.accepted&&!model.c1?button('c1',c.c1,()=>flow.allowC1(model.token)):null}
  {model.c1&&['C2_REQUIRED','BLOCKED'].includes(model.state)?button('c2',c.c2,()=>flow.allowC2(model.token)):null}
  {model.state==='READY_NOT_SENT'?<><Text style={styles.body}>{c.prepared}</Text>{button('analyze',c.analyze,()=>flow.analyze(model.token))}</>:null}
  {model.busy?<Text style={styles.body} accessibilityLiveRegion="polite">{c.busy}</Text>:null}
  {model.state==='BLOCKED'?<Text style={styles.body} accessibilityLiveRegion="polite">{c.blocked}</Text>:null}
  {model.state==='NEED_MORE_INFO'?<Text style={styles.body}>{c.needInfo}</Text>:null}
  {model.state==='PROPOSAL'?<View testID="coach-m5-proposal"><Text style={styles.body}>{c.proposal}</Text>
   {(model.proposal?.result.state==='OBSERVATIONS'?model.proposal.result.cues:[]).map((cue:string)=><Text key={cue} style={styles.body}>{c[cue as 'VISIBLE_FOOD']}</Text>)}
   {button('m5-choice',model.selected?c.selected:c.select,()=>flow.chooseProposal(model.token),model.selected)}</View>:null}
  <View style={styles.controls}>
  {model.hasPhoto?button('retake',c.retake,()=>flow.retake(model.token)):null}
  {button('cancel',c.cancel,()=>flow.cancel(model.token),false,true)}
  {model.c1?button('revoke',c.revoke,()=>flow.revoke(model.token),false,true):null}
  {model.hasPhoto?button('delete',c.delete,()=>flow.delete(model.token),false,true):null}
  </View>
  <Text style={styles.limits}>{c.deleteNotice}</Text>{model.cleanup?<Text style={styles.cleanup} accessibilityLiveRegion="polite">{c.cleanup}</Text>:null}
 </View>;
}

const styles=StyleSheet.create({
 card:{borderRadius:20,borderWidth:1,borderColor:"#718575",backgroundColor:"#101E1B",padding:16,gap:12},
 body:{color:"#FFF5E2",fontSize:14,lineHeight:22},header:{gap:6},domain:{color:"#FFF5E2",fontSize:19,lineHeight:26,fontWeight:"700"},limits:{color:"#D2DED7",fontSize:13,lineHeight:20},
 viewfinder:{width:200,height:200,maxWidth:"100%",alignSelf:"center",borderRadius:16,borderWidth:1,borderColor:"#718575",overflow:"hidden",backgroundColor:"rgba(255,245,226,0.04)"},accepted:{borderColor:"#8FE5BC",borderWidth:2},
 button:{minHeight:48,borderRadius:24,borderWidth:1,paddingHorizontal:16,paddingVertical:12,alignItems:"center",justifyContent:"center"},primary:{backgroundColor:"#225A47",borderColor:"#9DD4B4"},secondary:{backgroundColor:"#172923",borderColor:"#98B2A3",flexGrow:1,flexBasis:120},disabled:{opacity:0.55},buttonText:{color:"#FFF5E2",fontSize:15,lineHeight:22,fontWeight:"700",textAlign:"center"},controls:{flexDirection:"row",flexWrap:"wrap",gap:8},cleanup:{color:"#C3F5DC",backgroundColor:"#194631",borderRadius:12,padding:12,fontSize:13,lineHeight:20}
});
