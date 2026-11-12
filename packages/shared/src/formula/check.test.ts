import { describe, expect, it } from 'vitest';
import { flowDefinitionSchema, type FlowField } from '../fms/definition';
import { validateFlow } from '../fms/flow';
import {
  checkFormula,
  flowFormulaProblems,
  formProblems,
  formulaGives,
  formulaMessage,
  knownFieldsFor,
  type FormulaField,
} from './index';

const f = (key: string, type: string, formula?: string): FormulaField => ({
  key,
  label: key.charAt(0).toUpperCase() + key.slice(1),
  type,
  ...(formula !== undefined ? { formula } : {}),
});

const fields = [
  f('qty', 'number'),
  f('rate', 'amount'),
  f('checkin', 'date'),
  f('checkout', 'date'),
  f('arrived', 'datetime'),
  f('vip', 'yesno'),
  f('room', 'dropdown'),
  f('guest', 'text'),
  f('items', 'items'),
  f('photo', 'photo'),
  f('notes', 'longtext'),
  f('tags', 'multiselect'),
  f('total', 'formula', 'qty * rate'),
  f('due', 'formula', 'checkin + 7'),
];
const code = (expr: string, self?: string) => checkFormula(expr, fields, self)?.code ?? null;

describe('checkFormula', () => {
  it('passes formulas that can work', () => {
    for (const expr of [
      'qty * rate',
      'qty × rate + 18%',
      'days(checkout, checkin) * rate',
      'checkout - checkin',
      'checkin + 2',
      'hours(arrived, checkin)',
      'sum(items)',
      "sum(items, 'qty') * 2",
      'count(items)',
      'sum(qty, rate, 5)',
      'total * 18%',
      'round(total / 3, 1)',
      'if(vip, rate - 10%, rate)',
      "if(room = 'Deluxe', 4500, 3000)",
      "if(guest != 'walk-in', 1, 0)",
      'if(checkout > checkin, qty, 0)',
      'if(arrived >= checkin, 1, 0)',
      'max(checkin, checkout)',
      'min(qty, rate, 100)',
      'ifblank(qty, 0) + 1',
      'due - checkin',
      'max(due, checkout) + 1',
    ])
      expect([expr, code(expr, 'me')]).toEqual([expr, null]);
  });

  it('says what a sound formula gives', () => {
    expect(formulaGives('qty * rate', fields)).toBe('number');
    expect(formulaGives('checkout - checkin', fields)).toBe('number');
    expect(formulaGives('checkin + 2', fields)).toBe('date');
    expect(formulaGives('arrived + 1', fields)).toBe('datetime');
    expect(formulaGives('due + 1', fields)).toBe('date');
    expect(formulaGives('if(vip, checkin, checkout)', fields)).toBe('date');
    expect(formulaGives('qty *', fields)).toBeNull();
  });

  it('a formula that can not be read', () => {
    expect(checkFormula('qty *', fields)).toMatchObject({ code: 'missingAfter', at: 4 });
    expect(code('')).toBe('empty');
  });

  it('an unknown field, with its place', () => {
    expect(checkFormula('qty * price', fields)).toEqual({
      code: 'unknownField',
      at: 6,
      end: 11,
      name: 'price',
    });
    expect(code('constructor + 1')).toBe('unknownField');
    expect(checkFormula('sum + 1', fields)).toMatchObject({
      code: 'needsBrackets',
      name: 'sum',
      other: 'sum(items)',
    });
  });

  it('a field of a type a formula can not use', () => {
    expect(checkFormula('qty + photo', fields)).toMatchObject({
      code: 'fieldType',
      name: 'Photo',
      other: 'photo',
    });
    expect(code('notes * 2')).toBe('fieldType');
    expect(code('count(tags)')).toBe('fieldType');
  });

  it('itself, and formulas that read each other', () => {
    expect(checkFormula('total + 1', fields, 'total')).toMatchObject({ code: 'self', name: 'Total' });
    const ring = [
      f('a', 'formula', 'b + 1'),
      f('b', 'formula', 'c * 2'),
      f('c', 'formula', 'a - 1'),
      f('d', 'formula', 'a'),
    ];
    expect(checkFormula('b + 1', ring, 'a')).toMatchObject({ code: 'cycle', name: 'B', at: 0, end: 1 });
    expect(checkFormula('c * 2', ring, 'b')).toMatchObject({ code: 'cycle' });
    // Not in the circle itself, but it reads one.
    expect(checkFormula('a', ring, 'd')).toMatchObject({ code: 'cycle', name: 'A' });
    expect(formProblems(ring as FlowField[]).map((p) => p.problem.code)).toEqual([
      'cycle',
      'cycle',
      'cycle',
      'cycle',
    ]);
  });

  it('a formula that reads a broken formula is not blamed for it', () => {
    const some = [f('qty', 'number'), f('bad', 'formula', 'qty * nothing'), f('good', 'formula', 'bad + 1')];
    expect(formProblems(some as FlowField[]).map((p) => [p.field, p.problem.code])).toEqual([
      ['bad', 'unknownField'],
    ]);
  });

  it('values of the wrong kind', () => {
    expect(code('guest * 2')).toBe('needsNumber');
    expect(code('vip + 1')).toBe('needsNumber');
    expect(code('-room')).toBe('needsNumber');
    expect(code('items * 2')).toBe('itemsOutside');
    expect(code('items')).toBe('itemsOutside');
    expect(code('if(vip, items, 0)')).toBe('itemsOutside');
    expect(code('count(qty)')).toBe('needsItems');
    expect(code("sum(qty, 'qty')")).toBe('needsItems');
    expect(code('sum(guest)')).toBe('needsNumber');
    expect(code('days(checkout, qty)')).toBe('needsDates');
    expect(code('hours(qty, arrived)')).toBe('needsDates');
    expect(code('checkin + checkout')).toBe('dateMath');
    expect(code('checkin * 2')).toBe('dateMath');
    expect(code('qty - checkin')).toBe('dateMath');
    expect(code('checkin + 10%')).toBe('dateMath');
    expect(code('round(checkin)')).toBe('dateMath');
    expect(code('if(qty, 1, 2)')).toBe('condition');
    expect(code('if(qty + 1, 1, 2)')).toBe('condition');
    expect(code('qty > 2')).toBe('compare');
    expect(code('(qty > 2) * 5')).toBe('compare');
    expect(code("if(guest > 'a', 1, 2)")).toBe('textCompare');
    expect(code('if(qty = guest, 1, 2)')).toBe('sameKind');
    expect(code('if(checkin > 5, 1, 2)')).toBe('sameKind');
    expect(code('if(vip, qty, checkin)')).toBe('sameKind');
    expect(code('max(qty, checkin)')).toBe('sameKind');
    expect(code('ifblank(checkin, 0)')).toBe('sameKind');
    expect(code('guest')).toBe('result');
    expect(code('vip')).toBe('result');
    expect(code("if(vip, 'yes', 'no')")).toBe('result');
  });

  it('every problem reads as a sentence with the field in it', () => {
    expect(formulaMessage(checkFormula('qty * price', fields)!)).toBe(
      'There is no field called "price" here. Pick a field from the list.',
    );
    expect(formulaMessage(checkFormula('guest * 2', fields)!)).toBe(
      '"Guest" is not a number, so it can\'t be used in a sum.',
    );
    expect(formulaMessage(checkFormula('items * 2', fields)!)).toContain('sum(items)');
  });
});

describe('formulas in a flow', () => {
  const step = (key: string, extra: Record<string, unknown> = {}) => ({
    key,
    name: key,
    type: 'TASK',
    starter: true,
    time: { value: 1, unit: 'hours', anchor: 'previous' },
    ...extra,
  });
  const num = (key: string) => ({ key, label: key, type: 'number' });
  const formula = (key: string, expr: string) => ({ key, label: key, type: 'formula', formula: expr });
  const flow = (over: Record<string, unknown> = {}) =>
    flowDefinitionSchema.parse({
      startFields: [num('qty'), num('rate'), formula('total', 'qty * rate')],
      steps: [
        step('pack', { fields: [num('boxes')] }),
        step('check', { type: 'DECISION', yes: 'ship', no: 'rework' }),
        step('rework', { fields: [num('redo')], next: 'check' }),
        step('ship', { fields: [num('freight'), formula('bill', 'total + freight + boxes * 10')] }),
      ],
      ...over,
    });

  it('a step formula may read the start form and the steps that can come before it', () => {
    const def = flow();
    expect(knownFieldsFor(def, 'ship').map((x) => x.key)).toEqual(['qty', 'rate', 'total', 'boxes', 'redo']);
    expect(knownFieldsFor(def, 'pack').map((x) => x.key)).toEqual(['qty', 'rate', 'total']);
    // "rework" loops back to "check", so its own later visit can read what "check" leads to — but not "ship".
    expect(knownFieldsFor(def, 'rework').map((x) => x.key)).toEqual(['qty', 'rate', 'total', 'boxes']);
    expect(flowFormulaProblems(def)).toEqual([]);
    expect(validateFlow(def)).toEqual([]);
  });

  it('a start formula can not read a step, nor a step one that comes after it', () => {
    const early = flow({ startFields: [num('qty'), formula('total', 'qty * freight')] });
    expect(flowFormulaProblems(early)[0]).toMatchObject({
      field: 'total',
      problem: { code: 'unknownField' },
    });
    const def = flow();
    def.steps[0]!.fields.push(formula('early', 'freight * 2') as FlowField);
    expect(flowFormulaProblems(def)).toMatchObject([
      { stepKey: 'pack', field: 'early', problem: { name: 'freight' } },
    ]);
  });

  it('publishing checks name the step, the field and the problem', () => {
    const def = flow();
    def.steps[3]!.fields.push(formula('bad', 'freight *') as FlowField, {
      key: 'blank',
      label: 'Blank',
      type: 'formula',
      required: false,
    });
    expect(validateFlow(def)).toEqual([
      { code: 'formula', stepKey: 'ship', field: 'bad', detail: 'bad: Something is missing after "×".' },
      {
        code: 'formula',
        stepKey: 'ship',
        field: 'blank',
        detail: 'Blank: Write the formula, for example: qty × rate',
      },
    ]);
    const start = flow({ startFields: [num('qty'), formula('a', 'b'), formula('b', 'a')] });
    expect(validateFlow(start).map((i) => [i.code, i.stepKey, i.field])).toEqual([
      ['formula', undefined, 'a'],
      ['formula', undefined, 'b'],
      ['formula', 'ship', 'bill'],
    ]);
  });

  it('a flow saved before formulas existed has no formula problems', () => {
    const old = flowDefinitionSchema.parse({ startFields: [num('qty')], steps: [step('only')] });
    expect(validateFlow(old)).toEqual([]);
  });
});
