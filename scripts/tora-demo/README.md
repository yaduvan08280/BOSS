# TORA SKYLOUNGE demo set-up

Scripts that built the TORA demo company through MONO's own API (as an admin and as each staff member would), so the
set-up also exercised the product. Run with Node 22 against a running dev stack, in this order:

```bash
cd scripts/tora-demo
export OWNER_ID=<owner mobile> OWNER_PW=<owner password>   # MONO_URL / MONO_ORIGIN if not localhost:3000 / :5173
node org.mjs && node ims.mjs && node hosp.mjs && node setup2.mjs && node fms.mjs && node work.mjs \
  && node records.mjs && node stock.mjs && node pos.mjs && node res.mjs && node hotel.mjs && node hotel3.mjs \
  && node crm.mjs && node hr.mjs && node attendance.mjs && node rota-fix.mjs
cd ../.. && npx tsx scripts/tora-demo/settle-days.ts 2026-11-01 2026-11-13   # the nightly job for the past days
```

`org.mjs` writes `ids.json` (the ids of what it made); the later scripts read it. Staff logins get the demo password
from `data.mjs` (set once with a small seed script, like `seed:demo`). Most scripts skip what already exists; a few
(records, POS, stock) add data each time they run. `shoot.sh` takes screenshots with Playwright in Docker
(`./shoot.sh 390 844 <login> <password> shots/phone /hosp/pos /fms/live`), `sheet.cjs` makes contact sheets.

Everything except TORA's name, address and menu style is sample data. See `docs/plans/tora-demo-guide.md`.
