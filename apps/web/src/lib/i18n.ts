import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Language } from '@mono/shared';
import { safeStorage } from './utils';

const LANG_KEY = 'mono.lang';

export function storedLanguage(): Language {
  return safeStorage.get(LANG_KEY) === 'hi' ? 'hi' : 'en';
}

// One language is about 90 KB on the wire, so only the one on screen is loaded before the first screen;
// the other comes when somebody switches (and English follows quietly behind Hindi, as its fallback).
const loaders: Record<Language, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('@/locales/en.bundle'),
  hi: () => import('@/locales/hi.bundle'),
};
const loading = new Map<Language, Promise<void>>();
let words: Record<string, { en: string; hi?: string }> | null = null;

export function loadLanguage(lang: Language): Promise<void> {
  let job = loading.get(lang);
  if (!job) {
    job = loaders[lang]().then((m) => {
      i18n.addResourceBundle(lang, 'translation', m.default, true, true);
      // A company's own words (packs) are laid over the language that has just arrived too.
      if (words) applyWords(words);
    });
    // A failed download (offline) may be tried again.
    job.catch(() => loading.delete(lang));
    loading.set(lang, job);
  }
  return job;
}

export async function setLanguage(lang: Language) {
  safeStorage.set(LANG_KEY, lang);
  document.documentElement.lang = lang;
  await loadLanguage(lang).catch(() => undefined);
  return i18n.changeLanguage(lang);
}

/** Resolves when the language on screen is ready: the app is drawn after this (main.tsx). */
export const i18nReady: Promise<void> = (async () => {
  const lang = storedLanguage();
  document.documentElement.lang = lang;
  await i18n.use(initReactI18next).init({
    resources: {},
    lng: lang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  await loadLanguage(lang).catch(() => undefined);
  if (lang !== 'en') void loadLanguage('en').catch(() => undefined);
})();

/**
 * A company's packs may rename things on screen ("Guest" → "Patient"). The words are laid over the built-in
 * strings; taking a pack off puts the built-in ones back.
 */
const original = new Map<string, string | undefined>();
export function applyWords(next: Record<string, { en: string; hi?: string }>) {
  words = next;
  for (const [id, text] of original) {
    const [lng, key] = [id.slice(0, 2), id.slice(3)];
    if (text === undefined) continue;
    i18n.addResource(lng, 'translation', key, text);
  }
  original.clear();
  for (const [key, w] of Object.entries(next))
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
