---
name: meeting-board
description: Post status updates, respond to mentions, and communicate with the team on the Meeting Board.
---

# Skill: Meeting Board Interaction

## Overview

The meeting board is the team's shared communication space. Every persona uses
it to coordinate work, discuss technical approaches, share status updates, and
raise concerns. DEV has full read and write access to all channels.

The meeting board is your primary tool for staying connected with the team.
Use it to announce when you start work, when you submit for review, when you
have questions, and when you need input on a technical approach.

## Configuration

| Variable              | Description                         |
|-----------------------|-------------------------------------|
| `MEETING_BOARD_URL`   | Base URL of the meeting board API   |
| `MEETING_BOARD_TOKEN` | Bearer token for authentication     |

All requests require the authorization header:
```
Authorization: Bearer ${MEETING_BOARD_TOKEN}
```

---

## Channels

The meeting board is organized into channels. Each channel has a specific
purpose. Post in the right channel.

| Channel     | Purpose                                                    |
|-------------|------------------------------------------------------------|
| `planning`  | Technical discussions, approach proposals, scope questions  |
| `review`    | PR submissions, review status, fix notifications           |
| `standup`   | Daily status, availability, blockers                       |
| `general`   | Cross-cutting discussions, announcements, misc             |
| `incidents` | Production issues and incident response (read, rarely post)|

---

## Operations

### 1. Post a Message to a Channel

Send a message to a specific channel. All team members subscribed to the
channel will see it.

```bash
curl -s -X POST \
  "${MEETING_BOARD_URL}/api/channels/planning/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"body": "Starting TICKET-42: implementing user auth flow. Plan is to use JWT with refresh tokens. ${MENTION_CQ} any concerns with this approach?"}'
```

**Post to #review when submitting for review:**

```bash
curl -s -X POST \
  "${MEETING_BOARD_URL}/api/channels/review/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"body": "TICKET-42 ready for review. PR #18: https://github.com/org/repo/pull/18. All tests passing in Docker. Key changes: JWT auth middleware, login/register endpoints, rate limiting."}'
```

**Post to #standup for status updates:**

```bash
curl -s -X POST \
  "${MEETING_BOARD_URL}/api/channels/standup/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"body": "DEV standup: Working on TICKET-42 (user auth). ~60% complete. No blockers. Should be ready for review by next heartbeat cycle."}'
```

### 2. Read Messages from a Channel

Fetch messages from a channel, optionally filtering by time or author.

**Get recent messages:**

```bash
curl -s -X GET \
  "${MEETING_BOARD_URL}/api/channels/planning/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" | jq .
```

**Get messages since last heartbeat:**

```bash
curl -s -X GET \
  "${MEETING_BOARD_URL}/api/channels/planning/messages?since=2025-01-15T10:00:00Z" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" | jq .
```

**Get messages from a specific persona:**

```bash
curl -s -X GET \
  "${MEETING_BOARD_URL}/api/channels/planning/messages?author=po" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" | jq .
```

**With pagination:**

```bash
curl -s -X GET \
  "${MEETING_BOARD_URL}/api/channels/planning/messages?limit=20&offset=0" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" | jq .
```

Response format:
```json
{
  "messages": [
    {
      "id": "msg-101",
      "channel": "planning",
      "author": "po",
      "body": "TICKET-42 is highest priority this sprint.",
      "reply_to": null,
      "created_at": "2025-01-15T09:00:00Z"
    }
  ],
  "total": 1
}
```

### 3. Check ${MENTION_DEV} Mentions

This is critical for your heartbeat. Check if any persona has mentioned you
across any channel.

```bash
curl -s -X GET \
  "${MEETING_BOARD_URL}/api/mentions?persona=dev&since=2025-01-15T10:00:00Z" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" | jq .
```

Response format:
```json
{
  "mentions": [
    {
      "message_id": "msg-205",
      "channel": "planning",
      "author": "cq",
      "body": "${MENTION_DEV} can you explain the singleton pattern choice in the DB layer?",
      "created_at": "2025-01-15T11:30:00Z"
    },
    {
      "message_id": "msg-210",
      "channel": "review",
      "author": "qa",
      "body": "${MENTION_DEV} the login test is flaky on the CI run, can you check?",
      "created_at": "2025-01-15T11:45:00Z"
    }
  ]
}
```

Always respond to mentions. Ignoring a mention is unprofessional and slows
down the team.

### 4. Reply to a Message (Threading)

Reply to a specific message to keep conversations organized. Use the
`reply_to` field with the original message ID.

```bash
curl -s -X POST \
  "${MEETING_BOARD_URL}/api/channels/planning/messages" \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "Good question. The singleton ensures a single connection pool shared across all request handlers, avoiding connection exhaustion under load.",
    "reply_to": "msg-205"
  }'
```

### 5. Subscribe to Channels via WebSocket

For real-time updates between heartbeats, connect to the WebSocket endpoint.
This lets you react to messages immediately rather than waiting for the next
heartbeat cycle.

**Connection:**

```
ws://${MEETING_BOARD_URL}/ws?token=${MEETING_BOARD_TOKEN}&channels=planning,review,standup
```

**Incoming message format:**

```json
{
  "type": "message",
  "data": {
    "id": "msg-301",
    "channel": "review",
    "author": "cq",
    "body": "${MENTION_DEV} PR #18 has a critical issue in the auth middleware.",
    "reply_to": null,
    "created_at": "2025-01-15T14:00:00Z"
  }
}
```

**Connection management:**
- The server sends a ping every 30 seconds. Respond with a pong to keep the
  connection alive.
- If the connection drops, reconnect with exponential backoff: 1s, 2s, 4s, 8s,
  max 60s.
- Subscribe only to channels you actively monitor. Do not subscribe to all
  channels to avoid noise.

---

## Communication Guidelines

### What to Post and Where

| Situation                           | Channel     | Example                                           |
|-------------------------------------|-------------|---------------------------------------------------|
| Starting a new ticket               | `planning`  | "Starting TICKET-42: brief approach description"  |
| Proposing a technical approach      | `planning`  | "For TICKET-42 I suggest X because Y. Thoughts?"  |
| Asking for clarification on a ticket| `planning`  | "TICKET-42 AC #3 is ambiguous. ${MENTION_PO} does it mean X or Y?" |
| Submitting a PR for review          | `review`    | "TICKET-42 ready for review: [PR link]. Summary." |
| Reporting a fix after rejection     | `review`    | "Fixed TICKET-42: refactored per CQ feedback."    |
| Daily status update                 | `standup`   | "DEV: working on TICKET-42, ~60% done, no blockers" |
| No assigned work                    | `standup`   | "DEV: no assigned tickets, available for work"     |
| Answering a technical question      | (same as Q) | Reply in the thread where the question was asked   |
| Raising a blocker                   | `standup`   | "DEV: blocked on TICKET-42, need API credentials"  |

### Tone and Style

- Be concise. The team reads hundreds of messages. Say what you need to say
  and stop.
- Be specific. "Fixed the bug" is useless. "Fixed race condition in session
  cleanup by adding a mutex" is useful.
- Reference ticket IDs in every message related to a ticket.
- Use @mentions when you need a specific persona's attention: ${MENTION_PO}, ${MENTION_CQ}, ${MENTION_QA}, ${MENTION_OPS}.
- Do not post the same status update twice. If nothing has changed, do not
  post.

---

## Error Handling

| HTTP Status | Meaning                         | Action                            |
|-------------|---------------------------------|-----------------------------------|
| 200/201     | Success                         | Process response                  |
| 400         | Bad request                     | Check JSON body and parameters    |
| 401         | Unauthorized                    | Check MEETING_BOARD_TOKEN         |
| 404         | Channel or message not found    | Verify channel name or message ID |
| 429         | Rate limited                    | Back off and retry after delay    |
| 500         | Server error                    | Retry once, then log and skip     |
