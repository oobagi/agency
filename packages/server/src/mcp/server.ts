import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type http from 'node:http';
import { z } from 'zod/v4';
import { TOOL_DEFINITIONS, MANAGER_ONLY_TOOLS, validateAgentPermission } from './tool-registry.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ---------- Create a fresh MCP server with all tools registered ----------

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'agency-world-server',
    version: '0.1.0',
  });

  for (const [toolName, def] of Object.entries(TOOL_DEFINITIONS)) {
    // Use .passthrough() so _agent_id (injected by provider abstraction) survives validation
    const schema =
      def.inputSchema instanceof z.ZodObject
        ? def.inputSchema.passthrough()
        : def.inputSchema;

    server.registerTool(
      toolName,
      { description: def.description, inputSchema: schema },
      createStubHandler(toolName),
    );
  }

  return server;
}

// Log once at startup
console.log(
  `MCP tools defined: ${Object.keys(TOOL_DEFINITIONS).length} total ` +
    `(${MANAGER_ONLY_TOOLS.size} manager-only)`,
);

// ---------- Stub handler factory ----------

function createStubHandler(
  toolName: string,
): (args: unknown) => Promise<CallToolResult> {
  return async (rawArgs: unknown): Promise<CallToolResult> => {
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    // Permission check: manager-only tools require _agent_id with a manager role.
    // In production (Phase 3.0+) the agent_id comes from session context.
    // For stubs, it can be passed as a top-level _agent_id field for testing.
    const agentId = args._agent_id as string | undefined;

    if (MANAGER_ONLY_TOOLS.has(toolName)) {
      if (!agentId) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Permission denied: tool "${toolName}" requires a manager role. No agent identity provided.`,
            },
          ],
        };
      }

      const check = validateAgentPermission(agentId, toolName);
      if (!check.allowed) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Permission denied: ${check.reason}` }],
        };
      }
    }

    console.log(`[MCP stub] ${toolName}(${JSON.stringify(args)})`);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            tool: toolName,
            status: 'stub',
            message: `Tool "${toolName}" called successfully (stub — not yet implemented).`,
            args,
          }),
        },
      ],
    };
  };
}

// ---------- StreamableHTTP session management ----------

const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

export async function handleMcpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const url = req.url ?? '';
  if (!url.startsWith('/mcp')) return false;

  const method = req.method ?? 'GET';
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (method === 'POST') {
    // Existing session — forward to its transport
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
      return true;
    }

    // New session — create transport + server
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);

    // handleRequest sets the transport's sessionId during the initialize exchange
    await transport.handleRequest(req, res);

    const newSessionId = transport.sessionId;
    if (newSessionId) {
      sessions.set(newSessionId, { transport, server: mcpServer });
      transport.onclose = () => {
        sessions.delete(newSessionId);
      };
    }

    return true;
  }

  if (method === 'GET') {
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found. POST to /mcp first.' }));
      return true;
    }
    await session.transport.handleRequest(req, res);
    return true;
  }

  if (method === 'DELETE') {
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (session) {
      await session.transport.handleRequest(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found.' }));
    }
    return true;
  }

  return false;
}

export function closeMcpSessions(): void {
  for (const [, session] of sessions) {
    session.server.close().catch(() => {});
  }
  sessions.clear();
}
