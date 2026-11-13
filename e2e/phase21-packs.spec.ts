import { expect, test } from '@playwright/test';
import { call, choose, expectNoSideScroll, settled, signIn, tag } from './phase11-kit';

const shots = process.env.E2E_SCREENSHOTS === '1';

/**
 * Phase 21 through the screens (rows K41, K43, K44 of docs/plans/coverage.md): a trade is set up from its pack
 * alone — the Mining pack is installed from the Master Library, and what it made is used at once: a weighbridge
 * slip whose net weight MONO works out, a royalty pass whose number can be used only once, and the pack's
 * register. The other eight trades' days are proved by the API tests.
 */
test('the mining pack is installed from the screen and its records work', async ({ page }, info) => {
  const project = info.project.name;
  const t = tag(project);
  const dialog = page.getByRole('dialog').last();
  await signIn(page);
  await page.goto('/masters/library');
  await settled(page);
  const card = page.getByTestId('pack-mining');
  const install = card.getByRole('button', { name: 'Install' });
  // The demo company keeps the pack once a run has installed it.
  if (await install.count()) {
    await install.click();
    await expect(page.getByText(/^Mining installed: \d+ added, \d+ already there$/)).toBeVisible();
  }
  await expect(card.getByText('Installed · v1')).toBeVisible();
  await expectNoSideScroll(page);
  if (shots) await page.screenshot({ path: `docs/screenshots/phase21/${project}-packs.png` });

  // What the pack made: its record types (in a menu section of its own), its process, its register.
  const types = (
    await call<{ types: { id: string; prefix: string; menu: { section: string } }[] }>(
      page,
      'GET',
      '/api/records/types',
    )
  ).types;
  const slips = types.find((x) => x.prefix === 'WB')!;
  const passes = types.find((x) => x.prefix === 'RP')!;
  expect(passes.menu.section).toBe('Mining');

  // K43: a weighbridge slip — gross and tare typed, the net worked out.
  await page.goto(`/records/${slips.id}`);
  await settled(page);
  await page
    .getByRole('button', { name: /^New Weighbridge slip/ })
    .first()
    .click();
  await dialog.getByRole('textbox', { name: 'Vehicle number *' }).fill(`RJ14 ${t}`);
  await choose(page, dialog.getByRole('combobox', { name: /Mineral/ }), 'Quartz');
  await dialog.getByRole('textbox', { name: 'Gross (t) *' }).fill('28.4');
  await dialog.getByRole('textbox', { name: 'Tare (t) *' }).fill('10.15');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('heading', { name: new RegExp(`WB/.* RJ14 ${t}`) })).toBeVisible();
  await expect(dialog).toContainText('18.25');
  await expectNoSideScroll(page);
  if (shots) await page.screenshot({ path: `docs/screenshots/phase21/${project}-weigh-slip.png` });

  // K44: a royalty pass — and the same pass number a second time is refused.
  const passNo = `RJ/TNK/${t}`;
  const newPass = async () => {
    await page.goto(`/records/${passes.id}`);
    await settled(page);
    await page
      .getByRole('button', { name: /^New Royalty pass/ })
      .first()
      .click();
    await dialog.getByRole('textbox', { name: 'Pass number *' }).fill(passNo);
    await dialog.getByRole('textbox', { name: 'Vehicle number *' }).fill(`RJ14 ${t}`);
    await choose(page, dialog.getByRole('combobox', { name: /Mineral/ }), 'Quartz');
    await dialog.getByRole('textbox', { name: 'Weight (t) *' }).fill('18.25');
    await dialog.getByRole('textbox', { name: 'Destination *' }).fill('Kishangarh');
    await dialog.getByRole('button', { name: 'Save' }).click();
  };
  await newPass();
  await expect(dialog.getByRole('heading', { name: new RegExp(`RP/.* ${passNo}`) })).toBeVisible();
  await newPass();
  await expect(dialog.getByText(/already/i).first()).toBeVisible();
  if (shots) await page.screenshot({ path: `docs/screenshots/phase21/${project}-pass-twice.png` });

  // The pack's register lists the pass.
  const reports = await call<{ id: string; name: string }[] | { reports: { id: string; name: string }[] }>(
    page,
    'GET',
    '/api/reports',
  );
  const list = Array.isArray(reports) ? reports : reports.reports;
  const register = list.find((r) => r.name === 'Royalty-pass register')!;
  const ran = await call<{ result: { rows: unknown[][] } }>(page, 'GET', `/api/reports/${register.id}/run`);
  expect(ran.result.rows.flat()).toContain(passNo);
});
