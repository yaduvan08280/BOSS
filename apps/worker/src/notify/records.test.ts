import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@mono/db';
import {
  actorFor,
  addRecordNote,
  bootstrapCompany,
  createRecord,
  createRecordType,
  moveRecord,
} from '@mono/api/services';
import { notifyForEvent } from './engine';

const db = createPrisma();
afterAll(async () => db.$disconnect());
const deps = { db, appName: 'MONO', baseUrl: 'https://mono.example.in' };

describe('notification rules for custom records', () => {
  it('U7: a status change and a note reach the record\'s creator, never the person who did it; "added" is off until asked for', async () => {
    const tag = `${Date.now() % 1_000_000}`;
    const { company, owner } = await bootstrapCompany(db, {
      companyName: `Records ${tag}`,
      ownerName: 'Owner',
      ownerEmail: `rec${tag}@x.in`,
      ownerPassword: 'Secret123',
    });
    const member = await db.role.findFirstOrThrow({ where: { companyId: company.id, key: 'MEMBER' } });
    const asha = await db.user.create({
      data: { companyId: company.id, code: `A-${tag}`, name: 'Asha Meena', roleId: member.id },
    });
    const ownerActor = (await actorFor(db, company.id, owner!.id))!;
    const ashaActor = (await actorFor(db, company.id, asha.id))!;
    const type = await createRecordType(db, ownerActor, {
      name: 'Site visit',
      pluralName: 'Site visits',
      prefix: 'SV',
      definition: {
        fields: [{ key: 'site', label: 'Site', type: 'text', required: true }],
        tables: [],
        statuses: [
          { key: 'planned', label: 'Planned', kind: 'info' },
          { key: 'confirmed', label: 'Confirmed', kind: 'ok', final: true },
        ],
        start: 'planned',
        moves: [{ from: 'planned', action: 'confirm', label: 'Confirm', to: 'confirmed', who: ['approve'] }],
      },
      menu: { section: 'masters', icon: 'file-text' },
    });
    // The built-in rules: status changes and notes are on, "a record was added" starts switched off.
    const rules = await db.notificationRule.findMany({
      where: { companyId: company.id, event: { startsWith: 'record.' } },
      orderBy: { event: 'asc' },
    });
    expect(rules.map((r) => [r.event, r.active, r.recipients])).toEqual([
      ['record.created', false, ['owner']],
      ['record.note', true, ['creator']],
      ['record.status_changed', true, ['creator']],
    ]);

    // Asha makes a visit; the owner confirms it and writes a note.
    const visit = await createRecord(db, ashaActor, type.id, { data: { site: 'Tonk mine' } });
    await moveRecord(db, ownerActor, visit.id, { action: 'confirm', note: 'Go ahead' });
    await addRecordNote(db, ownerActor, visit.id, 'Take the survey kit');
    const events = await db.domainEvent.findMany({
      where: { companyId: company.id, entityId: visit.id },
      orderBy: { occurredAt: 'asc' },
    });
    for (const e of events) await notifyForEvent(e, deps);
    await db.outbox.updateMany({
      where: { companyId: company.id, status: 'QUEUED' },
      data: { status: 'SKIPPED' },
    });

    const inbox = await db.notification.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: 'asc' },
    });
    // Nothing for the owner (their own actions; and "added" is off), two for Asha.
    expect(inbox.filter((n) => n.userId === owner!.id)).toHaveLength(0);
    const hers = inbox.filter((n) => n.userId === asha.id);
    expect(hers.map((n) => [n.title, n.body, n.link])).toEqual([
      [
        `Site visit ${visit.code} · Tonk mine: Confirmed`,
        'Owner — Confirm: Planned → Confirmed. Note: Go ahead',
        `/records/${type.id}?record=${visit.id}`,
      ],
      [
        `Note on Site visit ${visit.code} · Tonk mine`,
        'Owner: Take the survey kit',
        `/records/${type.id}?record=${visit.id}`,
      ],
    ]);

    // Asha's own note on her own record tells nobody.
    await addRecordNote(db, ashaActor, visit.id, 'Kit packed');
    const own = await db.domainEvent.findFirstOrThrow({
      where: { companyId: company.id, entityId: visit.id, name: 'record.note', actorId: asha.id },
    });
    await notifyForEvent(own, deps);
    expect(await db.notification.count({ where: { companyId: company.id } })).toBe(2);
  });
});
