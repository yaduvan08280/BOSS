import { expect, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * Phase 11 (linked fields, record types, reports) through the screens. Set-up that a test does not prove goes
 * through the API; what it proves is driven in the browser, on a phone (380 px) and a desktop (1440 px).
 * Row ids are from docs/plans/coverage.md.
 */
export const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234';
export const OWNER = '9000000000';
/** A store keeper: a Member with a login (no admin rights). */
export const GOPAL = '9000000123';
const shots = process.env.E2E_SCREENSHOTS === '1';

export async function shot(page: Page, name: string, project: string) {
  if (shots)
    await page.screenshot({ path: `docs/screenshots/phase11/${project}-${name}.png`, fullPage: false });
}
export async function expectNoSideScroll(page: Page) {
  const width = page.viewportSize()!.width;
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    `page is wider than the screen at ${page.url()}`,
  ).toBeLessThanOrEqual(width);
}
export async function settled(page: Page) {
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 10_000 });
}
export async function signIn(page: Page, id = OWNER) {
  await page.goto('/login');
  await page.getByLabel(/mobile number or email/i).fill(id);
  await page.getByLabel(/^password$/i).fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('heading', { name: /what do you want to do/i })).toBeVisible();
}
export async function choose(page: Page, trigger: Locator, text: string) {
  await trigger.click();
  const search = page.getByRole('searchbox');
  if (await search.count()) await search.fill(text);
  await page
    .getByRole('option', { name: new RegExp(text, 'i') })
    .first()
    .click();
}
/** A second person in their own browser window (same phone / desktop settings as the test). */
export async function as(browser: Browser, id: string, info: { project: { use: object } }) {
  const ctx = await browser.newContext(info.project.use);
  const page = await ctx.newPage();
  await signIn(page, id);
  return { page, close: () => ctx.close() };
}
export const headers = (page: Page) => ({ origin: new URL(page.url()).origin });
export async function call<T = Record<string, unknown>>(
  page: Page,
  method: string,
  url: string,
  data?: unknown,
): Promise<T> {
  const r = await page.request.fetch(url, { method, data, headers: headers(page) });
  expect(r.ok(), `${method} ${url} → ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}
/** A different name on every run and in each project, so the suite can be run again on the same data. */
export const tag = (project: string) =>
  `${project === 'phone' ? 'P' : 'D'}${Date.now().toString(36).slice(-5).toUpperCase()}`;

export type TypeInput = { id: string };
/** A "Site visit" type with reportable fields, made through the API. */
export async function siteVisits(page: Page, name: string, prefix: string) {
  return call<TypeInput>(page, 'POST', '/api/records/types', {
    name,
    pluralName: `${name}s`,
    prefix,
    definition: {
      fields: [
        { key: 'site', label: 'Site', type: 'text', required: true, reportable: true },
        { key: 'visit_on', label: 'Visit on', type: 'date', reportable: true },
        { key: 'cost', label: 'Cost', type: 'amount', reportable: true },
      ],
      tables: [],
      statuses: [
        { key: 'planned', label: 'Planned', kind: 'info' },
        { key: 'confirmed', label: 'Confirmed', kind: 'ok' },
        { key: 'closed', label: 'Closed', kind: 'neutral', final: true },
      ],
      start: 'planned',
      moves: [
        { from: 'planned', action: 'confirm', label: 'Confirm', to: 'confirmed', who: ['edit'] },
        { from: 'confirmed', action: 'close', label: 'Close', to: 'closed', who: ['edit'] },
      ],
    },
    menu: { section: 'systems', icon: 'map-pin' },
  });
}
