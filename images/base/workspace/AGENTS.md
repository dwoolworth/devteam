# DevTeam Agent Guidelines

This document is **THE LAW**. Every agent in the DevTeam platform follows these rules without exception. Violating these rules causes stuck tickets, broken pipelines, and silent failures that cascade across the entire team.

---

## 1. The Ticket Lifecycle (THE LAW)

Every unit of work in DevTeam is a **ticket**. Tickets live on the Planning Board and move through a strict sequence of statuses. No status may be skipped. No status may be revisited except through the defined rejection paths.

### 1.1 Status Flow

```
BACKLOG
  |
  v
TODO
  |
  v
IN-PROGRESS
  |
  v
IN-REVIEW
  |
  +---> APPROVED ---> DONE
  |
  +---> CHANGES-REQUESTED ---> IN-PROGRESS  (cycle back)
  |
  +---> REJECTED ---> BACKLOG  (full rejection)
```

### 1.2 Status Definitions

| Status | Meaning |
|---|---|
| **BACKLOG** | Ticket exists but is not scheduled for work. No agent is assigned. |
| **TODO** | Ticket is scheduled and assigned to an agent. Work has not started. |
| **IN-PROGRESS** | The assigned agent is actively working on this ticket. |
| **IN-REVIEW** | Work is complete. The ticket is waiting for a reviewer agent to evaluate it. |
| **APPROVED** | A reviewer has accepted the work. The ticket is ready for merge/deploy. |
| **DONE** | The ticket's deliverable has been merged, deployed, or otherwise finalized. |
| **CHANGES-REQUESTED** | A reviewer found issues. The ticket returns to the assigned agent for rework. |
| **REJECTED** | The ticket itself is invalid, out of scope, or superseded. Returns to BACKLOG. |

### 1.3 Allowed Transitions

Each transition must include a **comment** explaining why the transition is happening. No silent transitions.

| From | To | Who Can Do It | Required Comment |
|---|---|---|---|
| BACKLOG | TODO | planner, lead | Assignment reason and sprint goal |
| TODO | IN-PROGRESS | assigned agent | Acknowledgement and initial plan |
| IN-PROGRESS | IN-REVIEW | assigned agent | Summary of work done, files changed, how to test |
| IN-REVIEW | APPROVED | reviewer agent | Review verdict with reasoning |
| IN-REVIEW | CHANGES-REQUESTED | reviewer agent | Specific issues that must be fixed, with file/line refs |
| IN-REVIEW | REJECTED | reviewer agent, lead | Reason for full rejection |
| CHANGES-REQUESTED | IN-PROGRESS | assigned agent | Acknowledgement of feedback and rework plan |
| APPROVED | DONE | deployer, lead, automation | Deployment or merge confirmation |
| REJECTED | BACKLOG | planner, lead | Triage notes for future consideration |

### 1.4 Initiative Ticket Exception

Initiative tickets are a first-class lifecycle exception. They follow a shortened lifecycle: `TODO -> DONE`.

**What is an initiative ticket?**

An initiative is a high-level business goal created by a **human stakeholder** and assigned to **PO**. It is not a Story, not a Task, not a Bug — it is a directive that says "make this happen." PO's job is to engage with the human to clarify the initiative, then decompose it into Epics and Stories that follow the normal lifecycle.

**Rules for initiative tickets:**

1. **Label required**: The ticket MUST have the label `initiative`. Without this label, the exception does not apply and the ticket follows the normal lifecycle.
2. **Assigned to PO only**: Initiative tickets MUST be assigned to `po`. No other agent may own an initiative.
3. **Created by humans only**: Agents MUST NOT create initiative tickets. Only human stakeholders create them. If an agent believes an initiative is needed, they escalate to `@human` via the Meeting Board.
4. **No intermediate statuses**: Initiative tickets go from `TODO` directly to `DONE`. They do NOT pass through `in-progress`, `in-review`, or `in-qa`. The work of an initiative is decomposition, not implementation.
5. **Closing comment required**: When PO closes an initiative ticket, the closing comment MUST list all child Epic and Story IDs that were created from the initiative. This is the traceability link.
6. **Child traceability**: All Epics and Stories created from an initiative MUST carry the label `initiative:INIT-XXX` (where `INIT-XXX` is the initiative ticket ID). This allows querying all work spawned from a single initiative.

**Anti-abuse clause**: During Priority 5 (Verify Ticket Quality) of every heartbeat, PO checks for tickets with the `initiative` label that were NOT created by a human. If an agent created a ticket and slapped the `initiative` label on it to bypass the lifecycle, PO removes the label, moves the ticket to `backlog`, and posts a public callout on the Meeting Board. The initiative exception is for human-originated work only.

---

## 2. The Cardinal Rule

> **When you act on a ticket, you MUST change its status.**

If a reviewer looks at a ticket in IN-REVIEW and decides the work is not acceptable, the reviewer MUST move the ticket to CHANGES-REQUESTED. The reviewer MUST NOT leave a comment saying "this needs changes" while leaving the status at IN-REVIEW.

If an agent picks up a TODO ticket, the agent MUST move it to IN-PROGRESS before beginning any work. The agent MUST NOT start coding while the ticket still says TODO.

**Every action on a ticket corresponds to exactly one status transition.** A comment without a status change is a violation of The Cardinal Rule.

---

## 3. The Quinn Problem

The Quinn Problem is named after a failure mode where an agent leaves a comment on a ticket without changing the status. This creates a **stuck ticket** — a ticket that appears to be in one state but is actually in another.

### Examples of the Quinn Problem:

- A reviewer comments "Looks good, approved!" but leaves the ticket in IN-REVIEW. The assigned agent never knows it was approved.
- An agent comments "Starting work on this" on a TODO ticket but never moves it to IN-PROGRESS. The planner thinks no one has picked it up.
- A reviewer comments "Please fix the null check on line 42" but leaves the ticket in IN-REVIEW instead of moving it to CHANGES-REQUESTED. The agent never sees the feedback because they are only watching for status changes.

### How to Avoid the Quinn Problem:

1. **Never post a comment on a ticket without also changing its status** (unless you are adding supplementary information to a ticket you already transitioned).
2. If you are adding follow-up context to a ticket you already transitioned, prefix your comment with `[ADDENDUM]` so it is clear this is not a new action.
3. All agents poll for work based on **status changes**, not comments. A comment alone is invisible to the workflow.

---

## 4. Communication Rules

### 4.1 All Discussion Happens on the Meeting Board

The Meeting Board is the **sole** communication channel between agents. Agents MUST NOT:

- Communicate directly with other agents through any mechanism other than the Meeting Board
- Embed messages to other agents inside code comments, commit messages, or file contents
- Assume another agent will read anything that is not posted to a Meeting Board channel

### 4.2 No Direct Bot-to-Bot Communication

Even if two agents are running in the same Docker network and could theoretically call each other's APIs, they MUST NOT. All coordination flows through the Meeting Board. This ensures:

- Full audit trail of all decisions
- Human operators can observe and intervene
- No hidden state or side-channel agreements between agents

### 4.3 Meeting Board Channels

| Channel | Purpose | Who Posts | Cadence |
|---|---|---|---|
| **#standup** | Daily status updates from each agent | All agents | Once per work cycle (configurable) |
| **#planning** | Sprint planning, ticket creation, backlog grooming | Planner, Lead | Start of each sprint/cycle |
| **#review** | Review requests, review verdicts, code discussion | Assigned agents, Reviewers | As tickets enter IN-REVIEW |
| **#retrospective** | Post-sprint analysis, process improvements | All agents | End of each sprint/cycle |
| **#ad-hoc** | Urgent issues, blockers, questions, general discussion | All agents | As needed |

### 4.4 Channel Rules

- Post to the **correct channel**. A review verdict posted to #standup will not be seen by the review pipeline.
- Every post must include the **ticket ID** if it relates to a ticket. Format: `[TICKET-123]` at the start of the message.
- Cross-channel references use the format: `See #review [TICKET-123]` to point agents to the relevant discussion.

---

## 5. @Mention Conventions

Agents use @mentions to direct messages to specific agents or groups.

| Mention | Target |
|---|---|
| `@all` | Every agent in the channel |
| `@planner` | The planner agent |
| `@lead` | The tech lead agent |
| `@reviewer` | All agents with reviewer capability |
| `@{agent-name}` | A specific agent by name (e.g., `@cleo`, `@quinn`, `@river`) |
| `@human` | Escalation to the human operator — used when an agent is blocked and cannot proceed without human input |

### Mention Rules

- Use `@human` sparingly. It pauses the pipeline until a human responds. Only use it for true blockers: ambiguous requirements, missing credentials, infrastructure failures.
- When you @mention an agent, that agent is **expected to respond**. If they do not respond within the configured timeout, the system escalates to `@lead`.
- Do not @mention agents in channels they are not subscribed to. Check the agent roster before mentioning.

---

## 6. Using the Planning Board

The Planning Board is the source of truth for all tickets. Every agent interacts with it through the Planning Board API.

### 6.1 Reading Tickets

- Poll for tickets assigned to you with status `TODO` to find new work.
- Poll for tickets assigned to you with status `CHANGES-REQUESTED` to find rework.
- Reviewers poll for tickets with status `IN-REVIEW` to find review work.

### 6.2 Updating Tickets

Every status update MUST include:

```json
{
  "ticket_id": "TICKET-123",
  "new_status": "IN-PROGRESS",
  "comment": "Picking up this ticket. Plan: refactor the auth middleware to support JWT rotation.",
  "agent": "cleo",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

All four fields are **required**. A status update without a comment is rejected by the API.

### 6.3 Creating Tickets

Only agents with the `planner` or `lead` role may create tickets. Tickets must include:

- **Title**: Short description (under 80 characters)
- **Description**: Full specification of the work to be done
- **Acceptance criteria**: Bulleted list of conditions that must be true for the ticket to be APPROVED
- **Priority**: `critical`, `high`, `medium`, `low`
- **Estimated complexity**: `trivial`, `small`, `medium`, `large`, `epic`
- **Assigned agent**: The agent responsible for the work (may be unassigned for BACKLOG tickets)

---

## 7. Status Transitions by Role

Each agent role has a defined set of status transitions it is allowed to perform.

### 7.1 Developer Agent

| Allowed Transition | Context |
|---|---|
| TODO -> IN-PROGRESS | Picking up assigned work |
| IN-PROGRESS -> IN-REVIEW | Submitting completed work for review |
| CHANGES-REQUESTED -> IN-PROGRESS | Acknowledging reviewer feedback and starting rework |

### 7.2 Reviewer Agent

| Allowed Transition | Context |
|---|---|
| IN-REVIEW -> APPROVED | Work meets acceptance criteria |
| IN-REVIEW -> CHANGES-REQUESTED | Work has specific issues that need fixing |
| IN-REVIEW -> REJECTED | Work is fundamentally wrong or ticket is invalid |

### 7.3 Planner Agent

| Allowed Transition | Context |
|---|---|
| BACKLOG -> TODO | Scheduling work for the current sprint |
| REJECTED -> BACKLOG | Re-triaging a rejected ticket |
| TODO -> DONE | Closing an initiative ticket after decomposition (initiative label required) |

### 7.4 Lead Agent

| Allowed Transition | Context |
|---|---|
| Any -> Any | The lead can override any transition in exceptional circumstances |
| APPROVED -> DONE | Confirming deployment/merge |

The lead MUST include `[OVERRIDE]` in the comment when making a non-standard transition and must explain why the override was necessary.

### 7.5 Deployer Agent

| Allowed Transition | Context |
|---|---|
| APPROVED -> DONE | Confirming successful deployment or merge |

---

## 8. Required Comment Formats

### 8.1 Picking Up a Ticket (TODO -> IN-PROGRESS)

```
Status: IN-PROGRESS
Agent: {agent-name}

## Plan
- {Step 1}
- {Step 2}
- {Step 3}

## Estimated Completion
{Time estimate or cycle count}
```

### 8.2 Submitting for Review (IN-PROGRESS -> IN-REVIEW)

```
Status: IN-REVIEW
Agent: {agent-name}

## Summary
{Brief description of what was done}

## Changes
- {File or component}: {What changed}
- {File or component}: {What changed}

## Testing
- {How the changes were tested}
- {Edge cases considered}

## Acceptance Criteria Check
- [x] {Criterion 1}
- [x] {Criterion 2}
- [x] {Criterion 3}
```

### 8.3 Approving a Ticket (IN-REVIEW -> APPROVED)

```
Status: APPROVED
Reviewer: {agent-name}

## Verdict: PASS

## Review Notes
- {Observation 1}
- {Observation 2}

## Acceptance Criteria Verification
- [x] {Criterion 1}: {How it was verified}
- [x] {Criterion 2}: {How it was verified}
```

### 8.4 Requesting Changes (IN-REVIEW -> CHANGES-REQUESTED)

```
Status: CHANGES-REQUESTED
Reviewer: {agent-name}

## Verdict: CHANGES NEEDED

## Required Changes
1. **{File}:{Line}** — {Description of the issue and what needs to change}
2. **{File}:{Line}** — {Description of the issue and what needs to change}

## Optional Suggestions
- {Non-blocking improvement suggestion}

## Failing Acceptance Criteria
- [ ] {Criterion that is not met}: {Why it fails}
```

### 8.5 Rejecting a Ticket (IN-REVIEW -> REJECTED)

```
Status: REJECTED
Reviewer: {agent-name}

## Verdict: REJECTED

## Reason
{Detailed explanation of why the ticket is being rejected entirely}

## Recommendation
{What should happen next — e.g., "Rewrite the ticket with clearer requirements",
"This is a duplicate of TICKET-456", "Out of scope for this sprint"}
```

### 8.6 Standup Update (#standup channel)

```
Agent: {agent-name}
Cycle: {cycle number or date}

## Completed
- [TICKET-123] {Brief summary}

## In Progress
- [TICKET-456] {Brief summary, % estimate, blockers if any}

## Blocked
- [TICKET-789] {What is blocking and what help is needed}

## Next
- [TICKET-012] {What will be picked up next}
```

---

## 9. Error Handling and Escalation

### 9.1 When You Are Stuck

If you cannot make progress on a ticket for any reason:

1. Post to **#ad-hoc** with the ticket ID and a description of the blocker.
2. @mention `@lead` if the blocker requires a process override.
3. @mention `@human` if the blocker requires human intervention (missing access, ambiguous requirements, infrastructure issue).
4. Do NOT silently stop working. A ticket left in IN-PROGRESS with no updates is indistinguishable from a crash.

### 9.2 When Another Agent Is Unresponsive

If you @mention an agent and they do not respond within the configured timeout:

1. Post to **#ad-hoc**: `@lead Agent @{name} is unresponsive. Ticket [TICKET-123] is blocked.`
2. The lead will either reassign the ticket or investigate the agent's health.

### 9.3 When the Meeting Board Is Down

If you cannot reach the Meeting Board:

1. Retry with exponential backoff (the runtime handles this automatically).
2. If the Meeting Board is down for longer than the configured `idle_timeout_seconds`, the agent will enter a safe idle state and resume when connectivity is restored.
3. Do NOT make progress on tickets while the Meeting Board is down. You cannot communicate your status, which violates the audit trail requirement.

### 9.4 When the Planning Board Is Down

If you cannot reach the Planning Board:

1. Post to **#ad-hoc** on the Meeting Board (if available): `Planning Board is unreachable. Pausing ticket work.`
2. Enter idle state. Do not attempt to work from cached ticket data — the board is the source of truth.

---

## 10. General Principles

1. **Transparency over speed.** It is better to post a status update and work slightly slower than to work fast and leave no trail.
2. **The board is the source of truth.** If it is not on the Planning Board, it does not exist. If it is not on the Meeting Board, it was not said.
3. **One ticket at a time.** Unless your configuration explicitly allows concurrent tickets, work on one ticket at a time. Finish or block before picking up the next.
4. **Comments are permanent.** Everything you post to the Meeting Board or Planning Board is part of the audit trail. Be precise, be professional, be helpful.
5. **Fail loudly.** If something is wrong, say so immediately. Silent failures are the most expensive kind.
