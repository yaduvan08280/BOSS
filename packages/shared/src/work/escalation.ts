import type { TicketSettings } from '../defaults';

const HOUR = 3600_000;

export type EscalationInput = {
  status: string;
  createdAt: Date;
  firstReplyAt: Date | null;
  plannedFixAt: Date;
};

/**
 * Which escalation level a ticket should be at now (CLAUDE.md §5.4).
 * Level 1 (coordinator) when the first reply or the planned fix time is missed; level 2 (HOD/owner)
 * when it is still missed one more SLA later (2× the reply time, or the planned fix + the fix time).
 */
export function ticketEscalation(
  t: EscalationInput,
  s: Pick<TicketSettings, 'escalationLevels' | 'firstReplyHours' | 'fixHours'>,
  now: Date,
): { level: 0 | 1 | 2; reason: 'noReply' | 'late' | null } {
  if (!s.escalationLevels || (t.status !== 'OPEN' && t.status !== 'IN_PROGRESS')) {
    return { level: 0, reason: null };
  }
  const at = now.getTime();
  const checks: { reason: 'noReply' | 'late'; l1: number; l2: number }[] = [
    { reason: 'late', l1: t.plannedFixAt.getTime(), l2: t.plannedFixAt.getTime() + s.fixHours * HOUR },
  ];
  if (!t.firstReplyAt) {
    const due = t.createdAt.getTime() + s.firstReplyHours * HOUR;
    checks.push({ reason: 'noReply', l1: due, l2: due + s.firstReplyHours * HOUR });
  }
  let best: { level: 0 | 1 | 2; reason: 'noReply' | 'late' | null } = { level: 0, reason: null };
  for (const c of checks) {
    const level = at >= c.l2 && s.escalationLevels >= 2 ? 2 : at >= c.l1 ? 1 : 0;
    if (level > best.level) best = { level, reason: c.reason };
  }
  return best;
}
