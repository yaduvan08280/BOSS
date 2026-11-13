import type { PackInput } from '../schema';
import { byField, f, flow, item, move, rep, req, rights, rt, st, task } from './kit';

/** A contractor: projects, a bill of quantities, material at the site, running bills to the client, subcontractors' bills. */
export const constructionPack: PackInput = {
  key: 'construction',
  name: 'Construction',
  version: 1,
  industry: 'construction',
  description:
    'Projects with a bill of quantities, material received and used at the site, running bills to the client and subcontractors’ work orders.',
  roles: [
    {
      key: 'site_engineer',
      name: 'Site engineer',
      permissions: [...rights.everyday, ...rights.work('ims', 'records', 'fms')],
    },
    {
      key: 'project_manager',
      name: 'Project manager',
      permissions: [
        ...rights.everyday,
        ...rights.lead('ims', 'records', 'fms'),
        ...rights.view('money', 'reports'),
      ],
    },
  ],
  taxCodes: [
    { code: 'WORKS18', name: 'GST on works contracts' },
    { code: 'GST28', name: 'GST 28%' },
  ],
  items: [
    item('CEMENT', 'Cement (50 kg bag)', 'bag', 'Material', { hsn: '2523', taxCode: 'GST28' }),
    item('STEEL', 'TMT steel', 'kg', 'Material', { hsn: '7214' }),
    item('SAND', 'River sand', 'cft', 'Material', { hsn: '2505' }),
  ],
  recordTypes: [
    rt('project', 'Project', 'Projects', 'PRJ', 'building', {
      fields: [
        req('name', 'Project', 'text', { unique: true }),
        req('client', 'Client'),
        f('site', 'Site address', 'longtext'),
        rep('value', 'Contract value (₹)', 'amount', { required: true }),
        rep('start', 'Start', 'date'),
        rep('finish', 'Finish by', 'date'),
      ],
      tables: [
        {
          key: 'boq',
          label: 'Bill of quantities',
          fields: [
            f('item', 'Item of work', 'text', { required: true }),
            f('unit', 'Unit'),
            f('qty', 'Quantity', 'number', { required: true }),
            f('rate', 'Rate (₹)', 'amount', { required: true }),
            f('amount', 'Amount (₹)', 'formula', { formula: 'qty * rate' }),
          ],
        },
      ],
      statuses: [
        st('awarded', 'Awarded', 'info'),
        st('running', 'Running', 'ok'),
        st('handed_over', 'Handed over', 'neutral', true),
      ],
      moves: [
        move('awarded', 'start', 'Start work', 'running'),
        move('running', 'hand_over', 'Hand over', 'handed_over', ['approve']),
      ],
    }),
    rt('running_bill', 'Running bill', 'Running bills', 'RA', 'receipt', {
      fields: [
        rep('project', 'Project', 'master', { master: 'rt:@pack/rt/project', required: true }),
        req('bill_no', 'RA bill number', 'text', { unique: true }),
        rep('upto', 'Work done up to', 'date', { required: true }),
        rep('percent', 'Work done so far (%)', 'number', { required: true }),
        rep('amount', 'This bill (₹)', 'amount', { required: true }),
        f('measurements', 'Measurement sheet', 'file'),
      ],
      statuses: [
        st('measured', 'Measured', 'info'),
        st('certified', 'Certified', 'warn'),
        st('invoiced', 'Invoiced', 'ok', true),
        st('rejected', 'Rejected', 'bad', true),
      ],
      moves: [
        move('measured', 'certify', 'Certify', 'certified', ['approve']),
        move('measured', 'reject', 'Send back', 'rejected', ['approve']),
        move('certified', 'invoice', 'Invoice raised', 'invoiced'),
      ],
    }),
    rt('work_order', 'Subcontract work order', 'Subcontract work orders', 'WO', 'hammer', {
      fields: [
        rep('project', 'Project', 'master', { master: 'rt:@pack/rt/project', required: true }),
        req('subcontractor', 'Subcontractor'),
        req('work', 'Work'),
        rep('value', 'Value (₹)', 'amount', { required: true }),
      ],
      statuses: [
        st('issued', 'Issued', 'info'),
        st('done', 'Work done', 'ok', true),
        st('cancelled', 'Cancelled', 'neutral', true),
      ],
      moves: [
        move('issued', 'finish', 'Work done', 'done', ['approve']),
        move('issued', 'cancel', 'Cancel', 'cancelled', ['approve']),
      ],
    }),
  ],
  flows: [
    flow(
      'running_bill',
      'Running bill to the client',
      'Bill',
      [req('project', 'Project'), req('bill_no', 'RA bill number')],
      [
        task('measure', 'Site engineer measures the work', 24),
        task('certify', 'Project manager certifies', 24),
        task('invoice', 'Accounts raise the invoice', 8),
      ],
    ),
  ],
  reports: [byField('ra_by_project', 'Running bills by project', 'running_bill', 'project', 'amount')],
};
