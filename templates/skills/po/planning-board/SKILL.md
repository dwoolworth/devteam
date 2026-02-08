---
name: planning-board
description: Full CRUD access to the Planning Board for creating, reading, updating, and deleting tickets.
---

# Skill: Planning Board (Full CRUD)

PO has full, unrestricted access to the Planning Board. This skill covers every operation available: creating tickets, reading and querying tickets, updating any field, deleting tickets, assigning work, managing statuses, and reading comment and status histories.

---

## Configuration

- **Base URL**: `${PLANNING_BOARD_URL}` (set via environment variable)
- **Auth Header**: `Authorization: Bearer ${PLANNING_BOARD_TOKEN}`
- **Content Type**: `application/json`

All examples below use these variables. Replace with actual values at runtime.

---

## Ticket Types

There are exactly three ticket types:

- **initiative** — A high-level request from human stakeholders. PO decomposes initiatives into epics and stories.
- **epic** — A large body of work that groups related stories. Created by PO during initiative decomposition.
- **story** — A single unit of deliverable work with acceptance criteria. The default type.

There are no other types. Do not use `bug`, `task`, `subtask`, or `feature` — they will be rejected by the API.

Ticket numbers use the format `MNS-{N}` for all types (e.g., `MNS-1`, `MNS-42`). There are no per-type prefixes.

---

## Create Ticket

### Create a Story (default type)

```bash
curl -s -X POST "${PLANNING_BOARD_URL}/api/tickets" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"type\": \"story\", \"title\": \"Implement user login form\", \"description\": \"Create a login form with email and password fields.\\n\\n## Acceptance Criteria\\n- [ ] Form has email field with validation\\n- [ ] Form has password field (min 8 chars)\\n- [ ] Submit button disabled until valid\\n- [ ] Server errors display inline\", \"priority\": 4, \"assignee\": \"${EXAMPLE_DEV_EMAIL}\", \"labels\": [\"frontend\", \"auth\"]}"
```

### Create an Epic

```bash
curl -s -X POST "${PLANNING_BOARD_URL}/api/tickets" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"type\": \"epic\", \"title\": \"User Authentication System\", \"description\": \"Complete authentication system including login, registration, password reset, and session management.\", \"priority\": 4, \"labels\": [\"auth\", \"mvp\"]}"
```

### Create an Initiative

```bash
curl -s -X POST "${PLANNING_BOARD_URL}/api/tickets" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"type\": \"initiative\", \"title\": \"Build user onboarding flow\", \"description\": \"Users need a guided onboarding experience after registration.\", \"priority\": 3}"
```

**Notes**:
- `type` defaults to `story` if omitted.
- `priority` is a number: 1 (lowest) to 5 (critical).
- `assignee` is an email like `${EXAMPLE_DEV_EMAIL}`, not a role name.
- Include acceptance criteria as markdown checkboxes inside the `description` field. There is no separate `acceptance_criteria` field.
- `boardId` is optional — the API auto-selects the default board if omitted.

---

## Query Tickets

### Get a Specific Ticket by Ticket Number

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets/MNS-22" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Query by Status

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets?status=in-review" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Query by Type

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets?type=initiative" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets?type=epic" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Query by Assignee

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets?assignee=${EXAMPLE_DEV_EMAIL}" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Query Unassigned Tickets

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets?assignee=none&status=todo" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Query by Multiple Filters

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets?status=in-progress&type=story&priority=4" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Free Text Search

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets?search=login%20form" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Query by Label

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets?label=auth" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Query by Date Range

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets?updated_after=2025-01-15T00:00:00Z&updated_before=2025-01-16T00:00:00Z" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

---

## Update Ticket

### Change Ticket Status

```bash
curl -s -X PATCH "${PLANNING_BOARD_URL}/api/tickets/MNS-22" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"status\": \"in-progress\"}"
```

### Reassign a Ticket

```bash
curl -s -X PATCH "${PLANNING_BOARD_URL}/api/tickets/MNS-22" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"assignee\": \"${EXAMPLE_DEV_EMAIL}\"}"
```

### Change Priority

```bash
curl -s -X PATCH "${PLANNING_BOARD_URL}/api/tickets/MNS-22" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"priority\": 5}"
```

### Change Type

```bash
curl -s -X PATCH "${PLANNING_BOARD_URL}/api/tickets/MNS-22" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"type\": \"epic\"}"
```

### Update Multiple Fields

```bash
curl -s -X PATCH "${PLANNING_BOARD_URL}/api/tickets/MNS-22" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"status\": \"in-progress\", \"assignee\": \"${EXAMPLE_DEV_EMAIL}\", \"priority\": 4}"
```

### Update Title and Description

```bash
curl -s -X PATCH "${PLANNING_BOARD_URL}/api/tickets/MNS-22" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"title\": \"Implement user login form with validation\", \"description\": \"Updated scope: include rate limiting feedback.\"}"
```

---

## Delete Ticket

Use sparingly. Only for duplicates or tickets created in error.

```bash
curl -s -X DELETE "${PLANNING_BOARD_URL}/api/tickets/MNS-99" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

---

## Assign / Unassign (Convenience Endpoint)

```bash
curl -s -X PUT "${PLANNING_BOARD_URL}/api/tickets/MNS-22/assignee" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"assignee\": \"${EXAMPLE_DEV_EMAIL}\"}"
```

### Unassign

```bash
curl -s -X PUT "${PLANNING_BOARD_URL}/api/tickets/MNS-22/assignee" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"assignee\": null}"
```

---

## Comments

### Read Comments

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets/MNS-22/comments" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Add Comment

```bash
curl -s -X POST "${PLANNING_BOARD_URL}/api/tickets/MNS-22/comments" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"body\": \"Reviewing this ticket. Acceptance criteria look good.\"}"
```

---

## Status History

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets/MNS-22/history" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

---

## Board Summary

### Tickets Per Status

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/board/summary" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Team Workload

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/board/workload" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

---

## Backlog Rank vs Priority

The board separates two concepts:

- **Priority** (1-5) — Categorical importance: 1 = Lowest, 2 = Low, 3 = Medium, 4 = High, 5 = Critical. Set when creating or updating a ticket. Shown as a colored badge on the backlog and as a color bar on board cards.
- **Rank** (1 to N) — Ordinal backlog position. Determines the order tickets appear in the backlog view. Managed by drag-and-drop reordering in the UI or by the reorder API endpoint.

**Key rules**:
- Changing priority does NOT change rank. A "Critical" ticket can be at any backlog position.
- Dragging a ticket in the backlog changes its rank but never its priority.
- New tickets get an auto-computed rank based on priority (higher-priority tickets insert near the top of the backlog).
- The `rank` field cannot be set via `PATCH /api/tickets/:id` — it is only changeable through the reorder endpoint.

### Reorder Backlog

```bash
curl -s -X POST "${PLANNING_BOARD_URL}/api/tasks/reorder" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"order\": [{\"id\": \"TASK_OBJECT_ID_1\", \"order\": 0}, {\"id\": \"TASK_OBJECT_ID_2\", \"order\": 1}]}"
```

Each item in the `order` array maps a task ObjectId to its new position. The API sets `rank = index + 1` for each item.

---

## Available Ticket Types

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/ticket-types" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

Returns: `["initiative", "epic", "story"]`

---

## Initiative Decomposition Workflow

### Step 1: Find New Initiatives

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets?type=initiative&status=todo" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Step 2: Read Initiative Details

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets/MNS-5" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Step 3: Create Epics

Create epics with a label linking back to the initiative ticket number.

```bash
curl -s -X POST "${PLANNING_BOARD_URL}/api/tickets" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"type\": \"epic\", \"title\": \"User Authentication System\", \"description\": \"Complete auth system. Spawned from MNS-5.\", \"priority\": 4, \"labels\": [\"auth\", \"initiative:MNS-5\"]}"
```

### Step 4: Create Stories Under Epics

```bash
curl -s -X POST "${PLANNING_BOARD_URL}/api/tickets" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"type\": \"story\", \"title\": \"Implement login form\", \"description\": \"Login form with validation.\\n\\n## Acceptance Criteria\\n- [ ] Email field with format validation\\n- [ ] Password field (min 8 chars)\\n- [ ] Disabled submit until valid\", \"priority\": 4, \"assignee\": \"${EXAMPLE_DEV_EMAIL}\", \"labels\": [\"auth\", \"initiative:MNS-5\"]}"
```

### Step 5: Close the Initiative

```bash
curl -s -X PATCH "${PLANNING_BOARD_URL}/api/tickets/MNS-5" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"status\": \"completed\"}"
```

Add a summary comment listing all created tickets:

```bash
curl -s -X POST "${PLANNING_BOARD_URL}/api/tickets/MNS-5/comments" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"body\": \"Initiative decomposed. Created: MNS-10 (epic), MNS-11 through MNS-14 (stories). All tagged with initiative:MNS-5.\"}"
```

### Step 6: Query by Initiative Label (Traceability)

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets?label=initiative:MNS-5" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```
