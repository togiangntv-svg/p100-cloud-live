export const WELCOME_STORAGE_KEY = '@100-human-development-welcome';
// Device presentation marker, never onboarding completion or person/goal evidence.
export const WELCOME_SEEN_VALUE = 'seen-v1';

export type WelcomeLaunchDecision = {
  showWelcome: boolean;
  resumeGoal: false;
};

export function resolveWelcomeLaunch(
  forceSlicePreviewOpening: boolean,
  deviceShouldShow: boolean,
  _ignoredLegacyResumeGoal?: boolean,
): WelcomeLaunchDecision {
  // Keep the old call shape compatible, but no legacy value can authorize resume.
  return {
    showWelcome: forceSlicePreviewOpening || deviceShouldShow,
    resumeGoal: false,
  };
}

export function resolveWelcomeInitialPhase(
  _forceSlicePreviewOpening: boolean,
  _reviewing: boolean,
  _ignoredLegacyResumeGoal: boolean,
): 'opening' {
  // The existing layout/review API stays intact; Welcome has no owner goal authority.
  return 'opening';
}

export function shouldShowFirstWelcome(
  welcomeValue: string | null,
  _ignoredLegacyOpeningValue?: string | null,
  _ignoredLegacyDevelopmentValue?: string | null,
): boolean {
  // "First" refers only to this installation's presentation, not a new person.
  return welcomeValue !== WELCOME_SEEN_VALUE;
}
