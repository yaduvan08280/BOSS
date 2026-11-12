import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@mono/db';
import { bootstrapCompany, startRecord } from '@mono/api/services';
import { notifyForEvent } from './engine';

const db = createPrisma();
afterAll(async () => db.$disconnect());
const deps = { db, appName: 'MONO', baseUrl: 'https://mono.example.in' };

describe("process messages name the record's values", () => {
  it('L18: a template uses {{data.<field>}} and {{data.<field>.<column>}}, filled from the record and its linked row', async () => {
    const tag = `${Date.now() % 1_000_000}`;
    const { company, owner } = await bootstrapCompany(db, {
      companyName: `Values ${tag}`,
      ownerName: 'Owner',
      ownerEmail: `val${tag}@x.in`,
      ownerPassword: 'Secret123',
    });
    const member = await db.role.findFirstOrThrow({ where: { companyId: company.id, key: 'MEMBER' } });
    const coordinator = await db.user.create({
      data: {
        companyId: company.id,
        code: `C-${tag}`,
        name: 'Mahesh Yadav',
        roleId: member.id,
        telegramChatId: `c${tag}`,
      },
    });
    const customer = await db.customer.create({
      data: {
        companyId: company.id,
        code: 'C-0001',
        name: 'Sharma Traders',
        city: 'Ajmer',
        mobile: '+919000012345',
      },
    });
    const definition = {
      timeModel: 'calendar',
      startFields: [
        { key: 'customer', label: 'Customer', type: 'master', master: 'customers', required: true },
        { key: 'qty', label: 'Qty', type: 'number' },
        { key: 'rate', label: 'Rate', type: 'amount' },
        { key: 'value', label: 'Value', type: 'formula', formula: 'qty * rate' },
      ],
      steps: [
        {
          key: 'pack',
          name: 'Pack',
          type: 'TASK',
          doerIds: [owner!.id],
          time: { value: 4, unit: 'hours', anchor: 'previous' },
          fields: [],
        },
      ],
    };
    const flow = await db.flow.create({
      data: {
        companyId: company.id,
        code: 'PRC-001',
        name: 'Orders',
        runName: 'Order',
        status: 'PUBLISHED',
        version: 1,
        dirty: false,
        draft: definition,
        coordinatorId: coordinator.id,
      },
    });
    const version = await db.flowVersion.create({
      data: { companyId: company.id, flowId: flow.id, version: 1, definition, publishedById: owner!.id },
    });
    await db.flow.update({ where: { id: flow.id }, data: { currentVersionId: version.id } });
    // The company's own wording for "a record was started", naming values of the record.
    await db.template.updateMany({
      where: { companyId: company.id, code: 'fms_record_started_tg', language: 'en' },
      data: {
        body: 'New order for {{data.customer}} of {{data.customer.city}} ({{data.customer.mobile}}): {{data.qty}} × {{data.rate}} = {{data.value}}. {{data.nothing}}',
      },
    });

    const record = await startRecord(db, {
      companyId: company.id,
      flowId: flow.id,
      data: {
        customer: 'Sharma Traders',
        qty: 12,
        rate: 1500.5,
        _refs: { customer: `customer:${customer.id}` },
      },
      startedById: owner!.id,
      source: 'web',
    });
    const event = await db.domainEvent.findFirstOrThrow({
      where: { companyId: company.id, entityId: record.id, name: 'fms.record_started' },
    });
    await notifyForEvent(event, deps);
    const sent = await db.outbox.findFirstOrThrow({
      where: { eventId: event.id, channel: 'telegram', userId: coordinator.id },
    });
    await db.outbox.updateMany({
      where: { companyId: company.id, status: 'QUEUED' },
      data: { status: 'SKIPPED' },
    });
    expect((sent.payload as { text: string }).text).toContain(
      'New order for Sharma Traders of Ajmer (+919000012345): 12 × ₹1,500.5 = 18,006. —',
    );
  });
});
