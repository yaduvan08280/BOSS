import type { Tx } from '@mono/db';
import type { RecordMove } from '@mono/shared';
import type { LoadedType } from './access';
import { startFlowOnMove } from './start-flow';

/** What a status change hands to whatever listens ("this move starts a process"). */
export type StatusChange = {
  companyId: string;
  actorId: string;
  type: LoadedType;
  record: { id: string; code: string; title: string; data: Record<string, unknown> };
  from: string;
  to: string;
  move: RecordMove;
  note: string | null;
};

export type StatusHook = (tx: Tx, change: StatusChange) => Promise<void>;

/**
 * Run inside the transaction that changes a record's status, after the status, the history line and the domain
 * event are written, so a failing hook rolls the status change back with it.
 */
export const statusHooks: StatusHook[] = [startFlowOnMove];

export async function runStatusHooks(tx: Tx, change: StatusChange) {
  for (const hook of statusHooks) await hook(tx, change);
}
