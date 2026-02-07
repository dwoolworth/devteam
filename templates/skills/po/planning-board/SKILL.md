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

## Create Ticket

Create a new ticket on the planning board.

```bash
curl -X POST "${PLANNING_BOARD_URL}/api/tickets" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "story",
    "title": "Implement user login form",
    "description": "Create a login form with email and password fields. Form should validate inputs client-side before submission and display server errors inline.",
    "acceptance_criteria": [
      "Form has email field with email format validation",
      "Form has password field with minimum 8 character validation",
      "Submit button is disabled until both fields are valid",
      "Server-side errors display inline below the relevant field",
      "Successful login redirects to the dashboard"
    ],
    "priority": "high",
    "assignee": "dev",
    "parent_id": "EPIC-001",
    "labels": ["frontend", "auth"]
  }'
```

### Create an Epic

```bash
curl -X POST "${PLANNING_BOARD_URL}/api/tickets" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "epic",
    "title": "User Authentication System",
    "description": "Complete authentication system including login, registration, password reset, and session management.",
    "priority": "critical",
    "labels": ["auth", "mvp"]
  }'
```

### Create a Bug

```bash
curl -X POST "${PLANNING_BOARD_URL}/api/tickets" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "bug",
    "title": "Login form submits with empty password field",
    "description": "When the user clears the password field after it was previously valid, the form still submits. Client-side validation is not re-evaluating on field clear.",
    "acceptance_criteria": [
      "Form does not submit when password field is empty",
      "Submit button becomes disabled when password is cleared"
    ],
    "priority": "high",
    "assignee": "dev",
    "parent_id": "STORY-042",
    "labels": ["bug", "frontend", "auth"]
  }'
```

---

## Query Tickets

### Get a Specific Ticket by ID

```bash
curl -X GET "${PLANNING_BOARD_URL}/api/tickets/STORY-042" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Query by Status

```bash
curl -X GET "${PLANNING_BOARD_URL}/api/tickets?status=in-review" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Query by Assignee

```bash
curl -X GET "${PLANNING_BOARD_URL}/api/tickets?assignee=dev" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Query by Multiple Filters

```bash
curl -X GET "${PLANNING_BOARD_URL}/api/tickets?status=in-progress&assignee=dev&priority=high" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Query by Date Range

```bash
curl -X GET "${PLANNING_BOARD_URL}/api/tickets?updated_after=2025-01-15T00:00:00Z&updated_before=2025-01-16T00:00:00Z" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Query Unassigned Tickets in Todo

```bash
curl -X GET "${PLANNING_BOARD_URL}/api/tickets?status=todo&assignee=none" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Free Text Search

```bash
curl -X GET "${PLANNING_BOARD_URL}/api/tickets?search=login%20form" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Query by Label

```bash
curl -X GET "${PLANNING_BOARD_URL}/api/tickets?label=frontend" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Query by Type

```bash
curl -X GET "${PLANNING_BOARD_URL}/api/tickets?type=epic" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Get Children of an Epic

```bash
curl -X GET "${PLANNING_BOARD_URL}/api/tickets?parent_id=EPIC-001" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

---

## Update Ticket

### Change Ticket Status (Workflow Enforcement)

This is PO's most critical update operation. Used to fix Quinn Problems and enforce the lifecycle.

```bash
curl -X PATCH "${PLANNING_BOARD_URL}/api/tickets/STORY-042" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in-progress"
  }'
```

### Reassign a Ticket

```bash
curl -X PATCH "${PLANNING_BOARD_URL}/api/tickets/STORY-042" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "assignee": "dev"
  }'
```

### Update Acceptance Criteria

```bash
curl -X PATCH "${PLANNING_BOARD_URL}/api/tickets/STORY-042" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "acceptance_criteria": [
      "Form has email field with email format validation",
      "Form has password field with minimum 8 character validation",
      "Submit button is disabled until both fields are valid",
      "Server-side errors display inline below the relevant field",
      "Successful login redirects to the dashboard",
      "Form shows loading spinner during submission"
    ]
  }'
```

### Change Priority

```bash
curl -X PATCH "${PLANNING_BOARD_URL}/api/tickets/STORY-042" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "priority": "critical"
  }'
```

### Update Multiple Fields at Once

```bash
curl -X PATCH "${PLANNING_BOARD_URL}/api/tickets/STORY-042" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in-progress",
    "assignee": "dev",
    "priority": "high",
    "labels": ["frontend", "auth", "urgent"]
  }'
```

### Update Title and Description

```bash
curl -X PATCH "${PLANNING_BOARD_URL}/api/tickets/STORY-042" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Implement user login form with validation",
    "description": "Updated scope: Create a login form with email and password fields. Include client-side and server-side validation. Add rate limiting feedback to the user."
  }'
```

---

## Delete Ticket

Use sparingly. Only for duplicates, tickets created in error, or tickets that are no longer relevant.

```bash
curl -X DELETE "${PLANNING_BOARD_URL}/api/tickets/STORY-099" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

---

## Assign Ticket

Convenience endpoint for assignment. Equivalent to a PATCH with only the `assignee` field.

```bash
curl -X PUT "${PLANNING_BOARD_URL}/api/tickets/STORY-042/assignee" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "assignee": "dev"
  }'
```

### Unassign a Ticket

```bash
curl -X PUT "${PLANNING_BOARD_URL}/api/tickets/STORY-042/assignee" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "assignee": null
  }'
```

---

## Read Comments (Quinn Problem Detection)

Read the comment history for a ticket. Essential for detecting failure comments that were not accompanied by a status change.

```bash
curl -X GET "${PLANNING_BOARD_URL}/api/tickets/STORY-042/comments" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

**Response structure**:
```json
{
  "ticket_id": "STORY-042",
  "comments": [
    {
      "id": "comment-001",
      "author": "qa",
      "timestamp": "2025-01-15T14:30:00Z",
      "body": "FAIL: Password field accepts 3-character passwords. Acceptance criteria requires minimum 8. See screenshot attached.",
      "status_at_time": "in-qa"
    },
    {
      "id": "comment-002",
      "author": "po",
      "timestamp": "2025-01-15T14:45:00Z",
      "body": "WORKFLOW VIOLATION: QA posted failure but did not move ticket to in-progress. Fixed.",
      "status_at_time": "in-progress"
    }
  ]
}
```

### Quinn Problem Detection Pattern

For each ticket in `in-review` or `in-qa`:
1. Fetch comments.
2. Find the most recent comment.
3. Check if it contains failure language: `fail`, `reject`, `broken`, `does not meet`, `defect`, `bug`, `not passing`, `incorrect`, `wrong`, `missing`, `needs fix`, `sending back`, `cannot approve`, `does not pass`.
4. If yes, check the ticket's current status. If it is still `in-review` or `in-qa` (not moved to `in-progress`), it is a Quinn Problem.

---

## Read Status History (Bounce Detection)

Read the full status transition log for a ticket. Used to detect tickets that keep bouncing between statuses.

```bash
curl -X GET "${PLANNING_BOARD_URL}/api/tickets/STORY-042/history" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

**Response structure**:
```json
{
  "ticket_id": "STORY-042",
  "transitions": [
    {
      "from_status": "todo",
      "to_status": "in-progress",
      "changed_by": "dev",
      "timestamp": "2025-01-15T09:00:00Z"
    },
    {
      "from_status": "in-progress",
      "to_status": "in-review",
      "changed_by": "dev",
      "timestamp": "2025-01-15T11:00:00Z"
    },
    {
      "from_status": "in-review",
      "to_status": "in-progress",
      "changed_by": "cq",
      "timestamp": "2025-01-15T12:00:00Z"
    },
    {
      "from_status": "in-progress",
      "to_status": "in-review",
      "changed_by": "dev",
      "timestamp": "2025-01-15T14:00:00Z"
    }
  ]
}
```

### Bounce Detection Pattern

1. Count the number of transitions for a ticket.
2. If >3 transitions, the ticket is bouncing.
3. If >5 transitions, the ticket needs intervention — call an ad-hoc meeting.

---

## Batch Operations

### Get Board Summary (Tickets Per Status)

```bash
curl -X GET "${PLANNING_BOARD_URL}/api/board/summary" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

**Response structure**:
```json
{
  "backlog": 12,
  "todo": 5,
  "in-progress": 3,
  "in-review": 1,
  "in-qa": 2,
  "completed": 28
}
```

### Get Team Workload

```bash
curl -X GET "${PLANNING_BOARD_URL}/api/board/workload" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

**Response structure**:
```json
{
  "dev": { "in-progress": 2, "in-review": 1, "total_active": 3 },
  "cq": { "in-progress": 0, "in-review": 2, "total_active": 2 },
  "qa": { "in-progress": 1, "in-qa": 1, "total_active": 2 },
  "ops": { "in-progress": 1, "in-review": 0, "total_active": 1 }
}
```

---

## Initiative Breakdown Workflow

This is the end-to-end workflow for processing initiative tickets created by human stakeholders.

### Step 1: Query for Initiative Tickets

Find initiative tickets assigned to PO in TODO status.

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets?assignee=po&status=todo&label=initiative" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Step 2: Read Initiative Details

For each initiative ticket found, read its full details including description and any existing comments.

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets/INIT-001" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets/INIT-001/comments" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

### Step 3: Post Clarification Comment (If Needed)

If the initiative lacks sufficient detail for decomposition, add a comment with specific questions.

```bash
curl -s -X POST "${PLANNING_BOARD_URL}/api/tickets/INIT-001/comments" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "Reviewing this initiative. Need clarification on the following before I can decompose:\n\n1. What is the expected scope — MVP or full feature?\n2. Are there specific performance requirements?\n3. What is the priority relative to current in-progress work?\n\nPlease reply on this ticket.",
    "author": "po"
  }'
```

**Important**: Do NOT change the initiative ticket's status when asking for clarification. It stays in `todo` until you close it.

### Step 4: Create Parent Epic(s)

Create Epics that map to the initiative. Each Epic MUST include the `initiative:INIT-XXX` label for traceability.

```bash
curl -s -X POST "${PLANNING_BOARD_URL}/api/tickets" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "epic",
    "title": "User Authentication System",
    "description": "Complete authentication system including login, registration, password reset, and session management. Spawned from initiative INIT-001.",
    "priority": "high",
    "labels": ["auth", "initiative:INIT-001"]
  }'
```

### Step 5: Create Stories Under Epics

Create Stories with acceptance criteria under each Epic. Each Story MUST also carry the `initiative:INIT-XXX` label.

```bash
curl -s -X POST "${PLANNING_BOARD_URL}/api/tickets" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "story",
    "title": "Implement user login form with validation",
    "description": "Create a login form with email and password fields. Validate client-side before submission. Display server errors inline.",
    "acceptance_criteria": [
      "Form has email field with email format validation",
      "Form has password field with minimum 8 character validation",
      "Submit button is disabled until both fields are valid",
      "Server-side errors display inline below the relevant field",
      "Successful login redirects to the dashboard"
    ],
    "priority": "high",
    "assignee": "dev",
    "parent_id": "EPIC-010",
    "labels": ["frontend", "auth", "initiative:INIT-001"]
  }'
```

### Step 6: Close the Initiative Ticket

Once all Epics and Stories are created, close the initiative ticket with a summary listing all child IDs.

```bash
curl -s -X PATCH "${PLANNING_BOARD_URL}/api/tickets/INIT-001" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed"
  }'
```

```bash
curl -s -X POST "${PLANNING_BOARD_URL}/api/tickets/INIT-001/comments" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "Status: DONE\nAgent: po\n\n## Initiative Decomposition Complete\n\nThis initiative has been broken down into the following work items:\n\n### Epics\n- EPIC-010: User Authentication System\n\n### Stories\n- STORY-050: Implement user login form with validation (assigned to @dev)\n- STORY-051: Implement user registration flow (assigned to @dev)\n- STORY-052: Implement password reset via email (assigned to @dev)\n- STORY-053: Add session management and token refresh (assigned to @dev)\n\nAll stories have acceptance criteria. Work will begin in priority order.\n\nTraceability: All child tickets carry the label `initiative:INIT-001`.",
    "author": "po"
  }'
```

### Step 7: Query Children by Initiative Label (Traceability)

At any time, query all work items spawned from a specific initiative.

```bash
curl -s -X GET "${PLANNING_BOARD_URL}/api/tickets?label=initiative:INIT-001" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}"
```

This returns all Epics, Stories, Tasks, and Bugs that carry the initiative traceability label. Use this for progress tracking, human status updates, and retrospectives.
