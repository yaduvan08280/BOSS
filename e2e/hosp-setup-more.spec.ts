import { expect, test } from '@playwright/test';
import { call, choose, expectNoSideScroll, settled, signIn, tag } from './phase11-kit';

/**
 * Hospitality set-up screens that had no browser test (rows S6, S7, S9, S13, S14 of docs/plans/coverage.md):
 * a printer and where an outlet's tickets go, what a role may give by itself, an add-on group, and the hours
 * a dish can be ordered in.
 */
test('a printer and ticket routing, a role’s limit, an add-on group and a dish’s hours', async ({
  page,
}, info) => {
  const t = tag(info.project.name);
  const dialog = page.getByRole('dialog');
  await signIn(page);
  await call(page, 'PUT', '/api/hosp/settings', { enabled: true });
  const branches = await call<{ id: string }[] | { branches: { id: string }[] }>(
    page,
    'GET',
    '/api/org/branches',
  );
  const branch = (Array.isArray(branches) ? branches : branches.branches)[0]!;
  const outletName = `Terrace ${t}`;
  const outlet = await call<{ id: string }>(page, 'POST', '/api/hosp/outlets', {
    name: outletName,
    branchId: branch.id,
  });
  await call(page, 'POST', '/api/hosp/stations', { outletId: outlet.id, name: `Grill ${t}` });
  const cat = await call<{ id: string }>(page, 'POST', '/api/hosp/menu/categories', { name: `Lunch ${t}` });
  const dish = `Thali ${t}`;
  const item = await call<{ id: string }>(page, 'POST', '/api/hosp/menu/items', {
    ...{ categoryId: cat.id, outletIds: [outlet.id], name: dish, price: 240_00 },
  });

  // S6: a kitchen printer on the network.
  await page.goto('/system/hospitality');
  await settled(page);
  await page.getByRole('tab', { name: 'Printers & stations' }).click();
  await page.getByLabel('Name', { exact: true }).fill(`Pass ${t}`);
  await page.getByLabel('Address', { exact: true }).fill('10.0.0.9:9100');
  await page.getByRole('button', { name: 'Add a printer' }).click();
  await expect(page.getByText(`Pass ${t}`).first()).toBeVisible();

  // S7: everything this outlet sends goes to its grill station.
  await choose(page, page.getByRole('combobox', { name: 'Outlet', exact: true }), outletName);
  await choose(page, page.getByRole('combobox', { name: 'Station for Everything else' }), `Grill ${t}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();
  await expectNoSideScroll(page);

  // S9: a supervisor may give up to 12 % by themselves; the rule is kept.
  await page.getByRole('tab', { name: 'Discounts, day close & payments' }).click();
  await page.getByLabel('Up to % for Supervisor').fill('12');
  await page.getByRole('button', { name: 'Save the rules' }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();
  await page.reload();
  await settled(page);
  await page.getByRole('tab', { name: 'Discounts, day close & payments' }).click();
  await expect(page.getByLabel('Up to % for Supervisor')).toHaveValue('12');
  await expectNoSideScroll(page);

  // S13: an add-on group with one priced option.
  await page.goto('/hosp/menu');
  await settled(page);
  await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add a group' }).click();
  const group = dialog.last();
  await group.getByLabel('Name', { exact: true }).fill(`Spice ${t}`);
  await group.getByLabel('Option', { exact: true }).fill('Extra hot');
  await group.getByLabel('Extra ₹', { exact: true }).fill('20');
  await group.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByText(`Spice ${t}`).first()).toBeVisible();
  await expect(dialog.getByText('Extra hot +₹20.00').first()).toBeVisible();
  await page.keyboard.press('Escape');

  // S14: the thali can be ordered at lunch only.
  await page.getByLabel('Search the menu').fill(dish);
  await page.getByRole('button', { name: 'Hours & prices' }).first().click();
  await expect(dialog.getByRole('heading', { name: new RegExp(`^${dish}`) })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add hours' }).click();
  await dialog.getByLabel('From', { exact: true }).fill('12:00');
  await dialog.getByLabel('To', { exact: true }).fill('15:00');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await call<{ items: { id: string; windows: { fromMin: number; toMin: number }[] | null }[] }>(
    page,
    'GET',
    '/api/hosp/menu',
  );
  expect(saved.items.find((x) => x.id === item.id)?.windows?.[0]).toMatchObject({ fromMin: 720, toMin: 900 });
  await expectNoSideScroll(page);
});
