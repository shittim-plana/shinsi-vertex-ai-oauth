import { NextRequest, NextResponse } from 'next/server';
import { getValidVertexAICredentials } from '@/utils/vertex-ai/token-manager';
import { createVertexAIGenAI } from '@/utils/vertex-ai/client';

export interface VerifyStep {
  name: string;
  ok: boolean;
  message: string;
}

export interface VerifyResult {
  allOk: boolean;
  steps: VerifyStep[];
}

/**
 * POST /api/vertex-ai/verify
 * Runs a step-by-step integrity check of the Vertex AI OAuth integration:
 *   1. Server configuration (env vars present)
 *   2. User credentials (valid access token)
 *   3. Vertex AI connectivity (real generateContent call)
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { uid?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { uid } = body;
  if (!uid) {
    return NextResponse.json({ error: 'uid is required.' }, { status: 400 });
  }

  const steps: VerifyStep[] = [];

  // ── Step 1: Server configuration ──────────────────────────────────────────
  const clientId = process.env.GCP_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GCP_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.VERTEX_AI_REDIRECT_URI;

  const configOk = Boolean(clientId && clientSecret && redirectUri);
  steps.push({
    name: '서버 설정 (환경 변수)',
    ok: configOk,
    message: configOk
      ? 'GCP_OAUTH_CLIENT_ID, GCP_OAUTH_CLIENT_SECRET, VERTEX_AI_REDIRECT_URI 설정됨'
      : `누락된 환경 변수: ${[
          !clientId && 'GCP_OAUTH_CLIENT_ID',
          !clientSecret && 'GCP_OAUTH_CLIENT_SECRET',
          !redirectUri && 'VERTEX_AI_REDIRECT_URI',
        ]
          .filter(Boolean)
          .join(', ')}`,
  });

  if (!configOk) {
    return NextResponse.json({ allOk: false, steps } satisfies VerifyResult);
  }

  // ── Step 2: User credentials (token fetch / refresh) ───────────────────────
  let creds: Awaited<ReturnType<typeof getValidVertexAICredentials>>;
  try {
    creds = await getValidVertexAICredentials(uid);
  } catch (err: unknown) {
    // Firestore or token-manager errors — server-internal, not user-actionable.
    console.error('[VertexAI Verify] Step 2 token fetch error:', err);
    steps.push({ name: '사용자 인증 토큰', ok: false, message: '토큰 조회 중 서버 오류가 발생했습니다. 서버 로그를 확인하세요.' });
    return NextResponse.json({ allOk: false, steps } satisfies VerifyResult);
  }

  if (!creds) {
    steps.push({
      name: '사용자 인증 토큰',
      ok: false,
      message: 'Vertex AI 연결 정보가 없습니다. GCP 계정을 먼저 연결하세요.',
    });
    return NextResponse.json({ allOk: false, steps } satisfies VerifyResult);
  }

  steps.push({
    name: '사용자 인증 토큰',
    ok: true,
    message: `액세스 토큰 유효 (프로젝트: ${creds.projectId}, 리전: ${creds.region})`,
  });

  // ── Step 3: Vertex AI connectivity (minimal generateContent call) ───────────
  // gemini-2.5-flash is a GA model that requires a real regional endpoint.
  // 'global' (https://aiplatform.googleapis.com) is intentionally the default because
  // Preview models (e.g. gemini-2.5-pro-preview) only work there, but gemini-2.5-flash
  // may not. If the first attempt throws, automatically retry with VERIFY_FALLBACK_REGION.
  // Empty response is not a region issue — fail immediately without retrying.
  const VERIFY_MODEL = 'gemini-2.5-flash';
  const VERIFY_FALLBACK_REGION = 'us-central1';
  const regionsToTry: string[] =
    creds.region !== VERIFY_FALLBACK_REGION
      ? [creds.region, VERIFY_FALLBACK_REGION]
      : [creds.region];

  let lastError: unknown = null;
  let succeededRegion: string | null = null;

  for (const tryRegion of regionsToTry) {
    try {
      const genAI = createVertexAIGenAI(creds.accessToken, creds.projectId, tryRegion);
      const response = await genAI.models.generateContent({
        model: VERIFY_MODEL,
        contents: [{ role: 'user', parts: [{ text: 'Say "ok" in one word.' }] }],
        config: {
          maxOutputTokens: 50,
          // Disable thinking to prevent thinking tokens from consuming the
          // entire output budget before any response text is generated.
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      const text = response?.text ?? '';
      if (!text) {
        // Empty response is a model/project problem, not a region problem — don't retry.
        const finishReason = response?.candidates?.[0]?.finishReason;
        const blockReason = response?.promptFeedback?.blockReason;
        const detail = [
          finishReason && `finishReason: ${finishReason}`,
          blockReason && `blockReason: ${blockReason}`,
        ]
          .filter(Boolean)
          .join(', ');
        steps.push({
          name: 'Vertex AI API 응답',
          ok: false,
          message: detail
            ? `빈 응답 수신 (${detail})`
            : '빈 응답 수신 (모델 또는 프로젝트 설정 확인 필요)',
        });
        return NextResponse.json({ allOk: false, steps } satisfies VerifyResult);
      }

      succeededRegion = tryRegion;
      break;
    } catch (err: unknown) {
      lastError = err;
      if (tryRegion !== regionsToTry[regionsToTry.length - 1]) {
        // Auth isolation in client.ts ensures this error originates from the GCP Vertex AI API.
        // Log at warn level since we are about to retry with a fallback region.
        console.warn(
          `[VertexAI Verify] Step 3 failed with region '${tryRegion}', retrying with '${VERIFY_FALLBACK_REGION}':`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  if (!succeededRegion) {
    // Auth isolation in client.ts ensures this error originates from the GCP Vertex AI API
    // response (e.g. API not enabled, quota exceeded, billing error) — never from ADC or
    // the server service-account file. Return the raw message so the user can diagnose
    // their own GCP project state directly.
    console.error('[VertexAI Verify] Step 3 API call error (all regions failed):', lastError);
    steps.push({
      name: 'Vertex AI API 응답',
      ok: false,
      message: lastError instanceof Error ? lastError.message : String(lastError),
    });
    return NextResponse.json({ allOk: false, steps } satisfies VerifyResult);
  }

  const fallbackNote =
    succeededRegion !== creds.region
      ? ` (리전 폴백: ${creds.region} → ${succeededRegion})`
      : '';
  steps.push({
    name: 'Vertex AI API 응답',
    ok: true,
    message: `API 정상 응답 수신 (모델: ${VERIFY_MODEL}${fallbackNote})`,
  });

  return NextResponse.json({ allOk: true, steps } satisfies VerifyResult);
}
