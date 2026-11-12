import { expect, test } from '@playwright/test';
import { call, choose, expectNoSideScroll, settled, shot, signIn, siteVisits, tag } from './phase11-kit';

/** Phase 11 through the screens: Live FMS columns, the report builder, and a fit-the-screen pass in English and Hindi. Row ids are from docs/plans/coverage.md. */

test('L18: Live FMS shows the columns chosen for a process', async ({ page }, info) => {
  await signIn(page);
  const flows = await call<{ id: string; name: string }[]>(page, 'GET', '/api/fms/flows');
  const flow = flows.find((f) => f.name === 'Sales Order to Dispatch')!;
  await call(page, 'PUT', `/api/fms/flows/${flow.id}/live-columns`, { columns: [] });
  await page.goto(`/fms/live?flow=${flow.id}`);
  await settled(page);
  await page.getByRole('button', { name: 'Columns' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Columns of this list')).toBeVisible();
  await dialog.getByLabel('Customer', { exact: true }).check();
  await dialog.getByLabel('Promised date').check();
  await expect(dialog.getByText('2 of 6 chosen')).toBeVisible();
  await shot(page, 'live-columns', info.project.name);
  await dialog.getByRole('button', { name: 'Save columns' }).click();
  await expect(page.getByText('Columns saved')).toBeVisible();
  // Every record now shows the two values under its title; dates read DD/MM/YYYY.
  const first = page.locator('main li').filter({ hasText: /#\d/ }).first();
  await expect(first.getByText('Customer:')).toBeVisible();
  await expect(first.getByText(/Promised date:\s*\d{2}\/\d{2}\/\d{4}/)).toBeVisible();
  await expectNoSideScroll(page);
  await shot(page, 'live-list', info.project.name);
  await call(page, 'PUT', `/api/fms/flows/${flow.id}/live-columns`, { columns: [] });
});

test('U9 U10: a report is built on screen from reportable fields, saved, opened from the list and exported', async ({
  page,
}, info) => {
  await signIn(page);
  const t = tag(info.project.name);
  const name = `Visit ${t}`;
  const { id } = await siteVisits(page, name, `V${t}`.slice(0, 6));
  for (const [site, visit_on, cost] of [
    ['Tonk mine', '2026-10-05', 1000],
    ['Tonk mine', '2026-10-20', 2500],
    ['Niwai factory', '2026-11-02', 4000],
    ['Kishangarh plant', '2026-11-18', 1500.5],
  ] as const)
    await call(page, 'POST', `/api/records/types/${id}/records`, { data: { site, visit_on, cost } });

  // The field editor shows the tick that makes a field usable in reports.
  await page.goto(`/records/types/${id}`);
  await settled(page);
  await page
    .getByRole('tab', { name: /^fields/i })
    .or(page.getByRole('button', { name: /^fields/i }))
    .first()
    .click();
  await expect(page.getByLabel('Use in reports').first()).toBeChecked();
  await expect(page.getByText('Ready to use in reports.').first()).toBeVisible();

  await page.goto('/reports/new');
  await settled(page);
  const report = `Visits by month ${t}`;
  await page.getByLabel('Name of the report').fill(report);
  await choose(page, page.getByRole('combobox', { name: 'What to report on' }), `Records: ${name}s`);
  await choose(page, page.getByRole('combobox', { name: 'Field to group by' }), 'Visit on');
  await page.getByRole('button', { name: 'Add a total' }).click();
  await choose(page, page.getByRole('combobox', { name: 'What to work out' }).nth(1), 'Total of');
  await page.getByRole('radio', { name: 'Bars' }).click();
  // Grouped by month: October has two visits worth 3,500; November two worth 5,500.5; the total row adds up.
  const table = page.locator('table').first();
  await expect(table.getByRole('row', { name: /Oct 2026\s*2\s*3,500/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /Nov 2026\s*2\s*5,500\.5/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /Total\s*4\s*9,000\.5/ })).toBeVisible();
  await expectNoSideScroll(page);
  await shot(page, 'report-builder', info.project.name);
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page).toHaveURL(/\/reports\/(?!new)[a-z0-9]+$/);

  // From the list, it opens with the same numbers; Excel comes as a real file.
  await page.goto('/reports');
  await page.getByRole('link', { name: new RegExp(report) }).click();
  await expect(
    page
      .locator('table')
      .first()
      .getByRole('row', { name: /Total\s*4\s*9,000\.5/ }),
  ).toBeVisible();
  const reportId = page.url().split('/').pop()!;
  const file = await page.request.get(`/api/reports/${reportId}/export?format=xlsx`);
  expect(file.status()).toBe(200);
  expect((await file.body()).subarray(0, 2).toString()).toBe('PK');
  await shot(page, 'report-saved', info.project.name);
});

test('Phase 11 screens fit the screen, in English and Hindi, with no browser date pickers', async ({
  page,
}, info) => {
  await signIn(page);
  const t = tag(info.project.name);
  const { id } = await siteVisits(page, `Fit ${t}`, `F${t}`.slice(0, 6));
  await call(page, 'POST', `/api/records/types/${id}/records`, {
    data: { site: 'Tonk mine', visit_on: '2026-11-20' },
  });
  const paths: [string, string][] = [
    ['/masters/lists', 'lists'],
    ['/records/types', 'record-types'],
    ['/records/types/new', 'record-type-new'],
    [`/records/types/${id}`, 'record-type'],
    [`/records/${id}`, 'record-list'],
    ['/reports', 'reports'],
    ['/reports/new', 'report-new'],
  ];
  for (const lang of ['en', 'hi'] as const) {
    await page.evaluate((l) => localStorage.setItem('mono.lang', l), lang);
    for (const [path, file] of paths) {
      await page.goto(path);
      await settled(page);
      await expectNoSideScroll(page);
      // No raw translation keys ("records.ed.title") and no browser date pickers (decision 46).
      const text = await page.locator('main').innerText();
      expect(text, `${path} (${lang})`).not.toMatch(
        /\b(records|reports|lists|links|forms|show|recordsReach)\.[a-z]+\.[a-zA-Z.]+\b/,
      );
      await expect(
        page.locator('input[type=date], input[type=time], input[type=datetime-local]'),
      ).toHaveCount(0);
      if (lang === 'en') await shot(page, file, info.project.name);
    }
  }
  await page.evaluate(() => localStorage.setItem('mono.lang', 'en'));
});
