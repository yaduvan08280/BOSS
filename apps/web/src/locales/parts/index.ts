/**
 * Strings of newer features live in their own files here: `<feature>.en.json` and `<feature>.hi.json`, each a
 * plain object of top-level sections (`{ "lists": { … } }`). They are added to the main files at start-up, so a
 * feature's strings can be written without touching the two big files. A section name must not repeat one that
 * already exists (the locales test checks).
 */
type Tree = Record<string, unknown>;

const files = import.meta.glob<Tree>('./*.json', { eager: true, import: 'default' });

export function partsFor(lang: 'en' | 'hi'): Tree[] {
  return Object.entries(files)
    .filter(([path]) => path.endsWith(`.${lang}.json`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, tree]) => tree);
}

export function withParts<T extends Tree>(base: T, lang: 'en' | 'hi'): T {
  return Object.assign({}, base, ...partsFor(lang)) as T;
}
