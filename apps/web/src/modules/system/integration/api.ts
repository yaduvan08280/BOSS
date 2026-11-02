import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type ChannelState = {
  saved: boolean;
  meta: Record<string, unknown>;
  secretsSaved: Record<string, boolean>;
};
export type Channels = {
  email: ChannelState;
  telegram: ChannelState;
  whatsapp: ChannelState;
  push: ChannelState;
  envDefaults: Record<string, boolean>;
};
export type Template = {
  id: string;
  code: string;
  channel: 'whatsapp' | 'email' | 'telegram';
  event: string | null;
  category: string;
  language: string;
  subject: string | null;
  body: string;
  status: string;
  quality: string | null;
  sentCount: number;
  readCount: number;
  active: boolean;
  isDefault: boolean;
  variables: string[];
};
export type Rule = {
  id: string;
  event: string;
  audience: 'team' | 'client' | 'vendor';
  recipients: string[];
  channels: string[];
  waitMinutes: number;
  escalateTo: string | null;
  escalateAfterMinutes: number | null;
  aiFollowUp: boolean;
  active: boolean;
  isDefault: boolean;
  createdAt: string;
};
export type ReminderPattern = {
  id: string;
  name: string;
  remindAt: string[];
  channels: string[];
  overdueRepeat: string;
  isDefault: boolean;
};
export type TelegramPage = {
  bot: string | null;
  connected: boolean;
  groupChatId: string | null;
  stats: { linked: number; total: number; pending: number; expired: number };
  people: {
    id: string;
    code: string;
    name: string;
    mobile: string | null;
    email: string | null;
    state: 'linked' | 'pending' | 'expired' | 'none';
    linkCode: string | null;
    sentAt: string | null;
    sentVia: string | null;
  }[];
};

export const nkeys = {
  channels: ['org', 'notify', 'channels'] as const,
  templates: ['org', 'notify', 'templates'] as const,
  rules: ['org', 'notify', 'rules'] as const,
  reminders: ['org', 'notify', 'reminders'] as const,
  telegram: ['org', 'notify', 'telegram'] as const,
};

export const useChannels = () =>
  useQuery({ queryKey: nkeys.channels, queryFn: () => api<Channels>('/api/notify/channels') });
export const useTemplates = () =>
  useQuery({ queryKey: nkeys.templates, queryFn: () => api<Template[]>('/api/notify/templates') });
export const useRules = () =>
  useQuery({ queryKey: nkeys.rules, queryFn: () => api<Rule[]>('/api/notify/rules') });
export const useReminders = () =>
  useQuery({ queryKey: nkeys.reminders, queryFn: () => api<ReminderPattern[]>('/api/notify/reminders') });
export const useTelegramPage = () =>
  useQuery({ queryKey: nkeys.telegram, queryFn: () => api<TelegramPage>('/api/notify/telegram') });
