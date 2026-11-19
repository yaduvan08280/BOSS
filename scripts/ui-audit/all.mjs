#!/usr/bin/env node
// Runs the audit at every screen size (and once each for dark, Hindi, larger text, compact rows and the folded
// menu); `--navy` runs the Navy & Gold look instead, at every size in light and dark;
// then prints one line per run and a total. Flags after the script's name are passed on (--base, --label …).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SIZES = [
  '360x740',
  '390x844',
  '430x932', // phones
  '768x1024',
  '1024x768', // tablets
  '853x533',
  '1024x640',
  '1280x800', // a 13" laptop at 150 %, 125 % and 100 %
  '1440x900',
  '1536x864',
  '1728x1117', // 14–16" laptops (1536 is also a 24" at 125 %)
  '1280x1024',
  '1920x1080',
  '2560x1440', // 19", 21–24" and 27" monitors
];
/** The sizes that also get the deep crawl (dialogs, drawers, dropdowns). */
export const KEY_SIZES = ['390x844', '1024x768', '1440x900', '2560x1440'];
const VARIANTS = [
  ['dark', '390x844'],
  ['dark', '1440x900'],
  ['hindi', '390x844'],
  ['hindi', '1440x900'],
  ['large', '390x844'],
  ['compact', '390x844'],
  ['compact', '1440x900'],
  ['collapsed', '1440x900'],
];

const audit = fileURLToPath(new URL('./audit.mjs', import.meta.url));
const pass = process.argv.slice(2);
const deep = pass.includes('--deep-key');
const navy = pass.includes('--navy');
const rest = pass.filter((a) => a !== '--deep-key' && a !== '--navy');
let failed = 0;
const run = (extra) => {
  const r = spawnSync(process.execPath, [audit, ...rest, ...extra], { encoding: 'utf8' });
  const line =
    (r.stdout.trim().split('\n').at(-1) ?? '') || r.stderr.trim().split('\n').slice(0, 3).join(' ');
  console.log(line);
  const m = / — (\d+) problems/.exec(line);
  failed += m ? Number(m[1]) : 1;
};
if (navy) {
  for (const look of ['navy', 'navy+dark'])
    for (const size of SIZES) run(['--size', size, '--variant', look]);
} else {
  for (const size of SIZES) run(['--size', size, ...(deep && KEY_SIZES.includes(size) ? ['--deep'] : [])]);
  for (const [variant, size] of VARIANTS) run(['--size', size, '--variant', variant]);
}
console.log(`TOTAL problems: ${failed}`);
process.exit(failed ? 1 : 0);
