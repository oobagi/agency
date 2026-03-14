import { Html } from '@react-three/drei';
import type { OfficeLayout } from '../hooks/useOfficeLayout';

interface Props {
  layout: OfficeLayout;
}

export function OfficeWalls({ layout }: Props) {
  const walls = layout.layout.filter((el) => el.type === 'wall');
  const doors = layout.layout.filter((el) => el.type === 'door');

  return (
    <>
      {walls.map((wall) => {
        const meta = wall.metadata ? JSON.parse(wall.metadata) : null;
        const isRoomWall = !!meta?.room;

        return (
          <mesh key={wall.id} position={[wall.position_x, wall.position_y, wall.position_z]}>
            <boxGeometry args={[wall.width, wall.height, wall.depth]} />
            <meshStandardMaterial
              color={isRoomWall ? '#3d3d5c' : '#4a4a6a'}
              transparent
              opacity={isRoomWall ? 0.6 : 0.8}
            />
          </mesh>
        );
      })}
      {doors.map((door) => {
        const meta = door.metadata ? JSON.parse(door.metadata) : null;
        return (
          <group key={door.id} position={[door.position_x, door.position_y, door.position_z]}>
            <mesh>
              <boxGeometry args={[door.width, door.height, door.depth]} />
              <meshStandardMaterial color="#2a4a3a" transparent opacity={0.3} />
            </mesh>
            {meta?.label && (
              <Html
                position={[0, 1.8, 0]}
                center
                style={{ pointerEvents: 'none' }}
                zIndexRange={[0, 0]}
              >
                <div
                  style={{
                    color: '#68d391',
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    background: 'rgba(26, 26, 46, 0.8)',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {meta.label}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
}
