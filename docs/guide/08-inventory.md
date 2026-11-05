# 8. Inventory (IMS)

## Every day (store keeper)
- **Stock moves:** Receive (IN), Issue (OUT), Transfer (to another location) — they apply at once.
- **Adjust** (damaged, expired, lost, found) waits for an approver; nobody approves their own.
- Stock can never go below zero: issuing more than is there is refused.

## Colours
Red = below ⅓ of MAX (or under the minimum) · Yellow = below ⅔ · Green = up to MAX · Purple = above MAX.
`MAX = average daily use × lead time (days) × safety factor`.

## Ordering (OWS — order when short)
The **OWS list** opens N days before the order day: items whose stock + on order is below ⅔ of MAX, with the
quantity to order (MAX − stock − on order). **Make purchase orders** creates one draft per vendor (`PO/26-27/0001`).
Red items can be ordered any day.

## MAX review (every 15 days)
MONO proposes a new MAX from real use. The reviewer **applies**, sets their own safety factor, or **skips**.
Nothing changes by itself.

## Audit and dead stock
Each cycle the top items by value get a count. A difference becomes an adjustment that waits for approval. Items
without movement for 365 days are dead stock; the owner hears about them once a month.

## Reports
Stock value, movement, turns (and NOS — slow movers), purchase. Opening stock imports from Excel.
