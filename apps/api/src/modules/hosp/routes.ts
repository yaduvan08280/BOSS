import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  kotRouteSchema,
  menuCategorySchema,
  menuItemSchema,
  modifierGroupSchema,
  outletSchema,
  printerSchema,
  roomSchema,
  roomTypeSchema,
  roomsBulkSchema,
  stationSchema,
  tableSchema,
  tablesBulkSchema,
} from '@mono/shared';
import { z } from 'zod';
import { actorOf } from '../delegation/routes';
import {
  addTables,
  deleteFloor,
  deleteTable,
  floorPlan,
  floorSchema,
  moveTables,
  movesSchema,
  saveFloor,
  saveTable,
} from './floors';
import {
  deleteCategory,
  deleteMenuItem,
  deleteModifierGroup,
  importMenu,
  menuSetup,
  pricesSchema,
  saveCategory,
  saveMenuItem,
  saveModifierGroup,
  savePrices,
  set86,
} from './menu';
import { menuFor } from './menu-read';
import {
  deleteOutlet,
  deletePrinter,
  deleteStation,
  listOutlets,
  listPrinters,
  saveOutlet,
  savePrinter,
  saveRoutes,
  saveStation,
} from './outlets';
import { addRooms, deleteRoom, deleteRoomType, listRooms, saveRoom, saveRoomType } from './rooms';
import { hospSettingsSchema, readHosp, saveHosp } from './settings';

const idParam = z.object({ id: z.string() });

/** Hospitality set-up and menu (phase 14). The services check the finer rights and the person's branches. */
export async function hospRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['hosp'];
  // A fresh hook list per route (decision 62).
  const view = () => ({ onRequest: [app.requirePermission('hosp.view')] });
  const db = app.prisma;
  const plain = () => ({ ...view(), schema: { tags } });
  const body = <T extends z.ZodTypeAny>(schema: T) => ({ ...view(), schema: { tags, body: schema } });
  const withId = <T extends z.ZodTypeAny>(schema: T) => ({
    ...view(),
    schema: { tags, params: idParam, body: schema },
  });
  const byId = () => ({ ...view(), schema: { tags, params: idParam } });

  r.get('/api/hosp/settings', plain(), async (q) => readHosp(db, actorOf(q)));
  r.put('/api/hosp/settings', body(hospSettingsSchema), async (q) => saveHosp(db, actorOf(q), q.body));

  r.get('/api/hosp/outlets', plain(), async (q) => listOutlets(db, actorOf(q)));
  r.post('/api/hosp/outlets', body(outletSchema), async (q) => saveOutlet(db, actorOf(q), q.body));
  r.put('/api/hosp/outlets/:id', withId(outletSchema), async (q) =>
    saveOutlet(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/hosp/outlets/:id', byId(), async (q) => deleteOutlet(db, actorOf(q), q.params.id));
  r.post('/api/hosp/stations', body(stationSchema), async (q) => saveStation(db, actorOf(q), q.body));
  r.put('/api/hosp/stations/:id', withId(stationSchema), async (q) =>
    saveStation(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/hosp/stations/:id', byId(), async (q) => deleteStation(db, actorOf(q), q.params.id));
  r.put('/api/hosp/routes', body(kotRouteSchema), async (q) => saveRoutes(db, actorOf(q), q.body));
  r.get('/api/hosp/printers', plain(), async (q) => listPrinters(db, actorOf(q)));
  r.post('/api/hosp/printers', body(printerSchema), async (q) => savePrinter(db, actorOf(q), q.body));
  r.put('/api/hosp/printers/:id', withId(printerSchema), async (q) =>
    savePrinter(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/hosp/printers/:id', byId(), async (q) => deletePrinter(db, actorOf(q), q.params.id));

  r.get('/api/hosp/outlets/:id/plan', byId(), async (q) => floorPlan(db, actorOf(q), q.params.id));
  r.post('/api/hosp/floors', body(floorSchema), async (q) => saveFloor(db, actorOf(q), q.body));
  r.put('/api/hosp/floors/:id', withId(floorSchema), async (q) =>
    saveFloor(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/hosp/floors/:id', byId(), async (q) => deleteFloor(db, actorOf(q), q.params.id));
  r.post('/api/hosp/tables', body(tableSchema), async (q) => saveTable(db, actorOf(q), q.body));
  r.put('/api/hosp/tables/:id', withId(tableSchema), async (q) =>
    saveTable(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/hosp/tables/:id', byId(), async (q) => deleteTable(db, actorOf(q), q.params.id));
  r.post('/api/hosp/tables/bulk', body(tablesBulkSchema), async (q) => addTables(db, actorOf(q), q.body));
  r.post('/api/hosp/tables/move', body(movesSchema), async (q) => moveTables(db, actorOf(q), q.body));

  r.get(
    '/api/hosp/rooms',
    { ...view(), schema: { tags, querystring: z.object({ branchId: z.string().optional() }) } },
    async (q) => listRooms(db, actorOf(q), q.query.branchId),
  );
  r.post('/api/hosp/room-types', body(roomTypeSchema), async (q) => saveRoomType(db, actorOf(q), q.body));
  r.put('/api/hosp/room-types/:id', withId(roomTypeSchema), async (q) =>
    saveRoomType(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/hosp/room-types/:id', byId(), async (q) => deleteRoomType(db, actorOf(q), q.params.id));
  r.post('/api/hosp/rooms', body(roomSchema), async (q) => saveRoom(db, actorOf(q), q.body));
  r.put('/api/hosp/rooms/:id', withId(roomSchema), async (q) =>
    saveRoom(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/hosp/rooms/:id', byId(), async (q) => deleteRoom(db, actorOf(q), q.params.id));
  r.post('/api/hosp/rooms/bulk', body(roomsBulkSchema), async (q) => addRooms(db, actorOf(q), q.body));

  r.get('/api/hosp/menu', plain(), async (q) => menuSetup(db, actorOf(q)));
  r.get(
    '/api/hosp/outlets/:id/menu',
    {
      ...view(),
      schema: { tags, params: idParam, querystring: z.object({ at: z.string().datetime().optional() }) },
    },
    async (q) => menuFor(db, actorOf(q), q.params.id, q.query.at ? new Date(q.query.at) : new Date()),
  );
  r.post('/api/hosp/menu/categories', body(menuCategorySchema), async (q) =>
    saveCategory(db, actorOf(q), q.body),
  );
  r.put('/api/hosp/menu/categories/:id', withId(menuCategorySchema), async (q) =>
    saveCategory(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/hosp/menu/categories/:id', byId(), async (q) => deleteCategory(db, actorOf(q), q.params.id));
  r.post('/api/hosp/menu/groups', body(modifierGroupSchema), async (q) =>
    saveModifierGroup(db, actorOf(q), q.body),
  );
  r.put('/api/hosp/menu/groups/:id', withId(modifierGroupSchema), async (q) =>
    saveModifierGroup(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/hosp/menu/groups/:id', byId(), async (q) =>
    deleteModifierGroup(db, actorOf(q), q.params.id),
  );
  r.post('/api/hosp/menu/items', body(menuItemSchema), async (q) => saveMenuItem(db, actorOf(q), q.body));
  r.put('/api/hosp/menu/items/:id', withId(menuItemSchema), async (q) =>
    saveMenuItem(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/hosp/menu/items/:id', byId(), async (q) => deleteMenuItem(db, actorOf(q), q.params.id));
  r.put('/api/hosp/menu/items/:id/prices', withId(pricesSchema), async (q) =>
    savePrices(db, actorOf(q), q.params.id, q.body),
  );
  r.post(
    '/api/hosp/menu/items/:id/86',
    withId(z.object({ off: z.boolean(), reason: z.string().trim().max(200).nullish() })),
    async (q) => set86(db, actorOf(q), q.params.id, q.body.off, q.body.reason),
  );
  r.post('/api/hosp/menu/import', body(z.object({ text: z.string().min(1).max(200_000) })), async (q) =>
    importMenu(db, actorOf(q), q.body.text),
  );
}
