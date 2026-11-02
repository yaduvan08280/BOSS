import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db, Prisma } from '@mono/db';
import {
  availableActions,
  slipActionSchema,
  slipCreateSchema,
  slipMachine,
  type SlipStatus,
} from '@mono/shared';
import { actorOf } from '../delegation/routes';
import { can, teamOf, type Actor } from '../work/actor';
import { moduleSettings } from '../work/settings';
import { actOnSlip, createSlip, slipCtx, slipDetail, slipRoles, slipWaitingOn } from './service';

const idParam = z.object({ id: z.string() });
const OPEN: SlipStatus[] = ['SUBMITTED', 'RETURNED', 'WITH_APPROVER'];
const TABS = ['mine', 'inbox', 'all'] as const;

/** Slips waiting on this person: to screen, to decide, to fix and resubmit, or to close. */
const inboxWhere = (me: string, approverStep: boolean): Prisma.SlipWhereInput => ({
  OR: [
    { status: 'SUBMITTED', receiverId: me },
    ...(approverStep ? [{ status: 'WITH_APPROVER', approverId: me }] : []),
    { status: { in: ['RETURNED', 'APPROVED', 'REJECTED'] }, raiserId: me },
  ],
});

async function listSlips(db: Db, actor: Actor, tab: (typeof TABS)[number]) {
  const s = await moduleSettings(db, actor.companyId, 'slip');
  const me = actor.userId;
  const base = { companyId: actor.companyId, deletedAt: null };
  const team = can(actor, 'slip.admin') ? null : await teamOf(db, actor.companyId, me);
  const involved: Prisma.SlipWhereInput = {
    OR: [
      { raiserId: me },
      { receiverId: me },
      { approverId: me },
      { accountableId: me },
      ...(team?.length ? [{ raiserId: { in: team } }] : []),
    ],
  };
  const where: Prisma.SlipWhereInput = {
    ...base,
    ...(tab === 'mine'
      ? { raiserId: me }
      : tab === 'inbox'
        ? inboxWhere(me, s.approverStep)
        : team
          ? involved
          : {}),
  };
  const [rows, mine, inbox, all] = await Promise.all([
    db.slip.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { solutions: { orderBy: { position: 'asc' }, select: { id: true, text: true } } },
    }),
    db.slip.count({ where: { ...base, raiserId: me, status: { in: OPEN } } }),
    db.slip.count({ where: { ...base, ...inboxWhere(me, s.approverStep) } }),
    db.slip.findMany({
      where: { ...base, ...(team ? involved : {}) },
      select: {
        status: true,
        stepSince: true,
        raiserId: true,
        receiverId: true,
        approverId: true,
        decidedAt: true,
      },
    }),
  ]);
  const now = Date.now();
  const late = (x: (typeof all)[number]) => {
    const w = slipWaitingOn(x, s);
    return Boolean(w && OPEN.includes(x.status as SlipStatus) && w.dueAt.getTime() < now);
  };
  const monthAgo = now - 30 * 86_400_000;
  return {
    slips: rows.map((x) => ({
      ...x,
      waitingOn: slipWaitingOn(x, s),
      actions: availableActions(slipMachine, x.status as SlipStatus, slipRoles(actor, x), slipCtx(s)),
    })),
    counts: { mine, inbox },
    tiles: {
      open: all.filter((x) => OPEN.includes(x.status as SlipStatus)).length,
      withMe: inbox,
      late: all.filter(late).length,
      approved: all.filter((x) => x.status !== 'REJECTED' && x.decidedAt && x.decidedAt.getTime() > monthAgo)
        .length,
      rejected: all.filter((x) => x.status === 'REJECTED').length,
    },
    settings: { solutionsRequired: s.solutionsRequired },
  };
}

/** Help Slips (CLAUDE.md §5.3). Rights per slip come from the state machine. */
export async function slipRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const view = { onRequest: [app.requirePermission('slip.view')] };

  r.get(
    '/api/slips',
    {
      ...view,
      schema: { tags: ['slip'], querystring: z.object({ tab: z.enum(TABS).default('inbox') }) },
    },
    async (request) => listSlips(app.prisma, actorOf(request), request.query.tab),
  );
  r.get('/api/slips/:id', { ...view, schema: { tags: ['slip'], params: idParam } }, async (request) =>
    slipDetail(app.prisma, actorOf(request), request.params.id),
  );
  r.post('/api/slips', { ...view, schema: { tags: ['slip'], body: slipCreateSchema } }, async (request) =>
    createSlip(app.prisma, actorOf(request), request.body),
  );
  r.post(
    '/api/slips/:id/actions',
    { ...view, schema: { tags: ['slip'], params: idParam, body: slipActionSchema } },
    async (request) => actOnSlip(app.prisma, actorOf(request), request.params.id, request.body),
  );
}
