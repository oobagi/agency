import { useCallback } from 'react';
import type { SimState } from '../hooks/useWebSocket';

interface HUDProps {
  simState: SimState;
  connected: boolean;
  showConversations: boolean;
  onToggleConversations: () => void;
  showProjects: boolean;
  onToggleProjects: () => void;
  showSchedule: boolean;
  onToggleSchedule: () => void;
}

const SPEEDS = [1, 2, 5, 10];

const styles = {
  container: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 16px',
    background: 'rgba(26, 26, 46, 0.9)',
    borderBottom: '1px solid #333355',
    fontFamily: 'monospace',
    fontSize: '13px',
    color: '#e2e8f0',
    zIndex: 10,
    pointerEvents: 'auto' as const,
  },
  time: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  button: {
    background: '#2d2d4a',
    color: '#e2e8f0',
    border: '1px solid #444466',
    borderRadius: '4px',
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  activeButton: {
    background: '#4a4a8a',
    color: '#fff',
    border: '1px solid #6666aa',
    borderRadius: '4px',
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  dot: (connected: boolean) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: connected ? '#48bb78' : '#f56565',
  }),
};

function formatSimTime(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toISOString().split('T')[0];
    const time = d.toISOString().split('T')[1].slice(0, 8);
    return `${date} ${time}`;
  } catch {
    return iso;
  }
}

export function HUD({
  simState,
  connected,
  showConversations,
  onToggleConversations,
  showProjects,
  onToggleProjects,
  showSchedule,
  onToggleSchedule,
}: HUDProps) {
  const togglePause = useCallback(async () => {
    const endpoint = simState.paused ? '/api/sim/resume' : '/api/sim/pause';
    await fetch(endpoint, { method: 'POST' });
  }, [simState.paused]);

  const setSpeed = useCallback(async (multiplier: number) => {
    await fetch('/api/sim/speed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ multiplier }),
    });
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.time}>
        <div style={styles.dot(connected)} title={connected ? 'Connected' : 'Disconnected'} />
        <span>{formatSimTime(simState.simTime)}</span>
        {simState.paused && <span style={{ color: '#f6ad55', fontWeight: 'bold' }}>PAUSED</span>}
      </div>

      <div style={styles.controls}>
        <button
          style={showConversations ? styles.activeButton : styles.button}
          onClick={onToggleConversations}
        >
          Conversations
        </button>

        <button
          style={showProjects ? styles.activeButton : styles.button}
          onClick={onToggleProjects}
        >
          Projects
        </button>

        <button
          style={showSchedule ? styles.activeButton : styles.button}
          onClick={onToggleSchedule}
        >
          Schedule
        </button>

        <button style={styles.button} onClick={togglePause}>
          {simState.paused ? 'Play' : 'Pause'}
        </button>

        {SPEEDS.map((s) => (
          <button
            key={s}
            style={simState.speed === s ? styles.activeButton : styles.button}
            onClick={() => setSpeed(s)}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}
