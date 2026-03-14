import { useState, useEffect, useCallback, useRef } from 'react';
import type { WSMessage } from './useWebSocket';

export interface ConversationSummary {
  id: string;
  type: string;
  location: string;
  sim_time_start: string;
  sim_time_end: string | null;
  message_count: number;
  participant_names: string;
  first_message: string | null;
}

export interface ConversationMessage {
  id: string;
  speaker_id: string;
  speaker_type: string;
  speaker_name: string | null;
  message: string;
  sim_time: string;
}

export interface ConversationDetail {
  id: string;
  type: string;
  location: string;
  sim_time_start: string;
  sim_time_end: string | null;
  participants: Array<{ agent_id: string; agent_name: string; role: string }>;
  messages: ConversationMessage[];
}

export interface ConversationFilters {
  search: string;
  type: string;
  participant: string;
}

const PAGE_SIZE = 30;

export function useConversations(subscribe: (handler: (msg: WSMessage) => void) => () => void) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<ConversationFilters>({
    search: '',
    type: '',
    participant: '',
  });
  const offsetRef = useRef(0);

  const fetchConversations = useCallback(
    async (reset = false) => {
      setLoading(true);
      const offset = reset ? 0 : offsetRef.current;
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      if (filters.search) params.set('search', filters.search);
      if (filters.type) params.set('type', filters.type);
      if (filters.participant) params.set('participant', filters.participant);

      try {
        const r = await fetch(`/api/conversations?${params}`);
        const data = await r.json();
        const items = data.conversations ?? [];
        setTotal(data.total ?? 0);
        if (reset) {
          setConversations(items);
          offsetRef.current = PAGE_SIZE;
        } else {
          setConversations((prev) => [...prev, ...items]);
          offsetRef.current = offset + PAGE_SIZE;
        }
      } catch {
        // ignore
      }
      setLoading(false);
    },
    [filters],
  );

  // Initial fetch + refetch on filter change
  useEffect(() => {
    fetchConversations(true);
  }, [fetchConversations]);

  // Real-time new conversations via WebSocket
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'conversation_new') {
        const newConvo: ConversationSummary = {
          id: msg.conversationId,
          type: msg.conversationType,
          location: 'office',
          sim_time_start: msg.sim_time_start,
          sim_time_end: null,
          message_count: 1,
          participant_names: msg.participant_names,
          first_message: msg.first_message,
        };
        setConversations((prev) => [newConvo, ...prev]);
        setTotal((prev) => prev + 1);
      }
    });
  }, [subscribe]);

  const loadMore = useCallback(() => {
    if (!loading && conversations.length < total) {
      fetchConversations(false);
    }
  }, [loading, conversations.length, total, fetchConversations]);

  return { conversations, total, loading, filters, setFilters, loadMore };
}
