import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { TrainerJourneyPresentation } from '@/context/TrainerRuntimeContext';
import { trainerJourneyCopy, type TrainerJourneyKey } from '@/i18n-trainer-journey';
import { useColors } from '@/hooks/useColors';

type Props = Readonly<{
  journey: TrainerJourneyPresentation;
  locale: string;
}>;

export function TrainerJourneyCard({ journey, locale }: Props) {
  const colors = useColors();
  const copy = trainerJourneyCopy(locale);
  const { view, commands } = journey;
  if (view.state !== 'CURRENT' || !view.simulation) return null;
  const token = view.token;
  const action = view.action;
  const draft = view.draft;
  const urgentHelp = draft?.problem_state === 'PROBLEM'
    && draft.safety_disposition === 'URGENT_HELP'
    || view.outcome?.state === 'ACTIVE'
      && view.outcome.facts?.problem_state === 'PROBLEM'
      && view.outcome.facts.safety_disposition === 'URGENT_HELP';
  const draftComplete = Boolean(draft?.execution_extent && draft.user_stopped !== undefined
    && draft.action_change && draft.constraint
    && (draft.problem_state === 'NO_PROBLEM_REPORTED' && draft.safety_disposition === 'CLEAR'
      || draft.problem_state === 'PROBLEM'
        && ['REASSESS', 'URGENT_HELP'].includes(String(draft.safety_disposition))
      || draft.problem_state === 'UNKNOWN' && draft.safety_disposition === 'REASSESS'));
  const text = (key: TrainerJourneyKey) => copy[key];
  const button = (id: string, label: string, onPress: () => unknown, selected = false,
    disabled = false) => (
    <Pressable
      key={id}
      testID={id}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { borderColor: colors.welcomeGoalChipBorder,
          backgroundColor: selected || pressed ? colors.welcomeGoalChipSelected : colors.welcomeGoalChip,
          opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, { color: colors.welcomeText }]}>{label}</Text>
    </Pressable>
  );
  const choose = (id: string, label: string, patch: Parameters<typeof commands.updateOutcomeDraft>[1],
    selected = false) => button(id, label, () => commands.updateOutcomeDraft(token, patch), selected);
  const messageKey: Partial<Record<NonNullable<typeof view.message>, TrainerJourneyKey>> = {
    NOT_RECORDED: 'trainerJourney.record.notRecorded',
    RECORDED: 'trainerJourney.record.recorded',
    CORRECTED: 'trainerJourney.record.corrected',
    DELETED: 'trainerJourney.record.deleted',
    RETRACTED: 'trainerJourney.record.retracted',
    RECORD_REVOKED: 'trainerJourney.record.revoked',
    NEXT_CREATED: 'trainerJourney.next.created',
    DENIED: 'trainerJourney.next.denied',
  };

  return (
    <View
      testID="trainer-journey-card"
      style={[styles.card, { borderColor: colors.welcomeGoalPanelBorder,
        backgroundColor: colors.welcomeGoalHeaderSurface }]}
    >
      <Text testID="trainer-journey-fixture-badge" style={[styles.badge, { color: colors.welcomeText }]}>
        {text('trainerJourney.action.simulation')}
      </Text>
      <Text style={[styles.fixtureNote, { color: colors.welcomeText }]}>
        {text('trainerJourney.availability.fixtureOnly')}
      </Text>
      {view.action_availability !== 'AVAILABLE' ? (
        <View testID="trainer-journey-safety-hold" style={styles.section}>
          <Text style={[styles.warning, { color: colors.welcomeText }]}>
            {text('trainerJourney.safety.held')}
          </Text>
          {urgentHelp ? (
            <Text testID="trainer-journey-urgent-help" style={[styles.warning, { color: colors.welcomeText }]}>
              {text('trainerJourney.safety.urgentHelp')}
            </Text>
          ) : null}
          <Text style={{ color: colors.welcomeText }}>
            {text('trainerJourney.safety.cannotContinue')}
          </Text>
          <Text style={{ color: colors.welcomeText }}>
            {text('trainerJourney.safety.nextUnavailable')}
          </Text>
        </View>
      ) : null}

      {view.goal?.state === 'ACCEPTED' ? (
        <Text testID="trainer-journey-goal-accepted" style={{ color: colors.welcomeText }}>
          {text('trainerJourney.goal.accepted')}
        </Text>
      ) : null}

      {action ? (
        <View style={styles.section}>
          {view.action_availability === 'AVAILABLE' && !['STOPPED', 'CANCELLED', 'INVALIDATED'].includes(action.state) ? <>
            <Text testID="trainer-journey-action-title" style={[styles.title, { color: colors.welcomeText }]}>
              {text('trainerJourney.action.title').replace('{n}', String(action.duration_minutes))}
            </Text>
            <Text style={{ color: colors.welcomeText }}>{text('trainerJourney.action.instructions')}</Text>
            <Text style={[styles.warning, { color: colors.welcomeText }]}>
              {text('trainerJourney.safety.warning')}: {text('trainerJourney.action.warning')}
            </Text>
            <Text style={{ color: colors.welcomeText }}>{text('trainerJourney.action.why')}</Text>
          </> : null}
          {view.action_availability === 'AVAILABLE' && action.state === 'PROPOSED'
            ? button('trainer-journey-accept-action', text('trainerJourney.action.choose'),
              () => commands.acceptAction(token)) : null}
          {view.action_availability === 'AVAILABLE' && action.state === 'ACCEPTED'
            ? button('trainer-journey-start-action', text('trainerJourney.action.start'),
              () => commands.startAction(token)) : null}
          {action.has_started && action.state !== 'STOPPED'
            ? button('trainer-journey-stop-action', text('trainerJourney.action.stop'),
              () => commands.stopAction(token)) : null}
          {action.has_started && !view.outcome && !draft
            ? button('trainer-journey-open-outcome', text('trainerJourney.action.report'),
              () => commands.openOutcomeDraft(token)) : null}
        </View>
      ) : null}

      {draft ? (
        <View testID="trainer-journey-outcome-draft" style={styles.section}>
          <Text style={[styles.title, { color: colors.welcomeText }]}>
            {text('trainerJourney.outcome.title')}
          </Text>
          <View style={styles.row}>
            {choose('trainer-outcome-did', text('trainerJourney.outcome.did'),
              { execution_extent: 'DID' }, draft.execution_extent === 'DID')}
            {choose('trainer-outcome-partial', text('trainerJourney.outcome.partial'),
              { execution_extent: 'PARTIAL' }, draft.execution_extent === 'PARTIAL')}
            {choose('trainer-outcome-skipped', text('trainerJourney.outcome.skipped'),
              { execution_extent: 'SKIPPED' }, draft.execution_extent === 'SKIPPED')}
            {choose('trainer-outcome-unknown', text('trainerJourney.outcome.unknown'),
              { execution_extent: 'UNKNOWN' }, draft.execution_extent === 'UNKNOWN')}
          </View>
          <View style={styles.row}>
            {choose('trainer-outcome-stopped-yes', text('trainerJourney.outcome.stoppedYes'),
              { user_stopped: true }, draft.user_stopped === true)}
            {choose('trainer-outcome-stopped-no', text('trainerJourney.outcome.stoppedNo'),
              { user_stopped: false }, draft.user_stopped === false)}
          </View>
          <View style={styles.row}>
            {choose('trainer-outcome-problem-none', text('trainerJourney.outcome.problemNone'),
              { problem_state: 'NO_PROBLEM_REPORTED', safety_disposition: 'CLEAR' },
              draft.problem_state === 'NO_PROBLEM_REPORTED')}
            {choose('trainer-outcome-problem', text('trainerJourney.outcome.problem'),
              { problem_state: 'PROBLEM', safety_disposition: undefined }, draft.problem_state === 'PROBLEM')}
            {choose('trainer-outcome-problem-unknown', text('trainerJourney.outcome.problemUnknown'),
              { problem_state: 'UNKNOWN', safety_disposition: 'REASSESS' }, draft.problem_state === 'UNKNOWN')}
          </View>
          {draft.problem_state === 'PROBLEM' ? (
            <View style={styles.row}>
              {choose('trainer-outcome-reassess', text('trainerJourney.outcome.reassess'),
                { safety_disposition: 'REASSESS' }, draft.safety_disposition === 'REASSESS')}
              {choose('trainer-outcome-urgent', text('trainerJourney.outcome.urgent'),
                { safety_disposition: 'URGENT_HELP' }, draft.safety_disposition === 'URGENT_HELP')}
            </View>
          ) : null}
          <View style={styles.row}>
            {choose('trainer-outcome-unchanged', text('trainerJourney.outcome.unchanged'),
              { action_change: 'UNCHANGED' }, draft.action_change === 'UNCHANGED')}
            {choose('trainer-outcome-changed', text('trainerJourney.outcome.changed'),
              { action_change: 'CHANGED' }, draft.action_change === 'CHANGED')}
            {choose('trainer-outcome-action-unknown', text('trainerJourney.outcome.unknown'),
              { action_change: 'UNKNOWN' }, draft.action_change === 'UNKNOWN')}
          </View>
          <View style={styles.row}>
            {choose('trainer-outcome-constraint-none', text('trainerJourney.outcome.constraintNone'),
              { constraint: 'NONE_REPORTED' }, draft.constraint === 'NONE_REPORTED')}
            {choose('trainer-outcome-constraint-time', text('trainerJourney.outcome.constraintTime'),
              { constraint: 'TIME_CONSTRAINT' }, draft.constraint === 'TIME_CONSTRAINT')}
            {choose('trainer-outcome-constraint-other', text('trainerJourney.outcome.constraintOther'),
              { constraint: 'OTHER_CONSTRAINT' }, draft.constraint === 'OTHER_CONSTRAINT')}
            {choose('trainer-outcome-constraint-unknown', text('trainerJourney.outcome.unknown'),
              { constraint: 'UNKNOWN' }, draft.constraint === 'UNKNOWN')}
          </View>
          <View style={styles.row}>
            {button('trainer-outcome-record', text('trainerJourney.outcome.save'),
              () => commands.recordOutcome(token), false, !draftComplete)}
            {button('trainer-outcome-cancel', text('trainerJourney.outcome.cancel'),
              () => commands.discardOutcomeDraft(token))}
          </View>
        </View>
      ) : null}

      {view.outcome?.state === 'ACTIVE' && view.cycle === 'A' ? (
        <View style={styles.section}>
          <Text style={{ color: colors.welcomeText }}>
            {view.next_use === 'ON'
              ? text('trainerJourney.nextUse.on') : text('trainerJourney.nextUse.off')}
          </Text>
          {view.next_use === 'OFF'
            ? button('trainer-journey-allow-next', text('trainerJourney.nextUse.allow'),
              () => commands.allowNextUse(token))
            : button('trainer-journey-revoke-next', text('trainerJourney.nextUse.revoke'),
              () => commands.revokeNextUse(token))}
          {view.next.eligible
            ? button('trainer-journey-create-next', text('trainerJourney.next.view'),
              () => commands.createNextCycle(token)) : null}
        </View>
      ) : null}

      {view.history ? (
        <View testID="trainer-journey-history" style={styles.section}>
          {button('trainer-history-toggle', text('trainerJourney.history.title'),
            () => commands.toggleHistory(token), view.history.expanded)}
          {view.history.expanded && view.history.outcome?.state === 'ACTIVE' ? (
            <View style={styles.row}>
              {button('trainer-history-correct', text('trainerJourney.history.correct'),
                () => commands.openHistoryCorrection(token))}
              {button('trainer-history-retract', text('trainerJourney.history.retract'),
                () => commands.retractHistory(token))}
              {button('trainer-history-delete', text('trainerJourney.history.delete'),
                () => commands.deleteHistory(token))}
            </View>
          ) : null}
          {view.history.expanded && view.history.outcome?.state === 'RETRACTED'
            ? button('trainer-history-delete', text('trainerJourney.history.delete'),
              () => commands.deleteHistory(token)) : null}
          {view.history.expanded && view.history.next_use === 'ON'
            ? button('trainer-history-revoke-next', text('trainerJourney.nextUse.revoke'),
              () => commands.revokeNextUse(token)) : null}
          {view.history.expanded && view.history.outcome
            ? button('trainer-history-revoke-record', text('trainerJourney.history.revokeRecord'),
              () => commands.revokeHistoryRecord(token)) : null}
        </View>
      ) : null}

      {view.message && messageKey[view.message] ? (
        <Text testID="trainer-journey-message" accessibilityLiveRegion="polite"
          style={{ color: colors.welcomeText }}>
          {text(messageKey[view.message]!)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  badge: { fontSize: 11, lineHeight: 15, fontWeight: '800', letterSpacing: 0.7 },
  fixtureNote: { fontSize: 12, lineHeight: 17, opacity: 0.86 },
  section: { width: '100%', gap: 8 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  warning: { fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  button: { minHeight: 38, borderWidth: 1, borderRadius: 12, paddingHorizontal: 11,
    paddingVertical: 8, justifyContent: 'center' },
  buttonText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
});
