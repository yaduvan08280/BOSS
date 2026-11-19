#!/usr/bin/env node
// Grows ONE company of a TEST database to about two years of a busy company — roughly half a million rows in
// each busy table — by copying the rows it already has with new ids and older dates. Used to find slow
// queries and missing indexes before the real data gets there (docs/database.md).
//
//   DATABASE_URL=postgresql://…/mono_big node deploy/loadtest/grow.mjs "Demo Industries" [scale]
//
// `scale` multiplies every table's copies (1 = the sizes below; 0.1 for a quick try). It refuses a database
// whose name does not end in "_big" — never run it on real data: the copies are not real work.
import pg from 'pg';

const [, , companyName = 'Demo Industries', scaleArg = '1'] = process.argv;
const scale = Number(scaleArg) || 1;
const url = process.env.DATABASE_URL ?? '';
const dbName = decodeURIComponent(new URL(url).pathname.slice(1));
if (!dbName.endsWith('_big')) {
  console.error(`Refusing "${dbName}": the database's name must end in "_big" (a scratch copy).`);
  process.exit(2);
}

/**
 * What to copy. `k` copies of every row of the company; `ids` are the columns that point at rows copied with
 * the same `k` (they get the matching new id); `set` replaces a column (`g` is the copy's number, 1…k);
 * `hours` is how far apart in time two copies sit, so the copies spread over about two years.
 */
const PLAN = [
  { t: 'tasks', k: 7500, ids: ['id'], set: { number: 'src.number + g * 1000' } },
  { t: 'task_events', k: 7500, ids: ['id', 'task_id'] },
  { t: 'checklist_runs', k: 15000, ids: ['id'], hours: 1 },
  { t: 'checklist_run_items', k: 15000, ids: ['id', 'run_id'], hours: 1 },
  { t: 'notifications', k: 1200, ids: ['id'] },
  { t: 'outbox', k: 1200, ids: ['id'] },
  { t: 'domain_events', k: 55, ids: ['id'] },
  { t: 'audit_logs', k: 35, ids: ['id'] },
  { t: 'stock_moves', k: 90, ids: ['id'], set: { reverses_id: 'null' } },
  {
    t: 'pos_orders',
    k: 250,
    ids: ['id'],
    set: { number: 'src.number + g * 10000', client_id: 'null', business_day: DAY('business_day') },
  },
  {
    t: 'kots',
    k: 250,
    ids: ['id', 'order_id'],
    set: { number: 'src.number + g * 10000', business_day: DAY('business_day') },
  },
  { t: 'pos_order_items', k: 250, ids: ['id', 'order_id', 'kot_id'], set: { client_id: 'null' } },
  { t: 'bills', k: 250, ids: ['id', 'against_id'], set: { number: "src.number || '-' || g" } },
  {
    t: 'pos_checks',
    k: 250,
    ids: ['id', 'order_id', 'bill_id', 'credit_note_id'],
    set: { business_day: DAY('business_day') },
  },
  { t: 'bill_allocations', k: 250, ids: ['id', 'bill_id', 'payment_id'] },
  { t: 'vouchers', k: 250, ids: ['id', 'bill_id'] },
  {
    t: 'sales_orders',
    k: 500,
    ids: ['id'],
    set: { number: "src.number || '-' || g", record_id: 'null', call_id: 'null' },
  },
  { t: 'payments', k: 500, ids: ['id', 'order_id'] },
  { t: 'fms_records', k: 400, ids: ['id'], set: { number: 'src.number + g * 100000' } },
  { t: 'fms_record_steps', k: 400, ids: ['id', 'record_id'] },
  { t: 'fms_record_events', k: 400, ids: ['id', 'record_id'] },
  { t: 'records', k: 1000, ids: ['id'], set: { number: 'src.number + g * 1000' } },
  { t: 'report_values', k: 1000, ids: ['id', 'record_id'] },
  { t: 'record_events', k: 1000, ids: ['id', 'record_id'] },
  { t: 'punches', k: 48, ids: ['id'], hours: 15 * 24 },
  {
    t: 'attendance_days',
    k: 48,
    ids: ['id'],
    hours: 15 * 24,
    set: { date: "to_char(src.date::date - g * 15, 'YYYY-MM-DD')" },
  },
];
/** A day kept as text (YYYY-MM-DD), moved back with the copy. */
function DAY(col) {
  return `to_char(src.${col}::date - (g % 700), 'YYYY-MM-DD')`;
}
const NEW_ID = (col) =>
  `case when src.${col} is null then null else 'c' || substr(md5(src.${col} || ':' || g), 1, 23) end`;

const db = new pg.Client({ connectionString: url });
await db.connect();
const company = (await db.query('select id from companies where name = $1', [companyName])).rows[0];
if (!company) {
  console.error(`No company called "${companyName}" in ${dbName}.`);
  process.exit(2);
}
// Copies only: no row triggers a foreign-key check against a parent that is copied a moment later.
await db.query("set session_replication_role = 'replica'");
for (const p of PLAN) {
  const k = Math.max(1, Math.round(p.k * scale));
  const cols = (
    await db.query(
      `select column_name, data_type from information_schema.columns
       where table_schema = 'public' and table_name = $1 order by ordinal_position`,
      [p.t],
    )
  ).rows;
  const hours = p.hours ?? Math.max(1, Math.round((730 * 24) / k));
  // Days kept as text (YYYY-MM-DD) move back with the copy too — else two years of bills share one month.
  const sample = (await db.query(`select * from "${p.t}" where company_id = $1 limit 50`, [company.id])).rows;
  const isDay = (name) => {
    const values = sample.map((r) => r[name]).filter((v) => v !== null && v !== undefined);
    return values.length > 0 && values.every((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
  };
  const expr = (c) => {
    if (p.set?.[c.column_name]) return p.set[c.column_name];
    if (p.ids.includes(c.column_name)) return NEW_ID(c.column_name);
    if (c.data_type.startsWith('timestamp')) return `src.${c.column_name} - g * interval '${hours} hours'`;
    if (c.data_type === 'text' && isDay(c.column_name))
      return `to_char(src.${c.column_name}::date - ((g * ${hours}) / 24)::int, 'YYYY-MM-DD')`;
    return `src.${c.column_name}`;
  };
  const started = Date.now();
  const res = await db.query(
    `insert into "${p.t}" (${cols.map((c) => `"${c.column_name}"`).join(', ')})
     select ${cols.map(expr).join(', ')}
     from "${p.t}" src cross join generate_series(1, ${k}) g
     where src.company_id = $1
     on conflict do nothing`,
    [company.id],
  );
  console.log(`${p.t}: +${res.rowCount} rows (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}
await db.query("set session_replication_role = 'origin'");
await db.query('analyze');
await db.end();
