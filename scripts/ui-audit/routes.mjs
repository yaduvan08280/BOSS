import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) =>
  readFileSync(fileURLToPath(new URL(`../../apps/web/src/${rel}`, import.meta.url)), 'utf8');

/**
 * Every route of the app, read from the code: the router's paths (nested ones joined to their parent) and the
 * side menu's paths (which add tabs given as a query). Routes with a parameter (`/masters/:id`) come back as
 * patterns; the crawler fills them with the first matching link it meets on a page.
 */
export function readRoutes() {
  const fixed = new Set();
  const patterns = new Set();
  const stack = [];
  for (const line of src('app/router.tsx').split('\n')) {
    const m = /^(\s*)(\{ )?path: '([^']+)'/.exec(line);
    if (!m) continue;
    // `{ path: … }` on one line opens at its brace; a `path:` on its own line belongs to the brace above it.
    const indent = m[1].length - (m[2] ? 0 : 2);
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    const full = m[3].startsWith('/') ? m[3] : `${stack.at(-1)?.full ?? ''}/${m[3]}`;
    stack.push({ indent, full });
    if (full.includes('*')) continue;
    (full.includes(':') ? patterns : fixed).add(full);
  }
  for (const m of src('layout/nav.ts').matchAll(/path: '([^']+)'/g)) fixed.add(m[1]);
  // Public pages (a guest's link with a token) and the sign-in page are not part of the signed-in crawl.
  const isPublic = (p) => /^\/(login|f|stay|room|rooms|book|pulse)(\/|$)/.test(p);
  return {
    fixed: [...fixed].filter((p) => !isPublic(p)).sort(),
    patterns: [...patterns]
      .filter((p) => !isPublic(p))
      .map((p) => ({
        pattern: p,
        re: new RegExp(`^${p.replace(/:[A-Za-z]+/g, '[^/?#]+')}$`),
      })),
  };
}
