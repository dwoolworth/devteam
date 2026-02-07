# DevTeam

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple)](https://modelcontextprotocol.io)
[![Go](https://img.shields.io/badge/Go-1.23+-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)

Design, generate, and deploy autonomous AI development teams. Five configurable roles -- Product Owner, Developer, Code Quality, QA, and DevOps -- collaborate through a shared communication layer, follow a strict ticket lifecycle, and drive code from backlog to production.

Teams are designed conversationally through an **MCP server** integrated with Claude Code. Choose personality archetypes, tune traits, assign AI providers, and deploy -- all through natural language.

No direct bot-to-bot communication. No shared memory. No shortcuts. Just a disciplined team that follows process.

## How It Works

Every AI persona runs in its own Docker container. They communicate exclusively through a central **Meeting Board** and track work on a **Project Board**. This is the cardinal rule: if it didn't happen on the board, it didn't happen.

```
                    ┌─────────────────────────────────────────────┐
                    │          DevTeam Network (Bridge)           │
                    │                                             │
                    │  ┌────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌─────┐  │
                    │  │ PO │ │ DEV  │ │  CQ  │ │  QA  │ │ OPS │  │
                    │  │    │ │      │ │      │ │      │ │     │  │
                    │  └──┬─┘ └──┬───┘ └──┬───┘ └──┬───┘ └──┬──┘  │
                    │     │      │        │        │        │     │
                    │     └──────┴────────┴────────┴────────┘     │
                    │                     │                       │
                    │                     ▼                       │
                    │    ┌───────────────────────────────────┐    │
                    │    │     Meeting Board (Go) :8080      │    │
                    │    │   REST · WebSocket · Dashboard    │    │
                    │    └────────────────┬──────────────────┘    │
                    │                     │                       │
                    │                     ▼                       │
                    │    ┌───────────────────────────────────┐    │
                    │    │  Project Board (Node.js) :8088    │    │
                    │    │  Tickets · Comments · Kanban UI   │    │
                    │    └────────────────┬──────────────────┘    │
                    │                     │                       │
                    │                     ▼                       │
                    │    ┌───────────────────────────────────┐    │
                    │    │         MongoDB :27017            │    │
                    │    └───────────────────────────────────┘    │
                    └─────────────────────────────────────────────┘
```

## The Team

Agent names, AI providers, and personalities are fully configurable through `team.yml`. The five **roles** are fixed:

| Role | Soul Title | What They Do |
|------|------------|-------------|
| **PO** | The Boss / The Enforcer | Collaborates with humans, owns the vision, writes acceptance criteria, assigns work, enforces process |
| **DEV** | The Builder | Writes code, runs tests in Docker, creates PRs, iterates on feedback |
| **CQ** | The Gatekeeper | Reviews every PR for security, quality, and maintainability |
| **QA** | The Validator | Tests against acceptance criteria with Playwright and curl |
| **OPS** | The Deployer | Deploys releases, manages infrastructure, always has a rollback plan |

Each agent gets a **personality archetype** (Commander, Craftsperson, Sentinel, Detective, etc.) with 14 tunable traits like assertiveness, thoroughness, humor, and patience. These shape how agents communicate, review code, handle failure, and interact with the team. See [ARCHITECTURE.md](docs/ARCHITECTURE.md#personality-system) for the full archetype and trait reference.

## The Ticket Lifecycle

This is THE LAW. Every persona understands it. PO enforces it every 15 minutes.

```
backlog → todo → in-progress → in-review → in-qa → completed → rfp → closed
                       ↑            |          |
                       |   CQ fails | QA fails |
                       +------------+----------+
                         Back to in-progress
```

There are no shortcuts. When QA fails a ticket, it goes back through the **full pipeline** -- DEV fixes, CQ re-reviews, QA re-tests. Every time.

**DEV priority order:**
1. Merge first -- completed tickets waiting for merge
2. Fix bugs second -- tickets rejected by CQ or QA
3. New work last -- pick from TODO

### The Quinn Problem

Named after an early bug in the system: QA would write a detailed failure comment but forget to change the ticket status. The board looked fine, but work had silently stalled.

PO now detects this every heartbeat -- scanning for tickets with failure comments but unchanged status -- and publicly calls it out. Comment AND status change, always, every time.

## Why This Architecture

Most multi-agent AI systems let agents talk directly to each other. This creates invisible side channels, makes debugging impossible, and produces systems that fail in unpredictable ways.

DevTeam takes a different approach:

- **No direct communication** -- Every interaction goes through the Meeting Board. If it's not there, it didn't happen.
- **Complete auditability** -- Every message, every status change, every decision is in MongoDB with a full audit trail.
- **Decoupled personas** -- Any agent can be restarted, replaced, or scaled without affecting the others.
- **Real testing** -- QA uses actual Playwright with headless Chromium, not simulated test results. Screenshots saved as evidence.
- **Provider-agnostic** -- The architecture doesn't care which LLM powers each persona. Swap providers without rebuilding.

## Quick Start

### MCP-Driven Setup (Recommended)

The fastest path uses the MCP server with Claude Code to design and deploy your team conversationally.

```bash
git clone https://github.com/dwoolworth/devteam.git
cd devteam
cd mcp && npm install && cd ..
```

Add the MCP server to your Claude Code config (`.mcp.json` in the project root):

```json
{
  "mcpServers": {
    "devteam": {
      "type": "stdio",
      "command": "node",
      "args": ["<absolute-path-to>/devteam/mcp/index.js"]
    }
  }
}
```

Then in Claude Code, design your team through conversation:

```
"Set up a project called my-app with a Go backend, React frontend, and PostgreSQL"
"Add a PO named Piper with the commander archetype, using xai/grok-3"
"Add a developer named Devon with the craftsperson archetype, boost initiative to 85"
"Add a code reviewer named Carmen as sentinel, using anthropic/claude-sonnet-4-20250514"
"Preview Carmen's personality"
"Generate the team"
"Deploy"
```

The MCP server handles `team.yml` creation, artifact generation, Docker Compose files, and deployment. See [QUICKSTART.md](docs/QUICKSTART.md) for the full walkthrough.

### Manual Setup

```bash
git clone https://github.com/dwoolworth/devteam.git
cd devteam
cp .env.example .env    # Edit with your API keys
make build && make up
```

See [QUICKSTART.md](docs/QUICKSTART.md#path-2-manual-setup-legacy) for detailed manual setup instructions.

## Design Decisions

### Personality System

Each agent's personality is built from an **archetype** (10 presets: Commander, Diplomat, Craftsperson, Maverick, Sentinel, Hustler, Mentor, Detective, Operator, Wildcard) and **14 tunable traits** (assertiveness, empathy, thoroughness, etc. scored 0-100). The archetype provides baseline trait values; individual traits can be overridden per agent. This resolves into narrative personality text in the agent's SOUL.md and IDENTITY.md files.

### 3-Layer Config Merge

Every persona container builds configuration in three layers:

1. **Base config** -- Baked into the Ubuntu 24.04 base image (shared defaults)
2. **Persona config** -- Copied during persona image build (role-specific identity, skills)
3. **Runtime overrides** -- Volume-mounted at container start (environment injection)

This lets you customize any persona without rebuilding images.

### Meeting Board (Go)

Central communication hub with REST API, WebSocket real-time updates, and an embedded dashboard. Channels: standup, planning, review, retrospective, ad-hoc. Every message is attributed to an authenticated persona -- bots cannot impersonate each other.

### Project Board (Node.js)

Kanban-style ticket management with MongoDB persistence. Auto-seeds agent accounts on first startup. Bearer token auth for API access. Human-friendly UI at port 8088.

### Persona Boundaries

Each persona has explicit rules about what they can and cannot do:

- **PO** does NOT write code, review code, or deploy
- **DEV** does NOT self-assign tickets or approve their own code
- **CQ** does NOT write feature code or deploy
- **QA** does NOT write code or review code
- **OPS** does NOT review code or test features

## Services

The generated Docker Compose file includes infrastructure services and one container per agent defined in `team.yml`. Agent names, ports, and providers vary by team configuration.

| Service | Port | Purpose |
|---------|------|---------|
| MongoDB | -- | Shared persistence |
| Meeting Board | 8080 | Communication hub + dashboard |
| Project Board | 8088 | Ticket management UI + API |
| Router | -- | WebSocket message routing to agents |
| Agent containers | 18790+ | One per agent, incrementing from base_port |

## Documentation

- **[QUICKSTART.md](docs/QUICKSTART.md)** -- Dual-path setup: MCP-driven or manual
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** -- Deep dive into system design, personality system, MCP server, and the ticket lifecycle
- **[EXTENDING.md](docs/EXTENDING.md)** -- Customize through MCP or manual configuration

## Kubernetes

Kustomize-based manifests in `k8s/` for production deployment. The `generate` tool can also produce K8s manifests directly from `team.yml` by setting the platform target to `kubernetes`.

```bash
make k8s-apply     # Deploy to cluster
make k8s-status    # Check status
```

## Contributing

Contributions welcome. Open an issue or submit a PR.

## License

MIT -- see [LICENSE](LICENSE).
