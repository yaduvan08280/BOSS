import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { addDays, depositFor, guestMobile, localDate, slotLabel } from '@mono/shared';
import { z } from 'zod';
import type { Env } from '../../env';
import { challenge, checkChallenge } from '../../lib/challenge';
import { AppError } from '../../lib/errors';
import { recordConsent } from './guests';
import { resNumber, resOutlet, whenOf } from './res-core';
import { byToken, endIn } from './res-flow';
import { availability, bookIn } from './reservations';

/**
 * Phase 16 — the public booking page of an outlet: its free times for a day and a party size, and a booking made
 * by the guest. Rate-limited per address, with a hidden honeypot field and a signed sum instead of a captcha
 * (decision 55). The guest's own link shows the booking and lets them cancel it.
 */
export async function bookingPublicRoutes(app: FastifyInstance, opts: { env: Env }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const secret = opts.env.APP_SECRET;
  const db = app.prisma;
  const token = z.object({ token: z.string().min(10).max(64) });
  const tags = ['public'];
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

  async function outletFor(t: string) {
    const outlet = await resOutlet(db, { bookingToken: t });
    if (!outlet || !outlet.booking.online)
      throw new AppError(404, 'NOT_FOUND', 'Online booking is not open here');
    return outlet;
  }

  r.get(
    '/api/public/book/:token',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags,
        params: token,
        querystring: z.object({
          day: day.optional(),
          size: z.coerce.number().int().min(1).max(500).optional(),
        }),
      },
    },
    async (q) => {
      const outlet = await outletFor(q.params.token);
      const company = await db.company.findUniqueOrThrow({
        where: { id: outlet.companyId },
        select: { name: true, settings: true },
      });
      const settings = (company.settings ?? {}) as { appName?: string; logoUrl?: string };
      const today = localDate(new Date(), outlet.tz);
      const b = outlet.booking;
      const size = Math.min(q.query.size ?? 2, b.maxOnline);
      const on = q.query.day && q.query.day >= today ? q.query.day : today;
      const open = on <= addDays(today, b.aheadDays);
      const a = open ? await availability(db, outlet, on, size) : null;
      return {
        company: company.name,
        logoUrl: settings.logoUrl ?? null,
        outlet: outlet.name,
        today,
        lastDay: addDays(today, b.aheadDays),
        maxOnline: b.maxOnline,
        day: on,
        size,
        deposit: depositFor(b, size),
        // The guest sees times, never which table.
        slots: (a?.slots ?? []).map((s) => ({ startMin: s.startMin, time: s.time, free: s.free })),
        challenge: challenge(secret),
      };
    },
  );

  r.post(
    '/api/public/book/:token',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags,
        params: token,
        body: z.object({
          day,
          startMin: z.number().int().min(0).max(2880),
          partySize: z.number().int().min(1).max(500),
          name: z.string().trim().min(1).max(80),
          mobile: guestMobile,
          email: z.string().trim().email().max(120).nullish(),
          occasion: z.string().trim().max(60).nullish(),
          requests: z.string().trim().max(500).nullish(),
          /** The guest ticked "send me offers". Not ticking it changes nothing already recorded. */
          marketing: z.boolean().default(false),
          challenge: z.string().max(200),
          answer: z.coerce.number().int(),
          website: z.string().max(200).optional(),
        }),
      },
    },
    async (q) => {
      const outlet = await outletFor(q.params.token);
      const b = q.body;
      // Bots fill every box, including the hidden one; people never see it.
      if (b.website) return { ok: true, number: null };
      if (!checkChallenge(secret, b.challenge, b.answer))
        throw new AppError(400, 'VALIDATION_FAILED', 'The sum is not right — try again', {
          challenge: challenge(secret),
        });
      const ctx = { companyId: outlet.companyId, actorId: null, ip: q.ip };
      const { row, guest } = await db.$transaction((tx) =>
        bookIn(
          tx,
          ctx,
          outlet,
          {
            outletId: outlet.id,
            day: b.day,
            startMin: b.startMin,
            partySize: b.partySize,
            guest: { mobile: b.mobile, name: b.name, email: b.email },
            occasion: b.occasion,
            requests: b.requests,
            source: 'ONLINE',
          },
          false,
        ),
      );
      if (b.marketing) await recordConsent(db, ctx, guest.id, { marketing: true, source: 'ONLINE' });
      return {
        ok: true,
        number: resNumber(row.number),
        status: row.status,
        when: whenOf(row),
        deposit: Number(row.depositDue),
        manage: row.token,
      };
    },
  );

  const summary = async (t: string) => {
    const { r: row, outlet } = await byToken(db, t);
    const guest = await db.guest.findFirstOrThrow({ where: { id: row.guestId } });
    return {
      outlet: outlet.name,
      number: resNumber(row.number),
      status: row.status,
      day: row.day,
      time: slotLabel(row.startMin),
      partySize: row.partySize,
      name: guest.name,
      deposit: row.depositState ? { amount: Number(row.depositDue), state: row.depositState } : null,
      canCancel: ['REQUESTED', 'CONFIRMED', 'REMINDED'].includes(row.status),
      cancelFreeHours: outlet.booking.cancelFreeHours,
    };
  };
  r.get(
    '/api/public/booking/:token',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags, params: token } },
    async (q) => summary(q.params.token),
  );
  r.post(
    '/api/public/booking/:token/cancel',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { tags, params: token } },
    async (q) => {
      const { r: row, outlet } = await byToken(db, q.params.token);
      await db.$transaction((tx) =>
        endIn(
          tx,
          { companyId: row.companyId, actorId: null, ip: q.ip },
          outlet,
          row,
          'CANCEL',
          'guest',
          'Cancelled by the guest',
        ),
      );
      return summary(q.params.token);
    },
  );
}
