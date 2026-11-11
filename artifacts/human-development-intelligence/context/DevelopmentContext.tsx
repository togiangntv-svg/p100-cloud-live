import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { createDevelopmentStore, type DevelopmentOwnerBinding } from './development-owner/store';

export type { AppState, TodayMode } from '../domain/gate7';
export { validationTests } from '../domain/gate7';

type DevelopmentStore = ReturnType<typeof createDevelopmentStore>;
const DevelopmentContext = createContext<DevelopmentStore | null>(null);

// Only a trusted session coordinator may supply a boundary-issued READY lease.
// Existing navigation supplies none: remain LOCKED without reading legacy data.
export function DevelopmentProvider({ children, ownerSession }: {
  children: React.ReactNode;
  ownerSession?: DevelopmentOwnerBinding;
}) {
  const access = ownerSession?.access;
  const lease = ownerSession?.lease;
  const store = useMemo(() => createDevelopmentStore({
    owner: access && lease ? { access, lease } : undefined,
    backend: AsyncStorage,
    onSelection: () => Haptics.selectionAsync(),
  }), [access, lease]);

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  return <DevelopmentContext.Provider value={store}>{children}</DevelopmentContext.Provider>;
}

export function useDevelopment() {
  const store = useContext(DevelopmentContext);
  if (!store) throw new Error('useDevelopment must be used inside DevelopmentProvider');
  // React rechecks before commit; retirement is synchronous, not a later state effect.
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
