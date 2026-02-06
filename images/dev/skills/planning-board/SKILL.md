# Skill: Planning Board Interaction

## Overview

This skill covers how DEV interacts with the planning board to manage tickets
through their lifecycle. DEV has LIMITED access to the planning board -- you
can read your assigned tickets, update their status within allowed transitions,
and add comments. You cannot create, delete, or reassign tickets.

## Configuration

| Variable              | Description                        |
|-----------------------|------------------------------------|
| `PLANNING_BOARD_URL`  | Base URL of the planning board API |
| `PLANNING_BOARD_TOKEN`| Bearer token for authentication    |

All requests require the authorization header:
```
Authorization: Bearer ${PLANNING_BOARD_TOKEN}
```

---

## Operations

### 1. List Your Assigned Tickets

Fetch all tickets currently assigned to you, optionally filtered by status.

```bash
curl -s -X GET \
  "${PLANNING_BOARD_URL}/api/tickets?assignee=dev" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" | jq .
```

**Filter by status:**

```bash
curl -s -X GET \
  "${PLANNING_BOARD_URL}/api/tickets?assignee=dev&status=todo" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" | jq .
```

Valid status values: `backlog`, `todo`, `in-progress`, `in-review`, `in-qa`, `completed`, `rfp`, `closed`

**With pagination:**

```bash
curl -s -X GET \
  "${PLANNING_BOARD_URL}/api/tickets?assignee=dev&limit=10&offset=0" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" | jq .
```

### 2. Get a Single Ticket

Fetch full details for a specific ticket including description, acceptance
criteria, and all metadata.

```bash
curl -s -X GET \
  "${PLANNING_BOARD_URL}/api/tickets/TICKET-42" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" | jq .
```

Response includes:
- `id` -- ticket identifier
- `title` -- short title
- `description` -- full description of the work
- `status` -- current status
- `priority` -- priority level (lower number = higher priority)
- `assignee` -- who it is assigned to
- `acceptance_criteria` -- array of criteria that must be met
- `labels` -- array of labels/tags
- `created_at` -- creation timestamp
- `updated_at` -- last modification timestamp

### 3. Update Ticket Status

Move a ticket through the workflow. DEV has four allowed transitions.

**Pick up a ticket (todo -> in-progress):**

```bash
curl -s -X PATCH \
  "${PLANNING_BOARD_URL}/api/tickets/TICKET-42" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in-progress"}'
```

**Submit for review (in-progress -> in-review):**

```bash
curl -s -X PATCH \
  "${PLANNING_BOARD_URL}/api/tickets/TICKET-42" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in-review"}'
```

**Blocked — move back to todo (in-progress -> todo):**

```bash
curl -s -X PATCH \
  "${PLANNING_BOARD_URL}/api/tickets/TICKET-42" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "todo"}'
```

Use this when you have questions for PO and cannot continue. Always add a
comment with your questions before moving back to todo.

**Merge complete — move to rfp (done -> rfp):**

```bash
curl -s -X PATCH \
  "${PLANNING_BOARD_URL}/api/tickets/TICKET-42" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "rfp"}'
```

Use this AFTER merging the PR to main. QA has already passed this ticket
(status was `completed`). Your merge + this status change makes it ready for
release.

**Forbidden transitions (will return 403):**
- Any status -> `completed` (only QA can set this on pass)
- Any status -> `backlog` (only PO can do this)
- Any status -> `cancelled` (only PO can do this)
- `in-review` -> `in-progress` (only CQ/QA can push back)
- Assigning or reassigning tickets

### 4. List Comments on a Ticket

Read all comments on a ticket, or only recent ones.

**All comments:**

```bash
curl -s -X GET \
  "${PLANNING_BOARD_URL}/api/tickets/TICKET-42/comments" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" | jq .
```

**Comments since a specific time (for heartbeat checks):**

```bash
curl -s -X GET \
  "${PLANNING_BOARD_URL}/api/tickets/TICKET-42/comments?since=2025-01-15T10:00:00Z" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" | jq .
```

### 5. Add a Comment to a Ticket

Post a comment on a ticket assigned to you. Use this to communicate progress,
ask clarifying questions, or explain changes made after a rejection.

```bash
curl -s -X POST \
  "${PLANNING_BOARD_URL}/api/tickets/TICKET-42/comments" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"body": "Refactored the auth middleware to reduce complexity. Extracted token validation into a separate helper function per CQ feedback."}'
```

You can only comment on tickets where `assignee` is `dev`. Attempting to
comment on another persona's ticket returns 403.

---

## Permissions Summary

| Action                  | Allowed | Notes                                               |
|-------------------------|---------|-----------------------------------------------------|
| List own tickets        | Yes     | Filter by assignee=dev                              |
| Get any ticket details  | Yes     | Read-only access to all tickets                     |
| Update own ticket status| Yes     | todo→in-progress, in-progress→in-review, in-progress→todo, completed→rfp |
| Comment on own tickets  | Yes     | Only on tickets assigned to dev                     |
| Create tickets          | No      | Only PO can create tickets                          |
| Delete tickets          | No      | Only PO can delete tickets                          |
| Assign tickets          | No      | Only PO can assign tickets                          |
| Change priority         | No      | Only PO can change priority                         |
| Edit ticket description | No      | Only PO can edit descriptions                       |
| Move to completed       | No      | Only QA can move to completed (on pass)             |

---

## Common Patterns

### Heartbeat Priority 1: Check for Completed Work to Merge

```bash
# Get all done tickets (QA passed, need merge)
DONE=$(curl -s -X GET \
  "${PLANNING_BOARD_URL}/api/tickets?assignee=dev&status=completed" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}")

# For each: merge PR, then move to rfp
TICKET_ID=$(echo "$DONE" | jq -r '.tickets[0].id')
# ... merge PR via gh pr merge ...
curl -s -X PATCH \
  "${PLANNING_BOARD_URL}/api/tickets/${TICKET_ID}" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "rfp"}'
```

### Heartbeat Priority 2: Check for Rejections

```bash
# Get all in-progress tickets
TICKETS=$(curl -s -X GET \
  "${PLANNING_BOARD_URL}/api/tickets?assignee=dev&status=in-progress" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}")

# For each ticket, check for recent comments from CQ or QA
TICKET_ID=$(echo "$TICKETS" | jq -r '.tickets[0].id')
COMMENTS=$(curl -s -X GET \
  "${PLANNING_BOARD_URL}/api/tickets/${TICKET_ID}/comments?since=${LAST_HEARTBEAT}" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}")

# Check if any comments indicate a rejection
echo "$COMMENTS" | jq '.comments[] | select(.author == "cq" or .author == "qa")'
```

### Heartbeat Priority 4: Pick Up New Work

```bash
# Get todo tickets, sorted by priority
TODOS=$(curl -s -X GET \
  "${PLANNING_BOARD_URL}/api/tickets?assignee=dev&status=todo" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}")

# Pick the highest priority one
NEXT_TICKET=$(echo "$TODOS" | jq -r '.tickets | sort_by(.priority) | .[0].id')

# Move to in-progress
curl -s -X PATCH \
  "${PLANNING_BOARD_URL}/api/tickets/${NEXT_TICKET}" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in-progress"}'
```

### Blocked: Move Back to Todo

```bash
# Add a comment with your questions
curl -s -X POST \
  "${PLANNING_BOARD_URL}/api/tickets/TICKET-42/comments" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"body": "@po Questions: 1. [question] 2. [question]"}'

# Move back to todo
curl -s -X PATCH \
  "${PLANNING_BOARD_URL}/api/tickets/TICKET-42" \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "todo"}'
```

---

## Error Handling

| HTTP Status | Meaning                                    | Action                          |
|-------------|--------------------------------------------|---------------------------------|
| 200         | Success                                    | Process response                |
| 400         | Bad request (malformed JSON, invalid field)| Check your request body         |
| 401         | Unauthorized (bad or expired token)        | Check PLANNING_BOARD_TOKEN      |
| 403         | Forbidden (not allowed for your role)      | You do not have this permission |
| 404         | Ticket not found                           | Verify the ticket ID            |
| 409         | Conflict (invalid status transition)       | Check allowed transitions       |
| 500         | Server error                               | Retry once, then log and skip   |
