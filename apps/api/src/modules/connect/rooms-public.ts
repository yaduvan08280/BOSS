import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { addDays, guestMobile, localDate } from '@mono/shared';
import { z } from 'zod';
import type { Env } from '../../env';
import { challenge, checkChallenge } from '../../lib/challenge';
import { AppError } from '../../lib/errors';
import { bookStayIn } from '../hotel/bookings';
import { hotelFor, isTaken } from '../hotel/core';
import { priceStay } from '../hotel/rates';

/**
 * Phase 19 — a property's own booking page (the "booking engine"): for the dates and guests asked, each room
 * type that can be sold with what the stay costs on each public rate plan, and a booking made by the guest
 * (source WEBSITE). Rate-limited per address, with the honeypot and the signed sum of the other public pages.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export async function roomsPublicRoutes(app: FastifyInstance, opts: { env: Env }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const secret = opts.env.APP_SECRET;
  const db = app.prisma;
  const token = z.object({ token: z.string().min(10).max(64) });
  const tags = ['public'];

  async function propertyFor(t: string) {
    const row = await db.hotelSettings.findUnique({ where: { bookingToken: t } });
    const hotel = row ? await hotelFor(db, row.companyId, row.branchId) : null;
    if (!hotel || !hotel.rules.online)
      throw new AppError(404, 'NOT_FOUND', 'Online booking is not open here');
    return hotel;
  }
  /** What can be offered: every room type on every active public (rack) plan that prices it and has a room left. */
  async function offers(
    hotel: Awaited<ReturnType<typeof propertyFor>>,
    q: { arrive: string; depart: string; adults: number; children: number },
  ) {
    const where = { companyId: hotel.companyId, branchId: hotel.branchId, deletedAt: null };
    const [types, plans] = await Promise.all([
      db.roomType.findMany({ where, orderBy: { name: 'asc' } }),
      db.ratePlan.findMany({ where: { ...where, active: true, kind: 'RACK' }, orderBy: { name: 'asc' } }),
    ]);
    const out = [];
    for (const type of types)
      for (const plan of plans) {
        try {
          const p = await priceStay(db, hotel.companyId, { ...q, ratePlanId: plan.id, roomTypeId: type.id });
          if (p.problem) continue;
          out.push({
            roomTypeId: type.id,
            room: type.name,
            sleeps: type.maxOccupancy,
            ratePlanId: plan.id,
            plan: plan.name,
            meal: plan.meal,
            nights: p.nights.length,
            total: p.total,
          });
        } catch {
          // No rate for this type on this plan, or too many guests for it: simply not offered.
        }
      }
    return out;
  }
  const span = (hotel: { tz: string; businessDate: string }, arrive?: string, depart?: string) => {
    const today = [localDate(new Date(), hotel.tz), hotel.businessDate].sort().pop()!;
    const from = arrive && arrive >= today ? arrive : today;
    const to = depart && depart > from ? depart : addDays(from, 1);
    return { today, arrive: from, depart: to };
  };

  r.get(
    '/api/public/rooms/:token',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags,
        params: token,
        querystring: z.object({
          arrive: day.optional(),
          depart: day.optional(),
          adults: z.coerce.number().int().min(1).max(20).default(2),
          children: z.coerce.number().int().min(0).max(20).default(0),
        }),
      },
    },
    async (q) => {
      const hotel = await propertyFor(q.params.token);
      const company = await db.company.findUniqueOrThrow({
        where: { id: hotel.companyId },
        select: { name: true, settings: true },
      });
      const s = span(hotel, q.query.arrive, q.query.depart);
      const tooLong = s.depart > addDays(s.arrive, 30);
      return {
        company: company.name,
        logoUrl: ((company.settings ?? {}) as { logoUrl?: string }).logoUrl ?? null,
        property: hotel.name,
        ...s,
        adults: q.query.adults,
        children: q.query.children,
        offers: tooLong
          ? []
          : await offers(hotel, { ...s, adults: q.query.adults, children: q.query.children }),
        challenge: challenge(secret),
      };
    },
  );

  r.post(
    '/api/public/rooms/:token',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags,
        params: token,
        body: z.object({
          arrive: day,
          depart: day,
          adults: z.number().int().min(1).max(20),
          children: z.number().int().min(0).max(20).default(0),
          roomTypeId: z.string().min(1).max(40),
          ratePlanId: z.string().min(1).max(40),
          name: z.string().trim().min(1).max(80),
          mobile: guestMobile,
          email: z.string().trim().email().max(120).nullish(),
          note: z.string().trim().max(500).nullish(),
          challenge: z.string().max(200),
          answer: z.coerce.number().int(),
          website: z.string().max(200).optional(),
        }),
      },
    },
    async (q) => {
      const hotel = await propertyFor(q.params.token);
      const b = q.body;
      if (b.website) return { ok: true, number: null };
      if (!checkChallenge(secret, b.challenge, b.answer))
        throw new AppError(400, 'VALIDATION_FAILED', 'The sum is not right — try again', {
          challenge: challenge(secret),
        });
      const s = span(hotel, b.arrive, b.depart);
      if (s.arrive !== b.arrive || s.depart !== b.depart || b.depart > addDays(b.arrive, 30))
        throw new AppError(400, 'VALIDATION_FAILED', 'Choose the dates again');
      // Only what the page offers: a public plan of this property.
      const plan = await db.ratePlan.findFirst({
        where: {
          id: b.ratePlanId,
          companyId: hotel.companyId,
          branchId: hotel.branchId,
          kind: 'RACK',
          active: true,
          deletedAt: null,
        },
      });
      if (!plan) throw new AppError(400, 'VALIDATION_FAILED', 'That rate is not offered online');
      try {
        const made = await db.$transaction((tx) =>
          bookStayIn(tx, { companyId: hotel.companyId, actorId: null, ip: q.ip }, hotel, {
            branchId: hotel.branchId,
            ratePlanId: plan.id,
            roomTypeId: b.roomTypeId,
            arrive: b.arrive,
            depart: b.depart,
            adults: b.adults,
            children: b.children,
            guest: { mobile: b.mobile, name: b.name, email: b.email },
            kind: 'INDIVIDUAL',
            source: 'WEBSITE',
            note: b.note,
          }),
        );
        return { ok: true, number: made.number, total: made.total, nights: made.nights.length };
      } catch (e) {
        if (isTaken(e)) throw new AppError(409, 'CONFLICT', 'That room was just taken — choose again');
        throw e;
      }
    },
  );
}
