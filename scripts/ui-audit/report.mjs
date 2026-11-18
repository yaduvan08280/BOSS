import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Listed, not counted as failures: a table scrolling inside its own card, a refusal for a screen that is not
 * this person's, a record that is gone, and a dropdown that says it has nothing to offer.
 */
export const LISTED = new Set(['table-scrolls', 'no-access', 'gone', 'dropdown-no-data']);

/** Reads a run's states and writes report.md beside them; returns a one-line summary. */
export function writeReport(dir, meta) {
  const rows = readFileSync(join(dir, 'states.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const states = rows.filter((r) => !r.end);
  const paths = new Set(rows.filter((r) => r.end).map((r) => r.path));
  const count = {
    screens: paths.size,
    states: states.filter((r) => !r.dropdown).length,
    tabs: states.filter((r) => r.state?.startsWith('tab ') && !r.state.includes('»') && !r.dropdown).length,
    dialogs: states.filter((r) => r.dialog).length,
    fields: states.reduce((n, r) => n + (r.fields ?? 0), 0),
    dropdowns: states.filter((r) => r.dropdown).length,
    options: states.reduce((n, r) => n + (r.options ?? 0), 0),
  };
  const byKind = new Map();
  for (const r of rows)
    for (const p of r.problems ?? []) {
      if (!byKind.has(p.kind)) byKind.set(p.kind, []);
      byKind.get(p.kind).push(`${r.path} — ${r.state}: ${p.detail}`);
    }
  const failures = [...byKind].filter(([k]) => !LISTED.has(k)).reduce((n, [, v]) => n + v.length, 0);
  const lines = [
    `# UI audit — ${meta.label} at ${meta.size}${meta.variant ? ` (${meta.variant})` : ''}${meta.deep ? ', deep' : ''}`,
    '',
    `Screens ${count.screens} · states ${count.states} · tabs ${count.tabs} · dialogs ${count.dialogs} · fields ${count.fields} · dropdowns ${count.dropdowns} (${count.options} options)`,
    '',
    `**Problems: ${failures}**${byKind.has('table-scrolls') ? ` · tables that scroll sideways (listed): ${byKind.get('table-scrolls').length}` : ''}`,
    '',
  ];
  for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${kind} (${list.length})`, '');
    for (const l of [...new Set(list)].slice(0, 200)) lines.push(`- ${l}`);
    lines.push('');
  }
  writeFileSync(join(dir, 'report.md'), lines.join('\n'));
  writeFileSync(
    join(dir, 'summary.json'),
    JSON.stringify({
      ...meta,
      count,
      failures,
      kinds: Object.fromEntries([...byKind].map(([k, v]) => [k, v.length])),
    }),
  );
  return `${count.screens} screens, ${count.states} states, ${count.dialogs} dialogs, ${count.fields} fields, ${count.dropdowns} dropdowns — ${failures} problems (${[...byKind].map(([k, v]) => `${k} ${v.length}`).join(', ') || 'none'})`;
}
