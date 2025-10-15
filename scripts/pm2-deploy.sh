#!/bin/bash

APP_NAME="next-app"
PORT=3000

# 1. 의존성 설치
echo "📦 Installing dependencies..."
npm install

# 2. Next.js 빌드
echo "🔧 Building the Next.js app..."
npm run build

# 3. PM2 상태 확인 후 실행/재시작 분기
echo "🔍 Checking PM2 process..."
if pm2 list | grep -q "$APP_NAME"; then
  echo "♻️ Restarting $APP_NAME..."
  pm2 restart "$APP_NAME --env GOOGLE_APPLICATION_CREDENTIALS=\"./gen-lang-client-0739712840-4166e4a8d851.json\""
else
  echo "🚀 Starting $APP_NAME on port $PORT..."
  pm2 start npm --name "$APP_NAME" -- start -- -p "$PORT --env GOOGLE_APPLICATION_CREDENTIALS=\"./gen-lang-client-0739712840-4166e4a8d851.json\""
fi

# 4. 상태 출력
pm2 status "$APP_NAME"
