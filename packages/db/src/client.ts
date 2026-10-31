import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

export type Db = PrismaClient;
/** Interactive-transaction client (what `$transaction(async (tx) => …)` hands you). */
export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

export function createPrisma(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
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
