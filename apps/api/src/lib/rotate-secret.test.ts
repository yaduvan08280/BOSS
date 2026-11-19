import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, makeCompany } from '../test/helpers';
import { rotateSecrets } from './rotate-secret';
import { decryptJson, encryptJson } from './secrets';

describe('changing APP_SECRET', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => {
    ctx = await makeApp();
  });
  afterAll(async () => ctx.app.close());
  // The secret every other test seals with: rows they left behind open with it, and it is put back at the end.
  const OLD = 'test-secret-that-is-long-enough-1234567890';
  const NEW = 'new-secret-new-secret-new-secret-new-secret';

  it('re-seals every saved secret, signs everybody out, and changes nothing when the old secret is wrong', async () => {
    const db = ctx.prisma;
    const { company, owner } = await makeCompany(ctx.app);
    const ai = await db.aiConfig.create({
      data: {
        companyId: company.id,
        provider: 'openai',
        model: 'x',
        secret: encryptJson({ apiKey: 'sk-1' }, OLD),
      },
    });
    const hook = await db.webhook.create({
      data: {
        companyId: company.id,
        url: 'https://example.com/h',
        events: ['*'],
        secret: encryptJson({ secret: 'whsec_1' }, OLD),
        createdById: owner.id,
      },
    });
    await db.session.create({
      data: {
        companyId: company.id,
        userId: owner.id,
        tokenHash: `t-${ai.id}`,
        expiresAt: new Date(Date.now() + 1e7),
      },
    });

    await expect(rotateSecrets(db, 'not-the-old-secret-not-the-old-secret', NEW)).rejects.toThrow(
      /cannot be opened/,
    );
    expect(decryptJson((await db.aiConfig.findUniqueOrThrow({ where: { id: ai.id } })).secret, OLD)).toEqual({
      apiKey: 'sk-1',
    });

    const counts = await rotateSecrets(db, OLD, NEW);
    try {
      expect(counts['AI settings']).toBeGreaterThanOrEqual(1);
      expect(counts.webhooks).toBeGreaterThanOrEqual(1);
      expect(counts.sessions).toBeGreaterThanOrEqual(1);
      expect(
        decryptJson((await db.aiConfig.findUniqueOrThrow({ where: { id: ai.id } })).secret, NEW),
      ).toEqual({
        apiKey: 'sk-1',
      });
      expect(
        decryptJson((await db.webhook.findUniqueOrThrow({ where: { id: hook.id } })).secret, NEW),
      ).toEqual({
        secret: 'whsec_1',
      });
      expect(() => decryptJson(ai.secret, NEW)).toThrow();
      expect(await db.session.count({ where: { userId: owner.id, revokedAt: null } })).toBe(0);
    } finally {
      // And back — whatever happened above — so the tests that follow find their rows as they sealed them.
      await rotateSecrets(db, NEW, OLD);
    }
    expect(decryptJson((await db.aiConfig.findUniqueOrThrow({ where: { id: ai.id } })).secret, OLD)).toEqual({
      apiKey: 'sk-1',
    });
  });
});
