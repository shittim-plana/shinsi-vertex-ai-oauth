import { GoogleGenAI } from '@google/genai';
import { UserRefreshClient } from 'google-auth-library';
// @ts-ignore - Incompatibility between local google-auth-library and @google/genai's bundled version
import type { GoogleAuthOptions } from '@google/genai';

/**
 * Creates a GoogleGenAI instance configured for Vertex AI using a user's OAuth access token.
 *
 * Auth isolation strategy:
 *   A UserRefreshClient is pre-seeded with the user's access token and passed as
 *   googleAuthOptions.authClient. GoogleAuth caches it as cachedCredential, so
 *   NodeAuth.addGoogleAuthHeaders() calls getRequestHeaders() on THIS client rather
 *   than going through the ADC chain (GOOGLE_APPLICATION_CREDENTIALS, well-known file,
 *   metadata server). This means the server service-account key file is never read during
 *   user-OAuth-path requests, eliminating any chance of key material appearing in error
 *   messages. The fix is stateless per call (no global mutation) and race-condition-free.
 *
 * The SDK natively maps location='global' → https://aiplatform.googleapis.com and
 * location='{region}' → https://{region}-aiplatform.googleapis.com.
 */
export function createVertexAIGenAI(
  accessToken: string,
  projectId: string,
  region: string,
): GoogleGenAI {
  // UserRefreshClient is assignable to JSONClient (= JWT | UserRefreshClient | …),
  // which is the expected authClient type in GoogleAuthOptions.
  const authClient = new UserRefreshClient();
  // setCredentials is defined on AuthClient and inherited by UserRefreshClient.
  // With access_token set and no expiry_date, isTokenExpiring() returns false, so
  // getRequestHeaders() returns the token immediately without any network call.
  authClient.setCredentials({ access_token: accessToken, token_type: 'Bearer' });

  return new GoogleGenAI({
    vertexai: true,
    project: projectId,
    location: region,
    googleAuthOptions: { authClient: authClient as any },
  });
}
