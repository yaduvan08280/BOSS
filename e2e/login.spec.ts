import { expect, test, type Page } from '@playwright/test';

const identifier = process.env.SEED_OWNER_MOBILE ?? '';
const password = process.env.SEED_OWNER_PASSWORD ?? '';
const shots = process.env.E2E_SCREENSHOTS === '1';

async function shot(page: Page, name: string, project: string) {
  if (shots) await page.screenshot({ path: `docs/screenshots/${project}-${name}.png`, fullPage: false });
}

/** Nothing may be wider than the device: on phones that widens the layout and pushes fixed bars off-screen. */
async function expectNoSideScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, 'page is wider than the screen').toBeLessThanOrEqual(width);
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/mobile number or email/i).fill(identifier);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('heading', { name: /what do you want to do/i })).toBeVisible();
}

test('owner signs in and sees the shell', async ({ page }, info) => {
  test.skip(!identifier || !password, 'Set SEED_OWNER_MOBILE and SEED_OWNER_PASSWORD');
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.emulateMedia({ colorScheme: 'light' });
  await shot(page, 'login', info.project.name);

  await page.getByLabel(/mobile number or email/i).fill(identifier);
  await page.getByLabel(/^password$/i).fill('wrong-password-1');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('alert')).toContainText(/wrong/i);

  await signIn(page);
  await shot(page, 'home', info.project.name);

  await expectNoSideScroll(page);

  await page.goto('/crm/customers');
  await expect(page.getByText(/arrives in phase 9/i)).toBeVisible();
  await expectNoSideScroll(page);
  await shot(page, 'placeholder', info.project.name);

  await page.goto('/system');
  await expect(page.getByRole('heading', { name: 'System Master' })).toBeVisible();
  await expectNoSideScroll(page);
  await shot(page, 'system-master', info.project.name);

  await page.goto('/dev/ui');
  await expectNoSideScroll(page);
  await shot(page, 'ui-kit', info.project.name);

  // Dark mode through the API the user menu uses, then put back the person's own choice.
  // Desktop only: both projects share one account, so toggling in parallel would race.
  if (info.project.name !== 'desktop') return;
  const origin = new URL(page.url()).origin;
  const before = (await (await page.request.get('/api/auth/me')).json()).user.themeMode as string;
  const setMode = (themeMode: string) =>
    page.request.patch('/api/auth/me/preferences', { data: { themeMode }, headers: { origin } });
  try {
    expect((await setMode('dark')).ok()).toBe(true);
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await shot(page, 'home-dark', info.project.name);
  } finally {
    await setMode(before);
  }
});

test('phone menu opens as a drawer', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone' || !identifier, 'phone only');
  await signIn(page);
  await page.getByRole('navigation', { name: 'Menu' }).last().getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Checklists' })).toBeVisible();
  await shot(page, 'drawer', info.project.name);
});
