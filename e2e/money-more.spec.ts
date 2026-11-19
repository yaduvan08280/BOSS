import { expect, test } from '@playwright/test';
import { call, choose, expectNoSideScroll, settled, signIn, tag } from './phase11-kit';

/**
 * Money screens that were proved through the API only (rows U12, U16, U18, U19, U21 of docs/plans/coverage.md),
 * now through the screens: a vendor's purchase bill, a credit note against an invoice, the ledger names for
 * Tally, and closing a branch's day with what was counted.
 */
test('a purchase bill, a credit note, the Tally ledgers and a closed day', async ({ page }, info) => {
  const t = tag(info.project.name);
  const dialog = page.getByRole('dialog');
  await signIn(page);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const id = (r: { id: string }) => r.id;
  const vendor = `Quarry ${t}`;
  const buyer = `Kitchen Studio ${t}`;
  await call(page, 'POST', '/api/money/parties', { name: vendor, kinds: ['vendor'] });
  const buyerId = id(await call(page, 'POST', '/api/money/parties', { name: buyer, kinds: ['customer'] }));
  const branchId = id(await call(page, 'POST', '/api/org/branches', { name: `Counter ${t}`, code: `C${t}` }));
  const drawer = `Drawer ${t}`;
  const modeId = id(await call(page, 'POST', '/api/money/modes', { name: drawer, kind: 'CASH', branchId }));
  const invoice = await call<{ id: string }>(page, 'POST', '/api/money/bills', {
    ...{ type: 'INVOICE', partyId: buyerId, date: today, branchId },
    lines: [{ item: 'Quartz slab', qty: 2, rate: 1000_00 }],
  });
  const issued = await call<{ number: string }>(page, 'POST', `/api/money/bills/${invoice.id}/issue`, {});
  // ₹500 comes in through the branch's own cash drawer.
  await call(page, 'POST', '/api/money/bills', {
    ...{ type: 'RECEIPT', partyId: buyerId, date: today, branchId, amount: 500_00, modeId },
  });

  // U12: a vendor's purchase bill, typed and issued.
  await page.goto('/money/bills');
  await settled(page);
  await choose(page, page.getByRole('combobox', { name: 'New paper' }), 'Purchase bill');
  await expect(dialog.getByRole('heading', { name: 'New purchase bill' })).toBeVisible();
  await choose(page, dialog.getByRole('combobox', { name: 'Party' }), vendor);
  await dialog.getByLabel('Item', { exact: true }).fill('Raw quartz');
  await dialog.getByLabel('Qty', { exact: true }).fill('10');
  await dialog.getByLabel('Rate', { exact: true }).fill('250');
  await expect(dialog.getByText('₹2,500').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Issue', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/is issued/)).toBeVisible();
  await page.getByRole('tab', { name: 'Purchase bills' }).click();
  await expect(page.locator('li', { hasText: vendor }).first()).toBeVisible();
  await expectNoSideScroll(page);

  // U16: a credit note for part of the invoice; the invoice then shows less to pay.
  await page.getByRole('tab', { name: 'Invoices' }).click();
  await page.getByLabel('Search number or party').fill(buyer);
  await page.locator('li', { hasText: issued.number }).first().getByRole('button').click();
  await dialog.getByRole('button', { name: 'Credit note' }).click();
  const note = dialog.last();
  await expect(note.getByRole('heading', { name: `Credit note for ${issued.number}` })).toBeVisible();
  await note.getByLabel('Item', { exact: true }).fill('One slab came back');
  await note.getByLabel('Qty', { exact: true }).fill('1');
  await note.getByLabel('Rate', { exact: true }).fill('1000');
  await note.getByRole('button', { name: 'Issue', exact: true }).click();
  await expect(page.getByText(/is issued/).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/money/owed');
  await settled(page);
  // 2,000 billed − 500 received − 1,000 credited = 500 still owed.
  await expect(page.locator('li', { hasText: buyer }).getByText('₹500').first()).toBeVisible();

  // U18: every head used by the papers gets a ledger name for Tally; the names are kept.
  await page.goto('/money/setup');
  await settled(page);
  await page.getByRole('tab', { name: 'Tally ledgers' }).click();
  const sales = page.getByLabel('Tally ledger for sales', { exact: true });
  await sales.fill(`Sales Account ${t}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();
  await page.reload();
  await settled(page);
  await page.getByRole('tab', { name: 'Tally ledgers' }).click();
  await expect(page.getByLabel('Tally ledger for sales', { exact: true })).toHaveValue(`Sales Account ${t}`);
  await expectNoSideScroll(page);

  // U21: the branch's day — ₹500 expected in its drawer; ₹480 is counted; closed, it shows ₹20 short.
  await page.goto('/money/day-close');
  await settled(page);
  await choose(page, page.getByRole('combobox', { name: 'Branch', exact: true }), `Counter ${t}`);
  // The drawer's name and what the papers expect sit together in its card.
  const expectedLine = page.getByText(drawer, { exact: true }).locator('..');
  await expect(expectedLine.getByText('Expected ₹500.00')).toBeVisible();
  await page.getByLabel(`Counted for ${drawer}`).fill('480');
  await page.getByRole('button', { name: 'Close the day' }).click();
  await expect(page.getByText('The day is closed').first()).toBeVisible();
  await expect(page.getByText('This day is closed.')).toBeVisible();
  await expect(page.getByText('₹20.00 short')).toBeVisible();
  await expectNoSideScroll(page);
});
