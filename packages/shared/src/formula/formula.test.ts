import { describe, expect, it } from 'vitest';
import {
  computeFormulas,
  evalFormula,
  formulaFields,
  formulaMessage,
  parseFormula,
  FORMULA_MAX_LENGTH,
  FORMULA_MESSAGES,
  FORMULA_PROBLEMS,
  type FormulaField,
} from './index';

const field = (key: string, type: string, formula?: string): FormulaField => ({
  key,
  label: key,
  type,
  ...(formula !== undefined ? { formula } : {}),
});
const run = (expr: string, values: Record<string, unknown> = {}, fields?: FormulaField[]) =>
  evalFormula(expr, values, { ...(fields ? { fields } : {}), tz: 'Asia/Kolkata' });
const problem = (expr: string) => {
  const p = parseFormula(expr);
  if (p.ok) throw new Error(`"${expr}" should not parse`);
  return p.problem;
};

describe('formula: arithmetic', () => {
  it('multiplies and divides before it adds and takes away', () => {
    expect(run('2 + 3 * 4')).toBe(14);
    expect(run('20 - 12 / 4')).toBe(17);
    expect(run('10 - 4 - 3')).toBe(3);
    expect(run('100 / 5 / 2')).toBe(10);
  });

  it('brackets come first', () => {
    expect(run('(2 + 3) * 4')).toBe(20);
    expect(run('((2 + 3) * (4 - 1)) / 5')).toBe(3);
  });

  it('reads the signs people type: × ÷ − and the dash word processors put in', () => {
    expect(run('6 × 7')).toBe(42);
    expect(run('42 ÷ 6')).toBe(7);
    expect(run('10 − 4')).toBe(6);
    expect(run('10 – 4')).toBe(6);
    expect(run('qty × rate', { qty: 3, rate: 450.5 })).toBe(1351.5);
  });

  it('a minus sign in front of a value', () => {
    expect(run('-5 + 8')).toBe(3);
    expect(run('4 * -2')).toBe(-8);
    expect(run('-(2 + 3)')).toBe(-5);
    expect(run('--5')).toBe(5);
    expect(run('-qty', { qty: 4 })).toBe(-4);
    expect(run('0 * -1')).toBe(0);
  });

  it('% is a percentage: × takes that share, + and − add it or take it off', () => {
    expect(run('amount * 18%', { amount: 1000 })).toBe(180);
    expect(run('18% * amount', { amount: 1000 })).toBe(180);
    expect(run('amount + 18%', { amount: 1000 })).toBe(1180);
    expect(run('amount - 10%', { amount: 1000 })).toBe(900);
    expect(run('amount * (100% - disc%)', { amount: 2000, disc: 25 })).toBe(1500);
    expect(run('50%')).toBe(0.5);
    expect(run('50% + 50%')).toBe(1);
  });

  it('a number has two places unless round says otherwise', () => {
    expect(run('10 / 3')).toBe(3.33);
    expect(run('2 / 3')).toBe(0.67);
    expect(run('1.005 * 1')).toBe(1.01);
    expect(run('0.1 + 0.2')).toBe(0.3);
    expect(run('round(10 / 3)')).toBe(3);
    expect(run('round(10 / 3, 4)')).toBe(3.3333);
    expect(run('round(2.5)')).toBe(3);
    expect(run('round(-2.5)')).toBe(-3);
    expect(run('round(1234, -2)')).toBe(1200);
    expect(run('round(1.005, 2)')).toBe(1.01);
    expect(run('if(1 > 0, round(10 / 3, 3), round(1, 3))')).toBe(3.333);
  });

  it('division by zero gives no value', () => {
    expect(run('10 / 0')).toBeNull();
    expect(run('amount / qty', { amount: 100, qty: 0 })).toBeNull();
    expect(run('1 + 10 / (2 - 2)')).toBeNull();
  });

  it('a missing value gives no value — not 0 and not an error', () => {
    expect(run('qty * rate', { qty: 3 })).toBeNull();
    expect(run('qty * rate', { qty: 3, rate: '' })).toBeNull();
    expect(run('qty * rate', { qty: 3, rate: null })).toBeNull();
    expect(run('qty + 0', {})).toBeNull();
    expect(run('ifblank(discount, 0) + 100', {})).toBe(100);
    expect(run('ifblank(discount, 0) + 100', { discount: 20 })).toBe(120);
  });

  it('reads numbers the way they are typed in a form', () => {
    const fields = [field('qty', 'number'), field('rate', 'amount')];
    expect(run('qty * rate', { qty: '3', rate: '1,200.50' }, fields)).toBe(3601.5);
    expect(run('qty * rate', { qty: '3', rate: '₹ 450' }, fields)).toBe(1350);
    expect(run('qty * rate', { qty: 'three', rate: 450 }, fields)).toBeNull();
    // A text field is text even when digits are typed in it.
    expect(run('code * 2', { code: '12' }, [field('code', 'text')])).toBeNull();
  });

  it('field names are not case sensitive', () => {
    expect(run('Qty * RATE', { qty: 2, rate: 5 })).toBe(10);
  });
});

describe('formula: functions', () => {
  it('min and max, of numbers or of dates', () => {
    expect(run('min(4, 2, 9)')).toBe(2);
    expect(run('max(4, 2, 9)')).toBe(9);
    expect(run('max(a, 0)', { a: -5 })).toBe(0);
    expect(run('min(a, b)', { a: 5 })).toBeNull();
    expect(run('max(a, b)', { a: '2026-11-12', b: '2026-12-01' })).toBe('2026-12-01');
    expect(run('min(a, b)', { a: '2026-11-12', b: '2026-12-01' })).toBe('2026-11-12');
  });

  it('sum and count of item lines', () => {
    const items = [
      { item: 'Tea', qty: 2, rate: 40, amount: 80 },
      { item: 'Thali', qty: 3, rate: 250.5, amount: 751.5 },
    ];
    expect(run('sum(items)', { items })).toBe(831.5);
    expect(run("sum(items, 'qty')", { items })).toBe(5);
    expect(run('sum(items, "rate")', { items })).toBe(290.5);
    expect(run("sum(items, 'amount')", { items })).toBe(831.5);
    expect(run('count(items)', { items })).toBe(2);
    expect(run('sum(items) + sum(items) * 5%', { items })).toBe(873.08);
    expect(run('sum(a, b, 10)', { a: 1, b: 2 })).toBe(13);
    expect(run('sum(items)', {})).toBeNull();
    expect(run('sum(items)', { items: [] })).toBeNull();
  });

  it('item lines still being typed: the amount is qty × rate', () => {
    const items = [
      { item: 'Tea', qty: '2', rate: '40' },
      { item: '', qty: '', rate: '' },
    ];
    expect(run('sum(items)', { items }, [field('items', 'items')])).toBe(80);
    expect(run('count(items)', { items }, [field('items', 'items')])).toBe(1);
  });

  it('if chooses between two values', () => {
    expect(run('if(qty > 10, 5, 0)', { qty: 12 })).toBe(5);
    expect(run('if(qty > 10, 5, 0)', { qty: 10 })).toBe(0);
    expect(run('if(qty >= 10, 5, 0)', { qty: 10 })).toBe(5);
    expect(run('if(qty ≤ 10, 5, 0)', { qty: 10 })).toBe(5);
    expect(run('if(qty != 10, 5, 0)', { qty: 10 })).toBe(0);
    expect(run('if(qty <> 10, 5, 0)', { qty: 11 })).toBe(5);
    expect(run('if(0.1 + 0.2 = 0.3, 1, 0)')).toBe(1);
    expect(run("if(room = 'Deluxe', 4500, 3000)", { room: 'deluxe ' })).toBe(4500);
    expect(run("if(room = 'Deluxe', 4500, 3000)", { room: 'Standard' })).toBe(3000);
    expect(run('if(vip, 10, 0)', { vip: true })).toBe(10);
    expect(run('if(vip, 10, 0)', { vip: false })).toBe(0);
    // The question can't be answered: no value.
    expect(run('if(qty > 10, 5, 0)', {})).toBeNull();
    expect(run('if(out > inn, 1, 0)', { out: '2026-11-14', inn: '2026-11-12' })).toBe(1);
  });
});

describe('formula: dates', () => {
  const stay = { checkin: '2026-11-12', checkout: '2026-11-15' };

  it('date − date and days() count the nights', () => {
    expect(run('checkout - checkin', stay)).toBe(3);
    expect(run('days(checkout, checkin)', stay)).toBe(3);
    expect(run('days(checkin, checkout)', stay)).toBe(-3);
    expect(run('days(checkout, checkin) * rate', { ...stay, rate: 2500 })).toBe(7500);
    expect(run('days(checkout, checkin)', { checkin: '2026-11-12' })).toBeNull();
    // Across a month end and a leap day.
    expect(run('b - a', { a: '2028-02-27', b: '2028-03-01' })).toBe(3);
  });

  it('date + number is the date so many days later', () => {
    expect(run('checkin + 2', stay)).toBe('2026-11-14');
    expect(run('2 + checkin', stay)).toBe('2026-11-14');
    expect(run('checkin - 12', stay)).toBe('2026-10-31');
    expect(run('checkin + nights', { ...stay, nights: 20 })).toBe('2026-12-02');
  });

  it('dates with a time: nights are counted on the company calendar', () => {
    // 12/11 14:00 IST → 14/11 11:00 IST is two nights, though less than 48 hours.
    const v = { inn: '2026-11-12T08:30:00.000Z', out: '2026-11-14T05:30:00.000Z' };
    expect(run('days(out, inn)', v)).toBe(2);
    expect(run('out - inn', v)).toBe(2);
    expect(run('hours(out, inn)', v)).toBe(45);
    // 23:30 IST on the 12th is still the 12th in India (it is 18:00 UTC).
    expect(run('days(out, inn)', { inn: '2026-11-12T18:00:00.000Z', out: '2026-11-13T18:00:00.000Z' })).toBe(
      1,
    );
    expect(run('days(out, inn)', { inn: '2026-11-12T18:00:00.000Z', out: '2026-11-12T19:00:00.000Z' })).toBe(
      1,
    );
    // As typed in the form (company clock, no zone) it gives the same answer.
    const fields = [field('inn', 'datetime'), field('out', 'datetime')];
    expect(run('days(out, inn)', { inn: '2026-11-12T14:00', out: '2026-11-14T11:00' }, fields)).toBe(2);
    expect(run('inn + 1', { inn: '2026-11-12T14:00' }, fields)).toBe('2026-11-13T08:30:00.000Z');
    expect(run('inn + 1', { inn: '2026-11-12T08:30:00.000Z' }, fields)).toBe('2026-11-13T08:30:00.000Z');
  });

  it('a date that is not a real date is no value', () => {
    expect(run('d + 1', { d: '2026-02-31' }, [field('d', 'date')])).toBeNull();
    expect(run('d + 1', { d: 'tomorrow' }, [field('d', 'date')])).toBeNull();
    expect(run('a * b', stay)).toBeNull();
    expect(run('checkin + checkout', stay)).toBeNull();
  });
});

describe('formula: formulas that read formulas', () => {
  const fields = [
    field('qty', 'number'),
    field('rate', 'amount'),
    field('grand', 'formula', 'total + gst'),
    field('gst', 'formula', 'total * 18%'),
    field('total', 'formula', 'qty * rate'),
  ];

  it('works them out in the order they depend on each other', () => {
    expect(computeFormulas(fields, { qty: 2, rate: 500 })).toEqual({ total: 1000, gst: 180, grand: 1180 });
  });

  it('never reads a value sent for a formula field', () => {
    expect(computeFormulas(fields, { qty: 2, rate: 500, total: 1, gst: 999999, grand: 5 })).toEqual({
      total: 1000,
      gst: 180,
      grand: 1180,
    });
    expect(computeFormulas(fields, { total: 700, gst: 126, grand: 826 })).toEqual({});
  });

  it('leaves out what has no value', () => {
    expect(computeFormulas(fields, { qty: 2 })).toEqual({});
    expect(computeFormulas([...fields, field('fixed', 'formula', '2 + 2')], {})).toEqual({ fixed: 4 });
  });

  it('formulas in a circle have no value, and nothing hangs', () => {
    const circle = [
      field('a', 'formula', 'b + 1'),
      field('b', 'formula', 'ifblank(c, 0) + 1'),
      field('c', 'formula', 'ifblank(a, 0) + 1'),
      field('me', 'formula', 'me + 1'),
      field('ok', 'formula', '1 + 1'),
      field('after', 'formula', 'ifblank(a, 5) + ok'),
    ];
    expect(computeFormulas(circle, {})).toEqual({ ok: 2, after: 7 });
  });

  it('a broken formula is left empty and the others still work', () => {
    const some = [
      field('bad', 'formula', 'qty * * 2'),
      field('none', 'formula'),
      field('good', 'formula', 'qty * 2'),
    ];
    expect(computeFormulas(some, { qty: 4 })).toEqual({ good: 8 });
  });

  it('reads what is already on the record (start form, earlier steps) by its look', () => {
    const step = [
      field('nights', 'formula', 'days(checkout, checkin)'),
      field('bill', 'formula', 'nights * tariff'),
    ];
    const known = { checkin: '2026-11-12', checkout: '2026-11-15T05:30:00.000Z', tariff: 3200 };
    expect(computeFormulas(step, known, { tz: 'Asia/Kolkata' })).toEqual({ nights: 3, bill: 9600 });
  });

  it('formulaFields lists the fields a formula reads', () => {
    expect(formulaFields('qty * rate + sum(items) - qty')).toEqual(['qty', 'rate', 'items']);
    expect(formulaFields('2 +')).toEqual([]);
  });
});

describe('formula: friendly errors', () => {
  it('says what is wrong and where', () => {
    expect(problem('')).toMatchObject({ code: 'empty' });
    expect(problem('   ')).toMatchObject({ code: 'empty' });
    expect(problem('qty *')).toMatchObject({ code: 'missingAfter', name: '×', at: 4, end: 5 });
    expect(problem('* qty')).toMatchObject({ code: 'missingBefore', name: '×', at: 0 });
    expect(problem('qty rate')).toMatchObject({ code: 'missingBetween', name: 'qty', other: 'rate' });
    expect(problem('2 (3)')).toMatchObject({ code: 'missingBetween' });
    expect(problem('(qty + 2')).toMatchObject({ code: 'openBracket', at: 0, end: 1 });
    expect(problem('qty + 2)')).toMatchObject({ code: 'closeBracket', at: 7 });
    expect(problem('qty + ()')).toMatchObject({ code: 'emptyBrackets' });
    expect(problem('1,200 * 2')).toMatchObject({ code: 'comma', at: 1 });
    expect(problem('1.2.3')).toMatchObject({ code: 'badNumber', name: '1.2.3' });
    expect(problem('qty # 2')).toMatchObject({ code: 'badChar', name: '#', at: 4, end: 5 });
    expect(problem('qty * $rate')).toMatchObject({ code: 'badChar', name: '$' });
    expect(problem("sum(items, 'qty")).toMatchObject({ code: 'openText' });
    expect(problem('total(items)')).toMatchObject({ code: 'unknownFunction', name: 'total' });
    expect(problem('days(a)')).toMatchObject({ code: 'usage', name: 'days', other: 'days(later, earlier)' });
    expect(problem('if(a > b, 1)')).toMatchObject({ code: 'usage', name: 'if' });
    expect(problem("sum(items, 'price')")).toMatchObject({ code: 'sumColumn', name: 'price' });
    expect(problem('count(2 + 2)')).toMatchObject({ code: 'needsItems' });
  });

  it('has a plain sentence for every problem', () => {
    for (const code of FORMULA_PROBLEMS) expect(FORMULA_MESSAGES[code].length).toBeGreaterThan(10);
    expect(formulaMessage(problem('qty rate'))).toBe(
      'Something is missing between "qty" and "rate". Put + − × or ÷ there.',
    );
    expect(formulaMessage(problem('qty *'))).toBe('Something is missing after "×".');
    expect(formulaMessage(problem('total(items)'))).toContain('no function called "total"');
  });
});

describe('formula: hostile input', () => {
  const secret = { qty: 2 };

  it('can reach nothing but the values it is given', () => {
    // Names an object inherits are just fields that are not there.
    for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'prototype', 'process'])
      expect(run(`${name} + 1`, secret)).toBeNull();
    expect(run('constructor', secret)).toBeNull();
    expect(run('constructor(1)', secret)).toBeNull();
    expect(problem('constructor(1)')).toMatchObject({ code: 'unknownFunction' });
    expect(problem('process.exit(1)')).toMatchObject({ code: 'badChar', name: '.' });
    expect(problem('qty.constructor')).toMatchObject({ code: 'badChar', name: '.' });
    expect(problem('__proto__')).toMatchObject({ code: 'badChar', name: '_' });
    expect(problem('qty[0]')).toMatchObject({ code: 'badChar', name: '[' });
    expect(problem('a; b')).toMatchObject({ code: 'badChar', name: ';' });
    expect(problem('{}')).toMatchObject({ code: 'badChar' });
    expect(problem('`x`')).toMatchObject({ code: 'badChar' });
    expect(problem('a => a')).toMatchObject({ code: 'missingAfter' });
    expect(problem('1e9')).toMatchObject({ code: 'missingBetween' });
    expect(problem('qty\\u0041')).toMatchObject({ code: 'badChar' });
    expect(problem('😀 + 1')).toMatchObject({ code: 'badChar', name: '😀', at: 0, end: 2 });
  });

  it('a value named like something inherited is read as a plain value, and pollutes nothing', () => {
    const values = JSON.parse('{"constructor": 5, "__proto__": {"polluted": 1}, "tostring": 2}') as Record<
      string,
      unknown
    >;
    expect(run('constructor + tostring', values)).toBe(7);
    expect(computeFormulas([field('x', 'formula', 'constructor * 2')], values)).toEqual({ x: 10 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('values that are not what they claim are no value', () => {
    const odd = { toString: () => '5', valueOf: () => 5 };
    expect(run('a + 1', { a: odd })).toBeNull();
    expect(run('a + 1', { a: { t: 'date', day: 1 } })).toBeNull();
    expect(run('a + 1', { a: NaN })).toBeNull();
    expect(run('a + 1', { a: Infinity })).toBeNull();
    expect(run('sum(a)', { a: [null, 5, 'x', { qty: 'y' }, { qty: 2, rate: 3, amount: {} }] })).toBe(6);
    expect(run('a * 9', { a: 1e308 })).toBeNull();
    expect(run('a + 1', null as unknown as Record<string, unknown>)).toBeNull();
  });

  it('quotes are only ever text, in any style', () => {
    expect(run("if(a = 'x', 1, 2)", { a: 'x' })).toBe(1);
    expect(run('if(a = “x”, 1, 2)', { a: 'x' })).toBe(1);
    expect(run("if(a = ‘it's’, 1, 2)", { a: 'it' })).toBeNull();
    expect(run("'1' + 1")).toBeNull();
    expect(run("'qty'", secret)).toBeNull();
    expect(run("if(a = 'constructor', 1, 2)", { a: 'b' })).toBe(2);
    // A whole "injection" inside quotes is one piece of text; outside them its characters are refused.
    expect(run("'); process.exit(1); ('")).toBeNull();
    expect(problem("1 + ''); process.exit(1); ('")).toMatchObject({ code: 'badChar' });
    expect(problem("1 + '); process.exit(1)")).toMatchObject({ code: 'openText' });
  });

  it('refuses very long and very deep input without working on it', () => {
    expect(problem('1+'.repeat(400) + '1')).toMatchObject({ code: 'tooLong', at: FORMULA_MAX_LENGTH });
    expect(problem('9'.repeat(100_000))).toMatchObject({ code: 'tooLong' });
    expect(problem('('.repeat(200) + '1' + ')'.repeat(200))).toMatchObject({ code: 'tooDeep' });
    expect(problem('-'.repeat(300) + '1')).toMatchObject({ code: 'tooDeep' });
    expect(problem('round('.repeat(60) + '1' + ')'.repeat(60))).toMatchObject({ code: 'tooDeep' });
    expect(problem(42 as unknown as string)).toMatchObject({ code: 'empty' });
    // As long and as deep as allowed still works.
    expect(run('1+'.repeat(249) + '1')).toBe(250);
    expect(run('('.repeat(20) + '7' + ')'.repeat(20))).toBe(7);
    expect(run('5' + '%'.repeat(400))).toBe(0);
    expect(run('9'.repeat(400) + ' * 9')).toBeNull();
  });
});
