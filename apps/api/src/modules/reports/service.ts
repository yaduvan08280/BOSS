import { Prisma, type Db } from '@mono/db';
import {
  reportDefinitionSchema,
  reportScheduleSchema,
  type ReportDefinition,
  type ReportInput,
} from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { renderPdf } from '../../lib/pdf';
import { toCsv, toXlsx, type Cell } from '../records/xlsx';
import { roleIdOf } from '../records/access';
import { listTypes } from '../records/types';
import { can, type Actor } from '../work/actor';
import { loadSource, runReport, type ReportResult } from './engine';

const ctxOf = (actor: Actor) => ({ companyId: actor.companyId, actorId: actor.userId });
const need = (actor: Actor, key: 'reports.view' | 'reports.create' | 'reports.edit', what: string) => {
  if (!can(actor, key)) throw new AppError(403, 'FORBIDDEN', `You can't ${what}`);
};

/** What a report can be built on: published processes (for people who may see processes) and record types. */
export async function reportSources(db: Db, actor: Actor) {
  need(actor, 'reports.view', 'open reports');
  const flows = can(actor, 'fms.view')
    ? await db.flow.findMany({
        where: { companyId: actor.companyId, deletedAt: null, version: { gt: 0 } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, code: true },
      })
    : [];
  const { types } = await listTypes(db, actor);
  return [
    ...flows.map((f) => ({ kind: 'flow' as const, id: f.id, name: f.name, code: f.code })),
    ...types
      .filter((t) => t.status === 'ACTIVE')
      .map((t) => ({ kind: 'recordType' as const, id: t.id, name: t.pluralName, code: t.prefix })),
  ];
}

/** The columns a source offers (with whether each reportable field's copies are complete). */
export async function reportFields(db: Db, actor: Actor, source: ReportDefinition['source']) {
  need(actor, 'reports.view', 'open reports');
  const src = await loadSource(db, actor, source);
  return { name: src.name, fields: src.fields };
}

/** Run a definition that is not saved (the builder's live preview). */
export async function previewReport(db: Db, actor: Actor, def: ReportDefinition) {
  need(actor, 'reports.view', 'open reports');
  return runReport(db, actor, def, 200);
}

type Row = {
  id: string;
  name: string;
  definition: unknown;
  ownerId: string;
  sharedRoles: string[];
  schedule: unknown;
  updatedAt: Date;
};
const shape = (r: Row, actor: Actor, owner?: string | null) => ({
  id: r.id,
  name: r.name,
  definition: reportDefinitionSchema.parse(r.definition),
  sharedRoles: r.sharedRoles,
  schedule: r.schedule ? reportScheduleSchema.parse(r.schedule) : null,
  mine: r.ownerId === actor.userId,
  owner: owner ?? null,
  /** Its maker, or someone who looks after all reports. */
  canEdit: r.ownerId === actor.userId ? can(actor, 'reports.edit') : can(actor, 'reports.admin'),
  updatedAt: r.updatedAt,
});

/** A saved report this person may open: their own, one shared with their role, or any for a reports admin. */
async function loadReport(db: Db, actor: Actor, id: string) {
  need(actor, 'reports.view', 'open reports');
  const r = await db.report.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!r) throw notFound('Report');
  if (r.ownerId !== actor.userId && !can(actor, 'reports.admin')) {
    const roleId = await roleIdOf(db, actor);
    if (!roleId || !r.sharedRoles.includes(roleId)) throw notFound('Report');
  }
  return r;
}

export async function listReports(db: Db, actor: Actor) {
  need(actor, 'reports.view', 'open reports');
  const roleId = await roleIdOf(db, actor);
  const rows = await db.report.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      ...(can(actor, 'reports.admin')
        ? {}
        : { OR: [{ ownerId: actor.userId }, ...(roleId ? [{ sharedRoles: { has: roleId } }] : [])] }),
    },
    orderBy: { name: 'asc' },
  });
  const people = new Map(
    (
      await db.user.findMany({
        where: { companyId: actor.companyId, id: { in: [...new Set(rows.map((r) => r.ownerId))] } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  return {
    reports: rows.map((r) => shape(r, actor, people.get(r.ownerId))),
    canCreate: can(actor, 'reports.create'),
  };
}

export async function getReport(db: Db, actor: Actor, id: string) {
  return shape(await loadReport(db, actor, id), actor);
}

/** Roles and people named on a report must be this company's. */
async function checkNames(db: Db, actor: Actor, input: ReportInput) {
  const roles = input.sharedRoles ?? [];
  if (roles.length) {
    const n = await db.role.count({
      where: { companyId: actor.companyId, deletedAt: null, id: { in: roles } },
    });
    if (n !== new Set(roles).size)
      throw new AppError(400, 'VALIDATION_FAILED', 'A role chosen here does not exist any more: pick again');
  }
  const people = input.schedule?.userIds ?? [];
  if (people.length) {
    const n = await db.user.count({
      where: { companyId: actor.companyId, deletedAt: null, status: 'ACTIVE', id: { in: people } },
    });
    if (n !== new Set(people).size)
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        'Someone chosen to receive this report is not active: pick again',
      );
  }
}

/** Save a new report, or change one (its maker, or a reports admin). It must run before it can be saved. */
export async function saveReport(db: Db, actor: Actor, input: ReportInput, id?: string) {
  need(actor, id ? 'reports.edit' : 'reports.create', id ? 'change reports' : 'make reports');
  const old = id ? await loadReport(db, actor, id) : null;
  if (old && old.ownerId !== actor.userId && !can(actor, 'reports.admin'))
    throw new AppError(403, 'FORBIDDEN', 'Only its maker can change this report: save your own copy instead');
  await runReport(db, actor, input.definition, 1); // refuses a report that names what this person can't see
  await checkNames(db, actor, input);
  // `schedule` left out keeps what was there; null takes it off.
  const schedule =
    input.schedule === undefined
      ? undefined
      : input.schedule === null
        ? Prisma.DbNull
        : (input.schedule as object);
  const data = {
    name: input.name,
    definition: input.definition as object,
    sharedRoles: [...new Set(input.sharedRoles ?? old?.sharedRoles ?? [])],
    ...(schedule === undefined ? {} : { schedule }),
  };
  return db.$transaction(async (tx) => {
    const row = old
      ? await tx.report.update({ where: { id: old.id }, data })
      : await tx.report.create({ data: { ...data, companyId: actor.companyId, ownerId: actor.userId } });
    await recordChange(tx, ctxOf(actor), {
      event: old ? 'report.changed' : 'report.created',
      entityType: 'report',
      entityId: row.id,
      before: old ? { name: old.name, definition: old.definition, sharedRoles: old.sharedRoles } : undefined,
      after: {
        name: row.name,
        definition: row.definition,
        sharedRoles: row.sharedRoles,
        schedule: row.schedule,
      },
      payload: { reportId: row.id, name: row.name },
    });
    return { id: row.id };
  });
}

export async function deleteReport(db: Db, actor: Actor, id: string) {
  need(actor, 'reports.edit', 'delete reports');
  const r = await loadReport(db, actor, id);
  if (r.ownerId !== actor.userId && !can(actor, 'reports.admin'))
    throw new AppError(403, 'FORBIDDEN', 'Only its maker can delete this report');
  await db.$transaction(async (tx) => {
    await tx.report.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordChange(tx, ctxOf(actor), {
      event: 'report.deleted',
      entityType: 'report',
      entityId: id,
      before: { name: r.name },
      payload: { reportId: id, name: r.name },
    });
  });
  return { ok: true };
}

/** Run a saved report as the person asking: they see only what they may see in its source. */
export async function runSaved(db: Db, actor: Actor, id: string, max = 500) {
  const r = await loadReport(db, actor, id);
  return {
    name: r.name,
    result: await runReport(db, actor, reportDefinitionSchema.parse(r.definition), max),
  };
}

/** The result as a sheet: a heading row, the rows, and a totals row when the report has totals. */
export function resultSheet(res: ReportResult): Cell[][] {
  const out: Cell[][] = [res.columns.map((c) => c.label), ...res.rows];
  if (res.totals && res.grouped) out.push(['Total', ...res.totals]);
  else if (res.totals) out.push([], res.measures, res.totals);
  return out;
}

const inr = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** A saved report as a file: CSV, Excel or PDF — up to 5,000 rows, the same numbers as on the screen. */
export async function exportReport(db: Db, actor: Actor, id: string, format: 'csv' | 'xlsx' | 'pdf') {
  const { name, result } = await runSaved(db, actor, id, 5000);
  const safe =
    name
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'report';
  const sheet = resultSheet(result);
  if (format === 'csv')
    return {
      body: Buffer.from(toCsv(sheet), 'utf8'),
      mime: 'text/csv; charset=utf-8',
      filename: `${safe}.csv`,
    };
  if (format === 'xlsx')
    return {
      body: toXlsx(name.slice(0, 28), sheet),
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${safe}.xlsx`,
    };
  const company = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { name: true },
  });
  const text = (v: Cell, right: boolean) => ({
    text: v === null || v === undefined ? '' : typeof v === 'number' ? inr(v) : String(v),
    alignment: right ? 'right' : 'left',
  });
  const numeric = result.columns.map((c) => c.kind === 'number');
  const body = [
    result.columns.map((c, i) => ({
      text: c.label,
      bold: true,
      fillColor: '#f2efe7',
      alignment: numeric[i] ? 'right' : 'left',
    })),
    ...result.rows.map((r) => r.map((v, i) => text(v, numeric[i]!))),
    ...(result.totals && result.grouped
      ? [[{ text: 'Total', bold: true }, ...result.totals.map((v) => ({ ...text(v, true), bold: true }))]]
      : []),
  ];
  const pdf = await renderPdf({
    pageSize: 'A4',
    pageOrientation: result.columns.length > 5 ? 'landscape' : 'portrait',
    pageMargins: [32, 36, 32, 40],
    info: { title: name },
    content: [
      { text: name, fontSize: 14, bold: true },
      {
        text: `${company.name} · ${result.source.name} · ${result.total} record(s)`,
        color: '#666',
        margin: [0, 2, 0, 10],
      },
      result.columns.length
        ? {
            table: { headerRows: 1, widths: result.columns.map((_, i) => (i === 0 ? '*' : 'auto')), body },
            layout: 'lightHorizontalLines',
          }
        : '',
      !result.grouped && result.totals
        ? {
            text: result.measures
              .map((m, i) => `${m}: ${result.totals![i] === null ? '—' : inr(result.totals![i]!)}`)
              .join('   ·   '),
            margin: [0, 10, 0, 0],
            bold: true,
          }
        : '',
    ],
  });
  return { body: pdf, mime: 'application/pdf', filename: `${safe}.pdf` };
}
