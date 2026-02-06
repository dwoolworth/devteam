# QA Test Runner Skill

## Overview
The test runner skill is how QA validates tickets against their acceptance criteria using real testing tools. You have two primary tools: **Playwright** (headless Chromium) for browser/UI testing and **curl + jq** for API testing. Every test follows a structured process: understand the criteria, determine the test mode, extract the target URL, execute the verification, capture evidence, document the result.

## Determining Test Mode

Read the acceptance criteria and determine whether each criterion requires **browser testing**, **API testing**, or **both**.

### Browser Testing (Playwright) — use when criteria mention:
- Form, button, page, click, display, redirect, modal, navigation
- Responsive, layout, visual appearance, text content on page
- User interactions (fill, submit, hover, scroll, drag)
- Page load, rendering, error pages, redirects

### API Testing (curl + jq) — use when criteria mention:
- Endpoint, route, response, status code, JSON, header, payload
- REST verbs (GET, POST, PUT, DELETE, PATCH)
- Authentication tokens, rate limiting, CORS
- Response body structure, data validation

### Mixed — when criteria include both UI and API elements:
- Test API criteria with curl first, then UI criteria with Playwright
- Document which tool was used for each criterion

## Extracting the Target URL

DEV provides the target URL in their ticket comment when moving the ticket to `in-review`. Look for it in:

1. The most recent DEV comment on the ticket
2. Specifically in a "Testing" or "How to test" section
3. Look for HTTP/HTTPS URLs (e.g., `http://dev-app:3000`, `http://devteam-dev-app:8080`)

If no URL is found in the ticket comments:
- Post to **#standup**: `@dev [TICKET-ID] is in in-qa but no test URL was provided. Where is the running instance?`
- Do NOT attempt to test without a target URL. Move to the next ticket in the queue.

## Browser Testing with Playwright

### Writing Test Scripts

Write ad-hoc Playwright scripts based on acceptance criteria. Save scripts to `/tmp/test-{TICKET_ID}.js` and execute them.

### Basic Script Structure

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const TICKET_ID = 'TICKET-123';
  const evidenceDir = `/home/agent/evidence/${TICKET_ID}`;

  // Ensure evidence directory exists
  const fs = require('fs');
  fs.mkdirSync(evidenceDir, { recursive: true });

  try {
    // Navigate to the target URL
    await page.goto('http://target-url:3000');

    // AC-1: Verify page loads with correct title
    const title = await page.title();
    if (title.includes('Expected Title')) {
      await page.screenshot({ path: `${evidenceDir}/${TICKET_ID}-AC1-pass.png` });
      console.log('AC-1: PASS - Title is correct');
    } else {
      await page.screenshot({ path: `${evidenceDir}/${TICKET_ID}-AC1-fail.png` });
      console.log(`AC-1: FAIL - Expected title containing "Expected Title", got "${title}"`);
    }

    // AC-2: Verify login form works
    await page.fill('#username', 'testuser');
    await page.fill('#password', 'testpass');
    await page.screenshot({ path: `${evidenceDir}/${TICKET_ID}-AC2-before-submit.png` });
    await page.click('#login-button');
    await page.waitForNavigation();
    const url = page.url();
    if (url.includes('/dashboard')) {
      await page.screenshot({ path: `${evidenceDir}/${TICKET_ID}-AC2-pass.png` });
      console.log('AC-2: PASS - Login redirects to dashboard');
    } else {
      await page.screenshot({ path: `${evidenceDir}/${TICKET_ID}-AC2-fail.png` });
      console.log(`AC-2: FAIL - Expected redirect to /dashboard, got ${url}`);
    }

  } catch (error) {
    await page.screenshot({ path: `${evidenceDir}/${TICKET_ID}-error.png` });
    console.error(`Test error: ${error.message}`);
  } finally {
    await browser.close();
  }
})();
```

### Running the Script

```bash
node /tmp/test-TICKET-123.js
```

### Common Playwright Operations

```javascript
// Navigation
await page.goto('http://target:3000/path');
await page.waitForNavigation();
await page.waitForSelector('#element');
await page.waitForTimeout(1000); // only when necessary

// Interaction
await page.click('#button');
await page.fill('#input', 'value');
await page.selectOption('#dropdown', 'option-value');
await page.check('#checkbox');

// Reading content
const text = await page.textContent('#element');
const value = await page.inputValue('#input');
const visible = await page.isVisible('#element');
const count = await page.locator('.item').count();

// Screenshots
await page.screenshot({ path: '/home/agent/evidence/TICKET-123/AC1-pass.png' });
await page.screenshot({ path: '/home/agent/evidence/TICKET-123/AC1-pass.png', fullPage: true });

// Assertions (manual — check values and log results)
const heading = await page.textContent('h1');
console.log(heading === 'Welcome' ? 'PASS' : `FAIL - got "${heading}"`);
```

## API Testing with curl + jq

### Basic Patterns

```bash
# GET request — check status code and response body
STATUS=$(curl -s -o /tmp/response.json -w '%{http_code}' http://target:3000/api/endpoint)
echo "Status: $STATUS"
cat /tmp/response.json | jq .

# POST request with JSON body
STATUS=$(curl -s -o /tmp/response.json -w '%{http_code}' \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}' \
  http://target:3000/api/endpoint)
echo "Status: $STATUS"
cat /tmp/response.json | jq .

# PUT request
STATUS=$(curl -s -o /tmp/response.json -w '%{http_code}' \
  -X PUT \
  -H "Content-Type: application/json" \
  -d '{"key": "updated-value"}' \
  http://target:3000/api/endpoint/123)

# DELETE request
STATUS=$(curl -s -o /tmp/response.json -w '%{http_code}' \
  -X DELETE \
  http://target:3000/api/endpoint/123)

# Check specific JSON fields
cat /tmp/response.json | jq -e '.data.id == 123'  # exits non-zero if false
cat /tmp/response.json | jq -e '.items | length > 0'

# Check response headers
curl -s -I http://target:3000/api/endpoint | grep -i content-type
```

### API Test Example

```bash
TICKET_ID="TICKET-456"
TARGET="http://target:3000"

# AC-1: GET /api/users returns 200 and a list of users
STATUS=$(curl -s -o /tmp/response.json -w '%{http_code}' "$TARGET/api/users")
if [ "$STATUS" = "200" ]; then
  COUNT=$(cat /tmp/response.json | jq '.users | length')
  if [ "$COUNT" -gt "0" ]; then
    echo "AC-1: PASS - GET /api/users returns 200 with $COUNT users"
  else
    echo "AC-1: FAIL - GET /api/users returns 200 but user list is empty"
  fi
else
  echo "AC-1: FAIL - Expected status 200, got $STATUS"
  cat /tmp/response.json | jq .
fi

# AC-2: POST /api/users creates a new user and returns 201
STATUS=$(curl -s -o /tmp/response.json -w '%{http_code}' \
  -X POST -H "Content-Type: application/json" \
  -d '{"name": "Test User", "email": "test@example.com"}' \
  "$TARGET/api/users")
if [ "$STATUS" = "201" ]; then
  ID=$(cat /tmp/response.json | jq -r '.user.id')
  echo "AC-2: PASS - POST /api/users returns 201, created user ID: $ID"
else
  echo "AC-2: FAIL - Expected status 201, got $STATUS"
  cat /tmp/response.json | jq .
fi
```

## Screenshot Evidence

### Naming Convention
```
{TICKET_ID}-AC{N}-{pass|fail}.png
```

Examples:
- `TICKET-123-AC1-pass.png` — Acceptance Criterion 1 passed
- `TICKET-123-AC2-fail.png` — Acceptance Criterion 2 failed
- `TICKET-123-AC2-before-submit.png` — Intermediate state capture
- `TICKET-123-error.png` — Unexpected error during testing

### Storage Path
```
/home/agent/evidence/{TICKET_ID}/
```

Create the directory before saving screenshots:
```bash
mkdir -p /home/agent/evidence/TICKET-123
```

### Referencing in Ticket Comments
Always reference evidence file paths in your pass/fail comments:
```markdown
- [x] **AC-1:** Login form displays correctly - VERIFIED
  Evidence: `/evidence/TICKET-123/TICKET-123-AC1-pass.png`
```

## Test Result Documentation Format

### PASS Template

```markdown
## QA PASS

All acceptance criteria verified successfully.

### Test Mode
- **Browser (Playwright):** AC-1, AC-2, AC-3
- **API (curl):** AC-4, AC-5
- **Target URL:** http://target-url:3000

### Criteria Results
- [x] **AC-1:** [Criterion text] - VERIFIED: [How it was verified]
  Evidence: `/evidence/{TICKET_ID}/{TICKET_ID}-AC1-pass.png`
- [x] **AC-2:** [Criterion text] - VERIFIED: [How it was verified]
  Evidence: `/evidence/{TICKET_ID}/{TICKET_ID}-AC2-pass.png`
- [x] **AC-3:** [Criterion text] - VERIFIED: [How it was verified]

### Test Environment
- Container: devteam-qa
- Target URL: [the URL from DEV's comment]
- Tested at: [timestamp]
- Test data: [description of test data used, if relevant]

### Notes
[Any observations that don't affect the pass/fail verdict but may be useful]

**Verdict: PASS - Moving to completed**
```

### FAIL Template

```markdown
## QA FAIL

One or more acceptance criteria not met.

### Test Mode
- **Browser (Playwright):** AC-1, AC-2
- **API (curl):** AC-3
- **Target URL:** http://target-url:3000

### Failed Criteria

#### [AC-N]: [Criterion text] - FAILED

**Steps to Reproduce:**
1. Start from [clean state / specific precondition]
2. Navigate to [URL]
3. [Exact action]
4. Observe: [what you see]

**Expected Behavior:**
[What the acceptance criterion says should happen, quoted directly]

**Actual Behavior:**
[What actually happened, with specifics -- error messages, incorrect values, missing elements]

**Evidence:** `/evidence/{TICKET_ID}/{TICKET_ID}-AC{N}-fail.png`

**Severity:** [Critical | Major | Minor]
- Critical: Blocks core functionality, data loss, security issue
- Major: Significant feature broken, poor user experience, no workaround
- Minor: Cosmetic issue, edge case, workaround available

### Passing Criteria
- [x] **AC-1:** [Criterion text] - VERIFIED
  Evidence: `/evidence/{TICKET_ID}/{TICKET_ID}-AC1-pass.png`

### Test Environment
- Container: devteam-qa
- Target URL: [the URL from DEV's comment]
- Tested at: [timestamp]
- Test data: [description of test data used, if relevant]

**Verdict: FAIL - Moving to in-progress (Quinn Rule: comment + status change)**
```

## Reproducible Failure Reports

Every failure report must be reproducible by anyone on the team. The standard is: if DEV reads your failure comment, they should be able to reproduce the exact issue without asking you a single question.

### Checklist for a Good Failure Report
- [ ] Steps start from a known, clean state
- [ ] Each step is a single, concrete action (not "set up the environment")
- [ ] Expected behavior quotes or directly references the acceptance criterion
- [ ] Actual behavior includes specific details (error messages, wrong values, screenshot references)
- [ ] Screenshot evidence is attached for UI failures
- [ ] Severity is assigned and justified
- [ ] The specific acceptance criterion that failed is clearly identified

### Common Pitfalls to Avoid
- "It doesn't work" -- too vague. What specifically does not work?
- "See screenshot" without describing what is in the screenshot -- always describe in text AND attach the screenshot
- Assuming DEV knows your test environment setup -- state it explicitly
- Mixing multiple failures into one blob -- separate each failed criterion clearly

## Regression Testing

When a ticket comes back to QA after a failure (DEV fixed it, CQ re-reviewed it):
1. Re-test the SPECIFIC criteria that failed previously
2. Also re-test all OTHER criteria (regression check -- the fix might have broken something else)
3. Document that this is a re-test in your comment: "Re-test after failure on [date]. Previous failure: [brief description]."
4. Take fresh screenshots for all criteria -- do not reuse old evidence
