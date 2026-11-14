-- Ask (CLAUDE.md §13) reads only these read-only views. Phase 6 gave it the work modules; these add the business:
-- stock by place, stock movements, what was sold (POS lines), bills, attendance days and table bookings.
-- Each carries company_id and branch_id (reach), a link, and person_id only where the row is someone's own.
-- Money is in rupees; quantities in the item's own unit; days as the start of that day in the company's clock.

CREATE OR REPLACE VIEW ai_v_stock AS
SELECT b.company_id, i.code, i.name AS item, i.category, i.unit,
  COALESCE(l.name, CASE b.location_id WHEN '' THEN 'Main store' WHEN '~transit' THEN 'In transit' ELSE b.location_id END) AS location,
  COALESCE(l.kind, 'STORE') AS location_kind, br.name AS branch,
  b.qty::float8 AS qty, ROUND(b.value / 100.0, 2)::float8 AS value,
  ROUND(i.rate / 100.0, 2)::float8 AS rate, i.min_qty::float8 AS min_qty, i.max_qty::float8 AS max_qty,
  i.band, i.vendor, '/ims/stock?item=' || i.id AS link, l.branch_id
FROM (
  SELECT company_id, item_id, location_id, SUM(qty) AS qty, SUM(value) AS value
  FROM stock_balances GROUP BY company_id, item_id, location_id
) b
JOIN items i ON i.id = b.item_id
LEFT JOIN locations l ON l.id = b.location_id
LEFT JOIN branches br ON br.id = l.branch_id
WHERE i.deleted_at IS NULL AND b.qty <> 0;

CREATE OR REPLACE VIEW ai_v_stock_moves AS
SELECT m.company_id, m.at, i.code, i.name AS item, i.category, i.unit, m.type,
  COALESCE(m.reason, '') AS reason, COALESCE(m.ref_type, '') AS source, m.qty::float8 AS qty,
  ROUND(COALESCE(m.value, 0) / 100.0, 2)::float8 AS value,
  COALESCE(fl.name, CASE m.location_id WHEN '' THEN 'Main store' WHEN '~transit' THEN 'In transit' ELSE m.location_id END) AS location,
  tl.name AS to_location, u.name AS by_person, m.status,
  '/ims/stock?item=' || i.id AS link, fl.branch_id
FROM stock_moves m
JOIN items i ON i.id = m.item_id
LEFT JOIN locations fl ON fl.id = m.location_id
LEFT JOIN locations tl ON tl.id = m.to_location_id
LEFT JOIN users u ON u.id = m.created_by_id;

CREATE OR REPLACE VIEW ai_v_sales_items AS
SELECT o.company_id, (o.business_day::date)::timestamp AT TIME ZONE co.timezone AS business_day,
  ot.name AS outlet, o.number AS order_number, o.type AS order_type, it.name AS item,
  it.variant_name AS variant, it.category, it.qty::float8 AS qty,
  ROUND(it.price * it.qty / 100.0, 2)::float8 AS amount, it.status, (it.status = 'VOID') AS is_void,
  it.void_reason, it.nc AS no_charge, st.name AS steward, it.created_at AS ordered_at,
  '/hosp/pos' AS link, o.branch_id
FROM pos_order_items it
JOIN pos_orders o ON o.id = it.order_id
JOIN outlets ot ON ot.id = o.outlet_id
JOIN companies co ON co.id = o.company_id
LEFT JOIN users st ON st.id = o.steward_id
WHERE o.status <> 'CANCELLED';

CREATE OR REPLACE VIEW ai_v_bills AS
SELECT k.company_id, (k.business_day::date)::timestamp AT TIME ZONE co.timezone AS business_day,
  ot.name AS outlet, k.number AS bill_number, ROUND(k.total / 100.0, 2)::float8 AS total,
  ROUND(k.service_charge / 100.0, 2)::float8 AS service_charge, k.status, o.covers AS guests,
  o.type AS order_type, (k.discount IS NOT NULL) AS has_discount, k.discount ->> 'reason' AS discount_reason,
  k.nc_reason AS no_charge_reason,
  (SELECT string_agg(DISTINCT p ->> 'mode', ', ') FROM jsonb_array_elements(COALESCE(k.payments, '[]'::jsonb)) p) AS paid_by,
  st.name AS steward, k.paid_at, '/hosp/day' AS link, o.branch_id
FROM pos_checks k
JOIN pos_orders o ON o.id = k.order_id
JOIN outlets ot ON ot.id = k.outlet_id
JOIN companies co ON co.id = k.company_id
LEFT JOIN users st ON st.id = o.steward_id;

CREATE OR REPLACE VIEW ai_v_attendance AS
SELECT a.company_id, a.user_id AS person_id, (a.date::date)::timestamp AT TIME ZONE co.timezone AS date,
  u.name AS person, dep.name AS department, a.status, a.in_at, a.out_at,
  ROUND(a.worked_min / 60.0, 2)::float8 AS worked_hours, a.late_min AS late_minutes,
  ROUND(a.overtime_min / 60.0, 2)::float8 AS overtime_hours, a.missed_out,
  '/hr/attendance?tab=month' AS link, COALESCE(a.branch_id, u.branch_id) AS branch_id
FROM attendance_days a
JOIN users u ON u.id = a.user_id
JOIN companies co ON co.id = a.company_id
LEFT JOIN departments dep ON dep.id = u.main_department_id
WHERE u.deleted_at IS NULL;

CREATE OR REPLACE VIEW ai_v_reservations AS
SELECT r.company_id, r.start_at, ot.name AS outlet, g.name AS guest, r.party_size, r.status, r.source,
  r.occasion, COALESCE(r.deposit_state, '') AS deposit, r.created_at,
  '/hosp/reservations' AS link, r.branch_id
FROM reservations r
JOIN outlets ot ON ot.id = r.outlet_id
JOIN guests g ON g.id = r.guest_id;
