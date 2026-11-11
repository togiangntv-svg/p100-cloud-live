import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { Screen } from '@/components/UI';
import { useCoaching } from '@/context/CoachingContext';
import { NaturalInteractionExperience } from '@/components/NaturalInteractionExperience';
import { useInteraction } from '@/context/InteractionContext';
import { useColors } from '@/hooks/useColors';

export default function TodayScreen() {
  const colors = useColors();
  const coaching = useCoaching();
  const interaction = useInteraction();

  return (
    <Screen scroll={false} backgroundColor={colors.welcomeNavy}>
      <StatusBar style="light" />
      {coaching.hydrated && interaction.hydrated ? <NaturalInteractionExperience /> : null}
    </Screen>
  );
}
