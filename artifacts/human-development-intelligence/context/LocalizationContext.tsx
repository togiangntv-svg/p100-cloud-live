import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { detectDeviceLocale, localeCode, translate, TranslationKey } from '@/i18n';
import { isReleaseLocale, type ReleaseLocale } from '../i18n-opening';
import { resolveInitialLocale } from '../locale-bootstrap';

const LOCALE_STORAGE_KEY = '@100-human-development-locale';

type LocalizationValue = {
  locale: ReleaseLocale;
  setLocale: (locale: ReleaseLocale) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  localeCode: string;
};

const LocalizationContext = createContext<LocalizationValue | null>(null);

export function LocalizationProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<ReleaseLocale>('en');
  const [ready, setReady] = useState(false);
  const writes = useRef(Promise.resolve());

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(LOCALE_STORAGE_KEY)
      .catch(() => null)
      .then((manualChoice) => {
        if (!active) return;
        // Production country detection is PENDING; device locale is fallback.
        setLocaleState(resolveInitialLocale({ manualChoice, deviceLocale: detectDeviceLocale() }));
        setReady(true);
      });
    return () => { active = false; };
  }, []);

  const setLocale = (next: ReleaseLocale) => {
    if (!isReleaseLocale(next)) return;
    setLocaleState(next);
    // Serialize manual choices so a slow earlier write cannot win later.
    writes.current = writes.current.catch(() => undefined)
      .then(() => AsyncStorage.setItem(LOCALE_STORAGE_KEY, next))
      .catch(() => undefined);
  };

  const value = useMemo(() => ({
    locale,
    setLocale,
    t: (key: TranslationKey, values?: Record<string, string | number>) => translate(locale, key, values),
    localeCode: localeCode(locale),
  }), [locale]);

  // Do not mount localized M1 content until persisted choice has resolved.
  if (!ready) return null;
  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocalizationContext);
  if (!value) throw new Error('useLocale must be used inside LocalizationProvider');
  return value;
}

export const localizationStorageKey = LOCALE_STORAGE_KEY;
