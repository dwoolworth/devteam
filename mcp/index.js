#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v3';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';

import {
  loadTeam, saveTeam, setupProject, setStack, setPlatform,
  setCredentials, getProject, addAgent, updateAgent, removeAgent, getTeam,
  resetTeam, addHuman, removeHuman,
} from './lib/team.js';
import {
  listRoles, listArchetypes, listTraits, getArchetype,
} from './lib/traits.js';
import { generate, previewPersonality } from './lib/generator.js';
import { deploy, teardown, rebuildAgent } from './lib/deployer.js';
import {
  teamStatus, agentLogs, restartAgent, postMessage, readChannel,
} from './lib/monitor.js';
import {
  inspectAgent, readSkill, listTickets, getTicket, boardSummary,
} from './lib/inspector.js';

// Project root is the devteam directory (parent of mcp/)
const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const server = new McpServer({
  name: 'devteam',
  version: '1.0.0',
});

// ============================================================================
// Project Setup Tools
// ============================================================================

server.tool(
  'setup_project',
  'Initialize or update the project configuration — name, description, repo URL, and manager (your name so agents address you personally)',
  {
    name: z.string().optional().describe('Project name'),
    description: z.string().optional().describe('Project description'),
    repo: z.string().optional().describe('Git repository URL'),
    manager_name: z.string().optional().describe('Your name — agents will address you by this name instead of "Manager"'),
    manager_email: z.string().optional().describe('Your email for the team (default: manager@devteam.local)'),
  },
  async ({ name, description, repo, manager_name, manager_email }) => {
    const result = setupProject(PROJECT_ROOT, { name, description, repo, manager_name, manager_email });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'set_stack',
  'Set tech stack: language, framework, frontend, database, testing tools',
  {
    language: z.string().optional().describe('Primary language (go, python, javascript, rust, etc.)'),
    framework: z.string().optional().describe('Backend framework (gin, django, express, etc.)'),
    frontend: z.string().optional().describe('Frontend framework (react, vue, svelte, etc.)'),
    database: z.string().optional().describe('Database (postgres, mysql, mongodb, etc.)'),
    testing: z.string().optional().describe('Testing framework (playwright, cypress, jest, etc.)'),
  },
  async (stack) => {
    const result = setStack(PROJECT_ROOT, stack);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'set_platform',
  'Set deployment platform: docker-compose or kubernetes, with optional cloud provider',
  {
    target: z.enum(['docker-compose', 'kubernetes']).describe('Deployment target'),
    provider: z.string().optional().describe('Cloud provider: local, digitalocean, aws, gcp, azure'),
    registry: z.string().optional().describe('Container registry URL'),
  },
  async (platform) => {
    const result = setPlatform(PROJECT_ROOT, platform);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'set_cloud_credentials',
  'Store cloud CLI credentials (DOCTL_TOKEN, AWS keys, etc.) — injected into OPS agent containers',
  {
    credentials: z.record(z.string()).describe('Key-value pairs of credential env vars'),
  },
  async ({ credentials }) => {
    const result = setCredentials(PROJECT_ROOT, credentials);
    return { content: [{ type: 'text', text: `Stored credentials: ${result.join(', ')}` }] };
  }
);

server.tool(
  'get_project',
  'Show current project configuration',
  {},
  async () => {
    const result = getProject(PROJECT_ROOT);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ============================================================================
// Design Phase Tools
// ============================================================================

server.tool(
  'list_roles',
  'Show available agent roles (po, dev, cq, qa, ops) with descriptions and tools',
  {},
  async () => {
    const roles = listRoles();
    return { content: [{ type: 'text', text: JSON.stringify(roles, null, 2) }] };
  }
);

server.tool(
  'list_archetypes',
  'Show personality archetypes with trait summaries — commander, diplomat, craftsperson, etc.',
  {},
  async () => {
    const archetypes = listArchetypes(PROJECT_ROOT);
    return { content: [{ type: 'text', text: JSON.stringify(archetypes, null, 2) }] };
  }
);

server.tool(
  'list_traits',
  'Show the 14 personality traits with low/mid/high descriptions',
  {},
  async () => {
    const traits = listTraits(PROJECT_ROOT);
    return { content: [{ type: 'text', text: JSON.stringify(traits, null, 2) }] };
  }
);

server.tool(
  'get_archetype',
  'Get full trait values for a named archetype',
  {
    archetype: z.string().describe('Archetype ID: commander, diplomat, craftsperson, maverick, sentinel, hustler, mentor, detective, operator, wildcard'),
  },
  async ({ archetype }) => {
    try {
      const result = getArchetype(PROJECT_ROOT, archetype);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'add_agent',
  'Add an agent to the team with a unique name, role, provider, archetype, and optional trait overrides',
  {
    name: z.string().describe('Unique agent name (e.g., "Piper", "Devon", "Alex")'),
    role: z.enum(['po', 'dev', 'cq', 'qa', 'ops']).describe('Agent role'),
    provider: z.string().describe('AI provider/model (e.g., "xai/grok-3", "anthropic/claude-sonnet-4-20250514")'),
    archetype: z.string().describe('Personality archetype ID'),
    traits: z.record(z.number()).optional().describe('Optional trait overrides (0-100), e.g. {"empathy": 75, "humor": 60}'),
    backstory: z.string().optional().describe('Optional personal backstory — history, family, hobbies, quirks that add conversational texture'),
  },
  async ({ name, role, provider, archetype, traits, backstory }) => {
    try {
      const result = addAgent(PROJECT_ROOT, { name, role, provider, archetype, traits, backstory });
      return { content: [{ type: 'text', text: `Added ${name} as ${role} (${archetype} archetype)\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'update_agent',
  'Modify an existing agent\'s configuration by name',
  {
    name: z.string().describe('Agent name to update'),
    role: z.enum(['po', 'dev', 'cq', 'qa', 'ops']).optional().describe('New role'),
    provider: z.string().optional().describe('New AI provider/model'),
    archetype: z.string().optional().describe('New personality archetype'),
    traits: z.record(z.number()).optional().describe('Trait overrides to merge'),
    backstory: z.string().optional().describe('Personal backstory — history, family, hobbies, quirks'),
  },
  async ({ name, ...updates }) => {
    try {
      // Filter out undefined values
      const filtered = Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== undefined)
      );
      const result = updateAgent(PROJECT_ROOT, name, filtered);
      return { content: [{ type: 'text', text: `Updated ${name}\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'remove_agent',
  'Remove an agent from the team by name',
  {
    name: z.string().describe('Agent name to remove'),
  },
  async ({ name }) => {
    try {
      const result = removeAgent(PROJECT_ROOT, name);
      return { content: [{ type: 'text', text: `Removed ${result.name} (${result.role})` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'start_over',
  'Reset EVERYTHING — remove all agents from team.yml and delete the entire generated/ directory. Use this to start fresh with a completely new team.',
  {
    confirm: z.literal('yes').describe('Must pass "yes" to confirm the reset'),
  },
  async ({ confirm }) => {
    try {
      const result = resetTeam(PROJECT_ROOT);
      let text = `Team reset complete.\n\nRemoved:\n${result.removed.map((r) => `  - ${r}`).join('\n')}`;
      text += `\n\nProject config preserved: ${result.project.name || '(unnamed)'}`;
      text += `\n\nNext steps: use add_agent to build a new team, then generate + deploy.`;
      return { content: [{ type: 'text', text }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'add_human',
  'Add a human user (stakeholder, observer) to the team — they get board access and can be @mentioned by agents',
  {
    name: z.string().describe('Human\'s name (e.g., "Alice")'),
    email: z.string().describe('Human\'s email (e.g., "alice@example.com")'),
    role: z.string().optional().describe('Role: stakeholder, observer (default: stakeholder)'),
  },
  async ({ name, email, role }) => {
    try {
      const result = addHuman(PROJECT_ROOT, { name, email, role });
      return { content: [{ type: 'text', text: `Added human: ${result.name} (${result.email}) as ${result.role}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'remove_human',
  'Remove a human user from the team by name',
  {
    name: z.string().describe('Human\'s name to remove'),
  },
  async ({ name }) => {
    try {
      const result = removeHuman(PROJECT_ROOT, name);
      return { content: [{ type: 'text', text: `Removed human: ${result.name} (${result.email})` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'get_team',
  'Show the current team roster with all agents and their configurations',
  {},
  async () => {
    const team = getTeam(PROJECT_ROOT);
    if (team.agents.length === 0) {
      return { content: [{ type: 'text', text: 'No agents configured yet. Use add_agent to build your team.' }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(team, null, 2) }] };
  }
);

server.tool(
  'preview_personality',
  'Preview the generated IDENTITY.md and SOUL.md for an agent before full generation',
  {
    name: z.string().describe('Agent name to preview'),
  },
  async ({ name }) => {
    try {
      const result = previewPersonality(PROJECT_ROOT, name);
      return {
        content: [
          { type: 'text', text: `## IDENTITY.md Preview\n\n${result.identity}\n\n---\n\n## SOUL.md Preview\n\n${result.soul}` },
        ],
      };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ============================================================================
// Generate & Deploy Tools
// ============================================================================

server.tool(
  'generate',
  'Generate all artifacts: agent personas, registry, compose/k8s manifests, .env, router config',
  {},
  async () => {
    try {
      const result = generate(PROJECT_ROOT);
      let text = `Generated artifacts for ${result.agents.length} agents:\n\n` +
        `Agents: ${result.agents.join(', ')}\n\n` +
        `Files created:\n${result.files.map((f) => `  - generated/${f}`).join('\n')}`;
      if (result.warnings && result.warnings.length > 0) {
        text += `\n\nWarnings:\n${result.warnings.map((w) => `  ⚠ ${w}`).join('\n')}`;
      }
      return { content: [{ type: 'text', text }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Generation failed: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'deploy',
  'Deploy the team to Docker Compose or Kubernetes',
  {
    target: z.enum(['docker-compose', 'kubernetes']).optional().describe('Deployment target (auto-detected from config if not specified)'),
  },
  async ({ target }) => {
    try {
      const result = deploy(PROJECT_ROOT, { target });
      return {
        content: [
          {
            type: 'text',
            text: `Deployment: ${result.status} (${result.target})\n\n${result.details.join('\n')}`,
          },
        ],
      };
    } catch (e) {
      return { content: [{ type: 'text', text: `Deployment failed: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'teardown',
  'Stop and remove the deployment (Docker Compose down or kubectl delete)',
  {
    target: z.enum(['docker-compose', 'kubernetes']).optional().describe('Deployment target'),
  },
  async ({ target }) => {
    try {
      const result = teardown(PROJECT_ROOT, { target });
      return { content: [{ type: 'text', text: `${result.status} (${result.target})` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Teardown failed: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'rebuild_agent',
  'Rebuild and restart a single agent container (after personality change)',
  {
    name: z.string().describe('Agent name to rebuild'),
  },
  async ({ name }) => {
    try {
      const result = rebuildAgent(PROJECT_ROOT, name);
      return { content: [{ type: 'text', text: `${result.agent}: ${result.status}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Rebuild failed: ${e.message}` }], isError: true };
    }
  }
);

// ============================================================================
// Monitor & Manage Tools
// ============================================================================

server.tool(
  'team_status',
  'Show all agents with online/offline status, uptime, and configuration',
  {},
  async () => {
    try {
      const statuses = teamStatus(PROJECT_ROOT);
      if (statuses.length === 0) {
        return { content: [{ type: 'text', text: 'No agents configured. Use add_agent to build your team.' }] };
      }
      const lines = statuses.map((s) => {
        const icon = s.online ? '🟢' : '🔴';
        return `${icon} **${s.name}** (${s.role}) — ${s.online ? `online, uptime: ${s.uptime}` : 'offline'} — ${s.provider} [${s.archetype}]`;
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'agent_logs',
  'Get recent logs for a specific agent by name',
  {
    name: z.string().describe('Agent name'),
    lines: z.number().optional().describe('Number of log lines (default 50)'),
  },
  async ({ name, lines }) => {
    try {
      const result = agentLogs(PROJECT_ROOT, name, lines || 50);
      return { content: [{ type: 'text', text: `## Logs for ${result.agent}\n\n\`\`\`\n${result.logs}\n\`\`\`` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'restart_agent',
  'Restart a specific agent container',
  {
    name: z.string().describe('Agent name to restart'),
  },
  async ({ name }) => {
    try {
      const result = restartAgent(PROJECT_ROOT, name);
      return { content: [{ type: 'text', text: `${result.agent}: ${result.status}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'post_message',
  'Post a message to a meeting board channel as the manager',
  {
    channel: z.string().describe('Channel name (e.g., "standup", "planning", "humans")'),
    text: z.string().describe('Message content'),
  },
  async ({ channel, text }) => {
    try {
      const result = await postMessage(PROJECT_ROOT, channel, text);
      return { content: [{ type: 'text', text: `Posted to #${result.channel}: "${result.message}"` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'read_channel',
  'Read recent messages from a meeting board channel',
  {
    channel: z.string().describe('Channel name'),
    limit: z.number().optional().describe('Number of messages (default 20)'),
  },
  async ({ channel, limit }) => {
    try {
      const result = await readChannel(PROJECT_ROOT, channel, limit || 20);
      if (!result.messages || result.messages.length === 0) {
        return { content: [{ type: 'text', text: `No messages in #${channel}` }] };
      }
      const formatted = result.messages.map((m) => {
        const time = new Date(m.created_at).toLocaleString();
        const name = m.author_name || m.author || 'unknown';
        const role = m.author_role ? ` (${m.author_role})` : '';
        return `**${name}${role}** (${time}):\n${m.content}`;
      });
      return { content: [{ type: 'text', text: `## #${channel}\n\n${formatted.join('\n\n---\n\n')}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ============================================================================
// Inspect & Board Tools
// ============================================================================

server.tool(
  'inspect_agent',
  'Read an agent\'s generated persona files (IDENTITY.md, SOUL.md, HEARTBEAT.md, TOOLS.md) and list its skills',
  {
    name: z.string().describe('Agent name (e.g., "Piper", "Juniper")'),
  },
  async ({ name }) => {
    try {
      const result = inspectAgent(PROJECT_ROOT, name);
      let text = `## ${result.agent} — Persona Files\n\n`;
      for (const [filename, content] of Object.entries(result.files)) {
        text += `### ${filename}\n\n${content}\n\n---\n\n`;
      }
      if (result.skills.length > 0) {
        text += `### Skills\n\n${result.skills.map((s) => `- ${s}`).join('\n')}`;
      } else {
        text += `### Skills\n\nNo skills configured.`;
      }
      return { content: [{ type: 'text', text }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'read_skill',
  'Read a specific skill\'s SKILL.md for an agent — useful for debugging skill definitions',
  {
    name: z.string().describe('Agent name'),
    skill: z.string().describe('Skill directory name (e.g., "meeting-board", "planning-board")'),
  },
  async ({ name, skill }) => {
    try {
      const result = readSkill(PROJECT_ROOT, name, skill);
      return { content: [{ type: 'text', text: `## ${result.agent} / ${result.skill}\n\n${result.content}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'list_tickets',
  'Query project board tickets with optional filters — status, assignee, type, priority, search text',
  {
    status: z.string().optional().describe('Filter by status: backlog, todo, in-progress, blocked, in-review, in-qa, completed, rfp, closed'),
    assignee: z.string().optional().describe('Filter by assignee email (e.g., "piper@devteam.local") or "none" for unassigned'),
    type: z.string().optional().describe('Filter by type: initiative, epic, story'),
    priority: z.number().optional().describe('Filter by priority: 1 (lowest) to 5 (critical)'),
    search: z.string().optional().describe('Search ticket names, descriptions, and numbers'),
    limit: z.number().optional().describe('Max results (default 100)'),
  },
  async (filters) => {
    try {
      const tickets = await listTickets(PROJECT_ROOT, filters);
      if (!Array.isArray(tickets) || tickets.length === 0) {
        return { content: [{ type: 'text', text: 'No tickets found matching filters.' }] };
      }
      const lines = tickets.map((t) => {
        const assignee = t.assignee || 'unassigned';
        const priority = { 5: 'CRIT', 4: 'HIGH', 3: 'MED', 2: 'LOW', 1: 'MIN' }[t.priority] || '?';
        const typePrefix = (t.type && t.type !== 'story') ? `[${t.type.toUpperCase()}] ` : '';
        return `**${t.ticketNumber || '?'}** ${typePrefix}[${priority}] ${t.name || t.title || 'Untitled'} — *${t.status}* (${assignee})`;
      });
      return { content: [{ type: 'text', text: `## Tickets (${tickets.length})\n\n${lines.join('\n')}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'get_ticket',
  'Get full ticket detail including comments and history by ticket number (e.g., MNS-22) or ID',
  {
    ticket: z.string().describe('Ticket number (e.g., "MNS-22") or ObjectId'),
  },
  async ({ ticket }) => {
    try {
      const t = await getTicket(PROJECT_ROOT, ticket);
      let text = `## ${t.ticketNumber || ticket} — ${t.name || t.title || 'Untitled'}\n\n`;
      text += `**Status:** ${t.status}  **Priority:** ${t.priority}  **Assignee:** ${t.assignee || 'unassigned'}\n`;
      if (t.type) text += `**Type:** ${t.type}  `;
      if (t.complexity) text += `**Complexity:** ${t.complexity}`;
      text += '\n';
      if (t.description) text += `\n### Description\n\n${t.description}\n`;
      if (t.comments && t.comments.length > 0) {
        text += `\n### Comments (${t.comments.length})\n\n`;
        text += t.comments.map((c) => {
          const time = new Date(c.timestamp).toLocaleString();
          return `**${c.authorName || c.author}** (${time}):\n${c.text || c.body}`;
        }).join('\n\n---\n\n');
      }
      if (t.history && t.history.length > 0) {
        text += `\n\n### History (${t.history.length})\n\n`;
        text += t.history.map((h) => {
          const time = new Date(h.timestamp).toLocaleString();
          return `- ${time} — ${h.details} *(${h.user})*`;
        }).join('\n');
      }
      return { content: [{ type: 'text', text }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'board_summary',
  'Get project board overview — ticket counts per status column and workload per assignee',
  {},
  async () => {
    try {
      const { statusCounts, workload } = await boardSummary(PROJECT_ROOT);

      let text = '## Board Summary\n\n### Status Counts\n\n';
      const statusOrder = ['backlog', 'todo', 'in-progress', 'blocked', 'in-review', 'in-qa', 'completed', 'rfp', 'closed'];
      for (const status of statusOrder) {
        if (statusCounts[status]) {
          text += `- **${status}**: ${statusCounts[status]}\n`;
        }
      }
      // Include any statuses not in the standard list
      for (const [status, count] of Object.entries(statusCounts)) {
        if (!statusOrder.includes(status)) {
          text += `- **${status}**: ${count}\n`;
        }
      }

      text += '\n### Workload\n\n';
      for (const [assignee, count] of Object.entries(workload)) {
        text += `- **${assignee}**: ${count} tickets\n`;
      }

      return { content: [{ type: 'text', text }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// ============================================================================
// MCP Resources
// ============================================================================

server.resource(
  'devteam://team',
  'devteam://team',
  async (uri) => {
    const teamFile = path.join(PROJECT_ROOT, 'team.yml');
    if (!fs.existsSync(teamFile)) {
      return { contents: [{ uri: uri.href, mimeType: 'text/yaml', text: '# No team.yml yet' }] };
    }
    const text = fs.readFileSync(teamFile, 'utf8');
    return { contents: [{ uri: uri.href, mimeType: 'text/yaml', text }] };
  }
);

server.resource(
  'devteam://registry',
  'devteam://registry',
  async (uri) => {
    const fp = path.join(PROJECT_ROOT, 'generated', 'agents-registry.json');
    if (!fs.existsSync(fp)) {
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: '[]' }] };
    }
    const text = fs.readFileSync(fp, 'utf8');
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text }] };
  }
);

server.resource(
  'devteam://traits',
  'devteam://traits',
  async (uri) => {
    const fp = path.join(PROJECT_ROOT, 'templates', 'traits.yml');
    const text = fs.readFileSync(fp, 'utf8');
    return { contents: [{ uri: uri.href, mimeType: 'text/yaml', text }] };
  }
);

server.resource(
  'devteam://archetypes',
  'devteam://archetypes',
  async (uri) => {
    const fp = path.join(PROJECT_ROOT, 'templates', 'archetypes.yml');
    const text = fs.readFileSync(fp, 'utf8');
    return { contents: [{ uri: uri.href, mimeType: 'text/yaml', text }] };
  }
);

server.resource(
  'devteam://compose',
  'devteam://compose',
  async (uri) => {
    const fp = path.join(PROJECT_ROOT, 'generated', 'docker-compose.generated.yml');
    if (!fs.existsSync(fp)) {
      return { contents: [{ uri: uri.href, mimeType: 'text/yaml', text: '# Not generated yet' }] };
    }
    const text = fs.readFileSync(fp, 'utf8');
    return { contents: [{ uri: uri.href, mimeType: 'text/yaml', text }] };
  }
);

server.resource(
  'devteam://router-config',
  'devteam://router-config',
  async (uri) => {
    const fp = path.join(PROJECT_ROOT, 'generated', 'router-agents.json');
    if (!fs.existsSync(fp)) {
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: '[]' }] };
    }
    const text = fs.readFileSync(fp, 'utf8');
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text }] };
  }
);

// ============================================================================
// Start Server
// ============================================================================

const transport = new StdioServerTransport();
await server.connect(transport);
