

## Phase 21 — Proof packs for nine other industries (45 rows; drafted from the plan §11A on 13/11/2026, not yet reviewed by GGM)

Each trade runs one scripted working day in its own empty company (API tests). Every shipped pack also installs alone, and all ten install together in one company (`apps/api/src/modules/packs/days/install-all.test.ts`).

| # | Row | Plan | Test |
|---|---|---|---|
| K1 | Pharmacy — **Set up from the pack**: roles, medicines tracked by batch, the Doctors master, prescription and expiry-return records, the return process, the registers; tax codes arrive at 0 % and the accountant types the rates | §11A | `apps/api/src/modules/packs/days/pharmacy.test.ts` |
| K2 | Pharmacy — **Buy and receive**: two lots of a medicine with different expiry and a second medicine are ordered, received by batch and expiry, and the distributor's bill (with input tax) is owed | §11A | `apps/api/src/modules/packs/days/pharmacy.test.ts` |
| K3 | Pharmacy — **Sell and bill**: a counter sale by barcode takes the lot that expires first, carries tax and is paid in cash; an expired lot on the shelf is never sold; more than the good stock is refused | §11A | `apps/api/src/modules/packs/days/pharmacy.test.ts` |
| K4 | Pharmacy — **The trade's own**: a Schedule H medicine is dispensed against a prescription (schedule required) and appears on the Schedule H register, the other sale does not; near-expiry stock goes back to the distributor — stock out, the bill credited, the return run through its process | §11A | `apps/api/src/modules/packs/days/pharmacy.test.ts` |
| K5 | Pharmacy — **Owner's view**: prescriptions by doctor, the medicine's stock register, a hospital's credit sale under Money owed (not overdue), what is owed to the distributor less the credit, the Weekly MIS | §11A | `apps/api/src/modules/packs/days/pharmacy.test.ts` |
| K6 | Gold and gems — **Set up from the pack**: pieces tracked one by one with a weight and priced by the gold rate, purity and HUID on every piece, old-gold and certificate records | §11A | `apps/api/src/modules/packs/days/gold.test.ts` |
| K7 | Gold and gems — **Buy and receive**: two rings received each with its number, weight, purity, cost and barcode; the workshop's bill (with tax) is owed | §11A | `apps/api/src/modules/packs/days/gold.test.ts` |
| K8 | Gold and gems — **Sell and bill**: no rate on the board, no sale; then a scanned ring sells at the day's rate × its weight × 22K with making charges at their own tax; a piece is sold once; tomorrow's rate changes tomorrow's price only | §11A | `apps/api/src/modules/packs/days/gold.test.ts` |
| K9 | Gold and gems — **The trade's own**: old gold is weighed and MONO works out its value (weight required), the scrap enters stock; a piece has one certificate — a second for the same piece or the same HUID is refused | §11A | `apps/api/src/modules/packs/days/gold.test.ts` |
| K10 | Gold and gems — **Owner's view**: old gold by purity, the vault's value, what the buyer owes until the receipt clears it, the Weekly MIS | §11A | `apps/api/src/modules/packs/days/gold.test.ts` |
| K11 | Retail — **Set up from the pack**: barcoded items with a price and tax code, the members' price list, return and scheme records, the shop-closing checklist | §11A | `apps/api/src/modules/packs/days/retail.test.ts` |
| K12 | Retail — **Buy and receive**: a carton of each item ordered and received; shelf stock and the distributor's bill (two tax rates, rounded to the rupee) | §11A | `apps/api/src/modules/packs/days/retail.test.ts` |
| K13 | Retail — **Sell and bill**: a basket scanned and paid in cash; a member pays the members' price; a scheme takes an amount off before tax; an unknown barcode or more than the shelf holds is refused | §11A | `apps/api/src/modules/packs/days/retail.test.ts` |
| K14 | Retail — **The trade's own**: a customer's return is asked, accepted only by an approver and the goods are back on the shelf; a scheme is started | §11A | `apps/api/src/modules/packs/days/retail.test.ts` |
| K15 | Retail — **Owner's view**: returns by reason, who owes, the Weekly MIS | §11A | `apps/api/src/modules/packs/days/retail.test.ts` |
| K16 | Wholesale — **Set up from the pack**: items, the dealer price list, the order-to-dispatch process | §11A | `apps/api/src/modules/packs/days/wholesale.test.ts` |
| K17 | Wholesale — **Buy and receive**: pipes and fittings ordered and received from the manufacturer | §11A | `apps/api/src/modules/packs/days/wholesale.test.ts` |
| K18 | Wholesale — **Sell and bill**: a dealer is billed at the dealer price on 30 days' credit (due date on the bill); a walk-in pays the counter price in cash | §11A | `apps/api/src/modules/packs/days/wholesale.test.ts` |
| K19 | Wholesale — **The trade's own**: the dealer's order runs confirm → pick and pack (checklist required) → dispatch (LR number required) → invoice, and closes | §11A | `apps/api/src/modules/packs/days/wholesale.test.ts` |
| K20 | Wholesale — **Owner's view**: what the dealer owes (not overdue), a part payment, the dealer's statement, the process report, the Weekly MIS | §11A | `apps/api/src/modules/packs/days/wholesale.test.ts` |
| K21 | Manufacturing — **Set up from the pack**: raw material and a made finished item, its bill of material, the quality-check record, the production process | §11A | `apps/api/src/modules/packs/days/manufacturing.test.ts` |
| K22 | Manufacturing — **Buy and receive**: grit and resin ordered and received by batch (resin with expiry) | §11A | `apps/api/src/modules/packs/days/manufacturing.test.ts` |
| K23 | Manufacturing — **Sell and bill**: an order for 40 slabs takes the raw material by the bill of material, 38 come out as a batch at their real cost; an order beyond the raw material cannot be finished; 30 slabs are invoiced to a dealer with tax | §11A | `apps/api/src/modules/packs/days/manufacturing.test.ts` |
| K24 | Manufacturing — **The trade's own**: a quality check on the batch (result required) is released only by an approver; the production order runs through its process (proof on the QC step) | §11A | `apps/api/src/modules/packs/days/manufacturing.test.ts` |
| K25 | Manufacturing — **Owner's view**: quality checks by result, stock value, what the dealer owes, the Weekly MIS | §11A | `apps/api/src/modules/packs/days/manufacturing.test.ts` |
| K26 | Construction — **Set up from the pack**: project (with a bill of quantities whose amounts MONO works out; a project's name used once), running-bill and work-order records, the certification process | §11A | `apps/api/src/modules/packs/days/construction.test.ts` |
| K27 | Construction — **Buy and receive**: cement and steel ordered and received; cement issued to the work, never more than there is | §11A | `apps/api/src/modules/packs/days/construction.test.ts` |
| K28 | Construction — **Sell and bill**: a running bill is measured, certified only by an approver and invoiced to the client with works-contract tax; the same RA number is not used twice; the bill runs through its process | §11A | `apps/api/src/modules/packs/days/construction.test.ts` |
| K29 | Construction — **The trade's own**: a subcontractor's work order and his bill entered against it | §11A | `apps/api/src/modules/packs/days/construction.test.ts` |
| K30 | Construction — **Owner's view**: running bills by project (total), what the client owes after a part payment, what suppliers and the subcontractor are owed, the Weekly MIS | §11A | `apps/api/src/modules/packs/days/construction.test.ts` |
| K31 | Real estate — **Set up from the pack**: the Units master with prices, the booking record with its payment schedule, the agreement-to-registry process | §11A | `apps/api/src/modules/packs/days/realestate.test.ts` |
| K32 | Real estate — **Buy and receive**: a developer buys services: the architect's bill is entered and owed | §11A | `apps/api/src/modules/packs/days/realestate.test.ts` |
| K33 | Real estate — **Sell and bill**: a flat is booked with its schedule; the same flat cannot be booked again while that booking lives; the first milestone is invoiced with tax and paid | §11A | `apps/api/src/modules/packs/days/realestate.test.ts` |
| K34 | Real estate — **The trade's own**: agreement signed, then the registry process with its proofs, and the booking is registered; a cancelled booking frees its unit for another buyer | §11A | `apps/api/src/modules/packs/days/realestate.test.ts` |
| K35 | Real estate — **Owner's view**: bookings by status with their value, what is owed, the Weekly MIS | §11A | `apps/api/src/modules/packs/days/realestate.test.ts` |
| K36 | Logistics — **Set up from the pack**: vehicles and drivers masters, consignment-note and trip records, the expense-claim process | §11A | `apps/api/src/modules/packs/days/logistics.test.ts` |
| K37 | Logistics — **Buy and receive**: the pump's diesel bill is entered and owed | §11A | `apps/api/src/modules/packs/days/logistics.test.ts` |
| K38 | Logistics — **Sell and bill**: a consignment note with its vehicle (freight required) is loaded and delivered; the freight bill is raised with tax | §11A | `apps/api/src/modules/packs/days/logistics.test.ts` |
| K39 | Logistics — **The trade's own**: a trip with kilometres worked out and its expenses is closed; the driver's claim runs through its process with proof | §11A | `apps/api/src/modules/packs/days/logistics.test.ts` |
| K40 | Logistics — **Owner's view**: freight by vehicle, the consignor's statement, the Weekly MIS | §11A | `apps/api/src/modules/packs/days/logistics.test.ts` |
| K41 | Mining — **Set up from the pack**: ore by the tonne with a price and tax code, weighbridge-slip and royalty-pass records, the dispatch process | §11A | `apps/api/src/modules/packs/days/mining.test.ts` |
| K42 | Mining — **Buy and receive**: diesel ordered, received and issued to a machine; the day's ore taken into stock by the tonne | §11A | `apps/api/src/modules/packs/days/mining.test.ts` |
| K43 | Mining — **Sell and bill**: a truck's slip has its net weight worked out and the ore is invoiced by the net tonnes with tax; more than the stock is refused | §11A | `apps/api/src/modules/packs/days/mining.test.ts` |
| K44 | Mining — **The trade's own**: a royalty pass number is used once (a repeat is refused whatever the capitals); the truck goes out through the dispatch process | §11A | `apps/api/src/modules/packs/days/mining.test.ts` |
| K45 | Mining — **Owner's view**: the royalty-pass register, tonnes by mineral, what the buyer owes, the Weekly MIS | §11A | `apps/api/src/modules/packs/days/mining.test.ts` |

Through the screens (`e2e/phase21-packs.spec.ts`, 380 and 1440): the Mining pack installed from the Master Library, a weighbridge slip whose net weight is worked out, a royalty pass whose number is refused the second time, and the pack's register (K41, K43, K44). **The other eight trades' days, and the buying, billing and owner's-view steps of all nine, are proved by API tests only** — the screens they use (purchase, goods receipt, counter sale, bills, records, processes, reports) are the ones tested in earlier phases.

**What a pack could not do, and what was done about it (plan rule: fix the core, never work around):**

| Found by | Gap | Fix in the core |
|---|---|---|
| Gold | making charges on a counter sale | a counter sale takes charges and a discount |
| Wholesale | a credit sale had no due date | a sale on credit is due after the party's credit days |
| Retail | no "member" kind of party for a members' price | the kind was added |
| Real estate | a cancelled booking kept its flat locked | a record status can free what the record held as unique |
| All | every company but the first missed newer modules' role rights | the start-up seed upgrades every company |

**Still gaps (not fixed, said in each trade's guide):** no booking of a resource by time for other trades (a vehicle can be on two consignments the same day); no billing engine by milestone (demands and running bills are invoices a person raises); old gold is not netted on the same bill; retention, TDS and cess on contractors' bills; a pack cannot make branches (mines, sites); reading a weighbridge; trade-specific government filings. Manufacturing was **not** checked with GGM staff.
