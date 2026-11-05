import type { Db } from '@mono/db';
import {
  afterOrderStepSchema,
  crmConfigSchema,
  DEFAULT_AFTER_ORDER,
  SETUP_PAGES,
  type AfterOrderStep,
  type CrmConfig,
  type FlowDefinition,
  type SetupPage,
} from '@mono/shared';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { createFlow, publishFlow, saveFlow } from '../fms/builder';
import type { Actor } from '../work/actor';
import { crmConfigOf, need, saveConfig, seatPeople } from './access';

/** The order record's start form: the after-order flow reads these. */
const START_FIELDS = [
  { key: 'customer', label: 'Customer', type: 'text', required: true },
  { key: 'order_no', label: 'Order', type: 'text', required: true },
  { key: 'amount', label: 'Amount', type: 'amount', required: true },
  { key: 'promised_on', label: 'Promised date', type: 'date', required: true },
  { key: 'payment_due', label: 'Payment due', type: 'date', required: true },
  { key: 'mobile', label: 'Customer mobile', type: 'mobile', required: false },
  { key: 'items', label: 'Items', type: 'items', required: false },
] as const;

const timeOf = (t: AfterOrderStep['time']) =>
  t.anchor === 'promised'
    ? { value: t.value, unit: t.unit, anchor: 'dateField' as const, field: 'promised_on', before: true }
    : t.anchor === 'paymentDue'
      ? { value: t.value, unit: t.unit, anchor: 'dateField' as const, field: 'payment_due', before: false }
      : { value: t.value, unit: t.unit, anchor: t.anchor };

/**
 * The after-order steps (§11.1 page 6) as a real FMS flow: each step's doers are the people in its seat, its
 * documents become checklist lines, proof as set. Saved and published (a new version; running orders keep theirs).
 */
export async function syncAfterOrderFlow(db: Db, actor: Actor, config: CrmConfig) {
  const admin = { ...actor, permissions: [...actor.permissions, 'fms.admin'] };
  const people = await Promise.all(
    config.afterOrder.map((s) => seatPeople(db, actor.companyId, s.seat, config)),
  );
  const empty = config.afterOrder.filter((_, i) => !people[i]!.length).map((s) => s.name);
  if (empty.length)
    throw new AppError(400, 'VALIDATION_FAILED', `Put someone in the seat for: ${empty.join(', ')}`);
  const definition: FlowDefinition = {
    startFields: START_FIELDS.map((f) => ({ ...f })),
    timeModel: 'shifts',
    steps: config.afterOrder.map((s, i) => ({
      key: s.key,
      name: s.name,
      type: 'TASK',
      doerIds: people[i]!,
      starter: false,
      backupIds: [],
      time: timeOf(s.time),
      checklist: s.documents,
      fields: [],
      documents: [],
      proofRequired: s.proof,
      notifyCustomer: false,
    })),
  };
  const coordinator =
    (await seatPeople(db, actor.companyId, 'crm', config))[0] ??
    (await seatPeople(db, actor.companyId, 'owner', config))[0] ??
    null;
  const meta = {
    name: 'CRM — after the order',
    runName: 'Order',
    coordinatorId: coordinator,
    description: 'Made by the Sales CRM setup (After the order). Change the steps there.',
  };
  const row = await db.crmSettings.findUnique({ where: { companyId: actor.companyId } });
  let flowId = row?.afterOrderFlowId ?? null;
  if (
    flowId &&
    !(await db.flow.findFirst({
      where: { id: flowId, companyId: actor.companyId, deletedAt: null, status: { not: 'ARCHIVED' } },
    }))
  )
    flowId = null;
  if (flowId) await saveFlow(db, admin, flowId, { meta, definition });
  else {
    flowId = (await createFlow(db, admin, { ...meta, departmentIds: [], videoUrl: null }, definition)).id;
    await db.crmSettings.update({
      where: { companyId: actor.companyId },
      data: { afterOrderFlowId: flowId },
    });
  }
  await publishFlow(db, admin, flowId);
  return flowId;
}

export const pageSchema = z.object({
  page: z.enum(SETUP_PAGES),
  patch: z.record(z.string(), z.unknown()).default({}),
});

/** Save one setup page (§11.1) and mark it done. The after-order page also republishes its FMS flow. */
export async function saveSetupPage(db: Db, actor: Actor, body: z.input<typeof pageSchema>) {
  need(actor, 'crm.admin', 'Only sales admins change the CRM setup');
  const { page, patch } = pageSchema.parse(body);
  const allowed: Partial<Record<SetupPage, (keyof CrmConfig)[]>> = {
    business: ['businessType'],
    sellTo: ['sellTo'],
    seats: ['seats', 'marketingAgency'],
    split: ['split'],
    customerRules: ['customers'],
    afterOrder: ['afterOrder'],
    nbd: ['nbd'],
  };
  const keys = Object.keys(patch);
  const bad = keys.filter((k) => !(allowed[page] ?? []).includes(k as keyof CrmConfig));
  if (bad.length) throw new AppError(400, 'VALIDATION_FAILED', `This page doesn't hold: ${bad.join(', ')}`);
  if (page === 'afterOrder')
    z.array(afterOrderStepSchema)
      .min(1)
      .parse(patch.afterOrder ?? DEFAULT_AFTER_ORDER);
  const config = await saveConfig(db, actor, patch as Partial<CrmConfig>, page);
  // The seats feed the after-order doers: keep the flow in step once it exists.
  if (
    page === 'afterOrder' ||
    (page === 'seats' &&
      (await db.crmSettings.findUnique({ where: { companyId: actor.companyId } }))?.afterOrderFlowId)
  )
    await syncAfterOrderFlow(db, actor, config);
  return progress(db, actor.companyId);
}

/** Mark a page done (pages that live elsewhere: the plan's pages, holidays, weekly off, seasons, rounding). */
export async function markPage(db: Db, actor: Actor, page: SetupPage) {
  const config = await crmConfigOf(db, actor.companyId);
  if (!config.done.includes(page)) await saveConfig(db, actor, { done: [...config.done, page] }, page);
  return progress(db, actor.companyId);
}

export async function progress(db: Db, companyId: string) {
  const config = await crmConfigOf(db, companyId);
  const row = await db.crmSettings.findUnique({ where: { companyId } });
  return {
    pages: SETUP_PAGES.map((p) => ({ page: p, done: config.done.includes(p) })),
    done: SETUP_PAGES.filter((p) => config.done.includes(p)).length,
    of: SETUP_PAGES.length,
    afterOrderFlowId: row?.afterOrderFlowId ?? null,
    config: crmConfigSchema.parse(config),
  };
}

/** System Master → Sales CRM: your own fields per record type. */
export async function saveFields(db: Db, actor: Actor, fields: unknown) {
  need(actor, 'crm.admin', 'Only sales admins change the CRM fields');
  const parsed = crmConfigSchema.shape.fields.parse(fields);
  for (const list of Object.values(parsed)) {
    const keys = list.map((f) => f.key);
    if (new Set(keys).size !== keys.length)
      throw new AppError(400, 'VALIDATION_FAILED', 'Two fields have the same key');
  }
  await saveConfig(db, actor, { fields: parsed });
  return parsed;
}

/** Fields & tags: your own customer tags (name + colour). Removing one takes it off every customer. */
export async function saveTagDefs(db: Db, actor: Actor, tags: unknown) {
  need(actor, 'crm.admin', 'Only sales admins change the tags');
  const parsed = crmConfigSchema.shape.tags.parse(tags);
  const keys = parsed.map((t) => t.key);
  if (new Set(keys).size !== keys.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'Two tags have the same key');
  await saveConfig(db, actor, { tags: parsed });
  await db.customerTag.deleteMany({ where: { companyId: actor.companyId, tag: { notIn: keys } } });
  return parsed;
}
