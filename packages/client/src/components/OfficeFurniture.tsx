import { useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import type { OfficeLayout, Desk } from '../hooks/useOfficeLayout';

interface Props {
  layout: OfficeLayout;
  selectedRoomId?: string | null;
  onRoomClick?: (roomId: string) => void;
  deskAssignMode?: { agentId: string; teamId: string | null } | null;
  onDeskClick?: (deskId: string) => void;
}

function DeskMesh({
  desk,
  deskAssignMode,
  onDeskClick,
}: {
  desk: Desk;
  deskAssignMode: Props['deskAssignMode'];
  onDeskClick?: (deskId: string) => void;
}) {
  const meshRef = useRef<Mesh>(null);
  const isAvailable = deskAssignMode && !desk.agent_id;
  const isTeamMatch = isAvailable && desk.team_id === deskAssignMode?.teamId;

  useFrame(({ clock }) => {
    if (!meshRef.current || !isAvailable) return;
    const t = clock.getElapsedTime();
    const pulse = Math.sin(t * 4) * 0.3 + 0.5;
    const mat = meshRef.current.material as unknown as {
      emissiveIntensity: number;
      emissive: { set: (c: string) => void };
    };
    mat.emissive.set(isTeamMatch ? '#4488ff' : '#3366aa');
    mat.emissiveIntensity = pulse;
  });

  return (
    <group position={[desk.position_x, 0, desk.position_z]}>
      {/* Desk surface */}
      <mesh
        ref={meshRef}
        position={[0, 0.4, 0]}
        onClick={
          isAvailable
            ? (e) => {
                e.stopPropagation();
                onDeskClick?.(desk.id);
              }
            : undefined
        }
      >
        <boxGeometry args={[1.8, 0.08, 1]} />
        <meshStandardMaterial
          color={desk.team_color ?? '#555566'}
          emissive="#000000"
          opacity={deskAssignMode && !isAvailable ? 0.4 : 1}
          transparent={!!(deskAssignMode && !isAvailable)}
        />
      </mesh>
      {/* Desk legs */}
      {(
        [
          [-0.8, 0.2, -0.4],
          [0.8, 0.2, -0.4],
          [-0.8, 0.2, 0.4],
          [0.8, 0.2, 0.4],
        ] as [number, number, number][]
      ).map(([x, y, z], i) => (
        <mesh key={i} position={[x, y, z]}>
          <boxGeometry args={[0.06, 0.4, 0.06]} />
          <meshStandardMaterial color="#333344" />
        </mesh>
      ))}
    </group>
  );
}

export function OfficeFurniture({
  layout,
  selectedRoomId,
  onRoomClick,
  deskAssignMode,
  onDeskClick,
}: Props) {
  return (
    <>
      {/* Desks */}
      {layout.desks.map((desk) => (
        <DeskMesh
          key={desk.id}
          desk={desk}
          deskAssignMode={deskAssignMode}
          onDeskClick={onDeskClick}
        />
      ))}

      {/* Meeting rooms — label + table */}
      {layout.meetingRooms.map((room) => {
        const isSelected = selectedRoomId === room.id;
        const isOnboarding = room.id === 'room-onboarding';
        return (
          <group key={room.id} position={[room.position_x, 0, room.position_z]}>
            {isOnboarding ? (
              /* Onboarding room: colored floor marker instead of table */
              <mesh
                position={[0, 0.02, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
                onClick={(e) => {
                  e.stopPropagation();
                  onRoomClick?.(room.id);
                }}
              >
                <planeGeometry args={[8, 8]} />
                <meshStandardMaterial
                  color="#1a3a5c"
                  emissive={isSelected ? '#1a2a4a' : '#0a1525'}
                  transparent
                  opacity={0.6}
                />
              </mesh>
            ) : (
              <>
                {/* Conference table */}
                <mesh
                  position={[0, 0.35, 0]}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRoomClick?.(room.id);
                  }}
                >
                  <boxGeometry args={[3, 0.08, 1.5]} />
                  <meshStandardMaterial
                    color="#4a5568"
                    emissive={isSelected ? '#2a2a6a' : '#000000'}
                  />
                </mesh>
                {/* Table legs */}
                {(
                  [
                    [-1.2, 0.17, -0.5],
                    [1.2, 0.17, -0.5],
                    [-1.2, 0.17, 0.5],
                    [1.2, 0.17, 0.5],
                  ] as [number, number, number][]
                ).map(([x, y, z], i) => (
                  <mesh key={i} position={[x, y, z]}>
                    <boxGeometry args={[0.08, 0.34, 0.08]} />
                    <meshStandardMaterial color="#333344" />
                  </mesh>
                ))}
              </>
            )}
            {/* Room label */}
            <Html
              position={[0, 3.2, 0]}
              center
              style={{ pointerEvents: 'none' }}
              zIndexRange={[0, 0]}
            >
              <div
                style={{
                  color: isSelected ? '#e2e8f0' : '#a0aec0',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  background: isSelected ? 'rgba(99, 102, 241, 0.5)' : 'rgba(26, 26, 46, 0.8)',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  whiteSpace: 'nowrap',
                }}
              >
                {room.name}
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}
