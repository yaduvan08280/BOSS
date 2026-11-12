# Plan — 100% hotel, bar and restaurant coverage, plus linked fields

Status: **plan only, nothing built yet.** Written 12/11/2026 against `main` at `e01ef63`; multi-branch phase added the same day.
Rule for every phase below: the same Definition of Done as CLAUDE.md §17 (380 px + 1440 px, Hindi + English,
state machines, audit + events, permissions on the API, company scoping tested, no file over 400 lines), **plus**
every row of that phase's coverage checklist has an automated test (unit or e2e) before the phase is called done.

"100%" is defined by the **coverage checklist** in §13: 259 workflows a hotel / bar / restaurant runs. A workflow is
covered when a person can do it end to end in MONO, or MONO drives it through a named integration (§10). The
program is finished only when all 259 rows are green.

---

## 1. Phase order and what depends on what

| Phase | Name | Needs | Why this order |
|---|---|---|---|
| 11 | **Linked fields** (value lists, "Write…", fields from other FMS, auto-fill, cascading, stock from any step) | — | Every later module's forms use it |
| 12 | **Branches, legal entities, countries, franchises** (scopes, routing, people across branches, per-entity HR / tax / currency / numbering, transfers design) | 11 | Every later module stores a branch and respects who may see it |
| 13 | **Inventory v2** (locations per branch, units, batches/expiry, recipes, central-kitchen production, indents, transfers in transit, wastage, variance, bar ml) | 12 | POS, bar and banquets consume stock through recipes |
| 14 | **Hospitality setup + Menu** (outlets, floors/tables, rooms, taxes, printers, payment modes, menu, modifiers) | 13 | POS, reservations and the hotel read this setup |
| 15 | **POS, KOT, kitchen display, billing, payments, day close** | 14 | The money path for restaurant and bar |
| 16 | **Table reservations, waitlist, guest profiles** | 14, 15 | A seated booking opens a POS order |
| 17 | **Hotel: bookings, front desk, folio, night audit, housekeeping, rates** | 14, 15 (room service posts to folio) | |
| 18 | **Banquets & events, bar & excise register, compliance, franchise royalties and audits** | 13–17 | Uses recipes, folios, the calendar |
| 19 | **Integrations** (channel manager / OTAs, payment links, aggregators, e-invoice, Tally, booking engine, printers) | 15–18 | Plugs into finished modules |
| 20 | **Reports, MIS, load test at service peak, offline drill, guides** | all | Sign-off |

Nothing in a later phase may start before the earlier phase's checklist is fully green.

---

## 2. Phase 11 — Linked fields (the foundation you asked for)

Today a field is plain (`text`, `dropdown` with fixed options, `master` with sources customers / items / vendors /
people / `m:<id>`), the value is stored as display text (decision 91), and only an AUTO step can move stock.

### 2.1 Field option "Remember what people type" (becomes a dropdown, last option **Write…**)
- New field setting `learn: true` on text fields. The field shows as a dropdown of **values already entered** in
  this field (most used first, type-to-filter). The last option is always **"Write…"**, which opens a text box; the
  new value is saved and offered next time.
- Where the list lives: new table `ValueList` (company, key, value, uses, lastUsedAt, createdBy, hidden) with
  `key = flow:<flowId>:<field>` by default, or a **named shared list** (`list:<name>`) so several FMS share one list.
- Admin can rename / merge / hide values (Masters → **Lists** tab). Merging rewrites nothing in old records (history
  stays); it only changes what is offered.
- Setting `writeAllowed: false` turns it into a strict dropdown once the list has values (only admins add).

### 2.2 Dropdown filled from **another FMS** (or the same one)
- New `master` sources:
  - `fms:<flowId>:<field>` — the distinct values typed in that field across that flow's records (e.g. "Vendor
    name" entered in *Purchase request* becomes the dropdown in *Goods receipt*).
  - `rec:<flowId>` — pick a **whole record** of another flow (shown as `#12 · Sharma wedding · 14/12/2026`).
    Optional filters: only records at step X, only RUNNING, only started by me, only within N days.
- The stored value becomes `{ text, ref }` (text for reading and documents, `ref` = the record / row / item id), so
  a renamed source still links. Old text-only values keep working (no migration of history).
- Unique values: field option `unique: true` refuses a value already used in another live record of the flow
  (booking references, bill numbers, room + date).

### 2.3 Auto-fill and cascading dropdowns
- `fill`: when a record / row / item is picked, copy chosen columns into other fields (pick *Item* → unit, rate;
  pick *Room* → room type, tariff; pick *Booking* → guest name, mobile, dates). Filled fields stay editable unless
  `locked: true`.
- `filterBy`: a dropdown's options depend on another field (pick *Outlet* → only its tables; pick *Category* → only
  its items; pick *Hall* → only free dates).
- **Formula fields** (read-only): `qty × rate`, `checkout − checkin` (nights), sums of item lines, percentages.
  A small safe expression language (numbers, dates, field refs, `+ − × ÷ round min max days()`), never `eval`.

### 2.4 Item lines and stock from any step
- The `items` field gets a real **item picker** (IMS items, by code or name; unit and rate auto-filled; live stock
  shown; "Write…" only if the flow allows free-text items).
- **Stock effect on any step** (not only AUTO): issue / receive / transfer / consume-by-recipe, from / to a location
  that is fixed or taken from a field, applied when the step is done. Shown as a preview before "Mark done".
- Not enough stock → per flow: **block** the step, or **allow and flag** (an approval goes to the store keeper).
- Reversal: reopening a step, rejecting an approval or cancelling a record **reverses** its stock moves (new moves,
  never edits).

### 2.5 Showing values anywhere
- Any field (from a master, another FMS, a list, an item, a formula) can be shown as a column in Live FMS, in
  documents (`{{field.column}}`), in KPI cards and in notification templates.

**Done when (checklist L1–L18 in §13):** a Purchase-request value appears as a dropdown in Goods receipt; "Write…"
adds a value that the next record offers; a picked booking fills guest fields; Outlet → Table cascades; a unique
booking ref is refused twice; a step issues stock from a location chosen in the form and reopening reverses it.

---

## 3. Phase 12 — Branches, legal entities, countries and franchises

Answers given on 12/11/2026: outlets in **several Indian states and outside India**; **one or more central
kitchens**, any of which can supply any outlet; outlets **send stock to each other** in emergencies; **franchise**
outlets are coming; leave and approval routing must be **a setting**.

Today only people, punches, holidays / weekly offs and checklists know a branch. Everything else is company-wide
(stock, permissions, processes, approvals, numbering, GSTIN, reports). This phase makes the branch a dimension of
everything. 40 gaps were listed on 12/11/2026; each one is a row in checklist G (§13).

### 3.1 The structure

```
Group (the tenant: one MONO install, one owner)
 └─ Legal entity — one per GSTIN / foreign registration; type: own or FRANCHISE
     │   country, currency, tax regime, address, letterhead, licences (FSSAI…), invoice series
     └─ Region (optional, any depth) — e.g. "Rajasthan", "Dubai"
         └─ Branch — type: OUTLET | CENTRAL KITCHEN | STORE / WAREHOUSE | OFFICE | HOTEL
             │   time zone, geofence(s), opening hours, managers, HR person, Telegram group
             └─ Location — the stock points inside a branch (main store, cold room, kitchen, bar, minibar)
```

- **Entity = one GSTIN (or one foreign company).** Two outlets in the same state can share an entity; an outlet in
  another state is another entity of the same company (same PAN, new GSTIN); a foreign outlet is its own entity.
- **Recommendation: one tenant, entities inside it** (not separate MONO companies). Shared menu, recipes, people,
  central kitchens and group reports stay simple. Franchise entities get hard isolation (§3.8). Decision #9.

### 3.2 Two ways of grouping people (function × location)
- Departments stay for **function** (Kitchen, Service, Bar, Housekeeping, Store, Accounts) and are shared across
  branches. Every person has a **home branch** and a department.
- Each branch has **branch managers** (one or more); each region has **area managers**; one person may manage any
  set of branches. The head of a department can be set **per branch** (the Kitchen head at Outlet 3) or group-wide.
- **Routing is a setting** (System Master → Branches → Approval routing), per module and per request type, with
  overrides per entity or branch: an ordered chain such as *branch manager → department head → HR → owner*, each
  step with "skip if empty / skip if it's the requester / wait N hours then go up". Used by leave, corrections, stock
  adjustments, indents, transfers, discounts, voids, slips, ticket escalation and notification "If no reply".
- New notification recipients: **branch manager, area manager, branch HR, department head at this branch**.

### 3.3 Who sees what (scopes)
- A role gets a **reach**: *own records* · *my branches* · *my entity* · *whole group*. A person gets a list of
  branches (home + the ones they manage or work at). Every list, count, report, search result, AI answer, export,
  API key and webhook is filtered by it — enforced in the database layer next to company scoping (`scope.ts`), with
  a test that fails when a branch-bearing model is missing.
- System Master per branch: an outlet manager can add and manage **only their branch's people** (salary only with
  HR rights for that branch). Group settings (roles, appearance, integrations) stay with owner / group admins.
- **Branch switcher** in the top bar ("All my branches" or one branch) for people with more than one.

### 3.4 People across branches
- **Branch history** with dates (moves are effective from a date); attendance, cover and payroll use the branch on
  each day, so a move in the middle of a month splits days and cost correctly.
- **Allowed branches** for punching: floating staff and managers punch at any of their branches' geofences without a
  flag; a branch may have several geofences.
- **Borrowing staff:** lend a person to another branch for dates (they show on that branch's cover board and work
  lists; their cost moves with them).
- Buddy cover can be limited to *same branch* or allowed across branches (HR rule).

### 3.5 HR per entity and branch
- HR person(s) per branch or entity; HR rules overrides by **entity and branch** (on top of department / person).
- **Pay rules per entity** (state / country): minimum-wage tables, weekly-off rules, professional tax / labour welfare
  as data entered by the accountant — nothing hard-coded. Payroll runs and closes **per entity** in its currency
  (gross pay only, as today; statutory deductions per country stay with the local accountant).
- Holidays per **country, state and branch**; leave types and quotas per entity.
- Cover board, attendance, 08:30 morning report and absence alerts are per branch, to that branch's managers and HR.

### 3.6 Stock, central kitchens and transfers
- Locations belong to branches; every item's stock is per location (built in Phase 13, designed here).
- **Several central kitchens / stores.** Supply routes: each outlet has a default kitchen per category, but a request
  can go to any kitchen or store.
- **Indent flow:** outlet requests → supplying branch approves (full / partial / substitute) → **dispatch** (stock in
  transit, a delivery note) → outlet **receives** (short / damaged / excess noted, with photos) → differences go to an
  approval. Stock in transit is visible on both sides.
- **Emergency outlet-to-outlet transfer:** request → both managers approve (or one, by the routing setting) →
  dispatch → receive, same in-transit rules; flagged on reports as emergency.
- **Production at the central kitchen:** production order (recipe × quantity) → consumes raw material → produces
  semi-finished / finished items with a batch and expiry → yield variance → dispatched to outlets.
- **Transfer price:** at cost, cost + %, or a price list, per supply route; stock value per location and branch.
- **Tax on transfers (India):** between branches with the **same GSTIN** a delivery challan; between **different
  GSTINs** (other state) a tax invoice from the sending entity and a purchase on the receiving one, numbered in each
  entity's series. Across countries: MONO records the transfer and its documents; customs / export paperwork is done
  outside MONO (decision #12).
- Levels, reorder lists, order days, audits, dead stock, store keepers and approvers are **per branch / location**.
- Purchase orders say **deliver to which branch**; vendors can be limited to entities / branches; price lists per
  vendor per branch.

### 3.7 Countries, currencies, time zones
- Per entity: **currency** (money stored as minor units + currency code, generalising today's paise), **tax regime**
  (India GST; VAT for e.g. UAE / UK; none) as tax profiles the accountant fills; legal and number formats on documents.
- Per branch: **time zone** — due times, shifts, attendance, day close and reminders follow the branch's clock.
- Group reports convert to a **base currency** using an exchange-rate table (entered monthly, or a feed later).
- This changes CLAUDE.md non-negotiables 7 and 8 (one company time zone; ₹ and Indian formats) for foreign
  entities only. Indian entities keep ₹, lakh / crore and DD/MM/YYYY. **Needs your approval** (decision #10).

### 3.8 Franchises
- A franchise is an entity of type FRANCHISE with its own owner and users. **Hard isolation:** its people can never
  reach beyond their entity, and group people see a franchise only with an explicit "franchise oversight" right.
- Shared from the group, read-only: brand menu, recipes, checklists and SOPs, training material.
- **Supplies from the central kitchens are sales** to the franchise (tax invoice, its own receivable in collections).
- **Royalty and fees:** % of sales (from the franchise's POS) or fixed, invoiced monthly; minimum guarantee.
- **Brand audits:** head-office auditors run audit checklists at franchise outlets (score, photos, corrective tasks).
- Franchise agreement, licences and renewal dates in Documents with reminders.
- **Exit:** export everything of one entity (data + files) as a package; then archive it.

### 3.9 Numbering, documents, licences
- Number series keyed by **entity / branch / document type / FY** (GST: one invoice series per GSTIN per FY;
  outlet bill series per outlet). Existing company-wide series continue unchanged for current data.
- Letterhead, address, GSTIN / TRN, FSSAI and licence numbers per entity and branch on every document.

### 3.10 Processes, checklists, work
- Every process record, checklist run, ticket, slip, PO, document, POS bill and CRM order carries a **branch**
  (the starter's branch, or a field). Live FMS, My steps and reports filter by branch.
- **Step doers are picked inside the record's branch** first (role / people at that branch), then the setting's
  fallback (region, group) — never silently someone at another outlet.
- **One checklist template → a run per branch**, done by that branch's people, with per-branch due times (its time
  zone); a change to the template applies everywhere.
- Flow designer people (EA, slip receiver / approver, ticket coordinator) can be set per branch.

### 3.11 Reports and setup
- Every report and dashboard has **Branch / Region / Entity / Group** filters; outlet **comparison and ranking**
  (sales, food cost, wastage, attendance, checklist misses, complaints, ticket times).
- Header cards and health check per branch.
- **Open an outlet by copying another** (checklists, levels, tables, menu prices, routing); **close an outlet**
  safely (move people, transfer stock, finish or move open work, then archive).
- Masters rows can belong to a branch / entity or be group-wide.

**Done when (G1–G45 in §13):** a group with 2 Indian entities (two states), 1 foreign entity and 1 franchise; 2 central
kitchens; 7 outlets. An area manager over 4 outlets sees only those; the franchise sees only itself. Kitchen 1
produces a gravy batch and sends it to Outlets 1 and 5 (in transit, received with a shortage); Outlet 2 sends stock to
Outlet 3 in an emergency; a transfer to the other state's entity creates a tax invoice in each series; a person moved
mid-month is paid correctly by both branches; leave follows the configured chain; payroll closes per entity in INR
and the foreign currency; group reports show all 7 outlets ranked, converted to the base currency.

---

## 4. Phase 13 — Inventory v2 (kitchen, bar, stores)

Changes decision 74 (one stock number per item) — a **migration** moves today's stock into the main store location.

- **Locations with their own stock:** main store, kitchen(s), bar(s), housekeeping, banquet, minibar — each inside a
  branch (§3.1); `StockBalance (item, location)`; transfers really move quantity.
- **Built here from the Phase 12 design (§3.6):** several central kitchens with supply routes, production orders,
  indents with dispatch / in transit / receive, emergency outlet-to-outlet transfers, transfer prices, delivery
  challans or tax invoices between GSTINs, per-branch levels, reorder lists, audits and approvers.
- **Units and conversion:** purchase unit → stock unit → recipe unit (case of 12 → bottle 750 ml → 30 / 60 ml peg;
  sack 25 kg → g). Every move stores the unit used and the converted quantity.
- **Batches and expiry:** batch, expiry date, FEFO issue, expiry alerts (N days before), expired-stock list.
- **Recipes (BOM):** a menu item / sub-recipe (gravy, batter) → ingredients with quantity, unit, **yield %** and
  **wastage %**; versioned; recipe cost live from latest rates; food-cost % against the selling price.
- **Requisition / indent:** kitchen or bar asks the store → approval → issue (transfer) → received confirmation;
  partial issue; shortage shows on the store's list.
- **Goods receipt (GRN) against PO:** quantity and rate variance, batch / expiry capture, invoice number, short /
  excess / rejected quantities, vendor return.
- **Par levels per location** and the reorder list per location (OWS works per location).
- **Wastage register** with reasons (spoiled, over-production, returned dish, breakage, staff meal, complimentary),
  photo, approval over a value limit.
- **Theoretical vs actual consumption:** sales × recipes vs opening + received − closing count → **variance** per
  item / outlet / day, with red flags above a set %.
- **Closing counts per location** (daily for bar and kitchen, weekly / monthly for stores) with blind-count option.
- **Bar:** open-bottle tracking in ml, peg sizes, bottle-level and ml-level stock, breakage, brand-wise register.
- **Valuation:** weighted average (default) or FIFO, per location.

**Done when (I1–I30):** a case of whisky received in the store, indented to the bar, sold as 60 ml pegs through a
recipe, counted at close, shows the right ml balance and variance; an expired batch is blocked from issue.

---

## 5. Phase 14 — Hospitality setup and Menu

**System Master → new tab "Hospitality"** with sub-tabs:
| Sub-tab | What |
|---|---|
| Outlets | Restaurant, bar, café, room service, banquet, pool bar…; each with its kitchen stations, stock location, price list, timings, tax profile |
| Floors & tables | Floor plan editor (drag tables, shapes, capacity, combinable tables, sections, assigned stewards) |
| Rooms | Room types (occupancy, beds, amenities, photos), rooms (number, floor, type, features, connecting rooms) |
| Taxes & charges | Tax profiles (CGST/SGST/IGST, slab chosen by the declared tariff for rooms — rates entered by the accountant, never hard-coded), service charge (**voluntary**, guest can remove it — CCPA guidelines), packaging, delivery charges, round-off |
| Printers & stations | KOT routing: category → station → printer / kitchen display; bill printers per outlet |
| Payment modes | Cash, UPI, card, wallet, room charge, company credit, complimentary; which need a reference |
| Discounts & approvals | Discount types (%, ₹, item, bill), limits per role, approval above limit, NC (no-charge) reasons |
| Day close rules | Business-day cut-off (e.g. 04:00), who closes, cash denominations, blind cash count |

**New left-menu section "HOSPITALITY"** (only shown when the module is on):
`POS · Tables · Kitchen display · Bills · Reservations · Front desk · Room calendar · Bookings · Guests ·
Housekeeping · Night audit · Banquets · Bar register · Day close · Hospitality reports`

**Menu** (Hospitality → Menu, also a tab in POS setup): categories, items (linked to a recipe), variants (half / full,
30 / 60 ml, small / large), modifiers and add-ons (with stock effect), combos, veg / non-veg / egg marks, allergens,
spice level, photos, Hindi names, price per outlet and per time band (happy hour), availability windows (breakfast
07:00–10:30), **86 / out of stock** toggle (auto when recipe stock is short), HSN/SAC codes.

**Done when (S1–S16):** an outlet with 3 stations, a floor of 20 tables, 40 rooms of 4 types, a menu of 120 items with
variants and modifiers, and tax profiles are set up from screens alone.

---

## 6. Phase 15 — POS, KOT, kitchen display, billing, payments, day close

- **Order taking** (tablet / phone / desktop, big touch targets): pick table (floor view with live status: free,
  seated, ordered, bill printed, paid, reserved), covers, steward; order types dine-in / takeaway / delivery / room
  service (→ guest folio) / staff meal.
- Add items with variants, modifiers, notes ("less spicy"), course (starter / main / dessert), **hold / fire** by
  course, seat numbers.
- **KOT:** sent per station (kitchen, tandoor, bar, dessert), numbered per day, printed and/or on the **kitchen
  display**; KOT edits and cancellations need a reason, and above a role limit an approval (void report).
- **Kitchen display (KDS):** tickets per station, timers with colours, bump item / ticket, recall, "all day" counts,
  expo screen.
- **Table operations:** move table, merge tables, split table, transfer items between tables, change steward.
- **Bill:** GST-correct invoice (per item tax, HSN/SAC, B2B with GSTIN), voluntary service charge, discounts with
  approval, NC with reason, round-off, **split bill** (by item, by seat, equally, by amount), reprint marked
  DUPLICATE, bill cancel with approval and reason (audit), credit note for refunds.
- **Payments:** multiple modes on one bill, UPI QR on the bill, card reference, room charge (guest signature),
  company credit (→ receivables in CRM collections), tips recorded per steward, advance adjustments.
- **Stock:** every settled item consumes its recipe from the outlet's location; cancelled KOTs before cooking don't;
  wastage asked for cooked-then-cancelled items.
- **Day close / shift close:** cash count by denomination, expected vs counted, UPI / card totals, X report (shift)
  and Z report (day), cannot back-date once closed (reopen needs owner + reason).
- **Works when the internet is down:** MONO runs on the office server, so tablets on the LAN keep working; the PWA
  also keeps an **offline order queue** (orders and KOTs saved on the device, sent when the server answers).
- **Printing:** the server sends ESC/POS straight to network thermal printers (IP:9100); USB printers through a small
  print agent on a PC (same pattern as the planned Tally agent).

**Done when (P1–P40):** a dinner service of 30 tables from seating to Z report, including a split bill, a room
charge, a voided KOT with approval, a printer going offline and the server losing internet, passes e2e.

---

## 7. Phase 16 — Table reservations, waitlist, guests

- Reservation book per outlet: date / time slots, party size, duration by party size, table assignment (manual or
  best fit, combining tables), special requests, occasion, **no double booking** (availability engine).
- Channels: phone / walk-in by staff, **online booking page** (public, with availability, captcha, rate limit),
  WhatsApp confirmation and reminder, deposit / advance by payment link for large parties.
- Statuses (state machine): requested → confirmed → reminded → arrived → seated (opens the POS order on the table)
  → finished; cancelled; **no-show** (deposit rule).
- **Waitlist** with quoted wait time and a WhatsApp "your table is ready".
- **Guest profiles** (one per mobile, shared with the hotel): visits, spend, favourite dishes, allergies, preferences,
  birthday / anniversary, notes, tags (VIP, regular), consent for marketing (DPDP Act consent recorded).

**Done when (R1–R20).**

---

## 8. Phase 17 — Hotel (property management)

- **Rates and availability:** rate plans EP / CP / MAP / AP, corporate and agent rates, seasons, weekend, length of
  stay, min stay, closed to arrival, extra adult / child, inventory per room type per day, stop-sell.
- **Room calendar (tape chart):** rooms × days, drag to move / extend, colour by status, no overlaps possible.
- **Bookings:** individual, group / block (with release date), corporate, travel agent (commission), OTA (§10);
  advances, cancellation policy and charges, no-show charge, booking voucher by WhatsApp / email.
- **Front desk:** arrivals / in-house / departures / due-outs lists, **check-in** (ID photo, KYC fields, signature,
  **Form C** for foreign guests with the 24-hour reminder and an export for the FRRO portal), room assignment,
  upgrade, room move, early check-in / late check-out charges, extend / shorten stay, key handover, visitor log.
- **Guest folio:** room charges, POS room-service postings, laundry, minibar, extras, advances; split folio,
  bill-to-company (→ city ledger / receivables), routing rules (room to company, extras to guest), GST invoice at
  check-out by tariff slab, credit notes, folio transfer between rooms.
- **Night audit:** posts room and tax charges, marks no-shows, checks open folios and unsettled bills, rolls the
  business date, produces the night audit pack (occupancy, ADR, RevPAR, revenue by outlet, cash).
- **Housekeeping:** room status (vacant clean / vacant dirty / occupied / inspected / out of order / out of service),
  daily board and assignments by floor, cleaning checklist per room (existing checklists with photo), inspection,
  **minibar check** (posts to folio), linen and amenities issue (stock), **lost & found** register, turndown.
- **Maintenance:** out-of-order rooms through help tickets (room blocked until the ticket closes).
- **Guest requests** during the stay (towels, iron, cab) → tickets with SLA, from the front desk or a QR in the room.
- **Police / guest register** report and occupancy statistics.

**Done when (H1–H50):** a 3-night CP stay with a room move, two room-service charges, minibar, split folio
(room to company, extras to guest) and a no-show the same night closes correctly through night audit.

---

## 9. Phase 18 — Banquets & events, bar, compliance

- **Banquets:** halls and capacities, event enquiry → quotation (menu packages per plate, hall rent, décor) →
  booking with advance → **BEO** (banquet event order) to kitchen, service and housekeeping → indent from recipes ×
  guaranteed covers → event day checklist → final bill (actual covers) → feedback. Hall calendar refuses clashes.
  Built on FMS + linked fields + recipes.
- **Bar & excise:** brand-wise daily register (opening, received, sold in ml / bottles, closing), permit / licence
  numbers, **state format export** (first: Rajasthan; others on request), dry-day calendar blocks liquor sales.
- **Compliance in Documents master with expiry reminders:** FSSAI licence, liquor licence, fire NOC, music licence,
  lift / boiler certificates, pollution consent; **HACCP** temperature logs (checklists with value fields and
  out-of-range alerts); pest control schedule.

**Done when (B1–B20).**

---

## 10. Phase 19 — Integrations

| Integration | How | Honest limit |
|---|---|---|
| OTAs (Booking.com, MakeMyTrip, Agoda, Airbnb…) | Through a **channel manager** API (e.g. Channex, STAAH, eZee Centrix): push rates / availability, pull bookings and cancellations | Direct OTA connections need certification by each OTA; a channel manager is the practical route and costs a monthly fee |
| Website booking engine | MONO public booking page (rooms and tables) with live availability | — |
| Payment links / UPI | Razorpay or Cashfree: advance links, UPI QR on bills, webhook marks paid | Card machines (EDC) are recorded by reference unless the bank offers an API |
| Zomato / Swiggy | Orders entered on POS as "Delivery – Zomato", payout CSV import and reconciliation | Direct order push needs approved POS-partner status with each aggregator |
| GST e-invoice (B2B) | IRP through a GSP API when turnover crosses the threshold | Needs a GSP account |
| Tally | Daily sales, purchase and receipt vouchers through the Tally agent (XML on port 9000) | Agent runs on the Tally PC |
| Printers | ESC/POS over the LAN; USB via the print agent | — |

**Done when (X1–X20).**

---

## 11. Phase 20 — Reports, load test, offline drill, guides

- Daily **flash report** (WhatsApp 08:00 to owner / GM): sales by outlet, covers, average per cover, occupancy, ADR,
  RevPAR, food cost %, beverage cost %, cash vs system, voids, discounts, NC.
- Reports: sales by item / category / steward / hour, KOT-to-serve times, void and discount audit, variance, stock
  valuation per location, receivables ageing for companies and agents, GSTR-1 export.
- Hospitality lines added to the **Weekly MIS** and scorecards (stewards, kitchen stations, housekeeping).
- **Load test at service peak:** 30 POS devices, 400 KOTs an hour, 10 front-desk users, 50 back-office users at once;
  p95 under 300 ms for POS actions.
- **Offline drill:** pull the internet during a service; pull the server's power (UPS) — written results.
- Printable guides: steward, cashier, kitchen, bartender, front office, housekeeping, night auditor, store, GM.

---

## 12. Roles added
Steward / captain · Cashier · Kitchen station (chef) · Bartender · F&B manager · Front office · Reservations ·
Housekeeping supervisor / attendant · Night auditor · Banquet manager · Store keeper (exists) · GM.
Each gets a ready role in Roles with the right permissions and its own phone home screen.

---

## 13. Coverage checklist (the 259 workflows that define 100%)

Each row becomes a test. Count per area:

| Area | Rows | Examples |
|---|---|---|
| L Linked fields | 18 | learn + Write…, list merge, `fms:` source, `rec:` source, unique, fill, cascade, formula, stock on step, reversal |
| G Branches, entities, franchises | 45 | scopes, routing chains, branch managers, area managers, branch history, floating staff, per-entity HR / pay / payroll close, holidays by country/state, currencies, time zones, tax regimes, number series per GSTIN, indents, in transit, emergency transfers, production, transfer price, inter-GSTIN invoices, franchise isolation, royalties, brand audits, entity export, outlet copy / close, comparison reports |
| I Inventory v2 | 30 | locations, units, batches, FEFO, recipes, sub-recipes, yield, indent, GRN variance, wastage, variance, bar ml, valuation |
| S Setup & menu | 16 | outlets, floors, rooms, taxes, printers, payment modes, discounts, menu, variants, modifiers, 86, time prices |
| P POS & billing | 40 | table states, KOT routing, KDS, edits/voids, move/merge/split, bills, split bills, payments, room charge, credit, tips, day close, offline queue, printers |
| R Reservations & guests | 20 | availability, best-fit tables, online booking, deposits, reminders, no-show, waitlist, seat → order, guest profile, consent |
| H Hotel | 50 | rates, tape chart, bookings, groups, check-in, Form C, folio, routing, night audit, housekeeping, minibar, lost & found, OOO |
| B Banquets, bar, compliance | 20 | enquiry → BEO → indent → bill, excise register, dry days, licences, HACCP logs |
| X Integrations | 20 | channel manager, booking engine, payment links, aggregator reconciliation, e-invoice, Tally, printers |
| **Total** | **259** | |

The full row list is written into `docs/plans/coverage.md` at the start of Phase 11, reviewed by GGM / the hotel
team, and frozen before building.

---

## 14. Decisions needed from you before the phase that uses them

| # | Decision | Needed by |
|---|---|---|
| 1 | Which property / outlets first (one hotel? how many restaurants and bars, rooms?) | 14 |
| 2 | Printers: network thermal (recommended) or USB; kitchen displays (tablets / TVs) | 15 |
| 3 | Payment gateway: Razorpay or Cashfree | 16 / 19 |
| 4 | Channel manager: Channex (open API) / STAAH / eZee Centrix | 19 |
| 5 | Excise register format: which state(s) | 18 |
| 6 | Valuation method: weighted average or FIFO | 13 |
| 7 | Business-day cut-off time and who may reopen a closed day | 15 |
| 8 | GST slabs and HSN/SAC codes, confirmed by your accountant | 14 |
| 9 | Franchises inside one MONO with hard isolation (recommended), or each franchise as a separate MONO company | 12 |
| 10 | OK to relax CLAUDE.md non-negotiables 7–8 for foreign entities only (their currency, time zone, tax regime) | 12 |
| 11 | Base currency for group reports and where exchange rates come from (entered monthly, or a feed) | 12 |
| 12 | Do central kitchens ever send food across borders, or are foreign outlets supplied locally? | 12 |
| 13 | List of entities (GSTINs / foreign companies), regions, branches and which kitchen feeds which outlet | 12 |
| 14 | Default approval routing per module (branch manager first or department head first) | 12 |

## 15. Size
Roughly the size of Phases 5–10 together (Phase 12 alone is about one large phase). Phase 11 is small enough to start now and is useful for GGM even
without the hospitality modules.
