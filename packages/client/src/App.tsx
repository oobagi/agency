import { useState, useCallback, useMemo } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useOfficeLayout } from './hooks/useOfficeLayout';
import { useAgents } from './hooks/useAgents';
import { useChatBubbles } from './hooks/useChatBubbles';
import { OfficeScene } from './components/OfficeScene';
import { HUD } from './components/HUD';
import { SidePanel } from './components/SidePanel';
import { RoomPanel } from './components/RoomPanel';
import { OnboardingDialogue } from './components/WelcomeOverlay';
import { ConversationsPanel } from './components/ConversationsPanel';
import { DiffViewerPanel } from './components/DiffViewerPanel';
import { SchedulePanel } from './components/SchedulePanel';
import { BlockedAgentModal } from './components/BlockedAgentModal';
import { ErrorBoundary } from './components/ErrorBoundary';

const ONBOARDED_KEY = 'agency_onboarded';

type OnboardingStep = 'intro' | 'click_om' | 'send_message' | 'outro' | 'done';

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
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(() =>
    localStorage.getItem(ONBOARDED_KEY) === '1' ? 'done' : 'intro',
  );

  const omAgent = useMemo(() => {
    for (const a of agents.values()) {
      if (a.role === 'office_manager') return a;
    }
    return null;
  }, [agents]);

  const onboarding = onboardingStep !== 'done' && agents.size <= 1 && omAgent !== null;

  const finishOnboarding = useCallback(() => {
    setOnboardingStep('done');
    localStorage.setItem(ONBOARDED_KEY, '1');
  }, []);

  const advanceOnboarding = useCallback(() => {
    setOnboardingStep((prev) => {
      if (prev === 'intro') return 'click_om';
      if (prev === 'click_om') return 'send_message';
      if (prev === 'send_message') return 'outro';
      if (prev === 'outro') {
        localStorage.setItem(ONBOARDED_KEY, '1');
        return 'done';
      }
      return prev;
    });
  }, []);

  const handleAgentClick = useCallback(
    (agentId: string) => {
      setSelectedAgentId(agentId);
      setSelectedRoomId(null);
      // If user clicked the OM during the click_om step, advance
      if (onboardingStep === 'click_om' && omAgent && agentId === omAgent.id) {
        advanceOnboarding();
      }
    },
    [onboardingStep, omAgent, advanceOnboarding],
  );

  const handleMessageSent = useCallback(() => {
    if (onboardingStep === 'send_message') {
      advanceOnboarding();
    }
  }, [onboardingStep, advanceOnboarding]);

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
  const showingOMPanel = selectedAgent?.role === 'office_manager' && onboarding;

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
          highlightAgentId={onboarding && !selectedAgentId ? (omAgent?.id ?? null) : null}
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
          <SidePanel
            agentId={selectedAgentId}
            onClose={handleClose}
            subscribe={subscribe}
            onboarding={showingOMPanel}
            onMessageSent={showingOMPanel ? handleMessageSent : undefined}
          />
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
      {onboarding && (
        <OnboardingDialogue
          step={onboardingStep as 'intro' | 'click_om' | 'send_message' | 'outro'}
          onAdvance={onboardingStep === 'outro' ? finishOnboarding : advanceOnboarding}
        />
      )}
    </div>
  );
}
