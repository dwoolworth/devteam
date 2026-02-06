# DevTeam Quick Start Guide

Get a fully autonomous AI development team running locally in under 10 minutes.

---

## Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| Docker | 20.10+ | Container runtime |
| Docker Compose | v2+ | Multi-service orchestration |
| Go | 1.23+ | Meeting Board local development (optional) |
| make | any | Build and run shortcuts |
| curl / jq | any | Smoke tests and debugging |

### API Keys

You need at least one key from each provider used by the team:

| Provider | Used By | Environment Variable |
|---|---|---|
| x.ai (Grok) | PO | `XAI_API_KEY` |
| Anthropic (Claude) | DEV, CQ, QA | `ANTHROPIC_API_KEY` |
| OpenAI (GPT) | OPS | `OPENAI_API_KEY` |

You also need access to an external TaskBoard (Planning Board) that serves as the team's ticket system:

| Variable | Purpose |
|---|---|
| `PLANNING_BOARD_URL` | Base URL of your TaskBoard instance |
| `PLANNING_BOARD_TOKEN` | Authentication token for the TaskBoard API |

---

## Clone and Setup

```bash
git clone <your-repo-url> devteam
cd devteam
```

Copy the example environment file and fill in your keys:

```bash
cp .env.example .env
```

Edit `.env` and populate the required values:

```dotenv
# AI Provider Keys
XAI_API_KEY=xai-...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Planning Board (external TaskBoard)
PLANNING_BOARD_URL=https://your-taskboard.example.com
PLANNING_BOARD_TOKEN=your-token

# Meeting Board Auth Tokens (one per persona)
# In production, generate unique tokens for each bot.
# For local development, the defaults in docker-compose.yml work fine.
MB_TOKEN_PO=your-po-token
MB_TOKEN_DEV=your-dev-token
MB_TOKEN_CQ=your-cq-token
MB_TOKEN_QA=your-qa-token
MB_TOKEN_OPS=your-ops-token

# Optional overrides
# MEETING_BOARD_PORT=8080
# PROJECT_CODE_PATH=./project
```

---

## Quick Start

Build all images (Meeting Board, base agent, and all five personas):

```bash
make build
```

Start the full team:

```bash
make up
```

This launches seven services on the `devteam` Docker network:

1. **mongo** -- MongoDB for Meeting Board persistence
2. **meeting-board** -- Go microservice (communication hub)
3. **po** -- Project Owner (x.ai / Grok)
4. **dev** -- Developer (Anthropic / Claude)
5. **cq** -- Code Quality (Anthropic / Claude)
6. **qa** -- Quality Assurance (Anthropic / Claude)
7. **ops** -- DevOps (OpenAI / GPT)

---

## Verify Startup

Check that all containers are running:

```bash
docker compose ps
```

You should see all seven services in a `running` or `healthy` state. The Meeting Board should show `(healthy)` after its health check passes.

Open the real-time dashboard:

```bash
make dashboard
```

This opens `http://localhost:8080` in your browser, where you can see channels, messages, and live WebSocket updates as the bots communicate.

---

## First Smoke Test

Run the built-in Meeting Board smoke test:

```bash
make test-meeting-board
```

This will:

1. Hit the `/health` endpoint and confirm `{"status": "ok"}`
2. List the seeded channels (standup, planning, review, retrospective, ad-hoc)
3. Post a test message to the first channel
4. Print "Meeting board is working!" on success

If any step fails, see the Troubleshooting section below.

---

## Useful Commands

```bash
make help                # Show all available make targets
make build               # Build all images
make up                  # Start all services (detached)
make down                # Stop all services
make restart             # Stop and restart all services
make status              # Show container status (docker compose ps)
make logs                # Tail logs for all services
make logs-dev            # Tail logs for a specific service (dev, po, cq, qa, ops, etc.)
make dashboard           # Open the Meeting Board dashboard in your browser
make test-meeting-board  # Smoke test the Meeting Board API
make clean               # Stop services, remove volumes and images
make up-infra            # Start only MongoDB + Meeting Board
make up-dev              # Start infra + DEV only (useful for testing)
make build-dev           # Rebuild just the DEV persona image
make k8s-apply           # Deploy to Kubernetes (requires kubectl configured)
make k8s-status          # Show Kubernetes resource status
```

---

## Architecture at a Glance

```
                    +-------------------+
                    |   Planning Board  |   (External TaskBoard)
                    |   (Ticket System) |
                    +--------+----------+
                             |
          +------------------+------------------+
          |                  |                  |
     +----v----+       +----v----+        +----v----+
     |   PO    |       |   DEV   |        |   OPS   |
     | (Grok)  |       | (Claude)|        |  (GPT)  |
     +---------+       +---------+        +---------+
          |                  |                  |
          |   +---------+   |   +---------+    |
          |   |   CQ    |   |   |   QA    |    |
          |   | (Claude)|   |   | (Claude)|    |
          |   +---------+   |   +---------+    |
          |        |        |        |         |
          v        v        v        v         v
     +-------------------------------------------+
     |           Meeting Board (Go)              |
     |  REST API  |  WebSocket  |  Dashboard     |
     +-------------------------------------------+
                         |
                    +----v----+
                    | MongoDB |
                    +---------+
```

**Key principle**: All bot-to-bot communication flows through the Meeting Board. No persona ever calls another persona directly. The Meeting Board is the single source of truth for team communication.

Each persona runs on a heartbeat loop (10-15 minutes), waking up to check the Meeting Board for mentions, read channel updates, check the Planning Board for ticket changes, and take action.

---

## Troubleshooting

### Meeting Board health check fails

```bash
# Check if MongoDB is healthy first
docker compose logs mongo

# Check Meeting Board logs for connection errors
docker compose logs meeting-board
```

The Meeting Board waits for MongoDB to be healthy before starting. If MongoDB fails its health check (`mongosh --eval "db.adminCommand('ping')"`), the Meeting Board will not start.

### A persona container keeps restarting

```bash
# Check the persona's logs for startup errors
docker compose logs po    # or dev, cq, qa, ops

# Common causes:
# - Missing or invalid API key in .env
# - Meeting Board not healthy yet (persona waits for it)
# - Invalid JSON in openclaw.json configuration
```

The entrypoint script validates the configuration at startup and will print clear error messages if something is wrong. Look for lines prefixed with `[entrypoint] ERROR:`.

### "invalid token" errors in Meeting Board logs

The `AUTH_TOKENS` environment variable in `docker-compose.yml` must include a matching token for each persona. If you set custom `MB_TOKEN_*` values in `.env`, make sure they match the `AUTH_TOKENS` format:

```
AUTH_TOKENS=po:<po-token>,dev:<dev-token>,cq:<cq-token>,qa:<qa-token>,ops:<ops-token>
```

### Port conflicts

By default, the Meeting Board binds to port 8080. If that port is in use, set `MEETING_BOARD_PORT` in your `.env`:

```dotenv
MEETING_BOARD_PORT=9090
```

Each persona also exposes a health check port for debugging:

| Service | Host Port |
|---|---|
| meeting-board | 8080 |
| po | 18790 |
| dev | 18791 |
| cq | 18792 |
| qa | 18793 |
| ops | 18794 |

### DEV cannot write to the project directory

The DEV container mounts a host directory for the project code. Make sure the path exists and is writable:

```bash
# Default path is ./project relative to the repo root
mkdir -p project

# Or set a custom path in .env
PROJECT_CODE_PATH=/path/to/your/project
```

The CQ container mounts the same path as read-only (`:ro`) so it can review code without modifying it.

### Starting fresh

To tear everything down and start from scratch:

```bash
make clean
```

This stops all containers, removes Docker volumes (including MongoDB data), and deletes all built images. You will need to run `make build` again afterward.

---

## Next Steps

- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for a deep dive into system design, the ticket lifecycle, and the Meeting Board API.
- Read [EXTENDING.md](./EXTENDING.md) to learn how to customize personas, add new skills, or scale the team.
