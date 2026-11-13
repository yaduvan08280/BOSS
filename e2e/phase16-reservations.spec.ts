import { expect, test } from '@playwright/test';
import { call, choose, expectNoSideScroll, settled, signIn, tag } from './phase11-kit';

const shots = process.env.E2E_SCREENSHOTS === '1';

/**
 * Phase 16 through the screens (rows R1–R4, R7, R8, R11–R13, R15–R20 of docs/plans/coverage.md): an outlet's
 * booking rules, a booking with the best-fit table, a large party whose deposit confirms it, arriving and seating
 * (the POS order opens on the table), the deposit used on the bill, the waitlist with its quoted wait, a guest's
 * profile and consent, and the public booking page with the guest's own cancel link. The outlet, its tables, a
 * dish and a cash mode are set up through the API — a fresh outlet every run.
 */
test('a booking from the phone call to the paid bill, the waitlist, guests and the public page', async ({
  page,
}, info) => {
  const project = info.project.name;
  const snap = async (name: string) => {
    if (shots) await page.screenshot({ path: `docs/screenshots/phase16/${project}-${name}.png` });
  };
  const t = tag(project);
  const digits = String(Date.now()).slice(-7);
  const n = {
    outlet: `Terrace ${t}`,
    dal: `Dal ${t}`,
    cash: `Cash ${t}`,
    asha: `Asha ${t}`,
    rohit: `Rohit ${t}`,
    verma: `Verma ${t}`,
    neha: `Neha ${t}`,
  };
  // Tomorrow on the company's clock, typed the way people type dates.
  const tomorrow = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata' }).format(
    new Date(Date.now() + 86_400_000),
  );
  const dialog = page.getByRole('dialog');
  /** Type a day into the page's day box once the book has loaded, and wait until it is taken. */
  const setDay = async () => {
    await expect(page.getByText('Guests expected')).toBeVisible();
    const box = page.getByRole('textbox', { name: 'Day' });
    await box.fill(tomorrow);
    await box.press('Enter');
    await expect(box).toHaveValue(tomorrow);
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
  };
  await signIn(page);
  await call(page, 'PUT', '/api/hosp/settings', { enabled: true });
  const branches = await call<{ branches: { id: string }[] } | { id: string }[]>(
    page,
    'GET',
    '/api/org/branches',
  );
  const branchId = (Array.isArray(branches) ? branches : branches.branches)[0]!.id;
  const outlet = await call<{ id: string }>(page, 'POST', '/api/hosp/outlets', { name: n.outlet, branchId });
  await call(page, 'POST', '/api/hosp/stations', { outletId: outlet.id, name: 'Kitchen' });
  const floor = await call<{ id: string }>(page, 'POST', '/api/hosp/floors', {
    outletId: outlet.id,
    name: 'Hall',
  });
  await call(page, 'POST', '/api/hosp/tables/bulk', { floorId: floor.id, count: 1, seats: 2 });
  await call(page, 'POST', '/api/hosp/tables/bulk', { floorId: floor.id, count: 3, from: 2 });
  const cat = await call<{ id: string }>(page, 'POST', '/api/hosp/menu/categories', { name: `Food ${t}` });
  await call(page, 'POST', '/api/hosp/menu/items', {
    categoryId: cat.id,
    outletIds: [outlet.id],
    name: n.dal,
    price: 50000,
  });
  await call(page, 'POST', '/api/money/modes', { name: n.cash, kind: 'CASH' });

  // R1: the book is empty; the rules ask a deposit from four guests and open the public page.
  await page.goto('/hosp/reservations');
  await settled(page);
  await choose(page, page.getByRole('combobox', { name: 'Outlet', exact: true }), n.outlet);
  await expect(page.getByText('No bookings on this day')).toBeVisible();
  await page.getByRole('button', { name: 'Booking rules' }).click();
  await dialog.getByLabel(/^Deposit from a party of/).fill('4');
  await dialog.getByLabel('Deposit per guest (₹)').fill('100');
  await dialog.getByRole('switch', { name: 'Public booking page' }).click();
  await snap('rules');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Booking rules saved')).toBeVisible();

  // R2, R3, R4: a phone booking for two tomorrow at 19:00 — MONO picks the two-seater.
  await setDay();
  await page.getByRole('button', { name: 'New booking' }).click();
  await dialog.getByRole('radio', { name: '19:00' }).click();
  await dialog.getByLabel('Mobile').fill(`98${digits}1`);
  await dialog.getByLabel('Name').fill(n.asha);
  await dialog.getByLabel('Occasion').fill('Birthday');
  await snap('new-booking');
  await dialog.getByRole('button', { name: 'Book the table' }).click();
  const asha = page.locator('main li', { hasText: n.asha });
  await expect(asha.getByText('Confirmed')).toBeVisible();
  await expect(asha.getByText(/T1 ·/)).toBeVisible();

  // R11: a party of four waits for its deposit; recording the money confirms it.
  await page.getByRole('button', { name: 'New booking' }).click();
  await dialog.getByLabel('Guests').fill('4');
  await expect(dialog.getByText('A party of this size pays a deposit of ₹400')).toBeVisible();
  await dialog.getByRole('radio', { name: '19:00' }).click();
  await dialog.getByLabel('Mobile').fill(`98${digits}2`);
  await dialog.getByLabel('Name').fill(n.rohit);
  await dialog.getByRole('button', { name: 'Book the table' }).click();
  const rohit = page.locator('main li', { hasText: n.rohit });
  await expect(rohit.getByText('To confirm')).toBeVisible();
  await expect(rohit.getByText('Deposit due ₹400')).toBeVisible();
  await rohit.getByRole('button', { name: /^Take deposit/ }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Paid by' }), n.cash);
  await dialog.getByRole('button', { name: 'Record the deposit' }).click();
  await expect(rohit.getByText('Confirmed')).toBeVisible();
  await expect(rohit.getByText('Deposit paid ₹400')).toBeVisible();
  await expect(page.getByText('Guests expected').locator('..')).toContainText('6');
  await expectNoSideScroll(page);
  await snap('book');

  // R7, R12: the first guest arrives and both parties are seated — each opens an order on its table.
  await asha.getByRole('button', { name: 'Arrived' }).click();
  await expect(asha.getByText('Arrived').first()).toBeVisible();
  await asha.getByRole('button', { name: 'Seat', exact: true }).click();
  await expect(asha.getByText('Seated')).toBeVisible();
  await rohit.getByRole('button', { name: 'Seat', exact: true }).click();
  await expect(rohit.getByText('Seated')).toBeVisible();

  // R16: on the POS the four-top's bill takes the deposit; the rest is paid in cash.
  await page.goto('/hosp/pos');
  await settled(page);
  await choose(page, page.getByRole('combobox', { name: 'Outlet', exact: true }), n.outlet);
  await expect(page.getByRole('button', { name: /^T1\s*Seated/ })).toBeVisible();
  await page.getByRole('button', { name: /^T2\s*Seated/ }).click();
  const panel = page.getByRole('dialog', { name: /^Order \d+/ });
  await panel.getByRole('button', { name: new RegExp(`^${n.dal}`) }).click();
  await panel.getByRole('button', { name: 'Send 1 item to the kitchen' }).click();
  await panel.getByRole('button', { name: 'Bill', exact: true }).click();
  const billBox = page.getByRole('dialog', { name: /^Bill/ }).last();
  await billBox.getByRole('button', { name: 'Make the bill' }).click();
  await billBox.getByRole('button', { name: 'Use the deposit ₹400' }).click();
  await expect(billBox.getByText('Deposit', { exact: true })).toBeVisible();
  await snap('bill-deposit');
  await choose(page, billBox.getByRole('combobox', { name: 'Paid by' }), n.cash);
  await expect(billBox.getByLabel('Amount', { exact: true })).toHaveValue('100');
  await billBox.getByRole('button', { name: 'Take the payment' }).click();
  await expect(page.getByText('Paid — the table is free')).toBeVisible();

  // The booking finished by itself, with its deposit used.
  await page.goto('/hosp/reservations');
  await settled(page);
  await choose(page, page.getByRole('combobox', { name: 'Outlet', exact: true }), n.outlet);
  await setDay();
  await expect(rohit.getByText('Finished')).toBeVisible();
  await expect(rohit.getByText('Deposit used ₹400')).toBeVisible();

  // R17, R18: a walk-in is quoted a wait, told the table is ready, and seated from the list.
  await page.getByRole('tab', { name: 'Waitlist' }).click();
  await page.getByLabel('Name').fill(n.verma);
  await page.getByLabel('Mobile').fill(`98${digits}3`);
  await expect(page.getByTestId('wait-quote')).toHaveText('A table is free now');
  await page.getByRole('button', { name: 'Add to the waitlist' }).click();
  const verma = page.locator('main li', { hasText: n.verma });
  await expect(verma).toBeVisible();
  await verma.getByRole('button', { name: 'Table is ready' }).click();
  await expect(verma.getByText('Called')).toBeVisible();
  await expectNoSideScroll(page);
  await snap('waitlist');
  await verma.getByRole('button', { name: 'Seat', exact: true }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Table' }), 'T3');
  await dialog.getByRole('button', { name: 'Seat', exact: true }).click();
  await expect(page.getByText('Nobody is waiting.')).toBeVisible();

  // R19, R20: the guest's profile — the visit is on it; consent is recorded with when and how.
  await page.goto('/hosp/guests');
  await settled(page);
  await page.getByLabel('Search name or mobile').fill(n.rohit);
  await page.getByRole('button', { name: new RegExp(n.rohit) }).click();
  await expect(dialog.getByText(`${n.dal} × 1`)).toBeVisible();
  await expect(dialog.getByText('Never asked.')).toBeVisible();
  await dialog.getByLabel('Allergies').fill('Peanuts');
  await dialog.getByRole('switch', { name: 'May be sent offers and news' }).click();
  await expect(dialog.getByText(/^Said yes on \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
  await snap('guest');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Allergies: Peanuts')).toBeVisible();
  await expectNoSideScroll(page);

  // R8, R15: the public page — a free time, the sum, a booking; the guest's own link cancels it.
  const book = await call<{ bookingToken: string }>(
    page,
    'GET',
    `/api/reservations/outlets/${outlet.id}/book`,
  );
  await page.goto(`/book/${book.bookingToken}`);
  await expect(page.getByRole('heading', { name: `Book a table at ${n.outlet}` })).toBeVisible();
  await page.getByRole('textbox', { name: 'Day' }).fill(tomorrow);
  await page.getByRole('textbox', { name: 'Day' }).press('Enter');
  await page.getByRole('radio', { name: '21:00' }).click();
  await page.getByLabel('Name').fill(n.neha);
  await page.getByLabel('Mobile').fill(`98${digits}4`);
  const sum = await page.getByText(/^What is \d+ \+ \d+\?$/).innerText();
  const [a, b] = sum.match(/\d+/g)!.map(Number) as [number, number];
  await page.getByLabel(/^What is/).fill(String(a + b));
  await expectNoSideScroll(page);
  await snap('public');
  await page.getByRole('button', { name: 'Book', exact: true }).click();
  await expect(page.getByText('Your table is booked')).toBeVisible();
  await page.getByRole('link', { name: 'See or cancel your booking' }).click();
  await expect(page.getByText(new RegExp(`${n.neha} · for 2 · Confirmed`))).toBeVisible();
  await page.getByRole('button', { name: 'Cancel my booking' }).click();
  await expect(page.getByText(new RegExp(`${n.neha} · for 2 · Cancelled`))).toBeVisible();
});
