import React from 'react';
import { Feather } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton, Card, Pill, SectionLabel, styles as ui } from '@/components/UI';
import { Animated100Signature } from '@/components/Animated100Signature';
import { useColors } from '@/hooks/useColors';
import { useLocale } from '@/context/LocalizationContext';
import { useOpening } from '@/context/OpeningContext';
import { AppState } from '@/context/DevelopmentContext';
import { FocusArea, Need, OpeningPath, pathsFor } from '@/domain/opening';
import { TranslationKey } from '@/i18n';

type Props = {
  returning: boolean;
  appState: AppState;
  onContinue: () => void;
  onDifferentTopic: () => void;
  onChoosePath: (path: OpeningPath) => void;
  onSkip: () => void;
};

const focusKeys: Record<FocusArea, TranslationKey> = {
  work: 'openingWork',
  health: 'openingHealth',
  worry: 'openingWorry',
  other: 'openingOther',
};

const needKeys: Record<Need, TranslationKey> = {
  stuck: 'needStuck',
  overloaded: 'needOverloaded',
  depleted: 'needDepleted',
  ready: 'needReady',
  unclear: 'needUnclear',
};

const pathKeys: Record<OpeningPath, [TranslationKey, TranslationKey]> = {
  clarify: ['pathClarify', 'pathClarifyBody'],
  small_start: ['pathSmallStart', 'pathSmallStartBody'],
  reduce: ['pathReduce', 'pathReduceBody'],
  protect: ['pathProtect', 'pathProtectBody'],
  rest: ['pathRest', 'pathRestBody'],
  gentle: ['pathGentle', 'pathGentleBody'],
  outdoor: ['pathOutdoor', 'pathOutdoorBody'],
  indoor: ['pathIndoor', 'pathIndoorBody'],
  name_worry: ['pathNameWorry', 'pathNameWorryBody'],
  self: ['pathSelf', 'pathSelfBody'],
};

const focusIcons: Record<FocusArea, keyof typeof Feather.glyphMap> = {
  work: 'briefcase',
  health: 'activity',
  worry: 'cloud',
  other: 'compass',
};

const displayFont = Platform.select({ ios: 'Georgia', android: 'serif', web: 'Georgia' });

export function OpeningExperience({ returning, appState, onContinue, onDifferentTopic, onChoosePath, onSkip }: Props) {
  const colors = useColors();
  const { t } = useLocale();
  const opening = useOpening();

  if (returning) {
    const recorded = appState.outcomeRecorded;
    return (
      <Card accent>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t(recorded ? 'returnRecordedTitle' : 'returnInProgressTitle')}
        </Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground }]}>
          {t(recorded ? 'returnRecordedBody' : 'returnInProgressBody')}
        </Text>
        <View style={styles.actions}>
          <ActionButton testID="opening-continue" label={t('continue')} onPress={onContinue} icon="arrow-right" />
          <ActionButton testID="opening-different" label={t('differentTopic')} onPress={onDifferentTopic} secondary icon="refresh-cw" />
        </View>
      </Card>
    );
  }

  if (opening.state.status === 'new') {
    return (
      <View style={[styles.start, Platform.OS === 'web' && styles.webStart]}>
        <View style={styles.startBrand}>
          <Animated100Signature width={66} height={40} color={colors.foreground} />
          <View style={[styles.startBrandRule, { backgroundColor: colors.brandGold }]} />
        </View>
        <Text style={[styles.greeting, { color: colors.foreground, fontFamily: displayFont }]}>
          {t('todayGreeting')}
        </Text>
        <Text style={[styles.startQuestion, { color: colors.foreground }]}>
          {t('openingQuestion')}
        </Text>
        <View style={styles.focusList}>
          <FocusButton focus="work" />
          <FocusButton focus="health" />
          <FocusButton focus="worry" />
          <FocusButton focus="other" />
        </View>
        <Pressable
          accessibilityRole="button"
          testID="opening-skip"
          onPress={onSkip}
          style={({ pressed }) => [styles.explore, { opacity: pressed ? 0.62 : 1 }]}
        >
          <Text style={[styles.exploreText, { color: colors.primary }]}>{t('openingExplore')}</Text>
          <Feather name="arrow-right" size={16} color={colors.brandGold} />
        </Pressable>
        <Text style={[styles.demoNote, { color: colors.mutedForeground }]}>{t('openingDemoBody')}</Text>
      </View>
    );
  }

  if (!opening.state.focusArea || !opening.state.need) {
    return (
      <>
        <SummaryCard />
        <SectionLabel>{t('openingFollowUp')}</SectionLabel>
        <Card>
          {(['stuck', 'overloaded', 'ready', 'depleted', 'unclear'] as Need[]).map((need) => (
            <ActionButton key={need} testID={`opening-need-${need}`} label={t(needKeys[need])} onPress={() => opening.selectNeed(need)} secondary />
          ))}
          <ActionButton testID="opening-edit" label={t('openingEdit')} onPress={opening.editFocus} secondary icon="edit-3" />
        </Card>
      </>
    );
  }

  const paths = pathsFor(opening.state.focusArea, opening.state.need);
  return (
    <>
      <SummaryCard />
      {opening.state.focusArea === 'health' ? <HealthIllustration /> : null}
      <SectionLabel>{t('openingSummary')}</SectionLabel>
      <Card>
        <Text style={[ui.subtitle, { color: colors.mutedForeground }]}>{t('openingNext')}</Text>
        {paths.slice(0, 3).map((path) => (
          <View key={path} style={[styles.path, { borderColor: colors.border }]}>
            <View style={styles.pathCopy}>
              <Text style={[styles.pathTitle, { color: colors.foreground }]}>{t(pathKeys[path][0])}</Text>
              <Text style={[styles.pathBody, { color: colors.mutedForeground }]}>{t(pathKeys[path][1])}</Text>
            </View>
            <ActionButton testID={`opening-path-${path}`} label={t('openingChoose')} onPress={() => onChoosePath(path)} secondary />
          </View>
        ))}
        <ActionButton testID="opening-edit" label={t('openingEdit')} onPress={opening.editFocus} secondary icon="edit-3" />
        <ActionButton testID="opening-skip" label={t('openingSkip')} onPress={onSkip} secondary />
      </Card>
    </>
  );

  function FocusButton({ focus }: { focus: FocusArea }) {
    return (
      <Pressable
        accessibilityRole="button"
        testID={`opening-focus-${focus}`}
        onPress={() => opening.selectFocus(focus)}
        style={({ pressed }) => [
          styles.focusCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <View style={[styles.focusIcon, { backgroundColor: colors.brandGoldSoft }]}>
          <Feather name={focusIcons[focus]} size={20} color={colors.brandGold} />
        </View>
        <Text style={[styles.focusLabel, { color: colors.foreground }]}>{t(focusKeys[focus])}</Text>
        <Feather name="chevron-right" size={20} color={colors.brandGold} />
      </Pressable>
    );
  }

  function SummaryCard() {
    if (!opening.state.focusArea) return null;
    const focus = t(focusKeys[opening.state.focusArea]);
    const need = opening.state.need ? t(needKeys[opening.state.need]) : t('openingFollowUp');
    return (
      <Card accent>
        <Text style={[styles.summaryLabel, { color: colors.primary }]}>{t('openingSummary')}</Text>
        <Text style={[styles.summary, { color: colors.foreground }]}>{t('openingReflection', { focus, need })}</Text>
      </Card>
    );
  }

  function HealthIllustration() {
    return (
      <Card>
        <Pill tone="copper">{t('healthDemoLabel')}</Pill>
        <Text style={[ui.subtitle, { color: colors.mutedForeground }]}>{t('healthDemoBody')}</Text>
        {!opening.state.healthDemoHistory ? (
          <ActionButton testID="health-demo-enable" label={t('openingChoose')} onPress={() => opening.setHealthDemo(true)} secondary />
        ) : (
          <>
            <Text style={[styles.pathBody, { color: colors.foreground }]}>{t('healthHistoryPrompt')}</Text>
            <ActionButton testID="health-well" label={t('healthWell')} onPress={() => opening.setHealthResponse('well')} secondary />
            <ActionButton testID="health-different" label={t('healthDifferent')} onPress={() => opening.setHealthResponse('different')} secondary />
            <ActionButton testID="health-not-sure" label={t('healthNotSure')} onPress={() => opening.setHealthResponse('not_sure')} secondary />
            {opening.state.healthResponse ? <Text style={[styles.pathBody, { color: colors.primary }]}>{t('healthRespect')}</Text> : null}
          </>
        )}
      </Card>
    );
  }
}

const styles = StyleSheet.create({
  start: { paddingTop: 28, paddingBottom: 8 },
  webStart: { paddingTop: 67 },
  startBrand: { alignSelf: 'flex-start', marginBottom: 28 },
  startBrandRule: { width: 22, height: 2, borderRadius: 1, marginTop: 5 },
  greeting: { fontSize: 40, lineHeight: 47, fontWeight: '600', letterSpacing: -1.1 },
  startQuestion: { fontSize: 22, lineHeight: 30, fontWeight: '700', marginTop: 12, maxWidth: 340 },
  focusList: { gap: 12, marginTop: 28 },
  focusCard: {
    minHeight: 76,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  focusIcon: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  focusLabel: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  explore: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8 },
  exploreText: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
  demoNote: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 2, paddingHorizontal: 10 },
  title: { fontSize: 24, lineHeight: 31, fontWeight: '700', marginTop: 17 },
  summaryLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  summary: { fontSize: 18, lineHeight: 25, fontWeight: '700', marginTop: 11 },
  actions: { gap: 10, marginTop: 8 },
  path: { alignItems: 'stretch', borderWidth: 1, borderRadius: 16, padding: 15, marginTop: 12, gap: 3 },
  pathCopy: { flex: 1 },
  pathTitle: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
  pathBody: { fontSize: 13, lineHeight: 19, marginTop: 5 },
});