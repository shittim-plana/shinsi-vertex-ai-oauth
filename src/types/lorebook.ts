import { Timestamp } from 'firebase/firestore';

export interface LorebookEntry {
  id: string; // Firestore document ID
  title: string;
  description: string;
  summary?: string; // 요약된 설명 (선택 사항)
  tags?: string[]; // 태그 배열 (선택 사항)
  isPublic?: boolean; // 공개 여부 (기본값: false, 비공개)
  createdAt: Timestamp;
  updatedAt: Timestamp;
  userId: string; // 이 로어북 항목을 생성한 사용자 ID
}

// 로어북 필터링 관련 타입
export type LorebookFilter = 'all' | 'public' | 'private';

export interface LorebookFilters {
  filter: LorebookFilter;
  searchQuery: string;
  sortBy: 'updatedAt' | 'title' | 'createdAt';
  sortOrder: 'asc' | 'desc';
}