import type { FlowField } from '../fms/definition';

/** CLAUDE.md §8 — the Master Library: ready master definitions by industry. Pick one → a master with these fields. */
export const INDUSTRIES = ['manufacturing', 'trading', 'services', 'retail', 'projects'] as const;
export type Industry = (typeof INDUSTRIES)[number];

export type LibraryMaster = {
  key: string;
  name: string;
  description: string;
  industries: Industry[];
  fields: FlowField[];
  keyField: string;
  displayField: string;
};

const f = (
  key: string,
  label: string,
  type: FlowField['type'] = 'text',
  extra: Partial<FlowField> = {},
): FlowField => ({
  key,
  label,
  type,
  required: false,
  ...extra,
});
const req = (key: string, label: string, type: FlowField['type'] = 'text', extra: Partial<FlowField> = {}) =>
  f(key, label, type, { required: true, ...extra });
const ALL: Industry[] = [...INDUSTRIES];

export const MASTER_LIBRARY: LibraryMaster[] = [
  {
    key: 'vendors',
    name: 'Vendors',
    description: 'Who you buy from: contacts, GST and payment terms.',
    industries: ALL,
    keyField: 'code',
    displayField: 'name',
    fields: [
      req('code', 'Vendor code'),
      req('name', 'Vendor name'),
      f('contact', 'Contact person'),
      f('mobile', 'Mobile', 'mobile'),
      f('email', 'Email', 'email'),
      f('gstin', 'GSTIN'),
      f('city', 'City'),
      f('terms', 'Payment terms (days)', 'number'),
      f('supplies', 'What they supply', 'longtext'),
    ],
  },
  {
    key: 'products',
    name: 'Products',
    description: 'What you sell, with its unit, price and HSN code.',
    industries: ['manufacturing', 'trading', 'retail'],
    keyField: 'code',
    displayField: 'name',
    fields: [
      req('code', 'Product code'),
      req('name', 'Product name'),
      f('category', 'Category'),
      f('unit', 'Unit', 'dropdown', { options: ['pcs', 'sqft', 'sqm', 'kg', 'box', 'set'] }),
      f('price', 'List price', 'amount'),
      f('hsn', 'HSN code'),
      f('gst', 'GST %', 'number'),
      f('photo', 'Photo', 'photo'),
    ],
  },
  {
    key: 'raw_materials',
    name: 'Raw materials',
    description: 'What goes into what you make, with its grade and supplier.',
    industries: ['manufacturing'],
    keyField: 'code',
    displayField: 'name',
    fields: [
      req('code', 'Code'),
      req('name', 'Material'),
      f('grade', 'Grade / spec'),
      f('unit', 'Unit', 'dropdown', { options: ['kg', 'ton', 'ltr', 'bag', 'drum'] }),
      f('supplier', 'Main supplier'),
      f('lead', 'Lead time (days)', 'number'),
    ],
  },
  {
    key: 'machines',
    name: 'Machines',
    description: 'Every machine with its make, location and service schedule.',
    industries: ['manufacturing', 'projects'],
    keyField: 'code',
    displayField: 'name',
    fields: [
      req('code', 'Machine no.'),
      req('name', 'Machine'),
      f('make', 'Make / model'),
      f('location', 'Location'),
      f('installed', 'Installed on', 'date'),
      f('service_every', 'Service every (days)', 'number'),
      f('owner', 'Looked after by', 'master', { master: 'people' }),
      f('amc', 'Under AMC', 'yesno'),
    ],
  },
  {
    key: 'spare_parts',
    name: 'Spare parts',
    description: 'Parts kept for the machines, and which machine each fits.',
    industries: ['manufacturing', 'projects'],
    keyField: 'code',
    displayField: 'name',
    fields: [
      req('code', 'Part no.'),
      req('name', 'Part'),
      f('machine', 'Fits machine'),
      f('vendor', 'Vendor'),
      f('min', 'Keep at least', 'number'),
    ],
  },
  {
    key: 'vehicles',
    name: 'Vehicles',
    description: 'Trucks and cars with their papers and when they expire.',
    industries: ['manufacturing', 'trading', 'projects'],
    keyField: 'number',
    displayField: 'number',
    fields: [
      req('number', 'Vehicle number'),
      f('type', 'Type', 'dropdown', { options: ['Truck', 'Trailer', 'Pickup', 'Car', 'Forklift'] }),
      f('driver', 'Driver'),
      f('driver_mobile', 'Driver mobile', 'mobile'),
      f('insurance_till', 'Insurance till', 'date'),
      f('fitness_till', 'Fitness till', 'date'),
      f('permit_till', 'Permit till', 'date'),
      f('puc_till', 'PUC till', 'date'),
    ],
  },
  {
    key: 'sites',
    name: 'Sites',
    description: 'Places you work at or deliver to, with the person there.',
    industries: ['projects', 'services', 'manufacturing'],
    keyField: 'code',
    displayField: 'name',
    fields: [
      req('code', 'Site code'),
      req('name', 'Site'),
      f('address', 'Address', 'longtext'),
      f('city', 'City'),
      f('contact', 'Site contact'),
      f('mobile', 'Mobile', 'mobile'),
      f('location', 'Location', 'location'),
    ],
  },
  {
    key: 'transporters',
    name: 'Transporters',
    description: 'Who carries your goods, their rates and lanes.',
    industries: ['manufacturing', 'trading'],
    keyField: 'name',
    displayField: 'name',
    fields: [
      req('name', 'Transporter'),
      f('contact', 'Contact person'),
      f('mobile', 'Mobile', 'mobile'),
      f('gstin', 'GSTIN'),
      f('lanes', 'Lanes / cities', 'longtext'),
      f('rate', 'Rate per ton (₹)', 'amount'),
    ],
  },
  {
    key: 'services',
    name: 'Services',
    description: 'What you offer, how long it takes and what it costs.',
    industries: ['services', 'projects'],
    keyField: 'code',
    displayField: 'name',
    fields: [
      req('code', 'Service code'),
      req('name', 'Service'),
      f('duration', 'Usual time (hours)', 'number'),
      f('rate', 'Rate', 'amount'),
      f('sac', 'SAC code'),
    ],
  },
  {
    key: 'brands',
    name: 'Brands',
    description: 'Brands you stock, with the distributor and margin.',
    industries: ['trading', 'retail'],
    keyField: 'name',
    displayField: 'name',
    fields: [
      req('name', 'Brand'),
      f('distributor', 'Distributor'),
      f('margin', 'Margin %', 'number'),
      f('credit', 'Credit days', 'number'),
    ],
  },
  {
    key: 'stores',
    name: 'Stores & godowns',
    description: 'Where stock is kept and who runs each place.',
    industries: ['trading', 'retail', 'manufacturing'],
    keyField: 'code',
    displayField: 'name',
    fields: [
      req('code', 'Code'),
      req('name', 'Store / godown'),
      f('city', 'City'),
      f('incharge', 'In charge', 'master', { master: 'people' }),
      f('area', 'Area (sq ft)', 'number'),
    ],
  },
  {
    key: 'documents',
    name: 'Licences & documents',
    description: 'Company papers that expire: licences, certificates, agreements.',
    industries: ALL,
    keyField: 'name',
    displayField: 'name',
    fields: [
      req('name', 'Document'),
      f('number', 'Number'),
      f('issued_by', 'Issued by'),
      f('valid_till', 'Valid till', 'date'),
      f('owner', 'Kept by', 'master', { master: 'people' }),
      f('copy', 'Copy', 'file'),
    ],
  },
];

/** Built-in lists a "from a master" field can also use (the CRM's customers, the IMS items, the people). */
export const BUILT_IN_MASTERS = ['customers', 'items', 'people', 'vendors'] as const;
