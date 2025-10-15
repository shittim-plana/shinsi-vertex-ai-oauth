// src/types/patreon.ts

// API 응답의 attributes 객체에 대한 타입들
export interface PatreonCampaignAttributes {
  creation_name: string | null;
  url: string | null;
  patron_count: number | null;
  // 필요한 다른 캠페IN 속성들 추가
}

export interface PatreonTierAttributes {
  title: string;
  amount_cents: number;
  description: string | null;
  // PatreonTier와 중복될 수 있으나, API 응답 구조에 맞춤
  // 필요한 다른 티어 속성들 추가
}

export interface PatreonMembershipAttributes {
  patron_status: 'active_patron' | 'declined_patron' | 'former_patron' | null;
  currently_entitled_amount_cents: number | null; // API 응답에서 null일 수 있음
  last_charge_date: string | null;
  pledge_relationship_start: string | null;
  // 필요한 다른 멤버십 속성들 추가
}


export interface PatreonTier { // 기존 PatreonTier는 유지하거나, PatreonTierAttributes로 대체 고려
  id: string;
  title: string;
  amount_cents: number; // Patreon API는 금액을 센트 단위로 제공
  description?: string;
  image_url?: string;
  created_at: string;
  edited_at: string;
}

export interface PatreonMember {
  id: string;
  type: 'member';
  attributes: PatreonMembershipAttributes; // PatreonMembershipAttributes 사용
  relationships: {
    currently_entitled_tiers: {
      data: { id: string; type: 'tier' }[];
    };
    user: {
      data: { id: string; type: 'user' };
      links: { related: string };
    };
  };
}

export interface PatreonUserData {
  patreonUserId: string;
  accessToken: string; // 암호화 필요
  refreshToken: string; // 암호화 필요
  expiresIn: number; // 토큰 만료 시간 (초)
  tokenTimestamp: number; // 토큰 발급 시간 (타임스탬프)
  scope: string;
  tierId?: string; // 현재 구독 중인 티어 ID
  lastChargeDate?: string | null;
  lastChargeStatus?: string | null;
  patronStatus?: 'active_patron' | 'declined_patron' | 'former_patron' | null;
  patreonMemberId?: string; // Patreon 멤버십 ID 추가
  initialRewardGrantedForTierAmount: number | null; // 최초 보상 지급된 티어 금액 (센트), null 허용
}

// API 응답에서 사용될 수 있는 리소스 타입 (예시)
export interface PatreonApiUser {
  id: string;
  type: 'user';
  attributes: {
    email?: string; // 스코프에 따라 존재 여부 다름
    full_name?: string;
    // 기타 사용자 속성
  };
}

export interface PatreonApiCampaign {
  id: string;
  type: 'campaign';
  attributes: PatreonCampaignAttributes;
}

export interface PatreonApiTier {
  id: string;
  type: 'tier';
  attributes: PatreonTierAttributes;
  relationships?: { // 티어와 캠페인 관계 추가
    campaign?: {
      data: { id: string; type: 'campaign' };
    };
  };
}


// Webhook 페이로드 타입 (필요에 따라 확장)
export interface PatreonWebhookPayload {
  data: {
    id: string; // 멤버 ID
    type: 'member';
    attributes: PatreonMembershipAttributes; // PatreonMembershipAttributes 사용
    relationships?: {
      user?: {
        data: {
          id: string; // Patreon 유저 ID
          type: 'user';
        };
      };
      currently_entitled_tiers?: {
        data: { id: string; type: 'tier' }[];
      };
      campaign?: { // 멤버십과 캠페인 관계 추가
        data: { id: string; type: 'campaign' };
      };
    };
  };
  included?: (PatreonApiUser | PatreonApiTier | PatreonApiCampaign | PatreonMember['relationships']['user'])[]; // included 필드에 따라 타입 추가 (PatreonTier -> PatreonApiTier, PatreonApiCampaign 추가)
  links?: {
    self: string;
  };
}
