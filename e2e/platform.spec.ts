import { expect, test, type Page } from '@playwright/test';

/** Phase 10: masters with rows and import, API keys and the public API, Google Drive, errors, the install card. */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234';
const OWNER = '9000000000';
const shots = process.env.E2E_SCREENSHOTS === '1';

async function shot(page: Page, name: string, project: string) {
  if (shots) await page.screenshot({ path: `docs/screenshots/${project}-${name}.png`, fullPage: false });
}
async function settled(page: Page) {
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 });
}
async function signIn(page: Page, id: string) {
  await page.goto('/login');
  await page.getByLabel(/mobile number or email/i).fill(id);
  await page.getByLabel(/^password$/i).fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('heading', { name: /what do you want to do/i })).toBeVisible();
}
const headers = (page: Page) => ({ origin: new URL(page.url()).origin });

/** The demo company's "Machines" master (made from the library the first time). */
async function machines(page: Page) {
  const list = (await (await page.request.get('/api/masters')).json()) as { id: string; name: string }[];
  const have = list.find((m) => m.name === 'Machines');
  if (have) return have.id;
  const r = await page.request.post('/api/masters/library/machines', { headers: headers(page), data: {} });
  return ((await r.json()) as { id: string }).id;
}

test('phase 10 screens fit the screen', async ({ page }, info) => {
  test.setTimeout(90_000);
  // The production Content-Security-Policy must not block anything the app needs.
  const blocked: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to (load|execute|apply|connect)/i.test(m.text()))
      blocked.push(m.text());
  });
  await signIn(page, OWNER);
  const id = await machines(page);
  for (const [path, file] of [
    ['/masters/library', 'masters-library'],
    [`/masters/${id}`, 'masters-rows'],
    ['/system/api-keys', 'api-keys'],
    ['/system/integration/drive', 'drive'],
    ['/system/errors', 'errors'],
  ] as const) {
    await page.goto(path);
    await settled(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `${path} is wider than the screen`,
    ).toBeLessThanOrEqual(page.viewportSize()!.width);
    await shot(page, file, info.project.name);
  }
  // The Drive wizard: four steps, the exact callback address, Connect waits for the ticks.
  await page.goto('/system/integration/drive');
  await expect(page.getByText(/where your files go/i)).toBeVisible();
  await expect(page.getByText(/\/api\/integrations\/google-drive\/callback/)).toBeVisible();
  await expect(page.getByRole('button', { name: /connect drive/i })).toBeDisabled();
  expect(blocked, 'blocked by the CSP').toEqual([]);
});

test('a master row added by hand and by paste, with every problem named', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'changes demo data');
  test.setTimeout(60_000);
  await signIn(page, OWNER);
  const id = await machines(page);
  await page.goto(`/masters/${id}`);
  await settled(page);
  const code = `M-${Date.now() % 100000}`;
  await page.getByRole('button', { name: /add a row/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/machine no/i).fill(code);
  await dialog.getByRole('textbox', { name: /^machine \*/i }).fill('Calibration line 2');
  await dialog.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByText('Calibration line 2').first()).toBeVisible();

  // Paste: one good row, one repeating the code → nothing is added, the line is named.
  await page.getByRole('button', { name: /^import$/i }).click();
  const imp = page.getByRole('dialog');
  await imp.getByLabel(/paste rows/i).fill(`Machine no.\tMachine\n${code}-B\tPress 1\n${code}\tCopy`);
  await imp.getByRole('button', { name: /import 2 rows/i }).click();
  await expect(imp.getByText(/line 3/i)).toBeVisible();
  await imp.getByLabel(/paste rows/i).fill(`Machine no.\tMachine\n${code}-B\tPress 1`);
  await imp.getByRole('button', { name: /import 1 row/i }).click();
  await expect(page.getByText('Press 1').first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel(/search rows/i).fill('press 1');
  await expect(page.getByLabel(/search rows/i)).toHaveValue('press 1');
  await expect(page.locator('main table').getByText('Calibration line 2')).toHaveCount(0);
});

test('an API key is shown once, works on /api/v1 and stops when revoked', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'changes demo data');
  test.setTimeout(60_000);
  await signIn(page, OWNER);
  await page.goto('/system/api-keys');
  await settled(page);
  const name = `e2e key ${Date.now() % 100000}`;
  await page
    .getByRole('button', { name: /generate api key/i })
    .first()
    .click();
  await page
    .getByRole('dialog')
    .getByLabel(/what is this key for/i)
    .fill(name);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /generate api key/i })
    .click();
  const key = (await page.getByTestId('secret-once').textContent())!.trim();
  expect(key).toMatch(/^mono_[0-9a-f]{12}_/);
  await page.getByRole('button', { name: /i have saved it/i }).click();
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText(key)).toHaveCount(0);

  const me = await page.request.get('/api/v1/me', { headers: { authorization: `Bearer ${key}` } });
  expect(me.status()).toBe(200);
  expect(((await me.json()) as { company: string }).company).toBe('Demo Industries');
  const items = await page.request.get('/api/v1/items', { headers: { 'x-api-key': key } });
  expect(items.status()).toBe(200);

  const row = page.locator('main li').filter({ hasText: name });
  await row.getByRole('button', { name: /revoke/i }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /revoke/i })
    .click();
  await expect(row.getByText(/revoked/i).first()).toBeVisible();
  expect(
    (await page.request.get('/api/v1/me', { headers: { authorization: `Bearer ${key}` } })).status(),
  ).toBe(401);
});
