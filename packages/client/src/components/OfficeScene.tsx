import { useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { OfficeFloor } from './OfficeFloor';
import { OfficeWalls } from './OfficeWalls';
import { OfficeFurniture } from './OfficeFurniture';
import { AgentLayer } from './AgentLayer';
import { ChatBubbleLayer } from './ChatBubbleLayer';
import type { OfficeLayout } from '../hooks/useOfficeLayout';
import type { AgentRenderState } from '../hooks/useAgents';
import type { ChatBubble } from '../hooks/useChatBubbles';

const PAN_SPEED = 20;
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();

function WASDControls({
  controlsRef,
}: {
  controlsRef: React.RefObject<{ target: THREE.Vector3; update: () => void } | null>;
}) {
  const { camera } = useThree();
  const keys = useRef<Set<string>>(new Set());

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      // Skip when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      keys.current.add(e.key.toLowerCase());
    };
    const onUp = (e: KeyboardEvent) => {
      keys.current.delete(e.key.toLowerCase());
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls || keys.current.size === 0) return;

    // Get camera's forward/right projected onto the XZ plane
    camera.getWorldDirection(_forward);
    _forward.y = 0;
    _forward.normalize();
    _right.crossVectors(_forward, camera.up).normalize();

    const move = new THREE.Vector3();
    if (keys.current.has('w')) move.add(_forward);
    if (keys.current.has('s')) move.sub(_forward);
    if (keys.current.has('a')) move.sub(_right);
    if (keys.current.has('d')) move.add(_right);

    if (move.lengthSq() === 0) return;
    move.normalize().multiplyScalar(PAN_SPEED * delta);

    camera.position.add(move);
    controls.target.add(move);
    controls.update();
  });

  return null;
}

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
  onboarding?: boolean;
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
  onboarding,
}: OfficeSceneProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);

  // During onboarding, point camera at the onboarding room where the OM is
  const camPos: [number, number, number] = onboarding ? [5, 25, 35] : [30, 25, 30];
  const camTarget: [number, number, number] = onboarding ? [-15, 0, 15] : [5, 0, 8];

  return (
    <Canvas
      camera={{ position: camPos, fov: 50, near: 0.1, far: 200 }}
      style={{ width: '100%', height: '100%', background: '#1a1a2e' }}
      onPointerMissed={onBackgroundClick}
    >
      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[20, 30, 10]} intensity={0.8} castShadow />
      <directionalLight position={[-10, 20, -10]} intensity={0.3} />

      {/* Camera controls */}
      <OrbitControls
        ref={controlsRef}
        target={camTarget}
        minDistance={5}
        maxDistance={80}
        maxPolarAngle={Math.PI / 2.1}
      />
      <WASDControls controlsRef={controlsRef} />

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
