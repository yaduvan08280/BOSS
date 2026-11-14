-- Ask: a place's kind as people say it — a store named "… kitchen …" is the kitchen's stock, "… bar …" the bar's.
CREATE OR REPLACE VIEW ai_v_stock AS
SELECT b.company_id, i.code, i.name AS item, i.category, i.unit,
  COALESCE(l.name, CASE b.location_id WHEN '' THEN 'Main store' WHEN '~transit' THEN 'In transit' ELSE b.location_id END) AS location,
  CASE
    WHEN l.kind = 'KITCHEN' OR l.name ILIKE '%kitchen%' THEN 'KITCHEN'
    WHEN l.kind = 'BAR' OR l.name ILIKE '%bar%' THEN 'BAR'
    WHEN l.kind = 'COLD_ROOM' OR l.name ILIKE '%cold%' THEN 'COLD_ROOM'
    ELSE COALESCE(l.kind, 'STORE')
  END AS location_kind, br.name AS branch,
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
