import { expect, test, type Page } from '@playwright/test';

/**
 * Accidental password reset (fixed 09/11/2026): a double-click on the Add people backdrop closed the
 * dialog on the first click and the second landed on a row's key icon, resetting that password at once.
 * Now a reset always asks first, your own row has no reset, and adding one person closes the dialog.
 * Runs on the demo company (npm run seed:demo) with a throwaway person; the owner is never reset.
 */
const OWNER = { id: '9000000000', password: process.env.SEED_DEMO_PASSWORD ?? 'Demo1234' };
const run = Date.now().toString(36).slice(-5).toUpperCase();
const NAME = `Zeta ${run}`;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/mobile number or email/i).fill(OWNER.id);
  await page.getByLabel(/^password$/i).fill(OWNER.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('heading', { name: /what do you want to do/i })).toBeVisible();
}

/** Count reset calls the browser makes; none may happen without a confirmation. */
function watchResets(page: Page) {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/reset-password')) calls.push(r.url());
  });
  return calls;
}

async function addPerson(page: Page) {
  await page.goto('/system/users');
  await page
    .getByRole('button', { name: /add people/i })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^name/i).fill(NAME);
  await dialog.getByLabel(/^mobile/i).fill(`97${String(Date.now()).slice(-8)}`);
  await dialog.getByRole('checkbox', { name: /give app login/i }).check();
  await dialog.getByRole('button', { name: /^add person$/i }).click();
  // The one-time password, then Done: nothing may be left open behind it.
  await expect(page.getByRole('dialog')).toContainText(NAME);
  await page.getByRole('button', { name: /^done$/i }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('Users: password reset safety', () => {
  test('adding one person closes the dialog; a double-click on the backdrop never resets', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'the table and the centred dialog are desktop layouts');
    await signIn(page);
    const resets = watchResets(page);
    await addPerson(page);
    await page.getByPlaceholder(/search name/i).fill(run);
    const key = page.getByRole('button', { name: `Reset ${NAME}'s password` });
    await expect(key).toBeVisible();

    for (const size of [
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      for (const gap of [90, 250]) {
        await key.scrollIntoViewIfNeeded();
        const box = (await key.boundingBox())!;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page
          .getByRole('button', { name: /add people/i })
          .first()
          .click();
        await expect(page.getByRole('dialog')).toBeVisible();
        // The key icon must sit on the backdrop, outside the dialog, for this to be the real case.
        const panel = (await page.getByRole('dialog').boundingBox())!;
        expect(x < panel.x || x > panel.x + panel.width || y < panel.y || y > panel.y + panel.height).toBe(
          true,
        );

        // Double-click on the backdrop right where the key icon is.
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForTimeout(gap);
        await page.mouse.down({ clickCount: 2 });
        await page.mouse.up({ clickCount: 2 });

        // At most a question — never a reset.
        const confirm = page.getByRole('dialog');
        await expect(confirm).toContainText(`Reset ${NAME}'s password?`);
        await expect(confirm).toContainText('signed out on every device');
        expect(resets, `${size.width}x${size.height}, ${gap} ms`).toHaveLength(0);
        await confirm.getByRole('button', { name: /^cancel$/i }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(resets).toHaveLength(0);
      }
    }

    // Saying yes does reset, and shows the one-time password.
    await key.click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^reset password$/i })
      .click();
    await expect(page.getByRole('dialog')).toContainText(/one-time password/i);
    expect(resets).toHaveLength(1);
    await page.getByRole('button', { name: /^done$/i }).click();
  });

  test('your own row has no reset; the key leads to Profile → Change password', async ({ page }) => {
    await signIn(page);
    const resets = watchResets(page);
    const me = (await (await page.request.get('/api/auth/me')).json()) as {
      user: { code: string; name: string };
    };
    await page.goto('/system/users');
    await page.getByPlaceholder(/search name/i).fill(me.user.code);
    // Phones show cards; desktop shows the table. Both use the same key icon.
    await expect(page.getByRole('main').getByText(me.user.name).first()).toBeVisible();
    await expect(page.getByRole('button', { name: `Reset ${me.user.name}'s password` })).toHaveCount(0);
    await page
      .getByRole('link', { name: /your own password/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/account$/);
    expect(resets).toHaveLength(0);
  });

  test('cards view asks before a reset too', async ({ page }) => {
    await signIn(page);
    const resets = watchResets(page);
    await addPerson(page);
    if (page.viewportSize()!.width >= 768) await page.getByRole('button', { name: /^cards$/i }).click();
    await page.getByPlaceholder(/search name/i).fill(run);
    await page.getByRole('button', { name: `Reset ${NAME}'s password` }).click();
    await expect(page.getByRole('dialog')).toContainText(`Reset ${NAME}'s password?`);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^cancel$/i })
      .click();
    expect(resets).toHaveLength(0);
  });

  // Leave the demo company as we found it.
  test.afterEach(async ({ page }) => {
    const users = (await (await page.request.get('/api/org/users')).json()) as { id: string; name: string }[];
    if (!Array.isArray(users)) return;
    const origin = new URL(page.url()).origin;
    for (const u of users.filter((x) => x.name === NAME))
      await page.request.delete(`/api/org/users/${u.id}`, { headers: { origin } });
  });
});
