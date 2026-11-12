import type { Db } from '@mono/db';

/**
 * Phase 12 demo data: a sample group next to the demo company's own branches — two Indian companies of the
 * group, one franchise partner and one company abroad — each with an outlet, what it prints on its papers, and
 * the settings that show the phase: a number-series code, licences, a tax profile, royalty terms, an exchange
 * rate. Nobody is moved and no existing branch is changed, so everything from earlier phases reads as before.
 * Added once.
 */
export async function seedDemoBranches(db: Db, companyId: string): Promise<boolean> {
  if (await db.legalEntity.count({ where: { companyId } })) return false;
  const month = new Date().toISOString().slice(0, 7);
  const year = Number(month.slice(0, 4));
  const entity = (name: string, more: object) =>
    db.legalEntity.create({ data: { companyId, name, ...more } });
  const hotels = await entity('Demo Hotels Pvt Ltd', {
    isDefault: true,
    state: 'Rajasthan',
    taxId: '08AAACD1234E1Z5',
    details: {
      legalName: 'Demo Hotels Private Limited',
      address: '12 MI Road, Jaipur 302001',
      seriesCode: 'RJ',
      letterheadFooter: 'Subject to Jaipur jurisdiction',
      licences: [{ name: 'Trade', number: 'TR/JPR/5521', validTill: `${year + 1}-03-31` }],
    },
  });
  const foods = await entity('Demo Foods LLP', {
    state: 'Rajasthan',
    taxId: '08AABFD5678K1Z2',
    details: { address: 'Lake Road, Ajmer 305001', seriesCode: 'AJ' },
  });
  const franchise = await entity('Kota Foods (franchise)', {
    kind: 'FRANCHISE',
    state: 'Rajasthan',
    taxId: '08AAKFK9012M1Z9',
    details: {
      seriesCode: 'KOTA',
      franchise: {
        agreementStart: `${year - 1}-04-01`,
        agreementEnd: `${year + 2}-03-31`,
        royaltyPercent: 6,
        minimumPaise: 25_000_00,
      },
    },
  });
  const gulf = await entity('Demo Gulf LLC', {
    country: 'AE',
    currency: 'AED',
    taxId: '100234567800003',
    details: {
      address: 'Marina Walk, Dubai',
      seriesCode: 'DXB',
      tax: {
        regime: 'VAT',
        idLabel: 'TRN',
        invoiceTitle: 'Tax Invoice',
        rates: [{ name: 'VAT 5%', percent: 5 }],
        note: 'Prices include 5% VAT',
      },
    },
  });
  const raj = await db.region.create({ data: { companyId, name: 'Rajasthan' } });
  const jaipur = await db.region.create({ data: { companyId, name: 'Jaipur', parentId: raj.id } });
  const outlet = (name: string, code: string, entityId: string, more: object = {}) =>
    db.branch.create({ data: { companyId, name, code, type: 'OUTLET', entityId, ...more } });
  const rooftop = await outlet('Jaipur Rooftop', 'JRT', hotels.id, {
    regionId: jaipur.id,
    city: 'Jaipur',
    state: 'Rajasthan',
    details: { licences: [{ name: 'FSSAI', number: '12219007000123', validTill: `${year + 1}-06-30` }] },
  });
  await outlet('Ajmer Lake View', 'ALV', foods.id, { regionId: raj.id, city: 'Ajmer', state: 'Rajasthan' });
  await outlet('Kota Outlet', 'KOT', franchise.id, { regionId: raj.id, city: 'Kota', state: 'Rajasthan' });
  await outlet('Dubai Marina', 'DXM', gulf.id, { city: 'Dubai', timezone: 'Asia/Dubai' });
  await db.location.createMany({
    data: ['Dry store', 'Cold room', 'Bar'].map((name, i) => ({
      companyId,
      branchId: rooftop.id,
      name,
      kind: ['STORE', 'COLD_ROOM', 'BAR'][i]!,
    })),
  });
  // Who approves leave at the rooftop (the owner's choice, shown on System Master → Branches → Who approves).
  await db.approvalRoute.create({
    data: {
      companyId,
      kind: 'hr.leave',
      branchId: rooftop.id,
      steps: [
        { who: 'branch_manager', skipIfEmpty: true, escalateAfterHours: 4 },
        { who: 'department_head', skipIfEmpty: true },
        { who: 'owner' },
      ],
    },
  });
  await db.exchangeRate.create({ data: { companyId, currency: 'AED', month, rate: 22.75 } });
  return true;
}
