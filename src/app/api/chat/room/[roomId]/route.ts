import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import { ChatRoom } from '../../../../../types/chat';
import { doc, getDoc } from 'firebase/firestore';
import { cookies } from 'next/headers';

export async function GET(
  request: NextRequest,
  params: any
) {
  try {
    // 쿠키에서 UID 가져오기
    const cookieStore = await cookies();
    const uid = cookieStore.get('uid')?.value;
    
    if (!uid) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
    }

    const roomId = params.roomId;

    if (!roomId) {
      return NextResponse.json({ 
        error: '채팅방 ID가 필요합니다.' 
      }, { status: 400 });
    }

    // 채팅방 정보 가져오기
    const roomRef = doc(db, 'chatRooms', roomId);
    const roomDoc = await getDoc(roomRef);
    
    if (!roomDoc.exists()) {
      return NextResponse.json({ 
        error: '채팅방을 찾을 수 없습니다.' 
      }, { status: 404 });
    }

    const roomData = roomDoc.data() as ChatRoom;
    const room = { ...roomData, id: roomDoc.id };

    // 요청자 권한 확인 (관리자/부관리자면 타 유저 채팅방 접근 허용)
    let isPrivileged = false;
    try {
      const requesterRef = doc(db, 'users', uid);
      const requesterSnap = await getDoc(requesterRef);
      if (requesterSnap.exists()) {
        const rd = requesterSnap.data() as any;
        isPrivileged = !!(rd.isAdmin || rd.isSubadmin);
      }
    } catch {}

    // 접근 권한 확인 (채팅방 생성자 또는 관리자/부관리자 허용)
    if (room.creatorId !== uid && !isPrivileged) {
      return NextResponse.json({
        error: '접근 권한이 없습니다.'
      }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      room
    });

  } catch (error) {
    console.error('채팅방 정보 조회 중 오류 발생:', error);
    
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    
    return NextResponse.json({ 
      error: `채팅방 정보 조회 실패: ${errorMessage}` 
    }, { status: 500 });
  }
}