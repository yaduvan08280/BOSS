import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './phase11-kit';

/**
 * Accessibility, checked by axe on every screen of the left menu (and the sign-in page), at the phone and the
 * desktop size: nothing "serious" or "critical" against WCAG 2 A / AA may be left — a button with no name,
 * text too faint to read, a form box with no label, a list or table built wrongly.
 * The addresses are read from the menu itself, so a new screen is checked without being added here.
 */
const menu = readFileSync(new URL('../apps/web/src/layout/nav.ts', import.meta.url), 'utf8');
const SCREENS = [...new Set([...menu.matchAll(/'(\/[a-z][a-z/-]*)'/g)].map((m) => m[1]!))]
  .filter((path) => path !== '/dev/ui')
  .sort();

/** The screen has drawn: a full-screen page (kitchen display, POS) has no <main>, so that is not asked for. */
async function ready(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 });
}

async function check(page: Page, where: string, problems: string[]) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  for (const v of result.violations) {
    if (v.impact !== 'serious' && v.impact !== 'critical') continue;
    const first = v.nodes[0];
    const data = (first?.any[0]?.data ?? null) as {
      fgColor?: string;
      bgColor?: string;
      contrastRatio?: number;
    } | null;
    const colours = data?.contrastRatio
      ? ` [${data.fgColor} on ${data.bgColor} = ${data.contrastRatio}]`
      : '';
    problems.push(
      `${where}: ${v.id} (${v.impact}, ${v.nodes.length}×) — ${v.help}${colours} — ${first?.target.join(' ')} ${(first?.html ?? '').slice(0, 140)}`,
    );
  }
}

test('the sign-in page has no serious accessibility problem', async ({ page }) => {
  const problems: string[] = [];
  await page.goto('/login');
  await page.waitForSelector('input');
  await check(page, '/login', problems);
  expect(problems).toEqual([]);
});

test('no screen of the menu has a serious accessibility problem', async ({ page }) => {
  test.setTimeout(1_200_000);
  expect(SCREENS.length).toBeGreaterThan(60);
  await signIn(page);
  const problems: string[] = [];
  for (const path of SCREENS) {
    await page.goto(path);
    await ready(page);
    // A screen that crashed shows a tidy message — which axe finds nothing wrong with. It is a failure here.
    if (await page.getByText(/This screen (hit a problem|stopped working)/).count())
      problems.push(`${path}: the screen crashed`);
    await check(page, path, problems);
  }
  expect(problems).toEqual([]);
});
