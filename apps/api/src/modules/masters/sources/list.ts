import { offeredValues } from '../../lists/values';
import type { SourceHandler } from './index';

/**
 * `list:<key>` — the values of a "remember what people type" list, most used first. `<key>` is the stored list
 * key as `listKeyOf` gives it: `list:flow:<flowId>:<field>` for a field's own list, `list:list:<name>` for a named
 * one. Only the person's own company is read; hidden and merged values are never offered.
 */
export const listSource: SourceHandler = async (db, actor, key, { q, limit }) =>
  (await offeredValues(db, actor.companyId, key, q, limit)).map((v) => ({
    value: v.value,
    label: v.value,
    sub: null,
  }));
