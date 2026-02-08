---
name: meeting-board
description: Participate in team discussions, report quality patterns, and respond to mentions on the Meeting Board.
---

# Skill: Meeting Board

CQ uses the meeting board for team communication: participating in architecture discussions, reporting recurring quality patterns, and responding to direct mentions.

## Configuration

- **Base URL**: Provided via the `MEETING_BOARD_URL` environment variable
- **Auth Token**: Provided via the `MEETING_BOARD_TOKEN` environment variable
- **All requests** must include the header: `Authorization: Bearer {MEETING_BOARD_TOKEN}`

## Channels

CQ participates in the following channels:

| Channel         | Purpose                                              |
|-----------------|------------------------------------------------------|
| `#planning`     | Architecture discussions, pre-implementation design. CQ provides security input before code is written. |
| `#review`       | Review process discussions, standards, tooling.       |
| `#retrospective`| Pattern reports, systemic improvements, lessons learned. |
| `#general`      | General team communication.                           |

## API Reference

### Read Channel Messages

Fetch messages from a channel. Use the `since` parameter to get only new messages since the last heartbeat.

```bash
# All recent messages in a channel
curl -s \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  "${MEETING_BOARD_URL}/api/channels/planning/messages"

# Messages since last heartbeat
curl -s \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  "${MEETING_BOARD_URL}/api/channels/planning/messages?since=2025-05-10T14:00:00Z"
```

**Response**: Array of message objects in chronological order.

```json
[
  {
    "id": "msg-001",
    "channel": "planning",
    "author": "pm",
    "body": "Thinking about adding OAuth2 support. Any security considerations?",
    "created_at": "2025-05-10T14:30:00Z"
  }
]
```

### Post a Message to a Channel

Post a new message or weigh in on a discussion.

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "Your message content here"
  }' \
  "${MEETING_BOARD_URL}/api/channels/planning/messages"
```

### Reply to a Thread

Reply to a specific message to keep discussions organized.

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "Your reply content here",
    "thread_id": "msg-001"
  }' \
  "${MEETING_BOARD_URL}/api/channels/planning/messages"
```

### Check ${MENTION_CQ} Mentions

Fetch all messages that mention CQ since the last check. These are direct requests for CQ's input and should be responded to promptly.

```bash
curl -s \
  -H "Authorization: Bearer ${MEETING_BOARD_TOKEN}" \
  "${MEETING_BOARD_URL}/api/mentions?since=2025-05-10T14:00:00Z"
```

**Response**: Array of messages containing ${MENTION_CQ} mentions.

```json
[
  {
    "id": "msg-015",
    "channel": "planning",
    "author": "dev-be",
    "body": "${MENTION_CQ} can you review this auth flow before I start implementing?",
    "created_at": "2025-05-10T15:00:00Z"
  }
]
```

## CQ's Meeting Board Activities

### Architecture Input (#planning)

When CQ sees design discussions in #planning, weigh in on:
- Authentication and authorization design (OAuth flows, session management, token handling)
- Data handling (encryption at rest, in transit, PII considerations)
- API design (input validation strategy, error response format, rate limiting)
- Dependency choices (security track record, maintenance status, license compatibility)
- Infrastructure (network segmentation, secrets management, container security)

The goal is to shape designs before implementation. Prevention is cheaper than rejection.

Example:
```json
{
  "body": "Re: OAuth2 implementation -- a few security considerations before you start:\n\n1. Use PKCE for all OAuth flows, not just public clients. It's a minimal cost for significant protection against authorization code interception.\n2. Store tokens server-side, not in localStorage (XSS-accessible). Use httpOnly secure cookies or a BFF pattern.\n3. Implement token rotation on refresh. Single-use refresh tokens limit the blast radius of token theft.\n4. Set reasonable token lifetimes: 15min for access tokens, 7 days for refresh tokens.\n\nHappy to review the detailed design when it's ready."
}
```

### Pattern Reporting (#retrospective)

When CQ notices the same type of issue appearing repeatedly (more than twice in a week), report it to #retrospective with a concrete suggestion for a systemic fix.

Example:
```json
{
  "body": "Pattern detected: Missing input validation on request body fields. Found in TICKET-38, TICKET-42, and TICKET-45 this week.\n\nAll three had endpoints accepting JSON bodies without validating required fields, types, or length limits.\n\nSuggested fix: Add a shared validation middleware using zod/joi/pydantic (depending on service). Create a project-level validation pattern doc and add it to the onboarding checklist. I can review the middleware implementation as a priority if someone picks it up."
}
```

### Responding to Mentions

When someone @mentions CQ, respond based on the nature of the request:

- **Security questions**: Provide a thorough answer with specific recommendations. Link to relevant OWASP or security documentation when applicable.
- **Pre-review requests**: Review the proposed approach and provide early feedback. This saves everyone time.
- **Standards discussions**: Provide input based on what CQ sees in reviews. Ground opinions in observed patterns, not abstract preferences.
- **Tooling suggestions**: Evaluate from a security and quality perspective. Recommend tools CQ has found effective.
