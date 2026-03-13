# Agency

A persistent background server that simulates a living software development office populated by autonomous AI agents. You give the Office Manager a high-level goal, and a team of AI agents self-organize to build it — hiring developers, assigning tasks, writing code in real Git repos, opening pull requests, and managing blockers — all without your intervention.

Open `http://localhost:PORT` in a browser to watch the simulation unfold in a 3D office viewport. Agents physically walk to each other to communicate, sit at desks to code, and gather in meeting rooms for standups. You can click any agent to read their chat log, inspect their agentic sessions tool-by-tool, or send them a direct message.

## How It Works

1. Start the server from the command line. It runs continuously in the background.
2. The Office Manager agent wakes up on a sim-time schedule and evaluates the state of the world.
3. Based on the goal you've given it, the Office Manager creates projects (real Git repos), hires agents, forms teams, and delegates work.
4. Team Managers assign tasks, review pull requests, and handle blockers within their teams.
5. Individual agents walk to their desks, execute agentic coding sessions, and open PRs when done.
6. You observe everything through the 3D viewport and conversation logs. Intervene only if you want to.

Closing the browser doesn't stop anything. The simulation keeps running.

## Tech Stack

| Layer                        | Technology                         | Rationale                                                                                                               |
| ---------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Backend**                  | Node.js + TypeScript               | Single-language stack with the server, strong async I/O for managing concurrent agent sessions                          |
| **Frontend**                 | React + Vite                       | Fast dev iteration, component model fits the panel-heavy UI                                                             |
| **3D Rendering**             | React Three Fiber + Drei           | Declarative 3D in React, Drei provides camera controls, billboards, and HTML overlays out of the box                    |
| **Database**                 | SQLite via better-sqlite3          | Zero-config embedded database, single file, no external process, perfect for a local simulation                         |
| **Vector Search**            | sqlite-vss                         | Vector similarity search inside SQLite for agent memory retrieval without an external vector DB                         |
| **Embeddings**               | @xenova/transformers               | Runs embedding models locally in Node.js, no external API calls needed for memory compression                           |
| **Git Operations**           | simple-git                         | Lightweight Node.js wrapper around Git CLI for repo initialization, worktree management, and diff generation            |
| **Real-time Updates**        | WebSockets (ws)                    | Push agent state changes, sim time ticks, and live session events to the browser without polling                        |
| **Agent-to-World Interface** | MCP Server                         | Model Context Protocol server gives agents a structured tool-calling interface to interact with the simulation          |
| **Agentic Providers**        | Claude Agent SDK, OpenAI Codex API | Two supported providers for spawning autonomous coding sessions; neither requires API key input — auth is via local CLI |

## Key Architectural Decisions

**Physical presence is mandatory.** Agents cannot communicate without walking to each other. There is no message bus, no event emitter between agents, no pub/sub. If Agent A needs to talk to Agent B, Agent A physically moves through the office to Agent B's location. Meetings don't start until everyone has arrived. This is the core simulation mechanic and the primary source of emergent behavior.

**Sim time is the only time.** Every scheduled event, idle timeout, daily routine, and meeting duration runs on the simulation clock. The only real-world timer is the single `setInterval` that advances the sim clock. The user controls speed (1x–10x) and can pause/resume at any time.

**Managers are autonomous.** The Office Manager runs three planning sessions per sim day automatically. Team Managers react to task completions, blockers, and morning arrivals. No user input is required to keep the simulation moving. The user is only contacted for true external blockers like missing CLI authentication.

**No API keys in the app.** Both supported agentic providers (Claude Agent SDK, OpenAI Codex API) authenticate through their own CLI tools. Agency never asks for, stores, or transmits an API key.

**Agency never touches the code.** External Git repos where agents write code are entirely separate from Agency's codebase. Agency tracks metadata only — repo paths, branch names, PR status, diffs for display — but never reads or writes source code itself.

**Agents start with nothing.** A freshly hired agent has only their persona. No project knowledge, no codebase context, no awareness of other agents. Everything is learned through direct physical interaction with their Team Manager.

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd agency

# Install dependencies
pnpm install

# Start the development server
pnpm dev
```

The server starts on a configurable port (default 3000). Open `http://localhost:3000` in your browser.

### Prerequisites

- Node.js 20+
- pnpm 9+
- At least one agentic provider CLI authenticated:
  - **Claude**: Run `claude` in your terminal and complete the auth flow
  - **Codex**: Run `codex` in your terminal and complete the auth flow

## Project Structure

```
agency/
├── packages/
│   ├── server/          # Node.js backend: sim engine, MCP server, database, providers
│   └── client/          # React frontend: 3D viewport, panels, WebSocket client
├── DESIGN_DOC.md        # Full product and architecture specification
├── PHASES.md            # Granular phased implementation plan
├── NOTES.md             # Running log of implementation progress
└── README.md            # This file
```

## Documentation

- **[DESIGN_DOC.md](DESIGN_DOC.md)** — The authoritative specification. Read this to understand every system, constraint, and design decision in detail.
- **[PHASES.md](PHASES.md)** — The implementation plan broken into micro-phases with acceptance criteria.
- **[NOTES.md](NOTES.md)** — Progress log maintained by implementing agents.

## License

MIT
