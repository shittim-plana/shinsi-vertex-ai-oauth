/**
 * 회원탈퇴 관련 유틸리티 함수들
 * 모든 함수는 멱등성을 보장하며, 존재하지 않는 리소스는 성공으로 처리
 */

import { getAuth } from 'firebase-admin/auth';
import { adminApp } from '@/firebase/firebaseAdmin';
import { db } from '@/firebase/config';
import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  writeBatch,
  orderBy,
  limit,
  startAfter,
  QueryDocumentSnapshot,
  DocumentData
} from 'firebase/firestore';
import { getStorage, ref, deleteObject, listAll } from 'firebase/storage';
import { storage } from '@/firebase/config';
import { getSupabaseAdminClient } from '@/utils/vector/supabaseClient';
import Stripe from 'stripe';

// 환경변수 체크 및 Stripe 초기화
let stripe: Stripe | null = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-07-30.basil',
    typescript: true,
  });
}

// Firebase Admin Auth 인스턴스
const auth = getAuth(adminApp);

/**
 * Stripe 구독 취소 (현재 구독 구조 없음으로 멱등 no-op)
 * 향후 구독 구조 도입 시 구현 예정
 */
export async function cancelStripeSubscriptionsForUser(uid: string): Promise<{ success: boolean; details: string[] }> {
  const details: string[] = [];

  try {
    if (!stripe) {
      details.push('Stripe 키 미설정 - 구독 취소 생략');
      return { success: true, details };
    }

    // 현재 구독 구조가 없으므로 no-op
    // 향후: 사용자 프로필에서 customer_id 조회 후 active 구독 취소
    details.push('현재 구독 구조 없음 - 취소 생략');
    return { success: true, details };
  } catch (error: any) {
    details.push(`Stripe 취소 실패: ${error.message}`);
    return { success: false, details };
  }
}

/**
 * Patreon 토큰 철회
 */
export async function revokePatreonTokens(uid: string): Promise<{ success: boolean; details: string[] }> {
  const details: string[] = [];

  try {
    const patreonDataRef = doc(db, 'users', uid, 'patreonData', 'data');
    const patreonDataSnap = await getDocs(collection(db, 'users', uid, 'patreonData'));

    if (patreonDataSnap.empty) {
      details.push('Patreon 데이터 없음');
      return { success: true, details };
    }

    const patreonDoc = patreonDataSnap.docs[0];
    const patreonData = patreonDoc.data();

    if (!patreonData?.accessToken) {
      details.push('Patreon 토큰 없음');
      return { success: true, details };
    }

    // Patreon 토큰 철회 API 호출
    const revokeResponse = await fetch('https://www.patreon.com/api/oauth2/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.PATREON_CLIENT_ID || '',
        client_secret: process.env.PATREON_CLIENT_SECRET || '',
        token: patreonData.accessToken,
      }),
    });

    if (!revokeResponse.ok) {
      const errorData = await revokeResponse.json().catch(() => ({}));
      details.push(`Patreon 토큰 철회 실패: ${revokeResponse.status} - ${errorData.error || 'Unknown error'}`);
      // 실패해도 계속 진행 (이미 철회되었을 수 있음)
    } else {
      details.push('Patreon 토큰 철회 성공');
    }

    // Patreon 데이터 삭제
    await deleteDoc(patreonDoc.ref);
    details.push('Patreon 데이터 삭제 완료');

    return { success: true, details };
  } catch (error: any) {
    details.push(`Patreon 토큰 철회 중 오류: ${error.message}`);
    return { success: false, details };
  }
}

/**
 * Firebase Auth 사용자 삭제
 */
export async function deleteUserAccount(uid: string): Promise<{ success: boolean; details: string[] }> {
  const details: string[] = [];

  try {
    await auth.deleteUser(uid);
    details.push('Firebase Auth 사용자 삭제 완료');
    return { success: true, details };
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      details.push('사용자가 이미 삭제됨');
      return { success: true, details };
    }
    details.push(`Firebase Auth 사용자 삭제 실패: ${error.message}`);
    return { success: false, details };
  }
}

/**
 * Firestore 사용자 데이터 삭제
 */
export async function deleteFirestoreUserData(uid: string): Promise<{ success: boolean; details: string[]; roomIds: string[] }> {
  const details: string[] = [];
  const roomIds: string[] = [];

  try {
    const batch = writeBatch(db);
    let batchCount = 0;
    const BATCH_SIZE = 500;

    // 1. 사용자 문서 삭제 (users/{uid})
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDocs(query(collection(db, 'users'), where('__name__', '==', uid)));
    if (!userSnap.empty) {
      batch.delete(userRef);
      batchCount++;
      details.push('사용자 문서 삭제 예정');
    }

    // 2. 캐릭터 삭제 (characters where creatorId == uid)
    const charactersQuery = query(collection(db, 'characters'), where('creatorId', '==', uid));
    const charactersSnap = await getDocs(charactersQuery);
    for (const charDoc of charactersSnap.docs) {
      batch.delete(charDoc.ref);
      batchCount++;
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        details.push(`${batchCount}개 문서 삭제 완료`);
        batchCount = 0;
      }
    }
    details.push(`${charactersSnap.size}개 캐릭터 삭제 예정`);

    // 3. 채팅방 및 메시지 삭제 (chatRooms where creatorId == uid)
    const chatRoomsQuery = query(collection(db, 'chatRooms'), where('creatorId', '==', uid));
    const chatRoomsSnap = await getDocs(chatRoomsQuery);

    for (const roomDoc of chatRoomsSnap.docs) {
      const roomId = roomDoc.id;
      roomIds.push(roomId);

      // 메시지 서브컬렉션 삭제
      const messagesQuery = query(collection(db, 'chatRooms', roomId, 'messages'));
      const messagesSnap = await getDocs(messagesQuery);
      for (const msgDoc of messagesSnap.docs) {
        batch.delete(msgDoc.ref);
        batchCount++;
        if (batchCount >= BATCH_SIZE) {
          await batch.commit();
          details.push(`${batchCount}개 메시지 삭제 완료`);
          batchCount = 0;
        }
      }

      // 채팅방 삭제
      batch.delete(roomDoc.ref);
      batchCount++;
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        details.push(`${batchCount}개 채팅방 삭제 완료`);
        batchCount = 0;
      }
    }
    details.push(`${chatRoomsSnap.size}개 채팅방 및 메시지 삭제 예정`);

    // 4. 포인트 잔액 삭제 (pointBalances/{uid})
    const pointBalanceRef = doc(db, 'pointBalances', uid);
    const pointBalanceSnap = await getDocs(query(collection(db, 'pointBalances'), where('__name__', '==', uid)));
    if (!pointBalanceSnap.empty) {
      batch.delete(pointBalanceRef);
      batchCount++;
      details.push('포인트 잔액 삭제 예정');
    }

    // 5. 포인트 거래내역 삭제 (pointTransactions where userId == uid)
    const pointTransactionsQuery = query(collection(db, 'pointTransactions'), where('userId', '==', uid));
    await deleteCollectionInBatches(pointTransactionsQuery, batch, batchCount, BATCH_SIZE, details, '포인트 거래내역');

    // 6. 선물 내역 삭제 (giftHistory where senderId == uid OR receiverId == uid)
    const giftHistoryQuery1 = query(collection(db, 'giftHistory'), where('senderId', '==', uid));
    const giftHistoryQuery2 = query(collection(db, 'giftHistory'), where('receiverId', '==', uid));
    await deleteCollectionInBatches(giftHistoryQuery1, batch, batchCount, BATCH_SIZE, details, '보낸 선물 내역');
    await deleteCollectionInBatches(giftHistoryQuery2, batch, batchCount, BATCH_SIZE, details, '받은 선물 내역');

    // 7. 랭킹 삭제 (rankings_* where userId == uid)
    const rankingCollections = ['rankings_daily', 'rankings_weekly', 'rankings_monthly', 'rankings_character_daily', 'rankings_character_weekly', 'rankings_character_monthly'];
    for (const collectionName of rankingCollections) {
      const rankingQuery = query(collection(db, collectionName), where('userId', '==', uid));
      await deleteCollectionInBatches(rankingQuery, batch, batchCount, BATCH_SIZE, details, `${collectionName} 랭킹`);
    }

    // 8. 굿즈 인벤토리 삭제 (users/{uid}/goodsInventory/*)
    const goodsInventoryQuery = query(collection(db, 'users', uid, 'goodsInventory'));
    const goodsInventorySnap = await getDocs(goodsInventoryQuery);
    for (const goodsDoc of goodsInventorySnap.docs) {
      batch.delete(goodsDoc.ref);
      batchCount++;
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        details.push(`${batchCount}개 굿즈 삭제 완료`);
        batchCount = 0;
      }
    }
    details.push(`${goodsInventorySnap.size}개 굿즈 인벤토리 삭제 예정`);

    // 남은 배치 커밋
    if (batchCount > 0) {
      await batch.commit();
      details.push(`최종 ${batchCount}개 문서 삭제 완료`);
    }

    return { success: true, details, roomIds };
  } catch (error: any) {
    details.push(`Firestore 삭제 중 오류: ${error.message}`);
    return { success: false, details, roomIds };
  }
}

/**
 * 캐릭터별 삭제 (characters where creatorId == uid)
 */
export async function deleteCharactersByOwner(uid: string): Promise<{ success: boolean; details: string[] }> {
  // deleteFirestoreUserData에서 이미 처리됨
  return { success: true, details: ['deleteFirestoreUserData에서 처리됨'] };
}

/**
 * 채팅 데이터 삭제 (messages 서브컬렉션)
 */
export async function deleteChatDataByUser(uid: string): Promise<{ success: boolean; details: string[] }> {
  // deleteFirestoreUserData에서 이미 처리됨
  return { success: true, details: ['deleteFirestoreUserData에서 처리됨'] };
}

/**
 * 포인트 데이터 삭제
 */
export async function deletePointsByUser(uid: string): Promise<{ success: boolean; details: string[] }> {
  // deleteFirestoreUserData에서 이미 처리됨
  return { success: true, details: ['deleteFirestoreUserData에서 처리됨'] };
}

/**
 * 랭킹 데이터 삭제
 */
export async function deleteRankingsByUser(uid: string): Promise<{ success: boolean; details: string[] }> {
  // deleteFirestoreUserData에서 이미 처리됨
  return { success: true, details: ['deleteFirestoreUserData에서 처리됨'] };
}

/**
 * 굿즈 데이터 삭제
 */
export async function deleteGoodsByUser(uid: string): Promise<{ success: boolean; details: string[] }> {
  // deleteFirestoreUserData에서 이미 처리됨
  return { success: true, details: ['deleteFirestoreUserData에서 처리됨'] };
}

/**
 * Storage 자산 삭제
 */
export async function deleteStorageAssetsByUser(uid: string): Promise<{ success: boolean; details: string[] }> {
  const details: string[] = [];

  try {
    const paths = await collectStoragePathsForUser(uid);
    if (paths.length === 0) {
      details.push('삭제할 Storage 경로 없음');
      return { success: true, details };
    }

    const deletePromises = paths.map(async (path) => {
      try {
        const storageRef = ref(storage, path);
        await deleteObject(storageRef);
        return { path, success: true };
      } catch (error: any) {
        if (error.code === 'storage/object-not-found') {
          return { path, success: true, note: '이미 삭제됨' };
        }
        return { path, success: false, error: error.message };
      }
    });

    // 병렬 삭제 (청크 단위로 제한)
    const CHUNK_SIZE = 10;
    const results = [];
    for (let i = 0; i < deletePromises.length; i += CHUNK_SIZE) {
      const chunk = deletePromises.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.allSettled(chunk);
      results.push(...chunkResults);
    }

    let successCount = 0;
    let errorCount = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value.success) successCount++;
        else errorCount++;
      } else {
        errorCount++;
      }
    }

    details.push(`Storage 삭제 완료: ${successCount}개 성공, ${errorCount}개 실패`);
    return { success: errorCount === 0, details };
  } catch (error: any) {
    details.push(`Storage 삭제 중 오류: ${error.message}`);
    return { success: false, details };
  }
}

/**
 * Supabase 벡터 데이터 삭제
 */
export async function deleteSupabaseVectorsByUser(uid: string, roomIds: string[]): Promise<{ success: boolean; details: string[] }> {
  const details: string[] = [];

  try {
    const supabase = getSupabaseAdminClient();

    // chat_message_embeddings 삭제
    const { error: embeddingsError } = await supabase
      .from('chat_message_embeddings')
      .delete()
      .or(`user_id.eq.${uid}${roomIds.length > 0 ? `,room_id.in.(${roomIds.join(',')})` : ''}`);

    if (embeddingsError) {
      details.push(`chat_message_embeddings 삭제 실패: ${embeddingsError.message}`);
    } else {
      details.push('chat_message_embeddings 삭제 완료');
    }

    // chat_memory_summaries 삭제
    const { error: summariesError } = await supabase
      .from('chat_memory_summaries')
      .delete()
      .or(`user_id.eq.${uid}${roomIds.length > 0 ? `,room_id.eq.${roomIds.join(',')}` : ''}`);

    if (summariesError) {
      details.push(`chat_memory_summaries 삭제 실패: ${summariesError.message}`);
    } else {
      details.push('chat_memory_summaries 삭제 완료');
    }

    // chat_memory_links는 cascade로 자동 삭제됨
    details.push('chat_memory_links는 cascade로 자동 삭제');

    return { success: !embeddingsError && !summariesError, details };
  } catch (error: any) {
    details.push(`Supabase 삭제 중 오류: ${error.message}`);
    return { success: false, details };
  }
}

/**
 * 사용자 채팅방 ID 수집
 */
export async function collectUserRoomIds(uid: string): Promise<string[]> {
  try {
    const chatRoomsQuery = query(collection(db, 'chatRooms'), where('creatorId', '==', uid));
    const chatRoomsSnap = await getDocs(chatRoomsQuery);
    return chatRoomsSnap.docs.map(doc => doc.id);
  } catch (error) {
    console.error('채팅방 ID 수집 실패:', error);
    return [];
  }
}

/**
 * 사용자 Storage 경로 수집
 */
export async function collectStoragePathsForUser(uid: string): Promise<string[]> {
  const paths: string[] = [];

  try {
    // 캐릭터의 이미지 경로 수집
    const charactersQuery = query(collection(db, 'characters'), where('creatorId', '==', uid));
    const charactersSnap = await getDocs(charactersQuery);

    for (const charDoc of charactersSnap.docs) {
      const charData = charDoc.data();
      if (charData?.image) {
        // Firebase Storage URL에서 경로 추출 (gs://bucket/path)
        const imageUrl = charData.image;
        if (imageUrl.startsWith('gs://')) {
          const path = imageUrl.replace('gs://arona-bot-mk-2.appspot.com/', '');
          paths.push(path);
        }
      }
      if (charData?.imageUrl) {
        const imageUrl = charData.imageUrl;
        if (imageUrl.startsWith('gs://')) {
          const path = imageUrl.replace('gs://arona-bot-mk-2.appspot.com/', '');
          paths.push(path);
        }
      }
    }

    // TODO: 채팅/갤러리 이미지 경로 수집 (필드명 확인 필요)
    // 현재 구조에서 채팅 메시지에 이미지 경로가 저장되는 방식을 확인 후 구현

    return [...new Set(paths)]; // 중복 제거
  } catch (error) {
    console.error('Storage 경로 수집 실패:', error);
    return [];
  }
}

/**
 * 컬렉션 배치 삭제 헬퍼 함수
 */
async function deleteCollectionInBatches(
  queryToDelete: any,
  batch: any,
  batchCount: number,
  BATCH_SIZE: number,
  details: string[],
  description: string
): Promise<number> {
  let totalDeleted = 0;
  let lastDoc: QueryDocumentSnapshot<DocumentData, DocumentData> | null = null;

  while (true) {
    let paginatedQuery = queryToDelete;
    if (lastDoc) {
      paginatedQuery = query(queryToDelete, startAfter(lastDoc));
    }

    const snapshot = await getDocs(paginatedQuery);
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
      batchCount++;
      totalDeleted++;

      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        details.push(`${description} ${batchCount}개 삭제 완료`);
        batchCount = 0;
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1] as QueryDocumentSnapshot<DocumentData, DocumentData>;
  }

  if (batchCount > 0) {
    await batch.commit();
    details.push(`${description} ${batchCount}개 삭제 완료`);
    batchCount = 0;
  }

  details.push(`${description} 총 ${totalDeleted}개 삭제 예정`);
  return batchCount;
}