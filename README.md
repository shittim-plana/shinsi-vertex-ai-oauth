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

## Vertex AI OAuth 설정 가이드

이 fork는 사용자가 **자신의 GCP 계정을 연결**하여 Vertex AI Gemini 모델을 본인 할당량으로 사용할 수 있는 OAuth 통합을 포함합니다. 서비스 계정 키 없이 사용자별 OAuth로 인증합니다.

### 구조

```
src/utils/vertex-ai/
├── constants.ts          — OAuth 상수 (스코프, 엔드포인트, 갱신 마진)
├── token-manager.ts      — 토큰 저장/갱신/조회 (Firestore)
└── client.ts             — GoogleGenAI 인스턴스 생성 (ADC 격리)

src/app/api/vertex-ai/
├── auth/route.ts         — OAuth 시작 (Google consent 화면 리다이렉트)
├── callback/route.ts     — OAuth 콜백 (code → token 교환, Firestore 저장)
├── disconnect/route.ts   — 연결 해제 (토큰 폐기 + Firestore 삭제)
├── projects/route.ts     — GCP 프로젝트 목록 조회
└── verify/route.ts       — 무결성 검사 (3단계: 설정→토큰→API 호출)

src/components/settings/
└── VertexAIConnection.tsx — 설정 UI (연결/해제/검사/토글)

lib/
├── vertex-ai-oauth.js          — 유니버설 참조 구현
├── vertex-ai-oauth.browser.js  — 브라우저 참조 구현
├── vertex-ai-oauth-server.js   — 서버 참조 구현
├── vertex-ai-api-routes-reference.md — API 엔드포인트 명세
└── vertex-ai-ui-wireframe.md   — UI 와이어프레임
```

### 흐름

```
사용자 (Firebase Auth 로그인 완료)
  → 설정 페이지 "GCP 계정 연결" 클릭
  → GET /api/vertex-ai/auth?uid=...&projectId=...&region=...
  → Google OAuth consent (scope: cloud-platform + projects.readonly)
  → Google → GET /api/vertex-ai/callback?code=...&state=...
  → code → token 교환 → Firestore users/{uid}.vertexAI 저장
  → 이후 채팅 시 자동으로 사용자 Vertex AI 토큰 사용
  → 토큰 만료 시 refresh_token으로 자동 갱신
```

### 환경변수 설정

`vercel.json`의 `env` 섹션을 채우세요:

| 변수 | 설명 | 얻는 곳 |
|------|------|---------|
| `GCP_OAUTH_CLIENT_ID` | OAuth 2.0 클라이언트 ID | GCP Console → APIs & Services → Credentials |
| `GCP_OAUTH_CLIENT_SECRET` | OAuth 2.0 클라이언트 시크릿 | 동일 |
| `VERTEX_AI_REDIRECT_URI` | 콜백 URL | `https://YOUR_DOMAIN/api/vertex-ai/callback` |
| `GOOGLE_CLIENT_ID` | = GCP_OAUTH_CLIENT_ID (동일 값) | 동일 |
| `GOOGLE_CLIENT_SECRET` | = GCP_OAUTH_CLIENT_SECRET (동일 값) | 동일 |
| `NEXTAUTH_SECRET` | 세션 시크릿 (랜덤 문자열) | `openssl rand -hex 32` |
| `NEXTAUTH_URL` | 사이트 URL | `https://YOUR_DOMAIN` |
| `GOOGLE_APPLICATION_CREDENTIALS` | 서비스 계정 JSON (서버 폴백용) | GCP Console → IAM → Service Accounts |

### GCP OAuth 클라이언트 생성 방법

1. [GCP Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. "Create Credentials" → "OAuth 2.0 Client ID"
3. Application type: **Web application**
4. Authorized redirect URIs에 추가: `https://YOUR_DOMAIN/api/vertex-ai/callback`
5. Client ID와 Client Secret를 `vercel.json`에 입력

### OAuth 동의 화면 설정

1. GCP Console → APIs & Services → OAuth consent screen
2. User type: **External** (또는 Internal for Workspace)
3. App name, support email 등 입력
4. Scopes 추가:
   - `https://www.googleapis.com/auth/cloud-platform`
   - `https://www.googleapis.com/auth/cloudplatformprojects.readonly`
5. **Test users** 탭에서 사용자 Gmail 추가 (앱 게시 전까지 필수)

> ⚠️ 앱이 "Testing" 상태일 때는 Test users에 등록된 Gmail만 OAuth 인증 가능합니다.
> 모든 사용자에게 열려면 Google의 앱 검증(verification)을 통과해야 합니다.

### Vertex AI API 활성화

사용자의 GCP 프로젝트에서 아래 API가 활성화되어 있어야 합니다:
- Vertex AI API (`aiplatform.googleapis.com`)
- Cloud Resource Manager API (`cloudresourcemanager.googleapis.com`)

### Firestore 스키마

`users/{uid}` 문서에 `vertexAI` 필드가 자동 생성됩니다:

```json
{
  "vertexAI": {
    "refreshToken": "...",
    "accessToken": "...",
    "tokenExpiresAt": 1720000000000,
    "gcpProjectId": "my-project",
    "region": "global",
    "connectedAt": 1720000000000,
    "scope": "https://www.googleapis.com/auth/cloud-platform ...",
    "enabled": true
  }
}
```

### 참고

- `lib/vertex-ai-api-routes-reference.md` — 전체 API 명세 (요청/응답/에러 코드)
- `src/utils/vertex-ai/client.ts` — ADC 격리 전략 (서비스 계정 키가 사용자 OAuth 경로에 노출되지 않도록)
- 토큰은 만료 5분 전에 자동 갱신됩니다 (`VERTEX_REFRESH_MARGIN_MS`)

### 라이선스 및 출처

Vertex AI OAuth 구현은 [vertex-ai-oauth by shittim-plana](https://github.com/shittim-plana/vertex-ai-oauth)를 기반으로 합니다.

`lib/` 디렉토리의 참조 구현 파일들은 vertex-ai-oauth 라이선스 (Attribution + No-Sell + Share-Alike)를 따릅니다. 자세한 내용은 [vertex-ai-oauth LICENSE](https://github.com/shittim-plana/vertex-ai-oauth/blob/main/LICENSE)를 참고하세요.

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

---

## Vertex AI OAuth Setup Guide

This fork includes a user-level OAuth integration that lets each user **connect their own GCP account** to use Vertex AI Gemini models with their own quota — no service account key sharing required.

### Required Environment Variables

Fill in the `env` section of `vercel.json`:

| Variable | Description | Where to get |
|----------|-------------|--------------|
| `GCP_OAUTH_CLIENT_ID` | OAuth 2.0 Client ID | GCP Console → APIs & Services → Credentials |
| `GCP_OAUTH_CLIENT_SECRET` | OAuth 2.0 Client Secret | Same |
| `VERTEX_AI_REDIRECT_URI` | Callback URL | `https://YOUR_DOMAIN/api/vertex-ai/callback` |
| `GOOGLE_CLIENT_ID` | Same as GCP_OAUTH_CLIENT_ID | Same |
| `GOOGLE_CLIENT_SECRET` | Same as GCP_OAUTH_CLIENT_SECRET | Same |
| `NEXTAUTH_SECRET` | Session secret (random string) | `openssl rand -hex 32` |
| `NEXTAUTH_URL` | Site URL | `https://YOUR_DOMAIN` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Service account JSON (server fallback) | GCP Console → IAM → Service Accounts |

### Setup Steps

1. **Create OAuth Client**: GCP Console → Credentials → Create OAuth 2.0 Client ID (Web application)
2. **Add redirect URI**: `https://YOUR_DOMAIN/api/vertex-ai/callback`
3. **Configure consent screen**: Add scopes `cloud-platform` and `cloudplatformprojects.readonly`
4. **Add test users**: While app is in "Testing" status, manually add Gmail addresses in OAuth consent screen → Test users
5. **Enable APIs** in each user's GCP project: Vertex AI API + Cloud Resource Manager API

> ⚠️ While your OAuth app is in "Testing" mode, only manually added test users can authorize. To open it to all users, you must pass Google's app verification.

See `lib/vertex-ai-api-routes-reference.md` for full API endpoint documentation.

### License & Attribution

The Vertex AI OAuth implementation is based on [vertex-ai-oauth by shittim-plana](https://github.com/shittim-plana/vertex-ai-oauth).

Reference implementation files in `lib/` are subject to the vertex-ai-oauth license (Attribution + No-Sell + Share-Alike). See [vertex-ai-oauth LICENSE](https://github.com/shittim-plana/vertex-ai-oauth/blob/main/LICENSE) for details.
