import { randomBytes } from 'node:crypto';
import type { Db } from '@mono/db';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { decryptJson, encryptJson } from '../../lib/secrets';
import { isOwner } from '../ims/access';
import type { Actor } from '../work/actor';

/** Google's OAuth and Drive addresses (fixed; nothing here comes from the user). */
export const GOOGLE = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  files: 'https://www.googleapis.com/drive/v3/files',
  upload: 'https://www.googleapis.com/upload/drive/v3/files',
  about: 'https://www.googleapis.com/drive/v3/about',
};
/** Only files MONO itself creates — it can never see anything else in the Drive (§12). */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export type DriveEnv = { secret: string; baseUrl: string; appName: string; fetch?: typeof fetch };
type Secrets = { clientSecret: string; refreshToken?: string };

const ctxOf = (actor: Actor) => ({ ...actor, actorId: actor.userId });
export const redirectUri = (baseUrl: string) =>
  `${new URL(baseUrl).origin}/api/integrations/google-drive/callback`;
const needOwner = async (db: Db, actor: Actor) => {
  if (!(await isOwner(db, actor)))
    throw new AppError(403, 'FORBIDDEN', 'Only the account owner can connect Google Drive');
};

export const startSchema = z.object({
  clientId: z
    .string()
    .trim()
    .regex(
      /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/,
      'The Client ID ends in .apps.googleusercontent.com',
    ),
  clientSecret: z.string().trim().min(10, 'Paste the Client secret').max(200),
});

/** Where files go now, for the screen. */
export async function driveStatus(db: Db, actor: Actor, env: DriveEnv) {
  const c = await db.driveConnection.findUnique({ where: { companyId: actor.companyId } });
  const [onDrive, waiting] = await Promise.all([
    db.attachment.count({ where: { companyId: actor.companyId, driveFileId: { not: null } } }),
    c?.status === 'connected' && c.connectedAt
      ? db.attachment.count({
          where: {
            companyId: actor.companyId,
            driveFileId: null,
            deletedAt: null,
            createdAt: { gte: c.connectedAt },
          },
        })
      : 0,
  ]);
  return {
    status: (c?.status ?? 'none') as 'none' | 'waiting' | 'connected' | 'error' | 'off',
    clientId: c?.clientId ?? null,
    accountEmail: c?.accountEmail ?? null,
    folderUrl: c?.folderId ? `https://drive.google.com/drive/folders/${c.folderId}` : null,
    connectedAt: c?.connectedAt ?? null,
    lastError: c?.lastError ?? null,
    redirectUri: redirectUri(env.baseUrl),
    folderName: `${env.appName} Files`,
    filesOnDrive: onDrive,
    filesWaiting: waiting,
    canSetUp: await isOwner(db, actor),
  };
}

/** Step 4 "Connect Drive": keep the client (secret encrypted) and send the owner to Google to say yes. */
export async function startDrive(db: Db, actor: Actor, env: DriveEnv, input: z.input<typeof startSchema>) {
  await needOwner(db, actor);
  const { clientId, clientSecret } = startSchema.parse(input);
  const state = randomBytes(24).toString('base64url');
  const before = await db.driveConnection.findUnique({ where: { companyId: actor.companyId } });
  const old = before ? decryptJson<Secrets>(before.secrets, env.secret) : null;
  // A new client means a new sign-in; the same client keeps its refresh token until Google gives a new one.
  const secrets = encryptJson(
    {
      clientSecret,
      ...(old?.refreshToken && before?.clientId === clientId ? { refreshToken: old.refreshToken } : {}),
    },
    env.secret,
  );
  const data = {
    clientId,
    secrets,
    state,
    stateExpiresAt: new Date(Date.now() + 15 * 60_000),
    lastError: null,
    status: before?.status === 'connected' && before.clientId === clientId ? 'connected' : 'waiting',
  };
  await db.$transaction(async (tx) => {
    await tx.driveConnection.upsert({
      where: { companyId: actor.companyId },
      create: { companyId: actor.companyId, ...data },
      update: data,
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'drive.connect_started',
      entityType: 'drive',
      entityId: actor.companyId,
      after: { clientId },
    });
  });
  const url = new URL(GOOGLE.auth);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(env.baseUrl),
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  }).toString();
  return { url: url.toString() };
}

async function googleJson<T>(f: typeof fetch, url: string, init: RequestInit): Promise<T> {
  const res = await f(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const e = body as { error?: string | { message?: string }; error_description?: string } | null;
    const msg =
      typeof e?.error === 'string'
        ? `${e.error}${e.error_description ? `: ${e.error_description}` : ''}`
        : (e?.error?.message ?? `HTTP ${res.status}`);
    throw new Error(msg.slice(0, 300));
  }
  return body as T;
}

/**
 * Google sends the owner back here. The state must match and be fresh; the code becomes a refresh token, the
 * account is read, and the "{APP} Files" folder is made (once). Returns where the browser goes next.
 */
export async function finishDrive(
  db: Db,
  actor: Actor,
  env: DriveEnv,
  q: { code?: string; state?: string; error?: string },
) {
  const back = (r: string) => `/system/integration/drive?drive=${r}`;
  const c = await db.driveConnection.findUnique({ where: { companyId: actor.companyId } });
  if (!c || !q.state || c.state !== q.state || !c.stateExpiresAt || c.stateExpiresAt < new Date())
    return back('expired');
  if (!(await isOwner(db, actor))) return back('owner');
  await db.driveConnection.update({ where: { id: c.id }, data: { state: null, stateExpiresAt: null } });
  const secrets = decryptJson<Secrets>(c.secrets, env.secret)!;
  const wasConnected = c.status === 'connected' && Boolean(secrets.refreshToken);
  if (q.error || !q.code) {
    await db.driveConnection.update({
      where: { id: c.id },
      data: {
        status: wasConnected ? 'connected' : 'error',
        lastError: `Google said: ${(q.error ?? 'no code').slice(0, 100)}`,
      },
    });
    return back('denied');
  }
  const f = env.fetch ?? fetch;
  try {
    const tok = await googleJson<{ access_token: string; refresh_token?: string; scope?: string }>(
      f,
      GOOGLE.token,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: q.code,
          client_id: c.clientId,
          client_secret: secrets.clientSecret,
          redirect_uri: redirectUri(env.baseUrl),
          grant_type: 'authorization_code',
        }).toString(),
      },
    );
    const refreshToken = tok.refresh_token ?? secrets.refreshToken;
    if (!refreshToken)
      throw new Error(
        'Google did not give a refresh token. Remove MONO under myaccount.google.com → Security → Third-party access, then connect again.',
      );
    if (tok.scope && !tok.scope.split(' ').includes(DRIVE_SCOPE))
      throw new Error(
        'Tick "See, edit, create and delete only the specific Google Drive files you use with this app" on Google\'s screen.',
      );
    const auth = { Authorization: `Bearer ${tok.access_token}` };
    const about = await googleJson<{ user?: { emailAddress?: string } }>(
      f,
      `${GOOGLE.about}?fields=user(emailAddress)`,
      { headers: auth },
    );
    let folderId = c.folderId;
    if (folderId) {
      // The folder may have been deleted in Drive: check it is still there and not in the bin.
      const ok = await googleJson<{ trashed?: boolean }>(f, `${GOOGLE.files}/${folderId}?fields=id,trashed`, {
        headers: auth,
      }).then(
        (x) => !x.trashed,
        () => false,
      );
      if (!ok) folderId = null;
    }
    if (!folderId) {
      const folder = await googleJson<{ id: string }>(f, `${GOOGLE.files}?fields=id`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${env.appName} Files`,
          mimeType: 'application/vnd.google-apps.folder',
        }),
      });
      folderId = folder.id;
    }
    await db.$transaction(async (tx) => {
      await tx.driveConnection.update({
        where: { id: c.id },
        data: {
          secrets: encryptJson({ ...secrets, refreshToken }, env.secret),
          status: 'connected',
          accountEmail: about.user?.emailAddress ?? null,
          folderId,
          lastError: null,
          connectedById: actor.userId,
          connectedAt: c.status === 'connected' && c.connectedAt ? c.connectedAt : new Date(),
        },
      });
      await writeAudit(tx, ctxOf(actor), {
        action: 'drive.connected',
        entityType: 'drive',
        entityId: actor.companyId,
        after: { account: about.user?.emailAddress ?? null, folderId },
      });
    });
    forgetToken(actor.companyId);
    return back('connected');
  } catch (e) {
    await db.driveConnection.update({
      where: { id: c.id },
      data: { status: wasConnected ? 'connected' : 'error', lastError: (e as Error).message },
    });
    return back('error');
  }
}

/** Stop sending new files to Drive. Files already there stay there and still open (the key is kept for reading). */
export async function pauseDrive(db: Db, actor: Actor) {
  await needOwner(db, actor);
  const c = await db.driveConnection.findUnique({ where: { companyId: actor.companyId } });
  if (!c) return { ok: true };
  await db.$transaction(async (tx) => {
    await tx.driveConnection.update({ where: { id: c.id }, data: { status: 'off', state: null } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'drive.paused',
      entityType: 'drive',
      entityId: actor.companyId,
    });
  });
  return { ok: true };
}

// ---- Access tokens (an hour each), kept in memory per company
const tokens = new Map<string, { token: string; until: number }>();
export const forgetToken = (companyId: string) => tokens.delete(companyId);

export async function accessToken(db: Db, env: DriveEnv, companyId: string) {
  const hit = tokens.get(companyId);
  if (hit && hit.until > Date.now() + 60_000) return hit.token;
  const c = await db.driveConnection.findUnique({ where: { companyId } });
  const s = c ? decryptJson<Secrets>(c.secrets, env.secret) : null;
  if (!c || !s?.refreshToken) throw new Error('Google Drive is not connected');
  try {
    const tok = await googleJson<{ access_token: string; expires_in?: number }>(
      env.fetch ?? fetch,
      GOOGLE.token,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: c.clientId,
          client_secret: s.clientSecret,
          refresh_token: s.refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      },
    );
    tokens.set(companyId, { token: tok.access_token, until: Date.now() + (tok.expires_in ?? 3600) * 1000 });
    return tok.access_token;
  } catch (e) {
    // invalid_grant = the owner removed access, or the app is still "Testing" (tokens end after 7 days).
    if (/invalid_grant|invalid_client|unauthorized_client/.test((e as Error).message))
      await db.driveConnection.update({
        where: { companyId },
        data: {
          status: 'error',
          lastError: `Google refused the saved sign-in (${(e as Error).message}). Connect Drive again.`,
        },
      });
    throw e;
  }
}

export const driveEnvOf = (env: { APP_SECRET: string; BASE_URL: string; APP_NAME: string }): DriveEnv => ({
  secret: env.APP_SECRET,
  baseUrl: env.BASE_URL,
  appName: env.APP_NAME,
});
