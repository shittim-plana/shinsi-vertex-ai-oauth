import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import { doc, deleteDoc, getDoc } from 'firebase/firestore';
import { cookies } from 'next/headers';

export async function DELETE(request: NextRequest) {
  try {
    // 쿠키에서 UID 가져오기
    const cookieStore = await cookies();
    const uid = cookieStore.get('uid')?.value;
    
    if (!uid) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 }
      );
    }

    // 요청 파라미터/본문에서 캐릭터 ID 가져오기 (DELETE 본문 미전달 대응)
    const url = new URL(request.url);
    let characterId = url.searchParams.get('characterId');

    if (!characterId) {
      try {
        const body = await request.json();
        characterId = body?.characterId ?? characterId;
      } catch {
        // ignore JSON parse error
      }
    }

    if (!characterId) {
      return NextResponse.json(
        { error: '캐릭터 ID가 필요합니다.' },
        { status: 400 }
      );
    }

    // 캐릭터 문서 참조
    const characterRef = doc(db, 'characters', characterId);
    const characterDoc = await getDoc(characterRef);

    if (!characterDoc.exists()) {
      return NextResponse.json(
        { error: '캐릭터를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    const characterData = characterDoc.data();

    // 권한 확인: 소유자 또는 관리자/부관리자
    let isPrivileged = false;
    try {
      const requesterRef = doc(db, 'users', uid);
      const requesterSnap = await getDoc(requesterRef);
      if (requesterSnap.exists()) {
        const rd = requesterSnap.data() as any;
        isPrivileged = !!(rd.isAdmin || rd.isSubadmin);
      }
    } catch {}

    if (characterData.creatorId !== uid && !isPrivileged) {
      return NextResponse.json(
        { error: '이 캐릭터를 영구 삭제할 권한이 없습니다.' },
        { status: 403 }
      );
    }

    // 삭제된 캐릭터인지 확인 (안전 장치)
    if (!characterData.isDeleted) {
      return NextResponse.json(
        { error: '먼저 캐릭터를 삭제해야 합니다.' },
        { status: 400 }
      );
    }

    // 영구 삭제 실행
    await deleteDoc(characterRef);

    return NextResponse.json({
      success: true,
      message: '캐릭터가 영구적으로 삭제되었습니다.',
      characterId,
      deletedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('캐릭터 영구 삭제 에러:', error);
    return NextResponse.json(
      { error: '캐릭터 영구 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}