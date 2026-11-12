import { assertPublicUrl } from '../platform/safe-url';
import type { Db, Prisma } from '@mono/db';
import { emitEvent } from '../../lib/events';
import { parseDefinition, fmsLink } from './engine';
import { finishAutoStep } from './records';

const HOUR = 3_600_000;
const ago = (ms: number) =>
  ms >= 48 * HOUR
    ? `${Math.round(ms / (24 * HOUR))} days`
    : ms >= HOUR
      ? `${Math.round(ms / HOUR)} h`
      : `${Math.max(1, Math.round(ms / 60_000))} min`;

/**
 * Every 5 minutes (CLAUDE.md §6.3): a reminder an hour before a step is due; once late, the doer and the
 * coordinator hear (once); at twice the planned time the problem solver is called in (once).
 */
export async function watchFmsSteps(db: Db, now = new Date()) {
  let sent = 0;
  // Every open step is looked at, a page at a time: a fixed "first 1,000" would leave a busy company's later
  // steps without their reminders for good.
  for (let after: string | undefined; ;) {
    const page = await db.fmsRecordStep.findMany({
      where: {
        status: 'OPEN',
        type: { not: 'AUTO' },
        record: { status: 'RUNNING', deletedAt: null },
        plannedAt: { lt: new Date(now.getTime() + HOUR) },
        ...(after ? { id: { gt: after } } : {}),
      },
      include: { record: { include: { flow: true } } },
      orderBy: { id: 'asc' },
      take: 500,
    });
    if (!page.length) break;
    after = page.at(-1)!.id;
    sent += await watchPage(db, page, now);
    if (page.length < 500) break;
  }
  return sent;
}

type OpenStep = Prisma.FmsRecordStepGetPayload<{ include: { record: { include: { flow: true } } } }>;

async function watchPage(db: Db, open: OpenStep[], now: Date) {
  let sent = 0;
  for (const s of open) {
    const f = s.record.flow;
    const base = {
      flow: f.name,
      run: f.runName,
      record: `${s.record.title} (#${s.record.number})`,
      step: s.stepName,
      doerId: s.doerId,
      coordinatorId: f.coordinatorId,
      solverId: f.solverId,
      due: s.plannedAt.toISOString(),
      link: fmsLink(s.record),
    };
    const send = async (
      name: string,
      mark: 'dueSoonNotifiedAt' | 'lateNotifiedAt' | 'solverNotifiedAt',
      extra: object = {},
    ) => {
      await db.$transaction(async (tx) => {
        const res = await tx.fmsRecordStep.updateMany({
          where: { id: s.id, [mark]: null, status: 'OPEN' },
          data: { [mark]: now },
        });
        if (!res.count) return;
        sent++;
        await emitEvent(
          tx,
          { companyId: s.companyId, actorId: null },
          { name, entityType: 'fms_step', entityId: s.id, payload: { ...base, ...extra } },
        );
        if (name !== 'fms.step_due_soon')
          await tx.fmsRecordEvent.create({
            data: {
              companyId: s.companyId,
              recordId: s.recordId,
              type: 'late',
              stepKey: s.stepKey,
              note: name === 'fms.step_stuck' ? 'Problem solver called in' : 'Late',
            },
          });
      });
    };
    const late = now.getTime() - s.plannedAt.getTime();
    const planned = Math.max(s.plannedAt.getTime() - s.startedAt.getTime(), 15 * 60_000);
    if (late < 0) {
      if (!s.dueSoonNotifiedAt && !s.lateNotifiedAt) await send('fms.step_due_soon', 'dueSoonNotifiedAt');
      continue;
    }
    if (!s.lateNotifiedAt) await send('fms.step_late', 'lateNotifiedAt', { late: ago(late) });
    if (!s.solverNotifiedAt && f.solverId && late >= planned)
      await send('fms.step_stuck', 'solverNotifiedAt', { late: ago(late) });
  }
  return sent;
}

/** AUTO webhook steps: POST the record to the URL; on success (or after 5 failed tries) the record moves on. */
export async function runFmsWebhooks(
  db: Db,
  f: typeof fetch = fetch,
  net?: { production: boolean; allowPrivate?: boolean },
) {
  const steps = await db.fmsRecordStep.findMany({
    where: { status: 'OPEN', type: 'AUTO', record: { status: 'RUNNING', deletedAt: null } },
    include: { record: { include: { version: true, flow: { select: { name: true } } } } },
    take: 50,
  });
  let done = 0;
  for (const s of steps) {
    const step = parseDefinition(s.record.version.definition).steps.find((x) => x.key === s.stepKey);
    const url = step?.auto?.action === 'webhook' ? step.auto.url : undefined;
    if (!url) {
      await finishAutoStep(db, s.id, 'No webhook URL');
      continue;
    }
    const tries = await db.fmsRecordEvent.count({
      where: { recordId: s.recordId, stepKey: s.stepKey, type: 'webhook_failed' },
    });
    try {
      // Never into the server's own network (SSRF); never follow a redirect there either.
      if (net) await assertPublicUrl(url, net);
      const res = await f(url, {
        redirect: 'manual',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flow: s.record.flow.name,
          record: { id: s.record.id, number: s.record.number, title: s.record.title, data: s.record.data },
          step: s.stepKey,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await finishAutoStep(db, s.id, `Webhook OK (${res.status})`);
      done++;
    } catch (err) {
      await db.fmsRecordEvent.create({
        data: {
          companyId: s.companyId,
          recordId: s.recordId,
          type: 'webhook_failed',
          stepKey: s.stepKey,
          note: (err as Error).message.slice(0, 200),
        },
      });
      if (tries + 1 >= 5)
        await finishAutoStep(db, s.id, `Webhook failed 5 times: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  return done;
}
