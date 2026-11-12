# Phase 11 · Package C — Formula fields (row L13, plan §2.3)

A **formula field** is a read-only field that MONO works out from the other fields: `qty × rate`, the nights
between two dates, the sum of item lines, a percentage. It is worked out **on the server** every time a form is
saved, by a small expression language that is parsed into a tree and walked — nothing is ever handed to `eval` or
`new Function`, and a formula can reach nothing but the form's values.

## What was built

| Where | What |
|---|---|
| `packages/shared/src/formula/` | The language: `tokens.ts` (tokenizer), `parse.ts` (parser → tree, `parseFormula`, `formulaFields`), `values.ts` (numbers, dates, item lines as the formula sees them), `eval.ts` (`evalFormula`), `check.ts` (`checkFormula`, `formulaGives`, `formulaCanRead`), `compute.ts` (`computeFormulas`, dependency order), `message.ts` (`formulaMessage`, plain-English sentences), `flow.ts` (`knownFieldsFor`, `formProblems`, `flowFormulaProblems`, `flowFormulaIssues`). Exported from `@mono/shared`. |
| `apps/api/src/modules/forms/formula.ts` | The `formula` stage of the form pipeline: drops whatever the browser sent for a formula field, works every formula out from `{ ...scope.known, ...state.values }` in the company time zone, and puts the results into `state.values` (no value → the key is left out). It never adds an error. |
| `packages/shared/src/fms/flow.ts` | `validateFlow` now also reports broken formulas (`code: 'formula'`, `stepKey`, `field`, `detail`). Because `publishFlow`, `getFlow` and the editor all call `validateFlow`, **publishing is refused**, the step gets its red badge and the "fix first" dialog lists it — with no edit to `fms/builder.ts`. |
| `apps/web/src/modules/fms/form/FormulaValue.tsx` | The read-only value in a form: live, from `ctx.values` + `ctx.known`, with the same shared `computeFormulas`; Indian grouping, DD/MM/YYYY. |
| `apps/web/src/modules/fms/field-extras/FormulaExtras.tsx` | The editor for a formula field: expression box, checked as it is typed (message + the place marked), chips for the form's fields, for the start form / earlier steps' fields, for signs and functions (inserted at the cursor), a worked example on sample values, and a fold-out "How to write a formula". |
| `apps/web/src/modules/fms/formula/` | `known.ts` (context of fields a step formula may read; company time zone without a request), `KnownFieldsFor.tsx`, `example.ts` (sample values + worked example), `text.ts`, `IssueText.tsx` (a formula problem in the publish dialog, translated). |
| `apps/web/src/modules/fms/show.ts` | A stored formula number is shown with Indian grouping (dates were already shown DD/MM/YYYY). |
| `apps/web/src/locales/parts/formula.en.json` / `.hi.json` | All strings (section `formula`). Hindi is machine-drafted (decision 14). |

### Shared files touched (one small edit each)
- `packages/shared/src/index.ts` — `export * from './formula';`
- `packages/shared/src/fms/flow.ts` — `FlowIssue` gets the code `'formula'` and an optional `field`; `validateFlow` adds `flowFormulaIssues(def)`.
- `apps/web/src/modules/fms/PublishProblems.tsx` — a `formula` problem is shown through `FormulaIssueText`.
- `apps/web/src/modules/fms/show.ts` — the formula number line.
- `apps/web/src/modules/fms/FlowEditor.tsx` — `<StepEditor>` is wrapped in `<KnownFieldsFor def stepKey>` so a step's formula editor knows the start form and earlier steps. The file was at exactly 400 lines, so `allFields` no longer copies `{key, label, type}` out of each field (it passes the fields themselves, which have those three properties); the file is now 399 lines.

No Prisma change, no migration, no new route, no new permission, no new event.

## The language (for the user guide)

A formula is written with **field names** (the field's key — tap a chip to add it), **numbers** and **signs**.
Spaces don't matter; capital letters don't matter.

| You write | It means | Example | Gives |
|---|---|---|---|
| `+` `−` `×` `÷` (also `-` `*` `/`) | add, take away, multiply, divide | `qty × rate` | 3 × 450 = `1350` |
| `( )` | do this part first | `(qty + free) × rate` | |
| `−x` | a minus sign in front | `-discount` | |
| `18%` | a percentage | `amount × 18%` | 18% of the amount |
| `a + 18%`, `a − 10%` | add / take off a percentage **of a** (as on a calculator) | `amount + 18%` | 1000 → `1180` |
| `date − date` | days (nights) between two dates | `checkout − checkin` | 12/11 → 15/11 = `3` |
| `date + 2`, `date − 2` | the date so many days later / earlier | `checkin + 7` | 12/11/2026 → `19/11/2026` |
| `days(later, earlier)` | nights between two dates | `days(checkout, checkin) × tariff` | |
| `hours(later, earlier)` | hours between two dates with time | `hours(left, arrived)` | |
| `sum(items)` | total amount of the item lines | `sum(lines)` | |
| `sum(items, 'qty')` | add up `'qty'`, `'rate'` or `'amount'` of the lines | `sum(lines, 'qty')` | |
| `sum(a, b, c)` | add numbers | `sum(room, food, laundry)` | |
| `count(items)` | how many item lines | `count(lines)` | |
| `round(x, places)` | round; `round(x)` = whole number, `round(x, -2)` = nearest hundred | `round(total / 3, 1)` | |
| `min(a, b, …)` / `max(a, b, …)` | smallest / largest number, or earliest / latest date | `max(balance, 0)` | |
| `if(question, a, b)` | `a` when the question is true, otherwise `b` | `if(nights > 7, 10, 0)` | |
| `<` `>` `<=` `>=` `=` `!=` (also `≤ ≥ ≠ <>`) | the questions for `if` | `if(room = 'Deluxe', 4500, 3000)` | |
| `ifblank(x, 0)` | use the second value when the field is empty | `total − ifblank(advance, 0)` | |

Rules worth knowing
- **Order**: `×` and `÷` before `+` and `−`, as in school; brackets first. `2 + 3 × 4` is 14.
- **Percent**: `18%` is 0.18. Straight after `+` or `−` it is a percentage *of what stands on its left*:
  `amount + 18%` = amount × 1.18, `amount − 10% − 5%` takes 10% off and then 5% off the rest. `amount × 18%` is
  just the 18%.
- **Empty means empty**: if a field the formula needs is empty, the formula has **no value** — it is not counted
  as 0 and the form is not refused. Use `ifblank(field, 0)` to say "empty counts as 0". Division by zero also
  gives no value.
- **Rounding**: a number is kept to **2 decimal places** unless the formula ends in `round(…)` (then exactly what
  `round` says). Halves round away from zero (2.5 → 3, 1.005 → 1.01).
- **Dates**: a date with a time is counted on the company's calendar: check-in 12/11 14:00 and check-out 14/11
  11:00 is 2 nights. `date + 1.5` on a plain date rounds to whole days; on a date with time it adds 36 hours.
- **What a formula can read**: number, amount, date, date & time, yes/no (as the question of `if`), dropdown /
  short text / "from a master" (only to compare with `=` or `!=`, text in quotes, capitals ignored), item lines
  (only inside `sum` / `count`), and other formula fields. It cannot read photos, files, signatures, long text,
  mobile, email, location or multi-select.
- **A formula gives a number or a date.** A question on its own (`qty > 10`) or text is refused — put it in `if`.
- **Formulas may read formulas** (`gst = total × 18%`, `grand = total + gst`); they are worked out in the order
  they depend on each other. Two formulas that read each other (or one that reads itself) are refused.
- **A step's formula** may read the fields of its own form, the start form, and the forms of steps that can come
  before it (following the flow's arrows — a later step, or a branch that never leads here, can't be read).
- Limits: 500 characters; brackets / functions at most 24 deep.

Examples
```
qty × rate                                   line total
days(checkout, checkin) × tariff             room charge
room_total + 12%                             with GST
sum(extras) + sum(extras) × 5%               extras with service charge
with_gst + ifblank(extras_total, 0) − ifblank(advance, 0)     balance to pay
round(amount × 18%, 0)                       tax in whole rupees
if(nights >= 7, room_total − 10%, room_total)   weekly discount
checkout + 7                                 follow-up date
max(balance, 0)                              never below zero
```

Messages people see when a formula is wrong (each also names the place in the text): e.g. `qty rate` →
"Something is missing between "qty" and "rate". Put + − × or ÷ there."; `qty × price` → "There is no field called
"price" here. Pick a field from the list."; `1,200 × 2` → "A comma only goes between the values of a function…
Write decimals with a point: 12.5"; `photo + 1` → ""Photo" can't be used in a formula…". The full list is
`FORMULA_MESSAGES` (English) and `formula.p.*` (English + Hindi); a test keeps the two English copies identical.

## Safety
- Tokenizer → recursive-descent parser → tree → evaluator. No `eval`, no `Function`, no property access syntax
  at all: `.`, `[`, `{`, `;`, backticks, `_` at the start of a name and every other character outside the
  language are refused by the tokenizer (`badChar`).
- A name is only ever looked up with `Object.hasOwn(values, name)`: `constructor`, `toString`, `process` are just
  "fields that are not there". Values that are not a plain number / date string / boolean / array of lines are
  "no value". Item lines are read with `Object.hasOwn` too.
- Input over 500 characters is refused before any work; nesting is capped at 24; evaluation is a bounded walk of
  a tree that can't be larger than the text. Non-finite results are "no value".
- The server never reads a formula field's value from the request (`checkFields` skips it, the stage deletes it,
  `computeFormulas` strips formula keys before it starts).

## Decisions taken
1. **Calculator percent** (`a + 18%` = a × 1.18). A non-programmer writing GST expects 1180, not 1000.18; the
   Excel reading would be a silent trap. `a × 18%` and a bare `18%` stay 0.18.
2. **`date − date` and `days()` count calendar days in the company time zone** (nights), also for dates with a
   time; `hours()` gives the exact hours.
3. **Missing → no value, everywhere** (also `sum` / `count` of no lines, `min` / `max` with one missing).
   `ifblank` is the one way to give an empty field a value.
4. **Extras beyond the brief**, kept from the earlier run because they make real forms work: `hours()`,
   `ifblank()`, yes/no fields as the question of `if`, text / dropdown comparison with `=` / `!=`,
   `sum(a, b, c)` of numbers, `min` / `max` of dates, `<>`, `≤ ≥ ≠`, curly quotes.
5. **Numbers compare after rounding to 9 places**, so `0.1 + 0.2 = 0.3` is true.
6. **Publish check lives in `validateFlow`** (shared), not in `builder.ts`: one line gives the same answer to the
   server (publish refused, `GET /flows/:id` issues), the editor (red badge, "n things to fix", the dialog) and
   the readiness meter. `fms/builder.ts` is unchanged.
7. **"Earlier steps" = steps from which this step can be reached** (decision branches, rejected approvals going
   back included), not "steps higher in the list".
8. **Values already on the record are read by their look** (`scope.known` carries no field types): a number is a
   number, `YYYY-MM-DD` a date, an ISO instant a date with time, an array item lines.
9. **A formula with no value never fails a form**, even on a `required` formula field (the label shows no `*`).
10. A formula's stored value: a number, `YYYY-MM-DD`, or an ISO instant — the same shapes other fields store, so
    titles, KPI cards, documents and the public API read it like any other value.

## Tests (all run and passing)
- `packages/shared/src/formula/formula.test.ts` (32) — precedence, brackets, signs, unary minus, percent,
  rounding, division by zero, missing values, typed numbers, every function, dates and date-times, formulas
  reading formulas, circles, broken formulas, friendly errors with positions, hostile input (`constructor`,
  `__proto__`, `process`, quotes, 100 000 characters, 200 brackets deep, objects posing as values).
- `packages/shared/src/formula/check.test.ts` (13) — `checkFormula` (unknown field, unusable type, itself,
  cycles, wrong kinds), `formulaGives`, what a step may read, `validateFlow` reporting formulas, old flows.
- `apps/api/src/modules/forms/formula.test.ts` (8, all `L13: …`) — qty × rate with the browser's value ignored;
  nights (dates, and date-times across the IST/UTC day line); sum / count of item lines; percentages; a step
  formula reading the start form and an earlier step; publishing refused for an unreadable formula, an unknown
  field, an unusable type, an empty formula, a circle, a later step's field — then published once mended; a
  formula broken inside an already published version leaves its field empty and the form still saves; a master
  row's formula.
- `apps/web/src/modules/fms/formula/formula.test.ts` (3, `L13: …`) — every problem / function has an English and
  a Hindi string and the English ones equal the server's; stored values shown with Indian grouping / DD/MM/YYYY;
  the worked example.
- Whole suite: 55 files, 410 passed, 5 skipped. `lint`, `typecheck`, `build` pass.
- Looked at in Chromium at 380 px and 1440 px (dev stack, demo data): the start-form formula editor (English and
  Hindi, a valid formula with its example, an error with the place marked), a step's editor with the "from the
  start form and the steps before" chips, the publish dialog with a formula problem, the start dialog working the
  values out live (`3`, `3,70,351.5`, `4,14,793.68`), and the record drawer showing the stored values. No page
  errors, no horizontal scroll.

## Left open / not verified
- **Live value inside a step dialog**: `FormulaValue` reads `ctx.known`, but `StepDialog.tsx` does not pass
  `known` to `FieldsForm` yet (package B owns that line). Until it does, a step formula that reads the start form
  shows "Worked out by itself" while the step is being filled; the server still works it out and the record
  shows it. Not something this package could fix without editing B's line.
- **Master import** (`masters/rows.ts` `importRows`) uses `checkFields` directly, not the form pipeline, so
  imported rows get no formula values (rows saved one by one do — tested). Not this package's file.
- **Masters and record types are not "published"**, so a broken formula there is only shown in the editor (live),
  not refused on save. `formProblems(fields)` is exported for whoever wants to refuse it.
- **No Playwright e2e spec** was added (the second wave owns e2e); the browser check above was done by hand with
  a script, and screenshots were not committed.
- **Documents (PDF), document titles, Telegram texts** print a formula number as a plain number (no grouping):
  "showing values anywhere" is second-wave work.
- **AI drafts** do not write formulas yet, and `ai/flows.ts` does not send formula problems back to the model
  (a draft with a broken formula would simply show it in the builder).
- The Hindi strings are machine-drafted and need GGM's review.
- In the editor every formula field shows its own chips and help; on a phone a form with many formula fields is
  long. It works at 380 px, but a "collapse when not focused" would be kinder.
