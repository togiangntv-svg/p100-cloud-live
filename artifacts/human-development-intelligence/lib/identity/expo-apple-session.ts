import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  ClientSessionError,
  createAppleSessionHandoff,
  createInstallBoundSessionCredentialStore,
  createIdentityHttpTransport,
  createProviderNeutralSessionAdapter,
  type InstallationMarkerStore,
  type NativeAppleSignIn,
  type SessionCredentialStore,
} from '../../domain/identity/client-session';

const SESSION_KEY = 'hdi100.identity.session.v1';
const SESSION_OPTIONS: SecureStore.SecureStoreOptions = Object.freeze({
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'com.togiang.hdi100.identity',
});
const INSTALL_MARKER_KEY = 'hdi100.identity.installation.v1';
const INSTALL_MARKER_VALUE = 'v1';

function unavailable(): never {
  throw new ClientSessionError('AUTHORITY_UNAVAILABLE');
}

function isCancellation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object'
    && (error as Record<string, unknown>).code === 'ERR_REQUEST_CANCELED');
}

export function createExpoAppleNativeSignIn(): NativeAppleSignIn {
  return Object.freeze({
    async authorize(nonceDigest: string) {
      if (Platform.OS !== 'ios' || !(await AppleAuthentication.isAvailableAsync())) {
        return unavailable();
      }
      try {
        const credential = await AppleAuthentication.signInAsync({
          nonce: nonceDigest,
          requestedScopes: [],
        });
        if (typeof credential.identityToken !== 'string' || credential.identityToken.length === 0) {
          return unavailable();
        }
        // Apple user/email/name are deliberately ignored; only the server-verified JWT crosses.
        return Object.freeze({ status: 'success' as const, identityToken: credential.identityToken });
      } catch (error) {
        if (isCancellation(error)) return Object.freeze({ status: 'cancelled' as const });
        return unavailable();
      }
    },
  });
}

export function createExpoSecureSessionStore(): SessionCredentialStore {
  return Object.freeze({
    load: () => SecureStore.getItemAsync(SESSION_KEY, SESSION_OPTIONS),
    save: (token: string) => SecureStore.setItemAsync(SESSION_KEY, token, SESSION_OPTIONS),
    remove: () => SecureStore.deleteItemAsync(SESSION_KEY, SESSION_OPTIONS),
  });
}

export function createExpoInstallationMarkerStore(): InstallationMarkerStore {
  return Object.freeze({
    async isEstablished(): Promise<boolean> {
      return await AsyncStorage.getItem(INSTALL_MARKER_KEY) === INSTALL_MARKER_VALUE;
    },
    establish: () => AsyncStorage.setItem(INSTALL_MARKER_KEY, INSTALL_MARKER_VALUE),
  });
}

export async function sha256RawNonce(rawNonce: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

export function createIosIdentityClient(input: Readonly<{
  baseUrl: string;
  requestTimeoutMs: number;
}>) {
  const transport = createIdentityHttpTransport({
    baseUrl: input.baseUrl,
    timeoutMs: input.requestTimeoutMs,
  });
  const session = createProviderNeutralSessionAdapter({
    store: createInstallBoundSessionCredentialStore({
      credentials: createExpoSecureSessionStore(),
      installation: createExpoInstallationMarkerStore(),
    }),
    transport,
  });
  const apple = createAppleSessionHandoff({
    native: createExpoAppleNativeSignIn(),
    transport,
    session,
    sha256: sha256RawNonce,
  });
  return Object.freeze({ apple, session });
}
