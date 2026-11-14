import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { AiFlowDraft, AskPlan } from '@mono/shared';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';
import { setTestLlm } from './llm';
import type { Llm } from './providers';
import { sendDailySummaries } from './summary';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());
afterEach(() => setTestLlm(null));

/** A scripted model: each call takes the next answer (JSON answers are checked against the real schema). */
function script(companyId: string, answers: unknown[]) {
  const asked: { system: string; user: string }[] = [];
  const llm: Llm = {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    async complete(req) {
      asked.push({ system: req.system, user: req.messages.at(-1)!.content });
      return { text: String(answers.shift()), usage: { inputTokens: 1_000, outputTokens: 100 } };
    },
    async json<T>(req: { system: string; messages: { content: string }[]; schema: z.ZodType<T> }) {
      asked.push({ system: req.system, user: req.messages.at(-1)!.content });
      return { data: req.schema.parse(answers.shift()), usage: { inputTokens: 2_000, outputTokens: 500 } };
    },
  };
  setTestLlm((id) => (id === companyId ? llm : null));
  return asked;
}

const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
async function person(api: Awaited<ReturnType<typeof ownerClient>>['api'], name: string, login = false) {
  const mobile = rnd();
  const r = (await api.post('/api/org/users', { name, mobile, loginEnabled: login })).body;
  return { id: r.person.id as string, mobile, tempPassword: r.tempPassword as string | undefined };
}

const step = (s: Record<string, unknown>): AiFlowDraft['steps'][number] =>
  ({
    type: 'TASK',
    doers: [],
    byStarter: false,
    time: { value: 4, unit: 'hours', from: 'previous' },
    fields: [],
    checklist: [],
    proofRequired: false,
    yes: null,
    no: null,
    next: null,
    rejectTo: null,
    autoAction: null,
    documentType: null,
    autoText: null,
    notifyCustomer: false,
    ...s,
  }) as unknown as AiFlowDraft['steps'][number];
const draft = (over: Partial<AiFlowDraft> = {}) => ({
  name: 'Complaint handling',
  runName: 'Complaint',
  departments: ['Quality'],
  coordinator: 'Kavita Rao',
  solver: 'Owner Person',
  startFields: [{ label: 'Customer', type: 'text', required: true, options: [] }],
  steps: [
    step({ key: 'log', name: 'Log the complaint', byStarter: true }),
    step({ key: 'check', name: 'Check the slab', doers: ['Kavita'] }),
    step({
      key: 'genuine',
      name: 'Genuine?',
      type: 'DECISION',
      doers: ['Kavita'],
      yes: 'replace',
      no: 'end',
    }),
    step({ key: 'replace', name: 'Send replacement', doers: ['Mahesh'] }),
  ],
  remember: ['Complaints are checked by Quality within a day'],
  ...over,
});

describe('AI layer', () => {
  it('says to connect AI first, and keeps the key out of every answer', async () => {
    const { api, company } = await ownerClient(ctx.app);
    const r = await api.post('/api/ai/flows/draft', { text: 'Customer calls, we check, we replace.' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('AI_NOT_CONNECTED');
    expect((await api.get('/api/ai/status')).body).toMatchObject({ connected: false });

    const saved = await api.put('/api/ai/config', {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      apiKey: 'sk-ant-test-1234567890-WXYZ',
    });
    expect(saved.body).toMatchObject({ provider: 'anthropic', hasKey: true, keyEnd: 'WXYZ' });
    expect(JSON.stringify(saved.body)).not.toContain('sk-ant');
    const row = await ctx.prisma.aiConfig.findUniqueOrThrow({ where: { companyId: company.id } });
    expect(row.secret).not.toContain('sk-ant');
    const audit = await ctx.prisma.auditLog.findMany({
      where: { companyId: company.id, action: 'ai.config_saved' },
    });
    expect(JSON.stringify(audit)).not.toContain('sk-ant');
    // Saving again without a key keeps it; Ollama needs an address.
    expect(
      (await api.put('/api/ai/config', { provider: 'anthropic', model: 'claude-sonnet-5-5' })).body.hasKey,
    ).toBe(true);
    expect((await api.put('/api/ai/config', { provider: 'ollama', model: 'qwen2.5:7b' })).status).toBe(400);
  });

  it('builds a process with AI, flags names it can not place, and opens it in the builder', async () => {
    const { api, company } = await ownerClient(ctx.app);
    await person(api, 'Kavita Rao');
    await api.post('/api/org/departments', { names: ['Quality'] });
    const asked = script(company.id, [draft()]);
    const r = await api.post('/api/ai/flows/draft', {
      text: 'A customer complaint is logged by whoever takes the call. Kavita checks the slab; if genuine Mahesh sends a replacement.',
    });
    expect(r.status).toBe(200);
    // The prompt carries the company's people and the description.
    expect(asked[0]!.system).toContain('Kavita Rao');
    expect(asked[0]!.user).toContain('Kavita checks the slab');
    expect(r.body.summary).toMatchObject({ steps: 4, startFields: 1, unassigned: 1 });
    expect(r.body.unmatched).toEqual(
      expect.arrayContaining([
        { where: 'Send replacement', name: 'Mahesh' },
        { where: 'solver', name: 'Owner Person' },
      ]),
    );
    expect(r.body.remember).toEqual(['Complaints are checked by Quality within a day']);

    const created = await api.post('/api/ai/flows/create', { draft: r.body.draft, text: 'how it works' });
    const flow = (await api.get(`/api/fms/flows/${created.body.id}`)).body;
    expect(flow).toMatchObject({
      name: 'Complaint handling',
      runName: 'Complaint',
      description: 'how it works',
    });
    expect(flow.draft.steps.map((s: { key: string }) => s.key)).toEqual([
      'log',
      'check',
      'genuine',
      'replace',
    ]);

    const usage = await ctx.prisma.aiUsage.findMany({ where: { companyId: company.id } });
    expect(usage).toMatchObject([
      {
        feature: 'build_flow',
        prompt: 'build_flow@2',
        inputTokens: 2_000,
        outputTokens: 500,
        costMicros: 18_000,
        ok: true,
      },
    ]);

    // Edit with AI shows the change and saves nothing.
    script(company.id, [
      draft({
        steps: [
          ...draft().steps.slice(0, 3),
          step({ key: 'replace', name: 'Send replacement', doers: ['Kavita'] }),
          step({ key: 'call_back', name: 'Call the customer back', byStarter: true }),
        ],
      }),
    ]);
    const edit = await api.post(`/api/ai/flows/${created.body.id}/edit`, {
      instruction: 'Kavita sends it, then call back',
    });
    expect(edit.body.diff).toMatchObject({
      added: [{ key: 'call_back' }],
      removed: [],
      changed: [{ key: 'replace', what: ['doers'] }],
    });
    expect((await api.get(`/api/fms/flows/${created.body.id}`)).body.draft.steps).toHaveLength(4);

    // KPI suggestions: only fields that exist; text can only be counted.
    script(company.id, [
      {
        cards: [
          { label: 'Complaints', source: 'count', aggregation: 'COUNT', period: 'WEEK', why: 'volume' },
          { label: 'Customers', source: 'start:customer', aggregation: 'TOTAL', period: 'MONTH', why: 'x' },
          { label: 'Ghost', source: 'start:nothing', aggregation: 'TOTAL', period: 'MONTH', why: 'x' },
        ],
      },
    ]);
    const kpis = (await api.post(`/api/ai/flows/${created.body.id}/kpis`)).body;
    expect(kpis.map((k: { label: string; aggregation: string }) => [k.label, k.aggregation])).toEqual([
      ['Complaints', 'COUNT'],
      ['Customers', 'COUNT'],
    ]);
  });

  it('asks the model once to fix problems MONO can name, and keeps the better draft', async () => {
    const { api, company } = await ownerClient(ctx.app);
    await person(api, 'Kavita Rao');
    const noTime = draft({
      steps: [
        ...draft().steps.slice(0, 3),
        step({ key: 'replace', name: 'Send replacement', doers: ['Kavita'], time: null }),
      ],
    });
    const asked = script(company.id, [noTime, draft()]);
    const r = (
      await api.post('/api/ai/flows/draft', { text: 'Complaint comes in, Kavita checks, then replaces.' })
    ).body;
    expect(asked).toHaveLength(2);
    expect(asked[1]!.user).toContain('"Send replacement" has no time');
    expect(r.issues.map((i: { code: string }) => i.code)).not.toContain('noTime');
    // A draft with nothing to fix is not sent back.
    expect(
      script(company.id, [draft()]) &&
        (await api.post('/api/ai/flows/draft', { text: 'Same again, please.' })).status,
    ).toBe(200);
    const usage = await ctx.prisma.aiUsage.findMany({
      where: { companyId: company.id, feature: 'build_flow' },
      orderBy: { createdAt: 'asc' },
    });
    expect(usage.map((u) => u.inputTokens)).toEqual([4_000, 2_000]);
  });

  it('answers questions from the read-only views, only this company, only your own rows unless admin', async () => {
    const { api, company, owner } = await ownerClient(ctx.app);
    const ravi = await person(api, 'Ravi Kumar', true);
    const due = new Date(Date.now() - 3 * 86_400_000).toISOString();
    for (const d of ['Grease the press', 'Fix the gate'])
      await api.post('/api/tasks', { doerId: ravi.id, plannedAt: due, description: d });
    await api.post('/api/tasks', { doerId: owner.id, plannedAt: due, description: 'Owner own task' });
    const plan = (p: Partial<AskPlan>) => ({
      answerable: true,
      why: '',
      view: 'tasks',
      columns: [],
      filters: [{ column: 'is_late', op: 'eq', value: true }],
      groupBy: null,
      aggregate: null,
      orderBy: null,
      limit: 50,
      report: null,
      ...p,
    });
    let asked = script(company.id, [
      plan({
        groupBy: 'doer',
        aggregate: { fn: 'count', column: null },
        orderBy: { column: 'value', dir: 'desc' },
      }),
      'Ravi Kumar has 2 late tasks.',
    ]);
    const grouped = (await api.post('/api/ai/ask', { question: 'Who has the most late tasks?' })).body;
    expect(grouped.columns).toEqual(['doer', 'value']);
    expect(grouped.rows[0]).toEqual({ doer: 'Ravi Kumar', value: 2 });
    expect(grouped.answer).toBe('Ravi Kumar has 2 late tasks.');
    expect(asked[1]!.user).toContain('Ravi Kumar');

    script(company.id, [
      plan({ filters: [{ column: 'task', op: 'contains', value: "gate'; drop table tasks; --" }] }),
      'None.',
    ]);
    expect((await api.post('/api/ai/ask', { question: 'gate?' })).body.rows).toEqual([]);
    expect(await ctx.prisma.task.count({ where: { companyId: company.id } })).toBe(3);

    // A plan naming anything outside the catalog never runs.
    asked = script(company.id, [plan({ columns: ['password_hash'] })]);
    const refused = (await api.post('/api/ai/ask', { question: 'passwords?' })).body;
    expect(refused).toMatchObject({ rows: [], problems: ['Unknown column "password_hash"'] });
    expect(asked).toHaveLength(1);

    // Ravi (no ai.admin) sees only his own tasks; members need ai.view to ask at all.
    const raviApi = await signedIn(ctx.app, ravi.mobile, ravi.tempPassword!);
    await raviApi.post('/api/auth/change-password', {
      currentPassword: ravi.tempPassword,
      newPassword: 'Ravi12345',
    });
    expect((await raviApi.post('/api/ai/ask', { question: 'my late tasks?' })).status).toBe(403);
    const role = await ctx.prisma.role.findFirstOrThrow({ where: { companyId: company.id, key: 'MEMBER' } });
    await ctx.prisma.role.update({
      where: { id: role.id },
      data: { permissions: [...(role.permissions as string[]), 'ai.view'] },
    });
    script(company.id, [plan({ columns: ['task', 'doer'] }), 'Two.']);
    const mine = (await raviApi.post('/api/ai/ask', { question: 'late tasks?' })).body;
    expect(mine.onlyMine).toBe(true);
    expect(mine.rows.map((r: { task: string }) => r.task).sort()).toEqual([
      'Fix the gate',
      'Grease the press',
    ]);
    expect(mine.rows[0].link).toMatch(/^\/delegation\?task=/);

    // Another company's rows never show.
    const other = await ownerClient(ctx.app);
    script(other.company.id, [plan({}), 'None.']);
    expect((await other.api.post('/api/ai/ask', { question: 'late?' })).body.rows).toEqual([]);
  });

  it('answers stock questions from the business views — by the stock right, not only your own rows', async () => {
    const { api, company } = await ownerClient(ctx.app);
    for (const [code, name, unit, openingQty] of [
      ['DAI-PAN', 'Paneer', 'kg', 12],
      ['DRY-RIC', 'Basmati rice', 'kg', 40],
    ] as const)
      expect(
        (await api.post('/api/ims/items', { code, name, unit, category: 'Kitchen', openingQty })).status,
      ).toBe(200);
    const plan: AskPlan = {
      answerable: true,
      why: '',
      view: 'stock',
      columns: ['item', 'qty', 'unit', 'location'],
      filters: [],
      groupBy: null,
      aggregate: null,
      orderBy: { column: 'qty', dir: 'desc' },
      limit: 1,
      report: null,
    };
    let asked = script(company.id, [plan, 'Basmati rice: 40 kg.']);
    const top = (await api.post('/api/ai/ask', { question: 'what in stock has the most quantity?' })).body;
    expect(top.rows).toEqual([
      {
        item: 'Basmati rice',
        qty: 40,
        unit: 'kg',
        location: 'Main store',
        link: expect.stringMatching(/^\/ims\/stock\?item=/),
      },
    ]);
    expect(asked[0]!.system).toContain('stock — What is in stock now');

    // A member with the stock right (and ai.view) sees the company's stock, not just "their own rows".
    const ravi = await person(api, 'Ravi Kumar', true);
    const raviApi = await signedIn(ctx.app, ravi.mobile, ravi.tempPassword!);
    await raviApi.post('/api/auth/change-password', {
      currentPassword: ravi.tempPassword,
      newPassword: 'Ravi12345',
    });
    const member = await ctx.prisma.role.findFirstOrThrow({
      where: { companyId: company.id, key: 'MEMBER' },
    });
    await ctx.prisma.role.update({
      where: { id: member.id },
      data: { permissions: ['ai.view', 'ims.view'] },
    });
    script(company.id, [plan, 'Basmati rice.']);
    expect((await raviApi.post('/api/ai/ask', { question: 'most stock?' })).body.rows).toHaveLength(1);

    // Without it, the stock views are not offered, and a plan that names them is refused.
    await ctx.prisma.role.update({ where: { id: member.id }, data: { permissions: ['ai.view'] } });
    asked = script(company.id, [plan]);
    const refused = (await raviApi.post('/api/ai/ask', { question: 'most stock?' })).body;
    expect(refused.rows).toEqual([]);
    expect(refused.answer).toMatch(/can't see stock/);
    expect(asked[0]!.system).not.toContain('stock — What is in stock now');
  });

  it('chat: looks things up, calculates and answers in steps; keeps the conversation; staff see only their own', async () => {
    const { api, company, owner } = await ownerClient(ctx.app);
    for (const [code, name, openingQty] of [
      ['DAI-PAN', 'Paneer', 12],
      ['DRY-RIC', 'Basmati rice', 40],
    ] as const)
      await api.post('/api/ims/items', { code, name, unit: 'kg', category: 'Kitchen', openingQty });
    const step = (s: object) => ({
      action: 'answer',
      purpose: '',
      lookup: null,
      calculate: null,
      answer: null,
      showLookup: null,
      suggestions: [],
      ...s,
    });
    const stockLookup = {
      view: 'stock',
      columns: ['item', 'qty', 'unit'],
      filters: [],
      groupBy: null,
      aggregate: null,
      orderBy: { column: 'qty', dir: 'desc' },
      limit: 10,
    };
    let asked = script(company.id, [
      step({ action: 'lookup', purpose: 'Stock dekh raha hoon', lookup: stockLookup }),
      step({
        action: 'calculate',
        purpose: 'Total',
        calculate: { expression: '40 + 12', label: 'kg in all' },
      }),
      step({
        answer: '**Basmati rice** sabse zyada hai: 40 kg. Kul 52 kg.',
        showLookup: 1,
        suggestions: ['Paneer kitna bacha?'],
      }),
    ]);
    const r = (await api.post('/api/ai/chat', { text: 'sabse zyada stock kis cheez ka hai?' })).body;
    expect(r.message.content).toContain('Basmati rice');
    expect(r.message.data.steps).toEqual([
      { purpose: 'Stock dekh raha hoon', kind: 'lookup', view: 'stock', rows: 2 },
      { purpose: 'Total', kind: 'calculate', result: 'kg in all = 52' },
    ]);
    expect(r.message.data.table.rows[0]).toMatchObject({ item: 'Basmati rice', qty: 40 });
    expect(r.message.data.suggestions).toEqual(['Paneer kitna bacha?']);
    // The model saw the rows of its lookup and the calculator's result.
    expect(asked[1]!.user).toContain('Basmati rice');
    expect(asked[2]!.user).toContain('= 52');
    expect(asked[0]!.system).toContain('the owner');

    // The next question continues the same chat, with the earlier turn in the history.
    asked = script(company.id, [step({ answer: 'Paneer: 12 kg.' })]);
    const next = (await api.post('/api/ai/chat', { chatId: r.chatId, text: 'aur paneer?' })).body;
    expect(next.chatId).toBe(r.chatId);
    const chat = (await api.get(`/api/ai/chats/${r.chatId}`)).body;
    expect(chat.messages.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect((await api.get('/api/ai/chats')).body).toHaveLength(1);

    // A member: only their own attendance, and no stock (not offered; a plan for it is refused to the model).
    const ravi = await person(api, 'Ravi Kumar', true);
    const raviApi = await signedIn(ctx.app, ravi.mobile, ravi.tempPassword!);
    await raviApi.post('/api/auth/change-password', {
      currentPassword: ravi.tempPassword,
      newPassword: 'Ravi12345',
    });
    const member = await ctx.prisma.role.findFirstOrThrow({
      where: { companyId: company.id, key: 'MEMBER' },
    });
    await ctx.prisma.role.update({ where: { id: member.id }, data: { permissions: ['ai.view', 'hr.view'] } });
    for (const userId of [ravi.id, owner.id])
      await ctx.prisma.attendanceDay.create({
        data: { companyId: company.id, userId, date: '2026-10-05', status: 'LATE' },
      });
    asked = script(company.id, [
      step({ action: 'lookup', purpose: 'stock', lookup: stockLookup }),
      step({
        action: 'lookup',
        purpose: 'attendance',
        lookup: { ...stockLookup, view: 'attendance', columns: ['person', 'status'], orderBy: null },
      }),
      step({ answer: 'Aap 05/10 ko late the.', showLookup: 2 }),
    ]);
    const mine = (await raviApi.post('/api/ai/chat', { text: 'main kab late aaya?' })).body;
    expect(asked[0]!.system).not.toContain('stock — What is in stock now');
    expect(asked[0]!.system).toContain('not the owner');
    expect(asked[1]!.user).toMatch(/could not run: You may not read "stock"/);
    expect(mine.message.data.table.rows).toEqual([
      expect.objectContaining({ person: 'Ravi Kumar', status: 'LATE' }),
    ]);
    // Someone else's chat is not theirs to read.
    expect((await raviApi.get(`/api/ai/chats/${r.chatId}`)).status).toBe(404);
  });

  it('keeps business details, remembers facts, and builds the ChatGPT prompt from data', async () => {
    const { api, company } = await ownerClient(ctx.app);
    const saved = (await api.put('/api/ai/business-details', { text: 'We make quartz slabs in Kishangarh.' }))
      .body;
    expect(saved).toMatchObject({ words: 6, quality: 'short' });
    await api.post('/api/ai/remember', { lines: ['Dispatch leaves before 6 pm'] });
    expect((await api.get('/api/ai/business-details')).body.text).toBe(
      'We make quartz slabs in Kishangarh.\n- Dispatch leaves before 6 pm',
    );
    const prompt = (await api.get('/api/ai/business-details/chatgpt-prompt')).body.prompt;
    expect(prompt).toContain('Dispatch leaves before 6 pm');
    expect(prompt).toContain('Tasks given in the last 30 days');
    script(company.id, [{ text: 'A longer description. '.repeat(30) }]);
    expect((await api.post('/api/ai/business-details/refresh')).body).toMatchObject({
      words: 90,
      quality: 'fair',
    });
    // Refresh only proposes; the saved text is unchanged.
    expect((await api.get('/api/ai/business-details')).body.words).toBe(12);
  });

  it('drafts and saves a master; names stay unique', async () => {
    const { api, company } = await ownerClient(ctx.app);
    script(company.id, [
      {
        name: 'Vehicles',
        description: 'Our trucks and loaders',
        fields: [
          { label: 'Vehicle number', type: 'text', required: true, options: [] },
          { label: 'Kind', type: 'dropdown', required: true, options: ['Truck', 'Loader'] },
          { label: 'Insurance till', type: 'date', required: false, options: [] },
        ],
        keyField: 'Vehicle number',
        displayField: 'Vehicle number',
      },
    ]);
    const d = (await api.post('/api/ai/masters/draft', { text: 'our trucks with number and insurance' }))
      .body;
    expect(d).toMatchObject({ name: 'Vehicles', keyField: 'vehicle_number', displayField: 'vehicle_number' });
    expect((await api.post('/api/masters', { ...d, source: 'ai' })).status).toBe(200);
    expect((await api.post('/api/masters', { ...d, name: 'vehicles' })).status).toBe(409);
    expect((await api.get('/api/masters')).body).toHaveLength(1);
  });

  it('a rate limit on one route never limits its neighbours', async () => {
    const { api } = await ownerClient(ctx.app);
    // "Test" allows 6 a minute and GST verify 30; the routes next to them must not inherit that.
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await api.get('/api/ai/business-details')).status);
    for (let i = 0; i < 35; i++) codes.push((await api.get('/api/org/company')).status);
    expect(codes.every((c) => c === 200)).toBe(true);
  });

  it('sends the owner one AI summary a day at 08:45 (company time)', async () => {
    const { api, company } = await ownerClient(ctx.app);
    await api.put('/api/ai/config', { provider: 'anthropic', model: 'claude-opus-5-5', apiKey: 'sk-ant-x' });
    const asked = script(company.id, ['Good morning. 0 late tasks.']);
    const at = (hhmm: string) => new Date(`2026-11-03T${hhmm}:00+05:30`);
    const secret = 'test-secret-that-is-long-enough-1234567890';
    expect(await sendDailySummaries(ctx.prisma, secret, at('08:30'), company.id)).toBe(0);
    expect(await sendDailySummaries(ctx.prisma, secret, at('08:46'), company.id)).toBe(1);
    expect(await sendDailySummaries(ctx.prisma, secret, at('09:30'), company.id)).toBe(0);
    expect(asked[0]!.user).toContain('Late right now');
    const ev = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { companyId: company.id, name: 'ai.daily_summary' },
    });
    expect(ev.payload).toMatchObject({ summary: 'Good morning. 0 late tasks.', date: '03/11/2026' });
  });
});
