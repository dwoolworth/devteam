const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// S3 Configuration for DigitalOcean Spaces
const S3_BUCKET = 'mnemoshare';
const S3_FOLDER = 'planningboard';
const S3_CDN_URL = process.env.S3_CDN_URL || 'https://mnemoshare.sfo3.cdn.digitaloceanspaces.com';

const s3Client = new S3Client({
  endpoint: 'https://sfo3.digitaloceanspaces.com',
  region: 'sfo3',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'DO00QWRPACHVN6QJLQ6J',
    secretAccessKey: process.env.S3_SECRET_KEY || 'l2LIBS2qC8KWQ3xxdsxLGaJe2FkjeT5k1ty0LxaEQ50'
  }
});

// Configure multer for memory storage (we'll upload to S3)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Allow images and common document types
    const allowed = /jpeg|jpg|png|gif|webp|pdf|doc|docx|txt|md/;
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    if (allowed.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  }
});

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ================== WEBSOCKET SERVER ==================

const wss = new WebSocket.Server({ server });

// Track connections by board
const boardClients = new Map(); // boardId -> Set of WebSocket clients

wss.on('connection', (ws, req) => {
  console.log('WebSocket client connected');
  
  ws.isAlive = true;
  ws.boardId = null;
  
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // Subscribe to a board
      if (data.type === 'subscribe' && data.boardId) {
        ws.boardId = data.boardId;
        
        if (!boardClients.has(data.boardId)) {
          boardClients.set(data.boardId, new Set());
        }
        boardClients.get(data.boardId).add(ws);
        
        ws.send(JSON.stringify({ type: 'subscribed', boardId: data.boardId }));
        console.log(`Client subscribed to board ${data.boardId}`);
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  });
  
  ws.on('close', () => {
    // Remove from board clients
    if (ws.boardId && boardClients.has(ws.boardId)) {
      boardClients.get(ws.boardId).delete(ws);
      if (boardClients.get(ws.boardId).size === 0) {
        boardClients.delete(ws.boardId);
      }
    }
    console.log('WebSocket client disconnected');
  });
});

// Heartbeat to detect stale connections
const wsHeartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) {
      if (ws.boardId && boardClients.has(ws.boardId)) {
        boardClients.get(ws.boardId).delete(ws);
      }
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(wsHeartbeat);
});

// Broadcast to all clients watching a board
function broadcastToBoard(boardId, event) {
  const clients = boardClients.get(boardId);
  if (!clients) return;
  
  const message = JSON.stringify(event);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE || 'taskboard';

let db;
let client;

// ================== AGENT NOTIFICATION SYSTEM ==================

// Load agent gateways from registry file or fall back to hardcoded defaults
function loadAgentGateways() {
  const registryPath = process.env.AGENTS_REGISTRY;
  if (registryPath && fs.existsSync(registryPath)) {
    try {
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      const gateways = {};
      for (const agent of registry) {
        const email = agent.email || `${agent.id}@devteam.local`;
        gateways[email] = {
          name: agent.name || agent.id,
          role: agent.role,
          gatewayUrl: agent.gateway ? `http://${agent.gateway.host || agent.id}:${agent.gateway.port || 18789}` : `http://${agent.id}:18789`,
          token: agent.token || ''
        };
      }
      console.log(`Loaded ${Object.keys(gateways).length} agents from registry: ${registryPath}`);
      return gateways;
    } catch (e) {
      console.error(`Failed to load agents registry: ${e.message}`);
    }
  }

  // Fallback: hardcoded defaults
  return {
    'piper@devteam.local': {
      name: 'Piper', role: 'po',
      gatewayUrl: 'http://po:18789', token: process.env.MB_TOKEN_PO || 'change-me-po-token'
    },
    'devon@devteam.local': {
      name: 'Devon', role: 'dev',
      gatewayUrl: 'http://dev:18789', token: process.env.MB_TOKEN_DEV || 'change-me-dev-token'
    },
    'carmen@devteam.local': {
      name: 'Carmen', role: 'cq',
      gatewayUrl: 'http://cq:18789', token: process.env.MB_TOKEN_CQ || 'change-me-cq-token'
    },
    'quinn@devteam.local': {
      name: 'Quinn', role: 'qa',
      gatewayUrl: 'http://qa:18789', token: process.env.MB_TOKEN_QA || 'change-me-qa-token'
    },
    'rafael@devteam.local': {
      name: 'Rafael', role: 'ops',
      gatewayUrl: 'http://ops:18789', token: process.env.MB_TOKEN_OPS || 'change-me-ops-token'
    }
  };
}

const AGENT_GATEWAYS = loadAgentGateways();

// Send notification directly to agent's Clawdbot gateway
async function sendAgentNotification(agentEmail, message) {
  const agent = AGENT_GATEWAYS[agentEmail];
  if (!agent) {
    console.log(`No gateway configured for ${agentEmail}`);
    return;
  }
  
  try {
    const response = await fetch(`${agent.gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${agent.token}`
      },
      body: JSON.stringify({
        model: 'default',
        messages: [
          {
            role: 'user',
            content: `[TaskBoard Notification]\n\n${message}\n\nPlease acknowledge and take appropriate action.`
          }
        ],
        stream: false
      })
    });
    
    if (!response.ok) {
      console.error(`Agent notification to ${agent.name} failed:`, response.status);
    } else {
      console.log(`Notification sent to ${agent.name}`);
    }
  } catch (error) {
    console.error(`Agent notification error (${agent.name}):`, error.message);
  }
}

// Legacy Discord webhook (kept for backwards compatibility)
async function sendDiscordWebhook(webhookUrl, payload) {
  if (!webhookUrl) return;
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      console.error('Discord webhook failed:', response.status, await response.text());
    }
  } catch (error) {
    console.error('Discord webhook error:', error.message);
  }
}

async function sendEmail(to, subject, body) {
  // Using SendGrid (mnemoshare.com has it configured)
  const sendgridApiKey = process.env.SENDGRID_API_KEY;
  if (!sendgridApiKey) {
    console.log('Email notification (no SendGrid key):', { to, subject });
    return;
  }
  
  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendgridApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: 'taskboard@mnemoshare.com', name: 'TaskBoard' },
        subject: subject,
        content: [{ type: 'text/plain', value: body }]
      })
    });
    if (!response.ok) {
      console.error('SendGrid failed:', response.status);
    }
  } catch (error) {
    console.error('Email error:', error.message);
  }
}

// Parse @mentions from text (returns array of emails)
function parseMentions(text) {
  const mentionRegex = /@(\w+)/g;
  const mentions = [];
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(match[1].toLowerCase());
  }
  return mentions;
}

// Get user by name (case-insensitive)
async function getUserByName(name) {
  return await db.collection('users').findOne({ 
    name: { $regex: new RegExp(`^${name}$`, 'i') } 
  });
}

// Send notifications for task events
async function notifyTaskEvent(eventType, task, actor, extraData = {}) {
  const webhooks = await db.collection('webhooks').find({ enabled: true }).toArray();
  const users = await db.collection('users').find().toArray();
  const userMap = Object.fromEntries(users.map(u => [u.email, u]));
  
  const taskUrl = `https://planning.mnemoshare.com/board/${task.boardId}#task-${task._id}`;
  
  for (const webhook of webhooks) {
    let shouldNotify = false;
    let notifyReason = '';
    
    // Check notification rules
    switch (eventType) {
      case 'task_assigned':
        // Notify if task is assigned to this webhook's user
        if (task.assignee === webhook.userEmail) {
          shouldNotify = true;
          notifyReason = `📋 **Task Assigned to You**`;
        }
        break;
        
      case 'status_change':
        // Notify assignee when their task moves
        if (task.assignee === webhook.userEmail && actor !== webhook.userEmail) {
          shouldNotify = true;
          notifyReason = `🔄 **Task Status Changed**`;
        }
        // Notify watchers of specific columns
        if (webhook.watchColumns && webhook.watchColumns.includes(task.status)) {
          shouldNotify = true;
          notifyReason = `👀 **Task Entered ${formatStatus(task.status)}**`;
        }
        break;
        
      case 'comment_added':
        // Notify assignee of new comments (unless they wrote it)
        if (task.assignee === webhook.userEmail && actor !== webhook.userEmail) {
          shouldNotify = true;
          notifyReason = `💬 **New Comment on Your Task**`;
        }
        // Notify if @mentioned
        if (extraData.mentions && extraData.mentions.includes(webhook.userName?.toLowerCase())) {
          shouldNotify = true;
          notifyReason = `📣 **You Were Mentioned**`;
        }
        break;
        
      case 'task_updated':
        // Notify assignee when task details change
        if (task.assignee === webhook.userEmail && actor !== webhook.userEmail) {
          shouldNotify = true;
          notifyReason = `✏️ **Task Updated**`;
        }
        break;
    }
    
    if (shouldNotify) {
      // Build notification message
      let message = `${notifyReason}\n\n`;
      message += `**Task:** ${task.name}\n`;
      message += `**Task ID:** ${task._id}\n`;
      message += `**Status:** ${formatStatus(task.status)}\n`;
      message += `**Priority:** ${getPriorityLabel(task.priority)}\n`;
      message += `**Updated By:** ${actor}\n`;
      message += `**URL:** ${taskUrl}\n`;
      
      if (task.description) {
        message += `\n**Description:**\n${task.description.substring(0, 500)}${task.description.length > 500 ? '...' : ''}\n`;
      }
      
      if (extraData.comment) {
        message += `\n**Comment:**\n${extraData.comment}\n`;
      }
      
      if (extraData.statusFrom && extraData.statusTo) {
        message += `\n**Status Change:** ${formatStatus(extraData.statusFrom)} → ${formatStatus(extraData.statusTo)}\n`;
      }
      
      // Send to agent gateway (direct via Tailscale)
      if (AGENT_GATEWAYS[webhook.userEmail]) {
        await sendAgentNotification(webhook.userEmail, message);
      }
      
      // Also send to Discord webhook if configured (legacy support)
      if (webhook.discordWebhook) {
        const embed = {
          title: task.name,
          url: taskUrl,
          description: notifyReason,
          color: getStatusColor(task.status),
          fields: [
            { name: 'Status', value: formatStatus(task.status), inline: true },
            { name: 'Priority', value: getPriorityLabel(task.priority), inline: true },
            { name: 'Updated By', value: actor, inline: true }
          ],
          timestamp: new Date().toISOString()
        };
        
        if (extraData.comment) {
          embed.fields.push({ 
            name: 'Comment', 
            value: extraData.comment.length > 200 ? extraData.comment.substring(0, 200) + '...' : extraData.comment 
          });
        }
        
        await sendDiscordWebhook(webhook.discordWebhook, { embeds: [embed] });
      }
    }
  }
  
  // Send email for @mentions to humans
  if (eventType === 'comment_added' && extraData.mentions) {
    for (const mentionName of extraData.mentions) {
      const user = await getUserByName(mentionName);
      if (user && !user.isAgent) {  // Only email humans
        await sendEmail(
          user.email,
          `[TaskBoard] ${actor} mentioned you in "${task.title}"`,
          `${actor} mentioned you in a comment:\n\n"${extraData.comment}"\n\nView task: ${taskUrl}`
        );
      }
    }
  }
}

function formatStatus(status) {
  const labels = {
    'backlog': 'Backlog',
    'todo': 'TODO',
    'in-progress': 'In Progress',
    'blocked': 'Blocked',
    'in-review': 'In Review',
    'in-qa': 'QA',
    'completed': 'Completed',
    'rfp': 'Ready for Production',
    'closed': 'Closed'
  };
  return labels[status] || status;
}

function getStatusColor(status) {
  const colors = {
    'backlog': 0x6b7280,
    'todo': 0x3b82f6,
    'in-progress': 0xf59e0b,
    'blocked': 0xef4444,
    'in-review': 0xec4899,
    'in-qa': 0x8b5cf6,
    'completed': 0x10b981,
    'rfp': 0x06b6d4,
    'closed': 0x374151
  };
  return colors[status] || 0x6b7280;
}

function getPriorityLabel(priority) {
  const labels = { 5: '🔴 Critical', 4: '🟠 High', 3: '🟡 Medium', 2: '🟢 Low', 1: '⚪ Lowest' };
  return labels[priority] || 'Medium';
}

// ================== DATABASE INIT ==================

async function connectDB() {
  client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log(`Connected to MongoDB database: ${DB_NAME}`);
  
  // Create indexes
  await db.collection('tasks').createIndex({ boardId: 1 });
  await db.collection('tasks').createIndex({ status: 1 });
  await db.collection('tasks').createIndex({ assignee: 1 });
  await db.collection('tasks').createIndex({ priority: 1 });
  await db.collection('auth_users').createIndex({ email: 1 }, { unique: true });
  await db.collection('auth_users').createIndex({ apiToken: 1 }, { sparse: true });
  await db.collection('webhooks').createIndex({ userEmail: 1 }, { unique: true });
  
  // Seed default board if none exists
  const boardCount = await db.collection('boards').countDocuments();
  if (boardCount === 0) {
    await db.collection('boards').insertOne({
      name: 'Main Board',
      description: 'Primary task board',
      createdAt: new Date(),
      columns: ['backlog', 'todo', 'in-progress', 'blocked', 'in-review', 'in-qa', 'completed', 'rfp']
    });
    console.log('Created default board');
  }
  
  // Seed team members from agent registry (for task assignment)
  const userCount = await db.collection('users').countDocuments();
  if (userCount === 0) {
    const userDocs = [
      { name: 'Human', email: 'human@devteam.local', avatar: '\uD83D\uDC68\u200D\uD83D\uDCBB', isAgent: false, createdAt: new Date() }
    ];
    for (const [email, config] of Object.entries(AGENT_GATEWAYS)) {
      userDocs.push({
        name: config.name,
        email: email,
        avatar: config.role === 'po' ? '\uD83D\uDCCB' : config.role === 'dev' ? '\uD83D\uDD28' : config.role === 'cq' ? '\uD83D\uDD0D' : config.role === 'qa' ? '\uD83E\uDDEA' : '\uD83D\uDE80',
        isAgent: true,
        createdAt: new Date()
      });
    }
    await db.collection('users').insertMany(userDocs);
    console.log(`Created ${userDocs.length} team members`);
  }

  // Seed auth users with login credentials (humans + agents)
  const authUserCount = await db.collection('auth_users').countDocuments();
  if (authUserCount === 0) {
    const defaultPassword = await bcrypt.hash(process.env.PB_DEFAULT_PASSWORD || 'devteam2025', 10);
    const authDocs = [
      { email: 'human@devteam.local', name: 'Human', password: defaultPassword, isAgent: false, createdAt: new Date() }
    ];
    for (const [email, config] of Object.entries(AGENT_GATEWAYS)) {
      const apiToken = crypto.randomBytes(32).toString('hex');
      authDocs.push({
        email: email,
        name: config.name,
        password: defaultPassword,
        isAgent: true,
        apiToken: apiToken,
        createdAt: new Date()
      });
    }
    await db.collection('auth_users').insertMany(authDocs);
    console.log(`Created ${authDocs.length} auth users`);
    // Log agent tokens for debugging
    authDocs.filter(u => u.isAgent).forEach(u => {
      console.log(`  ${u.name}: ${u.apiToken}`);
    });
  }
  
  // Seed webhook configurations for agents (direct gateway notifications)
  for (const [email, config] of Object.entries(AGENT_GATEWAYS)) {
    const existing = await db.collection('webhooks').findOne({ userEmail: email });
    if (!existing) {
      // Each agent watches the columns relevant to their role
      const watchMap = {
        'po': ['rfp', 'backlog', 'blocked'],
        'dev': ['todo', 'in-progress', 'completed'],
        'cq': ['in-review'],
        'qa': ['in-qa'],
        'ops': ['rfp']
      };
      await db.collection('webhooks').insertOne({
        userEmail: email,
        userName: config.name,
        role: config.role,
        enabled: true,
        watchColumns: watchMap[config.role] || [],
        createdAt: new Date()
      });
      console.log(`Created webhook config for ${config.name}`);
    }
  }
  
  // Migration: Backfill ticket numbers for existing tasks
  const tasksWithoutTicketNumber = await db.collection('tasks').find({ 
    ticketNumber: { $exists: false } 
  }).toArray();
  
  if (tasksWithoutTicketNumber.length > 0) {
    console.log(`Backfilling ticket numbers for ${tasksWithoutTicketNumber.length} existing tasks...`);
    for (const task of tasksWithoutTicketNumber) {
      const counter = await db.collection('counters').findOneAndUpdate(
        { _id: 'ticketNumber' },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' }
      );
      const ticketNumber = `MNS-${counter.seq}`;
      await db.collection('tasks').updateOne(
        { _id: task._id },
        { $set: { ticketNumber } }
      );
    }
    console.log(`Backfilled ${tasksWithoutTicketNumber.length} ticket numbers`);
  }
}

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'taskboard-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: MONGODB_URI,
    dbName: DB_NAME,
    collectionName: 'sessions'
  }),
  cookie: { 
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    secure: process.env.NODE_ENV === 'production' ? 'auto' : false
  }
}));

// Make db and user available to routes
app.use((req, res, next) => {
  req.db = db;
  res.locals.user = req.session.user || null;
  next();
});

// Auth middleware - session OR API token
function requireAuth(req, res, next) {
  if (req.session.user) {
    return next();
  }
  return res.redirect('/login');
}

// API auth - supports session OR Bearer token
async function requireApiAuth(req, res, next) {
  // Check session first
  if (req.session.user) {
    req.apiUser = req.session.user;
    return next();
  }
  
  // Check Bearer token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const user = await db.collection('auth_users').findOne({ apiToken: token });
    if (user) {
      req.apiUser = { id: user._id, email: user.email, name: user.name };
      return next();
    }
  }
  
  return res.status(401).json({ error: 'Unauthorized. Use session cookie or Bearer token.' });
}

// ================== AUTH ROUTES ==================

// Login page
app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  res.render('login', { error: null });
});

// Login handler
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const user = await db.collection('auth_users').findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.render('login', { error: 'Invalid email or password' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.render('login', { error: 'Invalid email or password' });
    }
    
    // Set session
    req.session.user = {
      id: user._id,
      email: user.email,
      name: user.name
    };
    
    res.redirect('/');
  } catch (error) {
    console.error('Login error:', error);
    res.render('login', { error: 'An error occurred. Please try again.' });
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Change password page
app.get('/change-password', requireAuth, (req, res) => {
  res.render('change-password', { error: null, success: null });
});

// Change password handler
app.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  
  if (newPassword !== confirmPassword) {
    return res.render('change-password', { error: 'New passwords do not match', success: null });
  }
  
  if (newPassword.length < 6) {
    return res.render('change-password', { error: 'Password must be at least 6 characters', success: null });
  }
  
  try {
    const user = await db.collection('auth_users').findOne({ _id: new ObjectId(req.session.user.id) });
    
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.render('change-password', { error: 'Current password is incorrect', success: null });
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.collection('auth_users').updateOne(
      { _id: user._id },
      { $set: { password: hashedPassword, updatedAt: new Date() } }
    );
    
    res.render('change-password', { error: null, success: 'Password changed successfully!' });
  } catch (error) {
    console.error('Change password error:', error);
    res.render('change-password', { error: 'An error occurred. Please try again.', success: null });
  }
});

// ================== PROTECTED VIEWS ==================

// Main board view
app.get('/', requireAuth, async (req, res) => {
  try {
    const boards = await db.collection('boards').find().toArray();
    const defaultBoard = boards[0];
    res.redirect(`/board/${defaultBoard._id}`);
  } catch (error) {
    res.status(500).render('error', { error: error.message });
  }
});

// Board view with swimlanes
app.get('/board/:id', requireAuth, async (req, res) => {
  try {
    const board = await db.collection('boards').findOne({ _id: new ObjectId(req.params.id) });
    if (!board) return res.status(404).render('error', { error: 'Board not found' });
    
    const tasks = await db.collection('tasks').find({ boardId: board._id.toString() }).toArray();
    const users = await db.collection('users').find().toArray();
    
    res.render('board', { board, tasks, users, view: 'swimlane' });
  } catch (error) {
    res.status(500).render('error', { error: error.message });
  }
});

// Backlog view
app.get('/board/:id/backlog', requireAuth, async (req, res) => {
  try {
    const board = await db.collection('boards').findOne({ _id: new ObjectId(req.params.id) });
    if (!board) return res.status(404).render('error', { error: 'Board not found' });
    
    const tasks = await db.collection('tasks')
      .find({ 
        boardId: board._id.toString(),
        status: { $nin: ['completed', 'rfp', 'closed'] }
      })
      .sort({ priority: 1, backlogOrder: 1 })
      .toArray();
    const users = await db.collection('users').find().toArray();
    
    res.render('backlog', { board, tasks, users, view: 'backlog' });
  } catch (error) {
    res.status(500).render('error', { error: error.message });
  }
});

// Archive view - all tasks including closed, with filters
app.get('/board/:id/archive', requireAuth, async (req, res) => {
  try {
    const board = await db.collection('boards').findOne({ _id: new ObjectId(req.params.id) });
    if (!board) return res.status(404).render('error', { error: 'Board not found' });
    
    const tasks = await db.collection('tasks')
      .find({ boardId: board._id.toString() })
      .sort({ updatedAt: -1 })
      .toArray();
    const users = await db.collection('users').find().toArray();
    
    res.render('archive', { board, tasks, users, view: 'archive' });
  } catch (error) {
    res.status(500).render('error', { error: error.message });
  }
});

// ================== API ENDPOINTS ==================

// Health check (public)
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Get current user info
app.get('/api/me', requireApiAuth, async (req, res) => {
  const user = await db.collection('auth_users').findOne({ email: req.apiUser.email });
  res.json({
    email: user.email,
    name: user.name,
    isAgent: user.isAgent || false,
    hasApiToken: !!user.apiToken
  });
});

// Generate/regenerate API token
app.post('/api/me/token', requireApiAuth, async (req, res) => {
  const newToken = crypto.randomBytes(32).toString('hex');
  await db.collection('auth_users').updateOne(
    { email: req.apiUser.email },
    { $set: { apiToken: newToken, tokenUpdatedAt: new Date() } }
  );
  res.json({ apiToken: newToken });
});

// ================== WEBHOOK MANAGEMENT ==================

// Get my webhook config
app.get('/api/webhooks/me', requireApiAuth, async (req, res) => {
  const webhook = await db.collection('webhooks').findOne({ userEmail: req.apiUser.email });
  res.json(webhook || { userEmail: req.apiUser.email, enabled: false });
});

// Set/update webhook config
app.put('/api/webhooks/me', requireApiAuth, async (req, res) => {
  const config = {
    userEmail: req.apiUser.email,
    userName: req.apiUser.name,
    discordWebhook: req.body.discordWebhook || null,
    watchColumns: req.body.watchColumns || [],  // e.g., ['in-qa'] for Quinn
    enabled: req.body.enabled !== false,
    updatedAt: new Date()
  };
  
  await db.collection('webhooks').updateOne(
    { userEmail: req.apiUser.email },
    { $set: config },
    { upsert: true }
  );
  
  res.json(config);
});

// ================== TASK API ==================

// List all tasks (with optional filters)
app.get('/api/tasks', requireApiAuth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.assignee) filter.assignee = req.query.assignee;
    if (req.query.boardId) filter.boardId = req.query.boardId;
    
    const tasks = await db.collection('tasks')
      .find(filter)
      .sort({ updatedAt: -1 })
      .toArray();
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all tasks for a board
app.get('/api/boards/:boardId/tasks', requireApiAuth, async (req, res) => {
  try {
    const tasks = await db.collection('tasks')
      .find({ boardId: req.params.boardId })
      .toArray();
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single task with full details
app.get('/api/tasks/:id', requireApiAuth, async (req, res) => {
  try {
    const task = await db.collection('tasks').findOne({ _id: new ObjectId(req.params.id) });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get task by ticket number (e.g., MNS-22)
app.get('/api/tasks/by-ticket/:ticketNumber', requireApiAuth, async (req, res) => {
  try {
    const task = await db.collection('tasks').findOne({ 
      ticketNumber: req.params.ticketNumber.toUpperCase() 
    });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get next ticket number (auto-incrementing)
async function getNextTicketNumber() {
  const counter = await db.collection('counters').findOneAndUpdate(
    { _id: 'ticketNumber' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return `MNS-${counter.seq}`;
}

// Create task
app.post('/api/tasks', requireApiAuth, async (req, res) => {
  try {
    // Validate boardId is provided
    if (!req.body.boardId) {
      return res.status(400).json({ error: 'boardId is required' });
    }
    
    // Validate boardId exists
    const board = await db.collection('boards').findOne({ _id: new ObjectId(req.body.boardId) });
    if (!board) {
      return res.status(400).json({ error: 'Invalid boardId - board not found' });
    }
    
    // Generate ticket number
    const ticketNumber = await getNextTicketNumber();
    
    const task = {
      ...req.body,
      ticketNumber,
      status: req.body.status || 'backlog',
      priority: parseInt(req.body.priority) || 3,
      complexity: parseInt(req.body.complexity) || 3,
      assignee: req.body.assignee || null,
      comments: [],
      createdAt: new Date(),
      createdBy: req.apiUser.email,
      updatedAt: new Date(),
      history: [{
        action: 'created',
        timestamp: new Date(),
        user: req.apiUser.email,
        details: 'Task created'
      }]
    };
    
    const result = await db.collection('tasks').insertOne(task);
    task._id = result.insertedId;
    
    // Notify if assigned
    if (task.assignee) {
      await notifyTaskEvent('task_assigned', task, req.apiUser.email);
    }
    
    // Broadcast to WebSocket clients
    broadcastToBoard(task.boardId, {
      type: 'task_created',
      task: task,
      user: req.apiUser.email
    });
    
    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update task
app.put('/api/tasks/:id', requireApiAuth, async (req, res) => {
  try {
    const taskId = new ObjectId(req.params.id);
    const existingTask = await db.collection('tasks').findOne({ _id: taskId });
    
    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const historyEntries = [];
    const statusChanged = req.body.status && req.body.status !== existingTask.status;
    const assigneeChanged = req.body.assignee !== undefined && req.body.assignee !== existingTask.assignee;
    
    // Track status change
    if (statusChanged) {
      historyEntries.push({
        action: 'status_change',
        timestamp: new Date(),
        user: req.apiUser.email,
        details: `Status: ${existingTask.status} → ${req.body.status}`
      });
    }
    
    // Track assignee change
    if (assigneeChanged) {
      historyEntries.push({
        action: 'assignee_change',
        timestamp: new Date(),
        user: req.apiUser.email,
        details: `Assigned to: ${req.body.assignee || 'Unassigned'}`
      });
    }
    
    const update = {
      ...req.body,
      updatedAt: new Date(),
      updatedBy: req.apiUser.email
    };
    
    if (req.body.priority) update.priority = parseInt(req.body.priority);
    if (req.body.complexity) update.complexity = parseInt(req.body.complexity);
    
    const updateOp = { $set: update };
    if (historyEntries.length > 0) {
      updateOp.$push = { history: { $each: historyEntries } };
    }
    
    await db.collection('tasks').updateOne({ _id: taskId }, updateOp);
    
    const updatedTask = await db.collection('tasks').findOne({ _id: taskId });
    
    // Send notifications
    if (assigneeChanged && req.body.assignee) {
      await notifyTaskEvent('task_assigned', updatedTask, req.apiUser.email);
    }
    
    if (statusChanged) {
      await notifyTaskEvent('status_change', updatedTask, req.apiUser.email, {
        statusFrom: existingTask.status,
        statusTo: req.body.status
      });
    }
    
    if (!statusChanged && !assigneeChanged) {
      await notifyTaskEvent('task_updated', updatedTask, req.apiUser.email);
    }
    
    // Broadcast to WebSocket clients
    broadcastToBoard(updatedTask.boardId, {
      type: 'task_updated',
      task: updatedTask,
      user: req.apiUser.email,
      changes: {
        statusChanged,
        assigneeChanged,
        oldStatus: statusChanged ? existingTask.status : null,
        newStatus: statusChanged ? req.body.status : null
      }
    });
    
    res.json(updatedTask);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete task
app.delete('/api/tasks/:id', requireApiAuth, async (req, res) => {
  try {
    const taskId = new ObjectId(req.params.id);
    const task = await db.collection('tasks').findOne({ _id: taskId });
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    await db.collection('tasks').deleteOne({ _id: taskId });
    
    // Broadcast to WebSocket clients
    broadcastToBoard(task.boardId, {
      type: 'task_deleted',
      taskId: req.params.id,
      user: req.apiUser.email
    });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reorder tasks (for backlog drag-and-drop)
app.post('/api/tasks/reorder', requireApiAuth, async (req, res) => {
  try {
    const { order } = req.body;
    
    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'Invalid order data' });
    }
    
    // Update each task with its new backlog order AND priority (1 = highest, N = lowest)
    const bulkOps = order.map((item, index) => ({
      updateOne: {
        filter: { _id: new ObjectId(item.id) },
        update: { 
          $set: { 
            backlogOrder: item.order,
            priority: index + 1,  // Priority matches position: 1 = top, N = bottom
            updatedAt: new Date()
          }
        }
      }
    }));
    
    if (bulkOps.length > 0) {
      await db.collection('tasks').bulkWrite(bulkOps);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================== COMMENTS API ==================

// Get comments for a task
app.get('/api/tasks/:id/comments', requireApiAuth, async (req, res) => {
  try {
    const task = await db.collection('tasks').findOne({ _id: new ObjectId(req.params.id) });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task.comments || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add comment to task
app.post('/api/tasks/:id/comments', requireApiAuth, async (req, res) => {
  try {
    const taskId = new ObjectId(req.params.id);
    const task = await db.collection('tasks').findOne({ _id: taskId });
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const commentText = req.body.text || req.body.body || '';
    const comment = {
      id: new ObjectId().toString(),
      author: req.apiUser.email,
      authorName: req.apiUser.name,
      text: commentText,
      body: commentText,
      timestamp: new Date()
    };

    await db.collection('tasks').updateOne(
      { _id: taskId },
      {
        $push: {
          comments: comment,
          history: {
            action: 'comment_added',
            timestamp: new Date(),
            user: req.apiUser.email,
            details: `Comment: ${commentText.substring(0, 100)}${commentText.length > 100 ? '...' : ''}`
          }
        },
        $set: { updatedAt: new Date() }
      }
    );
    
    // Parse @mentions and notify
    const mentions = parseMentions(req.body.text);
    await notifyTaskEvent('comment_added', task, req.apiUser.email, {
      comment: req.body.text,
      mentions: mentions
    });
    
    // Broadcast to WebSocket clients
    broadcastToBoard(task.boardId, {
      type: 'comment_added',
      taskId: req.params.id,
      comment: comment,
      user: req.apiUser.email
    });
    
    res.status(201).json(comment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload attachment to task (S3)
app.post('/api/tasks/:id/attachments', requireApiAuth, upload.single('file'), async (req, res) => {
  try {
    const task = await db.collection('tasks').findOne({ _id: new ObjectId(req.params.id) });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(req.file.originalname);
    const filename = uniqueSuffix + ext;
    const s3Key = `${S3_FOLDER}/${filename}`;
    
    // Upload to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      ACL: 'public-read'
    }));
    
    const attachment = {
      id: crypto.randomUUID(),
      filename: filename,
      s3Key: s3Key,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      url: `${S3_CDN_URL}/${s3Key}`,
      uploadedBy: req.apiUser.email,
      uploadedAt: new Date()
    };
    
    await db.collection('tasks').updateOne(
      { _id: new ObjectId(req.params.id) },
      { 
        $push: { attachments: attachment },
        $set: { updatedAt: new Date() }
      }
    );
    
    res.status(201).json(attachment);
  } catch (error) {
    console.error('S3 upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete attachment from task (S3)
app.delete('/api/tasks/:id/attachments/:attachmentId', requireApiAuth, async (req, res) => {
  try {
    const task = await db.collection('tasks').findOne({ _id: new ObjectId(req.params.id) });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const attachment = task.attachments?.find(a => a.id === req.params.attachmentId);
    if (attachment && attachment.s3Key) {
      // Delete from S3
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: S3_BUCKET,
          Key: attachment.s3Key
        }));
      } catch (s3Error) {
        console.error('S3 delete error:', s3Error);
      }
    }
    
    await db.collection('tasks').updateOne(
      { _id: new ObjectId(req.params.id) },
      { 
        $pull: { attachments: { id: req.params.attachmentId } },
        $set: { updatedAt: new Date() }
      }
    );
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================== USERS API ==================

// Get all users
app.get('/api/users', requireApiAuth, async (req, res) => {
  try {
    const users = await db.collection('users').find().toArray();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================== BOARDS API ==================

// Get all boards
app.get('/api/boards', requireApiAuth, async (req, res) => {
  try {
    const boards = await db.collection('boards').find().toArray();
    res.json(boards);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================== /api/tickets ALIASES ==================
// Agent skills reference /api/tickets; the canonical routes use /api/tasks.
// These aliases resolve ticket-number IDs (e.g. MNS-22) to ObjectIds
// and support both PUT and PATCH for updates.

async function resolveTicketId(id) {
  // If it looks like a ticket number (contains a dash), look it up
  if (id.includes('-')) {
    const task = await db.collection('tasks').findOne({ ticketNumber: id.toUpperCase() });
    return task ? task._id.toString() : null;
  }
  return id; // assume ObjectId
}

// List / search tickets
app.get('/api/tickets', requireApiAuth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.assignee) {
      filter.assignee = req.query.assignee === 'none' ? null : req.query.assignee;
    }
    if (req.query.boardId) filter.boardId = req.query.boardId;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.priority) filter.priority = parseInt(req.query.priority);
    if (req.query.label) filter.labels = req.query.label;
    if (req.query.parent_id) filter.parentId = req.query.parent_id;

    // Date range filters
    if (req.query.created_after || req.query.created_before) {
      filter.createdAt = {};
      if (req.query.created_after) filter.createdAt.$gte = new Date(req.query.created_after);
      if (req.query.created_before) filter.createdAt.$lte = new Date(req.query.created_before);
    }
    if (req.query.updated_after || req.query.updated_before) {
      filter.updatedAt = {};
      if (req.query.updated_after) filter.updatedAt.$gte = new Date(req.query.updated_after);
      if (req.query.updated_before) filter.updatedAt.$lte = new Date(req.query.updated_before);
    }

    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { title: { $regex: req.query.search, $options: 'i' } },
        { description: { $regex: req.query.search, $options: 'i' } },
        { ticketNumber: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    const tasks = await db.collection('tasks')
      .find(filter)
      .sort({ updatedAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single ticket by ID or ticket number
app.get('/api/tickets/:id', requireApiAuth, async (req, res) => {
  try {
    const resolved = await resolveTicketId(req.params.id);
    if (!resolved) return res.status(404).json({ error: 'Ticket not found' });
    const task = await db.collection('tasks').findOne({ _id: new ObjectId(resolved) });
    if (!task) return res.status(404).json({ error: 'Ticket not found' });
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create ticket (inline — mirrors POST /api/tasks)
app.post('/api/tickets', requireApiAuth, async (req, res) => {
  try {
    // Auto-resolve boardId: if not provided, use the first board
    let boardId = req.body.boardId;
    if (!boardId) {
      const defaultBoard = await db.collection('boards').findOne();
      if (!defaultBoard) return res.status(400).json({ error: 'No board exists' });
      boardId = defaultBoard._id.toString();
    } else {
      const board = await db.collection('boards').findOne({ _id: new ObjectId(boardId) });
      if (!board) return res.status(400).json({ error: 'Invalid boardId - board not found' });
    }

    const ticketNumber = await getNextTicketNumber();

    // Accept both "name" and "title" for the ticket name
    const taskName = req.body.name || req.body.title || req.body.summary || 'Untitled';

    const task = {
      ...req.body,
      name: taskName,
      title: taskName,
      boardId,
      ticketNumber,
      status: req.body.status || 'backlog',
      priority: parseInt(req.body.priority) || 3,
      complexity: parseInt(req.body.complexity) || 3,
      assignee: req.body.assignee || null,
      comments: [],
      createdAt: new Date(),
      createdBy: req.apiUser.email,
      updatedAt: new Date(),
      history: [{
        action: 'created',
        timestamp: new Date(),
        user: req.apiUser.email,
        details: 'Task created'
      }]
    };

    const result = await db.collection('tasks').insertOne(task);
    task._id = result.insertedId;

    if (task.assignee) {
      await notifyTaskEvent('task_assigned', task, req.apiUser.email);
    }

    broadcastToBoard(task.boardId, {
      type: 'task_created', task, user: req.apiUser.email
    });

    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update ticket (PUT or PATCH)
async function handleTicketUpdate(req, res) {
  try {
    const resolved = await resolveTicketId(req.params.id);
    if (!resolved) return res.status(404).json({ error: 'Ticket not found' });
    req.params.id = resolved;
    req.url = `/api/tasks/${resolved}`;
    // Reuse the PUT /api/tasks/:id handler logic inline
    const taskId = new ObjectId(resolved);
    const existingTask = await db.collection('tasks').findOne({ _id: taskId });
    if (!existingTask) return res.status(404).json({ error: 'Ticket not found' });

    const historyEntries = [];
    const statusChanged = req.body.status && req.body.status !== existingTask.status;
    const assigneeChanged = req.body.assignee !== undefined && req.body.assignee !== existingTask.assignee;

    if (statusChanged) {
      historyEntries.push({
        action: 'status_change', timestamp: new Date(), user: req.apiUser.email,
        details: `Status: ${existingTask.status} → ${req.body.status}`
      });
    }
    if (assigneeChanged) {
      historyEntries.push({
        action: 'assignee_change', timestamp: new Date(), user: req.apiUser.email,
        details: `Assigned to: ${req.body.assignee || 'Unassigned'}`
      });
    }

    const update = { ...req.body, updatedAt: new Date(), updatedBy: req.apiUser.email };
    if (req.body.priority) update.priority = parseInt(req.body.priority);
    if (req.body.complexity) update.complexity = parseInt(req.body.complexity);

    const updateOp = { $set: update };
    if (historyEntries.length > 0) updateOp.$push = { history: { $each: historyEntries } };

    await db.collection('tasks').updateOne({ _id: taskId }, updateOp);
    const updatedTask = await db.collection('tasks').findOne({ _id: taskId });

    broadcastToBoard(updatedTask.boardId, {
      type: 'task_updated', task: updatedTask, user: req.apiUser.email,
      changes: { statusChanged, assigneeChanged, oldStatus: statusChanged ? existingTask.status : null, newStatus: statusChanged ? req.body.status : null }
    });

    res.json(updatedTask);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

app.put('/api/tickets/:id', requireApiAuth, handleTicketUpdate);
app.patch('/api/tickets/:id', requireApiAuth, handleTicketUpdate);

// Delete ticket
app.delete('/api/tickets/:id', requireApiAuth, async (req, res) => {
  try {
    const resolved = await resolveTicketId(req.params.id);
    if (!resolved) return res.status(404).json({ error: 'Ticket not found' });
    req.params.id = resolved;
    const taskId = new ObjectId(resolved);
    const task = await db.collection('tasks').findOne({ _id: taskId });
    if (!task) return res.status(404).json({ error: 'Ticket not found' });
    await db.collection('tasks').deleteOne({ _id: taskId });
    broadcastToBoard(task.boardId, { type: 'task_deleted', taskId: resolved });
    res.json({ message: 'Ticket deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ticket comments aliases
app.get('/api/tickets/:id/comments', requireApiAuth, async (req, res) => {
  try {
    const resolved = await resolveTicketId(req.params.id);
    if (!resolved) return res.status(404).json({ error: 'Ticket not found' });
    const taskId = new ObjectId(resolved);
    const task = await db.collection('tasks').findOne({ _id: taskId });
    if (!task) return res.status(404).json({ error: 'Ticket not found' });
    res.json(task.comments || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tickets/:id/comments', requireApiAuth, async (req, res) => {
  try {
    const resolved = await resolveTicketId(req.params.id);
    if (!resolved) return res.status(404).json({ error: 'Ticket not found' });
    const taskId = new ObjectId(resolved);
    const task = await db.collection('tasks').findOne({ _id: taskId });
    if (!task) return res.status(404).json({ error: 'Ticket not found' });

    const commentText = req.body.text || req.body.body || '';
    const comment = {
      id: new ObjectId().toString(),
      author: req.apiUser.email,
      authorName: req.apiUser.name,
      text: commentText,
      body: commentText,
      timestamp: new Date()
    };

    await db.collection('tasks').updateOne(
      { _id: taskId },
      {
        $push: {
          comments: comment,
          history: {
            action: 'comment_added',
            timestamp: new Date(),
            user: req.apiUser.email,
            details: `Comment: ${commentText.substring(0, 100)}${commentText.length > 100 ? '...' : ''}`
          }
        },
        $set: { updatedAt: new Date() }
      }
    );

    const mentions = parseMentions(commentText);
    await notifyTaskEvent('comment_added', task, req.apiUser.email, {
      comment: commentText, mentions
    });

    broadcastToBoard(task.boardId, {
      type: 'comment_added', taskId: resolved, comment, user: req.apiUser.email
    });

    res.status(201).json(comment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ticket history
app.get('/api/tickets/:id/history', requireApiAuth, async (req, res) => {
  try {
    const resolved = await resolveTicketId(req.params.id);
    if (!resolved) return res.status(404).json({ error: 'Ticket not found' });
    const task = await db.collection('tasks').findOne({ _id: new ObjectId(resolved) });
    if (!task) return res.status(404).json({ error: 'Ticket not found' });
    res.json(task.history || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update ticket status only
app.put('/api/tickets/:id/status', requireApiAuth, async (req, res) => {
  try {
    const resolved = await resolveTicketId(req.params.id);
    if (!resolved) return res.status(404).json({ error: 'Ticket not found' });
    const taskId = new ObjectId(resolved);
    const existingTask = await db.collection('tasks').findOne({ _id: taskId });
    if (!existingTask) return res.status(404).json({ error: 'Ticket not found' });

    const newStatus = req.body.status;
    if (!newStatus) return res.status(400).json({ error: 'status is required' });

    if (newStatus === existingTask.status) {
      return res.json(existingTask);
    }

    const historyEntry = {
      action: 'status_change',
      timestamp: new Date(),
      user: req.apiUser.email,
      details: `Status: ${existingTask.status} → ${newStatus}`
    };

    await db.collection('tasks').updateOne(
      { _id: taskId },
      {
        $set: { status: newStatus, updatedAt: new Date(), updatedBy: req.apiUser.email },
        $push: { history: historyEntry }
      }
    );

    const updatedTask = await db.collection('tasks').findOne({ _id: taskId });

    await notifyTaskEvent('status_change', updatedTask, req.apiUser.email, {
      statusFrom: existingTask.status, statusTo: newStatus
    });

    broadcastToBoard(updatedTask.boardId, {
      type: 'task_updated', task: updatedTask, user: req.apiUser.email,
      changes: { statusChanged: true, oldStatus: existingTask.status, newStatus }
    });

    res.json(updatedTask);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update ticket assignee only
app.put('/api/tickets/:id/assignee', requireApiAuth, async (req, res) => {
  try {
    const resolved = await resolveTicketId(req.params.id);
    if (!resolved) return res.status(404).json({ error: 'Ticket not found' });
    const taskId = new ObjectId(resolved);
    const existingTask = await db.collection('tasks').findOne({ _id: taskId });
    if (!existingTask) return res.status(404).json({ error: 'Ticket not found' });

    const newAssignee = req.body.assignee !== undefined ? req.body.assignee : req.body.email;
    if (newAssignee === undefined) return res.status(400).json({ error: 'assignee is required' });

    const historyEntry = {
      action: 'assignee_change',
      timestamp: new Date(),
      user: req.apiUser.email,
      details: `Assigned to: ${newAssignee || 'Unassigned'}`
    };

    await db.collection('tasks').updateOne(
      { _id: taskId },
      {
        $set: { assignee: newAssignee, updatedAt: new Date(), updatedBy: req.apiUser.email },
        $push: { history: historyEntry }
      }
    );

    const updatedTask = await db.collection('tasks').findOne({ _id: taskId });

    if (newAssignee) {
      await notifyTaskEvent('task_assigned', updatedTask, req.apiUser.email);
    }

    broadcastToBoard(updatedTask.boardId, {
      type: 'task_updated', task: updatedTask, user: req.apiUser.email,
      changes: { assigneeChanged: true }
    });

    res.json(updatedTask);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Board summary (tickets per status)
app.get('/api/board/summary', requireApiAuth, async (req, res) => {
  try {
    const pipeline = [
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ];
    const results = await db.collection('tasks').aggregate(pipeline).toArray();
    const summary = {};
    for (const r of results) summary[r._id] = r.count;
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Board workload (tickets per assignee)
app.get('/api/board/workload', requireApiAuth, async (req, res) => {
  try {
    const pipeline = [
      { $match: { status: { $nin: ['closed', 'done'] } } },
      { $group: { _id: '$assignee', count: { $sum: 1 } } },
    ];
    const results = await db.collection('tasks').aggregate(pipeline).toArray();
    const workload = {};
    for (const r of results) workload[r._id || 'unassigned'] = r.count;
    res.json(workload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`TaskBoard running on port ${PORT} (WebSocket enabled)`);
  });
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  if (client) await client.close();
  process.exit(0);
});
