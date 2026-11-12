import type { FastifyRequest } from 'fastify';
import { AppError, forbidden } from '../../lib/errors';

/**
 * People set-up per branch (phase 12, plan §3.3): someone whose role does not reach the whole group — an outlet
 * manager with the right to add and edit people — manages only the people of their own branches. Group-wide
 * people (owner, group admins) are not limited.
 */
const mine = (request: FastifyRequest): string[] | null => request.reachAll?.branchIds ?? null;

/** Every one of these people must work at one of the caller's branches. */
export function assertMyPeople(request: FastifyRequest, people: { branchId: string | null }[]) {
  const branches = mine(request);
  if (!branches) return;
  if (people.some((p) => !p.branchId || !branches.includes(p.branchId)))
    throw forbidden('You manage only the people of your own branches');
}

/** The branch a new or moved person gets: one of the caller's own (their only one when none is named). */
export function myBranchFor(request: FastifyRequest, branchId: string | null | undefined) {
  const branches = mine(request);
  if (!branches) return branchId;
  if (branchId) {
    if (!branches.includes(branchId)) throw forbidden('You can add people only to your own branches');
    return branchId;
  }
  if (branches.length === 1) return branches[0]!;
  throw new AppError(400, 'VALIDATION_FAILED', 'Choose the branch this person works at');
}

/** Roles and whole-list imports stay with the group's admins. */
export function assertGroupWide(request: FastifyRequest, what: string) {
  if (mine(request)) throw forbidden(`Only the group's admins ${what}`);
}
