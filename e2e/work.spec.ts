import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test';

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

/** Phase 3 on the demo company: a task's whole life and a checklist run, each person in their own browser. */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234';
const OWNER = '9000000000';
const SANDEEP = '9000000111';
const RAMESH = '9000000110';
const GOPAL = '9000000123';
const TZ = 'Asia/Kolkata';
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

/** A second person on the same app, with their own cookies. */
async function as(browser: Browser, id: string, info: { project: { use: object } }) {
  const ctx = await browser.newContext(info.project.use);
  const page = await ctx.newPage();
  await signIn(page, id);
  return { page, close: () => ctx.close() };
}

async function userId(page: Page, name: string) {
  const users = (await (await page.request.get('/api/org/users')).json()) as { id: string; name: string }[];
  const u = users.find((x) => x.name === name);
  if (!u) throw new Error(`${name} is not in the demo company`);
  return u.id;
}

/** Loaded: skeletons gone (the live event stream keeps the network busy, so "networkidle" never comes). */
async function settled(page: Page) {
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 10_000 });
}

const origin = (page: Page) => ({ origin: new URL(page.url()).origin });
const post = (req: APIRequestContext, page: Page, url: string, data: unknown) =>
  req.post(url, { data, headers: origin(page) });

/** The card (phone) or table row (desktop) that holds this text — inside the page, not a toast (toasts are <li> too). */
const row = (page: Page, text: string) =>
  page.locator('main').locator('li, tr').filter({ hasText: text }).first();

test('a task goes from given to verified, all from the web', async ({ page, browser }, info) => {
  const label = `E2E ${info.project.name} ${Date.now()}: check the forklift brakes`;
  await signIn(page, OWNER);
  await page.goto('/delegation?tab=add');
  await choose(page, page.getByLabel(/^doer \*/i), 'Sandeep Pal');
  await choose(page, page.getByLabel(/verifier \(optional\)/i), 'Ramesh Choudhary');
  await page.getByLabel(/^task \*/i).fill(label);
  await shot(page, 'task-add', info.project.name);
  await page.getByRole('button', { name: 'Submit task' }).click();
  await expect(page.getByText(/given to Sandeep Pal/i)).toBeVisible();

  const tasks = (await (await page.request.get('/api/tasks?scope=all&tab=pending')).json()) as {
    tasks: { id: string; description: string; status: string }[];
  };
  const task = tasks.tasks.find((x) => x.description === label);
  expect(task?.status).toBe('AWAITING_ACCEPTANCE');

  try {
    // Doer accepts, then marks it done with a note.
    const doer = await as(browser, SANDEEP, info);
    await doer.page.goto('/delegation?tab=pending');
    await row(doer.page, label).getByRole('button', { name: 'Accept' }).click();
    await expect(row(doer.page, label).getByRole('button', { name: 'Mark done' })).toBeVisible();
    await shot(doer.page, 'task-pending', info.project.name);
    await row(doer.page, label).getByRole('button', { name: 'Mark done' }).click();
    const dialog = doer.page.getByRole('dialog');
    await dialog.getByLabel(/what was done/i).fill('Brakes adjusted and tested');
    await shot(doer.page, 'task-done-dialog', info.project.name);
    await dialog.getByRole('button', { name: /mark done · send to ramesh choudhary/i }).click();
    await expect(dialog).toBeHidden();
    await doer.close();

    // Verifier sees it under Verification and verifies.
    const verifier = await as(browser, RAMESH, info);
    await verifier.page.goto('/delegation?tab=verification');
    await row(verifier.page, label).getByRole('button', { name: 'Verify' }).click();
    await expect(row(verifier.page, label)).toBeHidden();
    await verifier.close();

    const done = (await (await page.request.get(`/api/tasks/${task!.id}`)).json()) as { status: string };
    expect(done.status).toBe('DONE');

    // History in the drawer shows every step.
    await page.goto(`/delegation?tab=done&task=${task!.id}`);
    await expect(
      page.getByRole('dialog').getByText('Brakes adjusted and tested', { exact: true }),
    ).toBeVisible();
    await shot(page, 'task-drawer', info.project.name);
  } finally {
    // Leave the demo data as it was: cancelled tasks don't count in scores.
    if (task)
      await post(page.request, page, `/api/tasks/${task.id}/actions`, {
        action: 'cancel',
        reason: 'E2E clean-up',
      });
  }
});

/** "HH:mm" in the company time zone, a couple of hours from now. */
function dueSoon() {
  const at = new Date(Date.now() + 2 * 3600_000);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  return { time: parts, date };
}

test('a checklist run is ticked, proved, submitted and verified', async ({ page, browser }, info) => {
  const name = `E2E ${info.project.name} ${Date.now()} boiler round`;
  await signIn(page, OWNER);
  const { time, date } = dueSoon();
  const res = await post(page.request, page, '/api/checklists/masters', {
    name,
    items: [
      { key: 'p', text: 'Pressure reading (bar)', requireValue: true },
      { key: 'v', text: 'Photo of the safety valve', requirePhoto: true },
    ],
    frequency: { type: 'daily' },
    dueTime: time,
    windowHours: 4,
    doerIds: [await userId(page, 'Gopal Prajapat')],
    verifierId: await userId(page, 'Rajesh Goyal'),
    skipHolidays: false,
    startDate: date,
  });
  expect(res.ok(), await res.text()).toBe(true);
  const master = (await res.json()) as { id: string };

  try {
    // Saving the master created today's run straight away.
    const doer = await as(browser, GOPAL, info);
    await doer.page.goto('/checklists');
    await row(doer.page, name).click();
    const sheet = doer.page.getByRole('dialog');
    await sheet.getByPlaceholder('Enter the value').fill('6.5');
    await sheet.getByRole('button', { name: 'Pressure reading (bar)' }).click();
    await expect(sheet.getByRole('button', { name: 'Pressure reading (bar)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await sheet.locator('input[type=file]').setInputFiles('apps/web/public/icon-192.png');
    await expect(sheet.getByRole('button', { name: 'Photo of the safety valve' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(sheet.locator('img')).toBeVisible();
    await shot(doer.page, 'checklist-run', info.project.name);
    await sheet.getByRole('button', { name: 'Submit' }).click();
    await expect(sheet.getByText('To verify').first()).toBeVisible();
    await doer.close();

    // Rajesh is the verifier (he is also the owner).
    await page.goto('/checklists?tab=all');
    await row(page, name).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('dialog').getByText('Done').first()).toBeVisible();

    const runs = (await (await page.request.get('/api/checklists/runs?scope=all')).json()) as {
      runs: { status: string; master: { name: string } }[];
    };
    expect(runs.runs.find((r) => r.master.name === name)?.status).toBe('DONE');
  } finally {
    await page.request.delete(`/api/checklists/masters/${master.id}`, { headers: origin(page) });
  }
});

test('Delegation, Checklists and My Workspace fit the screen', async ({ page }, info) => {
  await signIn(page, OWNER);
  for (const [path, file] of [
    ['/delegation?tab=pending', 'delegation'],
    ['/delegation?tab=scorecard', 'scorecard'],
    ['/checklists?tab=all', 'checklists'],
    ['/checklists?tab=master', 'checklist-masters'],
    ['/workspace', 'workspace'],
  ] as const) {
    await page.goto(path);
    await settled(page);
    await expectNoSideScroll(page);
    await shot(page, file, info.project.name);
  }
  // R/Y/G is a toggle on the scorecard tab.
  await page.goto('/delegation?tab=scorecard');
  await page.getByRole('button', { name: 'R/Y/G report' }).click();
  await settled(page);
  await expectNoSideScroll(page);
  await shot(page, 'ryg', info.project.name);
});

test('dates are DD/MM/YYYY everywhere and long lists filter as you type', async ({ page }, info) => {
  await signIn(page, OWNER);
  const noBrowserPickers = async () =>
    expect(page.locator('input[type=date], input[type=time], input[type=datetime-local]')).toHaveCount(0);

  // Forms that take dates: never the browser's own picker (it follows the browser locale, e.g. MM/DD).
  for (const path of [
    '/delegation?tab=add',
    '/help-tickets?tab=raise',
    '/checklists?tab=assign',
    '/system/company/shifts',
  ]) {
    await page.goto(path);
    await settled(page);
    await noBrowserPickers();
  }

  // Type a date and time, give the task, and read it back exactly as typed.
  const label = `E2E ${info.project.name} ${Date.now()} date check`;
  await page.goto('/delegation?tab=add');
  const date = page.getByLabel(/^planned \*/i);
  await expect(date).toHaveValue(/^\d{2}\/\d{2}\/\d{4}$/);
  await date.fill('05112030');
  await expect(date).toHaveValue('05/11/2030');
  await page.getByLabel(/^time$/i).fill('18:00');

  // Type-to-filter: a few letters leave only the matching people.
  await page.getByLabel(/^doer \*/i).click();
  await page.getByRole('searchbox').fill('sand pal');
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.getByRole('searchbox').press('Enter');
  await expect(page.getByLabel(/^doer \*/i)).toContainText('Sandeep Pal');

  await page.getByLabel(/^task \*/i).fill(label);
  await page.getByRole('button', { name: 'Submit task' }).click();
  await expect(page.getByText(/given to Sandeep Pal/i)).toBeVisible();
  const tasks = (await (await page.request.get('/api/tasks?scope=all&tab=pending')).json()) as {
    tasks: { id: string; description: string }[];
  };
  const task = tasks.tasks.find((x) => x.description === label)!;
  try {
    await page.goto(`/delegation?tab=pending&task=${task.id}`);
    await expect(page.getByRole('dialog').getByText('05/11/2030 18:00').first()).toBeVisible();
    // The move-date dialog uses the same field.
    await page.getByRole('dialog').getByRole('button', { name: 'Move date' }).click();
    await noBrowserPickers();
    await expect(
      page
        .getByRole('dialog')
        .last()
        .getByLabel(/new planned date/i),
    ).toHaveValue('05/11/2030');
  } finally {
    await page.request.post(`/api/tasks/${task.id}/actions`, {
      data: { action: 'cancel', reason: 'E2E clean-up' },
      headers: origin(page),
    });
  }
});
