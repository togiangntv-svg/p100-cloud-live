import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Animated100Signature } from '@/components/Animated100Signature';

const founderLogo = require('../assets/images/icon.png');

export function BrandLogo({ size = 42, animated = true }: { size?: number; animated?: boolean }) {
  const colors = useColors();
  if (animated) {
    return <Animated100Signature width={size * 1.65} height={size} color={colors.primary} />;
  }
  return (
    <Image
      accessible
      accessibilityLabel="Logo 100"
      source={founderLogo}
      defaultSource={founderLogo}
      resizeMode="contain"
      fadeDuration={0}
      style={{ width: size, height: size, borderRadius: size * 0.26 }}
    />
  );
}

export function Screen({
  children,
  scroll = true,
  backgroundColor,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  backgroundColor?: string;
}) {
  const colors = useColors();
  const content = (
    <View style={[styles.screen, { backgroundColor: backgroundColor ?? colors.background }]}>
      {children}
    </View>
  );
  if (!scroll) return content;
  return (
    <KeyboardAwareScrollViewCompat
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      keyboardDismissMode="on-drag"
      bottomOffset={72}
    >
      {content}
    </KeyboardAwareScrollViewCompat>
  );
}

const displayFont = Platform.select({ ios: 'Georgia', android: 'serif', web: 'Georgia' });

export function Header({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string; icon?: keyof typeof Feather.glyphMap }) {
  const colors = useColors();
  return (
    <View style={[styles.header, Platform.OS === 'web' && styles.webHeader]}>
      <View style={styles.brandLockup}>
        {eyebrow === '100' ? (
          <BrandLogo />
        ) : (
          <Text style={[styles.brandText, { color: colors.primary }]}>{eyebrow}</Text>
        )}
        <View style={[styles.brandRule, { backgroundColor: colors.brandGold }]} />
      </View>
      <Text style={[styles.title, { color: colors.foreground, fontFamily: displayFont }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{children}</Text>;
}

export function Card({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  const colors = useColors();
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: accent ? colors.brandGold : colors.border }, accent && styles.accentCard]}>{children}</View>;
}

export function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'green' | 'copper' | 'red' }) {
  const colors = useColors();
  const toneColor = tone === 'green' ? colors.accentForeground : tone === 'copper' ? colors.primary : tone === 'red' ? colors.destructive : colors.mutedForeground;
  const toneBg = tone === 'green' ? colors.accent : tone === 'copper' ? colors.brandGoldSoft : tone === 'red' ? colors.destructiveSoft : colors.muted;
  return <View style={[styles.pill, { backgroundColor: toneBg }]}><Text style={[styles.pillText, { color: toneColor }]}>{children}</Text></View>;
}

export function ActionButton({ label, onPress, secondary = false, disabled = false, icon, testID }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean; icon?: keyof typeof Feather.glyphMap; testID?: string }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID ?? `action-${label}`}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: secondary ? colors.card : colors.primary,
          borderColor: secondary ? colors.border : colors.primary,
          opacity: disabled ? 0.45 : pressed ? 0.78 : 1,
        },
      ]}
    >
      {icon ? <Feather name={icon} size={16} color={secondary ? colors.secondaryForeground : colors.primaryForeground} /> : null}
      <Text style={[styles.buttonText, { color: secondary ? colors.secondaryForeground : colors.primaryForeground }]}>{label}</Text>
    </Pressable>
  );
}

export function Row({ icon, title, body, right }: { icon: keyof typeof Feather.glyphMap; title: string; body?: string; right?: React.ReactNode }) {
  const colors = useColors();
  return <View style={styles.row}><View style={[styles.rowIcon, { backgroundColor: colors.secondary }]}><Feather name={icon} size={16} color={colors.primary} /></View><View style={styles.rowCopy}><Text style={[styles.rowTitle, { color: colors.foreground }]}>{title}</Text>{body ? <Text style={[styles.rowBody, { color: colors.mutedForeground }]}>{body}</Text> : null}</View>{right}</View>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, width: '100%', paddingHorizontal: 20 },
  scrollContent: { flexGrow: 1, paddingBottom: 116 },
  header: { paddingTop: 28, paddingBottom: 28 },
  webHeader: { paddingTop: 67 },
  brandLockup: { alignSelf: 'flex-start', marginBottom: 20 },
  brandText: { fontSize: 17, lineHeight: 22, fontWeight: '800', letterSpacing: 1.2 },
  brandRule: { width: 22, height: 2, borderRadius: 1, marginTop: 5 },
  eyebrow: { fontSize: 11, fontWeight: '600', letterSpacing: 1.2, marginBottom: 8 },
  title: { fontSize: 34, lineHeight: 40, fontWeight: '600', letterSpacing: -0.9 },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 10, maxWidth: 340 },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase', marginTop: 12, marginBottom: 12 },
  card: { borderWidth: 1, borderRadius: 22, padding: 20, marginBottom: 14 },
  accentCard: { borderWidth: 1 },
  pill: { alignSelf: 'flex-start', borderRadius: 100, paddingHorizontal: 10, paddingVertical: 6 },
  pillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  button: { minHeight: 54, borderWidth: 1, borderRadius: 16, paddingHorizontal: 17, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14 },
  buttonText: { fontSize: 15, lineHeight: 21, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  rowIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1 },
  rowTitle: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
  rowBody: { fontSize: 13, lineHeight: 19, marginTop: 4 },
});