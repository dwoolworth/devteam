# DevTeam

A containerized autonomous AI development team. Five AI personas — Product Owner, Developer, Code Quality, QA, and DevOps — collaborate through a shared Meeting Board and Project Board, following a strict ticket lifecycle to ship software without human intervention.

## The Team

| Role | Name   | AI Provider       | Email                | What They Do |
|------|--------|-------------------|----------------------|-------------|
| PO   | Piper  | x.ai / Grok       | piper@devteam.local  | Owns vision, assigns work, enforces the ticket lifecycle |
| DEV  | Devon  | Anthropic / Claude | devon@devteam.local  | Writes code, runs tests, creates PRs, merges after QA pass |
| CQ   | Carmen | Anthropic / Claude | carmen@devteam.local | Reviews code for security, quality, and maintainability |
| QA   | Quinn  | Anthropic / Claude | quinn@devteam.local  | Tests against acceptance criteria with Playwright and curl |
| OPS  | Rafael | OpenAI / GPT       | rafael@devteam.local | Deploys releases, manages infrastructure |

## Architecture

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
 |  |            Project Board (Node.js) :3000                          |  |
 |  |  Ticket CRUD  |  Comments  |  Bearer Auth  |  WebSocket          |  |
 |  +-------------------------------------------------------------------+  |
 |            |                                                            |
 |            v                                                            |
 |  +-------------------------------------------------------------------+  |
 |  |                     MongoDB :27017                                |  |
 |  |            meetingboard DB  |  taskboard DB                       |  |
 |  +-------------------------------------------------------------------+  |
 +--------------------------------------------------------------------------+
```

**Cardinal Rule:** No persona ever communicates directly with another persona. All bot-to-bot communication flows through the Meeting Board.

## Ticket Lifecycle (THE LAW)

```
backlog → todo → in-progress → in-review → in-qa → completed → rfp → closed
                       ↑            |          |
                       |   CQ fails |  QA fails|
                       +------------+----------+
                         Back to in-progress
```

| Column      | Who Moves Here | Trigger |
|-------------|---------------|---------|
| Backlog     | PO            | Ticket created |
| TODO        | PO            | Prioritized, acceptance criteria written, assigned |
| In Progress | DEV           | Work started (or pushed back from CQ/QA) |
| In Review   | DEV           | PR submitted, ready for code review |
| In QA       | CQ            | Code review passed |
| Completed   | QA            | All acceptance criteria verified |
| RFP         | DEV           | PR merged to main |
| Closed      | PO            | Deployed to production |

### DEV Priority Order

1. **Merge first** — Check Completed for tickets needing merge → RFP
2. **Fix bugs second** — In Progress tickets pushed back from CQ/QA
3. **New work last** — Pick up from TODO

## Quick Start

### Prerequisites

- Docker 20.10+ and Docker Compose v2+
- API keys: `XAI_API_KEY` (PO), `ANTHROPIC_API_KEY` (DEV/CQ/QA), `OPENAI_API_KEY` (OPS)

### Setup

```bash
git clone git@github.com:MnemoShare/devteam.git
cd devteam
cp .env.example .env
# Edit .env with your API keys and generate auth tokens
```

### Generate auth tokens

```bash
# Meeting Board tokens (one per persona)
for role in PO DEV CQ QA OPS; do
  echo "MB_TOKEN_${role}=$(openssl rand -hex 32)"
done
```

### Start

```bash
make build    # Build all images
make up       # Start all 8 services
```

### Verify

```bash
docker compose ps                    # All services running/healthy
open http://localhost:8080           # Meeting Board dashboard
open http://localhost:8088           # Project Board UI
```

### Extract Project Board tokens

On first startup, the Project Board auto-generates API tokens for each agent:

```bash
docker compose logs project-board | grep "API Tokens" -A 10
```

Paste the tokens into `.env` as `PB_TOKEN_PO`, `PB_TOKEN_DEV`, etc., then restart the agents:

```bash
docker compose restart po dev cq qa ops
```

## Services

| Service        | Container Name         | Host Port | Purpose |
|---------------|------------------------|-----------|---------|
| mongo         | devteam-mongo          | —         | Shared MongoDB (meetingboard + taskboard DBs) |
| project-board | devteam-project-board  | 8088      | Ticket management UI and API |
| meeting-board | devteam-meeting-board  | 8080      | Communication hub + dashboard |
| po            | devteam-po             | 18790     | Product Owner agent |
| dev           | devteam-dev            | 18791     | Developer agent |
| cq            | devteam-cq             | 18792     | Code Quality agent |
| qa            | devteam-qa             | 18793     | QA agent |
| ops           | devteam-ops            | 18794     | DevOps agent |

## File Structure

```
devteam/
├── docker-compose.yml          # 8 services on devteam network
├── .env.example                # Environment template
├── Makefile                    # Build/run shortcuts
├── meeting-board/              # Go microservice (communication hub)
│   ├── main.go
│   ├── Dockerfile
│   ├── go.mod / go.sum
│   └── internal/               # handlers, models, store, ws, server
├── projectboard/               # Node.js task board
│   ├── src/server.js
│   ├── src/views/              # EJS templates (board, login, etc.)
│   ├── Dockerfile
│   └── package.json
├── images/
│   ├── base/                   # Ubuntu 24.04 + OpenClaw base image
│   │   ├── Dockerfile
│   │   ├── entrypoint.sh       # 3-layer config merge
│   │   ├── openclaw.base.json
│   │   └── scripts/            # healthcheck.sh, wait-for-it.sh
│   ├── po/                     # Product Owner persona
│   ├── dev/                    # Developer persona
│   ├── cq/                     # Code Quality persona
│   ├── qa/                     # QA persona (Playwright + Chromium)
│   └── ops/                    # DevOps persona
├── k8s/                        # Kustomize-based K8s manifests
└── docs/
    ├── QUICKSTART.md
    ├── ARCHITECTURE.md
    └── EXTENDING.md
```

Each persona directory contains:
- `Dockerfile` — Extends base image
- `openclaw.json` — AI provider config, heartbeat interval
- `workspace/` — SOUL.md, HEARTBEAT.md, IDENTITY.md, TOOLS.md
- `skills/` — Role-specific skills (git-workflow, code-review, test-runner, deploy, etc.)

## Key Concepts

### Meeting Board
Go microservice with REST API, WebSocket real-time updates, and an embedded dashboard. All inter-agent communication goes here. Channels: standup, planning, review, retrospective, ad-hoc.

### Project Board
Local Node.js/Express app (forked from [MnemoShare/projectboard](https://github.com/MnemoShare/projectboard)). Runs alongside the team in Docker. Auto-seeds agent accounts on first startup. Bearer token auth for API access. Human UI at port 8088.

### 3-Layer Config Merge
1. **Base config** — Baked into base image
2. **Persona config** — Copied during persona image build
3. **Runtime overrides** — Volume-mounted at container start

### The Quinn Problem
Named after QA: failing a ticket in comments but forgetting to move the status back. PO detects and fixes this every heartbeat. The rule: comment AND status change, always, every time.

### Test Environment
DEV runs the app inside their container on the devteam Docker network. QA accesses it at `http://devteam-dev:<port>`. QA uses Playwright (headless Chromium) for UI testing and curl/jq for API testing. Screenshots saved to `./qa-evidence/` on the host.

## Make Targets

```bash
make help                # Show all targets
make build               # Build all images
make up                  # Start all services
make down                # Stop all services
make logs                # Tail all logs
make logs-dev            # Tail specific service logs
make dashboard           # Open Meeting Board dashboard
make test-meeting-board  # Smoke test Meeting Board API
make clean               # Stop + remove volumes + images
make k8s-apply           # Deploy to Kubernetes
```

## Documentation

- [QUICKSTART.md](docs/QUICKSTART.md) — Setup in under 10 minutes
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — Deep dive into system design
- [EXTENDING.md](docs/EXTENDING.md) — Customize personas, add skills, scale the team
