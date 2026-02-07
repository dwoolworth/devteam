# PO Tools Reference

PO has access to two primary tools: the Planning Board API and the Meeting Board API. PO does not have access to git, code editors, CI/CD pipelines, or deployment tools. PO manages work through tickets and communication.

---

## Planning Board API

**Purpose**: Full CRUD management of the project's ticket board. PO has unrestricted access to all operations.

**Base URL**: Value of `PLANNING_BOARD_URL` environment variable
**Authentication**: Bearer token from `PLANNING_BOARD_TOKEN` environment variable

### Available Operations

#### Create Ticket
Create a new Epic, Story, Task, or Bug on the board.

**Fields**:
- `type` (required): `epic`, `story`, `task`, `bug`, `initiative`
- `title` (required): Short, descriptive title
- `description` (required): Detailed description of the work
- `acceptance_criteria` (required for stories): List of testable criteria
- `priority` (required): `critical`, `high`, `medium`, `low`
- `assignee` (optional): Team member role (`dev`, `cq`, `qa`, `ops`)
- `parent_id` (optional): Parent epic ID for stories, parent story ID for tasks
- `labels` (optional): Array of string labels

#### Read / Query Tickets
Retrieve tickets by various filters.

**Query Parameters**:
- `id`: Specific ticket ID
- `status`: Filter by status (`backlog`, `todo`, `in-progress`, `in-review`, `in-qa`, `completed`, `rfp`, `closed`)
- `assignee`: Filter by assignee role
- `type`: Filter by ticket type
- `priority`: Filter by priority
- `created_after` / `created_before`: Date range filters
- `updated_after` / `updated_before`: Date range filters
- `label`: Filter by label
- `search`: Free text search across title and description

#### Update Ticket
Modify any field on any ticket.

**Updatable Fields**:
- `status`: Move ticket to any status (unrestricted for PO)
- `assignee`: Reassign to any team member
- `title`: Edit the title
- `description`: Edit the description
- `acceptance_criteria`: Add or modify acceptance criteria
- `priority`: Change priority level
- `labels`: Add or remove labels

#### Delete Ticket
Remove a ticket from the board entirely. Use for duplicates or invalid tickets only.

#### Read Comments
Retrieve the comment history for a ticket. Used primarily for Quinn Problem detection.

**Returns**: Array of comments with `author`, `timestamp`, `body`, and `status_at_time` fields.

#### Read Status History
Retrieve the full status transition log for a ticket. Used for bounce detection.

**Returns**: Array of transitions with `from_status`, `to_status`, `changed_by`, and `timestamp` fields.

---

## Meeting Board API

**Purpose**: Team communication hub. PO uses this to run meetings, post announcements, call out violations, and monitor team activity.

**Base URL**: Value of `MEETING_BOARD_URL` environment variable
**Authentication**: Bearer token from `MEETING_BOARD_TOKEN` environment variable

### Available Operations

#### Post Message
Send a message to any channel.

**Fields**:
- `channel` (required): Target channel (`#standup`, `#planning`, `#retrospective`, `#ad-hoc`, `#blockers`, or any custom channel)
- `body` (required): Message content (supports markdown formatting)
- `mentions` (optional): Array of roles to notify (`dev`, `cq`, `qa`, `ops`, `po`)

#### Create Channel
Create a new channel for ad-hoc meetings or special topics.

**Fields**:
- `name` (required): Channel name (will be prefixed with `#`)
- `purpose` (optional): Description of the channel's purpose
- `members` (optional): Array of roles to invite

#### Read Channel History
Retrieve messages from a channel.

**Query Parameters**:
- `channel` (required): Channel name
- `since`: Timestamp to retrieve messages after
- `limit`: Maximum number of messages to return (default 50)

#### Check Mentions
Retrieve all messages that mention `@po` that have not been responded to.

**Returns**: Array of messages with `channel`, `author`, `timestamp`, `body`, and `responded` fields.

#### Get Last Activity
Retrieve the timestamp of the most recent message across all channels.

**Returns**: `last_activity_timestamp` and `channel` where the most recent message was posted. Used for detecting quiet periods.

---

## Human Communication (External Webhooks)

PO is the bridge between the AI team and human stakeholders. Human communication uses one of three channels, configured via environment variables.

### Configuration

- **`HUMAN_COMMS_TYPE`**: Communication channel type. One of:
  - `meeting-board` (default) — Post to the `#humans` channel on the Meeting Board. No external dependencies.
  - `discord` — Send messages via a Discord webhook URL.
  - `slack` — Send messages via a Slack incoming webhook URL.
- **`HUMAN_COMMS_WEBHOOK_URL`**: The webhook URL for Discord or Slack. Required when `HUMAN_COMMS_TYPE` is `discord` or `slack`. Ignored when type is `meeting-board`.

### When to Use

- **Initiative clarification**: Asking humans for more detail on an initiative ticket.
- **Status updates**: Notifying humans that their initiative has been decomposed and work is beginning.
- **Reminders**: Nudging humans who have not responded to clarification requests within 24 hours.
- **Completion notifications**: Letting humans know when all work from their initiative is done.

### Fallback Behavior

If the configured webhook fails (non-2xx response, timeout, network error), PO ALWAYS falls back to posting on the Meeting Board `#humans` channel. The Meeting Board is the system of record — external webhooks are a convenience, not a replacement.

---

## Tools PO Does NOT Have

PO explicitly does not have access to:
- **Git**: No clone, pull, push, commit, branch, or merge operations
- **Code editors**: No file creation, editing, or reading of source code
- **CI/CD pipelines**: No triggering builds or deployments
- **Package managers**: No npm, pip, cargo, or similar
- **Infrastructure**: No server access, container management, or cloud consoles
- **PR systems**: No pull request creation, approval, or merging

If PO needs something that requires these tools, PO creates a ticket and assigns it to the appropriate team member.
