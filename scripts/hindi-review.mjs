#!/usr/bin/env node
// The Hindi strings were machine-drafted. This makes one sheet a Hindi speaker can review, and puts the
// corrections back.
//   node scripts/hindi-review.mjs export            → docs/hindi-review.csv (key, English, Hindi, Corrected)
//   node scripts/hindi-review.mjs import [file.csv] → writes every filled "Corrected" cell into the locale files
// Open the CSV in Excel or Google Sheets, type only in the last column, save as CSV (UTF-8).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'apps/web/src/locales';
const files = [
  ['en.json', 'hi.json'],
  ...readdirSync(join(dir, 'parts'))
    .filter((f) => f.endsWith('.en.json'))
    .map((f) => [`parts/${f}`, `parts/${f.replace('.en.json', '.hi.json')}`]),
];
const flat = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj))
    if (v && typeof v === 'object') flat(v, `${prefix}${k}.`, out);
    else out[`${prefix}${k}`] = String(v);
  return out;
};
const cell = (s) => `"${String(s ?? '').replaceAll('"', '""')}"`;
const BOM = String.fromCharCode(0xfeff);
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  const endCell = () => {
    row.push(cur);
    cur = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') endCell();
    else if (c === '\n') {
      endCell();
      rows.push(row);
      row = [];
    } else if (c !== '\r') cur += c;
  }
  if (cur || row.length) {
    endCell();
    rows.push(row);
  }
  return rows;
};

const mode = process.argv[2];
if (mode === 'export') {
  const lines = [['File', 'Key', 'English', 'Hindi (now)', 'Corrected Hindi'].map(cell).join(',')];
  let n = 0;
  for (const [en, hi] of files) {
    const e = flat(JSON.parse(readFileSync(join(dir, en), 'utf8')));
    const h = flat(JSON.parse(readFileSync(join(dir, hi), 'utf8')));
    for (const key of Object.keys(e)) {
      lines.push([hi, key, e[key], h[key] ?? '', ''].map(cell).join(','));
      n++;
    }
  }
  writeFileSync('docs/hindi-review.csv', BOM + lines.join('\n') + '\n');
  console.log(`${n} strings written to docs/hindi-review.csv`);
} else if (mode === 'import') {
  const rows = parseCsv(
    readFileSync(process.argv[3] ?? 'docs/hindi-review.csv', 'utf8').replace(BOM, ''),
  ).slice(1);
  const byFile = new Map();
  for (const [file, key, , , fixed] of rows)
    if (file && key && fixed?.trim()) byFile.set(file, [...(byFile.get(file) ?? []), [key, fixed.trim()]]);
  let n = 0;
  for (const [file, fixes] of byFile) {
    const path = join(dir, file);
    const json = JSON.parse(readFileSync(path, 'utf8'));
    for (const [key, value] of fixes) {
      const parts = key.split('.');
      let at = json;
      // Keys may themselves contain dots only at the leaf level in rare cases: walk as far as objects go.
      while (parts.length > 1 && at[parts[0]] && typeof at[parts[0]] === 'object') at = at[parts.shift()];
      const leaf = parts.join('.');
      // Placeholders must survive a correction.
      const want = (
        String(flat(JSON.parse(readFileSync(path.replace('hi.json', 'en.json'), 'utf8')))[key] ?? '').match(
          /\{\{[^}]+\}\}/g,
        ) ?? []
      )
        .sort()
        .join();
      const got = (value.match(/\{\{[^}]+\}\}/g) ?? []).sort().join();
      if (want !== got) {
        console.log(`skipped ${key}: the {{placeholders}} do not match the English`);
        continue;
      }
      at[leaf] = value;
      n++;
    }
    writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
  }
  console.log(`${n} corrections written`);
} else {
  console.log('Use: node scripts/hindi-review.mjs export | import [file.csv]');
  process.exit(2);
}
