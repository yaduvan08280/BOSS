import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@mono/db';
import { actorFor, bootstrapCompany, createTask } from '@mono/api/services';
import { onAction, onCommand, onMy } from './bot-handlers';

const db = createPrisma();
afterAll(async () => db.$disconnect());

describe('work from Telegram', () => {
  it('accepts, moves, needs proof, finishes and verifies — same rules as the web', async () => {
    const tag = `${Date.now() % 1_000_000}`;
    const { company, owner } = await bootstrapCompany(db, {
      companyName: `Bot Work ${tag}`,
      ownerName: 'Owner',
      ownerEmail: `o${tag}@x.in`,
      ownerPassword: 'Secret123',
    });
    const role = await db.role.findFirstOrThrow({ where: { companyId: company.id, key: 'MEMBER' } });
    const doer = await db.user.create({
      data: {
        companyId: company.id,
        code: `B-${tag}`,
        name: 'Sandeep',
        roleId: role.id,
        telegramChatId: `d${tag}`,
      },
    });
    await db.user.update({ where: { id: owner!.id }, data: { telegramChatId: `o${tag}` } });
    const scope = { companyIds: [company.id] };
    const ownerActor = (await actorFor(db, company.id, owner!.id))!;
    const task = await db.$transaction((tx) =>
      createTask(tx, ownerActor, {
        doerId: doer.id,
        verifierId: owner!.id,
        plannedAt: new Date(Date.now() + 3600_000).toISOString(),
        description: 'Calibrate press 2',
        requireProof: true,
      }),
    );

    expect(await onAction(db, scope, `o${tag}`, `act:accept:task:${task.id}`)).toContain("isn't yours");
    expect(await onAction(db, scope, `d${tag}`, `act:accept:task:${task.id}`)).toContain('Accepted #1');
    expect((await onMy(db, scope, `d${tag}`, 'MONO')).text).toContain('#1 Calibrate press 2');
    expect(await onCommand(db, scope, `d${tag}`, 'move', '1 31/12 18:00 waiting for spare part')).toMatch(
      /moved to 31\/12\/\d{4} 18:00/,
    );
    expect(await onAction(db, scope, `d${tag}`, `act:done:task:${task.id}`)).toContain(
      'Reply to the task message with a photo',
    );

    await db.attachment.create({
      data: {
        companyId: company.id,
        entityType: 'task',
        entityId: task.id,
        path: 'p.jpg',
        mime: 'image/jpeg',
        size: 1,
        originalName: 'p.jpg',
        uploadedById: doer.id,
      },
    });
    expect(await onCommand(db, scope, `d${tag}`, 'done', '1 both gauges set')).toContain(
      'sent for verification',
    );
    expect((await onMy(db, scope, `o${tag}`, 'MONO')).text).toContain('waiting for you to verify');
    expect(await onAction(db, scope, `o${tag}`, `act:verify:task:${task.id}`)).toContain('verified');
    const t = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(t).toMatchObject({ status: 'DONE', revisionCount: 1, doneNote: 'both gauges set' });
    expect(await onCommand(db, scope, `d${tag}`, 'done', '99')).toContain('no task #99');
  });
});
