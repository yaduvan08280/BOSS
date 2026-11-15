import { describe, expect, it } from 'vitest';
import {
  bookingSchema,
  branchRulesSchema,
  crmConfigSchema,
  hospRulesSchema,
  hotelRulesSchema,
  hrRulesSchema,
  imsRulesSchema,
  PROCESSES,
} from '@mono/shared';
import en from '../../../locales/parts/flows.en.json';
import hi from '../../../locales/parts/flows.hi.json';
import { fieldKey, getAt, PROCESS_SETUP, setAt, SETUP_ELSEWHERE, type SourceId } from './setup-fields';

const SCHEMA: Record<SourceId, unknown> = {
  hr: hrRulesSchema,
  ims: imsRulesSchema,
  crm: crmConfigSchema,
  hosp: hospRulesSchema,
  hotel: hotelRulesSchema,
  branch: branchRulesSchema,
  booking: bookingSchema,
};
type Z = {
  shape?: Record<string, Z>;
  _def?: { innerType?: Z; valueType?: Z };
  parse: (x: unknown) => unknown;
};
/** Through .default() / .optional() / .nullish() to the object or the value underneath. */
const inner = (s: Z | undefined): Z | undefined =>
  s?.shape ? s : s?._def?.innerType ? inner(s._def.innerType) : s;
const schemaAt = (s: Z, path: string) =>
  path.split('.').reduce<Z | undefined>((x, k) => {
    const i = inner(x);
    return i?.shape ? i.shape[k] : i?._def?.valueType; // a record (CRM seats): any key
  }, s);

describe('Set up panel of every process (decision 239)', () => {
  it('covers every process that is not an engine module', () => {
    const plain = PROCESSES.filter((p) => !('engine' in p)).map((p) => p.key);
    for (const key of plain) expect(Boolean(PROCESS_SETUP[key] || SETUP_ELSEWHERE[key]), key).toBe(true);
    for (const key of Object.keys(PROCESS_SETUP)) expect(plain, key).toContain(key);
  });

  it('points every field at a rule that exists, of the right kind', () => {
    for (const [process, def] of Object.entries(PROCESS_SETUP)) {
      const schema = SCHEMA[def.src] as Z;
      const defaults = schema.parse({});
      for (const f of def.fields) {
        const where = `${process}: ${def.src}.${f.path}`;
        expect(schemaAt(schema, f.path), where).toBeDefined();
        const v = getAt(defaults, f.path);
        if (f.kind === 'person') expect(v ?? null, where).toBeNull();
        else if (f.kind === 'toggle') expect(typeof v, where).toBe('boolean');
        else if (f.kind === 'select') expect(f.options, where).toContain(v);
        else if (['people', 'lines', 'stageDays'].includes(f.kind))
          expect(Array.isArray(v ?? []), where).toBe(true); // a seat nobody holds yet is left out
        else expect(typeof v, where).toBe('number');
      }
    }
  });

  it('has every label in English and Hindi', () => {
    for (const lang of [en, hi]) {
      const f = lang.flows as unknown as {
        f: Record<string, string>;
        o: Record<string, Record<string, string>>;
      };
      for (const def of Object.values(PROCESS_SETUP))
        for (const field of def.fields) {
          const k = fieldKey(def.src, field.path);
          expect(f.f[k], k).toBeTruthy();
          if (field.kind === 'select')
            for (const o of field.options) expect(f.o[k]?.[o], `${k}.${o}`).toBeTruthy();
        }
    }
  });

  it('reads and writes a rule by its path', () => {
    const rules = { buddy: { noBuddy: 'warn', maxCover: 3 }, holdMin: 15 };
    const next = setAt(rules, 'buddy.noBuddy', 'off');
    expect(next).toEqual({ buddy: { noBuddy: 'off', maxCover: 3 }, holdMin: 15 });
    expect(rules.buddy.noBuddy).toBe('warn');
    expect(getAt(next, 'buddy.noBuddy')).toBe('off');
    expect(getAt(next, 'missing.deep')).toBeUndefined();
  });
});
