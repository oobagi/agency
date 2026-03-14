# Agency

Persistent background server simulating a living software dev office with autonomous AI agents.

## Quick Reference

- **Monorepo**: pnpm workspace with `packages/server` and `packages/client`
- **Dev**: `pnpm dev` (runs both packages in parallel)
- **Build**: `pnpm build` or `pnpm --filter @agency/server build`
- **Lint**: `pnpm lint` (ESLint across all packages)
- **Format**: `pnpm format` (Prettier) / `pnpm format:check`
- **Server port**: 3001 (configurable via PORT env var)
- **Client**: Vite dev server proxies `/api` and `/ws` to server
- **Status**: Feature-complete and hardened (all phases 1.0-8.1 done)

## Hard Constraints

These are non-negotiable. Code violating any of these is wrong.

1. **No API keys anywhere.** Auth is handled by provider CLIs (Claude Code, Codex). Never accept, store, or transmit keys.
2. **Agency never touches external repos.** Only track metadata (paths, branches, PR status). Never read/write source code in agent project repos.
3. **Physical presence required for all communication.** No event emitters, pub/sub, or message buses between agents. Agents must physically walk to each other. No exceptions.
4. **Managers are autonomous.** They run on sim-time schedules, not user input.
5. **Failures escalate through hierarchy.** Agent -> Team Manager -> Office Manager -> User. User is last resort.
6. **New agents know nothing.** Only their persona. Knowledge comes from physical interaction with managers.
7. **Agents never merge their own work.** All work goes through PRs. Team Manager reviews and merges.
8. **UI is a 3D viewport.** No global text input. User clicks agents to interact.

## Architecture

- **Database**: SQLite via better-sqlite3 (WAL mode, foreign keys ON). `getDb()` from `packages/server/src/db.js`
- **Sim Clock**: `SimClock` class is the sole time source. All game mechanics use sim time, never `Date.now()`
- **Migrations**: TypeScript modules in `packages/server/src/migrations/`. Register in `migrations/index.ts`
- **Agent SDK**: All LLM calls must use Agent SDK `query()`. Never use raw Anthropic SDK directly.
- **Lightweight LLM calls**: Use `query()` with model haiku, maxTurns 1, allowedTools empty, persistSession false.

## Coding Standards

- TypeScript strict mode in both packages
- 2-space indentation, single quotes, trailing commas, 100 char print width
- Prefix unused params with `_` (e.g., `_req`)
- Use `.js` extensions in imports (Node16 module resolution)
- Prefer `node:` prefix for Node.js built-ins (e.g., `node:http`)

## Documentation

- @docs/architecture.md — System architecture, module map, boot/shutdown sequences, key implementation details
- @docs/agents.md — Agent hierarchy, autonomy, communication, sessions, memory, escalation
- @docs/api-reference.md — All REST endpoints, WebSocket events, and MCP tools
- @docs/database.md — Full table schemas and migrations
- @docs/implementation-log.md — Phase-by-phase implementation history with decisions and issues
