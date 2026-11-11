import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { createCoachingStore, type CoachingOwnerBinding } from './coaching-owner/store';

type CoachingStore = ReturnType<typeof createCoachingStore>;
const CoachingContext = createContext<CoachingStore | null>(null);

export function CoachingProvider({ children, ownerSession }: {
  children: React.ReactNode;
  ownerSession?: CoachingOwnerBinding;
}) {
  const access = ownerSession?.access;
  const lease = ownerSession?.lease;
  const store = useMemo(() => createCoachingStore({
    owner: access && lease ? { access, lease } : undefined,
    backend: AsyncStorage,
  }), [access, lease]);
  useEffect(() => { store.start(); return () => store.stop(); }, [store]);
  return <CoachingContext.Provider value={store}>{children}</CoachingContext.Provider>;
}

export function useCoaching() {
  const store = useContext(CoachingContext);
  if (!store) throw new Error('useCoaching must be used inside CoachingProvider');
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
