#!/bin/bash

# DreamListenBar 停止脚本

echo "🛑 停止 DreamListenBar 后台..."

pkill -f "node server.js" 2>/dev/null
pkill -f "ngrok http 3001" 2>/dev/null

echo "✅ 已停止"
