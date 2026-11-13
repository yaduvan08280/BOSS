import { expect, test } from '@playwright/test';
import { call, choose, expectNoSideScroll, settled, signIn, tag } from './phase11-kit';

const shots = process.env.E2E_SCREENSHOTS === '1';

/**
 * Phase 14 through the screens (rows S1–S6, S10, S12, S13, S15, S16 of docs/plans/coverage.md): the owner switches
 * hospitality on, adds an outlet with a station, a floor with tables, a room type with rooms, a discount rule,
 * pastes a menu, adds an item with variants and switches one off.
 */
test('hospitality is set up from the screens: outlet, tables, rooms, rules and a menu', async ({ page }, info) => {
  const project = info.project.name;
  const snap = async (name: string) => {
    if (shots) await page.screenshot({ path: `docs/screenshots/phase14/${project}-${name}.png` });
  };
  const t = tag(project);
  const n = { outlet: `Courtyard ${t}`, floor: `Terrace ${t}`, type: `Deluxe ${t}`, cat: `Starters ${t}`, dish: `Paneer tikka ${t}` };
  // Room numbers are unique in a branch: a different range on every run.
  const room = 1000 + (Date.now() % 90000);
  const dialog = page.getByRole('dialog');
  await signIn(page);
  // Start from "off" so the switch itself is driven (another run may have left it on).
  await call(page, 'PUT', '/api/hosp/settings', { enabled: false });

  // S1: switched on in System Master.
  await page.goto('/system/hospitality');
  await settled(page);
  await expect(page.getByRole('tab', { name: 'Outlets' })).toHaveCount(0);
  await page.getByRole('switch', { name: 'Use hospitality' }).click();
  await expect(page.getByRole('tab', { name: 'Outlets' })).toBeVisible();

  // S2, S3: an outlet with its service charge, then a station.
  await page.getByRole('button', { name: 'Add an outlet' }).click();
  await dialog.getByLabel('Name', { exact: true }).fill(n.outlet);
  await dialog.getByLabel(/^Service charge %/).fill('5');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  const outlet = page.locator('li', { hasText: n.outlet });
  await outlet.getByRole('button').click();
  await dialog.getByLabel('Station name').fill('Tandoor');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(outlet.getByText('1 stations · 0 tables')).toBeVisible();
  await expectNoSideScroll(page);
  await snap('outlets');

  // S4: a floor, six tables at once, one renamed.
  await page.getByRole('tab', { name: 'Floors & tables' }).click();
  await choose(page, page.getByRole('combobox', { name: 'Outlet', exact: true }), n.outlet);
  await page.getByLabel("New floor's name").fill(n.floor);
  await page.getByRole('button', { name: 'Add a floor' }).click();
  await page.getByRole('button', { name: 'Add many tables' }).click();
  await dialog.getByLabel('How many').fill('6');
  await dialog.getByRole('button', { name: 'Add them' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'T6, 4' })).toBeVisible();
  await page.getByRole('button', { name: 'T1, 4' }).click();
  await dialog.getByLabel('Seats').fill('8');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'T1, 8' })).toBeVisible();
  await expectNoSideScroll(page);
  await snap('floor');

  // S5, S6: a room type and four rooms.
  await page.getByRole('tab', { name: 'Rooms' }).click();
  await page.getByRole('button', { name: 'Add a room type' }).click();
  await dialog.getByLabel('Name', { exact: true }).fill(n.type);
  await dialog.getByLabel('Code', { exact: true }).fill(t.slice(0, 6));
  await dialog.getByLabel(/^Tariff a night/).fill('4500');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  const type = page.locator('li', { hasText: n.type });
  await type.getByRole('button', { name: 'Add rooms' }).click();
  await dialog.getByLabel('From room no.').fill(String(room));
  await dialog.getByLabel('To room no.').fill(String(room + 3));
  await dialog.getByRole('button', { name: 'Add rooms' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(type.getByText('4 rooms')).toBeVisible();
  await snap('rooms');

  // S8 and S10: the printers screen fits; a no-charge reason is added and saved.
  await page.getByRole('tab', { name: 'Printers & stations' }).click();
  await settled(page);
  await expectNoSideScroll(page);
  await page.getByRole('tab', { name: 'Discounts, day close & payments' }).click();
  await page.getByLabel('New reason').fill(`Critic ${t}`);
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await page.getByRole('button', { name: 'Save the rules' }).click();
  await expect(page.getByText('Saved').first()).toBeVisible();
  await expectNoSideScroll(page);
  await snap('rules');

  // S12, S13, S16: the Hospitality menu appears; a menu is pasted, an item with variants is added by hand.
  await page.goto('/hosp/menu');
  await settled(page);
  await page.getByRole('button', { name: 'Paste a menu' }).click();
  await dialog.getByLabel('Paste a menu').fill(`${n.cat}, Soup ${t}, 120, veg\n${n.cat}, Wings ${t}, 280, non-veg, Half=160|Full=280\n${n.cat}, Broken ${t}, x`);
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(dialog.getByText('Line 3: "x" is not a price')).toBeVisible();
  await dialog.getByLabel('Paste a menu').fill(`${n.cat}, Soup ${t}, 120, veg\n${n.cat}, Wings ${t}, 280, non-veg, Half=160|Full=280`);
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('li', { hasText: `Wings ${t}` }).getByText('Half ₹160.00 · Full ₹280.00')).toBeVisible();
  await page.getByRole('tab', { name: new RegExp(n.cat) }).click();
  await page.getByRole('button', { name: 'Add an item' }).click();
  await dialog.getByLabel('Name', { exact: true }).fill(n.dish);
  await dialog.getByLabel('Price (₹)', { exact: true }).fill('320');
  await dialog.getByRole('button', { name: 'Add a variant' }).click();
  await dialog.getByLabel('Variant name').fill('Half');
  await dialog.getByLabel('Variant price').fill('180');
  await dialog.getByLabel('Share').fill('0.5');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  const dish = page.locator('li', { hasText: n.dish });
  await expect(dish.getByText('Half ₹180.00')).toBeVisible();
  // S15: 86 by hand.
  await dish.getByRole('switch').click();
  await expect(dish.getByText('86 — off')).toBeVisible();
  await expectNoSideScroll(page);
  await snap('menu');
});
