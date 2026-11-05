/** The printable user guides from docs/guide, bundled as text and loaded only when opened. */
const files = import.meta.glob('../../../../../docs/guide/[0-9]*.md', { query: '?raw', import: 'default' });

export const GUIDES = Object.keys(files)
  .map((path) => /(\d\d-[\w-]+)\.md$/.exec(path)![1]!)
  .sort();

export async function loadGuide(slug: string): Promise<string | null> {
  const key = Object.keys(files).find((p) => p.endsWith(`/${slug}.md`));
  return key ? ((await files[key]!()) as string) : null;
}
