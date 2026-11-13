import type { PackInput } from '../schema';
import { ME } from '../schema';
import { rights } from './kit';

const view = (...m: string[]) => m.map((x) => `${x}.view`);
const work = (...m: string[]) => m.flatMap((x) => [`${x}.view`, `${x}.create`]);
const lead = (...m: string[]) => m.flatMap((x) => [`${x}.view`, `${x}.create`, `${x}.edit`, `${x}.approve`]);
const { everyday } = rights;
const daily = { type: 'daily' };
const checklist = (name: string, dueTime: string, lines: string[]) => ({
  key: name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 38),
  name,
  input: {
    items: lines.map((text, i) => ({ key: `i${i + 1}`, text })),
    frequency: daily,
    dueTime,
    windowHours: 2,
    doerIds: [ME],
    skipHolidays: false,
    startDate: '2026-01-01',
  },
});

/**
 * The hospitality pack (plan §12, §12A): the module switched on, the roles of a hotel and its restaurants, the
 * tax-code shells an accountant fills, the lists the screens offer, and the opening / closing checklists.
 * Outlets, the menu, rooms and rates are a property's own and are set up on their screens.
 */
export const hospitalityPack: PackInput = {
  key: 'hospitality',
  name: 'Hotel & restaurant',
  version: 1,
  industry: 'hospitality',
  description:
    'Restaurant, bar and hotel: POS, kitchen display, reservations, front desk, housekeeping, banquets. Adds the roles, tax codes to fill, and opening and closing checklists.',
  switches: { hospitality: true },
  roles: [
    { key: 'steward', name: 'Steward / captain', permissions: [...everyday, ...work('hosp')] },
    { key: 'cashier', name: 'Cashier', permissions: [...everyday, ...work('hosp'), ...view('money')] },
    { key: 'kitchen', name: 'Kitchen station', permissions: [...everyday, ...work('hosp'), ...view('ims')] },
    { key: 'bartender', name: 'Bartender', permissions: [...everyday, ...work('hosp'), ...work('ims')] },
    {
      key: 'fnb_manager',
      name: 'F&B manager',
      permissions: [...everyday, ...lead('hosp', 'ims'), ...view('money', 'reports')],
    },
    {
      key: 'front_office',
      name: 'Front office',
      permissions: [...everyday, ...work('hosp'), ...view('money')],
    },
    { key: 'reservations', name: 'Reservations', permissions: [...everyday, ...work('hosp')] },
    {
      key: 'hk_supervisor',
      name: 'Housekeeping supervisor',
      permissions: [...everyday, ...lead('hosp'), ...work('ims')],
    },
    { key: 'hk_attendant', name: 'Housekeeping attendant', permissions: [...everyday, ...work('hosp')] },
    {
      key: 'night_auditor',
      name: 'Night auditor',
      permissions: [...everyday, ...lead('hosp'), ...view('money', 'reports')],
    },
    {
      key: 'banquet_manager',
      name: 'Banquet manager',
      permissions: [...everyday, ...lead('hosp'), ...view('money', 'ims')],
    },
    {
      key: 'gm',
      name: 'General manager',
      permissions: [
        ...everyday,
        ...lead('hosp', 'ims', 'money', 'delegation', 'checklist', 'ticket', 'slip', 'hr'),
        ...view('reports', 'crm', 'fms'),
      ],
    },
  ],
  taxCodes: [
    { code: 'FOOD', name: 'GST on food' },
    { code: 'LIQUOR', name: 'VAT on liquor' },
    { code: 'ROOM', name: 'GST on rooms (by tariff slab)' },
    { code: 'BANQUET', name: 'GST on banquets' },
    { code: 'SERVICE', name: 'GST on other services' },
  ],
  lists: [
    {
      key: 'list:hosp_occasion',
      values: ['Birthday', 'Anniversary', 'Business dinner', 'Wedding reception', 'Conference'],
    },
    {
      key: 'list:hosp_void_reason',
      values: ['Guest changed mind', 'Wrong item punched', 'Kitchen delay', 'Quality complaint'],
    },
  ],
  checklists: [
    checklist('Restaurant opening', '10:30', [
      'Floor, tables and chairs clean; cutlery and napkins laid',
      'POS and printers on; a test ticket printed in the kitchen and the bar',
      'Float counted and typed in the shift',
      "Today's 86 list checked with the kitchen",
      'Fridge and freezer temperatures logged',
    ]),
    checklist('Restaurant closing', '23:30', [
      'Every table billed; no running order left',
      'Cash counted by denomination and the day closed',
      'Kitchen gas, exhaust and equipment off',
      'Wastage of the day entered',
      'Bar stock counted and locked',
    ]),
    checklist('Front desk morning', '07:30', [
      "Today's arrivals and departures read; rooms blocked for early arrivals",
      'Night audit pack read; open folios of guests who left followed up',
      'Form C due today filed',
      'Keys and key cards counted',
    ]),
    checklist('Housekeeping morning', '08:00', [
      'Rooms to clean given out by floor',
      'Linen and amenities issued from the store',
      'Lost and found entered',
      'Rooms out of order checked with maintenance',
    ]),
  ],
};
