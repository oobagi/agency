import { useState, useEffect, useCallback, useRef } from 'react';
import type { WSMessage } from '../hooks/useWebSocket';

interface Agent {
  id: string;
  name: string;
  role: string;
  state: string;
  team_name: string | null;
  team_color: string | null;
  persona: string;
  specialties?: string;
  hired_at: string;
  desk_id: string | null;
}

interface ChatLog {
  id: string;
  speaker_id: string | null;
  speaker_type: string;
  message: string;
  sim_time: string;
  speaker_name?: string;
  [key: string]: unknown;
}

interface ToolCall {
  id: string;
  tool_name: string;
  arguments: string;
  result: string | null;
  status: string;
  sim_time: string;
}

interface Session {
  id: string;
  sim_day: string;
  provider: string;
  model: string;
  started_at: string;
  ended_at: string | null;
  outcome: string | null;
  tool_call_count: number;
}

interface Task {
  id: string;
  title: string;
  status: string;
}

interface SidePanelProps {
  agentId: string;
  onClose: () => void;
  subscribe: (handler: (msg: WSMessage) => void) => () => void;
  onboarding?: boolean;
  onMessageSent?: () => void;
}

type Tab = 'chat' | 'sessions' | 'details';

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
  role: { color: '#a0aec0', fontSize: '11px', marginBottom: '2px' },
  state: { fontSize: '11px' },
  teamDot: (color: string) => ({
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: color,
    marginRight: '6px',
  }),
  tabs: {
    display: 'flex',
    borderBottom: '1px solid #333355',
  },
  tab: (active: boolean) => ({
    flex: 1,
    padding: '8px 0',
    textAlign: 'center' as const,
    cursor: 'pointer',
    background: active ? '#2d2d4a' : 'transparent',
    color: active ? '#fff' : '#a0aec0',
    border: 'none',
    borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
    fontFamily: 'monospace',
    fontSize: '11px',
  }),
  body: {
    flex: 1,
    overflow: 'auto' as const,
    padding: '10px 14px',
  },
  // Chat
  chatList: { display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  chatMsg: (isUser: boolean) => ({
    background: isUser ? '#3b3b6b' : '#2a2a45',
    padding: '6px 8px',
    borderRadius: '6px',
    fontSize: '11px',
    lineHeight: '1.4',
  }),
  chatSpeaker: { color: '#a78bfa', fontSize: '10px', marginBottom: '2px' },
  chatTime: { color: '#666', fontSize: '9px', marginTop: '2px' },
  chatInput: {
    display: 'flex',
    gap: '6px',
    padding: '10px 14px',
    borderTop: '1px solid #333355',
  },
  input: {
    flex: 1,
    background: '#2a2a45',
    border: '1px solid #444466',
    borderRadius: '4px',
    color: '#e2e8f0',
    padding: '6px 8px',
    fontFamily: 'monospace',
    fontSize: '11px',
    outline: 'none',
  },
  sendBtn: {
    background: '#4a4a8a',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '6px 12px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '11px',
  },
  // Sessions
  sessionCard: {
    background: '#2a2a45',
    borderRadius: '6px',
    marginBottom: '8px',
    overflow: 'hidden' as const,
  },
  sessionHeader: {
    padding: '8px 10px',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sessionOutcome: (outcome: string | null) => ({
    fontSize: '10px',
    padding: '1px 6px',
    borderRadius: '3px',
    background:
      outcome === 'completed'
        ? '#22543d'
        : outcome === 'interrupted'
          ? '#744210'
          : outcome === 'errored'
            ? '#742a2a'
            : '#2d3748',
    color: '#fff',
  }),
  toolCall: {
    padding: '4px 10px',
    borderTop: '1px solid #333355',
    fontSize: '10px',
  },
  toolName: { color: '#a78bfa', fontWeight: 'bold' as const },
  toolStatus: (status: string) => ({
    color: status === 'completed' ? '#68d391' : status === 'errored' ? '#fc8181' : '#f6ad55',
    fontSize: '9px',
  }),
  stopBtn: {
    background: '#e53e3e',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '10px',
  },
  // Details
  detailRow: { marginBottom: '8px' },
  detailLabel: { color: '#a0aec0', fontSize: '10px', marginBottom: '2px' },
  detailValue: { fontSize: '12px' },
};

function formatRole(role: string): string {
  if (role === 'office_manager') return 'Office Manager';
  if (role === 'team_manager') return 'Team Manager';
  return 'Agent';
}

function formatTime(iso: string): string {
  try {
    return iso.split('T')[1]?.slice(0, 8) ?? iso;
  } catch {
    return iso;
  }
}

export function SidePanel({
  agentId,
  onClose,
  subscribe,
  onboarding,
  onMessageSent,
}: SidePanelProps) {
  const [tab, setTab] = useState<Tab>('chat');
  const [agent, setAgent] = useState<Agent | null>(null);
  const [chatLogs, setChatLogs] = useState<ChatLog[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [message, setMessage] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Fetch agent details
  useEffect(() => {
    fetch(`/api/agents/${agentId}`)
      .then((r) => r.json())
      .then(setAgent)
      .catch(() => {});
  }, [agentId]);

  // Fetch chat logs
  useEffect(() => {
    if (tab !== 'chat') return;
    fetch(`/api/agents/${agentId}/chat-logs`)
      .then((r) => r.json())
      .then((data) => {
        setChatLogs(Array.isArray(data) ? data : []);
        setTimeout(() => chatEndRef.current?.scrollIntoView(), 100);
      })
      .catch(() => {});
  }, [agentId, tab]);

  // Fetch sessions
  useEffect(() => {
    if (tab !== 'sessions') return;
    fetch(`/api/agents/${agentId}/sessions`)
      .then((r) => r.json())
      .then((data) => setSessions(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [agentId, tab]);

  // Fetch tasks
  useEffect(() => {
    fetch(`/api/agents/${agentId}/tasks`)
      .then((r) => r.json())
      .then((data) => setTasks(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [agentId]);

  // Fetch tool calls when session expanded
  useEffect(() => {
    if (!expandedSession) return;
    fetch(`/api/sessions/${expandedSession}`)
      .then((r) => r.json())
      .then((data) => setToolCalls(data.tool_calls ?? []))
      .catch(() => {});
  }, [expandedSession]);

  // Live session updates via WebSocket
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'session_event' && msg.agentId === agentId) {
        const event = msg.event as {
          type: string;
          sessionId: string;
          data: Record<string, unknown>;
        };

        if (event.type === 'tool_call_start') {
          const tc: ToolCall = {
            id: (event.data.toolUseId as string) || crypto.randomUUID(),
            tool_name: event.data.toolName as string,
            arguments: JSON.stringify(event.data.args),
            result: null,
            status: 'pending',
            sim_time: new Date().toISOString(),
          };
          setToolCalls((prev) => [...prev, tc]);
        }

        if (event.type === 'tool_call_complete') {
          setToolCalls((prev) =>
            prev.map((tc) =>
              tc.id === event.data.toolUseId
                ? {
                    ...tc,
                    result: JSON.stringify(event.data.result),
                    status: (event.data.isError as boolean) ? 'errored' : 'completed',
                  }
                : tc,
            ),
          );
        }

        if (event.type === 'session_complete' || event.type === 'session_error') {
          setSessions((prev) =>
            prev.map((s) =>
              s.id === event.sessionId
                ? { ...s, outcome: event.type === 'session_complete' ? 'completed' : 'errored' }
                : s,
            ),
          );
        }
      }
    });
  }, [agentId, subscribe]);

  const sendMessage = useCallback(async () => {
    if (!message.trim()) return;
    await fetch(`/api/agents/${agentId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.trim() }),
    });
    setChatLogs((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        speaker_id: null,
        speaker_type: 'user',
        message: message.trim(),
        sim_time: new Date().toISOString(),
      },
    ]);
    setMessage('');
    onMessageSent?.();
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [agentId, message, onMessageSent]);

  const interruptSession = useCallback(async (sessionId: string) => {
    await fetch(`/api/sessions/${sessionId}/interrupt`, { method: 'POST' });
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, outcome: 'interrupted' } : s)),
    );
  }, []);

  const currentTask =
    tasks.find((t) => t.status === 'in_progress') ?? tasks.find((t) => t.status === 'pending');

  return (
    <div style={S.panel}>
      {/* Header */}
      <div style={S.header}>
        <button style={S.closeBtn} onClick={onClose}>
          x
        </button>
        <div style={S.name}>{agent?.name ?? '...'}</div>
        <div style={S.role}>{agent ? formatRole(agent.role) : ''}</div>
        {agent?.team_name && (
          <div style={S.role}>
            <span style={S.teamDot(agent.team_color ?? '#666')} />
            {agent.team_name}
          </div>
        )}
        <div style={S.state}>
          State: <strong>{agent?.state ?? '...'}</strong>
          {currentTask && (
            <>
              {' '}
              | Task: <em>{currentTask.title}</em>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={S.tabs}>
        <button style={S.tab(tab === 'chat')} onClick={() => setTab('chat')}>
          Chat Log
        </button>
        <button style={S.tab(tab === 'sessions')} onClick={() => setTab('sessions')}>
          Sessions
        </button>
        <button style={S.tab(tab === 'details')} onClick={() => setTab('details')}>
          Details
        </button>
      </div>

      {/* Tab content */}
      <div style={S.body}>
        {tab === 'chat' && (
          <div style={S.chatList}>
            {chatLogs.map((cl) => (
              <div key={cl.id} style={S.chatMsg(cl.speaker_type === 'user')}>
                <div style={S.chatSpeaker}>
                  {cl.speaker_type === 'user' ? 'You' : (cl.speaker_name ?? 'Agent')}
                </div>
                <div>{cl.message}</div>
                <div style={S.chatTime}>{formatTime(cl.sim_time)}</div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        )}

        {tab === 'sessions' && (
          <div>
            {sessions.map((session) => {
              const isActive = !session.ended_at;
              const isExpanded = expandedSession === session.id;
              return (
                <div key={session.id} style={S.sessionCard}>
                  <div
                    style={S.sessionHeader}
                    onClick={() => setExpandedSession(isExpanded ? null : session.id)}
                  >
                    <div>
                      <div style={{ fontSize: '11px' }}>
                        {session.sim_day} {formatTime(session.started_at)}
                      </div>
                      <div style={{ color: '#a0aec0', fontSize: '10px' }}>
                        {session.model} | {session.tool_call_count} tools
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={S.sessionOutcome(session.outcome)}>
                        {isActive ? 'active' : (session.outcome ?? '?')}
                      </span>
                      {isActive && (
                        <button
                          style={S.stopBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            interruptSession(session.id);
                          }}
                        >
                          Stop
                        </button>
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <div>
                      {toolCalls.map((tc) => (
                        <div key={tc.id} style={S.toolCall}>
                          <span style={S.toolName}>{tc.tool_name}</span>{' '}
                          <span style={S.toolStatus(tc.status)}>
                            {tc.status === 'pending' ? '...' : tc.status}
                          </span>
                        </div>
                      ))}
                      {toolCalls.length === 0 && (
                        <div style={{ ...S.toolCall, color: '#666' }}>No tool calls</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {sessions.length === 0 && <div style={{ color: '#666' }}>No sessions yet</div>}
          </div>
        )}

        {tab === 'details' && agent && (
          <div>
            <div style={S.detailRow}>
              <div style={S.detailLabel}>Role</div>
              <div style={S.detailValue}>{formatRole(agent.role)}</div>
            </div>
            <div style={S.detailRow}>
              <div style={S.detailLabel}>Team</div>
              <div style={S.detailValue}>{agent.team_name ?? 'Unassigned'}</div>
            </div>
            <div style={S.detailRow}>
              <div style={S.detailLabel}>State</div>
              <div style={S.detailValue}>{agent.state}</div>
            </div>
            <div style={S.detailRow}>
              <div style={S.detailLabel}>Desk</div>
              <div style={S.detailValue}>{agent.desk_id ?? 'None'}</div>
            </div>
            <div style={S.detailRow}>
              <div style={S.detailLabel}>Hired</div>
              <div style={S.detailValue}>{agent.hired_at}</div>
            </div>
            <div style={S.detailRow}>
              <div style={S.detailLabel}>Persona</div>
              <div
                style={{
                  ...S.detailValue,
                  fontSize: '10px',
                  lineHeight: '1.5',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {agent.persona?.slice(0, 500)}
                {agent.persona?.length > 500 ? '...' : ''}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Chat input */}
      {tab === 'chat' && (
        <div style={S.chatInput}>
          <input
            style={S.input}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder={onboarding ? 'Tell the OM what to build...' : 'Send a message...'}
          />
          <button style={S.sendBtn} onClick={sendMessage}>
            Send
          </button>
        </div>
      )}
    </div>
  );
}
