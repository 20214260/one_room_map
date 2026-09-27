import type { NextConfig } from "next";

// 대회 서버 배포: SUNROOM_STATIC_EXPORT=1 로 빌드하면 정적 파일(out/)로 내보내고 FastAPI 가 같은 포트에서 서비스함.
// 평소 개발·팀 빌드(pnpm dev / pnpm build)에는 영향 없음.
const nextConfig: NextConfig = {
  ...(process.env.SUNROOM_STATIC_EXPORT === "1" ? { output: "export" } : {}),
};

export default nextConfig;
