import { useState, useEffect } from 'react';
import type { MeetingRoom } from '../hooks/useOfficeLayout';
import type { AgentRenderState } from '../hooks/useAgents';

interface Conversation {
  id: string;
  type: string;
  sim_time_start: string;
  sim_time_end: string | null;
  participant_names: string | null;
  message_count: number;
  first_message: string | null;
}

interface ConversationDetail {
  id: string;
  type: string;
  messages: {
    id: string;
    speaker_type: string;
    speaker_name: string | null;
    message: string;
    sim_time: string;
  }[];
}

interface RoomPanelProps {
  room: MeetingRoom;
  agents: Map<string, AgentRenderState>;
  onClose: () => void;
}

const PROXIMITY = 4;

const S = {
  panel: {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    bottom: 0,
    width: '380px',
    background: '#1e1e32',
    borderLeft: '1px solid #333355',
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
  },
  closeBtn: {
    float: 'right' as const,
    background: 'none',
    border: 'none',
    color: '#a0aec0',
    cursor: 'pointer',
    fontSize: '16px',
    fontFamily: 'monospace',
  },
  name: { fontSize: '15px', fontWeight: 'bold' as const, marginBottom: '4px' },
  subtitle: { color: '#a0aec0', fontSize: '11px' },
  body: {
    flex: 1,
    overflow: 'auto' as const,
    padding: '10px 14px',
  },
  section: { marginBottom: '16px' },
  sectionTitle: {
    fontSize: '10px',
    color: '#a0aec0',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '8px',
  },
  agentCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    background: '#2a2a45',
    borderRadius: '6px',
    marginBottom: '4px',
  },
  dot: (color: string) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
  }),
  agentName: { fontSize: '12px', fontWeight: 'bold' as const },
  agentState: { color: '#a0aec0', fontSize: '10px' },
  convoCard: {
    background: '#2a2a45',
    borderRadius: '6px',
    marginBottom: '6px',
    overflow: 'hidden' as const,
  },
  convoHeader: {
    padding: '8px 10px',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  convoType: (type: string) => ({
    fontSize: '10px',
    padding: '1px 6px',
    borderRadius: '3px',
    background:
      type === 'meeting'
        ? '#2d4a3d'
        : type === 'standup'
          ? '#4a3d2d'
          : type === 'briefing'
            ? '#2d3d4a'
            : '#2d2d4a',
    color: '#fff',
  }),
  convoPreview: {
    color: '#a0aec0',
    fontSize: '10px',
    marginTop: '2px',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
    maxWidth: '250px',
  },
  message: {
    padding: '4px 10px',
    borderTop: '1px solid #333355',
    fontSize: '10px',
    lineHeight: '1.4',
  },
  messageSpeaker: { color: '#a78bfa', fontSize: '9px', marginBottom: '1px' },
  messageTime: { color: '#666', fontSize: '9px', marginTop: '1px' },
  empty: { color: '#666', fontSize: '11px', fontStyle: 'italic' as const },
};

function formatTime(iso: string): string {
  try {
    return iso.split('T')[1]?.slice(0, 8) ?? iso;
  } catch {
    return iso;
  }
}

export function RoomPanel({ room, agents, onClose }: RoomPanelProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [expandedConvo, setExpandedConvo] = useState<string | null>(null);
  const [convoDetail, setConvoDetail] = useState<ConversationDetail | null>(null);

  // Find agents near this room
  const nearbyAgents = Array.from(agents.values()).filter((a) => {
    const dx = a.targetX - room.position_x;
    const dz = a.targetZ - room.position_z;
    return Math.sqrt(dx * dx + dz * dz) <= PROXIMITY;
  });

  // Fetch conversations for this room
  useEffect(() => {
    fetch(`/api/conversations?location=${encodeURIComponent(room.name)}&limit=20`)
      .then((r) => r.json())
      .then((data) => setConversations(data.conversations ?? []))
      .catch(() => {});
  }, [room.name]);

  // Fetch detail when conversation expanded
  useEffect(() => {
    if (!expandedConvo) {
      setConvoDetail(null);
      return;
    }
    fetch(`/api/conversations/${expandedConvo}`)
      .then((r) => r.json())
      .then(setConvoDetail)
      .catch(() => {});
  }, [expandedConvo]);

  return (
    <div style={S.panel}>
      {/* Header */}
      <div style={S.header}>
        <button style={S.closeBtn} onClick={onClose}>
          x
        </button>
        <div style={S.name}>{room.name}</div>
        <div style={S.subtitle}>Capacity: {room.capacity}</div>
      </div>

      {/* Body */}
      <div style={S.body}>
        {/* Agents present */}
        <div style={S.section}>
          <div style={S.sectionTitle}>Agents Present ({nearbyAgents.length})</div>
          {nearbyAgents.length === 0 && <div style={S.empty}>No agents in this room</div>}
          {nearbyAgents.map((a) => (
            <div key={a.id} style={S.agentCard}>
              <div style={S.dot(a.teamColor ?? '#6b7280')} />
              <div>
                <div style={S.agentName}>{a.name}</div>
                <div style={S.agentState}>{a.state}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Conversations */}
        <div style={S.section}>
          <div style={S.sectionTitle}>Conversations ({conversations.length})</div>
          {conversations.length === 0 && (
            <div style={S.empty}>No conversations in this room yet</div>
          )}
          {conversations.map((c) => {
            const isExpanded = expandedConvo === c.id;
            return (
              <div key={c.id} style={S.convoCard}>
                <div
                  style={S.convoHeader}
                  onClick={() => setExpandedConvo(isExpanded ? null : c.id)}
                >
                  <div>
                    <div style={{ fontSize: '11px' }}>
                      {formatTime(c.sim_time_start)}
                      {c.participant_names && (
                        <span style={{ color: '#a0aec0', marginLeft: '6px' }}>
                          {c.participant_names}
                        </span>
                      )}
                    </div>
                    {c.first_message && <div style={S.convoPreview}>{c.first_message}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <span style={S.convoType(c.type)}>{c.type}</span>
                    <span style={{ color: '#666', fontSize: '10px' }}>
                      {c.message_count} msg{c.message_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                {isExpanded && convoDetail && (
                  <div>
                    {convoDetail.messages.map((m) => (
                      <div key={m.id} style={S.message}>
                        <div style={S.messageSpeaker}>{m.speaker_name ?? m.speaker_type}</div>
                        <div>{m.message}</div>
                        <div style={S.messageTime}>{formatTime(m.sim_time)}</div>
                      </div>
                    ))}
                    {convoDetail.messages.length === 0 && (
                      <div style={{ ...S.message, color: '#666' }}>No messages</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
