import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@mono/db';
import { actorFor, bootstrapCompany, createTask, sendTelegram } from '@mono/api/services';
import { addDays, localDate, zonedToUtc } from '@mono/shared';
import { markSeen, onText } from './bot-handlers';
import { workSummary } from './bot-work';
import { notifyForEvent } from './engine';

/** The silly-but-real things people do on Telegram, each pinned down by a test. */
const db = createPrisma();
afterAll(async () => db.$disconnect());
const TZ = 'Asia/Kolkata';

let tag = '';
let companyId = '';
let ownerId = '';
let driverId = '';
const scope = () => ({ companyIds: [companyId] });
const ownerChat = () => `o${tag}`;
const driverChat = () => `d${tag}`;

beforeAll(async () => {
  tag = `${Date.now() % 1_000_000}${Math.floor(Math.random() * 100)}`;
  const { company, owner } = await bootstrapCompany(db, {
    companyName: `Bot Edge ${tag}`,
    ownerName: 'Owner',
    ownerEmail: `edge${tag}@x.in`,
    ownerPassword: 'Secret123',
  });
  companyId = company.id;
  ownerId = owner!.id;
  const role = await db.role.findFirstOrThrow({ where: { companyId, key: 'MEMBER' } });
  const driver = await db.user.create({
    data: {
      companyId,
      code: `E-${tag}`,
      name: 'Ramesh Gurjar',
      roleId: role.id,
      telegramChatId: driverChat(),
    },
  });
  driverId = driver.id;
  await db.user.update({ where: { id: ownerId }, data: { telegramChatId: ownerChat() } });
});

async function giveTask(description: string, plannedAt: Date, extra: { requireProof?: boolean } = {}) {
  const actor = (await actorFor(db, companyId, ownerId))!;
  return db.$transaction((tx) =>
    createTask(tx, actor, {
      doerId: driverId,
      plannedAt: plannedAt.toISOString(),
      description,
      requireProof: extra.requireProof ?? false,
    }),
  );
}

describe('commands', () => {
  it('/done with no number lists open tasks as Done buttons; /done@bot and /move work', async () => {
    const t = await giveTask('Change truck tyres', new Date(Date.now() + 5 * 3600_000));
    await db.task.update({ where: { id: t.id }, data: { status: 'OPEN', acceptedAt: new Date() } });

    const list = await onText(db, scope(), driverChat(), '/done', 'MONO');
    expect(list.text).toMatch(/which task is done/i);
    expect(list.buttons).toEqual([{ label: `✅ Done #${t.number}`, data: `act:done:task:${t.id}` }]);

    const moved = await onText(
      db,
      scope(),
      driverChat(),
      `/move ${t.number} 05/11/2026 18:00 tyre shop closed`,
      'MONO',
    );
    expect(moved.text).toContain('moved to 05/11/2026 18:00');
    const bad = await onText(db, scope(), driverChat(), `/move ${t.number} 31/02/2026 18:00 wrong`, 'MONO');
    expect(bad.text).toContain('is not a date');

    const done = await onText(
      db,
      scope(),
      driverChat(),
      `/done@Monobuddy_bot ${t.number} changed all six`,
      'MONO',
    );
    expect(done.text).toMatch(/sent for verification|done\./);
    expect(await db.task.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({
      doneNote: 'changed all six',
    });
  });

  it('unknown commands get help; plain text from the owner is an EA capture, from staff a hello', async () => {
    expect((await onText(db, scope(), driverChat(), '/hello', 'MONO')).text).toContain("I don't know /hello");
    expect((await onText(db, scope(), driverChat(), 'Why', 'MONO')).text).toContain("You're linked");
    expect((await onText(db, scope(), ownerChat(), 'Call the tyre dealer', 'MONO')).text).toMatch(
      /Captured #\d+/,
    );
    expect((await onText(db, scope(), 'nobody', '/my', 'MONO')).text).toContain('not linked');
  });
});

describe('/today', () => {
  it('means due before midnight (company time) plus anything late; later work is counted, not hidden', async () => {
    const now = zonedToUtc(localDate(new Date(), TZ), 12 * 60, TZ); // today 12:00 IST
    const today = localDate(now, TZ);
    const late = await giveTask('Late one', zonedToUtc(addDays(today, -1), 17 * 60, TZ));
    const tonight = await giveTask('Due tonight', zonedToUtc(today, 23 * 60 + 30, TZ));
    const tomorrow = await giveTask('Due tomorrow', zonedToUtc(addDays(today, 1), 30, TZ));
    const w = await workSummary(db, { id: driverId, companyId }, true, now);
    const text = w.lines.join('\n');
    expect(text).toContain(`#${late.number} Late one`);
    expect(text).toContain('⚠️ late');
    expect(text).toContain(`#${tonight.number} Due tonight`);
    expect(text).not.toContain(`#${tomorrow.number}`);
    expect(w.later).toBeGreaterThanOrEqual(1);
    expect(w.buttons.some((b) => b.label === `👍 Accept #${tonight.number}`)).toBe(true);
  });

  it('shows tasks to verify even when the verifier is the creator by default (no name on the task)', async () => {
    const t = await giveTask('Wash the truck', new Date(Date.now() + 3600_000));
    await db.task.update({ where: { id: t.id }, data: { status: 'PENDING_VERIFY', doneAt: new Date() } });
    const r = await onText(db, scope(), ownerChat(), '/my', 'MONO');
    expect(r.text).toContain(`#${t.number} Wash the truck — waiting for you to verify`);
    expect(r.buttons).toContainEqual({ label: `🔍 Verify #${t.number}`, data: `act:verify:task:${t.id}` });
  });
});

describe('seen without a Seen button', () => {
  it('anything the person does in the chat marks what we delivered there as read; nothing else', async () => {
    const make = async (title: string, sentOnTelegram: boolean) => {
      const ev = await db.domainEvent.create({
        data: { companyId, name: 'notify.test', entityType: 'user', entityId: driverId, payload: {} },
      });
      const n = await db.notification.create({
        data: { companyId, userId: driverId, title, eventId: ev.id },
      });
      if (sentOnTelegram)
        await db.outbox.create({
          data: {
            companyId,
            eventId: ev.id,
            channel: 'telegram',
            userId: driverId,
            to: driverChat(),
            payload: {},
            status: 'SENT',
            sentAt: new Date(Date.now() - 1000),
          },
        });
      return n;
    };
    const onTg = await make('Seen on Telegram', true);
    const appOnly = await make('Only in the app', false);
    expect(await markSeen(db, scope(), driverChat())).toBe(1);
    expect((await db.notification.findUniqueOrThrow({ where: { id: onTg.id } })).readAt).not.toBeNull();
    expect((await db.notification.findUniqueOrThrow({ where: { id: appOnly.id } })).readAt).toBeNull();
    expect(await markSeen(db, scope(), 'stranger')).toBe(0);
  });
});

describe('proof reaches the verifier', () => {
  it('the "done, please verify" Telegram message carries the doer\'s photos', async () => {
    const t = await giveTask('Fit new tyres', new Date(Date.now() + 3600_000), { requireProof: true });
    await db.task.update({ where: { id: t.id }, data: { status: 'OPEN' } });
    const file = await db.attachment.create({
      data: {
        companyId,
        entityType: 'upload',
        entityId: driverId,
        path: `${companyId}/tyre.jpg`,
        mime: 'image/jpeg',
        size: 3,
        originalName: 'tyre.jpg',
        uploadedById: driverId,
      },
    });
    const driver = (await actorFor(db, companyId, driverId))!;
    const { actOnTask } = await import('@mono/api/services');
    await actOnTask(db, driver, t.id, {
      action: 'markDone',
      note: 'All six changed',
      attachmentIds: [file.id],
    });
    const event = await db.domainEvent.findFirstOrThrow({
      where: { companyId, name: 'delegation.done', entityId: t.id },
    });
    expect((event.payload as { proof: string[] }).proof).toEqual([file.id]);
    await notifyForEvent(event, { db, appName: 'MONO', baseUrl: 'https://mono.example.in' });
    const tg = await db.outbox.findFirstOrThrow({
      where: { eventId: event.id, channel: 'telegram', userId: ownerId },
    });
    const msg = tg.payload as { files: { path: string; mime: string }[]; buttons: { label: string }[] };
    expect(msg.files).toEqual([{ path: `${companyId}/tyre.jpg`, mime: 'image/jpeg', name: 'tyre.jpg' }]);
    expect(msg.buttons[0]!.label).toBe('Verify');
  });
});

describe('sending files to Telegram', () => {
  type Call = { method: string; body: unknown };
  const fakeFetch = (calls: Call[]) =>
    (async (url: string, init: { body: unknown }) => {
      calls.push({ method: String(url).split('/').pop()!, body: init.body });
      return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }));
    }) as unknown as typeof fetch;
  const msg = (files: { path: string; mime: string; name: string }[]) => ({
    text: 'Task #1 done, please verify',
    buttons: [{ label: 'Verify', data: 'act:verify:task:x' }],
    files,
  });
  const read = async (p: string) => {
    if (p === 'missing.jpg') throw new Error('gone');
    return Buffer.from('img');
  };

  it('one photo goes with the text and buttons as its caption', async () => {
    const calls: Call[] = [];
    const r = await sendTelegram(
      't',
      '42',
      msg([{ path: 'a.jpg', mime: 'image/jpeg', name: 'a.jpg' }]),
      fakeFetch(calls),
      read,
    );
    expect(calls.map((c) => c.method)).toEqual(['sendPhoto']);
    const form = calls[0]!.body as FormData;
    expect(form.get('caption')).toBe('Task #1 done, please verify');
    expect(JSON.parse(String(form.get('reply_markup'))).inline_keyboard[0][0].text).toBe('Verify');
    expect(r.providerId).toBe('42:1');
  });

  it('several photos make an album, documents follow, then the text with the buttons', async () => {
    const calls: Call[] = [];
    await sendTelegram(
      't',
      '42',
      msg([
        { path: 'a.jpg', mime: 'image/jpeg', name: 'a.jpg' },
        { path: 'b.jpg', mime: 'image/png', name: 'b.png' },
        { path: 'c.pdf', mime: 'application/pdf', name: 'bill.pdf' },
      ]),
      fakeFetch(calls),
      read,
    );
    expect(calls.map((c) => c.method)).toEqual(['sendMediaGroup', 'sendDocument', 'sendMessage']);
  });

  it('a missing file never blocks the message', async () => {
    const calls: Call[] = [];
    await sendTelegram(
      't',
      '42',
      msg([{ path: 'missing.jpg', mime: 'image/jpeg', name: 'x.jpg' }]),
      fakeFetch(calls),
      read,
    );
    expect(calls.map((c) => c.method)).toEqual(['sendMessage']);
    expect(JSON.parse(String(calls[0]!.body)).text).toContain('could not be attached');
  });
});
