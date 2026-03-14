# Agency

A persistent server that simulates a software development office run entirely by autonomous AI agents. Give the Office Manager a goal and watch as it hires developers, forms teams, assigns tasks, writes code in real Git repos, opens pull requests, and resolves blockers — all on its own.

Open `http://localhost:3001` to observe the simulation in a 3D viewport. Agents physically walk to each other to communicate, sit at desks to code, and gather in meeting rooms. Click any agent to inspect their work or send them a message.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- At least one agentic provider CLI authenticated:
  - **Claude** — run `claude` in your terminal and complete the auth flow
  - **Codex** — run `codex` in your terminal and complete the auth flow

### Install and Run

```bash
# Clone
git clone https://github.com/oobagi/agency.git
cd agency

# Install dependencies
pnpm install

# Start both server and client in dev mode
pnpm dev
```

Or without full git history:

```bash
npx degit oobagi/agency agency
cd agency
pnpm install
pnpm dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

### Production Build

```bash
pnpm build
pnpm start
```

### Health Check

```bash
curl http://localhost:3001/api/health
```

## How It Works

1. The **Office Manager** wakes up on a sim-time schedule and evaluates the world
2. It creates projects (real Git repos), hires agents from a persona pool, forms teams, and delegates work
3. **Team Managers** assign tasks, review PRs, and handle blockers within their teams
4. **Agents** walk to their desks, run agentic coding sessions via MCP tools, and open PRs when done
5. Failures escalate: Agent -> Team Manager -> Office Manager -> You (last resort)

Closing the browser doesn't stop anything. The simulation keeps running.

### Controls

- **Play / Pause** — freeze or resume the simulation
- **Speed** — 1x, 2x, 5x, or 10x sim time
- **Click an agent** — open their side panel (chat log, live sessions, details)
- **Conversations** — browse all office conversations
- **Projects** — view diffs, commits, and PRs
- **Schedule** — see the daily timeline and live activity feed

## Tech Stack

|                   |                                                               |
| ----------------- | ------------------------------------------------------------- |
| **Server**        | Node.js, TypeScript, SQLite (better-sqlite3), WebSockets (ws) |
| **Client**        | React, Vite, React Three Fiber, Drei                          |
| **AI**            | Claude Agent SDK, MCP Server, @huggingface/transformers       |
| **Git**           | simple-git (real repos, real worktrees, real merges)          |
| **Vector Search** | sqlite-vss (agent memory retrieval)                           |

## Project Structure

```
packages/
  server/     # Simulation engine, MCP server, providers, database
  client/     # 3D viewport, HUD, panels
docs/         # Architecture, API reference, schema, build log
```

## Documentation

| Doc                                              | Description                                        |
| ------------------------------------------------ | -------------------------------------------------- |
| [Architecture](docs/architecture.md)             | System design, module map, boot/shutdown sequences |
| [Agent System](docs/agents.md)                   | How agents think, move, communicate, and work      |
| [API Reference](docs/api-reference.md)           | REST endpoints, WebSocket events, MCP tools        |
| [Database Schema](docs/database.md)              | Full table definitions and migrations              |
| [Implementation Log](docs/implementation-log.md) | Phase-by-phase build history                       |

## Development

```bash
pnpm dev              # Start server + client in parallel
pnpm build            # Build both packages
pnpm lint             # ESLint across all packages
pnpm format           # Prettier format
pnpm format:check     # Check formatting
```

## License

MIT
