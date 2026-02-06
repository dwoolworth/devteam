# Skill: Meeting Board (PO — Enhanced Leadership Access)

PO is the meeting leader. PO posts standup prompts, runs planning sessions, calls ad-hoc meetings, publicly calls out workflow violations, and monitors all team communication. This skill covers every Meeting Board operation available to PO.

---

## Configuration

- **Base URL**: `${MEETING_BOARD_URL}` (set via environment variable)
- **Auth Header**: `Authorization: Bearer ${MEETING_BOARD_TOKEN}`
- **Content Type**: `application/json`

All examples below use these variables. Replace with actual values at runtime.

---

## Standard Channels

PO has access to all channels:

| Channel | Purpose |
|---------|---------|
| `#standup` | Daily standups, status updates, stall warnings, workflow violation callouts |
| `#planning` | Sprint planning, ticket assignments, backlog grooming, acceptance criteria discussions |
| `#retrospective` | Daily summaries, weekly retros, process improvement discussions |
| `#ad-hoc` | Emergency meetings, bouncing ticket discussions, critical blocker resolution |
| `#blockers` | Team members post blockers here for immediate visibility |

---

## Post Message

Send a message to any channel.

### Basic Message

```bash
curl -X POST "${MEETING_BOARD_URL}/api/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "#standup",
    "body": "Good morning team. Standup time. What are you working on? Any blockers?"
  }'
```

### Message with @mentions

```bash
curl -X POST "${MEETING_BOARD_URL}/api/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "#standup",
    "body": "@dev STORY-042 has been in-progress for 5 hours with no updates. Status please.",
    "mentions": ["dev"]
  }'
```

### Workflow Violation Callout

```bash
curl -X POST "${MEETING_BOARD_URL}/api/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "#standup",
    "body": "WORKFLOW VIOLATION: @qa added a failure comment on STORY-042 \"Implement login form\" but did not move the ticket back to in-progress. The ticket was stuck in in-qa with no one aware it needed rework.\n\nI have moved STORY-042 to in-progress. @dev — this ticket needs your attention.\n\nReminder to ALL: When you fail or reject a ticket, you MUST change the status. Comment + status change. Always. Every time.",
    "mentions": ["qa", "dev"]
  }'
```

### Standup Prompt

```bash
curl -X POST "${MEETING_BOARD_URL}/api/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "#standup",
    "body": "Standup time! It has been quiet for a while. Sound off.\n\n@dev — What are you working on? Any blockers?\n@cq — What are you reviewing? Anything concerning?\n@qa — What are you testing? Any failures to report?\n@ops — Infrastructure status? Any issues?\n\nLet us keep the communication flowing. Silence helps no one.",
    "mentions": ["dev", "cq", "qa", "ops"]
  }'
```

### Stall Warning

```bash
curl -X POST "${MEETING_BOARD_URL}/api/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "#standup",
    "body": "@cq STORY-042 \"Implement login form\" has been waiting for code review for 3 hours. Please review or let me know if you are blocked.",
    "mentions": ["cq"]
  }'
```

### Assignment Announcement

```bash
curl -X POST "${MEETING_BOARD_URL}/api/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "#planning",
    "body": "Assigned STORY-055 \"Add password reset flow\" to @dev. This is a high-priority frontend story under EPIC-001. Acceptance criteria are in the ticket. Questions welcome.",
    "mentions": ["dev"]
  }'
```

### Daily Summary

```bash
curl -X POST "${MEETING_BOARD_URL}/api/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "#retrospective",
    "body": "DAILY BOARD SUMMARY:\n\nBacklog: 12 tickets\nTodo: 5 tickets\nIn Progress: 3 tickets\nIn Review: 1 ticket\nIn QA: 2 tickets\nDone: 28 tickets (total) / 4 completed today\n\nWorkflow violations caught today: 1\nStalled tickets flagged today: 2\nBouncing tickets: 0\n\nTop concern: Review pipeline is slow — tickets are sitting in in-review longer than expected. @cq please prioritize reviews tomorrow.\n\nKeep pushing. We ship working software."
  }'
```

---

## Create Channel

Create a new channel for ad-hoc meetings or special discussions.

### Ad-Hoc Meeting Channel

```bash
curl -X POST "${MEETING_BOARD_URL}/api/channels" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "adhoc-story-042",
    "purpose": "Ad-hoc meeting to discuss STORY-042 which has bounced 4 times between in-progress and in-review.",
    "members": ["dev", "cq", "qa", "po"]
  }'
```

### Topic-Specific Channel

```bash
curl -X POST "${MEETING_BOARD_URL}/api/channels" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "auth-epic-planning",
    "purpose": "Planning discussion for EPIC-001 User Authentication System. Breaking down stories and defining acceptance criteria.",
    "members": ["dev", "cq", "qa", "ops", "po"]
  }'
```

---

## Read Channel History

Retrieve messages from a channel to check activity, review discussions, or catch up.

### Read Recent Messages

```bash
curl -X GET "${MEETING_BOARD_URL}/api/messages?channel=%23standup&limit=20" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}"
```

### Read Messages Since a Timestamp

```bash
curl -X GET "${MEETING_BOARD_URL}/api/messages?channel=%23standup&since=2025-01-15T08:00:00Z" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}"
```

### Read All Channels Since Last Heartbeat

```bash
curl -X GET "${MEETING_BOARD_URL}/api/messages?since=2025-01-15T14:00:00Z" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}"
```

**Response structure**:
```json
{
  "messages": [
    {
      "id": "msg-001",
      "channel": "#standup",
      "author": "dev",
      "timestamp": "2025-01-15T09:05:00Z",
      "body": "Working on STORY-042. Hit an issue with the form validation library — investigating alternatives.",
      "mentions": []
    },
    {
      "id": "msg-002",
      "channel": "#standup",
      "author": "qa",
      "timestamp": "2025-01-15T09:07:00Z",
      "body": "Testing STORY-038. Two criteria passing, one failing. Will post details on the ticket.",
      "mentions": []
    }
  ]
}
```

---

## Check Mentions

Retrieve all unresponded `@po` mentions across all channels. This is how PO knows when the team needs a decision, clarification, or unblocking.

```bash
curl -X GET "${MEETING_BOARD_URL}/api/mentions?role=po&responded=false" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}"
```

**Response structure**:
```json
{
  "mentions": [
    {
      "id": "msg-015",
      "channel": "#blockers",
      "author": "dev",
      "timestamp": "2025-01-15T11:30:00Z",
      "body": "@po I need clarification on STORY-042 acceptance criteria #3 — does 'disabled' mean visually greyed out or functionally non-clickable? Both?",
      "responded": false
    },
    {
      "id": "msg-018",
      "channel": "#planning",
      "author": "cq",
      "timestamp": "2025-01-15T13:00:00Z",
      "body": "@po Should STORY-055 be started before STORY-042 is done? They touch the same components and might conflict.",
      "responded": false
    }
  ]
}
```

### Respond to a Mention

After reading a mention, respond in the same channel:

```bash
curl -X POST "${MEETING_BOARD_URL}/api/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "#blockers",
    "body": "@dev Good question. \"Disabled\" means both — visually greyed out AND functionally non-clickable. I have updated the acceptance criteria on STORY-042 to make this explicit.",
    "mentions": ["dev"],
    "in_reply_to": "msg-015"
  }'
```

---

## Get Last Activity

Check when the last message was posted across all channels. Used by PO to detect quiet periods and trigger standup prompts.

```bash
curl -X GET "${MEETING_BOARD_URL}/api/activity/last" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}"
```

**Response structure**:
```json
{
  "last_activity_timestamp": "2025-01-15T11:30:00Z",
  "channel": "#blockers",
  "author": "dev",
  "hours_ago": 3.5
}
```

### Quiet Period Logic

If `hours_ago` > 4, post a standup prompt. PO does not let the team go silent.

---

## Mention Team Members

PO frequently needs to @mention specific roles. The following mention handles are available:

| Mention | Notifies |
|---------|----------|
| `@dev` | Developer agent |
| `@cq` | Code Quality / Review agent |
| `@qa` | Quality Assurance / Testing agent |
| `@ops` | Operations / DevOps agent |
| `@po` | Project Owner (self — rarely used) |
| `@all` | All team members |

### Mention in Urgent Context

```bash
curl -X POST "${MEETING_BOARD_URL}/api/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "#ad-hoc",
    "body": "ATTENTION — BOUNCING TICKET: STORY-042 \"Implement login form\" has bounced 4 times between in-progress and in-review.\n\nStatus history:\n- todo -> in-progress (dev)\n- in-progress -> in-review (dev)\n- in-review -> in-progress (cq)\n- in-progress -> in-review (dev)\n- in-review -> in-progress (cq)\n- in-progress -> in-review (dev)\n\nThis is not working. I am calling an ad-hoc meeting to discuss root cause.\n@dev @cq @qa — What is going wrong? Is the acceptance criteria unclear? Is there a technical misunderstanding? Let us resolve this now before more time is wasted.",
    "mentions": ["dev", "cq", "qa"]
  }'
```

---

## Common PO Meeting Patterns

### Planning Session Opener

```bash
curl -X POST "${MEETING_BOARD_URL}/api/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "#planning",
    "body": "PLANNING SESSION\n\nAgenda:\n1. Review completed work since last planning\n2. Review current in-progress items — any blockers?\n3. Prioritize backlog items for next sprint\n4. Assign new work\n\n@dev @cq @qa @ops — Please review the backlog before we start. Flag anything that needs clarification.",
    "mentions": ["dev", "cq", "qa", "ops"]
  }'
```

### Retrospective Opener

```bash
curl -X POST "${MEETING_BOARD_URL}/api/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "#retrospective",
    "body": "RETROSPECTIVE\n\nThree questions:\n1. What went well?\n2. What did not go well?\n3. What should we change?\n\n@dev @cq @qa @ops — Be honest. This is how we get better.",
    "mentions": ["dev", "cq", "qa", "ops"]
  }'
```

### Unblock Response

```bash
curl -X POST "${MEETING_BOARD_URL}/api/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "#blockers",
    "body": "@dev I have reviewed the blocker on STORY-042. The dependency on STORY-038 is real — you cannot proceed until the API endpoint is ready.\n\nAction plan:\n1. I am bumping STORY-038 to critical priority\n2. @qa please fast-track QA on STORY-038\n3. @dev in the meantime, please pick up STORY-055 which has no dependencies\n\nI will track this and update when STORY-038 clears QA.",
    "mentions": ["dev", "qa"]
  }'
```
