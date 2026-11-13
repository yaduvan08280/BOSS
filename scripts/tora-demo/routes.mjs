// node routes.mjs <tag> [pathFilter] [--body]  — list routes of a tag with compact request-body shapes
import fs from 'node:fs';
const o = JSON.parse(fs.readFileSync(new URL('./openapi.json', import.meta.url)));
const [tag, filt = '', flag] = process.argv.slice(2);
const short = (s, d = 0) => {
  if (!s || d > 3) return '?';
  if (s.$ref) return s.$ref.split('/').pop();
  if (s.anyOf || s.oneOf) return (s.anyOf || s.oneOf).map((x) => short(x, d)).join('|');
  if (s.enum) return s.enum.join('|');
  if (s.type === 'array') return `[${short(s.items, d + 1)}]`;
  if (s.type === 'object' || s.properties) {
    const req = new Set(s.required || []);
    return '{' + Object.entries(s.properties || {}).map(([k, v]) => `${k}${req.has(k) ? '' : '?'}:${short(v, d + 1)}`).join(', ') + '}';
  }
  return s.type || '?';
};
for (const [p, m] of Object.entries(o.paths)) for (const [v, d] of Object.entries(m)) {
  if (tag !== '*' && !(d.tags || []).includes(tag)) continue;
  if (filt && !p.includes(filt)) continue;
  const b = d.requestBody?.content?.['application/json']?.schema;
  console.log(v.toUpperCase().padEnd(6), p, flag === '--body' && b ? '\n       ' + short(b) : '');
}
