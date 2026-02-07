# Extending DevTeam

How to customize agents, design personalities, add team members, scale the team, and adapt the platform to your needs.

---

## Table of Contents

- [Customizing Through MCP](#customizing-through-mcp)
- [Personality System Reference](#personality-system-reference)
- [Advanced: Manual Customization](#advanced-manual-customization)
  - [How to Customize a Persona](#how-to-customize-a-persona)
  - [How to Add a New Persona](#how-to-add-a-new-persona)
  - [How to Add New Skills](#how-to-add-new-skills)
  - [How to Customize the Meeting Board](#how-to-customize-the-meeting-board)
  - [How to Scale DEV](#how-to-scale-dev)
  - [How to Use Different AI Providers](#how-to-use-different-ai-providers)
  - [How to Add New Meeting Board Channels](#how-to-add-new-meeting-board-channels)
- [Summary of Extension Points](#summary-of-extension-points)

---

## Customizing Through MCP

The MCP server provides the easiest path for all common customizations. These tools modify `team.yml` and regenerate artifacts without manual file editing.

### Changing an Agent's Personality

Update the agent's archetype or individual traits, regenerate, and rebuild:

```
"Update Devon's archetype to maverick"
"Update Devon's traits -- set risk_tolerance to 60 and humor to 70"
"Generate the team"
"Rebuild Devon"
```

MCP tools used: `update_agent` → `generate` → `rebuild_agent`

You can preview the resulting personality before committing to a full generation:

```
"Preview Devon's personality"
```

MCP tool: `preview_personality` -- shows the rendered IDENTITY.md and SOUL.md.

### Adding and Removing Agents

Add a new agent with a name, role, provider, archetype, and optional trait overrides:

```
"Add a second developer named Alex with the hustler archetype, using anthropic/claude-sonnet-4-20250514"
"Generate the team"
"Deploy"
```

MCP tools used: `add_agent` → `generate` → `deploy`

Remove an agent:

```
"Remove Alex from the team"
"Generate the team"
"Deploy"
```

MCP tools used: `remove_agent` → `generate` → `deploy`

### Multiple Agents Per Role

You can have multiple agents with the same role (e.g., two DEVs). Each gets a unique name, its own container, and its own personality:

```
"Add a developer named Devon with the craftsperson archetype -- thorough and careful"
"Add a developer named Alex with the hustler archetype -- fast and scrappy"
```

PO will see both in the team roster and can assign work to either. Each DEV gets its own host port (incrementing from `base_port`).

### Changing Providers

Switch an agent's AI provider without changing anything else:

```
"Update Devon's provider to openai/gpt-4o"
"Generate the team"
"Rebuild Devon"
```

MCP tool: `update_agent` (with `provider` field)

### Changing Stack and Platform

```
"Set the stack to Python with Django, React frontend, and PostgreSQL"
"Set the platform to kubernetes with digitalocean as the cloud provider"
```

MCP tools: `set_stack`, `set_platform`

These update `team.yml` and affect the generated deployment manifests and agent skill context.

### Storing Cloud Credentials

For cloud deployments, store credentials that get injected into the OPS agent:

```
"Store cloud credentials -- DOCTL_TOKEN is my-token-123"
```

MCP tool: `set_cloud_credentials`

### Adding Agent Backstories

Give agents personal history, hobbies, and quirks for richer team interactions:

```
"Update Devon's backstory to: Grew up tinkering with ham radios and Linux boxes in rural Oregon. Plays bass in a garage band on weekends. Believes every bug is a puzzle worth savoring."
```

MCP tool: `update_agent` (with `backstory` field) → `generate` → `rebuild_agent`

Backstory can also be set when adding an agent:

```
"Add a QA named Quinn with the detective archetype, backstory: Former forensic accountant who switched to software testing because she missed the thrill of finding discrepancies."
```

MCP tool: `add_agent` (with `backstory` parameter)

### Monitoring and Communication

After deployment, interact with the team through MCP:

```
"Show team status"                    # team_status
"Show logs for Devon"                 # agent_logs
"Restart Carmen"                      # restart_agent
"Post to the standup channel: Good morning team, let's review priorities"  # post_message
"Read the planning channel"           # read_channel
```

---

## Personality System Reference

### Archetypes

Each archetype provides baseline values (0-100) for all 14 traits. Any archetype can be used with any role, though some are designed with specific roles in mind.

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

### Traits

Each trait is scored 0-100 and maps to a tier: **low** (0-33), **mid** (34-66), **high** (67-100).

| Trait | Low | Mid | High |
|---|---|---|---|
| **Assertiveness** | Deferential, goes along with consensus | Confident but flexible | Forceful and direct |
| **Empathy** | Task-focused, feedback is blunt | Balanced, hard truths with framing | Deeply considerate |
| **Thoroughness** | Critical path only | Important + most edge cases | Exhaustive, every boundary |
| **Risk Tolerance** | Conservative, proven patterns | Pragmatic, insists on rollback | Adventurous, ships MVPs |
| **Humor** | All business, dry and factual | Professional with occasional wit | Genuinely funny |
| **Discipline** | Flexible, bends rules | Uses judgment on strictness | Process is law |
| **Initiative** | Stays in lane, waits | Proactive within domain | Anticipates needs |
| **Communication Style** | Terse, bullet points | Clear and structured | Detailed and narrative |
| **Confidence** | Hedges, asks for validation | Appropriately confident | Very self-assured |
| **Patience** | Frustrated quickly | Patient first time, expects improvement | Extremely patient |
| **Perfectionism** | Good enough is good enough | Has standards, won't block on cosmetics | Nothing ships unless excellent |
| **Collaboration** | Independent operator | Team player, invites input | Highly collaborative, seeks consensus |
| **Adaptability** | Prefers stability | Adapts to reasonable changes | Thrives on change |
| **Mentorship** | Does work, doesn't explain | Includes the "why" | Natural teacher |

### Backstory

Each agent can have an optional free-text `backstory` field that adds personal history, family background, hobbies, and quirks. Backstory appears as a "Your Story" section in SOUL.md (between "Who You Are" and "Your Personality") and as a summary line in IDENTITY.md. Agents without a backstory render normally with no empty sections.

```yaml
# In team.yml
- name: Devon
  role: dev
  provider: anthropic/claude-sonnet-4-20250514
  archetype: craftsperson
  backstory: >-
    Grew up tinkering with ham radios and Linux boxes in rural Oregon.
    Plays bass in a garage band on weekends. Believes every bug is a
    puzzle worth savoring.
```

### How Overrides Work

An archetype provides the baseline. Trait overrides merge on top:

```yaml
# In team.yml
- name: Piper
  role: po
  provider: xai/grok-3
  archetype: commander        # Baseline: assertiveness=90, empathy=40, humor=20, ...
  traits:
    empathy: 70               # Override: raise empathy from 40 to 70
    humor: 65                 # Override: raise humor from 20 to 65
```

The result: Piper is still a Commander (decisive, disciplined, high standards) but more empathetic and personable than a default Commander. The overridden trait values determine which tier description (low/mid/high) appears in the generated SOUL.md narrative.

Use `preview_personality` to see the exact output before generating.

---

## Advanced: Manual Customization

The sections below describe how to customize the platform by editing files directly. For most use cases, the MCP tools above are simpler and less error-prone.

### How to Customize a Persona

Each persona's behavior is defined by four workspace files and a configuration JSON. You can override any of these at three levels, listed from heaviest (requires rebuild) to lightest (no rebuild needed).

> **MCP equivalent:** `update_agent` → `generate` → `rebuild_agent`

#### Understanding the Workspace Files

| File | Purpose | Example Content |
|---|---|---|
| `SOUL.md` | Core identity, values, personality, and philosophy | "You are DEV. You are the Builder..." |
| `HEARTBEAT.md` | Prioritized operational loop executed every N minutes | Priority 1: check rejections, Priority 2: new tickets, etc. |
| `IDENTITY.md` | Name, role declaration, team roster context | Short identity card with name and responsibilities |
| `TOOLS.md` | Available tools and how to invoke them | API endpoints, CLI commands, allowed operations |
| `openclaw.json` | AI provider, model, heartbeat interval, role metadata | `{"provider": {"name": "anthropic", "model": "..."}}` |

#### Method 1: Build-Time Override (New Image Layer)

Create a custom Dockerfile that extends the persona image and replaces specific files. This is best for permanent customizations that you want baked into the image.

```dockerfile
FROM devteam/dev:latest

# Override the soul with your custom version
COPY my-custom-SOUL.md /home/agent/persona/workspace/SOUL.md

# Override the heartbeat to change the operational loop
COPY my-custom-HEARTBEAT.md /home/agent/persona/workspace/HEARTBEAT.md

# Override the openclaw config to change the model or heartbeat interval
COPY my-custom-openclaw.json /home/agent/persona/openclaw.json

USER agent
WORKDIR /home/agent/workspace
```

Build your custom image:

```bash
docker build -t my-team/dev:latest -f Dockerfile.custom-dev .
```

Update `docker-compose.yml` to use your custom image:

```yaml
dev:
  image: my-team/dev:latest
  # ... rest of config unchanged
```

#### Method 2: Volume Mount Override (Runtime, No Rebuild)

Mount a directory to `/overrides/workspace/` to replace workspace files at container startup. The entrypoint script copies any files found in the overrides directory into the active workspace, replacing the persona defaults.

> **MCP equivalent:** `update_agent` modifies `team.yml`, then `generate` renders new persona files that are volume-mounted by the generated Compose file.

```yaml
# In docker-compose.yml
dev:
  build:
    context: ./images/dev
    dockerfile: Dockerfile
  volumes:
    - ./my-overrides/dev/workspace:/overrides/workspace:ro
    - ./my-overrides/dev/openclaw.json:/overrides/openclaw.json:ro
    - ${PROJECT_CODE_PATH:-./project}:/home/agent/workspace/project:rw
```

Create your override files:

```
my-overrides/
  dev/
    workspace/
      SOUL.md            # Only include files you want to override
      HEARTBEAT.md       # Missing files keep the persona default
    openclaw.json        # Deep-merged on top of persona + base config
```

The `openclaw.json` override is deep-merged (not replaced). This means you only need to include the fields you want to change:

```json
{
  "heartbeat": {
    "interval_minutes": 5
  }
}
```

This changes the heartbeat interval to 5 minutes while preserving all other config values.

#### Method 3: Environment Variables

Some configuration values can be set purely through environment variables. These are injected into the config by the entrypoint script after all three layers are merged.

```yaml
dev:
  environment:
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    - MEETING_BOARD_URL=http://meeting-board:8080
    - MEETING_BOARD_TOKEN=${MB_TOKEN_DEV}
    - PLANNING_BOARD_URL=${PLANNING_BOARD_URL}
    - PLANNING_BOARD_TOKEN=${PLANNING_BOARD_TOKEN}
```

The entrypoint handles two placeholder formats in `openclaw.json`:

- `${VAR_NAME}` -- replaced with the environment variable value, or left empty if unset
- `${VAR_NAME:-default}` -- replaced with the environment variable value, or `default` if unset

API keys (`ANTHROPIC_API_KEY`, `XAI_API_KEY`, `OPENAI_API_KEY`) are also injected into the config at `api_keys.<provider>` regardless of placeholders.

#### Override Precedence

When the same file or config key appears at multiple layers, the later layer wins:

```
Base config  <  Persona config  <  Runtime override  <  Environment variable
(Layer 1)       (Layer 2)          (Layer 3)            (post-merge injection)
```

---

### How to Add a New Persona

To add a sixth (or seventh, or eighth) persona to the team manually, follow the established pattern.

> **MCP equivalent:** `add_agent` → `generate` → `deploy`

#### Step 1: Create the Persona Directory

```bash
mkdir -p images/newrole/workspace images/newrole/skills/meeting-board images/newrole/skills/planning-board
```

#### Step 2: Create the Required Files

**`images/newrole/Dockerfile`**

```dockerfile
FROM devteam/base:latest

# Copy persona configuration
COPY openclaw.json /home/agent/persona/openclaw.json
COPY workspace/ /home/agent/persona/workspace/
COPY skills/ /home/agent/persona/skills/

USER agent
WORKDIR /home/agent/workspace
```

All persona Dockerfiles follow this exact pattern. The base image handles everything else.

**`images/newrole/openclaw.json`**

```json
{
  "name": "newrole",
  "display_name": "New Role Display Name",
  "provider": {
    "name": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "api_key_env": "ANTHROPIC_API_KEY"
  },
  "persona": {
    "role": "new_role",
    "description": "One-sentence description of what this role does and its key principles."
  },
  "heartbeat": {
    "interval_minutes": 10
  },
  "skills_dir": "/home/agent/persona/skills"
}
```

**`images/newrole/workspace/SOUL.md`**

Write the persona's core identity document. This is the most important file. It defines who the persona is, what it values, how it operates, and what its boundaries are. Study the existing SOUL.md files in `images/po/workspace/`, `images/dev/workspace/`, etc. for the tone and structure.

**`images/newrole/workspace/HEARTBEAT.md`**

Define the prioritized operational loop. This is what the persona does every N minutes. Structure it as numbered priorities (Priority 1 through Priority N) where the persona stops at the first level where it finds actionable work.

**`images/newrole/workspace/IDENTITY.md`**

A short identity card: name, role, one-line description, and team context.

**`images/newrole/workspace/TOOLS.md`**

Document the tools this persona is allowed to use: Meeting Board API endpoints, Planning Board API endpoints, and any role-specific tools (CLI commands, APIs, etc.).

**`images/newrole/skills/meeting-board/SKILL.md`**

Copy from an existing persona and adjust if needed. This teaches the persona how to interact with the Meeting Board API (list channels, post messages, check mentions).

**`images/newrole/skills/planning-board/SKILL.md`**

Copy from an existing persona and adjust. This teaches the persona how to interact with the Planning Board (query tickets, update status, post comments).

#### Step 3: Add to the Build System

Update the `Makefile`:

```makefile
build-personas: build-base ## Build all persona images (requires base)
	docker build -t $(REGISTRY)/po:$(TAG)      ./images/po
	docker build -t $(REGISTRY)/dev:$(TAG)     ./images/dev
	docker build -t $(REGISTRY)/cq:$(TAG)      ./images/cq
	docker build -t $(REGISTRY)/qa:$(TAG)      ./images/qa
	docker build -t $(REGISTRY)/ops:$(TAG)     ./images/ops
	docker build -t $(REGISTRY)/newrole:$(TAG) ./images/newrole

build-newrole: build-base ## Build NewRole image
	docker build -t $(REGISTRY)/newrole:$(TAG) ./images/newrole
```

#### Step 4: Add to Docker Compose

Add a new service block in `docker-compose.yml`:

```yaml
newrole:
  build:
    context: ./images/newrole
    dockerfile: Dockerfile
  container_name: devteam-newrole
  restart: unless-stopped
  networks:
    - devteam
  ports:
    - "18795:18789"
  environment:
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    - MEETING_BOARD_URL=http://meeting-board:8080
    - MEETING_BOARD_TOKEN=${MB_TOKEN_NEWROLE}
    - PLANNING_BOARD_URL=${PLANNING_BOARD_URL}
    - PLANNING_BOARD_TOKEN=${PLANNING_BOARD_TOKEN}
  depends_on:
    meeting-board:
      condition: service_healthy
```

#### Step 5: Add the Auth Token

Update the Meeting Board's `AUTH_TOKENS` to include the new persona:

```yaml
meeting-board:
  environment:
    - AUTH_TOKENS=${AUTH_TOKENS:-po:dev-token,dev:dev-token,cq:dev-token,qa:dev-token,ops:dev-token,newrole:dev-token}
```

Add `MB_TOKEN_NEWROLE` to your `.env` file.

#### Step 6: Add to Kubernetes (Optional)

Add a Deployment to `k8s/personas/deployments.yaml` following the pattern of the existing personas. Add the new token to `k8s/personas/secrets.yaml`.

#### Step 7: Update Mention Detection

The Meeting Board's mention regex in `handlers.go` currently matches `@(po|dev|cq|qa|ops)`. To include the new persona in mention detection, update the regex:

```go
var mentionRe = regexp.MustCompile(`@(po|dev|cq|qa|ops|newrole)`)
```

Rebuild the Meeting Board after this change.

---

### How to Add New Skills

Skills are directories containing a `SKILL.md` file that teaches a persona how to perform a specific capability. The OpenClaw agent runtime discovers skills from the `skills_dir` configured in `openclaw.json`.

#### Creating a Skill

Create a new directory under the persona's `skills/` folder:

```bash
mkdir -p images/dev/skills/my-new-skill
```

Write the skill document:

```markdown
# My New Skill

## What This Skill Does

Describe the capability in 1-2 sentences.

## When To Use This Skill

Describe the trigger conditions -- when should the persona invoke this skill?

## How To Use This Skill

### Step 1: ...

Provide detailed, step-by-step instructions with exact API calls,
CLI commands, or procedures. Include request/response examples.

### Step 2: ...

Continue with subsequent steps.

## Error Handling

Describe what to do when things go wrong.

## Constraints

List any limitations or things the persona should NOT do with this skill.
```

#### Existing Skills by Role

| Role | Skill | Purpose |
|---|---|---|
| PO | meeting-board | Post messages, read channels, check mentions |
| PO | planning-board | Create tickets, assign work, update statuses |
| PO | human-comms | Communicate with human stakeholders |
| DEV | meeting-board | Post updates, read feedback |
| DEV | planning-board | Query assigned tickets, update statuses |
| DEV | git-workflow | Branch, commit, push, create PRs |
| CQ | meeting-board | Post review results |
| CQ | planning-board | Update ticket statuses after review |
| CQ | code-review | Review PRs, check security, rate severity |
| QA | meeting-board | Post test results |
| QA | planning-board | Update ticket statuses after testing |
| QA | test-runner | Execute tests, verify acceptance criteria |
| OPS | meeting-board | Post deployment updates |
| OPS | planning-board | Move tickets to closed after deploy |
| OPS | deploy | Execute deployments with rollback plans |

#### Sharing Skills Across Personas

For the **MCP-driven path**, skills are stored in `templates/skills/<role>/` and copied to each agent of that role during generation. To share a skill across roles, place it in the relevant role directories.

For the **manual path**, each persona has its own copy under `images/<persona>/skills/`. Copy the skill directory to each persona that needs it.

---

### How to Customize the Meeting Board

> These changes require editing Go source code. They are not available through MCP tools.

#### Adding Routes

The Meeting Board is a standard Go microservice using `gorilla/mux`. To add new API endpoints:

1. Add a handler function in `meeting-board/internal/handlers/handlers.go`:

```go
func (h *Handlers) MyNewHandler(w http.ResponseWriter, r *http.Request) {
    // Implementation
    respondJSON(w, http.StatusOK, result)
}
```

2. Register the route in `meeting-board/internal/server/server.go`:

```go
api.HandleFunc("/my-new-endpoint", h.MyNewHandler).Methods("GET")
```

3. Rebuild the Meeting Board:

```bash
make build-meeting-board
```

#### Modifying the Auth Model

The current auth model uses simple Bearer tokens mapped to roles. To change this:

- **Add new roles:** Add entries to the `AUTH_TOKENS` environment variable (manual path) or add agents to `team.yml` (MCP path -- tokens are auto-generated).
- **Add role-based permissions:** Modify `AuthMiddleware` in `handlers.go` to check the resolved role against allowed roles per endpoint.
- **Switch to JWT:** Replace the token map lookup with JWT verification in the middleware.

#### Modifying the Data Model

Models are defined in `meeting-board/internal/models/models.go`. The store layer in `meeting-board/internal/store/store.go` handles MongoDB operations. To add new fields:

1. Add the field to the model struct with `json` and `bson` tags.
2. Update the relevant handler to accept/return the new field.
3. If the field needs indexing, add an index in the store's initialization.

---

### How to Scale DEV

> **MCP equivalent:** Use `add_agent` to add multiple DEV agents with different names and personalities. Each gets its own container automatically.

In the Kubernetes deployment, DEV uses a StatefulSet specifically to support scaling. Each DEV replica gets its own persistent volume for project code and a stable network identity.

#### Scaling in Kubernetes

```bash
kubectl -n devteam scale statefulset dev --replicas=3
```

This creates `dev-0`, `dev-1`, and `dev-2`, each with its own 10Gi PVC. Each DEV instance needs:

- Its own Meeting Board token (or a shared token if you prefer)
- A way to avoid conflicting work (PO should assign different tickets to different DEV instances)

#### Considerations for Multi-DEV

When running multiple DEV instances, you need to address:

**Ticket assignment:** PO needs to know there are multiple developers. Update PO's SOUL.md and HEARTBEAT.md to reference `dev-0`, `dev-1`, etc. as separate assignees, or use a naming convention like `dev-frontend`, `dev-backend`. With the MCP path, this happens automatically -- the generated IDENTITY.md includes the full team roster.

**Git conflicts:** Each DEV works on its own feature branch. As long as PO assigns non-overlapping tickets, conflicts are rare. If two DEVs touch the same files, CQ will catch conflicts during review.

**Meeting Board identity:** Each DEV replica should authenticate with a distinct token so the audit trail distinguishes `dev-0` from `dev-1`. With the MCP path, each agent gets a unique auto-generated token. For the manual path, update `AUTH_TOKENS` accordingly:

```
AUTH_TOKENS=po:...,dev-0:...,dev-1:...,dev-2:...,cq:...,qa:...,ops:...
```

Update the mention regex to match the new names:

```go
var mentionRe = regexp.MustCompile(`@(po|dev-\d+|dev|cq|qa|ops)`)
```

#### Scaling in Docker Compose

Docker Compose does not natively support StatefulSets, but you can define multiple DEV services manually:

```yaml
dev-0:
  build:
    context: ./images/dev
  container_name: devteam-dev-0
  environment:
    - MEETING_BOARD_TOKEN=${MB_TOKEN_DEV_0}
  volumes:
    - ./project-0:/home/agent/workspace/project:rw
  # ...

dev-1:
  build:
    context: ./images/dev
  container_name: devteam-dev-1
  environment:
    - MEETING_BOARD_TOKEN=${MB_TOKEN_DEV_1}
  volumes:
    - ./project-1:/home/agent/workspace/project:rw
  # ...
```

With the MCP path, this is handled automatically -- `generate` creates one service per agent in the Compose file.

---

### How to Use Different AI Providers

> **MCP equivalent:** `update_agent` with a new `provider` field (format: `vendor/model`).

Each persona's AI provider is configured in its `openclaw.json`:

```json
{
  "provider": {
    "name": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "api_key_env": "ANTHROPIC_API_KEY"
  }
}
```

#### Switching a Persona's Provider

To change DEV from Anthropic to OpenAI, for example:

**Option A: Build-time change.** Edit `images/dev/openclaw.json`:

```json
{
  "provider": {
    "name": "openai",
    "model": "gpt-4o",
    "api_key_env": "OPENAI_API_KEY"
  }
}
```

Update `docker-compose.yml` to pass `OPENAI_API_KEY` instead of `ANTHROPIC_API_KEY`:

```yaml
dev:
  environment:
    - OPENAI_API_KEY=${OPENAI_API_KEY}
```

Rebuild: `make build-dev`

**Option B: Runtime override.** Create an override file at `my-overrides/dev/openclaw.json`:

```json
{
  "provider": {
    "name": "openai",
    "model": "gpt-4o",
    "api_key_env": "OPENAI_API_KEY"
  }
}
```

Mount it as a volume and pass the correct API key:

```yaml
dev:
  volumes:
    - ./my-overrides/dev/openclaw.json:/overrides/openclaw.json:ro
  environment:
    - OPENAI_API_KEY=${OPENAI_API_KEY}
```

#### Supported Providers

The current system supports three providers out of the box:

| Provider | Config Name | Models | API Key Env Var |
|---|---|---|---|
| x.ai | `xai` | grok-3 | `XAI_API_KEY` |
| Anthropic | `anthropic` | claude-sonnet-4-20250514, claude-opus-4-5 | `ANTHROPIC_API_KEY` |
| OpenAI | `openai` | gpt-4o | `OPENAI_API_KEY` |

Any provider supported by the OpenClaw runtime can be used. Consult the OpenClaw documentation for the full list of supported providers and models.

#### Changing the Model

To use a different model from the same provider, update only the `model` field:

```json
{
  "provider": {
    "name": "anthropic",
    "model": "claude-opus-4-20250514"
  }
}
```

This can be done via any of the three override methods (build-time edit, volume mount, or runtime override merge). With MCP, use `update_agent` with a new provider string (e.g., `anthropic/claude-opus-4-20250514`).

---

### How to Add New Meeting Board Channels

#### At Runtime via the API

Post to the Meeting Board API to create a new channel:

```bash
curl -X POST http://localhost:8080/api/channels \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <any-valid-token>" \
  -d '{
    "name": "blockers",
    "description": "Blocker reports and escalation threads"
  }'
```

This creates the channel immediately. All personas can see it on their next heartbeat when they list channels.

#### At Startup via Seed Configuration

To add a channel that is always created on startup, modify the `seedChannels` function in `meeting-board/main.go`:

```go
func seedChannels(st *store.Store) {
    defaults := []struct {
        name string
        desc string
    }{
        {"standup", "Daily standup updates and status reports"},
        {"planning", "Sprint planning and task breakdown discussions"},
        {"review", "Code review requests and feedback"},
        {"retrospective", "Sprint retrospective discussions and action items"},
        {"ad-hoc", "General discussion and ad-hoc communication"},
        {"blockers", "Blocker reports and escalation threads"},        // New channel
        {"deployments", "Deployment announcements and status updates"}, // New channel
    }
    // ... rest of function unchanged
}
```

Rebuild and restart:

```bash
make build-meeting-board && make restart
```

Seeded channels use `GetChannelByName` to check for existence before creating, so adding new entries to the seed list will not duplicate existing channels.

#### Updating Personas to Use New Channels

After adding a channel, update the relevant persona's HEARTBEAT.md and skill files to reference it. For example, if you add a `blockers` channel, update PO's HEARTBEAT.md to include checking that channel for new posts.

---

## Summary of Extension Points

| What to Change | MCP Tool | Manual Alternative | Rebuild Required? |
|---|---|---|---|
| Agent personality/archetype | `update_agent` → `generate` → `rebuild_agent` | Edit `workspace/SOUL.md` (volume mount) | No (MCP) or No (volume mount) or Yes (image layer) |
| Agent traits | `update_agent` → `generate` → `rebuild_agent` | Edit `workspace/SOUL.md` (volume mount) | No (MCP) or No (volume mount) or Yes (image layer) |
| Heartbeat loop/priorities | Edit template in `templates/roles/<role>/` | Edit `workspace/HEARTBEAT.md` (volume mount) | No (volume mount) or Yes (image layer) |
| Available tools | Edit template in `templates/roles/<role>/` | Edit `workspace/TOOLS.md` (volume mount) | No (volume mount) or Yes (image layer) |
| AI model or provider | `update_agent` → `generate` → `rebuild_agent` | Edit `openclaw.json` (volume mount) | No (MCP) or No (volume mount) or Yes (image layer) |
| Heartbeat interval | `update_agent` → `generate` → `rebuild_agent` | Edit `openclaw.json` `heartbeat.interval_minutes` | No (MCP) or No (volume mount) |
| API keys | Set in `.env` | Set in `.env` | No |
| Auth tokens | Auto-generated by `generate` | Set in `.env` + `AUTH_TOKENS` | No |
| Add new agent | `add_agent` → `generate` → `deploy` | Full `images/<name>/` directory | No (MCP) or Yes (manual) |
| Remove agent | `remove_agent` → `generate` → `deploy` | Remove from compose + delete image | No (MCP) |
| New skill | Add to `templates/skills/<role>/` → `generate` | Add to `images/<role>/skills/` | Yes (manual) or No (MCP) |
| New Meeting Board channel | `post_message` (creates on first use) | `POST /api/channels` or `main.go` seed | No (API) or Yes (seed) |
| Meeting Board routes | -- | `handlers.go` + `server.go` | Yes |
| DEV replicas | `add_agent` (multiple DEVs) | `kubectl scale` or compose services | No (MCP) or No (k8s) |
| Stack/platform | `set_stack`, `set_platform` → `generate` | -- | No |
| Cloud credentials | `set_cloud_credentials` → `generate` | Set in `.env` | No |
