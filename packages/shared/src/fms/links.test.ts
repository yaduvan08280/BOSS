import { describe, expect, it } from 'vitest';
import { checkFields } from './fields';
import { fieldSchema, flowDefinitionSchema } from './definition';
import { listKeyOf, makeRef, mergeData, parseRef, parseSource, plainValues, refsOf, withRef } from './links';

describe('linked field helpers', () => {
  it('keeps a link beside the text and drops it when the value is typed again', () => {
    const picked = withRef({ customer: 'Sharma Traders' }, 'customer', makeRef('customer', 'c1'));
    expect(picked).toEqual({ customer: 'Sharma Traders', _refs: { customer: 'customer:c1' } });
    expect(refsOf(picked)).toEqual({ customer: 'customer:c1' });
    expect(plainValues(picked)).toEqual({ customer: 'Sharma Traders' });
    expect(withRef({ ...picked, customer: 'Typed by hand' }, 'customer', null)).toEqual({
      customer: 'Typed by hand',
    });
  });

  it('reads old text-only data as data with no links', () => {
    expect(refsOf({ customer: 'Old value' })).toEqual({});
    expect(refsOf(null)).toEqual({});
    expect(refsOf({ _refs: ['not', 'a', 'map'] })).toEqual({});
  });

  it('merges step data without losing earlier links, and forgets links of fields that are gone', () => {
    const start = { customer: 'A', _refs: { customer: 'customer:c1' } };
    const step = { item: 'Resin', _refs: { item: 'item:i1', ghost: 'row:x' } };
    expect(mergeData(start, step)).toEqual({
      customer: 'A',
      item: 'Resin',
      _refs: { customer: 'customer:c1', item: 'item:i1' },
    });
    expect(mergeData({ a: 1 }, null, undefined)).toEqual({ a: 1 });
  });

  it('parses refs and sources', () => {
    expect(parseRef('rec:abc')).toEqual({ kind: 'rec', id: 'abc' });
    expect(parseRef('nonsense')).toBeNull();
    expect(parseRef('spaceship:1')).toBeNull();
    expect(parseSource('customers')).toEqual({ kind: 'customers' });
    expect(parseSource('m:m1')).toEqual({ kind: 'master', id: 'm1' });
    expect(parseSource('fms:f1:vendor_name')).toEqual({ kind: 'fms', flowId: 'f1', field: 'vendor_name' });
    expect(parseSource('rec:f1')).toEqual({ kind: 'rec', flowId: 'f1' });
    expect(parseSource('rt:t1')).toEqual({ kind: 'rt', id: 't1' });
    expect(parseSource('fms:f1')).toBeNull();
    expect(parseSource(undefined)).toBeNull();
  });

  it("names a value list: the field's own, or a shared named one", () => {
    expect(listKeyOf({ kind: 'flow', id: 'f1' }, { key: 'vendor' })).toBe('flow:f1:vendor');
    expect(listKeyOf({ kind: 'flow', id: 'f1' }, { key: 'vendor', list: 'vendors' })).toBe('list:vendors');
  });
});

describe('field schema (phase 11 settings)', () => {
  it('reads a field saved before phase 11 exactly as it was', () => {
    const old = { key: 'customer', label: 'Customer', type: 'master', required: true, master: 'customers' };
    expect(fieldSchema.parse(old)).toEqual(old);
    expect(flowDefinitionSchema.parse({ startFields: [old] }).startFields[0]).toEqual(old);
  });

  it('never takes a formula value from the form, and keeps a picked item on a line', () => {
    const fields = [
      fieldSchema.parse({
        key: 'total',
        label: 'Total',
        type: 'formula',
        formula: 'qty * rate',
        required: true,
      }),
      fieldSchema.parse({ key: 'lines', label: 'Items', type: 'items' }),
    ];
    const { values, errors } = checkFields(fields, {
      total: 999,
      lines: [{ item: 'Resin', qty: 2, rate: 10, itemId: 'i1', unit: 'kg' }],
    });
    expect(errors).toEqual({});
    expect(values).toEqual({
      lines: [{ item: 'Resin', qty: 2, rate: 10, amount: 20, itemId: 'i1', unit: 'kg' }],
    });
  });
});
