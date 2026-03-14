import { useEffect, useRef, useCallback, useState } from 'react';

export interface SimState {
  simTime: string;
  speed: number;
  paused: boolean;
}

export type WSMessage =
  | { type: 'tick'; simTime: string; speed: number; paused: boolean }
  | {
      type: 'agent_position';
      agentId: string;
      x: number;
      y: number;
      z: number;
      state: string;
      moving: boolean;
    }
  | {
      type: 'speak';
      agentId: string;
      agentName: string;
      message: string;
      listeners: Array<{ id: string; name: string }>;
    }
  | { type: 'blocker_user_facing'; [key: string]: unknown }
  | { type: 'session_event'; agentId: string; event: unknown }
  | {
      type: 'conversation_new';
      conversationId: string;
      conversationType: string;
      participant_names: string;
      first_message: string;
      sim_time_start: string;
    };

type MessageHandler = (msg: WSMessage) => void;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const [connected, setConnected] = useState(false);
  const [simState, setSimState] = useState<SimState>({
    simTime: new Date().toISOString(),
    speed: 1,
    paused: true,
  });

  const subscribe = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    function connect() {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        // Reconnect after 2s
        setTimeout(connect, 2000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WSMessage;

          if (msg.type === 'tick') {
            setSimState({ simTime: msg.simTime, speed: msg.speed, paused: msg.paused });
          }

          for (const handler of handlersRef.current) {
            handler(msg);
          }
        } catch {
          // Ignore invalid messages
        }
      };
    }

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, []);

  // Fetch initial sim state via REST
  useEffect(() => {
    fetch('/api/sim/status')
      .then((r) => r.json())
      .then((data) => {
        if (data.simTime) {
          setSimState({ simTime: data.simTime, speed: data.speed, paused: data.paused });
        }
      })
      .catch(() => {});
  }, []);

  return { connected, simState, subscribe };
}
