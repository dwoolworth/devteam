---
name: planning-board
description: Read tickets, post test result comments, and change ticket status as part of the QA gate on the Planning Board.
---

# QA Planning Board Skill

## Overview
QA has gate permissions on the planning board. You are authorized to read tickets, post detailed test result comments, and change ticket status as part of the QA gate in the pipeline.

## Permissions

| Action          | Allowed | Notes                                    |
|-----------------|---------|------------------------------------------|
| GET tickets     | Yes     | Filter by status, read all fields        |
| POST comments   | Yes     | Detailed test results on any ticket      |
| PUT status      | Yes     | in-qa -> rfp (pass), in-qa -> in-progress (fail) |
| POST tickets    | No      | Cannot create tickets                    |
| DELETE tickets  | No      | Cannot delete tickets                    |
| PUT assignee    | No      | Cannot assign tickets                    |

## API Usage

### Fetch Tickets in QA Queue

```bash
curl -s "${PLANNING_BOARD_URL}/api/tickets?status=in-qa" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json"
```

Returns all tickets currently in the `in-qa` status. Process them oldest first based on the `updated_at` or `moved_at` timestamp.

### Fetch a Single Ticket with Full Details

```bash
curl -s "${PLANNING_BOARD_URL}/api/tickets/${TICKET_ID}" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json"
```

Returns the full ticket including description, acceptance criteria, comments, history, and current status.

### Post a PASS Comment

```bash
curl -s -X POST "${PLANNING_BOARD_URL}/api/tickets/${TICKET_ID}/comments" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "author": "qa",
    "type": "qa_pass",
    "body": "## QA PASS\n\nAll acceptance criteria verified:\n\n- [x] Criterion 1: Verified - [details]\n- [x] Criterion 2: Verified - [details]\n- [x] Criterion 3: Verified - [details]\n\nTicket is ready for production."
  }'
```

### Post a FAIL Comment (Quinn Rule - Step 1 of 2)

```bash
curl -s -X POST "${PLANNING_BOARD_URL}/api/tickets/${TICKET_ID}/comments" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "author": "qa",
    "type": "qa_fail",
    "body": "## QA FAIL\n\n### Failed Criteria\n- [ ] Criterion 2: FAILED\n\n### Steps to Reproduce\n1. Start from clean state\n2. Navigate to [location]\n3. Perform [action]\n4. Observe [result]\n\n### Expected Behavior\n[What the acceptance criteria specifies should happen]\n\n### Actual Behavior\n[What actually happened, with specifics]\n\n### Severity\n[Critical | Major | Minor]\n\n### Passing Criteria\n- [x] Criterion 1: Verified\n- [x] Criterion 3: Verified"
  }'
```

### Move Ticket to RFP (PASS)

```bash
curl -s -X PUT "${PLANNING_BOARD_URL}/api/tickets/${TICKET_ID}/status" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "rfp",
    "changed_by": "qa"
  }'
```

### Move Ticket to In-Progress (FAIL - Quinn Rule - Step 2 of 2)

```bash
curl -s -X PUT "${PLANNING_BOARD_URL}/api/tickets/${TICKET_ID}/status" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in-progress",
    "changed_by": "qa"
  }'
```

**CRITICAL: When failing a ticket, you MUST execute BOTH the comment POST and the status PUT. This is the Quinn Rule. A comment without a status change leaves the ticket stranded in `in-qa` and stalls the pipeline.**

## Workflow Reminders

- Always post the comment BEFORE changing the status, so the comment is visible when DEV picks up the ticket
- On PASS: comment first, then move to `rfp`
- On FAIL: comment first, then move to `in-progress` (THE QUINN RULE - both are mandatory)
- Failed tickets re-enter the full pipeline: DEV fixes -> CQ reviews -> QA tests again
