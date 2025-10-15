import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import { collection, query, where, getDocs, deleteDoc, doc, Timestamp } from 'firebase/firestore';

export async function POST(request: NextRequest) {
  try {
    // 크론 작업 인증 (예: Vercel Cron 또는 외부 크론 서비스)
    const authHeader = request.headers.get('authorization');
    const expectedToken = process.env.CRON_SECRET_TOKEN;
    
    if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json(
        { error: '인증되지 않은 요청입니다.' },
        { status: 401 }
      );
    }

    console.log('Starting cleanup of deleted characters...');

    // 30일 전 날짜 계산
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoffTimestamp = Timestamp.fromDate(thirtyDaysAgo);

    // 30일 이상 지난 삭제된 캐릭터 조회
    const charactersRef = collection(db, 'characters');
    const deletedCharactersQuery = query(
      charactersRef,
      where('isDeleted', '==', true),
      where('deletedAt', '<=', cutoffTimestamp)
    );

    const querySnapshot = await getDocs(deletedCharactersQuery);
    
    if (querySnapshot.empty) {
      console.log('No characters to cleanup');
      return NextResponse.json({
        success: true,
        message: '정리할 캐릭터가 없습니다.',
        deletedCount: 0
      });
    }

    const deletionPromises: Promise<void>[] = [];
    const deletedCharacterInfo: { id: string; name: string; deletedAt: string }[] = [];

    querySnapshot.forEach((docSnapshot) => {
      const characterData = docSnapshot.data();
      
      // 캐릭터 정보 로깅을 위해 저장
      deletedCharacterInfo.push({
        id: docSnapshot.id,
        name: characterData.name || 'Unknown',
        deletedAt: characterData.deletedAt?.toDate()?.toISOString() || 'Unknown'
      });

      // 영구 삭제 작업 추가
      deletionPromises.push(deleteDoc(doc(db, 'characters', docSnapshot.id)));
    });

    // 모든 삭제 작업 실행
    await Promise.all(deletionPromises);

    console.log(`Successfully deleted ${deletedCharacterInfo.length} characters:`, deletedCharacterInfo);

    return NextResponse.json({
      success: true,
      message: `${deletedCharacterInfo.length}개의 캐릭터가 영구 삭제되었습니다.`,
      deletedCount: deletedCharacterInfo.length,
      deletedCharacters: deletedCharacterInfo
    });

  } catch (error) {
    console.error('캐릭터 정리 작업 에러:', error);
    return NextResponse.json(
      { 
        error: '캐릭터 정리 작업 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// GET 메서드로 상태 확인
export async function GET(request: NextRequest) {
  try {
    // 30일 전 날짜 계산
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoffTimestamp = Timestamp.fromDate(thirtyDaysAgo);

    // 정리 대상 캐릭터 개수 확인
    const charactersRef = collection(db, 'characters');
    const deletedCharactersQuery = query(
      charactersRef,
      where('isDeleted', '==', true),
      where('deletedAt', '<=', cutoffTimestamp)
    );

    const querySnapshot = await getDocs(deletedCharactersQuery);
    
    const charactersToDelete = querySnapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().name || 'Unknown',
      deletedAt: doc.data().deletedAt?.toDate()?.toISOString() || 'Unknown',
      creatorId: doc.data().creatorId || 'Unknown'
    }));

    return NextResponse.json({
      success: true,
      cutoffDate: thirtyDaysAgo.toISOString(),
      charactersToDelete: charactersToDelete.length,
      characters: charactersToDelete
    });

  } catch (error) {
    console.error('캐릭터 정리 상태 확인 에러:', error);
    return NextResponse.json(
      { 
        error: '상태 확인 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}