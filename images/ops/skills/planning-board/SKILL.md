# OPS Planning Board Skill

## Overview
OPS has deployment-gate permissions on the planning board. You are authorized to read tickets, post deployment comments, and move tickets to their final `closed` status after successful deployment.

## Permissions

| Action          | Allowed | Notes                                           |
|-----------------|---------|-------------------------------------------------|
| GET tickets     | Yes     | Filter by status, read all fields               |
| POST comments   | Yes     | Deployment details on any ticket                |
| PUT status      | Yes     | rfp -> closed (after successful deployment)     |
| POST tickets    | No      | Cannot create tickets                           |
| DELETE tickets  | No      | Cannot delete tickets                           |
| PUT assignee    | No      | Cannot assign tickets                           |

## API Usage

### Fetch Tickets Ready for Production

```bash
curl -s "${PLANNING_BOARD_URL}/api/tickets?status=rfp" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json"
```

Returns all tickets with status `rfp` (Ready for Production). These have passed both CQ review and QA testing.

### Fetch a Single Ticket with Full Details

```bash
curl -s "${PLANNING_BOARD_URL}/api/tickets/${TICKET_ID}" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json"
```

Returns the full ticket including all comments from DEV, CQ, and QA. Review these for deployment context.

### Post a Deployment Comment

```bash
curl -s -X POST "${PLANNING_BOARD_URL}/api/tickets/${TICKET_ID}/comments" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "author": "ops",
    "type": "deployment",
    "body": "## Deployment Complete\n\n**Deployed:** [service/component name]\n**Environment:** [production/staging]\n**Timestamp:** [ISO timestamp]\n**Version/Tag:** [version or commit hash]\n\n### Deployment Steps Executed\n1. [Step performed]\n2. [Step performed]\n3. [Step performed]\n\n### Post-Deployment Verification\n- [x] Health checks passing\n- [x] Smoke tests passing\n- [x] Monitoring dashboards nominal\n- [x] Error rates within threshold\n\n### Rollback Plan\nTo rollback this deployment:\n1. [Rollback step]\n2. [Rollback step]\n3. [Verify rollback step]\n\n**Status: Successfully deployed and verified.**"
  }'
```

### Move Ticket to Closed (After Successful Deployment)

```bash
curl -s -X PUT "${PLANNING_BOARD_URL}/api/tickets/${TICKET_ID}/status" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "closed",
    "changed_by": "ops"
  }'
```

### Post a Deployment Failure Comment

```bash
curl -s -X POST "${PLANNING_BOARD_URL}/api/tickets/${TICKET_ID}/comments" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "author": "ops",
    "type": "deployment_failed",
    "body": "## Deployment Failed\n\n**Attempted:** [timestamp]\n**Environment:** [production/staging]\n\n### Failure Details\n[What went wrong during deployment]\n\n### Actions Taken\n1. [Rollback executed / not needed]\n2. [Systems verified stable]\n\n### Root Cause\n[Initial assessment of what caused the failure]\n\n### Next Steps\n[What needs to happen before re-attempting deployment]\n\n**Status: Deployment halted. Ticket remains in rfp pending resolution.**"
  }'
```

## Workflow Notes

- Always verify CQ and QA both passed by reading ticket comments before deploying
- Post the deployment comment BEFORE moving to closed, so the deployment record is on the ticket
- If deployment fails, post a failure comment but do NOT move the ticket to closed -- it stays in `rfp`
- Coordinate with the team in #standup if a deployment failure requires ticket rework
