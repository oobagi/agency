import { useState, useEffect, useCallback } from 'react';

interface EscalationEntry {
  role: string;
  agent_name: string;
  sim_time: string;
  action: string;
  notes: string;
}

interface Blocker {
  id: string;
  agent_id: string;
  description: string;
  status: string;
  escalation_history: string;
  created_at: string;
  task_title?: string;
}

const S = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#e2e8f0',
  },
  modal: {
    background: '#1e1e32',
    border: '1px solid #333355',
    borderRadius: '8px',
    width: '500px',
    maxHeight: '80vh',
    overflow: 'auto' as const,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
  },
  header: {
    padding: '16px 20px',
    borderBottom: '1px solid #333355',
    background: '#252540',
    borderRadius: '8px 8px 0 0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {},
  agentName: { fontSize: '16px', fontWeight: 'bold' as const, marginBottom: '4px' },
  agentRole: { color: '#a0aec0', fontSize: '11px' },
  blockedBadge: {
    background: '#742a2a',
    color: '#fc8181',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 'bold' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#a0aec0',
    cursor: 'pointer',
    fontSize: '18px',
    fontFamily: 'monospace',
    marginLeft: '12px',
  },
  body: {
    padding: '16px 20px',
  },
  section: { marginBottom: '16px' },
  sectionTitle: {
    fontSize: '11px',
    color: '#a0aec0',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '8px',
    borderBottom: '1px solid #333355',
    paddingBottom: '4px',
  },
  description: {
    background: '#2a2a45',
    padding: '10px 12px',
    borderRadius: '6px',
    fontSize: '12px',
    lineHeight: '1.5',
    borderLeft: '3px solid #fc8181',
  },
  escalationList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  escalationEntry: {
    display: 'flex',
    gap: '10px',
    fontSize: '11px',
  },
  escalationDot: (role: string) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    marginTop: '4px',
    flexShrink: 0,
    background:
      role === 'agent'
        ? '#4299e1'
        : role === 'team_manager'
          ? '#a78bfa'
          : role === 'office_manager'
            ? '#ed64a6'
            : '#48bb78',
  }),
  escalationContent: { flex: 1 },
  escalationHeader: { marginBottom: '2px' },
  escalationName: { color: '#c4b5fd', fontWeight: 'bold' as const },
  escalationAction: { color: '#a0aec0' },
  escalationTime: { color: '#666', fontSize: '9px' },
  escalationNotes: {
    color: '#a0aec0',
    fontSize: '10px',
    fontStyle: 'italic' as const,
  },
  footer: {
    padding: '12px 20px',
    borderTop: '1px solid #333355',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
  },
  resolveBtn: {
    background: '#22543d',
    color: '#68d391',
    border: '1px solid #2f855a',
    borderRadius: '4px',
    padding: '8px 16px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '12px',
    fontWeight: 'bold' as const,
  },
  resolveBtnDisabled: {
    background: '#2d3748',
    color: '#666',
    border: '1px solid #444',
    borderRadius: '4px',
    padding: '8px 16px',
    cursor: 'not-allowed' as const,
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  cancelBtn: {
    background: 'transparent',
    color: '#a0aec0',
    border: '1px solid #444466',
    borderRadius: '4px',
    padding: '8px 16px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  empty: { color: '#666', textAlign: 'center' as const, padding: '20px' },
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.toISOString().split('T')[0]} ${d.toISOString().split('T')[1].slice(0, 5)}`;
  } catch {
    return iso;
  }
}

function formatAction(action: string): string {
  return action.replace(/_/g, ' ');
}

interface BlockedAgentModalProps {
  agentId: string;
  agentName: string;
  agentRole: string;
  onClose: () => void;
}

export function BlockedAgentModal({
  agentId,
  agentName,
  agentRole,
  onClose,
}: BlockedAgentModalProps) {
  const [blocker, setBlocker] = useState<Blocker | null>(null);
  const [resolving, setResolving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Fetch blocker data
  useEffect(() => {
    setLoading(true);
    fetch(`/api/agents/${agentId}/blockers`)
      .then((r) => r.json())
      .then((data) => {
        const blockers = Array.isArray(data) ? data : [];
        // Get the most recent open/user_facing blocker
        const active = blockers.find(
          (b: Blocker) =>
            b.status === 'user_facing' ||
            b.status === 'open' ||
            b.status === 'escalated_to_tm' ||
            b.status === 'escalated_to_om',
        );
        setBlocker(active ?? blockers[0] ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [agentId]);

  const handleResolve = useCallback(async () => {
    if (!blocker) return;
    setResolving(true);
    try {
      await fetch(`/api/blockers/${blocker.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'Resolved by user via UI' }),
      });
      onClose();
    } catch {
      setResolving(false);
    }
  }, [blocker, onClose]);

  const escalationHistory: EscalationEntry[] = blocker
    ? (() => {
        try {
          return JSON.parse(blocker.escalation_history);
        } catch {
          return [];
        }
      })()
    : [];

  if (loading) {
    return (
      <div style={S.overlay} onClick={onClose}>
        <div style={S.modal} onClick={(e) => e.stopPropagation()}>
          <div style={S.body}>
            <div style={S.empty}>Loading blocker details...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.header}>
          <div style={S.headerLeft}>
            <div style={S.agentName}>{agentName}</div>
            <div style={S.agentRole}>{agentRole}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={S.blockedBadge}>Blocked</span>
            <button style={S.closeBtn} onClick={onClose}>
              x
            </button>
          </div>
        </div>

        <div style={S.body}>
          {!blocker && <div style={S.empty}>No blocker data found for this agent.</div>}

          {blocker && (
            <>
              <div style={S.section}>
                <div style={S.sectionTitle}>What went wrong</div>
                <div style={S.description}>{blocker.description}</div>
              </div>

              {escalationHistory.length > 0 && (
                <div style={S.section}>
                  <div style={S.sectionTitle}>Escalation chain</div>
                  <div style={S.escalationList}>
                    {escalationHistory.map((entry, i) => (
                      <div key={i} style={S.escalationEntry}>
                        <div style={S.escalationDot(entry.role)} />
                        <div style={S.escalationContent}>
                          <div style={S.escalationHeader}>
                            <span style={S.escalationName}>{entry.agent_name}</span>{' '}
                            <span style={S.escalationAction}>{formatAction(entry.action)}</span>
                          </div>
                          <div style={S.escalationTime}>{formatTime(entry.sim_time)}</div>
                          {entry.notes && <div style={S.escalationNotes}>{entry.notes}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={S.section}>
                <div style={S.sectionTitle}>Resolution steps</div>
                <div style={{ fontSize: '11px', lineHeight: '1.6', color: '#a0aec0' }}>
                  <div>1. Review the blocker description above</div>
                  <div>
                    2. Take the required external action (e.g., authenticate CLI, install
                    dependencies)
                  </div>
                  <div>3. Once resolved, click "Mark as Resolved" below</div>
                  <div style={{ marginTop: '6px', color: '#666', fontSize: '10px' }}>
                    If the underlying issue is not actually fixed, the agent will re-encounter it
                    and re-escalate.
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {blocker && (
          <div style={S.footer}>
            <button style={S.cancelBtn} onClick={onClose}>
              Dismiss
            </button>
            <button
              style={resolving ? S.resolveBtnDisabled : S.resolveBtn}
              onClick={handleResolve}
              disabled={resolving}
            >
              {resolving ? 'Resolving...' : 'Mark as Resolved'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
