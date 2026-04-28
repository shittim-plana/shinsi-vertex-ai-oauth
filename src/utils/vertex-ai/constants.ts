/**
 * Vertex AI OAuth 공유 상수
 *
 * 토큰 관리, OAuth 흐름, API 라우트 전체에서 단일 출처로 사용합니다.
 */

/** Cloud Platform API 접근 범위 */
export const VERTEX_OAUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** GCP 프로젝트 목록 읽기 범위 */
export const VERTEX_PROJECTS_SCOPE =
  'https://www.googleapis.com/auth/cloudplatformprojects.readonly';

/** 토큰 만료 5분 전에 자동 갱신을 시작하는 여유 시간(ms) */
export const VERTEX_REFRESH_MARGIN_MS = 5 * 60 * 1000;

// ── Google OAuth 엔드포인트 ─────────────────────────────────────────────────

/** Google OAuth 인증 코드 요청 엔드포인트 */
export const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** 액세스 토큰 발급·갱신 엔드포인트 */
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** 토큰 폐기 엔드포인트 */
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

// ── GCP API 엔드포인트 ─────────────────────────────────────────────────────

/** Cloud Resource Manager v1 프로젝트 목록 엔드포인트 */
export const GCP_PROJECTS_ENDPOINT =
  'https://cloudresourcemanager.googleapis.com/v1/projects';
