import type { ComplianceItem, Db } from '@mono/db';
import {
  addDays,
  complianceSchema,
  complianceState,
  inRange,
  reminderDue,
  tempPointSchema,
  tempReadingSchema,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { claimMark } from '../ea/jobs';
import { ctxOf } from '../hosp/access';
import type { Actor } from '../work/actor';
import { dmy, manager, placeFor, placeOf, sales, seer } from './core';

/**
 * Phase 18 — compliance: licences and certificates with the day they run out (and things done again and again,
 * such as pest control, with the day they are next due), reminders before that day, and HACCP temperature logs
 * that raise an alert when a reading is outside its limits.
 */
type Done = { on: string; byId: string; note: string | null; next: string };
const view = (c: ComplianceItem, today: string) => ({
  id: c.id,
  branchId: c.branchId,
  kind: c.kind,
  name: c.name,
  number: c.number,
  authority: c.authority,
  issuedOn: c.issuedOn,
  expiresOn: c.expiresOn,
  everyDays: c.everyDays,
  remindDays: c.remindDays,
  fileId: c.fileId,
  note: c.note,
  state: complianceState(c.expiresOn, today, c.remindDays),
  daysLeft: Math.round(
    (Date.parse(`${c.expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  ),
  history: (c.history as Done[] | null) ?? [],
});

export async function listCompliance(db: Db, actor: Actor, branchId: string) {
  seer(actor);
  const place = await placeOf(db, actor, branchId);
  const rows = await db.complianceItem.findMany({
    where: { companyId: actor.companyId, branchId, deletedAt: null },
    orderBy: { expiresOn: 'asc' },
  });
  const items = rows.map((r) => view(r, place.today));
  const count = (s: string) => items.filter((i) => i.state === s).length;
  return {
    today: place.today,
    counts: { valid: count('VALID'), expiring: count('EXPIRING'), expired: count('EXPIRED') },
    items,
  };
}
export async function saveCompliance(
  db: Db,
  actor: Actor,
  input: z.input<typeof complianceSchema>,
  id?: string,
) {
  manager(actor);
  const c = complianceSchema.parse(input);
  const place = await placeOf(db, actor, c.branchId);
  const before = id
    ? await db.complianceItem.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } })
    : null;
  if (id && !before) throw notFound('Item');
  const data = {
    branchId: c.branchId,
    kind: c.kind,
    name: c.name,
    number: c.number ?? null,
    authority: c.authority ?? null,
    issuedOn: c.issuedOn ?? null,
    expiresOn: c.expiresOn,
    everyDays: c.everyDays ?? null,
    remindDays: c.remindDays,
    fileId: c.fileId ?? null,
    note: c.note ?? null,
  };
  return db.$transaction(async (tx) => {
    const row = before
      ? await tx.complianceItem.update({ where: { id: before.id }, data })
      : await tx.complianceItem.create({ data: { ...data, companyId: actor.companyId } });
    await writeAudit(tx, ctxOf(actor), {
      action: before ? 'compliance.updated' : 'compliance.created',
      entityType: 'compliance_item',
      entityId: row.id,
      before: before ? view(before, place.today) : undefined,
      after: view(row, place.today),
    });
    return view(row, place.today);
  });
}

export const renewSchema = z.object({
  /** The new last day (a renewed licence). Left out for something done every N days: the next due day is worked out. */
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  number: z.string().trim().max(60).nullish(),
  fileId: z.string().max(40).nullish(),
  note: z.string().trim().max(300).nullish(),
});
/** Renewed, or done: the due day moves on and what was there before stays in its history. */
export async function renewCompliance(db: Db, actor: Actor, id: string, input: z.input<typeof renewSchema>) {
  sales(actor);
  const p = renewSchema.parse(input);
  const c = await db.complianceItem.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!c) throw notFound('Item');
  const place = await placeOf(db, actor, c.branchId);
  const next = p.expiresOn ?? (c.everyDays ? addDays(place.today, c.everyDays) : null);
  if (!next) throw new AppError(400, 'VALIDATION_FAILED', 'Until which day is it valid now?');
  if (next <= place.today) throw new AppError(400, 'VALIDATION_FAILED', 'The new day must be after today');
  const history = [
    ...((c.history as Done[] | null) ?? []),
    { on: place.today, byId: actor.userId, note: p.note ?? null, next },
  ];
  return db.$transaction(async (tx) => {
    const row = await tx.complianceItem.update({
      where: { id },
      data: {
        expiresOn: next,
        issuedOn: place.today,
        history,
        ...(p.number ? { number: p.number } : {}),
        ...(p.fileId ? { fileId: p.fileId } : {}),
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'compliance.renewed',
      entityType: 'compliance_item',
      entityId: id,
      before: { expiresOn: c.expiresOn },
      after: { expiresOn: next, note: p.note ?? null },
    });
    return view(row, place.today);
  });
}
export async function deleteCompliance(db: Db, actor: Actor, id: string) {
  manager(actor);
  const c = await db.complianceItem.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!c) throw notFound('Item');
  await placeOf(db, actor, c.branchId);
  await db.$transaction(async (tx) => {
    await tx.complianceItem.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'compliance.deleted',
      entityType: 'compliance_item',
      entityId: id,
      before: { name: c.name },
    });
  });
  return { ok: true };
}

/** Reminders (worker, daily is enough; safe to run often): each step — 60, 30, 7 days, the day, run out — is told once. */
export async function complianceSweep(db: Db, onlyCompanyId?: string) {
  const rows = await db.complianceItem.findMany({
    where: { deletedAt: null, ...(onlyCompanyId ? { companyId: onlyCompanyId } : {}) },
    take: 5000,
  });
  const places = new Map<string, Awaited<ReturnType<typeof placeFor>> | null>();
  let sent = 0;
  for (const c of rows) {
    if (!places.has(c.branchId))
      places.set(c.branchId, await placeFor(db, c.companyId, c.branchId).catch(() => null));
    const place = places.get(c.branchId);
    if (!place) continue;
    const step = reminderDue(c.expiresOn, place.today, c.remindDays);
    if (!step || !(await claimMark(db, c.companyId, `compliance:${c.id}:${c.expiresOn}:${step}`))) continue;
    const v = view(c, place.today);
    await db.$transaction((tx) =>
      emitEvent(
        tx,
        { companyId: c.companyId, actorId: null },
        {
          name: 'compliance.expiring',
          entityType: 'compliance_item',
          entityId: c.id,
          payload: {
            branchId: c.branchId,
            place: place.name,
            name: c.name,
            number: c.number ?? '',
            on: dmy(c.expiresOn),
            days: Math.max(0, v.daysLeft),
            state:
              v.daysLeft < 0
                ? 'has run out'
                : v.daysLeft === 0
                  ? 'runs out today'
                  : `runs out in ${v.daysLeft} days`,
            link: '/hosp/compliance',
          },
        },
      ),
    );
    sent++;
  }
  return sent;
}

export async function tempBoard(db: Db, actor: Actor, branchId: string) {
  seer(actor);
  const place = await placeOf(db, actor, branchId);
  const points = await db.tempPoint.findMany({
    where: { companyId: actor.companyId, branchId, deletedAt: null },
    orderBy: { name: 'asc' },
  });
  const since = new Date(Date.now() - 7 * 86_400_000);
  const readings = await db.tempReading.findMany({
    where: { companyId: actor.companyId, pointId: { in: points.map((p) => p.id) }, at: { gte: since } },
    orderBy: { at: 'desc' },
    take: 2000,
  });
  return {
    today: place.today,
    points: points.map((p) => {
      const mine = readings.filter((r) => r.pointId === p.id);
      return {
        id: p.id,
        name: p.name,
        unit: p.unit,
        min: p.min === null ? null : Number(p.min),
        max: p.max === null ? null : Number(p.max),
        last: mine[0]
          ? { value: Number(mine[0].value), ok: mine[0].ok, at: mine[0].at, action: mine[0].action }
          : null,
        outOfRange: mine.filter((r) => !r.ok).length,
        readings: mine
          .slice(0, 20)
          .map((r) => ({ value: Number(r.value), ok: r.ok, at: r.at, action: r.action })),
      };
    }),
  };
}
export async function saveTempPoint(
  db: Db,
  actor: Actor,
  input: z.input<typeof tempPointSchema>,
  id?: string,
) {
  manager(actor);
  const p = tempPointSchema.parse(input);
  await placeOf(db, actor, p.branchId);
  if (p.min != null && p.max != null && p.min > p.max)
    throw new AppError(400, 'VALIDATION_FAILED', 'The lowest is above the highest');
  const data = { branchId: p.branchId, name: p.name, unit: p.unit, min: p.min ?? null, max: p.max ?? null };
  const row = id
    ? await db.tempPoint.update({ where: { id, companyId: actor.companyId }, data })
    : await db.tempPoint.create({ data: { ...data, companyId: actor.companyId } });
  await db.$transaction((tx) =>
    writeAudit(tx, ctxOf(actor), {
      action: 'compliance.temp_point_saved',
      entityType: 'temp_point',
      entityId: row.id,
      after: p,
    }),
  );
  return { id: row.id };
}
/** A reading. Outside the limits it needs what was done about it, and the branch's managers are told at once. */
export async function logTemp(
  db: Db,
  actor: Actor,
  pointId: string,
  input: z.input<typeof tempReadingSchema>,
) {
  sales(actor);
  const r = tempReadingSchema.parse(input);
  const point = await db.tempPoint.findFirst({
    where: { id: pointId, companyId: actor.companyId, deletedAt: null },
  });
  if (!point) throw notFound('Point');
  const place = await placeOf(db, actor, point.branchId);
  const limits = {
    min: point.min === null ? null : Number(point.min),
    max: point.max === null ? null : Number(point.max),
  };
  const ok = inRange(limits, r.value);
  if (!ok && !r.action)
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      `${r.value}${point.unit} is outside the limits — write what was done about it`,
    );
  return db.$transaction(async (tx) => {
    const row = await tx.tempReading.create({
      data: {
        companyId: actor.companyId,
        branchId: point.branchId,
        pointId,
        value: r.value,
        ok,
        action: r.action ?? null,
        byId: actor.userId,
      },
    });
    if (!ok) {
      await writeAudit(tx, ctxOf(actor), {
        action: 'compliance.out_of_range',
        entityType: 'temp_point',
        entityId: pointId,
        after: { value: r.value, action: r.action },
      });
      await emitEvent(tx, ctxOf(actor), {
        name: 'compliance.out_of_range',
        entityType: 'temp_point',
        entityId: pointId,
        payload: {
          branchId: point.branchId,
          place: place.name,
          point: point.name,
          value: `${r.value}${point.unit}`,
          limits: `${limits.min ?? '—'} to ${limits.max ?? '—'}${point.unit}`,
          action: r.action,
          link: '/hosp/compliance',
        },
      });
    }
    return { id: row.id, ok };
  });
}
