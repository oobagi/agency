import type { OfficeLayout } from '../hooks/useOfficeLayout';

interface Props {
  layout: OfficeLayout;
}

export function OfficeFloor({ layout }: Props) {
  const floor = layout.layout.find((el) => el.type === 'floor');
  if (!floor) return null;

  return (
    <mesh position={[floor.position_x, -0.05, floor.position_z]} receiveShadow>
      <boxGeometry args={[floor.width, floor.height, floor.depth]} />
      <meshStandardMaterial color="#2a2a40" />
    </mesh>
  );
}
