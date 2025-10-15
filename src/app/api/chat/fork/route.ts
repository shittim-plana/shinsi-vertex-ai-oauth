export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import { ChatRoom, Message } from '../../../../types/chat';
import { collection, doc, runTransaction, query, where, orderBy, getDocs, Timestamp } from 'firebase/firestore';
import { cookies } from 'next/headers';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  try {
    // 쿠키에서 UID 가져오기
    const cookieStore = await cookies();
    const uid = cookieStore.get('uid')?.value;
    
    if (!uid) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
    }

    const body = await request.json();
    
    // 🔍 DEBUG LOG: API에서 받은 요청 데이터 상세 분석
    console.log('[DEBUG] Fork API received request:', {
      fullRequestBody: body,
      bodyKeys: Object.keys(body),
      bodyValues: Object.values(body)
    });
    
    const {
      originalRoomId,
      forkFromMessageId,
      forkDescription
    }: {
      originalRoomId: string;
      forkFromMessageId: string;
      forkDescription?: string;
    } = body;

    // 🔍 DEBUG LOG: 추출된 필드 상세 분석
    console.log('[DEBUG] Fork API extracted fields:', {
      extractedFields: {
        originalRoomId,
        forkFromMessageId,
        forkDescription
      },
      fieldTypes: {
        originalRoomId: typeof originalRoomId,
        forkFromMessageId: typeof forkFromMessageId,
        forkDescription: typeof forkDescription
      },
      validationCheck: {
        hasOriginalRoomId: !!originalRoomId,
        hasForkFromMessageId: !!forkFromMessageId,
        originalRoomIdTruthy: Boolean(originalRoomId),
        forkFromMessageIdTruthy: Boolean(forkFromMessageId)
      }
    });

    if (!originalRoomId || !forkFromMessageId) {
      // 🔍 DEBUG LOG: 누락된 필드 상세 정보
      console.error('[DEBUG] Missing required fields validation failed:', {
        missingOriginalRoomId: !originalRoomId,
        missingForkFromMessageId: !forkFromMessageId,
        originalRoomIdCheck: { value: originalRoomId, type: typeof originalRoomId, truthy: !!originalRoomId },
        forkFromMessageIdCheck: { value: forkFromMessageId, type: typeof forkFromMessageId, truthy: !!forkFromMessageId },
        fullBody: body
      });
      
      return NextResponse.json({
        error: '필수 매개변수가 누락되었습니다.'
      }, { status: 400 });
    }

    // Firestore 트랜잭션으로 데이터 일관성 보장
    const result = await runTransaction(db, async (transaction) => {
      // 1. 원본 채팅방 정보 가져오기
      const originalRoomRef = doc(db, 'chatRooms', originalRoomId);
      const originalRoomDoc = await transaction.get(originalRoomRef);
      
      if (!originalRoomDoc.exists()) {
        throw new Error('원본 채팅방을 찾을 수 없습니다.');
      }

      const originalRoom = originalRoomDoc.data() as ChatRoom;

      // 2. 분기점 메시지까지의 모든 메시지 가져오기
      const messagesRef = collection(db, 'chatRooms', originalRoomId, 'messages');
      const messagesQuery = query(messagesRef, orderBy('timestamp', 'asc'));
      const messagesSnapshot = await getDocs(messagesQuery);
      
      const allMessages: Message[] = [];
      let forkFromMessage: Message | null = null;
      let shouldInclude = true;

      messagesSnapshot.forEach((doc) => {
        const message = { id: doc.id, ...doc.data() } as Message;
        
        if (message.id === forkFromMessageId) {
          forkFromMessage = message;
          shouldInclude = false; // 분기점 메시지 이후는 포함하지 않음
        }
        
        if (shouldInclude) {
          allMessages.push(message);
        }
      });

      if (!forkFromMessage) {
        throw new Error('분기점 메시지를 찾을 수 없습니다.');
      }

      // 타입 가드 확인
      const forkMessage = forkFromMessage as Message;

      // 3. 새로운 채팅방 생성
      const newRoomId = uuidv4();
      const newRoom: ChatRoom = {
        ...originalRoom,
        id: newRoomId,
        name: `${originalRoom.name} (분기)`,
        creatorId: uid,
        lastUpdated: new Date(),
        isFork: true,
        parentRoomId: originalRoomId,
        forkPoint: {
          messageId: forkFromMessageId,
          timestamp: forkMessage.timestamp,
          description: forkDescription
        },
        forkRoomIds: [] // 새 채팅방이므로 비어있음
      };

      const newRoomRef = doc(db, 'chatRooms', newRoomId);
      transaction.set(newRoomRef, newRoom);

      // 4. 분기점까지의 메시지들을 새 채팅방에 복사
      const newMessagesRef = collection(db, 'chatRooms', newRoomId, 'messages');
      
      allMessages.forEach((message) => {
        const newMessageRef = doc(newMessagesRef, message.id);
        const { id, ...messageData } = message; // id 제외하고 복사
        transaction.set(newMessageRef, messageData);
      });

      // 5. 원본 채팅방의 forkRoomIds 업데이트
      const updatedForkRoomIds = [...(originalRoom.forkRoomIds || []), newRoomId];
      transaction.update(originalRoomRef, { forkRoomIds: updatedForkRoomIds });

      // 6. 분기점 메시지에 분기 정보 추가
      const forkFromMessageRef = doc(db, 'chatRooms', originalRoomId, 'messages', forkFromMessageId);
      const updatedForkRoomIdsForMessage = [...(forkMessage.forkRoomIds || []), newRoomId];
      
      transaction.update(forkFromMessageRef, {
        isForked: true,
        forkRoomIds: updatedForkRoomIdsForMessage
      });

      return { newRoomId, newRoom };
    });

    return NextResponse.json({
      success: true,
      newRoomId: result.newRoomId,
      message: '채팅방이 성공적으로 분기되었습니다.'
    });

  } catch (error) {
    console.error('분기 생성 중 오류 발생:', error);
    
    // 사용자 친화적인 오류 메시지
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    
    return NextResponse.json({ 
      error: `분기 생성 실패: ${errorMessage}` 
    }, { status: 500 });
  }
}