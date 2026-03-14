import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentRenderState } from '../hooks/useAgents';

interface AgentCapsuleProps {
  agent: AgentRenderState;
  selected?: boolean;
  highlight?: boolean;
  onClick?: (agentId: string) => void;
}

const LERP_SPEED = 8;
const IDLE_BOB_SPEED = 1.5;
const IDLE_BOB_AMOUNT = 0.05;

const labelStyle: React.CSSProperties = {
  pointerEvents: 'none',
  textAlign: 'center',
  whiteSpace: 'nowrap',
};

const nameStyle: React.CSSProperties = {
  color: '#e2e8f0',
  fontSize: '11px',
  fontFamily: 'monospace',
  fontWeight: 'bold',
  textShadow: '0 0 4px rgba(0,0,0,0.8)',
};

const stateStyle: React.CSSProperties = {
  color: '#a0aec0',
  fontSize: '9px',
  fontFamily: 'monospace',
  textShadow: '0 0 4px rgba(0,0,0,0.8)',
};

const blockedStyle: React.CSSProperties = {
  color: '#fc8181',
  fontSize: '16px',
  fontWeight: 'bold',
  textShadow: '0 0 6px rgba(245,101,101,0.6)',
};

const activityStyle: React.CSSProperties = {
  fontSize: '14px',
  textShadow: '0 0 4px rgba(0,0,0,0.6)',
};

function getCapsuleColor(agent: AgentRenderState): string {
  if (agent.role === 'office_manager') return '#9ca3af'; // neutral gray
  if (!agent.teamColor) return '#6b7280'; // unassigned gray
  return agent.teamColor;
}

export function AgentCapsule({ agent, selected, highlight, onClick }: AgentCapsuleProps) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const posRef = useRef(new THREE.Vector3(agent.x, 0, agent.z));

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    const target = new THREE.Vector3(agent.targetX, 0, agent.targetZ);
    posRef.current.lerp(target, Math.min(1, LERP_SPEED * delta));

    // Idle bobbing animation when not walking
    let yOffset = 0;
    if (!agent.moving && agent.state !== 'Walking') {
      yOffset = Math.sin(Date.now() * 0.001 * IDLE_BOB_SPEED) * IDLE_BOB_AMOUNT;
    }

    groupRef.current.position.set(posRef.current.x, yOffset, posRef.current.z);

    // Pulsing glow for highlighted capsule
    if (highlight && meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshStandardMaterial;
      const pulse = (Math.sin(Date.now() * 0.003) + 1) / 2; // 0..1
      mat.emissiveIntensity = 0.3 + pulse * 0.7;
    }
  });

  const color = getCapsuleColor(agent);
  const emissive = selected ? '#4444aa' : highlight ? '#6366f1' : '#000000';

  return (
    <group ref={groupRef} position={[agent.x, 0, agent.z]}>
      {/* Capsule body */}
      <mesh
        ref={meshRef}
        position={[0, 0.7, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(agent.id);
        }}
      >
        <capsuleGeometry args={[0.25, 0.6, 8, 16]} />
        <meshStandardMaterial color={color} emissive={emissive} />
      </mesh>

      {/* Name label + state */}
      <Html position={[0, 1.6, 0]} center style={labelStyle} zIndexRange={[0, 0]}>
        <div style={nameStyle}>{agent.name}</div>
        <div style={stateStyle}>{agent.state}</div>
      </Html>

      {/* Blocked indicator */}
      {agent.state === 'Blocked' && (
        <Html position={[0, 2.0, 0]} center style={labelStyle} zIndexRange={[0, 0]}>
          <div style={blockedStyle}>!</div>
        </Html>
      )}

      {/* Activity icon */}
      {agent.activityIcon && (
        <Html position={[0.4, 1.4, 0]} center style={labelStyle} zIndexRange={[0, 0]}>
          <div style={activityStyle}>{agent.activityIcon}</div>
        </Html>
      )}
    </group>
  );
}
