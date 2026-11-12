import { currentReach } from '@mono/db';
import { AppError } from '../../lib/errors';
import { can, type Actor } from '../work/actor';

/**
 * The brand team: people of the group with the franchise right. A franchise's own person never counts, whatever
 * role they hold inside their franchise.
 */
export function needBrandTeam(actor: Actor, what: string) {
  if (currentReach()?.isolated || !can(actor, 'franchise.admin'))
    throw new AppError(403, 'FORBIDDEN', `Only the brand team ${what}`);
}
