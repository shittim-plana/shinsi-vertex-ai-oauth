// src/types/character.ts

/**
 * Represents the structure of a character object.
 */
export interface Character {
  id: string;
  name: string;
  description: string;
  image: string;
  additionalImages?: string[]; // 추가: 추가 이미지 URL 배열 (선택적)
  detail?: string; // 추가: 상세 설정 (선택적)
  firstMessage?: string; // 추가: 첫 메시지 (선택적)
  creatorName: string;
  creatorId: string;
  tags: string[];
  isPublic: boolean;
  isNSFW: boolean;
  category?: string; // 추가: 캐릭터 카테고리 (선택적)
  isBanmal: boolean; // 반말 사용 여부 (필수)
  createdAt: Date;
  updatedAt?: Date; // 추가: 마지막 수정 시간 (선택적)
  conversationCount: number;
  likesCount: number;
  likedBy: string[]; // Array of user IDs who liked the character
  lorebookIds?: string[]; // 추가: 연결된 로어북 ID 배열 (선택적)
  requiredImageTags?: string; // 추가: 이미지 생성 시 필수 태그
  customEmotions?: string[]; // 추가: 커스텀 감정 라벨 (선택적)

  // 포인트 시스템 연동 필드
  isPremiumChat?: boolean; // 이 캐릭터와의 채팅이 유료인지 여부
  chatPointCost?: number; // 유료 채팅일 경우 메시지당 소모 포인트

  // 소프트 삭제 관련 필드
  deletedAt?: Date; // 소프트 삭제 타임스탬프
  isDeleted?: boolean; // 삭제 상태 플래그
  deletionReason?: string; // 삭제 사유 (선택적)
}
