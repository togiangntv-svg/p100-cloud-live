import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { createOpeningStore, type OpeningOwnerBinding } from './opening-owner/store';

type OpeningStore = ReturnType<typeof createOpeningStore>;
const OpeningContext = createContext<OpeningStore | null>(null);

export function OpeningProvider({ children, ownerSession }: {
  children: React.ReactNode;
  ownerSession?: OpeningOwnerBinding;
}) {
  const access = ownerSession?.access;
  const lease = ownerSession?.lease;
  const store = useMemo(() => createOpeningStore({
    owner: access && lease ? { access, lease } : undefined,
    backend: AsyncStorage,
  }), [access, lease]);
  useEffect(() => { store.start(); return () => store.stop(); }, [store]);
  return <OpeningContext.Provider value={store}>{children}</OpeningContext.Provider>;
}

export function useOpening() {
  const store = useContext(OpeningContext);
  if (!store) throw new Error('useOpening must be used inside OpeningProvider');
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
