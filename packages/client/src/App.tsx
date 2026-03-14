import { useState, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useOfficeLayout } from './hooks/useOfficeLayout';
import { useAgents } from './hooks/useAgents';
import { useChatBubbles } from './hooks/useChatBubbles';
import { OfficeScene } from './components/OfficeScene';
import { HUD } from './components/HUD';
import { SidePanel } from './components/SidePanel';
import { ConversationsPanel } from './components/ConversationsPanel';

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
  const { connected, simState, subscribe } = useWebSocket();
  const { data: layout, error } = useOfficeLayout();
  const agents = useAgents(subscribe);
  const chatBubbles = useChatBubbles(subscribe);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showConversations, setShowConversations] = useState(false);

  const handleAgentClick = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedAgentId(null);
  }, []);

  const toggleConversations = useCallback(() => {
    setShowConversations((prev) => !prev);
  }, []);

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
      <HUD
        simState={simState}
        connected={connected}
        showConversations={showConversations}
        onToggleConversations={toggleConversations}
      />
      <OfficeScene
        layout={layout}
        agents={agents}
        chatBubbles={chatBubbles}
        selectedAgentId={selectedAgentId}
        onAgentClick={handleAgentClick}
        onBackgroundClick={handleClose}
      />
      {showConversations && (
        <ConversationsPanel onClose={toggleConversations} subscribe={subscribe} />
      )}
      {selectedAgentId && (
        <SidePanel agentId={selectedAgentId} onClose={handleClose} subscribe={subscribe} />
      )}
    </div>
  );
}
