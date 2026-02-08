import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { loadTeam } from './team.js';

const COMPOSE_PROJECT = 'devteam';

export function deploy(projectRoot, options = {}) {
  const team = loadTeam(projectRoot);
  const target = options.target || team.project.platform?.target || 'docker-compose';

  // Verify generated files exist
  const genDir = path.join(projectRoot, 'generated');
  if (!fs.existsSync(genDir)) {
    throw new Error('No generated files found. Run generate first.');
  }

  if (target === 'kubernetes') {
    return deployK8s(projectRoot);
  }
  return deployDockerCompose(projectRoot);
}

function composeCmd(composeFile, envFile) {
  const envArg = envFile && fs.existsSync(envFile) ? `--env-file ${envFile}` : '';
  return `docker compose -p ${COMPOSE_PROJECT} -f ${composeFile} ${envArg}`;
}

function deployDockerCompose(projectRoot) {
  const composeFile = path.join(projectRoot, 'generated', 'docker-compose.generated.yml');
  const envFile = path.join(projectRoot, 'generated', '.env.generated');

  if (!fs.existsSync(composeFile)) {
    throw new Error('docker-compose.generated.yml not found. Run generate first.');
  }

  const results = [];
  const cmd = composeCmd(composeFile, envFile);

  // Tear down any existing devteam project first to avoid conflicts
  try {
    execSync(`${cmd} down --remove-orphans`, {
      cwd: projectRoot,
      stdio: 'pipe',
      timeout: 120000,
    });
    results.push('Cleaned up previous devteam deployment.');
  } catch {
    // No previous deployment — that's fine
  }

  // Build images
  try {
    results.push('Building base image...');
    execSync('docker build -t devteam/base:latest ./images/base/', {
      cwd: projectRoot,
      stdio: 'pipe',
      timeout: 300000,
    });
    results.push('Base image built.');
  } catch (e) {
    results.push(`Base image build warning: ${e.message}`);
  }

  // Build role images
  const roles = ['po', 'dev', 'cq', 'qa', 'ops'];
  for (const role of roles) {
    const dockerfilePath = path.join(projectRoot, 'images', role, 'Dockerfile');
    if (fs.existsSync(dockerfilePath)) {
      try {
        execSync(`docker build -t devteam/${role}:latest ./images/${role}/`, {
          cwd: projectRoot,
          stdio: 'pipe',
          timeout: 300000,
        });
        results.push(`Built devteam/${role}:latest`);
      } catch (e) {
        results.push(`Build warning for ${role}: ${e.message}`);
      }
    }
  }

  // Start with docker compose
  try {
    execSync(`${cmd} up -d`, {
      cwd: projectRoot,
      stdio: 'pipe',
      timeout: 300000,
    });
    results.push('Docker Compose services started (project: devteam).');
  } catch (e) {
    throw new Error(`Docker Compose up failed: ${e.stderr?.toString() || e.message}`);
  }

  return {
    target: 'docker-compose',
    status: 'deployed',
    details: results,
  };
}

function deployK8s(projectRoot) {
  const k8sDir = path.join(projectRoot, 'generated', 'k8s');
  if (!fs.existsSync(k8sDir)) {
    throw new Error('k8s/ directory not found. Run generate with kubernetes target first.');
  }

  const results = [];

  try {
    execSync(`kubectl apply -f ${k8sDir}/`, {
      cwd: projectRoot,
      stdio: 'pipe',
      timeout: 120000,
    });
    results.push('Kubernetes manifests applied.');
  } catch (e) {
    throw new Error(`kubectl apply failed: ${e.stderr?.toString() || e.message}`);
  }

  return {
    target: 'kubernetes',
    status: 'deployed',
    details: results,
  };
}

export function teardown(projectRoot, options = {}) {
  const team = loadTeam(projectRoot);
  const target = options.target || team.project.platform?.target || 'docker-compose';

  if (target === 'kubernetes') {
    const k8sDir = path.join(projectRoot, 'generated', 'k8s');
    try {
      execSync(`kubectl delete -f ${k8sDir}/`, {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 120000,
      });
    } catch (e) {
      // Ignore errors on teardown
    }
    return { status: 'torn down', target: 'kubernetes' };
  }

  const composeFile = path.join(projectRoot, 'generated', 'docker-compose.generated.yml');
  if (fs.existsSync(composeFile)) {
    const envFile = path.join(projectRoot, 'generated', '.env.generated');
    const cmd = composeCmd(composeFile, envFile);
    try {
      execSync(`${cmd} down -v --remove-orphans`, {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 120000,
      });
    } catch {
      // Ignore errors on teardown
    }
  }
  return { status: 'torn down', target: 'docker-compose' };
}

export function rebuildAgent(projectRoot, agentName) {
  const team = loadTeam(projectRoot);
  const agentDef = team.team.agents.find(
    (a) => a.name.toLowerCase() === agentName.toLowerCase()
  );
  if (!agentDef) {
    throw new Error(`Agent "${agentName}" not found.`);
  }

  const agentId = agentDef.name.toLowerCase();
  const composeFile = path.join(projectRoot, 'generated', 'docker-compose.generated.yml');

  if (!fs.existsSync(composeFile)) {
    throw new Error('docker-compose.generated.yml not found. Run generate and deploy first.');
  }

  try {
    const envFile = path.join(projectRoot, 'generated', '.env.generated');
    const cmd = composeCmd(composeFile, envFile);
    execSync(`${cmd} up -d --build ${agentId}`, {
      cwd: projectRoot,
      stdio: 'pipe',
      timeout: 300000,
    });
  } catch (e) {
    throw new Error(`Rebuild failed for ${agentId}: ${e.stderr?.toString() || e.message}`);
  }

  return { agent: agentId, status: 'rebuilt and restarted' };
}
