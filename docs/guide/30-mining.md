# 30. Mining

Install it once: **Masters → Master Library → Packs → Mining → Install**. Nothing you already have is changed. Then fill the tax rates with your accountant (**Money → Money set-up**) — the pack leaves them at 0 %.

## What the pack gives you
Ore by the **tonne** · **Weighbridge slip** and **Royalty pass** records · the roles **Weighbridge operator** and **Mine manager** · the process **Mine dispatch** · the **Royalty-pass register**.

## Production and fuel
Take the day's production into stock by the tonne (Stock → Receive). Receive diesel against purchase orders and **issue** it to each machine with a note.

## A dispatch
1. **Weighbridge slip**: vehicle, mineral, gross and tare — MONO works out the net.
2. **Royalty pass**: its number (used **once** — a repeat is refused), vehicle, mineral, weight, destination.
3. Bill the buyer from **Stock → Sell** by the net tonnes.
4. Run **Mine dispatch**: load → weighbridge → royalty pass → gate out. Mark the pass **Used** and the slip **Gate out**.

## The owner looks at
The **Royalty-pass register** · tonnes dispatched by mineral · stock of ore · diesel used · Money owed · Weekly MIS.

## Not in MONO
Reading the weighbridge directly (the site agent prints and posts to Tally; a scale reader is not built); royalty returns to the department; a mine per branch must be added in System Master → Branches (a pack cannot make branches).
