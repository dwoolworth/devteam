# QA Tools

## Planning Board API

The planning board is your primary work interface. You read tickets from the `in-qa` column, test them, and move them forward or back.

### Capabilities
- **Read tickets:** Fetch tickets filtered by status, read descriptions, acceptance criteria, comments, and history
- **Add comments:** Post detailed test results as comments on tickets
- **Change status:** Move tickets between allowed statuses (in-qa -> rfp, in-qa -> in-progress)

### Access Level
- Full read access to all tickets (you need context from the full pipeline)
- Write access limited to comments and status changes on `in-qa` tickets
- No create, delete, or assign permissions

## Meeting Board API

The meeting board is where you communicate with the team.

### Capabilities
- **Post messages:** Share QA status updates, ask questions, report patterns
- **Read channels:** Monitor #standup, #retrospective, and other channels
- **Check mentions:** Look for @qa mentions that need your response

### Key Channels
- **#standup:** Post queue status, ask clarifying questions
- **#retrospective:** Report recurring failure patterns

## Test Execution Tools

### Playwright (Browser Testing)
Headless Chromium browser for UI verification. Playwright is installed in your container with Chromium.

- **Navigate pages:** Load URLs, follow links, handle redirects
- **Interact with elements:** Click buttons, fill forms, select dropdowns, check checkboxes
- **Read page content:** Extract text, check visibility, count elements, read input values
- **Take screenshots:** Capture full-page or element screenshots as evidence
- **Wait for state:** Wait for navigation, selectors, network idle

Usage: Write Node.js scripts using the `playwright` module and execute with `node`.

### curl + jq (API Testing)
HTTP requests with response validation for API endpoint testing.

- **All HTTP methods:** GET, POST, PUT, DELETE, PATCH
- **Status code checking:** Capture and validate HTTP status codes
- **JSON validation:** Parse response bodies with jq, check field values, array lengths, nested structures
- **Header inspection:** Verify content types, auth headers, CORS headers

Usage: Execute curl commands directly in the shell, pipe to jq for JSON parsing.

### Evidence Storage
Screenshots and test artifacts are saved to `/home/agent/evidence/`, which is mounted as a volume to the host.

- **Screenshot naming:** `{TICKET_ID}-AC{N}-{pass|fail}.png`
- **Directory per ticket:** `/home/agent/evidence/{TICKET_ID}/`
- **Referenced in comments:** Include evidence file paths in ticket comments so the team can review

### Node.js
Available for writing custom test scripts when shell commands are not sufficient. Node.js 20 LTS is installed with npm. Use it to write Playwright scripts or custom validation logic.

## Access Restrictions

- **No write access to project code.** You do not modify source code. You do not fix bugs. You find them, document them, and send them back.
- **No infrastructure access.** Deployment and infrastructure are OPS territory.
- **No ticket creation.** If you find a bug outside the current ticket scope, report it to PO or add it to your failure comment for the relevant ticket.
