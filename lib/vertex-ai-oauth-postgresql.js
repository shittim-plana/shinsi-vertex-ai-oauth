/**
 * vertex-ai-oauth — PostgreSQL Token Manager (Server-side Reference Implementation)
 *
 * Manages OAuth 2.0 tokens for Vertex AI using PostgreSQL instead of localStorage/Firestore.
 * Requires a `vertex_ai_connections` table and a PostgreSQL query function.
 *
 * Usage:
 *   const { createTokenManager } = require('./vertex-ai-oauth-postgresql');
 *   const manager = createTokenManager({ query, clientId, clientSecret });
 *   const creds = await manager.getValidCredentials(uid);
 *
 * Table schema:
 *   CREATE TABLE vertex_ai_connections (
 *     user_id VARCHAR(255) PRIMARY KEY,
 *     refresh_token TEXT NOT NULL,
 *     access_token TEXT,
 *     token_expires_at BIGINT NOT NULL,
 *     gcp_project_id VARCHAR(255) NOT NULL,
 *     region VARCHAR(50) DEFAULT 'global',
 *     scope TEXT,
 *     enabled BOOLEAN DEFAULT true,
 *     connected_at BIGINT NOT NULL,
 *     updated_at BIGINT NOT NULL
 *   );
 *
 * @license See LICENSE in repository root
 */

'use strict';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes before expiry

/**
 * @param {Object} opts
 * @param {function(string, any[]): Promise<{rows: any[]}>} opts.query - PostgreSQL query function
 * @param {string} opts.clientId - GCP OAuth Client ID
 * @param {string} opts.clientSecret - GCP OAuth Client Secret
 * @param {number} [opts.refreshMarginMs] - Refresh margin in ms (default: 5 min)
 */
function createTokenManager(opts) {
  const { query, clientId, clientSecret, refreshMarginMs = REFRESH_MARGIN_MS } = opts;

  if (!query) throw new Error('vertex-ai-oauth-postgresql: query function is required');
  if (!clientId || !clientSecret) throw new Error('vertex-ai-oauth-postgresql: clientId and clientSecret are required');

  async function _refreshAccessToken(uid, refreshToken) {
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
      if (errorData.error === 'invalid_grant') {
        await query('DELETE FROM vertex_ai_connections WHERE user_id = $1', [uid]);
        return null;
      }
      return null;
    }

    const tokenData = await response.json();
    if (!tokenData.access_token || typeof tokenData.expires_in !== 'number') return null;

    const now = Date.now();
    await query(
      'UPDATE vertex_ai_connections SET access_token = $1, token_expires_at = $2, updated_at = $3 WHERE user_id = $4',
      [tokenData.access_token, now + tokenData.expires_in * 1000, now, uid],
    );

    return tokenData.access_token;
  }

  return {
    /**
     * Get valid Vertex AI credentials, refreshing if needed.
     * @param {string} uid
     * @returns {Promise<{accessToken: string, projectId: string, region: string}|null>}
     */
    async getValidCredentials(uid) {
      const result = await query('SELECT * FROM vertex_ai_connections WHERE user_id = $1', [uid]);
      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      if (!row.refresh_token || !row.gcp_project_id) return null;
      if (row.enabled === false) return null;

      const region = row.region || 'global';

      if (row.access_token && Number(row.token_expires_at) > Date.now() + refreshMarginMs) {
        return { accessToken: row.access_token, projectId: row.gcp_project_id, region };
      }

      const newToken = await _refreshAccessToken(uid, row.refresh_token);
      if (!newToken) return null;
      return { accessToken: newToken, projectId: row.gcp_project_id, region };
    },

    /**
     * Get connection status (no tokens exposed).
     * @param {string} uid
     * @returns {Promise<{connected: boolean, minutesLeft: number}>}
     */
    async getStatus(uid) {
      const result = await query(
        'SELECT refresh_token, token_expires_at FROM vertex_ai_connections WHERE user_id = $1',
        [uid],
      );
      if (result.rows.length === 0) return { connected: false, minutesLeft: 0 };
      const row = result.rows[0];
      if (!row.refresh_token) return { connected: false, minutesLeft: 0 };
      const msLeft = Math.max(0, Number(row.token_expires_at) - Date.now());
      return { connected: true, minutesLeft: Math.round(msLeft / 60000) };
    },

    /**
     * Store tokens from OAuth callback.
     * @param {Object} params
     */
    async storeTokens({ uid, refreshToken, accessToken, expiresIn, projectId, region, scope }) {
      const now = Date.now();
      await query(
        `INSERT INTO vertex_ai_connections
          (user_id, refresh_token, access_token, token_expires_at, gcp_project_id, region, scope, enabled, connected_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $8)
         ON CONFLICT (user_id) DO UPDATE SET
          refresh_token = $2, access_token = $3, token_expires_at = $4,
          gcp_project_id = $5, region = $6, scope = $7, enabled = true, updated_at = $8`,
        [uid, refreshToken, accessToken, now + expiresIn * 1000, projectId, region || 'global', scope || '', now],
      );
    },

    /**
     * Disconnect: revoke tokens at Google and delete from DB.
     * @param {string} uid
     */
    async disconnect(uid) {
      const result = await query(
        'SELECT refresh_token, access_token FROM vertex_ai_connections WHERE user_id = $1',
        [uid],
      );
      if (result.rows.length > 0) {
        const { refresh_token, access_token } = result.rows[0];
        for (const token of [refresh_token, access_token].filter(Boolean)) {
          try {
            await fetch(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            });
          } catch { /* best-effort */ }
        }
      }
      await query('DELETE FROM vertex_ai_connections WHERE user_id = $1', [uid]);
    },
  };
}

module.exports = { createTokenManager, GOOGLE_TOKEN_ENDPOINT, GOOGLE_REVOKE_ENDPOINT };
