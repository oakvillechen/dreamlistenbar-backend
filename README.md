# DreamListenBar Backend

## 运行说明

这是一个 Node.js + Playwright 后端服务。

### 首次设置（在 Shell 中运行）：

```bash
npm install
npx playwright install chromium
```

### 启动服务：

```bash
npm start
```

服务将在端口 3001 运行。

### API 端点：

- `GET /api/search?keyword=xxx` - 搜索小说
- `GET /api/category?id=1&page=1` - 获取分类
- `GET /api/book/:id` - 书籍详情
- `GET /api/audio?url=xxx` - 提取音频

---

Made with 💙 by DreamHomeGTA
