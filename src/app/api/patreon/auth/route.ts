// src/app/api/patreon/auth/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const clientId = process.env.PATREON_CLIENT_ID;
  const access_token = process.env.PATREON_ACCESS_TOKEN;
  const redirectUri = process.env.PATREON_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    console.error('Patreon client ID or redirect URI is not configured.');
    return NextResponse.json(
      { error: 'Patreon integration is not configured correctly.' },
      { status: 500 }
    );
  }

  // 필요한 scope 정의 (기획서에 명시된 정보 접근을 위해)
  // identity: 사용자 기본 정보 (이름, 이메일 등)
  // identity[email]: 이메일 주소
  // identity.memberships: 사용자의 멤버십 정보 (후원 티어 등)
  // campaigns: 캠페인 정보 (선택적, 캠페인 세부 정보 필요시)
  // w:campaigns.webhook: 웹훅 관련 (Patreon에서 웹훅 설정 시 필요할 수 있음)
  const scopes = [
    'identity',
    'identity[email]',
    'identity.memberships',
    // 'campaigns', // 필요시 추가
    // 'w:campaigns.webhook' // 필요시 추가
  ];
  const scopeString = scopes.join('%20'); // URL 인코딩된 공백

  // 클라이언트에서 전달된 Firebase 사용자 이메일을 가져옵니다.
  const userEmail = req.nextUrl.searchParams.get('email');

  if (!userEmail) {
    return NextResponse.json(
      { error: 'Firebase user email (email) is required as a query parameter.' },
      { status: 400 }
    );
  }

  // const memberInfoResponse = await fetch(
  //   `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=UA-iGwnODZM7NzbGch-hGMmVBScnWlS2-iE7EwieX_tGSel6l4FQjZOFdwwgxY1M&redirect_uri=${redirectUri}&scope=identity.memberships%20identity`,
  //   {
  //     headers: {
  //       Authorization: `Bearer ${access_token}`,
  //     },
  //   }
  // );

  // Firebase 사용자 이메일을 state 파라미터로 사용합니다.
  // 실제 프로덕션에서는 CSRF 토큰과 함께 사용하거나 암호화하는 것을 고려해야 합니다.
  // 또한, 이메일은 URL에 안전하게 인코딩되어야 할 수 있습니다. 여기서는 Patreon이 state를 그대로 반환한다고 가정합니다.
  const state = userEmail;

  const patreonAuthUrl = `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopeString}&state=${encodeURIComponent(state)}`;

  return NextResponse.redirect(patreonAuthUrl, {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
