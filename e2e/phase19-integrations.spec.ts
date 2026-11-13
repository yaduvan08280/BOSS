import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { call, choose, expectNoSideScroll, settled, signIn, tag } from './phase11-kit';

const shots = process.env.E2E_SCREENSHOTS === '1';
type Branch = { id: string; name: string };

/**
 * Phase 19 through the screens (rows X1, X2, X4, X8, X14, X15, X17, X20 of docs/plans/coverage.md). The outside
 * services are a stand-in web server started by the test (a channel manager and an e-invoice provider): the API
 * under test must run with WEBHOOK_ALLOW_PRIVATE=1 so it may call this machine. Payment gateways have fixed
 * addresses, so paying a link is not driven here — only saving the gateway and seeing its webhook address.
 */
let server: Server;
let base = '';
const seen: { url: string; body: unknown }[] = [];
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ url: req.url ?? '', body: raw ? JSON.parse(raw) : null });
      res.setHeader('content-type', 'application/json');
      res.end(
        req.url === '/einvoice'
          ? JSON.stringify({
              irn: 'e2e'.padEnd(64, '7'),
              ackNo: 112010036563310,
              ackDt: '2026-11-13 12:30:00',
              signedQr: 'signed.qr',
            })
          : '{}',
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => new Promise((r) => server.close(r)));

const firstBranch = async (page: Page) => {
  const list = await call<{ branches: Branch[] } | Branch[]>(page, 'GET', '/api/org/branches');
  return (Array.isArray(list) ? list : list.branches)[0]!;
};
const open = async (page: Page, tab: string) => {
  await page.goto('/system/integration/connections');
  await settled(page);
  await page.getByRole('tab', { name: tab }).click();
};

test('a gateway, a property’s booking page and its channel manager', async ({ page }, info) => {
  const project = info.project.name;
  const snap = async (name: string) => {
    if (shots) await page.screenshot({ path: `docs/screenshots/phase19/${project}-${name}.png` });
  };
  const t = tag(project);
  const n = { type: `Lake ${t}`, plan: `L${t}`, guest: `Web ${t}`, ref: `BDC-${t}` };
  const no = 3000 + (Date.now() % 5000);
  await signIn(page);
  await call(page, 'PUT', '/api/hosp/settings', { enabled: true });
  const branch = await firstBranch(page);
  const type = await call<{ id: string }>(page, 'POST', '/api/hosp/room-types', {
    branchId: branch.id,
    name: n.type,
    code: `K${t}`,
    occupancy: 2,
    maxOccupancy: 3,
  });
  await call(page, 'POST', '/api/hosp/rooms/bulk', { typeId: type.id, from: no, to: no + 1, floor: '3' });
  await call(page, 'POST', '/api/hotel/plans', {
    branchId: branch.id,
    code: n.plan,
    name: `Web rate ${t}`,
    meal: 'EP',
    rates: [{ roomTypeId: type.id, base: 4500_00 }],
    weekendDays: [],
  });

  // X1: the payment gateway's keys are saved; the address its webhook must call is shown.
  await open(page, 'Payments & e-invoice');
  const gateway = page.getByTestId('gateway-card');
  await gateway.getByLabel('Key ID').fill('rzp_test_e2e');
  await gateway.getByLabel('Key secret').fill('secret-e2e');
  await gateway.getByLabel('Webhook secret').fill('whsec-e2e');
  await gateway.getByRole('button', { name: 'Save connection' }).click();
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  await expect(gateway.getByTestId('gateway-hook')).toContainText('/api/hooks/gateway/');
  await expect(gateway.getByText('Keys saved')).toBeVisible();
  await expectNoSideScroll(page);
  await snap('gateway');

  // X8: the property's own booking page is switched on and gets its link.
  await page.getByRole('tab', { name: 'Rooms & channels' }).click();
  await choose(page, page.getByRole('combobox', { name: 'Property', exact: true }), branch.name);
  const pageCard = page.getByTestId('rooms-page-card');
  const toggle = pageCard.getByRole('switch');
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  await expect(pageCard.getByTestId('rooms-link')).toContainText('/rooms/');
  const link = (await pageCard.getByTestId('rooms-link').textContent())!.trim();

  // X1, X2: the channel manager — its address, token, the room's code there and the plan sent — then a push.
  const channel = page.getByTestId('channel-card');
  await channel.getByLabel("Provider's address").fill(base);
  await channel.getByLabel('Access token').fill('cm-token-e2e');
  await channel.getByLabel(`Code for ${n.type}`).fill(`CM-${t}`);
  await choose(
    page,
    channel.getByRole('combobox', { name: 'Rate plan sent to the channels' }),
    `Web rate ${t}`,
  );
  await channel.getByRole('button', { name: 'Save connection' }).click();
  await expect(channel.getByText('Keys saved')).toBeVisible();
  await channel.getByRole('button', { name: 'Send the next 30 days' }).click();
  await expect(page.getByText(/^Sent: \d+ room-days$/)).toBeVisible();
  const ari = seen.filter((s) => s.url === '/ari').pop()!.body as {
    rows: { room: string; price: number; available: number }[];
  };
  // Thirty days of this room type by its code there, at the plan's price, both rooms free.
  const mine = ari.rows.filter((r) => r.room === `CM-${t}`);
  expect(mine).toHaveLength(30);
  expect(mine[0]).toMatchObject({ price: 4500_00, available: 2 });
  await expectNoSideScroll(page);
  await snap('channel');

  // X4, X20: a booking arrives from a channel on the webhook; the log shows it came in.
  const conns = await call<{ kind: string; branchId: string | null; hookPath: string }[]>(
    page,
    'GET',
    '/api/connect/connections',
  );
  const hook = conns.find((c) => c.kind === 'CHANNEL' && c.branchId === branch.id)!.hookPath;
  const today = (mine[0] as unknown as { date: string }).date;
  const plus = (d: string, days: number) =>
    new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const made = await page.request.post(hook, {
    data: {
      ref: n.ref,
      channel: 'Booking.com',
      room: `CM-${t}`,
      arrive: plus(today, 5),
      depart: plus(today, 6),
      guest: { name: 'Otto Traveller' },
    },
  });
  expect(made.ok(), await made.text()).toBeTruthy();
  await page.getByRole('tab', { name: 'Log' }).click();
  await expect(page.locator('main li', { hasText: n.ref }).getByText('Received · Booking')).toBeVisible();
  await expect(page.locator('main li', { hasText: 'Rates and availability' }).first()).toBeVisible();
  await snap('log');

  // X8: a guest books a room on the public page — no sign-in.
  await page.context().clearCookies();
  await page.goto(link);
  await expect(page.getByRole('heading', { name: `Book a room at ${branch.name}` })).toBeVisible();
  const offer = page.getByRole('radio', { name: new RegExp(n.type) });
  await expect(offer).toContainText('₹4,500');
  await offer.click();
  await page.getByLabel('Name').fill(n.guest);
  await page.getByLabel('Mobile').fill(`93${String(Date.now()).slice(-8)}`);
  const sum = page.getByLabel(/What is \d+ \+ \d+/);
  const [a, b] = (
    (await page
      .locator('label', { hasText: /\d+ \+ \d+/ })
      .first()
      .textContent()) ?? ''
  )
    .match(/\d+/g)!
    .map(Number);
  await sum.fill(String(a! + b!));
  await expectNoSideScroll(page);
  await snap('public-rooms');
  await page.getByRole('button', { name: 'Book', exact: true }).click();
  await expect(page.getByText('Your room is booked')).toBeVisible();
  await expect(page.getByText(/Booking BK-\d+/)).toBeVisible();
});

test('a site agent’s key and a delivery partner’s payout file', async ({ page }, info) => {
  const project = info.project.name;
  const t = tag(project);
  const n = { outlet: `Cloud ${t}`, dal: `Dal ${t}`, agent: `Desk PC ${t}`, ref: `ZOM-${t}` };
  await signIn(page);
  await call(page, 'PUT', '/api/hosp/settings', { enabled: true });
  const branch = await firstBranch(page);
  // A Zomato order made, tagged, billed and closed on Zomato's account (through the API).
  const outlet = await call<{ id: string }>(page, 'POST', '/api/hosp/outlets', {
    name: n.outlet,
    branchId: branch.id,
  });
  await call(page, 'POST', '/api/hosp/stations', { outletId: outlet.id, name: 'Kitchen' });
  const cat = await call<{ id: string }>(page, 'POST', '/api/hosp/menu/categories', { name: `Food ${t}` });
  const dal = await call<{ id: string }>(page, 'POST', '/api/hosp/menu/items', {
    categoryId: cat.id,
    outletIds: [outlet.id],
    name: n.dal,
    price: 28000,
  });
  const order = await call<{ id: string }>(page, 'POST', '/api/pos/orders', {
    outletId: outlet.id,
    type: 'TAKEAWAY',
    tableIds: [],
  });
  await call(page, 'POST', `/api/pos/orders/${order.id}/items`, {
    items: [{ menuItemId: dal.id, qty: 1 }],
    fire: true,
  });
  const tagged = await call<{ modeId: string }>(page, 'POST', `/api/pos/orders/${order.id}/aggregator`, {
    aggregator: 'ZOMATO',
    ref: n.ref,
  });
  const check = await call<{ id: string; total: number }>(
    page,
    'POST',
    `/api/pos/orders/${order.id}/check`,
    {},
  );
  await call(page, 'POST', `/api/pos/checks/${check.id}/pay`, {
    payments: [{ modeId: tagged.modeId, amount: check.total }],
  });

  // X17: a key for the branch's computer, shown once.
  await open(page, 'Site agents & Tally');
  const agents = page.getByTestId('agents-card');
  await choose(page, agents.getByRole('combobox', { name: 'Branch' }), branch.name);
  await agents.getByLabel('Name (for example, Front desk PC)').fill(n.agent);
  await agents.getByRole('button', { name: 'Make a key' }).click();
  const key = (await page.getByTestId('secret-once').textContent())!.trim();
  expect(key).toMatch(/^agt_[0-9a-f]{12}_/);
  if (shots) await page.screenshot({ path: `docs/screenshots/phase19/${project}-agent-key.png` });
  await page.getByRole('dialog').getByRole('button').last().click();
  const row = agents.locator('li', { hasText: n.agent });
  await expect(row.getByText('Not heard from')).toBeVisible();
  // The agent calls in with its key: it is online.
  const jobs = await page.request.get('/api/agent/print', { headers: { authorization: `Bearer ${key}` } });
  expect(jobs.ok()).toBeTruthy();
  await page.reload();
  await settled(page);
  await page.getByRole('tab', { name: 'Site agents & Tally' }).click();
  await expect(
    page.getByTestId('agents-card').locator('li', { hasText: n.agent }).getByText('Online'),
  ).toBeVisible();
  await expect(page.getByTestId('tally-card')).toContainText('Waiting');
  await expectNoSideScroll(page);

  // X14: Zomato's payout file — checked first, then recorded.
  await page.getByRole('tab', { name: 'Zomato / Swiggy' }).click();
  await expect(page.getByTestId('waiting-card')).toContainText(n.ref);
  const kept = 60;
  const total = check.total / 100;
  const csv = `Order ID,Order Total,Commission,Net Payout\n${n.ref},${total.toFixed(2)},${kept.toFixed(2)},${(total - kept).toFixed(2)}\nZOM-GHOST-${t},100.00,20.00,80.00\n`;
  const payout = page.getByTestId('payout-card');
  await payout
    .locator('input[type=file]')
    .setInputFiles({ name: `zomato-${t}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await payout.getByRole('button', { name: 'Check the file' }).click();
  const result = payout.getByTestId('payout-result');
  await expect(result).toContainText('Checked — nothing recorded yet');
  await expect(result).toContainText('1 orders found');
  await expect(result).toContainText(`ZOM-GHOST-${t}`);
  await payout.getByRole('button', { name: 'Record the payout' }).click();
  await expect(result).toContainText('Recorded');
  await expect(page.getByTestId('waiting-card')).not.toContainText(n.ref);
  await expectNoSideScroll(page);
  if (shots) await page.screenshot({ path: `docs/screenshots/phase19/${project}-payout.png` });
});

test('a B2B invoice gets its e-invoice number', async ({ page }, info) => {
  const project = info.project.name;
  const t = tag(project);
  await signIn(page);
  // A legal entity with a GSTIN and a PIN code in its address, and a desk of it (made once, reused after).
  type Structure = {
    entities: { id: string; name: string }[];
    branches: { id: string; name: string; entityId: string | null }[];
  };
  const s = await call<Structure>(page, 'GET', '/api/branches/structure');
  const entity =
    s.entities.find((e) => e.name === 'E-invoice Foods') ??
    (await call<{ id: string }>(page, 'POST', '/api/branches/entities', {
      name: 'E-invoice Foods',
      state: 'Rajasthan',
      taxId: '08AAAAA0000A1Z5',
      details: { legalName: 'E-invoice Foods Pvt Ltd', address: '12 MI Road, Jaipur, Rajasthan 302001' },
    }));
  const desk =
    s.branches.find((b) => b.name === 'E-invoice desk') ??
    (await call<{ id: string }>(page, 'POST', '/api/org/branches', {
      name: 'E-invoice desk',
      type: 'OFFICE',
      entityId: entity.id,
    }));
  await call(page, 'PUT', '/api/money/tax-rates', {
    code: 'GST18',
    name: 'GST 18%',
    percent: 18,
    from: '2020-01-01',
  });
  const buyer = await call<{ id: string }>(page, 'POST', '/api/money/parties', {
    name: `Acme Foods ${t}`,
    kinds: ['customer'],
    state: 'Maharashtra',
    taxId: '27ABCDE1234F1Z5',
    address: 'Plot 4, Andheri East, Mumbai, Maharashtra 400069',
  });
  const bill = await call<{ id: string }>(page, 'POST', '/api/money/bills', {
    type: 'INVOICE',
    partyId: buyer.id,
    date: new Date().toISOString().slice(0, 10),
    branchId: desk.id,
    lines: [{ item: 'Outdoor catering', hsn: '996334', qty: 1, rate: 10000_00, taxCode: 'GST18' }],
  });
  await call(page, 'POST', `/api/money/bills/${bill.id}/issue`);

  // X1: the e-invoice provider is connected.
  await open(page, 'Payments & e-invoice');
  const card = page.getByTestId('einvoice-card');
  await card.getByLabel("Provider's address").fill(base);
  await card.getByLabel('Access token').fill('gsp-token-e2e');
  await card.getByRole('button', { name: 'Save connection' }).click();
  await expect(card.getByText('Keys saved')).toBeVisible();

  // X15: on the bill, "Get e-invoice" registers it and the IRN is shown.
  await page.goto('/money/bills');
  await settled(page);
  await page.getByText(`Acme Foods ${t}`).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Get e-invoice (IRN)' }).click();
  await expect(page.getByText('E-invoice registered')).toBeVisible();
  await expect(dialog.getByTestId('irn')).toContainText('e2e7777');
  await expect(dialog.getByRole('button', { name: 'Cancel e-invoice' })).toBeVisible();
  const sent = seen.filter((x) => x.url === '/einvoice').pop()!.body as {
    BuyerDtls: { Gstin: string };
    ValDtls: { TotInvVal: number };
  };
  expect(sent.BuyerDtls.Gstin).toBe('27ABCDE1234F1Z5');
  expect(sent.ValDtls.TotInvVal).toBe(11800);
  await expectNoSideScroll(page);
  if (shots) await page.screenshot({ path: `docs/screenshots/phase19/${project}-einvoice.png` });
});
