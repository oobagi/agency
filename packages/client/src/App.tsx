import { useState, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useOfficeLayout } from './hooks/useOfficeLayout';
import { useAgents } from './hooks/useAgents';
import { useChatBubbles } from './hooks/useChatBubbles';
import { OfficeScene } from './components/OfficeScene';
import { HUD } from './components/HUD';
import { SidePanel } from './components/SidePanel';
import { RoomPanel } from './components/RoomPanel';
import { ConversationsPanel } from './components/ConversationsPanel';
import { DiffViewerPanel } from './components/DiffViewerPanel';
import { SchedulePanel } from './components/SchedulePanel';
import { BlockedAgentModal } from './components/BlockedAgentModal';
import { ErrorBoundary } from './components/ErrorBoundary';

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
  const { connected, simState, updateSimState, subscribe } = useWebSocket();
  const { data: layout, error } = useOfficeLayout();
  const agents = useAgents(subscribe, connected);
  const chatBubbles = useChatBubbles(subscribe);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [leftPanel, setLeftPanel] = useState<LeftPanel>(null);

  const handleAgentClick = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    setSelectedRoomId(null);
  }, []);

  const handleRoomClick = useCallback((roomId: string) => {
    setSelectedRoomId((prev) => (prev === roomId ? null : roomId));
    setSelectedAgentId(null);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedAgentId(null);
    setSelectedRoomId(null);
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
        onUpdateSimState={updateSimState}
        showConversations={leftPanel === 'conversations'}
        onToggleConversations={() => togglePanel('conversations')}
        showProjects={leftPanel === 'projects'}
        onToggleProjects={() => togglePanel('projects')}
        showSchedule={leftPanel === 'schedule'}
        onToggleSchedule={() => togglePanel('schedule')}
      />
      <ErrorBoundary fallbackLabel="3D Viewport">
        <OfficeScene
          layout={layout}
          agents={agents}
          chatBubbles={chatBubbles}
          selectedAgentId={selectedAgentId}
          selectedRoomId={selectedRoomId}
          onAgentClick={handleAgentClick}
          onRoomClick={handleRoomClick}
          onBackgroundClick={handleClose}
        />
      </ErrorBoundary>
      {leftPanel === 'conversations' && (
        <ErrorBoundary fallbackLabel="Conversations">
          <ConversationsPanel onClose={() => togglePanel('conversations')} subscribe={subscribe} />
        </ErrorBoundary>
      )}
      {leftPanel === 'projects' && (
        <ErrorBoundary fallbackLabel="Projects">
          <DiffViewerPanel onClose={() => togglePanel('projects')} />
        </ErrorBoundary>
      )}
      {leftPanel === 'schedule' && (
        <ErrorBoundary fallbackLabel="Schedule">
          <SchedulePanel
            onClose={() => togglePanel('schedule')}
            subscribe={subscribe}
            simTime={simState.simTime}
          />
        </ErrorBoundary>
      )}
      {selectedAgentId && (
        <ErrorBoundary fallbackLabel="Agent Panel">
          <SidePanel agentId={selectedAgentId} onClose={handleClose} subscribe={subscribe} />
        </ErrorBoundary>
      )}
      {selectedRoomId && layout && (
        <ErrorBoundary fallbackLabel="Room Panel">
          <RoomPanel
            room={layout.meetingRooms.find((r) => r.id === selectedRoomId)!}
            agents={agents}
            onClose={handleClose}
          />
        </ErrorBoundary>
      )}
      {selectedAgentId && isBlocked && selectedAgent && (
        <ErrorBoundary fallbackLabel="Blocker Modal">
          <BlockedAgentModal
            agentId={selectedAgentId}
            agentName={selectedAgent.name}
            agentRole={selectedAgent.role}
            onClose={handleClose}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}
