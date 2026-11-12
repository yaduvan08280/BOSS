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

export default i18n;
