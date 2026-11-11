import { resolveLocalVerificationConfig } from '@/lib/identity/local-verification';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { aiGatewayStatus, aiPilotSession, aiRespond, setBaseUrl } from '@workspace/api-client-react';
import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  createInteractionStore, type InteractionApi, type InteractionOwnerBinding,
} from './interaction-owner/store';

const domain = process.env.EXPO_PUBLIC_DOMAIN?.replace(/^https?:\/\//u, '').replace(/\/+$/u, '');
const localConfig = resolveLocalVerificationConfig(process.env.EXPO_PUBLIC_LOCAL_VERIFICATION,
  globalThis.location?.origin, process.env.EXPO_PUBLIC_LOCAL_AUTHORITY_ORIGIN,
  process.env.EXPO_PUBLIC_M3_RUNTIME_MODE);
if (localConfig) setBaseUrl(localConfig.origin);
else if (domain && process.env.EXPO_PUBLIC_M3_RUNTIME_MODE !== 'local-verification') setBaseUrl(`https://${domain}`);

const api: InteractionApi = {
  status: ({ signal }) => aiGatewayStatus({ credentials: 'include', signal }),
  pilot: (body, { signal }) => aiPilotSession(body, { credentials: 'include', signal }),
  respond: (body, { signal }) => aiRespond(body, { credentials: 'include', signal }),
};
type InteractionStore = ReturnType<typeof createInteractionStore>;
const InteractionContext = createContext<InteractionStore | null>(null);

/**
 * The future trusted session coordinator supplies access + a boundary-issued lease.
 * The existing navigation supplies neither: Interaction remains LOCKED, with no legacy
 * hydration or AI call. No demo owner, local ID authority, or production auth is invented.
 */
export function InteractionProvider({ children, ownerSession }: {
  children: React.ReactNode;
  ownerSession?: InteractionOwnerBinding;
}) {
  const access = ownerSession?.access;
  const lease = ownerSession?.lease;
  const store = useMemo(() => createInteractionStore({
    owner: access && lease ? { access, lease } : undefined,
    backend: AsyncStorage,
    api,
  }), [access, lease]);

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  return <InteractionContext.Provider value={store}>{children}</InteractionContext.Provider>;
}

export function useInteraction() {
  const store = useContext(InteractionContext);
  if (!store) throw new Error('useInteraction must be used inside InteractionProvider');
  // React rechecks the external snapshot before committing; private state retires
  // synchronously at the source instead of waiting for a later setState effect.
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
