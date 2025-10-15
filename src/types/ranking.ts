 // src/types/ranking.ts

/**
 * 집계 기간 타입
 */
export type RankingPeriod = 'daily' | 'weekly' | 'monthly';

/**
 * 개별 사용자 랭킹 항목
 */
export interface RankingItem {
  userId: string;
  earned: number;
  spent: number;
  net: number;
  rank: number;
  displayName?: string;
  avatarUrl?: string;
}

/**
 * 랭킹 문서 스키마
 * - Firestore Timestamp는 Admin SDK 타입(FirebaseFirestore.Timestamp)을 사용
 */
export interface RankingDoc {
  metadata: {
    periodKey: string;
    from: FirebaseFirestore.Timestamp;
    to: FirebaseFirestore.Timestamp;
    generatedAt: FirebaseFirestore.Timestamp;
    timezone: 'KST';
    metric: 'earned';
    version: number;
    topN: number;
  };
  items: RankingItem[];
  totals: {
    usersConsidered: number;
    totalEarned: number;
    totalSpent: number;
  };
}

/**
 * 캐릭터 랭킹 지표 타입
 */
export type CharacterRankingMetric = 'earned' | 'net' | 'spent' | 'played';

/**
 * 개별 캐릭터 랭킹 항목
 */
export interface CharacterRankingItem {
  characterId: string;
  earned: number;
  spent: number;
  net: number;
  played: number;
  rank: number;
  displayName?: string;
  avatarUrl?: string;
  creatorId?: string;
}

/**
 * 캐릭터 랭킹 문서 스키마
 */
export interface CharacterRankingDoc {
  metadata: {
    periodKey: string;
    from: FirebaseFirestore.Timestamp;
    to: FirebaseFirestore.Timestamp;
    generatedAt: FirebaseFirestore.Timestamp;
    timezone: 'KST';
    metric: 'earned';
    version: number;
    topN: number;
  };
  items: CharacterRankingItem[];
  totals: {
    charactersConsidered: number;
    totalEarned: number;
    totalSpent: number;
    totalPlayed: number;
  };
}