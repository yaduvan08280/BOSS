import { describe, expect, it } from 'vitest';
import { FORMULA_FUNCTIONS, FORMULA_MESSAGES, FORMULA_PROBLEMS, type FlowField } from '@mono/shared';
import en from '../../../locales/parts/formula.en.json';
import hi from '../../../locales/parts/formula.hi.json';
import { showValue } from '../show';
import { sampleValues, workedExample } from './example';

const f = (key: string, type: string, formula?: string): FlowField =>
  ({ key, label: key, type, required: false, ...(formula ? { formula } : {}) }) as FlowField;
const yesNo: [string, string] = ['Yes', 'No'];

describe('formula screens', () => {
  it('L13: every formula problem has an English and a Hindi sentence, the English one as the server says it', () => {
    for (const code of FORMULA_PROBLEMS) {
      expect(en.formula.p[code], code).toBe(FORMULA_MESSAGES[code].replace(/\{(\w+)\}/g, '{{$1}}'));
      expect(hi.formula.p[code].length, code).toBeGreaterThan(5);
    }
    expect(Object.keys(en.formula.p).sort()).toEqual([...FORMULA_PROBLEMS].sort());
    for (const fn of FORMULA_FUNCTIONS) {
      expect(en.formula.fn[fn], fn).toContain(`${fn}(`);
      expect(hi.formula.fn[fn], fn).toContain(`${fn}(`);
    }
    expect(Object.keys(en.formula.fn).sort()).toEqual([...FORMULA_FUNCTIONS].sort());
  });

  it('L13: a stored formula value is shown with Indian grouping, or as a DD/MM/YYYY date', () => {
    const total = f('total', 'formula', 'qty * rate');
    expect(showValue(total, 1234567.5, 'Asia/Kolkata', yesNo)).toBe('12,34,567.5');
    expect(showValue(total, 3.3333, 'Asia/Kolkata', yesNo)).toBe('3.3333');
    expect(showValue(total, 0, 'Asia/Kolkata', yesNo)).toBe('0');
    expect(showValue(total, '2026-11-22', 'Asia/Kolkata', yesNo)).toBe('22/11/2026');
    expect(showValue(total, '2026-11-13T08:30:00.000Z', 'Asia/Kolkata', yesNo)).toBe('13/11/2026 14:00');
    expect(showValue(total, undefined, 'Asia/Kolkata', yesNo)).toBeNull();
  });

  it('L13: the editor shows a worked example on believable values', () => {
    const fields = [
      f('qty', 'number'),
      f('rate', 'amount'),
      f('checkin', 'date'),
      f('checkout', 'date'),
      f('lines', 'items'),
      f('total', 'formula', 'qty × rate'),
      f('nights', 'formula', 'checkout − checkin'),
      f('bill', 'formula', 'total + sum(lines) + 18%'),
    ];
    expect(sampleValues(fields, 'Asia/Kolkata', 'Sample')).toMatchObject({
      qty: 3,
      rate: 1200,
      checkin: '2026-11-12',
      checkout: '2026-11-14',
    });
    const total = workedExample(fields[5]!, fields, 'Asia/Kolkata', 'Sample');
    expect(total.result).toBe(3600);
    expect(total.inputs.map((i) => [i.field.key, i.value])).toEqual([
      ['qty', 3],
      ['rate', 1200],
    ]);
    expect(workedExample(fields[6]!, fields, 'Asia/Kolkata', 'Sample').result).toBe(2);
    // A formula that reads another formula shows that one's worked-out value.
    const bill = workedExample(fields[7]!, fields, 'Asia/Kolkata', 'Sample');
    expect(bill.inputs[0]).toMatchObject({ field: { key: 'total' }, value: 3600 });
    expect(bill.result).toBe(4696.4);
    // A step formula reading the start form: the scope holds both.
    const step = [f('freight', 'amount'), f('grand', 'formula', 'total + freight')];
    expect(workedExample(step[1]!, [...fields, ...step], 'Asia/Kolkata', 'Sample').result).toBe(4050);
  });
});
