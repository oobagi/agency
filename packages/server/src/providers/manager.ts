import { getDb } from '../db.js';
import { ClaudeAgentSdkProvider } from './claude-agent-sdk.js';
import { CodexProvider } from './codex.js';
import type { AgenticProvider } from './types.js';

const providers: Record<string, AgenticProvider> = {
  claude_agent_sdk: new ClaudeAgentSdkProvider(),
  codex: new CodexProvider(),
};

export class ProviderManager {
  /**
   * Get the provider for a given agent.
   * Checks per-agent overrides first, then falls back to the default from settings.
   */
  getProvider(agentId: string): AgenticProvider {
    const db = getDb();

    // Check per-agent override
    const agent = db
      .prepare('SELECT provider_override FROM agents WHERE id = ?')
      .get(agentId) as { provider_override: string | null } | undefined;

    if (agent?.provider_override) {
      const override = providers[agent.provider_override];
      if (override) return override;
      console.warn(
        `[provider] Agent ${agentId} has unknown provider_override "${agent.provider_override}", using default`,
      );
    }

    return this.getDefaultProvider();
  }

  /**
   * Get the model for a given agent.
   * Checks per-agent overrides first, then falls back to the default from settings.
   */
  getModel(agentId: string): string {
    const db = getDb();

    const agent = db
      .prepare('SELECT model_override FROM agents WHERE id = ?')
      .get(agentId) as { model_override: string | null } | undefined;

    if (agent?.model_override) return agent.model_override;
    return this.getDefaultModel();
  }

  getDefaultProvider(): AgenticProvider {
    const db = getDb();
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'default_provider'")
      .get() as { value: string } | undefined;

    const name = row ? JSON.parse(row.value) : 'claude_agent_sdk';
    return providers[name] ?? providers.claude_agent_sdk;
  }

  getDefaultModel(): string {
    const db = getDb();
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'default_model'")
      .get() as { value: string } | undefined;

    return row ? JSON.parse(row.value) : 'claude-sonnet-4-20250514';
  }

  /** List all available provider names */
  listProviders(): string[] {
    return Object.keys(providers);
  }
}

// Singleton
export const providerManager = new ProviderManager();
