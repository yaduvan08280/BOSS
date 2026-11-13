import type { Db } from '@mono/db';
import { ME, packKey, packSchema, toTokens, token, type Pack } from '@mono/shared';
import { z } from 'zod';
import { needPackAdmin } from './install';
import type { Actor } from '../work/actor';

/**
 * Phase 20 — a company's own set-up as a pack file: its masters (definitions, and rows when asked), record
 * types, published processes, checklists, saved reports, its own roles, the tax codes (never the rates) and the
 * value lists. Ids become tokens and people become "whoever installs it", so the file installs anywhere.
 * Records, bills, stock and people are never part of a pack.
 */
export const exportSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  name: z.string().trim().min(2).max(60),
  version: z.number().int().min(1).default(1),
  industry: z.string().trim().min(2).max(40).default('own'),
  description: z.string().max(500).default(''),
  /** Master rows travel too (price lists, a standard list of tests …). Off by default: they may be private. */
  rows: z.boolean().default(false),
});

export async function exportPack(db: Db, actor: Actor, input: z.input<typeof exportSchema>): Promise<Pack> {
  needPackAdmin(actor);
  const o = exportSchema.parse(input);
  const where = { companyId: actor.companyId, deletedAt: null };
  const [masters, types, flows, checklists, reports, roles, taxes, lists, items, people, hosp, installs] =
    await Promise.all([
      db.masterDef.findMany({ where, orderBy: { createdAt: 'asc' } }),
      db.recordType.findMany({ where, orderBy: { createdAt: 'asc' } }),
      db.flow.findMany({ where: { ...where, status: 'PUBLISHED' }, orderBy: { createdAt: 'asc' } }),
      db.checklistMaster.findMany({ where, orderBy: { createdAt: 'asc' } }),
      db.report.findMany({ where, orderBy: { createdAt: 'asc' } }),
      db.role.findMany({ where, orderBy: { createdAt: 'asc' } }),
      db.taxRate.findMany({
        where: { companyId: actor.companyId },
        distinct: ['code'],
        orderBy: { code: 'asc' },
      }),
      db.valueList.findMany({
        where: { ...where, hidden: false },
        orderBy: [{ key: 'asc' }, { value: 'asc' }],
      }),
      db.item.findMany({ where, orderBy: { code: 'asc' }, take: 500 }),
      db.user.findMany({ where: { companyId: actor.companyId }, select: { id: true } }),
      db.hospSettings.findUnique({ where: { companyId: actor.companyId }, select: { enabled: true } }),
      db.packInstall.findMany({
        where: { companyId: actor.companyId, removedAt: null },
        orderBy: { installedAt: 'asc' },
      }),
    ]);
  // One key per thing, unique within its kind.
  const keys = (names: string[]) => {
    const seen = new Map<string, number>();
    return names.map((n) => {
      const k = packKey(n);
      const count = (seen.get(k) ?? 0) + 1;
      seen.set(k, count);
      return count === 1 ? k : `${k.slice(0, 36)}_${count}`;
    });
  };
  const mKeys = keys(masters.map((m) => m.name));
  const tKeys = keys(types.map((t) => t.name));
  const fKeys = keys(flows.map((f) => f.name));
  // Built-in roles travel as their own token (every company has them); only the company's own roles are in the file.
  const rKeys = roles.map((r, i, all) =>
    r.key ? `builtin_${r.key.toLowerCase()}` : keys(all.map((x) => x.name))[i]!,
  );
  const tokens = new Map<string, string>([
    ...masters.map((m, i) => [m.id, token('master', mKeys[i]!)] as [string, string]),
    ...types.map((t, i) => [t.id, token('rt', tKeys[i]!)] as [string, string]),
    ...flows.map((f, i) => [f.id, token('flow', fKeys[i]!)] as [string, string]),
    ...roles.map((r, i) => [r.id, token('role', rKeys[i]!)] as [string, string]),
  ]);
  const who = new Set(people.map((p) => p.id));
  const out = <T>(v: T) => toTokens(v, tokens, who);
  const versions = new Map(
    (
      await db.flowVersion.findMany({
        where: { id: { in: flows.map((f) => f.currentVersionId).filter((x): x is string => Boolean(x)) } },
      })
    ).map((v) => [v.id, v.definition]),
  );
  const rows = o.rows
    ? await db.masterRow.findMany({
        where: { companyId: actor.companyId, deletedAt: null, masterId: { in: masters.map((m) => m.id) } },
        take: 5000,
      })
    : [];
  const byList = new Map<string, string[]>();
  for (const l of lists) byList.set(l.key, [...(byList.get(l.key) ?? []), l.value]);
  const pack = {
    key: o.key,
    name: o.name,
    version: o.version,
    industry: o.industry,
    description: o.description,
    switches: hosp?.enabled ? { hospitality: true } : {},
    words: Object.assign({}, ...installs.map((i) => (i.words ?? {}) as object)),
    roles: roles
      .map((r, i) => ({ key: rKeys[i]!, name: r.name, permissions: r.permissions, builtIn: Boolean(r.key) }))
      .filter((r) => !r.builtIn)
      .map((r) => ({ key: r.key, name: r.name, permissions: r.permissions })),
    taxCodes: taxes.map((t) => ({ code: t.code, name: t.name })),
    lists: [...byList].map(([key, values]) => ({ key, values: values.slice(0, 200) })),
    masters: masters.map((m, i) => ({
      key: mKeys[i]!,
      name: m.name,
      description: m.description,
      fields: out(m.fields) as Record<string, unknown>[],
      keyField: m.keyField,
      displayField: m.displayField,
      rows: rows
        .filter((r) => r.masterId === m.id)
        .slice(0, 500)
        .map((r) => out(r.data) as Record<string, unknown>),
    })),
    items: items.map((i) => ({
      code: i.code,
      name: i.name,
      unit: i.unit,
      category: i.category,
      extras: Object.fromEntries(
        Object.entries({
          tracking: i.tracking,
          made: i.made,
          units: i.units,
          purchaseUnit: i.purchaseUnit,
          secondUnit: i.secondUnit,
          pricedBy: i.pricedBy,
          barcode: i.barcode,
          brand: i.brand,
          hsn: i.hsn,
          taxCode: i.taxCode,
          sellPrice: i.sellPrice == null ? null : Number(i.sellPrice),
          rateKey: i.rateKey,
          rateFactor: i.rateFactor == null ? null : Number(i.rateFactor),
          shelfLifeDays: i.shelfLifeDays,
        }).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length)),
      ),
    })),
    recordTypes: types.map((t, i) => ({
      key: tKeys[i]!,
      name: t.name,
      pluralName: t.pluralName,
      prefix: t.prefix,
      description: t.description,
      definition: out(t.definition) as Record<string, unknown>,
      icon: ((t.menu ?? {}) as { icon?: string }).icon ?? 'file-text',
      permissions: out(t.permissions) as Record<string, unknown>,
    })),
    flows: flows.map((f, i) => ({
      key: fKeys[i]!,
      name: f.name,
      runName: f.runName,
      description: f.description,
      definition: out(versions.get(f.currentVersionId ?? '') ?? f.draft) as Record<string, unknown>,
      publish: true,
    })),
    checklists: checklists.map((c, i) => ({
      key: `${packKey(c.name).slice(0, 34)}_${i + 1}`,
      name: c.name,
      input: {
        items: c.items,
        frequency: c.frequency,
        dueTime: `${String(Math.floor(c.dueMin / 60)).padStart(2, '0')}:${String(c.dueMin % 60).padStart(2, '0')}`,
        windowHours: c.windowHours,
        doerIds: [ME],
        skipHolidays: c.skipHolidays,
        startDate: c.startDate,
        active: c.active,
      } as Record<string, unknown>,
    })),
    reports: reports.map((r, i) => ({
      key: `${packKey(r.name).slice(0, 34)}_${i + 1}`,
      name: r.name,
      definition: out(r.definition) as Record<string, unknown>,
    })),
  };
  // What is exported must be something install can read.
  return packSchema.parse(pack);
}
