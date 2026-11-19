import type { Db } from '@mono/db';
import { matchesEvent } from './webhooks';

type Heard = { id: string; companyId: string; name: string };

/**
 * Which of these events nobody is waiting for: no active notification rule for the event in its company and
 * no active webhook that asks for it. The worker reads this once for a whole batch (two queries) instead of
 * asking the same two questions for every event — at a POS's pace that is twenty events a second, nearly all
 * of them with nobody listening. A rule or webhook switched on a moment later is treated like one made after
 * the event: it hears the next one.
 */
export async function unheardEvents(db: Db, events: Heard[]): Promise<Set<string>> {
  if (!events.length) return new Set();
  const companyIds = [...new Set(events.map((e) => e.companyId))];
  const names = [...new Set(events.map((e) => e.name))];
  const [rules, hooks] = await Promise.all([
    db.notificationRule.findMany({
      where: { companyId: { in: companyIds }, event: { in: names }, active: true, deletedAt: null },
      select: { companyId: true, event: true },
    }),
    db.webhook.findMany({
      where: { companyId: { in: companyIds }, active: true, deletedAt: null },
      select: { companyId: true, events: true },
    }),
  ]);
  const ruled = new Set(rules.map((r) => `${r.companyId} ${r.event}`));
  const unheard = new Set<string>();
  for (const e of events) {
    if (ruled.has(`${e.companyId} ${e.name}`)) continue;
    if (hooks.some((h) => h.companyId === e.companyId && matchesEvent(h.events, e.name))) continue;
    unheard.add(e.id);
  }
  return unheard;
}
