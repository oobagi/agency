import { Html } from '@react-three/drei';
import type { ChatBubble } from '../hooks/useChatBubbles';
import type { AgentRenderState } from '../hooks/useAgents';

interface ChatBubbleLayerProps {
  bubbles: ChatBubble[];
  agents: Map<string, AgentRenderState>;
}

const MAX_DISPLAY_LEN = 80;

const bubbleStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  maxWidth: '200px',
  background: 'rgba(30, 30, 50, 0.92)',
  border: '1px solid #4a4a6a',
  borderRadius: '8px',
  padding: '6px 10px',
  fontFamily: 'monospace',
  fontSize: '10px',
  lineHeight: '1.4',
  color: '#e2e8f0',
};

const nameStyle: React.CSSProperties = {
  color: '#a78bfa',
  fontSize: '9px',
  marginBottom: '2px',
  fontWeight: 'bold',
};

function BubbleContent({ bubble }: { bubble: ChatBubble }) {
  const now = Date.now();
  const remaining = bubble.expiresAt - now;
  const totalDuration = bubble.expiresAt - bubble.createdAt;
  const opacity = Math.max(0.2, Math.min(1, remaining / (totalDuration * 0.3)));

  const truncated =
    bubble.message.length > MAX_DISPLAY_LEN
      ? bubble.message.slice(0, MAX_DISPLAY_LEN) + '...'
      : bubble.message;

  return (
    <div style={{ ...bubbleStyle, opacity }} title={bubble.message}>
      <div style={nameStyle}>{bubble.agentName}</div>
      <div>{truncated}</div>
    </div>
  );
}

export function ChatBubbleLayer({ bubbles, agents }: ChatBubbleLayerProps) {
  return (
    <>
      {bubbles.map((bubble) => {
        const agent = agents.get(bubble.agentId);
        if (!agent) return null;

        return (
          <group key={bubble.id} position={[agent.targetX, 0, agent.targetZ]}>
            <Html position={[0, 2.4, 0]} center distanceFactor={15} zIndexRange={[100, 0]}>
              <BubbleContent bubble={bubble} />
            </Html>
          </group>
        );
      })}
    </>
  );
}
