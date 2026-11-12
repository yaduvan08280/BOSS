import { useQuery } from '@tanstack/react-query';
import type { ApprovalKind, ApprovalStep, BranchType, ManagerRole } from '@mono/shared';
import { api } from '@/lib/api';

export type Entity = {
  id: string;
  name: string;
  kind: 'OWN' | 'FRANCHISE';
  country: string;
  currency: string;
  state: string | null;
  taxId: string | null;
  isDefault: boolean;
};
export type Region = { id: string; name: string; entityId: string | null; parentId: string | null };
export type GroupBranch = {
  id: string;
  name: string;
  code: string | null;
  type: BranchType;
  entityId: string | null;
  regionId: string | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  isDefault: boolean;
  people: number;
};
export type Manager = { userId: string; branchId: string | null; regionId: string | null; role: ManagerRole };
export type Structure = {
  entities: Entity[];
  regions: Region[];
  branches: GroupBranch[];
  managers: Manager[];
};
export type Route = {
  id: string;
  kind: ApprovalKind;
  entityId: string | null;
  branchId: string | null;
  steps: ApprovalStep[];
};
export type Chain = {
  steps: { who: ApprovalStep['who']; userIds: string[]; open: boolean }[];
  first: string[];
  deciders: string[];
};

// Under ['org', …] so every structure change refreshes with the rest of the set-up screens.
export const useStructure = () =>
  useQuery({ queryKey: ['org', 'structure'], queryFn: () => api<Structure>('/api/branches/structure') });
export const useRoutes = () =>
  useQuery({ queryKey: ['org', 'approvals'], queryFn: () => api<Route[]>('/api/branches/approvals') });

/** Regions as an indented list (a region under its parent), for pickers and the tree. */
export function regionTree(regions: Region[]): { region: Region; depth: number }[] {
  const out: { region: Region; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const r of regions.filter((x) => (x.parentId ?? null) === parentId)) {
      out.push({ region: r, depth });
      walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  // A region whose parent is gone still shows.
  for (const r of regions) if (!out.some((o) => o.region.id === r.id)) out.push({ region: r, depth: 0 });
  return out;
}
