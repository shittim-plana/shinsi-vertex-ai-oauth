// src/types/point.ts
import { Timestamp } from 'firebase/firestore'; // Timestamp import 추가

export interface PointBalance {
  userId: string; // 아로나 플랫폼 사용자 ID
  balance: number; // 현재 보유 포인트
  lastUpdated: Date; // 마지막 업데이트 일시
  lastTxId?: string; // 마지막 거래 ID(멱등성 확인용, 선택)
}

export type PointTransactionType =
  | 'patreon_reward' // Patreon 후원 보상
  | 'chat_usage' // 채팅 사용
  | 'goods_purchase' // 굿즈 구매
  | 'stripe_purchase' // Stripe 결제(포인트 충전)
  | 'admin_adjustment' // 관리자 조정
  | 'event_reward' // 이벤트 보상
  | 'coupon_redemption' // 쿠폰 사용
  | 'attendance' // 출석 보상
  | 'creator_reward'; // 생성자 보상

export interface PointTransaction {
  id: string; // 거래 고유 ID
  userId: string;
  type: PointTransactionType;
  amount: number; // 포인트 변동량 (양수: 획득, 음수: 사용)
  description: string; // 거래 설명 (예: "$5 Patreon 후원 보상")
  transactionDate: Date; // 거래 발생 일시
  relatedId?: string; // 관련 ID (예: Patreon 거래 ID, 굿즈 ID 등)
}

// Patreon 티어별 포인트 지급 정책
export interface PatreonTierPointReward {
  tierId: string; // Patreon 티어 ID (기획서의 금액 또는 티어명과 매칭)
  points: number; // 지급 포인트
  name: string; // 티어명 (예: "🌱 응원자")
}

// 기획서의 후원 티어 설계를 기반으로 한 상수
export const PATREON_TIER_REWARDS: Record<string, PatreonTierPointReward> = {
  '1': { tierId: '1', points: 100000, name: '🌱 초보 응원자' },
  '5': { tierId: '5', points: 500000, name: '🌱 응원자' },
  '10': { tierId: '10', points: 1000000, name: '🌸 마음의 선물' },
  '20': { tierId: '20', points: 2000000, name: '🌟 대화의 동반자' },
  '50': { tierId: '50', points: 5000000, name: '🫅 친애하는 후원자' },
  '100': { tierId: '100', points: 10000000, name: '👑 전설의 서포터' },
};

// 포인트 소모 정책
export const POINT_CONSUMPTION_RATES = {
  chatNormal: 20,
  chatPremium: 50,
  goodsMin: 1000,
  goodsMax: 5000,
};

// 티어별 혜택
export interface TierBenefit {
  chatPointDiscountRate?: number; // 채팅 포인트 소모율 감면 (예: 0.3 이면 30% 감면)
  premiumGoodsAccess?: boolean; // 프리미엄 굿즈 선물 가능 여부
  enhancedReactions?: boolean; // 캐릭터 반응 강화
  customizableReactions?: boolean; // 커스터마이징 반응 등록 가능
  privateMessageOrStory?: boolean; // 프라이빗 메시지 또는 스토리 반영권
  rankingDisplay?: boolean; // 랭킹 표시
  uniqueCharacterReaction?: boolean; // 캐릭터 고유 반응
  giftHistory?: boolean; // 선물 히스토리 기록
  monthlyLetter?: boolean; // 월별 편지
  exclusiveGoods?: boolean; // 전용 굿즈 해금
  anniversaryCreation?: boolean; // 캐릭터와 기념일 생성
  digitalGoodsGiftCount?: number; // 디지털 굿즈 선물 횟수
}

export const TIER_BENEFITS: Record<string, TierBenefit> = {
  '5': {
    digitalGoodsGiftCount: 1,
  },
  '10': {
    premiumGoodsAccess: true,
    enhancedReactions: true, // 감정 반응 추가 해금
  },
  '20': {
    chatPointDiscountRate: 0.3,
    enhancedReactions: true, // 캐릭터 반응 강화 (10달러 티어와 중복될 수 있으나, 더 강화된 형태로 해석)
  },
  '50': {
    rankingDisplay: true,
    uniqueCharacterReaction: true,
    giftHistory: true,
    monthlyLetter: true,
    exclusiveGoods: true,
  },
  '100': {
    customizableReactions: true,
    privateMessageOrStory: true,
    anniversaryCreation: true,
  },
};

// 쿠폰(포인트 코드) 타입
export interface Coupon {
  id: string; // Firestore 문서 ID (쿠폰 코드 자체를 ID로 사용할 수도 있음)
  code: string; // 사용자가 입력하는 쿠폰 코드
  points: number; // 지급될 포인트
  description?: string; // 쿠폰 설명
  isUsed: boolean; // 사용 여부
  usedBy?: string; // 사용한 사용자 UID
  usedAt?: Timestamp | null; // Timestamp 타입으로 변경
  createdAt: Timestamp; // Timestamp 타입으로 변경
  expiresAt?: Timestamp | null; // Timestamp 타입으로 변경
  tierId?: string; // 관련 Patreon 티어 ID (선택 사항)
  issuedToPatreonUserId?: string; // 특정 Patreon 사용자에게 발급된 경우 (선택 사항)
  maxUses?: number; // 최대 사용 횟수 (선택 사항, 기본값 1)
  currentUses?: number; // 현재 사용 횟수 (선택 사항, maxUses와 함께 사용)
}

// Patreon 후원 보상 코드 타입
export enum RedemptionCodeStatus {
  Unused = 'UNUSED',
  Used = 'USED',
  Expired = 'EXPIRED',
}

export interface RedemptionCode {
  code: string; // 고유 코드
  pointsValue: number; // 지급될 포인트
  status: RedemptionCodeStatus; // 코드 상태
  patronEmail: string; // 후원자 이메일
  createdAt: Timestamp; // 생성 일시
  tierId: string; // 후원한 티어 ID
  description?: string; // 설명
  usedAt?: Timestamp | null; // 사용 일시
  usedBy?: string; // 사용한 아로나 플랫폼 사용자 ID
}
