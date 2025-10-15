export const runtime = 'nodejs';
export const maxDuration = 60;
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import { ChatRoom } from '../../../../types/chat';
import { collection, doc, getDoc, query, where, getDocs, orderBy } from 'firebase/firestore';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  try {
    // 쿠키에서 UID 가져오기
    const cookieStore = await cookies();
    const uid = cookieStore.get('uid')?.value;
    
    if (!uid) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get('roomId');
    const type = searchParams.get('type') || 'children'; // 'children' 또는 'siblings'

    if (!roomId) {
      return NextResponse.json({ 
        error: '채팅방 ID가 필요합니다.' 
      }, { status: 400 });
    }

    // 현재 채팅방 정보 가져오기
    const currentRoomRef = doc(db, 'chatRooms', roomId);
    const currentRoomDoc = await getDoc(currentRoomRef);
    
    if (!currentRoomDoc.exists()) {
      return NextResponse.json({ 
        error: '채팅방을 찾을 수 없습니다.' 
      }, { status: 404 });
    }

    const currentRoom = currentRoomDoc.data() as ChatRoom;
    let forks: ChatRoom[] = [];

    if (type === 'children') {
      // 현재 채팅방에서 생성된 분기들 (자식 분기들)
      if (currentRoom.forkRoomIds && currentRoom.forkRoomIds.length > 0) {
        const forksQuery = query(
          collection(db, 'chatRooms'),
          where('__name__', 'in', currentRoom.forkRoomIds),
          orderBy('lastUpdated', 'desc')
        );
        
        const forksSnapshot = await getDocs(forksQuery);
        forks = forksSnapshot.docs.map(doc => ({ 
          id: doc.id, 
          ...doc.data() 
        } as ChatRoom));
      }
    } else {
      // 형제 분기들 (같은 부모를 가진 분기들)
      if (currentRoom.parentRoomId) {
        const siblingsQuery = query(
          collection(db, 'chatRooms'),
          where('parentRoomId', '==', currentRoom.parentRoomId),
          orderBy('lastUpdated', 'desc')
        );
        
        const siblingsSnapshot = await getDocs(siblingsQuery);
        forks = siblingsSnapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as ChatRoom))
          .filter(room => room.id !== roomId); // 현재 채팅방 제외
      }
    }

    // 메시지 개수 추가 (선택적)
    const forksWithMessageCount = await Promise.all(
      forks.map(async (fork) => {
        try {
          const messagesQuery = query(collection(db, 'chatRooms', fork.id, 'messages'));
          const messagesSnapshot = await getDocs(messagesQuery);
          
          return {
            ...fork,
            messageCount: messagesSnapshot.size
          };
        } catch (error) {
          console.error(`메시지 개수 조회 실패 (채팅방 ${fork.id}):`, error);
          return fork; // 메시지 개수 없이 반환
        }
      })
    );

    return NextResponse.json({
      success: true,
      forks: forksWithMessageCount,
      type,
      totalCount: forksWithMessageCount.length
    });

  } catch (error) {
    console.error('분기 목록 조회 중 오류 발생:', error);
    
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    
    return NextResponse.json({ 
      error: `분기 목록 조회 실패: ${errorMessage}` 
    }, { status: 500 });
  }
}