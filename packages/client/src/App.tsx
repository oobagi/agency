import { useState, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useOfficeLayout } from './hooks/useOfficeLayout';
import { useAgents } from './hooks/useAgents';
import { useChatBubbles } from './hooks/useChatBubbles';
import { OfficeScene } from './components/OfficeScene';
import { HUD } from './components/HUD';
import { SidePanel } from './components/SidePanel';
import { ConversationsPanel } from './components/ConversationsPanel';
import { DiffViewerPanel } from './components/DiffViewerPanel';
import { SchedulePanel } from './components/SchedulePanel';
import { BlockedAgentModal } from './components/BlockedAgentModal';

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

type LeftPanel = 'conversations' | 'projects' | 'schedule' | null;

export function App() {
  const { connected, simState, subscribe } = useWebSocket();
  const { data: layout, error } = useOfficeLayout();
  const agents = useAgents(subscribe);
  const chatBubbles = useChatBubbles(subscribe);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [leftPanel, setLeftPanel] = useState<LeftPanel>(null);

  const handleAgentClick = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedAgentId(null);
  }, []);

  const togglePanel = useCallback((panel: LeftPanel) => {
    setLeftPanel((prev) => (prev === panel ? null : panel));
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

  const selectedAgent = selectedAgentId ? agents.get(selectedAgentId) : null;
  const isBlocked = selectedAgent?.state === 'Blocked';

  return (
    <div style={styles.root}>
      <HUD
        simState={simState}
        connected={connected}
        showConversations={leftPanel === 'conversations'}
        onToggleConversations={() => togglePanel('conversations')}
        showProjects={leftPanel === 'projects'}
        onToggleProjects={() => togglePanel('projects')}
        showSchedule={leftPanel === 'schedule'}
        onToggleSchedule={() => togglePanel('schedule')}
      />
      <OfficeScene
        layout={layout}
        agents={agents}
        chatBubbles={chatBubbles}
        selectedAgentId={selectedAgentId}
        onAgentClick={handleAgentClick}
        onBackgroundClick={handleClose}
      />
      {leftPanel === 'conversations' && (
        <ConversationsPanel onClose={() => togglePanel('conversations')} subscribe={subscribe} />
      )}
      {leftPanel === 'projects' && <DiffViewerPanel onClose={() => togglePanel('projects')} />}
      {leftPanel === 'schedule' && (
        <SchedulePanel
          onClose={() => togglePanel('schedule')}
          subscribe={subscribe}
          simTime={simState.simTime}
        />
      )}
      {selectedAgentId && (
        <SidePanel agentId={selectedAgentId} onClose={handleClose} subscribe={subscribe} />
      )}
      {selectedAgentId && isBlocked && selectedAgent && (
        <BlockedAgentModal
          agentId={selectedAgentId}
          agentName={selectedAgent.name}
          agentRole={selectedAgent.role}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
