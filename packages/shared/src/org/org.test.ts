import { describe, expect, it } from 'vitest';
import { checkGstin, gstinCheckDigit } from './gst';
import { parsePeopleList } from './people';

describe('GSTIN', () => {
  it('accepts a valid GSTIN and extracts PAN and state', () => {
    const first14 = '08AAACG1234A1Z';
    const gstin = first14 + gstinCheckDigit(first14);
    const r = checkGstin(gstin.toLowerCase());
    expect(r).toMatchObject({ valid: true, pan: 'AAACG1234A', stateCode: '08', stateName: 'Rajasthan' });
  });
  it('matches the published sample 27AAPFU0939F1ZV', () => {
    expect(checkGstin('27AAPFU0939F1ZV').valid).toBe(true);
  });
  it('rejects wrong format, state and checksum', () => {
    expect(checkGstin('ABC')).toMatchObject({ valid: false, reason: 'format' });
    expect(checkGstin('00AAPFU0939F1ZV')).toMatchObject({ valid: false, reason: 'state' });
    expect(checkGstin('27AAPFU0939F1ZA')).toMatchObject({ valid: false, reason: 'checksum' });
  });
});

describe('parsePeopleList', () => {
  it('reads tab-separated rows pasted from Excel', () => {
    const rows = parsePeopleList(
      'Sandeep Pal\t98290 12345\tsandeep@x.in\tMaintenance\tFitter\nRavi Kumar\t9829012346',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: 'Sandeep Pal',
      mobile: '+919829012345',
      email: 'sandeep@x.in',
      department: 'Maintenance',
      designation: 'Fitter',
      errors: [],
    });
    expect(rows[1]).toMatchObject({ name: 'Ravi Kumar', email: null, department: null });
  });
  it('uses a header row to map columns in any order', () => {
    const rows = parsePeopleList('Department,Name,Phone\nIT,"Pal, Sandeep",9829012345');
    expect(rows).toEqual([
      expect.objectContaining({ line: 2, name: 'Pal, Sandeep', department: 'IT', mobile: '+919829012345' }),
    ]);
  });
  it('flags missing names, bad numbers and duplicates', () => {
    const rows = parsePeopleList(',12\nA,9829012345\nB,9829012345,bad-email');
    expect(rows[0]!.errors).toEqual(['Name is missing', '"12" is not a valid mobile number']);
    expect(rows[2]!.errors).toContain('Same mobile as line 2');
    expect(rows[2]!.errors).toContain('"bad-email" is not a valid email');
  });
});
