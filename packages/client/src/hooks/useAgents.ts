import { useEffect, useState, useCallback, useRef } from 'react';
import type { WSMessage } from './useWebSocket';

export interface Agent {
  id: string;
  name: string;
  role: string;
  state: string;
  team_id: string | null;
  team_name: string | null;
  team_color: string | null;
  position_x: number;
  position_y: number;
  position_z: number;
  desk_id: string | null;
}

export interface AgentRenderState {
  id: string;
  name: string;
  role: string;
  state: string;
  teamColor: string | null;
  // Current display position (interpolated)
  x: number;
  y: number;
  z: number;
  // Target position (from server)
  targetX: number;
  targetZ: number;
  moving: boolean;
  // Activity icon
  activityIcon: string | null;
  activityIconTime: number;
}

const ACTIVITY_ICONS: Record<string, string> = {
  begin_task: '\u{1F4BB}', // laptop
  commit_work: '\u{2705}', // check mark
  open_pull_request: '\u{1F4E4}', // outbox
  review_pull_request: '\u{1F50D}', // magnifying glass
};

const ACTIVITY_ICON_DURATION_MS = 3000;

export function useAgents(
  subscribe: (handler: (msg: WSMessage) => void) => () => void,
  connected: boolean,
) {
  const [agents, setAgents] = useState<Map<string, AgentRenderState>>(new Map());
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  // Fetch initial agents from REST, and re-fetch on reconnect
  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then((data: Agent[]) => {
        const map = new Map<string, AgentRenderState>();
        for (const a of data) {
          map.set(a.id, {
            id: a.id,
            name: a.name,
            role: a.role,
            state: a.state,
            teamColor: a.team_color,
            x: a.position_x,
            y: a.position_y,
            z: a.position_z,
            targetX: a.position_x,
            targetZ: a.position_z,
            moving: false,
            activityIcon: null,
            activityIconTime: 0,
          });
        }
        setAgents(map);
      })
      .catch(() => {});
  }, [connected]);

  // Subscribe to WebSocket position updates
  const handleMessage = useCallback((msg: WSMessage) => {
    if (msg.type === 'agent_position') {
      setAgents((prev) => {
        const next = new Map(prev);
        const existing = next.get(msg.agentId);
        if (existing) {
          next.set(msg.agentId, {
            ...existing,
            targetX: msg.x,
            targetZ: msg.z,
            state: msg.state,
            moving: msg.moving,
          });
        } else {
          // New agent appeared — fetch full data
          fetch(`/api/agents/${msg.agentId}`)
            .then((r) => r.json())
            .then((a: Agent) => {
              setAgents((p) => {
                const n = new Map(p);
                n.set(a.id, {
                  id: a.id,
                  name: a.name,
                  role: a.role,
                  state: a.state,
                  teamColor: a.team_color,
                  x: msg.x,
                  y: msg.y,
                  z: msg.z,
                  targetX: msg.x,
                  targetZ: msg.z,
                  moving: msg.moving,
                  activityIcon: null,
                  activityIconTime: 0,
                });
                return n;
              });
            })
            .catch(() => {});
        }
        return next;
      });
    }

    // Activity icons from session tool_call_start events
    if (msg.type === 'session_event') {
      const event = msg.event as { type: string; data: { toolName?: string } };
      if (event.type === 'tool_call_start' && event.data.toolName) {
        const icon = ACTIVITY_ICONS[event.data.toolName];
        if (icon) {
          setAgents((prev) => {
            const next = new Map(prev);
            const existing = next.get(msg.agentId);
            if (existing) {
              next.set(msg.agentId, {
                ...existing,
                activityIcon: icon,
                activityIconTime: Date.now(),
              });
            }
            return next;
          });
        }
      }
    }
  }, []);

  useEffect(() => {
    return subscribe(handleMessage);
  }, [subscribe, handleMessage]);

  // Clear expired activity icons periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setAgents((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [id, agent] of next) {
          if (agent.activityIcon && now - agent.activityIconTime > ACTIVITY_ICON_DURATION_MS) {
            next.set(id, { ...agent, activityIcon: null, activityIconTime: 0 });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return agents;
}
