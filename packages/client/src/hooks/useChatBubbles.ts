import { useEffect, useState, useCallback } from 'react';
import type { WSMessage } from './useWebSocket';

export interface ChatBubble {
  id: string;
  agentId: string;
  agentName: string;
  message: string;
  createdAt: number; // Date.now()
  expiresAt: number;
}

const BUBBLE_DURATION_MS = 6000;

export function useChatBubbles(subscribe: (handler: (msg: WSMessage) => void) => () => void) {
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);

  const handleMessage = useCallback((msg: WSMessage) => {
    if (msg.type !== 'speak') return;

    const now = Date.now();
    const bubble: ChatBubble = {
      id: `${msg.agentId}-${now}`,
      agentId: msg.agentId,
      agentName: msg.agentName,
      message: msg.message,
      createdAt: now,
      expiresAt: now + BUBBLE_DURATION_MS,
    };

    setBubbles((prev) => {
      // Replace any existing bubble for this agent
      const filtered = prev.filter((b) => b.agentId !== msg.agentId);
      return [...filtered, bubble];
    });
  }, []);

  useEffect(() => {
    return subscribe(handleMessage);
  }, [subscribe, handleMessage]);

  // Clean up expired bubbles
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setBubbles((prev) => {
        const active = prev.filter((b) => b.expiresAt > now);
        return active.length !== prev.length ? active : prev;
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return bubbles;
}
