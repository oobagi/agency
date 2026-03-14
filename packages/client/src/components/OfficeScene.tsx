import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { OfficeFloor } from './OfficeFloor';
import { OfficeWalls } from './OfficeWalls';
import { OfficeFurniture } from './OfficeFurniture';
import { AgentLayer } from './AgentLayer';
import { ChatBubbleLayer } from './ChatBubbleLayer';
import type { OfficeLayout } from '../hooks/useOfficeLayout';
import type { AgentRenderState } from '../hooks/useAgents';
import type { ChatBubble } from '../hooks/useChatBubbles';

interface OfficeSceneProps {
  layout: OfficeLayout;
  agents: Map<string, AgentRenderState>;
  chatBubbles: ChatBubble[];
  selectedAgentId: string | null;
  selectedRoomId: string | null;
  highlightAgentId?: string | null;
  deskAssignMode?: { agentId: string; teamId: string | null } | null;
  onAgentClick: (agentId: string) => void;
  onRoomClick: (roomId: string) => void;
  onDeskClick?: (deskId: string) => void;
  onBackgroundClick: () => void;
}

export function OfficeScene({
  layout,
  agents,
  chatBubbles,
  selectedAgentId,
  selectedRoomId,
  highlightAgentId,
  deskAssignMode,
  onAgentClick,
  onRoomClick,
  onDeskClick,
  onBackgroundClick,
}: OfficeSceneProps) {
  return (
    <Canvas
      camera={{ position: [30, 25, 30], fov: 50, near: 0.1, far: 200 }}
      style={{ width: '100%', height: '100%', background: '#1a1a2e' }}
      onPointerMissed={onBackgroundClick}
    >
      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[20, 30, 10]} intensity={0.8} castShadow />
      <directionalLight position={[-10, 20, -10]} intensity={0.3} />

      {/* Camera controls */}
      <OrbitControls
        target={[5, 0, 8]}
        minDistance={5}
        maxDistance={80}
        maxPolarAngle={Math.PI / 2.1}
      />

      {/* Office geometry */}
      <OfficeFloor layout={layout} />
      <OfficeWalls layout={layout} />
      <OfficeFurniture
        layout={layout}
        selectedRoomId={selectedRoomId}
        onRoomClick={onRoomClick}
        deskAssignMode={deskAssignMode}
        onDeskClick={onDeskClick}
      />

      {/* Agents */}
      <AgentLayer
        agents={agents}
        selectedAgentId={selectedAgentId}
        highlightAgentId={highlightAgentId}
        onAgentClick={onAgentClick}
      />

      {/* Chat bubbles */}
      <ChatBubbleLayer bubbles={chatBubbles} agents={agents} />

      {/* Grid helper for spatial reference */}
      <gridHelper args={[60, 30, '#333355', '#222244']} position={[0, 0.01, 0]} />
    </Canvas>
  );
}
