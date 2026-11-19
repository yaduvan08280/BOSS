#!/usr/bin/env node
/* global document */
// Audits the pages a guest opens from a link, with no sign-in: the same checks as the signed-in audit, at
// phone, tablet and desktop widths.
//
//   node scripts/ui-audit/public.mjs --base http://localhost:5173 --paths /login,/f/<token>,/book/<token>
//
// Tokens are a company's own (a process's form link, an outlet's booking page, a booking's link, a property's
// booking page, a room's QR link, a stay's link, an outlet's pulse link) — copy them from the screens that
// show those links.
import { appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { probe } from './probe.mjs';
import { writeReport } from './report.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://localhost:5173');
const LABEL = arg('label', 'public');
const SIZES = arg('sizes', '360x740,390x844,768x1024,1440x900').split(',');
const PATHS = arg('paths', '/login').split(',').filter(Boolean);
const SCHEMES = arg('schemes', 'light,dark').split(',');

const browser = await chromium.launch(
  process.env.AUDIT_CHROMIUM ? { executablePath: process.env.AUDIT_CHROMIUM } : {},
);
let failed = 0;
for (const size of SIZES)
  for (const scheme of SCHEMES) {
    const [width, height] = size.split('x').map(Number);
    const out = join(arg('out', 'ui-audit-out'), LABEL, `${size}${scheme === 'dark' ? '-dark' : ''}`);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(join(out, 'shots'), { recursive: true });
    const log = join(out, 'states.jsonl');
    const context = await browser.newContext({
      viewport: { width, height },
      serviceWorkers: 'block',
      colorScheme: scheme,
    });
    const page = await context.newPage();
    for (const path of PATHS) {
      // The token stays out of the report: a link is a key.
      const shown = path.replace(/\/[^/]{12,}$/, '/<token>');
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await page
        .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 8000 })
        .catch(() => {});
      const found = await page.evaluate(probe);
      const file = `${shown.replace(/[^a-z0-9]+/gi, '_')}.jpg`;
      await page.screenshot({ path: join(out, 'shots', file), type: 'jpeg', quality: 60, fullPage: true });
      appendFileSync(
        log,
        `${JSON.stringify({ path: shown, state: 'page', problems: found.problems, fields: found.fields })}\n`,
      );
      appendFileSync(log, `${JSON.stringify({ path: shown, end: true })}\n`);
    }
    await context.close();
    const line = writeReport(out, { size, label: LABEL, variant: scheme === 'dark' ? 'dark' : '' });
    console.log(`${LABEL} ${size} ${scheme}: ${line}`);
    failed += Number(/ — (\d+) problems/.exec(line)?.[1] ?? 1);
  }
await browser.close();
console.log(`TOTAL problems: ${failed}`);
process.exit(failed ? 1 : 0);
