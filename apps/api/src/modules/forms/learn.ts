import type { Db, Tx } from '@mono/db';
import { listKeyOf, type FlowField } from '@mono/shared';
import { recordChange } from '../../lib/events';
import { findValue, mayAddValues, normOf, offeredCount, rememberValue } from '../lists/values';
import { actorFor } from '../work/actor';
import type { FormScope, FormStage, FormState } from './index';

/** The text fields that remember what people type, with the value just entered. */
const learned = (fields: FlowField[], state: FormState) =>
  fields.flatMap((f) => {
    const v = state.values[f.key];
    return f.learn && f.type === 'text' && typeof v === 'string' && v.trim() && !state.errors[f.key]
      ? [{ field: f, value: v.trim() }]
      : [];
  });

/** May this person add to a list that is closed? The caller may say so; otherwise their role decides. */
async function mayAdd(db: Db | Tx, scope: FormScope) {
  if (scope.canAddValues === true) return true;
  if (!scope.actorId) return false;
  const actor = await actorFor(db, scope.companyId, scope.actorId);
  return !!actor && mayAddValues(actor);
}

/**
 * Remember what people type (§2.1): closed lists refuse new values; saved values are counted so the next form
 * offers them. The public form neither reads nor feeds a list: what a stranger types is kept on the record only.
 */
export const learnStage: FormStage = {
  name: 'learn',

  async check(db, scope, fields, state) {
    if (scope.publicForm) return;
    let allowed: boolean | undefined;
    for (const { field, value } of learned(fields, state)) {
      const key = listKeyOf(scope.owner, field);
      const row = await findValue(db, scope.companyId, key, value);
      if (row && !row.hidden) {
        // Already offered: keep the list's spelling ("jaipur" → "Jaipur"), so one value stays one value.
        state.values[field.key] = row.value;
        continue;
      }
      // An open list takes anything; a closed one is closed only once it has values to pick from.
      if (field.writeAllowed !== false) continue;
      if (!(await offeredCount(db, scope.companyId, key))) continue;
      allowed ??= await mayAdd(db, scope);
      if (!allowed) state.errors[field.key] = `${field.label}: pick from the list`;
    }
  },

  async commit(tx, scope, fields, state) {
    if (scope.publicForm) return;
    const entries = learned(fields, state)
      .map(({ field, value }) => ({ key: listKeyOf(scope.owner, field), value }))
      // Always in the same order, so two forms saved together never wait on each other's rows.
      .sort((a, b) => a.key.localeCompare(b.key) || normOf(a.value).localeCompare(normOf(b.value)));
    for (const { key, value } of entries) {
      const { id, inserted } = await rememberValue(tx, scope.companyId, key, value, scope.actorId);
      // A new value is a change to the list (audit + event); one more use of a known value is only counted.
      if (inserted)
        await recordChange(
          tx,
          { companyId: scope.companyId, actorId: scope.actorId },
          {
            event: 'list.value_added',
            entityType: 'value_list',
            entityId: id,
            after: { key, value },
            payload: { key, value, via: 'form' },
          },
        );
    }
  },
};
