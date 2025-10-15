module.exports = {
  apps: [
    {
      name: "next-app", // pm2-deploy.sh와 일치
      script: "npm",    // package.json의 "start" 스크립트 실행
      args: "start -- -p 3000", // "npm run start -- -p 3000"과 동일, 포트 3000 사용
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production", // 프로덕션 환경 명시
        GOOGLE_APPLICATION_CREDENTIALS: "./gen-lang-client-0739712840-4166e4a8d851.json",
        PATREON_CLIENT_ID: "UA-iGwnODZM7NzbGch-hGMmVBScnWlS2-iE7EwieX_tGSel6l4FQjZOFdwwgxY1M",
        PATREON_CLIENT_SECRET: "BIj1SdXHx9xvK71KDKCsnJJRyw3JStxg3nN9lfcz8Kkl3jT2qp6BL-H1SpA2UKuI",
        PATREON_REDIRECT_URI: "https://4vz0172ivqlpyw-3000.proxy.runpod.net/api/patreon/callback",
        // 필요한 다른 환경 변수들을 여기에 추가할 수 있습니다.
        // 예: DB_HOST: "localhost", API_KEY: "your_api_key"
      },
      log_date_format: "YYYY-MM-DD HH:mm Z", // 로그 시간 형식
    },
  ],
};