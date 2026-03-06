#!/bin/bash

# DreamListenBar 后台启动脚本
# 启动本地后端用于开发测试

set -e

cd "$(dirname "$0")"

echo "🚀 启动 DreamListenBar 后台..."

# 杀掉旧进程
pkill -f "node server.js" 2>/dev/null || true
sleep 1

# 启动 Node 后端
echo "📡 启动 Node 后端 (端口 3001)..."
nohup node server.js > server.log 2>&1 &
sleep 2

# 检查后端是否启动
if curl -s http://localhost:3001/api/category?id=latest > /dev/null 2>&1; then
    echo "✅ Node 后端启动成功"
    echo ""
    echo "📍 本地地址: http://localhost:3001"
    echo "📍 API 测试: http://localhost:3001/api/category?id=latest"
    echo "📍 音频解密: http://localhost:3001/api/yuetingba/audio/{tingId}"
else
    echo "⚠️ Node 后端启动中..."
fi

echo ""
echo "🎉 DreamListenBar 后台已启动！"
echo "   日志文件: server.log"
echo ""
echo "💡 提示：前端会自动回退到 Render 后端"
echo "   停止命令: ./stop.sh"
