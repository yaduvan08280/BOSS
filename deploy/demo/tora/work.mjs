import { dayIn, inDays, iso } from './client.mjs';
import { placeholderPng } from './png.mjs';

const proof = (api, name = 'proof.png') => api.upload(placeholderPng(), name, 'image/png');
const act = (api, id, body) => api.post(`/api/tasks/${id}/actions`, body);

/** Who runs each Business Engine module. */
export async function flowSettings(ctx) {
  const { api, ids } = ctx;
  const p = (k) => ids.people[k].id;
  const now = Object.fromEntries((await api.get('/api/engine')).map((m) => [m.module, m.settings]));
  const set = (module, patch) => api.put(`/api/work/settings/${module}`, { ...now[module], ...patch });
  await set('delegation', { eaUserId: p('meera') });
  await set('slip', { receiverUserId: p('arjun'), approverUserId: p('owner') });
  await set('ticket', { coordinatorUserId: p('arjun') });
  await set('ea', { eaUserId: p('meera') });
  return 'EA Meera · slips: Arjun screens, the owner decides · tickets: Arjun coordinates';
}

// who gives, who does, days from today, hour, text, verifier, what then happens
const TASKS = [
  ['owner', 'vikram', 1, 18, 'Finalise the New Year’s Eve terrace layout and cover-charge tiers for the C-Scheme rooftop', null, 'accept'],
  ['owner', 'rohit', 2, 12, 'Send revised corporate dinner proposal to Genpact (120 pax, 19/12) with the live-grill add-on', null, 'accept'],
  ['arjun', 'sanjay', 1, 11, 'Cost the winter tasting menu (8 courses) and share food cost % per plate', 'arjun', 'done'],
  ['arjun', 'girish', -1, 17, 'Close the rate contract with the dairy vendor for paneer, cream and butter for the next quarter', null, 'accept'],
  ['arjun', 'kavita', 3, 15, 'Complete police verification papers for the six stewards who joined in October', null, 'none'],
  ['vikram', 'rahul', 0, 20, 'Train the bar team on the four new signature cocktails; share the recipe cards with photos', 'vikram', 'verified'],
  ['vikram', 'manoj', -2, 16, 'Get the terrace heaters serviced before the weekend and confirm gas stock', null, 'accept'],
  ['vikram', 'pooja', 1, 14, 'Call back the 12 waitlisted guests of Saturday and offer the 7:30 pm seating', null, 'done'],
  ['sanjay', 'imran', 0, 13, 'Standardise the dal makhani recipe card: yield, portion and plating photo', 'sanjay', 'rejected'],
  ['sanjay', 'mohit', 2, 10, 'Label and date every container in the cold room; discard anything past shelf life', 'sanjay', 'accept'],
  ['girish', 'ramesh', 0, 12, 'Physical count of liquor store vs. system for the excise register', 'girish', 'done'],
  ['suresh', 'neha', -1, 12, 'Deposit weekend cash and attach the bank slip', 'suresh', 'verified'],
  ['shalini', 'aman', 1, 9, 'Share arrival list with airport pick-up times for the wedding group checking in on Friday', null, 'accept'],
  ['shalini', 'harish', -3, 15, 'Fix the geyser in room 204 and check the other rooms on the same line', 'shalini', 'moved'],
  ['dinesh', 'lakshmi', 2, 16, 'Prepare 40 extra chair covers and two stage backdrops for the Sharma sangeet', null, 'none'],
  ['rohit', 'ananya', 1, 17, 'Follow up with five wedding planners met at the Jaipur Wedding Expo; log the next action for each', 'rohit', 'accept'],
  ['rohit', 'tanvi', 4, 12, 'Shoot and post the Sunday brunch reel; boost for Jaipur 25–40', null, 'accept'],
  ['priya', 'karan', 0, 19, 'Brief the floor team on the new allergen card and the upsell of the day', null, 'declined'],
  ['priya', 'farhan', 1, 12, 'Share wastage sheet of the week with reasons for the top five items', 'priya', 'accept'],
  ['owner', 'arjun', 5, 11, 'Shortlist two locations for the third Skylounge (Jagatpura / Mansarovar) with rent and footfall', null, 'accept'],
];

export async function tasks(ctx) {
  const { api, ids } = ctx;
  const have = (await api.get('/api/tasks?scope=all&tab=all')).tasks ?? [];
  if (have.some((t) => t.description === TASKS[0][4])) return 'already there';
  for (const [by, doer, days, hour, description, verifier, then] of TASKS) {
    const giver = await ctx.as(by);
    const worker = await ctx.as(doer);
    const t = await giver.post('/api/tasks', {
      doerId: ids.people[doer].id,
      plannedAt: iso(inDays(days, hour)),
      description,
      verifierId: verifier ? ids.people[verifier].id : null,
    });
    if (then === 'none') continue;
    if (then === 'declined') {
      await act(worker, t.id, { action: 'decline', reason: 'On leave tomorrow evening — please give it to the other captain' });
      continue;
    }
    await act(worker, t.id, { action: 'accept' });
    if (then === 'moved') {
      await act(worker, t.id, { action: 'moveDate', plannedAt: iso(inDays(1, 15)), reason: 'Heating element is on order; the vendor delivers tomorrow morning' });
      await act(giver, t.id, { action: 'addFollowUp', note: 'Guest in 204 checks in on Saturday — it must be done before that.' });
    }
    if (['done', 'verified', 'rejected'].includes(then)) {
      await act(worker, t.id, { action: 'addNote', note: 'Started — will share by the evening.' });
      await act(worker, t.id, { action: 'markDone', note: 'Done as discussed. Sheet and photos shared on the group.', attachmentIds: [await proof(worker)] });
      const fresh = await giver.get(`/api/tasks/${t.id}`);
      const status = fresh.task?.status ?? fresh.status;
      if (status === 'PENDING_VERIFY' && then !== 'done') {
        const checker = await ctx.as(verifier ?? by);
        await act(checker, t.id, then === 'verified' ? { action: 'verify', comment: 'Good work.' } : { action: 'reject', comment: 'Plating photo is missing and the yield is not written — please add both.' });
      }
    }
  }
  // One job done by three people one after another (pass on).
  const sales = await ctx.as('rohit');
  const chain = await sales.post('/api/tasks', {
    doerId: ids.people.ananya.id,
    plannedAt: iso(inDays(0, 16)),
    description: 'Sharma wedding (14/12): menu tasting → final menu → kitchen indent',
  });
  await act(await ctx.as('ananya'), chain.id, { action: 'accept' });
  await act(await ctx.as('ananya'), chain.id, { action: 'passOn', doerId: ids.people.dinesh.id, plannedAt: iso(inDays(1, 13)), note: 'Tasting done with the family. They chose the Royal Rajasthani menu with a live chaat counter.' });
  await act(await ctx.as('dinesh'), chain.id, { action: 'accept' });
  await act(await ctx.as('dinesh'), chain.id, { action: 'passOn', doerId: ids.people.sanjay.id, plannedAt: iso(inDays(2, 12)), note: 'Final menu signed by the client. 350 guaranteed covers. Please raise the indent.' });
  return `${TASKS.length + 1} tasks in every state (waiting, accepted, late, to verify, done, sent back, declined, passed on)`;
}

const item = (text, need = {}) => ({ text, requirePhoto: false, requireVoice: false, requireValue: false, ...need });
// name, department, branch, doers, verifier, frequency, due, window h, items
const CHECKLISTS = [
  ['Opening checklist — Skylounge C-Scheme', 'Service', 'sky', ['manoj'], 'vikram', { type: 'daily' }, '16:30', 3, [
    item('Terrace furniture wiped, aligned and cushions placed'),
    item('Lights, heaters and misting fans tested'),
    item('Music system and microphone tested at opening volume'),
    item('Menus and QR stands clean; allergen cards on every table'),
    item('Guest washrooms checked and stocked', { requirePhoto: true }),
    item('POS float counted (write the amount)', { requireValue: true }),
    item('Tonight’s reservations and special requests read out in the briefing'),
  ]],
  ['Closing checklist — Skylounge C-Scheme', 'Service', 'sky', ['manoj'], 'vikram', { type: 'daily' }, '23:45', 3, [
    item('All bills settled; no table left open on the POS'),
    item('Cash counted and handed to the cashier (write the amount)', { requireValue: true }),
    item('Gas valves closed, heaters off'),
    item('Bar locked; liquor stock sheet signed', { requirePhoto: true }),
    item('Terrace lights off, lift lobby locked'),
  ]],
  ['Bar opening — par stock, ice and garnish', 'Bar', 'sky', ['aditya'], 'rahul', { type: 'daily' }, '16:00', 2, [
    item('Par stock of the top 20 bottles checked; requisition raised for the short ones'),
    item('Ice bins filled; ice machine clean'),
    item('Garnish tray cut fresh and labelled'),
    item('Glassware polished; chipped glass discarded (write the count)', { requireValue: true }),
    item('Draught line flushed'),
  ]],
  ['Kitchen hygiene and temperature log (FSSAI)', 'Kitchen', 'sky', ['imran'], 'sanjay', { type: 'daily' }, '15:00', 3, [
    item('Walk-in chiller temperature (°C)', { requireValue: true }),
    item('Deep freezer temperature (°C)', { requireValue: true }),
    item('Staff in clean uniform, caps and gloves; nails checked'),
    item('Chopping boards colour-coded and sanitised'),
    item('Day-dot labels on every container', { requirePhoto: true }),
    item('Hand-wash station stocked'),
  ]],
  ['Central kitchen — receiving and cold room', 'Purchase & Stores', 'ck', ['ramesh'], 'girish', { type: 'daily' }, '10:00', 3, [
    item('Vegetables and dairy weighed against the purchase order'),
    item('Meat and seafood received below 4 °C (write the reading)', { requireValue: true }),
    item('Rejected items photographed and sent back with the challan', { requirePhoto: true }),
    item('FIFO followed while stacking; older batch in front'),
  ]],
  ['Opening checklist — Skylounge Vaishali Nagar', 'Service', 'vsn', ['karan'], 'priya', { type: 'daily' }, '16:30', 3, [
    item('Terrace furniture wiped and set'),
    item('Lights and heaters tested'),
    item('Washrooms checked and stocked', { requirePhoto: true }),
    item('POS float counted (write the amount)', { requireValue: true }),
  ]],
  ['Room inspection — Tora Suites', 'Housekeeping', 'sty', ['lakshmi'], 'shalini', { type: 'daily' }, '13:00', 3, [
    item('Vacant rooms inspected: linen, bathroom, minibar, AC'),
    item('Corridors and lift lobby cleaned'),
    item('Maintenance issues raised as help tickets (write how many)', { requireValue: true }),
    item('Lost and found register updated'),
  ]],
  ['Daily sales and cash deposit', 'Accounts', 'sky', ['neha'], 'suresh', { type: 'daily' }, '12:30', 4, [
    item('Yesterday’s Z report matched with card and UPI settlements'),
    item('Cash deposited; bank slip attached', { requirePhoto: true }),
    item('Complimentary and discount bills listed for the manager'),
  ]],
  ['Weekly deep cleaning — exhaust, grease trap, drains', 'Kitchen', 'sky', ['imran'], 'sanjay', { type: 'weekly', weekday: 1 }, '12:00', 6, [
    item('Exhaust hood filters degreased'),
    item('Grease trap emptied', { requirePhoto: true }),
    item('Drains flushed and pest-control log signed'),
  ]],
  ['Monthly fire safety and licence check', 'Maintenance', 'sty', ['harish'], 'arjun', { type: 'monthly', day: 1 }, '11:00', 24, [
    item('Fire extinguishers within date and pressure in the green', { requirePhoto: true }),
    item('Emergency exits clear; signage lit'),
    item('FSSAI, excise, fire NOC and music licences: expiry dates checked'),
  ]],
];

export async function checklists(ctx) {
  const { api, ids } = ctx;
  const have = await api.get('/api/checklists/masters');
  const names = new Set((have.masters ?? have).map((m) => m.name));
  let made = 0;
  for (const [name, dept, branch, doers, verifier, frequency, dueTime, windowHours, items] of CHECKLISTS) {
    if (names.has(name)) continue;
    await api.post('/api/checklists/masters', {
      name, departmentId: ids.depts[dept], branchId: ids.branches[branch],
      items: items.map((it, i) => ({ key: `i${i + 1}`, ...it })),
      frequency, dueTime, windowHours,
      doerIds: doers.map((k) => ids.people[k].id), verifierId: ids.people[verifier].id,
      skipHolidays: false, startDate: dayIn(0), active: true,
    });
    made += 1;
  }
  // The doers work on today's runs: one finished and verified, one waiting for its verifier, one half done.
  let worked = 0;
  for (const [who, how] of [['manoj', 'verify'], ['aditya', 'submit'], ['imran', 'half'], ['ramesh', 'submit']]) {
    const me = await ctx.as(who);
    const run = ((await me.get('/api/checklists/runs?scope=mine')).runs ?? []).find((r) => r.status === 'OPEN' && !(r.itemsDone > 0));
    if (!run) continue;
    const full = await me.get(`/api/checklists/runs/${run.id}`);
    const lines = full.items ?? full.run?.items ?? [];
    const upto = how === 'half' ? Math.ceil(lines.length / 2) : lines.length;
    for (const line of lines.slice(0, upto)) {
      await me.post(`/api/checklists/runs/${run.id}/items`, {
        itemId: line.id, done: true,
        value: line.requireValue ? (/°C|temp/i.test(line.text) ? '3.5' : '12') : null,
        attachmentId: line.requirePhoto ? await proof(me) : null,
      });
    }
    if (how !== 'half') await me.post(`/api/checklists/runs/${run.id}/actions`, { action: 'submit', note: 'All done.' });
    if (how === 'verify') {
      const master = CHECKLISTS.find((c) => c[3].includes(who));
      await (await ctx.as(master[4])).post(`/api/checklists/runs/${run.id}/actions`, { action: 'verify' }).catch(() => {});
    }
    worked += 1;
  }
  return `${made} checklists added; ${worked} of today's runs worked on`;
}

export async function slipsAndTickets(ctx) {
  const { api, ids } = ctx;
  const p = (k) => ids.people[k].id;
  const slips = (await api.get('/api/slips?tab=all').catch(() => api.get('/api/slips?tab=inbox'))).slips ?? [];
  let note = [];
  if (!slips.length) {
    const raise = async (who, dept, problem, solutions) =>
      (await ctx.as(who)).post('/api/slips', { problem, solutions, departmentId: ids.depts[dept] });
    const s1 = await raise('imran', 'Kitchen', 'Tandoor gas pressure drops between 8:30 and 10 pm on weekends, so kebab tickets take 25 minutes instead of 12 and tables complain.', [
      'Add a second commercial cylinder bank with an auto change-over valve for the tandoor line',
      'Shift tandoori starters to a pre-order during the booking call for groups above eight',
      'Move one tandoor to piped gas when the building connection comes next quarter',
    ]);
    const s2 = await raise('rahul', 'Bar', 'Premium whisky pours do not match the bottles finished: about two bottles a week are unaccounted for at the C-Scheme bar.', [
      'Fit measured pourers on the top ten premium bottles and count them at closing every day',
      'Weigh open bottles on Monday and Thursday and compare with the POS sale',
      'Give one bartender ownership of the premium shelf per shift with a signed handover',
    ]);
    await raise('lakshmi', 'Housekeeping', 'Linen comes back late from the laundry vendor three days a week, so rooms are ready only after 3 pm and early check-ins wait in the lobby.', [
      'Keep a third par of linen for the 12 rooms',
      'Add a penalty clause and a 10 am delivery time to the laundry contract',
      'Try a second vendor for two weeks and compare',
    ]);
    const arjun = await ctx.as('arjun');
    await arjun.post(`/api/slips/${s1.id}/actions`, { action: 'forward', note: 'Real problem — seen it on both Saturdays.' });
    await api.post(`/api/slips/${s1.id}/actions`, { action: 'approve', solutionId: (await api.get(`/api/slips/${s1.id}`)).slip?.solutions?.[0]?.id ?? (await api.get(`/api/slips/${s1.id}`)).solutions?.[0]?.id, doerId: p('harish'), plannedAt: iso(inDays(3, 15)), note: 'Go ahead. Keep the cost under ₹35,000.' });
    await arjun.post(`/api/slips/${s2.id}/actions`, { action: 'forward', note: 'Needs the owner’s decision — it touches every bar.' });
    note.push('3 help slips (one approved into a task, one with the owner, one with the receiver)');
  }
  const tickets = (await api.get('/api/tickets?tab=all').catch(() => api.get('/api/tickets'))).tickets ?? [];
  if (!tickets.length) {
    const raise = async (who, solver, title, description, hours) =>
      (await ctx.as(who)).post('/api/tickets', { title, description, solverId: p(solver), plannedFixAt: iso(new Date(Date.now() + hours * 3600_000)) });
    const t1 = await raise('rahul', 'harish', 'Bar KOT printer prints blank tickets', 'Since yesterday evening the bar printer feeds paper but prints nothing. Drinks orders are being shouted across.', 6);
    const t2 = await raise('aman', 'harish', 'AC in room 104 is leaking water', 'Water dripping on the carpet near the window. Guest arrives at 2 pm.', 4);
    await raise('priya', 'arjun', 'Card machine at Vaishali Nagar declines every third swipe', 'The bank’s machine times out during the dinner rush; guests end up paying by UPI.', 24);
    const t4 = await raise('neha', 'suresh', 'Petty cash is short by ₹1,200 for the week', 'Vouchers and cash do not match for the week ending Sunday.', 12);
    const harish = await ctx.as('harish');
    await harish.post(`/api/tickets/${t1.id}/actions`, { action: 'reply', text: 'Looks like the thermal head. Bringing the spare printer from the store in 30 minutes.' });
    await harish.post(`/api/tickets/${t2.id}/actions`, { action: 'reply', text: 'Drain pipe is choked. Cleaning it now.' });
    await harish.post(`/api/tickets/${t2.id}/actions`, { action: 'resolve', note: 'Drain pipe cleaned and the tray re-levelled. Ran for 40 minutes with no drip.', attachmentIds: [await proof(harish)] });
    const suresh = await ctx.as('suresh');
    await suresh.post(`/api/tickets/${t4.id}/actions`, { action: 'reply', text: 'Checking the vouchers of Friday.' });
    await suresh.post(`/api/tickets/${t4.id}/actions`, { action: 'resolve', note: 'Two fuel vouchers were entered twice. Corrected; cash now matches.', attachmentIds: [await proof(suresh)] });
    await (await ctx.as('neha')).post(`/api/tickets/${t4.id}/actions`, { action: 'confirm' });
    note.push('4 help tickets (open, in progress, fixed and waiting for the raiser, closed)');
  }
  return note.join('; ') || 'already there';
}

export async function eaBoard(ctx) {
  const { api, ids } = ctx;
  const board = await api.get('/api/ea/board');
  if ((board.items ?? []).filter((i) => !i.text.startsWith('PROBE')).length) return 'already there';
  const meera = await ctx.as('meera');
  const ownerId = ctx.me.user.id;
  const cap = async (text) => (await meera.post('/api/ea/items', { text, ownerId })).id;
  const go = (id, body) => meera.post(`/api/ea/items/${id}/actions`, body);
  await go(await cap('Review meeting with outlet managers — October P&L'), { action: 'schedule', date: dayIn(1), start: '11:00', minutes: 60, kind: 'review' });
  await go(await cap('Call the landlord of the Vaishali Nagar terrace about the lease renewal'), { action: 'schedule', date: dayIn(1), start: '15:30', minutes: 30, kind: 'call' });
  await go(await cap('Tasting of the winter menu with Chef Sanjay'), { action: 'schedule', date: dayIn(2), start: '13:00', minutes: 90, kind: 'meeting' });
  await go(await cap('Meet the wedding planner from Shaadi Squad at Tora Suites'), { action: 'schedule', date: dayIn(3), start: '17:00', minutes: 45, kind: 'meeting' });
  await go(await cap('Excise licence renewal: fee slab for 2027 announced — ₹ 12 L for the rooftop category'), { action: 'toInformation' });
  await go(await cap('Zomato Gold renewal terms shared by the account manager'), { action: 'toInformation' });
  await go(await cap('Open a Tora cloud kitchen for the Mansarovar side'), { action: 'toSomeday' });
  await go(await cap('Rooftop solar for the central kitchen'), { action: 'toSomeday' });
  await go(await cap('Fire NOC renewal for Tora Suites'), { action: 'toWaiting', waitingOn: 'Fire department inspection date' });
  await go(await cap('Quotation for the retractable roof at C-Scheme'), { action: 'toWaiting', waitingOn: 'Vendor’s revised quotation' });
  await go(await cap('Get three quotes for new bar stools (24 pieces)'), { action: 'delegate', doerId: ids.people.girish.id, plannedAt: iso(inDays(4, 17)) });
  const done = await cap('Sign the Diwali bonus sheet');
  await go(done, { action: 'schedule', date: dayIn(0), start: '10:00', minutes: 15, kind: 'task' });
  await go(done, { action: 'done' });
  await cap('Ask about the birthday booking for 40 on the 22nd — who is handling it?');
  await cap('New uniform samples are with HR — see them');
  return '14 items on the owner’s board: scheduled, information, someday, waiting, delegated, done, two still to sort';
}
