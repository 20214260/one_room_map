# 오픈소스·외부 서비스 라이선스 출처

순룸 코드는 [MIT](../LICENSE). 아래 구성 요소는 각자의 라이선스·약관을 따름. 버전은 2026-09-27 설치 기준 (`pnpm-lock.yaml`, `backend/requirements.txt`).

## 프론트엔드 (npm)

| 패키지 | 버전 | 라이선스 |
| --- | --- | --- |
| next | 16.3.4 | MIT |
| react, react-dom | 19.2.6 | MIT |
| vinext (Next API on Vite) | 1.0.0-beta.5 | MIT |
| vite | 8.0.13 | MIT |
| tailwindcss | 4.2.1 | MIT |
| radix-ui, @base-ui/react, @shadcn/react, cmdk, vaul, sonner | — | MIT |
| react-hook-form, @hookform/resolvers, zod | — | MIT |
| date-fns, react-day-picker, recharts, embla-carousel-react, input-otp | — | MIT |
| clsx, tailwind-merge, next-themes, react-resizable-panels | — | MIT |
| class-variance-authority | 0.7.1 | Apache-2.0 |
| drizzle-orm | 0.45.2 | Apache-2.0 |
| lucide-react | 1.31.0 | ISC |
| typescript (개발) | 5.9.3 | Apache-2.0 |

## 백엔드 (pip)

| 패키지 | 버전 | 라이선스 |
| --- | --- | --- |
| fastapi | 0.141.1 | MIT |
| pydantic | 2.13.5 | MIT |
| SQLAlchemy | 2.1.1 | MIT |
| uvicorn | 0.54.0 | BSD-3-Clause |
| httpx | 0.28.1 | BSD-3-Clause |
| python-dotenv | 1.2.3 | BSD-3-Clause |
| python-multipart | 0.0.32 | Apache-2.0 |
| pillow | 12.3.0 | MIT-CMU (HPND) |
| psycopg (PostgreSQL 드라이버) | 3.3.6 | **LGPL-3.0** — 수정 없이 라이브러리로 설치해 사용. 소스는 PyPI·공식 저장소에서 제공되며 순룸 코드의 MIT 라이선스에 영향 없음 |
| supervisor (배포 서버 운영) | 4.x | BSD 계열 (Repoze Public License) |

## 저장소에 포함된 외부 파일

| 파일 | 출처 | 라이선스 |
| --- | --- | --- |
| `vendor/shadcn-tailwind-4.13.0.css` | shadcn/ui | MIT (`vendor/shadcn-tailwind-4.13.0.LICENSE.md`) |
| `build/sites-vite-plugin.ts` | OpenAI | MIT (`build/sites-vite-plugin.LICENSE`) |
| `public/images/room-*.jpg` | Pexels / Unsplash | 각 사진 라이선스 ([DATA_SOURCES](DATA_SOURCES.md)) |

## 외부 API (약관 적용)

| 서비스 | 용도 | 약관 |
| --- | --- | --- |
| Google Gemini API | AI 비교 추천, 매물 설명 초안 | https://ai.google.dev/gemini-api/terms |
| Kakao Maps JavaScript API | 지도·위치 선택 | https://developers.kakao.com/terms |
| Kakao 로그인, Google OAuth | 소셜 로그인 | 각 개발자 콘솔 약관 |
| Supabase (PostgreSQL, Storage) | DB, 사진 저장 | https://supabase.com/terms |

API 키는 서버 `.env`(Gemini·OAuth·DB) 또는 공개용 키(카카오 JavaScript 키)만 사용하고 저장소에 커밋하지 않음.
