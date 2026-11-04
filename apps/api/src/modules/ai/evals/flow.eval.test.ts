import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AI_FLOW_EXAMPLES, aiFlowDraftSchema, draftToFlow, type AiProvider } from '@mono/shared';
import { draftWithRepair } from '../flows';
import { makeLlm } from '../providers';
import * as BUILD from '../prompts/build-flow.v2';
import type { CompanyContext } from '../prompts/context';

/**
 * Evals for "Build with AI" (PROMPTS.md phase 6): the five sample descriptions must come back as JSON that
 * matches the schema and converts into a flow with no broken branches, the right number of steps and the
 * named people found.
 *
 * - Live:   AI_EVAL_PROVIDER=anthropic AI_EVAL_MODEL=claude-opus-5-5 AI_EVAL_KEY=… npm test -- flow.eval
 *           (ollama: AI_EVAL_BASE_URL=http://localhost:11434, no key). AI_EVAL_RECORD=1 also saves the answers.
 * - Replay: without those, every recorded answer in fixtures/<model>/ is checked again (no AI call, no cost).
 */
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, 'fixtures');

const DEMO: [string, string, string | null][] = [
  ['Rajesh Goyal', 'Management', 'Owner'],
  ['Meena Goyal', 'Management', 'Director'],
  ['Suresh Agarwal', 'Accounts', 'Accountant'],
  ['Mahesh Yadav', 'Dispatch', 'Dispatch Manager'],
  ['Ravi Kumar', 'Dispatch', null],
  ['Kavita Rathore', 'HR', 'HR Manager'],
  ['Nikhil Sharma', 'IT', 'IT Administrator'],
  ['Neha Kapoor', 'Marketing', 'Marketing Manager'],
  ['Ajay Meena', 'Production', 'Production Head'],
  ['Amit Khandelwal', 'Purchase', 'Purchase Manager'],
  ['Priya Sharma', 'Quality', 'Quality Manager'],
  ['Rohit Mittal', 'Sales', 'Sales Manager'],
  ['Sunita Bansal', 'Sales', 'Sales Executive'],
  ['Arjun Rawat', 'Sales', 'Sales Executive'],
  ['Gopal Prajapat', 'Store', 'Store Keeper'],
];
const ctx: CompanyContext = {
  company: 'Demo Industries',
  timezone: 'Asia/Kolkata',
  now: '03/11/2026 10:00',
  details: 'We make engineered quartz slabs and sell them to dealers and builders across North India.',
  people: DEMO.map(([name, department, designation], i) => ({ id: `u${i}`, name, department, designation })),
  departments: [...new Set(DEMO.map((d) => d[1]))].map((name, i) => ({ id: `d${i}`, name })),
  documentTypes: [
    { code: 'QUO', name: 'Quotation' },
    { code: 'PI', name: 'Proforma invoice' },
    { code: 'INV', name: 'Tax invoice' },
  ],
};

const BROKEN = new Set([
  'unknownTarget',
  'orphan',
  'noEnd',
  'duplicateKey',
  'duplicateField',
  'decisionBranches',
]);

function check(key: string, raw: unknown) {
  const example = AI_FLOW_EXAMPLES.find((e) => e.key === key)!;
  const draft = aiFlowDraftSchema.parse(raw);
  const out = draftToFlow(draft, ctx);
  expect(
    out.issues.filter((i) => BROKEN.has(i.code)),
    'broken branches or steps',
  ).toEqual([]);
  expect(
    out.issues.filter((i) => i.code === 'noTime'),
    'every step has a time',
  ).toEqual([]);
  expect(out.summary.steps).toBeGreaterThanOrEqual(example.minSteps);
  expect(out.summary.steps).toBeLessThanOrEqual(example.maxSteps);
  if (key === 'leadToOrder') {
    // Everyone in this description is a real person in the demo company.
    expect(out.summary.unassigned).toBe(0);
    expect(
      out.unmatched.filter(
        (u) => u.where !== 'department' && u.where !== 'solver' && u.where !== 'coordinator',
      ),
    ).toEqual([]);
    expect(out.definition.steps.some((s) => s.type === 'DECISION')).toBe(true);
    expect(out.definition.steps.some((s) => s.type === 'APPROVAL')).toBe(true);
  }
  return out;
}

const live = process.env.AI_EVAL_PROVIDER as AiProvider | undefined;
const recorded = existsSync(FIXTURES)
  ? readdirSync(FIXTURES).flatMap((model) =>
      readdirSync(join(FIXTURES, model)).map((file) => ({
        model,
        key: file.replace(/\.json$/, ''),
        file: join(FIXTURES, model, file),
      })),
    )
  : [];

describe.skipIf(!live)('Build with AI — live', () => {
  const llm = live
    ? makeLlm({
        provider: live,
        model: process.env.AI_EVAL_MODEL ?? 'claude-opus-5-5',
        apiKey: process.env.AI_EVAL_KEY,
        baseUrl: process.env.AI_EVAL_BASE_URL,
      })
    : null;
  for (const ex of AI_FLOW_EXAMPLES)
    it(`${ex.key}: valid JSON that becomes a sound flow`, { timeout: 20 * 60_000 }, async () => {
      // The same path as the screen: draft, check, one repair round when needed.
      const { data, repaired } = await draftWithRepair(
        llm!,
        ctx,
        BUILD.system(ctx),
        BUILD.user({ text: ex.text }),
      );
      console.info(`${ex.key}: ${data.steps.length} steps${repaired ? ' (after one repair round)' : ''}`);
      if (process.env.AI_EVAL_RECORD === '1') {
        const dir = join(FIXTURES, llm!.model.replace(/[^a-z0-9.-]/gi, '_'));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${ex.key}.json`), `${JSON.stringify(data, null, 2)}\n`);
      }
      check(ex.key, data);
    });
});

describe.skipIf(!recorded.length)('Build with AI — recorded answers', () => {
  for (const r of recorded)
    it(`${r.model} · ${r.key}`, () => {
      check(r.key, JSON.parse(readFileSync(r.file, 'utf8')));
    });
});
