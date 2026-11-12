import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { AiRecordType } from '@mono/shared';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { setTestLlm } from './llm';
import type { Llm } from './providers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());
afterEach(() => setTestLlm(null));

/** A scripted model: each call takes the next answer (checked against the real schema). */
function script(companyId: string, answers: unknown[]) {
  const asked: { system: string; messages: { role: string; content: string }[] }[] = [];
  const llm: Llm = {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    async complete() {
      throw new Error('not used');
    },
    async json<T>(req: {
      system: string;
      messages: { role: string; content: string }[];
      schema: z.ZodType<T>;
    }) {
      asked.push({ system: req.system, messages: req.messages });
      return { data: req.schema.parse(answers.shift()), usage: { inputTokens: 1_000, outputTokens: 300 } };
    },
  };
  setTestLlm((id) => (id === companyId ? llm : null));
  return asked;
}

const field = (label: string, type = 'text', required = false, options: string[] = []) => ({
  label,
  type,
  required,
  options,
});
const visit = (over: Partial<AiRecordType> = {}): AiRecordType =>
  ({
    name: 'Site visit',
    pluralName: 'Site visits',
    prefix: 'sv',
    description: 'A visit to a customer site',
    fields: [
      field('Site', 'text', true),
      field('Customer', 'master'),
      field('Visit on', 'date'),
      field('Kind', 'dropdown', false, ['Survey', 'Repair']),
      field('Cost', 'amount'),
    ],
    titleField: 'site',
    tables: [{ label: 'Findings', fields: [field('What', 'text', true), field('Qty', 'number')] }],
    statuses: [
      { label: 'Planned', kind: 'info', final: false },
      { label: 'Confirmed', kind: 'ok', final: false },
      { label: 'Closed', kind: 'neutral', final: true },
      { label: 'Cancelled', kind: 'bad', final: true },
    ],
    start: 'planned',
    moves: [
      { from: 'Planned', to: 'Confirmed', label: 'Confirm', who: 'approve', noteRequired: false },
      { from: 'Confirmed', to: 'Closed', label: 'Close', who: 'edit', noteRequired: false },
      { from: 'Planned', to: 'Cancelled', label: 'Cancel', who: 'creator', noteRequired: true },
      { from: 'Planned', to: 'Nowhere', label: 'Lost move', who: 'edit', noteRequired: false },
    ],
    ...over,
  }) as AiRecordType;

describe('build a record type with AI (plan §2.6)', () => {
  it("U8: a description becomes a draft for the editor — sound, in the company's words — and nothing is saved", async () => {
    const w = await world(ctx.app);
    await w.api.put('/api/ai/business-details', { text: 'We make quartz slabs in Kishangarh.' });
    const asked = script(w.companyId, [visit()]);
    const res = await w.api.post('/api/ai/record-types/draft', {
      text: 'Site visits to customers: site, customer, date, kind, cost, with findings. Planned, confirmed, closed.',
    });
    expect(res.status).toBe(200);
    expect(asked).toHaveLength(1); // nothing to fix: not sent back
    expect(asked[0]!.system).toContain('quartz slabs'); // every prompt carries the business details
    expect(res.body).toMatchObject({
      name: 'Site visit',
      pluralName: 'Site visits',
      prefix: 'SV',
      description: 'A visit to a customer site',
      problems: [],
    });
    const def = res.body.definition;
    expect(def.fields.map((f: { key: string; type: string }) => [f.key, f.type])).toEqual([
      ['site', 'text'],
      ['customer', 'master'],
      ['visit_on', 'date'],
      ['kind', 'dropdown'],
      ['cost', 'amount'],
    ]);
    expect(def.displayField).toBe('site');
    expect(def.tables).toEqual([
      {
        key: 'findings',
        label: 'Findings',
        fields: [
          { key: 'what', label: 'What', type: 'text', required: true },
          { key: 'qty', label: 'Qty', type: 'number', required: false },
        ],
      },
    ]);
    expect(def.start).toBe('planned');
    expect(def.statuses.map((s: { key: string; final?: boolean }) => [s.key, Boolean(s.final)])).toEqual([
      ['planned', false],
      ['confirmed', false],
      ['closed', true],
      ['cancelled', true],
    ]);
    // Moves are joined by label; one that leads nowhere is dropped; a cancellation asks why.
    expect(def.moves).toEqual([
      { from: 'planned', action: 'confirm', label: 'Confirm', to: 'confirmed', who: ['approve'] },
      { from: 'confirmed', action: 'close', label: 'Close', to: 'closed', who: ['edit'] },
      {
        from: 'planned',
        action: 'cancel',
        label: 'Cancel',
        to: 'cancelled',
        who: ['creator'],
        noteRequired: true,
      },
    ]);
    // The AI only proposes: no record type exists until a person saves the draft — and the draft does save.
    expect(await ctx.prisma.recordType.count({ where: { companyId: w.companyId } })).toBe(0);
    const { problems: _p, ...input } = res.body;
    const saved = await w.api.post('/api/records/types', {
      ...input,
      menu: { section: 'masters', icon: 'file-text' },
    });
    expect(saved.status).toBe(200);
    const usage = await ctx.prisma.aiUsage.findMany({
      where: { companyId: w.companyId, feature: 'record_type' },
    });
    expect(usage.map((u) => u.prompt)).toEqual(['record-type@1']);
  });

  it('U8: a draft MONO can fault is sent back once, and the better one is kept', async () => {
    const w = await world(ctx.app);
    // No move leads to "Closed", and a move leaves a final status.
    const unsound = visit({
      moves: [
        { from: 'Planned', to: 'Confirmed', label: 'Confirm', who: 'approve', noteRequired: false },
        { from: 'Cancelled', to: 'Planned', label: 'Bring back', who: 'edit', noteRequired: false },
      ],
    });
    const asked = script(w.companyId, [unsound, visit()]);
    const res = await w.api.post('/api/ai/record-types/draft', {
      text: 'Site visits with statuses and moves.',
    });
    expect(asked).toHaveLength(2);
    const fix = asked[1]!.messages.at(-1)!.content;
    expect(fix).toContain('No move leads to "Closed"');
    expect(fix).toContain('which is a final status');
    expect(res.body.problems).toEqual([]);
    expect(res.body.definition.moves).toHaveLength(3);
    // If the second try is no better, the first is kept and its problems are shown for the person to fix.
    script(w.companyId, [unsound, unsound]);
    const kept = (
      await w.api.post('/api/ai/record-types/draft', { text: 'Site visits with statuses and moves.' })
    ).body;
    expect(kept.problems.length).toBeGreaterThan(0);
    expect(kept.name).toBe('Site visit');
  });

  it('U8: only people who set record types up may ask; without a connected AI the answer says so', async () => {
    const w = await world(ctx.app);
    const member = await w.person('Gopal Prajapat');
    script(w.companyId, [visit()]);
    expect(
      (await member.api.post('/api/ai/record-types/draft', { text: 'A trip log for vehicles.' })).status,
    ).toBe(403);
    setTestLlm(null);
    const none = await w.api.post('/api/ai/record-types/draft', { text: 'A trip log for vehicles.' });
    expect(none.status).toBeGreaterThanOrEqual(400);
    expect(none.body.error.message).toMatch(/AI/);
    expect((await w.api.post('/api/ai/record-types/draft', { text: 'short' })).status).toBe(400);
  });
});
