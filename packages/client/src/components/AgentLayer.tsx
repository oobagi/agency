import { AgentCapsule } from './AgentCapsule';
import type { AgentRenderState } from '../hooks/useAgents';

interface AgentLayerProps {
  agents: Map<string, AgentRenderState>;
  selectedAgentId: string | null;
  onAgentClick: (agentId: string) => void;
}

export function AgentLayer({ agents, selectedAgentId, onAgentClick }: AgentLayerProps) {
  return (
    <>
      {[...agents.values()].map((agent) => (
        <AgentCapsule
          key={agent.id}
          agent={agent}
          selected={agent.id === selectedAgentId}
          onClick={onAgentClick}
        />
      ))}
    </>
  );
}
