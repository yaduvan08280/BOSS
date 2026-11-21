import { expect, test } from '@playwright/test';
import { call, choose, settled, signIn, tag } from './phase11-kit';

/**
 * The booking dialog opens on something that can be sold: a rate plan is offered only with the room types it
 * has a rate for. The plan made here comes first in the list (its code starts with "0") and prices only the
 * room type made here, which is not the property's first — so a dialog that paired the first plan with the
 * first room type would ask for a price that does not exist.
 */
test('a new booking is priced as soon as the dialog opens', async ({ page }, info) => {
  const t = tag(info.project.name);
  const dialog = page.getByRole('dialog');
  await signIn(page);
  await call(page, 'PUT', '/api/hosp/settings', { enabled: true });
  const branches = await call<{ branches: { id: string; name: string }[] } | { id: string; name: string }[]>(
    page,
    'GET',
    '/api/org/branches',
  );
  const branch = (Array.isArray(branches) ? branches : branches.branches)[0]!;
  const mk = (name: string, code: string) =>
    call<{ id: string }>(page, 'POST', '/api/hosp/room-types', {
      branchId: branch.id,
      name,
      code,
      occupancy: 2,
      maxOccupancy: 3,
    });
  await mk(`Plain ${t}`, `P${t}`);
  const suite = await mk(`Suite ${t}`, `S${t}`);
  const no = 9000 + (Date.now() % 900);
  await call(page, 'POST', '/api/hosp/rooms/bulk', { typeId: suite.id, from: no, to: no, floor: '9' });
  await call(page, 'POST', '/api/hotel/plans', {
    branchId: branch.id,
    code: `0${t}`,
    name: `Suites only ${t}`,
    meal: 'EP',
    rates: [{ roomTypeId: suite.id, base: 700000, extraAdult: 0, extraChild: 0 }],
  });

  const refused: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/hotel/quote') && r.status() >= 400) refused.push(`${r.status()} ${r.url()}`);
  });
  await page.goto('/hotel/desk');
  await settled(page);
  await choose(page, page.getByRole('combobox', { name: 'Property', exact: true }), branch.name);
  await page.getByRole('button', { name: 'New booking' }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Rate plan' }), `0${t}`);
  await expect(dialog.getByTestId('hotel-quote')).toContainText('1 nights · ₹7,000');
  // The plan's own room type is the only one offered.
  await dialog.getByRole('combobox', { name: 'Room type' }).click();
  await expect(page.getByRole('option', { name: `Suite ${t}` })).toBeVisible();
  await expect(page.getByRole('option', { name: `Plain ${t}` })).toHaveCount(0);
  expect(refused).toEqual([]);
});
