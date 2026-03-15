import { useState } from 'react';

interface SettingsPanelProps {
  onClose: () => void;
}

const S = {
  panel: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    bottom: 0,
    width: '380px',
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
  title: { fontSize: '14px', fontWeight: 'bold' as const },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#a0aec0',
    cursor: 'pointer',
    fontSize: '16px',
    fontFamily: 'monospace',
  },
  body: {
    flex: 1,
    overflow: 'auto' as const,
    padding: '14px',
  },
  section: {
    marginBottom: '20px',
  },
  sectionTitle: {
    fontSize: '11px',
    color: '#a0aec0',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '8px',
    borderBottom: '1px solid #333355',
    paddingBottom: '4px',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
  },
  label: {
    fontSize: '12px',
  },
  sublabel: {
    fontSize: '10px',
    color: '#a0aec0',
    marginTop: '2px',
  },
  btn: {
    background: '#4a4a8a',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '5px 12px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '11px',
    flexShrink: 0,
  },
  btnDanger: {
    background: '#742a2a',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '5px 12px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '11px',
    flexShrink: 0,
  },
};

function ResetButton({
  label,
  confirmMsg,
  scope,
  danger,
  alsoResetOnboarding,
}: {
  label: string;
  confirmMsg: string;
  scope: string;
  danger?: boolean;
  alsoResetOnboarding?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (!confirm(confirmMsg)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      if (res.ok) {
        if (alsoResetOnboarding) {
          localStorage.removeItem('agency_onboarded');
        }
        window.location.reload();
      } else {
        const data = await res.json();
        alert(`Reset failed: ${data.error}`);
      }
    } catch {
      alert('Reset failed: could not reach server');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button style={danger ? S.btnDanger : S.btn} onClick={handleClick} disabled={busy}>
      {busy ? '...' : label}
    </button>
  );
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  return (
    <div style={S.panel}>
      <div style={S.header}>
        <div style={S.title}>Settings</div>
        <button style={S.closeBtn} onClick={onClose}>
          x
        </button>
      </div>

      <div style={S.body}>
        <div style={S.section}>
          <div style={S.sectionTitle}>Onboarding</div>
          <div style={S.row}>
            <div>
              <div style={S.label}>Reset onboarding tutorial</div>
              <div style={S.sublabel}>Replay the Office Manager introduction</div>
            </div>
            <button
              style={S.btn}
              onClick={() => {
                localStorage.removeItem('agency_onboarded');
                window.location.reload();
              }}
            >
              Reset
            </button>
          </div>
        </div>

        <div style={S.section}>
          <div style={S.sectionTitle}>Reset</div>

          <div style={S.row}>
            <div>
              <div style={S.label}>Reset conversations</div>
              <div style={S.sublabel}>Clear all chat logs and conversation history</div>
            </div>
            <ResetButton
              label="Reset"
              scope="conversations"
              confirmMsg="Clear all conversations and chat logs?"
            />
          </div>

          <div style={S.row}>
            <div>
              <div style={S.label}>Reset agents</div>
              <div style={S.sublabel}>
                Fire all hired agents, clear teams, tasks, and sessions. Keeps the Office Manager.
              </div>
            </div>
            <ResetButton
              label="Reset"
              scope="agents"
              danger
              confirmMsg="Fire all agents and clear teams/tasks/sessions? The Office Manager will be kept."
            />
          </div>

          <div style={S.row}>
            <div>
              <div style={S.label}>Reset sim time</div>
              <div style={S.sublabel}>Jump back to Day 1, 08:00</div>
            </div>
            <ResetButton
              label="Reset"
              scope="sim_time"
              confirmMsg="Reset simulation time to Day 1, 08:00?"
            />
          </div>

          <div style={S.row}>
            <div>
              <div style={S.label}>Reset everything</div>
              <div style={S.sublabel}>
                Wipe all data — agents, teams, projects, conversations, sim time. Fresh start.
              </div>
            </div>
            <ResetButton
              label="Reset All"
              scope="everything"
              danger
              alsoResetOnboarding
              confirmMsg="This will wipe ALL data and start fresh. Are you sure?"
            />
          </div>
        </div>

        <div style={S.section}>
          <div style={S.sectionTitle}>Data</div>
          <div style={S.row}>
            <div>
              <div style={S.label}>Clear local storage</div>
              <div style={S.sublabel}>Reset all client-side preferences</div>
            </div>
            <button
              style={S.btnDanger}
              onClick={() => {
                if (
                  !confirm('Clear all local storage? This will reset onboarding and preferences.')
                )
                  return;
                localStorage.clear();
                window.location.reload();
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
