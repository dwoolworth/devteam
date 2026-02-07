---
name: git-workflow
description: Branch-based Git workflow for code changes, commits, and pull requests.
---

# Skill: Git Workflow

## Overview

All code changes go through Git using a branch-based workflow. DEV never
commits directly to `main`. Every change lives on a feature branch, goes
through a pull request, and gets reviewed by CQ before merging. This skill
covers the full workflow from cloning to PR creation.

## Configuration

| Variable    | Description                          |
|-------------|--------------------------------------|
| `REPO_URL`  | Git remote URL for the repository    |

Git authentication is handled via SSH keys pre-configured in the container.
GitHub CLI (`gh`) is pre-installed and authenticated.

---

## Workflow Steps

### 1. Clone the Repository

On first setup, clone the project repository into the workspace.

```bash
git clone ${REPO_URL} /home/agent/workspace/repo
cd /home/agent/workspace/repo
```

If the repo is already cloned, make sure you are up to date:

```bash
cd /home/agent/workspace/repo
git checkout main
git pull origin main
```

### 2. Create a Feature Branch

Every ticket gets its own branch. Create it from an up-to-date `main`.

```bash
git checkout main
git pull origin main
git checkout -b feature/TICKET-42-user-authentication
```

**Branch naming convention:**

```
feature/{TICKET-ID}-{brief-description}
```

Rules:
- Always prefix with `feature/`
- Include the full ticket ID (e.g., `TICKET-42`)
- Add a brief, hyphenated description (2-5 words)
- Use lowercase only
- Use hyphens, not underscores

Examples:
- `feature/TICKET-42-user-authentication`
- `feature/TICKET-17-fix-cart-total`
- `feature/TICKET-103-add-rate-limiting`
- `feature/TICKET-8-refactor-db-queries`

**Never branch from another feature branch.** Always branch from `main`.

### 3. Make Changes and Commit

Write your code, then stage and commit in logical, atomic units. Each commit
should represent one coherent change.

```bash
# Stage specific files (preferred over git add .)
git add src/auth/middleware.js src/auth/middleware.test.js

# Commit with conventional commit format
git commit -m "feat(TICKET-42): add JWT authentication middleware"
```

**Conventional commit format:**

```
{type}({TICKET-ID}): {description}

{optional body}

{optional footer}
```

**Commit types:**

| Type       | When to Use                                        |
|------------|----------------------------------------------------|
| `feat`     | A new feature or capability                        |
| `fix`      | A bug fix                                          |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test`     | Adding or updating tests only                      |
| `docs`     | Documentation changes only                         |
| `chore`    | Build process, tooling, or dependency changes      |
| `style`    | Formatting, whitespace, semicolons (no logic change)|
| `perf`     | Performance improvement                            |

**Commit message rules:**
- The description (first line) must be under 72 characters
- Use imperative mood: "add feature" not "added feature" or "adds feature"
- Do not end the description with a period
- The ticket ID must always be in the scope parentheses
- The body (optional) explains *why*, not *what* (the diff shows what)

**Examples of good commits:**

```
feat(TICKET-42): add JWT authentication middleware

Implements token verification for all protected routes.
Uses RS256 signing with rotating keys from the auth service.
```

```
fix(TICKET-42): handle expired token gracefully

Previously returned a 500 error. Now returns 401 with a clear
message telling the client to refresh their token.
```

```
test(TICKET-42): add integration tests for auth flow

Covers login, registration, token refresh, and invalid
credential scenarios.
```

```
refactor(TICKET-42): extract token validation into helper

Reduces complexity in the middleware by moving validation
logic to a dedicated module. Addresses CQ feedback on
function length.
```

**Examples of bad commits:**

```
# Too vague
fix(TICKET-42): fix bug

# No ticket ID
feat: add authentication

# Past tense
feat(TICKET-42): added authentication

# Too long
feat(TICKET-42): add JWT authentication middleware with RS256 signing and rotating keys from auth service with graceful error handling
```

### 4. Push the Branch

Push your feature branch to the remote. Use `-u` on the first push to set
the upstream tracking reference.

```bash
# First push
git push -u origin feature/TICKET-42-user-authentication

# Subsequent pushes
git push
```

If the push is rejected because `main` has moved ahead, rebase:

```bash
git fetch origin
git rebase origin/main
# Resolve any conflicts
git push --force-with-lease
```

Use `--force-with-lease` instead of `--force`. It prevents you from
accidentally overwriting someone else's changes.

### 5. Create a Pull Request

Use the GitHub CLI to create a PR. The PR title should include the ticket ID,
and the body should follow the template below.

```bash
gh pr create \
  --title "TICKET-42: Implement user authentication flow" \
  --body "## Summary
Implements JWT-based user authentication per the requirements in TICKET-42.

## Changes
- Added JWT authentication middleware for protected routes
- Created login endpoint with email/password validation
- Created registration endpoint with input sanitization
- Added rate limiting (5 attempts per minute per IP)
- Added comprehensive test suite (unit + integration)

## Acceptance Criteria
- [x] Users can register with email and password
- [x] Users can log in and receive a JWT
- [x] Protected routes reject unauthenticated requests
- [x] Rate limiting prevents brute force attacks
- [x] All error responses follow the standard format

## Testing
- Unit tests: 24 passing
- Integration tests: 8 passing
- Docker build and test: passing
- Manual verification: login, register, token refresh all working

## Ticket
Resolves TICKET-42"
```

**PR template breakdown:**

| Section              | Purpose                                          |
|----------------------|--------------------------------------------------|
| **Summary**          | 1-2 sentences explaining what and why            |
| **Changes**          | Bulleted list of what was changed                |
| **Acceptance Criteria** | Checklist from the ticket, checked off        |
| **Testing**          | What tests were run, what was verified           |
| **Ticket**           | Reference to the ticket using "Resolves TICKET-X"|

### 6. After PR Creation

Once the PR is created:

1. Start the app running inside your container for QA access
2. Add a ticket comment with the PR link and test URL (under "How to Test")
3. Move the ticket to `in-review` on the planning board
4. Post the PR link on the Meeting Board #review channel
5. Keep the app running until QA renders a verdict

If CQ requests changes:
1. Make the changes on the same feature branch
2. Commit with a clear message referencing the feedback
3. Push to the same branch (the PR updates automatically)
4. Restart the app if the changes affect it
5. Comment on the PR explaining what changed
6. Post an update on the Meeting Board #review channel

### 7. Merge After QA Pass

When QA passes the ticket and moves it to `completed`, you merge the PR to `main`:

1. Check out main and pull latest:

   ```bash
   git checkout main
   git pull origin main
   ```

2. Merge the PR using GitHub CLI:

   ```bash
   gh pr merge {pr_number} --merge --delete-branch
   ```

   Use `--merge` (not squash, not rebase) unless the project specifies otherwise.
   The `--delete-branch` flag cleans up the remote feature branch.

3. Verify the merge:

   ```bash
   git pull origin main
   git log --oneline -3
   ```

4. Stop the running test instance (QA is done with it):

   ```bash
   kill %1  # or kill the app process
   ```

5. Move the ticket to `rfp` on the planning board
6. Add a comment: "PR merged to main. Feature branch cleaned up. Moving to rfp."
7. Post on Meeting Board #review channel

**Merging completed work is your FIRST priority in every heartbeat.** Check
the `completed` column before fixing bugs or picking up new work.

---

## Common Scenarios

### Rebasing After Main Moves Ahead

```bash
git fetch origin
git rebase origin/main

# If conflicts arise:
# 1. Edit the conflicting files to resolve
# 2. Stage the resolved files
git add <resolved-files>
# 3. Continue the rebase
git rebase --continue

# Push the rebased branch
git push --force-with-lease
```

### Squashing Commits Before Review

If you have many small commits that should be one logical change, squash them
before requesting review. Use interactive rebase with care:

```bash
# Squash the last 3 commits into one
git rebase -i HEAD~3
# In the editor: mark the commits to squash with 's'
# Write a clean, combined commit message
git push --force-with-lease
```

### Checking PR Status

```bash
# View your open PRs
gh pr list --author @me

# View a specific PR with details
gh pr view 18

# Check CI/review status
gh pr checks 18
```

### Updating PR Description

```bash
gh pr edit 18 --body "updated description here"
```

---

## Rules

1. **Never commit directly to main.** All changes go through feature branches and PRs.
2. **You merge your own PRs — but only after QA passes.** CQ reviews, QA tests, then you merge when the ticket reaches `completed`.
3. **Always reference the ticket ID** in branch names, commit messages, and PR descriptions.
4. **Keep PRs focused.** One ticket, one PR. Do not bundle unrelated changes.
5. **Test before pushing.** If tests fail, fix them before creating the PR.
6. **Use force-with-lease, never force.** Protect against accidentally overwriting shared work.
7. **Write meaningful commit messages.** Future you and your teammates will thank you.
8. **Keep your branch up to date.** Rebase on main regularly to avoid large merge conflicts.
9. **Merge completed work first.** Always check `completed` column before starting new work.
