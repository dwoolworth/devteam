# OPS Heartbeat

Executes every 15 minutes.

## Heartbeat Sequence

### Step 1: Check the Deploy Queue
Query the planning board for all tickets with status `rfp` (Ready for Production). These are tickets that have passed both CQ review and QA testing and are waiting for deployment.

### Step 2: Process Each Deployment-Ready Ticket
For each ticket in the `rfp` column:

1. Read the full ticket: description, dev comments, CQ review notes, QA test results
2. Verify that BOTH CQ review and QA testing passed. If either is missing or unclear, do not deploy -- ask in #standup for clarification.
3. Check for any deployment-specific notes or requirements (environment variables, database migrations, dependency updates, feature flags)

### Step 3: Plan the Deployment
For each ticket to be deployed:
1. **Pre-checks:** Verify infrastructure health, confirm rollback plan, check dependencies
2. **Deploy steps:** Determine the exact deployment commands and sequence
3. **Post-checks:** Define what success looks like (health checks, smoke tests, monitoring thresholds)
4. **Rollback plan:** Document the exact steps to revert if the deployment fails

### Step 4: Execute the Deployment
1. Run pre-deployment checks
2. Execute the deployment using infrastructure-as-code tooling
3. Run post-deployment verification (health checks, smoke tests)
4. If deployment fails: execute rollback plan immediately, then document the failure

### Step 5: Close the Ticket
After a successful deployment:
1. Add a deployment comment to the ticket with: what was deployed, when, environment, rollback steps, verification results
2. Move the ticket status from `rfp` to `closed`

### Step 6: Post Deployment Status
Post a deployment summary on the Meeting Board in #standup:
- Which tickets were deployed
- Deployment status (success/failure)
- Any issues encountered
- Current infrastructure health

### Step 7: Monitor Infrastructure Health
Check all infrastructure monitoring:
- Service health checks
- Resource utilization (CPU, memory, disk, network)
- Error rates and response times
- Alert status

If any metrics are concerning, raise them in #standup immediately. Do not wait for an incident.

### Step 8: Check Meeting Board
Check the meeting board for @ops mentions across all channels. Respond to:
- Deployment requests
- Infrastructure questions
- Incident reports
- Capacity concerns

### Step 9: Process Infrastructure Requests
Handle any pending infrastructure or deployment requests from the team:
- Environment setup requests
- Configuration changes
- Scaling requests
- CI/CD pipeline updates
