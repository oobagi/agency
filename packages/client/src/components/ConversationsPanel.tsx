import { useState, useEffect, useCallback } from 'react';
import type { WSMessage } from '../hooks/useWebSocket';
import type { ConversationDetail, ConversationFilters } from '../hooks/useConversations';
import { useConversations } from '../hooks/useConversations';

const TYPES = ['', 'one_on_one', 'meeting', 'standup', 'briefing', 'user_interaction'];

const S = {
  panel: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    bottom: 0,
    width: '420px',
    background: '#1e1e32',
    borderRight: '1px solid #333355',
    display: 'flex',
    flexDirection: 'column' as const,
    zIndex: 20,
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#e2e8f0',
    overflow: 'hidden',
  },
  header: {
    padding: '12px 14px',
    borderBottom: '1px solid #333355',
    background: '#252540',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: '15px', fontWeight: 'bold' as const },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#a0aec0',
    cursor: 'pointer',
    fontSize: '16px',
    fontFamily: 'monospace',
  },
  filters: {
    padding: '8px 14px',
    borderBottom: '1px solid #333355',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  filterRow: {
    display: 'flex',
    gap: '6px',
  },
  input: {
    flex: 1,
    background: '#2a2a45',
    border: '1px solid #444466',
    borderRadius: '4px',
    color: '#e2e8f0',
    padding: '5px 8px',
    fontFamily: 'monospace',
    fontSize: '11px',
    outline: 'none',
  },
  select: {
    background: '#2a2a45',
    border: '1px solid #444466',
    borderRadius: '4px',
    color: '#e2e8f0',
    padding: '5px 8px',
    fontFamily: 'monospace',
    fontSize: '11px',
    outline: 'none',
  },
  body: {
    flex: 1,
    overflow: 'auto' as const,
    padding: '8px 14px',
  },
  card: (expanded: boolean) => ({
    background: expanded ? '#2d2d4a' : '#2a2a45',
    borderRadius: '6px',
    marginBottom: '6px',
    cursor: 'pointer',
    overflow: 'hidden' as const,
    border: expanded ? '1px solid #4a4a8a' : '1px solid transparent',
  }),
  cardHeader: {
    padding: '8px 10px',
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '4px',
  },
  typeBadge: (type: string) => ({
    fontSize: '9px',
    padding: '1px 6px',
    borderRadius: '3px',
    background:
      type === 'meeting'
        ? '#4a4a8a'
        : type === 'standup'
          ? '#2d6a4f'
          : type === 'briefing'
            ? '#744210'
            : type === 'user_interaction'
              ? '#553c9a'
              : '#2d3748',
    color: '#fff',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  }),
  time: { color: '#a0aec0', fontSize: '10px' },
  participants: {
    fontSize: '11px',
    color: '#c4b5fd',
    marginBottom: '3px',
  },
  preview: {
    fontSize: '10px',
    color: '#a0aec0',
    lineHeight: '1.4',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  msgCount: { color: '#666', fontSize: '9px' },
  transcript: {
    borderTop: '1px solid #333355',
    padding: '8px 10px',
    maxHeight: '300px',
    overflow: 'auto' as const,
  },
  message: {
    marginBottom: '6px',
    fontSize: '11px',
    lineHeight: '1.4',
  },
  msgSpeaker: { color: '#a78bfa', fontSize: '10px', marginBottom: '1px' },
  msgTime: { color: '#666', fontSize: '9px' },
  msgText: { color: '#e2e8f0' },
  loadMore: {
    display: 'block',
    width: '100%',
    padding: '8px',
    background: '#2d2d4a',
    border: '1px solid #444466',
    borderRadius: '4px',
    color: '#a0aec0',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '11px',
    textAlign: 'center' as const,
    marginTop: '4px',
  },
  empty: { color: '#666', textAlign: 'center' as const, padding: '20px' },
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toISOString().split('T')[0];
    const time = d.toISOString().split('T')[1].slice(0, 5);
    return `${date} ${time}`;
  } catch {
    return iso;
  }
}

function formatType(type: string): string {
  return type.replace(/_/g, ' ');
}

interface ConversationsPanelProps {
  onClose: () => void;
  subscribe: (handler: (msg: WSMessage) => void) => () => void;
}

export function ConversationsPanel({ onClose, subscribe }: ConversationsPanelProps) {
  const { conversations, total, loading, filters, setFilters, loadMore } =
    useConversations(subscribe);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);

  // Debounced filter updates
  const [searchInput, setSearchInput] = useState('');
  const [participantInput, setParticipantInput] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev: ConversationFilters) => ({ ...prev, search: searchInput }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, setFilters]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev: ConversationFilters) => ({ ...prev, participant: participantInput }));
    }, 300);
    return () => clearTimeout(timer);
  }, [participantInput, setFilters]);

  // Fetch detail when expanding
  useEffect(() => {
    if (!expandedId) {
      setDetail(null);
      return;
    }
    fetch(`/api/conversations/${expandedId}`)
      .then((r) => r.json())
      .then((data) => setDetail(data))
      .catch(() => {});
  }, [expandedId]);

  const handleTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setFilters((prev: ConversationFilters) => ({ ...prev, type: e.target.value }));
    },
    [setFilters],
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <div style={S.panel}>
      <div style={S.header}>
        <span style={S.title}>Conversations</span>
        <button style={S.closeBtn} onClick={onClose}>
          x
        </button>
      </div>

      <div style={S.filters}>
        <div style={S.filterRow}>
          <input
            style={S.input}
            placeholder="Search messages..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <input
            style={{ ...S.input, maxWidth: '140px' }}
            placeholder="Participant..."
            value={participantInput}
            onChange={(e) => setParticipantInput(e.target.value)}
          />
        </div>
        <div style={S.filterRow}>
          <select style={S.select} value={filters.type} onChange={handleTypeChange}>
            <option value="">All types</option>
            {TYPES.filter(Boolean).map((t) => (
              <option key={t} value={t}>
                {formatType(t)}
              </option>
            ))}
          </select>
          <span style={S.msgCount}>
            {total} conversation{total !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div style={S.body}>
        {conversations.map((c) => {
          const isExpanded = expandedId === c.id;
          return (
            <div key={c.id} style={S.card(isExpanded)}>
              <div style={S.cardHeader} onClick={() => toggleExpand(c.id)}>
                <div style={S.cardTop}>
                  <span style={S.typeBadge(c.type)}>{formatType(c.type)}</span>
                  <span style={S.time}>{formatTime(c.sim_time_start)}</span>
                </div>
                <div style={S.participants}>{c.participant_names || 'Unknown'}</div>
                {c.first_message && (
                  <div style={S.preview}>
                    {c.first_message.slice(0, 120)}
                    {c.first_message.length > 120 ? '...' : ''}
                  </div>
                )}
                <div style={S.msgCount}>
                  {c.message_count} message{c.message_count !== 1 ? 's' : ''}
                </div>
              </div>

              {isExpanded && detail && detail.id === c.id && (
                <div style={S.transcript}>
                  {detail.messages.map((m) => (
                    <div key={m.id} style={S.message}>
                      <div style={S.msgSpeaker}>
                        {m.speaker_type === 'user' ? 'You' : (m.speaker_name ?? 'Agent')}
                        <span style={S.msgTime}> {formatTime(m.sim_time)}</span>
                      </div>
                      <div style={S.msgText}>{m.message}</div>
                    </div>
                  ))}
                  {detail.messages.length === 0 && (
                    <div style={{ color: '#666', fontSize: '10px' }}>No messages</div>
                  )}
                </div>
              )}

              {isExpanded && !detail && (
                <div style={{ ...S.transcript, color: '#666' }}>Loading...</div>
              )}
            </div>
          );
        })}

        {conversations.length === 0 && !loading && (
          <div style={S.empty}>No conversations found</div>
        )}

        {loading && <div style={S.empty}>Loading...</div>}

        {conversations.length < total && !loading && (
          <button style={S.loadMore} onClick={loadMore}>
            Load more ({total - conversations.length} remaining)
          </button>
        )}
      </div>
    </div>
  );
}
