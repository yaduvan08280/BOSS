# TORA SKYLOUNGE demo — how to show it (prepared 14/11/2026)

The dev database on this PC holds a full demo for **TORA SKYLOUNGE** (company of the owner login `8569966304`).
Real: the name, the Murlipura address (3rd + 4th floor, Janak Square, Kedia Palace Rd), a cocktails & bar-food
pure-veg menu style, ~₹1,000 for two. **Everything else is sample data**: the people, the central kitchen,
TORA Stays & Banquets (Vaishali) and the Malviya Nagar franchise, the numbers, GSTIN/licence numbers, vendors.
Tax rates are demo values (FOOD 5 %, ROOM 5 %/18 % slabs, LIQUOR 0 % placeholder) — the accountant must set them.

Rebuild it on another machine with `scripts/tora-demo/` (see its README).

## Logins (password for every staff login: `Tora@2026`)

| Who | Login (mobile) | Shows |
|---|---|---|
| You (owner) | 8569966304 | everything, System Master |
| Aditya Khandelwal — Director | 7000011101 | admin view, EA board owner's tasks |
| Rohan Mehta — General Manager | 7000011102 | approvals, all branches |
| Karan Shekhawat — Restaurant Manager | 7000011110 | POS approvals (R6 discount waiting), floor |
| Deepak Saini — Captain (Sky Lounge) | 7000011112 | phone POS, his checklists, leave request |
| Manish Agarwal — Cashier | 7000011122 | bills, day close |
| Chef Harish Bhatt | 7000011130 | kitchen display, recipes, indents |
| Vinod Rawat — Sous chef | 7000011131 | kitchen display, receiving vegetables |
| Aman Singh Rathore — Head bartender | 7000011140 | bar, bar register |
| Gopal Choudhary — Store manager | 7000011150 | stock, transfers, GRN |
| Neha Kapoor — Front office (hotel) | 7000011160 | front desk, check-ins |
| Simran Kaur — Marketing & events | 7000011409 | party flow, CRM, NBD funnel |
| Riya Sharma — Hostess | 7000011121 | reservations, waitlist |

(Mobiles are +91 70000 1xxxx — imaginary; no WhatsApp/SMS is configured, only your Telegram bot.)

## A 20-minute walk-through

1. **Home → System Master** (owner): company, 4 branches in 2 legal entities, 16 departments, 45 people, org chart.
2. **Phone, as Deepak**: POS opens on the Rooftop → tap a free table → seat → order → *Send to kitchen*.
3. **Kitchen display, as Vinod**: the ticket appears; mark ready, bump. Tickets age amber at 10 min, red at 20.
4. **As Karan**: POS → *1 waiting for approval* (30 % off on R6 asked by a steward) → approve or refuse.
5. **Live FMS → Party & event booking**: six parties; open *Mehra anniversary* (late on the menu step) and its timeline.
6. **Delegation sheet / Checklists**: overdue tasks in red, the bar closing checklist with ml count.
7. **Reservations → Rooftop**: tonight's bookings, the gazebo party of 10 with a ₹500/head deposit, the waitlist.
8. **Inventory → Recipes & production**: cost % per dish; **Transfers**: central store → Murlipura; **Stock**: bands.
9. **Front desk / Room calendar** (Vaishali): 3 guests in house, Emma Clarke (British) with Form C due.
10. **Banquets**: Agarwal reception (confirmed, BEO sent), TechNova (quoted).
11. **Hospitality reports → Flash**, **CRM dashboard** (₹7.30 L month target), **Weekly MIS**, **Outlet comparison**,
    **Reports** (4 saved: parties by occasion, complaints by source …), **Compliance** (music licence ends 30/11).

## Before the meeting

- Records age: steps planned "in 1 hour" will be late by the meeting. That is fine to show (late = red), or re-run
  `node scripts/tora-demo/records.mjs` style actions to move a few forward.
- Your own test leftovers in this company: the process **"Indent Managment"** (PRC-001, 1 record late) and the item
  **GREASE WHITE**. Live FMS opens on PRC-001 first — archive it in FMS builder if you don't want it shown.
- Set real tax rates (Money → set-up) if you will show a bill's tax.
- Pitch deck and the integrations guide are artifacts (links in the chat).
