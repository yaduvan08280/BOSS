import type { PackInput } from '../schema';
import { byField, f, flow, move, rep, req, rights, rt, st, task } from './kit';

/** A developer: units, one booking per unit, a payment schedule by milestone, the agreement and the registry. */
export const realEstatePack: PackInput = {
  key: 'real_estate',
  name: 'Real estate',
  version: 1,
  industry: 'real estate',
  description:
    'Flats and plots as a master, one live booking per unit with its payment schedule by milestone, and the agreement-to-registry process.',
  roles: [
    {
      key: 'sales_exec',
      name: 'Property sales executive',
      permissions: [...rights.everyday, ...rights.work('records', 'crm', 'fms')],
    },
    {
      key: 'crm_exec',
      name: 'Post-sales (CRM)',
      permissions: [...rights.everyday, ...rights.lead('records', 'fms'), ...rights.work('money')],
    },
  ],
  taxCodes: [{ code: 'RE5', name: 'GST on under-construction property' }],
  masters: [
    {
      key: 'units',
      name: 'Units',
      description: 'Every flat or plot you sell.',
      fields: [
        f('code', 'Unit', 'text', { required: true }),
        f('tower', 'Tower / block'),
        f('floor', 'Floor', 'number'),
        f('area', 'Area (sq ft)', 'number'),
        f('price', 'Price (₹)', 'amount'),
      ],
      keyField: 'code',
      displayField: 'code',
      rows: [
        { code: 'A-101', tower: 'A', floor: 1, area: 1200, price: 6000000 },
        { code: 'A-102', tower: 'A', floor: 1, area: 1450, price: 7250000 },
        { code: 'B-201', tower: 'B', floor: 2, area: 1200, price: 6100000 },
      ],
    },
  ],
  recordTypes: [
    rt('booking', 'Unit booking', 'Unit bookings', 'BKG', 'building', {
      fields: [
        // One live booking per unit: a cancelled booking frees it.
        rep('unit', 'Unit', 'master', { master: 'm:@pack/master/units', required: true, unique: true }),
        req('buyer', 'Buyer'),
        f('mobile', 'Mobile', 'mobile'),
        rep('price', 'Agreed price (₹)', 'amount', { required: true }),
        rep('booked_on', 'Booked on', 'date'),
      ],
      tables: [
        {
          key: 'schedule',
          label: 'Payment schedule',
          fields: [
            f('milestone', 'Milestone', 'text', { required: true }),
            f('percent', '% of price', 'number', { required: true }),
            f('due', 'Due on', 'date'),
          ],
        },
      ],
      statuses: [
        st('booked', 'Booked', 'info'),
        st('agreement', 'Agreement signed', 'warn'),
        st('registered', 'Registered', 'ok', true),
        st('cancelled', 'Cancelled', 'neutral', true, true),
      ],
      moves: [
        move('booked', 'sign', 'Agreement signed', 'agreement'),
        move('agreement', 'register', 'Registry done', 'registered', ['approve']),
        move('booked', 'cancel', 'Cancel the booking', 'cancelled', ['approve']),
        move('agreement', 'cancel', 'Cancel the booking', 'cancelled', ['approve']),
      ],
    }),
  ],
  flows: [
    flow(
      'agreement_registry',
      'Agreement to registry',
      'Unit',
      [req('unit', 'Unit'), req('buyer', 'Buyer')],
      [
        task('draft', 'Draft the agreement', 48),
        task('sign', 'Buyer signs', 168),
        task('stamp', 'Stamp duty and registration fee paid', 72, { proofRequired: true }),
        task('registry', 'Registry done at the sub-registrar', 168, { proofRequired: true }),
      ],
    ),
  ],
  reports: [byField('bookings_by_status', 'Bookings by status', 'booking', 'status', 'price')],
};
