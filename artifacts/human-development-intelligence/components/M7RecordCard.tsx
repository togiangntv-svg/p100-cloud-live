import type { M7ArchiveSnapshot } from '@/domain/m7/store';
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ReleaseLocale } from '@/i18n-opening';
import { M7_RECORD_COPY, M7_FEEDBACK_COPY, M7_ARCHIVE_COPY } from '@/i18n-m7-record';
import type { M7RecordDraft, M7RecordPresentation } from './m7-record-controller';

type ChoiceField = 'execution_extent' | 'action_change' | 'user_stopped'
  | 'problem_report' | 'constraint';
type Option<K extends ChoiceField> = readonly [NonNullable<M7RecordDraft[K]>, string];

/** The card only sends explicit user choices to the host's semantic callbacks. */
export function M7RecordCard({ presentation, locale, color, border }: Readonly<{
  presentation: M7RecordPresentation; locale: ReleaseLocale; color: string; border: string;
}>) {
  const view = presentation.forLocale(locale);
  const copy = M7_RECORD_COPY[locale];
  const feedbackCopy = M7_FEEDBACK_COPY[locale];
  const historyCopy=M7_ARCHIVE_COPY[locale];
  const reflectionTitle = {vi:'Lắng đọng cuối buổi',en:'A moment to reflect','zh-Hans':'结束后的片刻回顾',es:'Un momento para reflexionar',hi:'अंत में कुछ पल मनन',ja:'終わりの振り返り',ko:'마무리하며 돌아보기',ru:'Минута для размышлений'}[locale];
  const localNotice=view.persistence==='SAVED'?historyCopy.saved:view.persistence==='SAVING'?historyCopy.saving:view.persistence==='ERROR'?historyCopy.saveError:copy.localOnly;
  const button = (id: string, label: string, onPress: () => unknown, selected = false) =>
    <Pressable key={id} testID={`m7-record-${id}`} accessibilityRole="button"
      accessibilityState={{ selected }} onPress={onPress}
      style={[styles.button, { borderColor: border }]}>
      <Text style={{ color }}>{selected ? '● ' : ''}{label}</Text>
    </Pressable>;
  const row = <K extends ChoiceField,>(label: string, field: K,
    options: readonly Option<K>[]) =>
    <View style={styles.group}><Text style={{ color }}>{label}</Text>
      <View style={styles.options}>{options.map(([value, text]) =>
        button(`${field}-${String(value)}`, text, () => view.choose(field, value),
          view.draft[field] === value))}</View></View>;
  if (view.state === 'UNAVAILABLE') return <View testID="m7-record-unavailable">
    <Text style={{ color }}>{copy.unavailable}</Text>
  </View>;
  if (view.state === 'DELETED') {
    if (!view.feedback && view.feedbackState === 'DELETED') return <View testID="m7-record-deleted">
      <Text style={{ color }}>{view.notice ? feedbackCopy[view.notice] : copy.deleted}</Text>
      <Text style={[styles.badge, { color, borderColor: border }]}>{localNotice}</Text>
    </View>;
  }
  const active = view.outcome?.state === 'ACTIVE' ? view.outcome : undefined;
  const showDraft = view.state === 'READY' || view.editing;
  return <View testID="m7-record-card" style={[styles.card, { borderColor: border }]}>
    <Text style={[styles.heading,{color}]}>{reflectionTitle}</Text>
    <Text testID="m7-report-status" style={{ color }}>{view.state === 'DELETED' ? feedbackCopy.deletedReport
      : view.state === 'RETRACTED' ? copy.retracted
      : active ? copy.recorded : copy.available}</Text>
    <Text style={{ color }}>{localNotice}</Text>
    {active && !view.editing ? <View testID="m7-record-current-report" style={[styles.reportSection,{borderColor:border}]}>
      <Text style={{ color }}>{copy.extent} {copy[active.outcome.execution_extent === 'DID' ? 'did'
        : active.outcome.execution_extent === 'PARTIAL' ? 'partial'
          : active.outcome.execution_extent === 'SKIPPED' ? 'skipped' : 'unknown']}</Text>
      <Text style={{ color }}>{copy.problem} {copy[active.outcome.problem_state === 'NO_PROBLEM_REPORTED'
        ? 'none' : active.outcome.problem_state === 'UNKNOWN' ? 'unknown'
          : active.outcome.safety_disposition === 'URGENT_HELP' ? 'urgent' : 'problemYes']}</Text>
      {active.outcome.performed_minutes !== undefined
        ? <Text style={{ color }}>{copy.minutes}: {active.outcome.performed_minutes}</Text> : null}
      {active.evidence_text ? <Text style={{ color }}>{active.evidence_text}</Text> : null}
    </View> : null}
    {showDraft ? <>
      {row(copy.extent, 'execution_extent', [['DID', copy.did], ['PARTIAL', copy.partial],
        ['SKIPPED', copy.skipped], ['UNKNOWN', copy.unknown]])}
      {row(copy.change, 'action_change', [['UNCHANGED', copy.unchanged],
        ['CHANGED', copy.changed], ['UNKNOWN', copy.unknown]])}
      {row(copy.stopped, 'user_stopped', [[true, copy.yes], [false, copy.no]])}
      {row(copy.problem, 'problem_report', [['NONE', copy.none],
        ['PROBLEM', copy.problemYes], ['URGENT', copy.urgent], ['UNKNOWN', copy.unknown]])}
      {row(copy.constraint, 'constraint', [['NONE_REPORTED', copy.none],
        ['TIME_CONSTRAINT', copy.time], ['OTHER_CONSTRAINT', copy.other], ['UNKNOWN', copy.unknown]])}
      <Text style={{ color }}>{copy.minutes}</Text>
      <TextInput testID="m7-record-minutes" keyboardType="numeric" value={view.draft.minutes_text}
        onChangeText={text => view.setMinutes(text)} style={[styles.input, { color, borderColor: border }]} />
      <Text style={{ color }}>{copy.note}</Text>
      <TextInput testID="m7-record-note" multiline value={view.draft.evidence_text}
        onChangeText={text => view.setEvidenceText(text)}
        style={[styles.input, { color, borderColor: border }]} />
      <View style={styles.options}>
        {view.canSubmit ? button('submit', copy.submit, () => view.submit()) : null}
        {button('cancel', copy.cancel, () => view.cancel())}
      </View>
    </> : null}
    {active && !view.editing ? <View style={styles.options}>
      {button('correct', copy.correct, () => view.beginCorrection())}
      {button('retract', copy.retract, () => view.requestRetraction())}
      {button('delete', copy.delete, () => view.requestDelete())}
    </View> : null}
    {view.state === 'RETRACTED' ? button('delete', copy.delete, () => view.requestDelete()) : null}
    <View testID="m7-feedback" style={[styles.group,styles.reportSection,{borderColor:border}]}>
      {view.notice ? <Text testID="m7-feedback-ack" style={{ color }}>{feedbackCopy[view.notice]}</Text> : null}
      {view.feedback && 'feedback' in view.feedback && view.feedback.feedback && !view.feedbackEditing
        ? <Text testID="m7-feedback-current" accessibilityLanguage={view.feedback.feedback.locale}
            style={{ color }}>{view.feedback.feedback.displayed_label}</Text> : null}
      {view.feedbackState === 'RETRACTED'
        ? <Text style={{ color }}>{feedbackCopy.retracted}</Text> : null}
      {view.feedbackState === 'DELETED'
        ? <Text style={{ color }}>{feedbackCopy.deletedFeedback}</Text> : null}
      {view.canFeedback || view.feedbackEditing ? <>
        <Text style={{ color }}>{feedbackCopy.prompt}</Text>
        <View style={styles.options}>
          {button('feedback-VERY_GOOD', feedbackCopy.veryGood, () => view.chooseFeedback('VERY_GOOD'), view.feedbackDraft?.experience === 'VERY_GOOD')}
          {button('feedback-FELT_MANAGEABLE', feedbackCopy.manageable, () => view.chooseFeedback('FELT_MANAGEABLE'), view.feedbackDraft?.experience === 'FELT_MANAGEABLE')}
          {button('feedback-FELT_TOO_MUCH', feedbackCopy.tooMuch, () => view.chooseFeedback('FELT_TOO_MUCH'), view.feedbackDraft?.experience === 'FELT_TOO_MUCH')}
          {button('feedback-PROBLEM_REPORTED', feedbackCopy.problem, () => view.chooseFeedback('PROBLEM_REPORTED'), view.feedbackDraft?.experience === 'PROBLEM_REPORTED')}
          {view.canSubmitFeedback ? button('feedback-submit', feedbackCopy.submit, () => view.submitFeedback()) : null}
          {view.feedbackDraft || view.feedbackEditing ? button('feedback-keep', feedbackCopy.keep, () => view.cancelFeedback()) : null}
        </View>
      </> : !view.feedback && view.feedbackState !== 'DELETED'
        ? <Text style={{ color }}>{feedbackCopy.unavailable}</Text> : null}
      {view.feedback?.state === 'ACTIVE' && !view.feedbackEditing ? <View style={styles.options}>
        {button('feedback-correct', feedbackCopy.correct, () => view.beginFeedbackCorrection())}
        {button('feedback-retract', feedbackCopy.retract, () => view.requestFeedbackRetraction())}
      </View> : null}
      {view.feedback ? button('feedback-delete', feedbackCopy.deleteFeedback, () => view.requestFeedbackDelete()) : null}
      {view.feedback && view.outcome && 'episode' in view.outcome
        ? button('delete-both', feedbackCopy.deleteBoth, () => view.requestDeleteBoth()) : null}
    </View>
    {view.confirming ? <View style={styles.group}>
      <Text style={{ color }}>{view.confirming === 'RETRACT' ? view.confirmingComponent === 'F' ? feedbackCopy.confirmRetraction : copy.confirmRetract
        : view.confirmingComponent === 'BOTH' ? feedbackCopy.confirmDeleteBoth
          : view.confirmingComponent === 'F' ? feedbackCopy.confirmDeleteFeedback : feedbackCopy.confirmDeleteReport}</Text>
      <View style={styles.options}>
        {button('confirm', view.confirmingComponent === 'F'
          ? view.confirming === 'RETRACT' ? feedbackCopy.retract : feedbackCopy.deleteFeedback
          : view.confirmingComponent === 'BOTH' ? feedbackCopy.deleteBoth : view.confirming === 'RETRACT' ? copy.retract : copy.delete,
          () => view.confirming === 'RETRACT' ? view.confirmRetraction() : view.confirmDelete())}
        {button('keep', feedbackCopy.keep, () => view.keep())}
      </View>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  badge: {alignSelf:'flex-start',borderWidth:1,borderRadius:14,paddingHorizontal:12,paddingVertical:8,fontSize:13,lineHeight:20,fontWeight:'600'},
  heading: {fontSize:21,lineHeight:28,fontWeight:'700'},
  reportSection: {borderWidth:1,borderRadius:16,padding:14,gap:8},
  card: { width: '100%', borderWidth: 1, borderRadius: 24, padding: 18, gap: 14 },
  group: { gap: 10, paddingVertical: 10 }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  button: { borderWidth: 1, borderRadius: 22, minHeight: 48, paddingHorizontal: 14, paddingVertical: 12 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 48 },
});

/** Historical DTO only: no live callbacks, permissions, task restoration or reuse toggle. */
export function M7CompletedReportCard({snapshot,locale,color,border}:Readonly<{snapshot:M7ArchiveSnapshot;locale:ReleaseLocale;color:string;border:string}>){
  const c=M7_ARCHIVE_COPY[locale],r=M7_RECORD_COPY[locale],f=M7_FEEDBACK_COPY[locale],report=snapshot.report;
  if(snapshot.phase==='ERROR')return <View testID="m7-history-error"><Text style={{color}}>{c.readError}</Text></View>;
  if(!report)return null;
  const outcome=report.R?.state==='ACTIVE'?report.R.outcome:undefined,feedback=report.F?.state==='ACTIVE'?report.F.feedback:undefined;
  return <View testID="m7-completed-history" style={[styles.card,{borderColor:border}]}>
    <Text style={[styles.heading,{color}]}>{c.title}</Text><Text style={{color}}>{c.readOnly}</Text><Text testID="m7-history-reuse-off" style={[styles.badge,{color,borderColor:border}]}>{c.reuseOff}</Text>
    {report.R?<View testID="m7-history-R" style={[styles.reportSection,{borderColor:border}]}><Text style={{color}}>{c.outcome}</Text>
      {outcome?<><Text style={{color}}>{r.extent}: {r[outcome.execution_extent==='DID'?'did':outcome.execution_extent==='PARTIAL'?'partial':outcome.execution_extent==='SKIPPED'?'skipped':'unknown']}</Text>
        <Text style={{color}}>{r.change}: {r[outcome.action_change==='UNCHANGED'?'unchanged':outcome.action_change==='CHANGED'?'changed':'unknown']}</Text>
        <Text style={{color}}>{r.stopped}: {outcome.user_stopped?r.yes:r.no}</Text>
        <Text style={{color}}>{r.problem}: {r[outcome.problem_state==='NO_PROBLEM_REPORTED'?'none':outcome.problem_state==='UNKNOWN'?'unknown':outcome.safety_disposition==='URGENT_HELP'?'urgent':'problemYes']}</Text>
        <Text style={{color}}>{r.constraint}: {r[outcome.constraint==='NONE_REPORTED'?'none':outcome.constraint==='TIME_CONSTRAINT'?'time':outcome.constraint==='OTHER_CONSTRAINT'?'other':'unknown']}</Text>
        {outcome.performed_minutes!==undefined?<Text style={{color}}>{r.minutes}: {outcome.performed_minutes}</Text>:null}
        {'evidence_text' in report.R&&report.R.evidence_text?<Text style={{color}}>{report.R.evidence_text}</Text>:null}</>:<Text style={{color}}>{r.retracted}</Text>}
    </View>:null}
    {report.F?<View testID="m7-history-F" style={[styles.reportSection,{borderColor:border}]}><Text style={{color}}>{c.feedback}</Text><Text style={{color}}>{feedback?f[feedback.experience==='VERY_GOOD'?'veryGood':feedback.experience==='FELT_MANAGEABLE'?'manageable':feedback.experience==='FELT_TOO_MUCH'?'tooMuch':'problem']:f.retracted}</Text></View>:null}
    <Text style={[styles.badge,{color,borderColor:border}]}>{snapshot.phase==='SAVING'?c.saving:c.saved}</Text>
  </View>;
}
