import { expect, test } from '@playwright/test';
import { as, call, choose, expectNoSideScroll, PASSWORD, settled, signIn, tag } from './phase11-kit';

/**
 * The parts of the POS's long story (P40 of docs/plans/coverage.md) that were proved through the API only, now
 * through the screens with two people: a void above the asker's limit waits for a manager, who approves it on
 * their own screen; and one bill is split equally and paid in two parts.
 */
test('a void waits for a manager; a bill is split in two and paid part by part', async ({
  page,
  browser,
  request,
}, info) => {
  const t = tag(info.project.name);
  const n = { outlet: `Diner ${t}`, dal: `Dal ${t}`, cola: `Cola ${t}`, cash: `Cash ${t}` };
  await signIn(page);
  const settings = await call<{ rules: { limits?: { roleId: string }[] } }>(
    page,
    'GET',
    '/api/hosp/settings',
  );
  const roles = (await call<{ roles: { id: string; key: string | null }[] }>(page, 'GET', '/api/org/roles'))
    .roles;
  const member = roles.find((r) => r.key === 'MEMBER')!.id;
  // A member may void up to ₹10 by themselves: the ₹280 dal below needs a manager's yes.
  await call(page, 'PUT', '/api/hosp/settings', {
    enabled: true,
    rules: {
      limits: [
        ...(settings.rules.limits ?? []).filter((l) => l.roleId !== member),
        { roleId: member, maxPct: 5, voidPaise: 10_00 },
      ],
    },
  });
  // The steward: a new person, who chooses their own password at first sign-in (done here through the API).
  const mobile = `8${String(Date.now()).slice(-9)}`;
  const made = await call<{ tempPassword: string }>(page, 'POST', '/api/org/users', {
    ...{ name: `Steward ${t}`, mobile, loginEnabled: true, roleId: member },
  });
  const origin = new URL(page.url()).origin;
  const first = await request.post('/api/auth/login', {
    headers: { origin },
    data: { identifier: mobile, password: made.tempPassword },
  });
  expect(first.ok(), await first.text()).toBeTruthy();
  const changed = await request.post('/api/auth/change-password', {
    headers: { origin },
    data: { currentPassword: made.tempPassword, newPassword: PASSWORD },
  });
  expect(changed.ok(), await changed.text()).toBeTruthy();
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
  await call(page, 'POST', '/api/hosp/tables/bulk', { floorId: floor.id, count: 2 });
  const cat = await call<{ id: string }>(page, 'POST', '/api/hosp/menu/categories', { name: `Food ${t}` });
  for (const [name, price] of [
    [n.dal, 280_00],
    [n.cola, 80_00],
  ] as const)
    await call(page, 'POST', '/api/hosp/menu/items', {
      categoryId: cat.id,
      outletIds: [outlet.id],
      name,
      price,
    });
  await call(page, 'POST', '/api/money/modes', { name: n.cash, kind: 'CASH' });

  // The steward seats T1 and sends a dal and two colas to the kitchen.
  const steward = await as(browser, mobile, info);
  const s = steward.page;
  await s.goto('/hosp/pos');
  await settled(s);
  await choose(s, s.getByRole('combobox', { name: 'Outlet', exact: true }), n.outlet);
  await s.getByRole('button', { name: /^T1\s*Free/ }).click();
  await s.getByRole('dialog').getByLabel('Guests').fill('2');
  await s.getByRole('dialog').getByRole('button', { name: 'Start the order' }).click();
  const panel = s.getByRole('dialog', { name: /^Order \d+/ });
  await panel.getByRole('button', { name: new RegExp(`^${n.dal}`) }).click();
  await panel.getByRole('button', { name: new RegExp(`^${n.cola}`) }).click();
  await panel.getByRole('button', { name: `One more ${n.cola}` }).click();
  await panel.getByRole('button', { name: 'Send 3 items to the kitchen' }).click();
  await expect(panel.locator('li', { hasText: n.dal }).getByText('In the kitchen')).toBeVisible();

  // P10: the dal is voided — above the steward's limit, so it waits.
  await panel.getByRole('button', { name: `Void ${n.dal}` }).click();
  const voidBox = s.getByRole('dialog', { name: `Void ${n.dal}` });
  await voidBox.getByLabel('Why is it being voided?').fill('Wrong table');
  await voidBox.getByRole('button', { name: 'Void', exact: true }).click();
  await expect(panel.locator('li', { hasText: n.dal }).getByText('Void waits for approval')).toBeVisible();

  // P11: the manager sees it waiting on their own screen and approves.
  await page.goto('/hosp/pos');
  await settled(page);
  await choose(page, page.getByRole('combobox', { name: 'Outlet', exact: true }), n.outlet);
  await page.getByRole('button', { name: '1 waiting for approval' }).click();
  const asks = page.getByRole('dialog', { name: 'Waiting for approval' });
  await expect(asks.getByText(n.dal).first()).toBeVisible();
  await expect(asks.getByText('Wrong table').first()).toBeVisible();
  await asks.getByRole('button', { name: 'Approve' }).click();
  await expect(asks.getByText('Nothing is waiting.')).toBeVisible();
  await expectNoSideScroll(page);
  await expect(panel.locator('li', { hasText: n.dal }).getByText('Voided')).toBeVisible({ timeout: 15_000 });

  // P20: the bill for the two colas (₹160) is split equally between two people and paid part by part.
  await panel.getByRole('button', { name: 'Bill', exact: true }).click();
  const billBox = s.getByRole('dialog', { name: /^Bill/ }).last();
  await billBox.getByLabel('Split equally among').fill('2');
  await billBox.getByRole('button', { name: 'Make the bill' }).click();
  await expect(billBox.getByText('To be paid as ₹80.00 + ₹80.00')).toBeVisible();
  for (const last of [false, true]) {
    await choose(s, billBox.getByRole('combobox', { name: 'Paid by' }), n.cash);
    await billBox.getByLabel('Amount', { exact: true }).fill('80');
    await billBox.getByRole('button', { name: 'Take the payment' }).click();
    if (last) await expect(s.getByText('Paid — the table is free')).toBeVisible();
    // After the first part the bill is still open, with the other ₹80 to pay.
    else
      await expect
        .poll(async () => {
          const checks = await call<{ due: number }[]>(page, 'GET', `/api/pos/outlets/${outlet.id}/checks`);
          return checks[0]?.due;
        })
        .toBe(80_00);
  }
  await expect(s.getByRole('button', { name: /^T1\s*Free/ })).toBeVisible();
  await expectNoSideScroll(s);
  await steward.close();
});
