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
  },
};

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
