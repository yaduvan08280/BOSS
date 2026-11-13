// Stage 5: document types + 7 FMS processes for TORA, published, with KPI cards.
import fs from 'node:fs';
import { session } from './api.mjs';

const s = await session(process.env.OWNER_ID, process.env.OWNER_PW);
const ids = JSON.parse(fs.readFileSync(new URL('./ids.json', import.meta.url)));
const U = ids.uid;
const D = ids.dep;

for (const d of [
  { code: 'QUO', name: 'Party / event quotation', prefix: 'QUO', terms: '30% advance confirms the booking. Balance on the event day. Menu final 3 days before.' },
  { code: 'PO', name: 'Purchase order', prefix: 'PO', terms: 'Deliver to the store between 8 am and 11 am. Dairy at ≤ 5 °C. FSSAI label and expiry on every pack.' },
  { code: 'BEO', name: 'Banquet event order', prefix: 'BEO' },
  { code: 'OFR', name: 'Offer letter', prefix: 'OFR' },
]) await s.put('/api/document-types', { ...d, series: 'company' });

const H = (value, anchor = 'previous') => ({ value, unit: 'hours', anchor });
const Dd = (value, anchor = 'previous') => ({ value, unit: 'days', anchor });
const before = (field, value, unit = 'days') => ({ value, unit, anchor: 'dateField', field, before: true });
const f = (key, label, type, more = {}) => ({ key, label, type, ...more });
const dd = (key, label, options, more = {}) => ({ key, label, type: 'dropdown', options, ...more });
// step: [key, name, type, doers[], time, extra]
const step = ([key, name, type, doers, time, extra = {}]) => ({
  key, name, type, doerIds: doers.map((k) => U[k]), ...(type === 'AUTO' ? {} : { time }), ...extra,
});

const FLOWS = [
  {
    meta: { name: 'Party & event booking (Sky Lounge / Rooftop)', runName: 'Party', departmentIds: [D['Sales & Marketing']], coordinatorId: U.simran, solverId: U.rohan,
      description: 'Every birthday, kitty party, corporate night and rooftop buyout — from the first call to the Google review.' },
    start: [
      f('guest', 'Guest / company name', 'text', { required: true }), f('mobile', 'Mobile', 'mobile', { required: true }),
      dd('occasion', 'Occasion', ['Birthday', 'Anniversary', 'Corporate party', 'Kitty party', 'Engagement / Roka', 'Farewell', 'Bachelor party'], { required: true, reportable: true }),
      f('event_date', 'Event date', 'date', { required: true }), f('guests', 'Number of guests', 'number', { required: true, reportable: true }),
      dd('venue', 'Venue', ['Sky Lounge (3rd floor)', 'Rooftop (4th floor)', 'Full rooftop buyout'], { reportable: true }),
      f('budget', 'Budget per head (₹)', 'amount'),
    ],
    steps: [
      ['call', 'Call the guest back and understand the plan', 'TASK', ['simran'], H(1), { checklist: ['Date & time confirmed', 'Head count', 'Veg menu preference', 'Bar / mocktail package?'] }],
      ['quote', 'Send package & quotation', 'TASK', ['yash'], H(4), { documents: ['QUO'], fields: [dd('package', 'Package', ['Rooftop party package ₹1,499', 'Silver ₹950', 'Gold ₹1,250', 'Custom']), f('quoted', 'Quoted amount (₹)', 'amount', { required: true, reportable: true })] }],
      ['follow', 'Follow up for confirmation', 'TASK', ['yash'], H(24)],
      ['won', 'Guest confirmed?', 'DECISION', ['simran'], H(48), { yes: 'advance', no: 'end' }],
      ['advance', 'Collect 30% advance', 'TASK', ['manish'], H(24), { proofRequired: true, fields: [f('advance', 'Advance received (₹)', 'amount', { required: true, reportable: true }), dd('mode', 'Mode', ['UPI', 'Card', 'Cash', 'Bank transfer'])] }],
      ['menu', 'Finalise menu & bar package with the chef', 'TASK', ['harish'], before('event_date', 3), { checklist: ['Allergies noted', 'Cake / special dish', 'Bar package or mocktails only'] }],
      ['decor', 'Book decor, cake, DJ & photographer', 'TASK', ['simran'], before('event_date', 2), { checklist: ['Decor vendor confirmed', 'Cake ordered', 'DJ playlist shared', 'Neon sign / balloons'] }],
      ['brief', 'Team briefing on the event day', 'TASK', ['karan'], before('event_date', 0, 'hours'), { checklist: ['Tables set as per layout', 'Stewards allotted', 'Valet informed', 'Music check'] }],
      ['run', 'Run the event (photos as proof)', 'TASK', ['karan'], H(6), { proofRequired: true }],
      ['settle', 'Final bill settled', 'TASK', ['manish'], H(2), { fields: [f('final', 'Final bill (₹)', 'amount', { reportable: true })] }],
      ['review', 'Ask for a Google review & share photos', 'TASK', ['riya'], H(24), { checklist: ['Google review link sent on WhatsApp', 'Photos posted on Instagram with tag'] }],
    ],
    kpis: [
      { label: 'Parties booked this month', source: 'count', aggregation: 'COUNT', period: 'MONTH' },
      { label: 'Guests this month', source: 'start:guests', aggregation: 'TOTAL', period: 'MONTH' },
      { label: 'Advance collected (month)', source: 'step:advance:advance', aggregation: 'TOTAL', period: 'MONTH' },
    ],
  },
  {
    meta: { name: 'Kitchen purchase – indent to payment', runName: 'Indent', departmentIds: [D.Purchase, D.Stores], coordinatorId: U.nitin, solverId: U.gopal,
      description: 'An outlet asks for stock; the central store issues it, or Purchase buys it with an approved PO, checks it in and pays the vendor.' },
    start: [
      dd('outlet', 'For which outlet', ['Murlipura (Sky Lounge + Rooftop)', 'Vaishali (Café + Banquets)', 'Malviya Nagar (franchise)', 'Central kitchen'], { required: true, reportable: true }),
      f('lines', 'Items needed', 'items', { required: true }), f('needed_by', 'Needed by', 'date', { required: true }),
      dd('urgency', 'Urgency', ['Normal', 'Urgent (today)', 'For a banquet / party'], { reportable: true }),
    ],
    steps: [
      ['check', 'In stock at the central store?', 'DECISION', ['gopal'], H(2), { yes: 'issue', no: 'po' }],
      ['po', 'Raise purchase order to the vendor', 'TASK', ['nitin'], H(4), { documents: ['PO'], fields: [f('vendor', 'Vendor', 'master', { master: 'vendors' }), f('po_value', 'PO value (₹)', 'amount', { reportable: true })] }],
      ['approve', 'PO approval (GM)', 'APPROVAL', ['rohan'], H(4), { rejectTo: 'po' }],
      ['deliver', 'Vendor delivers', 'OUTSIDE', ['nitin'], H(24)],
      ['grn', 'Receive & quality check (GRN)', 'TASK', ['gopal'], H(2), { proofRequired: true, checklist: ['Weight / count checked', 'Dairy at ≤ 5 °C', 'FSSAI label & expiry checked', 'Rejected items sent back'] }],
      ['issue', 'Issue to the outlet (transfer)', 'TASK', ['gopal'], H(4), { checklist: ['Transfer made in MONO', 'Outlet signed the challan'] }],
      ['bill', 'Vendor bill to accounts', 'TASK', ['rakesh'], H(48), { next: 'pay' }],
      ['pay', 'Payment released', 'OUTSIDE', ['rakesh'], Dd(7)],
    ],
    kpis: [{ label: 'Indents this month', source: 'count', aggregation: 'COUNT', period: 'MONTH' }, { label: 'PO value (month)', source: 'step:po:po_value', aggregation: 'TOTAL', period: 'MONTH' }],
  },
  {
    meta: { name: 'Guest complaint & review recovery', runName: 'Complaint', departmentIds: [D.Operations, D['F&B Service']], coordinatorId: U.rohan, solverId: U.aditya,
      description: 'A bad review or a complaint at the table becomes a tracked case: acknowledged in an hour, root cause, fix, the guest won back, and a reply on the platform.' },
    start: [
      f('guest', 'Guest name', 'text', { required: true }), f('mobile', 'Mobile', 'mobile'),
      dd('source', 'Where it came from', ['Google review', 'Zomato', 'EazyDiner', 'District', 'Instagram', 'At the table', 'Phone call'], { required: true, reportable: true }),
      f('rating', 'Rating given (1–5)', 'number'), dd('outlet', 'Outlet', ['Sky Lounge', 'Rooftop', 'Tora Café', 'Banquets', 'Hotel'], { reportable: true }),
      f('complaint', 'What the guest said', 'longtext', { required: true }),
    ],
    steps: [
      ['ack', 'Call & acknowledge the guest', 'TASK', ['riya'], H(1)],
      ['why', 'Find the root cause', 'TASK', ['karan'], H(4), { fields: [dd('cause', 'Root cause', ['Food quality', 'Slow service', 'Staff behaviour', 'Billing error', 'Music / ambience', 'Cleanliness', 'Pricing'], { required: true, reportable: true }), f('detail', 'What happened', 'longtext')] }],
      ['fix', 'Corrective action in the team', 'TASK', ['karan'], H(24), { checklist: ['Team briefed', 'SOP / checklist updated if needed'] }],
      ['recover', 'Win the guest back (call + voucher)', 'TASK', ['imran'], H(24), { fields: [f('voucher', 'Voucher given (₹)', 'amount', { reportable: true })] }],
      ['reply', 'Reply on the review platform', 'TASK', ['simran'], H(24), { proofRequired: true }],
      ['happy', 'Guest happy now?', 'DECISION', ['rohan'], H(48), { yes: 'end', no: 'recover' }],
    ],
    kpis: [{ label: 'Complaints this month', source: 'count', aggregation: 'COUNT', period: 'MONTH' }, { label: 'Average rating given', source: 'start:rating', aggregation: 'AVERAGE', period: 'MONTH' }],
  },
  {
    meta: { name: 'New dish / cocktail launch', runName: 'Dish', departmentIds: [D.Kitchen, D.Bar], coordinatorId: U.harish, solverId: U.rohan,
      description: 'From idea to the POS: trials, costing (food cost under 30%), tasting by the director, photos, menu and online listings.' },
    start: [f('dish', 'Dish / drink name', 'text', { required: true }), dd('category', 'Menu section', ['Sky Bites (starters)', 'Mains', 'Desserts', 'Signature cocktails', 'Mocktails & soft drinks'], { reportable: true }), f('concept', 'Concept', 'longtext'), f('price', 'Target price (₹)', 'amount')],
    steps: [
      ['trial', 'Recipe trials (3 rounds)', 'TASK', ['vinod'], Dd(3), { proofRequired: true, fields: [f('recipe', 'Final recipe notes', 'longtext', { required: true })] }],
      ['cost', 'Costing in MONO (recipe)', 'TASK', ['gopal'], Dd(1), { checklist: ['Recipe saved in Inventory → Recipes', 'Food cost ≤ 30% of price'] }],
      ['taste', 'Tasting by the director', 'APPROVAL', ['aditya'], Dd(2), { rejectTo: 'trial' }],
      ['shoot', 'Photo shoot for menu & Instagram', 'TASK', ['simran'], Dd(3), { proofRequired: true }],
      ['pos', 'Add to POS menu & kitchen routing', 'TASK', ['karan'], Dd(1)],
      ['brief', 'Staff briefing & upselling line', 'TASK', ['imran'], Dd(1)],
      ['online', 'Update Zomato / EazyDiner / District menus', 'TASK', ['simran'], Dd(2)],
    ],
    kpis: [{ label: 'Dishes launched (FY)', source: 'count', aggregation: 'COUNT', period: 'FY' }],
  },
  {
    meta: { name: 'New staff joining', runName: 'Joiner', departmentIds: [D['HR & Admin']], coordinatorId: U.shalini, solverId: U.rohan,
      description: 'Documents, police verification, uniform, MONO login, food-safety training, buddy shifts and a 30-day review for every new joiner.' },
    start: [f('name', 'Name', 'text', { required: true }), f('mobile', 'Mobile', 'mobile', { required: true }), dd('position', 'Position', ['Steward', 'Captain', 'Commis', 'Bartender', 'Room attendant', 'Cashier', 'Valet'], { reportable: true }), dd('branch', 'Branch', ['Murlipura', 'Vaishali Nagar', 'Central kitchen', 'Malviya Nagar']), f('joining', 'Joining date', 'date', { required: true })],
    steps: [
      ['offer', 'Offer letter sent', 'TASK', ['shalini'], H(24), { documents: ['OFR'] }],
      ['docs', 'Collect documents', 'TASK', ['shalini'], before('joining', 1), { checklist: ['Aadhaar', 'PAN', 'Bank passbook', '2 photos', 'Medical fitness'] }],
      ['police', 'Police verification submitted', 'TASK', ['shalini'], Dd(2), { proofRequired: true }],
      ['uniform', 'Uniform, locker & ID card', 'TASK', ['gopal'], Dd(1)],
      ['login', 'MONO login + Telegram linked', 'TASK', ['shalini'], H(4)],
      ['fssai', 'Food safety & hygiene training', 'TASK', ['harish'], Dd(3), { proofRequired: true }],
      ['buddy', 'Three buddy shifts with a senior', 'TASK', ['karan'], Dd(3)],
      ['review', '30-day review', 'APPROVAL', ['rohan'], Dd(30)],
    ],
    kpis: [{ label: 'Joiners this month', source: 'count', aggregation: 'COUNT', period: 'MONTH' }],
  },
  {
    meta: { name: 'Banquet & wedding booking (Vaishali)', runName: 'Event', departmentIds: [D['Banquets & Events']], coordinatorId: U.vivek, solverId: U.sneha,
      description: 'Weddings, receptions and conferences at Tora Stays & Banquets — site visit, proposal, advance, BEO, vendors, the day itself and the settlement.' },
    start: [f('client', 'Client / company', 'text', { required: true }), f('mobile', 'Mobile', 'mobile', { required: true }), dd('type', 'Event type', ['Wedding', 'Reception', 'Engagement', 'Corporate conference', 'Birthday', 'Social gathering'], { required: true, reportable: true }), f('event_date', 'Event date', 'date', { required: true }), f('guests', 'Expected guests', 'number', { reportable: true }), dd('hall', 'Hall', ['Tora Grand Ballroom', 'Terrace Lawn', 'Board Room'])],
    steps: [
      ['visit', 'Site visit & hall show', 'TASK', ['priya'], Dd(2)],
      ['proposal', 'Send proposal', 'TASK', ['priya'], Dd(1), { documents: ['QUO'], fields: [f('value', 'Proposal value (₹)', 'amount', { required: true, reportable: true })] }],
      ['nego', 'Negotiate & follow up', 'TASK', ['vivek'], Dd(3)],
      ['won', 'Booking confirmed?', 'DECISION', ['vivek'], Dd(7), { yes: 'advance', no: 'end' }],
      ['advance', '30% advance received', 'TASK', ['rakesh'], Dd(2), { proofRequired: true, fields: [f('advance', 'Advance (₹)', 'amount', { required: true, reportable: true })] }],
      ['beo', 'BEO made & sent to all departments', 'TASK', ['vivek'], before('event_date', 7), { documents: ['BEO'] }],
      ['vendors', 'Vendors confirmed (decor, DJ, photographer)', 'TASK', ['vivek'], before('event_date', 5)],
      ['indent', 'Kitchen indent raised', 'TASK', ['harish'], before('event_date', 3)],
      ['setup', 'Hall set-up & checklist', 'TASK', ['kavita'], before('event_date', 0, 'hours'), { proofRequired: true }],
      ['event', 'Event done', 'TASK', ['vivek'], H(8)],
      ['settle', 'Final settlement', 'TASK', ['rakesh'], Dd(2)],
      ['feedback', 'Feedback & testimonial', 'TASK', ['priya'], Dd(3)],
    ],
    kpis: [{ label: 'Events this month', source: 'count', aggregation: 'COUNT', period: 'MONTH' }, { label: 'Proposal value (month)', source: 'step:proposal:value', aggregation: 'TOTAL', period: 'MONTH' }],
  },
  {
    meta: { name: 'Equipment breakdown', runName: 'Breakdown', departmentIds: [D.Maintenance], coordinatorId: U.bhanwar, solverId: U.rohan,
      description: 'A cold room, tandoor, AC or sound system stops — inspected in an hour, fixed in-house or by the AMC vendor, and confirmed by the user.' },
    start: [dd('equipment', 'Equipment', ['Walk-in cold room', 'Deep freezer', 'Tandoor', 'Kitchen exhaust', 'Bar chiller', 'AC – Lounge', 'Sound system', 'Lift', 'Generator'], { required: true, reportable: true }), dd('branch', 'Branch', ['Murlipura', 'Vaishali Nagar', 'Central kitchen', 'Malviya Nagar'], { required: true }), f('issue', 'What is wrong', 'longtext', { required: true }), f('photo', 'Photo', 'photo')],
    steps: [
      ['inspect', 'Inspect', 'TASK', ['pappu'], H(1)],
      ['inhouse', 'Can we fix it in-house?', 'DECISION', ['bhanwar'], H(2), { yes: 'fix', no: 'vendor' }],
      ['fix', 'Fix in-house', 'TASK', ['pappu'], H(4), { proofRequired: true, next: 'confirm' }],
      ['vendor', 'Call the AMC vendor', 'TASK', ['bhanwar'], H(4)],
      ['repair', 'Vendor repairs', 'OUTSIDE', ['bhanwar'], H(24), { fields: [f('cost', 'Repair cost (₹)', 'amount', { reportable: true })] }],
      ['bill', 'Approve the repair bill', 'APPROVAL', ['rohan'], H(4)],
      ['confirm', 'User confirms it works', 'TASK', ['karan'], H(2)],
    ],
    kpis: [{ label: 'Breakdowns this month', source: 'count', aggregation: 'COUNT', period: 'MONTH' }, { label: 'Repair cost (month)', source: 'step:repair:cost', aggregation: 'TOTAL', period: 'MONTH' }],
  },
];

const have = await s.get('/api/fms/flows');
const list = have.flows ?? have;
ids.flow = {};
for (const fl of FLOWS) {
  const definition = { timeModel: 'calendar', startFields: fl.start, steps: fl.steps.map(step) };
  let found = list.find((x) => x.name === fl.meta.name);
  let id = found?.id;
  if (!id) id = (await s.post('/api/fms/flows', { meta: fl.meta, definition })).id;
  else await s.put(`/api/fms/flows/${id}`, { meta: fl.meta, definition });
  try { await s.post(`/api/fms/flows/${id}/publish`); } catch (e) { console.log('publish', fl.meta.name, e.message.slice(0, 400)); }
  try { await s.put(`/api/fms/flows/${id}/kpis`, fl.kpis); } catch (e) { console.log('kpis', fl.meta.name, e.message.slice(0, 300)); }
  ids.flow[fl.meta.runName] = id;
}
console.log('flows ok', Object.keys(ids.flow).length);
fs.writeFileSync(new URL('./ids.json', import.meta.url), JSON.stringify(ids, null, 1));
