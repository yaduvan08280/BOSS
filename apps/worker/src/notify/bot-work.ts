import type { Db } from '@mono/db';
import { actOnTask, actorFor, taskByNumber } from '@mono/api/services';
import { formatShortDateTime, parseLocalDateTime, zonedToUtc } from '@mono/shared';

/** Work from Telegram: buttons on task messages and the /done, /move commands. Same rules as the web. */
type Who = { id: string; companyId: string };

function friendly(err: unknown): string {
  const e = err as { code?: string; message?: string };
  if (e.code === 'FORBIDDEN_TRANSITION') return "That isn't yours to do on this task.";
  if (e.code === 'INVALID_TRANSITION')
    return 'That was already done (or the task has moved on). Check the app.';
  if (e.code === 'GUARD_FAILED') return 'That step is switched off for your company.';
  return e.message ?? 'Something went wrong. Try in the app.';
}

async function tz(db: Db, companyId: string) {
  return (await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } }))
    .timezone;
}

export async function taskButton(db: Db, me: Who, action: string, taskId: string): Promise<string> {
  const actor = await actorFor(db, me.companyId, me.id);
  if (!actor) return 'Your account is not active.';
  try {
    if (action === 'accept') {
      const t = await actOnTask(db, actor, taskId, { action: 'accept' });
      return `✅ Accepted #${t.number}.`;
    }
    if (action === 'done') {
      const t = await actOnTask(db, actor, taskId, {
        action: 'markDone',
        note: 'Done (from Telegram)',
        attachmentIds: [],
      });
      return t.status === 'PENDING_VERIFY'
        ? `✅ #${t.number} sent for verification.`
        : `✅ #${t.number} done.`;
    }
    if (action === 'verify') {
      const t = await actOnTask(db, actor, taskId, { action: 'verify' });
      return `✅ #${t.number} verified.`;
    }
    if (action === 'move') {
      const t = await db.task.findFirst({
        where: { id: taskId, companyId: me.companyId },
        select: { number: true },
      });
      return `Send: /move ${t?.number ?? '<number>'} DD/MM HH:mm reason`;
    }
    return 'Please do this in the app.';
  } catch (err) {
    const msg = friendly(err);
    return msg.includes('proof')
      ? `${msg} Reply to the task message with a photo, then press Done again.`
      : msg;
  }
}

/** /done 70 [what was done] */
export async function doneCommand(db: Db, me: Who, args: string): Promise<string> {
  const m = /^#?(\d+)\s*(.*)$/s.exec(args.trim());
  if (!m) return 'Write the task number: /done 70 what you did';
  const t = await taskByNumber(db, me.companyId, Number(m[1]));
  if (!t) return `There is no task #${m[1]}.`;
  const actor = await actorFor(db, me.companyId, me.id);
  if (!actor) return 'Your account is not active.';
  try {
    const done = await actOnTask(db, actor, t.id, {
      action: 'markDone',
      note: m[2]?.trim() || 'Done (from Telegram)',
      attachmentIds: [],
    });
    return done.status === 'PENDING_VERIFY'
      ? `✅ #${done.number} sent for verification.`
      : `✅ #${done.number} done.`;
  } catch (err) {
    return friendly(err);
  }
}

/** /move 70 05/11 18:00 waiting for the spare part */
export async function moveCommand(db: Db, me: Who, args: string): Promise<string> {
  const m = /^#?(\d+)\s+(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)(?:\s+(\d{1,2}:\d{2}))?\s+(.{3,})$/s.exec(
    args.trim(),
  );
  if (!m) return 'Write: /move 70 05/11 18:00 why it is changing';
  const zone = await tz(db, me.companyId);
  const year = new Date().getFullYear();
  const date = m[2]!.split(/[/.-]/).length === 2 ? `${m[2]}/${year}` : m[2]!;
  const parsed = parseLocalDateTime(m[3] ? `${date} ${m[3]}` : date);
  if (!parsed) return `"${m[2]}" is not a date. Use DD/MM.`;
  const t = await taskByNumber(db, me.companyId, Number(m[1]));
  if (!t) return `There is no task #${m[1]}.`;
  const actor = await actorFor(db, me.companyId, me.id);
  if (!actor) return 'Your account is not active.';
  try {
    const at = zonedToUtc(parsed.date, parsed.minutes, zone);
    const moved = await actOnTask(db, actor, t.id, {
      action: 'moveDate',
      plannedAt: at.toISOString(),
      reason: m[4]!.trim(),
    });
    return `📅 #${moved.number} moved to ${formatShortDateTime(moved.plannedAt, zone)}.`;
  } catch (err) {
    return friendly(err);
  }
}

/** /my and /today: tasks to do or verify, checklists due, then unread messages. */
export async function workSummary(db: Db, me: Who, today: boolean): Promise<string[]> {
  const zone = await tz(db, me.companyId);
  const endOfDay = new Date(Date.now() + 24 * 3600_000);
  const [tasks, verify, runs] = await Promise.all([
    db.task.findMany({
      where: {
        companyId: me.companyId,
        deletedAt: null,
        doerId: me.id,
        status: { in: ['AWAITING_ACCEPTANCE', 'OPEN'] },
        ...(today ? { plannedAt: { lt: endOfDay } } : {}),
      },
      orderBy: { plannedAt: 'asc' },
      take: 10,
    }),
    db.task.count({
      where: { companyId: me.companyId, deletedAt: null, verifierId: me.id, status: 'PENDING_VERIFY' },
    }),
    db.checklistRun.findMany({
      where: { companyId: me.companyId, doerId: me.id, status: 'OPEN', plannedAt: { lt: endOfDay } },
      include: { master: { select: { name: true } } },
      orderBy: { plannedAt: 'asc' },
      take: 10,
    }),
  ]);
  const now = new Date();
  const lines: string[] = [];
  for (const t of tasks) {
    const late = t.plannedAt < now ? ' ⚠️ late' : '';
    const wait = t.status === 'AWAITING_ACCEPTANCE' ? ' (to accept)' : '';
    lines.push(
      `#${t.number} ${t.description.slice(0, 60)} · ${formatShortDateTime(t.plannedAt, zone)}${late}${wait}`,
    );
  }
  for (const r of runs)
    lines.push(
      `☑️ ${r.master.name} · ${r.itemsDone}/${r.itemsTotal} · ${formatShortDateTime(r.plannedAt, zone)}`,
    );
  if (verify) lines.push(`🔍 ${verify} task(s) waiting for you to verify`);
  const [tickets, slips] = await Promise.all([
    db.ticket.findMany({
      where: {
        companyId: me.companyId,
        deletedAt: null,
        solverId: me.id,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
      },
      orderBy: { plannedFixAt: 'asc' },
      take: 5,
    }),
    db.slip.count({
      where: {
        companyId: me.companyId,
        deletedAt: null,
        OR: [
          { status: 'SUBMITTED', receiverId: me.id },
          { status: 'WITH_APPROVER', approverId: me.id },
          { status: 'RETURNED', raiserId: me.id },
        ],
      },
    }),
  ]);
  for (const t of tickets)
    lines.push(
      `🎫 T#${t.number} ${t.title.slice(0, 50)} · fix by ${formatShortDateTime(t.plannedFixAt, zone)}${t.plannedFixAt < now ? ' ⚠️ late' : ''}`,
    );
  if (slips) lines.push(`📝 ${slips} help slip(s) waiting on you`);
  return lines;
}
