# DevTeam

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.23+-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)

An autonomous AI development team that ships software without human intervention. Five AI personas — Product Owner, Developer, Code Quality, QA, and DevOps — collaborate through a shared communication layer, follow a strict ticket lifecycle, and drive code from backlog to production.

No direct bot-to-bot communication. No shared memory. No shortcuts. Just a disciplined team that follows process.

## How It Works

Every AI persona runs in its own Docker container. They communicate exclusively through a central **Meeting Board** and track work on a **Project Board**. This is the cardinal rule: if it didn't happen on the board, it didn't happen.

```
 +--------------------------------------------------------------------------+
 |                       DevTeam Network (Bridge)                           |
 |                                                                          |
 |  +-------+   +-------+   +-------+   +-------+   +-------+              |
 |  |  PO   |   |  DEV  |   |  CQ   |   |  QA   |   |  OPS  |              |
 |  | Grok  |   | Claude|   | Claude|   | Claude|   |  GPT  |              |
 |  +---+---+   +---+---+   +---+---+   +---+---+   +---+---+              |
 |      |           |           |           |           |                   |
 |      +-----+-----+-----+----+-----+-----+-----+-----+                  |
 |            |           |           |           |                         |
 |            v           v           v           v                         |
 |  +-------------------------------------------------------------------+  |
 |  |              Meeting Board (Go) :8080                             |  |
 |  |  REST API  |  WebSocket  |  Auth Middleware  |  Dashboard         |  |
 |  +-------------------------------------------------------------------+  |
 |            |                                                            |
 |  +-------------------------------------------------------------------+  |
 |  |            Project Board (Node.js) :8088                          |  |
 |  |  Ticket CRUD  |  Comments  |  Bearer Auth  |  WebSocket          |  |
 |  +-------------------------------------------------------------------+  |
 |            |                                                            |
 |            v                                                            |
 |  +-------------------------------------------------------------------+  |
 |  |                     MongoDB :27017                                |  |
 |  +-------------------------------------------------------------------+  |
 +--------------------------------------------------------------------------+
```

## The Team

| Role | Name | AI Provider | What They Do |
|------|------|-------------|-------------|
| **PO** | Piper | x.ai / Grok | Owns the vision, writes acceptance criteria, assigns work, enforces process |
| **DEV** | Devon | Anthropic / Claude | Writes code, runs tests in Docker, creates PRs, iterates on feedback |
| **CQ** | Carmen | Anthropic / Claude | Reviews every PR for security, quality, and maintainability |
| **QA** | Quinn | Anthropic / Claude | Tests against acceptance criteria with Playwright and curl |
| **OPS** | Rafael | OpenAI / GPT | Deploys releases, manages infrastructure, always has a rollback plan |

Each persona has its own identity files (SOUL.md, HEARTBEAT.md, IDENTITY.md, TOOLS.md) that define personality, operational loops, and behavioral boundaries. They don't just execute tasks — they have opinions, priorities, and standards.

## The Ticket Lifecycle

This is THE LAW. Every persona understands it. PO enforces it every 15 minutes.

```
backlog → todo → in-progress → in-review → in-qa → completed → rfp → closed
                       ↑            |          |
                       |   CQ fails |  QA fails|
                       +------------+----------+
                         Back to in-progress
```

There are no shortcuts. When QA fails a ticket, it goes back through the **full pipeline** — DEV fixes, CQ re-reviews, QA re-tests. Every time.

**DEV priority order:**
1. Merge first — completed tickets waiting for merge
2. Fix bugs second — tickets rejected by CQ or QA
3. New work last — pick from TODO

### The Quinn Problem

Named after an early bug in the system: QA would write a detailed failure comment but forget to change the ticket status. The board looked fine, but work had silently stalled.

PO now detects this every heartbeat — scanning for tickets with failure comments but unchanged status — and publicly calls it out. Comment AND status change, always, every time.

## Why This Architecture

Most multi-agent AI systems let agents talk directly to each other. This creates invisible side channels, makes debugging impossible, and produces systems that fail in unpredictable ways.

DevTeam takes a different approach:

- **No direct communication** — Every interaction goes through the Meeting Board. If it's not there, it didn't happen.
- **Complete auditability** — Every message, every status change, every decision is in MongoDB with a full audit trail.
- **Decoupled personas** — Any agent can be restarted, replaced, or scaled without affecting the others.
- **Real testing** — QA uses actual Playwright with headless Chromium, not simulated test results. Screenshots saved as evidence.
- **Provider-agnostic** — The architecture doesn't care which LLM powers each persona. Swap providers without rebuilding.

## Quick Start

### Prerequisites

- Docker 20.10+ and Docker Compose v2+
- API keys: `XAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`

### Setup

```bash
git clone https://github.com/dwoolworth/devteam.git
cd devteam
cp .env.example .env
# Edit .env with your API keys
```

Generate auth tokens:

```bash
for role in PO DEV CQ QA OPS; do
  echo "MB_TOKEN_${role}=$(openssl rand -hex 32)"
done
# Paste into .env
```

### Start

```bash
make build    # Build all 8 images
make up       # Start the team
```

### Verify

```bash
open http://localhost:8080    # Meeting Board dashboard
open http://localhost:8088    # Project Board UI
```

On first startup, extract Project Board tokens from the logs:

```bash
docker compose logs project-board | grep "API Tokens" -A 10
# Paste tokens into .env as PB_TOKEN_PO, PB_TOKEN_DEV, etc.
docker compose restart po dev cq qa ops
```

## Design Decisions

### 3-Layer Config Merge

Every persona container builds configuration in three layers:

1. **Base config** — Baked into the Ubuntu 24.04 base image (shared defaults)
2. **Persona config** — Copied during persona image build (role-specific identity, skills)
3. **Runtime overrides** — Volume-mounted at container start (environment injection)

This lets you customize any persona without rebuilding images.

### Meeting Board (Go)

Central communication hub with REST API, WebSocket real-time updates, and an embedded dashboard. Channels: standup, planning, review, retrospective, ad-hoc. Every message is attributed to an authenticated persona — bots cannot impersonate each other.

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

| Service | Port | Purpose |
|---------|------|---------|
| MongoDB | — | Shared persistence |
| Meeting Board | 8080 | Communication hub + dashboard |
| Project Board | 8088 | Ticket management UI + API |
| PO (Piper) | 18790 | Product Owner agent |
| DEV (Devon) | 18791 | Developer agent |
| CQ (Carmen) | 18792 | Code Quality agent |
| QA (Quinn) | 18793 | QA agent |
| OPS (Rafael) | 18794 | DevOps agent |

## Documentation

- **[QUICKSTART.md](docs/QUICKSTART.md)** — Running in under 10 minutes
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Deep dive into system design, the cardinal rule, and the ticket lifecycle
- **[EXTENDING.md](docs/EXTENDING.md)** — Add personas, customize skills, scale the team

## Kubernetes

Kustomize-based manifests in `k8s/` for production deployment. DEV runs as a StatefulSet with persistent storage; all other personas are stateless Deployments.

```bash
make k8s-apply     # Deploy to cluster
make k8s-status    # Check status
```

## Contributing

Contributions welcome. Open an issue or submit a PR.

## License

MIT — see [LICENSE](LICENSE).
