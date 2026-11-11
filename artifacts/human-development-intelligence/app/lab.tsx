import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { ActionButton, Card, Header, Pill, Screen, styles as ui } from '@/components/UI';
import { useColors } from '@/hooks/useColors';
import { useDevelopment, validationTests } from '@/context/DevelopmentContext';

export default function LabScreen() {
  if (!__DEV__) return <Redirect href="/" />;
  return <DevelopmentLab />;
}

function DevelopmentLab() {
  const colors = useColors();
  const { state, runValidation, resetLocalState, persistenceStatus, persistenceError } = useDevelopment();
  const passedCount = validationTests.filter((test) => state.validationLog[test.id]).length;
  const allPass = state.validationRun && passedCount === validationTests.length;
  return (
    <Screen>
      <Pressable testID="lab-back" onPress={() => router.back()} style={styles.back}><Feather name="arrow-left" size={18} color={colors.primary} /><Text style={[styles.backText, { color: colors.primary }]}>Quyền riêng tư</Text></Pressable>
      <Header eyebrow="PROTOTYPE LAB" title="Local validation log" subtitle="Deterministic scenario logic · Gate 7 hiện hành · không có dữ liệu người thật." icon="tool" />
      <Card accent>
        <Pill tone={allPass ? 'green' : state.validationRun ? 'red' : 'copper'}>
          {allPass ? '17 / 17 PASS' : state.validationRun ? `${passedCount} / 17 · FAIL` : 'READY TO RUN'}
        </Pill>
        <Text style={[ui.title, styles.labHeading, { color: colors.foreground }]}>D0 → D8 · P0 → P5</Text>
        <Text style={[ui.subtitle, { color: colors.mutedForeground }]}>Validation log ghi nhận đúng các boundary: user agency, reversibility, developmental fading và high-stakes safety.</Text>
        <ActionButton label={state.validationRun ? 'Chạy lại 17 tests' : 'Chạy 17 acceptance tests'} onPress={runValidation} icon="play" />
        <ActionButton label="Xóa local state" onPress={() => { void resetLocalState(); }} secondary icon="trash-2" />
        <Text style={[styles.status, { color: persistenceStatus === 'error' ? colors.destructive : colors.mutedForeground }]}>{persistenceError ?? `Persistence: ${persistenceStatus.toUpperCase()}`}</Text>
      </Card>
      {validationTests.map((test, index) => (
        <View key={test.id} style={[styles.testRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.testId, { color: colors.primary }]}>{test.id}</Text>
          <Text style={[styles.testTitle, { color: colors.foreground }]}>{test.title}</Text>
          <Feather name={state.validationLog[test.id] ? 'check-circle' : 'circle'} size={17} color={state.validationLog[test.id] ? colors.accentForeground : colors.mutedForeground} />
        </View>
      ))}
      <Text style={[styles.footer, { color: colors.mutedForeground }]}>Log này là local demo instrumentation. Không phải chứng nhận lâm sàng hay pháp lý.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 16, paddingBottom: 4 },
  backText: { fontSize: 13, fontWeight: '700' },
  labHeading: { fontSize: 22, marginTop: 15 },
  testRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, gap: 10 },
  testId: { width: 28, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  testTitle: { flex: 1, fontSize: 12, lineHeight: 17 },
  footer: { fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 20, paddingHorizontal: 15 },
  status: { fontSize: 11, lineHeight: 16, marginTop: 10 },
});