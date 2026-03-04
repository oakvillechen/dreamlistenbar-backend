# 🎧 DreamListenBar Backend

Express.js + Playwright 音频解析服务

## 🚀 部署到 Replit

[![Run on Replit](https://replit.com/badge/github/oakvillechen/dreamlistenbar-backend)](https://replit.com/new/github/oakvillechen/dreamlistenbar-backend)

### 部署步骤：
1. 点击上方按钮
2. 登录/注册 Replit 账号
3. 等待安装完成（首次需要安装 Playwright）
4. 点击 **"Run"** 启动服务
5. 复制 Replit 提供的 URL（类似 `https://dreamlistenbar-backend.你的用户名.repl.co`）

## 📋 API 端点

| 端点 | 说明 |
|------|------|
| `GET /api/search?keyword=xxx` | 搜索小说 |
| `GET /api/category?id=1&page=1` | 获取分类列表 |
| `GET /api/book/:id` | 获取书籍详情 |
| `GET /api/audio?url=xxx` | 提取音频URL |

## 🔧 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| PORT | 服务端口 | 3001 |

## 🐳 本地 Docker 运行

```bash
docker build -t dreamlistenbar-backend .
docker run -p 3001:3001 dreamlistenbar-backend
```

## 📦 本地开发

```bash
npm install
npx playwright install chromium
npm start
```

---

Made with 💙 by DreamHomeGTA
