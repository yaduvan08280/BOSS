import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, type PrismaClient } from './generated/client';

/**
 * Reach (phase 12, plan §3.3): how far the person behind the current request sees. `branchIds: null` means the
 * whole group. With a list, every read of a branch-bearing model returns only rows of those branches, rows with
 * no branch (group-wide, or made before branches existed) and rows the person is personally part of.
 */
export type Reach = {
  userId: string;
  branchIds: string[] | null;
  /** The person picked one branch in the top bar: show that branch only, not their own rows elsewhere. */
  strict?: boolean;
  /**
   * A franchise's own person (stage D): nothing outside their entity's branches — not even what is group-wide,
   * except brand content the group shares with franchises.
   */
  isolated?: boolean;
  /** With `isolated`: the franchise itself — its entity and all its branches (kept when the switcher narrows). */
  franchise?: { entityId: string; branchIds: string[] };
  /**
   * A group person without the franchise-oversight right: the whole group (`branchIds: null`) except these
   * branches — the franchises'.
   */
  exceptBranchIds?: string[];
};

/** Models whose rows always have a branch: there is no "group-wide" row to ask for. */
const ALWAYS_AT_A_BRANCH = new Set(['BrandAudit', 'DayClose']);

/** Brand content the group shares with franchises, read-only: models with a `shared` flag on a group-wide row. */
const SHARED_WITH_FRANCHISES: Record<string, Where> = {
  ChecklistMaster: { branchId: null, shared: true },
  MasterRow: { branchId: null, master: { shared: true } },
};

/**
 * The same limits for a plain branch column (people's home branch, a list of branches): null = no limit.
 * `orNull` keeps rows with no branch (someone at head office) when only the franchises are left out.
 */
export function reachBranch(field = 'branchId', reach = currentReach()): Where | null {
  if (!reach) return null;
  if (reach.branchIds) return { [field]: { in: reach.branchIds } };
  if (reach.exceptBranchIds?.length)
    return field === 'id'
      ? { id: { notIn: reach.exceptBranchIds } }
      : { OR: [{ [field]: null }, { [field]: { notIn: reach.exceptBranchIds } }] };
  return null;
}

const store = new AsyncLocalStorage<{ reach: Reach | null }>();

/** Run a request inside its own reach slot (set later, once the person is known). */
export const runWithReachSlot = <T>(fn: () => T): T => store.run({ reach: null }, fn);
/** The person is known: everything this request reads from here on is limited to their reach. */
export function setReach(reach: Reach | null) {
  const slot = store.getStore();
  if (slot) slot.reach = reach;
}
export const currentReach = (): Reach | null => store.getStore()?.reach ?? null;
/** For tests and jobs that act as a person outside a web request. `fn` must await its queries itself: Prisma
 * queries are lazy and run when awaited, so a query returned un-awaited would run outside this reach. */
export const withReachOf = <T>(reach: Reach | null, fn: () => Promise<T>): Promise<T> =>
  store.run({ reach }, fn);

type Where = Record<string, unknown>;

/**
 * Branch-bearing models that are filtered by reach, each with the ways a person is "part of" a row whatever its
 * branch (a task given to me, a ticket I raised, a process step that is mine). Kept in sync with the schema by
 * `reach.test.ts`: a new model with `branchId` must be listed here or in `BRANCH_FREE_MODELS`.
 */
export const BRANCH_SCOPED_MODELS: Record<string, (userId: string) => Where[]> = {
  Task: (u) => [{ doerId: u }, { creatorId: u }, { verifierId: u }],
  ChecklistMaster: (u) => [{ createdById: u }, { verifierId: u }],
  ChecklistRun: (u) => [{ doerId: u }, { verifierId: u }],
  Slip: (u) => [{ raiserId: u }, { receiverId: u }, { approverId: u }],
  Ticket: (u) => [{ raiserId: u }, { solverId: u }],
  FmsRecord: (u) => [{ startedById: u }, { steps: { some: { doerId: u } } }],
  Document: (u) => [{ createdById: u }],
  PurchaseOrder: (u) => [{ createdById: u }],
  SalesOrder: () => [],
  RecordEntry: (u) => [{ createdById: u }],
  MasterRow: () => [],
  Punch: (u) => [{ userId: u }],
  BrandAudit: (u) => [{ auditorId: u }],
  Bill: (u) => [{ createdById: u }],
  DayClose: (u) => [{ closedById: u }],
};

/**
 * Rows that belong to a branch through their parent (a process step through its record): fenced the same way, so
 * counts and lists made from the child table stay inside the reach too.
 */
export const BRANCH_CHILD_MODELS: Record<
  string,
  { relation: string; parent: string; own: (userId: string) => Where[] }
> = {
  FmsRecordStep: { relation: 'record', parent: 'FmsRecord', own: (u) => [{ doerId: u }] },
};

/** Models that carry a branch but are not filtered by reach, with the reason. */
export const BRANCH_FREE_MODELS: Record<string, string> = {
  User: 'people are named across branches (a task given by head office); the Users screen filters by itself',
  PulseRating: "guests' ratings are read only through the owner's desk and the outlet's manager",
  SpotCheck: 'asked of one person and decided by one person; listed through its own service',
  Holiday: 'the calendar is read by everyone',
  WeeklyOff: 'the calendar is read by everyone',
  Location: 'set-up data, listed through the branch',
  BranchManager: 'set-up data: who runs what',
  UserBranch: 'set-up data: who works where',
  DepartmentHead: 'set-up data: who heads what',
  ApprovalRoute: 'set-up data: the owner’s routing',
  BranchLoan: 'set-up data: who is lent where and when',
  BranchStay: 'set-up data: where a person works from which day',
  AttendanceDay: 'attendance is listed by HR scope (HR all, an HOD their team, everyone themselves)',
  PaymentMode: 'set-up data: how money is taken at a branch',
  HotelSettings:
    "a hotel's rows are reached through its branch: the hotel services check the branch against the person's branches",
  RatePlan:
    "a hotel's rows are reached through its branch: the hotel services check the branch against the person's branches",
  RoomDay:
    "a hotel's rows are reached through its branch: the hotel services check the branch against the person's branches",
  GroupBlock:
    "a hotel's rows are reached through its branch: the hotel services check the branch against the person's branches",
  Stay: "a hotel's rows are reached through its branch: the hotel services check the branch against the person's branches",
  RoomNight:
    "a hotel's rows are reached through its branch: the hotel services check the branch against the person's branches",
  RoomBlock:
    "a hotel's rows are reached through its branch: the hotel services check the branch against the person's branches",
  Folio:
    "a hotel's rows are reached through its branch: the hotel services check the branch against the person's branches",
  NightAudit:
    "a hotel's rows are reached through its branch: the hotel services check the branch against the person's branches",
  HkTask:
    "a hotel's rows are reached through its branch: the hotel services check the branch against the person's branches",
  LostFound:
    "a hotel's rows are reached through its branch: the hotel services check the branch against the person's branches",
  BranchRule:
    "reached through its branch: the banquet and compliance services check the branch against the person's branches",
  Hall: "reached through its branch: the banquet and compliance services check the branch against the person's branches",
  BanquetEvent:
    "reached through its branch: the banquet and compliance services check the branch against the person's branches",
  ComplianceItem:
    "reached through its branch: the banquet and compliance services check the branch against the person's branches",
  TempPoint:
    "reached through its branch: the banquet and compliance services check the branch against the person's branches",
  TempReading:
    "reached through its branch: the banquet and compliance services check the branch against the person's branches",
  AgentToken:
    "a site agent's key is managed by admins and used by the agent itself, never listed by branch reach",
  Reservation:
    "reached through its outlet: the reservation services check the outlet against the person's branches",
  WaitlistEntry: 'reached through its outlet, like a reservation',
  PosOrder: "reached through its outlet: the POS services check the outlet against the person's branches",
  Outlet: "set-up data, listed through the branch (the hospitality services filter by the person's branches)",
  RoomType: 'set-up data, listed through the branch',
  Room: 'set-up data, listed through the branch',
  Printer: 'set-up data: a printer may serve the whole group or one branch',
  PriceList: 'set-up data: prices are read by whoever sells; a list for a branch is chosen by the price rule',
  ModuleBranchSetting: 'set-up data: a branch’s own flow-designer people',
};

const FILTERED = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

/** What a reach adds to a where on one model (null = nothing: the model is free, or the reach is the group). */
export function reachWhere(model: string, reach: Reach | null): Where | null {
  if (!reach) return null;
  // People, branches and entities are set-up data everyone may normally read. Franchises are the exception:
  // a franchise's person sees only their own franchise's, and a group person without oversight not the franchises'.
  if (model === 'User' || model === 'Branch' || model === 'LegalEntity') {
    const key = model === 'User' ? 'branchId' : 'id';
    if (reach.franchise) {
      if (model === 'LegalEntity') return { id: reach.franchise.entityId };
      const inside = { [key]: { in: reach.franchise.branchIds } };
      return model === 'User' ? { OR: [inside, { id: reach.userId }] } : inside;
    }
    if (reach.exceptBranchIds?.length && model !== 'LegalEntity')
      return model === 'User'
        ? { OR: [{ branchId: null }, { branchId: { notIn: reach.exceptBranchIds } }] }
        : { id: { notIn: reach.exceptBranchIds } };
    return null;
  }
  if (reach.branchIds === null) {
    // The whole group, minus the franchises for someone without the oversight right.
    if (!reach.exceptBranchIds?.length) return null;
    const outside: Where[] = [
      ...(ALWAYS_AT_A_BRANCH.has(model) ? [] : [{ branchId: null }]),
      { branchId: { notIn: reach.exceptBranchIds } },
    ];
    const kid = BRANCH_CHILD_MODELS[model];
    if (kid) return { [kid.relation]: { OR: outside } };
    return BRANCH_SCOPED_MODELS[model] ? { OR: outside } : null;
  }
  // A franchise's person sees no group-wide rows — only brand content shared with franchises.
  const inReach: Where[] = reach.isolated
    ? [
        { branchId: { in: reach.branchIds } },
        ...(SHARED_WITH_FRANCHISES[model] ? [SHARED_WITH_FRANCHISES[model]!] : []),
      ]
    : [...(ALWAYS_AT_A_BRANCH.has(model) ? [] : [{ branchId: null }]), { branchId: { in: reach.branchIds } }];
  const child = BRANCH_CHILD_MODELS[model];
  if (child) {
    const own = reach.strict ? [] : child.own(reach.userId);
    return { OR: [{ [child.relation]: { OR: inReach } }, ...own] };
  }
  const part = BRANCH_SCOPED_MODELS[model];
  if (!part) return null;
  const own = reach.strict ? [] : part(reach.userId);
  return { OR: [...inReach, ...own] };
}

/** The base client with reach built in: there is no way to read a branch-bearing table around it. */
export function withReach<T extends PrismaClient>(db: T): T {
  return db.$extends({
    name: 'reach',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const extra = FILTERED.has(operation) ? reachWhere(model, currentReach()) : null;
          if (!extra) return query(args);
          const a = { ...((args ?? {}) as { where?: Where }) };
          // A unique look-up keeps its key on top; the limit rides along as an extra condition.
          if (operation.startsWith('findUnique') && a.where) {
            const more = a.where.AND;
            a.where = { ...a.where, AND: [...(Array.isArray(more) ? more : more ? [more] : []), extra] };
          } else a.where = a.where ? { AND: [a.where, extra] } : extra;
          return query(a as typeof args);
        },
      },
    },
  }) as unknown as T;
}

/**
 * The same fence for hand-written SQL (record lists, reports): a condition on the row aliased `r`, or TRUE when
 * the current request sees the whole group. `mine` are the columns that make a row the person's own; process
 * records also count a step that is theirs.
 */
export function reachSql(table: 'records' | 'fms_records'): Prisma.Sql {
  const reach = currentReach();
  if (!reach) return Prisma.sql`TRUE`;
  if (reach.branchIds === null)
    return reach.exceptBranchIds?.length
      ? Prisma.sql`(r.branch_id IS NULL OR r.branch_id NOT IN (${Prisma.join(reach.exceptBranchIds)}))`
      : Prisma.sql`TRUE`;
  const inBranches = reach.branchIds.length
    ? Prisma.sql`r.branch_id IN (${Prisma.join(reach.branchIds)})`
    : Prisma.sql`FALSE`;
  if (reach.isolated && reach.strict) return inBranches;
  if (reach.strict) return Prisma.sql`(r.branch_id IS NULL OR ${inBranches})`;
  const own =
    table === 'records'
      ? Prisma.sql`r.created_by_id = ${reach.userId}`
      : Prisma.sql`(r.started_by_id = ${reach.userId} OR EXISTS (
          SELECT 1 FROM fms_record_steps s WHERE s.record_id = r.id AND s.doer_id = ${reach.userId}))`;
  if (reach.isolated) return Prisma.sql`(${inBranches} OR ${own})`;
  return Prisma.sql`(r.branch_id IS NULL OR ${inBranches} OR ${own})`;
}
