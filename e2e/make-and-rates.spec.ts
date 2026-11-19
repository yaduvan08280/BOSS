import { expect, test } from '@playwright/test';
import { call, choose, expectNoSideScroll, settled, signIn, tag } from './phase11-kit';

/**
 * Two more screens that had no browser test: a month's exchange rate (G34 of docs/plans/coverage.md) and a
 * recipe with a production order made and finished from it (I12, I14) — the ingredient leaves the main store and
 * what was made comes in.
 */
test('a month’s exchange rate is typed and kept', async ({ page }) => {
  await signIn(page);
  await page.goto('/system/branches');
  await settled(page);
  await page.getByRole('tab', { name: 'Exchange rates' }).click();
  const rate = page.getByLabel(/^Rupees for 1 [A-Z]{3}$/).first();
  await expect(rate).toBeVisible();
  // A different rate on every run: typing the rate that is already saved changes nothing, and Save stays off.
  const value = (20 + (Date.now() % 900) / 100).toFixed(2);
  await rate.fill(value);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();
  await page.reload();
  await settled(page);
  await page.getByRole('tab', { name: 'Exchange rates' }).click();
  await expect(page.getByLabel(/^Rupees for 1 [A-Z]{3}$/).first()).toHaveValue(String(Number(value)));
  await expectNoSideScroll(page);
});

test('a recipe, and a production order made and finished from it', async ({ page }, info) => {
  const t = tag(info.project.name);
  const dialog = page.getByRole('dialog');
  await signIn(page);
  const raw = await call<{ id: string }>(page, 'POST', '/api/ims/items', {
    ...{ code: `RM-${t}`, name: `Resin ${t}`, unit: 'kg', ratePaise: 100_00, openingQty: 50 },
  });
  const made = await call<{ id: string }>(page, 'POST', '/api/ims/items', {
    ...{ code: `MK-${t}`, name: `Sealer ${t}`, unit: 'kg', ratePaise: 0, openingQty: 0 },
  });
  await call(page, 'PUT', `/api/ims/items/${made.id}/extras`, { made: 'MAKE', tracking: 'BATCH' });
  const stockOf = async (id: string) => {
    const got = await call<{ id: string; stock: number }[] | { items: { id: string; stock: number }[] }>(
      page,
      'GET',
      '/api/ims/items',
    );
    return Number((Array.isArray(got) ? got : got.items).find((x) => x.id === id)!.stock);
  };

  // I12: ten kilos of sealer take four kilos of resin.
  await page.goto('/ims/kitchen');
  await settled(page);
  await page.getByRole('button', { name: 'New recipe' }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Makes' }), `MK-${t}`);
  await dialog.getByLabel('Makes how much').fill('10');
  await choose(page, dialog.getByRole('combobox', { name: 'Ingredient' }), `RM-${t}`);
  await dialog.getByLabel('Quantity', { exact: true }).fill('4');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(`Sealer ${t}`).first()).toBeVisible();
  await expectNoSideScroll(page);

  // I14: twenty kilos are planned and finished: eight kilos of resin go, twenty of sealer come in.
  await page.getByRole('tab', { name: 'Production' }).click();
  await page.getByRole('button', { name: 'Plan production' }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Makes' }), `MK-${t}`);
  await dialog.getByLabel('Quantity', { exact: true }).fill('20');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const order = page.locator('main li', { hasText: `Sealer ${t}` }).first();
  await order.getByRole('button', { name: /^Finish/ }).click();
  await dialog.getByRole('button', { name: /^(Finish|Save)/ }).click();
  await expect(page.getByText('Production recorded').first()).toBeVisible();
  await expect.poll(() => stockOf(raw.id)).toBe(42);
  await expect.poll(() => stockOf(made.id)).toBe(20);
  await expectNoSideScroll(page);
});
