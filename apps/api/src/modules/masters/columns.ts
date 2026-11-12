import type { Db } from '@mono/db';
import {
  fieldSchema,
  flowDefinitionSchema,
  recordDefinitionSchema,
  type FlowField,
  type PermissionKey,
} from '@mono/shared';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { can, type Actor } from '../work/actor';
import { vendorsMaster } from './options';
import type { SourceColumn } from './sources';
import { mayReadRecordType } from './sources/record-type';

type ColumnLister = (db: Db, actor: Actor, arg: string) => Promise<SourceColumn[]>;

const fixed =
  (...cols: [string, string][]): ColumnLister =>
  async () =>
    cols.map(([key, label]) => ({ key, label }));

/** Values a row can hand to another field (files and signatures stay with their record). */
const ofFields = (fields: FlowField[]): SourceColumn[] =>
  fields
    .filter((f) => !['photo', 'file', 'signature'].includes(f.type))
    .map((f) => ({ key: f.key, label: f.label }));

const masterColumns: ColumnLister = async (db, actor, masterId) => {
  const m = await db.masterDef.findFirst({
    where: { id: masterId, companyId: actor.companyId, deletedAt: null },
    select: { fields: true },
  });
  return m ? ofFields(z.array(fieldSchema).parse(m.fields)) : [];
};

/** A record's columns: what MONO knows about it, then every field of the flow (start form first, then the steps). */
const recordColumns: ColumnLister = async (db, actor, flowId) => {
  const flow = await db.flow.findFirst({
    where: { id: flowId, companyId: actor.companyId, deletedAt: null },
    select: { draft: true, currentVersionId: true },
  });
  if (!flow) return [];
  const version = flow.currentVersionId
    ? await db.flowVersion.findUnique({ where: { id: flow.currentVersionId }, select: { definition: true } })
    : null;
  const def = flowDefinitionSchema.parse(version?.definition ?? flow.draft ?? {});
  const seen = new Set(['number', 'title', 'status', 'started']);
  const own = ofFields([...def.startFields, ...def.steps.flatMap((s) => s.fields)]).filter(
    (c) => !seen.has(c.key) && seen.add(c.key),
  );
  return [
    { key: 'number', label: 'Number' },
    { key: 'title', label: 'Title' },
    { key: 'status', label: 'Status' },
    { key: 'started', label: 'Started on' },
    ...own,
  ];
};

/** A custom record's columns: its number, title and status, then the type's own fields. */
const recordTypeColumns: ColumnLister = async (db, actor, typeId) => {
  const t = await db.recordType.findFirst({
    where: { id: typeId, companyId: actor.companyId, deletedAt: null },
    select: { definition: true },
  });
  if (!t) return [];
  const seen = new Set(['code', 'title', 'status']);
  return [
    { key: 'code', label: 'Number' },
    { key: 'title', label: 'Title' },
    { key: 'status', label: 'Status' },
    ...ofFields(recordDefinitionSchema.parse(t.definition).fields).filter((c) => !seen.has(c.key)),
  ];
};

/** By source prefix, like the choices themselves (`options.ts`). A source without an entry has no columns. */
export const SOURCE_COLUMNS: Record<string, ColumnLister> = {
  customers: fixed(
    ['name', 'Name'],
    ['code', 'Code'],
    ['city', 'City'],
    ['mobile', 'Mobile'],
    ['segment', 'Segment'],
  ),
  items: fixed(
    ['name', 'Name'],
    ['code', 'Code'],
    ['unit', 'Unit'],
    ['rate', 'Rate'],
    ['category', 'Category'],
    ['location', 'Location'],
    ['vendor', 'Vendor'],
    ['stock', 'Stock'],
  ),
  people: fixed(
    ['name', 'Name'],
    ['code', 'Code'],
    ['mobile', 'Mobile'],
    ['designation', 'Designation'],
    ['department', 'Department'],
  ),
  vendors: async (db, actor) => {
    const m = await vendorsMaster(db, actor.companyId);
    return m ? masterColumns(db, actor, m.id) : [{ key: 'name', label: 'Name' }];
  },
  m: masterColumns,
  rec: recordColumns,
  rt: recordTypeColumns,
};

const NEEDS: Record<string, PermissionKey> = { rec: 'fms.view', fms: 'fms.view' };

/** The columns a source's rows carry — what the editor offers for auto-fill and "depends on". */
export async function sourceColumns(db: Db, actor: Actor, source: string): Promise<SourceColumn[]> {
  const i = source.indexOf(':');
  const prefix = i < 0 ? source : source.slice(0, i);
  const need = NEEDS[prefix];
  if (need && !can(actor, need))
    throw new AppError(403, 'FORBIDDEN', 'You do not have access to the processes this list reads');
  const arg = i < 0 ? '' : source.slice(i + 1);
  if (prefix === 'rt') await mayReadRecordType(db, actor, arg);
  return (await SOURCE_COLUMNS[prefix]?.(db, actor, arg)) ?? [];
}
