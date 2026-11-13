// Stage 6: checklists (recurring), delegation tasks in every state, help slips, help tickets, EA board.
import fs from 'node:fs';
import { as, at, dayStr } from './people.mjs';

const ids = JSON.parse(fs.readFileSync(new URL('./ids.json', import.meta.url)));
const U = ids.uid, D = ids.dep, B = ids.br;
const owner = await as('owner');
const step = process.argv[2] ?? 'all';

if (step === 'all' || step === 'checklists') {
  const masters = await owner.get('/api/checklists/masters');
  const list = masters.masters ?? masters;
  const items = (lines) => lines.map((t, i) => {
    const [text, flag] = Array.isArray(t) ? t : [t];
    return { key: `i${i + 1}`, text, ...(flag === 'value' ? { requireValue: true } : flag === 'photo' ? { requirePhoto: true } : {}) };
  });
  const daily = { type: 'daily' };
  const C = [
    ['Restaurant opening', 'F&B Service', 'mur', daily, '11:30', ['pooja'], 'karan', null],
    ['Restaurant closing', 'F&B Service', 'mur', daily, '23:45', ['deepak'], 'imran', null],
    ['Front desk morning', 'Front Office', 'vai', daily, '07:30', ['neha'], 'sneha', null],
    ['Housekeeping morning', 'Housekeeping', 'vai', daily, '08:00', ['kavita'], 'sneha', null],
    ['Bar opening – Sky Bar', 'Bar', 'mur', daily, '16:30', ['aman'], 'imran', ['Ice machine on, ice bins full', ['Garnish prepped (lime, mint, orange)', 'photo'], 'Par stock checked against the par sheet', 'Glassware polished', 'Speed rail set & pourers checked']],
    ['Bar closing & liquor count', 'Bar', 'mur', daily, '23:50', ['joel'], 'aman', [['Open bottles noted in ml', 'value'], 'Excise register entry done in MONO', 'Bar fridge & store locked', 'Keys handed to the duty manager']],
    ['Kitchen hygiene & temperature log', 'Kitchen', 'mur', daily, '11:00', ['vinod'], 'harish', [['Walk-in cold room °C', 'value'], ['Deep freezer °C', 'value'], 'Veg washed in sanitiser', 'Hand-wash station stocked', ['Pest traps checked', 'photo']]],
    ['Washroom & lounge round', 'F&B Service', 'mur', daily, '20:00', ['sonu'], 'deepak', [['Washrooms clean & stocked', 'photo'], 'Smoking area ashtrays changed', 'Lounge sofas & cushions set']],
    ['Rooftop weather & lighting check', 'Maintenance', 'mur', daily, '16:00', ['pappu'], 'bhanwar', ['Heaters / misting fans working', 'Umbrellas & canopy secured', 'Fairy lights & signage on', 'Rain covers ready']],
    ['Valet & parking set-up', 'Security & Valet', 'mur', daily, '18:00', ['ramsingh'], 'karan', ['Valet podium & token book', 'Parking signage out', 'Key box locked']],
    ['Daily sales & cash report', 'Accounts', 'mur', daily, '23:59', ['manish'], 'rakesh', ['POS day closed (Z report)', ['Cash in safe (₹)', 'value'], 'UPI & card settlement matched', 'EazyDiner / District payouts noted']],
    ['Central kitchen dispatch', 'Kitchen', 'ck', daily, '09:30', ['prakash'], 'gopal', ['Gravies & marinades packed and labelled', 'Dispatch transfer made in MONO', ['Van temperature °C', 'value']]],
    ['Weekly kitchen deep clean', 'Kitchen', 'mur', { type: 'weekly', weekday: 1 }, '10:30', ['suresh'], 'harish', ['Exhaust hood degreased', 'Cold room deep cleaned', 'Tandoor cleaned', ['Photos before / after', 'photo']]],
    ['Weekly social media plan', 'Sales & Marketing', 'mur', { type: 'weekly', weekday: 1 }, '12:00', ['simran'], 'aditya', ['3 reels planned', 'Weekend event poster ready', 'Google Business profile updated', 'Replies to all new reviews']],
    ['Monthly fire extinguisher check', 'Maintenance', 'mur', { type: 'monthly', day: 1 }, '11:00', ['bhanwar'], 'rohan', ['All extinguishers in date', 'Fire exits clear', 'Smoke detectors tested']],
    ['Monthly stock audit (top 50 items)', 'Stores', 'ck', { type: 'monthly', day: 'last' }, '18:00', ['gopal'], 'rakesh', ['Count done in MONO (Closing counts)', 'Variance explained', 'Dead stock listed']],
  ];
  for (const [name, dept, br, frequency, dueTime, doers, verifier, lines] of C) {
    const found = list.find((m) => m.name === name);
    const body = {
      name, departmentId: D[dept], branchId: B[br], frequency, dueTime, windowHours: 3, doerIds: doers.map((k) => U[k]),
      verifierId: U[verifier], skipHolidays: false, startDate: dayStr(0), active: true,
      ...(lines ? { items: items(lines) } : {}),
    };
    if (found) await owner.patch(`/api/checklists/masters/${found.id}`, body);
    else await owner.post('/api/checklists/masters', body);
  }
  console.log('checklists ok', C.length);
}

if (step === 'all' || step === 'tasks') {
  // [creator, doer, verifier, due(days, time), text, outcome]
  const T = [
    ['aditya', 'rohan', null, [2, '18:00'], 'Finalise New Year’s Eve rooftop event plan – ticket price, DJ, menu', 'accept'],
    ['aditya', 'simran', 'rohan', [1, '17:00'], 'Tie up with 3 Jaipur food influencers for the winter menu launch', 'accept'],
    ['rohan', 'bhanwar', 'karan', [0, '15:00'], 'Fix the flickering LED strip on the 4th floor bar counter', 'done'],
    ['rohan', 'gopal', 'rohan', [-1, '18:00'], 'Get 3 quotes for a new 2-door bar chiller', 'late'],
    ['rohan', 'harish', 'aditya', [3, '16:00'], 'Winter menu: 4 new soups and 2 hot cocktails for tasting', 'accept'],
    ['karan', 'deepak', 'karan', [0, '19:00'], 'Train the new stewards on upselling cocktails with starters', 'done'],
    ['karan', 'riya', null, [1, '13:00'], 'Call all 12 bookings for Saturday and re-confirm head count', 'pending'],
    ['karan', 'aman', 'karan', [2, '18:00'], 'Make a happy-hours (4–7 pm) cocktail card for the Sky Bar', 'accept'],
    ['harish', 'vinod', 'harish', [-2, '12:00'], 'Standardise the paneer tikka marinade – write the recipe card', 'late'],
    ['harish', 'tenzin', 'harish', [1, '12:00'], 'Trial Burnt Garlic Fried Rice and Chilli Basil Noodles', 'accept'],
    ['rakesh', 'manish', 'rakesh', [0, '23:00'], 'Reconcile EazyDiner payout for last week with POS bills', 'done'],
    ['shalini', 'shalini', null, [4, '17:00'], 'Renew the staff group medical insurance (42 people)', 'pending'],
    ['sneha', 'neha', 'sneha', [1, '11:00'], 'List the hotel on Booking.com and Agoda – photos, rates and policies', 'accept'],
    ['sneha', 'kavita', 'sneha', [0, '17:00'], 'Deep clean rooms 201–206 before the wedding group check-in', 'done'],
    ['vivek', 'priya', 'vivek', [2, '18:00'], 'Send the wedding brochure to 10 planners in Jaipur', 'accept'],
    ['aditya', 'rakesh', 'aditya', [5, '17:00'], 'Prepare the October P&L for both outlets and the hotel', 'pending'],
    ['rohan', 'kunal', 'rohan', [3, '18:00'], 'Malviya Nagar franchise: send the brand audit action plan', 'accept'],
    ['simran', 'yash', 'simran', [-1, '17:00'], 'Pitch the corporate Friday-night package to 15 IT companies in Sitapura', 'late'],
    ['rohan', 'ramsingh', null, [1, '19:00'], 'Arrange 2 extra valet boys for Saturday night', 'pending'],
    ['imran', 'joel', 'aman', [0, '22:00'], 'Clean and descale the coffee machine at the Sky Bar', 'done-verified'],
  ];
  const have = await owner.get('/api/tasks?status=all');
  const existing = new Set((have.tasks ?? have.rows ?? have).map?.((t) => t.description) ?? []);
  for (const [creator, doer, verifier, [d, time], description, outcome] of T) {
    if (existing.has(description)) continue;
    const c = await as(creator);
    let task;
    try {
      task = await c.post('/api/tasks', { doerId: U[doer], plannedAt: at(Math.max(d, 0), d < 0 ? '00:30' : time), ...(verifier ? { verifierId: U[verifier] } : {}), description });
    } catch (e) { console.log('task', description.slice(0, 30), e.message.slice(0, 200)); continue; }
    const id = task.id ?? task.task?.id;
    const doerS = await as(doer);
    const act = (s, a) => s.post(`/api/tasks/${id}/actions`, a).catch((e) => console.log('act', a.action, e.message.slice(0, 160)));
    if (outcome !== 'pending' && creator !== doer) await act(doerS, { action: 'accept' });
    if (outcome === 'late') await act(doerS, { action: 'addFollowUp', note: 'Waiting for the vendor – will close tomorrow' });
    if (outcome.startsWith('done')) await act(doerS, { action: 'markDone', note: 'Done – see note' });
    if (outcome === 'done-verified' && verifier) await act(await as(verifier), { action: 'verify', comment: 'Checked, good' });
  }
  console.log('tasks ok');
}

if (step === 'all' || step === 'slips') {
  const slips = [
    ['karan', 'Saturday nights the rooftop waits 25–30 min for a table and guests leave', ['Take ₹500/head deposits for 6+ guests online', 'Add 4 standing bar tables near the bar counter', 'Start a WhatsApp waitlist with a 15-min call-back'], 'F&B Service'],
    ['harish', 'Tandoor gas cylinder runs out mid-service twice a month', ['Keep one full spare cylinder on a manifold', 'Switch the tandoor to PNG', 'Add a weekly cylinder check to the kitchen checklist'], 'Kitchen'],
    ['neha', 'Late check-outs block rooms for the wedding groups arriving at noon', ['Charge 50% for check-out after 12', 'Offer the lobby lounge with free tea to early arrivals', 'Pre-assign rooms the night before'], 'Front Office'],
  ];
  for (const [who, problem, solutions, dept] of slips) {
    try { await (await as(who)).post('/api/slips', { problem, solutions, departmentId: D[dept] }); } catch (e) { console.log('slip', e.message.slice(0, 200)); }
  }
  const tickets = [
    ['karan', 'POS tablet on the rooftop keeps disconnecting from Wi-Fi', 'Tablet R-2 drops Wi-Fi every 20 min; orders get queued', 'bhanwar', 1],
    ['riya', 'EazyDiner booking not showing in our reservations', 'Booking for Mehta family (6) on Saturday 8 pm came on EazyDiner app only', 'karan', 0],
    ['arjun', 'Room 204 – AC not cooling', 'Guest complained at 11 pm; temporary fan given', 'bhanwar', 0],
    ['manish', 'Card machine printing blank slips', 'HDFC POS paper roll is fine; printer head issue?', 'nitin', 1],
  ];
  for (const [who, title, description, solver, d] of tickets) {
    try { await (await as(who)).post('/api/tickets', { title, description, solverId: U[solver], plannedFixAt: at(d, '20:00') }); } catch (e) { console.log('ticket', e.message.slice(0, 200)); }
  }
  console.log('slips & tickets ok');
}
