import crypto from 'node:crypto';
import type {
  AgenticProvider,
  Session,
  SessionConfig,
  SessionEvent,
  SessionErrorData,
} from './types.js';

/**
 * Codex provider placeholder.
 *
 * Implements the AgenticProvider interface so the system compiles and
 * ProviderManager can return it, but spawning a session currently returns
 * a single session_error event indicating that Codex is not yet wired up.
 *
 * The real implementation will wrap the OpenAI Codex CLI/API once it is
 * integrated (tracked for a future phase).
 */
export class CodexProvider implements AgenticProvider {
  readonly name = 'codex';

  async spawnSession(config: SessionConfig): Promise<Session> {
    const sessionId = crypto.randomUUID();

    async function* events(): AsyncGenerator<SessionEvent> {
      yield {
        type: 'session_error',
        sessionId,
        agentId: config.agentId,
        timestamp: new Date().toISOString(),
        data: {
          errors: ['Codex provider is not yet implemented.'],
          durationMs: 0,
        } satisfies SessionErrorData,
      };
    }

    return {
      id: sessionId,
      agentId: config.agentId,
      events: events(),
      abort: () => {},
    };
  }

  async interruptSession(_sessionId: string): Promise<void> {
    // No-op — no active sessions to interrupt
  }
}
