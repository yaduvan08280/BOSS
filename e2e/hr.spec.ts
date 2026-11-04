import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

/** Phase 7: attendance, leave with a Buddy, the cover board and the HR rules wizard, on the demo company. */
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
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    'page is wider than the screen',
  ).toBeLessThanOrEqual(width);
}
async function settled(page: Page) {
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 10_000 });
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

/** A working day about a week ahead, as YYYY-MM-DD and as typed (DDMMYYYY). */
function workingDayAhead(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  for (;;) {
    const wd = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' }).format(d);
    if (wd !== 'Sun') break;
    d.setTime(d.getTime() + 86_400_000);
  }
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  const [y, m, dd] = iso.split('-');
  return { iso, typed: `${dd}${m}${y}` };
}

test('HR screens fit the screen', async ({ page }, info) => {
  await signIn(page, OWNER);
  for (const [path, file] of [
    ['/hr/attendance', 'hr-attendance'],
    ['/hr/attendance?tab=team', 'hr-team'],
    ['/hr/attendance?tab=corrections', 'hr-corrections'],
    ['/hr/leave', 'hr-leave-apply'],
    ['/hr/leave?tab=mine', 'hr-leave-mine'],
    ['/hr/leave?tab=holidays', 'hr-holidays'],
    ['/hr/cover', 'hr-cover'],
    ['/system/hr-rules', 'hr-rules'],
  ] as const) {
    await page.goto(path);
    await settled(page);
    await expectNoSideScroll(page);
    await shot(page, file, info.project.name);
  }
  // The demo has Arjun on leave today, his work covered by Sunita.
  await page.goto('/hr/cover');
  await expect(page.locator('main').getByText('Arjun Rawat')).toBeVisible();
  await expect(
    page
      .locator('main')
      .getByText(/Covered by Sunita Bansal/)
      .first(),
  ).toBeVisible();
});

test('leave with a Buddy: apply, the Buddy says yes, the HOD approves', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough: it changes leave data');
  test.setTimeout(90_000);
  await signIn(page, OWNER);
  const day = workingDayAhead(9);
  const users = (await (await page.request.get('/api/org/users')).json()) as { id: string; name: string }[];
  const sandeepId = users.find((u) => u.name === 'Sandeep Pal')!.id;
  const task = (await (
    await page.request.post('/api/tasks', {
      headers: headers(page),
      data: {
        doerId: sandeepId,
        plannedAt: `${day.iso}T11:00:00+05:30`,
        description: `E2E ${Date.now()} oil the press`,
      },
    })
  ).json()) as { id: string };
  let leaveId = '';
  try {
    const s = await as(browser, SANDEEP, info);
    await s.page.request.post(`/api/tasks/${task.id}/actions`, {
      headers: headers(s.page),
      data: { action: 'accept' },
    });
    await s.page.goto('/hr/leave');
    await choose(s.page, s.page.getByLabel('Kind of leave *'), 'Casual leave');
    await s.page.getByLabel('First day *').fill(day.typed);
    await s.page.getByLabel('Why *').fill('Cousin’s engagement');
    await expect(s.page.getByText(/1 working day/)).toBeVisible();
    await choose(s.page, s.page.getByLabel(/Buddy for .*oil the press/), 'Gopal Prajapat');
    await shot(s.page, 'hr-leave-buddy', info.project.name);
    await s.page.getByRole('button', { name: 'Ask for leave' }).click();
    await expect(s.page.getByText(/Leave asked for/)).toBeVisible();
    const mine = (await (await s.page.request.get('/api/hr/leave')).json()) as {
      mine: { id: string; from: string }[];
    };
    leaveId = mine.mine.find((l) => l.from === day.iso)!.id;
    await s.close();

    // Gopal says yes from his Buddy requests.
    const g = await as(browser, GOPAL, info);
    await g.page.goto('/hr/leave?tab=buddy');
    await g.page
      .locator('main li')
      .filter({ hasText: 'Sandeep Pal' })
      .first()
      .getByRole('button', { name: 'Yes, I will cover' })
      .click();
    await expect(
      g.page.locator('main li').filter({ hasText: 'Sandeep Pal' }).first().getByText('Will cover'),
    ).toBeVisible();
    await g.close();

    // Ramesh (HOD of Maintenance) approves.
    const r = await as(browser, RAMESH, info);
    await r.page.goto('/hr/leave?tab=approve');
    const card = r.page.locator('main li').filter({ hasText: 'Sandeep Pal' }).first();
    await expect(card.getByText('Will cover')).toBeVisible();
    await card.getByRole('button', { name: 'Approve' }).click();
    await expect(r.page.getByText('Saved').first()).toBeVisible();
    await r.close();
    const after = (await (await page.request.get('/api/hr/leave')).json()) as unknown;
    void after;
    const lists = (await (
      await (await as(browser, SANDEEP, info)).page.request.get('/api/hr/leave')
    ).json()) as { mine: { id: string; status: string }[] };
    expect(lists.mine.find((l) => l.id === leaveId)?.status).toBe('APPROVED');
  } finally {
    if (leaveId) await page.request.post(`/api/hr/leave/${leaveId}/cancel`, { headers: headers(page) });
    await page.request.post(`/api/tasks/${task.id}/actions`, {
      headers: headers(page),
      data: { action: 'cancel', reason: 'E2E clean-up' },
    });
  }
});

test('HR rules wizard: change an answer, check and save', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'changes company rules');
  await signIn(page, OWNER);
  const before = (await (await page.request.get('/api/hr/rules')).json()) as { rules: object };
  try {
    await page.goto('/system/hr-rules');
    await page
      .getByRole('radiogroup', { name: 'Grace minutes late' })
      .first()
      .getByRole('radio', { name: '30 min' })
      .click();
    await page.getByRole('button', { name: /7 Check & save/ }).click();
    await expect(page.getByText('30 min').first()).toBeVisible();
    await shot(page, 'hr-rules-check', info.project.name);
    await page.getByRole('button', { name: 'Save the rules' }).click();
    await expect(page.getByText('HR rules saved')).toBeVisible();
    const saved = (await (await page.request.get('/api/hr/rules')).json()) as {
      rules: { late: { graceMinutes: number } };
    };
    expect(saved.rules.late.graceMinutes).toBe(30);
  } finally {
    await page.request.put('/api/hr/rules', { headers: headers(page), data: before.rules });
  }
});

test('punch in on the phone at the plant', async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone', 'people punch on their phones');
  const ctx = await browser.newContext({
    ...info.project.use,
    geolocation: { latitude: 26.5918, longitude: 74.8543, accuracy: 20 },
    permissions: ['geolocation'],
  });
  const page = await ctx.newPage();
  await signIn(page, GOPAL);
  await page.goto('/hr/attendance');
  await settled(page);
  const button = page.getByRole('button', { name: /Punch (in|out)/ });
  const label = (await button.textContent()) ?? '';
  await button.click();
  await expect(page.getByText(label.includes('in') ? 'Punched in' : 'Punched out')).toBeVisible();
  await expectNoSideScroll(page);
  await shot(page, 'hr-punched', info.project.name);
  await ctx.close();
});
