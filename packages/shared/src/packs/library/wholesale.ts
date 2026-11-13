import type { PackInput } from '../schema';
import { f, flow, item, req, rights, task } from './kit';

/** A distributor: dealers on their own price list and on credit, orders that move from confirm to dispatch. */
export const wholesalePack: PackInput = {
  key: 'wholesale',
  name: 'Wholesale & distribution',
  version: 1,
  industry: 'wholesale',
  description:
    'Dealers buy on their own price list and on credit. Adds the order-to-dispatch process; receivables and statements come from Money.',
  roles: [
    {
      key: 'order_desk',
      name: 'Order desk',
      permissions: [...rights.everyday, ...rights.work('ims', 'money', 'fms', 'crm')],
    },
    { key: 'dispatch', name: 'Dispatch', permissions: [...rights.everyday, ...rights.work('ims', 'fms')] },
  ],
  taxCodes: [
    { code: 'GST12', name: 'GST 12%' },
    { code: 'GST18', name: 'GST 18%' },
  ],
  items: [
    item('PIPE1', 'PVC pipe 1 inch (6 m)', 'pcs', 'Pipes', {
      hsn: '3917',
      taxCode: 'GST18',
      sellPrice: 420_00,
    }),
    item('ELBOW1', 'Elbow 1 inch', 'pcs', 'Fittings', { hsn: '3917', taxCode: 'GST18', sellPrice: 28_00 }),
    item('TAPE', 'Thread seal tape', 'pcs', 'Fittings', { hsn: '3919', taxCode: 'GST18', sellPrice: 15_00 }),
  ],
  priceLists: [
    {
      key: 'dealers',
      name: 'Dealer price',
      partyKind: 'dealer',
      lines: [
        { code: 'PIPE1', price: 360_00 },
        { code: 'ELBOW1', price: 22_00 },
        { code: 'TAPE', price: 11_00 },
      ],
    },
  ],
  flows: [
    flow(
      'order_to_dispatch',
      'Dealer order to dispatch',
      'Order',
      [
        req('dealer', 'Dealer'),
        f('lines', 'Items', 'items', { required: true }),
        f('promised', 'Promised by', 'date'),
      ],
      [
        task('confirm', 'Confirm the order and the credit limit', 2),
        task('pick', 'Pick and pack', 8, { checklist: ['Quantities counted', 'Packed and labelled'] }),
        task('dispatch', 'Dispatch with the transporter’s receipt', 24, {
          fields: [f('lr_no', 'LR number', 'text', { required: true }), f('transporter', 'Transporter')],
        }),
        task('invoice', 'Invoice sent to the dealer', 4),
      ],
    ),
  ],
};
