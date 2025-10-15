import withPWAInit from "next-pwa";

const isDev = process.env.NODE_ENV === 'development';

const withPWA = withPWAInit({
  dest: "public", // 서비스 워커 파일 출력 경로
  register: true, // 서비스 워커 자동 등록
  skipWaiting: true, // 새 서비스 워커 즉시 활성화
  disable: isDev, // 개발 환경에서 PWA 비활성화
  buildExcludes: [/app-build-manifest\.json$/], // app-build-manifest.json 무시
} as any);

const nextConfig = {
 /* config options here */
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        {
          key: "Access-Control-Allow-Origin",
          value: "*",
        },
      ],
    },
  ],
};

export default withPWA(nextConfig);
