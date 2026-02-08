import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { loadTeam } from './team.js';

export function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('timeout'));
    });
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

export function teamStatus(projectRoot) {
  const team = loadTeam(projectRoot);
  const agents = team.team.agents;
  const genDir = path.join(projectRoot, 'generated');

  // Load registry for gateway info
  const registryPath = path.join(genDir, 'agents-registry.json');
  let registry = [];
  if (fs.existsSync(registryPath)) {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  }

  const statuses = [];

  for (const agentDef of agents) {
    const agentId = agentDef.name.toLowerCase();
    const containerName = `devteam-${agentId}`;

    let online = false;
    let uptime = 'unknown';

    // Check Docker container status
    try {
      const result = execSync(
        `docker inspect --format='{{.State.Status}}|{{.State.StartedAt}}' ${containerName} 2>/dev/null`,
        { stdio: 'pipe', timeout: 5000 }
      ).toString().trim();

      const [status, startedAt] = result.split('|');
      online = status === 'running';
      if (online && startedAt) {
        const started = new Date(startedAt);
        const diff = Date.now() - started.getTime();
        const hours = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        uptime = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      }
    } catch {
      // Container not found or docker not available
    }

    statuses.push({
      name: agentDef.name,
      role: agentDef.role,
      id: agentId,
      online,
      uptime,
      provider: agentDef.provider,
      archetype: agentDef.archetype,
    });
  }

  return statuses;
}

export function agentLogs(projectRoot, agentName, lines = 50) {
  const team = loadTeam(projectRoot);
  const agentDef = team.team.agents.find(
    (a) => a.name.toLowerCase() === agentName.toLowerCase()
  );
  if (!agentDef) {
    throw new Error(`Agent "${agentName}" not found.`);
  }

  const containerName = `devteam-${agentDef.name.toLowerCase()}`;

  try {
    const logs = execSync(
      `docker logs --tail ${lines} ${containerName} 2>&1`,
      { stdio: 'pipe', timeout: 10000 }
    ).toString();
    return { agent: agentDef.name, logs };
  } catch (e) {
    return { agent: agentDef.name, logs: `Error: ${e.message}` };
  }
}

export function restartAgent(projectRoot, agentName) {
  const team = loadTeam(projectRoot);
  const agentDef = team.team.agents.find(
    (a) => a.name.toLowerCase() === agentName.toLowerCase()
  );
  if (!agentDef) {
    throw new Error(`Agent "${agentName}" not found.`);
  }

  const containerName = `devteam-${agentDef.name.toLowerCase()}`;

  try {
    execSync(`docker restart ${containerName}`, {
      stdio: 'pipe',
      timeout: 30000,
    });
    return { agent: agentDef.name, status: 'restarted' };
  } catch (e) {
    throw new Error(`Restart failed: ${e.message}`);
  }
}

export async function postMessage(projectRoot, channel, text) {
  const meetingBoardUrl = process.env.MEETING_BOARD_URL || 'http://localhost:8081';

  const resp = await httpRequest(`${meetingBoardUrl}/api/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer dashboard',
    },
    body: { channel, body: text },
  });

  if (resp.status >= 400) {
    throw new Error(`Failed to post message: ${JSON.stringify(resp.data)}`);
  }

  return { channel, message: text, status: 'posted' };
}

export async function readChannel(projectRoot, channel, limit = 20) {
  const meetingBoardUrl = process.env.MEETING_BOARD_URL || 'http://localhost:8081';

  const resp = await httpRequest(
    `${meetingBoardUrl}/api/messages?channel=${encodeURIComponent(channel)}&limit=${limit}`,
    {
      headers: { Authorization: 'Bearer dashboard' },
    }
  );

  if (resp.status >= 400) {
    throw new Error(`Failed to read messages: ${JSON.stringify(resp.data)}`);
  }

  return { channel, messages: resp.data };
}
