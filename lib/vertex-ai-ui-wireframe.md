# Vertex AI Connection — UI 상태 머신 및 사용자 흐름

`src/components/settings/VertexAIConnection.tsx` 의 UI 상태 머신과
사용자 흐름을 문서화한 참고 자료입니다.

---

## 최상위 상태 (isConnected)

```
        ┌─────────────┐        OAuth 콜백 성공        ┌──────────────┐
        │  미연결      │ ──────────────────────────► │  연결됨       │
        │ (Firestore  │                              │ (refreshToken │
        │ refreshToken│ ◄────────────────────────── │  존재)        │
        │ 없음)        │      연결 해제 성공           └──────────────┘
        └─────────────┘
```

`isConnected = Boolean(vertexData?.refreshToken)`

로딩 중(`loading === true`)에는 컴포넌트 전체가 `null`을 반환합니다.

---

## 상태 변수 목록

| 변수 | 타입 | 초기값 | 설명 |
|------|------|--------|------|
| `loading` | boolean | `true` | Firestore 초기 로드 중 |
| `vertexData` | `VertexAIData \| null` | `null` | 저장된 연결 데이터 |
| `projectId` | string | `''` | 연결 전 폼 입력 (GCP Project ID) |
| `region` | string | `'global'` | 연결 전 폼 입력 (리전 선택) |
| `projects` | array | `[]` | 프로젝트 목록 조회 결과 |
| `loadingProjects` | boolean | `false` | 프로젝트 목록 조회 중 |
| `disconnecting` | boolean | `false` | 연결 해제 요청 진행 중 |
| `togglingEnabled` | boolean | `false` | enabled 토글 진행 중 |
| `verifying` | boolean | `false` | 무결성 검사 진행 중 |
| `verifyResult` | `VerifyResult \| null` | `null` | 무결성 검사 결과 |

---

## 상태 A: 미연결

`isConnected === false` 인 경우 표시됩니다.

### 폼 UI

```
┌─────────────────────────────────────────┐
│  Vertex AI 연결                   [미연결] │
│  GCP 계정을 연결하여 본인의 할당량으로...    │
├─────────────────────────────────────────┤
│  GCP Project ID                          │
│  [ my-gcp-project                    ]  │
│                                          │
│  리전                                    │
│  [ global (Preview 모델 전용...)      ▼] │
│                                          │
│  ℹ GCP 프로젝트에서 Vertex AI API가...    │
│                                          │
│  [ ☁ GCP 계정 연결 ]  ← projectId가 비면 disabled │
└─────────────────────────────────────────┘
```

### 리전 선택 옵션

| value | label |
|-------|-------|
| `global` | global (Preview 모델 전용 — gemini-2.5-pro-preview 등) |
| `us-central1` | us-central1 (Iowa) |
| `us-east4` | us-east4 (Virginia) |
| `us-west1` | us-west1 (Oregon) |
| `europe-west1` | europe-west1 (Belgium) |
| `europe-west4` | europe-west4 (Netherlands) |
| `asia-northeast1` | asia-northeast1 (Tokyo) |
| `asia-southeast1` | asia-southeast1 (Singapore) |

기본값은 `global`. **Preview 모델(gemini-2.5-pro-preview 등)은 regional endpoint 미지원**이므로 임의 변경 금지.

### 연결 시작 동작

```
handleConnect()
  → window.location.href = /api/vertex-ai/auth?uid=&projectId=&region=
  → [서버가 Google OAuth URL로 302 리다이렉트]
  → [사용자가 Google 계정 선택 및 권한 동의]
  → GET /api/vertex-ai/callback?code=&state=
  → [서버가 Firestore에 저장 후]
  → /settings?vertex_ai_status=success 로 리다이렉트
```

---

## 상태 B: 연결됨

`isConnected === true` 인 경우 표시됩니다.

### 배지 색상 로직

| 조건 | 배지 색상 | 텍스트 |
|------|---------|--------|
| `tokenExpired === true` | orange | 토큰 만료 |
| `vertexData.enabled === false` | gray | 비활성화 |
| 그 외 (정상) | green | 연결됨 |

`tokenExpired = isConnected && tokenExpiresAt > 0 && msLeft === 0`

만료된 토큰은 **다음 API 호출 시 서버에서 자동 갱신**됩니다 (사용자 조작 불필요).

### 정보 표시 영역

```
┌─────────────────────────────────────────┐
│  Vertex AI 연결                   [연결됨] │
├─────────────────────────────────────────┤
│  프로젝트 ID:  my-gcp-project            │
│  리전:         us-central1              │
│  연결일:       2025. 4. 5.              │
│  토큰 상태:    42분 후 갱신              │
│                                          │
│  ○ Vertex AI OAuth 사용                 │
│    (OFF 시 인증정보 유지, 공유 API 키로 폴백) │
│                                          │
│  [프로젝트 목록 조회] [무결성 검사] [연결 해제] │
└─────────────────────────────────────────┘
```

---

## 서브 흐름 1: enabled 토글

`handleToggleEnabled()` — Firestore `vertexAI.enabled` 필드만 업데이트합니다.

```
토글 클릭
  → setTogglingEnabled(true)
  → updateDoc({ 'vertexAI.enabled': newEnabled })
  → setVertexData(prev => { ...prev, enabled: newEnabled })
  → 알림: "Vertex AI 활성화됨" (green) / "Vertex AI 비활성화됨" (orange)
  → setTogglingEnabled(false)
```

`enabled` 필드 의미:
- `false`로 **명시**된 경우에만 비활성화 (서버에서 `null` 반환)
- `undefined` 또는 그 외 값은 활성화로 취급

---

## 서브 흐름 2: 프로젝트 목록 조회

`fetchProjects()` — `POST /api/vertex-ai/projects` 호출.

```
[프로젝트 목록 조회] 클릭
  → setLoadingProjects(true)
  → POST /api/vertex-ai/projects { uid }
  → 성공: setProjects(data.projects)
    [목록이 연결됨 UI 하단에 표시]
  → 실패: 알림 "프로젝트 조회 실패" (red)
  → setLoadingProjects(false)
```

---

## 서브 흐름 3: 무결성 검사

`handleVerify()` — `POST /api/vertex-ai/verify` 호출.

```
[무결성 검사] 클릭
  → setVerifying(true), setVerifyResult(null)
  → POST /api/vertex-ai/verify { uid }
  → 성공: setVerifyResult(data)
    [Alert 컴포넌트로 결과 인라인 표시]
  → 실패: 알림 "무결성 검사 실패" (red)
  → setVerifying(false)
```

#### 결과 표시 (verifyResult 존재 시)

```
┌────────────────────────────────────────────────────────┐
│ ✅ 무결성 검사 통과  (또는 ❌ 무결성 검사 실패)           │
│                                                        │
│  ✓  서버 설정 (환경 변수): GCP_OAUTH_CLIENT_ID, ...     │
│  ✓  사용자 인증 토큰: 액세스 토큰 유효 (프로젝트: ...)    │
│  ✓  Vertex AI API 응답: API 정상 응답 수신 (모델: ...)   │
└────────────────────────────────────────────────────────┘
```

---

## 서브 흐름 4: 연결 해제

`handleDisconnect()` — `POST /api/vertex-ai/disconnect` 호출.

```
[연결 해제] 클릭
  → setDisconnecting(true)
  → POST /api/vertex-ai/disconnect { uid }
  → 성공:
      setVertexData(null)           ← isConnected = false → UI가 "미연결" 상태로 전환
      알림: "Vertex AI 연결 해제됨" (orange)
  → 실패: 알림 "연결 해제 실패" (red)
  → setDisconnecting(false)
```

---

## OAuth 콜백 처리 (URL 파라미터 감시)

컴포넌트 마운트 시 `window.location.search`를 검사합니다:

| 파라미터 | 동작 |
|---------|------|
| `vertex_ai_status=success` | 알림 "Vertex AI 연결됨" (green) + `loadVertexAIData()` 재호출 + URL 정리 |
| `vertex_ai_status=error` | 알림 "Vertex AI 연결 실패" + `vertex_ai_message` 표시 + URL 정리 |

---

## 전체 상태 전이 다이어그램

```
[초기]
  loading=true
       │
       ▼ Firestore 로드 완료
  ┌────────────────────────────────────────┐
  │                                        │
  ▼                                        ▼
[미연결]                               [연결됨]
  │                                        │
  │ handleConnect()                        ├── handleToggleEnabled()
  │ → redirect to Google OAuth             │     → Firestore enabled 업데이트
  │ → callback → Firestore 저장            │
  │ → URL ?vertex_ai_status=success        ├── fetchProjects()
  │ → loadVertexAIData()                   │     → projects 목록 표시
  └────────────────────────────────────────┤
                                           ├── handleVerify()
                                           │     → verifyResult 인라인 표시
                                           │
                                           └── handleDisconnect()
                                                 → vertexData = null
                                                 → [미연결] 상태로 전환
```
