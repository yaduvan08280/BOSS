import type { PackInput } from '../schema';
import { byField, f, item, move, pick, rep, req, rights, rt, st } from './kit';

/** A jeweller: each piece by its own number with weight and purity, priced by the day's gold rate; old gold taken in; certificates. */
export const goldPack: PackInput = {
  key: 'gold_gems',
  name: 'Gold & gems',
  version: 1,
  industry: 'gold and gems',
  description:
    'Every piece tracked by its own number, weight and purity and sold at the day’s rate with making charges. Adds old-gold purchases and piece certificates.',
  roles: [
    {
      key: 'jeweller',
      name: 'Counter jeweller',
      permissions: [...rights.everyday, ...rights.work('ims', 'money', 'records')],
    },
    {
      key: 'stock_keeper',
      name: 'Vault keeper',
      permissions: [...rights.everyday, ...rights.lead('ims'), ...rights.work('records')],
    },
  ],
  taxCodes: [
    { code: 'GOLD3', name: 'GST on gold and jewellery' },
    { code: 'MAKING5', name: 'GST on making charges' },
  ],
  attributes: [
    {
      category: 'Jewellery',
      defs: [
        { key: 'purity', label: 'Purity', type: 'choice', options: ['24K', '22K', '18K', '14K'] },
        { key: 'huid', label: 'HUID', type: 'text' },
        { key: 'stone', label: 'Stone', type: 'text' },
      ],
    },
  ],
  items: [
    item('RING22', 'Gold ring 22K', 'pcs', 'Jewellery', {
      tracking: 'SERIAL',
      secondUnit: 'g',
      pricedBy: 'second',
      rateKey: 'GOLD24',
      rateFactor: 0.916,
      taxCode: 'GOLD3',
      hsn: '7113',
    }),
    item('CHAIN22', 'Gold chain 22K', 'pcs', 'Jewellery', {
      tracking: 'SERIAL',
      secondUnit: 'g',
      pricedBy: 'second',
      rateKey: 'GOLD24',
      rateFactor: 0.916,
      taxCode: 'GOLD3',
      hsn: '7113',
    }),
    item('OLDGOLD', 'Old gold (scrap)', 'g', 'Old gold', { hsn: '7108' }),
  ],
  recordTypes: [
    rt('old_gold', 'Old gold purchase', 'Old gold purchases', 'OG', 'gem', {
      fields: [
        req('customer', 'Customer'),
        f('mobile', 'Mobile', 'mobile'),
        rep('weight_g', 'Net weight (g)', 'number', { required: true }),
        pick('purity', 'Purity', ['24K', '22K', '18K', '14K'], { required: true }),
        rep('rate', 'Rate a gram (₹)', 'amount', { required: true }),
        rep('value', 'Value (₹)', 'formula', { formula: 'weight_g * rate' }),
        f('id_proof', 'ID proof', 'photo'),
      ],
      statuses: [
        st('weighed', 'Weighed', 'info'),
        st('paid', 'Paid / adjusted', 'ok', true),
        st('cancelled', 'Cancelled', 'neutral', true),
      ],
      moves: [
        move('weighed', 'pay', 'Paid or adjusted in a bill', 'paid'),
        move('weighed', 'cancel', 'Cancel', 'cancelled'),
      ],
    }),
    rt('certificate', 'Piece certificate', 'Piece certificates', 'CERT', 'star', {
      fields: [
        req('piece', 'Piece number', 'text', { unique: true }),
        pick('purity', 'Purity', ['24K', '22K', '18K', '14K'], { required: true }),
        rep('weight_g', 'Weight (g)', 'number'),
        f('huid', 'HUID', 'text', { unique: true }),
        f('lab', 'Assaying centre'),
        f('scan', 'Certificate', 'file'),
      ],
      statuses: [st('issued', 'Issued', 'ok'), st('withdrawn', 'Withdrawn', 'neutral', true)],
      moves: [move('issued', 'withdraw', 'Withdraw', 'withdrawn', ['approve'])],
    }),
  ],
  reports: [byField('old_gold_by_purity', 'Old gold bought, by purity', 'old_gold', 'purity', 'weight_g')],
};
