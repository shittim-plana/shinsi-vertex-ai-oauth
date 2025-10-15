import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/firebase/config';
import { doc, getDoc } from 'firebase/firestore';

interface ImpersonatePayload {
  targetUid: string;
  // optional days to persist cookie; default short session
  days?: number;
}

/**
 * Admin-only: Set the 'uid' cookie to target user's UID to access their session by URL.
 * Adds 'impersonating' and 'impersonator' cookies for traceability.
 * NOTE:
 * - This endpoint only sets cookies. It does not change Firebase Auth identity.
 * - Client/UI must still handle admin overrides for protected pages.
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const requesterUid = cookieStore.get('uid')?.value;

    if (!requesterUid) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
    }

    const body = (await request.json()) as ImpersonatePayload;
    const targetUid = String(body?.targetUid || '').trim();
    const days = typeof body?.days === 'number' && body.days > 0 ? body.days : 1;

    if (!targetUid) {
      return NextResponse.json({ error: 'targetUid가 필요합니다.' }, { status: 400 });
    }

    // 권한 확인: 관리자만 세션 가장 가능
    const requesterRef = doc(db, 'users', requesterUid);
    const requesterSnap = await getDoc(requesterRef);
    if (!requesterSnap.exists() || requesterSnap.data()?.isAdmin !== true) {
      return NextResponse.json({ error: '관리자 권한이 없습니다.' }, { status: 403 });
    }

    // 대상 사용자 존재 여부 체크(선택적, 문서 없더라도 허용하려면 주석 처리)
    const targetRef = doc(db, 'users', targetUid);
    const targetSnap = await getDoc(targetRef);
    if (!targetSnap.exists()) {
      // 문서가 없으면 경고만 주고 진행하거나, 강제 차단할 수 있음.
      // 여기서는 차단.
      return NextResponse.json({ error: '대상 사용자 문서를 찾을 수 없습니다.' }, { status: 404 });
    }

    const res = NextResponse.json({ success: true, targetUid });

    // uid를 대상 사용자로 설정
    const maxAge = Math.floor(days * 24 * 60 * 60);
    res.cookies.set('uid', targetUid, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      // secure: true, // HTTPS 환경에서 권장
      maxAge,
    });

    // 추적용 쿠키 설정
    res.cookies.set('impersonating', 'true', {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge,
    });
    res.cookies.set('impersonator', requesterUid, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge,
    });

    return res;
  } catch (error: any) {
    console.error('Admin impersonate error:', error);
    return NextResponse.json({ error: '세션 가장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}