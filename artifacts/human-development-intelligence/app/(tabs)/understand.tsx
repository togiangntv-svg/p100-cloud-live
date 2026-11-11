import React, { useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { ActionButton, Card, Header, Screen, styles as ui } from '@/components/UI';
import { useColors } from '@/hooks/useColors';
import { useLocale } from '@/context/LocalizationContext';
import { useDevelopment } from '@/context/DevelopmentContext';
import { classifyHighStakesText, MAX_CORRECTION_LENGTH } from '@/domain/gate7';

export default function UnderstandScreen() {
  const colors = useColors();
  const { t, locale } = useLocale();
  const { state, correctInference } = useDevelopment();
  const [draft, setDraft] = useState(state.inferenceCorrection ?? '');
  const highStakes = classifyHighStakesText(draft);
  const inferred = state.inferenceCorrection ? t('reflectionActive') : t('reflectionDefault');

  const saveCorrection = () => {
    const fallback = locale === 'vi' ? 'Tôi chưa chắc điều này đúng với mình hôm nay.' : 'I am not sure this is right for me today.';
    correctInference(draft.trim() || fallback);
  };

  return (
    <Screen>
      <Header eyebrow="100" title={t('understand')} subtitle={t('correctionBody')} icon="user" />
      <Card accent>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('reflectionTitle')}</Text>
        <Text style={[ui.title, styles.inference, { color: colors.foreground }]}>{inferred}</Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground }]}>{t('usefulWithoutBody')}</Text>
      </Card>
      <Card>
        <Text style={[styles.prompt, { color: colors.foreground }]}>{t('correctionPrompt')}</Text>
        <TextInput
          testID="inference-correction-input"
          value={draft}
          onChangeText={setDraft}
          maxLength={MAX_CORRECTION_LENGTH}
          placeholder={t('correctionPlaceholder')}
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
        />
        {highStakes ? <Text style={[styles.warning, { color: colors.destructive }]}>{t('highStakes')}</Text> : null}
        <ActionButton label={t('save')} onPress={saveCorrection} icon="edit-3" />
        {state.inferenceCorrection ? <Text style={[styles.saved, { color: colors.primary }]}>{t('correctionSaved')}</Text> : null}
      </Card>
      <Card>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('notTrue')}</Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground }]}>{t('usefulWithout')}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 14, fontWeight: '700' },
  inference: { fontSize: 21, lineHeight: 28, marginTop: 14 },
  prompt: { fontSize: 14, fontWeight: '700', marginBottom: 12 },
  input: { minHeight: 92, borderWidth: 1, borderRadius: 14, padding: 13, fontSize: 14, lineHeight: 20, textAlignVertical: 'top' },
  warning: { fontSize: 13, lineHeight: 19, fontWeight: '600', marginBottom: 10 },
  saved: { fontSize: 12, lineHeight: 18, marginTop: 10, fontWeight: '600' },
});