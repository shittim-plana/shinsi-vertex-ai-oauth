import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import { doc, updateDoc, getDoc, Timestamp } from 'firebase/firestore';
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

    // 요청 파라미터/본문에서 캐릭터 ID와 삭제 사유 가져오기 (DELETE 본문 미전달 대응)
    const url = new URL(request.url);
    let characterId = url.searchParams.get('characterId');
    let reason = url.searchParams.get('reason') || undefined;

    // 일부 환경에서 DELETE 본문이 전달되지 않을 수 있어 안전 파싱 시도
    if (!characterId) {
      try {
        const body = await request.json();
        characterId = body?.characterId ?? characterId;
        reason = (body?.reason ?? reason) as string | undefined;
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
        { error: '이 캐릭터를 삭제할 권한이 없습니다.' },
        { status: 403 }
      );
    }

    // 이미 삭제된 캐릭터인지 확인
    if (characterData.isDeleted) {
      return NextResponse.json(
        { error: '이미 삭제된 캐릭터입니다.' },
        { status: 400 }
      );
    }

    // 소프트 삭제 실행
    const updateData = {
      isDeleted: true,
      deletedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      ...(reason && { deletionReason: reason })
    };

    await updateDoc(characterRef, updateData);

    return NextResponse.json({
      success: true,
      message: '캐릭터가 성공적으로 삭제되었습니다.',
      characterId,
      deletedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('캐릭터 삭제 에러:', error);
    return NextResponse.json(
      { error: '캐릭터 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 일괄 삭제 지원
export async function POST(request: NextRequest) {
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

    // 요청 본문에서 캐릭터 ID 배열과 삭제 사유 가져오기
    const body = await request.json();
    const { characterIds, reason } = body;

    if (!characterIds || !Array.isArray(characterIds) || characterIds.length === 0) {
      return NextResponse.json(
        { error: '삭제할 캐릭터 ID 배열이 필요합니다.' },
        { status: 400 }
      );
    }

    const results = [];
    const errors = [];

    // 요청자 권한 확인 (관리자/부관리자)
    let isPrivileged = false;
    try {
      const requesterRef = doc(db, 'users', uid);
      const requesterSnap = await getDoc(requesterRef);
      if (requesterSnap.exists()) {
        const rd = requesterSnap.data() as any;
        isPrivileged = !!(rd.isAdmin || rd.isSubadmin);
      }
    } catch {}

    // 각 캐릭터에 대해 소프트 삭제 실행
    for (const characterId of characterIds) {
      try {
        const characterRef = doc(db, 'characters', characterId);
        const characterDoc = await getDoc(characterRef);

        if (!characterDoc.exists()) {
          errors.push({ characterId, error: '캐릭터를 찾을 수 없습니다.' });
          continue;
        }

        const characterData = characterDoc.data();

        // 소유자 또는 관리자/부관리자 확인
        if (characterData.creatorId !== uid && !isPrivileged) {
          errors.push({ characterId, error: '삭제 권한이 없습니다.' });
          continue;
        }

        // 이미 삭제된 캐릭터인지 확인
        if (characterData.isDeleted) {
          errors.push({ characterId, error: '이미 삭제된 캐릭터입니다.' });
          continue;
        }

        // 소프트 삭제 실행
        const updateData = {
          isDeleted: true,
          deletedAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          ...(reason && { deletionReason: reason })
        };

        await updateDoc(characterRef, updateData);
        results.push({ 
          characterId, 
          success: true, 
          deletedAt: new Date().toISOString() 
        });

      } catch (error) {
        console.error(`캐릭터 ${characterId} 삭제 에러:`, error);
        errors.push({ characterId, error: '삭제 중 오류가 발생했습니다.' });
      }
    }

    return NextResponse.json({
      success: true,
      message: `${results.length}개 캐릭터가 삭제되었습니다.`,
      results,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('일괄 캐릭터 삭제 에러:', error);
    return NextResponse.json(
      { error: '일괄 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}