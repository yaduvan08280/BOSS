import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createPrisma, type DomainEvent } from '@mono/db';
import { loadEnv } from '@mono/api/env';
import {
  bootstrapCompany,
  ChannelError,
  LocalDiskStorage,
  newLinkCode,
  recordChange,
} from '@mono/api/services';
import { onAck, onCode, onMy, onProof } from './bot-handlers';
import { notifyForEvent } from './engine';
import { processEscalations } from './escalations';
import { sendDue, type SenderDeps } from './outbox';

const db = createPrisma();
const env = loadEnv({
  ...process.env,
  APP_SECRET: 'x'.repeat(40),
  BASE_URL: 'https://mono.example.in',
  LOG_LEVEL: 'silent',
});
const deps = { db, appName: 'MONO', baseUrl: 'https://mono.example.in' };
let seq = 0;

async function newCompany() {
  seq += 1;
  const tag = `${Date.now() % 1_000_000}${seq}`;
  const { company, owner } = await bootstrapCompany(db, {
    companyName: `Notify Co ${tag}`,
    ownerName: 'Owner',
    ownerEmail: `owner${tag}@example.in`,
    ownerPassword: 'Secret123',
  });
  return { company, owner: owner!, tag };
}

async function emit(
  companyId: string,
  name: string,
  payload: Record<string, unknown>,
  actorId: string | null = null,
) {
  const signal = await db.$transaction((tx) =>
    recordChange(
      tx,
      { companyId, actorId },
      { event: name, entityType: 'user', entityId: String(payload.userId ?? payload.doerId ?? 'x'), payload },
    ),
  );
  return db.domainEvent.findUniqueOrThrow({ where: { id: signal.id } }) as Promise<DomainEvent>;
}

afterAll(async () => db.$disconnect());

describe('engine', () => {
  it('creates in-app + queues Telegram and email, skips what cannot be sent, once per event', async () => {
    const { company, owner } = await newCompany();
    await db.user.update({ where: { id: owner.id }, data: { telegramChatId: '111' } });
    const event = await emit(company.id, 'notify.test', { userId: owner.id }, owner.id);
    expect(await notifyForEvent(event, deps)).toBe(2);
    const rows = await db.outbox.findMany({ where: { eventId: event.id }, orderBy: { channel: 'asc' } });
    expect(rows.map((r) => [r.channel, r.status])).toEqual([
      ['email', 'QUEUED'],
      ['telegram', 'QUEUED'],
      ['whatsapp', 'SKIPPED'],
    ]);
    expect(rows.find((r) => r.channel === 'whatsapp')!.lastError).toContain('mobile');
    const tg = rows.find((r) => r.channel === 'telegram')!.payload as {
      text: string;
      buttons: { label: string }[];
    };
    expect(tg.text).toContain('Hello Owner');
    expect(tg.buttons.map((b) => b.label)).toEqual(['Seen ✓', 'Open']);
    const inapp = await db.notification.findMany({ where: { eventId: event.id } });
    expect(inapp).toHaveLength(1);
    expect(await notifyForEvent(event, deps)).toBe(0);
  });

  it('skips channels the company has not set up', async () => {
    const { company, owner } = await newCompany();
    await db.user.update({ where: { id: owner.id }, data: { telegramChatId: '333' } });
    const event = await emit(company.id, 'notify.test', { userId: owner.id });
    await notifyForEvent(event, { ...deps, available: async () => new Set(['telegram']) });
    const rows = await db.outbox.findMany({ where: { eventId: event.id }, orderBy: { channel: 'asc' } });
    expect(rows.map((r) => [r.channel, r.status, r.lastError])).toEqual([
      ['email', 'SKIPPED', 'email is not set up'],
      ['telegram', 'QUEUED', null],
      ['whatsapp', 'SKIPPED', 'whatsapp is not set up'],
    ]);
  });

  it('holds messages during the person’s quiet hours', async () => {
    const { company, owner } = await newCompany();
    const local = new Intl.DateTimeFormat('en-GB', {
      timeZone: company.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const hhmm = (d: Date) => local.format(d);
    const end = new Date(Date.now() + 60 * 60_000);
    await db.user.update({
      where: { id: owner.id },
      data: {
        telegramChatId: '222',
        prefs: { quietHours: { start: hhmm(new Date(Date.now() - 60 * 60_000)), end: hhmm(end) } },
      },
    });
    const event = await emit(company.id, 'delegation.assigned', {
      doerId: owner.id,
      number: 70,
      title: 'Calibrate press',
      due: new Date().toISOString(),
    });
    await notifyForEvent(event, deps);
    const tg = await db.outbox.findFirstOrThrow({ where: { eventId: event.id, channel: 'telegram' } });
    expect(Math.abs(tg.sendAfter.getTime() - end.getTime())).toBeLessThan(61_000);
    expect((tg.payload as { text: string }).text).toContain('Calibrate press');
  });

  it('puts the task buttons on Telegram messages (Verify for the verifier)', async () => {
    const { company, owner } = await newCompany();
    await db.user.update({ where: { id: owner.id }, data: { telegramChatId: '444' } });
    const event = await emit(company.id, 'delegation.done', {
      doerId: 'someone-else',
      verifierId: owner.id,
      number: 71,
      title: 'Grease bearings',
      due: new Date().toISOString(),
      telegramActions: ['verify'],
    });
    await notifyForEvent(event, deps);
    const tg = await db.outbox.findFirstOrThrow({
      where: { eventId: event.id, channel: 'telegram', userId: owner.id },
    });
    const buttons = (tg.payload as { buttons: { label: string; data?: string }[] }).buttons;
    expect(buttons[0]).toEqual({ label: 'Verify', data: `act:verify:user:${event.entityId}` });
  });
});

describe('outbox sender', () => {
  const fakeClients: SenderDeps['clientsFor'] = async () => ({
    telegram: { token: 't', groupChatId: null, botUsername: 'b' },
    email: { transport: {} as never, from: 'a@b.in' },
    whatsapp: null,
    push: null,
  });

  it('sends, retries with backoff, and gives up on permanent errors', async () => {
    const { company } = await newCompany();
    const base = { companyId: company.id, payload: { text: 'hi' } };
    const ok = await db.outbox.create({
      data: { ...base, channel: 'telegram', to: 'ok', templateCode: 'notify_test_tg' },
    });
    const flaky = await db.outbox.create({ data: { ...base, channel: 'telegram', to: 'flaky' } });
    const bad = await db.outbox.create({ data: { ...base, channel: 'telegram', to: 'blocked' } });
    const telegram = vi.fn(async (_t: string, to: string) => {
      if (to === 'flaky') throw new ChannelError('Telegram: Too Many Requests');
      if (to === 'blocked') throw new ChannelError('Telegram: bot was blocked by the user', false);
      return { providerId: `${to}:1` };
    });
    await sendDue({ db, env, clientsFor: fakeClients, senders: { telegram } });
    const [a, b, c] = await Promise.all(
      [ok, flaky, bad].map((r) => db.outbox.findUniqueOrThrow({ where: { id: r.id } })),
    );
    expect(a).toMatchObject({ status: 'SENT', providerId: 'ok:1', tries: 1 });
    expect(b).toMatchObject({ status: 'QUEUED', tries: 1 });
    expect(b!.sendAfter.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(c).toMatchObject({ status: 'FAILED', tries: 1 });
    expect(
      (
        await db.template.findFirstOrThrow({
          where: { companyId: company.id, code: 'notify_test_tg', language: 'en' },
        })
      ).sentCount,
    ).toBe(1);
  });
});

describe('escalations', () => {
  it('escalates to the HOD when nobody answers, and not when they do', async () => {
    const { company, owner, tag } = await newCompany();
    const dept = await db.department.create({
      data: { companyId: company.id, name: 'Maintenance', hodUserId: owner.id },
    });
    const role = await db.role.findFirstOrThrow({ where: { companyId: company.id, key: 'MEMBER' } });
    const mk = (n: string) =>
      db.user.create({
        data: {
          companyId: company.id,
          code: `T-${n}${tag}`,
          name: n,
          roleId: role.id,
          mainDepartmentId: dept.id,
        },
      });
    const [sandeep, lalit] = [await mk('Sandeep'), await mk('Lalit')];
    await db.notificationRule.updateMany({
      where: { companyId: company.id, event: 'notify.test' },
      data: { escalateTo: 'hod', escalateAfterMinutes: 10, channels: ['inapp'] },
    });

    const e1 = await emit(company.id, 'notify.test', { userId: sandeep.id });
    const e2 = await emit(company.id, 'notify.test', { userId: lalit.id });
    await notifyForEvent(e1, deps);
    await notifyForEvent(e2, deps);
    const waits = await db.escalation.findMany({ where: { companyId: company.id } });
    expect(waits).toHaveLength(2);
    expect(waits[0]!.dueAt.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);

    await db.notification.updateMany({ where: { eventId: e2.id }, data: { readAt: new Date() } }); // Lalit answered
    await db.escalation.updateMany({
      where: { companyId: company.id },
      data: { dueAt: new Date(Date.now() - 1000) },
    });
    expect(await processEscalations(db)).toMatchObject({ escalated: 1 });
    const statuses = await db.escalation.findMany({
      where: { companyId: company.id },
      orderBy: { userId: 'asc' },
    });
    expect(statuses.map((s) => s.status).sort()).toEqual(['ANSWERED', 'ESCALATED']);

    const up = await db.domainEvent.findFirstOrThrow({
      where: { companyId: company.id, name: 'notify.escalation' },
    });
    expect((up.payload as { userId: string }).userId).toBe(owner.id);
    await notifyForEvent(up, deps);
    const n = await db.notification.findFirstOrThrow({ where: { eventId: up.id } });
    expect(n).toMatchObject({ userId: owner.id, tone: 'warn' });
    expect(n.title).toContain('No reply');
  });
});

describe('Telegram bot', () => {
  it('links with a code, lists work, marks seen and saves photo proof', async () => {
    const { company, owner } = await newCompany();
    const scope = { companyIds: [company.id] };
    const chatId = `9${Date.now()}`;
    expect(await onMy(db, scope, chatId, 'MONO')).toContain('not linked');
    const code = await db.$transaction((tx) => newLinkCode(tx, company.id, owner.id, 'screen'));
    expect(await onCode(db, chatId, code.code.toLowerCase(), 'MONO')).toContain('Linked');
    expect(await onCode(db, chatId, code.code, 'MONO')).toContain('already used');

    const event = await emit(company.id, 'notify.test', { userId: owner.id });
    await notifyForEvent(event, deps);
    expect(await onMy(db, scope, chatId, 'MONO')).toContain('Test message');
    const n = await db.notification.findFirstOrThrow({ where: { eventId: event.id } });
    expect(await onAck(db, scope, chatId, n.id)).toContain('seen');
    expect((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt).not.toBeNull();

    const sent = await db.outbox.findFirstOrThrow({ where: { eventId: event.id, channel: 'telegram' } });
    await db.outbox.update({ where: { id: sent.id }, data: { providerId: `${chatId}:55` } });
    const storage = new LocalDiskStorage(mkdtempSync(join(tmpdir(), 'mono-proof-')));
    const reply = await onProof(db, storage, scope, chatId, 55, async () => ({
      data: Buffer.from('jpg'),
      mime: 'image/jpeg',
      name: 'p.jpg',
    }));
    expect(reply).toContain('proof');
    expect(await db.attachment.count({ where: { companyId: company.id, entityId: owner.id } })).toBe(1);
  });
});
