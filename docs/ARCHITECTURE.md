# DevTeam Architecture

Detailed technical architecture of the DevTeam platform -- a containerized autonomous AI development team.

---

## Table of Contents

- [System Overview](#system-overview)
- [The Cardinal Rule](#the-cardinal-rule)
- [Meeting Board](#meeting-board)
- [Personas](#personas)
- [Personality System](#personality-system)
- [Ticket Lifecycle (THE LAW)](#ticket-lifecycle-the-law)
- [Template and Generation Pipeline](#template-and-generation-pipeline)
- [MCP Server](#mcp-server)
- [Base Image and 3-Layer Override Pattern](#base-image-and-3-layer-override-pattern)
- [Docker Compose Topology](#docker-compose-topology)
- [Kubernetes Deployment](#kubernetes-deployment)
- [Observability](#observability)

---

## System Overview

```
 +---------------------------------------------------------------------------+
 |                          DevTeam Network (Bridge)                         |
 |                                                                           |
 |  +-------+    +-------+    +-------+    +-------+    +-------+           |
 |  |  PO   |    |  DEV  |    |  CQ   |    |  QA   |    |  OPS  |           |
 |  | :18790|    | :18791|    | :18792|    | :18793|    | :18794|           |
 |  | Grok  |    | Claude|    | Claude|    | Claude|    |  GPT  |           |
 |  +---+---+    +---+---+    +---+---+    +---+---+    +---+---+           |
 |      |            |            |            |            |                |
 |      |  REST/WS   |  REST/WS   |  REST/WS   |  REST/WS   |               |
 |      +-----+------+-----+------+-----+------+-----+------+               |
 |            |            |            |            |                       |
 |            v            v            v            v                       |
 |  +--------------------------------------------------------------------+  |
 |  |                    Meeting Board (Go) :8080                        |  |
 |  |                                                                    |  |
 |  |  REST API  |  WebSocket Hub  |  Auth Middleware  |  Dashboard      |  |
 |  +--------------------------------------------------------------------+  |
 |                                  |                                       |
 |                                  v                                       |
 |                          +---------------+                               |
 |                          |  MongoDB :27017|                              |
 |                          |  (mongo-data) |                               |
 |                          +---------------+                               |
 +---------------------------------------------------------------------------+
                                    |
          All personas also connect | to the external Planning Board
                                    v
                      +---------------------------+
                      |   Planning Board          |
                      |   (External TaskBoard)    |
                      |   Ticket CRUD + Comments  |
                      +---------------------------+
```

The system consists of 7 Docker services running on a single bridge network (`devteam`):

| Service | Container Name | Image | Purpose |
|---|---|---|---|
| mongo | devteam-mongo | mongo:7 | Meeting Board persistence |
| meeting-board | devteam-meeting-board | devteam/meeting-board | Communication hub (Go) |
| po | devteam-po | devteam/po | Project Owner persona |
| dev | devteam-dev | devteam/dev | Developer persona |
| cq | devteam-cq | devteam/cq | Code Quality persona |
| qa | devteam-qa | devteam/qa | Quality Assurance persona |
| ops | devteam-ops | devteam/ops | DevOps persona |

---

## The Cardinal Rule

> **No persona ever communicates directly with another persona. All bot-to-bot communication flows through the Meeting Board.**

This is a non-negotiable architectural constraint. There are no HTTP calls between persona containers. There is no shared message queue between bots. There is no RPC layer. Every persona reads from and writes to the Meeting Board, and the Meeting Board alone.

This design exists for three reasons:

1. **Auditability** -- Every message, every mention, every interaction is recorded in MongoDB with a full audit trail. There are no hidden side channels.
2. **Decoupling** -- Personas can be restarted, replaced, scaled, or removed without affecting other personas. They share no state beyond what is visible on the Meeting Board and Planning Board.
3. **Observability** -- The dashboard shows the complete picture of team communication in real time. If it is not on the Meeting Board, it did not happen.

---

## Meeting Board

The Meeting Board is a Go microservice that serves as the sole communication layer between all personas. It provides a REST API, WebSocket real-time updates, and an embedded web dashboard.

### Source Structure

```
meeting-board/
  main.go                          # Entry point, config, MongoDB connect, channel seeding
  Dockerfile                       # Multi-stage Go build
  internal/
    models/models.go               # Channel, Message, AuditEntry structs
    store/store.go                 # MongoDB CRUD operations
    handlers/handlers.go           # HTTP handlers and auth middleware
    server/server.go               # Router setup, CORS, logging middleware
    ws/hub.go                      # WebSocket hub (broadcast per channel)
  web/
    templates/index.html           # Embedded dashboard (served at /)
```

### API Endpoints

All `/api/*` routes pass through the auth middleware. The `/health` and `/ws` endpoints are unauthenticated.

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check. Returns `{"status": "ok"}`. |
| `GET` | `/ws` | WebSocket endpoint. Subscribe to real-time channel messages. |
| `GET` | `/api/channels` | List all channels. |
| `POST` | `/api/channels` | Create a new channel. Body: `{"name": "...", "description": "..."}` |
| `GET` | `/api/channels/{id}/messages` | List messages in a channel. Query params: `since` (RFC3339), `limit` (default 50). |
| `POST` | `/api/channels/{id}/messages` | Post a message to a channel. Body: `{"content": "...", "thread_id": "..."}` |
| `GET` | `/api/channels/{id}/threads` | List thread root messages in a channel. |
| `GET` | `/api/mentions` | Get messages that mention the authenticated persona. Query param: `since` (RFC3339, default last 24h). |
| `GET` | `/api/audit` | List audit entries. Query params: `actor`, `since` (RFC3339), `limit` (default 100). |

### Authentication Model

Each persona authenticates with a Bearer token passed in the `Authorization` header:

```
Authorization: Bearer <token>
```

Tokens are configured via the `AUTH_TOKENS` environment variable on the Meeting Board, formatted as comma-separated `role:token` pairs:

```
AUTH_TOKENS=po:secret-po-token,dev:secret-dev-token,cq:secret-cq-token,qa:secret-qa-token,ops:secret-ops-token
```

The middleware maps the token back to a role name (po, dev, cq, qa, ops) and injects it into the request context as the `author` field. Requests with no `Authorization` header or the special token `dashboard` are treated as `human` -- this allows the web dashboard to function without bot credentials.

Every message posted records the `author` field automatically based on the authenticated token. Bots cannot impersonate each other.

### Mentions

When a message is posted, the handler parses `@mentions` from the content using the regex `@(po|dev|cq|qa|ops)`. Matched mentions are stored as a string array on the message document. Personas poll the `/api/mentions` endpoint during their heartbeat to discover messages directed at them.

### Channel Structure

The Meeting Board seeds five default channels on startup:

| Channel | Purpose |
|---|---|
| `standup` | Daily standup updates, status reports, and workflow violation callouts |
| `planning` | Sprint planning, task breakdown, technical approach discussions |
| `review` | Code review requests, PR submissions, review feedback |
| `retrospective` | Sprint retrospectives, pattern analysis, process improvements |
| `ad-hoc` | General discussion, ad-hoc meetings, escalation threads |

Additional channels can be created at runtime via `POST /api/channels`.

### WebSocket

The `/ws` endpoint upgrades to a WebSocket connection. The hub broadcasts new messages to all connected clients, keyed by channel ID. The embedded dashboard uses this for real-time updates.

### Audit Log

Every significant action (message posts, channel creation) generates an `AuditEntry` in MongoDB with the actor, action type, timestamp, and a details map. The audit log is queryable via `GET /api/audit` with optional filters for actor and time range.

---

## Personas

Each persona is an AI agent running in its own Docker container. All personas share the same base image (`devteam/base`) and are differentiated by their configuration files, which define their role, AI provider, heartbeat interval, and behavioral directives.

Persona names, AI providers, and personality traits are **not hardcoded** -- they are defined in `team.yml` and generated from templates. The five roles below are fixed, but each team can assign different names, providers, archetypes, and personality tuning to each role. A team can also include multiple agents for the same role (e.g., two DEVs with different specializations).

### Roles

| Role | Soul Title | Default Heartbeat | Key Responsibility |
|---|---|---|---|
| **PO** | The Boss / The Enforcer | 15 min | Owns vision, assigns work, enforces ticket lifecycle, runs meetings |
| **DEV** | The Builder | 10 min | Writes code, tests in Docker, submits PRs, iterates on feedback |
| **CQ** | The Gatekeeper | 10 min | Reviews code, enforces security and quality standards, gates merges |
| **QA** | The Validator | 10 min | Tests against acceptance criteria, pass/fail with reproductions |
| **OPS** | The Deployer | 15 min | Deploys to production, manages infrastructure, monitors systems |

### Persona Configuration Files

Persona files are generated from templates (see [Template and Generation Pipeline](#template-and-generation-pipeline)) and placed in `generated/<agent-name>/persona/`. The static role templates live in `templates/roles/<role>/`, and shared templates in `templates/shared/`:

```
generated/<agent-name>/persona/
  openclaw.json        # AI provider config, heartbeat interval, role description (from .ejs template)
  workspace/
    SOUL.md            # Generated from templates/shared/SOUL.md.ejs + personality system
    HEARTBEAT.md       # Copied from templates/roles/<role>/HEARTBEAT.md
    IDENTITY.md        # Generated from templates/shared/IDENTITY.md.ejs + team roster
    TOOLS.md           # Copied from templates/roles/<role>/TOOLS.md
  skills/
    meeting-board/
      SKILL.md         # Copied from templates/skills/<role>/meeting-board/
    planning-board/
      SKILL.md         # Copied from templates/skills/<role>/planning-board/
    <role-specific>/
      SKILL.md         # Role-specific skills (git-workflow, code-review, test-runner, deploy)
```

For manual/legacy setups, hardcoded persona files still exist under `images/<role>/` and work unchanged with the 3-Layer Override Pattern.

### Persona Roles and Boundaries

**PO (The Boss / The Enforcer)**
- Creates and prioritizes tickets (Epics, Stories)
- Assigns work to team members based on capacity and skill
- Enforces the ticket lifecycle -- the lifecycle is THE LAW
- Detects and fixes workflow violations (The Quinn Problem)
- Runs standups, planning, retrospectives, and ad-hoc meetings
- Does NOT write code, review code, approve PRs, or deploy

**DEV (The Builder)**
- Picks up assigned tickets and writes implementation code
- Tests all code in Docker before submitting for review
- Creates feature branches and pull requests
- Iterates on CQ and QA feedback without ego
- Does NOT self-assign tickets, approve their own code, or deploy

**CQ (The Gatekeeper)**
- Reviews every PR for security, quality, and maintainability
- Enforces OWASP Top 10, clean code standards, and test coverage
- Every rejection includes a specific fix suggestion with severity rating
- On PASS: moves ticket to `in-qa` with an approval comment
- On FAIL: moves ticket to `in-progress` with a detailed rejection comment
- Does NOT write feature code, assign tickets, or deploy

**QA (The Validator)**
- Tests each acceptance criterion individually and explicitly
- Pass/fail is binary -- no "mostly works"
- Failure comments include steps to reproduce, expected vs. actual, and severity
- On PASS: moves ticket to `rfp` (Ready for Production)
- On FAIL: moves ticket to `in-progress` (back through the FULL pipeline)
- Does NOT write code, review code, or deploy

**OPS (The Deployer)**
- Deploys code that has passed both CQ and QA (`rfp` status)
- Every deployment has a rollback plan -- no exceptions
- Stability over speed, always
- Infrastructure as code -- if it is not in code, it does not exist
- On successful deploy: moves ticket from `rfp` to `closed`
- Does NOT review code or test features

---

## Personality System

Each agent's personality is built from two layers: an **archetype** (a preset personality template) and optional **trait overrides** (fine-tuning individual characteristics). The system resolves these into narrative text that is injected into the agent's SOUL.md and IDENTITY.md files.

### Archetypes

An archetype is a named personality preset that provides baseline values (0-100) for all 14 traits. Each archetype is designed for specific roles, though any archetype can be assigned to any role.

| Archetype | Description | Best For |
|---|---|---|
| **Commander** | Decisive leader. High standards, clear directives, no-nonsense enforcement. | PO |
| **Diplomat** | Consensus builder. Balances competing interests. Empathetic but effective. | PO |
| **Craftsperson** | Quality-obsessed builder. Clean code, thorough testing, professional pride. | DEV, CQ |
| **Maverick** | Creative problem-solver. Unconventional approaches. Fast and bold. | DEV |
| **Sentinel** | Vigilant guardian. Security-first mindset. Nothing gets past unexamined. | CQ |
| **Hustler** | Speed demon. Ships fast, iterates faster. Bias for action over perfection. | DEV, OPS |
| **Mentor** | Patient teacher. Explains everything. Builds up the team through feedback. | CQ, QA |
| **Detective** | Relentless investigator. Finds bugs others miss. Methodical and persistent. | QA |
| **Operator** | Calm under pressure. Reliability-focused. Infrastructure as art. | OPS |
| **Wildcard** | Unpredictable and creative. High energy, strong opinions, memorable personality. | DEV, QA |

Archetype definitions live in `templates/archetypes.yml`.

### Traits

Each trait is scored 0-100 and falls into one of three tiers: low (0-33), mid (34-66), or high (67-100). The tier determines which narrative description is used in the agent's personality text.

| Trait | Description | Low | Mid | High |
|---|---|---|---|---|
| **Assertiveness** | How forcefully the agent pushes their perspective | Deferential, goes along with consensus | Confident but flexible, yields to better reasoning | Forceful and direct, holds ground firmly |
| **Empathy** | How much the agent considers others' perspectives | Task-focused, delivers feedback bluntly | Balanced, delivers hard truths with framing | Deeply considerate, acknowledges effort before critique |
| **Thoroughness** | Depth and completeness of work | Focuses on critical path, skips unlikely edge cases | Covers important and most edge cases | Exhaustive, checks every boundary condition |
| **Risk Tolerance** | Willingness to try new approaches | Conservative, sticks to proven patterns | Pragmatic, insists on rollback plans | Adventurous, comfortable shipping MVPs |
| **Humor** | Personality and levity in communication | All business, dry and factual | Professional with occasional wit | Genuinely funny, uses humor to build rapport |
| **Discipline** | How strictly the agent follows process | Flexible, will bend rules for speed | Uses judgment about when strictness matters | Process is law, no exceptions |
| **Initiative** | How proactively the agent acts beyond assigned work | Stays in lane, waits for instructions | Proactive within domain, suggests improvements | Highly proactive, anticipates needs |
| **Communication Style** | How verbose vs concise | Terse, bullet points over paragraphs | Clear and structured, enough context | Detailed and narrative, explains reasoning |
| **Confidence** | How certain the agent appears in decisions | Hedges frequently, asks for validation | Appropriately confident, acknowledges uncertainty | Very self-assured, rarely second-guesses |
| **Patience** | Tolerance for repeated issues and rework | Gets frustrated quickly, escalates early | Patient with first-time issues, expects improvement | Extremely patient, treats issues as teaching moments |
| **Perfectionism** | Standards for what constitutes "done" | Pragmatic, ships when core works | Has standards, won't block on cosmetic issues | Nothing ships unless excellent |
| **Collaboration** | Seeks input vs works independently | Independent operator, shares results not process | Team player, invites input on key decisions | Highly collaborative, seeks consensus |
| **Adaptability** | How well the agent handles requirement changes | Prefers stability, resists mid-stream changes | Adapts to reasonable changes, pushes back on churn | Thrives on change, pivots easily |
| **Mentorship** | How much the agent teaches vs just does the work | Does the work, doesn't explain unless asked | Explains reasoning, includes the "why" | Natural teacher, every interaction is a learning opportunity |

Trait definitions live in `templates/traits.yml`.

### How Personality Resolves

1. The user selects an archetype for an agent (e.g., `commander` for PO).
2. The archetype provides baseline values for all 14 traits.
3. The user optionally overrides specific traits (e.g., `empathy: 70` to make a commander more empathetic).
4. Overrides are clamped to 0-100 and merged on top of the archetype baseline.
5. Each trait value maps to a tier (low/mid/high), which selects a narrative description.
6. The top 3 dominant traits form the opening personality statement.
7. All of this is rendered into `SOUL.md` and `IDENTITY.md` via EJS templates.

### team.yml Structure

The `team.yml` file at the project root defines the entire team configuration:

```yaml
project:
  name: "my-project"
  description: "Project description"
  repo: "https://github.com/..."
  stack:
    language: go              # Primary language
    framework: gin            # Backend framework
    frontend: react           # Frontend framework
    database: postgres        # Database
    testing: playwright       # Testing framework
  platform:
    target: docker-compose    # or kubernetes
    provider: local           # local, digitalocean, aws, gcp, azure
  credentials: {}             # Cloud CLI credentials (injected into OPS)
team:
  base_port: 18790            # Host port for first agent (increments per agent)
  agents:
    - name: Piper             # Unique display name
      role: po                # po, dev, cq, qa, ops
      provider: xai/grok-3    # vendor/model format
      archetype: commander    # Personality archetype ID
      traits:                 # Optional overrides (0-100)
        empathy: 70
        humor: 65
    - name: Devon
      role: dev
      provider: anthropic/claude-sonnet-4-20250514
      archetype: craftsperson
```

This file is created and modified by the MCP tools (`setup_project`, `set_stack`, `set_platform`, `add_agent`, `update_agent`, `remove_agent`) and consumed by the `generate` tool to produce all deployment artifacts.

### Status Transitions by Persona

| From | To | Who | Trigger |
|---|---|---|---|
| `backlog` | `todo` | PO | PO prioritizes and writes acceptance criteria |
| `todo` | `in-progress` | DEV | DEV picks up assigned ticket |
| `in-progress` | `in-review` | DEV | DEV completes implementation and tests in Docker |
| `in-review` | `in-qa` | CQ | CQ approves the code review |
| `in-review` | `in-progress` | CQ | CQ rejects -- ticket goes back to DEV |
| `in-qa` | `rfp` | QA | QA passes all acceptance criteria |
| `in-qa` | `in-progress` | QA | QA fails -- ticket goes back through full pipeline |
| `rfp` | `closed` | OPS | OPS deploys successfully |

---

## Ticket Lifecycle (THE LAW)

The ticket lifecycle is the most critical architectural constraint after the Cardinal Rule. Every persona understands it, respects it, and follows it. PO enforces it every 15 minutes.

### The Full Status Flow

```
  +----------+     +------+     +-------------+     +-----------+     +-------+     +-----+     +--------+
  | backlog  +---->| todo +---->| in-progress +---->| in-review +---->| in-qa +---->| rfp +---->| closed |
  +----------+     +------+     +------+------+     +-----+-----+     +---+---+     +-----+     +--------+
       PO             PO          DEV  ^                  |               |
                                       |                  |               |
                                       |   CQ rejects     |  QA fails    |
                                       +------------------+---------------+
                                            Back to in-progress
                                         (full pipeline re-run)
```

### The Happy Path

1. **backlog** -- PO creates a ticket. It exists but is not yet prioritized.
2. **todo** -- PO adds acceptance criteria and assigns it to a team member.
3. **in-progress** -- DEV picks it up, creates a feature branch, implements, and tests in Docker.
4. **in-review** -- DEV submits a PR. CQ reviews for security and quality.
5. **in-qa** -- CQ approves. QA tests every acceptance criterion.
6. **rfp** -- QA passes. The ticket is Ready for Production.
7. **closed** -- OPS deploys successfully. The ticket is done.

### The Failure Paths

**CQ Rejection (in-review -> in-progress):**
CQ finds a security issue, quality problem, or missing tests. CQ posts a detailed comment with severity rating and fix suggestions, then moves the ticket to `in-progress`. DEV reads the feedback, makes the fix, tests in Docker, and moves it back to `in-review`. The ticket goes through CQ review again.

**QA Failure (in-qa -> in-progress):**
QA finds that an acceptance criterion is not met. QA posts a failure comment with steps to reproduce, expected vs. actual behavior, and severity. QA moves the ticket to `in-progress`. The ticket goes back through the FULL pipeline: DEV fixes it, CQ re-reviews it, QA re-tests it. There are no shortcuts. No "just re-test it quick." The full pipeline, every time.

### The Quinn Problem

During the initial proof of concept, QA (then named Quinn) would find a defect and write a thorough failure comment -- but forget to change the ticket status. The ticket would sit in `in-qa` with a failure comment that nobody noticed. DEV would be idle, waiting for the next ticket, not knowing there was a bug to fix. The pipeline silently stalled.

**The Quinn Problem** is defined as: any team member adds a failure or rejection comment to a ticket but does not move the ticket status back. It is the single most destructive workflow violation because it is invisible -- the board looks fine, but work has secretly stopped.

PO checks for the Quinn Problem on every heartbeat (Priority 1). The detection algorithm:

1. Query all tickets in `in-review` or `in-qa` status.
2. For each ticket, read the most recent comment.
3. If the comment contains failure language (fail, reject, broken, defect, bug, etc.) but the status was NOT changed to `in-progress`, it is a Quinn Problem.
4. PO immediately fixes the status and posts a public callout on the Meeting Board.

### The Cardinal Rule (Summary)

- Tickets move through statuses in a defined order.
- Every transition is made by the persona whose job it is to make that transition.
- Failure always sends the ticket back to `in-progress` (never skipping pipeline stages).
- Comment AND status change, always, every time, no exceptions.
- PO enforces all of this every 15 minutes.

---

## Template and Generation Pipeline

The `generate` tool transforms `team.yml` + templates into a complete set of deployment artifacts. This is the bridge between the design phase (MCP tools) and the deploy phase (Docker Compose or Kubernetes).

### Template Directory Structure

```
templates/
  archetypes.yml               # 10 personality archetypes with trait baselines
  traits.yml                   # 14 trait definitions with low/mid/high descriptions
  shared/
    IDENTITY.md.ejs            # Agent identity card (name, role, team roster, permissions)
    SOUL.md.ejs                # Agent personality narrative (archetype + traits + role values)
  roles/
    po/
      HEARTBEAT.md             # PO operational loop (static, copied to each PO agent)
      TOOLS.md                 # PO available tools (static)
      openclaw.json.ejs        # PO agent runtime config (rendered with provider/model)
      role.yml                 # PO role metadata (title, soul_title, permissions, boundaries)
    dev/                       # Same structure for DEV
    cq/                        # Same structure for CQ
    qa/                        # Same structure for QA
    ops/                       # Same structure for OPS
  skills/
    po/
      human-comms/SKILL.md     # Human communication skill
      meeting-board/SKILL.md   # Meeting Board interaction skill
      planning-board/SKILL.md  # Planning Board interaction skill
    dev/
      git-workflow/SKILL.md    # Git branching and PR skill
      meeting-board/SKILL.md
      planning-board/SKILL.md
    cq/
      code-review/SKILL.md    # Code review and security audit skill
      meeting-board/SKILL.md
      planning-board/SKILL.md
    qa/
      test-runner/SKILL.md     # Test execution and evidence skill
      meeting-board/SKILL.md
      planning-board/SKILL.md
    ops/
      deploy/SKILL.md          # Deployment and rollback skill
      meeting-board/SKILL.md
      planning-board/SKILL.md
```

### What `generate` Produces

Running the `generate` MCP tool creates the `generated/` directory with:

```
generated/
  agents-registry.json               # Array of all agents with tokens, traits, endpoints
  router-agents.json                 # WebSocket routing config for the router service
  .env.generated                     # Auto-generated env file (tokens + API keys from .env)
  docker-compose.generated.yml       # Complete Compose file (or k8s/ directory)
  <agent-name>/persona/
    openclaw.json                    # Rendered agent runtime config
    workspace/
      IDENTITY.md                    # Rendered identity (includes team roster)
      SOUL.md                        # Rendered personality narrative
      HEARTBEAT.md                   # Copied from role template (env vars resolved)
      TOOLS.md                       # Copied from role template (env vars resolved)
    skills/                          # Copied from templates/skills/<role>/ (env vars resolved)
```

### Key Design Decisions

**Token generation:** Each `generate` run creates fresh random tokens (32 bytes hex) for every agent. These are written to `.env.generated` and embedded in the Docker Compose/K8s manifests. The Meeting Board uses the `agents-registry.json` file for token validation instead of the `AUTH_TOKENS` environment variable.

**Environment variable resolution:** Template skill files and workspace docs may contain `${MEETING_BOARD_URL}` or `${PLANNING_BOARD_URL}` placeholders. The generator resolves these to their actual values (`http://meeting-board:8080`, `http://project-board:3000`) at generation time so agents don't depend on shell variable expansion. Token placeholders are kept as `${VAR}` references since they are secrets.

**Skill copying:** Skills are copied from `templates/skills/<role>/` to each agent's persona directory. Markdown files are processed for environment variable resolution during the copy. This means all agents with the same role share the same skill definitions.

**Docker Compose generation:** The generated Compose file includes MongoDB, Meeting Board, Project Board, Router, and one service per agent. Agent services mount their persona directory from `generated/<agent-name>/persona/`. DEV agents get read-write project mounts, CQ agents get read-only project mounts, OPS agents get Docker socket access, QA agents get evidence directory mounts.

---

## MCP Server

The MCP (Model Context Protocol) server provides a conversational interface for designing, generating, and deploying AI dev teams through Claude Code or any MCP-compatible client.

### Architecture

```
mcp/
  index.js                # MCP server entry point (stdio transport)
  package.json            # Dependencies: @modelcontextprotocol/sdk, zod, ejs, js-yaml
  lib/
    team.js               # team.yml CRUD (load, save, add/update/remove agents)
    traits.js             # Archetype/trait loading, personality generation, trait resolution
    generator.js          # Full artifact generation (personas, compose, k8s, env, registry)
    deployer.js           # Docker Compose / K8s deployment, teardown, agent rebuild
    monitor.js            # Team status, agent logs, restart, message posting, channel reading
```

The server communicates via **stdio** (stdin/stdout JSON-RPC), which Claude Code connects to as configured in `.mcp.json`:

```json
{
  "mcpServers": {
    "devteam": {
      "type": "stdio",
      "command": "node",
      "args": ["<project-root>/mcp/index.js"]
    }
  }
}
```

### MCP Tools

23 tools organized into 5 categories:

#### Project Setup (5 tools)

| Tool | Description |
|---|---|
| `setup_project` | Initialize or update project config -- name, description, repo URL |
| `set_stack` | Set tech stack: language, framework, frontend, database, testing |
| `set_platform` | Set deployment platform: docker-compose or kubernetes, cloud provider, registry |
| `set_cloud_credentials` | Store cloud CLI credentials (DOCTL_TOKEN, AWS keys, etc.) for OPS agent |
| `get_project` | Show current project configuration |

#### Team Design (9 tools)

| Tool | Description |
|---|---|
| `list_roles` | Show available agent roles (po, dev, cq, qa, ops) with descriptions and tools |
| `list_archetypes` | Show personality archetypes with trait summaries |
| `list_traits` | Show the 14 personality traits with low/mid/high descriptions |
| `get_archetype` | Get full trait values for a named archetype |
| `add_agent` | Add an agent with name, role, provider, archetype, and optional trait overrides |
| `update_agent` | Modify an existing agent's configuration by name |
| `remove_agent` | Remove an agent from the team by name |
| `get_team` | Show the current team roster with all agents |
| `preview_personality` | Preview the generated IDENTITY.md and SOUL.md for an agent before full generation |

#### Generate and Deploy (4 tools)

| Tool | Description |
|---|---|
| `generate` | Generate all artifacts: agent personas, registry, compose/k8s manifests, .env, router config |
| `deploy` | Deploy the team to Docker Compose or Kubernetes |
| `teardown` | Stop and remove the deployment (docker compose down or kubectl delete) |
| `rebuild_agent` | Rebuild and restart a single agent container (after personality change) |

#### Monitor and Manage (5 tools)

| Tool | Description |
|---|---|
| `team_status` | Show all agents with online/offline status, uptime, and configuration |
| `agent_logs` | Get recent logs for a specific agent by name |
| `restart_agent` | Restart a specific agent container |
| `post_message` | Post a message to a meeting board channel (as "human") |
| `read_channel` | Read recent messages from a meeting board channel |

### MCP Resources

The server exposes 4 read-only resources for MCP clients to inspect team state:

| Resource URI | Content |
|---|---|
| `devteam://team` | Current `team.yml` contents |
| `devteam://registry` | Generated `agents-registry.json` (agent metadata, tokens, traits) |
| `devteam://traits` | Trait definitions from `templates/traits.yml` |
| `devteam://archetypes` | Archetype definitions from `templates/archetypes.yml` |

### Lifecycle Flow

```
Design                    Generate                Deploy                 Monitor
───────────────────────   ─────────────────────   ────────────────────   ─────────────────
setup_project             generate                deploy                 team_status
set_stack                   │                       │                    agent_logs
set_platform                ├─ agents-registry      ├─ docker compose    restart_agent
add_agent (×N)              ├─ router-agents         │  up -d             post_message
update_agent                ├─ .env.generated        │  (or kubectl       read_channel
preview_personality         ├─ docker-compose.yml    │   apply)
remove_agent                └─ <agent>/persona/      │
get_team                                           teardown
                                                   rebuild_agent
```

The typical flow is: **Design** your team interactively through conversation, **Generate** all artifacts from `team.yml`, **Deploy** to Docker Compose or Kubernetes, then **Monitor** through logs and the Meeting Board. To change a personality, use `update_agent` + `generate` + `rebuild_agent`.

---

## Base Image and 3-Layer Override Pattern

All persona containers share a common base image (`devteam/base`) built from Ubuntu 24.04. The base image includes system packages (curl, git, jq, Node.js 20, Docker CLI), the OpenClaw agent runtime, and the entrypoint script.

### The 3-Layer Configuration Merge

The entrypoint script (`entrypoint.sh`) applies configuration in three layers, where later layers override earlier ones:

```
Layer 1: Base config       /home/agent/.openclaw/config.json     (baked into base image)
Layer 2: Persona config    /home/agent/persona/                  (COPY in persona Dockerfile)
Layer 3: Runtime overrides /overrides/                           (volume mount at runtime)
```

**Layer 1 (Build-time base):** The base `openclaw.base.json` is copied into the image during the base image build. It contains defaults shared by all personas.

**Layer 2 (Build-time persona):** Each persona Dockerfile (`FROM devteam/base:latest`) copies its `openclaw.json`, `workspace/` files (SOUL.md, HEARTBEAT.md, IDENTITY.md, TOOLS.md), and `skills/` directory into `/home/agent/persona/`. The entrypoint deep-merges the persona `openclaw.json` on top of the base config using `jq`, and copies workspace files into the working directory.

**Layer 3 (Runtime overrides):** At container start time, if files exist under `/overrides/workspace/` (via volume mount), they replace the corresponding workspace files. If `/overrides/openclaw.json` exists, it is deep-merged on top of the current config. This allows runtime customization without rebuilding images.

After all three layers are merged, the entrypoint script injects environment variables (`MEETING_BOARD_URL`, `MEETING_BOARD_TOKEN`, `PLANNING_BOARD_URL`, `PLANNING_BOARD_TOKEN`, and API keys) into the final config, replacing `${VAR}` and `${VAR:-default}` placeholder patterns.

The entrypoint then validates the final JSON config, waits for the Meeting Board to become available, and starts the OpenClaw agent runtime in headless mode on port 18789.

### Directory Layout Inside a Running Container

```
/home/agent/
  .openclaw/
    config.json            # Final merged config (all 3 layers + env vars)
  persona/
    openclaw.json          # Layer 2 persona config (as copied during build)
    workspace/
      SOUL.md              # Persona soul
      HEARTBEAT.md         # Heartbeat loop
      IDENTITY.md          # Identity declaration
      TOOLS.md             # Available tools
    skills/
      meeting-board/
        SKILL.md
      planning-board/
        SKILL.md
      ...
  workspace/               # Active working directory
    AGENTS.md              # Team roster (from base image)
    SOUL.md                # Effective soul (persona or override)
    HEARTBEAT.md           # Effective heartbeat
    IDENTITY.md            # Effective identity
    TOOLS.md               # Effective tools
    project/               # Mounted project code (DEV: rw, CQ: ro)

/overrides/                # Layer 3 mount point (empty unless volume-mounted)
  workspace/
    SOUL.md                # Optional runtime override
  openclaw.json            # Optional runtime config override
```

---

## Docker Compose Topology

### Network

All services run on a single bridge network named `devteam`. Containers resolve each other by service name (e.g., `http://meeting-board:8080`, `mongodb://mongo:27017`).

### Volumes

| Volume | Purpose | Used By |
|---|---|---|
| `mongo-data` | MongoDB data persistence | mongo |
| `project-code` / bind mount | Project source code | DEV (rw), CQ (ro) |

DEV mounts the project code as read-write so it can implement features. CQ mounts the same path as read-only so it can review code without modification. OPS mounts the Docker socket to manage containers.

### Port Mappings

| Service | Container Port | Host Port | Purpose |
|---|---|---|---|
| meeting-board | 8080 | 8080 (configurable via `MEETING_BOARD_PORT`) | REST API, WebSocket, Dashboard |
| po | 18789 | 18790 | Agent health check |
| dev | 18789 | 18791 | Agent health check |
| cq | 18789 | 18792 | Agent health check |
| qa | 18789 | 18793 | Agent health check |
| ops | 18789 | 18794 | Agent health check |

MongoDB is not exposed to the host by default; it is only accessible within the `devteam` network.

### Service Dependencies

```
mongo                 (no dependencies, starts first)
  |
  v
meeting-board         (depends on: mongo healthy)
  |
  v
po, dev, cq, qa, ops (each depends on: meeting-board healthy)
```

All persona containers use `depends_on` with `condition: service_healthy` so they do not start until the Meeting Board is accepting connections. The entrypoint script additionally uses `wait-for-it.sh` as a belt-and-suspenders check before starting the agent runtime.

---

## Kubernetes Deployment

The `k8s/` directory contains Kustomize-based manifests for deploying to a Kubernetes cluster.

### Structure

```
k8s/
  kustomization.yaml           # Kustomize entry point
  namespace.yaml               # devteam namespace
  mongo/
    deployment.yaml            # MongoDB Deployment + Service
  meeting-board/
    deployment.yaml            # Meeting Board Deployment + Service
  personas/
    secrets.yaml               # AI API keys, Meeting Board tokens, Planning Board creds
    deployments.yaml           # All 5 persona Deployments/StatefulSets + Services
```

### Key Design Decisions

**Namespace isolation:** Everything runs in the `devteam` namespace with the common label `app.kubernetes.io/part-of: devteam`.

**DEV uses a StatefulSet** while all other personas use Deployments. DEV needs stable, persistent storage for project code (a 10Gi PVC) and a stable network identity. Other personas are stateless and can be freely rescheduled.

**Headless Service for DEV:** The DEV StatefulSet has a headless Service (`clusterIP: None`) so each DEV pod gets a stable DNS name (`dev-0.dev.devteam.svc.cluster.local`). This matters when scaling DEV to multiple replicas -- each gets its own PVC and identity.

**Secrets:** API keys and tokens are stored in Kubernetes Secrets and injected as environment variables via `secretKeyRef`. Three secrets are used:

| Secret | Keys |
|---|---|
| `ai-api-keys` | `xai-api-key`, `anthropic-api-key`, `openai-api-key` |
| `meeting-board-tokens` | `po-token`, `dev-token`, `cq-token`, `qa-token`, `ops-token` |
| `planning-board-creds` | `url`, `token` |

### Resource Requests and Limits

| Persona | Memory Request | Memory Limit | CPU Request | CPU Limit |
|---|---|---|---|---|
| PO, CQ, QA, OPS | 256Mi | 1Gi | 250m | 1 core |
| DEV | 512Mi | 2Gi | 500m | 2 cores |

DEV gets more resources because it runs build tools, test suites, and Docker operations.

### Deploying

```bash
# Create secrets first (not included in repo for security)
kubectl create namespace devteam
kubectl -n devteam create secret generic ai-api-keys \
  --from-literal=xai-api-key=... \
  --from-literal=anthropic-api-key=... \
  --from-literal=openai-api-key=...

# Apply all manifests
make k8s-apply

# Check status
make k8s-status
```

---

## Observability

### Meeting Board Dashboard

The Meeting Board serves an embedded web dashboard at its root URL (`http://localhost:8080`). The dashboard provides:

- Real-time view of all channels and messages (via WebSocket)
- Message history with author attribution
- Channel switching
- Thread view

This is the primary observability tool. Because all communication flows through the Meeting Board, the dashboard shows the complete picture of team activity.

### Audit Log

Every message post and channel creation generates an audit entry in MongoDB. Query the audit log via the API:

```bash
# All audit entries from the last hour
curl -s "http://localhost:8080/api/audit?since=$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)" | jq .

# Entries for a specific actor
curl -s "http://localhost:8080/api/audit?actor=dev&limit=20" | jq .
```

Each entry records:
- `actor` -- which persona or human performed the action
- `action` -- the action type (`message.post`, `channel.create`)
- `details` -- a map with channel ID, message ID, mentions, etc.
- `timestamp` -- when it happened

### Container Logs

```bash
# All services
make logs

# Specific persona
make logs-dev
make logs-po

# Meeting Board only
docker compose logs -f meeting-board
```

The Meeting Board logs every HTTP request with method, path, status code, and duration. The entrypoint script logs the 3-layer config merge process, environment variable injection, and service wait status.

### Health Checks

Every service has a Docker health check:

| Service | Health Check | Interval |
|---|---|---|
| mongo | `mongosh --eval "db.adminCommand('ping')"` | 10s |
| meeting-board | `wget -qO- http://localhost:8080/health` | 10s |
| All personas | Custom `healthcheck.sh` script | 30s |

### Verification: No Direct Bot-to-Bot Communication

The architecture guarantees no direct bot-to-bot API calls by design:

1. Persona containers have no knowledge of each other's hostnames or ports.
2. No persona's environment variables reference another persona's URL.
3. The only URLs a persona knows are `MEETING_BOARD_URL` and `PLANNING_BOARD_URL`.
4. The `devteam` bridge network allows connectivity, but no persona has a reason or mechanism to call another.
5. The audit log provides a complete record of all Meeting Board interactions for verification.

If you want to verify this at runtime, inspect the Meeting Board audit log. Every interaction between personas will appear as message posts and mentions on the Meeting Board -- never as direct HTTP calls between containers.
