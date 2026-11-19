import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';
import { withReach } from './reach';
import { withCompanyWall } from './wall';

export type Db = PrismaClient;
/** Interactive-transaction client (what `$transaction(async (tx) => …)` hands you). */
export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

/** How a process talks to the database. Every part has a default; the environment can set each one. */
export type PoolRule = {
  /** Connections this process may hold (DB_POOL_MAX; 15). */
  max?: number;
  /** A single statement is stopped after this long (DB_STATEMENT_TIMEOUT_MS; 30 s). */
  statementTimeoutMs?: number;
  /** Shown in pg_stat_activity, so "who holds this lock" has an answer. */
  name?: string;
  /** The pool does not keep the process alive while its connections are idle (side pools). */
  exitOnIdle?: boolean;
};

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function createPrisma(url = process.env.DATABASE_URL, rule: PoolRule = {}): Db {
  if (!url) throw new Error('DATABASE_URL is not set');
  const statement = rule.statementTimeoutMs ?? num(process.env.DB_STATEMENT_TIMEOUT_MS, 30_000);
  const adapter = new PrismaPg({
    connectionString: url,
    max: rule.max ?? num(process.env.DB_POOL_MAX, 15),
    // Waiting for a free connection, or for the server to answer the first time, ends with an error — not a hang.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    application_name: rule.name ?? process.env.DB_APP_NAME ?? 'mono',
    allowExitOnIdle: rule.exitOnIdle ?? false,
    // Limits the database enforces on every connection of this process: no statement runs for ever, nothing
    // waits on a lock for more than 10 s, and a transaction left open and idle is closed after a minute —
    // so one stuck request cannot hold a lock (or a connection) until somebody restarts the server.
    options: `-c statement_timeout=${statement} -c lock_timeout=10000 -c idle_in_transaction_session_timeout=60000`,
  });
  // Reach (phase 12) is part of the client itself: inside a web request, reads of branch-bearing tables are
  // limited to what the signed-in person may see. Outside one (the worker, seeds) nothing is added.
  // The company wall (decision 250) sits under it: a signed-in request cannot touch another company's rows.
  return withReach(
    withCompanyWall(
      new PrismaClient({
        adapter,
        // In production an error from the database client names what failed, without the values that were
        // sent (they can be a person's details and would end up in the log and in System Master → Errors).
        errorFormat: process.env.NODE_ENV === 'production' ? 'minimal' : 'colorless',
        // A transaction may wait 10 s for a connection and run 20 s (Prisma's own 2 s / 5 s are too short for
        // a busy evening); the few long ones (imports, the night audit) set their own.
        transactionOptions: { maxWait: 10_000, timeout: 20_000 },
      }),
    ),
  );
}

let shared: Db | undefined;

/** Process-wide client (one pool per process). */
export function getPrisma(): Db {
  shared ??= createPrisma();
  return shared;
}

export async function disconnectPrisma(): Promise<void> {
  if (shared) await shared.$disconnect();
  shared = undefined;
}
