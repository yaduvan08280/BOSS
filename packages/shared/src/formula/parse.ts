import { fail, FormulaSyntaxError, shown, tokenize, type Token } from './tokens';
import {
  FORMULA_FUNCTIONS,
  FORMULA_MAX_DEPTH,
  FORMULA_USAGE,
  SUM_COLUMNS,
  type CompareOp,
  type FormulaFn,
  type FormulaNode,
  type MathOp,
  type ParsedFormula,
  type SumColumn,
} from './types';

const COMPARE = new Set<string>(['<', '>', '<=', '>=', '=', '!=']);
/** How many values each function takes: [at least, at most]. */
const ARGS: Record<FormulaFn, [number, number]> = {
  round: [1, 2],
  min: [1, Infinity],
  max: [1, Infinity],
  days: [2, 2],
  hours: [2, 2],
  sum: [1, Infinity],
  count: [1, 1],
  if: [3, 3],
  ifblank: [2, 2],
};
const isFn = (name: string): name is FormulaFn => (FORMULA_FUNCTIONS as readonly string[]).includes(name);

/**
 * Recursive descent, loosest first:  compare → + −  → × ÷ → minus sign → % → a value.
 * Every failure is a `FormulaProblem` with the place in the text, worded for someone who is not a programmer.
 */
class Parser {
  private readonly toks: Token[];
  private pos = 0;
  private depth = 0;

  constructor(private readonly text: string) {
    this.toks = tokenize(text);
  }

  private get tok(): Token {
    return this.toks[this.pos]!;
  }
  private get prev(): Token | undefined {
    return this.toks[this.pos - 1];
  }
  private is(...syms: string[]): boolean {
    const t = this.tok;
    return t.t === 'sym' && syms.includes(t.v);
  }
  private take(): Token {
    return this.toks[this.pos++]!;
  }
  private name(t: Token): string {
    return shown(t, this.text);
  }
  private nested<T>(run: () => T): T {
    if (++this.depth > FORMULA_MAX_DEPTH) fail('tooDeep', this.tok.at, this.tok.end);
    const out = run();
    this.depth--;
    return out;
  }

  /** The whole text must be one expression. */
  whole(): FormulaNode {
    const ast = this.expr();
    this.after(null);
    return ast;
  }

  /** What follows a finished expression: the end, or inside brackets a `)` or `,`. Anything else is a slip. */
  private after(open: Token | null, inCall = false): void {
    const t = this.tok;
    if (t.t === 'end') {
      if (open) fail('openBracket', open.at, open.end);
      return;
    }
    if (t.t === 'sym' && t.v === ')') {
      if (!open) fail('closeBracket', t.at, t.end);
      return;
    }
    if (t.t === 'sym' && t.v === ',') {
      if (!inCall) fail('comma', t.at, t.end);
      return;
    }
    const before = this.prev!;
    fail('missingBetween', before.at, t.end, this.name(before), this.name(t));
  }

  private expr(): FormulaNode {
    let l = this.sum();
    while (this.tok.t === 'sym' && COMPARE.has(this.tok.v)) {
      const op = (this.take() as { v: CompareOp }).v;
      const r = this.sum();
      l = { k: 'cmp', op, l, r, at: l.at, end: r.end };
    }
    return l;
  }

  private sum(): FormulaNode {
    let l = this.product();
    while (this.is('+', '-')) {
      const op = (this.take() as { v: MathOp }).v;
      const r = this.product();
      l = { k: 'bin', op, l, r, at: l.at, end: r.end };
    }
    return l;
  }

  private product(): FormulaNode {
    let l = this.signed();
    while (this.is('*', '/')) {
      const op = (this.take() as { v: MathOp }).v;
      const r = this.signed();
      l = { k: 'bin', op, l, r, at: l.at, end: r.end };
    }
    return l;
  }

  private signed(): FormulaNode {
    if (this.is('-')) {
      const sign = this.take();
      const x = this.nested(() => this.signed());
      return { k: 'neg', x, at: sign.at, end: x.end };
    }
    if (this.is('+')) {
      this.take();
      return this.nested(() => this.signed());
    }
    let x = this.value();
    while (this.is('%')) x = { k: 'pct', x, at: x.at, end: this.take().end };
    return x;
  }

  private value(): FormulaNode {
    const t = this.tok;
    if (t.t === 'num') return (this.take(), { k: 'num', v: t.v, at: t.at, end: t.end });
    if (t.t === 'str') return (this.take(), { k: 'str', v: t.v.trim(), at: t.at, end: t.end });
    if (t.t === 'id') {
      this.take();
      if (this.is('(')) return this.nested(() => this.call(t.v, t));
      return { k: 'ref', name: t.v, at: t.at, end: t.end };
    }
    if (this.is('(')) {
      const open = this.take();
      if (this.is(')')) fail('emptyBrackets', open.at, this.tok.end);
      const x = this.nested(() => this.expr());
      this.after(open);
      this.take();
      return x;
    }
    return this.nothingHere(t);
  }

  /** A value was expected and there is none: say what it is missing after (or before). */
  private nothingHere(t: Token): never {
    const before = this.prev;
    if (t.t === 'end') {
      if (!before) return fail('empty', 0, 0);
      return fail('missingAfter', before.at, before.end, this.name(before));
    }
    const opens = !before || (before.t === 'sym' && (before.v === '(' || before.v === ','));
    if (this.is(')')) {
      if (!before) return fail('closeBracket', t.at, t.end);
      return fail('missingAfter', before.at, before.end, this.name(before));
    }
    if (opens && !(before && this.is(',') && before.t === 'sym' && before.v === ','))
      return fail('missingBefore', t.at, t.end, this.name(t));
    return fail('missingAfter', before!.at, before!.end, this.name(before!));
  }

  private call(name: string, id: Token): FormulaNode {
    if (!isFn(name)) return fail('unknownFunction', id.at, id.end, name);
    const open = this.take();
    const args: FormulaNode[] = [];
    if (!this.is(')')) {
      for (;;) {
        args.push(this.expr());
        this.after(open, true);
        if (this.is(')')) break;
        this.take();
      }
    }
    const end = this.take().end;
    const [least, most] = ARGS[name];
    if (args.length < least || args.length > most) fail('usage', id.at, end, name, FORMULA_USAGE[name]);
    const column = args[1];
    if (name === 'sum' && column?.k === 'str') {
      // sum(items, 'qty'): the lines of one field, and what to add up from them.
      if (args.length !== 2) fail('usage', id.at, end, name, "sum(items, 'qty')");
      if (args[0]!.k !== 'ref') fail('needsItems', args[0]!.at, args[0]!.end, name);
      const v = column.v.toLowerCase();
      if (!(SUM_COLUMNS as readonly string[]).includes(v)) fail('sumColumn', column.at, column.end, column.v);
      args[1] = { ...column, v: v as SumColumn };
    }
    if (name === 'count' && args[0]!.k !== 'ref') fail('needsItems', args[0]!.at, args[0]!.end, name);
    return { k: 'call', fn: name, args, at: id.at, end };
  }
}

/** Read a formula. Never throws: gives the tree, or the first problem with its place in the text. */
export function parseFormula(text: string): ParsedFormula {
  try {
    if (typeof text !== 'string' || !text.trim()) fail('empty', 0, 0);
    return { ok: true, ast: new Parser(text).whole() };
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return { ok: false, problem: e.problem };
    throw e;
  }
}

/** Every node of a tree, parents first. */
export function walk(node: FormulaNode, visit: (n: FormulaNode) => void): void {
  visit(node);
  switch (node.k) {
    case 'neg':
    case 'pct':
      return walk(node.x, visit);
    case 'bin':
    case 'cmp':
      return (walk(node.l, visit), walk(node.r, visit));
    case 'call':
      return node.args.forEach((a) => walk(a, visit));
  }
}

/** The field keys a formula reads, in the order they appear (none if it can't be read). */
export function formulaFields(formula: string | FormulaNode): string[] {
  const parsed = typeof formula === 'string' ? parseFormula(formula) : { ok: true as const, ast: formula };
  if (!parsed.ok) return [];
  const keys = new Set<string>();
  walk(parsed.ast, (n) => n.k === 'ref' && keys.add(n.name));
  return [...keys];
}
