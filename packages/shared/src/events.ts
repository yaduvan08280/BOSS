/**
 * Domain events. Every mutation emits one; notifications are driven only by these + notification rules.
 * Add new names here as modules land (see CLAUDE.md §7.3 for the full list).
 */
export const DOMAIN_EVENTS = [
  'auth.logged_in',
  'auth.logged_out',
  'auth.password_changed',
  'company.created',
  'company.updated',
  'contact.created',
  'contact.updated',
  'contact.deleted',
  'shift.created',
  'shift.updated',
  'shift.deleted',
  'branch.created',
  'branch.updated',
  'branch.deleted',
  'designation.created',
  'designation.deleted',
  'department.created',
  'department.updated',
  'department.deleted',
  'user.created',
  'user.updated',
  'user.deleted',
  'user.password_reset',
  'role.created',
  'role.updated',
  'role.deleted',
  'channel.updated',
  'template.changed',
  'rule.changed',
  'reminder.changed',
  'telegram.linked',
  'telegram.codes_sent',
  'notification.read',
  'proof.attached',
] as const;
/** Module events (delegation.assigned, …) are listed in notify/catalog.ts and grow with each phase. */
export type DomainEventName = (typeof DOMAIN_EVENTS)[number] | (string & {});

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
