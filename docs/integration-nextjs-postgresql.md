# Next.js + PostgreSQL Integration Guide

Server-side Vertex AI OAuth integration using Next.js API Routes and PostgreSQL token storage.

This pattern is used when:
- Your app already has a PostgreSQL database
- You need server-side token management (no client-side token exposure)
- Users connect their own GCP project via OAuth and the API usage is billed to their account

---

## Architecture

```
User clicks "Connect"
  → /api/vertex-ai/auth (generates Google OAuth URL with state)
  → Google OAuth consent screen
  → /api/vertex-ai/callback (exchanges code → tokens → PostgreSQL)
  → Redirect to settings page

AI request:
  → token-manager reads from PostgreSQL
  → If expired, refreshes via Google token endpoint
  → Calls Vertex AI with user's credentials
  → User's GCP project is billed (not the server)
```

---

## PostgreSQL Schema

```sql
CREATE TABLE vertex_ai_connections (
  user_id VARCHAR(255) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  token_expires_at BIGINT NOT NULL,
  gcp_project_id VARCHAR(255) NOT NULL,
  region VARCHAR(50) DEFAULT 'global',
  scope TEXT,
  enabled BOOLEAN DEFAULT true,
  connected_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
```

---

## API Routes

### POST /api/vertex-ai/auth

Generates Google OAuth URL and redirects the user.

Query params: `uid`, `projectId`, `region`, `locale`

The `state` parameter encodes `{ uid, projectId, region, locale }` as base64url JSON.

### GET /api/vertex-ai/callback

Handles Google OAuth callback:
1. Exchanges authorization code for tokens
2. Stores tokens in `vertex_ai_connections` table (INSERT ON CONFLICT DO UPDATE)
3. Redirects to `/{locale}/settings?vertex_ai_status=success`

### GET /api/vertex-ai/status?uid={uid}

Returns connection status for UI display. Does not expose tokens.

```json
{ "isConnected": true, "projectId": "my-project", "region": "global", "connectedAt": 1717000000000, "minutesLeft": 42 }
```

### POST /api/vertex-ai/disconnect

Revokes tokens at Google (best-effort) and deletes the row from PostgreSQL.

---

## Token Manager

Server-side module that handles token lifecycle:

```typescript
import { query } from '@/utils/vector/postgresClient';

// Get valid credentials (auto-refreshes if expired)
const creds = await getValidVertexAICredentials(uid);
// Returns: { accessToken, projectId, region } | null

// Get access token only (for project listing, verification)
const token = await getVertexAIAccessToken(uid);

// Get connection status (for UI)
const status = await getVertexAIStatus(uid);
// Returns: { connected: boolean, minutesLeft: number }
```

Refresh margin: 5 minutes before expiry (`VERTEX_REFRESH_MARGIN_MS`).

On `invalid_grant` (user revoked access), the row is automatically deleted.

---

## Client Component (React)

```typescript
// VertexAIConnection.tsx
const loadVertexAIData = useCallback(async () => {
  const res = await fetch(`/api/vertex-ai/status?uid=${uid}`);
  const data = await res.json();
  if (data.isConnected) {
    setVertexData(data);
  } else {
    setVertexData(null);
  }
}, [uid]);

const handleConnect = () => {
  const locale = window.location.pathname.split('/')[1] || 'ko';
  const params = new URLSearchParams({ uid, projectId, region, locale });
  window.location.href = `/api/vertex-ai/auth?${params.toString()}`;
};
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GCP_OAUTH_CLIENT_ID` | Google OAuth 2.0 Client ID |
| `GCP_OAUTH_CLIENT_SECRET` | Google OAuth 2.0 Client Secret (server-side only) |
| `VERTEX_AI_REDIRECT_URI` | Full callback URL (e.g. `https://yourdomain.com/api/vertex-ai/callback`) |
| `POSTGRES_URL` or `DATABASE_URL` | PostgreSQL connection string |

The redirect URI must be registered in Google Cloud Console under **Authorized redirect URIs**.

---

## Security

- Tokens are stored in PostgreSQL as plaintext (server-side only, never exposed to client)
- The `/api/vertex-ai/status` endpoint returns only non-sensitive fields (projectId, region, connectedAt)
- `clientSecret` is used only in server-side token exchange — never sent to the browser
- All API costs are billed to the user's own GCP project, not the hosting server
