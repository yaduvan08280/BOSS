# 12. Integrations, public API and webhooks

## Google Drive (owner only)
System Master → Integration → **Google Drive** shows "Where your files go". To send new uploads to your own Drive:
1. Make a Google Cloud project and turn on the **Google Drive API**.
2. **OAuth consent screen:** External, add the scope `https://www.googleapis.com/auth/drive.file`, then
   **Publish app** (apps left in Testing are disconnected by Google after 7 days).
3. **Create OAuth client → Web application**, redirect URI exactly as shown on the page
   (`https://<your address>/api/integrations/google-drive/callback`).
4. Paste the **Client ID** and **Client secret** → **Connect Drive** → choose your Google account → Allow.
New files then move to the "MONO Files" folder about a minute after upload; older files stay on the server.
MONO can see only the files it puts there. **Stop sending files** keeps new uploads on the server again.

## API keys
System Master → **API Keys** → **Generate API key** → give it a name (e.g. "Tally connector") → copy the key now (it
is shown once). The key acts as you, with your permissions; **Revoke** stops it at once. Make one key per tool.

## The public API
- Address: `https://<your address>/api/v1` — documentation at `/api/docs`, machine-readable at
  `/api/v1/openapi.json`.
- Send the key as `Authorization: Bearer mono_…` (or `X-Api-Key: mono_…`). 120 calls a minute per key.
- Money is in **paise as strings**; dates are `YYYY-MM-DD`.
- Endpoints: `me`, customers (list, add, change), items, stock-moves, orders (list, take), flows, records (start,
  read), steps (mark done), masters and their rows.
```bash
curl -H "Authorization: Bearer mono_…" https://mono.ggminerals.com/api/v1/customers
```

## Webhooks
API Keys → **Add a webhook**: an `https://` address and the events to send (one by one, a module like `crm.*`, or
**Everything**). Copy the **signing secret** (shown once). Each delivery is a JSON POST:
```json
{ "id": "…", "event": "crm.order_taken", "occurredAt": "2026-11-05T06:30:00.000Z",
  "entity": { "type": "sales_order", "id": "…" }, "data": { "number": "SO/26-27/0042", "amountPaise": "1250000" } }
```
Headers: `X-Mono-Event`, `X-Mono-Delivery`, `X-Mono-Timestamp`, `X-Mono-Signature: sha256=<hex>` where the hex is
HMAC-SHA256 of `<timestamp>.<body>` with your secret. Answer with any 2xx within 10 seconds. Failed deliveries are
tried again after 30 s, 2 min, 8 min, 32 min and about 2 h, then marked failed (see **Deliveries**). **Send a test**
checks the address; **New secret** replaces the secret at once. Addresses inside your own network are refused.
Useful data events: `crm.customer_added`, `crm.customer_changed`, `crm.order_taken`, `crm.order_cancelled`,
`crm.payment_received`, `ims.stock_moved`, `master.row_added`, `master.row_changed`, `master.row_deleted`.
