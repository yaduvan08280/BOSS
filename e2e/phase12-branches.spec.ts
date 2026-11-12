import { expect, test } from '@playwright/test';
import { call, choose, expectNoSideScroll, settled, signIn, tag } from './phase11-kit';

const shots = process.env.E2E_SCREENSHOTS === '1';

/**
 * Phase 12, stage A through the screens (rows G1, G7, G9 of docs/plans/coverage.md): the owner builds the group's
 * structure, says who approves leave at one branch, checks it, and narrows the app to one branch.
 */
test('the owner sets up branches, decides who approves, and switches to one branch', async ({
  page,
}, info) => {
  const project = info.project.name;
  const snap = async (name: string) => {
    if (shots) await page.screenshot({ path: `docs/screenshots/phase12/${project}-${name}.png` });
  };
  const t = tag(project);
  const names = { entity: `Hotels ${t}`, region: `Jaipur ${t}`, rooftop: `Rooftop ${t}`, lake: `Lake ${t}` };
  await signIn(page);
  await page.goto('/system/branches');
  await settled(page);
  await expectNoSideScroll(page);
  const dialog = page.getByRole('dialog');
  const save = async () => {
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
  };

  // G1: a legal entity, a region and two branches, one with a manager.
  await page.getByRole('button', { name: 'Add an entity' }).click();
  await dialog.getByLabel('Name').fill(names.entity);
  await dialog.getByLabel('Tax number (GSTIN / TRN)').fill('08AAAAA0000A1Z5');
  await save();
  await expect(page.getByText(names.entity)).toBeVisible();

  await page.getByRole('button', { name: 'Add a region' }).click();
  await dialog.getByLabel('Name').fill(names.region);
  await save();
  await expect(page.getByText(names.region)).toBeVisible();

  for (const [name, withManager] of [
    [names.rooftop, true],
    [names.lake, false],
  ] as const) {
    await page.getByRole('button', { name: 'Add branch' }).click();
    await dialog.getByLabel('Name').fill(name);
    await choose(page, dialog.getByRole('combobox', { name: 'Region' }), names.region);
    await choose(page, dialog.getByRole('combobox', { name: 'Legal entity' }), names.entity);
    if (withManager) await choose(page, dialog.getByRole('combobox', { name: 'Branch managers' }), 'Gopal');
    await save();
    await expect(page.getByText(name).first()).toBeVisible();
  }
  const card = (name: string) => page.locator('li', { hasText: name });
  await expect(card(names.rooftop).getByText(/Managed by Gopal/)).toBeVisible();
  await expect(card(names.lake).getByText('No manager yet')).toBeVisible();
  await expectNoSideScroll(page);
  await snap('structure');

  // G9: who approves leave at the rooftop — the owner's choice, checked before relying on it.
  await page.getByRole('tab', { name: 'Who approves' }).click();
  await settled(page);
  const leave = page.getByRole('region', { name: 'Leave', exact: true });
  await leave.getByRole('button', { name: /Set who approves|For one branch or entity/ }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Applies to' }), `Only ${names.rooftop}`);
  await expect(dialog.getByText('Step 3')).toBeVisible();
  await dialog.getByLabel('Goes up after (hours)').first().fill('4');
  await snap('route-editor');
  await save();
  const saved = page.locator('div.border', { hasText: names.rooftop });
  await expect(saved.getByText('Branch manager (goes up after 4 hours)')).toBeVisible();
  await expect(saved.getByText('Owner')).toBeVisible();
  await expectNoSideScroll(page);
  await snap('who-approves');
  // The check names the people: a request from someone at the rooftop goes to Gopal first.
  const structure = await call<{ branches: { id: string; name: string }[] }>(
    page,
    'GET',
    '/api/branches/structure',
  );
  const rooftopId = structure.branches.find((b) => b.name === names.rooftop)!.id;
  const people = await call<{ id: string; name: string }[]>(page, 'GET', '/api/org/users');
  const asha = people.find((p) => !/Gopal/.test(p.name) && !/owner/i.test(p.name))!;
  await call(page, 'PUT', `/api/branches/people/${asha.id}`, { homeBranchId: rooftopId, alsoBranchIds: [] });
  await saved.getByRole('button', { name: 'Edit' }).click();
  await choose(page, dialog.getByRole('combobox', { name: 'Request from…' }), asha.name);
  await expect(dialog.getByText(/Branch manager: Gopal/)).toBeVisible();
  await page.keyboard.press('Escape');

  // G7: the switcher narrows every call to the chosen branch.
  await page.reload();
  await settled(page);
  const switcher = page.getByRole('combobox', { name: 'Branch shown' }).filter({ visible: true });
  const narrowed = page.waitForRequest(
    (r) => r.url().includes('/api/') && r.headers()['x-mono-branch'] === rooftopId,
  );
  await choose(page, switcher, names.rooftop);
  await narrowed;
  await expect(switcher).toContainText(names.rooftop);
  await expectNoSideScroll(page);
  await snap('switcher');
  await choose(page, switcher, 'All my branches');

  // Leave the shared demo data as it was for the other suites.
  await call(page, 'PUT', `/api/branches/people/${asha.id}`, { homeBranchId: null, alsoBranchIds: [] });
  const routes = await call<{ id: string; branchId: string | null }[]>(
    page,
    'GET',
    '/api/branches/approvals',
  );
  for (const r of routes.filter((x) => x.branchId === rooftopId))
    await call(page, 'DELETE', `/api/branches/approvals/${r.id}`);
  const all = await call<{
    branches: { id: string; name: string }[];
    regions: { id: string; name: string }[];
    entities: { id: string; name: string }[];
  }>(page, 'GET', '/api/branches/structure');
  for (const b of all.branches.filter((x) => x.name.endsWith(t))) {
    await call(page, 'PUT', '/api/branches/managers', { branchId: b.id, role: 'MANAGER', userIds: [] });
    await call(page, 'DELETE', `/api/org/branches/${b.id}`);
  }
  for (const r of all.regions.filter((x) => x.name.endsWith(t)))
    await call(page, 'DELETE', `/api/branches/regions/${r.id}`);
  for (const e of all.entities.filter((x) => x.name.endsWith(t)))
    await call(page, 'DELETE', `/api/branches/entities/${e.id}`);
});
