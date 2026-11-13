import type { PackInput } from '../schema';
import { ME } from '../schema';
import { byField, f, item, move, pick, rep, req, rights, rt, st } from './kit';

/** A shop: barcodes at the counter, a members' price, returns, the till counted at close. */
export const retailPack: PackInput = {
  key: 'retail',
  name: 'Retail shop',
  version: 1,
  industry: 'retail',
  description:
    'Counter billing by barcode with a members’ price list. Adds customer returns, schemes and the store’s opening and closing checklists.',
  roles: [
    {
      key: 'cashier',
      name: 'Shop cashier',
      permissions: [...rights.everyday, ...rights.work('ims', 'money', 'records')],
    },
    {
      key: 'store_manager',
      name: 'Store manager',
      permissions: [...rights.everyday, ...rights.lead('ims', 'money', 'records'), ...rights.view('reports')],
    },
  ],
  taxCodes: [
    { code: 'GST5', name: 'GST 5%' },
    { code: 'GST12', name: 'GST 12%' },
    { code: 'GST18', name: 'GST 18%' },
  ],
  lists: [{ key: 'list:retail_return_reason', values: ['Wrong size', 'Damaged', 'Changed mind', 'Expired'] }],
  items: [
    item('TEA250', 'Tea 250 g', 'pcs', 'Grocery', {
      barcode: '8902000000017',
      hsn: '0902',
      taxCode: 'GST5',
      sellPrice: 140_00,
    }),
    item('SOAP100', 'Bath soap 100 g', 'pcs', 'Personal care', {
      barcode: '8902000000024',
      hsn: '3401',
      taxCode: 'GST18',
      sellPrice: 45_00,
    }),
    item('BISC200', 'Biscuits 200 g', 'pcs', 'Grocery', {
      barcode: '8902000000031',
      hsn: '1905',
      taxCode: 'GST18',
      sellPrice: 30_00,
    }),
  ],
  priceLists: [
    {
      key: 'members',
      name: 'Members’ price',
      partyKind: 'member',
      lines: [
        { code: 'TEA250', price: 130_00 },
        { code: 'SOAP100', price: 40_00 },
      ],
    },
  ],
  recordTypes: [
    rt('customer_return', 'Customer return', 'Customer returns', 'RET', 'shopping-bag', {
      fields: [
        req('bill_no', 'Bill number'),
        req('item', 'Item'),
        rep('qty', 'Quantity', 'number', { required: true }),
        rep('reason', 'Reason', 'text', { list: 'retail_return_reason', learn: true }),
        pick('settle', 'Settled by', ['Exchange', 'Credit note', 'Refund'], { required: true }),
      ],
      statuses: [
        st('asked', 'Asked', 'warn'),
        st('accepted', 'Accepted', 'ok', true),
        st('refused', 'Refused', 'bad', true),
      ],
      moves: [
        move('asked', 'accept', 'Accept', 'accepted', ['approve']),
        move('asked', 'refuse', 'Refuse', 'refused', ['approve']),
      ],
    }),
    rt('scheme', 'Scheme', 'Schemes', 'SCH', 'star', {
      fields: [
        req('name', 'Scheme'),
        rep('from', 'From', 'date', { required: true }),
        rep('to', 'To', 'date'),
        f('details', 'What the customer gets', 'longtext'),
      ],
      statuses: [
        st('planned', 'Planned', 'info'),
        st('running', 'Running', 'ok'),
        st('ended', 'Ended', 'neutral', true),
      ],
      moves: [move('planned', 'start', 'Start', 'running'), move('running', 'end', 'End', 'ended')],
    }),
  ],
  checklists: [
    {
      key: 'shop_closing',
      name: 'Shop closing',
      input: {
        items: [
          { key: 'a', text: 'Till counted by denomination and the day closed' },
          { key: 'b', text: 'Card and UPI totals matched with the machine' },
          { key: 'c', text: 'Shutters, lights and AC off' },
        ],
        frequency: { type: 'daily' },
        dueTime: '21:30',
        windowHours: 2,
        doerIds: [ME],
        skipHolidays: false,
        startDate: '2026-01-01',
      },
    },
  ],
  reports: [byField('returns_by_reason', 'Returns by reason', 'customer_return', 'reason')],
};
