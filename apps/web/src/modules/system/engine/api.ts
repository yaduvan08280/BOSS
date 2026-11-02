import { useQuery } from '@tanstack/react-query';
import type { EngineModule } from '@mono/shared';
import { api } from '@/lib/api';

export type EngineModuleInfo = {
  module: EngineModule;
  settings: Record<string, unknown>;
  custom: boolean;
  changedAt: string | null;
  alerts: { active: number; total: number };
  roles: { role: string; telegram: string[] }[];
};
export type SettingsChange = {
  id: string;
  createdAt: string;
  actorName: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export const useEngine = () =>
  useQuery({ queryKey: ['engine', 'overview'], queryFn: () => api<EngineModuleInfo[]>('/api/engine') });
export const useEngineChanges = (module: EngineModule) =>
  useQuery({
    queryKey: ['engine', 'changes', module],
    queryFn: () => api<SettingsChange[]>(`/api/engine/${module}/changes`),
  });
