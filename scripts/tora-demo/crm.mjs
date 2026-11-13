// Stage 12: Sales CRM — corporate & event customers with order history (for SCOT), payments, leads in the NBD funnel.
import fs from 'node:fs';
import { as, dayStr } from './people.mjs';

const ids = JSON.parse(fs.readFileSync(new URL('./ids.json', import.meta.url)));
const U = ids.uid;
const owner = await as('owner');
const simran = await as('simran'), yash = await as('yash');
const tryit = async (label, fn) => { try { return await fn(); } catch (e) { console.log(label, e.message.slice(0, 300)); } };

const have = await owner.get('/api/crm/customers');
const existing = Object.fromEntries((have.customers ?? have.rows ?? have).map((c) => [c.name, c.id]));
// [name, city, mobile, segment, handledBy, creditDays, every N days, avg ₹, orders in 12 months, what]
const C = [
  ['Infosys Jaipur (SEZ)', 'Jaipur', '+919950012345', 'institution', 'yash', 30, 30, 85000, 9, 'Team nights on the rooftop'],
  ['Genpact Jaipur', 'Jaipur', '+919950012346', 'institution', 'yash', 30, 45, 120000, 6, 'Quarterly offsite dinners'],
  ['Mahindra World City – HR club', 'Jaipur', '+919950012347', 'institution', 'yash', 30, 60, 65000, 5, 'Rewards & recognition evenings'],
  ['Shaadi Sutra Wedding Planners', 'Jaipur', '+919829012348', 'dealer', 'simran', 15, 40, 350000, 6, 'Sangeet & cocktail nights'],
  ['Pink City Events Co.', 'Jaipur', '+919829012349', 'dealer', 'simran', 15, 30, 150000, 8, 'Birthday & theme parties'],
  ['Rajputana Travels (DMC)', 'Jaipur', '+919829012350', 'distributor', 'priya', 21, 20, 95000, 12, 'Hotel rooms + rooftop dinners for tour groups'],
  ['Jaipur Rotary Club (Midtown)', 'Jaipur', '+919829012351', 'institution', 'simran', 7, 30, 45000, 10, 'Monthly fellowship dinner'],
  ['Kotak Mahindra Bank – Vidhyadhar Nagar', 'Jaipur', '+919829012352', 'institution', 'yash', 30, 90, 60000, 3, 'Branch celebrations'],
  ['Vaishali Ladies Club', 'Jaipur', '+919414022334', 'retail', 'riya', 0, 30, 18000, 7, 'Monthly kitty party'],
  ['SKIT College – Student council', 'Jaipur', '+919660055667', 'institution', 'simran', 0, 180, 40000, 2, 'Farewell & fresher parties'],
];
const C2 = {};
for (const [name, city, mobile, segment, by, creditDays] of C) {
  C2[name] = existing[name] ?? (await tryit('cust ' + name, () => owner.post('/api/crm/customers', { name, city, mobile, segment, handledById: U[by], creditDays })))?.id;
}
console.log('customers ok');

// Order history over the last 12 months (only if none yet)
const orders = await owner.get('/api/crm/orders').catch(() => null);
const nOrders = (orders?.orders ?? orders?.rows ?? orders ?? []).length;
if (!nOrders) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (const [name, , , , by, , every, avg, count, what] of C) {
    const who = owner;
    for (let k = count; k >= 1; k--) {
      const d = -Math.round(k * every + rnd() * 4);
      if (d < -150) continue;
      const amount = Math.round(avg * (0.8 + rnd() * 0.4)) * 100;
      await tryit('order', () => who.post('/api/crm/orders', { customerId: C2[name], orderDate: dayStr(d), amount, gp: Math.round(amount * 0.42), items: [{ item: what, qty: 1, rate: amount / 100 }], promisedOn: dayStr(d + 3), note: what }));
    }
  }
  console.log('orders ok');
}

// Leads in the funnel
const L = [
  ['Rohan Agarwal', 'Agarwal Packers & Movers', '+919829033001', 'Website', 'Annual day for 150 staff in January', 300000, 'simran'],
  ['Kavya Sharma', null, '+919829033002', 'Instagram', 'Sangeet night for 120 guests, Feb', 450000, 'simran'],
  ['Manoj Gupta', 'Hotel Clarks partner agent', '+919829033003', 'Reference', 'Room blocks for 4 tour groups a month', 600000, 'priya'],
  ['Sunil Jain', 'JECRC University', '+919829033004', 'Google ads', 'Alumni meet dinner, 200 guests', 280000, 'yash'],
  ['Priyanka Rathore', null, '+919829033005', 'Walk-in', 'Engagement on the rooftop, 70 guests', 160000, 'simran'],
  ['Ankur Mittal', 'Capgemini Jaipur', '+919829033006', 'LinkedIn', 'Friday team dinners every month', 900000, 'yash'],
];
const leads = await owner.get('/api/crm/leads').catch(() => null);
const haveL = new Set((leads?.leads ?? leads?.enquiries ?? []).map((l) => l.name));
for (const [name, company, mobile, source, requirement, value, by] of L) {
  if (haveL.has(name)) continue;
  await tryit('lead ' + name, () => owner.post('/api/crm/leads', { name, ...(company ? { company } : {}), mobile, city: 'Jaipur', source, requirement, value: value * 100, ownerId: U[by] }));
}
console.log('leads ok');
