import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('a person’s photo', () => {
  it('is set by the person or an admin, shows in the people list, and can be taken off', async () => {
    const w = await world(ctx.app);
    const asha = await w.person('Asha Photo');
    const ravi = await w.person('Ravi Photo');
    const upload = (by: string, mime = 'image/jpeg') =>
      ctx.app.prisma.attachment
        .create({
          data: {
            companyId: w.companyId,
            entityType: 'upload',
            entityId: by,
            path: `t/${Math.random()}.jpg`,
            originalName: 'me.jpg',
            mime,
            size: 1,
            uploadedById: by,
          },
        })
        .then((a) => a.id);

    // Her own photo.
    const mine = await upload(asha.id);
    const set = await asha.api.put(`/api/org/users/${asha.id}/photo`, { fileId: mine });
    expect(set.status).toBe(200);
    expect(set.body.avatarUrl).toBe(`/api/files/${mine}`);
    expect((await asha.api.get('/api/auth/me')).body.user.avatarUrl).toBe(`/api/files/${mine}`);
    const list = (await ravi.api.get('/api/org/users')).body as { id: string; avatarUrl: string | null }[];
    expect(list.find((p) => p.id === asha.id)?.avatarUrl).toBe(`/api/files/${mine}`);

    // Not someone else's, not with someone else's upload, not a PDF.
    const his = await upload(ravi.id);
    expect((await ravi.api.put(`/api/org/users/${asha.id}/photo`, { fileId: his })).status).toBe(403);
    expect((await ravi.api.put(`/api/org/users/${ravi.id}/photo`, { fileId: mine })).status).toBe(404);
    const pdf = await upload(ravi.id, 'application/pdf');
    expect((await ravi.api.put(`/api/org/users/${ravi.id}/photo`, { fileId: pdf })).status).toBe(400);

    // An admin sets anyone's, and takes it off.
    const byOwner = await upload(w.owner.id);
    expect((await w.api.put(`/api/org/users/${ravi.id}/photo`, { fileId: byOwner })).body.avatarUrl).toBe(
      `/api/files/${byOwner}`,
    );
    expect((await w.api.put(`/api/org/users/${ravi.id}/photo`, { fileId: null })).body.avatarUrl).toBeNull();
  });
});
