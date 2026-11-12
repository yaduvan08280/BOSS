import type { Db, Tx } from '@mono/db';
import {
  branchDetailsSchema,
  entityDetailsSchema,
  type BranchDetails,
  type EntityDetails,
  type Licence,
} from '@mono/shared';

/**
 * Who a paper is from (phase 12, plan §3.9): the legal entity and branch it belongs to, with the address, tax
 * number and licences to print and the codes its number series use. A paper with no branch, or a branch with no
 * entity, is the company's own — exactly as before branches existed.
 */
export type Letterhead = {
  entityId: string | null;
  branchId: string | null;
  /** The name printed on top: the entity's legal name, else the company's. */
  name: string;
  address: string | null;
  phone: string | null;
  /** "GSTIN 08AAAAA0000A1Z5" (India) or "TRN 1002…" (elsewhere). */
  tax: string | null;
  taxId: string | null;
  branch: string | null;
  branchAddress: string | null;
  /** The branch's licences first, then the entity's (an outlet's FSSAI before the company's). */
  licences: Licence[];
  header: string | null;
  footer: string | null;
  entityCode: string | null;
  branchCode: string | null;
};

const read = <T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, json: unknown): T =>
  (schema.safeParse(json ?? {}).data ?? {}) as T;
/** The last four characters of an id, for a place that was given no series code. */
const tail = (id: string) => id.slice(-4).toUpperCase();

export async function letterheadOf(
  db: Db | Tx,
  companyId: string,
  branchId: string | null | undefined,
): Promise<Letterhead> {
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { name: true, legalName: true, city: true, state: true, gstin: true, mobile: true },
  });
  const branch = branchId ? await db.branch.findFirst({ where: { id: branchId, companyId } }) : null;
  const entity = branch?.entityId
    ? await db.legalEntity.findFirst({ where: { id: branch.entityId, companyId } })
    : null;
  const e = read<EntityDetails>(entityDetailsSchema, entity?.details);
  const b = read<BranchDetails>(branchDetailsSchema, branch?.details);
  const taxId = entity ? entity.taxId : company.gstin;
  return {
    entityId: entity?.id ?? null,
    branchId: branch?.id ?? null,
    name: entity ? e.legalName || entity.name : company.legalName || company.name,
    address: entity
      ? (e.address ?? entity.state ?? null)
      : [company.city, company.state].filter(Boolean).join(', ') || null,
    phone: b.phone ?? (entity ? (e.phone ?? null) : company.mobile),
    taxId: taxId ?? null,
    tax: taxId ? `${!entity || entity.country === 'IN' ? 'GSTIN' : 'TRN'} ${taxId}` : null,
    branch: branch?.name ?? null,
    branchAddress: b.address ?? ([branch?.city, branch?.state].filter(Boolean).join(', ') || null),
    licences: [...(b.licences ?? []), ...(e.licences ?? [])],
    header: e.letterheadHeader ?? null,
    footer: e.letterheadFooter ?? null,
    entityCode: entity ? (e.seriesCode ?? tail(entity.id)) : null,
    branchCode: branch ? (b.seriesCode ?? tail(branch.id)) : null,
  };
}

/**
 * The counter key and the number of a paper under a series rule. `company` keeps the old series untouched;
 * `entity` and `branch` put the place's code into the number so two series can never give the same one.
 * A paper with no such place falls back to the company's series.
 */
export function seriesOf(series: string, head: Letterhead, typeCode: string, prefix: string, fy: string) {
  const at =
    series === 'branch' && head.branchId
      ? { key: `b:${head.branchId}`, code: head.branchCode! }
      : (series === 'entity' || series === 'branch') && head.entityId
        ? { key: `e:${head.entityId}`, code: head.entityCode! }
        : null;
  return {
    counterKey: at ? `doc:${typeCode}@${at.key}` : `doc:${typeCode}`,
    number: (seq: number) => `${prefix}/${at ? `${at.code}/` : ''}${fy}/${String(seq).padStart(4, '0')}`,
  };
}
