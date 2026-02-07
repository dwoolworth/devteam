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
          config[agent.id] = { url: agent.url, token: agent.token };
        }
        log(`Agent config loaded from ${configPath}: ${Object.keys(config).join(', ')}`);
        return config;
      }
      log(`Agent config loaded from ${configPath}: ${Object.keys(data).join(', ')}`);
      return data;
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
      config[name] = { url, token };
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
// Wake an agent via its OpenClaw gateway WebSocket
// ---------------------------------------------------------------------------

function wakeAgent(agent, text) {
  const cfg = agentConfig[agent];
  if (!cfg) {
    log(`  No gateway config for "${agent}", skipping wake`);
    return;
  }

  if (!shouldWake(agent)) {
    log(`  Debounced wake for "${agent}" (woken <${WAKE_DEBOUNCE_MS / 1000}s ago)`);
    return;
  }

  log(`  Waking "${agent}" via ${cfg.url}`);

  const ws = new WebSocket(cfg.url);
  let settled = false;
  let connectSent = false;
  let challengeNonce = null;
  const pending = new Map(); // id → { resolve }

  const timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      log(`  Wake timeout for "${agent}"`);
      ws.close();
    }
  }, 15000);

  function sendReq(method, params) {
    const id = uuid();
    return new Promise((resolve) => {
      pending.set(id, { resolve });
      ws.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }

  function buildConnectParams(nonce) {
    const role = 'operator';
    const scopes = ['operator.admin'];
    const signedAtMs = Date.now();
    const clientId = 'gateway-client';
    const clientMode = 'backend';
    const authToken = getAuthToken(agent);

    // Build signed device auth payload
    const payload = buildDeviceAuthPayload({
      deviceId: deviceIdentity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token: authToken || null,
      nonce
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
        instanceId: uuid()
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
        ...(nonce ? { nonce } : {})
      }
    };
  }

  // Queue connect after 750ms (matches OpenClaw client behavior) unless a
  // challenge arrives first.
  ws.on('open', () => {
    setTimeout(() => {
      if (!settled && !connectSent) {
        doConnect(null);
      }
    }, 750);
  });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Handle response to a pending request
    if (msg.type === 'res' && msg.id && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg);
      pending.delete(msg.id);
      return;
    }

    // Handle connect challenge event (type is "event", not "ev")
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      const nonce = msg.payload?.nonce || null;
      challengeNonce = nonce;
      if (!connectSent) {
        await doConnect(nonce);
      }
      return;
    }
  });

  async function doConnect(nonce, retryCount = 0) {
    if (connectSent && retryCount === 0) return;
    connectSent = true;

    try {
      const params = buildConnectParams(nonce || challengeNonce);
      const connectRes = await sendReq('connect', params);

      if (connectRes.error) {
        // If NOT_PAIRED, wait for auto-approve daemon then retry once
        if (connectRes.error.code === 'NOT_PAIRED' && retryCount < 2) {
          log(`  Pairing requested for "${agent}", waiting for auto-approve...`);
          connectSent = false;
          challengeNonce = null;
          ws.close();
          await new Promise(r => setTimeout(r, 2000));
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            lastWake.delete(agent);
            wakeAgent(agent, text);
          }
          return;
        }
        // If token mismatch and we were using a stored device token, clear it and retry
        // with the original gateway token
        const errMsg = connectRes.error.message || '';
        if (errMsg.includes('token mismatch') && deviceTokens.has(agent) && retryCount < 2) {
          log(`  Stale device token for "${agent}", clearing and retrying with gateway token...`);
          deviceTokens.delete(agent);
          saveDeviceTokens();
          connectSent = false;
          challengeNonce = null;
          ws.close();
          await new Promise(r => setTimeout(r, 1000));
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            lastWake.delete(agent);
            wakeAgent(agent, text);
          }
          return;
        }
        log(`  Connect error for "${agent}": ${JSON.stringify(connectRes.error)}`);
        cleanup();
        return;
      }

      // Extract and store device token if provided
      const deviceToken = connectRes.payload?.auth?.deviceToken;
      if (deviceToken) {
        storeDeviceToken(agent, deviceToken);
      }

      log(`  Connected to "${agent}" gateway`);

      // Send wake
      const wakeRes = await sendReq('wake', { mode: 'now', text });

      if (wakeRes.error) {
        log(`  Wake error for "${agent}": ${JSON.stringify(wakeRes.error)}`);
      } else {
        log(`  Wake acknowledged by "${agent}"`);
      }

      cleanup();
    } catch (e) {
      log(`  Wake failed for "${agent}": ${e.message}`);
      cleanup();
    }
  }

  function cleanup() {
    if (!settled) {
      settled = true;
      clearTimeout(timeout);
      ws.close();
    }
  }

  ws.on('error', (err) => {
    log(`  WebSocket error for "${agent}": ${err.message}`);
    cleanup();
  });

  ws.on('close', () => {
    clearTimeout(timeout);
  });
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

function handleBroadcast(raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }

  // Only process messages that have mentions
  const mentions = msg.mentions;
  if (!Array.isArray(mentions) || mentions.length === 0) return;

  const author = msg.author || '';
  const content = msg.content || '';
  const channelId = msg.channel_id || '';

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

  for (const mentioned of expandedMentions) {
    // Don't wake an agent that mentioned itself
    if (mentioned === author) continue;

    // Only wake configured agents
    if (!agentConfig[mentioned]) continue;

    const channelName = channelIdToName[channelId] || channelId;
    log(`Detected @mention for "${mentioned}" by "${author}" in #${channelName}`);

    const context = `@${mentioned} mentioned by ${author} in #${channelName}: "${content.slice(0, 300)}"`;
    wakeAgent(mentioned, context);
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
    handleBroadcast(data);
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
// Pre-pair with all agent gateways at startup
// ---------------------------------------------------------------------------

async function prePairWithAgent(agent, cfg) {
  return new Promise((resolve) => {
    const ws = new WebSocket(cfg.url);
    let done = false;
    let connectSent = false;
    let challengeNonce = null;
    const pending = new Map();

    const timer = setTimeout(() => {
      if (!done) { done = true; ws.close(); resolve(false); }
    }, 10000);

    function sendReq(method, params) {
      const id = uuid();
      return new Promise((res) => {
        pending.set(id, { resolve: res });
        ws.send(JSON.stringify({ type: 'req', id, method, params }));
      });
    }

    function buildParams(nonce) {
      const role = 'operator';
      const scopes = ['operator.admin'];
      const signedAtMs = Date.now();
      const clientId = 'gateway-client';
      const clientMode = 'backend';
      const authToken = getAuthToken(agent);
      const payload = buildDeviceAuthPayload({
        deviceId: deviceIdentity.deviceId, clientId, clientMode, role, scopes,
        signedAtMs, token: authToken || null, nonce
      });
      const signature = signPayload(deviceIdentity.privateKeyPem, payload);
      return {
        minProtocol: PROTOCOL_VERSION, maxProtocol: PROTOCOL_VERSION,
        client: { id: clientId, version: '1.0.0', platform: 'linux', mode: clientMode, instanceId: uuid() },
        caps: [], auth: { token: authToken }, role, scopes,
        device: {
          id: deviceIdentity.deviceId,
          publicKey: base64UrlEncode(derivePublicKeyRaw(deviceIdentity.publicKeyPem)),
          signature, signedAt: signedAtMs,
          ...(nonce ? { nonce } : {})
        }
      };
    }

    async function doConnect(nonce) {
      if (connectSent) return;
      connectSent = true;
      try {
        const res = await sendReq('connect', buildParams(nonce || challengeNonce));
        if (res.error) {
          if (res.error.code === 'NOT_PAIRED') {
            log(`  Pre-pair: pairing requested for "${agent}", waiting for auto-approve...`);
            // Close, wait, then retry once
            ws.close();
            await new Promise(r => setTimeout(r, 2000));
            done = true; clearTimeout(timer);
            resolve(await prePairWithAgent(agent, cfg));
            return;
          }
          // If token mismatch with stored device token, clear it and retry with gateway token
          const errMsg = res.error.message || '';
          if (errMsg.includes('token mismatch') && deviceTokens.has(agent)) {
            log(`  Pre-pair: stale device token for "${agent}", clearing and retrying...`);
            deviceTokens.delete(agent);
            saveDeviceTokens();
            done = true; clearTimeout(timer); ws.close();
            resolve(await prePairWithAgent(agent, cfg));
            return;
          }
          log(`  Pre-pair: connect error for "${agent}": ${errMsg || JSON.stringify(res.error)}`);
        } else {
          // Extract and store device token if provided
          const deviceToken = res.payload?.auth?.deviceToken;
          if (deviceToken) {
            storeDeviceToken(agent, deviceToken);
          }
          log(`  Pre-pair: "${agent}" paired successfully`);
        }
      } catch (e) {
        log(`  Pre-pair: failed for "${agent}": ${e.message}`);
      }
      done = true; clearTimeout(timer); ws.close(); resolve(true);
    }

    ws.on('open', () => {
      setTimeout(() => { if (!done && !connectSent) doConnect(null); }, 750);
    });

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'res' && msg.id && pending.has(msg.id)) {
        pending.get(msg.id).resolve(msg); pending.delete(msg.id); return;
      }
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        challengeNonce = msg.payload?.nonce || null;
        if (!connectSent) await doConnect(challengeNonce);
      }
    });

    ws.on('error', () => { if (!done) { done = true; clearTimeout(timer); resolve(false); } });
    ws.on('close', () => { clearTimeout(timer); });
  });
}

async function prePairAllAgents() {
  log('Pre-pairing with all agent gateways...');
  for (const [agent, cfg] of Object.entries(agentConfig)) {
    await prePairWithAgent(agent, cfg);
  }
  log('Pre-pairing complete');
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

log('DevTeam Mention Router starting');
connectToMeetingBoard();
// Pre-pair in the background after startup
setTimeout(() => prePairAllAgents(), 2000);
