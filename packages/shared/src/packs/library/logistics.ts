import type { PackInput } from '../schema';
import { byField, f, flow, move, rep, req, rights, rt, st, task } from './kit';

/** A transporter: vehicles and drivers, the consignment note, trips with their expenses, the freight bill. */
export const logisticsPack: PackInput = {
  key: 'logistics',
  name: 'Logistics & transport',
  version: 1,
  industry: 'logistics',
  description:
    'Vehicles and drivers, consignment notes, trips with their expenses, and the trip-expense claim process. Freight bills are raised in Money.',
  roles: [
    {
      key: 'traffic',
      name: 'Traffic desk',
      permissions: [...rights.everyday, ...rights.work('records', 'fms', 'money')],
    },
    { key: 'driver', name: 'Driver', permissions: [...rights.work('delegation', 'records', 'fms')] },
  ],
  taxCodes: [{ code: 'GTA5', name: 'GST on goods transport' }],
  masters: [
    {
      key: 'vehicles',
      name: 'Vehicles',
      fields: [
        f('number', 'Vehicle number', 'text', { required: true }),
        f('type', 'Type'),
        f('capacity_t', 'Capacity (t)', 'number'),
        f('permit_till', 'Permit valid till', 'date'),
      ],
      keyField: 'number',
      displayField: 'number',
      rows: [
        { number: 'RJ14 GA 1234', type: '10-wheeler', capacity_t: 16 },
        { number: 'RJ14 GB 5678', type: '6-wheeler', capacity_t: 9 },
      ],
    },
    {
      key: 'drivers',
      name: 'Drivers',
      fields: [
        f('name', 'Name', 'text', { required: true }),
        f('licence', 'Licence no.'),
        f('mobile', 'Mobile', 'mobile'),
      ],
      keyField: 'name',
      displayField: 'name',
      rows: [
        { name: 'Ramesh Kumar', licence: 'RJ14 2015 0001234' },
        { name: 'Salim Khan', licence: 'RJ14 2018 0005678' },
      ],
    },
  ],
  recordTypes: [
    rt('consignment', 'Consignment note', 'Consignment notes', 'CN', 'package', {
      fields: [
        req('consignor', 'Consignor'),
        req('consignee', 'Consignee'),
        req('from', 'From'),
        req('to', 'To'),
        rep('packages', 'Packages', 'number'),
        rep('weight_t', 'Weight (t)', 'number', { required: true }),
        rep('freight', 'Freight (₹)', 'amount', { required: true }),
        rep('vehicle', 'Vehicle', 'master', { master: 'm:@pack/master/vehicles', required: true }),
        f('eway', 'E-way bill no.'),
      ],
      statuses: [
        st('booked', 'Booked', 'info'),
        st('in_transit', 'In transit', 'warn'),
        st('delivered', 'Delivered', 'ok', true),
        st('cancelled', 'Cancelled', 'neutral', true),
      ],
      moves: [
        move('booked', 'load', 'Loaded and left', 'in_transit'),
        move('in_transit', 'deliver', 'Delivered (POD)', 'delivered'),
        move('booked', 'cancel', 'Cancel', 'cancelled', ['approve']),
      ],
    }),
    rt('trip', 'Trip', 'Trips', 'TRIP', 'truck', {
      fields: [
        rep('vehicle', 'Vehicle', 'master', { master: 'm:@pack/master/vehicles', required: true }),
        rep('driver', 'Driver', 'master', { master: 'm:@pack/master/drivers', required: true }),
        req('route', 'Route'),
        rep('start_km', 'Start km', 'number'),
        rep('end_km', 'End km', 'number'),
        rep('km', 'Kilometres', 'formula', { formula: 'end_km - start_km' }),
        rep('advance', 'Advance given (₹)', 'amount'),
      ],
      tables: [
        {
          key: 'expenses',
          label: 'Trip expenses',
          fields: [
            f('kind', 'Expense', 'text', { required: true }),
            f('amount', 'Amount (₹)', 'amount', { required: true }),
            f('bill', 'Bill', 'photo'),
          ],
        },
      ],
      statuses: [
        st('planned', 'Planned', 'info'),
        st('running', 'On the road', 'warn'),
        st('closed', 'Closed', 'ok', true),
      ],
      moves: [
        move('planned', 'start', 'Start the trip', 'running'),
        move('running', 'close', 'Close the trip', 'closed'),
      ],
    }),
  ],
  flows: [
    flow(
      'trip_expense',
      'Trip expense claim',
      'Claim',
      [req('trip', 'Trip'), f('amount', 'Amount claimed (₹)', 'amount', { required: true })],
      [
        task('submit', 'Driver hands in the bills', 24, { proofRequired: true }),
        task('check', 'Supervisor checks them', 24),
        task('pay', 'Accounts settle the claim', 48),
      ],
    ),
  ],
  reports: [byField('freight_by_vehicle', 'Freight by vehicle', 'consignment', 'vehicle', 'freight')],
};
