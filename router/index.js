'use strict';

const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MEETING_BOARD_URL    = process.env.MEETING_BOARD_URL    || 'http://meeting-board:8080';
const MEETING_BOARD_WS_URL = process.env.MEETING_BOARD_WS_URL || 'ws://meeting-board:8080/ws';
const WAKE_DEBOUNCE_MS     = parseInt(process.env.WAKE_DEBOUNCE_MS, 10) || 30000;
const CHANNEL_REFRESH_MS   = 5 * 60 * 1000; // re-fetch channels every 5 minutes
const RECONNECT_DELAY_MS   = 3000;
const PROTOCOL_VERSION     = 3;

// Observer configuration
const OBSERVER_ENABLED       = process.env.OBSERVER_ENABLED !== 'false'; // default: on
const OBSERVER_API_KEY       = process.env.ANTHROPIC_API_KEY || '';
const OBSERVER_MODEL         = process.env.OBSERVER_MODEL || 'claude-haiku-4-5-20251001';
const CONTEXT_MESSAGES_LIMIT = parseInt(process.env.CONTEXT_MESSAGES_LIMIT, 10) || 20;
const CONTEXT_CACHE_TTL_MS   = 5000; // 5s cache to avoid redundant fetches

// Load agent config from AGENTS_CONFIG JSON file or fall back to env vars
const agentConfig = loadAgentConfig();

function loadAgentConfig() {
  const configPath = process.env.AGENTS_CONFIG;
  if (configPath) {
    try {
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      // Expected format: { "agentId": { "url": "ws://...", "token": "..." }, ... }
      // or array format from router-agents.json
      if (Array.isArray(data)) {
        const config = {};
        for (const agent of data) {
          config[agent.id] = { url: agent.url, token: agent.token, role: agent.role, name: agent.name };
        }
        log(`Agent config loaded from ${configPath}: ${Object.keys(config).join(', ')}`);
        return config;
      }
      // Object format — preserve role/name if present
      const config = {};
      for (const [id, entry] of Object.entries(data)) {
        config[id] = { ...entry, role: entry.role || id, name: entry.name || id };
      }
      log(`Agent config loaded from ${configPath}: ${Object.keys(config).join(', ')}`);
      return config;
    } catch (e) {
      log(`Warning: could not load agent config from ${configPath}: ${e.message}`);
    }
  }

  // Fall back to env var-based config
  const AGENTS = ['po', 'dev', 'cq', 'qa', 'ops'];
  const config = {};
  for (const name of AGENTS) {
    const upper = name.toUpperCase();
    const url   = process.env[`${upper}_GATEWAY_URL`];
    const token = process.env[`${upper}_GATEWAY_TOKEN`];
    if (url && token) {
      config[name] = { url, token, role: name, name: name.toUpperCase() };
    }
  }
  log(`Agent config loaded from env vars: ${Object.keys(config).join(', ') || '(none)'}`);
  return config;
}

log(`Active agents: ${Object.keys(agentConfig).join(', ') || '(none)'}`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function uuid() {
  return crypto.randomUUID();
}

// Simple HTTP GET that returns parsed JSON.
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Conversation context — fetch recent messages for contextual wakes
// ---------------------------------------------------------------------------

const contextCache = new Map(); // channelName → { messages, timestamp }

async function fetchRecentMessages(channelName, limit = CONTEXT_MESSAGES_LIMIT) {
  // Check cache first
  const cached = contextCache.get(channelName);
  if (cached && Date.now() - cached.timestamp < CONTEXT_CACHE_TTL_MS) {
    return cached.messages;
  }

  try {
    const url = `${MEETING_BOARD_URL}/api/messages?channel=${encodeURIComponent(channelName)}&limit=${limit}`;
    const messages = await httpGetJson(url);
    const result = Array.isArray(messages) ? messages : [];
    contextCache.set(channelName, { messages: result, timestamp: Date.now() });
    return result;
  } catch (e) {
    log(`Failed to fetch recent messages for #${channelName}: ${e.message}`);
    return [];
  }
}

function formatConversationContext(messages, channelName) {
  if (!messages.length) return '';

  // Messages from API are newest-first; reverse for chronological order
  const chronological = [...messages].reverse();
  const lines = chronological.map(m => {
    const name = m.author_name || m.author || 'unknown';
    const role = m.author_role ? ` (${m.author_role.toUpperCase()})` : '';
    return `  [${name}${role}] ${m.content}`;
  });

  return `\n\nRecent conversation in #${channelName}:\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Observer — LLM-powered relevance evaluation (Haiku)
// ---------------------------------------------------------------------------

const https = require('https');

/**
 * Call Anthropic Messages API to evaluate which agents (if any) should be
 * woken for a conversation. Returns an array of agent IDs.
 */
async function evaluateRelevance(conversationContext, candidateAgents, channelName) {
  if (!OBSERVER_API_KEY) return [];

  const agentList = candidateAgents
    .map(a => `- ${a.id} "${a.name}" (${a.role.toUpperCase()}): ${ROLE_DESCRIPTIONS[a.role] || a.role}`)
    .join('\n');

  const prompt = `You are a conversation observer for a team chat (like Slack). Your job is to decide which team members, if any, should be notified about this conversation so they can chime in.

Team members available to notify:
${agentList}

Current conversation in #${channelName}:
${conversationContext}

Decide which team members (if any) should be pulled into this conversation. Consider:
1. Is the topic genuinely relevant to their role, and would their expertise add value?
2. Have they already participated and said what they need to say?
3. Is the conversation going in circles or has it become unproductive? If so, don't add more voices.
4. Would notifying them lead to a useful contribution, or just noise?
5. Lean toward NOT notifying — only wake someone if their input would be clearly valuable.

Respond with ONLY a JSON object: {"wake": ["agentId1", "agentId2"], "reason": "brief explanation"}
If no one should be notified: {"wake": [], "reason": "brief explanation"}`;

  try {
    const body = JSON.stringify({
      model: OBSERVER_MODEL,
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': OBSERVER_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse Anthropic response: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('Anthropic API timeout')); });
      req.write(body);
      req.end();
    });

    // Extract text from response
    const text = result.content?.[0]?.text || '';
    // Parse JSON from response (may be wrapped in markdown code fences)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log(`Observer: could not parse Haiku response: ${text.slice(0, 200)}`);
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const wake = Array.isArray(parsed.wake) ? parsed.wake : [];
    const reason = parsed.reason || '';

    if (wake.length > 0) {
      log(`Observer: Haiku recommends waking [${wake.join(', ')}] — ${reason}`);
    } else {
      log(`Observer: Haiku says no one needed — ${reason}`);
    }

    return wake;
  } catch (e) {
    log(`Observer: Haiku evaluation failed: ${e.message}`);
    return [];
  }
}

const ROLE_DESCRIPTIONS = {
  po: 'Product Owner — requirements, stories, priorities, roadmap, stakeholder needs',
  dev: 'Developer — code, architecture, implementation, debugging, APIs, databases',
  cq: 'Code Quality — reviews, standards, security, tech debt, best practices',
  qa: 'QA/Testing — test plans, bug verification, regression, e2e, coverage',
  ops: 'Operations — deployment, infrastructure, monitoring, CI/CD, scaling',
};

// Quick pre-filter: does this message have ANY topical relevance worth evaluating?
const ALL_KEYWORDS = [
  'requirement', 'story', 'epic', 'feature', 'priority', 'backlog', 'sprint', 'roadmap',
  'code', 'bug', 'error', 'implement', 'api', 'database', 'refactor', 'architecture',
  'quality', 'lint', 'review', 'security', 'vulnerability', 'tech debt',
  'test', 'testing', 'regression', 'e2e', 'coverage', 'defect',
  'deploy', 'infrastructure', 'docker', 'kubernetes', 'monitoring', 'production',
  'deadline', 'milestone', 'blocker', 'risk', 'performance', 'migration',
];

function hasAnyRelevance(content) {
  const lower = content.toLowerCase();
  return ALL_KEYWORDS.some(kw => lower.includes(kw));
}

log(`Observer: ${OBSERVER_ENABLED ? 'enabled' : 'disabled'} (model=${OBSERVER_MODEL}, api_key=${OBSERVER_API_KEY ? 'set' : 'MISSING'})`);

// ---------------------------------------------------------------------------
// Device identity — ED25519 keypair for OpenClaw gateway auth
// ---------------------------------------------------------------------------

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const IDENTITY_DIR  = path.join(process.env.HOME || '/tmp', '.openclaw', 'identity');
const IDENTITY_FILE = path.join(IDENTITY_DIR, 'device.json');

function base64UrlEncode(buf) {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function derivePublicKeyRaw(publicKeyPem) {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  if (spki.length === ED25519_SPKI_PREFIX.length + 32 &&
      spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function fingerprintPublicKey(publicKeyPem) {
  return crypto.createHash('sha256').update(derivePublicKeyRaw(publicKeyPem)).digest('hex');
}

function loadOrCreateDeviceIdentity() {
  try {
    if (fs.existsSync(IDENTITY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8'));
      if (parsed?.version === 1 && parsed.deviceId && parsed.publicKeyPem && parsed.privateKeyPem) {
        log(`Device identity loaded: ${parsed.deviceId.slice(0, 12)}...`);
        return parsed;
      }
    }
  } catch {}

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem  = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const deviceId = fingerprintPublicKey(publicKeyPem);

  const identity = { version: 1, deviceId, publicKeyPem, privateKeyPem, createdAtMs: Date.now() };
  try {
    fs.mkdirSync(path.dirname(IDENTITY_FILE), { recursive: true });
    fs.writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2) + '\n', { mode: 0o600 });
  } catch (e) {
    log(`Warning: could not persist device identity: ${e.message}`);
  }

  log(`Device identity created: ${deviceId.slice(0, 12)}...`);
  return identity;
}

function buildDeviceAuthPayload(params) {
  const version = params.nonce ? 'v2' : 'v1';
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(','),
    String(params.signedAtMs),
    params.token || ''
  ];
  if (version === 'v2') base.push(params.nonce || '');
  return base.join('|');
}

function signPayload(privateKeyPem, payload) {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, 'utf8'), key));
}

const deviceIdentity = loadOrCreateDeviceIdentity();

// ---------------------------------------------------------------------------
// Device token storage — after pairing, gateway assigns a device-specific token
// that must be used for all subsequent connections (not the original gateway token).
// ---------------------------------------------------------------------------

const DEVICE_TOKENS_FILE = path.join(IDENTITY_DIR, 'device-tokens.json');
const deviceTokens = new Map(); // agent name → device token string

function loadDeviceTokens() {
  try {
    if (fs.existsSync(DEVICE_TOKENS_FILE)) {
      const data = JSON.parse(fs.readFileSync(DEVICE_TOKENS_FILE, 'utf8'));
      for (const [agent, token] of Object.entries(data)) {
        deviceTokens.set(agent, token);
      }
      log(`Loaded ${deviceTokens.size} stored device token(s)`);
    }
  } catch (e) {
    log(`Warning: could not load device tokens: ${e.message}`);
  }
}

function saveDeviceTokens() {
  try {
    const data = {};
    for (const [agent, token] of deviceTokens) {
      data[agent] = token;
    }
    fs.mkdirSync(path.dirname(DEVICE_TOKENS_FILE), { recursive: true });
    fs.writeFileSync(DEVICE_TOKENS_FILE, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  } catch (e) {
    log(`Warning: could not save device tokens: ${e.message}`);
  }
}

function storeDeviceToken(agent, token) {
  deviceTokens.set(agent, token);
  saveDeviceTokens();
  log(`  Stored device token for "${agent}"`);
}

function getAuthToken(agent) {
  // Prefer stored device token over original gateway token
  const stored = deviceTokens.get(agent);
  if (stored) return stored;
  return agentConfig[agent]?.token || '';
}

loadDeviceTokens();

// ---------------------------------------------------------------------------
// Wake debounce — prevent spamming an agent that was just woken
// ---------------------------------------------------------------------------

const lastWake = new Map(); // agent name → timestamp

function shouldWake(agent) {
  const now = Date.now();
  const last = lastWake.get(agent) || 0;
  if (now - last < WAKE_DEBOUNCE_MS) {
    return false;
  }
  lastWake.set(agent, now);
  return true;
}

// ---------------------------------------------------------------------------
// Persistent agent connections — always-on WebSocket to each agent gateway
// ---------------------------------------------------------------------------

const KEEPALIVE_INTERVAL_MS = 30000; // ping every 30s to keep connection alive
const agentConns = new Map(); // agentId → connection state

function buildConnectParams(agentId, nonce) {
  const role = 'operator';
  const scopes = ['operator.admin'];
  const signedAtMs = Date.now();
  const clientId = 'gateway-client';
  const clientMode = 'backend';
  const authToken = getAuthToken(agentId);

  const payload = buildDeviceAuthPayload({
    deviceId: deviceIdentity.deviceId,
    clientId,
    clientMode,
    role,
    scopes,
    signedAtMs,
    token: authToken || null,
    nonce,
  });
  const signature = signPayload(deviceIdentity.privateKeyPem, payload);

  return {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client: {
      id: clientId,
      version: '1.0.0',
      platform: 'linux',
      mode: clientMode,
      instanceId: uuid(),
    },
    caps: [],
    auth: { token: authToken },
    role,
    scopes,
    device: {
      id: deviceIdentity.deviceId,
      publicKey: base64UrlEncode(derivePublicKeyRaw(deviceIdentity.publicKeyPem)),
      signature,
      signedAt: signedAtMs,
      ...(nonce ? { nonce } : {}),
    },
  };
}

/**
 * Establish and maintain a persistent authenticated WebSocket connection
 * to an agent's OpenClaw gateway. Automatically reconnects on disconnect.
 */
function connectToAgent(agentId) {
  const cfg = agentConfig[agentId];
  if (!cfg) return;

  // Get or create connection state
  let conn = agentConns.get(agentId);
  if (!conn) {
    conn = {
      agentId,
      ws: null,
      authenticated: false,
      connecting: false,
      pending: new Map(),       // reqId → { resolve, timer }
      reconnectTimer: null,
      reconnectDelay: 1000,     // exponential backoff, starts 1s
      keepaliveTimer: null,
      wakeQueue: null,          // latest wake text queued while disconnected
      retryCount: 0,            // suppress noisy logs on repeated retries
    };
    agentConns.set(agentId, conn);
  }

  // Don't double-connect
  if (conn.connecting || conn.authenticated) return;

  conn.connecting = true;
  conn.authenticated = false;
  if (conn.reconnectTimer) { clearTimeout(conn.reconnectTimer); conn.reconnectTimer = null; }

  if (conn.retryCount === 0) {
    log(`  Connecting to "${agentId}" at ${cfg.url}`);
  } else if (conn.retryCount === 5) {
    log(`  Still trying to reach "${agentId}" (retries silenced until connected)`);
  }

  const ws = new WebSocket(cfg.url);
  conn.ws = ws;
  let connectSent = false;
  let challengeNonce = null;

  function sendReq(method, params) {
    const id = uuid();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (conn.pending.has(id)) {
          conn.pending.delete(id);
          resolve({ error: { message: 'Request timeout' } });
        }
      }, 15000);
      conn.pending.set(id, { resolve, timer });
      try {
        ws.send(JSON.stringify({ type: 'req', id, method, params }));
      } catch (e) {
        clearTimeout(timer);
        conn.pending.delete(id);
        resolve({ error: { message: e.message } });
      }
    });
  }

  // Store sendReq on conn so wakeAgent() can use it
  conn.sendReq = sendReq;

  async function doConnect(nonce) {
    if (connectSent) return;
    connectSent = true;

    try {
      const params = buildConnectParams(agentId, nonce || challengeNonce);
      const res = await sendReq('connect', params);

      if (res.error) {
        // NOT_PAIRED — wait for auto-approve daemon, then retry
        if (res.error.code === 'NOT_PAIRED') {
          log(`  Pairing requested for "${agentId}", waiting for auto-approve...`);
          ws.close();
          await new Promise(r => setTimeout(r, 2000));
          conn.connecting = false;
          connectToAgent(agentId);
          return;
        }
        // Stale device token — clear and retry with gateway token
        const errMsg = res.error.message || '';
        if (errMsg.includes('token mismatch') && deviceTokens.has(agentId)) {
          log(`  Stale device token for "${agentId}", clearing and retrying...`);
          deviceTokens.delete(agentId);
          saveDeviceTokens();
          ws.close();
          await new Promise(r => setTimeout(r, 1000));
          conn.connecting = false;
          connectToAgent(agentId);
          return;
        }
        log(`  Connect error for "${agentId}": ${JSON.stringify(res.error)}`);
        ws.close();
        return;
      }

      // Success — store device token, mark connected
      const deviceToken = res.payload?.auth?.deviceToken;
      if (deviceToken) storeDeviceToken(agentId, deviceToken);

      conn.authenticated = true;
      conn.connecting = false;
      conn.reconnectDelay = 1000; // reset backoff
      conn.retryCount = 0;
      log(`  Connected to "${agentId}" (persistent)`);

      // Start keepalive pings
      if (conn.keepaliveTimer) clearInterval(conn.keepaliveTimer);
      conn.keepaliveTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, KEEPALIVE_INTERVAL_MS);

      // Flush any wake that arrived while we were connecting
      if (conn.wakeQueue) {
        const text = conn.wakeQueue;
        conn.wakeQueue = null;
        log(`  Flushing queued wake for "${agentId}"`);
        const wakeRes = await sendReq('wake', { mode: 'now', text });
        if (wakeRes.error) {
          log(`  Wake error for "${agentId}": ${JSON.stringify(wakeRes.error)}`);
        } else {
          log(`  Wake acknowledged by "${agentId}"`);
        }
      }
    } catch (e) {
      log(`  Connection failed for "${agentId}": ${e.message}`);
      ws.close();
    }
  }

  ws.on('open', () => {
    // Wait up to 750ms for a challenge; if none arrives, connect anyway
    setTimeout(() => {
      if (!connectSent && ws.readyState === WebSocket.OPEN) doConnect(null);
    }, 750);
  });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // Handle response to a pending request
    if (msg.type === 'res' && msg.id && conn.pending.has(msg.id)) {
      const p = conn.pending.get(msg.id);
      clearTimeout(p.timer);
      p.resolve(msg);
      conn.pending.delete(msg.id);
      return;
    }

    // Handle connect challenge
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      challengeNonce = msg.payload?.nonce || null;
      if (!connectSent) await doConnect(challengeNonce);
    }
  });

  ws.on('close', () => {
    const wasAuthenticated = conn.authenticated;
    conn.authenticated = false;
    conn.connecting = false;
    conn.ws = null;
    conn.sendReq = null;
    if (conn.keepaliveTimer) { clearInterval(conn.keepaliveTimer); conn.keepaliveTimer = null; }

    // Clear any pending requests
    for (const [, p] of conn.pending) {
      clearTimeout(p.timer);
      p.resolve({ error: { message: 'Connection closed' } });
    }
    conn.pending.clear();

    // Auto-reconnect with exponential backoff
    const delay = conn.reconnectDelay;
    conn.reconnectDelay = Math.min(conn.reconnectDelay * 2, 30000);
    if (wasAuthenticated) {
      log(`  Connection to "${agentId}" lost, reconnecting in ${delay / 1000}s`);
    }
    conn.retryCount++;
    conn.reconnectTimer = setTimeout(() => {
      conn.connecting = false;
      connectToAgent(agentId);
    }, delay);
  });

  ws.on('error', (err) => {
    if (conn.retryCount < 2) {
      log(`  WebSocket error for "${agentId}": ${err.message}`);
    }
    // 'close' event will fire after this, triggering reconnect
  });
}

/**
 * Wake an agent using its persistent connection. If not yet connected,
 * queue the wake to be sent as soon as the connection is established.
 */
function wakeAgent(agent, text) {
  if (!agentConfig[agent]) {
    log(`  No gateway config for "${agent}", skipping wake`);
    return;
  }

  if (!shouldWake(agent)) {
    log(`  Debounced wake for "${agent}" (woken <${WAKE_DEBOUNCE_MS / 1000}s ago)`);
    return;
  }

  const conn = agentConns.get(agent);

  // If connected, send wake immediately
  if (conn && conn.authenticated && conn.sendReq) {
    log(`  Waking "${agent}" (persistent connection)`);
    conn.sendReq('wake', { mode: 'now', text }).then(res => {
      if (res.error) {
        log(`  Wake error for "${agent}": ${JSON.stringify(res.error)}`);
      } else {
        log(`  Wake acknowledged by "${agent}"`);
      }
    });
    return;
  }

  // Not connected — queue wake and ensure connection is being established
  log(`  Queuing wake for "${agent}" (connecting...)`);
  if (conn) {
    conn.wakeQueue = text;
  } else {
    connectToAgent(agent);
    const newConn = agentConns.get(agent);
    if (newConn) newConn.wakeQueue = text;
  }
}

/**
 * Establish persistent connections to all configured agent gateways.
 */
function connectAllAgents() {
  log('Establishing persistent connections to all agent gateways...');
  for (const agentId of Object.keys(agentConfig)) {
    connectToAgent(agentId);
  }
}

// ---------------------------------------------------------------------------
// Meeting Board WebSocket listener
// ---------------------------------------------------------------------------

let mbWs = null;
let subscribedChannels = new Set();
let channelIdToName = {};          // channelId → channel name (e.g., "standup")
let channelRefreshTimer = null;

async function fetchChannels() {
  try {
    const channels = await httpGetJson(`${MEETING_BOARD_URL}/api/channels`);
    return Array.isArray(channels) ? channels : [];
  } catch (e) {
    log(`Failed to fetch channels: ${e.message}`);
    return [];
  }
}

function subscribeToChannels(ws, channels) {
  for (const ch of channels) {
    const id = ch.id || ch._id;
    if (!id) continue;
    if (ch.name) channelIdToName[id] = ch.name;
    if (subscribedChannels.has(id)) continue;
    ws.send(JSON.stringify({ action: 'subscribe', channel: id }));
    subscribedChannels.add(id);
  }
  log(`Subscribed to ${subscribedChannels.size} channel(s)`);
}

async function refreshChannels() {
  if (!mbWs || mbWs.readyState !== WebSocket.OPEN) return;
  const channels = await fetchChannels();
  subscribeToChannels(mbWs, channels);
}

async function handleBroadcast(raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }

  const mentions = msg.mentions;
  const hasMentions = Array.isArray(mentions) && mentions.length > 0;
  const author = msg.author || '';
  const content = msg.content || '';
  const channelId = msg.channel_id || '';
  const channelName = channelIdToName[channelId] || channelId;

  // Track which agents are woken by @mention so observer skips them
  const mentionWoken = new Set();

  // ----- Phase 1: @mention wake with conversation context -----
  if (hasMentions) {
    // Expand @everyone to all configured agents
    const expandedMentions = new Set();
    for (const mentioned of mentions) {
      if (mentioned === 'everyone') {
        for (const agentName of Object.keys(agentConfig)) {
          expandedMentions.add(agentName);
        }
      } else {
        expandedMentions.add(mentioned);
      }
    }

    // Fetch conversation context once for all mentions in this channel
    const recentMessages = channelName ? await fetchRecentMessages(channelName) : [];
    const contextStr = formatConversationContext(recentMessages, channelName);

    for (const mentioned of expandedMentions) {
      if (mentioned === author) continue;
      if (!agentConfig[mentioned]) continue;

      mentionWoken.add(mentioned);
      log(`Detected @mention for "${mentioned}" by "${author}" in #${channelName}`);

      const wakeText = `@${mentioned} mentioned by ${author} in #${channelName}: "${content.slice(0, 300)}"${contextStr}`;
      wakeAgent(mentioned, wakeText);
    }
  }

  // ----- Phase 2: Observer — LLM-powered relevance evaluation -----
  if (!OBSERVER_ENABLED) return;
  if (!content || !channelName) return;
  if (!OBSERVER_API_KEY) return;

  // Quick pre-filter: skip messages with zero topical keywords (saves API calls)
  if (!hasAnyRelevance(content)) return;

  // Build list of candidate agents (not already @mentioned, not the author)
  const candidates = [];
  for (const [agentName, cfg] of Object.entries(agentConfig)) {
    if (mentionWoken.has(agentName)) continue;
    if (agentName === author) continue;
    // Respect wake debounce — but don't consume it yet (just check)
    const lastWakeTime = lastWake.get(agentName) || 0;
    if (Date.now() - lastWakeTime < WAKE_DEBOUNCE_MS) continue;
    candidates.push({ id: agentName, name: cfg.name || agentName, role: cfg.role || agentName });
  }
  if (candidates.length === 0) return;

  // Fetch conversation context for Haiku to evaluate
  const recentMessages = await fetchRecentMessages(channelName);
  const contextStr = formatConversationContext(recentMessages, channelName);
  if (!contextStr) return;

  // Ask Haiku which agents should be woken
  const agentsToWake = await evaluateRelevance(contextStr, candidates, channelName);

  for (const agentId of agentsToWake) {
    if (!agentConfig[agentId]) continue;
    if (mentionWoken.has(agentId)) continue;
    if (!shouldWake(agentId)) continue;

    const wakeText = `You're observing #${channelName} and noticed a conversation relevant to your role. If you have something valuable to contribute, post to the channel. If not, do nothing — no response is needed.${contextStr}`;
    wakeAgent(agentId, wakeText);
  }
}

function connectToMeetingBoard() {
  log(`Connecting to Meeting Board at ${MEETING_BOARD_WS_URL}`);
  subscribedChannels = new Set();

  mbWs = new WebSocket(MEETING_BOARD_WS_URL);

  mbWs.on('open', async () => {
    log('Connected to Meeting Board');

    // Fetch and subscribe to all channels
    const channels = await fetchChannels();
    subscribeToChannels(mbWs, channels);

    // Periodically refresh channels to pick up new ones
    if (channelRefreshTimer) clearInterval(channelRefreshTimer);
    channelRefreshTimer = setInterval(refreshChannels, CHANNEL_REFRESH_MS);
  });

  mbWs.on('message', (data) => {
    handleBroadcast(data).catch(e => log(`Broadcast handler error: ${e.message}`));
  });

  mbWs.on('close', () => {
    log(`Meeting Board connection closed, reconnecting in ${RECONNECT_DELAY_MS / 1000}s`);
    if (channelRefreshTimer) clearInterval(channelRefreshTimer);
    setTimeout(connectToMeetingBoard, RECONNECT_DELAY_MS);
  });

  mbWs.on('error', (err) => {
    log(`Meeting Board WebSocket error: ${err.message}`);
    // 'close' event will fire after this, triggering reconnect
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

log('DevTeam Mention Router starting');
connectToMeetingBoard();
// Establish persistent connections to all agent gateways after a short delay
setTimeout(() => connectAllAgents(), 2000);
