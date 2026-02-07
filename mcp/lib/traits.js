import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

let _traits = null;
let _archetypes = null;

function templatesDir(projectRoot) {
  return path.join(projectRoot, 'templates');
}

export function loadTraits(projectRoot) {
  if (_traits) return _traits;
  const fp = path.join(templatesDir(projectRoot), 'traits.yml');
  const raw = fs.readFileSync(fp, 'utf8');
  _traits = yaml.load(raw).traits;
  return _traits;
}

export function loadArchetypes(projectRoot) {
  if (_archetypes) return _archetypes;
  const fp = path.join(templatesDir(projectRoot), 'archetypes.yml');
  const raw = fs.readFileSync(fp, 'utf8');
  _archetypes = yaml.load(raw).archetypes;
  return _archetypes;
}

export function listRoles() {
  return [
    {
      id: 'po',
      name: 'Project Owner',
      description: 'Owns the vision. Creates tickets, assigns work, runs meetings, enforces the lifecycle, communicates with humans.',
      tools: ['Planning Board (full CRUD)', 'Meeting Board', 'Human Communication (webhooks)'],
    },
    {
      id: 'dev',
      name: 'Developer',
      description: 'Writes code. Picks up stories, creates PRs, tests in Docker, iterates on feedback.',
      tools: ['Planning Board (own tickets)', 'Meeting Board', 'Git', 'Docker', 'Code Editor'],
    },
    {
      id: 'cq',
      name: 'Code Quality',
      description: 'Reviews code. Security gatekeeper. Passes or fails PRs with detailed feedback.',
      tools: ['Planning Board (gate)', 'Meeting Board', 'Git (read-only)', 'Static Analysis'],
    },
    {
      id: 'qa',
      name: 'Quality Assurance',
      description: 'Tests against acceptance criteria. Passes or fails with evidence and reproduction steps.',
      tools: ['Planning Board (gate)', 'Meeting Board', 'Playwright', 'curl+jq', 'Screenshots'],
    },
    {
      id: 'ops',
      name: 'DevOps',
      description: 'Deploys to production. Manages infrastructure, CI/CD, monitoring.',
      tools: ['Planning Board (final gate)', 'Meeting Board', 'Docker/K8s', 'Cloud CLI'],
    },
  ];
}

export function listArchetypes(projectRoot) {
  const archetypes = loadArchetypes(projectRoot);
  return Object.entries(archetypes).map(([id, a]) => ({
    id,
    name: a.name,
    description: a.description,
    best_for: a.best_for,
  }));
}

export function listTraits(projectRoot) {
  const traits = loadTraits(projectRoot);
  return Object.entries(traits).map(([id, t]) => ({
    id,
    name: t.name,
    description: t.description,
    tiers: t.tiers,
  }));
}

export function getArchetype(projectRoot, archetypeId) {
  const archetypes = loadArchetypes(projectRoot);
  const archetype = archetypes[archetypeId];
  if (!archetype) {
    throw new Error(`Archetype "${archetypeId}" not found. Available: ${Object.keys(archetypes).join(', ')}`);
  }
  return { id: archetypeId, ...archetype };
}

// Resolve final trait values: archetype baseline + overrides
export function resolveTraits(projectRoot, archetypeId, overrides = {}) {
  const archetype = getArchetype(projectRoot, archetypeId);
  const traits = loadTraits(projectRoot);
  const resolved = { ...archetype.traits };

  for (const [key, value] of Object.entries(overrides)) {
    if (traits[key]) {
      resolved[key] = Math.max(0, Math.min(100, value));
    }
  }

  return resolved;
}

// Get trait tier (low/mid/high) from a numeric value
function getTier(value) {
  if (value <= 33) return 'low';
  if (value <= 66) return 'mid';
  return 'high';
}

// Generate personality narrative from resolved traits
export function generatePersonality(projectRoot, agent, role) {
  const traits = loadTraits(projectRoot);
  const resolved = resolveTraits(projectRoot, agent.archetype, agent.traits || {});

  // Build summary of notable traits
  const notable = [];
  for (const [key, value] of Object.entries(resolved)) {
    if (value >= 80) notable.push(`highly ${traits[key].name.toLowerCase()}`);
    else if (value <= 20) notable.push(`low ${traits[key].name.toLowerCase()}`);
  }

  const summary = notable.length > 0
    ? `\n**Notable traits**: ${notable.join(', ')}`
    : '';

  // Build trait narrative
  const narrativeParts = [];
  for (const [key, value] of Object.entries(resolved)) {
    const tier = getTier(value);
    const trait = traits[key];
    if (trait) {
      narrativeParts.push(`**${trait.name}** (${value}/100): ${trait.tiers[tier]}`);
    }
  }

  // Build opening paragraph based on dominant traits
  const dominantTraits = Object.entries(resolved)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([key]) => traits[key]?.name.toLowerCase())
    .filter(Boolean);

  const opening = `You are the team's ${role.soul_title.toLowerCase()}. Your defining qualities are ${dominantTraits.join(', ')}. These shape every interaction, every decision, every piece of work you produce.`;

  // Communication style
  const commStyle = resolved.communication_style || 50;
  const humor = resolved.humor || 30;
  let communication = '';
  if (commStyle >= 70) {
    communication = 'You communicate in detail. You provide context, explain reasoning, and make sure nothing is ambiguous.';
  } else if (commStyle <= 30) {
    communication = 'You are terse and direct. Bullet points over paragraphs. Every word counts.';
  } else {
    communication = 'You communicate clearly and concisely. Enough context to be useful without over-explaining.';
  }

  if (humor >= 70) {
    communication += ' You bring genuine humor to your communication — wit, wordplay, and lightness that makes collaboration enjoyable.';
  } else if (humor <= 20) {
    communication += ' You keep things strictly professional. No jokes, no banter — just the facts.';
  }

  return {
    summary,
    traits_narrative: narrativeParts.join('\n\n'),
    opening,
    communication,
    resolved,
  };
}
