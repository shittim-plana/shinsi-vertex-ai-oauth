import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import { doc, setDoc } from 'firebase/firestore';
import { GOOGLE_TOKEN_ENDPOINT } from '@/utils/vertex-ai/constants';

interface OAuthState {
  uid: string;
  projectId: string;
  region: string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const error = searchParams.get('error');

  const baseUrl = new URL(req.url).origin;

  // User denied consent or other OAuth error
  if (error) {
    console.error(`[VertexAI Callback] OAuth error: ${error}`);
    const redirectUrl = new URL('/settings', baseUrl);
    redirectUrl.searchParams.set('vertex_ai_status', 'error');
    redirectUrl.searchParams.set('vertex_ai_message', error);
    return NextResponse.redirect(redirectUrl);
  }

  if (!code || !stateParam) {
    return NextResponse.json(
      { error: 'Authorization code or state parameter missing.' },
      { status: 400 },
    );
  }

  // Decode state
  let state: OAuthState;
  try {
    state = JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf-8'));
  } catch {
    return NextResponse.json({ error: 'Invalid state parameter.' }, { status: 400 });
  }

  if (!state.uid) {
    return NextResponse.json({ error: 'uid missing in state.' }, { status: 400 });
  }

  const clientId = process.env.GCP_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GCP_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.VERTEX_AI_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error('[VertexAI Callback] Missing GCP OAuth env vars.');
    return NextResponse.json(
      { error: 'Vertex AI integration is not configured correctly.' },
      { status: 500 },
    );
  }

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
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

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}));
      console.error('[VertexAI Callback] Token exchange failed:', errorData);
      const redirectUrl = new URL('/settings', baseUrl);
      redirectUrl.searchParams.set('vertex_ai_status', 'error');
      redirectUrl.searchParams.set('vertex_ai_message', 'token_exchange_failed');
      return NextResponse.redirect(redirectUrl);
    }

    const tokenData: unknown = await tokenResponse.json();

    // Validate response shape — use 'in' narrowing (§8-E: no unsound assertions)
    if (
      !tokenData ||
      typeof tokenData !== 'object' ||
      !('access_token' in tokenData) ||
      !('refresh_token' in tokenData) ||
      !('expires_in' in tokenData) ||
      typeof (tokenData as Record<string, unknown>).access_token !== 'string' ||
      typeof (tokenData as Record<string, unknown>).refresh_token !== 'string' ||
      typeof (tokenData as Record<string, unknown>).expires_in !== 'number'
    ) {
      console.error('[VertexAI Callback] Unexpected token response:', tokenData);
      const redirectUrl = new URL('/settings', baseUrl);
      redirectUrl.searchParams.set('vertex_ai_status', 'error');
      redirectUrl.searchParams.set('vertex_ai_message', 'invalid_token_response');
      return NextResponse.redirect(redirectUrl);
    }

    const validated = tokenData as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope?: string;
    };

    // Store in Firestore
    const userDocRef = doc(db, 'users', state.uid);
    await setDoc(
      userDocRef,
      {
        vertexAI: {
          refreshToken: validated.refresh_token,
          accessToken: validated.access_token,
          tokenExpiresAt: Date.now() + validated.expires_in * 1000,
          gcpProjectId: state.projectId,
          region: state.region || 'global',
          connectedAt: Date.now(),
          scope: validated.scope || '',
        },
      },
      { merge: true },
    );

    console.log(`[VertexAI Callback] Successfully connected for user ${state.uid}`);

    const redirectUrl = new URL('/settings', baseUrl);
    redirectUrl.searchParams.set('vertex_ai_status', 'success');
    return NextResponse.redirect(redirectUrl);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[VertexAI Callback] Error:', errMsg);
    const redirectUrl = new URL('/settings', baseUrl);
    redirectUrl.searchParams.set('vertex_ai_status', 'error');
    redirectUrl.searchParams.set('vertex_ai_message', encodeURIComponent(errMsg));
    return NextResponse.redirect(redirectUrl);
  }
}
