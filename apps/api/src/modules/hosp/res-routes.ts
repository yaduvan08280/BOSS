import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  bookingPatchSchema,
  consentSchema,
  guestPatchSchema,
  guestSchema,
  reservationSchema,
  waitlistSchema,
} from '@mono/shared';
import { z } from 'zod';
import type { Env } from '../../env';
import { actorOf } from '../delegation/routes';
import { ctxOf } from './access';
import { advanceFor, useAdvance } from './advance';
import {
  changeGuest,
  deleteGuest,
  guestProfile,
  guestQuery,
  listGuests,
  recordConsent,
  saveGuest,
} from './guests';
import {
  actOnReservation,
  actSchema,
  depositSchema,
  payDeposit,
  refundDeposit,
  saveBooking,
} from './res-flow';
import { bookingPublicRoutes } from './res-public';
import {
  availability,
  book,
  changeReservation,
  changeSchema,
  getReservation,
  host,
  makeReservation,
  staffOutlet,
} from './reservations';
import { actOnWaitlist, joinWaitlist, quote, quoteQuery, waitActSchema, waitlist } from './waitlist';

const idParam = z.object({ id: z.string() });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Reservations, the waitlist and guests (phase 16). */
export async function reservationRoutes(app: FastifyInstance, opts: { env: Env }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['reservations'];
  // A fresh hook list per route (decision 62); the services check the finer rights and the outlet's branch.
  const view = () => ({ onRequest: [app.requirePermission('hosp.view')] });
  const db = app.prisma;
  const byId = () => ({ ...view(), schema: { tags, params: idParam } });
  const withId = <T extends z.ZodTypeAny>(schema: T) => ({
    ...view(),
    schema: { tags, params: idParam, body: schema },
  });

  r.get(
    '/api/reservations/outlets/:id/book',
    { ...view(), schema: { tags, params: idParam, querystring: z.object({ day: day.optional() }) } },
    async (q) => book(db, actorOf(q), q.params.id, q.query.day),
  );
  r.get(
    '/api/reservations/outlets/:id/availability',
    {
      ...view(),
      schema: {
        tags,
        params: idParam,
        querystring: z.object({
          day,
          size: z.coerce.number().int().min(1).max(500),
          except: z.string().optional(),
        }),
      },
    },
    async (q) => {
      const outlet = await staffOutlet(db, actorOf(q), q.params.id);
      return availability(db, outlet, q.query.day, q.query.size, q.query.except);
    },
  );
  r.put('/api/reservations/outlets/:id/rules', withId(bookingPatchSchema), async (q) =>
    saveBooking(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/reservations', { ...view(), schema: { tags, body: reservationSchema } }, async (q) =>
    makeReservation(db, actorOf(q), q.body),
  );
  r.get('/api/reservations/:id', byId(), async (q) => getReservation(db, actorOf(q), q.params.id));
  r.patch('/api/reservations/:id', withId(changeSchema), async (q) =>
    changeReservation(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/reservations/:id/act', withId(actSchema), async (q) =>
    actOnReservation(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/reservations/:id/deposit', withId(depositSchema), async (q) =>
    payDeposit(db, actorOf(q), q.params.id, q.body),
  );
  r.post(
    '/api/reservations/:id/deposit/refund',
    withId(z.object({ reason: z.string().trim().max(200).nullish() })),
    async (q) => refundDeposit(db, actorOf(q), q.params.id, q.body),
  );
  // A deposit against the dinner's bill.
  r.get('/api/pos/orders/:id/advance', byId(), async (q) => ({
    advance: await advanceFor(db, actorOf(q).companyId, q.params.id),
  }));
  r.post('/api/pos/checks/:id/advance', byId(), async (q) => useAdvance(db, actorOf(q), q.params.id));

  r.get('/api/reservations/outlets/:id/waitlist', byId(), async (q) => waitlist(db, actorOf(q), q.params.id));
  r.get(
    '/api/reservations/outlets/:id/quote',
    { ...view(), schema: { tags, params: idParam, querystring: quoteQuery } },
    async (q) => quote(db, actorOf(q), q.params.id, q.query.size),
  );
  r.post('/api/reservations/waitlist', { ...view(), schema: { tags, body: waitlistSchema } }, async (q) =>
    joinWaitlist(db, actorOf(q), q.body),
  );
  r.post('/api/reservations/waitlist/:id/act', withId(waitActSchema), async (q) =>
    actOnWaitlist(db, actorOf(q), q.params.id, q.body),
  );

  r.get('/api/guests', { ...view(), schema: { tags, querystring: guestQuery } }, async (q) =>
    listGuests(db, actorOf(q), q.query),
  );
  r.post('/api/guests', { ...view(), schema: { tags, body: guestSchema } }, async (q) =>
    saveGuest(db, actorOf(q), q.body),
  );
  r.get('/api/guests/:id', byId(), async (q) => guestProfile(db, actorOf(q), q.params.id));
  r.patch('/api/guests/:id', withId(guestPatchSchema), async (q) =>
    changeGuest(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/guests/:id/consent', withId(consentSchema), async (q) => {
    const actor = actorOf(q);
    host(actor);
    return recordConsent(db, ctxOf(actor), q.params.id, q.body);
  });
  r.delete('/api/guests/:id', byId(), async (q) => deleteGuest(db, actorOf(q), q.params.id));

  await app.register(bookingPublicRoutes, { env: opts.env });
}
