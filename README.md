# FirePortal-ChatAI

极简 AI Chat WebUI，专为 Apple Watch 等资源受限设备设计。

## 特性

### 前端
- **极简设计**：无框架，纯 ES5 JavaScript，兼容老旧浏览器
- **Watch 优化**：大字体、简洁UI，适配小屏幕
- **对话管理**：清空聊天记录、查看历史对话
- **离线兼容**：使用 XMLHttpRequest，避免现代API依赖

### 后端
- **JSON 数据库**：零配置，文件存储
- **UUID 认证**：URL 即权限，无需登录流程
- **日志系统**：自动轮转、压缩归档、可在管理后台查看
- **IP 记录**：支持 ESA `ali-real-client-ip` 头

### 管理后台
- **密码保护**：在 config.json 中配置密码
- **用户管理**：创建用户、添加备注、删除用户
- **对话监控**：查看用户聊天记录、删除消息
- **日志查看**：实时查看系统日志
- **统计数据**：用户数、消息数、Token 使用量

## 快速开始

1. **安装依赖**
```bash
npm install
```

2. **启动服务**
```bash
npm start
```

3. **配置**

首次启动会自动创建 `config.json`，编辑配置：

```json
{
  "port": 3000,
  "admin": {
    "password": "your_secure_password"
  },
  "logging": {
    "directory": "logs",
    "retentionDays": 30
  },
  "openai": {
    "apiKey": "your_api_key",
    "apiUrl": "https://api.openai.com/v1/chat/completions",
    "model": "gpt-3.5-turbo",
    "maxTokens": 500
  }
}
```

4. **访问**

- 管理后台: `http://localhost:3000/admin`
- Watch 端: `http://localhost:3000/user/{uuid}`

## 使用流程

1. 访问管理后台并登录
2. 创建新用户（自动生成 UUID）
3. 复制用户链接发送给用户
4. 用户通过链接直接访问聊天

## 技术栈

- **后端**: Node.js + Express
- **前端**: 纯 HTML + CSS + ES5 JavaScript
- **数据**: JSON 文件存储
- **日志**: 自研日志系统，支持轮转和压缩

## 文件结构

```
/server.js          - 主服务器
/logger.js          - 日志系统
/config.json        - 配置文件（自动生成）
/public
  /watch.html       - Watch 端界面
  /watch.css        - Watch 端样式
  /watch.js         - Watch 端逻辑（ES5）
  /admin.html       - 管理后台
/data               - 用户和对话数据
/logs               - 日志文件
```

## License

MIT
