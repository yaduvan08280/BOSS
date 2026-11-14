-- Ask / the owner's chat (14/11/2026): read-only views for the rest of MONO — customers, leads, money (bills,
-- receipts, purchase bills and what is owed), purchase orders, hotel stays, banquets, leave, the menu with its
-- recipe cost, and licences. Same shape as the others: company_id, branch_id, person_id where a row is someone's,
-- money in rupees, days as the start of that day in the company's clock, and a link.

CREATE OR REPLACE VIEW ai_v_customers AS
SELECT c.company_id, c.code, c.name AS customer, c.city, c.segment, h.name AS handled_by, c.credit_days,
  c.owner_customer, (c.lost_at IS NOT NULL) AS is_lost,
  COALESCE(s.sales_12m, 0)::float8 AS sales_12m, COALESCE(s.orders_12m, 0)::int AS orders_12m,
  s.last_order_on, COALESCE(s.owed, 0)::float8 AS owed, c.created_at,
  '/crm/customers?customer=' || c.id AS link, NULL::text AS branch_id
FROM customers c
LEFT JOIN users h ON h.id = c.handled_by_id
LEFT JOIN LATERAL (
  SELECT ROUND(SUM(b.total) FILTER (WHERE b.date >= to_char(now() - interval '365 days', 'YYYY-MM-DD')) / 100.0, 2) AS sales_12m,
    COUNT(*) FILTER (WHERE b.date >= to_char(now() - interval '365 days', 'YYYY-MM-DD')) AS orders_12m,
    (MAX(b.date)::date)::timestamp AT TIME ZONE MAX(co.timezone) AS last_order_on,
    ROUND(SUM(b.total - b.settled - b.credited) / 100.0, 2) AS owed
  FROM bills b JOIN companies co ON co.id = b.company_id
  WHERE b.party_id = c.id AND b.type = 'INVOICE' AND b.status NOT IN ('DRAFT', 'CANCELLED')
) s ON TRUE
WHERE c.deleted_at IS NULL;

CREATE OR REPLACE VIEW ai_v_leads AS
SELECT l.company_id, l.owner_id AS person_id, l.number, l.name, l.company AS lead_company, l.city, l.source,
  l.requirement, l.stage, l.status, ROUND(COALESCE(l.value, 0) / 100.0, 2)::float8 AS value, o.name AS owner,
  l.next_action, (l.next_action_on::date)::timestamp AT TIME ZONE co.timezone AS next_action_on,
  l.created_at, l.closed_at, '/crm/nbd' AS link, NULL::text AS branch_id
FROM leads l
JOIN companies co ON co.id = l.company_id
LEFT JOIN users o ON o.id = l.owner_id;

CREATE OR REPLACE VIEW ai_v_money AS
SELECT b.company_id, b.type, b.number, (b.date::date)::timestamp AT TIME ZONE co.timezone AS date,
  p.name AS party, br.name AS branch, b.status,
  ROUND(b.total / 100.0, 2)::float8 AS total, ROUND(b.tax / 100.0, 2)::float8 AS tax,
  ROUND(b.settled / 100.0, 2)::float8 AS settled,
  ROUND((b.total - b.settled - b.credited) / 100.0, 2)::float8 AS balance,
  (b.due_on::date)::timestamp AT TIME ZONE co.timezone AS due_on,
  CASE WHEN b.due_on IS NOT NULL AND b.status IN ('ISSUED', 'PART_PAID') AND b.due_on < to_char(now(), 'YYYY-MM-DD')
    THEN (CURRENT_DATE - b.due_on::date) ELSE 0 END AS days_overdue,
  COALESCE(b.source_type, '') AS source, '/money/bills?bill=' || b.id AS link, b.branch_id
FROM bills b
JOIN companies co ON co.id = b.company_id
LEFT JOIN parties p ON p.id = b.party_id
LEFT JOIN branches br ON br.id = b.branch_id
WHERE b.status <> 'DRAFT';

CREATE OR REPLACE VIEW ai_v_purchase_orders AS
SELECT po.company_id, po.number, po.vendor, po.status,
  (po.expected_on::date)::timestamp AT TIME ZONE co.timezone AS expected_on,
  ROUND(COALESCE((SELECT SUM(pl.qty * pl.rate) FROM po_lines pl WHERE pl.po_id = po.id), 0) / 100.0, 2)::float8 AS value,
  (SELECT COUNT(*) FROM po_lines pl WHERE pl.po_id = po.id)::int AS lines, u.name AS raised_by, po.created_at,
  '/ims/purchase' AS link, po.branch_id
FROM purchase_orders po
JOIN companies co ON co.id = po.company_id
LEFT JOIN users u ON u.id = po.created_by_id;

CREATE OR REPLACE VIEW ai_v_hotel_stays AS
SELECT s.company_id, s.number, g.name AS guest, rt.name AS room_type, br.name AS property,
  (s.arrive::date)::timestamp AT TIME ZONE co.timezone AS arrive,
  (s.depart::date)::timestamp AT TIME ZONE co.timezone AS depart,
  (s.depart::date - s.arrive::date) AS nights, s.status, s.source, COALESCE(s.channel, '') AS channel,
  s.kind, s.adults, s.children, s.checked_in_at, s.checked_out_at, s.created_at,
  '/hotel/desk' AS link, s.branch_id
FROM stays s
JOIN companies co ON co.id = s.company_id
JOIN guests g ON g.id = s.guest_id
LEFT JOIN room_types rt ON rt.id = s.room_type_id
LEFT JOIN branches br ON br.id = s.branch_id;

CREATE OR REPLACE VIEW ai_v_banquets AS
SELECT e.company_id, e.number, g.name AS guest, e.occasion, br.name AS branch, e.start_at,
  e.expected_covers, e.guaranteed_covers, e.actual_covers, e.status,
  ROUND(COALESCE((e.quote ->> 'total')::numeric, 0) / 100.0, 2)::float8 AS quote_total, e.created_at,
  '/hosp/banquets' AS link, e.branch_id
FROM banquet_events e
JOIN guests g ON g.id = e.guest_id
LEFT JOIN branches br ON br.id = e.branch_id;

CREATE OR REPLACE VIEW ai_v_leave AS
SELECT r.company_id, r.user_id AS person_id, u.name AS person, dep.name AS department, t.code AS leave_type,
  (r."from"::date)::timestamp AT TIME ZONE co.timezone AS from_day,
  (r."to"::date)::timestamp AT TIME ZONE co.timezone AS to_day,
  r.days::float8 AS days, r.status, r.reason, r.created_at, '/hr/leave' AS link, u.branch_id
FROM leave_requests r
JOIN users u ON u.id = r.user_id
JOIN companies co ON co.id = r.company_id
JOIN leave_types t ON t.id = r.leave_type_id
LEFT JOIN departments dep ON dep.id = u.main_department_id;

-- Recipe cost: each ingredient's quantity × its rate (base units; yield and wastage left out — an estimate).
CREATE OR REPLACE VIEW ai_v_menu AS
SELECT m.company_id, m.name AS dish, c.name AS category, ROUND(m.price / 100.0, 2)::float8 AS price, m.diet,
  m.active, m.off AS sold_out, rc.cost::float8 AS recipe_cost,
  CASE WHEN m.price > 0 AND rc.cost IS NOT NULL THEN ROUND(rc.cost * 10000.0 / m.price, 1)::float8 END AS food_cost_pct,
  '/hosp/menu' AS link, NULL::text AS branch_id
FROM menu_items m
LEFT JOIN menu_categories c ON c.id = m.category_id
LEFT JOIN LATERAL (
  SELECT ROUND(SUM((l ->> 'qty')::numeric * i.rate) / 100.0, 2) AS cost
  FROM recipes r CROSS JOIN jsonb_array_elements(r.lines) l
  JOIN items i ON i.id = l ->> 'itemId'
  WHERE r.item_id = m.item_id AND r.active
) rc ON TRUE
WHERE m.deleted_at IS NULL;

CREATE OR REPLACE VIEW ai_v_licences AS
SELECT ci.company_id, ci.name, ci.kind, br.name AS branch, ci.number, ci.authority,
  (ci.expires_on::date)::timestamp AT TIME ZONE co.timezone AS expires_on,
  (ci.expires_on::date - CURRENT_DATE) AS days_left, '/hosp/compliance' AS link, ci.branch_id
FROM compliance_items ci
JOIN companies co ON co.id = ci.company_id
LEFT JOIN branches br ON br.id = ci.branch_id
WHERE ci.deleted_at IS NULL;
