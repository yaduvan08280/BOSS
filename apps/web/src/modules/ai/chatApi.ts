import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';

export type ChatTable = {
  view: string;
  label: string;
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
};
export type ChatData = {
  steps: { purpose: string; kind: 'lookup' | 'calculate'; view?: string; rows?: number; result?: string }[];
  table: ChatTable | null;
  suggestions: string[];
};
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  data: ChatData | null;
  createdAt: string;
};
export type ChatSummary = { id: string; title: string; updatedAt: string };

const KEY = ['ai', 'chats'] as const;
export const useChats = () => useQuery({ queryKey: KEY, queryFn: () => api<ChatSummary[]>('/api/ai/chats') });
export const useChat = (id: string | null) =>
  useQuery({
    queryKey: [...KEY, id],
    queryFn: () => api<{ id: string; title: string; messages: ChatMessage[] }>(`/api/ai/chats/${id}`),
    enabled: Boolean(id),
  });

/**
 * Sending a question: the question shows at once, the answer when the assistant has finished its look-ups.
 * Returns the chat id (a new chat gets one with its first question).
 */
export function useSend(chatId: string | null, onChat: (id: string) => void) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = async (text: string) => {
    setPending(text);
    setError(null);
    try {
      const r = await api<{ chatId: string; title: string; message: ChatMessage }>('/api/ai/chat', {
        method: 'POST',
        body: { chatId, text },
      });
      await qc.invalidateQueries({ queryKey: KEY });
      if (r.chatId !== chatId) onChat(r.chatId);
      await qc.refetchQueries({ queryKey: [...KEY, r.chatId] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The assistant could not answer');
    } finally {
      setPending(null);
    }
  };
  return { send, pending, error };
}

export const deleteChat = (id: string) => api(`/api/ai/chats/${id}`, { method: 'DELETE' });
