import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, formatMoney, localDate, toInrPaise } from '@mono/shared';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { ok, twoOutlets, type World } from './testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const TZ = 'Asia/Kolkata';
const lastMonth = () => {
  const [y, m] = localDate(new Date(), TZ).split('-').map(Number) as [number, number];
  return `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
};

describe('countries and currencies (phase 12, stage C)', () => {
  it('G34: money is minor units and a currency; rupees keep lakh and crore', () => {
    expect(formatMoney(13_100_000_00)).toBe('₹1,31,00,000.00');
    expect(formatMoney(13_100_000_00, 'INR', { compact: true })).toBe('₹1.31 Cr');
    expect(formatMoney(1_234_567_89, 'AED')).toBe('AED 1,234,567.89');
    expect(formatMoney(-5_000_50, 'USD')).toBe('-USD 5,000.50');
    // Dinars have three decimals, yen none.
    expect(formatMoney(12_345, 'KWD')).toBe('KWD 12.345');
    expect(formatMoney(12_345, 'JPY')).toBe('JPY 12,345');
    // AED 1,000.00 at ₹22.75 = ₹22,750.00; rupees pass through.
    expect(toInrPaise(1_000_00, 'AED', 22.75)).toBe(22_750_00);
    expect(toInrPaise(999, 'INR', 5)).toBe(999);
  });

  it("G37, G38: each entity is paid and closed in its own currency; the group total is in rupees by the month's rate", async () => {
    const w = await world(ctx.app);
    const { g } = await twoOutlets(ctx.prisma, w);
    const dubai = await ok<{ id: string }>(
      w.api.post('/api/branches/entities', { name: 'GGM Gulf LLC', country: 'AE', currency: 'AED' }),
    );
    const marina = await ok<{ id: string }>(
      w.api.post('/api/org/branches', { name: 'Marina Dubai', type: 'OUTLET', entityId: dubai.id }),
    );
    const month = lastMonth();
    const paid = async (name: string, branchId: string, salary: number) => {
      const p = await g.at(name, branchId);
      await ctx.prisma.user.update({ where: { id: p.id }, data: { hr: { doj: '2025-01-01', salary } } });
      await ctx.prisma.attendanceDay.createMany({
        data: Array.from({ length: 28 }, (_, i) => ({
          companyId: w.companyId,
          userId: p.id,
          date: addDays(`${month}-01`, i),
          status: 'PRESENT',
          workedMin: 480,
        })),
      });
      return p;
    };
    const inJaipur = await paid('Cook Rooftop', g.b.rooftop.id, 30_000);
    const inDubai = await paid('Cook Marina', marina.id, 4_000);
    type Sheet = {
      currency: string;
      totalPaise: number;
      missingRates: string[];
      lines: { user: { id: string }; currency: string; grossPaise: number }[];
    };
    const sheet = (entityId?: string) =>
      ok<Sheet>(w.api.get(`/api/hr/payroll/${month}${entityId ? `?entityId=${entityId}` : ''}`));
    // Dubai's payroll is in dirhams: the salary typed is AED 4,000 and nothing is converted.
    const gulf = await sheet(dubai.id);
    expect(gulf.currency).toBe('AED');
    expect(gulf.lines.map((l) => [l.user.id, l.currency])).toEqual([[inDubai.id, 'AED']]);
    expect(gulf.totalPaise).toBe(gulf.lines[0]!.grossPaise);
    // The group in rupees: with no rate typed for the month, the dirhams are left out and named.
    const before = await sheet();
    const jaipurGross = before.lines.find((l) => l.user.id === inJaipur.id)!.grossPaise;
    expect(before).toMatchObject({ currency: 'INR', missingRates: ['AED'], totalPaise: jaipurGross });
    // Only the accounts / HR admin types rates; rupees need none.
    const rate = (api: World['api'], body: object) => api.put('/api/branches/rates', body);
    expect((await rate(inJaipur.api, { currency: 'AED', month, rate: 22.75 })).status).toBe(403);
    expect((await rate(w.api, { currency: 'INR', month, rate: 1 })).status).toBe(400);
    await ok(rate(w.api, { currency: 'AED', month, rate: 22.75 }));
    const after = await sheet();
    expect(after.missingRates).toEqual([]);
    expect(after.totalPaise).toBe(jaipurGross + toInrPaise(gulf.lines[0]!.grossPaise, 'AED', 22.75));
    expect(await ok<unknown[]>(w.api.get(`/api/branches/rates?year=${month.slice(0, 4)}`))).toEqual([
      { currency: 'AED', month, rate: 22.75 },
    ]);
    // Closing Dubai keeps its figures in dirhams.
    const closed = await ok<Sheet & { closed: object | null }>(
      w.api.post(`/api/hr/payroll/${month}/close?entityId=${dubai.id}`, {}),
    );
    expect(closed).toMatchObject({ currency: 'AED', totalPaise: gulf.totalPaise });
    expect(closed.closed).not.toBeNull();
  });
});
