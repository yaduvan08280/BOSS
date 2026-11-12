import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Phase 11 (linked fields, record types, reports) through the screens. Set-up that a test does not prove goes
 * through the API; what it proves is driven in the browser, on a phone (380 px) and a desktop (1440 px).
 * Row ids are from docs/plans/coverage.md.
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234';
const OWNER = '9000000000';
const shots = process.env.E2E_SCREENSHOTS === '1';

async function shot(page: Page, name: string, project: string) {
  if (shots)
    await page.screenshot({ path: `docs/screenshots/phase11/${project}-${name}.png`, fullPage: false });
}
async function expectNoSideScroll(page: Page) {
  const width = page.viewportSize()!.width;
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    `page is wider than the screen at ${page.url()}`,
  ).toBeLessThanOrEqual(width);
}
async function settled(page: Page) {
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 10_000 });
}
async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/mobile number or email/i).fill(OWNER);
  await page.getByLabel(/^password$/i).fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('heading', { name: /what do you want to do/i })).toBeVisible();
}
async function choose(page: Page, trigger: Locator, text: string) {
  await trigger.click();
  const search = page.getByRole('searchbox');
  if (await search.count()) await search.fill(text);
  await page
    .getByRole('option', { name: new RegExp(text, 'i') })
    .first()
    .click();
}
const headers = (page: Page) => ({ origin: new URL(page.url()).origin });
async function call<T = Record<string, unknown>>(
  page: Page,
  method: string,
  url: string,
  data?: unknown,
): Promise<T> {
  const r = await page.request.fetch(url, { method, data, headers: headers(page) });
  expect(r.ok(), `${method} ${url} → ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}
/** A different name on every run and in each project, so the suite can be run again on the same data. */
const tag = (project: string) =>
  `${project === 'phone' ? 'P' : 'D'}${Date.now().toString(36).slice(-5).toUpperCase()}`;

type TypeInput = { id: string };
/** A "Site visit" type with reportable fields, made through the API. */
async function siteVisits(page: Page, name: string, prefix: string) {
  return call<TypeInput>(page, 'POST', '/api/records/types', {
    name,
    pluralName: `${name}s`,
    prefix,
    definition: {
      fields: [
        { key: 'site', label: 'Site', type: 'text', required: true, reportable: true },
        { key: 'visit_on', label: 'Visit on', type: 'date', reportable: true },
        { key: 'cost', label: 'Cost', type: 'amount', reportable: true },
      ],
      tables: [],
      statuses: [
        { key: 'planned', label: 'Planned', kind: 'info' },
        { key: 'confirmed', label: 'Confirmed', kind: 'ok' },
        { key: 'closed', label: 'Closed', kind: 'neutral', final: true },
      ],
      start: 'planned',
      moves: [
        { from: 'planned', action: 'confirm', label: 'Confirm', to: 'confirmed', who: ['edit'] },
        { from: 'confirmed', action: 'close', label: 'Close', to: 'closed', who: ['edit'] },
      ],
    },
    menu: { section: 'systems', icon: 'map-pin' },
  });
}

test('U1 U2 U7: a record type is set up on screen, a move starts a process, and the record says so', async ({
  page,
}, info) => {
  await signIn(page);
  const t = tag(info.project.name);
  const name = `Site visit ${t}`;
  const { id } = await siteVisits(page, name, `S${t}`.slice(0, 6));

  // The type editor: "This move starts a process" on the Confirm move, filled from the record.
  await page.goto(`/records/types/${id}`);
  await settled(page);
  await page
    .getByRole('tab', { name: /statuses/i })
    .or(page.getByRole('button', { name: /statuses & moves/i }))
    .first()
    .click();
  const starts = page.getByLabel('This move starts a process').first();
  await starts.check();
  await choose(page, page.getByRole('combobox', { name: 'Process to start' }), 'Returns & Complaints');
  await choose(page, page.getByRole('combobox', { name: /Where Customer comes from/ }), 'Field: Site');
  await expectNoSideScroll(page);
  await shot(page, 'type-start-flow', info.project.name);
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();

  // A record of it: the Confirm button moves it and starts the process; History links to the process record.
  const rec = await call<{ id: string; code: string }>(page, 'POST', `/api/records/types/${id}/records`, {
    data: { site: `Tonk mine ${t}`, cost: '2500', visit_on: '2026-11-20' },
  });
  await page.goto(`/records/${id}?record=${rec.id}`);
  await page.getByRole('button', { name: 'Confirm' }).click();
  const sure = page.getByRole('dialog').getByRole('button', { name: /confirm/i });
  if (await sure.count()) await sure.last().click();
  await expect(page.getByText('Now: Confirmed').first()).toBeVisible();
  await page
    .getByRole('tab', { name: /history/i })
    .or(page.getByRole('button', { name: /^history$/i }))
    .first()
    .click();
  const started = page.getByRole('link', { name: /Started Returns & Complaints #\d+/ });
  await expect(started).toBeVisible();
  await expectNoSideScroll(page);
  await shot(page, 'record-history', info.project.name);
  await started.click();
  await expect(page).toHaveURL(/\/fms\/live\?record=/);
  await expect(page.getByRole('dialog').getByText(`Tonk mine ${t}`).first()).toBeVisible();
});

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

test('U8: "Build with AI" opens the type editor on an unsaved draft (model answer stubbed)', async ({
  page,
}, info) => {
  await signIn(page);
  const t = tag(info.project.name);
  const draft = {
    name: `Vehicle trip ${t}`,
    pluralName: `Vehicle trips ${t}`,
    prefix: `T${t}`.slice(0, 6),
    description: 'One trip of a vehicle',
    problems: [],
    definition: {
      fields: [
        { key: 'vehicle', label: 'Vehicle', type: 'text', required: true },
        { key: 'km', label: 'Kilometres', type: 'number', required: false },
      ],
      tables: [],
      statuses: [
        { key: 'planned', label: 'Planned', kind: 'info' },
        { key: 'finished', label: 'Finished', kind: 'ok', final: true },
      ],
      start: 'planned',
      moves: [{ from: 'planned', action: 'finish', label: 'Finish', to: 'finished', who: ['edit'] }],
      displayField: 'vehicle',
    },
  };
  await page.route('**/api/ai/status', (r) =>
    r.fulfill({ json: { connected: true, provider: 'anthropic', model: 'stub', stt: 'browser' } }),
  );
  await page.route('**/api/ai/record-types/draft', (r) => r.fulfill({ json: draft }));
  await page.goto('/records/types');
  await settled(page);
  await page.getByRole('button', { name: 'Build with AI' }).click();
  await page.getByRole('button', { name: 'Vehicle trip' }).click();
  await shot(page, 'type-ai-dialog', info.project.name);
  await page.getByRole('button', { name: 'Draft it' }).click();
  await expect(page.getByText('Drafted by AI.')).toBeVisible();
  // Nothing is saved until the person presses Save.
  const before = await call<{ types: { name: string }[] }>(page, 'GET', '/api/records/types');
  expect(before.types.map((x) => x.name)).not.toContain(draft.name);
  await expectNoSideScroll(page);
  await shot(page, 'type-ai-draft', info.project.name);
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page).toHaveURL(/\/records\/types\/(?!new)[a-z0-9]+$/);
  const after = await call<{ types: { name: string }[] }>(page, 'GET', '/api/records/types');
  expect(after.types.map((x) => x.name)).toContain(draft.name);
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
