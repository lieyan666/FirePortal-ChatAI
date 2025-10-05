const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Logger = require('./logger');

// Load configuration
const CONFIG_FILE = path.join(__dirname, 'config.json');
const TEMPLATE_FILE = path.join(__dirname, 'config.json.template');

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

  // Load default config from template if exists
  let defaultConfig = {};
  if (fs.existsSync(TEMPLATE_FILE)) {
    defaultConfig = JSON.parse(fs.readFileSync(TEMPLATE_FILE, 'utf8'));
  }

  const config = mergeConfig(userConfig, defaultConfig);

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
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');

// Initialize database
function initDB() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
  }
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(CONVERSATIONS_FILE)) {
    fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify([], null, 2));
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

// Model helpers
function getDefaultModel() {
  const defaultModel = config.models.find(m => m.default);
  return defaultModel || config.models[0];
}

function getModelById(modelId) {
  return config.models.find(m => m.id === modelId);
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
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

// Conversation management
function createConversation(uuid, title = 'New Chat') {
  const conversations = readJSON(CONVERSATIONS_FILE);
  const conversation = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    uuid: uuid,
    title: title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deleted: false
  };
  conversations.push(conversation);
  writeJSON(CONVERSATIONS_FILE, conversations);
  logger.info('Conversation created', { uuid, conversationId: conversation.id });
  return conversation;
}

function getUserConversations(uuid, includeDeleted = false) {
  const conversations = readJSON(CONVERSATIONS_FILE);
  return conversations
    .filter(c => c.uuid === uuid && (includeDeleted || !c.deleted))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function getConversation(conversationId) {
  const conversations = readJSON(CONVERSATIONS_FILE);
  return conversations.find(c => c.id === conversationId);
}

function updateConversation(conversationId, updates) {
  const conversations = readJSON(CONVERSATIONS_FILE);
  const conversation = conversations.find(c => c.id === conversationId);
  if (conversation) {
    Object.assign(conversation, updates);
    conversation.updatedAt = new Date().toISOString();
    writeJSON(CONVERSATIONS_FILE, conversations);
  }
}

function softDeleteConversation(conversationId) {
  const conversations = readJSON(CONVERSATIONS_FILE);
  const conversation = conversations.find(c => c.id === conversationId);
  if (conversation) {
    conversation.deleted = true;
    conversation.deletedAt = new Date().toISOString();
    writeJSON(CONVERSATIONS_FILE, conversations);
    logger.info('Conversation soft deleted', { conversationId });
  }
}

function restoreConversation(conversationId) {
  const conversations = readJSON(CONVERSATIONS_FILE);
  const conversation = conversations.find(c => c.id === conversationId);
  if (conversation) {
    conversation.deleted = false;
    delete conversation.deletedAt;
    writeJSON(CONVERSATIONS_FILE, conversations);
    logger.info('Conversation restored', { conversationId });
  }
}

function getUserChats(uuid) {
  const chats = readJSON(CHATS_FILE);
  return chats.filter(c => c.uuid === uuid).sort((a, b) =>
    new Date(a.timestamp) - new Date(b.timestamp)
  );
}

function getConversationChats(conversationId) {
  const chats = readJSON(CHATS_FILE);
  return chats.filter(c => c.conversationId === conversationId).sort((a, b) =>
    new Date(a.timestamp) - new Date(b.timestamp)
  );
}

function addChat(uuid, conversationId, role, content, modelId) {
  const chats = readJSON(CHATS_FILE);
  const chat = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    uuid: uuid,
    conversationId: conversationId,
    role: role,
    content: content,
    modelId: modelId || null,
    timestamp: new Date().toISOString()
  };
  chats.push(chat);
  writeJSON(CHATS_FILE, chats);

  // Update conversation's updatedAt
  updateConversation(conversationId, {});

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

// API: 获取用户的会话列表
app.get('/api/conversations/:uuid', (req, res) => {
  const { uuid } = req.params;

  const user = getUser(uuid);
  if (!user) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }

  const conversations = getUserConversations(uuid);
  res.json({ success: true, conversations });
});

// API: 创建新会话
app.post('/api/conversations/:uuid', (req, res) => {
  const { uuid } = req.params;
  const { title } = req.body;

  const user = getUser(uuid);
  if (!user) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }

  const conversation = createConversation(uuid, title || 'New Chat');
  res.json({ success: true, conversation });
});

// API: 更新会话标题
app.put('/api/conversations/:conversationId', (req, res) => {
  const { conversationId } = req.params;
  const { title } = req.body;

  const conversation = getConversation(conversationId);
  if (!conversation) {
    return res.status(404).json({ success: false, error: 'Conversation not found' });
  }

  updateConversation(conversationId, { title });
  res.json({ success: true });
});

// API: 软删除会话
app.delete('/api/conversations/:conversationId', (req, res) => {
  const { conversationId } = req.params;

  const conversation = getConversation(conversationId);
  if (!conversation) {
    return res.status(404).json({ success: false, error: 'Conversation not found' });
  }

  softDeleteConversation(conversationId);
  logger.info('User deleted conversation', { conversationId, ip: req.clientIp });
  res.json({ success: true });
});

// Admin API: 恢复已删除的会话
app.post('/admin/api/conversations/:conversationId/restore', requireAdminAuth, (req, res) => {
  const { conversationId } = req.params;

  const conversation = getConversation(conversationId);
  if (!conversation) {
    return res.status(404).json({ success: false, error: 'Conversation not found' });
  }

  restoreConversation(conversationId);
  logger.info('Admin restored conversation', { conversationId, ip: req.clientIp });
  res.json({ success: true });
});

// API: 获取会话的聊天历史
app.get('/api/conversations/:conversationId/chats', (req, res) => {
  const { conversationId } = req.params;

  const conversation = getConversation(conversationId);
  if (!conversation) {
    return res.status(404).json({ success: false, error: 'Conversation not found' });
  }

  const chats = getConversationChats(conversationId);
  res.json({ success: true, chats });
});

// API: 获取聊天历史 (兼容旧API)
app.get('/api/chat/:uuid', (req, res) => {
  const { uuid } = req.params;
  const limit = parseInt(req.query.limit) || 50;

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
  const { message, model, conversationId, systemPromptId } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }

  try {
    // 检查用户是否存在
    const user = getUser(uuid);
    if (!user) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // 获取或创建会话
    let conversation;
    if (conversationId) {
      conversation = getConversation(conversationId);
      if (!conversation || conversation.uuid !== uuid) {
        return res.status(403).json({ success: false, error: 'Invalid conversation' });
      }
      if (conversation.deleted) {
        return res.status(410).json({ success: false, error: 'Conversation deleted' });
      }
    } else {
      // 如果没有提供会话ID，创建新会话
      conversation = createConversation(uuid, 'New Chat');
    }

    // 获取模型
    const selectedModel = model ? getModelById(model) : getDefaultModel();
    if (!selectedModel) {
      return res.status(400).json({ success: false, error: 'Invalid model' });
    }

    // 保存用户消息（带 modelId）
    addChat(uuid, conversation.id, 'user', message, selectedModel.id);
    updateUserActivity(uuid);

    // 获取对话历史（最近10条用于上下文）
    const history = getConversationChats(conversation.id).slice(-10);
    const messages = history.map(h => ({
      role: h.role,
      content: h.content
    }));

    // 构建系统提示词（拼接默认 + 用户选择的预设）
    let systemPromptContent = '';

    // 1. 先添加默认的基础提示词（强制）
    const defaultPrompt = config.systemPrompts?.default || '';
    if (defaultPrompt) {
      systemPromptContent = defaultPrompt;
    }

    // 2. 如果用户选择了预设，追加在后面
    if (systemPromptId) {
      const presets = config.systemPrompts?.presets || [];
      const selectedPreset = presets.find(p => p.id === systemPromptId);
      if (selectedPreset && selectedPreset.content) {
        if (systemPromptContent) {
          systemPromptContent += '\n\n' + selectedPreset.content;
        } else {
          systemPromptContent = selectedPreset.content;
        }
      }
    }

    // 3. 如果有系统提示词，添加到消息列表最前面
    if (systemPromptContent) {
      messages.unshift({
        role: 'system',
        content: systemPromptContent
      });
    }

    // 调用 OpenAI API
    const apiUrl = config.openai.apiUrl;
    const apiKey = config.openai.apiKey;

    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'API key not configured' });
    }

    const response = await axios.post(apiUrl, {
      model: selectedModel.id,
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

    // 保存 AI 回复（带 modelId）
    addChat(uuid, conversation.id, 'assistant', aiReply, selectedModel.id);

    // 更新 token 使用统计
    const users = readJSON(USERS_FILE);
    const userIndex = users.findIndex(u => u.uuid === uuid);
    if (userIndex !== -1) {
      users[userIndex].tokenUsage += response.data.usage.total_tokens || 0;
      writeJSON(USERS_FILE, users);
    }

    logger.info('Chat message processed', {
      uuid,
      conversationId: conversation.id,
      ip: req.clientIp,
      tokens: response.data.usage.total_tokens
    });

    res.json({
      success: true,
      reply: aiReply,
      conversationId: conversation.id
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

// Get available models
app.get('/api/models', (req, res) => {
  const models = config.models.map(m => ({
    id: m.id,
    name: m.name,
    default: m.default || false
  }));
  res.json({ success: true, models });
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

// Admin API: 获取用户的会话列表
app.get('/admin/api/user/:uuid/conversations', requireAdminAuth, (req, res) => {
  const { uuid } = req.params;
  const conversations = getUserConversations(uuid, true); // 包含已删除的

  // 为每个会话添加消息数量
  const conversationsWithCount = conversations.map(conv => {
    const chats = getConversationChats(conv.id);
    return {
      ...conv,
      messageCount: chats.length
    };
  });

  res.json({ success: true, conversations: conversationsWithCount });
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

// Admin API: 获取模型列表
app.get('/admin/api/models', requireAdminAuth, (req, res) => {
  res.json({ success: true, models: config.models });
});

// Admin API: 更新模型列表
app.put('/admin/api/models', requireAdminAuth, (req, res) => {
  const { models } = req.body;

  if (!Array.isArray(models) || models.length === 0) {
    return res.status(400).json({ success: false, error: 'Invalid models array' });
  }

  // 验证模型格式
  for (const model of models) {
    if (!model.id || !model.name) {
      return res.status(400).json({ success: false, error: 'Each model must have id and name' });
    }
  }

  // 确保至少有一个默认模型
  const hasDefault = models.some(m => m.default);
  if (!hasDefault && models.length > 0) {
    models[0].default = true;
  }

  config.models = models;
  saveConfig();

  logger.info('Admin updated models', { ip: req.clientIp, count: models.length });
  res.json({ success: true, models: config.models });
});

// Admin API: 获取系统提示词
app.get('/admin/api/system-prompts', requireAdminAuth, (req, res) => {
  res.json({
    success: true,
    systemPrompts: config.systemPrompts || { default: '', presets: [] }
  });
});

// Admin API: 更新系统提示词
app.put('/admin/api/system-prompts', requireAdminAuth, (req, res) => {
  const { systemPrompts } = req.body;

  if (!systemPrompts || typeof systemPrompts !== 'object') {
    return res.status(400).json({ success: false, error: 'Invalid systemPrompts object' });
  }

  config.systemPrompts = systemPrompts;
  saveConfig();

  logger.info('Admin updated system prompts', { ip: req.clientIp });
  res.json({ success: true, systemPrompts: config.systemPrompts });
});

// API: 获取系统提示词预设（供前端使用）
app.get('/api/system-prompts', (req, res) => {
  const presets = config.systemPrompts?.presets || [];
  res.json({
    success: true,
    presets: presets.map(p => ({ id: p.id, name: p.name }))  // 只返回 ID 和名称，不返回内容
  });
});

// Initialize and start
initDB();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
