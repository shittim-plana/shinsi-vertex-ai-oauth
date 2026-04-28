# Vertex AI OAuth — API Routes Reference

`src/app/api/vertex-ai/` 아래 5개 Next.js Route Handler의 HTTP API 계약입니다.
코드 자체가 아닌 **엔드포인트·요청·응답·에러 코드** 명세서입니다.

---

## 공통 사항

| 항목 | 내용 |
|------|------|
| Base path | `/api/vertex-ai/` |
| 인증 방식 | Firebase UID를 요청 body 또는 query parameter로 전달 (JWT 헤더 없음) |
| 환경 변수 필수 | `GCP_OAUTH_CLIENT_ID`, `GCP_OAUTH_CLIENT_SECRET`, `VERTEX_AI_REDIRECT_URI` |
| Content-Type (POST) | `application/json` |

---

## 1. GET `/api/vertex-ai/auth`

OAuth 인가 흐름을 시작합니다. Google OAuth 인가 URL로 **서버 사이드 리다이렉트**합니다.

### 요청

| 위치 | 파라미터 | 필수 | 설명 |
|------|---------|------|------|
| Query | `uid` | ✅ | Firebase 사용자 UID |
| Query | `projectId` | — | GCP 프로젝트 ID (빈 문자열 허용, callback 완료 후 Firestore에 저장) |
| Query | `region` | — | GCP 리전 (기본값: `global`) |

### 응답

| 조건 | 상태 | 동작 |
|------|------|------|
| 성공 | 302 | `accounts.google.com/o/oauth2/v2/auth?...` 로 리다이렉트 |
| `uid` 누락 | 400 | `{ "error": "Firebase uid is required as a query parameter." }` |
| 환경 변수 누락 | 500 | `{ "error": "Vertex AI integration is not configured correctly." }` |

### state 파라미터 구조

Google에 전달되는 `state`는 base64url 인코딩된 JSON입니다:

```json
{ "uid": "...", "projectId": "...", "region": "..." }
```

### 요청 스코프

```
https://www.googleapis.com/auth/cloud-platform
https://www.googleapis.com/auth/cloudplatformprojects.readonly
```

---

## 2. GET `/api/vertex-ai/callback`

Google이 인가 완료 후 리다이렉트하는 수신 엔드포인트입니다.
토큰 교환 후 Firestore에 저장하고 `/settings` 로 리다이렉트합니다.

### 요청 (Google이 자동으로 보냄)

| 위치 | 파라미터 | 설명 |
|------|---------|------|
| Query | `code` | 인가 코드 |
| Query | `state` | base64url JSON (`uid`, `projectId`, `region`) |
| Query | `error` | 사용자 거부 시 Google이 설정하는 에러 문자열 |

### 응답

| 조건 | 상태 | 리다이렉트 URL |
|------|------|--------------|
| 성공 | 302 | `/settings?vertex_ai_status=success` |
| 사용자 거부(error 파라미터) | 302 | `/settings?vertex_ai_status=error&vertex_ai_message={error}` |
| 토큰 교환 실패 | 302 | `/settings?vertex_ai_status=error&vertex_ai_message=token_exchange_failed` |
| 비정상 토큰 응답 | 302 | `/settings?vertex_ai_status=error&vertex_ai_message=invalid_token_response` |
| `code`/`state` 누락 | 400 | `{ "error": "Authorization code or state parameter missing." }` |
| state 디코딩 실패 | 400 | `{ "error": "Invalid state parameter." }` |
| 환경 변수 누락 | 500 | `{ "error": "Vertex AI integration is not configured correctly." }` |

### Firestore 저장 구조

`users/{uid}` 문서의 `vertexAI` 필드 (merge: true):

```json
{
  "vertexAI": {
    "refreshToken": "string",
    "accessToken": "string",
    "tokenExpiresAt": 1720000000000,
    "gcpProjectId": "string",
    "region": "global | us-central1 | ...",
    "connectedAt": 1720000000000,
    "scope": "https://www.googleapis.com/auth/cloud-platform ..."
  }
}
```

---

## 3. POST `/api/vertex-ai/verify`

Vertex AI OAuth 연동의 3단계 무결성 검사를 수행합니다.

### 요청 Body

```json
{ "uid": "firebase-user-uid" }
```

### 응답 Body

```typescript
interface VerifyResult {
  allOk: boolean;
  steps: Array<{
    name: string;   // 검사 단계 이름 (한국어)
    ok: boolean;
    message: string;
  }>;
}
```

### 검사 단계

| 순서 | name | 설명 |
|------|------|------|
| 1 | `서버 설정 (환경 변수)` | `GCP_OAUTH_CLIENT_ID`, `GCP_OAUTH_CLIENT_SECRET`, `VERTEX_AI_REDIRECT_URI` 존재 여부 |
| 2 | `사용자 인증 토큰` | Firestore에서 자격증명 로드 + 만료 시 갱신 |
| 3 | `Vertex AI API 응답` | `gemini-2.5-flash`로 실제 `generateContent` 호출 (`maxOutputTokens: 50`, `thinkingConfig: { thinkingBudget: 0 }`) |

단계 1 또는 2 실패 시 이후 단계를 건너뜁니다.

### 리전 폴백 동작

단계 3에서 설정된 리전으로 실패하면 `us-central1`로 자동 재시도합니다.
빈 응답(empty text)은 리전 문제가 아닌 것으로 간주하여 재시도하지 않습니다. 빈 응답 시 `finishReason`, `blockReason`이 있으면 메시지에 포함됩니다.

### 에러 응답

| 조건 | 상태 | Body |
|------|------|------|
| `uid` 누락 | 400 | `{ "error": "uid is required." }` |
| JSON 파싱 실패 | 400 | `{ "error": "Invalid JSON body." }` |

---

## 4. POST `/api/vertex-ai/disconnect`

GCP 계정 연결을 해제합니다. Google에서 토큰을 폐기하고 Firestore 데이터를 삭제합니다.

### 요청 Body

```json
{ "uid": "firebase-user-uid" }
```

### 응답

| 조건 | 상태 | Body |
|------|------|------|
| 성공 | 200 | `{ "success": true }` |
| `uid` 누락 | 400 | `{ "error": "uid is required." }` |
| 사용자 없음 | 404 | `{ "error": "User not found." }` |
| 서버 오류 | 500 | `{ "error": "..." }` |

### 토큰 폐기 동작

1. `refresh_token` 폐기 → `POST https://oauth2.googleapis.com/revoke?token=...`
2. `access_token` 폐기 → 동일 엔드포인트 (각각 best-effort, 실패해도 다음 단계 진행)
3. Firestore `users/{uid}.vertexAI` 필드 삭제 (`deleteField()`)

---

## 5. POST `/api/vertex-ai/projects`

사용자의 GCP 계정에 속한 활성 프로젝트 목록을 반환합니다.

### 요청 Body

```json
{ "uid": "firebase-user-uid" }
```

### 응답

**성공 (200):**
```json
{
  "projects": [
    { "projectId": "my-project-123", "name": "My Project" }
  ]
}
```

| 조건 | 상태 | Body |
|------|------|------|
| 성공 | 200 | `{ "projects": [{ "projectId": string, "name": string }] }` |
| 인증 정보 없음 | 401 | `{ "error": "No valid Vertex AI credentials. Please reconnect your GCP account." }` |
| GCP API 실패 | GCP 상태코드 전달 | `{ "error": "Failed to fetch GCP projects.", "details": {...} }` |
| `uid` 누락 | 400 | `{ "error": "uid is required." }` |
| 서버 오류 | 500 | `{ "error": "..." }` |

### 내부 동작

`getVertexAIAccessToken(uid)` 호출 — `gcpProjectId` 없이도 동작하므로
프로젝트를 아직 선택하지 않은 상태에서도 목록 조회 가능합니다.
Cloud Resource Manager API 필터: `?filter=lifecycleState:ACTIVE`

---

## Firestore 데이터 스키마 요약

`users/{uid}.vertexAI` 필드:

| 키 | 타입 | 설명 |
|----|------|------|
| `refreshToken` | string | Google refresh_token (연결 여부 판단 기준) |
| `accessToken` | string | 현재 access_token (캐시) |
| `tokenExpiresAt` | number | access_token 만료 시각 (epoch ms) |
| `gcpProjectId` | string | 선택된 GCP 프로젝트 ID |
| `region` | string | GCP 리전 (기본값: `global`) |
| `connectedAt` | number | 최초 연결 시각 (epoch ms) |
| `scope` | string | 부여된 OAuth 스코프 |
| `enabled` | boolean \| undefined | `false`이면 비활성화, 그 외(undefined 포함)는 활성화 |
