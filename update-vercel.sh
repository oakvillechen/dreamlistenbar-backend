#!/bin/bash

# 更新 Vercel 环境变量脚本
# 从 ngrok 获取当前 URL 并更新到 Vercel

echo "🔄 获取 ngrok URL..."

NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url')

if [ -z "$NGROK_URL" ] || [ "$NGROK_URL" = "null" ]; then
    echo "❌ ngrok 未运行或无法获取 URL"
    echo "💡 请先运行: ./start.sh"
    exit 1
fi

echo "📍 当前 ngrok URL: $NGROK_URL"

# 更新 Vercel 环境变量
WEB_APP_DIR="$(dirname "$0")/../web-app"

if [ -d "$WEB_APP_DIR" ]; then
    cd "$WEB_APP_DIR"
    
    echo "🔄 更新 Vercel 环境变量..."
    echo "$NGROK_URL" | vercel env add NEXT_PUBLIC_BACKEND_URL production --force 2>/dev/null || true
    
    echo "📤 触发重新部署..."
    vercel --prod --yes
    
    echo ""
    echo "✅ 完成！"
    echo "   后端: $NGROK_URL"
    echo "   前端: https://dreamlistenbar.vercel.app"
else
    echo "❌ web-app 目录不存在"
    exit 1
fi
