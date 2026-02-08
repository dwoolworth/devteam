import path from 'path';
import fs from 'fs';
import { httpRequest } from './monitor.js';

const PERSONA_FILES = ['IDENTITY.md', 'SOUL.md', 'HEARTBEAT.md', 'TOOLS.md'];

function getProjectBoardAuth(projectRoot) {
  const registryPath = path.join(projectRoot, 'generated', 'agents-registry.json');
  if (!fs.existsSync(registryPath)) {
    throw new Error('No agents-registry.json found — run generate first');
  }
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  if (registry.length === 0) {
    throw new Error('Registry is empty — no agents configured');
  }
  return registry[0].token;
}

export function inspectAgent(projectRoot, name) {
  const agentId = name.toLowerCase();
  const personaDir = path.join(projectRoot, 'generated', agentId, 'persona');

  if (!fs.existsSync(personaDir)) {
    throw new Error(`No generated persona found for "${name}". Run generate first.`);
  }

  const workspaceDir = path.join(personaDir, 'workspace');
  const files = {};

  for (const filename of PERSONA_FILES) {
    const fp = path.join(workspaceDir, filename);
    if (fs.existsSync(fp)) {
      files[filename] = fs.readFileSync(fp, 'utf8');
    }
  }

  // List skills
  const skillsDir = path.join(personaDir, 'skills');
  let skills = [];
  if (fs.existsSync(skillsDir)) {
    skills = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  return { agent: name, files, skills };
}

export function readSkill(projectRoot, name, skill) {
  const agentId = name.toLowerCase();
  const skillPath = path.join(
    projectRoot, 'generated', agentId, 'persona', 'skills', skill, 'SKILL.md'
  );

  if (!fs.existsSync(skillPath)) {
    throw new Error(`Skill "${skill}" not found for agent "${name}". Path: ${skillPath}`);
  }

  return { agent: name, skill, content: fs.readFileSync(skillPath, 'utf8') };
}

export async function listTickets(projectRoot, filters = {}) {
  const token = getProjectBoardAuth(projectRoot);
  const boardUrl = process.env.PROJECT_BOARD_URL || 'http://localhost:8088';

  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.assignee) params.set('assignee', filters.assignee);
  if (filters.type) params.set('type', filters.type);
  if (filters.priority) params.set('priority', String(filters.priority));
  if (filters.search) params.set('search', filters.search);
  if (filters.limit) params.set('limit', String(filters.limit));

  const qs = params.toString();
  const url = `${boardUrl}/api/tickets${qs ? '?' + qs : ''}`;

  const resp = await httpRequest(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (resp.status >= 400) {
    throw new Error(`Project board error (${resp.status}): ${JSON.stringify(resp.data)}`);
  }

  return resp.data;
}

export async function getTicket(projectRoot, ticketNumber) {
  const token = getProjectBoardAuth(projectRoot);
  const boardUrl = process.env.PROJECT_BOARD_URL || 'http://localhost:8088';

  const resp = await httpRequest(
    `${boardUrl}/api/tickets/${encodeURIComponent(ticketNumber)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (resp.status === 404) {
    throw new Error(`Ticket "${ticketNumber}" not found`);
  }
  if (resp.status >= 400) {
    throw new Error(`Project board error (${resp.status}): ${JSON.stringify(resp.data)}`);
  }

  return resp.data;
}

export async function boardSummary(projectRoot) {
  const token = getProjectBoardAuth(projectRoot);
  const boardUrl = process.env.PROJECT_BOARD_URL || 'http://localhost:8088';
  const headers = { Authorization: `Bearer ${token}` };

  const [summaryResp, workloadResp] = await Promise.all([
    httpRequest(`${boardUrl}/api/board/summary`, { headers }),
    httpRequest(`${boardUrl}/api/board/workload`, { headers }),
  ]);

  if (summaryResp.status >= 400) {
    throw new Error(`Board summary error (${summaryResp.status}): ${JSON.stringify(summaryResp.data)}`);
  }
  if (workloadResp.status >= 400) {
    throw new Error(`Board workload error (${workloadResp.status}): ${JSON.stringify(workloadResp.data)}`);
  }

  return { statusCounts: summaryResp.data, workload: workloadResp.data };
}
