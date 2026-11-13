import { expect, test } from '@playwright/test';
import { call, choose, expectNoSideScroll, settled, signIn, tag } from './phase11-kit';

const shots = process.env.E2E_SCREENSHOTS === '1';

/**
 * Phase 15 through the screens (rows P1–P5, P7–P9, P15, P16, P19, P23, P31, P32, P40 of docs/plans/coverage.md): a
 * table is seated, its order (a dish with a size, a held main, a drink) goes to the kitchen, the kitchen marks it
 * ready and bumps the ticket, an item is voided with a reason, the bill is made and paid, and the day is closed.
 * The outlet, its tables, menu and a cash mode are set up through the API — a fresh outlet every run, so closing
 * its day does not stop the next run.
 */
test('a table from seating to a closed day', async ({ page }, info) => {
  const project = info.project.name;
  const snap = async (name: string) => {
    if (shots) await page.screenshot({ path: `docs/screenshots/phase15/${project}-${name}.png` });
  };
  const t = tag(project);
  const n = {
    outlet: `Bistro ${t}`,
    tikka: `Tikka ${t}`,
    dal: `Dal ${t}`,
    cola: `Cola ${t}`,
    cash: `Cash ${t}`,
  };
  const dialog = page.getByRole('dialog');
  await signIn(page);
  await call(page, 'PUT', '/api/hosp/settings', { enabled: true });
  const branches = await call<{ branches: { id: string }[] } | { id: string }[]>(
    page,
    'GET',
    '/api/org/branches',
  );
  const branchId = (Array.isArray(branches) ? branches : branches.branches)[0]!.id;
  const outlet = await call<{ id: string }>(page, 'POST', '/api/hosp/outlets', {
    name: n.outlet,
    branchId,
    charges: { serviceChargePct: 10 },
  });
  await call(page, 'POST', '/api/hosp/stations', { outletId: outlet.id, name: 'Kitchen' });
  const floor = await call<{ id: string }>(page, 'POST', '/api/hosp/floors', {
    outletId: outlet.id,
    name: 'Hall',
  });
  await call(page, 'POST', '/api/hosp/tables/bulk', { floorId: floor.id, count: 3 });
  const cat = await call<{ id: string }>(page, 'POST', '/api/hosp/menu/categories', { name: `Food ${t}` });
  const item = (body: object) =>
    call(page, 'POST', '/api/hosp/menu/items', { categoryId: cat.id, outletIds: [outlet.id], ...body });
  await item({
    name: n.tikka,
    price: 32000,
    variants: [
      { key: 'half', name: 'Half', price: 18000, factor: 0.5 },
      { key: 'full', name: 'Full', price: 32000 },
    ],
  });
  await item({ name: n.dal, price: 28000 });
  await item({ name: n.cola, price: 8000 });
  await call(page, 'POST', '/api/money/modes', { name: n.cash, kind: 'CASH' });

  // P1, P2: the floor; a free table is seated.
  await page.goto('/hosp/pos');
  await settled(page);
  await choose(page, page.getByRole('combobox', { name: 'Outlet', exact: true }), n.outlet);
  await expect(page.getByRole('button', { name: /^T1\s*Free/ })).toBeVisible();
  await expectNoSideScroll(page);
  await snap('floor');
  await page.getByRole('button', { name: /^T1\s*Free/ }).click();
  await dialog.getByLabel('Guests').fill('2');
  await dialog.getByRole('button', { name: 'Start the order' }).click();
  const panel = page.getByRole('dialog', { name: /^Order \d+/ });
  await expect(panel).toBeVisible();

  // P3, P4: a dish with its size, a main that is held, a drink.
  await panel.getByRole('button', { name: new RegExp(n.tikka) }).click();
  const picker = page.getByRole('dialog', { name: n.tikka });
  await picker.getByRole('radio', { name: /Full/ }).click();
  await picker.getByRole('button', { name: 'Add to the order' }).click();
  await panel.getByRole('button', { name: new RegExp(`^${n.dal}`) }).click();
  await panel.getByRole('button', { name: new RegExp(`^${n.cola}`) }).click();
  await panel.getByRole('button', { name: `One more ${n.cola}` }).click();
  await panel.getByLabel(`Note for ${n.tikka}`).fill('Less spicy');
  await panel.locator('li', { hasText: n.dal }).getByRole('checkbox').check();
  await snap('cart');
  await panel.getByRole('button', { name: 'Send 4 items to the kitchen' }).click();
  // P5: the fired lines are in the kitchen, the held one waits.
  await expect(panel.locator('li', { hasText: n.tikka }).getByText('In the kitchen')).toBeVisible();
  await expect(panel.locator('li', { hasText: n.dal }).getByText('Held')).toBeVisible();
  await panel.getByRole('button', { name: 'Fire what is held' }).click();
  await expect(panel.locator('li', { hasText: n.dal }).getByText('In the kitchen')).toBeVisible();
  // P7: one cola too many — voided with a reason (the owner needs nobody's yes).
  await panel.getByRole('button', { name: `Void ${n.dal}` }).click();
  const voidBox = page.getByRole('dialog', { name: `Void ${n.dal}` });
  await voidBox.getByLabel('Why is it being voided?').fill('Guest changed their mind');
  await voidBox.getByRole('button', { name: 'Void', exact: true }).click();
  await expect(panel.locator('li', { hasText: n.dal }).getByText('Voided')).toBeVisible();
  await expectNoSideScroll(page);
  expect(
    await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    'the order panel is wider than the screen',
  ).toBe(true);
  await snap('order');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^T1\s*Ordered/ })).toBeVisible();

  // P8, P9: the kitchen sees the ticket, marks an item ready and bumps it; it can be recalled.
  await page.goto('/hosp/kds');
  await settled(page);
  await choose(page, page.getByRole('combobox', { name: 'Outlet', exact: true }), n.outlet);
  const ticket = page.locator('li', { hasText: 'KOT 1 · T1' });
  await expect(ticket.getByText('Less spicy')).toBeVisible();
  await expect(ticket.getByText('Kitchen · Dine-in')).toBeVisible();
  await ticket.getByRole('button', { name: new RegExp(n.tikka) }).click();
  await expect(ticket.getByRole('button', { name: new RegExp(n.tikka), pressed: true })).toBeVisible();
  await expectNoSideScroll(page);
  await snap('kds');
  await ticket.getByRole('button', { name: 'Bump' }).click();
  await expect(page.locator('li', { hasText: 'KOT 1 · T1' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Bumped' }).click();
  await expect(
    page.locator('li', { hasText: 'KOT 1 · T1' }).getByRole('button', { name: 'Recall' }),
  ).toBeVisible();

  // P15, P16, P19, P23: the bill — ₹480 of food, 10 % service, no tax typed — and cash for all of it.
  await page.goto('/hosp/pos');
  await settled(page);
  await choose(page, page.getByRole('combobox', { name: 'Outlet', exact: true }), n.outlet);
  await page.getByRole('button', { name: /^T1\s*Ordered/ }).click();
  await panel.getByRole('button', { name: 'Bill', exact: true }).click();
  const billBox = page.getByRole('dialog', { name: /^Bill/ }).last();
  await billBox.getByRole('button', { name: 'Make the bill' }).click();
  await expect(billBox.getByText('₹528').first()).toBeVisible();
  await snap('bill');
  await choose(page, billBox.getByRole('combobox', { name: 'Paid by' }), n.cash);
  await expect(billBox.getByLabel('Amount', { exact: true })).toHaveValue('528');
  await billBox.getByRole('button', { name: 'Take the payment' }).click();
  await expect(page.getByText('Paid — the table is free')).toBeVisible();
  await expect(page.getByRole('button', { name: /^T1\s*Free/ })).toBeVisible();

  // P31, P32: the day's report, the cash counted, the day closed.
  await page.goto('/hosp/day');
  await settled(page);
  await choose(page, page.getByRole('combobox', { name: 'Outlet', exact: true }), n.outlet);
  await expect(page.getByText('1 bills · 2 guests')).toBeVisible();
  await page.getByLabel('Notes of ₹500', { exact: true }).fill('1');
  await page.getByLabel('Notes of ₹20', { exact: true }).fill('1');
  await page.getByLabel('Notes of ₹5', { exact: true }).fill('1');
  await expect(page.getByText('Counted: ₹525')).toBeVisible();
  await expectNoSideScroll(page);
  await snap('day');
  await page.getByRole('button', { name: 'Close the day' }).click();
  await expect(page.getByText('Day closed', { exact: true })).toBeVisible();
  await expect(page.getByText(/Counted ₹525.* difference -₹3/)).toBeVisible();
  // A closed day takes no new order.
  const refused = await page.request.post('/api/pos/orders', {
    data: { outletId: outlet.id, type: 'TAKEAWAY' },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(refused.status()).toBe(409);
});
