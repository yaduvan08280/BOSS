import { expect, test, type Page } from '@playwright/test';

/** Phase 8: inventory on the demo company — stock today, moves, the order list, purchase orders, MAX review, audit. */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234';
const OWNER = '9000000000';
const GOPAL = '9000000123';
const shots = process.env.E2E_SCREENSHOTS === '1';

async function shot(page: Page, name: string, project: string) {
  if (shots) await page.screenshot({ path: `docs/screenshots/${project}-${name}.png`, fullPage: false });
}
async function settled(page: Page) {
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 10_000 });
}
async function signIn(page: Page, id: string) {
  await page.goto('/login');
  await page.getByLabel(/mobile number or email/i).fill(id);
  await page.getByLabel(/^password$/i).fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('heading', { name: /what do you want to do/i })).toBeVisible();
}
const headers = (page: Page) => ({ origin: new URL(page.url()).origin });

test('inventory screens fit the screen', async ({ page }, info) => {
  await signIn(page, OWNER);
  for (const [path, file] of [
    ['/ims/stock', 'ims-stock'],
    ['/ims/stock?tab=sheet', 'ims-sheet'],
    ['/ims/stock?tab=approvals', 'ims-approvals'],
    ['/ims/stock?tab=items', 'ims-items'],
    ['/ims/stock?tab=reports', 'ims-reports'],
    ['/ims/purchase', 'ims-ows'],
    ['/ims/purchase?tab=orders', 'ims-orders'],
    ['/ims/max-review', 'ims-review'],
    ['/ims/audit', 'ims-audit'],
    ['/ims/audit?tab=dead', 'ims-dead'],
    ['/system/inventory', 'ims-setup'],
    ['/system/inventory?tab=people', 'ims-setup-people'],
  ] as const) {
    await page.goto(path);
    await settled(page);
    const width = page.viewportSize()!.width;
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `${path} is wider than the screen`,
    ).toBeLessThanOrEqual(width);
    await shot(page, file, info.project.name);
  }
  // The demo has red items on the order list and reviews due.
  await page.goto('/ims/purchase');
  await expect(
    page
      .locator('main')
      .getByText('Polyester resin')
      .or(page.locator('main').getByText('MEKP hardener'))
      .first(),
  ).toBeVisible();
  await page.goto('/ims/max-review');
  await expect(page.getByRole('button', { name: 'Apply', exact: true }).first()).toBeVisible();
});

test('a stock out from the store, then order the item and receive it', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'changes stock');
  test.setTimeout(90_000);
  await signIn(page, GOPAL);
  await page.goto('/ims/stock');
  await settled(page);
  await page.getByPlaceholder('Type a code, name, category or vendor').fill('GN-002');
  await page
    .locator('main li')
    .filter({ hasText: 'Dust mask N95' })
    .getByRole('button', { name: 'In / out' })
    .click();
  await page.getByLabel(/Quantity/).fill('5');
  await page.getByLabel('Note').fill('E2E issue to Press 2');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Saved\. Now/)).toBeVisible();
  // More than in stock is stopped in the form.
  await page
    .locator('main li')
    .filter({ hasText: 'Dust mask N95' })
    .getByRole('button', { name: 'In / out' })
    .click();
  await page.getByLabel(/Quantity/).fill('999999');
  await expect(page.getByText(/^Only .* in stock$/)).toBeVisible();
  await page.keyboard.press('Escape');

  // The owner orders it by hand and Gopal receives it.
  const owner = await page.context().browser()!.newContext(info.project.use);
  const o = await owner.newPage();
  await signIn(o, OWNER);
  const items = (await (await o.request.get('/api/ims/items')).json()) as {
    items: { id: string; code: string; stock: number }[];
  };
  const mask = items.items.find((i) => i.code === 'GN-002')!;
  const po = (await (
    await o.request.post('/api/ims/po', {
      headers: headers(o),
      data: { vendor: 'Safety Store', lines: [{ itemId: mask.id, qty: 10 }] },
    })
  ).json()) as { id: string; number: string };
  await o.request.post(`/api/ims/po/${po.id}/send`, { headers: headers(o), data: {} });
  await owner.close();

  await page.goto('/ims/purchase?tab=orders');
  await page.getByPlaceholder('Type a PO number, vendor or item').fill(po.number);
  await page.locator('main li').filter({ hasText: po.number }).click();
  await page.getByLabel('Received now of Dust mask N95').fill('10');
  await shot(page, 'ims-receive', info.project.name);
  await page.getByRole('button', { name: 'Receive goods' }).click();
  await expect(page.getByText(`${po.number} fully received`)).toBeVisible();
  const after = (await (await page.request.get('/api/ims/items')).json()) as {
    items: { code: string; stock: number }[];
  };
  expect(after.items.find((i) => i.code === 'GN-002')!.stock).toBe(mask.stock + 10);
});
