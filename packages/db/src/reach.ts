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
};

const store = new AsyncLocalStorage<{ reach: Reach | null }>();

/** Run a request inside its own reach slot (set later, once the person is known). */
export const runWithReachSlot = <T>(fn: () => T): T => store.run({ reach: null }, fn);
/** The person is known: everything this request reads from here on is limited to their reach. */
export function setReach(reach: Reach | null) {
  const slot = store.getStore();
  if (slot) slot.reach = reach;
}
export const currentReach = (): Reach | null => store.getStore()?.reach ?? null;
/** For tests and jobs that act as a person outside a web request. */
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
};

/** Models that carry a branch but are not filtered by reach, with the reason. */
export const BRANCH_FREE_MODELS: Record<string, string> = {
  User: 'people are named across branches (a task given by head office); the Users screen filters by itself',
  Holiday: 'the calendar is read by everyone',
  WeeklyOff: 'the calendar is read by everyone',
  Location: 'set-up data, listed through the branch',
  BranchManager: 'set-up data: who runs what',
  UserBranch: 'set-up data: who works where',
  DepartmentHead: 'set-up data: who heads what',
  ApprovalRoute: 'set-up data: the owner’s routing',
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
  if (!reach || reach.branchIds === null) return null;
  const part = BRANCH_SCOPED_MODELS[model];
  if (!part) return null;
  const own = reach.strict ? [] : part(reach.userId);
  return { OR: [{ branchId: null }, { branchId: { in: reach.branchIds } }, ...own] };
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
          a.where = a.where ? { AND: [a.where, extra] } : extra;
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
  if (!reach || reach.branchIds === null) return Prisma.sql`TRUE`;
  const inBranches = reach.branchIds.length
    ? Prisma.sql`r.branch_id IN (${Prisma.join(reach.branchIds)})`
    : Prisma.sql`FALSE`;
  if (reach.strict) return Prisma.sql`(r.branch_id IS NULL OR ${inBranches})`;
  const own =
    table === 'records'
      ? Prisma.sql`r.created_by_id = ${reach.userId}`
      : Prisma.sql`(r.started_by_id = ${reach.userId} OR EXISTS (
          SELECT 1 FROM fms_record_steps s WHERE s.record_id = r.id AND s.doer_id = ${reach.userId}))`;
  return Prisma.sql`(r.branch_id IS NULL OR ${inBranches} OR ${own})`;
}
