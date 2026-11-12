import { formulaFields, parseFormula } from './parse';
import { fail, FormulaSyntaxError } from './tokens';
import {
  FORMULA_FUNCTIONS,
  FORMULA_USAGE,
  type FormulaField,
  type FormulaFn,
  type FormulaNode,
  type FormulaProblem,
} from './types';
import { fieldKind, type Kind } from './values';

/** What an expression gives, as far as the fields tell. `any` = can't be told (it reads a formula that is itself broken). */
type K = Kind | 'any';
const isDate = (k: K) => k === 'date' || k === 'dt';
const isFn = (name: string): name is FormulaFn => (FORMULA_FUNCTIONS as readonly string[]).includes(name);
/** Values of one group can be compared with each other. */
const group = (k: Kind) => (k === 'dt' ? 'date' : k);

/** Does formula field `from` read `target`, directly or through other formulas? */
function reaches(byKey: Map<string, FormulaField>, from: string, target: string): boolean {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const f = byKey.get(queue.pop()!);
    if (!f || f.type !== 'formula' || seen.has(f.key)) continue;
    seen.add(f.key);
    for (const dep of formulaFields(f.formula ?? '')) {
      if (dep === target) return true;
      queue.push(dep);
    }
  }
  return false;
}

/** Walks a formula's tree with the fields' types and stops at the first thing that can't work. */
class Checker {
  constructor(
    private readonly text: string,
    private readonly byKey: Map<string, FormulaField>,
    private readonly self: string | undefined,
    private readonly memo: Map<string, K>,
  ) {}

  private src(n: FormulaNode): string {
    return this.text.slice(n.at, n.end);
  }
  private label(n: FormulaNode): string {
    return n.k === 'ref' ? (this.byKey.get(n.name)?.label ?? n.name) : this.src(n);
  }

  /** The whole formula must give a number or a date. */
  top(ast: FormulaNode): K {
    const k = this.kind(ast);
    if (k === 'items') fail('itemsOutside', ast.at, ast.end, ast.k === 'ref' ? ast.name : 'items');
    if (k === 'bool') fail(ast.k === 'cmp' ? 'compare' : 'result', ast.at, ast.end, 'yesno');
    if (k === 'text') fail('result', ast.at, ast.end, 'text');
    return k;
  }

  private ref(n: FormulaNode & { k: 'ref' }): K {
    const f = this.byKey.get(n.name);
    if (n.name === this.self) fail('self', n.at, n.end, f?.label ?? n.name);
    if (!f) {
      if (isFn(n.name)) fail('needsBrackets', n.at, n.end, n.name, FORMULA_USAGE[n.name]);
      return fail('unknownField', n.at, n.end, n.name);
    }
    if (f.type !== 'formula') return fieldKind(f.type) ?? fail('fieldType', n.at, n.end, f.label, f.type);
    if (
      (this.self !== undefined && reaches(this.byKey, f.key, this.self)) ||
      reaches(this.byKey, f.key, f.key)
    )
      fail('cycle', n.at, n.end, f.label);
    // What the other formula gives. If it is broken, that is its own problem, not this one's.
    if (!this.memo.has(f.key)) {
      let k: K = 'any';
      const parsed = parseFormula(f.formula ?? '');
      if (parsed.ok) {
        try {
          k = new Checker(f.formula!, this.byKey, f.key, this.memo).top(parsed.ast);
        } catch (e) {
          if (!(e instanceof FormulaSyntaxError)) throw e;
        }
      }
      this.memo.set(f.key, k);
    }
    return this.memo.get(f.key)!;
  }

  /** A value for + − × ÷: a number or a date. */
  private operand(n: FormulaNode): 'num' | 'date' | 'dt' | 'any' {
    const k = this.kind(n);
    if (k === 'items') fail('itemsOutside', n.at, n.end, n.k === 'ref' ? n.name : 'items');
    if (k === 'bool' && n.k === 'cmp') fail('compare', n.at, n.end);
    if (k === 'bool' || k === 'text') fail('needsNumber', n.at, n.end, this.label(n));
    return k as 'num' | 'date' | 'dt' | 'any';
  }

  private num(n: FormulaNode): void {
    if (isDate(this.operand(n))) fail('dateMath', n.at, n.end);
  }

  private kind(n: FormulaNode): K {
    switch (n.k) {
      case 'num':
        return 'num';
      case 'str':
        return 'text';
      case 'ref':
        return this.ref(n);
      case 'neg':
      case 'pct':
        this.num(n.x);
        return 'num';
      case 'bin':
        return this.math(n);
      case 'cmp': {
        const l = this.kind(n.l);
        const r = this.kind(n.r);
        for (const [k, side] of [
          [l, n.l],
          [r, n.r],
        ] as const)
          if (k === 'items') fail('itemsOutside', side.at, side.end, side.k === 'ref' ? side.name : 'items');
        if (l !== 'any' && r !== 'any') {
          if (group(l) !== group(r)) fail('sameKind', n.at, n.end, this.label(n.l), this.label(n.r));
          if ((l === 'text' || l === 'bool') && n.op !== '=' && n.op !== '!=')
            fail('textCompare', n.at, n.end);
        }
        return 'bool';
      }
      case 'call':
        return this.call(n);
    }
  }

  private math(n: FormulaNode & { k: 'bin' }): K {
    if ((n.op === '+' || n.op === '-') && n.r.k === 'pct' && n.l.k !== 'pct') {
      // amount + 18%: the percent is of the amount.
      this.num(n.l);
      this.num(n.r.x);
      return 'num';
    }
    const l = this.operand(n.l);
    const r = this.operand(n.r);
    if (n.op === '*' || n.op === '/') {
      if (isDate(l) || isDate(r)) fail('dateMath', n.at, n.end);
      return 'num';
    }
    if (n.op === '+') {
      if (isDate(l) && isDate(r)) fail('dateMath', n.at, n.end);
      if (isDate(l)) return l;
      if (isDate(r)) return r;
      return l === 'num' && r === 'num' ? 'num' : 'any';
    }
    if (isDate(l)) return isDate(r) ? 'num' : r === 'num' ? l : 'any';
    if (isDate(r)) {
      if (l === 'num') fail('dateMath', n.at, n.end);
      return 'num';
    }
    return l === 'num' ? 'num' : 'any';
  }

  /** Two values that stand for each other (`if`'s answers, `ifblank`, `min` / `max`): the same kind. */
  private alike(nodes: FormulaNode[], kinds: K[]): K {
    let found: K = 'any';
    kinds.forEach((k, i) => {
      if (k === 'any') return;
      if (found !== 'any' && found !== k)
        fail('sameKind', nodes[0]!.at, nodes[i]!.end, this.label(nodes[0]!), this.label(nodes[i]!));
      if (found === 'any') found = k;
    });
    return found;
  }

  private call(n: FormulaNode & { k: 'call' }): K {
    const args = n.args;
    switch (n.fn) {
      case 'round':
        args.forEach((a) => this.num(a));
        return 'num';
      case 'min':
      case 'max':
        return this.alike(
          args,
          args.map((a) => this.operand(a)),
        );
      case 'days':
      case 'hours':
        for (const a of args)
          if (!['date', 'dt', 'any'].includes(this.kind(a)))
            fail('needsDates', a.at, a.end, n.fn, FORMULA_USAGE[n.fn]);
        return 'num';
      case 'sum': {
        const lines = args[1]?.k === 'str';
        for (const a of lines ? args.slice(0, 1) : args) {
          const k = this.kind(a);
          if (lines && k !== 'items' && k !== 'any') fail('needsItems', a.at, a.end, n.fn);
          if (k !== 'items') this.num(a);
        }
        return 'num';
      }
      case 'count': {
        const k = this.kind(args[0]!);
        if (k !== 'items' && k !== 'any') fail('needsItems', args[0]!.at, args[0]!.end, n.fn);
        return 'num';
      }
      case 'if': {
        const c = this.kind(args[0]!);
        if (c !== 'bool' && c !== 'any') fail('condition', args[0]!.at, args[0]!.end);
        return this.answers(args.slice(1));
      }
      case 'ifblank':
        return this.answers(args);
    }
  }

  private answers(nodes: FormulaNode[]): K {
    const kinds = nodes.map((a) => {
      const k = this.kind(a);
      if (k === 'items') fail('itemsOutside', a.at, a.end, a.k === 'ref' ? a.name : 'items');
      return k;
    });
    return this.alike(nodes, kinds);
  }
}

function inspect(
  expr: string,
  fields: readonly FormulaField[],
  self: string | undefined,
): { problem: FormulaProblem } | { kind: K } {
  const parsed = parseFormula(expr);
  if (!parsed.ok) return { problem: parsed.problem };
  // A later field with the same key wins: pass the form's own fields last.
  const byKey = new Map(fields.map((f) => [f.key, f]));
  try {
    return { kind: new Checker(expr, byKey, self, new Map()).top(parsed.ast) };
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return { problem: e.problem };
    throw e;
  }
}

/**
 * Can this formula work with these fields? Gives the first problem — it can't be read, a field it names doesn't
 * exist or can't be used (a photo, a file…), it reads itself, or two formulas read each other — or null.
 * `fields` are all fields the formula may read; `self` is the key of the field the formula belongs to.
 */
export function checkFormula(
  expr: string,
  fields: readonly FormulaField[],
  self?: string,
): FormulaProblem | null {
  const out = inspect(expr, fields, self);
  return 'problem' in out ? out.problem : null;
}

/** What a sound formula gives: a number, a date or a date with time (null: broken, or it can't be told). */
export function formulaGives(
  expr: string,
  fields: readonly FormulaField[],
  self?: string,
): 'number' | 'date' | 'datetime' | null {
  const out = inspect(expr, fields, self);
  if ('problem' in out) return null;
  return out.kind === 'num' ? 'number' : out.kind === 'date' ? 'date' : out.kind === 'dt' ? 'datetime' : null;
}
