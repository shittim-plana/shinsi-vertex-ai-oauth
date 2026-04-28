/**
 * vertex-ai-oauth-server.js
 *
 * Vertex AI OAuth — 서버 측 토큰 관리 참조 구현
 *
 * Vertex AI OAuth 서버 측 토큰 관리 핵심 로직을 담은 범용 참조 구현입니다.
 *
 * 외부 DB 의존성 없음. 토큰 영속화(저장·갱신 후 업데이트)는
 * 호출 측이 콜백 형태로 직접 처리합니다.
 *
 * ── 핵심 함수 ─────────────────────────────────────────────────────────────────
 *
 *   refreshAccessToken(refreshToken, clientId, clientSecret)
 *     → { accessToken, expiresAt }  |  null
 *
 *   getToken(stored, clientId, clientSecret, onRefreshed)
 *     → accessToken string  |  null
 *
 *   getTokenStatus(stored)
 *     → { connected: boolean, minutesLeft: number }
 *
 * ── 사용 예시 ─────────────────────────────────────────────────────────────────
 *
 *   const { getToken } = require('./lib/vertex-ai-oauth-server.js');
 *
 *   // stored: DB나 임의 스토리지에서 꺼낸 토큰 데이터
 *   const stored = {
 *     refreshToken: 'your-refresh-token',
 *     accessToken:  'cached-access-token',      // optional
 *     tokenExpiresAt: 1720000000000,             // optional, epoch ms
 *   };
 *
 *   const accessToken = await getToken(stored, CLIENT_ID, CLIENT_SECRET, async (newToken, expiresAt) => {
 *     // 갱신된 토큰을 DB에 저장
 *     await db.update({ accessToken: newToken, tokenExpiresAt: expiresAt });
 *   });
 *
 *   if (!accessToken) {
 *     // refreshToken 만료(invalid_grant) 또는 서버 오류 — 재인증 필요
 *   }
 *
 * ── 토큰 만료 처리 ────────────────────────────────────────────────────────────
 *
 *   Google은 refresh_token에 대해 `invalid_grant` 에러를 반환합니다:
 *     - 사용자가 앱 권한을 수동 취소한 경우
 *     - 같은 클라이언트로 50개 이상의 refresh_token이 발급된 경우 (oldest 자동 무효화)
 *     - refresh_token이 6개월 이상 사용되지 않은 경우
 *
 *   `refreshAccessToken`이 null을 반환하고 두 번째 인자에 `invalid_grant`가 담길 때
 *   저장된 자격증명을 삭제하고 사용자에게 재인증을 요청해야 합니다.
 */

'use strict';

// ── 상수 ──────────────────────────────────────────────────────────────────────

/** Cloud Platform API 접근 범위 */
const VERTEX_OAUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** GCP 프로젝트 목록 읽기 범위 */
const VERTEX_PROJECTS_SCOPE = 'https://www.googleapis.com/auth/cloudplatformprojects.readonly';

/** 토큰 만료 5분 전에 자동 갱신을 시작하는 여유 시간(ms) */
const VERTEX_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Google OAuth 인증 코드 요청 엔드포인트 */
const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** 액세스 토큰 발급·갱신 엔드포인트 */
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** 토큰 폐기 엔드포인트 */
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** Cloud Resource Manager v1 프로젝트 목록 엔드포인트 */
const GCP_PROJECTS_ENDPOINT = 'https://cloudresourcemanager.googleapis.com/v1/projects';

// ── 핵심 함수 ─────────────────────────────────────────────────────────────────

/**
 * refresh_token을 사용해 새 access_token을 발급합니다.
 *
 * @param {string} refreshToken  Google refresh_token
 * @param {string} clientId      GCP OAuth 클라이언트 ID
 * @param {string} clientSecret  GCP OAuth 클라이언트 시크릿
 * @returns {Promise<{ accessToken: string, expiresAt: number } | null>}
 *   성공 시 { accessToken, expiresAt(epoch ms) },
 *   실패 시 null.
 *   `invalid_grant`로 실패한 경우 두 번째 인자(errorCode)에 'invalid_grant'가 담깁니다.
 *   콜백 패턴 없이 직접 에러 코드를 확인하고 싶다면 아래 내부 구현을 참고하세요.
 */
async function refreshAccessToken(refreshToken, clientId, clientSecret) {
  if (!clientId || !clientSecret) {
    console.error('[VertexAI Server] clientId or clientSecret is missing');
    return null;
  }

  try {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorCode = errorData && errorData.error;

      if (errorCode === 'invalid_grant') {
        // refresh_token 폐기/만료 — 호출 측에서 저장된 자격증명 삭제 필요
        console.warn('[VertexAI Server] invalid_grant — stored credentials should be removed');
        return null;
      }

      console.error('[VertexAI Server] Token refresh failed:', errorCode, errorData.error_description || '');
      return null;
    }

    const tokenData = await response.json();

    if (
      !tokenData ||
      typeof tokenData.access_token !== 'string' ||
      typeof tokenData.expires_in !== 'number'
    ) {
      console.error('[VertexAI Server] Unexpected token response shape:', tokenData);
      return null;
    }

    return {
      accessToken: tokenData.access_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
    };
  } catch (error) {
    console.error('[VertexAI Server] Token refresh error:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * 캐시된 액세스 토큰이 유효하면 반환하고, 만료 임박·만료 시 갱신합니다.
 *
 * Firebase/Firestore와 무관하게 동작합니다. 토큰 갱신 후 영속화는
 * `onRefreshed` 콜백을 통해 호출 측이 직접 처리합니다.
 *
 * @param {object} stored                   스토리지에서 꺼낸 토큰 데이터
 * @param {string} stored.refreshToken      Google refresh_token (필수)
 * @param {string} [stored.accessToken]     캐시된 access_token (선택)
 * @param {number} [stored.tokenExpiresAt]  access_token 만료 시각(epoch ms, 선택)
 * @param {string} clientId                 GCP OAuth 클라이언트 ID
 * @param {string} clientSecret             GCP OAuth 클라이언트 시크릿
 * @param {Function} [onRefreshed]          갱신 후 호출되는 콜백
 *   (newAccessToken: string, newExpiresAt: number) => Promise<void>
 * @returns {Promise<string | null>}        유효한 access_token 또는 null
 */
async function getToken(stored, clientId, clientSecret, onRefreshed) {
  if (!stored || !stored.refreshToken) {
    return null;
  }

  // 캐시된 토큰이 만료 여유 시간 내에 있으면 그대로 반환
  if (
    stored.accessToken &&
    stored.tokenExpiresAt &&
    stored.tokenExpiresAt > Date.now() + VERTEX_REFRESH_MARGIN_MS
  ) {
    return stored.accessToken;
  }

  // 갱신 필요
  const result = await refreshAccessToken(stored.refreshToken, clientId, clientSecret);
  if (!result) return null;

  const { accessToken, expiresAt } = result;

  if (typeof onRefreshed === 'function') {
    try {
      await onRefreshed(accessToken, expiresAt);
    } catch (err) {
      // 영속화 실패는 이번 요청에 영향 없음 — 로그만 남김
      console.warn('[VertexAI Server] onRefreshed callback failed:', err instanceof Error ? err.message : String(err));
    }
  }

  return accessToken;
}

/**
 * OAuth 인가 코드를 access_token + refresh_token으로 교환합니다.
 * (일반적으로 callback 라우트에서만 사용)
 *
 * @param {string} code         Google OAuth 인가 코드
 * @param {string} clientId     GCP OAuth 클라이언트 ID
 * @param {string} clientSecret GCP OAuth 클라이언트 시크릿
 * @param {string} redirectUri  등록된 redirect URI
 * @returns {Promise<{
 *   accessToken: string,
 *   refreshToken: string,
 *   expiresAt: number,
 *   scope: string
 * } | null>}
 */
async function exchangeCodeForTokens(code, clientId, clientSecret, redirectUri) {
  try {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[VertexAI Server] Code exchange failed:', errorData);
      return null;
    }

    const tokenData = await response.json();

    if (
      !tokenData ||
      typeof tokenData.access_token !== 'string' ||
      typeof tokenData.refresh_token !== 'string' ||
      typeof tokenData.expires_in !== 'number'
    ) {
      console.error('[VertexAI Server] Unexpected token response shape:', tokenData);
      return null;
    }

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      scope: tokenData.scope || '',
    };
  } catch (error) {
    console.error('[VertexAI Server] Code exchange error:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * 토큰을 Google에 폐기합니다 (best-effort).
 * refresh_token을 폐기하면 관련 access_token이 모두 무효화됩니다.
 *
 * @param {string} token  폐기할 토큰 (refresh_token 또는 access_token)
 * @returns {Promise<boolean>}  성공 여부
 */
async function revokeToken(token) {
  try {
    const res = await fetch(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return res.ok;
  } catch (error) {
    console.warn('[VertexAI Server] Token revoke error:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Google OAuth 인가 URL을 생성합니다.
 * state 파라미터는 CSRF 방지용으로, base64url 인코딩된 JSON 객체를 권장합니다.
 *
 * @param {object} params
 * @param {string} params.clientId     GCP OAuth 클라이언트 ID
 * @param {string} params.redirectUri  등록된 redirect URI
 * @param {string} [params.state]      CSRF 방지용 state 값
 * @returns {string}  인가 URL
 */
function buildAuthUrl({ clientId, redirectUri, state }) {
  const scopes = [VERTEX_OAUTH_SCOPE, VERTEX_PROJECTS_SCOPE];
  const queryParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });
  if (state) queryParams.set('state', state);
  return `${GOOGLE_OAUTH_AUTHORIZE_URL}?${queryParams.toString()}`;
}

/**
 * 활성 GCP 프로젝트 목록을 반환합니다.
 *
 * @param {string} accessToken  유효한 access_token
 * @returns {Promise<Array<{ projectId: string, name: string }> | null>}
 */
async function listGCPProjects(accessToken) {
  try {
    const response = await fetch(`${GCP_PROJECTS_ENDPOINT}?filter=lifecycleState:ACTIVE`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[VertexAI Server] Failed to fetch GCP projects:', errorData);
      return null;
    }
    const data = await response.json();
    return (data.projects || []).map((p) => ({
      projectId: p.projectId,
      name: p.name,
    }));
  } catch (error) {
    console.error('[VertexAI Server] GCP projects error:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * 저장된 토큰 데이터로 Vertex AI 연결 상태를 계산합니다.
 * token-manager.ts의 getVertexAIStatus()와 동일한 로직이며,
 * lib/vertex-ai-oauth.js의 onStatusChange 콜백과 같은 구조를 반환합니다.
 *
 * @param {object} [stored]                   스토리지에서 꺼낸 토큰 데이터
 * @param {string} [stored.refreshToken]      Google refresh_token
 * @param {number} [stored.tokenExpiresAt]    access_token 만료 시각(epoch ms, 선택)
 * @returns {{ connected: boolean, minutesLeft: number }}
 */
function getTokenStatus(stored) {
  if (!stored || !stored.refreshToken) {
    return { connected: false, minutesLeft: 0 };
  }

  const expiresAt = stored.tokenExpiresAt || 0;
  const msLeft = Math.max(0, expiresAt - Date.now());
  const minutesLeft = Math.round(msLeft / 60_000);

  return { connected: true, minutesLeft };
}

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // 상수
  VERTEX_OAUTH_SCOPE,
  VERTEX_PROJECTS_SCOPE,
  VERTEX_REFRESH_MARGIN_MS,
  GOOGLE_OAUTH_AUTHORIZE_URL,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_REVOKE_ENDPOINT,
  GCP_PROJECTS_ENDPOINT,
  // 함수
  refreshAccessToken,
  getToken,
  getTokenStatus,
  exchangeCodeForTokens,
  revokeToken,
  buildAuthUrl,
  listGCPProjects,
};
