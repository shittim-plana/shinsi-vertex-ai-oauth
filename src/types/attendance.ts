import { Timestamp } from 'firebase/firestore';

/**
 * 사용자별 월간 출석 상태를 나타냅니다.
 *
 * @collection users/{uid}/attendance/{yyyy-MM}
 */
export interface AttendanceState {
  /** 문서 키, 'yyyy-MM' 형식 (예: '2025-01') */
  monthKey: string;
  /** 마지막 출석 보상을 받은 시점 (서버시간) */
  lastClaimedAt: Timestamp;
  /** 해당 월의 총 출석 횟수 */
  claimCount: number;
  /** 현재 적용되는 출석 보상 배수 (1.0 ~ 2.0) */
  currentMultiplier: number;
  /** 해당 월에 출석 보상으로 지급된 총 포인트 */
  totalAwarded: number;
  /** 출석한 날짜 목록, 'dd' 형식 (예: ['01', '02', '15']) */
  dayList: string[];
  /** 문서가 처음 생성된 시점 */
  createdAt: Timestamp;
  /** 문서가 마지막으로 업데이트된 시점 */
  updatedAt: Timestamp;
}

/**
 * 출석 보상 요청(claim) API의 응답 형식입니다.
 */
export interface ClaimResponse {
  /** 요청 성공 여부 */
  success: boolean;
  /** 이번 요청으로 지급된 포인트 양 */
  awardedAmount: number;
  /** 이번 요청에 적용된 배수 */
  multiplier: number;
  /** 다음 출석 시 적용될 배수 */
  nextMultiplier: number;
  /** 이번 달 총 출석 횟수 */
  claimCount: number;
  /** 현재 월 키 ('yyyy-MM' 형식) */
  monthKey: string;
  /** 오늘 이미 출석 보상을 받았는지 여부 */
  todayClaimed: boolean;
  /** 현재 달의 출석 시스템이 리셋되는 KST 기준 시각 (ISO string) */
  resetAtKST: string;
  /** 요청 처리 후 사용자의 현재 포인트 잔액 (선택 사항) */
  balance?: number;
  /** 에러 코드 (실패 시) */
  error?: string;
  /** 에러 메시지 (실패 시) */
  message?: string;
}