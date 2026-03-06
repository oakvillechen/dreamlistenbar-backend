#!/bin/bash

# DreamListenBar 后台启动脚本

cd "$(dirname "$0")"

echo "🚀 启动 DreamListenBar 后台..."

# 杀掉旧进程
pkill -f "node server.js" 2>/dev/null
pkill -f "ngrok http 3001" 2>/dev/null
sleep 1

# 启动 Node 后端
echo "📡 启动 Node 后端 (端口 3001)..."
nohup node server.js > server.log 2>&1 &
sleep 2

# 检查后端是否启动
if curl -s http://localhost:3001/api/category?id=latest > /dev/null 2>&1; then
    echo "✅ Node 后端启动成功"
else
    echo "❌ Node 后端启动失败，请检查 server.log"
    exit 1
fi

# 启动 ngrok
echo "🌐 启动 ngrok..."
nohup ngrok http 3001 > ngrok.log 2>&1 &
sleep 3

# 获取 ngrok URL
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url')

if [ -n "$NGROK_URL" ] && [ "$NGROK_URL" != "null" ]; then
    echo "✅ ngrok 启动成功"
    echo ""
    echo "📍 后端地址: $NGROK_URL"
    echo "📍 API 测试: $NGROK_URL/api/category?id=latest"
    echo ""
    echo "💡 提示：如果 Vercel 前端无法访问，请更新环境变量："
    echo "   vercel env add NEXT_PUBLIC_BACKEND_URL production --force"
    echo "   然后输入: $NGROK_URL"
else
    echo "❌ ngrok 启动失败"
    exit 1
fi

echo ""
echo "🎉 DreamListenBar 后台已启动！按 Ctrl+C 停止"
echo "   日志文件: server.log, ngrok.log"

# 保持脚本运行
wait
