import { Html } from '@react-three/drei';
import type { OfficeLayout } from '../hooks/useOfficeLayout';

interface Props {
  layout: OfficeLayout;
}

export function OfficeFurniture({ layout }: Props) {
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
      {layout.meetingRooms.map((room) => (
        <group key={room.id} position={[room.position_x, 0, room.position_z]}>
          {/* Conference table */}
          <mesh position={[0, 0.35, 0]}>
            <boxGeometry args={[3, 0.08, 1.5]} />
            <meshStandardMaterial color="#4a5568" />
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
          <Html position={[0, 3.2, 0]} center style={{ pointerEvents: 'none' }}>
            <div
              style={{
                color: '#a0aec0',
                fontSize: '11px',
                fontFamily: 'monospace',
                background: 'rgba(26, 26, 46, 0.8)',
                padding: '2px 6px',
                borderRadius: '3px',
                whiteSpace: 'nowrap',
              }}
            >
              {room.name}
            </div>
          </Html>
        </group>
      ))}
    </>
  );
}
