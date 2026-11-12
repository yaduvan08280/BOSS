/**
 * Events about data (not people) that outgoing webhooks can subscribe to, besides every notification event.
 * `module` is the event's own prefix, so the picker's "whole module" choice (`master.*`) matches its events.
 * Money in payloads is paise as a string; dates are YYYY-MM-DD.
 */
export const DATA_EVENTS = [
  { event: 'crm.customer_added', module: 'crm' },
  { event: 'crm.customer_changed', module: 'crm' },
  { event: 'crm.order_taken', module: 'crm' },
  { event: 'crm.order_cancelled', module: 'crm' },
  { event: 'crm.payment_received', module: 'crm' },
  { event: 'ims.stock_moved', module: 'ims' },
  { event: 'master.row_added', module: 'master' },
  { event: 'master.row_changed', module: 'master' },
  { event: 'master.row_deleted', module: 'master' },
  { event: 'master.rows_imported', module: 'master' },
  { event: 'list.value_added', module: 'list' },
  { event: 'list.value_renamed', module: 'list' },
  { event: 'list.value_hidden', module: 'list' },
  { event: 'list.value_shown', module: 'list' },
  { event: 'list.values_merged', module: 'list' },
  { event: 'record.changed', module: 'record' },
  { event: 'record.deleted', module: 'record' },
  { event: 'record.imported', module: 'record' },
] as const;

/** A webhook's event list: exact names, a module's events (`crm.*`) or everything (`*`). */
export const WEBHOOK_EVENT_PATTERN = /^(\*|[a-z_]+\.\*|[a-z_]+\.[a-z_.]+)$/;
