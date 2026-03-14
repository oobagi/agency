import { useEffect, useState } from 'react';

export interface LayoutElement {
  id: string;
  type: 'wall' | 'door' | 'floor' | 'decoration';
  position_x: number;
  position_y: number;
  position_z: number;
  width: number;
  height: number;
  depth: number;
  metadata: string | null;
}

export interface MeetingRoom {
  id: string;
  name: string;
  position_x: number;
  position_y: number;
  position_z: number;
  capacity: number;
}

export interface Desk {
  id: string;
  position_x: number;
  position_y: number;
  position_z: number;
  agent_id: string | null;
  agent_name: string | null;
  team_id: string | null;
  team_name: string | null;
  team_color: string | null;
}

export interface OfficeLayout {
  layout: LayoutElement[];
  meetingRooms: MeetingRoom[];
  desks: Desk[];
}

export function useOfficeLayout() {
  const [data, setData] = useState<OfficeLayout | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/office/layout')
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch((e) => setError(e.message));
  }, []);

  return { data, error };
}
