## 🇰🇷 개요 (Korean)

Next.js 15(App Router) + React 19 기반의 AI 캐릭터 대화/창작 플랫폼입니다. Firebase(인증/Firestore/Storage/Analytics)와 Supabase(pgvector)를 결합해 장기 기억 RAG, 요약(SUPA/HYPA 롤업), 그룹 채팅, 캐릭터/로어 관리, 포인트·멤버십·결제(Stripe/Patreon) 기능을 제공합니다. PWA와 Vercel Cron도 지원합니다.

주요 폴더와 코드(일부):
- `src/app` — 라우트(App Router), `api/*` 서버 라우트, `chat`, `ranking`, `lorebook`, `settings`, `admin` 등 화면
- `src/utils/vector/*` — 임베딩/하이브리드 검색/RAG/요약 저장소(Supabase)
- `src/utils/memory/*` — 요약 정책/프롬프트/요약기(SUPA/HYPA)
- `src/firebase/*` — Firebase 클라이언트/어드민 초기화, 컬렉션 유틸
- `supabase/schema/*.sql` — pgvector/tsvector 기반 스키마와 RPC(SQL Editor에서 실행)
- `docs/*.md` — 그룹 채팅/출석 등 기능 설계 문서

### 핵심 기능
- AI 대화
  - 단일/그룹 채팅, 캐릭터별 프로필/이미지 매칭, 최근 대화 요약 삽입
  - LLM: Google AI Studio(Gemini/Vertex), OpenRouter(Anthropic/OpenAI)
  - 장기 기억(RAG): Supabase pgvector + tsvector 하이브리드 검색, 요약 우선(summary-first) 검색
- 컨텐츠/자산
  - 캐릭터·로어북 CRUD, 이미지 생성(`/api/generate-image`) 및 요약(`/api/summarize`)
- 경제/랭킹
  - 포인트 잔액/거래, Stripe 결제/웹훅, Patreon 연동
  - 일/주/월 랭킹 집계(cron) + 조회(`/api/rankings`)
- 관리/보안
  - 관리자 권한 관리(`src/app/admin/users/page.tsx`), 삭제/정리용 cron
  - Firestore 규칙/인덱스(`firestore.rules`, `firestore.indexes.json`)
- 배포/운영
  - Vercel Cron(`vercel.json`), PWA(`next-pwa`, `public/manifest.json`, `public/sw.js`)

### 기술 스택
- Web: Next.js 15, React 19, TypeScript, Mantine + MUI
- Backend(App Router API): Firebase Admin, Supabase(Postgres + pgvector + pg_trgm + tsvector)
- AI: Google Generative AI/Vertex, OpenRouter, OpenAI(임베딩 포함)
- Payments: Stripe(Checkout/Webhook), Patreon OAuth
- Infra: Vercel, PWA, Vercel Cron

---

## 빠른 시작

사전 요구사항
- Node.js 20+ 권장, pnpm 9+ (repo에 `pnpm-lock.yaml` 존재)
- Firebase 프로젝트, Supabase 프로젝트, Stripe 계정, (선택) Patreon 클라이언트

1) 의존성 설치
```bash
pnpm install
```

2) 환경 변수 준비
- `.env.example`를 참고해 `.env` 또는 `.env.local`을 채웁니다.
- 꼭 필요한 값(요약):
  - Firebase Web: `NEXT_PUBLIC_FIREBASE_*`
  - Firebase Admin: `FIREBASE_ADMIN_SDK_CONFIG`(JSON), 또는 서비스 계정 파일 지정(`GOOGLE_APPLICATION_CREDENTIALS`)
  - Supabase(Server-only): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, (옵션) `SUPABASE_ANON_KEY`
  - AI 키: `GOOGLE_AI_STUDIO_API_KEY` 또는 `GOOGLE_AI_STUDIO_API_KEYS`, (옵션) `OPENROUTER_API_KEY`, `OPENAI_API_KEY`
  - 결제: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  - Cron 보안: `CRON_SECRET`(랭킹 집계), `CRON_SECRET_TOKEN`(정리 작업)
  - RAG/메모리: 아래 RAG/Memory 섹션 참조

보안 주의: `SUPABASE_SERVICE_ROLE_KEY`는 절대 클라이언트에 노출되면 안 됩니다. 서버 전용입니다.

3) Supabase 스키마 적용
- Supabase Dashboard → SQL Editor에서 아래 순서대로 실행:
  - `supabase/schema/001_chat_message_embeddings.sql`
  - `supabase/schema/002_match_chat_messages.sql`
  - `supabase/schema/004_enable_trgm_and_lexical.sql`
  - `supabase/schema/005_match_chat_messages_hybrid.sql`
  - `supabase/schema/006_parent_child_windowing.sql`
  - `supabase/schema/007_memory_summaries.sql`
  - `supabase/schema/008_memory_summaries_param_fix.sql`
  - `supabase/schema/009_memory_roomid_to_text.sql`
  - `supabase/schema/010_memory_summaries_rpc_roomid_text.sql`

4) 개발 서버 실행
```bash
pnpm dev
```
브라우저에서 http://localhost:3000 접속

---

## 환경 변수(요약)

Firebase
- `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`, (옵션) `NEXT_PUBLIC_FIREBASE_VAPID_KEY`
- Admin: `FIREBASE_ADMIN_SDK_CONFIG`(문자열 JSON) 또는 `GOOGLE_APPLICATION_CREDENTIALS`(파일 경로)

Supabase (서버 전용)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, (옵션) `SUPABASE_ANON_KEY`

AI/임베딩
- Google AI Studio: `GOOGLE_AI_STUDIO_API_KEY` 또는 `GOOGLE_AI_STUDIO_API_KEYS`
- OpenRouter(Anthropic/OpenAI 경유): `OPENROUTER_API_KEY`
- OpenAI 임베딩: `OPENAI_API_KEY`, (옵션) `EMBED_PROVIDER=openai|openrouter|local`, `EMBED_MODEL=text-embedding-3-small`, `LOCAL_EMBEDDING_URL`

결제/멤버십
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `PATREON_CLIENT_ID`, `PATREON_CLIENT_SECRET`, `PATREON_REDIRECT_URI`

Cron/운영
- `CRON_SECRET`, `CRON_SECRET_TOKEN`
- PWA는 `next-pwa` 설정(개발 모드 비활성)

요약/메모리/RAG
- 메모리 정책(`src/utils/memory/policy.ts`):
  - `SUPA_HYPA_MEMORY_ENABLED=true|false` (기본 on)
  - `MEMORY_RETRIEVAL_MODE=summary_only|cascaded|messages_first` (기본 cascaded)
  - `SUPA_THRESHOLD_TOKENS`, `SUPA_WINDOW_MESSAGES`, `HYPA_ROLLUP_CHUNKS`, `SUPA_ROLLUP_MAX_GAP_MINUTES`, `HYPA_ROLLUP_PERIOD_HOURS`
  - `MEMORY_SUMMARY_K1`, `MEMORY_SUMMARY_K2`, `MEMORY_MIN_SCORE`, `MEMORY_ALPHA`, `MEMORY_WEIGHT_BETA`, `DECAY_HALFLIFE_HOURS`, `MAX_CONTEXT_TOKENS_FOR_MEMORY`
- RAG 검색(`src/utils/vector/rag.ts`):
  - `RAG_MODE=v1|hybrid`(기본 v1), `RAG_K`, `RAG_FETCH_K`, `RAG_MIN_SCORE`, `RAG_ALPHA`, `RAG_WINDOW_SIZE`, `RAG_USE_TSV`, `RAG_USE_MQ`, `RAG_USE_HYDE`, `RAG_USE_RERANK`, `RAG_DECAY_HALFLIFE_HOURS`, `DEBUG_RAG`
- 요약 API(`src/app/api/summarize/route.ts`):
  - `SUMMARY_SERVER_MAX_INPUT_CHARS`, `SUMMARY_SERVER_CHUNK_CHARS`, `SUMMARY_SERVER_MAX_MESSAGES`, (클라이언트 제한) `SUMMARY_CLIENT_*`

참고: `.env.example`에 전체 예시가 포함되어 있습니다.

---

## RAG/Memory 개요

- 인덱싱: `/api/vector/index-message` → `chat_message_embeddings` 업서트
- 검색: 하이브리드(RAG_MODE=hybrid) = pgvector(semantic) + trigram/tsvector(lexical) + 시간감쇠 → `match_chat_messages_hybrid`
- 요약 우선(summary-first): `chat_memory_summaries`(SUPA=level 0, HYPA=level 1)에서 먼저 매칭 → 필요시 메시지 스니펫 보강
- 자동 롤업:
  - SUPA: 최근 창 크기/토큰 임계 도달 시 `runSupaSummarization`으로 요약 저장
  - HYPA: 일정 개수/기간 경과 시 `runHypaRollup`으로 상위 요약 및 링크 저장(`chat_memory_links`)
- 통합 시스템 블록: 검색/요약 결과를 시스템 프롬프트로 주입하여 답변 품질 향상

관련 파일
- `src/app/api/chat/bot-response/route.ts` — RAG 주입, 요약 롤업, 멀티 모델 지원
- `src/utils/vector/*` — 임베딩/검색/압축/시스템블록
- `src/utils/memory/*` — 정책/프롬프트/저장소
- `supabase/schema/*.sql` — 테이블/인덱스/RPC 정의

---

## 주요 API (발췌)
- 채팅
  - `POST /api/chat/bot-response` — 캐릭터 응답 생성 + RAG 주입/요약 롤업
  - `POST /api/chat/convert` — 그룹↔개인 방 전환, 포크 관리
  - `POST /api/vector/index-message` — 메시지 임베딩 인덱싱
- 생성/요약
  - `POST /api/generate-lore` — 로어/첫 메시지 생성(WW+ 형식)
  - `POST /api/generate-image` — 이미지 생성(선택)
  - `POST /api/summarize` — 대화 요약
- 경제/랭킹
  - `POST /api/stripe/checkout`, `POST /api/stripe/webhook` — 결제/웹훅
  - `GET /api/rankings` — 일/주/월 랭킹 조회
  - `GET /api/cron/aggregate-rankings/*` — Vercel Cron 대상(헤더 `X-Cron-Auth: $CRON_SECRET`)

---

## 배포/운영
- Vercel 배포 권장. `vercel.json`에 Cron이 정의되어 있습니다.
- Stripe Webhook은 `STRIPE_WEBHOOK_SECRET` 환경변수로 서명 검증을 수행합니다.
- Vertex/Google AI 사용 시 서비스 계정 자격증명이 필요합니다(`GOOGLE_APPLICATION_CREDENTIALS` 또는 JSON 문자열).

보안 체크리스트
- 서비스 롤 키/서비스 계정 JSON은 절대 클라이언트에 노출 금지
- Firestore Rules/Indexes 동기화(`firestore.rules`, `firestore.indexes.json`)
- Stripe Webhook 서명/비용 추적(포인트 차감 로직)

---

## 스크립트
`package.json` 일부 스크립트:
- `dev`, `build`, `start`, `lint`
- 마이그레이션/정리: `scripts/migrations/*`, `src/scripts/*` (예: 빈 채팅방 정리, 기본값 백필 등)

문서
- 그룹 채팅: `docs/group-chat.md`
- 출석 설계: `docs/attendance-design.md`

라이선스
- 미정 또는 레포지토리 소유자 정책을 따릅니다.

---

## 🇺🇸 Overview (English)

An AI character chat/creation platform built with Next.js 15 (App Router) and React 19. It combines Firebase (Auth/Firestore/Storage/Analytics) and Supabase (pgvector) to deliver long‑term memory RAG, summary rollups (SUPA/HYPA), group chat, character/lore management, and an economy layer (points, Stripe, Patreon). PWA and Vercel Cron are supported.

Highlighted directories:
- `src/app` — Routes (App Router), server routes under `api/*`, pages for `chat`, `ranking`, `lorebook`, `settings`, `admin`
- `src/utils/vector/*` — Embeddings, hybrid retrieval, RAG, summary repository (Supabase)
- `src/utils/memory/*` — Policy/prompts/summarizer (SUPA/HYPA)
- `src/firebase/*` — Firebase client/admin setup, collection helpers
- `supabase/schema/*.sql` — pgvector/tsvector schema and RPCs (run in SQL Editor)
- `docs/*.md` — Feature specs (group chat, attendance)

### Features
- AI Chat
  - Single/group chat, per‑character profiles/image selection, recent summary injection
  - LLM providers: Google AI Studio (Gemini/Vertex), OpenRouter (Anthropic/OpenAI)
  - Long‑term memory (RAG): Supabase pgvector + tsvector hybrid, summary‑first retrieval
- Content/Assets
  - Character/lorebook CRUD, image generation (`/api/generate-image`), conversation summarization (`/api/summarize`)
- Economy/Ranking
  - Points balance/ledger, Stripe checkout/webhook, Patreon OAuth
  - Daily/weekly/monthly ranking aggregation (cron) and fetch (`/api/rankings`)
- Admin/Security
  - Admin role management (`src/app/admin/users/page.tsx`), cleanup cron
  - Firestore rules and indexes (`firestore.rules`, `firestore.indexes.json`)
- Ops
  - Vercel Cron (`vercel.json`), PWA (`next-pwa`, `public/manifest.json`, `public/sw.js`)

### Stack
- Web: Next.js 15, React 19, TypeScript, Mantine + MUI
- Backend: Firebase Admin, Supabase (Postgres + pgvector + pg_trgm + tsvector)
- AI: Google Generative AI/Vertex, OpenRouter, OpenAI (incl. embeddings)
- Payments: Stripe (Checkout/Webhook), Patreon
- Infra: Vercel, PWA, Vercel Cron

---

## Quick Start

Prereqs
- Node.js 20+ recommended, pnpm 9+
- Firebase project, Supabase project, Stripe account, (optional) Patreon client

1) Install deps
```bash
pnpm install
```

2) Configure env
- Copy `.env.example` → `.env` or `.env.local` and fill in values.
- Minimum required:
  - Firebase Web: `NEXT_PUBLIC_FIREBASE_*`
  - Firebase Admin: `FIREBASE_ADMIN_SDK_CONFIG` (JSON) or `GOOGLE_APPLICATION_CREDENTIALS`
  - Supabase (server‑only): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, (opt) `SUPABASE_ANON_KEY`
  - AI keys: `GOOGLE_AI_STUDIO_API_KEY` or `GOOGLE_AI_STUDIO_API_KEYS`, (opt) `OPENROUTER_API_KEY`, `OPENAI_API_KEY`
  - Payments: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  - Cron: `CRON_SECRET` (aggregation), `CRON_SECRET_TOKEN` (cleanup)

Important: Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client. It’s server‑only.

3) Apply Supabase schema
- Run the SQL files in this order via Supabase SQL Editor:
  `001_chat_message_embeddings.sql` → `002_match_chat_messages.sql` → `004_enable_trgm_and_lexical.sql` → `005_match_chat_messages_hybrid.sql` → `006_parent_child_windowing.sql` → `007_memory_summaries.sql` → `008_memory_summaries_param_fix.sql` → `009_memory_roomid_to_text.sql` → `010_memory_summaries_rpc_roomid_text.sql`

4) Start dev server
```bash
pnpm dev
```
Open http://localhost:3000

---

## Env Summary

Firebase
- `NEXT_PUBLIC_FIREBASE_*` for client config
- Admin: `FIREBASE_ADMIN_SDK_CONFIG` (stringified JSON) or `GOOGLE_APPLICATION_CREDENTIALS`

Supabase (server‑only)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, (opt) `SUPABASE_ANON_KEY`

AI/Embeddings
- Google AI Studio: `GOOGLE_AI_STUDIO_API_KEY` or `GOOGLE_AI_STUDIO_API_KEYS`
- OpenRouter: `OPENROUTER_API_KEY`
- OpenAI embeddings: `OPENAI_API_KEY`, (opt) `EMBED_PROVIDER`, `EMBED_MODEL`, `LOCAL_EMBEDDING_URL`

Payments/Membership
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `PATREON_CLIENT_ID`, `PATREON_CLIENT_SECRET`, `PATREON_REDIRECT_URI`

Cron/Ops
- `CRON_SECRET`, `CRON_SECRET_TOKEN`

Summary/Memory/RAG
- Memory policy (`src/utils/memory/policy.ts`): thresholds, modes
- RAG retrieval (`src/utils/vector/rag.ts`): mode/hybrid knobs, decay, debug
- Summarizer API (`src/app/api/summarize/route.ts`): server/client budget limits

---

## RAG/Memory
- Indexing via `/api/vector/index-message` → `chat_message_embeddings`
- Retrieval: hybrid (pgvector + lexical with optional decay) via `match_chat_messages_hybrid`
- Summary‑first: match in `chat_memory_summaries` (SUPA/HYPA) and optionally enrich with message snippets
- Automatic rollups: SUPA and HYPA are produced based on thresholds and linked in `chat_memory_links`
- Unified system block injected into model prompts to improve grounding

See:
- `src/app/api/chat/bot-response/route.ts`
- `src/utils/vector/*`, `src/utils/memory/*`
- `supabase/schema/*.sql`

---

## APIs (selected)
- Chat: `POST /api/chat/bot-response`, `POST /api/chat/convert`, `POST /api/vector/index-message`
- Generation/Summarization: `POST /api/generate-lore`, `POST /api/generate-image`, `POST /api/summarize`
- Economy/Ranking: `POST /api/stripe/checkout`, `POST /api/stripe/webhook`, `GET /api/rankings`
- Cron: `GET /api/cron/aggregate-rankings/*` (set `X-Cron-Auth: $CRON_SECRET`)

---

## Deploy/Ops
- Prefer Vercel. Cron jobs are defined in `vercel.json`.
- Stripe webhook verification uses `STRIPE_WEBHOOK_SECRET`.
- Vertex/Google AI requires proper service account credentials (`GOOGLE_APPLICATION_CREDENTIALS` or JSON string var).

Security
- Never expose service role keys or service account JSON to the client.
- Keep Firestore rules and indexes in sync.
- Monitor token usage and point deduction for paid models.

---

## Scripts
- Core: `dev`, `build`, `start`, `lint`
- Migrations/maintenance under `scripts/migrations/*`, `src/scripts/*`

Docs
- Group chat: `docs/group-chat.md`
- Attendance: `docs/attendance-design.md`

License
- Apache-2.0 licensed.
