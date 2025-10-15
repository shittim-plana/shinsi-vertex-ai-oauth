import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import { doc, updateDoc, getDoc, Timestamp } from 'firebase/firestore';
import { cookies } from 'next/headers';

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

    // 요청 본문에서 캐릭터 ID 가져오기
    const body = await request.json();
    const { characterId } = body;

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

    // 소유자 확인
    if (characterData.creatorId !== uid) {
      return NextResponse.json(
        { error: '이 캐릭터를 복구할 권한이 없습니다.' },
        { status: 403 }
      );
    }

    // 삭제되지 않은 캐릭터인지 확인
    if (!characterData.isDeleted) {
      return NextResponse.json(
        { error: '이미 활성화된 캐릭터입니다.' },
        { status: 400 }
      );
    }

    // 30일 경과 여부 확인
    if (characterData.deletedAt) {
      const deletedDate = characterData.deletedAt.toDate();
      const now = new Date();
      const daysSinceDeletion = Math.floor((now.getTime() - deletedDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysSinceDeletion >= 30) {
        return NextResponse.json(
          { error: '복구 기간이 만료되었습니다. (30일 경과)' },
          { status: 400 }
        );
      }
    }

    // 캐릭터 복구
    const updateData = {
      isDeleted: false,
      deletedAt: null,
      deletionReason: null,
      updatedAt: Timestamp.now()
    };

    await updateDoc(characterRef, updateData);

    return NextResponse.json({
      success: true,
      message: '캐릭터가 성공적으로 복구되었습니다.',
      characterId,
      restoredAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('캐릭터 복구 에러:', error);
    return NextResponse.json(
      { error: '캐릭터 복구 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}