import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import type { Language } from '@/types/api';

// Every i18n/<lang>/<feature>.json file becomes the namespace <feature>, so a new feature only adds
// its own two files (docs/08 §8.5) and never edits this one.
const files = import.meta.glob<Record<string, unknown>>('./*/*.json', { eager: true, import: 'default' });

export const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const [path, strings] of Object.entries(files)) {
  const [, lang, ns] = path.match(/^\.\/(\w+)\/(\w+)\.json$/) ?? [];
  if (!lang || !ns) continue;
  resources[lang] = { ...resources[lang], [ns]: strings };
}

export const LANGUAGES: Language[] = ['vi', 'en'];

// Detection order: localStorage → browser (the user's profile is applied after login, see AuthContext).
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: LANGUAGES,
    load: 'languageOnly',
    fallbackLng: 'vi',
    defaultNS: 'common',
    interpolation: { escapeValue: false }, // React already escapes
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] },
    initAsync: false, // resources are bundled, so the first render already has the right language
  });

// Screen readers pick their voice from <html lang>.
const setHtmlLang = (lng: string) => document.documentElement.setAttribute('lang', lng);
setHtmlLang(i18n.resolvedLanguage ?? 'vi');
i18n.on('languageChanged', setHtmlLang);

export function currentLanguage(): Language {
  return i18n.resolvedLanguage === 'en' ? 'en' : 'vi';
}

export default i18n;
