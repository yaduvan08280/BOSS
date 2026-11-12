/**
 * Events about data (not people) that outgoing webhooks can subscribe to, besides every notification event.
 * Money in payloads is paise as a string; dates are YYYY-MM-DD.
 */
export const DATA_EVENTS = [
  { event: 'crm.customer_added', module: 'crm' },
  { event: 'crm.customer_changed', module: 'crm' },
  { event: 'crm.order_taken', module: 'crm' },
  { event: 'crm.order_cancelled', module: 'crm' },
  { event: 'crm.payment_received', module: 'crm' },
  { event: 'ims.stock_moved', module: 'ims' },
  { event: 'master.row_added', module: 'masters' },
  { event: 'master.row_changed', module: 'masters' },
  { event: 'master.row_deleted', module: 'masters' },
  { event: 'master.rows_imported', module: 'masters' },
  { event: 'record.created', module: 'records' },
  { event: 'record.changed', module: 'records' },
  { event: 'record.status_changed', module: 'records' },
  { event: 'record.note', module: 'records' },
  { event: 'record.deleted', module: 'records' },
  { event: 'record.imported', module: 'records' },
] as const;

/** A webhook's event list: exact names, a module's events (`crm.*`) or everything (`*`). */
export const WEBHOOK_EVENT_PATTERN = /^(\*|[a-z_]+\.\*|[a-z_]+\.[a-z_.]+)$/;
