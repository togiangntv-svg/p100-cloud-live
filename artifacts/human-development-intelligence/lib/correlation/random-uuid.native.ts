import * as Crypto from 'expo-crypto';

/** Expo/React Native platform UUID source. No fallback is permitted. */
export function randomUuid(): string {
  if (typeof Crypto.randomUUID !== 'function') {
    throw Error('SESSION_CORRELATION_UUID_UNAVAILABLE');
  }
  return Crypto.randomUUID();
}
