import { randomInt } from 'node:crypto';
import type { Db } from '@mono/db';
import { localDate, zonedToUtc } from '@mono/shared';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { can, type Actor } from '../work/actor';
import { places } from './core';

type Rules = { perDay: number; minutes: number };
const DEFAULTS: Rules = { perDay: 0, minutes: 20 };

export async function spotRules(db: Db, companyId: string): Promise<Rules> {
  const c = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { settings: true } });
  return { ...DEFAULTS, ...(((c.settings ?? {}) as { spotChecks?: Partial<Rules> }).spotChecks ?? {}) };
}

export async function saveSpotRules(db: Db, actor: Actor, input: Rules) {
  if (!can(actor, 'core.admin')) throw forbidden('Only the owner and admins set this');
  const c = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { settings: true },
  });
  const rules = {
    perDay: Math.min(20, Math.max(0, Math.round(input.perDay))),
    minutes: Math.min(120, Math.max(5, Math.round(input.minutes))),
  };
  await db.company.update({
    where: { id: actor.companyId },
    data: { settings: { ...((c.settings ?? {}) as object), spotChecks: rules } },
  });
  return rules;
}

/**
 * Ask one surprise check: a checklist item ticked in the last six hours, picked at random, must be shown again
 * with a photo taken now. The person who decides is the run's verifier, else the branch's manager, else nobody
 * but the owner and admins. Returns the check, or null when there is nothing to ask about.
 */
export async function askSpotCheck(db: Db, companyId: string, now = new Date()) {
  const rules = await spotRules(db, companyId);
  const since = new Date(now.getTime() - 6 * 3_600_000);
  const taken = (
    await db.spotCheck.findMany({
      where: { companyId, askedAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } },
      select: { runId: true },
    })
  ).map((s) => s.runId);
  const items = await db.checklistRunItem.findMany({
    where: {
      companyId,
      done: true,
      doneAt: { gte: since },
      runId: { notIn: taken },
      run: { master: { deletedAt: null } },
    },
    select: {
      id: true,
      text: true,
      runId: true,
      run: { select: { doerId: true, verifierId: true, branchId: true, master: { select: { name: true } } } },
    },
    take: 200,
  });
  if (!items.length) return null;
  const pick = items[randomInt(items.length)]!;
  const doer = await db.user.findFirst({
    where: { id: pick.run.doerId, companyId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!doer) return null;
  const manager = pick.run.branchId
    ? await db.branchManager.findFirst({
        where: { companyId, branchId: pick.run.branchId, role: 'MANAGER', userId: { not: doer.id } },
        select: { userId: true },
      })
    : null;
  const deciderId =
    pick.run.verifierId && pick.run.verifierId !== doer.id ? pick.run.verifierId : (manager?.userId ?? null);
  const dueAt = new Date(now.getTime() + rules.minutes * 60_000);
  return db.$transaction(async (tx) => {
    const row = await tx.spotCheck.create({
      data: {
        companyId,
        branchId: pick.run.branchId,
        runId: pick.runId,
        runItemId: pick.id,
        doerId: doer.id,
        deciderId,
        text: pick.text,
        checklist: pick.run.master.name,
        askedAt: now,
        dueAt,
      },
    });
    await emitEvent(
      tx,
      { companyId, actorId: null },
      {
        name: 'checklist.spot_check',
        entityType: 'spot_check',
        entityId: row.id,
        payload: {
          doerId: doer.id,
          checklist: row.checklist,
          item: row.text,
          minutes: rules.minutes,
          link: '/workspace',
        },
      },
    );
    return row;
  });
}

/** Every minute: checks whose time ran out are missed; companies that switched this on get their day's checks, spread over the day. */
export async function spotSweep(db: Db, now = new Date(), onlyCompanyId?: string) {
  const missed = await db.spotCheck.updateMany({
    where: { status: 'ASKED', dueAt: { lt: now }, ...(onlyCompanyId ? { companyId: onlyCompanyId } : {}) },
    data: { status: 'MISSED' },
  });
  const companies = await db.company.findMany({
    where: { deletedAt: null, ...(onlyCompanyId ? { id: onlyCompanyId } : {}) },
    select: { id: true, timezone: true, settings: true },
  });
  let asked = 0;
  for (const c of companies) {
    const rules = {
      ...DEFAULTS,
      ...(((c.settings ?? {}) as { spotChecks?: Partial<Rules> }).spotChecks ?? {}),
    };
    if (!rules.perDay) continue;
    const today = localDate(now, c.timezone);
    const minute = Math.round((now.getTime() - zonedToUtc(today, 0, c.timezone).getTime()) / 60_000);
    // Between 09:00 and 22:00: each minute has a small chance, so the day's checks come at times nobody can guess.
    if (minute < 9 * 60 || minute > 22 * 60) continue;
    const done = await db.spotCheck.count({
      where: { companyId: c.id, askedAt: { gte: zonedToUtc(today, 0, c.timezone) } },
    });
    if (done >= rules.perDay) continue;
    const left = Math.max(1, 22 * 60 - minute);
    if (randomInt(left) >= rules.perDay - done) continue;
    if (await askSpotCheck(db, c.id, now)) asked += 1;
  }
  return { asked, missed: missed.count };
}

const view = (
  s: {
    id: string;
    text: string;
    checklist: string;
    status: string;
    askedAt: Date;
    dueAt: Date;
    photoId: string | null;
    doerId: string;
    note: string | null;
  },
  name: (id: string) => string,
) => ({
  id: s.id,
  text: s.text,
  checklist: s.checklist,
  status: s.status,
  askedAt: s.askedAt,
  dueAt: s.dueAt,
  photoUrl: s.photoId ? `/api/files/${s.photoId}` : null,
  doer: name(s.doerId),
  note: s.note,
});

/** What is waiting on me: checks I must answer now, and answers I must judge. */
export async function mySpotChecks(db: Db, actor: Actor) {
  const [mine, judge, pl] = await Promise.all([
    db.spotCheck.findMany({
      where: {
        companyId: actor.companyId,
        doerId: actor.userId,
        status: 'ASKED',
        dueAt: { gte: new Date() },
      },
      orderBy: { dueAt: 'asc' },
    }),
    db.spotCheck.findMany({
      where: {
        companyId: actor.companyId,
        status: 'ANSWERED',
        doerId: { not: actor.userId },
        ...(can(actor, 'core.admin') ? {} : { deciderId: actor.userId }),
      },
      orderBy: { answeredAt: 'asc' },
      take: 20,
    }),
    places(db, actor.companyId),
  ]);
  return { answer: mine.map((s) => view(s, pl.name)), judge: judge.map((s) => view(s, pl.name)) };
}

/** The photo, taken after the question was asked and before its time ran out. */
export async function answerSpotCheck(db: Db, actor: Actor, id: string, attachmentId: string) {
  const s = await db.spotCheck.findFirst({ where: { id, companyId: actor.companyId, doerId: actor.userId } });
  if (!s) throw notFound('Check');
  if (s.status !== 'ASKED' || s.dueAt < new Date())
    throw new AppError(409, 'CONFLICT', 'The time for this check has passed');
  const file = await db.attachment.findFirst({
    where: { id: attachmentId, companyId: actor.companyId, uploadedById: actor.userId, deletedAt: null },
  });
  if (!file || !file.mime.startsWith('image/')) throw new AppError(400, 'BAD_REQUEST', 'Take a photo');
  if (file.createdAt < s.askedAt)
    throw new AppError(
      400,
      'BAD_REQUEST',
      'Take a new photo now — this one is from before the check was asked',
    );
  await db.$transaction(async (tx) => {
    await tx.attachment.update({
      where: { id: file.id },
      data: { entityType: 'spot_check', entityId: s.id },
    });
    await tx.spotCheck.update({
      where: { id: s.id },
      data: { status: s.deciderId ? 'ANSWERED' : 'ANSWERED', photoId: file.id, answeredAt: new Date() },
    });
  });
  return { ok: true };
}

/** The verifier's word: it holds, or it does not (with what was wrong). Nobody judges their own. */
export async function decideSpotCheck(
  db: Db,
  actor: Actor,
  id: string,
  input: { ok: boolean; note?: string | null },
) {
  const s = await db.spotCheck.findFirst({ where: { id, companyId: actor.companyId } });
  if (!s) throw notFound('Check');
  if (s.doerId === actor.userId) throw forbidden('Somebody else judges your check');
  if (s.deciderId !== actor.userId && !can(actor, 'core.admin'))
    throw forbidden('This check is not yours to judge');
  if (s.status !== 'ANSWERED') throw new AppError(409, 'CONFLICT', 'There is no answer to judge');
  if (!input.ok && !input.note?.trim()) throw new AppError(400, 'BAD_REQUEST', 'Say what was wrong');
  await db.$transaction(async (tx) => {
    await tx.spotCheck.update({
      where: { id },
      data: {
        status: input.ok ? 'OK' : 'NOT_OK',
        decidedById: actor.userId,
        decidedAt: new Date(),
        note: input.note?.trim() || null,
      },
    });
    await tx.auditLog.create({
      data: {
        companyId: actor.companyId,
        actorId: actor.userId,
        action: input.ok ? 'spot_check.ok' : 'spot_check.not_ok',
        entityType: 'spot_check',
        entityId: id,
        after: { note: input.note ?? null },
      },
    });
  });
  return { ok: true };
}

/** The owner's view: the rule, the last checks, and who missed or failed them. */
export async function spotChecks(db: Db, actor: Actor) {
  if (!can(actor, 'core.admin')) throw forbidden("The owner's desk is for the owner and admins");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [rules, rows, pl] = await Promise.all([
    spotRules(db, actor.companyId),
    db.spotCheck.findMany({
      where: { companyId: actor.companyId, askedAt: { gte: since } },
      orderBy: { askedAt: 'desc' },
      take: 300,
    }),
    places(db, actor.companyId),
  ]);
  const by = new Map<string, { asked: number; ok: number; notOk: number; missed: number }>();
  for (const r of rows) {
    const x = by.get(r.doerId) ?? by.set(r.doerId, { asked: 0, ok: 0, notOk: 0, missed: 0 }).get(r.doerId)!;
    x.asked += 1;
    if (r.status === 'OK') x.ok += 1;
    if (r.status === 'NOT_OK') x.notOk += 1;
    if (r.status === 'MISSED') x.missed += 1;
  }
  return {
    rules,
    people: [...by]
      .map(([userId, x]) => ({ userId, name: pl.name(userId), ...x }))
      .sort((a, b) => b.notOk + b.missed - (a.notOk + a.missed)),
    latest: rows.slice(0, 40).map((s) => view(s, pl.name)),
  };
}
