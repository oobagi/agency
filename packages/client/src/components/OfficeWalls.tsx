import type { OfficeLayout } from '../hooks/useOfficeLayout';

interface Props {
  layout: OfficeLayout;
}

export function OfficeWalls({ layout }: Props) {
  const walls = layout.layout.filter((el) => el.type === 'wall');

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
    </>
  );
}
