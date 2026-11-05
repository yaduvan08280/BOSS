import { expect, test, type Page } from '@playwright/test';

/** Phase 9: the Sales CRM on the demo company — the plan journey, the daily screens, a call that takes an order. */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234';
const OWNER = '9000000000';
const SUNITA = '9000000121';
const shots = process.env.E2E_SCREENSHOTS === '1';

async function shot(page: Page, name: string, project: string) {
  if (shots) await page.screenshot({ path: `docs/screenshots/${project}-${name}.png`, fullPage: false });
}
async function settled(page: Page) {
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 });
}
async function signIn(page: Page, id: string) {
  await page.goto('/login');
  await page.getByLabel(/mobile number or email/i).fill(id);
  await page.getByLabel(/^password$/i).fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('heading', { name: /what do you want to do/i })).toBeVisible();
}
const headers = (page: Page) => ({ origin: new URL(page.url()).origin });

test('sales CRM screens fit the screen', async ({ page }, info) => {
  test.setTimeout(120_000);
  await signIn(page, OWNER);
  const pages = [
    ['/crm', 'crm-dashboard'],
    ['/crm/customers', 'crm-customers'],
    ['/crm/scot', 'crm-scot'],
    ['/crm/calls', 'crm-calls'],
    ['/crm/orders', 'crm-orders'],
    ['/crm/collections', 'crm-collections'],
    ['/crm/nbd', 'crm-nbd'],
    ['/crm/meca', 'crm-meca'],
    ['/system/crm', 'crm-fields'],
    ...[
      'overview',
      'year',
      'quarters',
      'months',
      'weeks',
      'business',
      'sellTo',
      'seats',
      'split',
      'customerRules',
      'afterOrder',
      'nbd',
      'holidays',
      'seasons',
      'rounding',
    ].map((p) => [`/crm/setup?page=${p}`, `crm-setup-${p}`]),
  ] as const;
  for (const [path, file] of pages) {
    await page.goto(path);
    await settled(page);
    const width = page.viewportSize()!.width;
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `${path} is wider than the screen`,
    ).toBeLessThanOrEqual(width);
    await shot(page, file, info.project.name);
  }
  // The demo plan: approved, and the weeks add up to the month and the year.
  await page.goto('/crm/setup?page=weeks');
  await expect(page.getByText('Approved').first()).toBeVisible();
  await expect(page.getByText(/All 12 months add up to ₹7,50,00,000/)).toBeVisible();
});

test('a SCOT call takes an order that lands on CRM Orders', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'changes sales data');
  test.setTimeout(90_000);
  await signIn(page, SUNITA);
  await page.goto('/crm/calls');
  await settled(page);
  const card = page
    .locator('main li')
    .filter({ has: page.getByRole('button', { name: 'Order', exact: true }) })
    .first();
  const name = (await card.locator('.font-semibold').first().textContent())!.trim();
  await card.getByRole('button', { name: 'Order', exact: true }).click();
  await page.getByLabel('Amount (before GST)').fill('150000');
  await shot(page, 'crm-call-order', info.project.name);
  await page.getByRole('button', { name: 'Save the result' }).click();
  await expect(page.getByText(/Order SO\/\d{2}-\d{2}\/\d{4} taken/)).toBeVisible();
  await page.goto('/crm/orders');
  await expect(page.locator('section[aria-label="Confirm order"]').getByText(name).first()).toBeVisible();

  // Clean up: the owner cancels the order (its after-order record is cancelled too).
  const ctx = await browser.newContext(info.project.use);
  const o = await ctx.newPage();
  await signIn(o, OWNER);
  const board = (await (await o.request.get('/api/crm/orders')).json()) as {
    columns: { cards: { id: string; customer: string; amount: string }[] }[];
  };
  const mine = board.columns
    .flatMap((c) => c.cards)
    .find((c) => c.customer === name && c.amount === '15000000')!;
  expect(
    (
      await o.request.post(`/api/crm/orders/${mine.id}/cancel`, {
        headers: headers(o),
        data: { reason: 'E2E clean-up' },
      })
    ).ok(),
  ).toBe(true);
  await ctx.close();
});

test('the plan: unlock, change a month keeping the year, approve again', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'changes the plan');
  await signIn(page, OWNER);
  await page.goto('/crm/setup?page=months');
  await settled(page);
  try {
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.getByRole('button', { name: 'Unlock' }).last().click();
    await expect(page.getByText('Draft').first()).toBeVisible();
    await page.getByRole('button', { name: /^Change .*October/ }).click();
    await page.getByLabel('Turnover', { exact: true }).fill('9500000');
    await page.getByRole('radio', { name: 'Keep the year total — adjust other months' }).click();
    await shot(page, 'crm-month-dialog', info.project.name);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('All 12 months add up to ₹7,50,00,000.')).toBeVisible();
    const plan = (await (await page.request.get('/api/crm/plan')).json()) as {
      view: { months: { month: string; turnover: number }[]; addsUp: boolean };
    };
    expect(plan.view.months.find((m) => m.month.endsWith('-10'))!.turnover).toBe(95_00_000_00);
    expect(plan.view.addsUp).toBe(true);
  } finally {
    // Back to the demo's plan, approved.
    await page.request
      .put('/api/crm/plan', {
        headers: headers(page),
        data: { input: { monthGrowthPct: 0 }, resetMonths: true },
      })
      .catch(() => undefined);
    await page.request.post('/api/crm/plan/submit', { headers: headers(page), data: {} });
    await page.request.post('/api/crm/plan/approve', { headers: headers(page), data: {} });
  }
});
