---
name: planning-board
description: Read review queue, post review feedback, and transition tickets through the CQ gate on the Planning Board.
---

# Skill: Planning Board (CQ Gate Permissions)

CQ uses the planning board as the primary interface for the code review pipeline. CQ's access is scoped to gate operations: reading the review queue, posting review feedback, and transitioning tickets through the gate.

## Configuration

- **Base URL**: Provided via the `PLANNING_BOARD_URL` environment variable
- **Auth Token**: Provided via the `PLANNING_BOARD_TOKEN` environment variable
- **All requests** must include the header: `Authorization: Bearer {PLANNING_BOARD_TOKEN}`

## Permissions Summary

| Operation              | Allowed |
|------------------------|---------|
| List/read tickets      | Yes     |
| Read ticket comments   | Yes     |
| Post comments          | Yes     |
| Status: in-review -> in-qa      | Yes (PASS) |
| Status: in-review -> in-progress | Yes (FAIL) |
| Create tickets         | No      |
| Delete tickets         | No      |
| Assign tickets         | No      |
| Edit ticket details    | No      |
| Other status transitions | No    |

## API Reference

### Fetch the Review Queue

Retrieve all tickets waiting for CQ review. Always process oldest first.

```bash
curl -s \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  "${PLANNING_BOARD_URL}/api/tickets?status=in-review"
```

**Response**: Array of ticket objects sorted by creation date.

```json
[
  {
    "id": "TICKET-42",
    "title": "Add user authentication endpoint",
    "status": "in-review",
    "assignee": "dev-be",
    "created_at": "2025-05-10T14:30:00Z",
    "pr_url": "https://github.com/org/repo/pull/42"
  }
]
```

### Get Full Ticket Details

Read the complete ticket to understand requirements and acceptance criteria before reviewing code.

```bash
curl -s \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  "${PLANNING_BOARD_URL}/api/tickets/TICKET-42"
```

**Response**: Full ticket object with description, acceptance criteria, labels, and metadata.

### Read Ticket Comments

Read the entire discussion thread. Prior comments may contain important context, design decisions, or notes from previous review rounds.

```bash
curl -s \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  "${PLANNING_BOARD_URL}/api/tickets/TICKET-42/comments"
```

**Response**: Array of comment objects in chronological order.

### Post a Review Comment

Used for both approvals and rejections. Every status change must be accompanied by a comment.

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "APPROVED. Security review: No secrets in diff, all inputs validated, parameterized queries confirmed. Quality review: Error handling comprehensive, tests cover happy path and edge cases. Clean implementation."
  }' \
  "${PLANNING_BOARD_URL}/api/tickets/TICKET-42/comments"
```

#### Approval Comment Format

```
APPROVED. Security review: [what was verified]. Quality review: [what was checked]. Ship it.
```

Keep it concise but specific. QA and the developer should know what CQ verified.

#### Rejection Comment Format

```
REVIEW FAILED

## Issue 1: [Descriptive Title] (CRITICAL|HIGH|MEDIUM|LOW)
**What's wrong:** [Clear, specific explanation of the problem]
**Why it matters:** [What could go wrong if this ships -- concrete scenario]
**Fix suggestion:**
\```[language]
[Specific code example or step-by-step instructions]
\```

## Issue 2: [Title] (SEVERITY)
...
```

Every rejection must include at minimum: what is wrong, why it matters, and how to fix it. Code examples are strongly preferred when the fix is code-related.

### Move Ticket to in-qa (PASS)

After posting an approval comment, move the ticket forward to QA.

```bash
curl -s -X PUT \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in-qa"}' \
  "${PLANNING_BOARD_URL}/api/tickets/TICKET-42"
```

### Move Ticket to in-progress (FAIL)

After posting a rejection comment with detailed feedback, move the ticket back to the developer.

```bash
curl -s -X PUT \
  -H "Authorization: Bearer ${PLANNING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "in-progress"}' \
  "${PLANNING_BOARD_URL}/api/tickets/TICKET-42"
```

**CRITICAL**: When failing a ticket, BOTH actions are required:
1. Post the detailed rejection comment (with severity, explanation, and fix suggestion)
2. Move the ticket status to `in-progress`

A rejection without a comment leaves the developer confused. A comment without a status change leaves the ticket stuck in the queue. Both. Always. No exceptions.

## Workflow

1. Fetch tickets with `status=in-review`, sorted oldest first
2. For each ticket:
   a. Read full ticket details and all comments
   b. Review the associated code changes (using git/PR tools)
   c. Run security and quality checklists
   d. Either PASS (comment + move to in-qa) or FAIL (comment + move to in-progress)
3. Repeat until the review queue is empty
