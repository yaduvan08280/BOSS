import net from 'node:net';
import type { Db, Tx } from '@mono/db';
import { escpos, type PrintLine } from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { branchWhere, need } from './access';

/**
 * Phase 15 — printing. A ticket or bill becomes ESC/POS bytes in a `PrintJob`. Network printers are sent to by
 * the server (ip:9100) — the worker retries, and after five failures the job is FAILED (the ticket is still on
 * the kitchen display). Printers of a branch away from the server are served by that branch's site agent, which
 * pulls its jobs and reports back.
 */
const MAX_TRIES = 5;

export async function queuePrint(
  tx: Tx,
  companyId: string,
  printerId: string | null | undefined,
  kind: 'KOT' | 'BILL',
  refId: string,
  lines: PrintLine[],
) {
  if (!printerId) return null;
  const printer = await tx.printer.findFirst({ where: { id: printerId, companyId, deletedAt: null } });
  if (!printer) return null;
  return tx.printJob.create({
    data: { companyId, printerId, kind, refId, payload: Buffer.from(escpos(lines)).toString('base64') },
  });
}

/** Send bytes to a network printer: resolves when the printer took them, rejects on refusal or silence. */
export function sendToPrinter(address: string, bytes: Buffer, timeoutMs = 3000): Promise<void> {
  const [host, port] = address.split(':');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: host!, port: Number(port ?? 9100) });
    const fail = (e: Error) => {
      socket.destroy();
      reject(e);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error('The printer did not answer')));
    socket.once('error', fail);
    socket.once('connect', () => socket.end(bytes, () => resolve()));
  });
}

/** The worker's sweep: every queued job of a network printer is tried once; failures count towards FAILED. */
export async function sendQueued(db: Db, onlyCompanyId?: string) {
  const jobs = await db.printJob.findMany({
    where: { status: 'QUEUED', ...(onlyCompanyId ? { companyId: onlyCompanyId } : {}) },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  const printers = new Map(
    (await db.printer.findMany({ where: { id: { in: [...new Set(jobs.map((j) => j.printerId))] } } })).map(
      (p) => [p.id, p],
    ),
  );
  let sent = 0;
  for (const job of jobs) {
    const printer = printers.get(job.printerId);
    // A site agent's printer is not the server's to reach.
    if (!printer || printer.connection !== 'NETWORK') continue;
    try {
      if (!printer.address) throw new Error('The printer has no address');
      await sendToPrinter(printer.address, Buffer.from(job.payload, 'base64'));
      await db.printJob.update({
        where: { id: job.id },
        data: { status: 'SENT', sentAt: new Date(), tries: { increment: 1 }, error: null },
      });
      sent += 1;
    } catch (e) {
      const tries = job.tries + 1;
      await db.printJob.update({
        where: { id: job.id },
        data: {
          tries,
          error: (e as Error).message.slice(0, 200),
          status: tries >= MAX_TRIES ? 'FAILED' : 'QUEUED',
        },
      });
    }
  }
  return sent;
}

/** What a branch's site agent has to print: the queued jobs of that branch's agent printers. */
export async function agentJobs(db: Db, actor: Actor, branchId: string) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const printers = await db.printer.findMany({
    where: { companyId: actor.companyId, deletedAt: null, connection: 'AGENT', branchId, ...branchWhere() },
  });
  const jobs = await db.printJob.findMany({
    where: { companyId: actor.companyId, status: 'QUEUED', printerId: { in: printers.map((p) => p.id) } },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  const byId = new Map(printers.map((p) => [p.id, p]));
  return jobs.map((j) => ({
    id: j.id,
    kind: j.kind,
    printer: byId.get(j.printerId)!.name,
    address: byId.get(j.printerId)!.address,
    payload: j.payload,
  }));
}
/** The agent reports a job printed, or why it could not. */
export async function agentDone(db: Db, actor: Actor, id: string, ok: boolean, error?: string | null) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const job = await db.printJob.findFirst({ where: { id, companyId: actor.companyId } });
  if (!job) throw notFound('Print job');
  if (job.status !== 'QUEUED') throw new AppError(409, 'CONFLICT', 'That job is already finished');
  const tries = job.tries + 1;
  await db.printJob.update({
    where: { id },
    data: ok
      ? { status: 'SENT', sentAt: new Date(), tries }
      : { tries, error: (error ?? 'failed').slice(0, 200), status: tries >= MAX_TRIES ? 'FAILED' : 'QUEUED' },
  });
  return { ok: true };
}

/** Print jobs of the person's outlets that did not go through (so someone can look at the printer). */
export async function failedJobs(db: Db, actor: Actor) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const jobs = await db.printJob.findMany({
    where: { companyId: actor.companyId, status: { in: ['FAILED', 'QUEUED'] } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const printers = new Map(
    (
      await db.printer.findMany({
        where: { companyId: actor.companyId, id: { in: jobs.map((j) => j.printerId) } },
      })
    ).map((p) => [p.id, p.name]),
  );
  return jobs.map((j) => ({
    id: j.id,
    kind: j.kind,
    status: j.status,
    tries: j.tries,
    error: j.error,
    printer: printers.get(j.printerId) ?? '',
    createdAt: j.createdAt,
  }));
}
