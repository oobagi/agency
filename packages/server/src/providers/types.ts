// ---------- Session events ----------

export type SessionEventType =
  | 'tool_call_start'
  | 'tool_call_complete'
  | 'session_complete'
  | 'session_error';

export interface ToolCallStartData {
  toolUseId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolCallCompleteData {
  toolUseId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export interface SessionCompleteData {
  result: string;
  durationMs: number;
  numTurns: number;
  totalCostUsd: number;
  tokenEstimate: number;
}

export interface SessionErrorData {
  errors: string[];
  durationMs: number;
}

export interface SessionEvent {
  type: SessionEventType;
  sessionId: string;
  agentId: string;
  timestamp: string;
  data: ToolCallStartData | ToolCallCompleteData | SessionCompleteData | SessionErrorData;
}

// ---------- Session config ----------

export interface SessionConfig {
  agentId: string;
  systemPrompt: string;
  context: string;
  mcpTools: string[];
  provider: string;
  model: string;
}

// ---------- Session ----------

export interface Session {
  id: string;
  agentId: string;
  events: AsyncIterable<SessionEvent>;
  abort: () => void;
}

// ---------- Provider interface ----------

export interface AgenticProvider {
  readonly name: string;
  spawnSession(config: SessionConfig): Promise<Session>;
  interruptSession(sessionId: string): Promise<void>;
}
