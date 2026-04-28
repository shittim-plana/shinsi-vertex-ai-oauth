import { db } from '@/firebase/config';
import { doc, getDoc, DocumentReference, updateDoc, deleteField } from 'firebase/firestore';
import { VERTEX_REFRESH_MARGIN_MS, GOOGLE_TOKEN_ENDPOINT } from './constants';

export interface VertexAICredentials {
  accessToken: string;
  projectId: string;
  region: string;
}

/**
 * Vertex AI 연결 상태.
 * lib/vertex-ai-oauth.js의 onStatusChange 콜백 형태와 동일한 구조입니다.
 */
export interface VertexAIStatus {
  connected: boolean;
  minutesLeft: number;
}

interface VertexAIStoredData {
  refreshToken?: string;
  accessToken?: string;
  tokenExpiresAt?: number;
  gcpProjectId?: string;
  region?: string;
  connectedAt?: number;
  scope?: string;
  /** false로 명시된 경우에만 비활성화. 미설정(undefined)은 활성화로 취급. */
  enabled?: boolean;
}

/**
 * Exchanges a refresh token for a fresh access token and persists it to Firestore.
 * Returns the new access token, or null if the exchange fails.
 * Removes stored credentials on `invalid_grant` (revoked/expired refresh token).
 */
async function _refreshAccessToken(
  uid: string,
  refreshToken: string,
  userDocRef: DocumentReference,
): Promise<string | null> {
  const clientId = process.env.GCP_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GCP_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('[VertexAI] GCP_OAUTH_CLIENT_ID or GCP_OAUTH_CLIENT_SECRET not configured');
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
      const errorCode = (errorData as Record<string, unknown>)?.error;

      if (errorCode === 'invalid_grant') {
        // Refresh token revoked or expired — clean up
        console.warn('[VertexAI] invalid_grant for user:', uid, '— cleaning up stored credentials');
        await updateDoc(userDocRef, { vertexAI: deleteField() });
        return null;
      }

      console.error('[VertexAI] Token refresh failed for user:', uid, errorCode);
      return null;
    }

    const tokenData: unknown = await response.json();

    // Validate response shape (§8-E: no unsound assertions)
    if (
      !tokenData ||
      typeof tokenData !== 'object' ||
      !('access_token' in tokenData) ||
      !('expires_in' in tokenData) ||
      typeof (tokenData as Record<string, unknown>).access_token !== 'string' ||
      typeof (tokenData as Record<string, unknown>).expires_in !== 'number'
    ) {
      console.error('[VertexAI] Unexpected token response shape for user:', uid);
      return null;
    }

    const validated = tokenData as { access_token: string; expires_in: number };
    const newExpiresAt = Date.now() + validated.expires_in * 1000;

    await updateDoc(userDocRef, {
      'vertexAI.accessToken': validated.access_token,
      'vertexAI.tokenExpiresAt': newExpiresAt,
    });

    return validated.access_token;
  } catch (error: unknown) {
    // Separate uid from format string to avoid tainted-format-string (CodeQL js/tainted-format-string)
    console.error('[VertexAI] Token refresh error for user:', uid, error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Retrieves valid Vertex AI credentials for a user.
 * Returns null if the user has no Vertex AI connection or if tokens cannot be refreshed.
 * On `invalid_grant`, cleans up the stored data (revoked/expired refresh token).
 */
export async function getValidVertexAICredentials(uid: string): Promise<VertexAICredentials | null> {
  const userDocRef = doc(db, 'users', uid);
  const userDoc = await getDoc(userDocRef);

  if (!userDoc.exists()) return null;

  const data = userDoc.data();
  const vertexAI = data?.vertexAI as VertexAIStoredData | undefined;

  if (!vertexAI?.refreshToken || !vertexAI.gcpProjectId) return null;

  // enabled가 명시적으로 false인 경우 Vertex AI 사용 비활성화 (인증정보는 유지)
  if (vertexAI.enabled === false) return null;

  const region = vertexAI.region || 'global';

  // Check if current access token is still valid (5-minute margin before expiry)
  if (
    vertexAI.accessToken &&
    vertexAI.tokenExpiresAt &&
    vertexAI.tokenExpiresAt > Date.now() + VERTEX_REFRESH_MARGIN_MS
  ) {
    return {
      accessToken: vertexAI.accessToken,
      projectId: vertexAI.gcpProjectId,
      region,
    };
  }

  // Token expired or missing — refresh it via shared helper
  const newAccessToken = await _refreshAccessToken(uid, vertexAI.refreshToken, userDocRef);
  if (!newAccessToken) return null;

  return { accessToken: newAccessToken, projectId: vertexAI.gcpProjectId, region };
}

/**
 * 사용자의 Vertex AI 연결 상태를 반환합니다.
 * lib/vertex-ai-oauth.js의 onStatusChange 콜백과 동일한 구조를 사용합니다.
 *   { connected: true,  minutesLeft: 42 }
 *   { connected: false, minutesLeft: 0  }
 */
export async function getVertexAIStatus(uid: string): Promise<VertexAIStatus> {
  const userDocRef = doc(db, 'users', uid);
  const userDoc = await getDoc(userDocRef);

  if (!userDoc.exists()) return { connected: false, minutesLeft: 0 };

  const data = userDoc.data();
  const vertexAI = data?.vertexAI as
    | { refreshToken?: string; tokenExpiresAt?: number }
    | undefined;

  if (!vertexAI?.refreshToken) return { connected: false, minutesLeft: 0 };

  const expiresAt = vertexAI.tokenExpiresAt ?? 0;
  const msLeft = Math.max(0, expiresAt - Date.now());
  const minutesLeft = Math.round(msLeft / 60_000);

  return { connected: true, minutesLeft };
}

/**
 * Returns a valid Vertex AI access token for a user, WITHOUT requiring gcpProjectId.
 * Used by routes that only need the token (e.g., listing GCP projects) and do not
 * need a specific project/region context.
 *
 * Priority:
 *   1. User OAuth token from Firestore (refreshed if needed)
 *   2. Returns null if user has no OAuth connection or token cannot be refreshed
 */
export async function getVertexAIAccessToken(uid: string): Promise<string | null> {
  const userDocRef = doc(db, 'users', uid);
  let userDoc;
  try {
    userDoc = await getDoc(userDocRef);
  } catch (err: unknown) {
    // Separate uid from format string to avoid tainted-format-string (CodeQL js/tainted-format-string)
    console.error('[VertexAI] Firestore read error for user:', uid, err instanceof Error ? err.message : String(err));
    return null;
  }

  if (!userDoc.exists()) return null;

  const data = userDoc.data();
  const vertexAI = data?.vertexAI as VertexAIStoredData | undefined;

  // Must have at least a refresh token to be considered connected
  if (!vertexAI?.refreshToken) return null;

  // Return cached access token if still valid (5-minute margin)
  if (
    vertexAI.accessToken &&
    vertexAI.tokenExpiresAt &&
    vertexAI.tokenExpiresAt > Date.now() + VERTEX_REFRESH_MARGIN_MS
  ) {
    return vertexAI.accessToken;
  }

  // Token expired or missing — refresh via shared helper
  return _refreshAccessToken(uid, vertexAI.refreshToken, userDocRef);
}
