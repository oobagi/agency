import { Html } from '@react-three/drei';
import type { OfficeLayout } from '../hooks/useOfficeLayout';

interface Props {
  layout: OfficeLayout;
  selectedRoomId?: string | null;
  onRoomClick?: (roomId: string) => void;
}

export function OfficeFurniture({ layout, selectedRoomId, onRoomClick }: Props) {
  return (
    <>
      {/* Desks */}
      {layout.desks.map((desk) => (
        <group key={desk.id} position={[desk.position_x, 0, desk.position_z]}>
          {/* Desk surface */}
          <mesh position={[0, 0.4, 0]}>
            <boxGeometry args={[1.8, 0.08, 1]} />
            <meshStandardMaterial color={desk.team_color ?? '#555566'} />
          </mesh>
          {/* Desk legs */}
          {[
            [-0.8, 0.2, -0.4],
            [0.8, 0.2, -0.4],
            [-0.8, 0.2, 0.4],
            [0.8, 0.2, 0.4],
          ].map(([x, y, z], i) => (
            <mesh key={i} position={[x, y, z]}>
              <boxGeometry args={[0.06, 0.4, 0.06]} />
              <meshStandardMaterial color="#333344" />
            </mesh>
          ))}
        </group>
      ))}

      {/* Meeting rooms — label + table */}
      {layout.meetingRooms.map((room) => {
        const isSelected = selectedRoomId === room.id;
        return (
          <group key={room.id} position={[room.position_x, 0, room.position_z]}>
            {/* Conference table */}
            <mesh
              position={[0, 0.35, 0]}
              onClick={(e) => {
                e.stopPropagation();
                onRoomClick?.(room.id);
              }}
            >
              <boxGeometry args={[3, 0.08, 1.5]} />
              <meshStandardMaterial color="#4a5568" emissive={isSelected ? '#2a2a6a' : '#000000'} />
            </mesh>
            {/* Table legs */}
            {[
              [-1.2, 0.17, -0.5],
              [1.2, 0.17, -0.5],
              [-1.2, 0.17, 0.5],
              [1.2, 0.17, 0.5],
            ].map(([x, y, z], i) => (
              <mesh key={i} position={[x, y, z]}>
                <boxGeometry args={[0.08, 0.34, 0.08]} />
                <meshStandardMaterial color="#333344" />
              </mesh>
            ))}
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
