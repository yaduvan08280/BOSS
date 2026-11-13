import type { PackInput } from '../schema';
import { byField, f, flow, item, move, pick, register, rep, req, rights, rt, st, task } from './kit';

/** A mine: ore by the tonne, the weighbridge slip, the royalty-pass register, dispatches. */
export const miningPack: PackInput = {
  key: 'mining',
  name: 'Mining',
  version: 1,
  industry: 'mining',
  description:
    'Ore produced and sold by the tonne, weighbridge slips, the royalty-pass register and the dispatch process from loading to the gate.',
  roles: [
    {
      key: 'weighbridge',
      name: 'Weighbridge operator',
      permissions: [...rights.everyday, ...rights.work('records', 'ims', 'fms')],
    },
    {
      key: 'mine_manager',
      name: 'Mine manager',
      permissions: [
        ...rights.everyday,
        ...rights.lead('records', 'ims', 'fms'),
        ...rights.view('money', 'reports'),
      ],
    },
  ],
  taxCodes: [{ code: 'MIN5', name: 'GST on minerals' }],
  items: [
    item('QTZLUMP', 'Quartz lumps', 't', 'Mineral', { hsn: '2506', taxCode: 'MIN5', sellPrice: 1800_00 }),
    item('DIESEL', 'Diesel', 'ltr', 'Consumable', { hsn: '2710' }),
  ],
  recordTypes: [
    rt('weigh_slip', 'Weighbridge slip', 'Weighbridge slips', 'WB', 'tractor', {
      fields: [
        req('vehicle', 'Vehicle number'),
        pick('mineral', 'Mineral', ['Quartz', 'Feldspar', 'Silica sand'], { required: true }),
        rep('gross_t', 'Gross (t)', 'number', { required: true }),
        rep('tare_t', 'Tare (t)', 'number', { required: true }),
        rep('net_t', 'Net (t)', 'formula', { formula: 'gross_t - tare_t' }),
      ],
      statuses: [
        st('weighed', 'Weighed', 'info'),
        st('gone', 'Left the gate', 'ok', true),
        st('cancelled', 'Cancelled', 'neutral', true),
      ],
      moves: [
        move('weighed', 'gate_out', 'Gate out', 'gone'),
        move('weighed', 'cancel', 'Cancel', 'cancelled', ['approve']),
      ],
    }),
    rt('royalty_pass', 'Royalty pass', 'Royalty passes', 'RP', 'file-text', {
      fields: [
        req('pass_no', 'Pass number', 'text', { unique: true }),
        req('vehicle', 'Vehicle number'),
        pick('mineral', 'Mineral', ['Quartz', 'Feldspar', 'Silica sand'], { required: true }),
        rep('weight_t', 'Weight (t)', 'number', { required: true }),
        req('destination', 'Destination'),
        rep('issued_on', 'Issued on', 'date'),
      ],
      statuses: [
        st('issued', 'Issued', 'info'),
        st('used', 'Used', 'ok', true),
        st('cancelled', 'Cancelled', 'neutral', true),
      ],
      moves: [
        move('issued', 'use', 'Used for a dispatch', 'used'),
        move('issued', 'cancel', 'Cancel', 'cancelled', ['approve']),
      ],
    }),
  ],
  flows: [
    flow(
      'dispatch',
      'Mine dispatch',
      'Dispatch',
      [req('vehicle', 'Vehicle number'), req('buyer', 'Buyer'), f('mineral', 'Mineral')],
      [
        task('load', 'Load the vehicle', 2),
        task('weigh', 'Weighbridge slip', 1),
        task('pass', 'Royalty pass issued', 1),
        task('gate', 'Gate out', 1),
      ],
    ),
  ],
  reports: [
    register('royalty_register', 'Royalty-pass register', 'royalty_pass', [
      'code',
      'pass_no',
      'vehicle',
      'mineral',
      'weight_t',
      'destination',
      'created',
    ]),
    byField('tonnes_by_mineral', 'Tonnes dispatched by mineral', 'royalty_pass', 'mineral', 'weight_t'),
  ],
};
