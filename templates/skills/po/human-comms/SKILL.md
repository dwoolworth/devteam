---
name: human-comms
description: Communicate with human stakeholders via Meeting Board, Discord, or Slack webhooks.
---

# Skill: Human Communication

PO is the sole interface between the AI team and human stakeholders. This skill covers how to communicate with humans through the Meeting Board `#humans` channel, Discord webhooks, and Slack webhooks.

---

## Configuration

| Environment Variable | Required | Description |
|---|---|---|
| `HUMAN_COMMS_TYPE` | No (default: `meeting-board`) | Communication channel: `meeting-board`, `discord`, or `slack` |
| `HUMAN_COMMS_WEBHOOK_URL` | Only for `discord`/`slack` | The webhook URL for the external service |
| `MEETING_BOARD_URL` | Yes | Meeting Board base URL (always needed for fallback) |
| `MEETING_BOARD_TOKEN` | Yes | PO's auth token for the Meeting Board |

---

## When to Use This Skill

- **Initiative ticket arrives**: A human created an initiative in TODO assigned to you. Acknowledge it and ask clarifying questions if needed.
- **Clarification needed**: The initiative description is vague or missing key details. Ask specific questions.
- **Initiative decomposed**: You have broken the initiative into Epics and Stories. Notify the human with the breakdown summary.
- **Awaiting human response**: A clarification was asked >24 hours ago with no reply. Send a reminder.
- **Work completed**: All child tickets from an initiative have reached `completed`. Notify the human.

---

## Channel 1: Meeting Board `#humans` (Default / Fallback)

This is the default channel and the fallback for all external webhook failures. Messages posted here are visible on the Meeting Board dashboard.

### Post a Message to #humans

```bash
curl -s -X POST "${MEETING_BOARD_URL}/api/channels/humans/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "Your message here",
    "mentions": ["human"]
  }'
```

### Read Recent #humans Messages

```bash
curl -s -X GET "${MEETING_BOARD_URL}/api/channels/humans/messages?limit=20" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}"
```

---

## Channel 2: Discord Webhook

When `HUMAN_COMMS_TYPE=discord`, send messages to a Discord channel via webhook.

### Send a Discord Message

```bash
curl -s -X POST "${HUMAN_COMMS_WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "DevTeam PO",
    "content": "Your message here"
  }'
```

### Send a Discord Embed (for structured updates)

```bash
curl -s -X POST "${HUMAN_COMMS_WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "DevTeam PO",
    "embeds": [{
      "title": "Initiative Update: INIT-001",
      "description": "Your initiative has been decomposed into actionable work.",
      "color": 5814783,
      "fields": [
        {"name": "Epics Created", "value": "EPIC-010, EPIC-011", "inline": true},
        {"name": "Stories Created", "value": "STORY-050 through STORY-058", "inline": true},
        {"name": "Status", "value": "Work is queued and will begin shortly."}
      ]
    }]
  }'
```

### Verify Discord Webhook Response

A successful Discord webhook returns HTTP 204 (No Content). Any other status code is a failure — fall back to Meeting Board.

---

## Channel 3: Slack Incoming Webhook

When `HUMAN_COMMS_TYPE=slack`, send messages to a Slack channel via incoming webhook.

### Send a Slack Message

```bash
curl -s -X POST "${HUMAN_COMMS_WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Your message here"
  }'
```

### Send a Slack Block Kit Message (for structured updates)

```bash
curl -s -X POST "${HUMAN_COMMS_WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  -d '{
    "blocks": [
      {
        "type": "header",
        "text": {"type": "plain_text", "text": "Initiative Update: INIT-001"}
      },
      {
        "type": "section",
        "text": {"type": "mrkdwn", "text": "Your initiative has been decomposed into actionable work.\n\n*Epics Created:* EPIC-010, EPIC-011\n*Stories Created:* STORY-050 through STORY-058\n*Status:* Work is queued and will begin shortly."}
      }
    ]
  }'
```

### Verify Slack Webhook Response

A successful Slack webhook returns HTTP 200 with body `ok`. Any other response is a failure — fall back to Meeting Board.

---

## Message Templates

### Clarifying Questions (Initiative Needs More Detail)

```
[INIT-XXX] Initiative: "Title"

I have reviewed this initiative and need clarification before I can break it down into actionable work:

1. [Specific question about scope, priority, constraint, or expected outcome]
2. [Specific question]
3. [Specific question]

Please reply with answers so I can create the appropriate Epics and Stories. Without this clarity, I cannot guarantee the team builds what you actually need.
```

### Initiative Acknowledgment (New Initiative Received)

```
[INIT-XXX] Initiative Received: "Title"

I have picked up your initiative. I am reviewing the details and will follow up with clarifying questions if needed, or a breakdown summary once decomposition is complete.

Expected turnaround: Next heartbeat cycle (within 15 minutes).
```

### Breakdown Notification (Initiative Decomposed)

```
[INIT-XXX] Initiative Decomposed: "Title"

Your initiative has been broken down into the following work items:

Epic(s):
- EPIC-XXX: "Epic title"

Stories:
- STORY-XXX: "Story title" (assigned to @dev, priority: high)
- STORY-XXX: "Story title" (assigned to @dev, priority: medium)
- STORY-XXX: "Story title" (assigned to @dev, priority: medium)

All stories have acceptance criteria. The team will begin work in priority order. I will update you as items are completed.

Initiative ticket INIT-XXX is now closed.
```

### 24-Hour Reminder (Awaiting Human Response)

```
[INIT-XXX] Reminder: Awaiting Your Response

I asked clarifying questions on this initiative 24 hours ago and have not received a response. The initiative cannot be decomposed until these questions are answered:

1. [Original question 1]
2. [Original question 2]

Please respond when you can. The initiative remains in TODO until we have clarity.
```

---

## Error Handling

1. **Webhook returns non-2xx**: Log the error. Fall back to Meeting Board `#humans` immediately. Include a note in the fallback message: `[Webhook delivery failed — posting here as fallback]`.
2. **Webhook times out (>10s)**: Treat as failure. Fall back to Meeting Board.
3. **`HUMAN_COMMS_WEBHOOK_URL` is empty but type is `discord`/`slack`**: Log a warning. Use Meeting Board as fallback. Do not crash.
4. **Meeting Board is also down**: Follow the standard Meeting Board outage procedure (retry with backoff, enter idle state). Do not attempt to work on initiatives while communication channels are unavailable.

---

## Constraints

- **PO-only skill**: No other agent has human communication capabilities. If another agent needs human input, they post to `#ad-hoc` with `@human` and PO relays.
- **One-way webhooks**: Discord and Slack webhooks are fire-and-forget. Human responses come back through the Planning Board (comments on the initiative ticket), NOT through the webhook. Always check the initiative ticket for new comments — that is where human replies land.
- **No sensitive data over external channels**: Do not include API keys, credentials, internal URLs, or security findings in webhook messages. Keep external messages focused on business context. Technical details stay on the Meeting Board.
