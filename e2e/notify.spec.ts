import { expect, test, type Page } from '@playwright/test';

/** Phase 2 on the demo company: Send test → in-app (bell, live) + email (Mailpit in dev). */
const OWNER = { id: '9000000000', password: process.env.SEED_DEMO_PASSWORD ?? 'Demo1234', email: 'owner@demo.mono' };
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const shots = process.env.E2E_SCREENSHOTS === '1';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/mobile number or email/i).fill(OWNER.id);
  await page.getByLabel(/^password$/i).fill(OWNER.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('heading', { name: /what do you want to do/i })).toBeVisible();
}

test('Send test reaches the bell live and the inbox by email', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough; it sends real messages');
  const since = new Date();
  await signIn(page);
  await page.goto('/system/integration/rules');
  await expect(page.getByRole('cell', { name: /test message/i }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Send test' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox').selectOption({ label: 'Rajesh Goyal' });
  await dialog.getByRole('button', { name: 'Send test' }).click();
  await expect(page.getByText(/test sent/i)).toBeVisible();

  // Live: the toast and the bell update without a reload.
  await expect(page.getByText(/test message from/i).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /notifications: [1-9]/i }).click();
  await expect(page.getByRole('menu').getByText(/test message from/i).first()).toBeVisible();
  if (shots) await page.screenshot({ path: 'docs/screenshots/desktop-bell.png' });
  await page.keyboard.press('Escape');

  // Email: the worker sent it through SMTP (Mailpit in development).
  await expect
    .poll(
      async () => {
        const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${OWNER.email}`)}`);
        if (!res.ok()) return 0;
        const body = (await res.json()) as { messages: { Subject: string; Created: string }[] };
        return body.messages.filter((m) => /test message/i.test(m.Subject) && new Date(m.Created) >= new Date(since.getTime() - 5000)).length;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
});

test('Integration screens fit the screen', async ({ page }, info) => {
  await signIn(page);
  for (const [path, name] of [
    ['/system/integration', 'whatsapp'],
    ['/system/integration/templates', 'templates'],
    ['/system/integration/telegram', 'telegram'],
    ['/system/integration/channels', 'channels'],
    ['/system/integration/rules', 'rules'],
    ['/system/integration/reminders', 'reminders'],
    ['/notifications', 'notifications'],
    ['/account', 'account'],
  ] as const) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const width = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path} is wider than the screen`).toBeLessThanOrEqual(width);
    if (shots) await page.screenshot({ path: `docs/screenshots/${info.project.name}-int-${name}.png` });
  }
});
