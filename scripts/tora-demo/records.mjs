// Stage 7: running FMS records in every process, advanced step by step by the real doers.
import fs from 'node:fs';
import { as, dayStr } from './people.mjs';
import { photo } from './png.mjs';

const ids = JSON.parse(fs.readFileSync(new URL('./ids.json', import.meta.url)));
const byId = Object.fromEntries(Object.entries(ids.uid).map(([k, v]) => [v, k]));
const owner = await as('owner');
const defs = {};
async function def(flowId) {
  if (!defs[flowId]) {
    const f = await owner.get(`/api/fms/flows/${flowId}`);
    defs[flowId] = f.draft;
  }
  return defs[flowId];
}
let seed = 0;
/** Complete the open step `times` times with the given answers (one per step, in order). */
async function advance(recordId, flowId, answers) {
  const d = await def(flowId);
  for (const a of answers) {
    const rec = await owner.get(`/api/fms/records/${recordId}`);
    const open = rec.steps.find((x) => x.status === 'OPEN');
    if (!open) return;
    const sd = d.steps.find((x) => x.key === open.stepKey);
    const who = await as(byId[open.doerId] ?? 'owner');
    const body = { data: a.data ?? {}, checklistDone: sd.checklist ?? [], note: a.note ?? 'Done', ...(a.decision ? { decision: a.decision } : {}) };
    if (sd.proofRequired) body.attachmentIds = [(await who.upload(photo(seed++), `proof-${open.stepKey}.png`)).id];
    try { await who.post(`/api/fms/steps/${open.id}/complete`, body); }
    catch (e) { console.log('complete', open.stepKey, e.message.slice(0, 300)); return; }
  }
}
const titles = new Set();
for (const fid of Object.values(ids.flow)) for (const r of (await owner.get(`/api/fms/live?flowId=${fid}`)).records ?? []) titles.add(r.title);
async function start(flow, starter, data, answers = []) {
  const t = data.guest ?? data.client ?? data.dish ?? data.name ?? data.equipment;
  if (titles.has(t) || (flow === 'Indent' && titles.size && [...titles].some((x) => x.startsWith(data.outlet)))) return null;
  const s = await as(starter);
  const r = await s.post(`/api/fms/flows/${ids.flow[flow]}/records`, { data });
  await advance(r.id, ids.flow[flow], answers);
  return r.id;
}
const ok = (data) => ({ data });
const yes = { decision: 'yes' }, no = { decision: 'no' }, approved = { decision: 'approved' };

// Parties (the first record — Sharma — was started while testing)
const existing = await owner.get(`/api/fms/live?flowId=${ids.flow.Party}`).catch(() => null);
const sharma = (existing?.records ?? []).find?.((r) => r.title?.startsWith('Sharma'));
if (sharma && process.env.SHARMA) await advance(sharma.id, ids.flow.Party, [ok(), ok({ package: 'Rooftop party package ₹1,499', quoted: 37475 }), ok(), yes, ok({ advance: 11250, mode: 'UPI' }), ok()]);
await start('Party', 'simran', { guest: 'Infosys Jaipur – team night', mobile: '+919950012345', occasion: 'Corporate party', event_date: dayStr(9), guests: 60, venue: 'Full rooftop buyout', budget: 1800 }, [ok(), ok({ package: 'Custom', quoted: 132000 })]);
await start('Party', 'riya', { guest: 'Vaishali Ladies Club – kitty party', mobile: '+919414022334', occasion: 'Kitty party', event_date: dayStr(5), guests: 18, venue: 'Sky Lounge (3rd floor)', budget: 950 });
await start('Party', 'simran', { guest: 'Jain family – Roka ceremony', mobile: '+919828033445', occasion: 'Engagement / Roka', event_date: dayStr(20), guests: 80, venue: 'Full rooftop buyout', budget: 2200 });
await start('Party', 'yash', { guest: 'Mehra anniversary dinner', mobile: '+919783044556', occasion: 'Anniversary', event_date: dayStr(1), guests: 12, venue: 'Rooftop (4th floor)', budget: 1500 }, [ok(), ok({ package: 'Gold ₹1,250', quoted: 15000 }), ok(), yes, ok({ advance: 4500, mode: 'Card' })]);
await start('Party', 'simran', { guest: 'SKIT College – farewell', mobile: '+919660055667', occasion: 'Farewell', event_date: dayStr(12), guests: 40, venue: 'Sky Lounge (3rd floor)', budget: 700 }, [ok(), ok({ package: 'Silver ₹950', quoted: 38000 }), ok(), no]);
console.log('parties ok');

// Indents
const line = (code, qty) => { const it = ids.item[code]; return { item: code, itemId: it, qty, rate: 0 }; };
await start('Indent', 'vinod', { outlet: 'Murlipura (Sky Lounge + Rooftop)', lines: [line('DAI-PAN', 15), line('DAI-CRM', 6), line('VEG-MUS', 5)], needed_by: dayStr(1), urgency: 'For a banquet / party' });
await start('Indent', 'aman', { outlet: 'Murlipura (Sky Lounge + Rooftop)', lines: [line('LIQ-BSG', 4500), line('LIQ-JAM', 2250), line('SFT-TON', 48)], needed_by: dayStr(2), urgency: 'Normal' }, [no, ok({ po_value: 48600 })]);
await start('Indent', 'prakash', { outlet: 'Central kitchen', lines: [line('DRY-RIC', 50), line('DRY-OIL', 60), line('DRY-DAL', 20)], needed_by: dayStr(1), urgency: 'Normal' }, [no, ok({ po_value: 19900 }), approved, ok()]);
await start('Indent', 'neha', { outlet: 'Vaishali (Café + Banquets)', lines: [line('HK-AMN', 100), line('HK-TWL', 20)], needed_by: dayStr(0), urgency: 'Urgent (today)' }, [yes, ok()]);
console.log('indents ok');

// Complaints
await start('Complaint', 'riya', { guest: 'Ankit Jain', mobile: '+919001166778', source: 'Google review', rating: 2, outlet: 'Rooftop', complaint: 'Waited 40 minutes for starters on Saturday, staff did not update us.' }, [ok(), ok({ cause: 'Slow service', detail: 'Two stewards on leave, KOT for table R6 printed late' }), ok()]);
await start('Complaint', 'karan', { guest: 'Priyanka S.', mobile: '+919887077889', source: 'Zomato', rating: 3, outlet: 'Sky Lounge', complaint: 'Charged for 2 extra mocktails that we never ordered.' }, [ok(), ok({ cause: 'Billing error', detail: 'Items punched on the wrong table (L4 instead of L7)' }), ok(), ok({ voucher: 500 })]);
await start('Complaint', 'imran', { guest: 'Table L3 guest', source: 'At the table', rating: 3, outlet: 'Sky Lounge', complaint: 'Paneer tikka served cold.' });
console.log('complaints ok');

// Dishes, joiners, banquet events, breakdowns
await start('Dish', 'harish', { dish: 'Smoked Old Fashioned', category: 'Signature cocktails', concept: 'Bourbon-style old fashioned smoked with cinnamon at the table', price: 695 }, [ok({ recipe: '60 ml whisky, 10 ml sugar syrup, 2 dashes bitters, orange peel, cinnamon smoke' }), ok()]);
await start('Dish', 'harish', { dish: 'Truffle Mushroom Dimsum', category: 'Sky Bites (starters)', concept: 'Steamed dimsum with truffle oil and chilli crisp', price: 425 });
await start('Joiner', 'shalini', { name: 'Mukesh Kumar', mobile: '+919001234501', position: 'Steward', branch: 'Murlipura', joining: dayStr(3) }, [ok(), ok()]);
await start('Joiner', 'shalini', { name: 'Anjali Verma', mobile: '+919001234502', position: 'Room attendant', branch: 'Vaishali Nagar', joining: dayStr(7) });
await start('Event', 'priya', { client: 'Agarwal family – wedding reception', mobile: '+919829099001', type: 'Reception', event_date: dayStr(40), guests: 300, hall: 'Tora Grand Ballroom' }, [ok(), ok({ value: 525000 }), ok(), yes, ok({ advance: 157500 })]);
await start('Event', 'vivek', { client: 'TechNova Solutions – annual meet', mobile: '+919950099002', type: 'Corporate conference', event_date: dayStr(12), guests: 120, hall: 'Tora Grand Ballroom' }, [ok(), ok({ value: 210000 })]);
await start('Event', 'priya', { client: 'Gupta family – 50th birthday', mobile: '+919414099003', type: 'Birthday', event_date: dayStr(6), guests: 90, hall: 'Terrace Lawn' }, [ok(), ok({ value: 135000 }), ok(), yes, ok({ advance: 40500 }), ok()]);
await start('Breakdown', 'harish', { equipment: 'Walk-in cold room', branch: 'Murlipura', issue: 'Temperature climbing to 9 °C since morning; compressor making noise' }, [ok(), no, ok()]);
await start('Breakdown', 'imran', { equipment: 'AC – Lounge', branch: 'Murlipura', issue: 'AC near the dance floor dripping water' }, [ok(), yes]);
console.log('records ok');
