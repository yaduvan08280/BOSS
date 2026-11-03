import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

/** Pick from a MONO dropdown the way a person does: open it, type, click the match. */
async function choose(page: Page, trigger: Locator, text: string) {
  await trigger.click();
  const search = page.getByRole('searchbox');
  if (await search.count()) await search.fill(text);
  await page
    .getByRole('option', { name: new RegExp(text, 'i') })
    .first()
    .click();
}

/** Phase 4 on the demo company: slip, ticket and EA lifecycles in the web, and the flow designer's switches. */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234';
const OWNER = '9000000000';
const SANDEEP = '9000000111';
const RAMESH = '9000000110';
const GOPAL = '9000000123';
const shots = process.env.E2E_SCREENSHOTS === '1';

async function shot(page: Page, name: string, project: string) {
  if (shots) await page.screenshot({ path: `docs/screenshots/${project}-${name}.png`, fullPage: false });
}

async function expectNoSideScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, 'page is wider than the screen').toBeLessThanOrEqual(width);
}

async function signIn(page: Page, id: string) {
  await page.goto('/login');
  await page.getByLabel(/mobile number or email/i).fill(id);
  await page.getByLabel(/^password$/i).fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('heading', { name: /what do you want to do/i })).toBeVisible();
}

async function as(browser: Browser, id: string, info: { project: { use: object } }) {
  const ctx = await browser.newContext(info.project.use);
  const page = await ctx.newPage();
  await signIn(page, id);
  return { page, close: () => ctx.close() };
}

/** Loaded: skeletons gone (the live event stream keeps the network busy). */
async function settled(page: Page) {
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 10_000 });
}

const headers = (page: Page) => ({ origin: new URL(page.url()).origin });
/** A list row inside the page (toasts are list items too). */
const row = (page: Page, text: string) =>
  page
    .locator('main')
    .getByRole('button', { name: new RegExp(text) })
    .first();
const drawer = (page: Page) => page.getByRole('dialog').last();

test('a help slip goes from raised to approved (with a task) to closed', async ({ page, browser }, info) => {
  const problem = `E2E ${info.project.name} ${Date.now()} compressor trips at noon`;
  const raiser = await as(browser, SANDEEP, info);
  await raiser.page.goto('/help-slips?tab=raise');
  await raiser.page.getByLabel(/the problem/i).fill(problem);
  await raiser.page.getByLabel('Solution 1').fill('Service the compressor');
  await raiser.page.getByLabel('Solution 2').fill('Add a second compressor');
  await raiser.page.getByLabel('Solution 3').fill('Run it only in the morning');
  await shot(raiser.page, 'slip-raise', info.project.name);
  await raiser.page.getByRole('button', { name: 'Submit slip' }).click();
  await expect(raiser.page.getByText(/help slip #\d+ raised/i)).toBeVisible();

  // The receiver (Sandeep's HOD) screens it and forwards it.
  const receiver = await as(browser, RAMESH, info);
  await receiver.page.goto('/help-slips');
  await row(receiver.page, problem).click();
  await drawer(receiver.page).getByRole('button', { name: 'Forward to approver' }).click();
  await receiver.page.getByRole('dialog').last().getByRole('button', { name: 'Forward to approver' }).click();
  await expect(receiver.page.getByText('With the approver').first()).toBeVisible();
  await receiver.close();

  // The owner approves solution 2 for Sandeep: a delegation task is created and linked.
  await signIn(page, OWNER);
  await page.goto('/help-slips');
  await row(page, problem).click();
  await shot(page, 'slip-drawer', info.project.name);
  await drawer(page).getByRole('button', { name: 'Approve' }).click();
  const dlg = page.getByRole('dialog').last();
  await dlg.getByLabel('Add a second compressor').check();
  await choose(page, dlg.getByRole('combobox').first(), 'Sandeep Pal');
  await dlg.getByRole('button', { name: 'Approve' }).click();
  await expect(drawer(page).getByText(/task #\d+ for sandeep pal/i)).toBeVisible();

  // The raiser closes it.
  await raiser.page.goto('/help-slips?tab=mine');
  await row(raiser.page, problem).click();
  await drawer(raiser.page).getByRole('button', { name: 'Close slip' }).click();
  await raiser.page.getByRole('dialog').last().getByRole('button', { name: 'Close slip' }).click();
  await expect(drawer(raiser.page).getByText('Closed').first()).toBeVisible();
  await raiser.close();

  // Leave the demo scores as they were: cancel the task the decision created.
  const slips = (await (await page.request.get('/api/slips?tab=all')).json()) as {
    slips: { problem: string; taskId: string }[];
  };
  const taskId = slips.slips.find((s) => s.problem === problem)!.taskId;
  await page.request.post(`/api/tasks/${taskId}/actions`, {
    data: { action: 'cancel', reason: 'E2E clean-up' },
    headers: headers(page),
  });
});

test('a help ticket is replied, fixed with proof and confirmed', async ({ browser }, info) => {
  const title = `E2E ${info.project.name} ${Date.now()} conveyor belt slips`;
  const raiser = await as(browser, GOPAL, info);
  await raiser.page.goto('/help-tickets?tab=raise');
  await raiser.page.getByLabel(/what's wrong/i).fill(title);
  await choose(raiser.page, raiser.page.getByLabel(/problem solver/i), 'Sandeep Pal');
  await shot(raiser.page, 'ticket-raise', info.project.name);
  await raiser.page.getByRole('button', { name: 'Raise ticket' }).click();
  await expect(raiser.page.getByText(/ticket t#\d+ raised/i)).toBeVisible();

  const solver = await as(browser, SANDEEP, info);
  await solver.page.goto('/help-tickets');
  await row(solver.page, title).click();
  await drawer(solver.page).getByPlaceholder('Write a reply…').fill('Tightening it after lunch');
  await drawer(solver.page).getByRole('button', { name: 'Reply' }).click();
  await expect(drawer(solver.page).getByText('In progress').first()).toBeVisible();
  await drawer(solver.page).getByRole('button', { name: 'Mark fixed' }).click();
  const fixed = solver.page.getByRole('dialog').last();
  await fixed.getByLabel('What did you do?').fill('Tightened and aligned the belt');
  await fixed.locator('input[type=file]').first().setInputFiles('apps/web/public/icon-192.png');
  await expect(fixed.locator('img').first()).toBeVisible();
  await fixed.getByRole('button', { name: 'Mark fixed' }).click();
  await expect(
    drawer(solver.page)
      .getByText(/fixed — confirm/i)
      .first(),
  ).toBeVisible();
  await shot(solver.page, 'ticket-drawer', info.project.name);
  await solver.close();

  await raiser.page.goto('/help-tickets?tab=mine');
  await row(raiser.page, title).click();
  await drawer(raiser.page).getByRole('button', { name: "Yes, it's fixed" }).click();
  await expect(drawer(raiser.page).getByText('Closed').first()).toBeVisible();
  await raiser.close();
});

test('the EA board captures, schedules into the week and finishes', async ({ page }, info) => {
  const text = `E2E ${info.project.name} ${Date.now()} call the GST consultant`;
  await signIn(page, OWNER);
  await page.goto('/ea');
  await settled(page);
  await page.getByLabel(/one line/i).fill(text);
  await page.locator('main').getByRole('button', { name: 'Capture', exact: true }).click();
  const card = page.getByRole('region', { name: 'Captured' }).getByRole('button', { name: new RegExp(text) });
  await expect(card).toBeVisible();
  await shot(page, 'ea-board', info.project.name);

  await card.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Schedule' }).click();
  await page.getByRole('dialog').getByLabel('Start').fill('19:00');
  await page.getByRole('dialog').getByRole('button', { name: 'Schedule' }).click();
  await expect(
    page.getByRole('region', { name: 'Scheduled' }).getByRole('button', { name: new RegExp(text) }),
  ).toBeVisible();

  await page.locator('main').getByRole('button', { name: "Owner's week", exact: true }).click();
  const booked = page.getByRole('button', { name: new RegExp(`19:00.*${text}|${text}`) }).first();
  await expect(booked).toBeVisible();
  await shot(page, 'ea-week', info.project.name);
  await booked.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('main').getByRole('button', { name: 'Board', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Done' }).getByRole('button', { name: new RegExp(text) }),
  ).toBeVisible();

  // Clean up: close it so it leaves the board.
  const board = (await (await page.request.get('/api/ea/board')).json()) as {
    items: { id: string; text: string }[];
  };
  const id = board.items.find((i) => i.text === text)!.id;
  await page.request.post(`/api/ea/items/${id}/actions`, {
    data: { action: 'close' },
    headers: headers(page),
  });
});

test('switching "EA verifies" off in the flow designer makes Mark done go straight to Done', async ({
  page,
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'changes company settings; one run is enough');
  await signIn(page, OWNER);
  const before = (await (await page.request.get('/api/work/settings/delegation')).json()) as Record<
    string,
    unknown
  >;
  const custom = (
    (await (await page.request.get('/api/engine')).json()) as { module: string; custom: boolean }[]
  ).find((m) => m.module === 'delegation')!.custom;
  try {
    await page.goto('/system/engine?m=delegation');
    await settled(page);
    await expect(page.getByRole('heading', { name: 'Life of a task' })).toBeVisible();
    await shot(page, 'engine-delegation', info.project.name);
    const toggle = page.getByRole('switch', { name: 'EA verifies before done' });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(/saved\. the flow works this way/i)).toBeVisible();
    await expect(page.getByText(/EA verifies before done: On → Off/).first()).toBeVisible();

    // Give Sandeep a task (no verifier); he accepts and marks it done.
    const doer = await as(browser, SANDEEP, info);
    const users = (await (await page.request.get('/api/org/users')).json()) as { id: string; name: string }[];
    const task = (await (
      await page.request.post('/api/tasks', {
        data: {
          doerId: users.find((u) => u.name === 'Sandeep Pal')!.id,
          plannedAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
          description: `E2E ${Date.now()} oil the bearings`,
        },
        headers: headers(page),
      })
    ).json()) as { id: string };
    const act = (input: object) =>
      doer.page.request.post(`/api/tasks/${task.id}/actions`, { data: input, headers: headers(doer.page) });
    await act({ action: 'accept' });
    const done = (await (await act({ action: 'markDone', note: 'Oiled' })).json()) as { status: string };
    expect(done.status).toBe('DONE');
    await doer.close();
    await page.request.post(`/api/tasks/${task.id}/actions`, {
      data: { action: 'cancel', reason: 'E2E clean-up' },
      headers: headers(page),
    });
  } finally {
    // Put the company's settings back exactly as they were.
    if (custom)
      await page.request.put('/api/work/settings/delegation', { data: before, headers: headers(page) });
    else await page.request.delete('/api/work/settings/delegation', { headers: headers(page) });
  }
});

test('Help slips, tickets, EA, MIS and the flow designer fit the screen', async ({ page }, info) => {
  await signIn(page, OWNER);
  for (const [path, file] of [
    ['/help-slips?tab=all', 'slips'],
    ['/help-tickets?tab=all', 'tickets'],
    ['/ea', 'ea'],
    ['/ea?tab=week', 'ea-week-full'],
    ['/mis', 'mis'],
    ['/system/engine?m=ticket', 'engine-ticket'],
    ['/workspace', 'workspace-p4'],
  ] as const) {
    await page.goto(path);
    await settled(page);
    await expectNoSideScroll(page);
    await shot(page, file, info.project.name);
  }
});
