// i18n setup (i18next + react-i18next). UI strings are translated through here;
// content with embedded {vi,en} fields (products, shops…) still uses `tx`.
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { STR } from '../../data/strings';
import type { Lang } from '../../data/types';

// Build resource bundles from the bilingual STR table (single source of truth).
const en: Record<string, string> = {};
const vi: Record<string, string> = {};
for (const [key, val] of Object.entries(STR)) {
  en[key] = val.en;
  vi[key] = val.vi;
}

const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    vi: { translation: vi },
  },
  lng: 'vi',
  fallbackLng: 'vi',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/** Translate a UI key for a specific language (matches the legacy t(key, lang) API). */
export const t = (key: string, lang: Lang): string => i18n.t(key, { lng: lang }) as string;

export default i18n;
