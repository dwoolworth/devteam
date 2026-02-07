import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const TEAM_FILE = 'team.yml';

function teamPath(projectRoot) {
  return path.join(projectRoot, TEAM_FILE);
}

function defaultTeam() {
  return {
    project: {
      name: '',
      description: '',
      repo: '',
      stack: {},
      platform: {
        target: 'docker-compose',
        provider: 'local',
      },
      credentials: {},
    },
    team: {
      base_port: 18790,
      agents: [],
    },
  };
}

export function loadTeam(projectRoot) {
  const fp = teamPath(projectRoot);
  if (!fs.existsSync(fp)) {
    return defaultTeam();
  }
  const raw = fs.readFileSync(fp, 'utf8');
  const data = yaml.load(raw);
  return { ...defaultTeam(), ...data };
}

export function saveTeam(projectRoot, team) {
  const fp = teamPath(projectRoot);
  fs.writeFileSync(fp, yaml.dump(team, { lineWidth: 120, noRefs: true }), 'utf8');
}

// Project configuration
export function setupProject(projectRoot, { name, description, repo }) {
  const team = loadTeam(projectRoot);
  if (name) team.project.name = name;
  if (description) team.project.description = description;
  if (repo) team.project.repo = repo;
  saveTeam(projectRoot, team);
  return team.project;
}

export function setStack(projectRoot, stack) {
  const team = loadTeam(projectRoot);
  team.project.stack = { ...team.project.stack, ...stack };
  saveTeam(projectRoot, team);
  return team.project.stack;
}

export function setPlatform(projectRoot, platform) {
  const team = loadTeam(projectRoot);
  team.project.platform = { ...team.project.platform, ...platform };
  saveTeam(projectRoot, team);
  return team.project.platform;
}

export function setCredentials(projectRoot, credentials) {
  const team = loadTeam(projectRoot);
  team.project.credentials = { ...team.project.credentials, ...credentials };
  saveTeam(projectRoot, team);
  return Object.keys(team.project.credentials);
}

export function getProject(projectRoot) {
  const team = loadTeam(projectRoot);
  return team.project;
}

// Agent CRUD
export function addAgent(projectRoot, agent) {
  const team = loadTeam(projectRoot);
  const existing = team.team.agents.find(
    (a) => a.name.toLowerCase() === agent.name.toLowerCase()
  );
  if (existing) {
    throw new Error(`Agent "${agent.name}" already exists. Use update_agent to modify.`);
  }
  team.team.agents.push(agent);
  saveTeam(projectRoot, team);
  return agent;
}

export function updateAgent(projectRoot, name, updates) {
  const team = loadTeam(projectRoot);
  const idx = team.team.agents.findIndex(
    (a) => a.name.toLowerCase() === name.toLowerCase()
  );
  if (idx === -1) {
    throw new Error(`Agent "${name}" not found.`);
  }
  team.team.agents[idx] = { ...team.team.agents[idx], ...updates };
  saveTeam(projectRoot, team);
  return team.team.agents[idx];
}

export function removeAgent(projectRoot, name) {
  const team = loadTeam(projectRoot);
  const idx = team.team.agents.findIndex(
    (a) => a.name.toLowerCase() === name.toLowerCase()
  );
  if (idx === -1) {
    throw new Error(`Agent "${name}" not found.`);
  }
  const removed = team.team.agents.splice(idx, 1)[0];
  saveTeam(projectRoot, team);
  return removed;
}

export function getTeam(projectRoot) {
  const team = loadTeam(projectRoot);
  return team.team;
}
