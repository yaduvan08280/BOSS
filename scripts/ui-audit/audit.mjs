#!/usr/bin/env node
// UI audit: every route → every tab → (deep) every dialog, drawer and dropdown, at one screen size.
// See README.md. Usage: node scripts/ui-audit/audit.mjs --size 390x844 [--deep] [--label tora-owner] …
/* global document */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { probe } from './probe.mjs';
import { writeReport } from './report.mjs';
import { readRoutes } from './routes.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : (process.argv[i + 1]?.startsWith('--') ?? true) ? true : process.argv[i + 1];
};
const [W, H] = String(arg('size', '1440x900')).split('x').map(Number);
const BASE = arg('base', process.env.AUDIT_BASE ?? 'http://localhost:5173');
const LABEL = arg('label', 'run');
const DEEP = Boolean(arg('deep', false));
const WORKERS = Number(arg('workers', 3));
const VARIANT = arg('variant', ''); // dark | hindi | large | collapsed (one at a time)
const ONLY = arg('only', '');
const SHOTS = !arg('no-shots', false);
const OUT = join(arg('out', 'ui-audit-out'), LABEL, `${W}x${H}${VARIANT ? `-${VARIANT}` : ''}`);
const WAIT = Number(arg('wait', 1200));
// Buttons the crawler never presses: they change or send something.
const SKIP =
  /delete|remove|void|cancel|close|sign out|log ?out|reset|archive|discard|revoke|reject|approve|decline|punch|install|apply|print|download|import|save|submit|refresh|sync|send|verify|accept|mark|undo|clear|fire|pay|settle|issue|confirm|check ?out|check ?in|run|generate|recalc|reopen|unlock|lock|stop|disconnect|connect|switch|load|collapse|copy|bump|ready|serve|recall|start|capture|dictate|link|get my code|check all|duplicate|pack|move (up|down)|^×$|^x$/i;

mkdirSync(join(OUT, 'shots'), { recursive: true });
const LOG = join(OUT, 'states.jsonl');
const done = new Set(
  existsSync(LOG)
    ? readFileSync(LOG, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((r) => r.end)
        .map((r) => r.path)
    : [],
);
const record = (row) => appendFileSync(LOG, `${JSON.stringify(row)}\n`);
const slug = (s) =>
  s
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 90) || 'home';

const { fixed, patterns } = readRoutes();
const queue = fixed.filter((p) => p !== '/dev/ui' && (!ONLY || p.startsWith(ONLY)) && !done.has(p));
const filled = new Set();

async function look(page, path, state, errs) {
  await page.waitForLoadState('networkidle', { timeout: WAIT }).catch(() => {});
  // The grey loading shapes must be gone: a page is judged with its content, not while it loads.
  await page
    .waitForFunction(() => !document.querySelector('main [aria-busy="true"]'), null, { timeout: 4000 })
    .catch(() => {});
  await page.waitForTimeout(120);
  const seen = await page.evaluate(probe).catch(() => null);
  if (!seen) return;
  // A refusal (403) or a record that is gone (404 on a read: an old notification, a deleted row) is not a
  // fault of the screen. Both are listed, and the screen must then say so in words — "Something went wrong"
  // or a page that loads for ever still counts.
  const problems = [
    ...seen.problems,
    ...[...new Set(errs.splice(0))].map((e) => ({
      kind: e.startsWith('403 ') ? 'no-access' : e.startsWith('404 GET') ? 'gone' : 'error',
      detail: e,
    })),
  ];
  const file = `${slug(`${path}__${state}`)}.jpg`;
  if (SHOTS)
    await page.screenshot({ path: join(OUT, 'shots', file), type: 'jpeg', quality: 55 }).catch(() => {});
  record({ path, state, fields: seen.fields, dialog: seen.hasDialog, problems, shot: file });
}

async function dropdowns(page, path, state) {
  const boxes = page.locator('[role=dialog] [role=combobox]:visible, main [role=combobox]:visible');
  const n = Math.min(await boxes.count().catch(() => 0), 10);
  for (let i = 0; i < n; i++) {
    const box = boxes.nth(i);
    try {
      if (await box.isDisabled()) continue;
      const name = ((await box.getAttribute('aria-label')) || (await box.innerText()) || '').slice(0, 30);
      await box.click({ timeout: 1200 });
      await page.waitForTimeout(100);
      let options = await page.locator('[role=option]:visible').count();
      if (!options) {
        // Something else was open (a calendar, another list) and took the click: close it and ask once more.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(120);
        await box.click({ timeout: 1200 }).catch(() => {});
        await page.waitForTimeout(250);
        options = await page.locator('[role=option]:visible').count();
      }
      /* global innerWidth, innerHeight */
      const off = await page.evaluate(() => {
        const l = document.querySelector('[role=listbox]');
        if (!l) return false;
        const r = l.getBoundingClientRect();
        return r.right > innerWidth + 2 || r.left < -2 || r.bottom > innerHeight + 2 || r.top < -2;
      });
      const problems = [];
      if (!options) problems.push({ kind: 'dropdown-empty', detail: name });
      if (off) problems.push({ kind: 'dropdown-off-screen', detail: name });
      record({ path, state: `${state} ▾ ${name}`, dropdown: true, options, problems });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(60);
    } catch {
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
}

const closeAll = async (page) => {
  for (
    let i = 0;
    i < 4 &&
    (await page
      .locator('[role=dialog]:visible')
      .count()
      .catch(() => 0));
    i++
  ) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
};

async function deep(page, path, state, url, errs) {
  // The first row or card: its drawer and the tabs inside it.
  for (const sel of ['main tbody tr', 'main ul > li button', 'main ul > li']) {
    const row = page.locator(sel).first();
    if (!(await row.count().catch(() => 0))) continue;
    try {
      await row.click({ timeout: 1200, position: { x: 50, y: 12 } });
    } catch {
      continue;
    }
    await page.waitForTimeout(300);
    if (!(await page.locator('[role=dialog]:visible').count())) continue;
    await look(page, path, `${state} » row`, errs);
    const tabs = page.locator('[role=dialog] [role=tab]:visible');
    for (let t = 0; t < Math.min(await tabs.count().catch(() => 0), 6); t++) {
      await tabs
        .nth(t)
        .click({ timeout: 1000 })
        .catch(() => {});
      await look(page, path, `${state} » row » tab ${t + 1}`, errs);
    }
    await dropdowns(page, path, `${state} » row`);
    await closeAll(page);
    break;
  }
  // Every button that opens something (the ones that change or send are skipped).
  const pressed = new Set();
  for (let round = 0; round < 14; round++) {
    const btns = page.locator(
      'main button:visible:not([role=tab]):not([role=switch]):not([role=combobox]):not([role=checkbox]):not([aria-pressed])',
    );
    const n = await btns.count().catch(() => 0);
    let did = false;
    for (let i = 0; i < n; i++) {
      const b = btns.nth(i);
      const label = (
        (await b.innerText().catch(() => '')) ||
        (await b.getAttribute('aria-label').catch(() => '')) ||
        ''
      )
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 40);
      if (!label || pressed.has(label) || SKIP.test(label) || /^\d+$/.test(label)) continue;
      if (await b.isDisabled().catch(() => true)) continue;
      pressed.add(label);
      did = true;
      try {
        await b.click({ timeout: 1200 });
      } catch {
        break;
      }
      await page.waitForTimeout(280);
      const at = `${state} » [${label}]`;
      await look(page, path, at, errs);
      if (await page.locator('[role=dialog]:visible').count()) {
        await dropdowns(page, path, at);
        await closeAll(page);
      } else if (page.url() !== url) {
        await page.goto(url).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: WAIT }).catch(() => {});
      } else await page.keyboard.press('Escape').catch(() => {});
      break;
    }
    if (!did || pressed.size > 12) return;
  }
}

async function crawl(page, path, errs) {
  const url = BASE + path;
  await page.goto(url);
  await look(page, path, 'page', errs);
  // Links to routes with a parameter: one example of each is added to the queue.
  const links = await page
    .locator('main a[href^="/"]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  for (const href of links) {
    const hit = patterns.find((p) => p.re.test(href.split('?')[0]));
    if (hit && !filled.has(hit.pattern)) {
      filled.add(hit.pattern);
      if (!done.has(href)) queue.push(href);
    }
  }
  const TABS = path.startsWith('/system')
    ? 'main [role=tab]:visible'
    : 'main [role=tab]:visible, main [data-ui=tabs] > *:visible';
  const count = Math.min(
    await page
      .locator(TABS)
      .count()
      .catch(() => 0),
    14,
  );
  for (const t of count ? [...Array(count).keys()] : [-1]) {
    let state = 'page';
    if (t >= 0) {
      const tab = page.locator(TABS).nth(t);
      const name = ((await tab.innerText().catch(() => '')) || '').trim().replace(/\s+/g, ' ').slice(0, 24);
      try {
        await tab.click({ timeout: 4000 });
      } catch {
        continue;
      }
      state = `tab ${name}`;
      await look(page, path, state, errs);
    }
    if (DEEP) {
      const here = page.url();
      await dropdowns(page, path, state);
      await deep(page, path, state, here, errs);
      if (page.url() !== here) await page.goto(here).catch(() => {});
    }
  }
}

// AUDIT_CHROMIUM names a Chrome to use when Playwright's own download is not on this machine.
const browser = await chromium.launch(
  process.env.AUDIT_CHROMIUM ? { executablePath: process.env.AUDIT_CHROMIUM } : {},
);
const context = await browser.newContext({
  viewport: { width: W, height: H },
  serviceWorkers: 'block',
  colorScheme: VARIANT === 'dark' ? 'dark' : 'light',
});
await context.addInitScript((variant) => {
  try {
    if (variant === 'hindi') localStorage.setItem('mono.lang', 'hi');
    if (variant === 'large') localStorage.setItem('mono.largeText', '1');
    if (variant === 'collapsed') localStorage.setItem('mono.menuCollapsed', '1');
  } catch {
    /* a page with no storage */
  }
}, VARIANT);
const first = await context.newPage();
await first.goto(`${BASE}/login`);
await first
  .getByRole('textbox')
  .first()
  .fill(process.env.AUDIT_MOBILE ?? '');
await first.locator('input[type=password]').fill(process.env.AUDIT_PASSWORD ?? '');
await first.locator('button[type=submit]').click();
await first.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20_000 });
await first.close();

let active = 0;
async function worker() {
  let page = await context.newPage();
  const errs = [];
  const wire = (p) => {
    p.on('pageerror', (e) => errs.push(`page error: ${e.message.slice(0, 140)}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|401/.test(m.text()))
        errs.push(`console: ${m.text().slice(0, 140)}`);
    });
    p.on('response', (r) => {
      if (r.status() >= 400 && r.url().includes('/api/') && r.status() !== 401)
        errs.push(
          `${r.status()} ${r.request().method()} ${r
            .url()
            .replace(/^.*\/api/, '/api')
            .slice(0, 80)}`,
        );
    });
    p.on('dialog', (d) => d.dismiss().catch(() => {}));
  };
  wire(page);
  for (;;) {
    const path = queue.shift();
    if (!path) {
      if (!active) break;
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
    active++;
    try {
      errs.length = 0;
      await crawl(page, path, errs);
      record({ path, end: true });
    } catch (e) {
      record({
        path,
        end: true,
        problems: [{ kind: 'crawl-failed', detail: String(e).slice(0, 140) }],
        state: 'page',
      });
      await page.close().catch(() => {});
      page = await context.newPage();
      wire(page);
    }
    active--;
  }
  await page.close().catch(() => {});
}
await Promise.all(Array.from({ length: WORKERS }, worker));
await browser.close();
const summary = writeReport(OUT, { size: `${W}x${H}`, label: LABEL, variant: VARIANT, deep: DEEP });
console.log(`${LABEL} ${W}x${H}${VARIANT ? ` ${VARIANT}` : ''}: ${summary}`);
