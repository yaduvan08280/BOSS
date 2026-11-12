import { expect, test, type Page } from '@playwright/test';
import {
  GOPAL,
  as,
  call,
  choose,
  expectNoSideScroll,
  headers,
  settled,
  shot,
  signIn,
  tag,
} from './phase11-kit';

/** Phase 11 through the screens: stock on a step, and what a member (not an admin) may do. Row ids are from docs/plans/coverage.md. */

test('L5 U6: a member can only pick from a closed list, and is shut out of a record type that is not theirs', async ({
  page,
  browser,
}, info) => {
  await signIn(page);
  const t = tag(info.project.name);
  const me = await call<{ user: { id: string } }>(page, 'GET', '/api/auth/me');
  const roles = (await call<{ roles: { id: string; key: string | null }[] }>(page, 'GET', '/api/org/roles'))
    .roles;
  const hod = roles.find((r) => r.key === 'HOD')!.id;
  // A process whose "Grade" list only admins may add to, with two values already in it.
  const flow = await call<{ id: string }>(page, 'POST', '/api/fms/flows', {
    meta: { name: `Grading ${t}`, runName: 'Lot' },
  });
  await call(page, 'PUT', `/api/fms/flows/${flow.id}`, {
    definition: {
      timeModel: 'calendar',
      startFields: [
        { key: 'lot', label: 'Lot', type: 'text', required: true },
        { key: 'grade', label: 'Grade', type: 'text', learn: true, writeAllowed: false },
      ],
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
  for (const grade of ['Premium', 'Standard'])
    await call(page, 'POST', `/api/fms/flows/${flow.id}/records`, { data: { lot: 'Earlier lot', grade } });
  // Two record types: one for heads of department only, one for everyone.
  const makeType = (name: string, permissions?: object) =>
    call<{ id: string }>(page, 'POST', '/api/records/types', {
      name: `${name} ${t}`,
      pluralName: `${name}s ${t}`,
      prefix: `${name[0]}${t}`.slice(0, 6),
      definition: {
        fields: [{ key: 'title', label: 'Title', type: 'text', required: true }],
        tables: [],
        statuses: [
          { key: 'open', label: 'Open', kind: 'info' },
          { key: 'closed', label: 'Closed', kind: 'neutral', final: true },
        ],
        start: 'open',
        moves: [{ from: 'open', action: 'close', label: 'Close', to: 'closed', who: ['edit'] }],
      },
      menu: { section: 'systems', icon: 'file-text' },
      ...(permissions ? { permissions } : {}),
    });
  const secret = await makeType('Audit note', { view: [hod], create: [hod], edit: [hod], approve: [hod] });
  const open = await makeType('Visitor pass');
  await call(page, 'POST', `/api/records/types/${secret.id}/records`, {
    data: { title: 'Cash count short' },
  });

  const grades = async (p: Page) => {
    await p.goto(`/fms/live?flow=${flow.id}`);
    await settled(p);
    await p.getByRole('button', { name: /new lot/i }).click();
    await p.getByRole('dialog').getByRole('combobox', { name: 'Grade' }).click();
    await expect(p.getByRole('option').first()).toBeVisible();
    return (await p.getByRole('option').allInnerTexts()).sort();
  };
  // L5: the owner may still write a new value; the member gets a strict dropdown.
  expect(await grades(page)).toEqual(['Premium', 'Standard', 'Write…']);
  const gopal = await as(browser, GOPAL, info);
  try {
    expect(await grades(gopal.page)).toEqual(['Premium', 'Standard']);
    await shot(gopal.page, 'closed-list-member', info.project.name);
    // … and the server refuses a value that is not on the list, whatever the browser sends.
    const forced = await gopal.page.request.post(`/api/fms/flows/${flow.id}/records`, {
      data: { data: { lot: 'Lot 9', grade: 'Invented grade' } },
      headers: headers(gopal.page),
    });
    expect(forced.status()).toBe(400);

    // U6: the member sees the type made for everyone, not the one for heads of department.
    const menu = await call<{ id: string; name: string }[]>(gopal.page, 'GET', '/api/records/menu');
    expect(menu.map((m) => m.id)).toContain(open.id);
    expect(menu.map((m) => m.id)).not.toContain(secret.id);
    expect((await gopal.page.request.get(`/api/records/types/${secret.id}/records`)).status()).toBe(403);
    await gopal.page.goto(`/records/${secret.id}`);
    await expect(gopal.page.locator('main')).toBeVisible();
    await expect(gopal.page.getByText('Cash count short')).toHaveCount(0);
    await shot(gopal.page, 'record-type-no-access', info.project.name);
    // In the open type the member adds a record through the screen.
    await gopal.page.goto(`/records/${open.id}`);
    await settled(gopal.page);
    await gopal.page
      .getByRole('button', { name: /^New Visitor pass/ })
      .first()
      .click();
    const form = gopal.page.getByRole('dialog').last();
    await form.getByRole('textbox', { name: 'Title *' }).fill(`Courier at gate ${t}`);
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(
      gopal.page
        .getByRole('dialog')
        .last()
        .getByRole('heading', { name: /\/0001/ }),
    ).toBeVisible();
    await expectNoSideScroll(gopal.page);
  } finally {
    await gopal.close();
  }
});

test('L14 L15 L16 L17: item lines pick from the item master; a step issues stock after a preview, is blocked when short, and a cancel gives it back', async ({
  page,
}, info) => {
  await signIn(page);
  const t = tag(info.project.name);
  const me = await call<{ user: { id: string } }>(page, 'GET', '/api/auth/me');
  type Item = { id: string; code: string; name: string; stock: number; unit: string; rate: string | number };
  const items = async () => {
    const got = await call<Item[] | { items: Item[] }>(page, 'GET', '/api/ims/items');
    return Array.isArray(got) ? got : got.items;
  };
  const item = (await items()).find((x) => Number(x.stock) > 20)!;
  const stockNow = async () => Number((await items()).find((x) => x.id === item.id)!.stock);
  const before = await stockNow();
  const flow = await call<{ id: string }>(page, 'POST', '/api/fms/flows', {
    meta: { name: `Issue ${t}`, runName: 'Issue' },
  });
  const task = (key: string, name: string, extra: object = {}) => ({
    key,
    name,
    type: 'TASK',
    doerIds: [me.user.id],
    time: { value: 4, unit: 'hours', anchor: 'previous' },
    fields: [],
    ...extra,
  });
  await call(page, 'PUT', `/api/fms/flows/${flow.id}`, {
    definition: {
      timeModel: 'calendar',
      startFields: [
        { key: 'job', label: 'Job', type: 'text', required: true },
        { key: 'lines', label: 'Materials', type: 'items', freeItems: false },
      ],
      steps: [
        task('issue', 'Issue materials', { stock: { action: 'ISSUE', itemsField: 'lines', short: 'block' } }),
        task('check', 'Check the job'),
      ],
    },
  });
  await call(page, 'POST', `/api/fms/flows/${flow.id}/publish`);

  /** Start a record through the start form with one line of the item, and open its first step. */
  const startAndOpenStep = async (job: string, qty: string) => {
    await page.goto(`/fms/live?flow=${flow.id}`);
    await settled(page);
    await page.getByRole('button', { name: /new issue/i }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('textbox', { name: 'Job *' }).fill(job);
    // L14: the line picks from the item master (by name or code) and shows its unit, rate and live stock.
    await choose(page, dlg.getByRole('combobox', { name: 'Item' }), item.code);
    await expect(dlg.getByText(new RegExp(`In stock: [\\d.,]+ ${item.unit}`))).toBeVisible();
    await expect(dlg.getByRole('textbox', { name: 'Rate' })).not.toHaveValue('');
    await dlg.getByRole('textbox', { name: 'Qty' }).fill(qty);
    await dlg.getByRole('button', { name: 'Start' }).click();
    await expect(page).toHaveURL(/record=/);
    const id = new URL(page.url()).searchParams.get('record')!;
    await page.getByRole('dialog').getByRole('button', { name: 'Do my step' }).click();
    return { id, step: page.getByRole('dialog').last() };
  };

  // L15: the preview says what will go out; Mark done issues it.
  const good = await startAndOpenStep(`Line 2 repair ${t}`, '2');
  await expect(good.step.getByText('Goes out of stock')).toBeVisible();
  await expect(good.step.getByRole('listitem').filter({ hasText: item.code })).toContainText(
    `2 ${item.unit}`,
  );
  await expectNoSideScroll(page);
  await shot(page, 'step-stock-preview', info.project.name);
  await good.step.getByRole('button', { name: 'Mark done' }).click();
  await expect.poll(stockNow).toBe(before - 2);

  // L16: more than there is — the preview warns, and the step can't be marked done.
  const short = await startAndOpenStep(`Too much ${t}`, '999999');
  await expect(short.step.getByRole('alert')).toContainText('Not enough stock');
  await expect(short.step.getByRole('listitem').filter({ hasText: item.code })).toContainText(/Short by/);
  await shot(page, 'step-stock-short', info.project.name);
  await short.step.getByRole('button', { name: 'Mark done' }).click();
  await expect(page.getByText(/not enough|short/i).first()).toBeVisible();
  const still = await call<{ steps: { stepKey: string; status: string }[] }>(
    page,
    'GET',
    `/api/fms/records/${short.id}`,
  );
  expect(still.steps.find((x) => x.stepKey === 'issue')!.status).toBe('OPEN');
  expect(await stockNow()).toBe(before - 2);

  // L17: cancelling the first record gives its stock back, with a new move (nothing is rewritten).
  await call(page, 'POST', `/api/fms/records/${good.id}/actions`, {
    action: 'cancel',
    reason: 'Booked by mistake',
  });
  await expect.poll(stockNow).toBe(before);
  await call(page, 'POST', `/api/fms/records/${short.id}/actions`, { action: 'cancel', reason: 'test' });
});
