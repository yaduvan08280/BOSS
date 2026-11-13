import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { bookingInputSchema, groupBlockSchema, ratePlanSchema } from '@mono/shared';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { actorOf } from '../delegation/routes';
import { audits, nightAudit } from './audit';
import { createBlock, listBlocks, releaseBlockBy } from './blocks';
import { cancelBooking, cancelSchema, createBooking, listStays, stayQuery } from './bookings';
import { dmy, hotelFor } from './core';
import {
  addCharge,
  addFolio,
  advanceSchema,
  chargeSchema,
  folioSchema,
  moveLines,
  moveSchema,
  routingBody,
  setRouting,
  stayFolios,
  takeAdvance,
  voidLine,
  voidSchema,
} from './folio';
import {
  checkIn,
  checkInSchema,
  checkOut,
  checkOutSchema,
  deskLists,
  deskNote,
  deskNoteSchema,
  fileFormC,
  stayDetail,
} from './frontdesk';
import {
  actOnTask,
  assignSchema as hkAssignSchema,
  assignTasks,
  board,
  planBoard,
  planSchema,
  taskSchema,
} from './housekeeping';
import {
  closeFound,
  logFound,
  lostCloseSchema,
  lostFound,
  lostSchema,
  minibarCheck,
  minibarSchema,
} from './hk-extras';
import {
  blockRoom,
  blockSchema,
  guestRequest,
  publicRequest,
  publicRoom,
  releaseBlockedRoom,
  requestSchema,
  roomBlocks,
  roomLink,
} from './maintenance';
import {
  availability,
  availabilityQuery,
  deletePlan,
  getRules,
  listPlans,
  quote,
  quoteSchema,
  roomDaysSchema,
  rulesPatchSchema,
  savePlan,
  saveRules,
  setRoomDays,
} from './rates';
import { formCExport, guestRegister, occupancy, registerQuery } from './reports';
import { creditFolio, creditSchema, refundAdvance, settleFolio, settleSchema } from './settle';
import { assignRoom, assignSchema, changeDates, datesSchema, tapeChart, tapeQuery } from './tape';

const idParam = z.object({ id: z.string() });
const branchQuery = z.object({ branchId: z.string().min(1) });

/** The hotel (phase 17): rates, bookings, the room calendar, front desk, folios, night audit, housekeeping. */
export async function hotelRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['hotel'];
  // A fresh hook list per route (decision 62); the services check the finer rights and the branch.
  const view = () => ({ onRequest: [app.requirePermission('hosp.view')] });
  const db = app.prisma;
  const byId = () => ({ ...view(), schema: { tags, params: idParam } });
  const withId = <T extends z.ZodTypeAny>(schema: T) => ({
    ...view(),
    schema: { tags, params: idParam, body: schema },
  });
  const body = <T extends z.ZodTypeAny>(schema: T) => ({ ...view(), schema: { tags, body: schema } });
  const query = <T extends z.ZodTypeAny>(schema: T) => ({ ...view(), schema: { tags, querystring: schema } });

  // Rates, restrictions, availability, the property's rules.
  r.get('/api/hotel/plans', query(branchQuery), async (q) => listPlans(db, actorOf(q), q.query.branchId));
  r.post('/api/hotel/plans', body(ratePlanSchema), async (q) => savePlan(db, actorOf(q), q.body));
  r.put('/api/hotel/plans/:id', withId(ratePlanSchema), async (q) =>
    savePlan(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/hotel/plans/:id', byId(), async (q) => deletePlan(db, actorOf(q), q.params.id));
  r.put('/api/hotel/room-days', body(roomDaysSchema), async (q) => setRoomDays(db, actorOf(q), q.body));
  r.get('/api/hotel/availability', query(availabilityQuery), async (q) =>
    availability(db, actorOf(q), q.query),
  );
  r.get('/api/hotel/quote', query(quoteSchema), async (q) => quote(db, actorOf(q), q.query));
  r.get('/api/hotel/rules', query(branchQuery), async (q) => getRules(db, actorOf(q), q.query.branchId));
  r.put(
    '/api/hotel/rules',
    { ...view(), schema: { tags, querystring: branchQuery, body: rulesPatchSchema } },
    async (q) => saveRules(db, actorOf(q), q.query.branchId, q.body),
  );

  // Bookings, group blocks, the room calendar.
  r.get('/api/hotel/stays', query(stayQuery), async (q) => listStays(db, actorOf(q), q.query));
  r.post('/api/hotel/stays', body(bookingInputSchema), async (q) => createBooking(db, actorOf(q), q.body));
  r.get('/api/hotel/stays/:id', byId(), async (q) => stayDetail(db, actorOf(q), q.params.id));
  r.post('/api/hotel/stays/:id/cancel', withId(cancelSchema), async (q) =>
    cancelBooking(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/hotel/stays/:id/no-show', withId(cancelSchema), async (q) =>
    cancelBooking(db, actorOf(q), q.params.id, q.body, 'NO_SHOW'),
  );
  r.post('/api/hotel/stays/:id/room', withId(assignSchema), async (q) =>
    assignRoom(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/hotel/stays/:id/dates', withId(datesSchema), async (q) =>
    changeDates(db, actorOf(q), q.params.id, q.body),
  );
  r.get('/api/hotel/blocks', query(branchQuery), async (q) => listBlocks(db, actorOf(q), q.query.branchId));
  r.post('/api/hotel/blocks', body(groupBlockSchema), async (q) => createBlock(db, actorOf(q), q.body));
  r.post('/api/hotel/blocks/:id/release', byId(), async (q) => releaseBlockBy(db, actorOf(q), q.params.id));
  r.get('/api/hotel/tape', query(tapeQuery), async (q) => tapeChart(db, actorOf(q), q.query));

  // The front desk.
  r.get('/api/hotel/desk', query(branchQuery), async (q) => deskLists(db, actorOf(q), q.query.branchId));
  r.post('/api/hotel/stays/:id/check-in', withId(checkInSchema), async (q) =>
    checkIn(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/hotel/stays/:id/check-out', withId(checkOutSchema), async (q) =>
    checkOut(db, actorOf(q), q.params.id, q.body),
  );
  r.post(
    '/api/hotel/stays/:id/form-c',
    withId(z.object({ kyc: z.record(z.string(), z.unknown()).optional() })),
    async (q) => fileFormC(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/hotel/stays/:id/desk', withId(deskNoteSchema), async (q) =>
    deskNote(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/hotel/stays/:id/request', withId(requestSchema), async (q) =>
    guestRequest(db, actorOf(q), q.params.id, q.body),
  );

  // Folios.
  r.get('/api/hotel/stays/:id/folios', byId(), async (q) => stayFolios(db, actorOf(q), q.params.id));
  r.post('/api/hotel/stays/:id/folios', withId(folioSchema), async (q) =>
    addFolio(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/hotel/stays/:id/charges', withId(chargeSchema), async (q) =>
    addCharge(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/hotel/stays/:id/advance', withId(advanceSchema), async (q) =>
    takeAdvance(db, actorOf(q), q.params.id, q.body),
  );
  r.put('/api/hotel/stays/:id/routing', withId(routingBody), async (q) =>
    setRouting(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/hotel/folios/:id/move', withId(moveSchema), async (q) =>
    moveLines(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/hotel/folios/:id/settle', withId(settleSchema), async (q) =>
    settleFolio(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/hotel/folios/:id/credit', withId(creditSchema), async (q) =>
    creditFolio(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/hotel/folio-lines/:id/void', withId(voidSchema), async (q) =>
    voidLine(db, actorOf(q), q.params.id, q.body),
  );
  r.post(
    '/api/hotel/folio-lines/:id/refund',
    withId(z.object({ reason: z.string().trim().max(200).nullish() })),
    async (q) => refundAdvance(db, actorOf(q), q.params.id, q.body),
  );

  // Night audit and reports.
  r.post('/api/hotel/night-audit', body(branchQuery), async (q) =>
    nightAudit(db, actorOf(q), q.body.branchId),
  );
  r.get('/api/hotel/night-audits', query(branchQuery), async (q) => audits(db, actorOf(q), q.query.branchId));
  r.get('/api/hotel/register', query(registerQuery), async (q) => guestRegister(db, actorOf(q), q.query));
  r.get('/api/hotel/occupancy', query(registerQuery), async (q) => occupancy(db, actorOf(q), q.query));
  r.get('/api/hotel/form-c.csv', query(registerQuery), async (q, reply) =>
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="form-c-${q.query.from}-${q.query.to}.csv"`)
      .send(await formCExport(db, actorOf(q), q.query)),
  );

  // Housekeeping, lost & found, rooms out of order.
  r.get('/api/hotel/housekeeping', query(branchQuery), async (q) => board(db, actorOf(q), q.query.branchId));
  r.post('/api/hotel/housekeeping/plan', body(planSchema), async (q) => planBoard(db, actorOf(q), q.body));
  r.post('/api/hotel/housekeeping/assign', body(hkAssignSchema), async (q) =>
    assignTasks(db, actorOf(q), q.body),
  );
  r.post('/api/hotel/housekeeping/tasks/:id', withId(taskSchema), async (q) =>
    actOnTask(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/hotel/rooms/:id/minibar', withId(minibarSchema), async (q) =>
    minibarCheck(db, actorOf(q), q.params.id, q.body),
  );
  r.get('/api/hotel/lost-found', query(branchQuery), async (q) =>
    lostFound(db, actorOf(q), q.query.branchId),
  );
  r.post('/api/hotel/lost-found', body(lostSchema), async (q) => logFound(db, actorOf(q), q.body));
  r.post('/api/hotel/lost-found/:id/close', withId(lostCloseSchema), async (q) =>
    closeFound(db, actorOf(q), q.params.id, q.body),
  );
  r.get('/api/hotel/room-blocks', query(branchQuery), async (q) =>
    roomBlocks(db, actorOf(q), q.query.branchId),
  );
  r.post('/api/hotel/rooms/:id/block', withId(blockSchema), async (q) =>
    blockRoom(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/hotel/room-blocks/:id/release', byId(), async (q) =>
    releaseBlockedRoom(db, actorOf(q), q.params.id),
  );
  r.post('/api/hotel/rooms/:id/link', byId(), async (q) => roomLink(db, actorOf(q), q.params.id));

  // No sign-in: the QR in a room (a request), and the guest's booking voucher.
  const token = z.object({ token: z.string().min(10).max(64) });
  r.get(
    '/api/public/room/:token',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['public'], params: token },
    },
    async (q) => publicRoom(db, q.params.token),
  );
  r.post(
    '/api/public/room/:token/request',
    {
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
      schema: {
        tags: ['public'],
        params: token,
        body: requestSchema.extend({ website: z.string().max(200).optional() }),
      },
    },
    async (q) =>
      q.body.website ? { ok: true, number: null } : publicRequest(db, q.params.token, q.body.text),
  );
  r.get(
    '/api/public/stay/:token',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['public'], params: token },
    },
    async (q) => {
      const s = await db.stay.findUnique({ where: { token: q.params.token } });
      if (!s) throw new AppError(404, 'NOT_FOUND', 'This booking was not found');
      const [hotel, guest, type, nights] = await Promise.all([
        hotelFor(db, s.companyId, s.branchId),
        db.guest.findFirstOrThrow({ where: { id: s.guestId } }),
        db.roomType.findUnique({ where: { id: s.roomTypeId } }),
        db.roomNight.findMany({ where: { stayId: s.id } }),
      ]);
      return {
        hotel: hotel.name,
        number: s.number,
        status: s.status,
        name: guest.name,
        arrive: dmy(s.arrive),
        depart: dmy(s.depart),
        adults: s.adults,
        children: s.children,
        roomType: type?.name ?? '',
        meal: s.meal,
        total: nights.reduce((n, x) => n + Number(x.rate), 0),
        checkIn: hotel.rules.checkInMin,
        checkOut: hotel.rules.checkOutMin,
      };
    },
  );
}
