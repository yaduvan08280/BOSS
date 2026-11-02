import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db, Prisma } from '@mono/db';
import {
  availableActions,
  ticketActionSchema,
  ticketCreateSchema,
  ticketMachine,
  type TicketStatus,
} from '@mono/shared';
import { actorOf } from '../delegation/routes';
import { can, teamOf, type Actor } from '../work/actor';
import { moduleSettings } from '../work/settings';
import { actOnTicket, createTicket, ticketCtx, ticketDetail, ticketRoles } from './service';

const idParam = z.object({ id: z.string() });
const TABS = ['mine', 'assigned', 'all'] as const;
const LIVE: TicketStatus[] = ['OPEN', 'IN_PROGRESS'];

async function listTickets(db: Db, actor: Actor, tab: (typeof TABS)[number]) {
  const s = await moduleSettings(db, actor.companyId, 'ticket');
  const me = actor.userId;
  const base = { companyId: actor.companyId, deletedAt: null };
  const team = can(actor, 'ticket.admin') ? null : await teamOf(db, actor.companyId, me);
  const involved: Prisma.TicketWhereInput = {
    OR: [
      { raiserId: me },
      { solverId: me },
      { coordinatorId: me },
      ...(team?.length ? [{ raiserId: { in: team } }, { solverId: { in: team } }] : []),
    ],
  };
  const where: Prisma.TicketWhereInput = {
    ...base,
    ...(tab === 'mine' ? { raiserId: me } : tab === 'assigned' ? { solverId: me } : team ? involved : {}),
  };
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [rows, mine, assigned, scope] = await Promise.all([
    db.ticket.findMany({ where, orderBy: [{ status: 'asc' }, { plannedFixAt: 'asc' }], take: 300 }),
    db.ticket.count({ where: { ...base, raiserId: me, status: { in: [...LIVE, 'RESOLVED'] } } }),
    db.ticket.count({ where: { ...base, solverId: me, status: { in: LIVE } } }),
    db.ticket.findMany({
      where: { ...base, ...(team ? involved : {}) },
      select: { status: true, escalationLevel: true, closedAt: true, plannedFixAt: true },
    }),
  ]);
  const now = new Date();
  const live = scope.filter((x) => LIVE.includes(x.status as TicketStatus));
  return {
    tickets: rows.map((x) => ({
      ...x,
      actions: availableActions(
        ticketMachine,
        x.status as TicketStatus,
        ticketRoles(actor, x),
        ticketCtx(s),
      ).filter((a) => a !== 'autoClose'),
    })),
    counts: { mine, assigned },
    tiles: {
      open: live.length,
      late: live.filter((x) => x.plannedFixAt < now).length,
      escalated: live.filter((x) => x.escalationLevel > 0).length,
      waiting: scope.filter((x) => x.status === 'RESOLVED').length,
      closedWeek: scope.filter((x) => x.status === 'CLOSED' && x.closedAt && x.closedAt > weekAgo).length,
    },
    settings: { fixHours: s.fixHours, proofToResolve: s.proofToResolve },
  };
}

/** Help Tickets (CLAUDE.md §5.4). */
export async function ticketRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const view = { onRequest: [app.requirePermission('ticket.view')] };

  r.get(
    '/api/tickets',
    {
      ...view,
      schema: { tags: ['ticket'], querystring: z.object({ tab: z.enum(TABS).default('assigned') }) },
    },
    async (request) => listTickets(app.prisma, actorOf(request), request.query.tab),
  );
  r.get('/api/tickets/:id', { ...view, schema: { tags: ['ticket'], params: idParam } }, async (request) =>
    ticketDetail(app.prisma, actorOf(request), request.params.id),
  );
  r.post(
    '/api/tickets',
    { ...view, schema: { tags: ['ticket'], body: ticketCreateSchema } },
    async (request) => createTicket(app.prisma, actorOf(request), request.body),
  );
  r.post(
    '/api/tickets/:id/actions',
    { ...view, schema: { tags: ['ticket'], params: idParam, body: ticketActionSchema } },
    async (request) => actOnTicket(app.prisma, actorOf(request), request.params.id, request.body),
  );
}
