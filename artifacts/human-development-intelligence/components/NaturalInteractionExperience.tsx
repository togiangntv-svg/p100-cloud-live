import { Feather } from '@expo/vector-icons';
import React, { useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionButton, BrandLogo, Card, SectionLabel, styles as ui } from '@/components/UI';
import { CoachingExperience } from '@/components/CoachingExperience';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useCoaching } from '@/context/CoachingContext';
import { useInteraction } from '@/context/InteractionContext';
import { useLocale } from '@/context/LocalizationContext';
import { getAiSendingStatus } from '@/domain/interaction';
import { useColors } from '@/hooks/useColors';

type ComposerMode = 'conversation' | 'goal' | 'correction';

export function NaturalInteractionExperience() {
  const interaction = useInteraction();
  const coaching = useCoaching();
  return <NaturalInteractionEditor key={`${interaction.projectionRevision}:${coaching.projectionRevision}`} />;
}

function NaturalInteractionEditor() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, locale } = useLocale();
  const coaching = useCoaching();
  const interaction = useInteraction();
  const inputRef = useRef<TextInput>(null);
  const [composerMode, setComposerMode] = useState<ComposerMode>('conversation');
  const [message, setMessage] = useState('');
  const [goal, setGoal] = useState('');
  const [action, setAction] = useState('');
  const [correction, setCorrection] = useState('');
  const [outcome, setOutcome] = useState('');

  const legacyJourney = interaction.state.messages.length === 0 && coaching.state.status !== 'idle';
  const activePlan = interaction.state.goal;
  const latestUnderstanding = useMemo(
    () => [...interaction.state.understandings].reverse().find((item) => item.revokedAt === null),
    [interaction.state.understandings],
  );
  const aiSendingStatus = getAiSendingStatus(interaction.state);
  const composerBottomInset = Platform.OS === 'web' ? 92 : Math.max(insets.bottom, 12);
  const historyTopInset = Platform.OS === 'web' ? 67 : Math.max(insets.top + 8, 16);
  const inputStyle = [
    styles.input,
    { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card },
  ];
  const surfaceTextColor = colors.welcomeText;
  const surfaceMutedColor = colors.welcomeMuted;

  if (interaction.unreadableDataPreserved) {
    return (
      <Card accent>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('interactionUnreadableTitle')}</Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground, marginTop: 8 }]}>
          {t('interactionUnreadableBody')}
        </Text>
      </Card>
    );
  }

  if (legacyJourney) return <CoachingExperience />;

  const sendMessage = async () => {
    if (!await interaction.addUserMessage(message, locale)) return;
    setMessage('');
    inputRef.current?.focus();
  };

  const savePlan = () => {
    if (!interaction.saveGoal(goal, action)) return;
    coaching.selectStandardPractice(action.trim());
    setGoal('');
    setAction('');
    setComposerMode('conversation');
  };

  const saveCorrection = () => {
    if (!interaction.saveCorrection(correction)) return;
    setCorrection('');
    setComposerMode('conversation');
  };

  if (activePlan && coaching.state.status === 'standard_practice') {
    return (
      <>
        <SectionLabel>{t('interactionCurrentPlan')}</SectionLabel>
        <Card accent>
          <Text style={[styles.title, { color: colors.foreground }]}>{activePlan.text}</Text>
          <Text style={[styles.planAction, { color: colors.primary }]}>{activePlan.action}</Text>
          <Text style={[ui.subtitle, { color: colors.mutedForeground, marginTop: 10 }]}>
            {t('interactionNoAssumedProgress')}
          </Text>
          <ActionButton label={t('interactionRecordResult')} onPress={coaching.returnFromStandardPractice} icon="check" testID="natural-plan-return" />
          <ActionButton label={t('interactionPause')} onPress={coaching.pause} secondary icon="pause" testID="natural-plan-pause" />
          <ActionButton label={t('interactionCorrect')} onPress={() => setComposerMode('correction')} secondary icon="edit-2" testID="natural-plan-correct" />
          <ActionButton label={t('interactionStop')} onPress={coaching.stop} secondary icon="x-circle" testID="natural-plan-stop" />
        </Card>
        {composerMode === 'correction' ? (
          <CorrectionComposer
            value={correction}
            onChange={setCorrection}
            onSave={saveCorrection}
            onCancel={() => setComposerMode('conversation')}
          />
        ) : null}
      </>
    );
  }

  if (activePlan && coaching.state.status === 'standard_return') {
    return (
      <Card accent>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('interactionOutcomeTitle')}</Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground, marginTop: 8 }]}>
          {t('interactionOutcomeBody')}
        </Text>
        <TextInput
          style={inputStyle}
          value={outcome}
          onChangeText={setOutcome}
          multiline
          maxLength={1000}
          placeholder={t('interactionOutcomePlaceholder')}
          placeholderTextColor={colors.mutedForeground}
          testID="natural-outcome-input"
        />
        <ActionButton
          label={t('interactionSaveOutcome')}
          onPress={() => {
            coaching.submitStandardReturn(outcome, false);
            setOutcome('');
          }}
          disabled={!outcome.trim()}
          testID="natural-outcome-save"
        />
        <ActionButton
          label={t('interactionDidNotDo')}
          onPress={() => coaching.submitStandardReturn('', true)}
          secondary
          testID="natural-outcome-not-done"
        />
      </Card>
    );
  }

  if (activePlan && coaching.state.status === 'paused') {
    return (
      <Card>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('interactionPausedTitle')}</Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground, marginTop: 8 }]}>{activePlan.action}</Text>
        <ActionButton label={t('continue')} onPress={coaching.resume} icon="play" testID="natural-plan-resume" />
        <ActionButton label={t('interactionStop')} onPress={coaching.stop} secondary icon="x-circle" />
      </Card>
    );
  }

  if (activePlan && coaching.state.status === 'completed') {
    const didNotDo = coaching.state.standardDidNotDoIt;
    return (
      <Card accent>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('interactionRecordedTitle')}</Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground, marginTop: 8 }]}>
          {didNotDo ? t('interactionRecordedNotDone') : t('interactionRecordedNeutral')}
        </Text>
        {coaching.state.standardReturnMaterial ? (
          <Text style={[styles.outcome, { color: colors.foreground }]}>{coaching.state.standardReturnMaterial}</Text>
        ) : null}
        <ActionButton
          label={t('interactionNewConversation')}
          onPress={coaching.reset}
          secondary
          icon="message-circle"
          testID="natural-new-conversation"
        />
      </Card>
    );
  }

  const isFirstTurn = interaction.state.messages.length === 0;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {composerMode === 'goal' ? (
        <KeyboardAwareScrollViewCompat contentContainerStyle={[styles.editorContent, { paddingTop: historyTopInset }]}>
          <Card accent>
          <Text style={[styles.title, { color: colors.foreground }]}>{t('interactionGoalTitle')}</Text>
          <Text style={[ui.subtitle, { color: colors.mutedForeground, marginTop: 8 }]}>{t('interactionGoalBody')}</Text>
          <TextInput
            style={inputStyle}
            value={goal}
            onChangeText={setGoal}
            multiline
            maxLength={1000}
            placeholder={t('interactionGoalPlaceholder')}
            placeholderTextColor={colors.mutedForeground}
            testID="natural-goal-input"
          />
          <TextInput
            style={inputStyle}
            value={action}
            onChangeText={setAction}
            multiline
            maxLength={1000}
            placeholder={t('interactionActionPlaceholder')}
            placeholderTextColor={colors.mutedForeground}
            testID="natural-action-input"
          />
          <ActionButton label={t('interactionUseMyPlan')} onPress={savePlan} disabled={!goal.trim() || !action.trim()} testID="natural-plan-save" />
          <ActionButton label={t('cancel')} onPress={() => setComposerMode('conversation')} secondary />
          </Card>
        </KeyboardAwareScrollViewCompat>
      ) : composerMode === 'correction' ? (
        <KeyboardAwareScrollViewCompat contentContainerStyle={[styles.editorContent, { paddingTop: historyTopInset }]}>
          <CorrectionComposer
            value={correction}
            onChange={setCorrection}
            onSave={saveCorrection}
            onCancel={() => setComposerMode('conversation')}
          />
        </KeyboardAwareScrollViewCompat>
      ) : (
        <>
          <KeyboardAwareScrollViewCompat
            style={styles.historyScroll}
            contentContainerStyle={[styles.historyContent, { paddingTop: historyTopInset }]}
            keyboardDismissMode="on-drag"
          >
            {isFirstTurn ? (
              <View style={styles.opening}>
                <View style={styles.brand}>
                  <BrandLogo size={42} />
                  <View style={[styles.brandRule, { backgroundColor: colors.brandGold }]} />
                </View>
                <Text
                  accessibilityRole="header"
                  allowFontScaling
                  style={[styles.openingLine, { color: surfaceTextColor }]}
                >
                  {t('interactionOpening')}
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.historyHeader}>
                  <BrandLogo size={34} />
                  <View style={styles.historyHeaderCopy}>
                  <Text style={[styles.historyTitle, { color: surfaceTextColor }]}>{t('interactionHistory')}</Text>
                  <Text style={[styles.historyMeta, { color: surfaceMutedColor }]}>{t('interactionLocalOnly')}</Text>
                  </View>
                </View>
                {interaction.state.messages.map((item) => (
                  <View
                    key={item.id}
                    style={[
                      styles.message,
                      item.role === 'user' ? styles.userMessage : styles.assistantMessage,
                      { backgroundColor: item.role === 'user' ? colors.secondary : colors.card, borderColor: colors.border },
                    ]}
                  >
                    <Text style={[styles.messageText, { color: colors.foreground }]}>{item.text}</Text>
                    <Text style={[styles.messageMeta, { color: colors.mutedForeground }]}>
                      {item.provenance === 'AI_EXTERNAL' ? t('interactionExternalAi') : t('interactionYouSaid')}
                    </Text>
                  </View>
                ))}
                <Card>
                  <Text style={[styles.noticeTitle, { color: colors.foreground }]}>
                    {aiSendingStatus === 'stopped'
                      ? t('interactionAiStoppedTitle')
                      : interaction.state.aiAvailability === 'quota_exhausted'
                        ? t('interactionAiQuotaTitle')
                        : interaction.state.aiAvailability === 'offline'
                          ? t('interactionAiFallbackTitle')
                          : aiSendingStatus === 'enabled'
                            ? t('interactionAiOnTitle')
                            : t('interactionAiOffTitle')}
                  </Text>
                  <Text style={[ui.subtitle, { color: colors.mutedForeground, marginTop: 6 }]}>
                    {aiSendingStatus === 'stopped'
                      ? t('interactionAiStoppedBody')
                      : interaction.state.aiAvailability === 'quota_exhausted'
                        ? t('interactionAiQuotaBody')
                        : interaction.state.aiAvailability === 'offline'
                          ? t('interactionAiFallbackBody')
                          : aiSendingStatus === 'enabled'
                            ? t('interactionAiOnBody')
                            : t('interactionAiOffBody')}
                  </Text>
                  {interaction.state.aiConsent !== 'granted'
                    && interaction.state.aiAvailability === 'not_connected' ? (
                      <ActionButton
                        label={t('interactionEnableAi')}
                        onPress={() => void interaction.enableAiPilot(locale)}
                        disabled={interaction.aiBusy}
                        icon="shield"
                        testID="natural-enable-ai"
                      />
                    ) : null}
                </Card>
                {latestUnderstanding ? (
                <Text style={[styles.latestUnderstanding, { color: surfaceMutedColor }]}>
                    {t('interactionLatestUnderstanding', { text: latestUnderstanding.text })}
                  </Text>
                ) : null}
              </>
            )}
          </KeyboardAwareScrollViewCompat>
          <View
            style={[
              styles.composerDock,
              {
                backgroundColor: colors.welcomeNavy,
                borderTopColor: colors.welcomeBorder,
                paddingBottom: composerBottomInset,
              },
            ]}
          >
            <View style={[styles.composer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <TextInput
                ref={inputRef}
                style={[styles.composerInput, { color: colors.foreground }]}
                value={message}
                onChangeText={setMessage}
                multiline
                maxLength={2000}
                placeholder={t('interactionPlaceholder')}
                placeholderTextColor={colors.mutedForeground}
                accessibilityLabel={t('interactionPlaceholder')}
                testID="natural-message-input"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('interactionSend')}
                testID="natural-message-send"
                disabled={!message.trim() || interaction.aiBusy}
                onPress={() => void sendMessage()}
                style={({ pressed }) => [
                  styles.send,
                  { opacity: !message.trim() || interaction.aiBusy ? 0.32 : pressed ? 0.6 : 1 },
                ]}
              >
                <Feather name="arrow-up-circle" size={32} color={colors.primary} />
              </Pressable>
            </View>
            {!isFirstTurn ? (
              <View style={styles.suggestions}>
                <ActionButton label={t('interactionChooseChange')} onPress={() => setComposerMode('goal')} secondary testID="natural-open-plan" />
                <ActionButton label={t('interactionCorrect')} onPress={() => setComposerMode('correction')} secondary testID="natural-open-correction" />
                {interaction.state.aiConsent !== 'declined' ? (
                  <ActionButton
                    label={t('interactionKeepLocal')}
                    onPress={() => interaction.setAiConsent('declined')}
                    secondary
                    testID="natural-decline-ai"
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

function CorrectionComposer({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const { t } = useLocale();
  return (
    <Card accent>
      <Text style={[styles.title, { color: colors.foreground }]}>{t('correctionTitle')}</Text>
      <Text style={[ui.subtitle, { color: colors.mutedForeground, marginTop: 8 }]}>{t('interactionCorrectionBody')}</Text>
      <TextInput
        style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
        value={value}
        onChangeText={onChange}
        multiline
        maxLength={1000}
        placeholder={t('correctionPlaceholder')}
        placeholderTextColor={colors.mutedForeground}
        testID="natural-correction-input"
      />
      <ActionButton label={t('save')} onPress={onSave} disabled={!value.trim()} testID="natural-correction-save" />
      <ActionButton label={t('cancel')} onPress={onCancel} secondary />
    </Card>
  );
}

const displayFont = Platform.select({ ios: 'Georgia', android: 'serif', web: 'Georgia' });

const styles = StyleSheet.create({
  root: { flex: 1 },
  historyScroll: { flex: 1 },
  historyContent: { flexGrow: 1, paddingHorizontal: 0, paddingBottom: 16 },
  editorContent: { flexGrow: 1, paddingBottom: 20 },
  opening: { flexGrow: 1, paddingBottom: 8 },
  brand: { alignSelf: 'flex-start', marginBottom: 20 },
  brandRule: { width: 22, height: 2, borderRadius: 1, marginTop: 5 },
  openingLine: { fontSize: 28, lineHeight: 38, fontWeight: '600', letterSpacing: -0.5, fontFamily: displayFont, maxWidth: 340 },
  historyHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  historyHeaderCopy: { flex: 1 },
  historyTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  historyMeta: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  message: { borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 10, maxWidth: '92%' },
  userMessage: { alignSelf: 'flex-end' },
  assistantMessage: { alignSelf: 'flex-start' },
  messageText: { fontSize: 16, lineHeight: 23 },
  messageMeta: { fontSize: 10, lineHeight: 14, marginTop: 7 },
  noticeTitle: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
  latestUnderstanding: { fontSize: 12, lineHeight: 18, marginBottom: 12 },
  composerDock: { borderTopWidth: 1, paddingTop: 10 },
  composer: { borderWidth: 1, borderRadius: 20, minHeight: 78, flexDirection: 'row', alignItems: 'flex-end', padding: 12 },
  composerInput: { flex: 1, minHeight: 74, maxHeight: 180, fontSize: 16, lineHeight: 23, padding: 4, textAlignVertical: 'top' },
  send: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  suggestions: { marginTop: 2 },
  input: { borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 14, minHeight: 92, fontSize: 16, lineHeight: 23, textAlignVertical: 'top' },
  title: { fontSize: 24, lineHeight: 31, fontWeight: '700' },
  planAction: { fontSize: 17, lineHeight: 24, fontWeight: '700', marginTop: 14 },
  outcome: { fontSize: 16, lineHeight: 23, marginTop: 14 },
});
