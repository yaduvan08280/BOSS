import type { PackInput } from '../schema';
import { byField, f, flow, item, move, pick, rep, req, rights, rt, st, task } from './kit';

/** A factory: bills of material, production orders that make a batch, a quality check on every batch. */
export const manufacturingPack: PackInput = {
  key: 'manufacturing',
  name: 'Manufacturing',
  version: 1,
  industry: 'manufacturing',
  description:
    'Bills of material, production orders that turn raw material into a batch of finished goods, and a quality check on each batch.',
  roles: [
    {
      key: 'production',
      name: 'Production supervisor',
      permissions: [...rights.everyday, ...rights.lead('ims'), ...rights.work('fms', 'records')],
    },
    {
      key: 'quality',
      name: 'Quality inspector',
      permissions: [...rights.everyday, ...rights.lead('records'), ...rights.view('ims')],
    },
  ],
  taxCodes: [{ code: 'GST18', name: 'GST 18%' }],
  items: [
    item('QTZ', 'Quartz grit', 'kg', 'Raw material', { tracking: 'BATCH', hsn: '2506' }),
    item('RESIN', 'Polyester resin', 'kg', 'Raw material', {
      tracking: 'BATCH',
      hsn: '3907',
      shelfLifeDays: 180,
    }),
    item('SLAB20', 'Quartz slab 20 mm', 'pcs', 'Finished goods', {
      tracking: 'BATCH',
      made: 'MAKE',
      hsn: '6810',
      taxCode: 'GST18',
      sellPrice: 9500_00,
    }),
  ],
  recipes: [
    {
      code: 'SLAB20',
      outputQty: 1,
      lines: [
        { code: 'QTZ', qty: 90 },
        { code: 'RESIN', qty: 10 },
      ],
    },
  ],
  recordTypes: [
    rt('quality_check', 'Quality check', 'Quality checks', 'QC', 'clipboard-list', {
      fields: [
        req('batch', 'Batch / production order'),
        req('item', 'Item'),
        rep('checked', 'Pieces checked', 'number', { required: true }),
        rep('rejected', 'Pieces rejected', 'number'),
        pick('result', 'Result', ['Pass', 'Rework', 'Reject'], { required: true }),
        f('defects', 'Defects seen', 'longtext'),
        f('photo', 'Photo', 'photo'),
      ],
      statuses: [
        st('checked', 'Checked', 'info'),
        st('released', 'Released', 'ok', true),
        st('held', 'Held', 'bad', true),
      ],
      moves: [
        move('checked', 'release', 'Release the batch', 'released', ['approve']),
        move('checked', 'hold', 'Hold the batch', 'held', ['approve']),
      ],
    }),
  ],
  flows: [
    flow(
      'production_order',
      'Production order',
      'Order',
      [
        req('item', 'What to make'),
        f('qty', 'How many', 'number', { required: true }),
        f('needed', 'Needed by', 'date'),
      ],
      [
        task('issue', 'Issue raw material', 2),
        task('press', 'Press and cure', 24),
        task('polish', 'Polish and cut', 12),
        task('qc', 'Quality check', 4, { proofRequired: true }),
        task('store', 'Move to finished goods', 2),
      ],
    ),
  ],
  reports: [byField('qc_by_result', 'Quality checks by result', 'quality_check', 'result')],
};
