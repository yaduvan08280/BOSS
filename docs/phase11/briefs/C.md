# Package C — Formulas (row L13, plan §2.3 "Formula fields")

Plug into: `packages/shared/src/fms/definition.ts` (type `formula`, setting `formula`), `fms/fields.ts`
(`checkFields` skips formula fields; item lines are `{ item, qty, rate, amount }`),
`apps/api/src/modules/forms/index.ts` (`scope.known` = values already on the record), your stub
`forms/formula.ts`, `fms/builder.ts` (publish checks); web `fms/form/FormulaValue.tsx`,
`fms/field-extras/FormulaExtras.tsx` (your stubs), `fms/show.ts`, `fms/PublishProblems.tsx`.

Build:
- **A small safe expression language** in `packages/shared/src/formula/` (pure, exported from
  `packages/shared/src/index.ts`). Never `eval` / `new Function`; no property access on real objects; nothing
  reachable but the values passed in; input size and depth limits.
  - Tokenizer + parser → AST → evaluator. Values: numbers, dates (`date` and `datetime` fields). Field refs by key.
  - `+ − × ÷` (also `*`, `/`, Unicode minus), unary minus, parentheses, `%` as percent (`amount * 18%`), documented.
  - `round(x, places?)`, `min`, `max`, `days(later, earlier)` (nights), `sum(itemsField)` (amounts),
    `sum(itemsField, 'qty')`, `count(itemsField)`, and `if(cond, a, b)` with `< > <= >= = !=` if clean.
    date + number = date shifted by days; date − date = days.
  - Result: number (2 places unless `round` says otherwise) or date. Missing input → no value (not 0, not an
    error). Division by zero → no value.
  - `parseFormula` (friendly error with position, for a non-programmer), `formulaFields` (keys read),
    `checkFormula(expr, fields)` (unknown field, unusable type, itself, cycles), `evalFormula`,
    `computeFormulas(fields, values)` (dependency order; formulas may read formulas).
- **Stage** `forms/formula.ts` `check`: compute every formula field from `{ ...scope.known, ...state.values }`
  into `state.values` (no value → key left out). The browser's value is never used. An unparsable formula is the
  builder's problem, not the user's: leave the field empty, do not fail the form.
- **Publishing**: `fms/builder.ts` refuses a flow with a broken formula (invalid, unknown field, cycle), shown in
  `fms/PublishProblems.tsx`; minimal edits. A step formula may read start-form fields and earlier steps' fields.
- **Web**: `FormulaValue.tsx` read-only, live from `ctx.values` + `ctx.known` with the same shared function,
  Indian number grouping / DD/MM/YYYY. `FormulaExtras.tsx` (formula fields only): expression box, chips to insert
  the form's other fields and the functions, checked as typed, a worked example. `fms/show.ts` shows a stored
  formula value properly.
- Strings: `locales/parts/formula.en.json` / `formula.hi.json`.

Tests: `packages/shared/src/formula/formula.test.ts` (precedence, parentheses, unary minus, percent, every
function, dates, missing values, division by zero, rounding, formula-reads-formula, cycles, friendly errors,
hostile inputs: `constructor`, `__proto__`, `process`, very long / deeply nested input, quotes) and
`apps/api/src/modules/forms/formula.test.ts` `L13: …` (qty × rate; nights; sum of item lines; a percentage; the
browser's value ignored; a step formula reads a start-form field; publishing a broken formula is refused).
`docs/phase11/C-formulas.md` must include the language reference with examples (it goes into the user guide).
