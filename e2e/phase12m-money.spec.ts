import { expect, test } from '@playwright/test';
import { choose, expectNoSideScroll, settled, signIn, tag } from './phase11-kit';

const shots = process.env.E2E_SCREENSHOTS === '1';

/**
 * Phase 12M through the screens (rows U11, U13, U14, U15, U17, U20 of docs/plans/coverage.md): the accounts admin
 * types a tax rate and a payment mode, adds a party, issues a taxed invoice, takes part of the money, and sees
 * the rest in "Money owed", on the party's statement and on the day close.
 */
test('a taxed invoice is issued, part paid, and shows as owed', async ({ page }, info) => {
  const project = info.project.name;
  const snap = async (name: string) => {
    if (shots) await page.screenshot({ path: `docs/screenshots/phase12m/${project}-${name}.png` });
  };
  const t = tag(project);
  const names = { rate: `G${t}`, mode: `Till ${t}`, party: `Stone Buyer ${t}` };
  const dialog = page.getByRole('dialog');
  await signIn(page);

  // U13: a tax rate with the day it starts; U20: a way money is taken.
  await page.goto('/money/setup');
  await settled(page);
  await page.getByLabel('Code', { exact: true }).fill(names.rate);
  await page.getByLabel('Percent', { exact: true }).fill('18');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(names.rate, { exact: true })).toBeVisible();
  await snap('rates');
  await page.getByRole('tab', { name: 'Payment modes' }).click();
  await page.getByLabel('Name', { exact: true }).fill(names.mode);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(names.mode, { exact: true })).toBeVisible();
  for (const tab of ['Vendors to match', 'Tally ledgers']) {
    await page.getByRole('tab', { name: tab }).click();
    await settled(page);
    await expectNoSideScroll(page);
  }

  // U11: one party list.
  await page.goto('/money/parties');
  await settled(page);
  await page.getByRole('button', { name: 'Add a party' }).click();
  await dialog.getByLabel('Name', { exact: true }).fill(names.party);
  if ((await dialog.getByRole('button', { name: 'Customer', pressed: true }).count()) === 0)
    await dialog.getByRole('button', { name: 'Customer', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(names.party)).toBeVisible();
  await expectNoSideScroll(page);

  // U14: an invoice with a taxed line; the totals are worked out by the server as it is typed.
  await page.goto('/money/bills');
  await settled(page);
  await choose(page, page.getByRole('combobox', { name: 'New paper' }), 'Invoice');
  await choose(page, dialog.getByRole('combobox', { name: 'Party' }), names.party);
  await dialog.getByLabel('Item', { exact: true }).fill('Quartz slab');
  await dialog.getByLabel('Qty', { exact: true }).fill('2');
  await dialog.getByLabel('Rate', { exact: true }).fill('1000');
  await choose(page, dialog.getByRole('combobox', { name: 'Tax' }), names.rate);
  await expect(dialog.getByText('₹2,360')).toBeVisible();
  await snap('invoice');
  await dialog.getByRole('button', { name: 'Issue', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/is issued/)).toBeVisible();

  // U15: part of the money comes in; the invoice is part paid.
  await page.getByLabel('Search number or party').fill(names.party);
  await page.locator('li', { hasText: names.party }).first().getByRole('button').click();
  await dialog.getByRole('button', { name: 'Take payment' }).click();
  const pay = dialog.last();
  await pay.getByLabel('Amount', { exact: true }).fill('1000');
  await choose(page, pay.getByRole('combobox', { name: 'Paid by' }), names.mode);
  await pay.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Part paid').first()).toBeVisible();
  await snap('part-paid');
  await page.keyboard.press('Escape');
  await expectNoSideScroll(page);

  // U17: what is still owed, with ageing, and the party's statement.
  await page.goto('/money/owed');
  await settled(page);
  await expect(page.locator('li', { hasText: names.party }).getByText('₹1,360').first()).toBeVisible();
  await expectNoSideScroll(page);
  await snap('owed');
  await page.goto('/money/parties');
  await settled(page);
  await page.getByLabel('Search name, code or mobile').fill(names.party);
  await page.locator('li', { hasText: names.party }).getByRole('button', { name: 'Statement' }).click();
  await expect(dialog.getByText('They owe us')).toBeVisible();
  await expect(dialog.getByText('₹1,360').first()).toBeVisible();
  await snap('statement');
  await page.keyboard.press('Escape');

  // U20: the day close expects the money taken through the new mode.
  await page.goto('/money/day-close');
  await settled(page);
  await expectNoSideScroll(page);
  await snap('day-close');
});
