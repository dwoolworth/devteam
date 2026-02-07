import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import ejs from 'ejs';
import yaml from 'js-yaml';
import { loadTeam } from './team.js';
import { generatePersonality, resolveTraits } from './traits.js';

const GENERATED_DIR = 'generated';

function generatedPath(projectRoot) {
  return path.join(projectRoot, GENERATED_DIR);
}

function loadRoleConfig(projectRoot, role) {
  const fp = path.join(projectRoot, 'templates', 'roles', role, 'role.yml');
  const raw = fs.readFileSync(fp, 'utf8');
  return yaml.load(raw);
}

function renderTemplate(templatePath, data) {
  const template = fs.readFileSync(templatePath, 'utf8');
  return ejs.render(template, data);
}

// Provider display names
const PROVIDER_DISPLAY = {
  xai: 'x.ai Grok',
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI GPT',
};

function parseProvider(providerStr) {
  const parts = providerStr.split('/');
  const name = parts[0];
  const model = parts.slice(1).join('/');
  const roleDefaults = {
    xai: 'XAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
  };
  return {
    name,
    model,
    display: PROVIDER_DISPLAY[name] || name,
    api_key_env: roleDefaults[name] || `${name.toUpperCase()}_API_KEY`,
  };
}

// Default avatar emojis by role
const ROLE_AVATARS = {
  po: '📋',
  dev: '🔨',
  cq: '🔍',
  qa: '🧪',
  ops: '🚀',
};

export function generate(projectRoot) {
  const team = loadTeam(projectRoot);
  const agents = team.team.agents;
  const basePort = team.team.base_port || 18790;
  const genDir = generatedPath(projectRoot);

  // Clean and create output directory
  if (fs.existsSync(genDir)) {
    fs.rmSync(genDir, { recursive: true });
  }
  fs.mkdirSync(genDir, { recursive: true });

  const registry = [];
  const tokens = {};
  const routerAgents = {};
  let portOffset = 0;

  // Build teammates list for IDENTITY.md template
  const ROLE_TITLES = { po: 'Product Owner', dev: 'Developer', cq: 'Code Quality', qa: 'QA Tester', ops: 'DevOps' };
  const teammates = agents.map((a) => ({
    id: a.name.toLowerCase(),
    name: a.name,
    role: a.role,
    roleName: ROLE_TITLES[a.role] || a.role.toUpperCase(),
    providerDisplay: PROVIDER_DISPLAY[a.provider.split('/')[0]] || a.provider,
  }));

  for (const agentDef of agents) {
    const agentId = agentDef.name.toLowerCase();
    const role = agentDef.role;
    const roleConfig = loadRoleConfig(projectRoot, role);
    const provider = parseProvider(agentDef.provider);
    const port = basePort + portOffset;
    portOffset++;

    // Generate token
    const token = crypto.randomBytes(32).toString('hex');
    tokens[agentId] = token;

    // Build agent data object
    const agent = {
      id: agentId,
      name: agentDef.name,
      role,
      provider,
      archetype: agentDef.archetype,
      traits: agentDef.traits || {},
      traitOverrides: agentDef.traits || {},
      backstory: agentDef.backstory || '',
    };

    // Generate personality
    const personality = generatePersonality(projectRoot, agent, roleConfig);

    // Registry entry
    registry.push({
      id: agentId,
      name: agentDef.name,
      role,
      email: `${agentId}@devteam.local`,
      avatar: ROLE_AVATARS[role] || '🤖',
      provider: { name: provider.name, model: provider.model },
      gateway: { host: agentId, port: 18789 },
      token,
      traits: personality.resolved,
      archetype: agentDef.archetype,
    });

    // Router config entry
    routerAgents[agentId] = {
      name: agentDef.name,
      role,
      url: `ws://${agentId}:18789`,
      token,
    };

    // Create agent persona directory
    const agentDir = path.join(genDir, agentId, 'persona');
    const workspaceDir = path.join(agentDir, 'workspace');
    const skillsDir = path.join(agentDir, 'skills');
    fs.mkdirSync(workspaceDir, { recursive: true });

    // Render IDENTITY.md
    const identityTemplate = path.join(projectRoot, 'templates', 'shared', 'IDENTITY.md.ejs');
    const identity = renderTemplate(identityTemplate, { agent, role: roleConfig, personality, teammates });
    fs.writeFileSync(path.join(workspaceDir, 'IDENTITY.md'), identity);

    // Render SOUL.md
    const soulTemplate = path.join(projectRoot, 'templates', 'shared', 'SOUL.md.ejs');
    const soul = renderTemplate(soulTemplate, { agent, role: roleConfig, personality });
    fs.writeFileSync(path.join(workspaceDir, 'SOUL.md'), soul);

    // Resolve env var placeholders with actual values so agents don't depend
    // on shell variable expansion (LLMs sometimes use single quotes which
    // prevent expansion).
    const envReplacements = {
      '${MEETING_BOARD_URL}': 'http://meeting-board:8080',
      '$MEETING_BOARD_URL': 'http://meeting-board:8080',
      '${MEETING_BOARD_TOKEN}': `\${MEETING_BOARD_TOKEN}`,   // keep token as env var (it's secret)
      '${PLANNING_BOARD_URL}': 'http://project-board:3000',
      '$PLANNING_BOARD_URL': 'http://project-board:3000',
      '${PLANNING_BOARD_TOKEN}': `\${PLANNING_BOARD_TOKEN}`, // keep token as env var
    };

    function resolveEnvPlaceholders(content) {
      let result = content;
      for (const [placeholder, value] of Object.entries(envReplacements)) {
        result = result.split(placeholder).join(value);
      }
      return result;
    }

    function copyFileWithEnvResolve(src, dest) {
      const content = fs.readFileSync(src, 'utf8');
      fs.writeFileSync(dest, resolveEnvPlaceholders(content));
    }

    // Copy HEARTBEAT.md from templates (with env resolution)
    const heartbeatSrc = path.join(projectRoot, 'templates', 'roles', role, 'HEARTBEAT.md');
    if (fs.existsSync(heartbeatSrc)) {
      copyFileWithEnvResolve(heartbeatSrc, path.join(workspaceDir, 'HEARTBEAT.md'));
    }

    // Copy TOOLS.md from templates (with env resolution)
    const toolsSrc = path.join(projectRoot, 'templates', 'roles', role, 'TOOLS.md');
    if (fs.existsSync(toolsSrc)) {
      copyFileWithEnvResolve(toolsSrc, path.join(workspaceDir, 'TOOLS.md'));
    }

    // Render openclaw.json
    const openclawTemplate = path.join(projectRoot, 'templates', 'roles', role, 'openclaw.json.ejs');
    if (fs.existsSync(openclawTemplate)) {
      const openclawJson = renderTemplate(openclawTemplate, { agent, role: roleConfig });
      fs.writeFileSync(path.join(agentDir, 'openclaw.json'), openclawJson);
    }

    // Copy skills (with env resolution in .md files)
    const skillsSrc = path.join(projectRoot, 'templates', 'skills', role);
    if (fs.existsSync(skillsSrc)) {
      copyDirRecursive(skillsSrc, skillsDir, resolveEnvPlaceholders);
    }
  }

  // Write agents-registry.json
  fs.writeFileSync(
    path.join(genDir, 'agents-registry.json'),
    JSON.stringify(registry, null, 2)
  );

  // Write router-agents.json
  fs.writeFileSync(
    path.join(genDir, 'router-agents.json'),
    JSON.stringify(routerAgents, null, 2)
  );

  // Write .env.generated (reads API keys from root .env)
  const envResult = generateEnvFile(projectRoot, team, tokens);

  // Generate docker-compose or k8s manifests
  const target = team.project.platform?.target || 'docker-compose';
  if (target === 'kubernetes') {
    generateK8sManifests(projectRoot, team, registry, tokens);
  } else {
    generateDockerCompose(projectRoot, team, registry, tokens);
  }

  const result = {
    agents: registry.map((a) => `${a.name} (${a.role})`),
    files: [
      'agents-registry.json',
      'router-agents.json',
      '.env.generated',
      target === 'kubernetes' ? 'k8s/' : 'docker-compose.generated.yml',
      ...registry.map((a) => `${a.id}/persona/`),
    ],
  };
  if (envResult.missing && envResult.missing.length > 0) {
    result.warnings = [`Missing API keys (set in .env or shell): ${envResult.missing.join(', ')}`];
  }
  return result;
}

function readRootEnvKeys(projectRoot) {
  // Read the root .env file and extract known API key values.
  const envPath = path.join(projectRoot, '.env');
  const keys = {};
  if (!fs.existsSync(envPath)) return keys;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    keys[key] = value;
  }
  return keys;
}

function generateEnvFile(projectRoot, team, tokens) {
  const lines = ['# Auto-generated by devteam MCP — do not edit manually', ''];

  // Agent tokens
  lines.push('# Agent Tokens');
  for (const [id, token] of Object.entries(tokens)) {
    lines.push(`TOKEN_${id.toUpperCase()}=${token}`);
  }

  // Read real API keys from root .env
  const rootKeys = readRootEnvKeys(projectRoot);
  const providers = new Set(team.team.agents.map((a) => a.provider.split('/')[0]));
  const apiKeyMap = { xai: 'XAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' };

  lines.push('');
  lines.push('# AI Provider Keys');
  const missing = [];
  for (const [provider, envVar] of Object.entries(apiKeyMap)) {
    if (!providers.has(provider)) continue;
    const value = rootKeys[envVar] || process.env[envVar] || '';
    if (value) {
      lines.push(`${envVar}=${value}`);
    } else {
      lines.push(`# ${envVar}=  <-- SET THIS: no value found in .env or shell environment`);
      missing.push(envVar);
    }
  }

  // Cloud credentials
  if (team.project.credentials && Object.keys(team.project.credentials).length > 0) {
    lines.push('');
    lines.push('# Cloud/Platform Credentials');
    for (const [key, value] of Object.entries(team.project.credentials)) {
      // Resolve ${VAR} references from root .env or shell
      const resolved = value.replace(/\$\{(\w+)\}/g, (_, name) => rootKeys[name] || process.env[name] || '');
      lines.push(`${key}=${resolved}`);
    }
  }

  lines.push('');
  fs.writeFileSync(
    path.join(generatedPath(projectRoot), '.env.generated'),
    lines.join('\n')
  );

  return { missing };
}

function generateDockerCompose(projectRoot, team, registry, tokens) {
  const agents = team.team.agents;
  const basePort = team.team.base_port || 18790;

  const services = {};

  // MongoDB
  services.mongo = {
    image: 'mongo:7',
    container_name: 'devteam-mongo',
    restart: 'unless-stopped',
    networks: ['devteam'],
    volumes: ['mongo-data:/data/db'],
    healthcheck: {
      test: ['CMD', 'mongosh', '--eval', "db.adminCommand('ping')"],
      interval: '10s',
      timeout: '5s',
      retries: 5,
      start_period: '10s',
    },
  };

  // Note: paths are relative to the compose file location (generated/)
  // so ../ reaches the project root.

  // Meeting Board
  services['meeting-board'] = {
    build: { context: '../meeting-board', dockerfile: 'Dockerfile' },
    container_name: 'devteam-meeting-board',
    restart: 'unless-stopped',
    networks: ['devteam'],
    ports: ['${MEETING_BOARD_PORT:-8080}:8080'],
    environment: [
      'MONGO_URI=${MONGO_URI:-mongodb://mongo:27017}',
      'DB_NAME=${MONGO_DB:-meetingboard}',
      'PORT=8080',
      'AGENTS_REGISTRY=/data/agents-registry.json',
    ],
    volumes: ['./agents-registry.json:/data/agents-registry.json:ro'],
    depends_on: { mongo: { condition: 'service_healthy' } },
    healthcheck: {
      test: ['CMD', 'wget', '-qO-', 'http://localhost:8080/health'],
      interval: '10s',
      timeout: '5s',
      retries: 5,
      start_period: '10s',
    },
  };

  // Project Board
  services['project-board'] = {
    build: { context: '../projectboard', dockerfile: 'Dockerfile' },
    container_name: 'devteam-project-board',
    restart: 'unless-stopped',
    networks: ['devteam'],
    ports: ['${PROJECT_BOARD_PORT:-8088}:3000'],
    environment: [
      'MONGODB_URI=mongodb://mongo:27017/taskboard',
      'MONGODB_DATABASE=taskboard',
      'PORT=3000',
      'SESSION_SECRET=${PB_SESSION_SECRET:-devteam-session-secret-change-me}',
      'PB_DEFAULT_PASSWORD=${PB_DEFAULT_PASSWORD:-devteam2025}',
      'AGENTS_REGISTRY=/data/agents-registry.json',
    ],
    volumes: ['./agents-registry.json:/data/agents-registry.json:ro'],
    depends_on: { mongo: { condition: 'service_healthy' } },
    healthcheck: {
      test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:3000/api/health'],
      interval: '10s',
      timeout: '5s',
      retries: 5,
      start_period: '10s',
    },
  };

  // Router
  services.router = {
    build: { context: '../router', dockerfile: 'Dockerfile' },
    container_name: 'devteam-router',
    restart: 'unless-stopped',
    networks: ['devteam'],
    environment: [
      'MEETING_BOARD_URL=http://meeting-board:8080',
      'MEETING_BOARD_WS_URL=ws://meeting-board:8080/ws',
      'AGENTS_CONFIG=/app/agents.json',
      'WAKE_DEBOUNCE_MS=30000',
      'OBSERVER_ENABLED=true',
      'ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}',
      'OBSERVER_MODEL=claude-haiku-4-5-20251001',
      'CONTEXT_MESSAGES_LIMIT=20',
      'HOME=/home/router',
    ],
    volumes: [
      './router-agents.json:/app/agents.json:ro',
      'router-data:/home/router/.openclaw',
    ],
    depends_on: { 'meeting-board': { condition: 'service_healthy' } },
  };

  // Agent containers
  let portOffset = 0;
  for (const agentDef of agents) {
    const agentId = agentDef.name.toLowerCase();
    const role = agentDef.role;
    const port = basePort + portOffset;
    portOffset++;

    const provider = agentDef.provider.split('/')[0];
    const apiKeyEnvMap = {
      xai: 'XAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
    };
    const apiKeyEnv = apiKeyEnvMap[provider] || `${provider.toUpperCase()}_API_KEY`;

    const env = [
      `${apiKeyEnv}=\${${apiKeyEnv}}`,
      'MEETING_BOARD_URL=http://meeting-board:8080',
      `MEETING_BOARD_TOKEN=\${TOKEN_${agentId.toUpperCase()}}`,
      'PLANNING_BOARD_URL=http://project-board:3000',
      `PLANNING_BOARD_TOKEN=\${TOKEN_${agentId.toUpperCase()}}`,
      'OPENCLAW_GATEWAY_BIND=lan',
      `OPENCLAW_GATEWAY_TOKEN=\${TOKEN_${agentId.toUpperCase()}}`,
      'OPENCLAW_NO_ONBOARD=1',
      `AGENT_INSTANCE=${agentId}`,
      `AGENT_NAME=${agentDef.name}`,
      `AGENT_ROLE=${role}`,
    ];

    // Add role-specific env vars
    if (role === 'po') {
      env.push('HUMAN_COMMS_TYPE=${HUMAN_COMMS_TYPE:-meeting-board}');
      env.push('HUMAN_COMMS_WEBHOOK_URL=${HUMAN_COMMS_WEBHOOK_URL:-}');
    }

    // Add cloud credentials for OPS
    if (role === 'ops' && team.project.credentials) {
      for (const key of Object.keys(team.project.credentials)) {
        env.push(`${key}=\${${key}}`);
      }
    }

    const volumes = [`./${agentId}/persona:/home/agent/persona:ro`];

    // DEV gets project code mount
    if (role === 'dev') {
      volumes.push('${PROJECT_CODE_PATH:-../project}:/home/agent/workspace/project:rw');
    }

    // CQ gets read-only project code
    if (role === 'cq') {
      volumes.push('${PROJECT_CODE_PATH:-../project}:/home/agent/workspace/project:ro');
    }

    // QA gets evidence directory
    if (role === 'qa') {
      volumes.push('${QA_EVIDENCE_PATH:-../qa-evidence}:/home/agent/evidence');
    }

    // OPS gets docker socket
    if (role === 'ops') {
      volumes.push('${DOCKER_SOCKET:-/var/run/docker.sock}:/var/run/docker.sock');
    }

    services[agentId] = {
      image: `devteam/${role}:latest`,
      build: { context: `../images/${role}` },
      container_name: `devteam-${agentId}`,
      hostname: agentId,
      restart: 'unless-stopped',
      networks: ['devteam'],
      ports: [`${port}:18789`],
      environment: env,
      volumes,
      depends_on: {
        'meeting-board': { condition: 'service_healthy' },
        'project-board': { condition: 'service_healthy' },
      },
    };
  }

  const compose = {
    networks: { devteam: { driver: 'bridge' } },
    volumes: { 'mongo-data': null, 'project-code': null, 'router-data': null },
    services,
  };

  // Write as YAML
  const output = yaml.dump(compose, {
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });

  fs.writeFileSync(
    path.join(generatedPath(projectRoot), 'docker-compose.generated.yml'),
    output
  );
}

function generateK8sManifests(projectRoot, team, registry, tokens) {
  const k8sDir = path.join(generatedPath(projectRoot), 'k8s');
  fs.mkdirSync(k8sDir, { recursive: true });

  // Namespace
  const namespace = {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: { name: 'devteam' },
  };
  writeYaml(path.join(k8sDir, 'namespace.yml'), namespace);

  // ConfigMap with registry
  const configMap = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: 'agents-registry', namespace: 'devteam' },
    data: {
      'agents-registry.json': JSON.stringify(registry, null, 2),
    },
  };
  writeYaml(path.join(k8sDir, 'configmap-registry.yml'), configMap);

  // Secret with tokens
  const secretData = {};
  for (const [id, token] of Object.entries(tokens)) {
    secretData[`TOKEN_${id.toUpperCase()}`] = Buffer.from(token).toString('base64');
  }
  const secret = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name: 'agent-tokens', namespace: 'devteam' },
    type: 'Opaque',
    data: secretData,
  };
  writeYaml(path.join(k8sDir, 'secret-tokens.yml'), secret);

  // Deployment + Service per agent
  for (const agent of registry) {
    const deployment = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: agent.id, namespace: 'devteam' },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: agent.id } },
        template: {
          metadata: { labels: { app: agent.id, role: agent.role } },
          spec: {
            containers: [
              {
                name: agent.id,
                image: `devteam/${agent.role}:latest`,
                ports: [{ containerPort: 18789 }],
                env: [
                  { name: 'AGENT_INSTANCE', value: agent.id },
                  { name: 'AGENT_NAME', value: agent.name },
                  { name: 'AGENT_ROLE', value: agent.role },
                  { name: 'OPENCLAW_GATEWAY_BIND', value: 'lan' },
                  { name: 'OPENCLAW_NO_ONBOARD', value: '1' },
                  { name: 'MEETING_BOARD_URL', value: 'http://meeting-board:8080' },
                  { name: 'PLANNING_BOARD_URL', value: 'http://project-board:3000' },
                ],
              },
            ],
          },
        },
      },
    };
    writeYaml(path.join(k8sDir, `deployment-${agent.id}.yml`), deployment);

    const service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: agent.id, namespace: 'devteam' },
      spec: {
        selector: { app: agent.id },
        ports: [{ port: 18789, targetPort: 18789 }],
      },
    };
    writeYaml(path.join(k8sDir, `service-${agent.id}.yml`), service);
  }
}

function writeYaml(fp, data) {
  fs.writeFileSync(fp, yaml.dump(data, { lineWidth: 120, noRefs: true }));
}

function copyDirRecursive(src, dest, transformFn) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, transformFn);
    } else if (transformFn && entry.name.endsWith('.md')) {
      const content = fs.readFileSync(srcPath, 'utf8');
      fs.writeFileSync(destPath, transformFn(content));
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Preview personality for an agent without full generation
export function previewPersonality(projectRoot, agentName) {
  const team = loadTeam(projectRoot);
  const agentDef = team.team.agents.find(
    (a) => a.name.toLowerCase() === agentName.toLowerCase()
  );
  if (!agentDef) {
    throw new Error(`Agent "${agentName}" not found in team.`);
  }

  const role = agentDef.role;
  const roleConfig = loadRoleConfig(projectRoot, role);
  const provider = parseProvider(agentDef.provider);

  const agent = {
    id: agentDef.name.toLowerCase(),
    name: agentDef.name,
    role,
    provider,
    archetype: agentDef.archetype,
    traits: agentDef.traits || {},
    traitOverrides: agentDef.traits || {},
    backstory: agentDef.backstory || '',
  };

  const personality = generatePersonality(projectRoot, agent, roleConfig);

  // Render templates
  const identityTemplate = path.join(projectRoot, 'templates', 'shared', 'IDENTITY.md.ejs');
  const soulTemplate = path.join(projectRoot, 'templates', 'shared', 'SOUL.md.ejs');

  const identity = renderTemplate(identityTemplate, { agent, role: roleConfig, personality });
  const soul = renderTemplate(soulTemplate, { agent, role: roleConfig, personality });

  return { identity, soul, traits: personality.resolved };
}
