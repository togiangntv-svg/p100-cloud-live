import { detectLocaleFromTag, isReleaseLocale, type ReleaseLocale } from './i18n-opening';

// No authenticated country signal is available in this runtime. Do not infer
// one from a device region, an IP string, a header or an untrusted parameter.
export const PRODUCTION_IP_COUNTRY_STATUS = 'PENDING' as const;
const COUNTRY_LOCALES: Readonly<Record<string, ReleaseLocale>> = {
  VN: 'vi', CN: 'zh-Hans', IN: 'hi', JP: 'ja', KR: 'ko', RU: 'ru',
  ES: 'es', MX: 'es', GT: 'es', HN: 'es', SV: 'es', NI: 'es', CR: 'es',
  PA: 'es', CU: 'es', DO: 'es', PR: 'es', CO: 'es', VE: 'es', EC: 'es',
  PE: 'es', BO: 'es', PY: 'es', CL: 'es', AR: 'es', UY: 'es',
  US: 'en', GB: 'en', AU: 'en', NZ: 'en', IE: 'en', CA: 'en',
};
export function resolveInitialLocale(input: {
  manualChoice?: unknown;
  trustedCountryCode?: string | null;
  deviceLocale?: string | null;
}): ReleaseLocale {
  if (isReleaseLocale(input.manualChoice)) return input.manualChoice;
  if (input.trustedCountryCode) return COUNTRY_LOCALES[input.trustedCountryCode.toUpperCase()] ?? 'en';
  const device = detectLocaleFromTag(input.deviceLocale ?? '');
  return isReleaseLocale(device) ? device : 'en';
}
