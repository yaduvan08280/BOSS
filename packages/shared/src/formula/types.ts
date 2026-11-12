/**
 * Formula fields (plan §2.3): a small expression language — numbers, dates, field names, + − × ÷ %, a few
 * functions. It is parsed into a tree and the tree is walked; nothing is ever handed to `eval` or `Function`,
 * and a formula can reach nothing but the values it is given.
 */
export const FORMULA_MAX_LENGTH = 500;
/** Brackets, functions and minus signs inside each other. */
export const FORMULA_MAX_DEPTH = 24;

export const FORMULA_FUNCTIONS = [
  'round',
  'min',
  'max',
  'days',
  'hours',
  'sum',
  'count',
  'if',
  'ifblank',
] as const;
export type FormulaFn = (typeof FORMULA_FUNCTIONS)[number];

/** How each function is written (shown in "write it like this" messages and on the editor's chips). */
export const FORMULA_USAGE: Record<FormulaFn, string> = {
  round: 'round(number, 2)',
  min: 'min(a, b)',
  max: 'max(a, b)',
  days: 'days(later, earlier)',
  hours: 'hours(later, earlier)',
  sum: 'sum(items)',
  count: 'count(items)',
  if: 'if(a > b, x, y)',
  ifblank: 'ifblank(x, 0)',
};

/** What `sum(items, '…')` can add up from item lines. */
export const SUM_COLUMNS = ['amount', 'qty', 'rate'] as const;
export type SumColumn = (typeof SUM_COLUMNS)[number];

export type MathOp = '+' | '-' | '*' | '/';
export type CompareOp = '<' | '>' | '<=' | '>=' | '=' | '!=';

type Span = { at: number; end: number };
export type FormulaNode = Span &
  (
    | { k: 'num'; v: number }
    | { k: 'str'; v: string }
    | { k: 'ref'; name: string }
    | { k: 'neg'; x: FormulaNode }
    | { k: 'pct'; x: FormulaNode }
    | { k: 'bin'; op: MathOp; l: FormulaNode; r: FormulaNode }
    | { k: 'cmp'; op: CompareOp; l: FormulaNode; r: FormulaNode }
    | { k: 'call'; fn: FormulaFn; args: FormulaNode[] }
  );

export const FORMULA_PROBLEMS = [
  // The formula can't be read.
  'empty',
  'tooLong',
  'tooDeep',
  'badChar',
  'badNumber',
  'openText',
  'missingAfter',
  'missingBefore',
  'missingBetween',
  'openBracket',
  'closeBracket',
  'emptyBrackets',
  'comma',
  'unknownFunction',
  'usage',
  'sumColumn',
  // It can be read, but not with these fields.
  'unknownField',
  'needsBrackets',
  'self',
  'cycle',
  'fieldType',
  'itemsOutside',
  'needsItems',
  'needsNumber',
  'needsDates',
  'dateMath',
  'condition',
  'compare',
  'textCompare',
  'sameKind',
  'result',
] as const;
export type FormulaProblemCode = (typeof FORMULA_PROBLEMS)[number];

/**
 * What is wrong with a formula and where (`at`…`end` are character positions in the text, end not included).
 * `name` / `other` fill the message: a symbol, a field, a function, the way to write it.
 */
export type FormulaProblem = {
  code: FormulaProblemCode;
  at: number;
  end: number;
  name?: string;
  other?: string;
};

export type ParsedFormula = { ok: true; ast: FormulaNode } | { ok: false; problem: FormulaProblem };

/** What a formula gives: a number, a date `YYYY-MM-DD`, a date-time (ISO instant) — or null, "no value". */
export type FormulaResult = number | string | null;

/** The part of a field a formula needs to know. */
export type FormulaField = { key: string; label: string; type: string; formula?: string | undefined };
