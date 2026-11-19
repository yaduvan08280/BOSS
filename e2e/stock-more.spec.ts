import { expect, test } from '@playwright/test';
import { call, choose, expectNoSideScroll, settled, signIn, tag } from './phase11-kit';

/**
 * Stock screens that were proved through the API only (rows I9, I16, I20, I24, I27 and U27 of
 * docs/plans/coverage.md), now through the screens: goods received from a vendor, wastage written off, a price
 * list, a par level at a location and the route that supplies a branch.
 */
test('goods come in, some is wasted, a price list, a par level and a supply route', async ({
  page,
}, info) => {
  const t = tag(info.project.name);
  const dialog = page.getByRole('dialog');
  await signIn(page);
  const code = `ST-${t}`;
  const name = `Sealant tube ${t}`;
  const item = await call<{ id: string }>(page, 'POST', '/api/ims/items', {
    ...{ code, name, unit: 'pcs', ratePaise: 25_00, openingQty: 0 },
  });
  const branch = await call<{ id: string }>(page, 'POST', '/api/org/branches', {
    name: `Depot ${t}`,
    code: `D${t}`,
  });
  const shelf = `Shelf ${t}`;
  await call(page, 'POST', '/api/branches/locations', { branchId: branch.id, name: shelf, kind: 'STORE' });
  const stock = async () => {
    const got = await call<{ id: string; stock: number }[] | { items: { id: string; stock: number }[] }>(
      page,
      'GET',
      '/api/ims/items',
    );
    return Number((Array.isArray(got) ? got : got.items).find((x) => x.id === item.id)!.stock);
  };

  // I16: forty tubes arrive from a vendor and go into the main store.
  await page.goto('/ims/receipts');
  await settled(page);
  await page.getByRole('button', { name: 'Receive goods' }).click();
  await dialog.getByLabel('Vendor', { exact: true }).fill(`Seal Works ${t}`);
  await choose(page, dialog.getByRole('combobox', { name: 'Item' }), code);
  await dialog.getByLabel('Quantity', { exact: true }).fill('40');
  await dialog.getByLabel('Rate (₹)', { exact: true }).fill('25');
  await dialog.getByRole('button', { name: 'Receive', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(`Seal Works ${t}`).first()).toBeVisible();
  await expect.poll(stock).toBe(40);
  await expectNoSideScroll(page);

  // I20: three are spoiled; the stock goes down at once (a small loss needs no approver).
  await page.goto('/ims/wastage');
  await settled(page);
  await page.getByRole('button', { name: 'Record wastage' }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Item' }), code);
  await dialog.getByLabel('Quantity', { exact: true }).fill('3');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(name).first()).toBeVisible();
  await expect.poll(stock).toBe(37);
  await expectNoSideScroll(page);

  // U27: a price list with the item at its own price.
  await page.goto('/ims/prices');
  await settled(page);
  await page.getByRole('button', { name: 'New price list' }).click();
  await dialog.getByLabel('Name', { exact: true }).fill(`Dealers ${t}`);
  await choose(page, dialog.getByRole('combobox', { name: 'Item' }), code);
  await dialog.getByLabel('Price (₹)', { exact: true }).fill('32');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(`Dealers ${t}`).first()).toBeVisible();
  await expectNoSideScroll(page);

  // I24: the shelf should hold twenty; it holds none, so twenty are to be asked for.
  await page.goto('/ims/locations');
  await settled(page);
  await page.getByRole('tab', { name: 'Par levels' }).click();
  await choose(page, page.getByRole('combobox', { name: 'Location' }), shelf);
  await choose(page, page.getByRole('combobox', { name: 'Item' }), code);
  await page.getByLabel('Level', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('main').getByText(name).first()).toBeVisible();
  await expectNoSideScroll(page);

  // I9: the depot is supplied from the main store, at cost.
  await page.goto('/ims/transfers');
  await settled(page);
  await page.getByRole('button', { name: 'Supply routes' }).click();
  await choose(page, dialog.getByRole('combobox').first(), `Depot ${t}`);
  await choose(page, dialog.getByRole('combobox', { name: 'Supplied from' }), 'Main store');
  await dialog.getByRole('button', { name: 'Save the route' }).click();
  await expect(dialog.getByText(`Depot ${t}`).first()).toBeVisible();
  await expectNoSideScroll(page);
});
