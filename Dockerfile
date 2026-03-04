FROM node:20-bookworm-slim

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 lock（如果有）
COPY package*.json ./

# 安装由于网络限制可能偶尔慢的 Node 依赖库
RUN npm install

# 安装 Playwright 的 Chromium 浏览器内核，以及它在 Linux 上运行所需要的各种系统依赖库
RUN npx playwright install --with-deps chromium

# 复制项目的剩余所有代码
COPY . .

# 暴露出端口
EXPOSE 3001

# 启动服务器
CMD ["node", "server.js"]
