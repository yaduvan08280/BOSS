import { z } from 'zod';

type Json = Record<string, unknown>;
const PEOPLE =
  /^(doer|verifier|user|owner|assignee|hod|head|buddy|solver|receiver|approver|raiser|coordinator|sc|steward|manager|person|handledBy|reportsTo|ea|hr|backup|next|to|from|auditor|counter|cashier|host)/i;

/**
 * A body that fits a route's schema, made from the schema alone: the smallest value of each required field.
 * Every field that names another row (`…Id`, `…Ids`) is filled from `pick`, so the walk can send ids that
 * belong to another company or branch and see whether the route notices.
 */
export function sampleBody(schema: unknown, pick: (kind: string) => string | undefined) {
  let used = false;
  let json: Json;
  try {
    json = z.toJSONSchema(schema as z.ZodType, { io: 'input', unrepresentable: 'any' }) as Json;
  } catch {
    return { body: {}, used };
  }
  const defs = (json.$defs ?? {}) as Record<string, Json>;
  const idFor = (key: string) => {
    const base = key.replace(/Ids?$/, '');
    const id = pick(PEOPLE.test(base) ? 'user' : base) ?? pick('user');
    if (id) used = true;
    return id ?? 'x';
  };
  const make = (s: Json, key = '', depth = 0): unknown => {
    if (depth > 6) return null;
    if (typeof s.$ref === 'string') return make(defs[s.$ref.split('/').at(-1)!] ?? {}, key, depth + 1);
    if ('const' in s) return s.const;
    if (Array.isArray(s.enum)) return s.enum[0];
    const options = (s.anyOf ?? s.oneOf) as Json[] | undefined;
    if (options) return make(options.find((o) => o.type !== 'null') ?? options[0]!, key, depth + 1);
    if (Array.isArray(s.allOf))
      return Object.assign({}, ...(s.allOf as Json[]).map((x) => make(x, key, depth + 1)));
    const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type;
    if (type === 'object') {
      const props = (s.properties ?? {}) as Record<string, Json>;
      const required = new Set((s.required as string[] | undefined) ?? []);
      const out: Json = {};
      for (const [k, v] of Object.entries(props))
        if (required.has(k) || /Ids?$/.test(k)) out[k] = make(v, k, depth + 1);
      return out;
    }
    if (type === 'array') return [make((s.items ?? {}) as Json, key, depth + 1)];
    if (type === 'string') {
      if (/Ids?$/.test(key) || key === 'id') return idFor(key);
      if (s.format === 'date') return new Date().toISOString().slice(0, 10);
      if (s.format === 'date-time') return new Date(Date.now() + 86_400_000).toISOString();
      if (s.format === 'email') return 'walk@example.com';
      const min = typeof s.minLength === 'number' ? s.minLength : 1;
      return 'Walk test'.padEnd(min, 'x').slice(0, typeof s.maxLength === 'number' ? s.maxLength : 200);
    }
    if (type === 'integer' || type === 'number') {
      if (typeof s.minimum === 'number') return Math.max(s.minimum, 1);
      if (typeof s.exclusiveMinimum === 'number') return s.exclusiveMinimum + 1;
      return 1;
    }
    if (type === 'boolean') return true;
    return null;
  };
  const body = make(json);
  return { body: body && typeof body === 'object' ? (body as Json) : {}, used };
}
