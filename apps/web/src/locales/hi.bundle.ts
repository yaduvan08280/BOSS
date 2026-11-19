import base from './hi.json';

// Every string of one language: the main file plus each feature's own file (parts/<feature>.hi.json).
// Loaded as one piece, only when this language is the one on screen (lib/i18n.ts).
const parts = import.meta.glob<Record<string, unknown>>('./parts/*.hi.json', {
  eager: true,
  import: 'default',
});

export default Object.assign(
  {},
  base,
  ...Object.entries(parts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, tree]) => tree),
) as typeof base;
