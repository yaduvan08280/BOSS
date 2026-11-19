# Go-live: what only you (or somebody else) can do

Everything below needs a real account, a real device, the building or a person — it could not be done
while MONO was built. Each item says what to do, the exact commands, and what "passed" looks like.
Tick them in order; note the date and who did it. Commands run on the server in `~/mono`.

---

## 1. Update the server, set the new settings

- [ ] Update:
  ```bash
  ./deploy/update.sh
  ```
- [ ] In `.env` (the 48 GB server): `PG_SHARED_BUFFERS=8GB`, `PG_CACHE=24GB`; `AI_ALLOW_PRIVATE=1` **only** if
      an AI or speech server runs on this machine. Then:
  ```bash
  ./deploy/compose.sh up -d
  ```
- [ ] **Passed when** this says `"status":"ok"` (after the first night it must still say so — the backup,
      the base copy and the log archive report in by then):
  ```bash
  curl -s http://127.0.0.1:8080/api/health/ready
  ```
- [ ] System Master → Errors shows the same checks in words, all "ok".
- [ ] Put an outside monitor on `https://<your address>/api/health/ready` (alert when the text is not
      `"status":"ok"`).

## 2. Roles (Tora)

- [ ] System Master → Roles → **Recommended access** → read the preview → Apply.
- [ ] **Passed when** a kitchen person signs in and sees only their own work, and the Owner still sees everything.

## 3. Messages really arrive

| | Do | Passed when |
|---|---|---|
| Telegram | Integration → Connect channels → paste the bot token from @BotFather → Link Telegram → send yourself the code | Notification rules → **Send test** reaches your Telegram within seconds; a task given to you arrives with Accept / Done buttons; a task whose text has `<` or `&` in it arrives too |
| Email | Connect channels → SMTP host, port, user, password, From | Send test arrives; it is not in spam |
| WhatsApp | WhatsApp API → provider, endpoint, key → **Test API**; approve the templates in the provider's dashboard | A client message (a payment reminder to your own number) arrives; the template shows "Approved" |
| Phone push | Open MONO on a phone → Install → allow notifications | Send test shows on the lock screen |
| Alerts | Stop the worker for five minutes: `./deploy/compose.sh stop worker` … then `./deploy/compose.sh start worker` | Every Owner and Admin gets "The worker stopped…" once, and "back to normal" after the restart |

## 4. Money and tax — with the accountant

- [ ] Money → Money set-up → **Tax rates**: every code typed with its percent and the date it starts
      (MONO ships none). Room tariff slabs for the hotel.
- [ ] Each legal entity's GSTIN, state and invoice title (System Master → Branches → the entity).
- [ ] Raise one invoice inside the state and one outside; the accountant checks CGST / SGST / IGST, the
      round-off and the printed bill (Bills → the bill → PDF).
- [ ] Tally: Money set-up → Tally ledgers → a ledger name for every head; export one day and import it into
      a **copy** of the Tally company. **Passed when** Tally takes the file with no error and the day's
      totals match Money → Day close.
- [ ] The accountant confirms in writing: the commission of delivery partners booked as a credit note
      (decision 206); SAC 999799 for charges on e-invoices (decision 207); what a "month's day value" is for
      pay (decision 70). PF / ESI / TDS are **not** in MONO.
- [ ] GSTR-1: download a month's working file and compare it with the accountant's own figures.

## 5. Payment gateway, e-invoice, channel manager

Each was tested against a stand-in, never a real account.

- [ ] Gateway (Razorpay or Cashfree): Integration → Connections → keys and the webhook secret; set the
      webhook in the gateway's dashboard to the address MONO shows. Make a ₹1 link for a table deposit and
      pay it. **Passed when** the booking confirms by itself and Money shows the advance with the gateway's
      payment id.
- [ ] E-invoice: the GSP's address and keys; register one invoice to a party with a GSTIN on the GSP's
      **sandbox** first. **Passed when** the bill shows an IRN and the printed bill carries it. MONO speaks
      its own plain contract — your GSP needs a small mapping onto it (decision 207).
- [ ] Channel manager: the same — a mapping is needed and no channel manager has certified it
      (decision 201). Do not rely on it for live inventory until a test booking came in and a rate went out.

## 6. Printers and the site agent

- [ ] A network printer: Hospitality → Printers → IP and port → print a test ticket. **Passed when** it
      prints, Hindi-free (the printer prints "Rs" for ₹ and "?" for other scripts — decision 170).
- [ ] A USB printer or Tally at a branch: make an agent key (Integration → Connections), run
      `deploy/site-agent/agent.mjs` on that PC (INSTALL.md §7A). **Passed when** Integration health shows
      the agent "heard from" within a minute and a bill prints.
- [ ] Pull the printer's cable during service, take three orders, plug it back. **Passed when** all three
      tickets print, once each.

## 7. Google Drive (optional)

- [ ] System Master → Integration → Google Drive: the four steps with your own Google Cloud client.
      **Passed when** a newly uploaded photo appears in the "MONO Files" folder within two minutes and still
      opens in MONO.

## 8. Restore on a second machine (do it before relying on the backups)

- [ ] On another PC with Docker: INSTALL.md steps 1–4 with the **same `.env`**, copy the newest
      `mono-db-*.dump`, `mono-uploads-*.tar.gz` (and `base/`, `wal/`) into its backups folder, then:
  ```bash
  ./deploy/restore.sh
  ```
  ```bash
  ./deploy/restore.sh <the newest stamp it listed>
  ```
- [ ] **Passed when** you can sign in there, today's work is there, an uploaded photo opens, and a saved
      key still works (Integration shows the channels connected). Write the time it took in INSTALL.md's
      drill table.
- [ ] Once: roll that copy back to a minute you choose (`./deploy/restore-pitr.sh <copy> "YYYY-MM-DD HH:MM"`)
      and check that something done after that minute is gone.

## 9. The building: internet and power

- [ ] Pull the internet cable for five minutes during a test service on the POS. **Passed when** orders
      taken meanwhile are queued on the device and go through, once each, when the line is back; a bill
      cannot be made offline (it needs the server) and the screen says "No internet".
- [ ] Cut the server's power (with the UPS disconnected) while people work; start it again. **Passed when**
      MONO comes back by itself in a few minutes, `…/api/health/ready` is ok, and the last saved order is there.
- [ ] Run the load test from a laptop on the same network against a **test company** (never live data):
  ```bash
  BASE=http://<server>:8080 LOGIN=<owner mobile> PASSWORD=<password> SECONDS=900 node deploy/loadtest/service-peak.mjs
  ```
  **Passed when** it ends with `"pass":true` and `"failed":0`.

## 10. Words and forms

- [ ] Hindi: `node scripts/hindi-review.mjs export` writes `docs/hindi-review.csv`; somebody who reads Hindi
      fills the corrections column; `node scripts/hindi-review.mjs import` puts them back.
- [ ] Excise register: compare the exported file with the department's own form for your state before
      filing anything (only a Rajasthan layout exists, and it is MONO's reading of the usual register).
- [ ] Payroll: run a closed month beside the accountant's sheet for the same month. Gross only.

## 11. First week

- [ ] Each morning: `…/api/health/ready`, System Master → Errors, and last night's backup in
      `/srv/mono/backups` (the health check says how old it is).
- [ ] After the first Sunday: the health check's `restoreTest` says "Passed".
