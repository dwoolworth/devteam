# TaskBoard Agent Instructions

## Overview
TaskBoard is our project management system at https://planning.mnemoshare.com

Use this to:
- Read assigned tasks
- Update task status (move between columns)
- Add comments for questions or updates
- Collaborate with humans and other agents

## Authentication

Use your API token with Bearer auth:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://planning.mnemoshare.com/api/tasks
```

### Agent Tokens
- **Julia:** `447d79df9c20cba0d712f145e5140945270dab0d781a9b79e73170564ade62d0`
- **Ashley:** `c5aabef124e7ee0d88b3ecb1dc63d4133404c8fc4a1482db0577ee5f2452c5b3`
- **Quinn:** `d4cc62433975bac461e06c9e2e88457de89bff47be3cb38fdee9abba9f2b3859`

## API Endpoints

### List Tasks
```bash
# All tasks
GET /api/tasks

# Filter by status
GET /api/tasks?status=todo
GET /api/tasks?status=in-progress
GET /api/tasks?status=in-qa

# Filter by assignee
GET /api/tasks?assignee=ashley@mnemoshare.com
```

### Get Single Task
```bash
GET /api/tasks/:id
```

### Update Task
```bash
PUT /api/tasks/:id
Content-Type: application/json

{
  "status": "in-progress",  # backlog | todo | in-progress | in-qa | completed
  "description": "Updated description"
}
```

### Add Comment
```bash
POST /api/tasks/:id/comments
Content-Type: application/json

{
  "text": "Your comment here. Use @Derrick to mention someone."
}
```

### Get Task Comments
```bash
GET /api/tasks/:id/comments
```

## Workflow

### For Development Agents (Ashley, Julia)

1. **Check for assigned tasks:**
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     "https://planning.mnemoshare.com/api/tasks?assignee=YOUR_EMAIL&status=todo"
   ```

2. **Read task details** before starting work

3. **If you have questions:**
   - Add a comment with `@Derrick` or `@Jonathan` mention
   - Wait for webhook notification with their response

4. **When starting work:**
   ```bash
   curl -X PUT -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"status": "in-progress"}' \
     "https://planning.mnemoshare.com/api/tasks/:id"
   ```

5. **When work is complete:**
   - Add a comment describing what was done
   - Move to QA:
   ```bash
   curl -X PUT -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"status": "in-qa"}' \
     "https://planning.mnemoshare.com/api/tasks/:id"
   ```

### For QA Agent (Quinn)

1. **Monitor the QA column:**
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     "https://planning.mnemoshare.com/api/tasks?status=in-qa"
   ```

2. **When testing a task:**
   - Read the task description and comments
   - Verify the work meets requirements

3. **If issues found:**
   - Add a comment describing the bug/issue
   - Move back to in-progress:
   ```bash
   curl -X PUT -d '{"status": "in-progress"}' ...
   ```

4. **If approved:**
   - Add a comment confirming QA passed
   - Move to completed:
   ```bash
   curl -X PUT -d '{"status": "completed"}' ...
   ```

## Webhook Notifications

You'll receive Discord notifications when:
- A task is assigned to you
- Someone comments on your task
- Your task status changes
- You're @mentioned in a comment

**When you receive a webhook:**
1. Read the task details from the API
2. Take appropriate action
3. Respond with a comment if needed

## Column Meanings

| Column | Status | Meaning |
|--------|--------|---------|
| 📋 Backlog | `backlog` | Not yet ready for work |
| 📝 TODO | `todo` | Ready to be picked up |
| 🔨 In Progress | `in-progress` | Currently being worked on |
| 🧪 In QA | `in-qa` | Ready for testing/review |
| ✅ Completed | `completed` | Done! |

## Best Practices

1. **Always read the full task** before starting
2. **Ask questions early** via comments if anything is unclear
3. **Update status promptly** so everyone knows where things are
4. **Add meaningful comments** about what you did and any issues
5. **Never leave a task hanging** - if blocked, comment and move to appropriate status
