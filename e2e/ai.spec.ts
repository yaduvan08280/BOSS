import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/** Phase 6: the AI screens. The full "Build with AI" run needs a model, so it runs only with E2E_AI=1. */
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
const headers = (page: Page) => ({ origin: new URL(page.url()).origin });

test('AI screens fit the screen', async ({ page }, info) => {
  await signIn(page);
  for (const [path, file] of [
    ['/system/integration/ai', 'ai-settings'],
    ['/system/business-details', 'ai-business-details'],
    ['/fms/builder/ai', 'ai-build'],
    ['/masters', 'masters'],
  ] as const) {
    await page.goto(path);
    await settled(page);
    await expectNoSideScroll(page);
    await shot(page, file, info.project.name);
  }
  // The builder list offers it too.
  await page.goto('/fms/builder');
  await expect(page.getByRole('button', { name: 'Build with AI' })).toBeVisible();
});

test('business details save with a word count; masters are defined by hand', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough: it changes company data');
  await signIn(page);
  const before = (await (await page.request.get('/api/ai/business-details')).json()) as { text: string };
  try {
    await page.goto('/system/business-details');
    const box = page.getByLabel('Your business, in your words');
    await box.fill('We make engineered quartz slabs at Kishangarh and sell them to dealers and builders.');
    await expect(page.getByText(/Too short · 14 words/)).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved').first()).toBeVisible();
    expect(
      ((await (await page.request.get('/api/ai/business-details')).json()) as { words: number }).words,
    ).toBe(14);
  } finally {
    await page.request.put('/api/ai/business-details', {
      headers: headers(page),
      data: { text: before.text },
    });
  }

  // A master saved through the API shows on the page and is deleted from it.
  const name = `E2E vehicles ${Date.now()}`;
  const made = await page.request.post('/api/masters', {
    headers: headers(page),
    data: {
      name,
      fields: [{ key: 'number', label: 'Vehicle number', type: 'text', required: true }],
      keyField: 'number',
      displayField: 'number',
    },
  });
  expect(made.ok(), await made.text()).toBe(true);
  await page.goto('/masters');
  const card = page.locator('main li').filter({ hasText: name });
  await expect(card.getByText('Vehicle number')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await card.getByRole('button', { name: 'Delete' }).click();
  await expect(card).toHaveCount(0);
});

test('an "AI follow-up" switch on notification rules', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'a dialog check');
  await signIn(page);
  await page.goto('/system/integration/rules');
  await settled(page);
  await page.getByRole('button', { name: /add a rule/i }).click();
  await expect(page.getByRole('switch', { name: 'AI writes the message' })).toBeVisible();
});

test('Build with AI: the review opens in the builder (model answer stubbed)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough: it creates a process');
  await signIn(page);
  // A real model answer (recorded from qwen2.5:7b); everything after the model is the real app.
  const draft = JSON.parse(readFileSync('e2e/fixtures-ai-draft.json', 'utf8')) as {
    name: string;
    steps: unknown[];
  };
  await page.route('**/api/ai/status', (r) =>
    r.fulfill({ json: { connected: true, provider: 'anthropic', model: 'claude-opus-5-5', stt: 'browser' } }),
  );
  await page.route('**/api/ai/flows/draft', (r) =>
    r.fulfill({
      json: {
        draft,
        meta: { name: draft.name, runName: 'Order', departmentIds: [], coordinatorId: null, solverId: null },
        definition: { startFields: [], steps: [], timeModel: 'shifts' },
        unmatched: [{ where: 'Check stock', name: 'Production head' }],
        issues: [],
        summary: { steps: draft.steps.length, startFields: 3, stepFields: 4, unassigned: 1 },
        remember: [],
      },
    }),
  );
  await page.goto('/fms/builder/ai');
  await page.getByRole('button', { name: 'Order to dispatch' }).click();
  await page.getByRole('button', { name: 'Draft my process' }).click();
  await expect(page.getByRole('heading', { name: 'Your flow, drafted by AI' })).toBeVisible();
  await expect(page.getByText('Production head · Check stock')).toBeVisible();
  await expectNoSideScroll(page);
  await page.getByRole('button', { name: 'Open in the Builder' }).click();
  await expect(page).toHaveURL(/\/fms\/builder\/(?!ai)\w+/);
  const flowId = page.url().split('/').pop()!;
  const flow = (await (await page.request.get(`/api/fms/flows/${flowId}`)).json()) as {
    draft: { steps: unknown[] };
    description: string;
  };
  // The model's closing "End" step is not a step: "end" already closes the record.
  const real = (draft.steps as { key: string }[]).filter((s) => s.key !== 'end');
  expect((flow.draft.steps as { key: string }[]).map((s) => s.key)).toEqual(real.map((s) => s.key));
  expect(flow.description).toContain('dealer places an order');
  await page.request.post(`/api/fms/flows/${flowId}/archive`, {
    headers: headers(page),
    data: { archive: true },
  });
});

/** PROMPTS.md phase 6 acceptance: the Lead to Order description → a valid 10–12 step flow that opens in the builder. */
test('Build with AI: Lead to Order becomes a 10–12 step flow in the builder', async ({ page }, info) => {
  test.skip(
    process.env.E2E_AI !== '1' || info.project.name !== 'desktop',
    'needs a connected model (E2E_AI=1)',
  );
  test.setTimeout(25 * 60_000);
  await signIn(page);
  await page.goto('/fms/builder/ai');
  await page.getByRole('button', { name: 'Lead to order' }).click();
  await expect(page.getByText(/\d+\/30 words/)).toBeVisible();
  await page.getByRole('button', { name: 'Draft my process' }).click();
  await expect(page.getByRole('heading', { name: 'Your flow, drafted by AI' })).toBeVisible({
    timeout: 20 * 60_000,
  });
  const summary = (await page.getByText(/\d+ steps · \d+ start fields/).textContent()) ?? '';
  const steps = Number(/(\d+) steps/.exec(summary)?.[1]);
  expect(steps).toBeGreaterThanOrEqual(10);
  expect(steps).toBeLessThanOrEqual(12);
  await shot(page, 'ai-build-review', info.project.name);
  await page.getByRole('button', { name: 'Open in the Builder' }).click();
  await expect(page).toHaveURL(/\/fms\/builder\/(?!ai)\w+/);
  const flowId = page.url().split('/').pop()!;
  const flow = (await (await page.request.get(`/api/fms/flows/${flowId}`)).json()) as {
    draft: { steps: { type: string }[] };
  };
  expect(flow.draft.steps.length).toBe(steps);
  await page.getByRole('button', { name: 'Flowchart' }).click();
  await shot(page, 'ai-build-chart', info.project.name);
  await page.request.post(`/api/fms/flows/${flowId}/archive`, {
    headers: headers(page),
    data: { archive: true },
  });
});
