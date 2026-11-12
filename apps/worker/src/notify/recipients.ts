import { placeHolders } from '@mono/api/services';
import type { Db } from '@mono/db';
import { PLACE_RECIPIENTS, type PlaceRecipient } from '@mono/shared';

export type Person = {
  id: string;
  name: string;
  lang: string;
  mobile: string | null;
  email: string | null;
  telegramChatId: string | null;
  prefs: unknown;
  /** Their branch's clock (quiet hours are counted on it); absent for people with no branch. */
  branch?: { timezone: string | null } | null;
};
/** Someone outside the company (customer, vendor): only an address. */
export type External = { name: string | null; mobile: string | null; email: string | null };

const personSelect = {
  id: true,
  name: true,
  lang: true,
  mobile: true,
  email: true,
  telegramChatId: true,
  prefs: true,
  // The branch's clock, for quiet hours (phase 12).
  branch: { select: { timezone: true } },
} as const;
const active = { deletedAt: null, status: 'ACTIVE' as const };

const isPlace = (key: string): key is PlaceRecipient => (PLACE_RECIPIENTS as readonly string[]).includes(key);
const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : [];

/** The person an event is "about", used to find their HOD. */
function subjectId(payload: Record<string, unknown>, actorId: string | null) {
  for (const k of ['doerId', 'userId', 'personId', 'raiserId', 'solverId']) {
    const v = payload[k];
    if (typeof v === 'string') return v;
  }
  return actorId;
}

/** HOD of the person's main department; if they are that HOD, go one level up; finally the owner. */
export async function hodOf(db: Db, companyId: string, userId: string | null): Promise<Person[]> {
  if (userId) {
    const u = await db.user.findFirst({
      where: { id: userId, companyId },
      select: { mainDepartment: { select: { hodUserId: true, parent: { select: { hodUserId: true } } } } },
    });
    const dept = u?.mainDepartment;
    const hodId = dept?.hodUserId && dept.hodUserId !== userId ? dept.hodUserId : dept?.parent?.hodUserId;
    if (hodId && hodId !== userId) {
      const hod = await db.user.findFirst({
        where: { id: hodId, companyId, ...active },
        select: personSelect,
      });
      if (hod) return [hod];
    }
  }
  return owners(db, companyId);
}

function owners(db: Db, companyId: string) {
  return db.user.findMany({ where: { companyId, ...active, role: { key: 'OWNER' } }, select: personSelect });
}

/** Turn rule recipients (doer, hod, owner, user:<id> …) into people and outside addresses. */
export async function resolveRecipients(
  db: Db,
  companyId: string,
  keys: string[],
  payload: Record<string, unknown>,
  actorId: string | null,
): Promise<{ people: Person[]; external: External[] }> {
  const wanted = new Set<string>();
  const extra: Person[] = [];
  const external: External[] = [];
  for (const key of keys) {
    if (key.startsWith('user:')) wanted.add(key.slice(5));
    else if (key === 'actor') {
      if (actorId) wanted.add(actorId);
    } else if (key === 'owner') extra.push(...(await owners(db, companyId)));
    else if (key === 'hod') {
      // An approval route (phase 12) names who is asked in the HOD's place.
      const routed = ids(payload.approverIds);
      if (routed.length) for (const id of routed) wanted.add(id);
      else extra.push(...(await hodOf(db, companyId, subjectId(payload, actorId))));
    } else if (isPlace(key)) {
      const branchId = typeof payload.branchId === 'string' ? payload.branchId : null;
      for (const id of await placeHolders(db, companyId, key, subjectId(payload, actorId), branchId))
        wanted.add(id);
    } else if (key === 'hr') {
      const hr = await db.department.findFirst({
        where: { companyId, deletedAt: null, name: { equals: 'HR', mode: 'insensitive' } },
        select: { hodUserId: true },
      });
      if (hr?.hodUserId) wanted.add(hr.hodUserId);
    } else {
      for (const id of ids(payload[`${key}Id`]).concat(ids(payload[`${key}Ids`]))) wanted.add(id);
      const mobile = payload[`${key}Mobile`];
      const email = payload[`${key}Email`];
      if (typeof mobile === 'string' || typeof email === 'string') {
        external.push({
          name: typeof payload[key] === 'string' ? (payload[key] as string) : null,
          mobile: typeof mobile === 'string' ? mobile : null,
          email: typeof email === 'string' ? email : null,
        });
      }
    }
  }
  const found = wanted.size
    ? await db.user.findMany({
        where: { companyId, ...active, id: { in: [...wanted] } },
        select: personSelect,
      })
    : [];
  const people = new Map<string, Person>();
  for (const p of [...found, ...extra]) people.set(p.id, p);
  return { people: [...people.values()], external };
}
