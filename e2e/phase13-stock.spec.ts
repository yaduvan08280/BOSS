import { expect, test } from '@playwright/test';
import { call, choose, expectNoSideScroll, settled, signIn, tag } from './phase11-kit';

const shots = process.env.E2E_SCREENSHOTS === '1';

/**
 * Phase 13 through the screens (rows I1–I3, I7, I8, I10, I21, I24, I25, U28 of docs/plans/coverage.md): a case of
 * whisky is received into a store, moved to the bar, given a peg recipe, a bottle is broken and the bar is counted.
 * The item, its units and the two locations are set up through the API.
 */
test('whisky: received by the case, moved to the bar, a recipe, breakage and a blind count', async ({ page }, info) => {
  const project = info.project.name;
  const snap = async (name: string) => {
    if (shots) await page.screenshot({ path: `docs/screenshots/phase13/${project}-${name}.png` });
  };
  const t = tag(project);
  const n = { store: `Store ${t}`, bar: `Bar ${t}`, whisky: `Whisky ${t}`, peg: `Peg ${t}` };
  const dialog = page.getByRole('dialog');
  await signIn(page);
  const branches = await call<{ branches: { id: string }[] } | { id: string }[]>(page, 'GET', '/api/org/branches');
  const branchId = (Array.isArray(branches) ? branches : branches.branches)[0]!.id;
  for (const [name, kind] of [
    [n.store, 'STORE'],
    [n.bar, 'BAR'],
  ])
    await call(page, 'POST', '/api/branches/locations', { branchId, name, kind });
  const whisky = await call<{ id: string }>(page, 'POST', '/api/ims/items', { code: `W${t}`, name: n.whisky, unit: 'ml' });
  await call(page, 'PUT', `/api/ims/items/${whisky.id}/extras`, {
    units: [
      { unit: 'bottle', factor: 750 },
      { unit: 'case', factor: 9000 },
      { unit: 'peg', factor: 30, serve: true },
    ],
  });
  const peg = await call<{ id: string }>(page, 'POST', '/api/ims/items', { code: `P${t}`, name: n.peg, unit: 'peg' });
  await call(page, 'PUT', `/api/ims/items/${peg.id}/extras`, { made: 'DISH', sellPrice: 45000 });

  // I1, I3, I25: a case comes into the store; it is kept in ml and read as bottles.
  await page.goto('/ims/locations');
  await settled(page);
  await expectNoSideScroll(page);
  await page.getByRole('button', { name: 'Stock entry' }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Location', exact: true }), n.store);
  await choose(page, dialog.getByRole('combobox', { name: 'Item', exact: true }), n.whisky);
  await dialog.getByLabel('Quantity', { exact: true }).fill('1');
  await dialog.getByLabel(/^Unit/).fill('case');
  await dialog.getByLabel('Rate (₹)').fill('12000');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel('Search item or code').fill(n.whisky);
  await expect(page.getByText('12 bottle + 0 ml open')).toBeVisible();
  await snap('stock');
  // The item's settings open and show what was set.
  await page.getByRole('button', { name: 'How an item is kept' }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Item', exact: true }), n.whisky);
  await expect(dialog.getByLabel(/Other units/)).toHaveValue('bottle=750, case=9000, peg=30*');
  await snap('item-kept');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // I2, I10: two bottles go to the bar — dispatched, on the road, received.
  await page.goto('/ims/transfers');
  await settled(page);
  await page.getByRole('button', { name: 'Ask for stock' }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Kind', exact: true }), 'Our own transfer');
  await choose(page, dialog.getByRole('combobox', { name: 'For which location' }), n.bar);
  await choose(page, dialog.getByRole('combobox', { name: 'Who supplies' }), n.store);
  await choose(page, dialog.getByRole('combobox', { name: 'Item', exact: true }), n.whisky);
  await dialog.getByLabel('Quantity', { exact: true }).fill('2');
  await dialog.getByLabel(/^Unit/).fill('bottle');
  await dialog.getByRole('button', { name: 'Send the request' }).click();
  await expect(dialog).toHaveCount(0);
  const row = page.locator('li', { hasText: n.bar }).first();
  await row.getByRole('button').click();
  await dialog.getByRole('button', { name: 'Dispatch' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('tab', { name: 'On the road' }).click();
  await expect(row).toBeVisible();
  await snap('in-transit');
  await row.getByRole('button').click();
  await dialog.getByRole('button', { name: 'Receive' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('tab', { name: 'Finished' }).click();
  await expect(row.getByText('Closed')).toBeVisible();
  await expectNoSideScroll(page);

  // I7, I8: the peg's recipe — two 30 ml pegs of the bottle — with its cost.
  await page.goto('/ims/kitchen');
  await settled(page);
  await page.getByRole('button', { name: 'New recipe' }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Makes', exact: true }), n.peg);
  await choose(page, dialog.getByRole('combobox', { name: 'Ingredient', exact: true }), n.whisky);
  await dialog.getByLabel('Quantity', { exact: true }).fill('2');
  await dialog.getByLabel(/^Unit/).fill('peg');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  // 60 ml of a ₹12,000 case of 9 000 ml = ₹80; against ₹450 that is 17.8 %.
  const recipe = page.locator('li', { hasText: n.peg });
  await expect(recipe.getByText('₹80')).toBeVisible();
  await expect(recipe.getByText(/17\.8% of/)).toBeVisible();
  await snap('recipe');
  await page.getByRole('tab', { name: 'Production' }).click();
  await settled(page);
  await expectNoSideScroll(page);

  // I21: a bottle is dropped at the bar.
  await page.goto('/ims/wastage');
  await settled(page);
  await page.getByRole('button', { name: 'Record wastage' }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Item', exact: true }), n.whisky);
  await choose(page, dialog.getByRole('combobox', { name: 'Location', exact: true }), n.bar);
  await dialog.getByLabel('Quantity', { exact: true }).fill('20');
  await choose(page, dialog.getByRole('combobox', { name: 'Why', exact: true }), 'Breakage');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('li', { hasText: n.whisky }).getByText('Breakage')).toBeVisible();
  await expectNoSideScroll(page);
  await snap('wastage');

  // I24: a blind count of the bar: 1 480 ml are there; 1 470 are counted.
  await page.goto('/ims/counts');
  await settled(page);
  await page.getByRole('button', { name: 'Start a count' }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Location', exact: true }), n.bar);
  await dialog.getByRole('button', { name: 'Start counting' }).click();
  const counted = dialog.getByLabel(`Counted: ${n.whisky}`);
  await expect(counted).toBeVisible();
  await expect(dialog.getByText(/system \d/)).toHaveCount(0);
  await counted.fill('1470');
  await snap('count');
  await dialog.getByRole('button', { name: 'Submit the count' }).click();
  await expect(dialog.getByText(/-10 ml/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('li', { hasText: n.bar }).getByText('Waiting for approval')).toBeVisible();
  await expectNoSideScroll(page);

  // U28 and the remaining screens: a rate on the board; receipts and prices fit the screen.
  await page.goto('/ims/prices');
  await settled(page);
  await page.getByRole('tab', { name: 'Rate board' }).click();
  await page.getByLabel('Rate name').fill(`G${t}`);
  await page.getByLabel("Today's rate (₹)").fill('7350');
  await page.getByRole('button', { name: 'Set', exact: true }).click();
  await expect(page.getByText(`G${t}`, { exact: true })).toBeVisible();
  await expectNoSideScroll(page);
  await snap('rate-board');
  await page.goto('/ims/receipts');
  await settled(page);
  await expectNoSideScroll(page);
});
