import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Language } from '@mono/shared';
import en from '@/locales/en.json';
import hi from '@/locales/hi.json';
import { withParts } from '@/locales/parts';
import { safeStorage } from './utils';

const LANG_KEY = 'mono.lang';

export function storedLanguage(): Language {
  return safeStorage.get(LANG_KEY) === 'hi' ? 'hi' : 'en';
}

export function setLanguage(lang: Language) {
  safeStorage.set(LANG_KEY, lang);
  document.documentElement.lang = lang;
  return i18n.changeLanguage(lang);
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: withParts(en, 'en') }, hi: { translation: withParts(hi, 'hi') } },
  lng: storedLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});
document.documentElement.lang = storedLanguage();

/**
 * A company's packs may rename things on screen ("Guest" → "Patient"). The words are laid over the built-in
 * strings; taking a pack off puts the built-in ones back.
 */
const original = new Map<string, string | undefined>();
export function applyWords(words: Record<string, { en: string; hi?: string }>) {
  for (const [id, text] of original) {
    const [lng, key] = [id.slice(0, 2), id.slice(3)];
    if (text === undefined) continue;
    i18n.addResource(lng, 'translation', key, text);
  }
  original.clear();
  for (const [key, w] of Object.entries(words))
    for (const lng of ['en', 'hi'] as const) {
      const text = lng === 'hi' ? (w.hi ?? w.en) : w.en;
      const had = i18n.getResource(lng, 'translation', key) as unknown;
      // Only a real string is replaced: a pack cannot swap a whole section.
      if (typeof had !== 'string') continue;
      original.set(`${lng}:${key}`, had);
      i18n.addResource(lng, 'translation', key, text);
    }
  // Screens already drawn read the new words.
  void i18n.changeLanguage(i18n.language);
}

export default i18n;
