# 🎧 DreamListenBar Backend

Express.js + Playwright 音频解析服务

## 🚀 部署到 Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/oakvillechen/dreamlistenbar-backend)

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
