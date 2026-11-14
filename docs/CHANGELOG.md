# Changelog

## 14/11/2026 — Transfers carry a choice about open work; a bar and a kitchen in one outlet

- **Transfer dialog**: lists the person's open work (tasks, process steps, tickets, recurring checklists) and asks — keep it, hand it to someone who stays, or give it back to the branch manager.
- **Stock by menu category**: an outlet can take a category's stock from another location of its branch (System Master → Hospitality → outlet). Drinks sold reduce the bar's stock; a drink is switched off when the bar is out even if the kitchen has it.
- Fixed: saving an outlet no longer wipes its UPI id.

## 14/11/2026 — Attendance: late is not also a half day; recalculate a month

- **Rule corrected** for fixed shifts: someone 53 minutes late who stays to the end of an 8-hour shift is **Late**, not Half day — lateness has its own rule and is no longer counted against the hours a second time; the hours test is about leaving early. A day never asks for more hours than the shift has. Overtime counts only beyond the shift's own length (late and stayed late is time made up).
- **Recalculate** (Attendance → Monthly report, HR only): works a month's recorded days out again with today's rules — needed for days settled before this change. Refused for a month whose pay is closed.

## 14/11/2026 — Who works where: branches on the people screens, transfers

- **Org chart → Group by Branch**: one column per branch with its manager and its people by department, a warning column for people with no branch, and a branch filter. Drag a person onto another branch (or open the person → Transfer) to move them.
- **Users**: a Branch column, a branch filter with head-counts, "Move to branch" for the ticked people, and the branch on every card. The person sheet opens the same transfer dialog.
- **Transfer dialog**: home branch, the date it takes effect, the branches the person also works at, and their earlier branches. `POST /api/branches/people/move` moves several people at once (keeping their other branches); `GET /api/branches/people/:id` gives the history; the people list now carries `branchName` and `alsoBranchIds`.
## 14/11/2026 — Monthly attendance report (muster) and daily punches

- **HR → Attendance → Monthly report** (HODs, branch managers and HR; everyone else sees only themselves through
  the API): the **muster register** — one row per person, one code per day (P, LT, HD, A, CL/SL/EL… by leave
  type, ½ for half a day, WO, H, WO/P or H/P when someone worked an off day, – no record) with the month's totals
  (present, late, half days, absent, leave, weekly offs, holidays, hours worked, late minutes, overtime) — and
  **daily punches**: each person's in, out, hours, late and overtime for a day, every punch with its source
  (app, biometric, correction), and why the day counts as it does. Filter by month, department, branch and name;
  tap a day for its punches.
- **Downloads**: muster as **Excel** and **PDF** (A3 landscape, codes in a coloured grid, legend), daily punches
  as **Excel** and **CSV** — `GET /api/hr/attendance/muster` and `/api/hr/attendance/muster/export?kind=muster|punches&format=xlsx|csv|pdf`.
- It reads what payroll reads: settled days, the last two days worked out as they stand, the branch calendar for
  holidays and weekly offs, approved leave, nothing before joining (HR-details DOJ, else when the person was added).
- **Fixed: a leave approved after its days were settled** (off sick Monday, asked Tuesday) left those days
  "absent"; approving re-settles them as "on leave", and cancelling an approved leave settles them again.

## 14/11/2026 — Fixes found setting up a restaurant group (TORA SKYLOUNGE demo)

Found while setting up a full rooftop-bar demo through the API and clicking through it at 390 and 1440 px
(`scripts/tora-demo/`, `docs/plans/tora-demo-guide.md`).

- **Pack roles can do their daily work**: every role in every library pack now has what the built-in Member has
  — their process steps, checklists, punching in and leave, search and the people list. Before, a steward or a
  driver got "You don't have access" on My FMS steps and could not ask for leave. Companies that installed a pack
  earlier keep their roles as they are (an upgrade never changes a role): add the rights in System Master → Roles.
- **A person outside your branches is named as such**: giving work to someone at a branch you can't reach (a
  franchise's people) now says "works at a branch outside the ones you can reach", not "is not an active person".
- **Saving a branch keeps its phone and punching gates**: the branch dialog saves the address, series code and
  licences; details it does not send are now kept (they were wiped). `null` still clears a value.
- **Changing a checklist's doer moves the runs nobody started** to the new doer (in order), so the same
  occurrence no longer shows twice; started, covered and past runs stay with whoever had them.
- **Outlet screens start at your outlet**: POS, kitchen display, reservations and day close open on the outlet
  you picked last, else one at your home branch (dining rooms before room service), not the first by name.
  `/api/auth/me` returns the person's home `branchId`.
- **The order sheet names its table** ("Order 8 · R2").
- **Phones**: the search box on the Delegation sheet, Users, Org chart and Message templates takes the full
  width instead of shrinking beside the filters.
- Tests that booked leave for "tomorrow" failed on Saturdays (Sunday is the weekly off); they skip Sunday now.

## 13/11/2026 — Fixes from the owner's review

- **Tab bars that ran off the screen**: System Master's tabs and every work-screen tab strip now show an arrow at the edge while there is more that way, scroll with the mouse wheel, and bring the current tab into view (`components/scroll-row.tsx`).
- **Business Engine flowchart**: lines are horizontal and vertical only, each with its own place on the box and its own track between rows, so none merge; an arrowhead and a moving dot show the direction; lines that go back are amber and dashed (`modules/system/engine/route.ts`, tested).
- **Photos of people**: a photo can be added, changed or removed in the person sheet (admins) and on Profile (yourself) — `PUT /api/org/users/:id/photo`; it is made small on the device first. Avatars look the photo up themselves, and names in the task, checklist, process, attendance, cover and history lists carry the photo.

## Phase 21 — Packs for nine other industries (13/11/2026)

Plan: `docs/plans/hospitality-100-plan.md` §11A; rows K1–K45 in `docs/plans/coverage.md` (drafted from the plan,
not yet reviewed by GGM).

- **Nine packs** beside Hotel & restaurant, in Masters → Master Library → Packs: **Pharmacy, Gold & gems, Retail
  shop, Wholesale & distribution, Manufacturing, Construction, Real estate, Logistics & transport, Mining.** Each
  is set-up only — roles, tax codes for the accountant to fill, items, masters, record types, processes,
  registers and reports — and each has a short printable guide (Support → User guides, 22–30).
- **Each trade's working day is tested** in its own empty company: set up from the pack, buy and receive, sell
  and bill, the thing special to the trade (first-expired-first-out and the Schedule H register; a piece sold at
  the day's gold rate with making charges; a members' price; dealer credit; a batch made from its bill of
  material; running bills; one booking per flat; consignments and trips; the royalty-pass register), and the
  owner's view (a report, what is owed, the Weekly MIS). All ten packs also install together in one company.
- **What the packs found is fixed in the core**, not worked around: a counter sale takes **charges and a
  discount**; a **credit sale is due after the party's credit days**; a party can be a **member**; a record
  status can **free what the record held as unique** (a cancelled booking frees its flat).
- Packs can carry **item attributes, price lists and bills of material**.
- `npm run seed:demo -- --packs=pharmacy,retail` (or `SEED_DEMO_PACKS=`) installs packs into the demo company.

Not done, said plainly: the days are **API tests** — only the Mining pack is also driven through the screens.
**No booking of a resource by time and no milestone-billing engine** were built: a vehicle can be on two
consignments the same day, and demands and running bills are invoices a person raises. Old gold is not netted on
the same bill; retention, TDS and cess are not worked out; a pack cannot make branches (mines, sites); no
weighbridge reading; no government filing special to a trade. The packs' items and master rows are their demo
data — there are no demo transactions. **Manufacturing was not checked with GGM staff.** The "frees" switch on a
record status is set by a pack or the API; the record-type builder screen has no tick-box for it yet. Hindi
strings need review.

## Phase 20 — Packs, hospitality reports, load test, drills, guides (13/11/2026)

Plan: `docs/plans/hospitality-100-plan.md` §11, §12A; rows U37–U42 and F1–F7 in `docs/plans/coverage.md`.

- **Packs** (Masters → Master Library → Packs): the set-up of a whole trade in one step. A pack is a file — roles,
  tax codes to fill, lists, masters with rows, items, record types, processes, checklists, reports and the
  trade's own words on screen. **Installing never changes what you already have; an upgrade adds only what is
  new; taking a pack off keeps everything it made.** Your own company's set-up can be saved as a pack file and
  installed in another company. The first pack is **Hotel & restaurant** (the module switched on, twelve roles,
  five tax codes at 0 % for the accountant, opening and closing checklists).
- **Hospitality → Reports**: yesterday's **flash** (sales, guests, spend per guest, occupancy, ADR, RevPAR, food
  and drink cost %, cash counted against the system, voids, discounts, no-charge bills), **sales** by item,
  category, steward, hour or outlet, **kitchen times** by station, the **void and discount audit**, and the
  **team's week** (stewards, stations, housekeeping). The flash is also sent to the owner at 08:00.
- **GSTR-1 working file** for a month (`/api/money/gstr1`, JSON or CSV): B2B, B2C by state, notes, HSN, documents.
  It is for the accountant — it is not the portal's upload format and files nothing.
- **Nine printable guides** (Support → User guides): steward, cashier, kitchen, bartender, front office,
  housekeeping, night auditor, store, general manager.
- **Load test and drills** (`docs/phase20-load-and-drills.md`): 30 POS devices + 10 front-desk + 50 back-office
  people for three minutes — 720 orders, no failed request, POS p95 120 ms (gate 300 ms); the server killed in
  the middle of service — 489 orders, none lost, none billed twice. Both scripts are in `deploy/loadtest/`.
- Fixed on the way: at start-up **every** company's built-in roles now get the rights of modules added since
  (before, only the first company's did).

Not done, said plainly: the tests ran on the development machine with one API process, not the Docker build.
**The 10× load run on several API copies was not run, and the architecture rows A2–A10 are mostly not built**
(one API copy, no pooler, no sign-in cache, no leader worker, no monthly tables). The drills that need the
building — internet pulled, server power pulled, a restore on a second machine, a real printer — are still to be
done at the property. The hospitality lines are a report of their own, not yet part of the Weekly MIS score.
Stock valuation per location and the variance report already existed (Inventory). No screen for GSTR-1 or for
receivables by kind. Rows U31 (a booking engine for other trades) and U33 (billing by milestone) are not engines.
Hindi strings need review.

## Phase 19 — Integrations (13/11/2026)

Plan: `docs/plans/hospitality-100-plan.md` §10; rows X1–X20 in `docs/plans/coverage.md` (drafted from the plan,
not yet reviewed by GGM). Set up in System Master → Integration → **Connections**.

**Read this first: every outside service was tested against a stand-in written for the test. Nothing here has
been tried against a live Razorpay / Cashfree account, a channel manager, a GSP, a real Zomato / Swiggy file or
Tally.** Expect small fixes on the first live connection of each.

- **Channel manager** (per property): its address and token, which room type is which room there, and the plan
  whose rates are sent. "Send the next 30 days" pushes rooms left, price and restrictions; a push that fails is
  sent again by itself (five tries). Bookings, changes and cancellations from the travel sites come in on a
  webhook (or "Ask for new bookings"); the same booking twice is one booking. **A booking a site sold when no
  room is left is still taken and flagged** for a person to solve.
- **Your own booking page for rooms**: a switch per property gives a public link; guests see what is free with
  its price and book without signing in.
- **Payment links** (Razorpay or Cashfree): "Send a payment link" on a table deposit, a stay's advance, a
  banquet's advance and a restaurant bill. When the gateway says a link is paid — and its signature is right —
  MONO records the money once, exactly as a person at the desk would, and confirms the table booking.
- **UPI QR on the printed bill**: the bill prints a QR code for its amount (where the outlet has a UPI ID).
- **Zomato / Swiggy**: a takeaway or delivery order is marked with its number there and billed to the partner.
  The payout file (CSV) is checked first, then recorded: a receipt for what was paid, a credit note for what the
  partner kept, and a list of what does not match.
- **GST e-invoice**: "Get e-invoice (IRN)" on an issued B2B bill sends it to your provider and keeps the IRN,
  acknowledgement and QR; it can be cancelled for 24 hours.
- **Site agent** (`deploy/site-agent/agent.mjs`, one file, Node 22): on a branch's computer it prints that
  branch's tickets and bills (network or USB printer) and posts vouchers to Tally, reporting what Tally said.
  Its key is made in Connections and shown once.
- **Health**: one screen says what is not working — a failed connection, oversold bookings, a payment that came
  in but was not recorded, an agent that has gone quiet, vouchers Tally refused.

Not built, or not proved through the screens: the channel-manager and e-invoice adapters use MONO's own simple
contract — **a real provider needs a small mapping, and no channel manager has certified it**; refunds through
the gateway; a QR image on screen; direct order push from the aggregators; e-way bills; card machines; an
installer for the site agent. The commission credit note and the SAC used for charges on an e-invoice need the
accountant's yes. Browser-tested (380 and 1440): saving the gateway, the booking page and a guest's booking, the
channel manager's push and a booking in, a site agent's key, a payout file, an e-invoice. API-tested only: a
paid link, retries, channel changes / cancellations / overbooking, the agent printing and posting to Tally,
cancelling an e-invoice, marking an order on the POS screen. Hindi strings need review.

## Phase 18 — Banquets and events, bar, compliance (13/11/2026)

Plan: `docs/plans/hospitality-100-plan.md` §9; rows B1–B20 in `docs/plans/coverage.md` (drafted from the plan, not
yet reviewed by GGM). Under Hospitality once the module is on.

- **Banquets** (Hospitality → Banquets): halls with their capacities and rent, menu packages sold per plate, and
  events from the enquiry to the paid bill. A quotation is plates × guaranteed guests + hall rent + extras, with
  tax. The rule's advance (25 % by default) must be in before a booking is confirmed, and **a hall is never
  confirmed for two events at the same time**. A confirmed event has its **BEO** (notes for kitchen, service and
  housekeeping, sent with a version number — a change makes a new version), the **indent** (what the menu needs
  from its recipes × guaranteed guests, against the kitchen's stock), and the event-day checklist. When the event
  is held the food leaves the stock, the **final bill is made for the guests who came — never fewer than
  guaranteed** — and the advance is set against it; the balance is paid (a company may take it on credit) and
  feedback is recorded. A lost enquiry returns its advance; a cancelled booking returns it in time or keeps it.
- **Bar register** (Hospitality → Bar register): for each liquor brand at each stock location, the day's opening,
  received, sold, breakage and closing in bottles and ml, with the branch's licence; a file in the state's layout
  (Rajasthan first). **Dry days** take liquor off the live menu for that day, so the POS refuses it; food still
  sells.
- **Compliance** (Hospitality → Compliance): licences and certificates with the day they run out, reminders at
  60 / 30 / 7 days, on the day and once run out; things done again and again (pest control) move their next day
  on when marked done; **temperature logs** with limits — a reading outside them needs what was done about it and
  tells the managers at once.

Not built, or not proved through the screens: the excise file's layout is my reading of the usual brand-wise
register and **must be checked against the department's form before it is filed**; other states' formats; a
printed BEO or quotation (PDF); raising the indent as a stock transfer by itself (the list is shown); a hall
calendar screen (the API gives it; clashes are refused when confirming); menu items of a package and hall
capacities by setting are typed through the API; uploading the licence's file from the screen. Browser-tested:
one event from enquiry to closed, one licence, one temperature reading, the register of one brand and a dry day.
Hindi strings need review.

## Phase 17 — Hotel / property management (13/11/2026)

A hotel can run its rooms on MONO. Plan: `docs/plans/hospitality-100-plan.md` §8; rows H1–H50 in
`docs/plans/coverage.md` (drafted from the plan, not yet reviewed by GGM). Under Hospitality once the module is on;
a property is a branch that has rooms.

- **Room rates** (Hospitality → Room rates): rate plans EP / CP / MAP / AP with a rate per room type. Through the
  API a plan also carries weekend rates, seasons, a length-of-stay discount, a minimum stay, extra adult / child,
  its cancellation and no-show rule, and can be for one company or travel agent (with a commission). Days can be
  closed for sale, closed to arrival or given a minimum stay; what is left to sell is counted per room type per day.
- **Bookings**: priced night by night before they are made; the guest is the same profile the restaurant uses.
  Group blocks hold rooms until a release date; a company's booking bills the room to the company; an agent's
  keeps the commission. Advances are ADVANCE papers; cancelling follows the plan (free in time, else a charge on
  the folio); the guest gets a voucher link.
- **Room calendar** (Hospitality → Room calendar): rooms down, days across. A room holds one stay a night — the
  database itself refuses anything else. Give a waiting booking its room; tap a stay to open it.
- **Front desk** (Hospitality → Front desk): arrivals, in the house, departures, overdue to leave. Check-in needs
  a clean room, the ID, a photo of it and the signed card; a foreign guest's **Form C** is tracked (due in 24
  hours, a reminder to the managers, a file for the FRRO portal). Room move, free or paid upgrade, early / late
  charges by the property's rules, more or fewer nights, keys, visitors, check-out.
- **Folio**: room nights (posted by the night audit), restaurant bills sent to the room, minibar, laundry, extras,
  advances. Several folios on a stay with routing rules (room to the company, extras to the guest), charges moved
  between folios and between rooms, allowances by a supervisor. Closing a folio makes **one GST invoice, each room
  night taxed by the slab its tariff falls in**; a company's folio may be left owing (it shows in Money owed).
- **POS → room**: at a hotel, a bill paid by "room charge" goes on the folio of whoever is checked in to that room
  (nobody there → refused) and is paid with the folio — it is never invoiced twice.
- **Night audit** (Hospitality → Night audit): marks no-shows with the plan's charge, posts the night's room
  charges, lists what is still open, moves the hotel's date, and keeps the day's pack — occupancy, average rate,
  revenue per room, revenue by outlet, money by mode.
- **Housekeeping** (Hospitality → Housekeeping): every room's state, the day's cleaning with a checklist,
  inspection, rooms taken off sale (with a help ticket when the property has a maintenance person — the room
  comes back when the ticket closes), lost & found. Through the API: assignments by floor, turndown, the minibar
  check (to the folio and off the stock), linen issued from stock.
- **Guest requests** are help tickets with a time limit, from the desk or from the room's own QR page.
- Registers through the API: the guest (police) register and occupancy statistics.

Not built, or not proved through the screens: dragging on the calendar (a room is chosen from a list; moves and
date changes are in the stay's window); OTA / channel-manager bookings (plan §10, Phase 19); a PDF of the invoice
or voucher; a printed QR (the link is made, not the image); the signature is an uploaded photo of the signed card,
not drawn on screen. API only (no screen yet): seasons, weekend rates, length of stay, restrictions, group blocks,
corporate / agent plans, split folios, routing, moving charges, allowances, credit notes, Form C filing and
export, assignments by floor, turndown, minibar, the registers, the property's rules. Tax slabs must be typed by
the accountant. Hindi strings need review.

## Phase 16 — Table reservations, waitlist, guests (13/11/2026)

A restaurant takes bookings on MONO. Plan: `docs/plans/hospitality-100-plan.md` §7; rows R1–R20 in
`docs/plans/coverage.md` (drafted from the plan, not yet reviewed by GGM). Under Hospitality once the module is on.

- **Reservations** (Hospitality → Reservations): the day's book at an outlet — time, guest, party, table, status,
  deposit — with the next step on each card (confirm, arrived, seat, no-show, change, cancel). A new booking shows
  the free times for the day and party size and takes the **best-fit table** (the smallest that seats the party,
  or joinable tables put together) unless a host chooses one. **A table can never be booked twice** for any part
  of the same time, even when two people book at the same moment.
- **Booking rules** per outlet: slot length, how long a party stays by its size, the days ahead, the hold time, the
  reminder, free cancellation, the deposit (from a party size, per guest), what happens to a no-show's deposit.
- **Public booking page**: each outlet has a link (`/book/<code>`) that shows free times and takes a booking with a
  small sum instead of a captcha; bookings confirm by themselves or wait for a host, by the rule. The guest gets
  their own link to see or cancel the booking. Confirmation, reminder, cancellation and "your table is ready"
  messages go by the company's notification rules (WhatsApp / email templates are in the defaults).
- **Deposits**: a large party's booking waits until its deposit is recorded — an ADVANCE paper in the guest's
  name. At the table, **Use the deposit** on the bill sets it against the invoice and the rest is paid as usual.
  Cancelled in time, it is owed back (any host returns it); too late or a no-show, it is kept by the rule (an
  approver may still return it). **No payment gateway is connected** (plan decision 3 is open): money is taken by a
  person and recorded, not by a pay link.
- **Seating** opens the POS order on the booked table with the covers, name, occasion, requests and allergies;
  the booking finishes when that order is paid. The POS floor shows a table with a booking due soon as
  **Reserved**, with the name and time. The clock marks no-shows after the hold time and lapses requests nobody
  confirmed.
- **Waitlist**: a walk-in is quoted a wait (from running tables, bookings about to start and parties already
  waiting), told when the table is ready, and seated from the list.
- **Guests** (Hospitality → Guests): one profile per mobile for every outlet — allergies, preferences, birthday /
  anniversary, notes, tags — with visits, spend, favourite dishes and no-shows read from their orders and
  bookings, and **marketing consent recorded with when, how and by whom** (taking it back is recorded too).
- Money core: an advance can now be set against a bill later (`applyCredit` / `releaseCredit`).

Not built, or not proved through the screens: a payment link for deposits; changing a booking, no-show / bring
back, returning a deposit, the reminder and the reserved table are tested through the API only; guests cannot
change (only cancel) a booking from their link; availability does not look at walk-in orders still at a table
(the floor's Reserved state warns the steward instead); the waitlist seats on one chosen table. Hindi strings need
review.

## Phase 15 — POS, kitchen tickets and display, billing, payments, day close (13/11/2026)

A restaurant can run a service on MONO. Plan: `docs/plans/hospitality-100-plan.md` §6; rows P1–P40 in
`docs/plans/coverage.md`. Shown under Hospitality once the module is switched on.

- **POS** (Hospitality → POS): the outlet's floor with every table's state (free, seated, ordered, billed, paid).
  Tap a table to seat guests and take the order from the outlet's live menu — sizes, add-ons, a note for the kitchen,
  a course, **hold** an item and fire it later. Takeaway, delivery, room service, staff meals and a plain **counter
  sale** need no table.
- **Kitchen tickets**: each station gets its own ticket, numbered through the business day, printed where the
  station has a printer and always on the **kitchen display** (Hospitality → Kitchen display): timers that turn
  amber and red, tap an item when it is ready, bump the ticket, recall it, "all day" counts, an expo view of every
  station.
- **Voids**: an item never sent to the kitchen is simply taken off; a fired one needs a reason, and above the
  role's limit an approver who is not the asker. A dish already cooked is written off from the outlet's stock.
  Table operations: move, merge, send items to another table, change the steward.
- **Bills** are invoices in the money core: each item's tax and HSN, the outlet's **service charge the guest may
  refuse**, packaging and delivery on takeaway / delivery, a discount (within the role's limit, or approved), a
  no-charge bill with one of the company's reasons, round-off, a company's name for B2B, a UPI pay link, **split**
  by item, by seat, equally or by amounts, reprints marked DUPLICATE, and cancellation with an approval — money
  taken is voided, a credit note undoes the invoice, and the table is open again.
- **Payments**: several modes on one bill; a mode that needs a reference refuses without one; a room charge against
  the room number; company credit leaves the invoice owed (it shows in Money owed); tips per steward. When an order
  is paid its items take their recipes and add-ons from the outlet's stock — short stock is noted, never blocking.
- **Shift and day close** (Hospitality → Bills & day close): a cashier's X report, the day's Z report (sales, tax,
  charges, discounts, voids, money by mode, tips), cash counted by note with a blind count. A closed day takes
  nothing more; only the owner reopens it, with a reason.
- **Printing**: tickets and bills are ESC/POS jobs sent straight to network printers (IP:9100) and retried; a
  printer that stays offline fails the job and the ticket stays on the display. A branch away from the server pulls
  its jobs through its site agent. **Bill numbers can be reserved per device**, and orders and lines carry a device
  key, so a tablet that was offline sends what it kept without making anything twice.

Not done here: advance adjustments against a bill (P28), a QR image for UPI (the pay link is there), posting a room
charge to a guest folio and the guest's signature (the hotel, Phase 17), reservations on the floor (Phase 16), the
site-agent program itself (Phase 19), full offline billing on the device (lines are queued; bills still need the
server), continuous database archiving before the first live bill (plan §6 — a deployment step still to do). No
real thermal printer was used: printing is tested against a local socket. Hindi strings need review.

## Phase 14 — Hospitality set-up and menu (13/11/2026)

Everything a restaurant, bar or hotel sets up before the first order. Plan: `docs/plans/hospitality-100-plan.md`
§5; rows S1–S16 in `docs/plans/coverage.md`. Hospitality is **off** until a company switches it on
(System Master → Hospitality); companies that don't use it see nothing new.

- **Outlets** (restaurant, bar, café, room service, banquet, pool bar, counter): the branch, the location stock is
  taken from, opening hours, a **voluntary service charge %**, packaging and delivery charges, round-off, a bill
  printer, and the outlet's **kitchen stations**.
- **Floors & tables**: a floor plan per outlet — add tables one by one or many at once, drag them to their place,
  seats, shape, section, joinable tables.
- **Rooms**: room types (guests, beds, amenities, the declared tariff) and rooms by number, a range at once,
  connecting rooms known to both sides.
- **Printers & stations**: network or site-agent printers, and which station each menu category's tickets go to.
- **Discounts, day close & payments**: discount types, what each role may give by itself (anything above waits for
  an approver), no-charge reasons, the business day's cut-off, the notes counted, a blind cash count; payment modes
  for wallet, room charge, company credit and complimentary, and which need a reference.
- **Menu** (Hospitality → Menu): categories, items linked to a stock item and its recipe, veg / non-veg / egg,
  spice, allergens, Hindi names, HSN and tax code, **variants** (half / full), add-on groups with a stock effect,
  combos, prices per outlet and time band, availability windows, and **86**: switched off by hand with a reason, or
  by itself when the outlet's stock can't make one. A whole menu can be pasted in (all or nothing, problems by line).
- New rights `hosp.view / create / edit / approve / admin`; an outlet manager limited to a branch sees and changes
  only that branch's outlets and rooms.

Not done here: screens for modifier groups, combos, time-band prices and availability windows (their API is
tested), photos for rooms and dishes, the POS itself (Phase 15). Tax codes are the ones the accountant typed in
Money set-up; none is built in. Hindi strings need review.

## Phase 13 — Inventory v2: stock per location (13/11/2026)

Stock is now kept where it is. Plan: `docs/plans/hospitality-100-plan.md` §4 and §3.6; rows I1–I30 and U23–U30 in
`docs/plans/coverage.md`. Everything from phase 8 (bands, MAX review, OWS, audit) keeps working on the item's total;
today's stock moved into the **main store** by migration.

- **Stock by location** (Inventory → Stock by location): what each store, kitchen and bar holds, batch by batch;
  an *Expiring* tab and a *Value* tab (weighted average or FIFO). **Stock entry**: in, out, or a move inside the
  branch, typed in any of the item's units or by scanning a barcode.
- **How an item is kept**: tracked by quantity, **batch + expiry** (first expired first out; an expired batch is
  never issued), **serial** (each piece its own number, cost, weight and history) or **lot with attributes**; bought,
  made, or a dish; other units with conversion (case → bottle → ml → peg), a second unit (pieces and grams), barcode.
- **Transfers**: an outlet's indent to a kitchen or store (by its supply route, or any supplier), approved in full,
  in part or with a substitute → dispatched → **in transit**, seen by both sides → received; short, damaged and
  extra wait for an approver who is not the receiver. **Emergency** outlet-to-outlet transfers need a reason and a
  yes from both sides (or one, by the rule). Between branches a **delivery challan** goes with the goods; between two
  GSTINs a **tax invoice** from the sender and a **purchase bill** on the receiver. Transfer price: cost, cost + %, or
  a price list.
- **Recipes & production**: versioned recipes with yield % and wastage %, sub-recipes, live cost and food-cost %;
  production orders take the raw material and make a batch with its expiry, real cost and yield variance.
- **Goods receipts** against a purchase order or without one: quantity and rate differences, batch and expiry,
  rejected quantity, the vendor's purchase bill, returns to the vendor. A purchase order says where it is delivered.
- **Wastage register** with reasons; over a value limit it waits for approval. **Closing counts** per location, blind
  if wanted, with the variance against what the recipes used, flagged over a set %.
- **Prices**: price lists per kind of party, branch and date (the most specific wins) and a **rate board** for things
  sold by weight. A counter sale takes its price from them, issues the stock (a dish through its recipe, a piece by
  its number) and raises one invoice through the money core.
- Par levels and a reorder list per location, a per-location register (bottles, open ml, pegs sold), a daily
  expiry warning per branch, and notices for indents, dispatch and differences. A new party kind: **dealer**.
- People see and touch only the locations of their own branches; the main store is head office's.

Not done here: label printing (needs the site agent of Phase 19), vendors limited to entities and vendor price
lists per branch, photos on the wastage screen, screens for supply routes, par levels, vendor returns, the counter
sale, attributes, the register and the variance report (their API is tested). MAX review, OWS and the audit cycle
still work on the company total, not per location. Hindi strings need review.

## Phase 12M — Money core (13/11/2026)

One engine for every paper that carries money. Plan: `docs/plans/hospitality-100-plan.md` §3A; rows U11–U22 in
`docs/plans/coverage.md`. The CRM's screens are unchanged; its orders and payments now also stand as invoices and
receipts.

- **Parties** (Money → Parties): one list of everyone you deal with — customer, vendor, guest, company, agent,
  franchise, transporter; a party can be several. A CRM customer is a party with the same id and code.
- **Vendors to match** (Money set-up): vendor names typed on items and purchase orders are listed with a suggestion;
  a person says which party each is. Nothing is merged by itself.
- **Tax rates are data**: a code, a percent and the day it starts, typed by the accountant; a change is a new row
  from a new day. Rates can go by price slab. Same state → CGST + SGST, another state → IGST; a VAT entity charges
  one tax, a no-tax entity none (from the entity's tax profile).
- **Bills** (Money → Bills): invoice, credit note, debit note, receipt, advance, purchase bill, vendor payment and
  delivery challan in one model — lines with HSN and tax, charges, discount, round-off, any currency. Draft →
  issued → part paid → paid. An issued paper is never edited: an invoice is cancelled by a credit note, a receipt
  entered by mistake is voided with a reason. Numbers come from the legal entity's series.
- **Money owed** (receivable and payable with ageing, due and promised dates) and a **statement** per party.
- **Payment modes** per branch and a **day close**: expected from the day's papers against what was counted.
- Every issued paper makes a **balanced voucher**; **Tally ledgers** maps MONO's heads to Tally ledger names and
  exports the vouchers as Tally XML.
- CRM orders (invoice with the order's number), payments (receipt), cancelled orders (credit note), goods received
  on a purchase order (purchase bill), process document steps and `/api/v1/bills` all go through this engine. The
  worker carries over orders and payments made before it, numbers unchanged.
- New rights: `money.view / create / edit / approve / admin`.

Not done here: tax on CRM order lines (orders carry one amount), TDS / TCS, e-invoice and e-way bill, a printed
invoice PDF from a bill, bank reconciliation. Hindi strings need review.

## Phase 12 — Branches, legal entities, countries and franchises (13/11/2026)

One MONO for a whole group: many branches under several companies, some abroad, some franchised. Plan:
`docs/plans/hospitality-100-plan.md` §3; the 44 rows that define "done" (G1–G44) and the test that proves each are
in `docs/plans/coverage.md`. Nothing changes for a company with one branch and no entities.

**The structure** (System Master → Branches)
- **Legal entities** (a company of the group or a franchise partner: country, currency, tax number, address, a code for its number series, licences, a tax profile), **regions** of any depth, **branches** of a kind (outlet, kitchen, store, office, hotel) with their own address, licences, time zone and extra punching gates, and **stock locations** inside a branch.
- Each branch has **managers** and an **HR person**; each region has **area managers**. The head of a department can be set per branch.
- **Open a branch by copying another** (kind, region, entity, locations, approval steps, its place on checklists — never people) and **close one safely** (its people and open work move first; history keeps pointing at it).

**Who sees what**
- A role has a **reach**: own records, my branches, my entity or the whole group. It is enforced inside the database client, next to company scoping, so every list, count, report, export, Ask answer, API key and webhook follows it; a test fails if a new table with a branch is not listed.
- **Branch switcher** in the top bar: all my branches, or one branch, one region or one entity. It only ever narrows.
- Every task, checklist run, slip, ticket, process record, paper, purchase order, sales order and record **carries its branch**. Master rows and records can be for one branch or for the whole group.
- An **outlet manager manages only their own branch's people**; the structure and group settings stay with the group.

**Who approves** (System Master → Branches → Who approves) — the owner's choice (plan decision 14)
- For each kind of request (leave, attendance corrections, stock adjustments, help slips, ticket escalation) an ordered ladder: branch manager, area manager, department head, branch HR, HR person, owner or a named person. A step can be skipped when nobody holds it, can "go up after N hours", and can start "from an amount". A branch or an entity can have its own ladder. One answer decides; nobody decides their own request; the owner always can. With no ladder set, each module keeps its old rule.
- New notification recipients: branch manager, area manager, branch HR, department head at the branch.

**Work per branch**
- A process step goes to its doer **at the record's branch**, then the region, then elsewhere — and says so on the record when it leaves the branch.
- **One checklist template, a run per branch**: its own people, its own due time, its own clock.
- The flow designer's people (slip receiver / approver, ticket coordinator, verifier, EA) can differ **for one branch**.
- **Outlet comparison** (Systems): attendance, checklist misses, ticket fix time and on-time work side by side, ranked.
- System Master's people cards and health check follow the branch being looked at; a new check names branches without a manager.

**People across branches**
- **Branch history**: a move takes effect from a day (past, today or planned). Attendance days carry the branch of the day; **payroll splits a month's gross** between the branches by days.
- People **punch at any of their branches** and gates; staff can be **lent to another branch** for dates (they see its work, punch there, and their cost goes there).
- HR rules can differ by entity and by branch; holidays can be for a country, a state, an entity or a branch; leave days a year can differ by entity; "Buddy from another branch" is a rule; the cover board and the morning report are per branch.
- **Pay rules and minimum wages per entity** (typed by the accountant — nothing built in); **payroll is worked out and closed entity by entity**.

**Papers, currencies, clocks**
- A document type can number **per entity or per branch** (`INV/RJ/26-27/0001`); the company-wide series is untouched. Papers print the right entity's name, address, tax number and licences, the branch, and the entity's legal line.
- Each entity has a **currency** (minor units + code; rupees keep lakh / crore). Payroll is in the entity's currency; the group total is in rupees by **one exchange rate per currency per month**, typed by an accountant — a month with no rate is said, never guessed.
- Each branch can have its own **time zone**: shifts, attendance, absence alerts, checklist times and quiet hours follow it.

**Franchises**
- A franchise entity is **walled off**: its people see only their own franchise's work, people and branches, whatever role they hold. Group people see franchises only with the **franchise oversight** right (Roles → Franchises).
- **Brand content** (masters, checklist templates) can be shared with franchises read-only.
- **Royalty**: a share of the month's sales and / or a fixed fee, never under the minimum guarantee; one invoice a month (`ROY/26-27/0001`).
- **Brand audits**: an auditor scores an outlet point by point; every failed point becomes a proof-required task for the outlet's manager.
- **Renewals**: licences and franchise agreements are chased 30 days before, 7 days before and on the day.
- **Exit**: everything of one franchise (data and files) as a package, then archive.

**Also fixed**: the process-step watcher looked at only the first 1,000 open steps; it now pages through all of them.

**Not in this phase (said so in the coverage rows)**
- Screens for lending staff, dated moves, extra punching gates, minimum-wage tables, tax rates, royalties, brand audits, the franchise exit and the "share with franchises" switch — these work through the API and are tested there; the screens come next.
- Tax is not computed on lines, and purchase / sales order numbers are still company-wide: both belong to the money core (Phase 12M).
- Stock per location, transfers and central kitchens are Phase 13 (row G45).
- Process step due times still use the company's clock; the report builder does not convert currencies.
- Hindi strings are machine-drafted (decision 14).

## Phase 11 — Linked fields, record types and reports (12/11/2026)

What lets any industry fit its own work into MONO without code. Plan: `docs/plans/hospitality-100-plan.md` §2; the
29 rows that define "done" and the test that proves each are in `docs/plans/coverage.md`.

**Fields that remember, link and work things out** (every form: process start forms and steps, master rows, records)
- **Remember what people type**: a text field becomes a dropdown of the values already entered, most used first, with **Write…** as the last choice. A named shared list can be used by fields in different forms. **Masters → Lists**: rename, merge and hide values (old records keep what they said); "only admins add" makes the field a strict dropdown.
- **Choices from another process**: a dropdown offers the values typed in a field of another process, or a whole record of another process (`#12 · Sharma wedding · 14/12/2026`), limited to a step, to running records, to the person's own, or to the last N days.
- **A picked value keeps its link**: renaming the row never breaks it, and the record shows the new name. Links are stored beside the text (`_refs`), so everything that read the text before still works.
- **Unique** fields (a second live record with the same value is refused; cancelling frees it), **auto-fill** (pick an item → unit and rate fill; locked or editable), **dependent choices** (pick an Outlet → only its Tables).
- **Formula fields**: `qty * rate`, nights between two dates, the sum of item lines, percentages — worked out on the server by a small safe language (never `eval`), shown live in the form, checked on Publish.
- **Item lines pick from the item master** (code or name) with unit, rate and live stock; typed items only where the form allows.
- **Stock on any step**: a step can issue, receive or transfer stock, from / to a fixed place or one taken from a field, with a preview before "Mark done". Not enough stock blocks the step, or (by setting) lets it through flagged for approval. Sending a record back past the step, or cancelling it, reverses the stock with new moves.
- **Show values anywhere**: one path language — `field`, or `field.column` for a column of the row a field links to. Live FMS shows up to six chosen values per record (**Columns**), KPI cards total formula fields and numbers of linked rows, document header / terms / footer fill `{{field}}` and `{{field.column}}`, and process messages can say `{{data.field}}` and `{{data.field.column}}`.

**Record types** (Masters → Record types)
- A company's own things — a site visit, a prescription, a trip — set up from screens alone: fields, child tables, a number series `{PREFIX}/{FY}/{0001}`, statuses with allowed moves and who may make each (run through the shared `transition()`), a place in the left menu, and view / create / edit / approve rights per type.
- Each type gets its own list (search, filters by any field, sort, saved views, cards on phones), a drawer with Notes, History and Files, import with every problem by line, and export to CSV / Excel.
- Records link to records of other types and to customers, items and masters; they can be picked in any form.
- **A move can start a process**: its start form is filled from the record; if the process can't start, the move is refused.
- `record.*` events drive notification rules (status changed and note → the record's maker), webhooks, and the public API: `/api/v1/record-types`, `/record-types/:id/records`, `/entries/:id`, `/entries/:id/move`.
- **Build with AI**: describe the record type; the editor opens on the AI's draft, unsaved, for a person to check.

**Reports** (Systems → Reports)
- A field marked **reportable** keeps a typed, indexed copy (text, number, day, link) written with the record. Marking a field later copies the existing records in the background; the report says so until it is done.
- **Report builder**: a process or a record type → columns → filters → group (text, or dates by day / week / month / quarter / financial year) → totals (count, total, average, lowest, highest) → table, bars, line or pie. Save, share with roles (view only), export Excel / PDF / CSV, and **send it by itself** every day, week or month.
- Reports never run SQL made from what people type: names are checked against the source, values are bound, the company is always in the query, and a reader sees only what they may see in the source.
- **Ask** can answer from a saved report the person may open.

**Under the bonnet**
- One form pipeline on the server (`apps/api/src/modules/forms`): links → item lines → lists → formulas → unique → reportable copies, used by every form.
- The request ceiling counts per signed-in person (many people behind one office address are no longer refused together), with a flood guard per address.
- New modules in the Roles matrix: **Records** and **Reports**. Built-in roles of companies made earlier get their default rights when the server starts, where a role holds nothing of the module yet.
- Webhook picker: "whole module" choices (`master.*`, `list.*`, `record.*`) now match their events.
- Migrations: `phase11_lists`, `phase11_records`, `phase11_links`, `phase11_stock_steps`, `phase11_live_columns`, `phase11_reports`.

**Checked how**: 507 unit / API tests; 22 browser tests of the new screens on a phone and a desktop (`e2e/phase11-*.spec.ts`), with screenshots in `docs/screenshots/phase11/`; the older browser suite still passes on the merged code. Run the browser tests with `LOGIN_RATE_LIMIT=1000` in `.env` (they sign in many times).

**Not in this phase** (said plainly): Hindi strings are machine-drafted and need review (decision 14); PDFs still use Helvetica, so ₹ and Hindi do not print in report PDFs; KPI cards do not yet read saved reports; child lines of records are not imported, searched or reported on; "Build with AI" for record types is tested with a scripted model, not yet against a live key.

## Fix — leftover "arrives in phase N" notices replaced (09/11/2026)

Five spots still showed a placeholder for features that were already built. Each now works:

- **Delegation sheet → FMS report**: this week's process steps per person and per process, with the same week picker as the Scorecard: due this week, done, on time, late, still open, on-time %, and CSV export. Each step counts once: in the week it was done, or, while still open, in the week it fell due. Steps of records on hold don't count. Admins see everyone, HODs their team, everyone else themselves. A process name opens it in Live FMS. API: `GET /api/fms/reports/people?at=`.
- **AI assistant button** (bottom right): asks questions through the same Ask as Home, with example questions and a "Build a process with AI" link for people who can edit flows. If AI isn't connected it says so, with a Connect AI button for owners and admins.
- **Phone "+ Capture"**: one line onto the EA board for the board's owner, its EA and EA editors, plus shortcuts to give a task, raise a help slip or raise a help ticket (each shown only with the right to do it).
- **Org chart → a person → Open work**: their open tasks, checklist runs, process steps and help tickets, late ones first, each opening where it lives. API: `GET /api/work/people/:id/open` (admins anyone, HODs their team, everyone else themselves).
- **Users → tick people → Send Telegram codes**: sends link codes to the ticked people who aren't linked yet (people without a mobile or email get their code shown to hand over). Shown only with Integration admin rights.
- **UI kit → Theme playground**: "Save as company theme" saves the theme for everyone and keeps the logo, app name and defaults from Appearance.
- The assistant and capture panels close when a link in them opens another page.
- **Weekly MIS → FMS steps on time** is filled in (screen, phone cards, Excel, PDF) with the same counting as the FMS report, and counts towards each person's score. People with no process steps that week aren't marked down: the score averages only the parts with data.

## Fix — accidental password reset and owner lockout (09/11/2026)

- **Reset password asks first** (System Master → Users, table and cards): "Reset {name}'s password?" says they are signed out on every device and their password stops working. Before, a double-click on the Add people backdrop could close the dialog on the first click and reset the row behind it on the second, with no question.
- **No resetting your own password** from Users: the API refuses it (`POST /api/org/users/:id/reset-password` → 400, "Use Profile → Change password"), and your own row's key icon opens Profile instead.
- **Add people → One by one closes after a successful add** (like Paste a list), with a "{name} added" toast. Adding many people at once is what Paste a list is for.
- **Locked-out owner recovery from the server**: `./deploy/compose.sh exec api node apps/api/dist/reset-password.js <mobile-or-email> [--company <slug>]` (dev: `npm run reset-password -- …`) gives a one-time password, turns login on, signs the person out everywhere and writes the audit log. See INSTALL.md → Troubleshooting.
- **The seed refuses a weak owner password** when it creates a company (8+ characters with a letter and a number, the same rule as Change password). An existing company ignores it, so restarts never fail.
- `passwordChangedAt` stays "when the person last chose their own password": a reset (one-time password) doesn't set it; Change password does.
- The Add people button has an accessible name on phones (icon only there).

## Phase 10 — Masters, public API, Google Drive, PWA, hardening (05/11/2026)

**Masters**
- **Master Library** (Masters → Master Library): 12 ready masters by industry (Vendors, Products, Raw materials, Machines, Spare parts, Vehicles, Sites, Transporters, Services, Brands, Stores, Documents). "Use this" makes it yours, fields and all.
- **Rows** for every master (My Masters → Open): add, change, delete (the key is freed), search; a unique key per master and a display field.
- **Import** from an Excel file, a CSV, a paste, or a **Google Sheet link** ("anyone with the link can view"): headings by label or key, DD/MM/YYYY dates, yes/no and lists understood; all or nothing, every problem named by line.
- **"From a master" fields** in processes now search Customers, Items, Vendors, People or any master of your own as you type. Dates in forms must be real calendar dates (31/02 is refused).

**Public API and webhooks** (System Master → API Keys)
- The server address, **API keys** shown once (only a hash is kept), last used, revoke. A key acts as the person who made it, with that person's current rights.
- **`/api/v1`**: me, customers (list / add / change), items, stock moves, orders (list / take), processes (list, start a record, read it, mark a step done), masters and rows. 120 calls a minute per key. OpenAPI docs at `/api/docs` (production shows only the public API) and `/api/v1/openapi.json`.
- **Webhooks**: pick events (one by one, `crm.*`, or everything) → signed JSON posts (HMAC-SHA256 over timestamp + body), retried after 30 s, 2 min, 8 min, 32 min and ~2 h, then failed; a delivery log, "Send a test", "New secret". New data events: customer added / changed, order taken / cancelled, payment received, stock moved, master rows.

**Google Drive** (System Master → Integration → Google Drive)
- "Where your files go", the four guided steps with ticks (project + Drive API, consent screen with the `drive.file` scope and publishing, OAuth client with the exact redirect address to copy, Client ID + secret → Connect Drive) and a FAQ.
- Only the owner connects. New uploads are saved on the server, then moved to the "{APP} Files" folder about a minute later; older files stay where they are; everything still opens from MONO. "Stop sending files" keeps new uploads on the server.

**Phone app (PWA)**
- An install card ("Install MONO on this device") with the browser's own install, or the Share → Add to Home Screen steps on iPhone; hidden once installed or closed for 30 days. (Push opt-in and the offline punch queue were already in place.)

**Hardening**
- Security review against the OWASP Top 10 (`docs/security-review.md`).
- Content-Security-Policy, HSTS and Cross-Origin-Opener-Policy on the web app.
- Uploads must really be what they claim (file signatures checked); renamed programs and web pages are refused.
- Outgoing calls (webhooks, FMS webhook steps, the WhatsApp provider address) can't reach the server's own network.
- A ceiling of 600 API calls per IP per minute in production, on top of each route's own limit.
- **Error monitoring**: server, worker and browser errors are grouped, counted and shown in System Master → **Errors** (mark fixed; it reopens if it happens again). A crashed screen says so and offers Reload.
- A start-up check warns when `APP_SECRET` can't read the saved secrets (e.g. after restoring with a new `.env`).
- **Load test** (`deploy/k6/`): 50 people at once — results in `deploy/k6/README.md`.

**Backup and restore**
- `./deploy/restore.sh` lists the backups and restores one (database + uploaded files), starts MONO and prints a summary.
- INSTALL.md: keep `.env` safe, restore from a backup, **restore on a new machine** step by step, and a drill log.

**Guides and Support**
- Printable user guides for every module in `docs/guide/` (getting started, delegation, checklists, slips and tickets, EA and MIS, processes, HR, inventory, sales CRM, masters, System Master, integrations and API).
- **Support** page (the last placeholder): the company's contacts and admins (tap to call / email), Raise a help ticket, and every guide readable in the app with a Print button.
- `NEW_SETUP_PROCESS.md` (a new PC with WSL Ubuntu, command by command) and `FEATURES.md` (every feature, its setup and what it depends on).

**Checked**
- Load test on the Docker stack: 50 users for 3 minutes, 9,972 requests, 0 failed, p95 23 ms (reads) / 41 ms (writes).
- Restore drill: last backup restored with `restore.sh` into an empty data folder in 35 s — companies, people, tasks, the uploaded file (same checksum), sign-in and API keys all back.
- The production build passes the new end-to-end tests with no Content-Security-Policy violations.

## Phase 9 — Sales CRM (05/11/2026)

**Plan & setup** (Sales CRM → Plan & setup): the 15-page journey, with the FY, the plan's status and progress ("x of 15 pages done").
- **Plan the year:**
  - **Year target:** last year's turnover and GP, then grow by % or type an exact amount, plus the margin and the rounding; with month and week figures and last year against this year.
  - **Quarters:** each quarter's growth over the one before; fine-tune with − / +.
  - **Months:** shaped by working days, seasons and growth inside each quarter. "Change October" asks whether to change the year total or keep it and adjust the other months.
  - **Weeks:** Monday–Sunday, part weeks joinable; a day-by-day dialog (equal, or ± % per day).
  - **Every level adds up to the paisa:** one exact split (largest remainder, whole ₹1,000 / ₹10,000 / ₹1 L units when rounding) is used throughout. It is proved by property tests over thousands of random plans, plus a two-way split for the seats × months table.
- **CRM configuration:**
  - business type; whom you sell to; seats & people (11 seats, one person may hold several);
  - target split: CRR / NBD share, the owner's own clients, each person's month-by-month target and a science check;
  - customer rules (new / sleeping / lost / vampire);
  - after the order: the steps are published as a real FMS flow, and each step's doer is whoever sits in its seat;
  - NBD: lead sources, enquiry form fields, qualify questions, stages with planned days.
- **Settings:**
  - holidays and weekly off (the HR calendar, shared);
  - seasons (peak / good / slow, with a "year at a glance" strip);
  - round figures.
- **Approval:** send for approval → the owner approves (or sends back) → approved plans are locked until unlocked ("It will need approval once more").

**Daily screens**
- **Dashboard:**
  - this month's target, achieved and pace, gap and working days left;
  - tiles with 30-day sparklines and the change on last month;
  - revenue against target by month, and how much of the year is done.
  - "Viewing as" a seat or a person; people without CRM rights see their own.
- **Customer Master:**
  - GP rank and 12 months' sales and GP;
  - automatic tags (top / bottom 20%, new, sleeping, lost, vampire, owner's) and your own tags (name + colour), with the 80/20 check;
  - the customer card shows the SCOT rhythm, orders for 12 months and a new order;
  - add, edit, import.
- **SCOT sheet:**
  - each regular customer's rhythm from their orders (average order, usual gap, usual date of the month, next order due, the day to call — N days before, moved off holidays);
  - calls per day for 30 days, and SCOT against the CRR target.
- **Today's Calls:**
  - made each morning: SCOT calls when their day comes, and win-back calls for sleeping and lost customers;
  - cards or a grid; one-tap results: order taken (→ CRM Orders + the after-order flow), call later, not now (next cycle), lost (why → win-back).
- **CRM Orders:** a kanban by after-order step. A card opens the order's FMS record, where the step is done; orders finish when the record closes.
- **Collections:**
  - receivables by age, with payments set against the oldest orders first;
  - due today, promises (and broken ones), the follow-up log, payments;
  - statements sent to the customer (WhatsApp / email).
- **NBD funnel:**
  - enquiries to qualify (every question yes, a value, the next action and its date);
  - a stage kanban with days in stage against the plan (stuck), next actions;
  - won (→ a customer) or lost.
- **MeCA / MCAP:** each sales seat's weeks — new leads, conversion, average sale, calls made against planned, orders against the week's target — graded R/Y/G.
- **System Master → Sales CRM:** your own fields per record type (lead, quotation, customer, order).

**Messages:**
- `crm.call_due` to the SC for a new SCOT call;
- `crm.lead_assigned` and `crm.lead_stuck` (once per stage) to the lead's owner;
- `crm.customer_sleeping` once a customer goes quiet;
- `crm.payment_due` (the statement) to the customer.

**Also**
- The HR holidays screen sizes to the space it gets (it also sits inside the CRM journey).
- A new `MONTHS_EDITED` error asks before a change works hand-set months out again.

**Demo data:**
- an approved FY 2026-27 plan: ₹5 Cr + 50% = ₹7.5 Cr, rounded to ₹10,000, adding up to the rupee;
- seats filled; the after-order flow published;
- 24 Rajasthan customers with 13 months of orders and payments (every rhythm, sleeping, lost, vampires, the owner's own);
- running orders on the kanban, 20 leads across the funnel, today's calls.

## Phase 8 — Inventory (IMS) (04/11/2026)

**Rules** (System Master → Inventory), with the defaults of CLAUDE.md §10.1:
- **MAX & review:** daily use from the last 120 days (90 / 120 / 180); review every 15 days; raise the safety factor after 3 red days; lower it when purple for 50% of the period; step 0.25; lowest 1. MAX = average daily use × lead time × safety factor.
- **OWS & purchase:** the order day (Monday) and how many days ahead the list opens (1). Order quantity = MAX − (stock + on order).
- **Turns & NOS:** NOS under 10 turns a year; NOS target 50% of stock value; turns growth 26% a quarter; the bottom 20% offered for stopping.
- **Audit & dead stock:** the top 50 items by value counted every 30 days; dead after 365 days without movement.
- **Who does what:**
  - store keeper, purchase, reviewer, audit coordinator;
  - who approves stock adjustments, with the rules "any one of them", "never their own" and "the owner always can".

**Item master** (Inventory → Stock → Item master)
- Each item has: code, name, unit, category, location, lead time, safety factor, MAX, min, rate and vendor.
- Opening stock can be entered with the item.
- **Import from Excel:** paste from Excel or Google Sheets, or open an .xlsx or .csv file. Columns are matched by their headings in any order. Every problem is named by line, and nothing is saved until all lines are right.
- An item can only be removed when it has no stock and nothing on order; its moves stay in the IMS sheet.

**Stock**
- **Stock today:**
  - every item with a red / yellow / green / over-MAX band, a bar of stock against MAX, and what's on order;
  - the stock value, a search box and band filters.
- **Stock moves:**
  - receiving stock, issuing it and transfers apply at once;
  - adjustments (damaged, expired, lost, found, audit count) wait for an approver;
  - stock never goes below zero: the check and the change are one database statement, so two people issuing the last unit can't both succeed.
- **The IMS sheet:** every in and out in one list, with the balance after each move. It can be filtered by kind and dates.
- **To approve:** pending adjustments, with Approve / Reject for whoever may decide.
- **Alerts:**
  - an item turning red tells purchase, with the quantity to order;
  - going over MAX tells the reviewer.

**MAX review** (Inventory → MAX review)
- Each morning, items not reviewed for 15 days get a proposal. The proposal is based on the average daily use in the window and the daily bands (the worst band each day saw): the safety factor goes up after enough red days, down after enough purple days, and MAX is worked out again.
- The reviewer can apply one proposal or all of them, set their own safety factor (MAX is worked out from it), or skip.
- Items with no use in the window keep their MAX; they show as slow or dead stock instead.
- "Review now" makes the proposals straight away.

**Purchase** (Inventory → Purchase)
- **Order list (OWS):** on the order day (and N days before), every short item (stock + on order below ⅔ of MAX, or under its minimum), red ones first.
  - Untick lines or change quantities, then make the orders: one draft per vendor.
  - Purchase hears when the list opens.
- **Purchase orders** (`PO/26-27/0001`):
  - draft → sent → part received → received, or closed short, or cancelled (only before anything arrives);
  - receiving goods books stock in at the order's rate;
  - more than ordered can't be received on the order; extra goes in as a separate stock in.

**Audit** (Inventory → Audit)
- **Counts:** each cycle the most valuable items in stock are listed to count. A difference becomes an audit-count adjustment that waits for an approver.
- **Dead stock:** stock that hasn't moved for 365 days, with its value. The owner hears once a month.

**Reports** (Inventory → Stock → Reports)
- **Stock value** by category.
- **Movement** in a period (in, out, adjusted, out value).
- **Turns & NOS:**
  - turns per item, scaled to a year for items tracked for less;
  - NOS share against its target;
  - company turns for the last 90 days against the 90 before and the growth target;
  - the slowest items, offered for stopping.
- **Purchase** by vendor (ordered and received).

**FMS:** an AUTO step can now post stock.
- It issues a record's item lines out of stock, or receives them in.
- Items are matched by code or name. A line that can't be posted (unknown item, not enough stock) is noted on the record, and the rest still go.

**Also**
- New notification `ims.ows_ready` ("Order list ready") for purchase, beside the five §7.3 inventory events.
- The people picker from the FMS builder is now shared (`components/people-picker`).

**Demo data:**
- 50 items for a quartz-slab plant, with 120 days of issues and receipts and the rules' people. A few items are red and a few over MAX.
- 16 MAX reviews due, purchase orders in each state, a damage adjustment to approve, this cycle's audit counts, and two dead items.

## Phase 7 (added) — Work patterns, night shifts, pay from attendance (04/11/2026)

**Night shifts that cross midnight**
- After midnight the punch card still shows the night shift that started the evening before (it used to show a new, empty day).
- Absence alerts and the cover board also count a running night shift from the day it started.

**Work patterns, per person** (HR → Payroll → People)
- **Fixed shift** (as before).
- **Hours a day** (e.g. 8 h, any time): nobody is late. Less than half the hours = absent, less than all = half day, more = overtime.
- **Hours a week** (e.g. 48 h, Monday–Sunday): short weeks are cut by the pay rules, extra hours are overtime. The attendance month shows each week's hours against the target.
- Hours a day / a week can have a "latest time to start": not in by then on a working day = absent (the HOD is told).

**Pay from attendance** (HR → Payroll; HR only, gross pay)
- Each person is paid by the **month**, the **day** or the **hour**, at their own rate. Without one, the salary in their HR details counts as a monthly rate.
- **Pay rules** (company-wide, with overrides for a team, a designation or one person; the most specific wins):
  - a month's salary is for all days of the month (Sundays and holidays are paid days), working days only, or a fixed number (e.g. 26). This sets one day's pay;
  - weekly offs and holidays are paid, or not;
  - working on a weekly off or holiday gives a comp-off (the default, as before), extra pay (× a day's pay, e.g. ×2), a fixed amount, or nothing. Half a day counts half. A comp-off is earned only when that is the rule, so nobody gets both;
  - overtime pay at × the hourly rate (default ×2);
  - every N late days cut part of a day's pay (off by default);
  - hours short of a week are cut at the hourly rate, or not.
- **Month's pay:** a card per person with the counts (present, absent, leave, days off worked, late, overtime). Opening a card shows every line behind the pay (salary, days not paid, extra for a Sunday worked, overtime…). Includes a search box and a CSV download (opens in Excel).
  - Days before joining are not paid (the joining date in HR details, else when they were added).
  - A day with no attendance record at all (before MONO was used) doesn't cut a salary and doesn't pay a day wage; the card says how many such days there are.
  - A running month counts up to yesterday.
- **Close the month** once it has ended: the figures are kept as they are, whatever changes later. **Open again** needs a reason; the closed figures stay in the audit log.
- **Not included:** PF, ESI, TDS and other deductions. Payroll statutory logic must be confirmed by the company's accountant before go-live (CLAUDE.md §9.2).

**Leave a year by designation or person** (HR → Payroll → Leave a year)
- E.g. machine operators 6 CL, sales executives 10 CL, one person 12.5. Everyone else gets the leave type's number. This year's balances change at once.

**Fixes found on the way**
- An override (HR rules or pay rules) that changed one answer also reset every other answer to its default: zod's `.partial()` fills in defaults. Overrides now keep only what they change (`overrideOf`).
- A rule set that failed validation inside a service came back as a 500; it is now a 400 with the problem.
- The joining and birth dates in a person's HR details used the browser's date picker; they now use MONO's DD/MM/YYYY input.

**Demo data**
- Pay for Demo Industries: monthly salaries by role, daily wages for operators and fitters, an hourly inspector, Neha on 8 hours a day, Nikhil on 48 hours a week. Pay rules: calendar month with Sundays paid, a Sunday worked pays a day extra (operators twice), overtime ×2, every 3 late days cut half a day. CL: operators 6, sales executives 10.

## Phase 7 — HR: rules, attendance, leave, Buddy, cover board (04/11/2026)

**HR rules wizard** (System Master → HR rules)
- The 7 steps of CLAUDE.md §9.1 with their defaults:
  1. late & half day;
  2. punches & overtime;
  3. leave & HR;
  4. Buddy;
  5. the Buddy's answer;
  6. autopilot;
  7. check & save, grouped, with a Change link on each group.
- Each answer is preset chips plus a −/+ stepper for any other value.
- "Different for a team or person": a department or one person can have their own grace minutes and away-from-office rule.

**One calendar** (HR → Leave → Holidays)
- Holidays and weekly offs (Working / Half / Off per weekday, for the company or a branch) now drive everything: FMS due times, checklist runs, leave days and attendance.
- With no weekly offs set, the default shift's working days still apply, so nothing changes for companies that haven't set them up.

**Attendance** (HR → Attendance)
- Punch in / out on the phone:
  - the location is checked against the branch's geofence, and a punch away from the office is blocked or flagged by the rules (a flag tells the HOD);
  - a selfie is taken when the rules ask for one;
  - punches made with no connection are kept with their time and sent when the phone is back online.
- Before the day is settled, the screen shows "At work" / "Not in yet", not a provisional "Half day".
- Each day is settled two hours after the shift ends: Present / Late / Half day / Absent / On leave / Holiday / Weekly off, with the reasons ("40 min late", "No punch-out: half day until a correction"), plus overtime and comp-offs.
  - Night shifts count on the date they start.
  - A missed punch-out tells the person.
  - Days before someone joined are never marked.
- My month: a calendar of days with a colour per status; tap a day to see why, and to ask for a correction.
- **Corrections:** limited per month by the rules (3 by default); the HOD or HR approves, and the day is settled again.
- **Team:** one day for the team (HOD) or everyone (HR): in and out times, status and flagged punches.
- **Biometric import (HR):** a device CSV with code or biometric id, DD/MM/YYYY HH:mm, and IN/OUT if given (else first = IN, last = OUT). Repeats are skipped; unknown codes and impossible dates (31/02) are reported.

**Leave** (HR → Leave)
- Leave types: CL, SL, EL, Comp-off and LWP, with yearly quotas and carry-forward, editable.
- Balances per leave year (April or January). Comp-off = days earned by working half a day or more on a day off, within the validity window.
- Apply: kind, first and last day, half day, reason (Dictate works). Only working days are counted. Overlaps and over-balance requests are refused.
- The form lists **your open work in that period**: tasks due (late ones too), checklists that fall due, FMS steps you hold. Each piece gets a Buddy, the company's suggestion order first:
  1. the step's backup;
  2. your default Buddy;
  3. the least busy free person in your department;
  4. your HOD.
  People away, or already covering the most they may, aren't suggested.
- Buddies are asked on Telegram with **Yes, I will cover / Can't** buttons, and on the web under Buddy requests. An answer is due within the rule's hours; with the autopilot on, a no (or no answer) asks the next person.
- The HOD gets the request on Telegram with **Approve / Reject**.
  - "Block approval" refuses while any work has no Buddy.
  - "Warn only" approves and marks it.
  - The autopilot can approve a short leave by itself once everything is covered.
  - Nobody approves their own leave.
- Calling off a leave gives covered work back at once and returns the days.

**Buddy cover and the cover board** (HR → Cover board)
- When the leave starts, the work moves to the Buddy and shows **Covered by …**. That applies to tasks, FMS steps and checklist runs; new checklist runs during the leave are made for the Buddy.
- When it ends, the work goes back by the rule: **work not started goes back** (the default; anything the Buddy did on it counts as started), all of it goes back, or the Buddy keeps it.
- **Absent without leave:** someone who normally punches and isn't in by the half-day mark is absent. Their HOD is told which work has no Buddy, and the owner too after the confirm time. With the autopilot, the work goes to the first suggested Buddy.
- The cover board shows today's absentees and people on leave, their open work, and who covers it (covered, asked, or nobody). One click gives a piece to the suggested Buddy, or gives everything to someone.
- **08:30 morning report** to the owner, HR and the HODs: who is away and which of their work has no Buddy.

**Demo data** (`npm run seed:demo`)
- Weekly offs, a geofence on the plant, and two weeks of punches (a few late, one missed punch-out, one absence).
- Arjun Rawat on leave today and tomorrow, his task and process steps covered by Sunita Bansal.
- Pooja Jain's leave waiting on her Buddy, and a correction waiting for the HOD.

**Fixes found while testing**
- Plain dates in messages (a leave's first day) showed as 2026-11-06; every message now shows DD/MM/YYYY.
- A biometric line with the code "EMP-003" was taken for the header row and skipped.
- "31/02/2026" was read as 3 March; impossible dates are refused.
- The HOD was counted twice in the Buddy order (as "a free person in the department" too); they come last.

**Verified**
- 249 unit/integration tests (35 new):
  - the attendance rules with fixed punch data (grace, half day, missed punch-out, overtime, night shifts, leave, comp-off) and the geofence;
  - the rules defaults and overrides; leave days, Buddy order and the three state machines;
  - the API: punches, settling, corrections and their limit, biometric import, balance/overlap/days-off checks, "Block approval", autopilot, cancelling, absence, the cover board, the morning report and permissions.
- **Phase 7 acceptance, end to end:**
  1. Asha applies for leave with two open tasks.
  2. Her Buddy Ravi is asked on Telegram and taps "Yes, I will cover".
  3. The HOD approves from Telegram.
  4. When the leave starts, both tasks show "Covered by Ravi".
  5. After it ends, the task Ravi never touched goes back to Asha, and the one he started stays his.
- 42 browser tests pass (4 new): every HR screen fits at 380 px and 1440 px; leave across three people's browsers (apply → the Buddy says yes → the HOD approves); the rules wizard saves; a phone punch inside the geofence.
- Production stack: the `hr` migrations apply, the HR routes answer through Caddy, the worker's HR sweep runs, and the logs are clean.

## Phase 6 acceptance on DeepSeek (04/11/2026)

- **DeepSeek is a provider choice** (System Master → Integration → AI). The address (`https://api.deepseek.com`) is built in.
  - Models: `deepseek-flash` (default, $0.30 in / $1.20 out per million tokens at peak) and `deepseek-v4-pro` ($1.32 / $3.96).
  - Estimates use peak prices; off-peak is half (weekday peaks are 06:30–09:30 and 11:30–15:30 IST).
- **A DeepSeek model chosen under "OpenAI" without an address is now refused** with a clear message. Before, the key went to OpenAI and failed as "key not accepted"; that is what happened to the first GGM setup.
- **Build with AI prompt version 2** (`build_flow@2`, `edit_flow@2`; version 1 kept on file):
  - every step except automatic ones gets a person (a decision goes to whoever knows the answer, an outside wait to whoever follows up);
  - a branch that "closes the lead" points to the end instead of adding a step to close it.
- **Acceptance met:** the Lead to Order description became a valid 12-step flow (decision, price approval with its reject route, automatic thank-you), with every step assigned. It opened in the builder, in the browser test, in 17 seconds.
  - The other four examples have no broken branches. The only open points are roles that aren't one person ("HOD", "Customer care"); a person picks those in the builder.
  - The five DeepSeek answers are recorded in `evals/fixtures/deepseek-flash/` and checked again by every `npm test`.
- Cost of today's 13 DeepSeek calls (tests, five drafts, two runs, repair rounds): about $0.09. One Lead to Order draft: about 6,600 tokens in, 4,800 out, $0.008.
- The dev database got the rule for the new 08:45 summary event. The GGM owner's first AI-written summary arrives tomorrow at 08:45.

## Phase 6 — AI layer (03/11/2026)

**Connect an AI** (System Master → Integration → AI)
- Pick Anthropic (Claude), OpenAI (or a compatible server), Google Gemini or Ollama (a free model on your own machine).
  - The default model is Claude Opus 5.5. MONO knows the prices of the Claude models; for any other model you can type the price per million tokens.
  - The key is stored encrypted and never shown again; the screen shows only its last 4 characters.
- **Test** makes one tiny call and keeps the result.
- "This month" shows calls, tokens and the estimated cost per feature, plus the latest calls. Every AI call is logged with its feature, prompt version, tokens, time and cost.
- Speech to text: the browser (free, Chrome) or OpenAI Whisper / Gemini (Hindi and English).
- A switch for the daily summary.

**Business details** (System Master → Business details)
- "Your business, in your words": what you make, your customers, how an order moves, who does what… Every AI request includes it.
- A quality meter with the word count ("Very good · 521 words").
- **Refresh with our AI** rewrites it from the current text plus what MONO's data shows (departments, processes, papers…). The new text is shown for review and saved only when you press Save.
- **Update it with ChatGPT**: copy a ready prompt, paste ChatGPT's answer back. Nothing is sent anywhere by MONO for this.
- **Remember this for next time?** After a draft, the AI suggests short facts; the ticked ones are added to the business details.

**Build with AI** (FMS Builder → Build with AI)
- Describe how the work goes, by typing or speaking, in English, Hindi or Hinglish. A counter shows "x/30 words".
- Optionally give a name and a department. Five examples fill the box: Lead to order, Order to dispatch, Purchase request, Customer complaint (Hindi) and New employee joining.
- "Your flow, drafted by AI" shows:
  - the summary ("11 steps · 5 start fields · 14 step fields · Everyone is assigned");
  - names it could not find in MONO;
  - the flowchart, with red marks on steps to fix.
- From there:
  - ask for changes in your own words;
  - **Open in the Builder** creates a draft process (your description becomes its "how it works" text).
- Names are matched to real people: the full name, a unique first name ("Neha"), or a unique designation ("store keeper"). Ambiguous names (two Ravis) are left for you to choose.
- MONO checks every draft. When it finds problems it can name (a step without a time, a branch to a step that doesn't exist, a step nothing leads to, no way to the end), it asks the AI once to fix them and keeps the better version.
- It also corrects common slips by itself:
  - a step that only says "End" is dropped;
  - a task with Yes/No routes becomes a decision;
  - an approval's Yes/No become its approved / rejected routes.

**Edit with AI** (in the process editor)
- Say the change ("add a quality check after packing; Ravi does the invoice"), or use the quick changes: Add approval step · Add photo proof · WhatsApp update · Make it shorter.
- You see what would change (new steps, removed steps, and which part of a step changes: who, time, form, route…). **Apply** or **Try again**.
- Details the AI doesn't handle stay as they were: backups, date-field timing, documents, field help.

**More AI**
- **Suggest with AI** on the Dashboard tab proposes KPI cards. Only fields that exist are used, and only number fields are added up.
- **Masters:** *My masters* lists the company's masters; *Build a master with AI* proposes the fields to check and save; you can also make one by hand. Rows, Excel import and the Master Library come in phase 10.
- **Ask** (Home search): type a question ("who has the most late tasks?"). The answer is a sentence plus the rows behind it, each opening its record.
  - The AI only fills in a plan over six read-only views (tasks, checklists, tickets, process steps, process records, people). MONO checks every name, binds every value, adds the company, and runs it read-only with a 5-second limit.
  - People without AI admin rights see only their own work.
- **Dictate:** every mic button uses the company's speech-to-text when it is set up, else the browser's.
- **Daily summary:** the owner gets a short message at 08:45 (company time): yesterday's work, what is late now (with names), what is due today. Telegram by default, once a day, only when AI is connected.
- **AI follow-up:** a switch on any notification rule lets the AI write a short, polite chase in the person's language for Telegram and email. WhatsApp keeps its approved template, and the template is used whenever the AI has nothing.

**Fixes found while testing**
- A rate limit set on one route also applied to every route around it. This happened on the AI settings routes and the company settings routes, where GST verify's 30 a minute applied to all of them. Each route now has its own hook list, and a test covers it.
- Two labels (Edit, Delete) were missing and showed as raw keys. A new test fails the build when a screen asks for text that doesn't exist.
- A step the AI called "end" took the name MONO uses for "the record closes", which broke the flow. "end" is now reserved.
- Ollama on a CPU: a long answer always failed after exactly 5 minutes with "Could not reach the AI service". Node gives up when no reply starts within 5 minutes, and Ollama sent nothing until it had finished writing. Answers are now streamed, so they can take as long as they need (up to 30 minutes).

**Verified**
- 217 unit/integration tests (28 new) cover:
  - name matching, draft conversion and its slip fixes, the edit diff, Ask plan checks, cost estimates;
  - the AI API with a scripted model: not-connected, key never returned, build → open in builder, the repair round, edit diff, KPI filtering, Ask over the real views, an injection attempt, own rows only, another company's rows never shown;
  - business details, masters, and the 08:45 summary once a day;
  - AI follow-up in the notification engine, Ollama streaming, and the rate-limit regression.
- 37 browser tests:
  - the AI screens fit at 380 px and 1440 px;
  - business details save;
  - a master shows and is deleted;
  - the AI follow-up switch;
  - "Build with AI" review → "Open in the Builder" with the model's answer stubbed.
- Live run on a real model: Ollama with **qwen2.5:7b** on this machine's CPU. No cloud key was available.
  - The whole screen path works: drafting, summary, flags, chart, "remember" suggestions.
  - Evals: 3 of 5 descriptions pass (Order to dispatch, Purchase request, New employee joining).
  - Lead to order gave 9–11 steps with gaps: some steps without a person, and the "need confirmed?" decision missed. The Hindi complaint had a broken "No" branch. Both answers are kept in `apps/api/src/modules/ai/evals/failed/`.
  - **The phase 6 acceptance (Lead to Order → a valid 10–12 step flow) is not yet shown on the default model (Claude Opus 5.5).** It needs an API key: `AI_EVAL_PROVIDER=anthropic AI_EVAL_KEY=… npm test -- flow.eval`.
- Production stack: the `task_handover` and `ai` migrations apply; AI routes answer through Caddy; no errors in the logs.

## Delegation: Pass on and task notes (03/11/2026)

**Pass on: one task, several people, one after another**
- When your part is done and someone else has to finish, press **Pass on** (in the task or on its row). Fill in:
  - what you did;
  - who does the next part;
  - when their part is due;
  - your work, attached (optional).
- The same task (same number) moves to them:
  - They get it on Telegram like a new task, with an Accept button, your note, the original brief and the files you attached.
  - The person who gave the task is told who has it now.
  - The next person can pass it on again, as many times as needed.
- The task shows "Part 2", "Part 3"… and a "Worked on by Sandeep Pal → Ramesh Choudhary → …" line. The history records each hand-over with both due dates.
- Everyone who did a part keeps seeing the task in their list and its notes, but can't change it any more.
- Refused:
  - passing it to yourself;
  - a due time that has already passed;
  - passing it on before accepting it;
  - anyone but the doer passing it on.
- Passing it back to the person who gave it needs no acceptance.
- The new due time is a new part, not a "date moved", so it doesn't turn the task yellow or red.

**Notes on a task, with names**
- The task drawer has **Notes** and **History** tabs.
- Notes shows everything people wrote on the task, each with name, time and a tag:
  - notes and follow-ups;
  - hand-overs ("Passed on to Ramesh Choudhary");
  - done notes ("Done");
  - send-back and reopen reasons.
  A box at the bottom adds a note; Ctrl+Enter sends it.
- Notes can be added while the task runs and after it is done (not once it is cancelled). Each note reaches the doer, the person who gave it, the verifier and everyone who did a part, except the person who wrote it.
- Rows show how many notes a task has.
- Telegram: reply to a task message with text to add a note. A photo reply still attaches proof. `/help` says so.
- The green "done note" box is gone from the drawer: the note is in Notes with the doer's name.

**Notifications**
- New events (with English and Hindi texts):
  - `delegation.passed_on`, to the next person and the person who gave the task;
  - `delegation.note`, to everyone on the task.
  Every deploy now adds rules and templates for new events to every company, not only the main one. Existing rules are never changed.
- Telegram buttons on a message can go to one person only. On a hand-over, only the next person gets Accept / Done; the person who gave the task just reads the news.

**Verified**
- 6 new tests:
  - machine rules for pass on and notes;
  - a three-person chain through the API: refusals, visibility for earlier doers, who hears about notes, the hand-over history, passing back to the creator;
  - a Telegram text reply becoming a note;
  - per-person Telegram buttons.
- New browser test, on phone and desktop:
  1. Sandeep passes a task to Ramesh.
  2. Ramesh sees "Part 2", accepts it, reads Sandeep's note with his name, and adds his own.
  3. Sandeep still sees the task and Ramesh's note, with no Pass on button.

## Phase 5 — FMS: builder, engine, Live FMS, My steps, documents, KPI cards (03/11/2026)

**FMS Builder** (`/fms/builder`)
- The list has All / Published / Drafts tabs and table or card views. Each row shows its steps, departments, status ("Published v2", "Draft · changes not published") and its actions (edit, publish, duplicate, archive).
- The editor has four tabs:
  - Steps: a list with a step editor beside it. Each step has a type (Task, Decision, Approval, Outside, Auto), doers or "whoever started it", a backup, and a planned time. The time counts from the previous step, the start, a date field, or is a fixed time. Steps can also have a checklist, an entry form, required proof and a customer update.
  - Start form: 17 field types, including items (item, qty, rate, amount), dropdowns and from-a-master.
  - Details: coordinator and backup, problem solver and backup, departments, training video and KPI cards.
  - Flowchart: Yes/No branches and dashed rejection lines. A "+" under each step inserts one after it, and a red "!" marks steps that need fixing.
- The header shows "12 steps · 4 people · Start to end 3.2 days · 1 step to fix", plus the Working shifts or Full calendar choice.
- Publish refuses a flow until it is ready: every step needs a doer and a time, decisions need both branches, and no step may be orphaned. The errors are named per step.
- Published versions never change. Running records stay on the version they started with, and editing a published flow makes a draft of the next version.

**Engine**
- Starting a record checks the start form, numbers the record (#1, #2… per flow), gives it a title from the first fields, and opens step 1 for its doer.
- With several doers, the step goes to the one with the fewest open steps. A step done by "whoever started it" falls back to the coordinator for public-form records.
- Completing a step checks its fields, checklist and proof, then records the actual time:
  - Decision steps take the Yes or No branch.
  - Approval steps either approve or go to their reject step.
  - Outside steps wait for the outside party.
  - Auto steps run on their own: create a numbered document, send a customer update, or call a webhook. Webhooks are retried by the worker every minute.
- Planned times use working time: only shift hours count (night shifts included), and holidays and weekly offs are skipped. The other choice is the full calendar.
- Record actions: reassign the open step (the new doer gets it on Telegram), put on hold, resume, and close. Each action writes history with who did it and when.
- Every 5 minutes the worker checks open steps:
  - Due soon (an hour before): the doer is reminded.
  - Late: the doer and the coordinator are told.
  - Stuck (twice the planned time gone): the problem solver is told. A late step is only told once.

**Live FMS** (`/fms/live`) and **My FMS steps** (`/fms/my-steps`)
- Live FMS has a flow picker and tabs: Running · Late · Due today · On hold · Closed · Planned vs actual · Performance.
- A stage strip shows one circle per step with how many records are there and how many are late. The records table shows the record, step n of N, who has it, when it is due and how late it is. "+ New {run name}" opens the start form.
- The record drawer has four tabs:
  - Timeline: each step with doer, planned and actual time, On time / Done late / Delayed / Waiting, the data entered and the proof.
  - Planned vs actual.
  - Documents.
  - History.
  The drawer also has "Do my step", Reassign, Hold / Resume / Close, and a timeline PDF.
- My FMS steps has two parts: "Flows that start with you" (start one in a tap) and your steps, filtered by Running / Waiting on you / Late / Closed.
- Telegram:
  - `/my` lists FMS steps too.
  - Step messages have Done / Yes / No / Approve buttons. A step that needs fields or proof sends you to the web form instead.

**Documents** (`/documents`)
- Auto steps create papers numbered per type and per financial year: `INV/26-27/0001`.
- The list shows the number, type, date, party, which flow and record it came from, the total in ₹, and its status. Documents can be cancelled with a reason, and the number is never reused.
- Every document is a clean A4 PDF with the company, number, party, line items with totals, and the terms. Dates read DD/MM/YYYY and yes/no answers read Yes/No.
- Document types (prefix, header, footer, terms) are set up on the same page.

**KPI cards and the public form**
- KPI cards: pick a field, Count / Total / Average / Min / Max, and a period (Today / This week / This month / This FY). Each card is compared with the period before.
- Share a form link: customers fill a flow's start form at `/f/{token}` with no login. The form is protected by a rate limit, a hidden honeypot field and a signed sum question ("What is 4 + 7?"). It can be switched off at any time, and the record shows up on Live FMS.

**System Master**
- The Processes card counts real flows (live, being built, not started).
- The People card counts load from open FMS steps plus tasks.

**Demo data** (`npm run seed:demo`)
- The 8 flows from §15. Seven are published with 5 records each, some late and one closed in each. Lead to Order Conversion (12 steps) is a draft.
- Also 4 document types (QUO, PI, COA, INV) and 2 KPI cards per flow.

**Fixes found while testing**
- Saving one detail of a flow (say, the training video) reset its run name to "Record" and cleared its departments. Partial saves now change only what was sent, and a test covers it.
- Dates in the record drawer and in document PDFs read DD/MM/YYYY, never the stored 2026-11-03. An e2e check fails if a stored date comes back.
- The flowchart opens readable (at least 80 % zoom, from the top) instead of shrinking a long flow to fit.
- The Documents toolbar no longer overflows a phone screen.

**Verified**
- 183 unit/integration tests. New ones cover flow validation, readiness, branching, working time (shifts, night shifts, holidays), field checks and the engine. The engine tests run a decision, an approval reject, an auto document, reassigning, hold and close, and check that partial saves keep the rest.
- 19 browser tests. The Phase 5 acceptance test does it all in the browser:
  - builds a 6-step flow with a decision in the builder and publishes version 1;
  - starts an order on Live FMS and completes every step;
  - downloads the numbered invoice PDF.
  The others check that every FMS screen fits at 380 px and 1440 px, and that the public form works on a phone.
- Production stack: the `fms` migration applies. Smoke-tested through Caddy (publish → record → step done → auto `INV/26-27/0001` → PDF, timeline PDF, public form) with no errors in the logs.

## Fixes after EA testing (03/11/2026)

- **Weekly schedule:** entries were cut off mid-line in short slots. Hours are taller now, short entries end with "…", and hovering or focusing opens the full text (tooltip too).
- **People lists:** every people list shows name · designation · department ("Ramesh Gurjar · Truck Driver · Dispatch"), and the EA can delegate to the owner too.
- **Help slip vs help ticket:** both raise forms open with a short "which one do I need?" card with an example and a link to the other; the menu descriptions say it in one line.
- **`/capture`:** shows only for the owner and the EA, in `/help`, the hello and Telegram's command menu (each chat gets its own menu, updated when the EA changes). Anyone else typing it is told who can.

## Fixes after GGM testing (03/11/2026)

**Dates are DD/MM/YYYY everywhere**
- The browser's own date pickers are gone. They follow the browser's language: "11/04/2026" meant 4 November in an English (US) browser. All 13 were replaced by MONO's own fields:
  - Date: type `04112026` and the slashes appear, or pick from a Monday-first calendar.
  - Time: 24-hour; `18:00`, `1800` and `6pm` all work.
  - Impossible dates like 31/02 are refused.
- Every date shown, in lists, chips, Telegram, briefs and the MIS, now carries its year: `04/11/2026 18:00`.

**Type to filter in every list**
- Every dropdown in the app filters as you type. Every word must match (`sand pal` → Sandeep Pal), best matches come first, and letters in order also match (`rmsh` → Ramesh). Arrow keys and Enter work.
- Long lists get a search box; on short ones you can still just start typing.

**Telegram**
- `/done` and `/move` were never wired to the bot (only the code behind them was tested); now they work. `/done` with no number lists your open tasks as tap-to-finish buttons. `/move` takes DD/MM/YYYY. Unknown commands get the help text.
- `/today` = due before midnight in the company's time zone, plus anything late. Work due later is counted ("2 more due later — send /my").
- `/my` shows one-tap Accept / Done / Verify buttons. It now includes tasks you verify by default (as the creator or EA), not only ones with your name as verifier.
- **Seen without a button:** Telegram never tells bots when a message is read, so a WhatsApp-style blue tick isn't possible. Instead, anything you do in the chat (a button, a command, any message) marks everything delivered there before it as seen, which also stops escalations. The Seen button is gone.
- **Proof travels with "please verify":**
  - Covers delegation done, ticket fixed and checklist submitted. The photos are sent into the chat: one photo carries the message and the Verify button as its caption; several come as an album, then the message.
  - Documents are sent as files. A missing file never blocks the message.
- Button results are also written into the chat (Telegram's pop-up disappears too quickly to read "this task needs a photo").

**Uploads in development**
- The api and the worker each resolved the relative `UPLOAD_DIR` from their own start folder, so web uploads and Telegram photos landed in two different folders. The verifier's message warned that a file "could not be attached", and the web couldn't show Telegram photos. Relative paths are now always from the project root; existing files were merged. Production was not affected (both use `/data/uploads`).
- Proof sent to the verifier is only what the doer (or ticket solver) attached, not the brief the creator attached when giving the task.
- The brief travels too: files attached when giving a task (also on reassign), raising a ticket or raising a help slip go into the doer's / solver's / receiver's Telegram message.

**Verified**
- 161 unit/integration tests (18 new). They cover:
  - Date reading and formatting (day first, no month-first, year always shown) and type-to-filter ranking.
  - Every Telegram command path, including the exact messages from testing.
  - /today across midnight; default verifiers in /my.
  - Auto-seen (only what was delivered on Telegram).
  - Proof files in the outbox; single photo, album and missing-file sending.
- Playwright: no browser date picker on any date form, a typed date saved and shown back as DD/MM/YYYY, type-to-filter leaving one match. All 26 browser tests pass on phone and desktop.

## Phase 4: Help slips, help tickets, EA system, weekly MIS, Business Engine flow designer (02/11/2026)

**Help slips** (`/help-slips`)
- A problem plus the raiser's own solutions (the company sets how many: 1–3). Flow: receiver screens (forward or send back) → approver decides → **approving creates a linked delegation task** (pick a solution or write your own, choose the doer and date) → raiser closes.
- Switches: "Receiver screens first" off sends slips straight to the approver; "Approver step" off lets the receiver decide.
- Every step has a time limit. A late slip tells whoever holds it, plus the accountable person, once. Decided slips the raiser leaves open close by themselves (approved ones once their task is done).
- Accountability: "none" means the raiser stays accountable; it can also be the receiver or the approver.
- Tabs: Waiting on me, Raise a slip, My slips, All slips. Tiles: Waiting on me, Open, Late, Approved, Rejected. Drawer with solutions, decision, linked task, files and history.

**Help tickets** (`/help-tickets`)
- Raise → solver replies → marks it fixed (photo or file required when "Proof to resolve" is on, again after every reopen) → raiser confirms, or says "not fixed" (reopen count). "Auto after 24 hrs" closes resolved tickets on its own.
- Escalation is a level on the ticket, not a status:
  - **Level 1:** the first reply or the planned fix time was missed; goes to the coordinator, or the solver's HOD if there is none.
  - **Level 2:** still missed one more SLA later; goes to the HOD and the owner.
  - The coordinator chases but decides nothing; they can comment, move the fix time or reassign.
- Tabs: To fix, Raise a ticket, My tickets, All tickets. Tiles: Open, Late, Escalated, Waiting to confirm, Closed. Drawer with the conversation, SLA chips and actions.

**EA system** (`/ea`)
- One-line capture (web or Telegram `/capture`; plain Telegram messages from the owner or the EA count too).
- The EA sorts captures on a drag-and-drop board: Captured, Information, Someday, Waiting (with the cap), Scheduled (day, time and kind), Delegated (creates a task), Done. Switched-off stages hide.
- **Owner's week:** a day × hour grid on desktop and an agenda on phones; tap a free hour to book something into it.
- Automatic:
  - A scheduled day that passed goes back to Someday.
  - Information closes after the "kept for" days.
  - Delegated items finish when their task is done.
  - The **daily brief** at 08:30 lists today's schedule, captures to sort, waiting n/cap, delegated work to chase and the Someday review.
  - The **weekly plan** goes out on the plan day. Both send once per day per owner.

**Weekly MIS** (`/mis`)
- Per person, per week: tasks planned, work done %, on time %, verified in time %, checklists %, tickets fixed in time %, score (FMS steps arrive in phase 5). Admins see everyone, HODs their team, others themselves.
- Week picker, Excel (CSV) and **PDF** (pdfmake, landscape A4).
- Sent every Monday at 09:00 (company time) for the past week: to owners with everyone, to HODs with their team.

**Business Engine flow designer** (System Master → Business engine card → `/system/engine`)
- For all five modules: a React Flow chart drawn from the module's state machine under the company's settings. Legend: start, action, status, automatic, finished, dead end/escalation. Steps switched off, and statuses nothing can reach any more, fade out.
- **Alerts (n/n)** view, full view, and a "Set up your flow" panel:
  1) who does it; 1B) times and rules; 2) steps on/off.
  - Live preview while editing, then Save or Reset to default, with a "Default / Changed" badge.
  - "Recent changes by admin" (who, when, before → after) and who hears about what on Telegram.
- Every setting does something:
  - **Delegation:** "EA verifies before done" off makes Mark done go straight to Done. "Accept within" reminds the doer and tells the creator. "Reports open on" sets the sheet's default range.
  - **Checklists:** "Mark missed after" is the default window for new checklists, and "Tell the owner about misses" off leaves the owner out of miss alerts.
  - **Slips:** "Delegated within" sets the approved task's default date.

**Also**
- My Workspace, menu badges and the top-bar count now include slips, tickets and the EA's captures. Telegram `/my` lists tickets to fix and slips waiting.
- New notification events: `delegation.accept_late`, `slip.late`, `slip.closed`, `mis.weekly`.
  - `ticket.escalated`, `ea.daily_brief` and `ea.weekly_plan` now go to exactly the people the worker picks.
  - Untouched built-in rules are upgraded automatically.
- An event can leave out recipients a company switched off.
- `seed:demo` adds 8 help slips and 10 tickets in every state (some late or escalated), and a 17-item EA board with this week's schedule. Sunita Bansal is set as the EA.
- New packages, pinned to releases at least two weeks old: pdfmake 0.3.12, @xyflow/react 12.12.0, @dagrejs/dagre 3.1.1.

**Verified**
- 143 unit/integration tests. New ones cover:
  - The slip, ticket and EA state machines, and the flow charts under different settings.
  - Escalation levels and weekly MIS on fixed dates.
  - Slip, ticket and EA lifecycles through the API.
  - Late slips chased once; auto-closes; escalation recipients.
  - The waiting cap, day rollover, a brief sent once at its time, and the brief text.
  - "EA verifies" off going straight to Done; settings validation, reset and change log.
  - MIS visibility, the PDF and the Monday send.
- Playwright (phone and desktop), each person in their own browser:
  - A slip raised, forwarded, approved into a task and closed.
  - A ticket replied, fixed with a photo and confirmed.
  - An EA capture scheduled into the week and done.
  - The designer's switch turned off and a task closed without verification.
  - Every new screen fits at 380 and 1440 px.
- Production stack: the `engine` migration applies, the slip, ticket, EA, MIS PDF and designer APIs work through Caddy, and there are no errors in the API or worker logs.

## Phase 3: Delegation, checklists, scorecard, R/Y/G (02/11/2026)

**Delegation sheet** (`/delegation`)
- Every task change goes through the shared state machine (accept, decline, move date, follow-up, mark done, verify, send back, reopen, give to someone else, cancel). The company's toggles decide the guards: doer must accept, EA verifies, allow reopen.
- Each change writes history, audit and a domain event, so Telegram, email and in-app follow automatically.
- Tiles: Pending, Overdue, To verify (with the company's target), Done this week (on time / done) and My score.
- Tabs: Add task, Pending, Verification and Done (with counts), FMS report (phase 5 placeholder), Scorecard.
- Filters: search, doer, This week / All / dates, Mine / My team / Everyone. Tables on desktop, cards on phones. Bulk accept and verify.
- **Add task**:
  - Fields: doer (or Myself), planned date, optional verifier, description.
  - **Dictate** uses the browser's speech recognition until the AI layer arrives.
  - Files: drag-drop, camera, paste a screenshot, many files.
  - "Require a photo or file when done": the API refuses to close the task on a remark alone.
- **Import many** from CSV/Excel with a preview and per-line errors (all or nothing).
- Task drawer: details, files and full history (date moves with reasons, follow-ups, notes, status changes).
- Overdue tasks raise `delegation.overdue` once per local day; moving the date resets it.
- **Scorecard**:
  - Week picker and CSV export. Per person: % not done, % not on time, % verifications not done, % verifications late.
  - Each KPI shows benchmark, last week, planned, actual, actual % and next week's target.
  - Each line has a state: meets / off this week / missed twice / no data.
- **R/Y/G report**: Green/Yellow/Red/Still open tiles, per-person table with split bars, Week or Month (W1–W4), CSV download.

**Checklists** (`/checklists`)
- Checklist master:
  - Items can require a photo, voice note or value.
  - Frequency: daily, chosen weekdays, weekly, monthly (date or last day), quarterly, yearly or every N days.
  - Also: due time, hours to finish, doers, verifier, skip holidays and weekly offs, start date, on/off.
- The worker sweeps every 5 minutes, creating each run up to 24 h ahead. Runs are unique per (master, planned time, doer), so a sweep never creates duplicates. Saving a master creates its due runs at once.
- Run sheet: tick items, enter values (entering a value ticks the item), photo or voice proof per item, note, submit. The verifier verifies or sends it back.
- Reminders before the due time; runs still open after the window close as **Missed** and the rules tell the owner.
- Tabs: My checklists, All checklists, Assign checklist, Checklist master, Master changes (who changed what). Tiles: All, Due today, Overdue, To verify, Missed.
- Deleting a master keeps its runs as history, but they leave every list and count and are never reminded or marked missed.

**My Workspace** (`/workspace`): one list of tasks to do, tasks to verify and checklists due, live over SSE. Top-bar and menu badges show the same counts.

**Telegram**
- Task messages carry buttons:
  - Accept or Done · Move date on new tasks.
  - **Verify** for the verifier.
  - Seen ✓ and Open on all of them.
- `/done 70 what was done`, `/move 70 05/11 18:00 reason`; `/my` and `/today` list tasks and checklists.
- A photo sent as a reply is saved as proof, then Done works on proof-required tasks.

**Other**
- Nobody verifies their own work: when the verifier (or the EA/creator fallback) is the doer, there is no verification step, and the scorecard doesn't count one.
- People never get a message about their own action (tests and escalations excepted).
- Live notification toasts share one slot (a new one replaces the last; the bell keeps them all), so a busy hour can't cover a phone screen and swallow taps.
- The web app loads each screen on first visit: the main bundle went from 1.18 MB to 476 KB (145 KB gzipped).
- Uploads accept more file types (PDF, Office, audio), up to 10 MB.
- `seed:demo` adds:
  - 30 tasks in every state.
  - 6 checklist masters with a week of run history.
  - 4 holidays.
- No messages are sent while seeding.

**Verified**
- 118 unit/integration tests. New ones cover:
  - Both state machines.
  - Recurrence in the company time zone across holidays, weekly offs and month ends.
  - R/Y/G grades and scorecard KPIs on fixed dates, plus next-week targets.
  - The idempotent sweep, reminders, misses and deleted masters.
  - Permissions and privacy; import; overdue once a day.
  - Telegram buttons and commands.
- Playwright (phone and desktop, run one at a time because specs share the demo accounts), each person in their own browser:
  - Owner gives a task, the doer accepts and marks it done, the verifier verifies.
  - A checklist run gets a value and a photo, is submitted and verified.
  - Delegation, Scorecard, R/Y/G, Checklists, Masters and My Workspace fit at 380 and 1440 px.
- Production stack: the `work` migration applies on a fresh database; task and checklist flows, scorecard and SPA routes work through Caddy; no errors in the API or worker logs.

## Phase 2: Notifications, Telegram, templates, rules, reminders (02/11/2026)

**Engine** (worker)
- Domain event → matching rules → recipients → templates.
  - Recipients: doer, verifier, creator, HOD, owner, coordinator, customer… or a named person. The HOD lookup walks up the department tree, then falls back to the owner.
  - Templates are picked per channel and the person's language, with variables filled from the event (user ids become names; dates shown as DD/MM/YYYY HH:mm in the company time zone).
- In-app notification is always created, once per person, and pushed live over SSE (bell counter, toast).
- Telegram, email, WhatsApp and push go through the **outbox**:
  - The rule's wait and the person's quiet hours are respected (escalations and tests ignore quiet hours).
  - Sending starts the moment something is queued, plus a 10 s poll for delayed messages and retries.
  - `SKIP LOCKED` claims; 5 tries with exponential backoff; then SENT / FAILED / SKIPPED, each with a clear reason.
- **Escalations**: "if no reply in N minutes, escalate to HOD / owner / coordinator / a person", checked every minute. A reply means the notification was read (also via Telegram "Seen") or the person acted on the record.
- Admin group: one copy of every Telegram message.

**Channels**
- **Telegram** (grammY, long polling, one bot per company or the .env bot):
  - Link with an 8-character code (24 h) or a one-tap `t.me/bot?start=CODE` link.
  - `/start` `/my` `/today` `/done` `/capture`; inline Seen / Open buttons (Accept / Done / Move date wired with tasks in phase 3).
  - A photo sent as a reply is saved as proof on that record.
- **Email**: nodemailer SMTP per company (or .env), branded HTML + plain text.
- **WhatsApp**: provider interface with **WATI** (send template, read template statuses, test) and **AiSensy** (send via API campaign). Interakt and Kit19 are shown as "coming later".
- **Web push**: VAPID keys per company, per-device opt-in in Profile, a service-worker push handler, and dead subscriptions removed automatically.
- Secrets (bot token, SMTP password, API keys, VAPID private key) encrypted with AES-256-GCM from `APP_SECRET`; never returned to the browser; empty field = keep.

**Screens** (System Master → Integration)
- **WhatsApp API**: provider, credentials, connection panel, Test API.
- **Message templates**: 342 defaults (57 events × 3 channels × EN/HI), search, category and channel filters, load defaults per channel, editor with variable chips and live preview, Submit / Check all statuses, active toggle.
- **Link Telegram**: Linked % (target 80%), pending / expired, people table, "Send codes to all not linked" (codes go by WhatsApp/email; people without either get theirs on screen), admin group.
- **Connect channels**: Telegram bot (token checked with Telegram before saving), SMTP, phone push keys, each with Send test.
- **Notification rules**: tiles, module chips, table, Add/Edit rule (event, audience, recipients, channels, wait, escalation), on/off, **Send test**.
- **Reminder patterns**: Standard / Gentle / Strict defaults, editor (remind at, channels, once overdue).
- Google Drive tab is a placeholder for phase 10.
- **Bell** dropdown + **Notifications** page; **Profile** gets "Link my Telegram" and "Phone notifications".

**Dev and ops**
- Mailpit added to the dev stack (`http://localhost:8025`); `.env` SMTP points at it.
- `db:migrate` now passes arguments to `prisma migrate dev`, and the client regenerates afterwards.
- Existing companies get any missing defaults on the next seed/migrate run.
- INSTALL.md has a new "Messaging" section (BotFather, Gmail app password, WhatsApp approval, push).

**Verified**
- 89 unit/integration tests, including:
  - Encryption and tamper detection; secrets never returned.
  - Engine fan-out, idempotency and quiet hours; skipping unconfigured channels.
  - Retries and backoff; escalation to the HOD vs answered.
  - Bot linking, Seen, photo proof; Telegram codes; inbox and permissions.
- Playwright: Send test → toast and bell update live → email arrives in Mailpit; every Integration screen fits at 380 and 1440 px.
- Production stack: Send test gives the in-app notification, and the unconfigured channels are recorded with reasons.

## Phase 1: Company setup, departments, users, roles, org chart, Home (02/11/2026)

**System Master** (Owner/Admin)
- Five header cards on every tab, computed live:
  - Company setup steps, people and departments.
  - Business engine.
  - Processes and the people-load split (0s until phases 3–5).
  - Health check: 8 checks, with "See what is missing" linking to each fix.
- Tabs with count badges; later-phase tabs are placeholders.
- **Company setup**
  - Profile with the required fields.
  - GSTIN **Verify**: an offline checksum fills PAN and state; a pluggable GST provider (`GST_API_PROVIDER`) adds the legal name.
  - Points of contact.
  - Shifts & timings: overnight shifts, working-day chips, one default.
  - Branch tree with loop protection.
  - Designations as coloured chips; delete only when unused.
- **Departments**: type-and-Enter, cards with HOD picker, sub-departments, people and "with login" counts. Drag a card onto another to nest it, with Undo. Sub-department dialog. Delete only when empty.
- **Users**
  - Add one by one, or **Paste a list** from Excel/Sheets: tab or CSV, header in any order, live preview with per-line errors.
  - Department filter chips (plus Not assigned and New dept), search, Grid/Cards views (always cards on phones).
  - Team / HR column groups; HR details only with `hr.admin`.
  - Bulk move, set role and enable login; Telegram codes come in phase 2.
  - Login toggle, reset password, soft delete, and an edit panel with "also works in".
  - Auto codes `EMP-001`.
- **Roles**: permission matrix (16 modules × view/create/edit/approve/admin), built-in roles protected (Owner always all), custom roles, process-roles note. Enforced on every API route.
- **Org chart**
  - Stats row, search, department chips, zoom/Fit, Left & inactive, Full/Chart/List views, Owner on top.
  - Drag a person to another department → "Also add / Move / Cancel"; drop on the head slot → HOD.
  - Person side panel; touch drag by press-and-hold.
- **Appearance**: the theme generator with presets, 30 swatches plus any colour, warmth, corners, sidebar and buttons, with a live preview on the whole app. Also logo upload, app name, default language and mode, and the "staff may pick their own accent" switch.

**Home / search**
- Ctrl/Cmd+K command palette anywhere, plus inline search on Home over screens (English and Hindi), people and departments.
- Category chips per spec, an alert banner (e.g. departments without HOD), and favourites (star) saved per user.

**Accounts**
- One-time passwords for admin-created logins, shown once with copy buttons.
- Forced password change on first sign-in, enforced by the API.
- Resetting a password signs the person out everywhere; nobody can remove the last Owner or delete themselves.

**Platform**
- File uploads (`/api/files`, PNG/JPG/WebP up to 5 MB) on a local-disk storage interface; served only to the same company.
- New tables `company_contacts`; user `prefs` and `must_change_password`; company profile columns.
- `npm run seed:demo` (Demo Industries: 25 people, 14 departments, 5 shifts, 4 branches, 19 designations) and `npm run seed:ggm` (GGM sites and departments, no invented people). Both are safe to re-run.
- Docker: the `migrate` service now gives the uploads folder to the API user (no manual `chown`).

**Verified**
- 70 unit and integration tests, including permissions (Member gets 403, HR fields hidden), company isolation, delete rules, owner guards, paste import, chart moves, summary and search.
- Playwright: paste 5 users, move a person between departments, make a HOD (cleans up after itself), plus no side-scroll on every System Master tab at 380 and 1440 px.
- Production stack rebuilt from scratch: migrate, seed, login, upload and download through Caddy.

## Phase 0: Scaffold, auth, deploy skeleton (31/10/2026)

**Foundation**
- npm workspaces monorepo: `apps/api`, `apps/worker`, `apps/web`, `packages/shared`, `packages/db`. TypeScript 6 (strict), ESLint 10, Prettier, Vitest 5, Playwright.
- Prisma 7 with a multi-file schema and the driver adapter. Tables: companies, branches, shifts, departments, designations, roles, users, user_departments, counters, module_settings, attachments, sessions, audit_logs, domain_events, notifications.
- Company scoping (`forCompany`): every query is limited to one company, and list reads hide soft-deleted rows. Per-company human numbers (`EMP-001`, `BOP/26-27/0004`) come from an atomic counter.

**Shared**
- `transition()` state-machine helper (roles, guards, terminal states, available actions).
- Indian formats: ₹ with lakh/crore grouping and `₹1.31 Cr` / `₹45.36 L`, DD/MM/YYYY in the company time zone, FY April–March, E.164 mobiles.
- Permission keys and default permissions for the built-in roles.
- **Theme generator**: the whole UI is built from one seed colour (default honey `#EFC75E`). Readable text is guaranteed for every swatch in both modes. Status colours are fixed.

**API**
- Fastify 5 with zod validation, OpenAPI at `/api/docs` (dev), structured logs (pino) with cookies redacted, environment checked with zod, and the standard error shape.
- Auth: login by mobile or email + password (argon2id). Access token lasts 15 min and refresh 30 days, both in httpOnly cookies. Refresh tokens are rotated, and reusing an old one revokes all sessions. A company picker appears when one login exists in two companies. Logout, `/me`, preferences, and password change (which signs out other devices). Login is rate-limited and data-changing requests are checked against the site origin.
- Every mutation writes an audit row and an outbox event in the same transaction. Postgres NOTIFY feeds Server-Sent Events at `/api/events`, with a 25 s heartbeat.
- `/api/health`.

**Worker**
- pg-boss 12: outbox dispatcher (instant via LISTEN, plus a sweep every minute), retries with backoff, heartbeat file for the Docker healthcheck.

**Web**
- App shell in the Ink & Honey theme:
  - Dark sidebar with every menu section from §3 (collapsible), and a top bar with the workspace / System Master switch, counters, refresh and user menu (language, light/dark/system, larger text, assistant, help, sign out).
  - Floating assistant button.
  - On phones: bottom tab bar (Home · My work · + Capture · Alerts · Menu) and a menu drawer.
- Pages:
  - Login (English/Hindi, company picker).
  - Home "Ask" page with screen search (Ctrl/Cmd+K) and category chips.
  - System Master overview, Profile with password change, and the `/dev/ui` UI kit with a live theme playground.
  - Placeholder pages for every later-phase screen.
- English and Hindi strings (Hindi machine-drafted, to be reviewed). Fonts are self-hosted (Inter, Noto Sans Devanagari, JetBrains Mono). Installable PWA with icons.

**Deploy**
- Docker Compose with `db`, `migrate` (migrations + first-company seed), `api`, `worker`, `web` (Caddy: SPA + `/api` proxy with no buffering for SSE), `cloudflared` (profile `tunnel`) and `backup` (nightly dump + uploads, 14 days, optional rclone).
- `deploy/compose.sh` wrapper and `deploy/INSTALL.md`.

**Verified**
- 46 unit/integration tests (state machine, formatters, theme contrast across 30 swatches × modes, company isolation, auth flows, SSE, outbox dispatcher).
- Playwright login and shell tests at 380 px and 1440 px, with a no-side-scroll check.
- Fresh-machine Docker stack: migrate → seed → login works through Caddy, SSE streams through Caddy, and a backup restores.
