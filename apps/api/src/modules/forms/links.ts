import type { Db, Tx } from '@mono/db';
import { checkFields, refsOf, type FlowField } from '@mono/shared';
import { lookupRefs, matchesFilter, sourceRows, type MasterOption } from '../masters/options';
import type { Actor } from '../work/actor';
import type { FormScope, FormStage, FormState } from './index';

const filled = (v: unknown) => !(v === undefined || v === null || v === '');
const same = (a: unknown, b: unknown) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const TEXTY = ['text', 'longtext', 'master', 'dropdown', 'location', 'email', 'mobile'];

/** A source row's column as the target field would hold it (cleaned by the same rules as typed values). */
function columnFor(target: FlowField, raw: unknown): unknown {
  if (!filled(raw)) return undefined;
  const v = TEXTY.includes(target.type) && typeof raw !== 'object' ? String(raw) : raw;
  const { values } = checkFields([{ ...target, required: false }], { [target.key]: v });
  return values[target.key];
}

/**
 * Linked choices (§2.2–2.3). For every "from a master" field of the form:
 * - a link that came with the value is checked: the row must exist in this company and be one the field offers
 *   (its source and, for records, its `recFilter`). A link that fails is dropped — the text stays. A link that
 *   holds makes the text the row's current name, so the two can never disagree;
 * - `filterBy` is enforced: the row's column must equal the other field's value (this form's, else the
 *   record's earlier one);
 * - `fill` targets that are `locked` are worked out here from the source row, whatever the browser sent.
 *   Unlocked targets keep what the person left in them.
 * Nothing needs writing afterwards: the links travel with the values (`_refs`).
 */
async function check(db: Db | Tx, scope: FormScope, fields: FlowField[], state: FormState) {
  const { values, refs, errors } = state;
  // The designer of the form decided what a field reads; the person saving it only needs to be in the company.
  const actor: Actor = { companyId: scope.companyId, userId: scope.actorId ?? '', permissions: [] };
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const lockedBy = new Map<string, { from: FlowField; column: string }>();
  for (const f of fields)
    if (f.type === 'master')
      for (const [target, column] of Object.entries(f.fill ?? {}))
        if (byKey.get(target)?.locked && target !== f.key) lockedBy.set(target, { from: f, column });

  const rows = new Map<string, MasterOption>();
  const settled = new Set<string>();

  const applyLock = (target: FlowField, lock: { from: FlowField; column: string }) => {
    const row = rows.get(lock.from.key);
    delete values[target.key];
    delete refs[target.key];
    delete errors[target.key];
    const v = columnFor(target, row?.columns?.[lock.column]);
    if (filled(v)) {
      values[target.key] = v;
      const link = refsOf(row?.columns)[lock.column];
      if (link && target.type === 'master') refs[target.key] = link;
    } else if (target.required) errors[target.key] = `${target.label} is required`;
  };

  const verify = async (f: FlowField) => {
    const source = f.master ?? 'customers';
    const text = values[f.key];
    if (!filled(text)) {
      delete refs[f.key];
      return;
    }
    let row: MasterOption | undefined;
    const ref = refs[f.key];
    if (ref) {
      row = (await lookupRefs(db, actor, source, [ref], { rec: f.recFilter })).get(ref);
      if (!row) delete refs[f.key];
    }
    if (f.filterBy) {
      const pk = f.filterBy.field;
      const here = byKey.has(pk);
      const parent = here ? values[pk] : scope.known?.[pk];
      const parentRef = here ? refs[pk] : refsOf(scope.known)[pk];
      if (!filled(parent)) {
        errors[f.key] = `${f.label}: choose ${byKey.get(pk)?.label ?? pk} first`;
        return;
      }
      const filter = { column: f.filterBy.column, value: String(parent), ref: parentRef };
      if (!row) {
        // Typed (or sent without its link): if the source has rows of that name, one of them must fit.
        const named = (
          await sourceRows(db, actor, source, { q: String(text), limit: 50, rec: f.recFilter }).catch(
            () => [] as MasterOption[],
          )
        ).filter((o) => same(o.value, text));
        row = named.find((o) => matchesFilter(o, filter));
        if (named.length && !row) {
          errors[f.key] = `${f.label}: "${String(text)}" does not belong to ${String(parent)}`;
          return;
        }
        if (row?.ref) refs[f.key] = row.ref;
      } else if (!matchesFilter(row, filter)) {
        errors[f.key] = `${f.label}: "${row.value}" does not belong to ${String(parent)}`;
        return;
      }
    }
    if (row?.ref) {
      values[f.key] = row.value;
      rows.set(f.key, row);
    }
  };

  /** One field, after the fields it depends on (the field that fills it, the field its choices depend on). */
  const settle = async (f: FlowField): Promise<void> => {
    if (settled.has(f.key)) return;
    settled.add(f.key);
    const lock = lockedBy.get(f.key);
    if (lock) {
      await settle(lock.from);
      applyLock(f, lock);
    }
    const parent = f.filterBy && byKey.get(f.filterBy.field);
    if (parent) await settle(parent);
    if (f.type === 'master') await verify(f);
  };
  for (const f of fields) await settle(f);
  // A link is only ever kept on a "from a master" field that still has a value.
  for (const k of Object.keys(refs))
    if (byKey.get(k)?.type !== 'master' || !filled(values[k])) delete refs[k];
}

/** Linked choices (§2.2–2.3): what was picked from a master, another flow or a record — the link is checked and kept, auto-fill and locked fields are settled on the server. */
export const linkStage: FormStage = { name: 'links', check };
