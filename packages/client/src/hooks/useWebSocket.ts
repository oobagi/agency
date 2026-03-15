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
    }
  | {
      type: 'activity';
      category: string;
      agentId: string;
      agentName: string;
      description: string;
      simTime: string;
    }
  | { type: 'chat_log'; agentId: string; entry: Record<string, unknown> }
  | { type: 'agent_hired'; agentId: string; name: string; role: string }
  | { type: 'agent_fired'; agentId: string }
  | { type: 'agent_updated'; agentId: string };

type MessageHandler = (msg: WSMessage) => void;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

      ws.onopen = () => {
        setConnected(true);
        reconnectAttemptRef.current = 0;
      };

      ws.onclose = () => {
        setConnected(false);
        const attempt = reconnectAttemptRef.current;
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        reconnectAttemptRef.current = attempt + 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
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
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
      }
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

  const updateSimState = useCallback((partial: Partial<SimState>) => {
    setSimState((prev) => ({ ...prev, ...partial }));
  }, []);

  return { connected, simState, updateSimState, subscribe };
}
