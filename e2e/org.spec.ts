import { expect, test, type Page } from '@playwright/test';

/** Phase 1 flows on the demo company (npm run seed:demo). Each run uses its own names, so runs don't collide. */
const OWNER = { id: '9000000000', password: process.env.SEED_DEMO_PASSWORD ?? 'Demo1234' };
const run = Date.now().toString(36).slice(-5).toUpperCase();
const DEPT = `E2E ${run}`;
const shots = process.env.E2E_SCREENSHOTS === '1';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/mobile number or email/i).fill(OWNER.id);
  await page.getByLabel(/^password$/i).fill(OWNER.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('heading', { name: /what do you want to do/i })).toBeVisible();
}

/** Drag with real pointer moves so dnd-kit sees it. */
async function drag(page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 40), { steps: 12 });
  // dnd-kit auto-scrolls near the edges; aim again at where the target is now.
  await page.waitForTimeout(150);
  const c = (await to.boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + Math.min(c.height / 2, 40), { steps: 3 });
  await page.mouse.up();
}

test.describe('System Master (desktop)', () => {
  test('paste 5 people, move one between departments, make one HOD', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'drag & drop runs on desktop');
    await signIn(page);

    // A department of our own for this run.
    await page.goto('/system/departments');
    await page.getByPlaceholder(/type a department and press enter/i).fill(DEPT);
    await page.keyboard.press('Enter');
    await expect(page.getByText(DEPT, { exact: true })).toBeVisible();

    // Paste a list of 5.
    await page.goto('/system/users');
    await page
      .getByRole('button', { name: /add people/i })
      .first()
      .click();
    await page.getByRole('button', { name: /paste a list/i }).click();
    const n = (i: number) => `98${String(Date.now()).slice(-7)}${i}`;
    const rows = [
      [`Alpha ${run}`, n(1), '', 'IT', 'Fitter'],
      [`Beta ${run}`, n(2), '', 'IT', ''],
      [`Gamma ${run}`, '', `gamma${run.toLowerCase()}@e2e.test`, 'IT', ''],
      [`Delta ${run}`, n(4), '', DEPT, ''],
      [`Epsilon ${run}`, n(5), '', DEPT, ''],
    ];
    await page.getByRole('textbox', { name: /paste a list/i }).fill(rows.map((r) => r.join('\t')).join('\n'));
    await expect(page.getByRole('dialog').locator('tbody tr')).toHaveCount(5);
    await page.getByRole('button', { name: /add 5 people/i }).click();
    await expect(page.getByText('5 people added')).toBeVisible();
    await page.getByPlaceholder(/search name/i).fill(run);
    await expect(page.getByText(`Alpha ${run}`)).toBeVisible();
    await expect(page.getByText(`Epsilon ${run}`)).toBeVisible();
    if (shots) await page.screenshot({ path: 'docs/screenshots/desktop-users.png' });

    // Move Alpha from IT to Logistics (next column). Zoom out so both columns are on screen.
    await page.goto('/system/org-chart');
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom out' }).click();
    const alpha = page
      .locator('section[data-dept="IT"]')
      .getByRole('button', { name: new RegExp(`Alpha ${run}`) });
    await alpha.scrollIntoViewIfNeeded();
    // Drop on the team area (the head slot would make them HOD instead).
    await drag(
      page,
      alpha,
      page.locator('section[data-dept="Logistics"]').getByRole('button', { name: /add person/i }),
    );
    await expect(page.getByRole('dialog')).toContainText(`Alpha ${run} → Logistics`);
    await page.getByRole('button', { name: /move to logistics/i }).click();
    await expect(page.locator('section[data-dept="Logistics"]').getByText(`Alpha ${run}`)).toBeVisible();
    await expect(page.locator('section[data-dept="IT"]').getByText(`Alpha ${run}`)).toHaveCount(0);

    // Drop Delta on the head slot of our department.
    const column = page.locator(`section[data-dept="${DEPT}"]`);
    await column.scrollIntoViewIfNeeded();
    await drag(
      page,
      column.getByRole('button', { name: new RegExp(`Delta ${run}`) }),
      page.locator(`[data-hod-slot="${DEPT}"]`),
    );
    await expect(page.getByText(new RegExp(`Delta ${run} is now HOD of ${DEPT}`))).toBeVisible();
    await expect(page.locator(`[data-hod-slot="${DEPT}"]`)).toContainText('HOD');
    if (shots) await page.screenshot({ path: 'docs/screenshots/desktop-org-chart.png' });
  });

  // Leave the demo company as we found it: remove this run's people, then any empty E2E departments.
  test.afterEach(async ({ page }, info) => {
    if (info.project.name !== 'desktop') return;
    const origin = new URL(page.url()).origin;
    const headers = { origin };
    const users = (await (await page.request.get('/api/org/users')).json()) as { id: string; name: string }[];
    if (!Array.isArray(users)) return;
    const mine = /^(Alpha|Beta|Gamma|Delta|Epsilon) [0-9A-Z]{5}$/;
    for (const u of users.filter((x) => mine.test(x.name)))
      await page.request.delete(`/api/org/users/${u.id}`, { headers });
    const depts = (await (await page.request.get('/api/org/departments')).json()) as {
      id: string;
      name: string;
    }[];
    for (const d of depts.filter((x) => x.name.startsWith('E2E ')))
      await page.request.delete(`/api/org/departments/${d.id}`, { headers });
  });
});

test('System Master screens fit the screen', async ({ page }, info) => {
  await signIn(page);
  for (const [path, name] of [
    ['/system/company', 'company'],
    ['/system/departments', 'departments'],
    ['/system/users', 'users-list'],
    ['/system/roles', 'roles'],
    ['/system/org-chart', 'org-chart-view'],
    ['/system/appearance', 'appearance'],
  ] as const) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const width = page.viewportSize()!.width;
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `${path} is wider than the screen`,
    ).toBeLessThanOrEqual(width);
    if (shots) await page.screenshot({ path: `docs/screenshots/${info.project.name}-sys-${name}.png` });
  }
});
