#!/bin/bash

# DreamListenBar 后台启动脚本
# 自动启动后端 + ngrok + 更新 Vercel 环境变量

set -e

cd "$(dirname "$0")"

echo "🚀 启动 DreamListenBar 后台..."

# 代理配置（可选）
# 如果你有代理服务，取消下面的注释并设置代理地址
# export PROXY_SERVER="http://127.0.0.1:7890"
# export PROXY_SERVER="socks5://127.0.0.1:1080"

# 检查代理配置
if [ -n "$PROXY_SERVER" ]; then
    echo "🌐 使用代理: $PROXY_SERVER"
fi

# 杀掉旧进程
pkill -f "node server.js" 2>/dev/null || true
pkill -f "ngrok http 3001" 2>/dev/null || true
sleep 2

# 启动 Node 后端
echo "📡 启动 Node 后端 (端口 3001)..."
nohup node server.js > server.log 2>&1 &
sleep 2

# 检查后端是否启动
if curl -s http://localhost:3001/api/category?id=latest > /dev/null 2>&1; then
    echo "✅ Node 后端启动成功"
else
    echo "⚠️ Node 后端启动中... (可能是悦听吧封锁)"
fi

# 启动 ngrok
echo "🌐 启动 ngrok..."
nohup ngrok http 3001 > ngrok.log 2>&1 &
sleep 4

# 获取 ngrok URL
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url')

if [ -n "$NGROK_URL" ] && [ "$NGROK_URL" != "null" ]; then
    echo "✅ ngrok 启动成功"
    echo ""
    echo "📍 后端地址: $NGROK_URL"
    echo "📍 API 测试: $NGROK_URL/api/category?id=latest"
    echo ""
    
    # 自动更新 Vercel 环境变量
    echo "🔄 更新 Vercel 环境变量..."
    
    # 检查是否在 web-app 目录存在
    WEB_APP_DIR="$(dirname "$0")/../web-app"
    if [ -d "$WEB_APP_DIR" ]; then
        cd "$WEB_APP_DIR"
        
        # 更新 Vercel 环境变量
        echo "$NGROK_URL" | vercel env add NEXT_PUBLIC_BACKEND_URL production --force 2>/dev/null || true
        
        # 触发重新部署
        echo "📤 触发 Vercel 重新部署..."
        vercel --prod --yes > /dev/null 2>&1 &
        
        echo "✅ Vercel 环境变量已更新，正在重新部署..."
        cd - > /dev/null
    else
        echo "⚠️ web-app 目录不存在，跳过 Vercel 更新"
        echo "💡 手动更新命令: vercel env add NEXT_PUBLIC_BACKEND_URL production --force"
        echo "   然后输入: $NGROK_URL"
    fi
else
    echo "❌ ngrok 启动失败"
    echo "💡 请检查 ngrok 是否已安装并登录: ngrok config add-authtoken YOUR_TOKEN"
    exit 1
fi

echo ""
echo "🎉 DreamListenBar 后台已启动！"
echo "   日志文件: server.log, ngrok.log"
echo ""
echo "💡 提示：按 Ctrl+C 停止不会杀死后台进程"
echo "   停止命令: ./stop.sh"

# 保持脚本运行（可选）
# wait
