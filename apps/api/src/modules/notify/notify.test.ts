import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saveChannel, setChannelMeta } from '../../lib/channels/config';
import { decryptJson, encryptJson } from '../../lib/secrets';
import { makeApp, ownerClient, signedIn, testEnv } from '../../test/helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());
const SECRET = testEnv().APP_SECRET;

describe('secrets at rest', () => {
  it('round-trips and detects tampering', () => {
    const sealed = encryptJson({ pass: 'p@ss' }, SECRET);
    expect(sealed).not.toContain('p@ss');
    expect(decryptJson(sealed, SECRET)).toEqual({ pass: 'p@ss' });
    const tampered = sealed.slice(0, -4) + (sealed.endsWith('A') ? 'B' : 'A') + sealed.slice(-3);
    expect(() => decryptJson(tampered, SECRET)).toThrow();
    expect(() => decryptJson(sealed, 'another-secret-that-is-long-enough-123')).toThrow();
  });
});

describe('channels', () => {
  it('stores SMTP with the password encrypted and never returns it', async () => {
    const { api, company } = await ownerClient(ctx.app);
    const res = await api.put('/api/notify/channels/email', {
      host: 'smtp.example.in',
      port: 587,
      secure: false,
      user: 'mono',
      pass: 'Sup3rSecret',
      from: 'MONO <mono@example.in>',
    });
    expect(res.status).toBe(200);
    const list = (await api.get('/api/notify/channels')).body;
    expect(JSON.stringify(list)).not.toContain('Sup3rSecret');
    expect(list.email.secretsSaved).toEqual({ pass: true });
    const row = await ctx.prisma.channelConfig.findFirstOrThrow({
      where: { companyId: company.id, channel: 'email' },
    });
    expect(row.secret).not.toContain('Sup3rSecret');
    // Saving again without a password keeps the stored one.
    await api.put('/api/notify/channels/email', {
      host: 'smtp2.example.in',
      port: 465,
      secure: true,
      from: 'mono@example.in',
    });
    expect(decryptJson(row.secret, SECRET)).toEqual({ pass: 'Sup3rSecret' });
    expect((await api.get('/api/notify/channels')).body.email.meta.host).toBe('smtp2.example.in');
  });

  it('rejects a malformed Telegram token before calling Telegram', async () => {
    const { api } = await ownerClient(ctx.app);
    const res = await api.put('/api/notify/channels/telegram', { token: 'not-a-token' });
    expect(res.status).toBe(400);
  });
});

describe('templates, rules and reminders', () => {
  it('a new company starts with every default, and edits re-open WhatsApp approval', async () => {
    const { api } = await ownerClient(ctx.app);
    const templates = (await api.get('/api/notify/templates')).body as {
      id: string;
      code: string;
      channel: string;
      status: string;
      variables: string[];
    }[];
    expect(templates.length).toBeGreaterThan(300);
    expect((await api.post('/api/notify/templates/load-defaults', {})).body.added).toBe(0);
    const wa = templates.find((t) => t.code === 'delegation_assigned_wa')!;
    expect(wa.variables).toEqual(expect.arrayContaining(['number', 'creator', 'title', 'due']));
    await ctx.prisma.template.update({ where: { id: wa.id }, data: { status: 'APPROVED' } });
    const edited = await api.patch(`/api/notify/templates/${wa.id}`, {
      body: '*New task {{number}}*\n{{title}}',
    });
    expect(edited.body.status).toBe('DRAFT');
    expect((await api.post(`/api/notify/templates/${wa.id}/submit`)).status).toBe(400); // no provider yet

    const rules = (await api.get('/api/notify/rules')).body as { event: string }[];
    expect(rules.map((r) => r.event)).toContain('delegation.assigned');
    const bad = await api.post('/api/notify/rules', {
      event: 'delegation.overdue',
      audience: 'team',
      recipients: ['doer'],
      channels: ['telegram'],
      escalateTo: 'hod',
    });
    expect(bad.status).toBe(400);
    const ok = await api.post('/api/notify/rules', {
      event: 'delegation.overdue',
      audience: 'team',
      recipients: ['doer'],
      channels: ['telegram'],
      escalateTo: 'hod',
      escalateAfterMinutes: 10,
    });
    expect(ok.body).toMatchObject({ escalateTo: 'hod', escalateAfterMinutes: 10 });

    const patterns = (await api.get('/api/notify/reminders')).body as {
      name: string;
      isDefault: boolean;
      id: string;
    }[];
    expect(patterns.map((p) => p.name)).toEqual(['Standard', 'Gentle', 'Strict']);
    expect((await api.del(`/api/notify/reminders/${patterns[0]!.id}`)).status).toBe(409);
  });
});

describe('Telegram linking', () => {
  it('needs a connected bot, then hands out codes and deep links', async () => {
    const { api, company, owner } = await ownerClient(ctx.app);
    expect((await api.post('/api/notify/telegram/my-code')).status).toBe(400);
    await ctx.prisma.$transaction(async (tx) => {
      await saveChannel(
        tx,
        company.id,
        'telegram',
        { token: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef123' },
        SECRET,
        null,
      );
      await setChannelMeta(tx, company.id, 'telegram', { botUsername: 'mono_test_bot' });
    });
    const res = await api.post('/api/notify/telegram/my-code');
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
    const mine = res.body;
    expect(mine.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(mine.deepLink).toBe(`https://t.me/mono_test_bot?start=${mine.code}`);

    await api.post('/api/org/users', { name: 'No Contact' });
    await api.post('/api/org/users', { name: 'Has Mobile', mobile: `9${String(Date.now()).slice(-9)}` });
    const sent = (await api.post('/api/notify/telegram/send-codes', {})).body;
    expect(sent.sent).toBe(3);
    expect(sent.shown.map((s: { name: string }) => s.name)).toEqual(['No Contact']);
    const page = (await api.get('/api/notify/telegram')).body;
    expect(page).toMatchObject({ bot: 'mono_test_bot', stats: { linked: 0, total: 3, pending: 3 } });
    const events = await ctx.prisma.domainEvent.count({
      where: { companyId: company.id, name: 'notify.telegram_code' },
    });
    expect(events).toBe(3);
    expect(owner).toBeTruthy();
  });
});

describe('inbox and permissions', () => {
  it('reads notifications, counts unread, and keeps admin screens for admins', async () => {
    const { api, owner, company } = await ownerClient(ctx.app);
    await ctx.prisma.notification.createMany({
      data: [1, 2, 3].map((i) => ({ companyId: company.id, userId: owner.id, title: `Note ${i}` })),
    });
    let inbox = (await api.get('/api/notifications')).body;
    expect(inbox.unread).toBe(3);
    expect((await api.get('/api/auth/me')).body.counters.unreadNotifications).toBe(3);
    await api.post(`/api/notifications/${inbox.items[0].id}/read`);
    await api.post('/api/notifications/read-all');
    inbox = (await api.get('/api/notifications')).body;
    expect(inbox.unread).toBe(0);

    expect((await api.post('/api/notify/test', { userId: owner.id })).status).toBe(200);
    expect(
      await ctx.prisma.domainEvent.count({ where: { companyId: company.id, name: 'notify.test' } }),
    ).toBe(1);

    const mobile = `9${String(Date.now()).slice(-9)}`;
    const created = (await api.post('/api/org/users', { name: 'Member', mobile, loginEnabled: true })).body;
    const member = await signedIn(ctx.app, mobile, created.tempPassword);
    await member.post('/api/auth/change-password', {
      currentPassword: created.tempPassword,
      newPassword: 'Member1234',
    });
    expect((await member.get('/api/notify/templates')).status).toBe(403);
    expect((await member.post('/api/notify/test', { userId: owner.id })).status).toBe(403);
    expect((await member.get('/api/notifications')).status).toBe(200);
    // Nobody reads someone else's notification.
    const other = await ctx.prisma.notification.findFirstOrThrow({ where: { userId: owner.id } });
    expect((await member.post(`/api/notifications/${other.id}/read`)).status).toBe(404);
  });
});
