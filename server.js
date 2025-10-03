const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Logger = require('./logger');

// Load configuration
const CONFIG_FILE = path.join(__dirname, 'config.json');
const TEMPLATE_FILE = path.join(__dirname, 'config.json.template');

// Default configuration structure
const DEFAULT_CONFIG = {
  port: 3000,
  admin: {
    password: 'change_this_password'
  },
  logging: {
    directory: 'logs',
    retentionDays: 30
  },
  openai: {
    apiKey: '',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-3.5-turbo',
    maxTokens: 500
  }
};

function mergeConfig(userConfig, defaultConfig) {
  const merged = JSON.parse(JSON.stringify(defaultConfig));

  for (const key in userConfig) {
    if (typeof userConfig[key] === 'object' && !Array.isArray(userConfig[key])) {
      merged[key] = mergeConfig(userConfig[key], merged[key] || {});
    } else {
      merged[key] = userConfig[key];
    }
  }

  return merged;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    // Copy template to create config
    if (fs.existsSync(TEMPLATE_FILE)) {
      fs.copyFileSync(TEMPLATE_FILE, CONFIG_FILE);
      console.log('\n📝 Created config.json from template');
      console.log('🔧 Please edit config.json and add your API configuration\n');
    } else {
      console.log('\n⚠️  Configuration file and template not found!');
      console.log('📝 Please create config.json in the project root\n');
    }
    process.exit(1);
  }

  const userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const config = mergeConfig(userConfig, DEFAULT_CONFIG);

  // Save back if any fields were added
  if (JSON.stringify(config) !== JSON.stringify(userConfig)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('✅ Config file updated with missing default values');
  }

  return config;
}

const config = loadConfig();

// Initialize logger
const logger = new Logger(config.logging.directory);
logger.info('Server starting...', { config: { port: config.port } });

// Schedule daily log cleanup
setInterval(() => {
  logger.cleanOldLogs(config.logging.retentionDays);
}, 24 * 60 * 60 * 1000);

const app = express();
const PORT = config.port || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// IP logging middleware
app.use((req, res, next) => {
  req.clientIp = req.headers['ali-real-client-ip'] ||
                 req.headers['x-forwarded-for']?.split(',')[0] ||
                 req.ip ||
                 req.connection.remoteAddress;
  next();
});

// Database file paths
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');

// Initialize database
function initDB() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
  }
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(CHATS_FILE)) {
    fs.writeFileSync(CHATS_FILE, JSON.stringify([], null, 2));
  }
}

// Database helpers
function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getUser(uuid) {
  const users = readJSON(USERS_FILE);
  return users.find(u => u.uuid === uuid);
}

function createUser(uuid, notes = '') {
  const users = readJSON(USERS_FILE);
  const user = {
    uuid: uuid,
    notes: notes,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    messageCount: 0,
    tokenUsage: 0
  };
  users.push(user);
  writeJSON(USERS_FILE, users);
  logger.info('User created', { uuid, notes });
  return user;
}

function updateUserNotes(uuid, notes) {
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.uuid === uuid);
  if (user) {
    user.notes = notes;
    writeJSON(USERS_FILE, users);
    logger.info('User notes updated', { uuid, notes });
  }
}

function deleteUser(uuid) {
  const users = readJSON(USERS_FILE);
  const filtered = users.filter(u => u.uuid !== uuid);
  writeJSON(USERS_FILE, filtered);

  // Delete user's chats
  const chats = readJSON(CHATS_FILE);
  const filteredChats = chats.filter(c => c.uuid !== uuid);
  writeJSON(CHATS_FILE, filteredChats);

  logger.info('User deleted', { uuid });
}

function updateUserActivity(uuid) {
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.uuid === uuid);
  if (user) {
    user.lastActiveAt = new Date().toISOString();
    user.messageCount += 1;
    writeJSON(USERS_FILE, users);
  }
}

function getUserChats(uuid) {
  const chats = readJSON(CHATS_FILE);
  return chats.filter(c => c.uuid === uuid).sort((a, b) =>
    new Date(a.timestamp) - new Date(b.timestamp)
  );
}

function addChat(uuid, role, content) {
  const chats = readJSON(CHATS_FILE);
  const chat = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    uuid: uuid,
    role: role,
    content: content,
    timestamp: new Date().toISOString()
  };
  chats.push(chat);
  writeJSON(CHATS_FILE, chats);
  return chat;
}

function deleteChat(chatId) {
  const chats = readJSON(CHATS_FILE);
  const filtered = chats.filter(c => c.id !== chatId);
  writeJSON(CHATS_FILE, filtered);
}

// Watch Routes - 极简返回
app.get('/user/:uuid', (req, res) => {
  const { uuid } = req.params;

  // 检查用户是否存在
  const user = getUser(uuid);
  if (!user) {
    logger.warn('Unauthorized access attempt', { uuid, ip: req.clientIp });
    return res.status(403).send('Access denied. Invalid user ID.');
  }

  logger.info('User accessed watch UI', { uuid, ip: req.clientIp });
  // 返回极简 HTML 页面
  res.sendFile(path.join(__dirname, 'public', 'watch.html'));
});

// API: 获取聊天历史
app.get('/api/chat/:uuid', (req, res) => {
  const { uuid } = req.params;
  const limit = parseInt(req.query.limit) || 50; // 默认只返回最近50条

  // 检查用户是否存在
  const user = getUser(uuid);
  if (!user) {
    logger.warn('Unauthorized chat access', { uuid, ip: req.clientIp });
    return res.status(403).json({ success: false, error: 'Access denied' });
  }

  const chats = getUserChats(uuid).slice(-limit);
  res.json({ success: true, chats });
});

// API: 发送消息
app.post('/api/chat/:uuid', async (req, res) => {
  const { uuid } = req.params;
  const { message } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }

  try {
    // 检查用户是否存在
    const user = getUser(uuid);
    if (!user) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // 保存用户消息
    addChat(uuid, 'user', message);
    updateUserActivity(uuid);

    // 获取对话历史（最近10条用于上下文）
    const history = getUserChats(uuid).slice(-10);
    const messages = history.map(h => ({
      role: h.role,
      content: h.content
    }));

    // 调用 OpenAI API
    const apiUrl = config.openai.apiUrl;
    const apiKey = config.openai.apiKey;

    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'API key not configured' });
    }

    const response = await axios.post(apiUrl, {
      model: config.openai.model,
      messages: messages,
      max_tokens: config.openai.maxTokens,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const aiReply = response.data.choices[0].message.content;

    // 保存 AI 回复
    addChat(uuid, 'assistant', aiReply);

    // 更新 token 使用统计
    const users = readJSON(USERS_FILE);
    const userIndex = users.findIndex(u => u.uuid === uuid);
    if (userIndex !== -1) {
      users[userIndex].tokenUsage += response.data.usage.total_tokens || 0;
      writeJSON(USERS_FILE, users);
    }

    logger.info('Chat message processed', {
      uuid,
      ip: req.clientIp,
      tokens: response.data.usage.total_tokens
    });

    res.json({
      success: true,
      reply: aiReply
    });

  } catch (error) {
    logger.error('AI API Error', {
      uuid,
      ip: req.clientIp,
      error: error.response?.data || error.message
    });
    res.status(500).json({
      success: false,
      error: error.response?.data?.error?.message || 'AI service error'
    });
  }
});

// Clear chat history
app.delete('/api/chat/:uuid/clear', (req, res) => {
  const { uuid } = req.params;

  const user = getUser(uuid);
  if (!user) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }

  const chats = readJSON(CHATS_FILE);
  const filtered = chats.filter(c => c.uuid !== uuid);
  writeJSON(CHATS_FILE, filtered);

  logger.info('User cleared chat history', { uuid, ip: req.clientIp });
  res.json({ success: true });
});

// Admin authentication middleware
function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const token = authHeader.substring(7);

  // Simple password check (token is just the password)
  if (token !== config.admin.password) {
    logger.warn('Failed admin login attempt', { ip: req.clientIp });
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  next();
}

// Admin login
app.post('/admin/api/login', (req, res) => {
  const { password } = req.body;

  if (password === config.admin.password) {
    logger.info('Admin logged in', { ip: req.clientIp });
    res.json({ success: true, token: password });
  } else {
    logger.warn('Failed admin login', { ip: req.clientIp });
    res.status(401).json({ success: false, error: 'Invalid password' });
  }
});

// Admin Routes
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin API: 获取所有用户
app.get('/admin/api/users', requireAdminAuth, (req, res) => {
  const users = readJSON(USERS_FILE);
  res.json({ success: true, users });
});

// Admin API: 创建新用户
app.post('/admin/api/user/create', requireAdminAuth, (req, res) => {
  const { notes } = req.body;
  const uuid = Date.now().toString(36) + Math.random().toString(36).substr(2);
  const user = createUser(uuid, notes || '');
  logger.info('Admin created user', { uuid, ip: req.clientIp });
  res.json({ success: true, user });
});

// Admin API: 删除用户
app.delete('/admin/api/user/:uuid', requireAdminAuth, (req, res) => {
  const { uuid } = req.params;
  deleteUser(uuid);
  logger.info('Admin deleted user', { uuid, ip: req.clientIp });
  res.json({ success: true });
});

// Admin API: 更新用户备注
app.put('/admin/api/user/:uuid/notes', requireAdminAuth, (req, res) => {
  const { uuid } = req.params;
  const { notes } = req.body;
  updateUserNotes(uuid, notes);
  logger.info('Admin updated user notes', { uuid, ip: req.clientIp });
  res.json({ success: true });
});

// Admin API: 获取用户对话
app.get('/admin/api/user/:uuid/chats', requireAdminAuth, (req, res) => {
  const { uuid } = req.params;
  const chats = getUserChats(uuid);
  res.json({ success: true, chats });
});

// Admin API: 删除对话
app.delete('/admin/api/chat/:id', requireAdminAuth, (req, res) => {
  const { id } = req.params;
  deleteChat(id);
  logger.info('Admin deleted chat', { chatId: id, ip: req.clientIp });
  res.json({ success: true });
});

// Admin API: 统计数据
app.get('/admin/api/stats', requireAdminAuth, (req, res) => {
  const users = readJSON(USERS_FILE);
  const chats = readJSON(CHATS_FILE);

  const stats = {
    totalUsers: users.length,
    totalMessages: chats.length,
    totalTokens: users.reduce((sum, u) => sum + (u.tokenUsage || 0), 0),
    activeUsersToday: users.filter(u => {
      const lastActive = new Date(u.lastActiveAt);
      const today = new Date();
      return lastActive.toDateString() === today.toDateString();
    }).length
  };

  res.json({ success: true, stats });
});

// Admin API: 获取日志
app.get('/admin/api/logs', requireAdminAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const logs = logger.getLogs(limit);
  res.json({ success: true, logs });
});

// Admin API: 获取日志文件列表
app.get('/admin/api/logs/files', requireAdminAuth, (req, res) => {
  const files = logger.getLogFiles();
  res.json({ success: true, files });
});

// Initialize and start
initDB();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
