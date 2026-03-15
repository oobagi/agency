import { query, createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk';
import type { Query, SDKMessage, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import crypto from 'node:crypto';
import { z as z3 } from 'zod';
import {
  TOOL_DEFINITIONS,
  MANAGER_ONLY_TOOLS,
  validateAgentPermission,
} from '../mcp/tool-registry.js';
import type {
  AgenticProvider,
  Session,
  SessionConfig,
  SessionEvent,
  ToolCallStartData,
  ToolCallCompleteData,
  SessionCompleteData,
  SessionErrorData,
} from './types.js';

// The MCP server name used in tool prefixes (mcp__agency__<tool_name>)
const MCP_SERVER_NAME = 'agency';

/**
 * Build a Zod v3 shape from a Zod v4 schema.
 * The Agent SDK's tool() helper requires Zod v3 (with safeParseAsync).
 * We extract field names and types from the v4 schema and rebuild in v3.
 */
function buildZod3Shape(schema: unknown): Record<string, z3.ZodTypeAny> {
  // Try to extract shape from a ZodObject-like schema
  const s = schema as {
    shape?: Record<string, { _def?: { typeName?: string }; description?: string }>;
  };
  if (!s?.shape) return {};

  const v3Shape: Record<string, z3.ZodTypeAny> = {};
  for (const [key, fieldSchema] of Object.entries(s.shape)) {
    const typeName = fieldSchema?._def?.typeName ?? '';
    const desc = fieldSchema?.description;

    // Map common Zod v4 types to Zod v3 equivalents
    let v3Field: z3.ZodTypeAny;
    if (typeName.includes('Enum')) {
      v3Field = z3.string();
    } else if (typeName.includes('Number') || typeName.includes('Int')) {
      v3Field = z3.number();
    } else if (typeName.includes('Boolean')) {
      v3Field = z3.boolean();
    } else if (typeName.includes('Record') || typeName.includes('Object')) {
      v3Field = z3.record(z3.string(), z3.unknown());
    } else {
      v3Field = z3.string();
    }

    // Check if the field is optional in v4
    if (typeName.includes('Optional')) {
      v3Field = z3.string().optional();
    }

    if (desc) v3Field = v3Field.describe(desc) as z3.ZodTypeAny;
    v3Shape[key] = v3Field;
  }

  return v3Shape;
}

export class ClaudeAgentSdkProvider implements AgenticProvider {
  readonly name = 'claude_agent_sdk';
  private activeQueries = new Map<string, Query>();

  async spawnSession(config: SessionConfig): Promise<Session> {
    const sessionId = crypto.randomUUID();
    // System prompt = persona + context (rich background for the LLM)
    const systemPrompt = config.context
      ? `${config.systemPrompt}\n\n${config.context}`
      : config.systemPrompt;

    // User-facing prompt = short instruction to act on the context
    const userPrompt =
      'Review your context above and take appropriate action. Use the tools available to you to complete your work.';

    // Build the list of allowed MCP tools with the mcp__agency__ prefix
    const allowedMcpTools = config.mcpTools.map((t) => `mcp__${MCP_SERVER_NAME}__${t}`);

    // Create an in-process MCP server with the tools this session can access.
    // We use createSdkMcpServer so the Agent SDK can call our tools in-process
    // without needing an HTTP roundtrip.
    const mcpServer = this.buildMcpServer(config);

    const q = query({
      prompt: userPrompt,
      options: {
        model: config.model,
        systemPrompt,
        mcpServers: {
          [MCP_SERVER_NAME]: mcpServer as McpServerConfig,
        },
        allowedTools: allowedMcpTools,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        maxTurns: 50,
      },
    });

    this.activeQueries.set(sessionId, q);

    return {
      id: sessionId,
      agentId: config.agentId,
      events: this.streamToEvents(sessionId, config.agentId, q),
      abort: () => {
        q.close();
        this.activeQueries.delete(sessionId);
      },
    };
  }

  async interruptSession(sessionId: string): Promise<void> {
    const q = this.activeQueries.get(sessionId);
    if (q) {
      await q.interrupt();
      this.activeQueries.delete(sessionId);
    }
  }

  // Build an in-process MCP server for the Agent SDK with permission-checked tool handlers
  private buildMcpServer(config: SessionConfig) {
    const toolDefs = config.mcpTools
      .map((name) => {
        const def = TOOL_DEFINITIONS[name];
        if (!def) return null;
        return { name, def };
      })
      .filter(Boolean) as Array<{ name: string; def: (typeof TOOL_DEFINITIONS)[string] }>;

    const tools = toolDefs.map(({ name, def }) => {
      // The Agent SDK's tool() uses Zod v3 internally (safeParseAsync).
      // Our tool registry uses Zod v4, so we rebuild a Zod v3 passthrough schema.
      const v3Shape = buildZod3Shape(def.inputSchema);

      return sdkTool(name, def.description, v3Shape, async (args: Record<string, unknown>) => {
        // Permission check for manager-only tools
        if (MANAGER_ONLY_TOOLS.has(name)) {
          const check = validateAgentPermission(config.agentId, name);
          if (!check.allowed) {
            return {
              content: [{ type: 'text' as const, text: `Permission denied: ${check.reason}` }],
            };
          }
        }

        // Delegate to the MCP server handler registry
        // (which routes to real handlers or stubs via mcp/server.ts)
        const handler = this.getToolHandler(name, config.agentId);
        return handler(args);
      });
    });

    return createSdkMcpServer({
      name: MCP_SERVER_NAME,
      version: '0.1.0',
      tools,
    });
  }

  private getToolHandler(
    toolName: string,
    agentId: string,
  ): (
    args: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    return async (args: Record<string, unknown>) => {
      const { dispatchToolCall } = await import('../mcp/server.js');
      const result = await dispatchToolCall(toolName, { ...args, _agent_id: agentId });
      // Narrow content to text-only blocks for the SDK tool interface
      const textContent = result.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => ({ type: 'text' as const, text: b.text }));
      return { content: textContent };
    };
  }

  private async *streamToEvents(
    sessionId: string,
    agentId: string,
    q: Query,
  ): AsyncGenerator<SessionEvent> {
    try {
      for await (const message of q as AsyncIterable<SDKMessage>) {
        const events = this.messageToEvents(sessionId, agentId, message);
        for (const event of events) {
          yield event;
        }
      }
    } catch (err) {
      yield {
        type: 'session_error',
        sessionId,
        agentId,
        timestamp: new Date().toISOString(),
        data: {
          errors: [err instanceof Error ? err.message : String(err)],
          durationMs: 0,
        } satisfies SessionErrorData,
      };
    } finally {
      this.activeQueries.delete(sessionId);
    }
  }

  private messageToEvents(sessionId: string, agentId: string, message: SDKMessage): SessionEvent[] {
    const events: SessionEvent[] = [];
    const ts = new Date().toISOString();

    if (message.type === 'assistant') {
      // Extract tool_use blocks from the assistant message
      const toolUseBlocks = (message.message?.content ?? []).filter(
        (block: { type: string }) => block.type === 'tool_use',
      ) as Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>;

      for (const block of toolUseBlocks) {
        events.push({
          type: 'tool_call_start',
          sessionId,
          agentId,
          timestamp: ts,
          data: {
            toolUseId: block.id,
            toolName: block.name,
            args: block.input,
          } satisfies ToolCallStartData,
        });
      }
    }

    if (
      message.type === 'user' &&
      message.tool_use_result !== null &&
      message.tool_use_result !== undefined
    ) {
      // This is a tool result message
      const result = message.tool_use_result;
      events.push({
        type: 'tool_call_complete',
        sessionId,
        agentId,
        timestamp: ts,
        data: {
          toolUseId: message.parent_tool_use_id ?? '',
          toolName: '',
          result,
          isError: false,
        } satisfies ToolCallCompleteData,
      });
    }

    if (message.type === 'result') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultMsg = message as any;
      if (resultMsg.subtype === 'success') {
        events.push({
          type: 'session_complete',
          sessionId,
          agentId,
          timestamp: ts,
          data: {
            result: resultMsg.result ?? '',
            durationMs: resultMsg.duration_ms,
            numTurns: resultMsg.num_turns,
            totalCostUsd: resultMsg.total_cost_usd,
            tokenEstimate:
              (resultMsg.usage?.input_tokens ?? 0) + (resultMsg.usage?.output_tokens ?? 0),
          } satisfies SessionCompleteData,
        });
      } else {
        events.push({
          type: 'session_error',
          sessionId,
          agentId,
          timestamp: ts,
          data: {
            errors: resultMsg.errors ?? [resultMsg.subtype],
            durationMs: resultMsg.duration_ms,
          } satisfies SessionErrorData,
        });
      }
    }

    return events;
  }
}
