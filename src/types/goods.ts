// src/types/goods.ts

export type GoodsType =
  | 'digital_wallpaper' // 디지털 배경화면
  | 'digital_sticker_pack' // 디지털 스티커팩
  | 'character_voice_pack' // 캐릭터 보이스팩
  | 'behind_the_scenes' // 제작 비하인드 스토리
  | 'exclusive_story_access' // 독점 스토리 접근권
  | 'custom_character_art' // 커스텀 캐릭터 아트 (고가)
  | 'physical_merchandise_coupon'; // 실물 굿즈 할인 쿠폰 (외부 연동)

export interface GoodsItem {
  id: string; // 굿즈 고유 ID
  name: string; // 굿즈 이름
  description: string; // 굿즈 설명
  type: GoodsType;
  price: number; // 포인트 가격
  imageUrl?: string; // 굿즈 이미지 URL
  stock?: number | null; // 재고 (null이면 무제한)
  requiredTierId?: string | null; // 구매 가능 최소 Patreon 티어 ID (null이면 제한 없음)
  isPremium: boolean; // 프리미엄 굿즈 여부 (특정 티어 이상 구매 가능)
  isExclusive: boolean; // 특정 티어 전용 굿즈 여부
  createdAt: Date;
  updatedAt: Date;
}

export interface UserGoodsInventory {
  userId: string; // 아로나 플랫폼 사용자 ID
  goodsId: string; // 획득한 굿즈 ID
  quantity: number; // 보유 수량
  acquisitionDate: Date; // 획득 일시
  purchaseTransactionId?: string; // 구매 시 포인트 거래 ID
}

// 선물 히스토리
export interface GiftHistory {
  id: string;
  senderUserId: string; // 선물 보낸 유저 ID
  recipientCharacterId: string; // 선물 받은 캐릭터 ID
  goodsId: string; // 선물한 굿즈 ID
  quantity: number;
  giftedAt: Date;
  message?: string; // 선물 메시지
}
