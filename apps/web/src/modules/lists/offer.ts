/**
 * Value lists in the browser (plan §2.1): the small rules shared by the form input, the form editor and
 * Masters → Lists. Nothing here decides who may add to a closed list — the server says so (`canAdd`).
 */

/** What the server tells a "remember what people type" field (`GET /api/lists/offer`). */
export type Offer = {
  values: { value: string; uses: number }[];
  /** Values offered before any filter: a closed list is closed only once this is above zero. */
  total: number;
  /** This person may add to a list that only admins add to. */
  canAdd: boolean;
};

/**
 * Is "Write…" shown? An open list: always. A list only admins add to: while it is still empty, or when the
 * server said this person may add. Until the server has answered, a closed list offers no "Write…".
 */
export function mayWrite(
  field: { writeAllowed?: boolean },
  offer: Pick<Offer, 'total' | 'canAdd'> | undefined,
) {
  if (field.writeAllowed !== false) return true;
  return !!offer && (offer.total === 0 || offer.canAdd);
}

const same = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The rows of the dropdown: the offered values, then "Write…" as the last one when writing is allowed. When the
 * typed text is not one of the values, the last row offers to write exactly that.
 */
export function offerRows(offer: Offer | undefined, typed: string, canWrite: boolean) {
  const values = offer?.values ?? [];
  const text = typed.trim().replace(/\s+/g, ' ');
  const known = values.some((v) => same(v.value, text));
  return { values, write: canWrite ? { text: text && !known ? text : '' } : null };
}

/** "Room types" → `room_types`: the name a shared list is stored under ('' when nothing usable was typed). */
export function listSlug(name: string) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'l_$1')
    .slice(0, 40)
    .replace(/_+$/, '');
}

/** `room_types` → "Room types": how a shared list's name is shown. */
export function listTitle(slug: string) {
  const words = slug.replace(/_+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : slug;
}
