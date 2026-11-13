import { expect, test } from '@playwright/test';
import { call, choose, expectNoSideScroll, settled, signIn, tag } from './phase11-kit';

const shots = process.env.E2E_SCREENSHOTS === '1';

/**
 * Phase 18 through the screens (rows B1–B3, B5, B6, B8, B9, B11, B13, B14, B16, B17, B19 of
 * docs/plans/coverage.md): a hall and a package, an enquiry quoted and confirmed by its advance, the BEO sent,
 * the event-day checklist, the final bill for the guaranteed covers paid and the event closed; a licence about to
 * run out and a temperature reading out of range; the bar register of a whisky and a dry day. A stock location,
 * the whisky and a cash mode are set up through the API.
 */
test('a banquet from enquiry to the paid bill, compliance and the bar register', async ({ page }, info) => {
  const project = info.project.name;
  const snap = async (name: string) => {
    if (shots) await page.screenshot({ path: `docs/screenshots/phase18/${project}-${name}.png` });
  };
  const t = tag(project);
  const n = {
    hall: `Crystal ${t}`,
    pack: `Silver ${t}`,
    cash: `Cash ${t}`,
    host: `Sharma ${t}`,
    licence: `FSSAI ${t}`,
    point: `Chiller ${t}`,
    brand: `Oak ${t}`,
    category: `Liquor ${t}`,
  };
  const dialog = page.getByRole('dialog');
  await signIn(page);
  await call(page, 'PUT', '/api/hosp/settings', { enabled: true });
  const branches = await call<{ branches: { id: string; name: string }[] } | { id: string; name: string }[]>(
    page,
    'GET',
    '/api/org/branches',
  );
  const branch = (Array.isArray(branches) ? branches : branches.branches)[0]!;
  await call(page, 'POST', '/api/hosp/outlets', { name: `Hall desk ${t}`, branchId: branch.id });
  await call(page, 'POST', '/api/money/modes', { name: n.cash, kind: 'CASH' });
  // A whisky kept in ml in a bar of this branch: twelve bottles received today.
  const loc = await call<{ id: string }>(page, 'POST', '/api/branches/locations', {
    branchId: branch.id,
    name: `Bar ${t}`,
    kind: 'BAR',
  });
  const whisky = await call<{ id: string }>(page, 'POST', '/api/ims/items', {
    code: `W${t}`,
    name: n.brand,
    unit: 'ml',
    category: n.category,
  });
  await call(page, 'PUT', `/api/ims/items/${whisky.id}/extras`, {
    brand: n.brand,
    units: [{ unit: 'bottle', factor: 750 }],
  });
  await call(page, 'POST', '/api/ims/stock/entry', {
    itemId: whisky.id,
    type: 'IN',
    qty: 9000,
    ratePaise: 1,
    locationId: loc.id,
  });
  const at = async (path: string) => {
    await page.goto(path);
    await settled(page);
    await choose(page, page.getByRole('combobox', { name: 'Branch', exact: true }), branch.name);
  };
  const tick = async (scope: typeof dialog) => {
    const boxes = scope.getByRole('checkbox');
    for (let i = 0; i < (await boxes.count()); i++) {
      await boxes.nth(i).click();
      await expect(boxes.nth(i)).toBeChecked();
    }
  };

  // B1: a hall and a menu package.
  await at('/hosp/banquets');
  await page.getByRole('tab', { name: 'Halls & packages' }).click();
  await page.getByLabel('Hall name').fill(n.hall);
  await page.getByLabel('Guests', { exact: true }).fill('150');
  await page.getByLabel('Rent (₹)').fill('25000');
  await page.getByRole('button', { name: 'Add the hall' }).click();
  await expect(page.getByText('Hall saved')).toBeVisible();
  await page.getByLabel('Package name').fill(n.pack);
  await page.getByLabel('Per plate (₹)').fill('800');
  await page.getByRole('button', { name: 'Add the package' }).click();
  await expect(page.getByText('Package saved')).toBeVisible();
  await expectNoSideScroll(page);

  // B2: an enquiry for a hundred guests this evening.
  await page.getByRole('tab', { name: 'Events' }).click();
  await page.getByRole('button', { name: 'New enquiry' }).click();
  await dialog.getByLabel('Name').fill(n.host);
  await dialog.getByLabel('Mobile').fill(`94${String(Date.now()).slice(-8)}`);
  await dialog.getByLabel('Occasion').fill('Wedding reception');
  await choose(page, dialog.getByRole('combobox', { name: 'Hall' }), n.hall);
  await snap('enquiry');
  await dialog.getByRole('button', { name: 'Save the enquiry' }).click();
  await expect(page.getByText(/^Enquiry BQ-\d+ saved$/)).toBeVisible();

  // B3, B5: the quotation — 100 plates, the hall, flowers — and the advance that confirms it.
  await page.locator('main li', { hasText: n.host }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Menu package' }), n.pack);
  await dialog.getByLabel('An extra (décor, sound …)').fill('Flowers');
  await dialog.getByLabel('Its amount (₹)').fill('5000');
  await dialog.getByRole('button', { name: 'Make the quotation' }).click();
  const totals = dialog.getByTestId('bq-totals');
  await expect(totals.getByText('₹1,10,000.00').first()).toBeVisible();
  await expect(totals.getByText('₹0.00 / ₹27,500.00')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirm the booking' })).toBeDisabled();
  await dialog.getByLabel('Amount (₹)', { exact: true }).fill('27500');
  await choose(page, dialog.getByRole('combobox', { name: 'Paid by' }), n.cash);
  await dialog.getByRole('button', { name: 'Take an advance' }).click();
  await expect(totals.getByText('₹27,500.00 / ₹27,500.00')).toBeVisible();
  await snap('quoted');
  await dialog.getByRole('button', { name: 'Confirm the booking' }).click();
  await expect(dialog.getByText('Confirmed', { exact: true })).toBeVisible();

  // B6, B8: the BEO goes to the departments; the checklist is ticked on the day.
  await dialog.getByLabel('For the kitchen').fill('No onion, no garlic for 20 guests');
  await dialog.getByRole('button', { name: 'Save and send to the departments' }).click();
  await expect(dialog.getByText('sent', { exact: true })).toBeVisible();
  await tick(dialog);
  await expectNoSideScroll(page);
  await snap('confirmed');

  // B9, B11: 92 came — billed for the 100 guaranteed; the balance is paid and the event closes.
  await dialog.getByLabel('Guests who came').fill('92');
  await dialog.getByRole('button', { name: 'Event held — make the final bill' }).click();
  await expect(dialog.getByText('Held — to settle')).toBeVisible();
  await expect(totals.getByText('₹82,500.00')).toBeVisible();
  await choose(page, dialog.getByRole('combobox', { name: 'Paid by' }), n.cash);
  await dialog.getByRole('button', { name: 'Take ₹82,500.00 and close' }).click();
  await expect(dialog.getByText('Closed', { exact: true })).toBeVisible();
  await snap('closed');

  // B17, B19: a licence that runs out in twenty days; a chiller reading above its limit.
  await at('/hosp/compliance');
  const soon = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata' }).format(
    new Date(Date.now() + 20 * 86_400_000),
  );
  await page.getByLabel('Name', { exact: true }).fill(n.licence);
  const due = page.getByRole('textbox', { name: 'Runs out on / next due' });
  await due.fill(soon);
  await due.press('Enter');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId(`cmp-${n.licence}`).getByText('Running out')).toBeVisible();
  await expectNoSideScroll(page);
  await snap('compliance');
  await page.getByRole('tab', { name: 'Temperature log' }).click();
  await page.getByLabel('A place to log').fill(n.point);
  await page.getByLabel('Lowest').fill('0');
  await page.getByLabel('Highest').fill('5');
  await page.getByRole('button', { name: 'Add the place' }).click();
  const point = page.getByTestId(`temp-${n.point}`);
  await point.getByLabel('Reading').fill('8');
  await point.getByRole('button', { name: 'Log it' }).click();
  await expect(page.getByText(/is outside the limits/)).toBeVisible();
  await point.getByLabel('What was done (if out of range)').fill('Door seal fixed');
  await point.getByRole('button', { name: 'Log it' }).click();
  await expect(page.getByText('Out of range — the managers have been told')).toBeVisible();
  await expect(point.getByText('8°C — out of range')).toBeVisible();

  // B13, B14, B16: the bar — the liquor category, the brand's day in bottles, a dry day.
  await at('/hosp/bar');
  await page.getByLabel('A liquor category').fill(n.category);
  await page.getByLabel('Licence number').fill(`RJ/HBL/${t}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Bar rules saved')).toBeVisible();
  await expect(page.getByTestId('bar-licence')).toContainText(`RJ/HBL/${t}`);
  const brand = page.getByTestId(`bar-${n.brand}`);
  await expect(brand.getByText('12 + 0 ml').first()).toBeVisible();
  const dry = page.getByRole('textbox', { name: 'Dry day' });
  await dry.fill(soon);
  await dry.press('Enter');
  await page.getByLabel('Why', { exact: true }).fill(`Election ${t}`);
  await page.getByRole('button', { name: 'Add the dry day' }).click();
  await expect(page.getByText(`${soon} · Election ${t}`)).toBeVisible();
  await expectNoSideScroll(page);
  await snap('bar');
});
