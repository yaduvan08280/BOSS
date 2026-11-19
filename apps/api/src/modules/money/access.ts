import { forbidden } from '../../lib/errors';
import { can, type Actor } from '../work/actor';

/**
 * Parties, tax codes and payment modes are picked on other modules' screens too (a bill at the POS, a
 * vendor on a goods receipt, a customer's order), so they are read by people who work with money,
 * hospitality, stock or sales — and by nobody else (decision 250).
 */
export function needPick(a: Actor) {
  if (!(['money.view', 'hosp.view', 'ims.view', 'crm.view'] as const).some((key) => can(a, key)))
    throw forbidden();
}
