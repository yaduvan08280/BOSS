import { expect, test } from '@playwright/test';
import { call, choose, expectNoSideScroll, settled, shot, signIn, siteVisits, tag } from './phase11-kit';

/** Phase 11 record types through the screens: set-up, a move that starts a process, records with links and lines, Build with AI. Row ids are from docs/plans/coverage.md. */

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

test('U3 U4 U5: a record is made on screen with a link and child lines, found in its list, moved with a reason, and exported', async ({
  page,
}, info) => {
  await signIn(page);
  const t = tag(info.project.name);
  const type = await call<{ id: string }>(page, 'POST', '/api/records/types', {
    name: `Inspection ${t}`,
    pluralName: `Inspections ${t}`,
    prefix: `I${t}`.slice(0, 6),
    definition: {
      fields: [
        { key: 'site', label: 'Site', type: 'text', required: true },
        { key: 'customer', label: 'Customer', type: 'master', master: 'customers' },
        { key: 'visit_on', label: 'Visit on', type: 'date' },
        { key: 'cost', label: 'Cost', type: 'amount' },
      ],
      tables: [
        {
          key: 'findings',
          label: 'Findings',
          fields: [
            { key: 'what', label: 'What', type: 'text', required: true },
            { key: 'qty', label: 'Qty', type: 'number' },
          ],
        },
      ],
      statuses: [
        { key: 'planned', label: 'Planned', kind: 'info' },
        { key: 'visited', label: 'Visited', kind: 'ok', final: true },
      ],
      start: 'planned',
      moves: [
        {
          from: 'planned',
          action: 'visit',
          label: 'Mark visited',
          to: 'visited',
          who: ['edit'],
          noteRequired: true,
        },
      ],
    },
    menu: { section: 'systems', icon: 'map-pin' },
  });
  await call(page, 'POST', `/api/records/types/${type.id}/records`, {
    data: { site: 'Tonk mine', cost: 1200 },
  });

  await page.goto(`/records/${type.id}`);
  await settled(page);
  // On a phone the list is cards (the table stays in the page, hidden): look at what is shown.
  const shown = (text: string) => page.getByText(text).filter({ visible: true }).first();
  await expect(shown('Tonk mine')).toBeVisible();
  // U1/U3: a new record through its form — a picked customer (a link), a date typed DD/MM/YYYY, a child line.
  await page.getByRole('button', { name: /^New Inspection/ }).click();
  const form = page.getByRole('dialog').last();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Site is required').first()).toBeVisible(); // refused with the reason, nothing saved
  await form.getByRole('textbox', { name: 'Site *' }).fill(`Niwai factory ${t}`);
  await form.getByRole('combobox', { name: 'Customer' }).click();
  const customer = (await page.getByRole('option').first().innerText()).split('\n')[0]!.trim();
  await page.getByRole('option').first().click();
  await form.getByRole('textbox', { name: /Visit on/ }).fill('20/11/2026');
  await form.getByRole('textbox', { name: 'Cost' }).fill('2500');
  await form.getByRole('button', { name: 'Add a line' }).click();
  await form.getByRole('textbox', { name: 'What *' }).fill('Crack in wall');
  await form.getByRole('textbox', { name: 'Qty' }).fill('2');
  await expectNoSideScroll(page);
  await shot(page, 'record-form', info.project.name);
  await form.getByRole('button', { name: 'Save' }).click();

  // The drawer opens on the new record: its own number (the second of this type), values as people read them.
  const drawer = page.getByRole('dialog').last();
  await expect(drawer.getByRole('heading', { name: /\/0002 Niwai factory/ })).toBeVisible();
  await expect(drawer).toContainText('20/11/2026');
  await expect(drawer).toContainText('₹2,500');
  await expect(drawer).toContainText(customer);
  await expect(drawer).toContainText('Crack in wall');
  const recordId = new URL(page.url()).searchParams.get('record')!;
  const saved = await call<{ record: { data: { _refs?: Record<string, string> } } }>(
    page,
    'GET',
    `/api/records/entries/${recordId}`,
  );
  expect(saved.record.data._refs?.customer).toMatch(/^customer:/); // the link is kept beside the text

  // U2: the move asks why; the status changes; the note and the history say what happened.
  await drawer.getByRole('button', { name: 'Mark visited' }).click();
  const why = page.getByRole('dialog').last();
  await why.getByRole('textbox').fill('Seen with the site engineer');
  await why.getByRole('button', { name: /mark visited/i }).click();
  await expect(page.getByText('Now: Visited').first()).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Mark visited' })).toHaveCount(0); // final: nothing more to do
  await expect(drawer).toContainText('Seen with the site engineer');
  await drawer
    .getByRole('tab', { name: /history/i })
    .or(drawer.getByRole('button', { name: /^history/i }))
    .first()
    .click();
  await expect(drawer).toContainText('Mark visited: Planned → Visited');
  await shot(page, 'record-drawer', info.project.name);
  await page.keyboard.press('Escape');

  // U4: the list — status counts, and a search over every value.
  await expect(page.getByRole('button', { name: 'Planned 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Visited 1' })).toBeVisible();
  await page.getByPlaceholder('Search number, title or any value').fill(`niwai factory ${t}`);
  await expect(page.getByText('Tonk mine').filter({ visible: true })).toHaveCount(0);
  await expect(shown(`Niwai factory ${t}`)).toBeVisible();
  await expectNoSideScroll(page);
  await shot(page, 'record-list', info.project.name);

  // U5: the list exports with the same search (CSV here; Excel is the same route).
  const csv = await page.request.get(
    `/api/records/types/${type.id}/export?format=csv&q=${encodeURIComponent(`niwai factory ${t}`)}`,
  );
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  expect(text).toContain(`Niwai factory ${t}`);
  expect(text).not.toContain('Tonk mine');
  expect(text).toContain('20/11/2026');
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
