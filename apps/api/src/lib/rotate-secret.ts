import type { Db } from '@mono/db';
import { decryptJson, encryptJson } from './secrets';

/**
 * Changing APP_SECRET (after it may have leaked): every saved secret — channel settings, AI keys, webhook
 * signing secrets, the Drive sign-in, integration keys — is opened with the old secret and sealed again with
 * the new one, all in one transaction: either every row is re-sealed or none is. A row the old secret cannot
 * open stops everything (the old secret given is the wrong one).
 */
export async function rotateSecrets(db: Db, oldSecret: string, newSecret: string) {
  if (newSecret.length < 32) throw new Error('The new APP_SECRET must be at least 32 characters');
  if (oldSecret === newSecret) throw new Error('The new APP_SECRET is the same as the old one');
  const reseal = (sealed: string) => encryptJson(decryptJson(sealed, oldSecret), newSecret);
  return db.$transaction(async (tx) => {
    const counts: Record<string, number> = {};
    const each = async <T extends { id: string }>(
      name: string,
      rows: T[],
      sealedOf: (row: T) => string | null,
      save: (id: string, sealed: string) => Promise<unknown>,
    ) => {
      counts[name] = 0;
      for (const row of rows) {
        const sealed = sealedOf(row);
        if (!sealed) continue;
        let next: string;
        try {
          next = reseal(sealed);
        } catch {
          throw new Error(`A saved secret in ${name} cannot be opened with the old APP_SECRET given`);
        }
        await save(row.id, next);
        counts[name] += 1;
      }
    };
    await each(
      'channel settings',
      await tx.channelConfig.findMany({ select: { id: true, secret: true } }),
      (r) => r.secret,
      (id, secret) => tx.channelConfig.update({ where: { id }, data: { secret } }),
    );
    await each(
      'AI settings',
      await tx.aiConfig.findMany({ select: { id: true, secret: true } }),
      (r) => r.secret,
      (id, secret) => tx.aiConfig.update({ where: { id }, data: { secret } }),
    );
    await each(
      'webhooks',
      await tx.webhook.findMany({ select: { id: true, secret: true } }),
      (r) => r.secret,
      (id, secret) => tx.webhook.update({ where: { id }, data: { secret } }),
    );
    await each(
      'Google Drive',
      await tx.driveConnection.findMany({ select: { id: true, secrets: true } }),
      (r) => r.secrets,
      (id, secrets) => tx.driveConnection.update({ where: { id }, data: { secrets } }),
    );
    await each(
      'integrations',
      await tx.connection.findMany({ select: { id: true, secret: true } }),
      (r) => r.secret,
      (id, secret) => tx.connection.update({ where: { id }, data: { secret } }),
    );
    // Sessions are signed with the secret too: everybody signs in again.
    counts.sessions = (
      await tx.session.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } })
    ).count;
    return counts;
  });
}
