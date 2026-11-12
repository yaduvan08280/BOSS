import { parseFormula } from './parse';
import type { CompareOp, FormulaField, FormulaNode, FormulaResult, MathOp, SumColumn } from './types';
import { clockOf, dayOf, roundTo, shiftDays, toResult, toVal, type Val } from './values';

/** The company time zone when none is given (CLAUDE.md: default `Asia/Kolkata`). */
export const FORMULA_DEFAULT_TZ = 'Asia/Kolkata';

export type FormulaOptions = {
  /** The fields of the form: a value is read as its field's type. Values of other fields are read by their look. */
  fields?: readonly FormulaField[];
  /** Company time zone: "the day of" a date-time is the day on the company's calendar. */
  tz?: string;
};

type DateVal = { t: 'date'; day: number } | { t: 'dt'; ms: number };
const isDate = (v: Val): v is DateVal =>
  v !== null && typeof v === 'object' && (v.t === 'date' || v.t === 'dt');
const finite = (n: number): Val => (Number.isFinite(n) ? n : null);
const HOUR = 3_600_000;

function arith(op: MathOp, l: Val, r: Val): Val {
  if (l === null || r === null) return null;
  if (typeof l === 'number' && typeof r === 'number') {
    if (op === '/') return r === 0 ? null : finite(l / r);
    return finite(op === '+' ? l + r : op === '-' ? l - r : l * r);
  }
  // A date moves by days; two dates are so many days (nights) apart.
  if (op === '+' && isDate(l) && typeof r === 'number') return shiftDays(l, r);
  if (op === '+' && typeof l === 'number' && isDate(r)) return shiftDays(r, l);
  if (op === '-' && isDate(l) && typeof r === 'number') return shiftDays(l, -r);
  if (op === '-' && isDate(l) && isDate(r)) return dayOf(l) - dayOf(r);
  return null;
}

function compare(op: CompareOp, l: Val, r: Val): Val {
  if (l === null || r === null) return null;
  let d: number;
  if (typeof l === 'number' && typeof r === 'number') {
    // 0.1 + 0.2 = 0.3 must be true for the person who wrote it.
    d = Math.sign(roundTo(l, 9) - roundTo(r, 9));
  } else if (isDate(l) && isDate(r)) {
    d = Math.sign(clockOf(l) - clockOf(r));
  } else {
    const same =
      typeof l === 'boolean' && typeof r === 'boolean'
        ? l === r
        : typeof l === 'object' && typeof r === 'object' && l.t === 'text' && r.t === 'text'
          ? l.v.toLowerCase() === r.v.toLowerCase()
          : null;
    // Text and yes/no can be the same or not; one is never "more" than the other.
    if (same === null || (op !== '=' && op !== '!=')) return null;
    return op === '=' ? same : !same;
  }
  switch (op) {
    case '<':
      return d < 0;
    case '>':
      return d > 0;
    case '<=':
      return d <= 0;
    case '>=':
      return d >= 0;
    case '=':
      return d === 0;
    case '!=':
      return d !== 0;
  }
}

/** The smallest / largest of numbers, or the earliest / latest of dates. One missing value → no value. */
function extreme(vals: Val[], sign: 1 | -1): Val {
  let best: Val = null;
  for (const v of vals) {
    if (v === null) return null;
    if (best === null) {
      if (typeof v !== 'number' && !isDate(v)) return null;
      best = v;
    } else if (typeof v === 'number' && typeof best === 'number') {
      if ((v - best) * sign > 0) best = v;
    } else if (isDate(v) && isDate(best) && v.t === best.t) {
      if ((clockOf(v) - clockOf(best)) * sign > 0) best = v;
    } else return null;
  }
  return best;
}

class Evaluator {
  private readonly seen = new Map<string, Val>();
  constructor(private readonly read: (name: string) => Val) {}

  private ref(name: string): Val {
    if (!this.seen.has(name)) this.seen.set(name, this.read(name));
    return this.seen.get(name)!;
  }

  run(n: FormulaNode): Val {
    switch (n.k) {
      case 'num':
        return finite(n.v);
      case 'str':
        return n.v ? { t: 'text', v: n.v } : null;
      case 'ref':
        return this.ref(n.name);
      case 'neg': {
        const x = this.run(n.x);
        return typeof x === 'number' ? -x || 0 : null;
      }
      case 'pct': {
        const x = this.run(n.x);
        return typeof x === 'number' ? x / 100 : null;
      }
      case 'bin': {
        const l = this.run(n.l);
        // "amount + 18%" is the amount and 18% of it, as on a calculator ("amount − 10%" takes 10% off).
        if ((n.op === '+' || n.op === '-') && n.r.k === 'pct' && n.l.k !== 'pct') {
          const p = this.run(n.r.x);
          if (typeof l !== 'number' || typeof p !== 'number') return null;
          return finite(n.op === '+' ? l + (l * p) / 100 : l - (l * p) / 100);
        }
        return arith(n.op, l, this.run(n.r));
      }
      case 'cmp':
        return compare(n.op, this.run(n.l), this.run(n.r));
      case 'call':
        return this.call(n);
    }
  }

  private call(n: FormulaNode & { k: 'call' }): Val {
    const arg = (i: number) => (n.args[i] ? this.run(n.args[i]) : null);
    switch (n.fn) {
      case 'round': {
        const x = arg(0);
        const places = n.args[1] ? arg(1) : 0;
        if (typeof x !== 'number' || typeof places !== 'number') return null;
        return finite(roundTo(x, Math.max(-9, Math.min(9, Math.round(places)))));
      }
      case 'min':
        return extreme(
          n.args.map((a) => this.run(a)),
          -1,
        );
      case 'max':
        return extreme(
          n.args.map((a) => this.run(a)),
          1,
        );
      case 'days':
      case 'hours': {
        const later = arg(0);
        const earlier = arg(1);
        if (!isDate(later) || !isDate(earlier)) return null;
        return n.fn === 'days' ? dayOf(later) - dayOf(earlier) : (clockOf(later) - clockOf(earlier)) / HOUR;
      }
      case 'sum': {
        const second = n.args[1];
        const column: SumColumn = second?.k === 'str' ? (second.v as SumColumn) : 'amount';
        let total = 0;
        for (const a of second?.k === 'str' ? n.args.slice(0, 1) : n.args) {
          const v = this.run(a);
          if (typeof v === 'number') total += v;
          else if (v !== null && typeof v === 'object' && v.t === 'items')
            total += v.lines.reduce((s, line) => s + line[column], 0);
          else return null;
        }
        return finite(total);
      }
      case 'count': {
        const v = arg(0);
        return v !== null && typeof v === 'object' && v.t === 'items' ? v.lines.length : null;
      }
      case 'if': {
        const c = arg(0);
        if (typeof c !== 'boolean') return null;
        return c ? arg(1) : arg(2);
      }
      case 'ifblank':
        return arg(0) ?? arg(1);
    }
  }
}

/** Did the formula say how to round? Then its answer is kept as it is; otherwise numbers get 2 places. */
function rounded(n: FormulaNode): boolean {
  if (n.k === 'neg') return rounded(n.x);
  if (n.k !== 'call') return false;
  if (n.fn === 'round') return true;
  if (n.fn === 'if') return rounded(n.args[1]!) && rounded(n.args[2]!);
  if (n.fn === 'ifblank') return rounded(n.args[0]!) && rounded(n.args[1]!);
  return false;
}

/**
 * Work out one formula from a form's values. Never throws and never runs anything: a formula that can't be
 * read, a field left empty, a division by zero all give `null` — "no value".
 */
export function evalFormula(
  formula: string | FormulaNode,
  values: Record<string, unknown>,
  opts: FormulaOptions = {},
): FormulaResult {
  let ast: FormulaNode;
  if (typeof formula === 'string') {
    const parsed = parseFormula(formula);
    if (!parsed.ok) return null;
    ast = parsed.ast;
  } else ast = formula;
  if (!values || typeof values !== 'object') return null;
  const tz = opts.tz ?? FORMULA_DEFAULT_TZ;
  const types = new Map((opts.fields ?? []).map((f) => [f.key, f.type]));
  // Only the form's own values can be reached: never anything an object inherits (`constructor`, `toString`…).
  const read = (name: string) =>
    toVal(Object.hasOwn(values, name) ? values[name] : undefined, types.get(name), tz);
  return toResult(new Evaluator(read).run(ast), tz, rounded(ast) ? null : 2);
}
