import { DocumentSnapshot, DocumentData } from 'firebase/firestore';
import { Character } from '@/types/character';

/**
 * Firestore DocumentSnapshot을 Character 객체로 변환합니다.
 * 문서가 존재하지 않거나 데이터가 유효하지 않으면 null을 반환할 수 있습니다.
 * - isDeleted: 존재하지 않으면 false, true일 때만 true
 * - deletedAt: Firestore/Admin Timestamp면 toDate()로 Date 변환, 없으면 undefined
 * - deletionReason: string인 경우만 유지
 * @param docSnap - 변환할 Firestore DocumentSnapshot.
 * @returns 변환된 Character 객체 또는 null.
 */
export function characterFromDoc(docSnap: DocumentSnapshot<DocumentData>): Character | null {
  if (!docSnap.exists()) {
    return null;
  }

  const data = docSnap.data();
  if (!data) {
    return null; // 데이터가 없는 경우
  }

  // Firestore Web/Admin Timestamp 모두 대비: toDate() 존재 여부로 안전 변환
  const toDateSafe = (v: any): Date | undefined => {
    try {
      if (v == null) return undefined;
      if (typeof v?.toDate === 'function') return v.toDate();
      if (v instanceof Date) return v;
      return undefined;
    } catch {
      return undefined;
    }
  };

  try {
    const characterData: Character = {
      id: docSnap.id,
      name: data.name || 'Unknown Name', // 기본값 제공
      description: data.description || '',
      image: typeof data.image === 'string' ? data.image : '', // Character 타입과 호환되도록 string 보장
      additionalImages: Array.isArray(data.additionalImages) ? data.additionalImages : [],
      detail: data.detail || '',
      firstMessage: data.firstMessage || '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      isPublic: data.isPublic ?? true, // 기본값 true
      isNSFW: data.isNSFW || false,
      isBanmal: data.isBanmal || false,
      creatorId: data.creatorId || 'unknown',
      creatorName: data.creatorName || 'Anonymous',
      // Timestamp를 Date로 안전 변환, 유효하지 않으면 기존 정책대로 현재 시간 사용
      createdAt: toDateSafe(data.createdAt) ?? new Date(),
      updatedAt: toDateSafe(data.updatedAt) ?? new Date(),
      conversationCount: typeof data.conversationCount === 'number' ? data.conversationCount : 0,
      likesCount: typeof data.likesCount === 'number' ? data.likesCount : 0,
      likedBy: Array.isArray(data.likedBy) ? data.likedBy : [],
      lorebookIds: Array.isArray(data.lorebookIds) ? data.lorebookIds : [], // lorebookIds 필드
      requiredImageTags: typeof data.requiredImageTags === 'string' ? data.requiredImageTags : '', // 필수 이미지 태그

      // Soft-delete 필드 매핑 (삭제 상태 전파의 기반)
      isDeleted: data?.isDeleted === true, // 존재하지 않으면 false, true일 때만 true
      deletedAt: toDateSafe(data?.deletedAt), // Timestamp -> Date, 없으면 undefined
      deletionReason: typeof data?.deletionReason === 'string' ? data.deletionReason : undefined,
    };
    return characterData;
  } catch (error) {
    console.error("Error converting Firestore document to Character:", docSnap.id, error);
    return null; // 변환 중 오류 발생 시 null 반환
  }
}

// 필요에 따라 다른 Firestore 데이터 변환 유틸리티 함수를 추가할 수 있습니다.