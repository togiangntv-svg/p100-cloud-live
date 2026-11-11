// Standalone local harness, no product/EAS/signing identity.
module.exports = { expo: {
  name: 'Development Isolation Test', slug: 'development-isolation-test-harness',
  sdkVersion: '57.0.0', platforms: ['ios', 'android', 'web'], web: { bundler: 'metro' },
} };
