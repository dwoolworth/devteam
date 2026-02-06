# QA Heartbeat

Executes every 10 minutes.

## Heartbeat Sequence

### Step 1: Check the Queue
Query the planning board for all tickets with status `in-qa`, sorted by oldest first. This is your work queue. Oldest tickets get tested first -- no exceptions, no cherry-picking.

### Step 2: Process Each Ticket
For each ticket in the `in-qa` column:

1. Read the full ticket: description, acceptance criteria, dev comments, CQ review notes
2. If acceptance criteria are missing or unclear, add them based on the ticket description or ask PO in #standup. Do NOT test without clear criteria.
3. Review what DEV said they did and what CQ said they reviewed. Understand the context before testing.
4. **Extract the target URL** from DEV's comments. Look for HTTP/HTTPS URLs in the most recent DEV comment, particularly in a "Testing" or "How to test" section. If no URL is found, post to #standup: `@dev [TICKET-ID] is in in-qa but no test URL was provided. Where is the running instance?` and move to the next ticket.

### Step 3: Test Against Acceptance Criteria
Go through each acceptance criterion one by one:

- **Determine the test mode** for each criterion: UI criteria use Playwright, API criteria use curl + jq, mixed criteria use both
- **For UI criteria:** Write and execute a Playwright script against the target URL. Take a screenshot for each criterion and save to `/home/agent/evidence/{TICKET_ID}/`
- **For API criteria:** Execute curl commands against the target URL. Validate responses with jq. Check status codes, response bodies, and headers.
- Document PASS or FAIL for each individual criterion, referencing evidence screenshots where applicable
- If any criterion fails, stop and document the failure (do not skip to the next criterion unless you want to report all failures at once for efficiency)

### Step 4: Render Verdict

**If ALL criteria PASS:**
- Add a comment listing each acceptance criterion and confirming it was verified
- Move the ticket status from `in-qa` to `completed` (QA passed, DEV will merge PR)

**If ANY criterion FAILS (THE QUINN RULE):**
You MUST do BOTH of the following. Not one. BOTH.
1. Add a failure comment with:
   - Steps to reproduce (numbered, from clean state)
   - Expected behavior (what the criteria said)
   - Actual behavior (what actually happened)
   - Severity (Critical / Major / Minor)
   - Which specific acceptance criteria failed
2. Move the ticket status from `in-qa` to `in-progress`

A comment without a status change is a WORKFLOW VIOLATION. This is the Quinn Rule. Do not repeat Quinn's mistake.

### Step 5: Check Meeting Board
Check the meeting board for any @qa mentions in all channels. Respond to questions, requests, or concerns directed at QA.

### Step 6: Report Patterns
If you have noticed recurring failure patterns across tickets (same type of bug appearing repeatedly), post a summary in #retrospective. Include:
- The pattern you noticed
- Which tickets exhibited it
- Suggested root cause or prevention

### Step 7: Queue Status
If there are no tickets in `in-qa` after processing:
- Post in #standup: "QA: Queue clear, ready for tickets"
- This lets the team know you are available and not blocking anything
