

## Phase 20 — Packs, reports, load test, drills, guides (13 rows; U37–U42 are the plan's; F1–F7 were drafted from the plan §11 on 13/11/2026 and are not among the plan's 356)

| # | Row | Plan | Test |
|---|---|---|---|
| U37 | **Pack install**: a pack (a file of set-up) installs into an empty company — roles, tax-code shells at 0 %, value lists, a master with its rows, items with their tracking, a record type, a published process, a checklist and a saved report, each pointing at the others by token; only admins install; a file that is not a pack is refused. The hospitality pack from the library switches the module on and brings the hotel's twelve roles, five tax shells and four checklists | §12A | `apps/api/src/modules/packs/packs.test.ts`, `apps/api/src/modules/packs/packs-share.test.ts` |
| U38 | **Pack upgrade**: a newer version adds only what is new; what the company changed since (a master's rows, a role's rights) stays as it is; the same version again changes nothing; an older version is refused | §12A | `apps/api/src/modules/packs/packs.test.ts` |
| U39 | **Pack export**: a company's own set-up is saved as a pack file — no id and no person of that company is in it — and installed in another company, where its record types, links between them, process and words work | §12A | `apps/api/src/modules/packs/packs.test.ts` |
| U40 | **Two packs in one company**: what both name (a master) is shared, not made twice, and its rows are left alone | §12A | `apps/api/src/modules/packs/packs-share.test.ts` |
| U41 | **Pack words and menu**: each pack's record types sit in a left-menu section of its own name; a pack's words replace built-in strings on every screen (a later pack wins where two name one word) | §12A | `apps/api/src/modules/packs/packs-share.test.ts` |
| U42 | **Removing a pack keeps its data**: its words go and the earlier pack's come back; its record types, records, masters and rows stay; put back later it finds its things again and makes nothing twice | §12A | `apps/api/src/modules/packs/packs-share.test.ts` |
| F1 | **Sales report**: before-tax sales of a span of business days by item (with variant), category, steward, hour or outlet — quantity, amount, share, orders; voided and no-charge lines are left out; only for people who may see hospitality, and only their own outlets | §11 | `apps/api/src/modules/hreports/hreports.test.ts` |
| F2 | **Kitchen times**: tickets by station with the average and slowest minutes from fired to ready and how many went over the limit; a ticket never marked ready is counted, not timed | §11 | `apps/api/src/modules/hreports/hreports.test.ts` |
| F3 | **Void and discount audit**: every void of a fired item and every discount or no-charge bill, with who and why, and the totals | §11 | `apps/api/src/modules/hreports/hreports.test.ts` |
| F4 | **Daily flash**: per outlet sales, guests, spend per guest, voids, discounts, no-charge bills and the cash counted against the system (unknown until the day is closed); per property occupancy, ADR and RevPAR from the night audit; food and drink cost % from the stock the day's orders took; limited to the reader's branches | §11 | `apps/api/src/modules/hreports/hreports.test.ts` |
| F5 | **The flash is sent** to the owner once a day for yesterday, from 08:00 on the company's clock, only where hospitality is on | §11 | `apps/api/src/modules/hreports/hreports.test.ts` |
| F6 | **GSTR-1 working file** of a month: B2B invoices by rate (IGST across states, CGST + SGST within one), sales to unregistered buyers by place of supply and rate, credit notes to registered buyers, the HSN summary and the documents issued — as JSON and one CSV; drafts and other months are left out | §11 | `apps/api/src/modules/hreports/hreports.test.ts` |
| F7 | **Receivables by kind of party**: what companies (or travel agents) owe, apart from everyone else | §11 | `apps/api/src/modules/hreports/hreports.test.ts` |

Through the screens (`e2e/phase20-packs-reports.spec.ts`, 380 and 1440): the hospitality pack installed from the Master Library's Packs card and the company's own set-up saved as a pack file; the reports of a day on which one order was served — the flash, sales by item, kitchen times, the void and the discount, the team's week (U37, U39, F1–F4). Not browser-tested: installing from a file, upgrading and removing a pack, GSTR-1 (an API download), receivables by kind.

**Rows of the plan that earlier phases never wrote down — where they stand (13/11/2026):**

| # | Row (plan §13) | State |
|---|---|---|
| U31 | A non-hospitality test of the **booking** engine | **Not built as an engine.** Table and room bookings are hospitality's own; other trades get a booking only as a record type (see Phase 21) |
| U32 | Counter billing outside hospitality | Tested: the counter sale of `apps/api/src/modules/ims/stock-serial.test.ts` (U27–U30) |
| U33 | Running account | A party's statement and ageing are tested (U18, U20); **billing against a contract by milestone is not an engine** — Phase 21 models it with a record type and invoices |
| U34 | Price rules | Tested with U27, U29, U30 (price lists by party kind and branch, the rate board) |
| U35 | Registers | The stock register and the wastage register are tested (I21, I27); a trade's own register is a record type or a saved report |
| U36 | Site agent | Tested: `apps/api/src/modules/connect/connect-agent.test.ts` (printing and Tally) |
| A2–A10 | Several API copies, shared limit counters, sign-in cache, short event transactions, a leader worker, versions on orders, number series under load, monthly tables, a Health screen | **Not done as a set.** In place: idempotency keys on orders and lines (decision 171), reserved bill numbers per device, per-person request ceiling (A1). Not built: PgBouncer and several API copies in the compose file, a shared rate-limit store, the sign-in cache, a leader election for the worker, monthly table partitions. The 10× load gate with an API copy killed was therefore not run — see `docs/phase20-load-and-drills.md` for what was |
