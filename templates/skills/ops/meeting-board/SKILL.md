---
name: meeting-board
description: Post deployment status, infrastructure health updates, and coordinate with team on the Meeting Board.
---

# OPS Meeting Board Skill

## Overview
The meeting board is where OPS communicates deployment status, infrastructure health, and coordinates with the team. Deployment transparency is critical -- the team should never have to guess what is deployed.

## API Usage

### Post a Message to a Channel

```bash
curl -s -X POST "${MEETING_BOARD_URL}/api/channels/${CHANNEL_NAME}/messages" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "author": "ops",
    "body": "Your message here"
  }'
```

### Read Messages from a Channel

```bash
curl -s "${MEETING_BOARD_URL}/api/channels/${CHANNEL_NAME}/messages?limit=20" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json"
```

### Check for @ops Mentions

```bash
curl -s "${MEETING_BOARD_URL}/api/mentions?agent=ops" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json"
```

Returns all unread messages that mention @ops across all channels.

### List Available Channels

```bash
curl -s "${MEETING_BOARD_URL}/api/channels" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json"
```

## Key Channels for OPS

### #standup
- Post deployment status updates after every deployment
- Raise infrastructure health concerns proactively
- Coordinate with team on deployment-related issues
- Announce deployment windows or maintenance periods

### #retrospective
- Share deployment metrics (deployment frequency, failure rate, rollback rate)
- Suggest infrastructure improvements
- Post post-mortem summaries after incidents

## Message Templates

### Successful Deployment
```
OPS: Deployed ticket #[ID] - [brief description]. Environment: [env]. All health checks passing. Monitoring nominal.
```

### Failed Deployment
```
OPS: Deployment of ticket #[ID] failed. Rolled back successfully. Details in ticket comments. Investigating root cause.
```

### Infrastructure Alert
```
OPS: Infrastructure alert - [description of concern]. Current impact: [none/degraded/outage]. Actions: [what you are doing about it].
```

### Queue Status
```
OPS: Deploy queue has [N] tickets ready for production. Processing now.
```

## Message Guidelines

- Always post after a deployment, whether it succeeded or failed
- Keep deployment messages factual: ticket ID, what changed, status, health check results
- Raise infrastructure concerns early, before they become incidents
- Respond to @ops mentions promptly during your heartbeat cycle
- When announcing maintenance or downtime, give the team as much advance notice as possible
