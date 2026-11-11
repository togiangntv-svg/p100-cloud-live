// Standalone Expo Go/web harness. No EAS project, signing or app-store identity.
module.exports = {
  expo: {
    name: 'Interaction Isolation Test',
    slug: 'interaction-isolation-test-harness',
    sdkVersion: '57.0.0',
    platforms: ['ios', 'android', 'web'],
    web: { bundler: 'metro' },
  },
};
