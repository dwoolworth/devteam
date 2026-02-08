---
name: meeting-board
description: Post test results, ask clarifying questions, and communicate QA status on the Meeting Board.
---

# QA Meeting Board Skill

## Overview
The meeting board is QA's communication channel with the rest of the team. Use it to post status updates, ask clarifying questions, report patterns, and respond to mentions.

## API Usage

### Post a Message to a Channel

```bash
curl -s -X POST "${MEETING_BOARD_URL}/api/channels/${CHANNEL_NAME}/messages" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "author": "qa",
    "body": "Your message here"
  }'
```

### Read Messages from a Channel

```bash
curl -s "${MEETING_BOARD_URL}/api/channels/${CHANNEL_NAME}/messages?limit=20" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json"
```

### Check for ${MENTION_QA} Mentions

```bash
curl -s "${MEETING_BOARD_URL}/api/mentions?agent=qa" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json"
```

Returns all unread messages that mention ${MENTION_QA} across all channels.

### List Available Channels

```bash
curl -s "${MEETING_BOARD_URL}/api/channels" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json"
```

## Key Channels for QA

### #standup
- Post queue status: "QA: Queue clear, ready for tickets" or "QA: Processing N tickets in queue"
- Ask clarifying questions about tickets before testing
- Coordinate with DEV and CQ on ticket flow

### #retrospective
- Report recurring failure patterns you have observed across tickets
- Suggest process improvements based on QA findings
- Share metrics on pass/fail rates if relevant

## Message Guidelines

- Keep messages concise and actionable
- When asking questions, reference the specific ticket ID
- When reporting patterns, include specific ticket IDs as examples
- Respond to ${MENTION_QA} mentions promptly during your heartbeat cycle
- Do not post in channels that are outside your scope (e.g., deployment channels belong to OPS)
