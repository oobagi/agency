import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Lightweight LLM call for summaries, briefings, and other non-agentic tasks.
 * Uses Haiku model, no tools, single turn, no session persistence.
 */
export async function lightweightQuery(prompt: string): Promise<string> {
  const q = query({
    prompt,
    options: {
      model: 'claude-haiku-4-5-20251001',
      maxTurns: 1,
      allowedTools: [],
      disallowedTools: ['*'],
      persistSession: false,
    },
  });

  let result = '';
  for await (const message of q as AsyncIterable<SDKMessage>) {
    if (message.type === 'result' && message.subtype === 'success') {
      result = message.result;
    }
  }

  return result;
}
