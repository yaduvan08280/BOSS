import type { FastifyRequest } from 'fastify';
import type { Tx } from '@mono/db';
import { actorOf } from '../plugins/auth';
import type { ActorContext } from './audit';

/**
 * Run a mutation in one transaction on the company-scoped client.
 * `tx` is scoped (company filter applied); `raw` is the same transaction for helpers typed on the base client.
 */
export async function inCompanyTx<T>(
  request: FastifyRequest,
  fn: (tx: Tx, ctx: ActorContext & { actorId: string }) => Promise<T>,
): Promise<T> {
  const ctx = { ...actorOf(request), actorId: request.auth!.userId };
  return request.db.$transaction((tx) => fn(tx as unknown as Tx, ctx));
}
