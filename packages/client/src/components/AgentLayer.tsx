import { AgentCapsule } from './AgentCapsule';
import type { AgentRenderState } from '../hooks/useAgents';

interface AgentLayerProps {
  agents: Map<string, AgentRenderState>;
}

export function AgentLayer({ agents }: AgentLayerProps) {
  return (
    <>
      {[...agents.values()].map((agent) => (
        <AgentCapsule key={agent.id} agent={agent} />
      ))}
    </>
  );
}
