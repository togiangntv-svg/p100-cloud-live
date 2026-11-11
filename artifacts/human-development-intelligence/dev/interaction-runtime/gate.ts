// Runtime guard, not caller-supplied authority. Expo replaces __DEV__ in release bundles.
export function isRuntimeTestEnabled(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true
    && process.env.EXPO_PUBLIC_LOCAL_ISOLATION_TEST === 'enabled';
}
