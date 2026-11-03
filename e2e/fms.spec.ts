import { expect, test, type Locator, type Page } from '@playwright/test';

/** Phase 5 acceptance: build a 6-step flow with a decision, publish, run a record to a numbered PDF. */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234';
const OWNER = '9000000000';
const shots = process.env.E2E_SCREENSHOTS === '1';

async function shot(page: Page, name: string, project: string) {
  if (shots) await page.screenshot({ path: `docs/screenshots/${project}-${name}.png`, fullPage: false });
}
async function expectNoSideScroll(page: Page) {
  const width = page.viewportSize()!.width;
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    'page is wider than the screen',
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

test('build a 6-step flow with a decision, publish it, run a record to a numbered invoice', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough: it publishes a process');
  test.setTimeout(90_000);
  await signIn(page);
  const name = `E2E ${Date.now()} order to dispatch`;

  // Builder UI: create the process and its first step.
  await page.goto('/fms/builder');
  await page.getByRole('button', { name: 'New process' }).click();
  await page.getByLabel('Process name').fill(name);
  await page.getByLabel('A run is called').fill('Order');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/fms\/builder\/\w+/);
  const flowId = page.url().split('/').pop()!;
  await page.getByRole('button', { name: 'Add a step' }).click();
  await page.getByLabel('Step name').fill('Confirm order');
  await choose(page, page.getByRole('combobox', { name: 'Doers' }), 'Rajesh Goyal');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();

  // The rest of the steps (same save endpoint the editor uses), then publish from the UI.
  const users = (await (await page.request.get('/api/org/users')).json()) as { id: string; name: string }[];
  const me = users.find((u) => u.name === 'Rajesh Goyal')!.id;
  const t = (value: number) => ({ value, unit: 'hours', anchor: 'previous' });
  const res = await page.request.put(`/api/fms/flows/${flowId}`, {
    headers: headers(page),
    data: {
      meta: { coordinatorId: me, solverId: me },
      definition: {
        startFields: [{ key: 'customer', label: 'Customer', type: 'text', required: true }],
        steps: [
          { key: 'confirm', name: 'Confirm order', type: 'TASK', doerIds: [me], time: t(2) },
          {
            key: 'check',
            name: 'In stock?',
            type: 'DECISION',
            doerIds: [me],
            time: t(2),
            yes: 'pack',
            no: 'buy',
          },
          { key: 'buy', name: 'Buy material', type: 'TASK', doerIds: [me], time: t(24), next: 'pack' },
          { key: 'pack', name: 'Pack', type: 'TASK', doerIds: [me], time: t(4) },
          {
            key: 'dispatch',
            name: 'Dispatch',
            type: 'TASK',
            doerIds: [me],
            time: t(4),
            fields: [{ key: 'vehicle', label: 'Vehicle no.', type: 'text', required: true }],
          },
          {
            key: 'invoice',
            name: 'Make invoice',
            type: 'AUTO',
            auto: { action: 'document', documentType: 'INV' },
          },
        ],
      },
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Flowchart' }).click();
  await expect(page.getByText('6. Make invoice')).toBeVisible();
  await shot(page, 'fms-editor-chart', info.project.name);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/published version 1/i)).toBeVisible();

  // Live FMS: start an order, then do every step from the record drawer.
  await page.goto(`/fms/live?flow=${flowId}`);
  await page.getByRole('button', { name: 'New Order' }).click();
  await page.getByRole('dialog').getByLabel('Customer *').fill('E2E Sharma Builders');
  await page.getByRole('dialog').getByRole('button', { name: 'Start' }).click();
  const drawer = page.getByRole('dialog').last();
  await expect(drawer.getByText('E2E Sharma Builders').first()).toBeVisible();
  const doStep = async (answer: string, fill?: [string, string]) => {
    await drawer.getByRole('button', { name: 'Do my step' }).click();
    const dlg = page.getByRole('dialog').last();
    if (fill) await dlg.getByLabel(fill[0]).fill(fill[1]);
    await dlg.getByRole('button', { name: answer, exact: true }).click();
    await expect(page.getByText(/step done/i).first()).toBeVisible();
  };
  await doStep('Mark done');
  await doStep('Yes');
  await doStep('Mark done');
  await shot(page, 'fms-record', info.project.name);
  await doStep('Mark done', ['Vehicle no. *', 'RJ14 GD 4512']);
  await expect(drawer.getByText('Closed').first()).toBeVisible();

  // The AUTO step made a numbered invoice; its PDF downloads.
  await drawer.getByRole('button', { name: 'Documents' }).click();
  const doc = drawer.getByRole('link', { name: /INV\/\d{2}-\d{2}\/\d{4}/ });
  await expect(doc).toBeVisible();
  const pdf = await page.request.get((await doc.getAttribute('href'))!);
  expect(pdf.headers()['content-type']).toBe('application/pdf');

  // Keep the demo builder tidy.
  await page.request.post(`/api/fms/flows/${flowId}/archive`, {
    headers: headers(page),
    data: { archive: true },
  });
});

test('FMS screens fit the screen', async ({ page }, info) => {
  await signIn(page);
  const flows = (await (await page.request.get('/api/fms/flows')).json()) as { id: string; name: string }[];
  const flow = flows.find((f) => f.name === 'Returns & Complaints')!;
  for (const [path, file] of [
    ['/fms/builder', 'fms-builder'],
    [`/fms/builder/${flow.id}`, 'fms-editor'],
    [`/fms/live?flow=${flow.id}`, 'fms-live'],
    ['/fms/my-steps', 'fms-my-steps'],
    ['/documents', 'documents'],
  ] as const) {
    await page.goto(path);
    await settled(page);
    await expectNoSideScroll(page);
    await shot(page, file, info.project.name);
  }
  // A record drawer on the live page.
  await page.goto(`/fms/live?flow=${flow.id}`);
  await settled(page);
  await page.locator('main').getByRole('button').filter({ hasText: /#\d/ }).first().click();
  await expect(page.getByRole('dialog').getByText('Timeline').first()).toBeVisible();
  // Dates in the record read DD/MM/YYYY, never the stored YYYY-MM-DD.
  const text = (await page.getByRole('dialog').last().innerText()) ?? '';
  expect(text).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  expect(text).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
  await shot(page, 'fms-drawer', info.project.name);
});

test('the public form takes a record with no login', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'phone', 'customers fill it on their phones');
  await signIn(page);
  const flows = (await (await page.request.get('/api/fms/flows')).json()) as { id: string; name: string }[];
  const flow = flows.find((f) => f.name === 'Sales FMS')!;
  const link = (await (
    await page.request.post(`/api/fms/flows/${flow.id}/public`, {
      headers: headers(page),
      data: { enabled: true },
    })
  ).json()) as { publicToken: string };
  try {
    const ctx = await browser.newContext(info.project.use);
    const pub = await ctx.newPage();
    await pub.goto(`/f/${link.publicToken}`);
    await expect(pub.getByRole('heading', { name: 'Sales FMS' })).toBeVisible();
    await pub.getByLabel('Customer *').fill('E2E Walk-in Customer');
    const q = (await pub.getByText(/What is \d+ \+ \d+\?/).textContent())!;
    const [a, b] = q.match(/\d+/g)!.map(Number) as [number, number];
    await pub.getByLabel(/What is/).fill(String(a + b));
    await shot(pub, 'public-form', info.project.name);
    await expectNoSideScroll(pub);
    await pub.getByRole('button', { name: 'Send' }).click();
    await expect(pub.getByText(/your enquiry number is \d+/i)).toBeVisible();
    await ctx.close();
  } finally {
    await page.request.post(`/api/fms/flows/${flow.id}/public`, {
      headers: headers(page),
      data: { enabled: false },
    });
  }
});
