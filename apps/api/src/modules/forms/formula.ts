import { computeFormulas } from '@mono/shared';
import type { FormStage } from './index';

/**
 * Formula fields (§2.3): worked out on the server from the form's values and what is already on the record
 * (the start form, earlier steps) — never taken from the browser. A formula with no value (an input is missing,
 * a division by zero, a formula that can't be read) leaves its field out: that is the builder's problem, and the
 * person filling the form is not stopped by it.
 */
export const formulaStage: FormStage = {
  name: 'formula',
  async check(db, scope, fields, state) {
    const formulas = fields.filter((f) => f.type === 'formula');
    if (!formulas.length) return;
    for (const f of formulas) {
      delete state.values[f.key];
      delete state.refs[f.key];
    }
    // Dates with a time are counted on the company's calendar ("nights" are its nights, not UTC's).
    const company = await db.company.findUnique({
      where: { id: scope.companyId },
      select: { timezone: true },
    });
    Object.assign(
      state.values,
      computeFormulas(fields, { ...scope.known, ...state.values }, company ? { tz: company.timezone } : {}),
    );
  },
};
