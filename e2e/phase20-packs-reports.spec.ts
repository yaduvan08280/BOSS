import { expect, test } from '@playwright/test';
import { call, expectNoSideScroll, settled, signIn, tag } from './phase11-kit';

const shots = process.env.E2E_SCREENSHOTS === '1';

/**
 * Phase 20 through the screens (rows U37, U39, F1–F4 of docs/plans/coverage.md): the hospitality pack on the
 * Master Library's Packs card and this company's set-up saved as a pack file; then the hospitality reports of
 * a day on which one table was served — the flash, sales, kitchen times, voids and discounts, the team's week.
 */
test('packs: the hospitality pack is installed and the company’s set-up is saved as a file', async ({
  page,
}, info) => {
  const t = tag(info.project.name);
  await signIn(page);
  await page.goto('/masters/library');
  await settled(page);
  const card = page.getByTestId('pack-hospitality');
  await expect(card.getByText('Hotel & restaurant')).toBeVisible();
  const install = card.getByRole('button', { name: 'Install' });
  // The demo company keeps the pack once a run has installed it.
  if (await install.count()) {
    await install.click();
    await expect(
      page.getByText(/^Hotel & restaurant installed: \d+ added, \d+ already there$/),
    ).toBeVisible();
  }
  await expect(card.getByText('Installed · v1')).toBeVisible();
  const packs = page.getByTestId('packs');
  await expect(packs.getByText(/Hotel & restaurant · v1 · \d+ things/)).toBeVisible();
  await expectNoSideScroll(page);
  if (shots) await page.screenshot({ path: `docs/screenshots/phase20/${info.project.name}-packs.png` });
  // The pack brought the hotel's roles.
  const roles = await call<{ roles: { name: string }[] }>(page, 'GET', '/api/org/roles');
  expect(roles.roles.map((r) => r.name)).toEqual(
    expect.arrayContaining(['Steward / captain', 'Night auditor', 'General manager']),
  );

  // This company's own set-up as a pack file.
  await packs.getByLabel("Save this company's set-up as a pack called").fill(`Demo set-up ${t}`);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    packs.getByRole('button', { name: 'Save as a file' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^demo_set_up_.*\.mono-pack\.json$/);
  await expect(page.getByText('Pack file saved')).toBeVisible();
});

test('hospitality reports of a day: the flash, sales, kitchen times, voids and discounts, the team', async ({
  page,
}, info) => {
  const project = info.project.name;
  const t = tag(project);
  const n = { outlet: `Bistro ${t}`, dal: `Dal ${t}`, naan: `Naan ${t}` };
  await signIn(page);
  await call(page, 'PUT', '/api/hosp/settings', { enabled: true });
  const branches = await call<{ branches: { id: string }[] } | { id: string }[]>(
    page,
    'GET',
    '/api/org/branches',
  );
  const branchId = (Array.isArray(branches) ? branches : branches.branches)[0]!.id;
  const outlet = await call<{ id: string }>(page, 'POST', '/api/hosp/outlets', { name: n.outlet, branchId });
  await call(page, 'POST', '/api/hosp/stations', { outletId: outlet.id, name: `Pass ${t}` });
  const cat = await call<{ id: string }>(page, 'POST', '/api/hosp/menu/categories', { name: `Food ${t}` });
  const item = (name: string, price: number) =>
    call<{ id: string }>(page, 'POST', '/api/hosp/menu/items', {
      categoryId: cat.id,
      outletIds: [outlet.id],
      name,
      price,
    });
  const dal = await item(n.dal, 28000);
  const naan = await item(n.naan, 6000);
  const cash = await call<{ id: string }>(page, 'POST', '/api/money/modes', {
    name: `Cash ${t}`,
    kind: 'CASH',
  });
  // One takeaway: two dals and a naan; the naan is voided after it was sent; 5 % off; paid in cash.
  const order = await call<{ id: string }>(page, 'POST', '/api/pos/orders', {
    outletId: outlet.id,
    type: 'TAKEAWAY',
    tableIds: [],
    covers: 2,
  });
  await call(page, 'POST', `/api/pos/orders/${order.id}/items`, {
    items: [
      { menuItemId: dal.id, qty: 2 },
      { menuItemId: naan.id, qty: 1 },
    ],
    fire: true,
  });
  const full = await call<{ businessDay: string; items: { id: string; name: string }[] }>(
    page,
    'GET',
    `/api/pos/orders/${order.id}`,
  );
  await call(
    page,
    'POST',
    `/api/pos/orders/${order.id}/items/${full.items.find((i) => i.name === n.naan)!.id}/void`,
    { reason: 'Guest changed their mind' },
  );
  const check = await call<{ id: string; total: number }>(page, 'POST', `/api/pos/orders/${order.id}/check`, {
    discount: { kind: 'PERCENT', value: 5, reason: 'Regular guest' },
  });
  await call(page, 'POST', `/api/pos/checks/${check.id}/pay`, {
    payments: [{ modeId: cash.id, amount: check.total }],
  });
  const day = full.businessDay.split('-').reverse().join('/');

  await page.goto('/hosp/reports');
  await settled(page);
  const pick = async (label: string) => {
    const box = page.getByRole('textbox', { name: label, exact: true });
    await box.fill(day);
    await box.press('Enter');
  };
  // F4: the flash of that day — this outlet's line with its guests and its discount.
  await pick('Day');
  const flash = page.getByTestId('flash');
  await expect(flash.getByText(`Sales on ${day}`)).toBeVisible();
  await expect(flash.locator('div', { hasText: n.outlet }).first()).toContainText('2 guests');
  await expect(flash.getByText('Day not closed').first()).toBeVisible();
  await expectNoSideScroll(page);
  if (shots) await page.screenshot({ path: `docs/screenshots/phase20/${project}-flash.png` });

  // F1: what sold, by item and by another grouping.
  await page.getByRole('tab', { name: 'Sales', exact: true }).click();
  await pick('From');
  await pick('To');
  const sales = page.getByTestId('sales-report');
  await expect(sales.locator('div', { hasText: n.dal }).last()).toContainText('₹560.00');
  await expect(sales.getByText(n.naan)).toHaveCount(0);
  if (shots) await page.screenshot({ path: `docs/screenshots/phase20/${project}-sales.png` });

  // F2: the kitchen's tickets by station.
  await page.getByRole('tab', { name: 'Kitchen times' }).click();
  await expect(
    page
      .getByTestId('kitchen-report')
      .locator('div', { hasText: `Pass ${t}` })
      .last(),
  ).toContainText('1 tickets');

  // F3: the void and the discount, with who and why.
  await page.getByRole('tab', { name: 'Voids & discounts' }).click();
  const audit = page.getByTestId('audit-report');
  await expect(audit.locator('div', { hasText: n.naan }).last()).toContainText('Guest changed their mind');
  await expect(audit.getByText('Regular guest').first()).toBeVisible();
  await expectNoSideScroll(page);
  if (shots) await page.screenshot({ path: `docs/screenshots/phase20/${project}-audit.png` });

  // The team's week has stewards with what they sold.
  await page.getByRole('tab', { name: "Team's week" }).click();
  await expect(page.getByTestId('team-report').getByRole('heading', { name: 'Stewards' })).toBeVisible();
  await expect(
    page
      .getByTestId('team-report')
      .getByText(/\d+ orders · \d+ guests/)
      .first(),
  ).toBeVisible();
});
