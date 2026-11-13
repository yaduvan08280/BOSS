import { expect, test } from '@playwright/test';
import { call, choose, expectNoSideScroll, settled, signIn, tag } from './phase11-kit';

const shots = process.env.E2E_SCREENSHOTS === '1';
/**
 * Phase 17 through the screens (rows H1, H6, H9, H13, H17, H18, H20, H25, H27, H28, H32, H35, H36, H39–H43, H48 of
 * docs/plans/coverage.md): a rate plan, a booking priced night by night, check-in with the ID photo and
 * signature, a charge and an advance on the folio, a request from the QR page of the room, the night audit, the
 * folio paid and closed, check-out, and the room cleaned and inspected. The room type, its rooms, a tax rate and
 * a cash mode are set up through the API — new rooms every run, at the first branch.
 */
test('one night at the hotel, from the rate plan to the inspected room', async ({ page }, info) => {
  const project = info.project.name;
  const snap = async (name: string) => {
    if (shots) await page.screenshot({ path: `docs/screenshots/phase17/${project}-${name}.png` });
  };
  const t = tag(project);
  const no = 1000 + (Date.now() % 8000);
  const n = { type: `Deluxe ${t}`, plan: `C${t}`, cash: `Cash ${t}`, guest: `Vikram ${t}`, room: String(no) };
  const dialog = page.getByRole('dialog');
  await signIn(page);
  await call(page, 'PUT', '/api/hosp/settings', { enabled: true });
  const branches = await call<{ branches: { id: string; name: string }[] } | { id: string; name: string }[]>(
    page,
    'GET',
    '/api/org/branches',
  );
  const branch = (Array.isArray(branches) ? branches : branches.branches)[0]!;
  await call(page, 'PUT', '/api/money/tax-rates', {
    code: 'ROOM12',
    name: 'GST on rooms',
    percent: 12,
    from: '2020-01-01',
  });
  const type = await call<{ id: string }>(page, 'POST', '/api/hosp/room-types', {
    branchId: branch.id,
    name: n.type,
    code: `D${t}`,
    occupancy: 2,
    maxOccupancy: 3,
    taxCode: 'ROOM12',
  });
  await call(page, 'POST', '/api/hosp/rooms/bulk', { typeId: type.id, from: no, to: no + 1, floor: '1' });
  await call(page, 'POST', '/api/money/modes', { name: n.cash, kind: 'CASH' });
  const users = await call<{ id: string; role?: { key: string } }[]>(page, 'GET', '/api/org/users');
  const me = await call<{ user: { id: string } }>(page, 'GET', '/api/auth/me');
  const other = users.find((u) => u.id !== me.user.id)!;
  await call(page, 'PUT', `/api/hotel/rules?branchId=${branch.id}`, { requestSolverId: other.id });
  const property = async (path: string) => {
    await page.goto(path);
    await settled(page);
    await choose(page, page.getByRole('combobox', { name: 'Property', exact: true }), branch.name);
  };

  // H1: a rate plan with breakfast — ₹4,000 a night for the new room type.
  await property('/hotel/rates');
  await page.getByRole('button', { name: 'New rate plan' }).click();
  await dialog.getByLabel('Code').fill(n.plan);
  await dialog.getByLabel('Name').fill(`Breakfast ${t}`);
  await choose(page, dialog.getByRole('combobox', { name: 'Meal plan' }), 'With breakfast');
  await dialog.getByLabel(`${n.type} — a night (₹)`).fill('4000');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Rate plan saved')).toBeVisible();
  await expect(page.locator('main li', { hasText: n.plan }).getByText('₹4,000')).toBeVisible();
  await expectNoSideScroll(page);
  await snap('rates');

  // H6, H9: a booking for tonight, priced before it is made.
  await property('/hotel/desk');
  await page.getByRole('button', { name: 'New booking' }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Rate plan' }), n.plan);
  await choose(page, dialog.getByRole('combobox', { name: 'Room type' }), n.type);
  await expect(dialog.getByTestId('hotel-quote')).toContainText('1 nights · ₹4,000');
  await dialog.getByLabel('Mobile').fill(`96${String(Date.now()).slice(-8)}`);
  await dialog.getByLabel('Name').fill(n.guest);
  await snap('booking');
  await dialog.getByRole('button', { name: 'Make the booking' }).click();
  await expect(page.getByText(/^Booking BK-\d+ made$/)).toBeVisible();

  // H17, H18, H20: the arrival is checked in — a room, the ID, its photo, the signature.
  const row = page.locator('main li', { hasText: n.guest });
  await row.getByRole('button', { name: 'Check in' }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Room', exact: true }), n.room);
  await dialog.getByLabel('ID number').fill('1234 5678 9012');
  const files = dialog.locator('input[type=file]:not([capture])');
  await files.nth(0).setInputFiles('apps/web/public/icon-192.png');
  await expect(dialog.locator('li img')).toHaveCount(1);
  await files.nth(1).setInputFiles('apps/web/public/icon-192.png');
  await expect(dialog.locator('li img')).toHaveCount(2);
  await snap('check-in');
  await dialog.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(page.getByText(`Checked in to room ${n.room}`)).toBeVisible();
  await page.getByRole('tab', { name: 'In the house' }).click();
  await expect(row.getByText('In the house')).toBeVisible();

  // H27, H13: a cab on the folio, and ₹1,000 taken in advance.
  await row.getByRole('button', { name: 'Open' }).click();
  await dialog.getByRole('button', { name: 'Add a charge' }).click();
  await dialog.getByLabel('What').fill('Airport cab');
  await dialog.getByLabel('Price (₹)').fill('500');
  await dialog.getByRole('button', { name: 'Add to the folio' }).click();
  await expect(dialog.getByText('Airport cab')).toBeVisible();
  await dialog.getByRole('button', { name: 'Take an advance' }).first().click();
  await dialog.getByLabel('Amount (₹)').fill('1000');
  await choose(page, dialog.getByRole('combobox', { name: 'Paid by' }).first(), n.cash);
  await dialog.getByRole('button', { name: 'Take an advance' }).last().click();
  await expect(dialog.getByText(/Advance ADV/)).toBeVisible();
  await expectNoSideScroll(page);
  await snap('stay');

  // H48: the QR page of the room — no sign-in — sends a request to the staff.
  const rooms = await call<{ rooms: { id: string; number: string }[] }>(page, 'GET', '/api/hosp/rooms');
  const link = await call<{ path: string }>(
    page,
    'POST',
    `/api/hotel/rooms/${rooms.rooms.find((r) => r.number === n.room)!.id}/link`,
  );
  await page.goto(link.path);
  await expect(page.getByRole('heading', { name: `Room ${n.room} — how can we help?` })).toBeVisible();
  await page.getByLabel('What do you need?').fill('Two extra towels');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(/^Thank you — someone will be with you within \d+ minutes\.$/)).toBeVisible();
  await expectNoSideScroll(page);

  // H36, H39, H40: the night audit closes the day; the pack shows the room revenue.
  await property('/hotel/audit');
  await page.getByRole('button', { name: /^Run the night audit of/ }).click();
  await dialog.getByRole('button', { name: 'Run it' }).click();
  await expect(page.getByText(/^Day closed — the hotel's date is now/)).toBeVisible();
  await expect(page.getByText('Room revenue')).toBeVisible();
  await expectNoSideScroll(page);
  await snap('audit');

  // H25, H28, H32, H35: the folio — room ₹4,000 + 12 % and the cab, less the advance — is paid and closed; check-out.
  await property('/hotel/desk');
  await page.getByRole('tab', { name: 'Departures' }).click();
  await row.getByRole('button', { name: 'Open' }).click();
  const folio = dialog.getByTestId('folio-1');
  await expect(folio.getByText(/Room \d+ — /)).toBeVisible();
  await expect(folio.getByText('₹4,980')).toBeVisible();
  await choose(page, folio.getByRole('combobox', { name: 'Paid by' }), n.cash);
  await folio.getByRole('button', { name: 'Take ₹3,980.00 and close' }).click();
  await expect(folio.getByText('Closed', { exact: true })).toBeVisible();
  await expect(folio.getByText(/Invoice INV/)).toBeVisible();
  await snap('folio');
  await dialog.getByRole('button', { name: 'Check out' }).click();
  await expect(dialog.getByText('Checked out')).toBeVisible();

  // H41–H43: housekeeping — the room is dirty, its checklist is ticked, it is cleaned and inspected.
  await property('/hotel/housekeeping');
  const card = page.getByTestId(`hk-${n.room}`);
  await expect(card.getByText('Vacant, dirty')).toBeVisible();
  // Each tick is saved before it shows, so wait for one before the next.
  const boxes = card.getByRole('checkbox');
  for (let i = 0; i < (await boxes.count()); i++) {
    await boxes.nth(i).click();
    await expect(boxes.nth(i)).toBeChecked();
  }
  await card.getByRole('button', { name: 'Cleaned' }).click();
  await expect(card.getByText('Vacant, clean')).toBeVisible();
  await card.getByRole('button', { name: 'Pass inspection' }).click();
  await expect(card.getByText('Inspected', { exact: true }).first()).toBeVisible();
  await expectNoSideScroll(page);
  await snap('housekeeping');

  // H7: the room calendar shows the room and never scrolls the page sideways.
  await property('/hotel/calendar');
  await expect(page.locator('tbody th', { hasText: n.room })).toBeVisible();
  await expectNoSideScroll(page);
  await snap('calendar');
});
