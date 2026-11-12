import type { Db, Tx } from '@mono/db';
import {
  recordAccess,
  recordDefinitionSchema,
  recordMenuSchema,
  recordPermissionsSchema,
  type RecordAccess,
  type RecordDefinition,
  type RecordMenu,
  type RecordPermissions,
  type RecordRight,
  type RecordTypeStatus,
} from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';

export const ctxOf = (actor: Actor) => ({ ...actor, actorId: actor.userId });

/** A record type as the services use it: its stored JSON parsed, plus what this person may do with it. */
export type LoadedType = {
  id: string;
  companyId: string;
  name: string;
  pluralName: string;
  code: string | null;
  prefix: string;
  description: string | null;
  status: RecordTypeStatus;
  def: RecordDefinition;
  menu: RecordMenu;
  permissions: RecordPermissions;
  access: RecordAccess;
  updatedAt: Date;
};

type TypeRow = {
  id: string;
  companyId: string;
  name: string;
  pluralName: string;
  code: string | null;
  prefix: string;
  description: string | null;
  status: string;
  definition: unknown;
  menu: unknown;
  permissions: unknown;
  updatedAt: Date;
};

export async function roleIdOf(db: Db | Tx, actor: Actor): Promise<string | null> {
  const u = await db.user.findFirst({
    where: { id: actor.userId, companyId: actor.companyId },
    select: { roleId: true },
  });
  return u?.roleId ?? null;
}

export function shapeType(row: TypeRow, actor: Actor, roleId: string | null): LoadedType {
  const permissions = recordPermissionsSchema.parse(row.permissions);
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    pluralName: row.pluralName,
    code: row.code,
    prefix: row.prefix,
    description: row.description,
    status: row.status as RecordTypeStatus,
    def: recordDefinitionSchema.parse(row.definition),
    menu: recordMenuSchema.parse(row.menu),
    permissions,
    access: recordAccess(permissions, { granted: actor.permissions, roleId }),
    updatedAt: row.updatedAt,
  };
}

const WORDS: Record<RecordRight | 'admin', string> = {
  view: 'see',
  create: 'add',
  edit: 'change',
  approve: 'approve',
  admin: 'set up',
};

/**
 * Load a record type of the actor's company and check a right on it. Every route goes through here, so a type of
 * another company is "not found" and a missing right is a 403 — never a silent empty answer.
 */
export async function loadType(
  db: Db | Tx,
  actor: Actor,
  id: string,
  right: RecordRight | 'admin' = 'view',
): Promise<LoadedType> {
  const [row, roleId] = await Promise.all([
    db.recordType.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } }),
    roleIdOf(db, actor),
  ]);
  if (!row) throw notFound('Record type');
  const t = shapeType(row, actor, roleId);
  if (!t.access[right])
    throw new AppError(403, 'FORBIDDEN', `You can't ${WORDS[right]} ${t.pluralName.toLowerCase()}`);
  return t;
}

/** Records can't be added to an archived type. */
export function mustBeActive(t: LoadedType) {
  if (t.status !== 'ACTIVE')
    throw new AppError(409, 'CONFLICT', `${t.pluralName} are archived: no new ones can be added`);
}
