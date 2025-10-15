import { Timestamp } from 'firebase/firestore';

export interface Comment {
  id: string; // Firestore document ID
  characterId: string; // 댓글이 달린 캐릭터 ID
  userId: string; // 작성자 Firestore UID
  userName: string; // 작성자 표시 이름
  userAvatar?: string; // 작성자 프로필 이미지 URL
  content: string; // 댓글 내용
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  parentId?: string | null; // 최상위 부모 댓글 ID (대댓글인 경우)
  replyToUserName?: string; // 답글 대상 사용자 이름 (인용구 표시용)
  // 대댓글은 CommentItem 내에서 직접 가져오거나, 별도 쿼리로 가져올 수 있음 (여기서는 1개만 허용)
  // replies?: Comment[]; // 대댓글 목록 (데이터 구조에 포함하지 않음)
  likesCount?: number; // 좋아요 수
  likedBy?: string[]; // 좋아요 누른 사용자 UID 목록
  isDeleted?: boolean; // 소프트 삭제 여부 플래그
  // replies?: Comment[]; // Removed, replies are now in a subcollection
}