import { expect, test } from '@playwright/test';
import { call, choose, expectNoSideScroll, settled, shot, signIn, tag } from './phase11-kit';

/** Phase 11 forms through the screens: remembered values, linked and dependent choices, formulas, shared lists, choices from another process, unique values. Row ids are from docs/plans/coverage.md. */

test('L1 L2 L9 L11 L12 L13: a start form remembers values, links a picked row, fills from it, narrows a dependent choice and works a formula out', async ({
  page,
}, info) => {
  await signIn(page);
  const t = tag(info.project.name);
  const me = await call<{ user: { id: string } }>(page, 'GET', '/api/auth/me');
  const master = (name: string, fields: object[]) =>
    call<{ id: string }>(page, 'POST', '/api/masters', {
      name: `${name} ${t}`,
      displayField: 'name',
      fields,
    });
  const outlets = await master('Outlets', [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'city', label: 'City', type: 'text' },
    { key: 'cover', label: 'Cover', type: 'number' },
  ]);
  const tables = await master('Tables', [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'outlet', label: 'Outlet', type: 'text' },
  ]);
  const rows: Record<string, { id: string }> = {};
  for (const [name, city, cover] of [
    ['Rooftop', 'Jaipur', 500],
    ['Garden', 'Ajmer', 250],
  ] as const)
    rows[name] = await call(page, 'POST', `/api/masters/${outlets.id}/rows`, { name, city, cover });
  for (const [name, outlet] of [
    ['R1', 'Rooftop'],
    ['R2', 'Rooftop'],
    ['G1', 'Garden'],
  ])
    await call(page, 'POST', `/api/masters/${tables.id}/rows`, { name, outlet });
  const flow = await call<{ id: string }>(page, 'POST', '/api/fms/flows', {
    meta: { name: `Bookings ${t}`, runName: 'Booking' },
  });
  await call(page, 'PUT', `/api/fms/flows/${flow.id}`, {
    definition: {
      timeModel: 'calendar',
      startFields: [
        { key: 'guest', label: 'Guest', type: 'text', required: true },
        { key: 'venue', label: 'Venue', type: 'text', learn: true },
        {
          key: 'outlet',
          label: 'Outlet',
          type: 'master',
          master: `m:${outlets.id}`,
          fill: { city: 'city', cover: 'cover' },
        },
        { key: 'city', label: 'City', type: 'text', locked: true },
        { key: 'cover', label: 'Cover charge', type: 'number' },
        {
          key: 'table',
          label: 'Table',
          type: 'master',
          master: `m:${tables.id}`,
          filterBy: { field: 'outlet', column: 'outlet' },
        },
        { key: 'guests', label: 'Guests', type: 'number' },
        { key: 'rate', label: 'Rate', type: 'amount' },
        { key: 'total', label: 'Total', type: 'formula', formula: 'guests * rate' },
      ],
      steps: [
        {
          key: 'confirm',
          name: 'Confirm',
          type: 'TASK',
          doerIds: [me.user.id],
          time: { value: 4, unit: 'hours', anchor: 'previous' },
          fields: [],
        },
      ],
    },
  });
  await call(page, 'POST', `/api/fms/flows/${flow.id}/publish`);
  // Earlier bookings: "Poolside" twice, "Lawn" once.
  for (const venue of ['Lawn', 'Poolside', 'Poolside'])
    await call(page, 'POST', `/api/fms/flows/${flow.id}/records`, {
      data: { guest: 'Earlier guest', venue },
    });

  const open = async () => {
    await page.goto(`/fms/live?flow=${flow.id}`);
    await settled(page);
    await page.getByRole('button', { name: /new booking/i }).click();
    return page.getByRole('dialog');
  };
  let dlg = await open();
  await dlg.getByRole('textbox', { name: 'Guest *' }).fill(`Sharma wedding ${t}`);

  // L1: a dropdown of what was typed before, most used first; L2: the last choice is "Write…".
  await dlg.getByRole('combobox', { name: 'Venue' }).click();
  await expect(page.getByRole('option')).toHaveText(['Poolside', 'Lawn', 'Write…']);
  await page.getByRole('option', { name: 'Write…' }).click();
  await dlg.getByLabel('Venue').fill(`Terrace ${t}`);

  // L12: no tables until an outlet is chosen; then only that outlet's tables.
  await expect(dlg.getByRole('combobox', { name: 'Table' })).toBeDisabled();
  await dlg.getByRole('combobox', { name: 'Outlet' }).click();
  await page.getByRole('option', { name: 'Rooftop' }).click();
  // L11: picking the outlet fills the cover charge (editable) and the city (locked).
  await expect(dlg.getByLabel('Cover charge')).toHaveValue('500');
  await expect(dlg.getByLabel('City')).toContainText('Jaipur');
  await dlg.getByRole('combobox', { name: 'Table' }).click();
  await expect(page.getByRole('option')).toHaveText(['R1', 'R2']);
  await page.getByRole('option', { name: 'R2' }).click();

  // L13: the formula is worked out as the numbers are typed.
  await dlg.getByRole('textbox', { name: 'Guests', exact: true }).fill('12');
  await dlg.getByLabel('Rate').fill('1500.5');
  await expect(dlg.getByRole('status', { name: 'Total' })).toHaveText('18,006');
  await expectNoSideScroll(page);
  await shot(page, 'start-form', info.project.name);
  await dlg.getByRole('button', { name: 'Start' }).click();

  // The record: the server stored the same total, the city, and the link to the outlet's row.
  await expect(page).toHaveURL(/record=/);
  const recordId = new URL(page.url()).searchParams.get('record')!;
  const rec = await call<{ data: Record<string, unknown> }>(page, 'GET', `/api/fms/records/${recordId}`);
  expect(rec.data).toMatchObject({
    venue: `Terrace ${t}`,
    outlet: 'Rooftop',
    city: 'Jaipur',
    cover: 500,
    table: 'R2',
    total: 18006,
    _refs: { outlet: `row:${rows.Rooftop!.id}` },
  });

  // L9: the outlet is renamed — the record still points at it and shows the new name.
  await call(page, 'PUT', `/api/masters/${outlets.id}/rows/${rows.Rooftop!.id}`, {
    name: 'Sky Lounge',
    city: 'Jaipur',
    cover: 500,
  });
  await page.reload();
  await expect(
    page
      .getByRole('dialog')
      .getByText(/Sky Lounge/)
      .first(),
  ).toBeVisible();
  await shot(page, 'record-renamed-link', info.project.name);

  // L2: the value written by hand is offered to the next booking.
  dlg = await open();
  await dlg.getByRole('combobox', { name: 'Venue' }).click();
  await expect(page.getByRole('option', { name: `Terrace ${t}` })).toBeVisible();
});

test('L3 L4: a shared list feeds two processes; an admin renames, merges and hides values and old records keep what they said', async ({
  page,
}, info) => {
  await signIn(page);
  const t = tag(info.project.name);
  const me = await call<{ user: { id: string } }>(page, 'GET', '/api/auth/me');
  const list = `halls_${t.toLowerCase()}`;
  const flowWith = async (name: string, runName: string, field: object) => {
    const flow = await call<{ id: string }>(page, 'POST', '/api/fms/flows', {
      meta: { name: `${name} ${t}`, runName },
    });
    await call(page, 'PUT', `/api/fms/flows/${flow.id}`, {
      definition: {
        timeModel: 'calendar',
        startFields: [{ key: 'guest', label: 'Guest', type: 'text', required: true }, field],
        steps: [
          {
            key: 'confirm',
            name: 'Confirm',
            type: 'TASK',
            doerIds: [me.user.id],
            time: { value: 4, unit: 'hours', anchor: 'previous' },
            fields: [],
          },
        ],
      },
    });
    await call(page, 'POST', `/api/fms/flows/${flow.id}/publish`);
    return flow.id;
  };
  // Two processes whose fields use the same named list.
  const banquets = await flowWith('Banquets', 'Banquet', {
    key: 'hall',
    label: 'Hall',
    type: 'text',
    learn: true,
    list,
  });
  const meetings = await flowWith('Meetings', 'Meeting', {
    key: 'room',
    label: 'Room',
    type: 'text',
    learn: true,
    list,
  });
  const made: Record<string, string> = {};
  for (const hall of ['Poolside', 'Poolside', 'Lawn', 'Pool side', 'Old shed'])
    made[hall] = (
      await call<{ id: string }>(page, 'POST', `/api/fms/flows/${banquets}/records`, {
        data: { guest: 'Earlier', hall },
      })
    ).id;

  // L3: the other process offers what the first one learned.
  const offered = async () => {
    await page.goto(`/fms/live?flow=${meetings}`);
    await settled(page);
    await page.getByRole('button', { name: /new meeting/i }).click();
    await page.getByRole('dialog').getByRole('combobox', { name: 'Room' }).click();
    await expect(page.getByRole('option').first()).toBeVisible();
    return page.getByRole('option').allInnerTexts();
  };
  // Most used first (ties: the latest first), and "Write…" last.
  const before = await offered();
  expect(before[0]).toBe('Poolside');
  expect(before.at(-1)).toBe('Write…');
  expect([...before].sort()).toEqual(['Lawn', 'Old shed', 'Pool side', 'Poolside', 'Write…']);

  // L4: Masters → Lists. The list is used in both processes.
  await page.goto('/masters/lists');
  await settled(page);
  await page.getByPlaceholder('Search lists').fill(`Banquets ${t}`);
  await page
    .locator('main')
    .getByRole('button')
    .filter({ hasText: `Banquets ${t}` })
    .first()
    .click();
  const main = page.locator('main');
  await expect(main.getByText(new RegExp(`Banquets ${t} · Hall`)).last()).toBeVisible();
  await expect(main.getByText(new RegExp(`Meetings ${t} · Room`)).last()).toBeVisible();
  const row = (value: string) =>
    main
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: 'Rename' }) })
      .filter({ hasText: value });
  // Rename "Lawn" → "Garden lawn".
  await row('Lawn').getByRole('button', { name: 'Rename' }).click();
  let dlg = page.getByRole('dialog').last();
  await dlg.getByRole('textbox', { name: 'Value' }).fill('Garden lawn');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(row('Garden lawn')).toBeVisible();
  // Merge the misspelt "Pool side" into "Poolside": its use is added to the one kept.
  await row('Pool side').getByRole('button', { name: 'Merge into another' }).click();
  dlg = page.getByRole('dialog').last();
  await choose(page, dlg.getByRole('combobox', { name: 'Keep this value' }), 'Poolside');
  await dlg.getByRole('button', { name: 'Merge' }).click();
  await expect(row('Pool side')).toHaveCount(0);
  await expect(row('Poolside')).toContainText('3 uses');
  // Hide "Old shed": it stays in the list's records but is not offered any more.
  await row('Old shed').getByRole('button', { name: 'Hide' }).click();
  await expectNoSideScroll(page);
  await shot(page, 'lists-admin', info.project.name);

  // Forms offer the tidied list …
  expect(await offered()).toEqual(['Poolside', 'Garden lawn', 'Write…']);
  // … and old records keep what they said.
  for (const [hall, id] of Object.entries(made)) {
    const rec = await call<{ data: { hall: string } }>(page, 'GET', `/api/fms/records/${id}`);
    expect(rec.data.hall).toBe(hall);
  }
});

test('L6 L7 L8 L10: choices come from another process — its typed values and its records (only running ones) — and a unique value is refused twice', async ({
  page,
}, info) => {
  await signIn(page);
  const t = tag(info.project.name);
  const me = await call<{ user: { id: string } }>(page, 'GET', '/api/auth/me');
  const publish = async (name: string, runName: string, startFields: object[]) => {
    const flow = await call<{ id: string }>(page, 'POST', '/api/fms/flows', {
      meta: { name: `${name} ${t}`, runName },
    });
    await call(page, 'PUT', `/api/fms/flows/${flow.id}`, {
      definition: {
        timeModel: 'calendar',
        startFields,
        steps: [
          {
            key: 'check',
            name: 'Check',
            type: 'TASK',
            doerIds: [me.user.id],
            time: { value: 4, unit: 'hours', anchor: 'previous' },
            fields: [],
          },
        ],
      },
    });
    await call(page, 'POST', `/api/fms/flows/${flow.id}/publish`);
    return flow.id;
  };
  const requests = await publish('Purchase requests', 'Request', [
    { key: 'material', label: 'Material', type: 'text', required: true },
  ]);
  const start = (flowId: string, data: object) =>
    call<{ id: string; number: number }>(page, 'POST', `/api/fms/flows/${flowId}/records`, { data });
  const steel = await start(requests, { material: `Steel rods ${t}` });
  const cement = await start(requests, { material: `Cement ${t}` });
  const sand = await start(requests, { material: `Sand ${t}` });
  await call(page, 'POST', `/api/fms/records/${sand.id}/actions`, { action: 'cancel', reason: 'Not needed' });
  const receipts = await publish('Goods receipts', 'Receipt', [
    {
      key: 'material',
      label: 'Material',
      type: 'master',
      master: `fms:${requests}:material`,
      required: true,
    },
    {
      key: 'request',
      label: 'Request',
      type: 'master',
      master: `rec:${requests}`,
      recFilter: { running: true },
    },
    { key: 'grn_no', label: 'GRN no', type: 'text', required: true, unique: true },
  ]);

  const open = async () => {
    await page.goto(`/fms/live?flow=${receipts}`);
    await settled(page);
    await page.getByRole('button', { name: /new receipt/i }).click();
    return page.getByRole('dialog');
  };
  const fill = async (grn: string) => {
    const dlg = await open();
    // L6: the values typed in "Material" of the other process (the cancelled request's value is not offered).
    await dlg.getByRole('combobox', { name: /^Material/ }).click();
    await expect(page.getByRole('option', { name: `Steel rods ${t}` })).toBeVisible();
    await expect(page.getByRole('option', { name: `Cement ${t}` })).toBeVisible();
    await expect(page.getByRole('option', { name: `Sand ${t}` })).toHaveCount(0);
    await page.getByRole('option', { name: `Steel rods ${t}` }).click();
    // L7: a whole record of the other process, shown "#n · title · DD/MM/YYYY"; L8: only running ones.
    await dlg.getByRole('combobox', { name: 'Request' }).click();
    const label = new RegExp(`^#${steel.number} · Steel rods ${t} · \\d{2}/\\d{2}/\\d{4}`);
    await expect(page.getByRole('option', { name: label })).toBeVisible();
    await expect(
      page.getByRole('option', { name: new RegExp(`#${cement.number} · Cement ${t}`) }),
    ).toBeVisible();
    await expect(page.getByRole('option', { name: new RegExp(`Sand ${t}`) })).toHaveCount(0);
    await page.getByRole('option', { name: label }).click();
    await dlg.getByRole('textbox', { name: /GRN no/ }).fill(grn);
    return dlg;
  };

  let dlg = await fill(`GRN-${t}`);
  await expectNoSideScroll(page);
  await shot(page, 'choices-from-process', info.project.name);
  await dlg.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/record=/);
  const first = new URL(page.url()).searchParams.get('record')!;
  const saved = await call<{ data: { request: string; _refs?: Record<string, string> } }>(
    page,
    'GET',
    `/api/fms/records/${first}`,
  );
  expect(saved.data._refs?.request).toBe(`rec:${steel.id}`);

  // L10: the same GRN number again (whatever the capitals) is refused, and nothing is started.
  dlg = await fill(`grn-${t.toLowerCase()}`);
  await dlg.getByRole('button', { name: 'Start' }).click();
  await expect(dlg.getByText(/already/i).first()).toBeVisible();
  await expect(page).not.toHaveURL(/record=/);
  await shot(page, 'unique-refused', info.project.name);
  // Cancelling the record that holds it frees the number.
  await call(page, 'POST', `/api/fms/records/${first}/actions`, {
    action: 'cancel',
    reason: 'Entered twice',
  });
  await dlg.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/record=/);
});
