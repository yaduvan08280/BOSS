/**
 * Domain events. Every mutation emits one; notifications are driven only by these + notification rules.
 * Add new names here as modules land (see CLAUDE.md §7.3 for the full list).
 */
export const DOMAIN_EVENTS = [
  'auth.logged_in',
  'auth.logged_out',
  'auth.password_changed',
  'company.created',
  'user.created',
] as const;
export type DomainEventName = (typeof DOMAIN_EVENTS)[number];

export type DomainEventEnvelope<P = Record<string, unknown>> = {
  id: string;
  companyId: string;
  name: DomainEventName;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  payload: P;
  occurredAt: string;
};
