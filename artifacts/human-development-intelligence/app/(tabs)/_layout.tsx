import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useLocale } from '@/context/LocalizationContext';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';

function NativeTabLayout() {
  const { t } = useLocale();
  const tabs = [
    { name: 'index', label: t('today'), icon: 'sun' as const, sfDefault: 'sun.max' as const, sfSelected: 'sun.max.fill' as const },
    { name: 'understand', label: t('understand'), icon: 'user' as const, sfDefault: 'person' as const, sfSelected: 'person.fill' as const },
    { name: 'privacy', label: t('settings'), icon: 'settings' as const, sfDefault: 'gearshape' as const, sfSelected: 'gearshape' as const },
  ] as const;

  return (
    <NativeTabs>
      {tabs.map((tab) => (
        <NativeTabs.Trigger key={tab.name} name={tab.name}>
          <NativeTabs.Trigger.Icon sf={{ default: tab.sfDefault, selected: tab.sfSelected }} />
          <NativeTabs.Trigger.Label>{tab.label}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const { t } = useLocale();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const tabs = [
    { name: 'index', label: t('today'), icon: 'sun' as const },
    { name: 'understand', label: t('understand'), icon: 'user' as const },
    { name: 'privacy', label: t('settings'), icon: 'settings' as const },
  ] as const;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={100} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
          ) : null,
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.label,
            tabBarActiveTintColor: tab.name === 'privacy' ? colors.mutedForeground : colors.primary,
            tabBarIcon: ({ color }) => (
              <Feather name={tab.icon} size={tab.name === 'privacy' ? 17 : 19} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

export default function TabLayout() {
  return isLiquidGlassAvailable() ? <NativeTabLayout /> : <ClassicTabLayout />;
}