import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  complianceSchema,
  enquirySchema,
  hallSchema,
  packageSchema,
  tempPointSchema,
  tempReadingSchema,
} from '@mono/shared';
import { z } from 'zod';
import { actorOf } from '../delegation/routes';
import { exciseExport, exciseQuery, exciseRegister } from './bar';
import {
  deleteCompliance,
  listCompliance,
  logTemp,
  renewCompliance,
  renewSchema,
  saveCompliance,
  saveTempPoint,
  tempBoard,
} from './compliance';
import {
  advanceSchema,
  beoSchema,
  completeEvent,
  completeSchema,
  saveBeo,
  takeAdvance,
  tickChecklist,
  tickSchema,
} from './day';
import { endEvent, endSchema, feedbackSchema, saveFeedback, settleEvent, settleSchema } from './close';
import {
  confirmEvent,
  createEnquiry,
  eventQuery,
  getEvent,
  listEvents,
  quoteBody,
  quoteEvent,
} from './events';
import {
  branchRulesPatch,
  calendarQuery,
  deleteHall,
  deletePackage,
  getBranchRules,
  hallCalendar,
  listHalls,
  listPackages,
  saveBranchRules,
  saveHall,
  savePackage,
} from './halls';

const idParam = z.object({ id: z.string() });
const branchQuery = z.object({ branchId: z.string().min(1) });

/** Banquets and events, the bar's excise register, and compliance (phase 18). */
export async function banquetRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['banquets'];
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

  r.get('/api/banquets/halls', query(branchQuery.partial()), async (q) =>
    listHalls(db, actorOf(q), q.query.branchId),
  );
  r.post('/api/banquets/halls', body(hallSchema), async (q) => saveHall(db, actorOf(q), q.body));
  r.put('/api/banquets/halls/:id', withId(hallSchema), async (q) =>
    saveHall(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/banquets/halls/:id', byId(), async (q) => deleteHall(db, actorOf(q), q.params.id));
  r.get('/api/banquets/packages', view(), async (q) => listPackages(db, actorOf(q)));
  r.post('/api/banquets/packages', body(packageSchema), async (q) => savePackage(db, actorOf(q), q.body));
  r.put('/api/banquets/packages/:id', withId(packageSchema), async (q) =>
    savePackage(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/banquets/packages/:id', byId(), async (q) => deletePackage(db, actorOf(q), q.params.id));
  r.get('/api/hosp/branch-rules', query(branchQuery), async (q) =>
    getBranchRules(db, actorOf(q), q.query.branchId),
  );
  r.put(
    '/api/hosp/branch-rules',
    { ...view(), schema: { tags, querystring: branchQuery, body: branchRulesPatch } },
    async (q) => saveBranchRules(db, actorOf(q), q.query.branchId, q.body),
  );
  r.get('/api/banquets/calendar', query(calendarQuery), async (q) => hallCalendar(db, actorOf(q), q.query));

  r.get('/api/banquets/events', query(eventQuery), async (q) => listEvents(db, actorOf(q), q.query));
  r.post('/api/banquets/events', body(enquirySchema), async (q) => createEnquiry(db, actorOf(q), q.body));
  r.get('/api/banquets/events/:id', byId(), async (q) => getEvent(db, actorOf(q), q.params.id));
  r.post('/api/banquets/events/:id/quote', withId(quoteBody), async (q) =>
    quoteEvent(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/banquets/events/:id/advance', withId(advanceSchema), async (q) =>
    takeAdvance(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/banquets/events/:id/confirm', byId(), async (q) => confirmEvent(db, actorOf(q), q.params.id));
  r.post('/api/banquets/events/:id/beo', withId(beoSchema), async (q) =>
    saveBeo(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/banquets/events/:id/checklist', withId(tickSchema), async (q) =>
    tickChecklist(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/banquets/events/:id/complete', withId(completeSchema), async (q) =>
    completeEvent(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/banquets/events/:id/settle', withId(settleSchema), async (q) =>
    settleEvent(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/banquets/events/:id/feedback', withId(feedbackSchema), async (q) =>
    saveFeedback(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/banquets/events/:id/end', withId(endSchema), async (q) =>
    endEvent(db, actorOf(q), q.params.id, q.body),
  );

  r.get('/api/bar/excise', query(exciseQuery), async (q) => exciseRegister(db, actorOf(q), q.query));
  r.get('/api/bar/excise.csv', query(exciseQuery), async (q, reply) =>
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="excise-${q.query.from}.csv"`)
      .send(await exciseExport(db, actorOf(q), q.query)),
  );

  r.get('/api/compliance', query(branchQuery), async (q) => listCompliance(db, actorOf(q), q.query.branchId));
  r.post('/api/compliance', body(complianceSchema), async (q) => saveCompliance(db, actorOf(q), q.body));
  r.put('/api/compliance/:id', withId(complianceSchema), async (q) =>
    saveCompliance(db, actorOf(q), q.body, q.params.id),
  );
  r.post('/api/compliance/:id/renew', withId(renewSchema), async (q) =>
    renewCompliance(db, actorOf(q), q.params.id, q.body),
  );
  r.delete('/api/compliance/:id', byId(), async (q) => deleteCompliance(db, actorOf(q), q.params.id));
  r.get('/api/compliance/temps', query(branchQuery), async (q) =>
    tempBoard(db, actorOf(q), q.query.branchId),
  );
  r.post('/api/compliance/temps', body(tempPointSchema), async (q) => saveTempPoint(db, actorOf(q), q.body));
  r.post('/api/compliance/temps/:id/readings', withId(tempReadingSchema), async (q) =>
    logTemp(db, actorOf(q), q.params.id, q.body),
  );
}
