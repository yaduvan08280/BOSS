import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';
import { documentPdf } from './documents';
import { runFmsWebhooks, watchFmsSteps } from './jobs';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
const t = (value: number, unit = 'hours') => ({ value, unit, anchor: 'previous' });

async function team() {
  const o = await ownerClient(ctx.app);
  const make = async (name: string) => {
    const mobile = rnd();
    const r = (await o.api.post('/api/org/users', { name, mobile, loginEnabled: true })).body;
    const api = await signedIn(ctx.app, mobile, r.tempPassword);
    await api.post('/api/auth/change-password', {
      currentPassword: r.tempPassword,
      newPassword: 'Secret12345',
    });
    return { id: r.person.id as string, api };
  };
  return {
    ...o,
    sales: await make('Neha Sales'),
    store: await make('Anil Store'),
    boss: await make('Arvind Boss'),
  };
}

/** Order → in stock? → (no) buy → manager OK → dispatch → invoice (AUTO document). */
function orderFlow(ids: { sales: string; store: string; boss: string }) {
  return {
    timeModel: 'calendar',
    startFields: [
      { key: 'customer', label: 'Customer', type: 'text', required: true },
      { key: 'mobile', label: 'Mobile', type: 'mobile' },
      { key: 'lines', label: 'Items', type: 'items', required: true },
    ],
    steps: [
      {
        key: 'confirm',
        name: 'Confirm order',
        type: 'TASK',
        doerIds: [ids.sales],
        time: t(2),
        checklist: ['Rate checked'],
      },
      {
        key: 'stock',
        name: 'In stock?',
        type: 'DECISION',
        doerIds: [ids.store],
        time: t(4),
        yes: 'dispatch',
        no: 'buy',
      },
      {
        key: 'buy',
        name: 'Buy material',
        type: 'TASK',
        doerIds: [ids.store],
        time: t(2, 'days'),
        fields: [{ key: 'po', label: 'PO number', type: 'text', required: true }],
      },
      { key: 'ok', name: 'Manager OK', type: 'APPROVAL', doerIds: [ids.boss], time: t(1), rejectTo: 'buy' },
      {
        key: 'dispatch',
        name: 'Dispatch',
        type: 'TASK',
        doerIds: [ids.store],
        time: t(4),
        proofRequired: true,
      },
      {
        key: 'invoice',
        name: 'Make invoice',
        type: 'AUTO',
        auto: { action: 'document', documentType: 'INV' },
      },
    ],
  };
}

describe('FMS', () => {
  it('builds, publishes, and runs a record down both branches to a numbered invoice', async () => {
    const { api, company, sales, store, boss } = await team();
    await api.put('/api/document-types', { code: 'INV', name: 'Tax invoice', prefix: 'INV' });
    const flow = (await api.post('/api/fms/flows', { meta: { name: 'Order to dispatch', runName: 'Order' } }))
      .body;
    expect(flow.code).toBe('PRC-001');

    // An incomplete draft can't be published.
    const draft = orderFlow({ sales: sales.id, store: store.id, boss: boss.id });
    const broken = {
      ...draft,
      steps: draft.steps.map((s) => (s.key === 'stock' ? { ...s, no: undefined } : s)),
    };
    await api.put(`/api/fms/flows/${flow.id}`, { definition: broken });
    const refused = await api.post(`/api/fms/flows/${flow.id}/publish`);
    expect(refused.status).toBe(400);
    expect(refused.body.error.details.issues.map((i: { code: string }) => i.code)).toContain(
      'decisionBranches',
    );

    await api.put(`/api/fms/flows/${flow.id}`, {
      definition: draft,
      meta: { coordinatorId: boss.id, solverId: boss.id },
    });
    expect((await api.post(`/api/fms/flows/${flow.id}/publish`)).body).toMatchObject({
      status: 'PUBLISHED',
      version: 1,
    });
    // Saving one field leaves the others alone (the run name stays "Order").
    await api.put(`/api/fms/flows/${flow.id}`, { meta: { videoUrl: 'https://youtu.be/x' } });
    const detail = (await api.get(`/api/fms/flows/${flow.id}`)).body;
    expect(detail).toMatchObject({ runName: 'Order', videoUrl: 'https://youtu.be/x' });
    expect(detail.stats).toMatchObject({ steps: 6, people: 3 });

    // Start: required fields are checked; the first step goes to sales, due in 2 h.
    expect(
      (await sales.api.post(`/api/fms/flows/${flow.id}/records`, { data: { mobile: '9829012345' } })).status,
    ).toBe(400);
    const rec = (
      await sales.api.post(`/api/fms/flows/${flow.id}/records`, {
        data: {
          customer: 'Sharma Builders',
          mobile: '98290 12345',
          lines: [{ item: 'Carrara 20mm', qty: 10, rate: 4500 }],
        },
      })
    ).body;
    expect(rec).toMatchObject({ title: 'Sharma Builders', number: 1, status: 'RUNNING' });
    const open = async () =>
      (await api.get(`/api/fms/records/${rec.id}`)).body.steps.find(
        (s: { status: string }) => s.status === 'OPEN',
      );
    let step = await open();
    expect(step).toMatchObject({ stepKey: 'confirm', doerId: sales.id });
    const due = new Date(step.plannedAt).getTime() - new Date(step.startedAt).getTime();
    expect(Math.round(due / 3_600_000)).toBe(2);

    const done = (who: typeof api, body: object) => who.post(`/api/fms/steps/${step.id}/complete`, body);
    expect((await done(store.api, {})).status).toBe(403);
    expect((await done(sales.api, {})).body.error.message).toContain('Tick the checklist');
    await done(sales.api, { checklistDone: ['Rate checked'] });

    step = await open();
    expect(step.stepKey).toBe('stock');
    expect((await done(store.api, {})).body.error.message).toBe('Answer Yes or No');
    await done(store.api, { decision: 'no' });
    step = await open();
    expect(step.stepKey).toBe('buy');
    expect((await done(store.api, {})).body.error.details.fields).toHaveProperty('po');
    await done(store.api, { data: { po: 'PO-77' } });

    step = await open();
    expect(step.stepKey).toBe('ok');
    expect((await done(boss.api, { decision: 'rejected' })).body.error.message).toBe(
      'Say why it is rejected',
    );
    await done(boss.api, { decision: 'rejected', note: 'Wrong vendor' });
    step = await open();
    expect(step.stepKey).toBe('buy'); // rejected → back to buying
    await done(store.api, { data: { po: 'PO-78' } });
    step = await open();
    await done(boss.api, { decision: 'approved' });

    step = await open();
    expect(step.stepKey).toBe('dispatch');
    expect((await done(store.api, {})).body.error.message).toContain('proof');
    const photo = await ctx.prisma.attachment.create({
      data: {
        companyId: company.id,
        entityType: 'upload',
        entityId: store.id,
        path: 'x/truck.jpg',
        mime: 'image/jpeg',
        size: 1,
        originalName: 'truck.jpg',
        uploadedById: store.id,
      },
    });
    const closed = (await done(store.api, { attachmentIds: [photo.id] })).body;
    expect(closed.status).toBe('CLOSED');

    const final = (await api.get(`/api/fms/records/${rec.id}`)).body;
    expect(final.documents).toHaveLength(1);
    expect(final.documents[0].number).toMatch(/^INV\/\d{2}-\d{2}\/0001$/);
    expect(final.documents[0].total).toBe(45000);
    const { pdf } = await documentPdf(ctx.prisma, company.id, final.documents[0].id);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const names = (
      await ctx.prisma.domainEvent.findMany({
        where: { companyId: company.id, name: { startsWith: 'fms.' } },
      })
    ).map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'fms.record_started',
        'fms.step_assigned',
        'fms.approval_needed',
        'fms.record_closed',
      ]),
    );

    // The report and the KPI cards read the finished record.
    const report = (await api.get(`/api/fms/flows/${flow.id}/report`)).body;
    expect(report.steps.find((s: { key: string }) => s.key === 'buy').passed).toBe(2);
    await api.put(`/api/fms/flows/${flow.id}/kpis`, [
      { label: 'Orders', source: 'count', aggregation: 'COUNT', period: 'MONTH' },
      { label: 'Order value', source: 'start:lines', aggregation: 'TOTAL', period: 'MONTH' },
    ]);
    const kpis = (await api.get(`/api/fms/flows/${flow.id}/kpis`)).body;
    expect(kpis.map((k: { value: number }) => k.value)).toEqual([1, 45000]);
  });

  it('keeps running records on their version; holds, reassigns, and chases late steps', async () => {
    const { api, company, sales, store, boss } = await team();
    await api.put('/api/document-types', { code: 'INV', name: 'Tax invoice', prefix: 'INV' });
    const flow = (await api.post('/api/fms/flows', { meta: { name: 'Orders', runName: 'Order' } })).body;
    const def = orderFlow({ sales: sales.id, store: store.id, boss: boss.id });
    await api.put(`/api/fms/flows/${flow.id}`, {
      definition: def,
      meta: { coordinatorId: boss.id, solverId: boss.id },
    });
    await api.post(`/api/fms/flows/${flow.id}/publish`);
    const rec = (
      await sales.api.post(`/api/fms/flows/${flow.id}/records`, {
        data: { customer: 'A', lines: [{ item: 'X', qty: 1, rate: 1 }] },
      })
    ).body;

    // v2 renames the first step; the running record still shows v1's.
    await api.put(`/api/fms/flows/${flow.id}`, {
      definition: {
        ...def,
        steps: def.steps.map((s) => (s.key === 'confirm' ? { ...s, name: 'Call the customer' } : s)),
      },
    });
    await api.post(`/api/fms/flows/${flow.id}/publish`);
    const r1 = (await api.get(`/api/fms/records/${rec.id}`)).body;
    expect(r1.version).toBe(1);
    expect(r1.steps[0].stepName).toBe('Confirm order');

    const stepId = r1.steps[0].id;
    expect((await sales.api.post(`/api/fms/steps/${stepId}/reassign`, { doerId: store.id })).status).toBe(
      403,
    );
    await boss.api.post(`/api/fms/steps/${stepId}/reassign`, { doerId: store.id, reason: 'Neha on leave' });
    expect((await boss.api.post(`/api/fms/records/${rec.id}/actions`, { action: 'hold' })).status).toBe(400);
    await boss.api.post(`/api/fms/records/${rec.id}/actions`, {
      action: 'hold',
      reason: 'Customer asked to wait',
    });
    expect(
      (await store.api.post(`/api/fms/steps/${stepId}/complete`, { checklistDone: ['Rate checked'] })).body
        .error.message,
    ).toBe('This record is on hold');
    await boss.api.post(`/api/fms/records/${rec.id}/actions`, { action: 'resume' });

    // Late: the doer + coordinator hear once; at twice the planned time the solver is called in.
    await ctx.prisma.fmsRecordStep.update({
      where: { id: stepId },
      data: {
        startedAt: new Date(Date.now() - 6 * 3_600_000),
        plannedAt: new Date(Date.now() - 3 * 3_600_000),
      },
    });
    await watchFmsSteps(ctx.prisma);
    await watchFmsSteps(ctx.prisma);
    const ev = await ctx.prisma.domainEvent.findMany({
      where: { companyId: company.id, name: { in: ['fms.step_late', 'fms.step_stuck'] } },
    });
    expect(ev.map((e) => e.name).sort()).toEqual(['fms.step_late', 'fms.step_stuck']);
    expect((ev[0]!.payload as { doerId: string }).doerId).toBe(store.id);

    const live = (await api.get(`/api/fms/live?flowId=${flow.id}&tab=late`)).body;
    expect(live.records.map((r: { id: string }) => r.id)).toEqual([rec.id]);
    expect(live.stages.find((s: { key: string }) => s.key === 'confirm')).toMatchObject({
      count: 1,
      late: 1,
    });
    expect((await store.api.get('/api/fms/my')).body.steps.map((s: { id: string }) => s.id)).toContain(
      stepId,
    );
  });

  it('calls webhooks, and takes records from the public form', async () => {
    const { api, company, sales } = await team();
    const flow = (await api.post('/api/fms/flows', { meta: { name: 'Complaints', runName: 'Complaint' } }))
      .body;
    await api.put(`/api/fms/flows/${flow.id}`, {
      meta: { coordinatorId: sales.id },
      definition: {
        startFields: [
          { key: 'name', label: 'Your name', type: 'text', required: true },
          { key: 'problem', label: 'Problem', type: 'longtext', required: true },
        ],
        steps: [
          {
            key: 'hook',
            name: 'Send to CRM',
            type: 'AUTO',
            auto: { action: 'webhook', url: 'https://crm.example.in/hook' },
          },
          { key: 'call', name: 'Call back', type: 'TASK', starter: true, time: t(4) },
        ],
      },
    });
    await api.post(`/api/fms/flows/${flow.id}/publish`);
    const link = (await api.post(`/api/fms/flows/${flow.id}/public`, { enabled: true })).body;

    const form = await ctx.app.inject({ method: 'GET', url: `/api/public/forms/${link.publicToken}` });
    const body = form.json() as { fields: { key: string }[]; challenge: { question: string; token: string } };
    expect(body.fields.map((f) => f.key)).toEqual(['name', 'problem']);
    const [a, b] = body.challenge.question.split(' + ').map(Number) as [number, number];
    const post = (answer: number, extra = {}) =>
      ctx.app.inject({
        method: 'POST',
        url: `/api/public/forms/${link.publicToken}`,
        payload: {
          data: { name: 'Ram', problem: 'Slab cracked on delivery' },
          challenge: body.challenge.token,
          answer,
          ...extra,
        },
      });
    expect((await post(a + b + 1)).statusCode).toBe(400);
    expect((await post(a + b, { website: 'spam.example' })).json()).toEqual({ ok: true, number: null });
    expect((await post(a + b)).json()).toEqual({ ok: true, number: 1 });

    const rec = await ctx.prisma.fmsRecord.findFirstOrThrow({
      where: { companyId: company.id, flowId: flow.id },
    });
    expect(rec.source).toBe('public');
    const calls: string[] = [];
    await runFmsWebhooks(ctx.prisma, (async (url: string) => {
      calls.push(url);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch);
    expect(calls).toContain('https://crm.example.in/hook');
    const steps = await ctx.prisma.fmsRecordStep.findMany({
      where: { recordId: rec.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(steps.map((s) => [s.stepKey, s.status])).toEqual([
      ['hook', 'DONE'],
      ['call', 'OPEN'],
    ]);
    // Started from the public form: the "starter" step goes to the coordinator.
    expect(steps[1]!.doerId).toBe(sales.id);
  });
});
