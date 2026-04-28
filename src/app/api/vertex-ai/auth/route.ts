import { NextRequest, NextResponse } from 'next/server';
import {
  VERTEX_OAUTH_SCOPE,
  VERTEX_PROJECTS_SCOPE,
  GOOGLE_OAUTH_AUTHORIZE_URL,
} from '@/utils/vertex-ai/constants';

const VERTEX_AI_SCOPES = [VERTEX_OAUTH_SCOPE, VERTEX_PROJECTS_SCOPE];

export async function GET(req: NextRequest) {
  const clientId = process.env.GCP_OAUTH_CLIENT_ID;
  const redirectUri = process.env.VERTEX_AI_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    console.error('[VertexAI Auth] GCP_OAUTH_CLIENT_ID or VERTEX_AI_REDIRECT_URI not configured.');
    return NextResponse.json(
      { error: 'Vertex AI integration is not configured correctly.' },
      { status: 500 },
    );
  }

  const uid = req.nextUrl.searchParams.get('uid');
  if (!uid) {
    return NextResponse.json(
      { error: 'Firebase uid is required as a query parameter.' },
      { status: 400 },
    );
  }

  const projectId = req.nextUrl.searchParams.get('projectId') || '';
  // global은 의도적인 기본값 — Preview 모델(gemini-2.5-pro-preview 등)은 리전 선택 불가
  const region = req.nextUrl.searchParams.get('region') || 'global';

  // Encode state as base64 JSON (same pattern as Patreon OAuth using state param)
  const state = Buffer.from(JSON.stringify({ uid, projectId, region })).toString('base64url');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: VERTEX_AI_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const authUrl = `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;

  return NextResponse.redirect(authUrl);
}
