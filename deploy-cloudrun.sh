#!/bin/bash
# deploy-cloudrun.sh - 部署 DreamListenBar 后端到 Google Cloud Run

set -e

# 配置变量
PROJECT_ID="your-project-id"  # 替换为你的 GCP 项目 ID
SERVICE_NAME="dreamlistenbar-backend"
REGION="us-central1"  # 或其他区域

echo "🚀 部署 DreamListenBar 后端到 Cloud Run..."
echo ""
echo "项目ID: $PROJECT_ID"
echo "服务名: $SERVICE_NAME"
echo "区域: $REGION"
echo ""

# 设置项目
gcloud config set project $PROJECT_ID

# 构建并部署
gcloud run deploy $SERVICE_NAME \
  --source . \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --port 3001 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 60 \
  --min-instances 0 \
  --max-instances 3

echo ""
echo "✅ 部署完成！"
echo ""
echo "获取服务 URL："
gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --format 'value(status.url)'
