# Document F — coverage rows for Phases 12–21 (no code)

Read `CLAUDE.md`, the whole of `/home/user/BOSS/docs/plans/hospitality-100-plan.md`, and
`/home/user/BOSS/docs/plans/coverage.md` (match its style: one plain sentence per row saying what a person does
and what must be true, the plan section, an empty "Test" column).

Write `docs/plans/coverage-later.md` in your checkout. Counts are fixed by the plan's §13 and must be exact:

| Area | Rows | Ids | Phase |
|---|---|---|---|
| A Architecture (A1 is in coverage.md) | 9 | A2–A10 | as §1.2's table says |
| G Branches, entities, franchises | 45 | G1–G45 | 12 (mark each with its stage A / B / C / D, §3.12) |
| U money core | 12 | U11–U22 | 12M |
| I Inventory v2 | 30 | I1–I30 | 13 |
| U item tracking | 8 | U23–U30 | 13 |
| S Setup & menu | 16 | S1–S16 | 14 |
| P POS & billing | 40 | P1–P40 | 15 |
| R Reservations & guests | 20 | R1–R20 | 16 |
| H Hotel | 50 | H1–H50 | 17 |
| B Banquets, bar, compliance | 20 | B1–B20 | 18 |
| X Integrations | 20 | X1–X20 | 19 |
| U engines and packs | 12 | U31–U42 | 15–20 (U31–U36 one non-hospitality test per engine of §1.1: booking, counter billing, running account, price rules, registers, site agent; U37–U42 pack install, upgrade, export, two packs in one company, pack words and menu, removing a pack keeps its data) |
| K Proof packs | 45 | K1–K45 | 21 (nine industries in §11A's order × the five checks; name each trade's special thing from §12A) |

Rules: every row traceable to something the plan says; every bullet of every phase section covered at least once;
nothing invented. More workflows than rows → group close ones; fewer → split the important ones into their
distinct cases (split bill by item / seat / equally / amount). Written for a hotel owner: plain words, no code
names, concrete action and concrete expected result, Indian dates and money in examples. Include the "consume by
recipe on a step" row inside Inventory v2. A heading per phase with the plan decisions (§14) that must be answered
first. Start with a summary table adding up to 327 rows here + 29 in coverage.md = 356. End with "Questions for
the hotel team": everything too vague to turn into a testable row, as questions an owner can answer.

Count the rows per area with a script before finishing; no id duplicated or skipped. `npx prettier --write` it.
Commit on your checkout's branch (commit trailers as in COMMON.md); do not push.
