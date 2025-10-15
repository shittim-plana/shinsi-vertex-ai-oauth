import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import { doc, updateDoc, serverTimestamp, runTransaction, getDoc } from 'firebase/firestore';
import { cookies } from 'next/headers';

interface ConvertRoomRequest {
  roomId: string;
  targetType: 'group' | 'private';
  reason?: string;
  auto?: boolean;
  characterId?: string; // private로 전환 시 남을 캐릭터 ID
}

export async function POST(request: NextRequest) {
  try {
    // 쿠키에서 UID 가져오기
    const cookieStore = await cookies();
    const uid = cookieStore.get('uid')?.value;

    if (!uid) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
    }

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

    const body: ConvertRoomRequest = await request.json();
    const { roomId, targetType, reason = '', auto = false, characterId } = body;

    if (!roomId || !targetType) {
      return NextResponse.json({ 
        error: '채팅방 ID와 전환 타입이 필요합니다.' 
      }, { status: 400 });
    }

    // 트랜잭션으로 안전하게 데이터 변경
    const result = await runTransaction(db, async (transaction) => {
      const roomRef = doc(db, 'chatRooms', roomId);
      const roomDoc = await transaction.get(roomRef);

      if (!roomDoc.exists()) {
        throw new Error('채팅방을 찾을 수 없습니다.');
      }

      const roomData = roomDoc.data();

      // 권한 확인: 생성자 또는 관리자/부관리자
      if (roomData.creatorId !== uid && !isPrivileged) {
        throw new Error('채팅방 전환 권한이 없습니다.');
      }

      const currentType = roomData.isGroupChat ? 'group' : 'private';
      
      // 이미 목표 타입인 경우
      if (currentType === targetType) {
        throw new Error(`이미 ${targetType === 'group' ? '그룹' : '개인'} 채팅방입니다.`);
      }

      // 전환 히스토리 생성
      const conversionEntry = {
        fromType: currentType,
        toType: targetType,
        timestamp: serverTimestamp(),
        reason: reason || (auto ? '자동 전환 (캐릭터 1명 남음)' : '수동 전환'),
        triggeredBy: auto ? 'auto' : 'manual',
        ...(targetType === 'private' && characterId && { characterId })
      };

      let updateData: any = {
        conversionHistory: [...(roomData.conversionHistory || []), conversionEntry]
      };

      if (targetType === 'private') {
        // 그룹 → 개인 전환
        if (!characterId) {
          throw new Error('개인 채팅방 전환 시 캐릭터 ID가 필요합니다.');
        }

        // 선택된 캐릭터가 현재 채팅방에 있는지 확인
        const currentCharacterIds = roomData.characterIds || [];
        if (!currentCharacterIds.includes(characterId)) {
          throw new Error('선택된 캐릭터가 현재 채팅방에 없습니다.');
        }

        updateData = {
          ...updateData,
          isGroupChat: false,
          type: 'private', // 명시적 타입 설정
          characterId: characterId,
          // 그룹 채팅 전용 필드 정리
          characterIds: null,
          activeCharacterIds: null,
          nextSpeakerIndex: null
        };

      } else {
        // 개인 → 그룹 전환
        const currentCharacterId = roomData.characterId;
        if (!currentCharacterId) {
          throw new Error('현재 캐릭터 정보를 찾을 수 없습니다.');
        }

        updateData = {
          ...updateData,
          isGroupChat: true,
          type: 'group', // 명시적 타입 설정
          characterIds: [currentCharacterId],
          activeCharacterIds: [currentCharacterId],
          nextSpeakerIndex: 0,
          // 개인 채팅 전용 필드 정리
          characterId: null
        };
      }

      // Firestore 업데이트
      transaction.update(roomRef, updateData);

      return {
        success: true,
        roomId,
        fromType: currentType,
        toType: targetType,
        auto,
        characterId: targetType === 'private' ? characterId : undefined
      };
    });

    return NextResponse.json(result);

  } catch (error) {
    console.error('채팅방 전환 중 오류 발생:', error);
    
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    
    return NextResponse.json({ 
      error: `채팅방 전환 실패: ${errorMessage}` 
    }, { status: 500 });
  }
}