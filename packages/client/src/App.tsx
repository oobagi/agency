import { useWebSocket } from './hooks/useWebSocket';
import { useOfficeLayout } from './hooks/useOfficeLayout';
import { OfficeScene } from './components/OfficeScene';
import { HUD } from './components/HUD';

const styles = {
  root: {
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
    position: 'relative' as const,
    background: '#1a1a2e',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100vw',
    height: '100vh',
    color: '#a0aec0',
    fontFamily: 'monospace',
    fontSize: '14px',
    background: '#1a1a2e',
  },
};

export function App() {
  const { connected, simState } = useWebSocket();
  const { data: layout, error } = useOfficeLayout();

  if (error) {
    return (
      <div style={styles.loading}>
        Failed to load office layout: {error}. Is the server running?
      </div>
    );
  }

  if (!layout) {
    return <div style={styles.loading}>Loading office...</div>;
  }

  return (
    <div style={styles.root}>
      <HUD simState={simState} connected={connected} />
      <OfficeScene layout={layout} />
    </div>
  );
}
