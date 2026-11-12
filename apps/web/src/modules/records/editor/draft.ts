import {
  checkRecordDefinition,
  defaultRecordDefinition,
  EVERYONE,
  recordDefinitionSchema,
  type RecordDefinition,
  type RecordMenu,
  type RecordPermissions,
} from '@mono/shared';
import type { RecordTypeView } from '../api';

/** A record type while it is being edited (nothing is saved until Save). */
export type Draft = {
  name: string;
  pluralName: string;
  prefix: string;
  description: string;
  definition: RecordDefinition;
  menu: RecordMenu;
  /** Left out on a new type until the Permissions tab is touched: the server then sets the defaults. */
  permissions?: RecordPermissions;
};
export type TabProps = { draft: Draft; set: (patch: Partial<Draft>) => void };

export const blankDraft = (): Draft => ({
  name: '',
  pluralName: '',
  prefix: '',
  description: '',
  definition: defaultRecordDefinition(),
  menu: { section: 'masters', icon: 'file-text' },
});

export const draftOf = (t: RecordTypeView): Draft => ({
  name: t.name,
  pluralName: t.pluralName,
  prefix: t.prefix,
  description: t.description ?? '',
  definition: t.definition,
  menu: t.menu,
  permissions: t.permissions,
});

/** Everyone views, makes and edits; heads of department approve — what the server gives a new type. */
export const defaultPermissions = (hodRoleId?: string): RecordPermissions => ({
  view: [EVERYONE],
  create: [EVERYONE],
  edit: [EVERYONE],
  approve: hodRoleId ? [hodRoleId] : [],
});

export const PREFIX_OK = /^[A-Z][A-Z0-9]{0,7}$/;

/** "Site visit" → "SV"; "Prescription" → "PRE". */
export function suggestPrefix(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  const p = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 3);
  return /^[A-Z]/.test(p) ? p.slice(0, 8) : '';
}

/**
 * What still has to be fixed before the type can be saved, as sentences. The same checks run again on the
 * server (shared `checkRecordDefinition`), so the screen and the API never disagree.
 */
export function problemsOf(d: Draft, words: { name: string; plural: string; prefix: string; shape: string }) {
  const out: string[] = [];
  if (d.name.trim().length < 2) out.push(words.name);
  if (d.pluralName.trim().length < 2) out.push(words.plural);
  if (!PREFIX_OK.test(d.prefix)) out.push(words.prefix);
  const shape = recordDefinitionSchema.safeParse(d.definition);
  if (!shape.success) {
    // A label left empty, too many fields … named by where it is.
    for (const issue of shape.error.issues.slice(0, 5))
      out.push(`${words.shape} ${whereOf(d.definition, issue.path)}: ${issue.message}`);
    return out;
  }
  return [...out, ...checkRecordDefinition(shape.data)];
}

/** "fields → 3rd" in words a person can find on the screen. */
function whereOf(def: RecordDefinition, path: PropertyKey[]): string {
  const [group, index] = path;
  const at = typeof index === 'number' ? index : -1;
  if (group === 'fields') return `“${def.fields[at]?.label || `field ${at + 1}`}”`;
  if (group === 'tables') return `“${def.tables[at]?.label || `table ${at + 1}`}”`;
  if (group === 'statuses') return `“${def.statuses[at]?.label || `status ${at + 1}`}”`;
  if (group === 'moves') return `“${def.moves[at]?.label || `move ${at + 1}`}”`;
  return String(group ?? '');
}
