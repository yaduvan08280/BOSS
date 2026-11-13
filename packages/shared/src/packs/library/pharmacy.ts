import type { PackInput } from '../schema';
import { f, flow, item, move, pick, register, rep, req, rights, rt, st, task, byField } from './kit';

/** A chemist's shop: batches with expiry, first-expired-first-out at the counter, prescriptions, the Schedule H register, expiry returns. */
export const pharmacyPack: PackInput = {
  key: 'pharmacy',
  name: 'Pharmacy',
  version: 1,
  industry: 'pharmacy',
  description:
    'Medicines by batch and expiry, sold first-expired-first-out at the counter. Adds prescriptions, the Schedule H register and returns of near-expiry stock to the distributor.',
  roles: [
    {
      key: 'pharmacist',
      name: 'Pharmacist',
      permissions: [
        ...rights.everyday,
        ...rights.lead('ims', 'records'),
        ...rights.work('money'),
        ...rights.view('reports'),
      ],
    },
    {
      key: 'counter',
      name: 'Counter staff',
      permissions: [...rights.everyday, ...rights.work('ims', 'records', 'money')],
    },
  ],
  taxCodes: [
    { code: 'MED5', name: 'GST on medicines (lower slab)' },
    { code: 'MED12', name: 'GST on medicines' },
    { code: 'MED18', name: 'GST on other goods' },
  ],
  lists: [
    {
      key: 'list:pharma_return_reason',
      values: ['Near expiry', 'Expired', 'Damaged strip', 'Recalled batch'],
    },
  ],
  masters: [
    {
      key: 'doctors',
      name: 'Doctors',
      description: 'Who writes the prescriptions you dispense.',
      fields: [
        f('code', 'Code', 'text', { required: true }),
        f('name', 'Name', 'text', { required: true }),
        f('reg_no', 'Registration no.'),
        f('mobile', 'Mobile', 'mobile'),
      ],
      keyField: 'code',
      displayField: 'name',
      rows: [
        { code: 'DR1', name: 'Dr S. Mehta', reg_no: 'RMC 12345' },
        { code: 'DR2', name: 'Dr A. Khan', reg_no: 'RMC 67890' },
      ],
    },
  ],
  items: [
    item('PCM500', 'Paracetamol 500 mg (strip of 10)', 'strip', 'OTC', {
      tracking: 'BATCH',
      hsn: '30049099',
      taxCode: 'MED12',
      sellPrice: 30_00,
      barcode: '8901000000011',
    }),
    item('AZI500', 'Azithromycin 500 mg (strip of 3)', 'strip', 'Schedule H', {
      tracking: 'BATCH',
      hsn: '30042019',
      taxCode: 'MED12',
      sellPrice: 120_00,
      barcode: '8901000000028',
    }),
    item('ORS', 'ORS sachet', 'pcs', 'OTC', {
      tracking: 'BATCH',
      hsn: '30049099',
      taxCode: 'MED5',
      sellPrice: 22_00,
      barcode: '8901000000035',
    }),
  ],
  recordTypes: [
    rt('prescription', 'Prescription', 'Prescriptions', 'RX', 'pill', {
      fields: [
        req('patient', 'Patient'),
        rep('doctor', 'Doctor', 'master', { master: 'm:@pack/master/doctors', required: true }),
        req('medicine', 'Medicine'),
        rep('qty', 'Quantity', 'number', { required: true }),
        pick('schedule', 'Schedule', ['None', 'Schedule H', 'Schedule H1', 'Schedule X'], {
          required: true,
        }),
        rep('rx_date', 'Prescription date', 'date'),
        f('rx_photo', 'Photo of the prescription', 'photo'),
      ],
      statuses: [
        st('received', 'Received', 'info'),
        st('dispensed', 'Dispensed', 'ok', true),
        st('cancelled', 'Cancelled', 'neutral', true),
      ],
      moves: [
        move('received', 'dispense', 'Mark dispensed', 'dispensed'),
        move('received', 'cancel', 'Cancel', 'cancelled'),
      ],
    }),
    rt('expiry_return', 'Expiry return', 'Expiry returns', 'ER', 'truck', {
      fields: [
        req('vendor', 'Distributor'),
        req('medicine', 'Medicine'),
        req('batch', 'Batch'),
        rep('qty', 'Quantity', 'number', { required: true }),
        rep('reason', 'Reason', 'text', { list: 'pharma_return_reason', learn: true }),
      ],
      statuses: [st('raised', 'Raised', 'warn'), st('returned', 'Returned', 'ok', true)],
      moves: [move('raised', 'return', 'Mark returned', 'returned')],
    }),
  ],
  flows: [
    flow(
      'expiry_return',
      'Expiry return to the distributor',
      'Return',
      [req('vendor', 'Distributor'), req('medicine', 'Medicine and batch'), f('qty', 'Quantity', 'number')],
      [
        task('pull', 'Pull the stock off the shelf', 4),
        task('pickup', 'Distributor collects it', 72),
        task('credit', 'Credit note received', 168),
      ],
    ),
  ],
  reports: [
    register(
      'schedule_h',
      'Schedule H register',
      'prescription',
      ['code', 'created', 'patient', 'doctor', 'medicine', 'qty'],
      [{ field: 'schedule', op: 'contains', value: 'Schedule' }],
    ),
    byField('rx_by_doctor', 'Prescriptions by doctor', 'prescription', 'doctor'),
  ],
};
