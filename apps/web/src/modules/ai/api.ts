import { useQuery } from '@tanstack/react-query';
import type {
  AiConfigInput,
  AiFlowDraft,
  AiProvider,
  AskPlan,
  DetailsQuality,
  FlowDefinition,
  FlowDiff,
  FlowField,
  FlowIssue,
  Unmatched,
} from '@mono/shared';
import { api } from '@/lib/api';
import { useWorkMutation } from '@/lib/work';

export type AiStatus = {
  connected: boolean;
  provider: AiProvider | null;
  model: string | null;
  stt: 'browser' | 'openai' | 'gemini';
};
export type AiConfigView = Omit<AiConfigInput, 'apiKey' | 'sttKey'> & {
  hasKey: boolean;
  keyEnd: string | null;
  hasSttKey: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  knownPrice: boolean;
};
type UsageRow = { calls: number; inputTokens: number; outputTokens: number; costMicros: number };
export type AiUsage = {
  month: (UsageRow & { feature: string })[];
  total: UsageRow;
  recent: {
    id: string;
    feature: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
    ms: number;
    ok: boolean;
    error: string | null;
    userId: string | null;
    createdAt: string;
  }[];
};
export type BusinessDetailsView = {
  text: string;
  words: number;
  quality: DetailsQuality;
  updatedAt: string | null;
};
export type FlowDraftResult = {
  draft: AiFlowDraft;
  meta: {
    name: string;
    runName: string;
    departmentIds: string[];
    coordinatorId: string | null;
    solverId: string | null;
  };
  definition: FlowDefinition;
  unmatched: Unmatched[];
  issues: FlowIssue[];
  summary: { steps: number; startFields: number; stepFields: number; unassigned: number };
  remember: string[];
};
export type EditResult = {
  definition: FlowDefinition;
  diff: FlowDiff;
  unmatched: Unmatched[];
  issues: FlowIssue[];
};
export type KpiSuggestion = {
  label: string;
  source: string;
  aggregation: string;
  period: string;
  why: string;
};
export type MasterDraft = {
  name: string;
  description: string;
  fields: FlowField[];
  keyField: string | null;
  displayField: string | null;
};
export type MasterDef = MasterDraft & { id: string; source: string; updatedAt: string };
export type AskAnswer = {
  answer: string;
  plan: AskPlan;
  columns: string[];
  rows: (Record<string, unknown> & { link?: string })[];
  total: number;
  onlyMine?: boolean;
  problems?: string[];
  /** The answer came from a saved report (plan §2.7). */
  report?: { id: string; name: string; link: string };
};

export const useAiStatus = () =>
  useQuery({ queryKey: ['ai', 'status'], queryFn: () => api<AiStatus>('/api/ai/status'), staleTime: 60_000 });
export const useAiConfig = () =>
  useQuery({ queryKey: ['ai', 'config'], queryFn: () => api<AiConfigView | null>('/api/ai/config') });
export const useAiUsage = () =>
  useQuery({ queryKey: ['ai', 'usage'], queryFn: () => api<AiUsage>('/api/ai/usage') });
export const useBusinessDetails = () =>
  useQuery({
    queryKey: ['ai', 'business'],
    queryFn: () => api<BusinessDetailsView>('/api/ai/business-details'),
  });
export const useMasters = () =>
  useQuery({ queryKey: ['masters'], queryFn: () => api<MasterDef[]>('/api/masters') });

const AI_KEYS = [['ai'], ['masters']];
export const useAiMutation = <I, O = unknown>(fn: (input: I) => Promise<O>, success?: (o: O) => string) =>
  useWorkMutation(fn, AI_KEYS, success);

export const aiApi = {
  saveConfig: (body: AiConfigInput) => api<AiConfigView>('/api/ai/config', { method: 'PUT', body }),
  test: () =>
    api<{ ok: boolean; error: string | null; reply: string }>('/api/ai/config/test', { method: 'POST' }),
  saveDetails: (text: string) =>
    api<BusinessDetailsView>('/api/ai/business-details', { method: 'PUT', body: { text } }),
  refreshDetails: () =>
    api<{ text: string; words: number; quality: DetailsQuality }>('/api/ai/business-details/refresh', {
      method: 'POST',
    }),
  chatGptPrompt: () => api<{ prompt: string }>('/api/ai/business-details/chatgpt-prompt'),
  remember: (lines: string[]) =>
    api<{ added: number }>('/api/ai/remember', { method: 'POST', body: { lines } }),
  draftFlow: (body: {
    text: string;
    name?: string | null;
    departmentId?: string | null;
    previous?: AiFlowDraft | null;
    changes?: string | null;
  }) => api<FlowDraftResult>('/api/ai/flows/draft', { method: 'POST', body }),
  createFlow: (draft: AiFlowDraft, text: string) =>
    api<{ id: string; code: string }>('/api/ai/flows/create', { method: 'POST', body: { draft, text } }),
  editFlow: (id: string, instruction: string) =>
    api<EditResult>(`/api/ai/flows/${id}/edit`, { method: 'POST', body: { instruction } }),
  suggestKpis: (id: string) => api<KpiSuggestion[]>(`/api/ai/flows/${id}/kpis`, { method: 'POST' }),
  draftMaster: (text: string) =>
    api<MasterDraft>('/api/ai/masters/draft', { method: 'POST', body: { text } }),
  saveMaster: (body: MasterDraft & { source: 'ai' | 'own' }, id?: string) =>
    api<MasterDef>(id ? `/api/masters/${id}` : '/api/masters', { method: id ? 'PUT' : 'POST', body }),
  deleteMaster: (id: string) => api(`/api/masters/${id}`, { method: 'DELETE' }),
  ask: (question: string) => api<AskAnswer>('/api/ai/ask', { method: 'POST', body: { question } }),
};

/** "$0.0123" — costs are estimates in US dollars. */
export const usd = (micros: number) =>
  micros === 0 ? '—' : `$${(micros / 1_000_000).toFixed(micros < 10_000 ? 4 : 2)}`;

/** Words that make a search look like a question for the AI rather than a screen name. */
export const looksLikeQuestion = (q: string) =>
  /\?\s*$/.test(q) ||
  /^(who|what|which|how|when|where|why|show|list|kaun|kya|kitne|kitna|kab|कौन|क्या|कितने|कितना|कब)\b/i.test(
    q.trim(),
  );
