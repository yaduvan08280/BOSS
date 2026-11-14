# What setting up TORA found (14/11/2026)

Built a full restaurant-group demo through MONO's API (as admin and as each staff member) and clicked through it in
Chromium at 390 × 844 and 1440 × 900 (owner, captain, chef). Fixed ones are on branch `fix/tora-pitch-findings`.

## Fixed

| # | What | Where |
|---|---|---|
| 1 | Pack roles (all 10 packs) lacked Member's daily rights: no process steps ("You don't have access"), no punch-in or leave, no search, no people list | `packages/shared/src/packs/library/kit.ts`, `hospitality.ts`, `logistics.ts` + test |
| 2 | Giving a task to a franchise person said "The doer is not an active person" | `delegation/service.ts`, `work/actor.ts` + franchise test |
| 3 | Editing a branch in System Master wiped its phone and extra punching gates (details replaced, not merged) | `org/setup.routes.ts` + test |
| 4 | Changing a checklist's doer left the old doer's open run and made a second one for the same time | `checklist/service.ts` + test |
| 5 | POS, kitchen display, reservations and day close opened on the first outlet by name ("In-room dining – Vaishali" for a rooftop captain) | `hosp/outletChoice.ts`, 4 screens, `auth/service.ts` (`branchId` in me) |
| 6 | The order sheet did not name its table | `pos/OrderPanel.tsx` |
| 7 | On phones the search box of Delegation, Users, Org chart and Templates shrank to an icon | 4 screens |
| 8 | Two HR tests failed every Saturday (leave "tomorrow" = Sunday, the weekly off) | `hr.test.ts`, `hr-cover.test.ts` |
| 9 | No month-wide attendance report: added the muster register and daily punch report with Excel / PDF / CSV | `hr/muster.ts`, `hr/muster-export.ts`, `hr/MusterTab.tsx` + test |
| 10 | A leave approved after its days were settled left them "absent" (muster and pay wrong) | `hr/leave.ts` + test |

## Not fixed (gaps to decide on)

- **Weekly offs come from the default shift, not each person's shift or a rota**: lounge and kitchen staff on a
  7-day shift show Sundays as WO/P (comp-off earned) and a rota day off reads as absent. Hospitality needs a
  per-person weekly off or rota.
- **Full day = 8 h with an 8-hour shift**: leaving 2 minutes early is a half day; set "hours of work for a full
  day" below the shift length (7.5 h) for TORA.
- **An outlet takes all its stock from one location**: a bar and a kitchen in the same outlet must share a store.
  A route per menu category (bar items from the bar, food from the kitchen) would fix it.
- **FMS stock steps use the old free-text location** (`stock.from.fixed`), not Phase 13 locations.
- **Pack roles reach the whole group** (`reach: group`); floor roles would usually be `branches`. Set by hand for TORA.
- **Reports/Kitchen display/Reservations default outlet** now remembered, but **Bar register and Compliance**
  still start at the first branch by name (Vaishali, which has no bar).
- **Banquet packages** are not returned with halls (`GET /api/banquets/packages` is separate) — easy to miss for an
  integrator; not a user-facing bug.
- **Hospitality reports "yesterday"** follows the business-day cut-off (04:00): after midnight it shows the day
  before yesterday's sales. Correct by the rule, surprising on screen; a note under the date would help.
- **Every CRM order opens an after-order process record**, so importing old orders makes old late records; there is
  no "historic order" switch (closed by hand for TORA).
- The **Chrome on this PC's Windows side** reaches a different MONO on `localhost:5173` (GGM Minerals); the WSL dev
  server is not reachable from that browser. Testing used Playwright in Docker instead.
