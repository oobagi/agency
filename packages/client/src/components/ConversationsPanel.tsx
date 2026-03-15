import { useState, useEffect, useCallback, useRef } from 'react';
import type { WSMessage } from '../hooks/useWebSocket';
import type { ConversationDetail, ConversationFilters } from '../hooks/useConversations';
import { useConversations } from '../hooks/useConversations';

const TYPES = ['', 'one_on_one', 'meeting', 'standup', 'briefing', 'user_interaction'];

// Consistent colors for up to 8 participants
const SPEAKER_COLORS = [
  '#a78bfa', // purple
  '#4ade80', // green
  '#f472b6', // pink
  '#38bdf8', // blue
  '#fb923c', // orange
  '#facc15', // yellow
  '#34d399', // teal
  '#f87171', // red
];

function getSpeakerColor(speakerId: string, participantIds: string[]): string {
  const idx = participantIds.indexOf(speakerId);
  return SPEAKER_COLORS[idx >= 0 ? idx % SPEAKER_COLORS.length : 0];
}

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
    background: expanded ? '#2d2d4a' : '#252540',
    borderRadius: '8px',
    marginBottom: '8px',
    cursor: 'pointer',
    overflow: 'hidden' as const,
    border: expanded ? '1px solid #4a4a8a' : '1px solid #333355',
  }),
  cardHeader: {
    padding: '10px 12px',
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
  },
  typeBadge: (type: string) => ({
    fontSize: '9px',
    padding: '2px 8px',
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
    fontWeight: 'bold' as const,
  }),
  time: { color: '#666', fontSize: '10px' },
  participants: {
    fontSize: '12px',
    color: '#e2e8f0',
    fontWeight: 'bold' as const,
    marginBottom: '4px',
  },
  preview: {
    fontSize: '11px',
    color: '#a0aec0',
    lineHeight: '1.4',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  msgCount: {
    color: '#666',
    fontSize: '10px',
    marginTop: '4px',
  },
  transcript: {
    borderTop: '1px solid #333355',
    padding: '10px 12px',
    maxHeight: '400px',
    overflow: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
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
    return d.toISOString().split('T')[1].slice(0, 5);
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().split('T')[0];
  } catch {
    return iso;
  }
}

function formatType(type: string): string {
  return type.replace(/_/g, ' ');
}

// Chat bubble for a single message
function MessageBubble({
  message,
  speakerColor,
  isFirstBySpeaker,
}: {
  message: { speaker_name: string | null; speaker_type: string; message: string; sim_time: string };
  speakerColor: string;
  isFirstBySpeaker: boolean;
}) {
  const isUser = message.speaker_type === 'user';
  const name = isUser ? 'You' : (message.speaker_name ?? 'Agent');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {isFirstBySpeaker && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginTop: '4px',
          }}
        >
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: speakerColor,
              flexShrink: 0,
            }}
          />
          <span style={{ color: speakerColor, fontSize: '11px', fontWeight: 'bold' }}>{name}</span>
          <span style={{ color: '#555', fontSize: '9px' }}>{formatTime(message.sim_time)}</span>
        </div>
      )}
      <div
        style={{
          marginLeft: '14px',
          padding: '6px 10px',
          background: '#1a1a2e',
          borderRadius: '6px',
          borderLeft: `2px solid ${speakerColor}`,
          fontSize: '11px',
          lineHeight: '1.5',
          color: '#e2e8f0',
          wordBreak: 'break-word',
        }}
      >
        {message.message}
      </div>
    </div>
  );
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
  const transcriptRef = useRef<HTMLDivElement>(null);

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

  // Auto-scroll transcript to bottom
  useEffect(() => {
    if (detail && transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [detail]);

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
                  <span style={S.time}>
                    {formatDate(c.sim_time_start)} {formatTime(c.sim_time_start)}
                  </span>
                </div>
                <div style={S.participants}>{c.participant_names || 'Unknown'}</div>
                {c.first_message && !isExpanded && (
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
                <div style={S.transcript} ref={transcriptRef}>
                  {detail.messages.length === 0 && (
                    <div style={{ color: '#666', fontSize: '10px', textAlign: 'center' }}>
                      No messages
                    </div>
                  )}
                  {detail.messages.map((m, i) => {
                    const participantIds = detail.participants.map((p) => p.agent_id);
                    const prevMsg = i > 0 ? detail.messages[i - 1] : null;
                    const isFirstBySpeaker = !prevMsg || prevMsg.speaker_id !== m.speaker_id;

                    return (
                      <MessageBubble
                        key={m.id}
                        message={m}
                        speakerColor={getSpeakerColor(m.speaker_id, participantIds)}
                        isFirstBySpeaker={isFirstBySpeaker}
                      />
                    );
                  })}
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
