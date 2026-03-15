import { AgentCapsule } from './AgentCapsule';
import type { AgentRenderState } from '../hooks/useAgents';

interface AgentLayerProps {
  agents: Map<string, AgentRenderState>;
  selectedAgentId: string | null;
  highlightAgentId?: string | null;
  onAgentClick: (agentId: string) => void;
}

export function AgentLayer({
  agents,
  selectedAgentId,
  highlightAgentId,
  onAgentClick,
}: AgentLayerProps) {
  return (
    <>
      {[...agents.values()]
        .filter((a) => a.state !== 'Departing')
        .map((agent) => (
          <AgentCapsule
            key={agent.id}
            agent={agent}
            selected={agent.id === selectedAgentId}
            highlight={agent.id === highlightAgentId}
            onClick={onAgentClick}
          />
        ))}
    </>
  );
}
