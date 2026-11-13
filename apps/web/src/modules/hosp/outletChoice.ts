import { useState } from 'react';
import { useMe } from '@/modules/auth/session';
import type { Outlet } from './api';

const KEY = 'mono.outlet';
/** Dining rooms first: a POS, a kitchen display or a booking sheet rarely starts at room service. */
const KIND_ORDER = ['RESTAURANT', 'BAR', 'CAFE', 'POOL_BAR', 'COUNTER', 'BANQUET', 'ROOM_SERVICE'];

const remembered = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const remember = (id: string) => {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private window: nothing to keep */
  }
};

/**
 * Which outlet a screen starts on: the one this person picked last (on any outlet screen), else a live outlet at
 * their home branch, dining rooms before banquets and room service, else the first. Found 14/11/2026: a steward
 * at the rooftop opened the POS on another branch's room service because outlets come back sorted by name.
 */
export function pickOutlet(outlets: Outlet[], homeBranchId: string | null | undefined, last: string | null) {
  if (last && outlets.some((o) => o.id === last)) return last;
  const live = outlets.filter((o) => o.active);
  const rank = (o: Outlet) => {
    const k = KIND_ORDER.indexOf(o.kind);
    return (o.branchId === homeBranchId ? 0 : 100) + (k < 0 ? KIND_ORDER.length : k);
  };
  return [...(live.length ? live : outlets)].sort((a, b) => rank(a) - rank(b))[0]?.id ?? '';
}

/** `[current, choose]` for an outlet picker; the choice is kept for the next outlet screen. */
export function useOutletChoice(outlets: Outlet[] | undefined): [string, (id: string) => void] {
  const me = useMe();
  const [picked, setPicked] = useState('');
  const current =
    (picked && outlets?.some((o) => o.id === picked) ? picked : '') ||
    (outlets ? pickOutlet(outlets, me.data?.user.branchId, remembered()) : '');
  const choose = (id: string) => {
    setPicked(id);
    remember(id);
  };
  return [current, choose];
}
