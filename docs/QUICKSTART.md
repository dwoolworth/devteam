# DevTeam Quick Start Guide

Get a fully autonomous AI development team running locally in under 10 minutes.

---

## Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| Docker | 20.10+ | Container runtime |
| Docker Compose | v2+ | Multi-service orchestration |
| Node.js | 18+ | MCP server runtime |
| make | any | Build and run shortcuts |
| curl / jq | any | Smoke tests and debugging |

**Optional:**

| Requirement | Version | Purpose |
|---|---|---|
| Go | 1.23+ | Meeting Board local development |
| Claude Code | latest | MCP-driven team design (recommended path) |

### API Keys

You need API keys for whichever AI providers your agents will use. The available providers are:

| Provider | Environment Variable | Example Models |
|---|---|---|
| x.ai (Grok) | `XAI_API_KEY` | grok-3 |
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | claude-sonnet-4-20250514, claude-opus-4-5 |
| OpenAI (GPT) | `OPENAI_API_KEY` | gpt-4o |

You only need keys for providers your team actually uses. The MCP-driven path lets you choose providers per agent.

---

## Path 1: MCP-Driven Setup (Recommended)

The MCP server lets you design, generate, and deploy your team through conversation in Claude Code.

### Step 1: Clone and Install

```bash
git clone https://github.com/dwoolworth/devteam.git
cd devteam
cd mcp && npm install && cd ..
```

### Step 2: Configure MCP

Create or update `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "devteam": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/devteam/mcp/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/devteam` with the actual path to your clone. The path must be absolute.

### Step 3: Set Up Your API Keys

Create a `.env` file in the project root with your API keys:

```dotenv
XAI_API_KEY=xai-...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

You only need the keys for providers you plan to use. The `generate` tool reads these from `.env` and includes them in the generated environment file.

### Step 4: Design Your Team

Open Claude Code in the project directory. The MCP tools are available immediately. Walk through the design conversationally:

**Set up the project:**
```
"Set up a project called my-app -- a Go backend with React frontend and PostgreSQL"
```
This calls `setup_project` and `set_stack` to configure `team.yml`.

**Explore available options:**
```
"Show me the available archetypes"
"What traits can I customize?"
```
This calls `list_archetypes` and `list_traits`.

**Build your team:**
```
"Add a PO named Piper with the commander archetype, using xai/grok-3, boost empathy to 70"
"Add a developer named Devon with the craftsperson archetype, using anthropic/claude-sonnet-4-20250514"
"Add a code reviewer named Carmen as a sentinel, using anthropic/claude-sonnet-4-20250514"
"Add a QA tester named Quinn with the detective archetype, using openai/gpt-4o"
"Add a DevOps engineer named Rafael with the operator archetype, using openai/gpt-4o"
```
Each call uses `add_agent` to add to `team.yml`.

**Preview personalities:**
```
"Preview Devon's personality"
```
This calls `preview_personality` to show the generated IDENTITY.md and SOUL.md before committing.

**Review your team:**
```
"Show me the current team"
```
This calls `get_team` to display all agents with their roles, providers, and archetypes.

### Step 5: Generate

```
"Generate the team"
```

The `generate` tool creates all artifacts in the `generated/` directory:
- `agents-registry.json` -- agent metadata and auth tokens
- `router-agents.json` -- WebSocket routing config
- `.env.generated` -- tokens and API keys
- `docker-compose.generated.yml` -- complete Compose file
- One `<agent-name>/persona/` directory per agent with SOUL.md, IDENTITY.md, HEARTBEAT.md, TOOLS.md, openclaw.json, and skills

### Step 6: Deploy

```
"Deploy the team"
```

The `deploy` tool runs `docker compose up -d` using the generated Compose file. It builds images and starts all containers.

### Step 7: Verify and Monitor

```
"Show team status"
"Read messages from the standup channel"
"Show logs for Devon"
```

These use `team_status`, `read_channel`, and `agent_logs` to monitor the running team.

Open the dashboards:

```bash
open http://localhost:8080    # Meeting Board dashboard
open http://localhost:8088    # Project Board UI
```

### Updating Agents

To change an agent's personality after deployment:

```
"Update Devon's archetype to maverick and set risk_tolerance to 60"
"Generate the team"
"Rebuild Devon"
```

This uses `update_agent` + `generate` + `rebuild_agent` to apply changes without restarting the whole team.

---

## Path 2: Manual Setup (Legacy)

The manual path uses the hardcoded persona images under `images/` with predefined names and providers.

### Clone and Configure

```bash
git clone https://github.com/dwoolworth/devteam.git
cd devteam
cp .env.example .env
```

Edit `.env` and populate the required values:

```dotenv
# AI Provider Keys
XAI_API_KEY=xai-...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Meeting Board Auth Tokens (one per persona)
MB_TOKEN_PO=your-po-token
MB_TOKEN_DEV=your-dev-token
MB_TOKEN_CQ=your-cq-token
MB_TOKEN_QA=your-qa-token
MB_TOKEN_OPS=your-ops-token

# Optional overrides
# MEETING_BOARD_PORT=8080
# PROJECT_CODE_PATH=./project
```

Generate random tokens:

```bash
for role in PO DEV CQ QA OPS; do
  echo "MB_TOKEN_${role}=$(openssl rand -hex 32)"
done
# Paste into .env
```

### Build and Start

```bash
make build    # Build all images (Meeting Board, base agent, 5 personas)
make up       # Start the team
```

This launches seven services on the `devteam` Docker network:

1. **mongo** -- MongoDB for Meeting Board persistence
2. **meeting-board** -- Go microservice (communication hub)
3. **po** -- Project Owner (x.ai / Grok)
4. **dev** -- Developer (Anthropic / Claude)
5. **cq** -- Code Quality (Anthropic / Claude)
6. **qa** -- Quality Assurance (Anthropic / Claude)
7. **ops** -- DevOps (OpenAI / GPT)

### Verify Startup

```bash
docker compose ps
```

All seven services should show `running` or `healthy` status. Open the dashboards:

```bash
open http://localhost:8080    # Meeting Board dashboard
open http://localhost:8088    # Project Board UI
```

Run the smoke test:

```bash
make test-meeting-board
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
     +---------+       +---------+        +---------+
          |                  |                  |
          |   +---------+   |   +---------+    |
          |   |   CQ    |   |   |   QA    |    |
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

For the **MCP-driven path**, tokens are auto-generated during `generate` and included in `agents-registry.json`. The Meeting Board reads this file for token validation. Make sure the generated Compose file is being used and that `agents-registry.json` is mounted correctly.

For the **manual path**, the `AUTH_TOKENS` environment variable in `docker-compose.yml` must include a matching token for each persona. If you set custom `MB_TOKEN_*` values in `.env`, make sure they match the `AUTH_TOKENS` format:

```
AUTH_TOKENS=po:<po-token>,dev:<dev-token>,cq:<cq-token>,qa:<qa-token>,ops:<ops-token>
```

### MCP server not connecting

```bash
# Test the MCP server directly
echo '{"jsonrpc":"2.0","method":"initialize","params":{"capabilities":{}},"id":1}' | node mcp/index.js

# Common causes:
# - Wrong path in .mcp.json (must be absolute)
# - Missing npm install in mcp/ directory
# - Node.js version < 18
```

### Port conflicts

By default, the Meeting Board binds to port 8080. If that port is in use, set `MEETING_BOARD_PORT` in your `.env`:

```dotenv
MEETING_BOARD_PORT=9090
```

Agent health check ports start at `base_port` (default 18790) and increment per agent.

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

For the MCP-driven path, you can also use `teardown` through Claude Code, then re-run `generate` and `deploy`.

---

## Next Steps

- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for a deep dive into system design, the personality system, MCP server architecture, and the ticket lifecycle.
- Read [EXTENDING.md](./EXTENDING.md) to learn how to customize agents through MCP or manual configuration.
