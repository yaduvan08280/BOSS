import type { PrismaClient } from './generated/client';
import { COMPANY_MODELS } from './company-models';
import { currentCompany } from './reach';

type Where = Record<string, unknown>;
type Args = { where?: Where; data?: unknown; create?: unknown };

/** Operations that name one row by a unique key: the company rides along in the same `where`. */
const BY_KEY = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']);
/** Operations that take a filter. */
const BY_FILTER = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
]);

export class OtherCompanyError extends Error {
  constructor(model: string) {
    super(`A ${model} row for another company cannot be written from this request`);
    this.name = 'OtherCompanyError';
  }
}

const rowsOf = (data: unknown): Record<string, unknown>[] =>
  (Array.isArray(data) ? data : data ? [data] : []) as Record<string, unknown>[];

/**
 * The company wall (decision 250). Inside a signed-in request, every read and write of a model that belongs to
 * a company is limited to the caller's company by the client itself — whatever the service forgot to check.
 * An id from another company is simply "not there": a look-up finds nothing, an update or delete fails as
 * not found, and a row can only be created for the caller's own company.
 *
 * Outside a request (the worker, seeds, sign-in before the person is known) nothing is added. Code that must
 * read another company on purpose (the owner's linked companies) says so with `acrossCompanies`.
 */
export function withCompanyWall<T extends PrismaClient>(db: T): T {
  return db.$extends({
    name: 'company-wall',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const companyId = currentCompany();
          if (!companyId || !COMPANY_MODELS.has(model)) return query(args);
          const a = { ...((args ?? {}) as Args) };
          if (operation === 'create' || operation === 'createMany' || operation === 'createManyAndReturn') {
            for (const row of rowsOf(a.data))
              if (typeof row.companyId === 'string' && row.companyId !== companyId)
                throw new OtherCompanyError(model);
            return query(args);
          }
          if (BY_KEY.has(operation)) {
            if (operation === 'upsert')
              for (const row of rowsOf(a.create))
                if (typeof row.companyId === 'string' && row.companyId !== companyId)
                  throw new OtherCompanyError(model);
            a.where = { ...a.where, companyId };
          } else if (BY_FILTER.has(operation)) {
            a.where = a.where ? { AND: [a.where, { companyId }] } : { companyId };
          } else return query(args);
          return query(a as typeof args);
        },
      },
    },
  }) as unknown as T;
}
