import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { cookies } from 'next/headers';

interface SetRolesPayload {
  targetUid: string;
  isAdmin?: boolean;
  isSubadmin?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const requesterUid = cookieStore.get('uid')?.value;
    if (!requesterUid) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
    }

    const body = (await request.json()) as SetRolesPayload;
    const { targetUid, isAdmin, isSubadmin } = body || {};

    if (!targetUid || typeof targetUid !== 'string') {
      return NextResponse.json({ error: 'targetUid가 필요합니다.' }, { status: 400 });
    }

    // 요청자 권한 확인 (관리자만 권한 변경 가능)
    const requesterRef = doc(db, 'users', requesterUid);
    const requesterSnap = await getDoc(requesterRef);
    if (!requesterSnap.exists() || requesterSnap.data()?.isAdmin !== true) {
      return NextResponse.json({ error: '관리자 권한이 없습니다.' }, { status: 403 });
    }

    // 대상 사용자 문서 업데이트 (merge)
    const targetRef = doc(db, 'users', targetUid);
    await setDoc(
      targetRef,
      {
        isAdmin: isAdmin === true,
        isSubadmin: isSubadmin === true,
        rolesUpdatedAt: serverTimestamp(),
        rolesUpdatedBy: requesterUid,
      },
      { merge: true }
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('관리자 권한 설정 오류:', error);
    return NextResponse.json({ error: '권한 설정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}