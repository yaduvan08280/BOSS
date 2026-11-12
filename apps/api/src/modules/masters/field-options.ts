import type { Db } from '@mono/db';
import { fieldSchema, flowDefinitionSchema, type FlowField } from '@mono/shared';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import type { FormOwner } from '../forms';
import type { Actor } from '../work/actor';
import { masterOptions, type MasterOption } from './options';

/** Which field of which form: the owner, the field's key and — for a flow — the step and the record being filled. */
export type FieldAt = { owner: FormOwner; field: string; step?: string; record?: string };

type FieldFinder = (db: Db, companyId: string, at: FieldAt) => Promise<FlowField | null>;

/** A flow's field as the form being filled has it: the record's own version, else the published one, else the draft. */
const inFlow: FieldFinder = async (db, companyId, at) => {
  const flow = await db.flow.findFirst({
    where: { id: at.owner.id, companyId, deletedAt: null },
    select: { draft: true, currentVersionId: true },
  });
  if (!flow) return null;
  const record = at.record
    ? await db.fmsRecord.findFirst({
        where: { id: at.record, companyId, flowId: at.owner.id },
        select: { flowVersionId: true },
      })
    : null;
  const versionId = record?.flowVersionId ?? flow.currentVersionId;
  const version = versionId
    ? await db.flowVersion.findFirst({ where: { id: versionId, companyId }, select: { definition: true } })
    : null;
  const def = flowDefinitionSchema.parse(version?.definition ?? flow.draft ?? {});
  const forms = at.step
    ? [def.steps.find((s) => s.key === at.step)?.fields ?? []]
    : [def.startFields, ...def.steps.map((s) => s.fields)];
  return forms.flatMap((f) => f).find((f) => f.key === at.field) ?? null;
};

const inMaster: FieldFinder = async (db, companyId, at) => {
  const m = await db.masterDef.findFirst({
    where: { id: at.owner.id, companyId, deletedAt: null },
    select: { fields: true },
  });
  return m
    ? (z
        .array(fieldSchema)
        .parse(m.fields)
        .find((f) => f.key === at.field) ?? null)
    : null;
};

/** Where a form's fields are read from, by owner kind (record types add theirs). */
export const FIELD_FINDERS: Partial<Record<FormOwner['kind'], FieldFinder>> = {
  flow: inFlow,
  master: inMaster,
};

/**
 * The choices of one field of a saved form. What the field may show is read from its own settings here — its
 * source, which records it offers (`recFilter`), which column must match (`filterBy`) — so a browser can search
 * and name the other field's value, which only narrows the list, but can never widen it.
 */
export async function fieldOptions(
  db: Db,
  actor: Actor,
  at: FieldAt,
  q = '',
  parent: { value?: string; ref?: string } = {},
): Promise<MasterOption[]> {
  const field = await FIELD_FINDERS[at.owner.kind]?.(db, actor.companyId, at);
  if (!field || field.type !== 'master')
    throw new AppError(400, 'VALIDATION_FAILED', 'This field has no list of choices');
  let filter: { column: string; value: string; ref?: string } | undefined;
  if (field.filterBy) {
    // Nothing is offered until the field it depends on has a value.
    if (!parent.value?.trim()) return [];
    filter = { column: field.filterBy.column, value: parent.value, ref: parent.ref };
  }
  return masterOptions(db, actor, field.master ?? 'customers', q, 50, { rec: field.recFilter, filter });
}
