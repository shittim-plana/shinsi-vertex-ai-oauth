import { Timestamp } from 'firebase/firestore';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import isoWeek from 'dayjs/plugin/isoWeek';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

/**
 * Date 또는 Timestamp 객체를 'YYYY-MM-DD' 형식의 문자열로 변환합니다.
 * 유효하지 않은 입력이나 변환 중 오류 발생 시 'Invalid Date'를 반환합니다.
 * @param date - 변환할 Date 또는 Timestamp 객체 (undefined 가능)
 * @returns 포맷된 날짜 문자열 또는 'N/A' 또는 'Invalid Date'
 */
export const formatDate = (date: Date | Timestamp | undefined): string => {
  if (!date) return 'N/A';

  let dateObj: Date;
  if (date instanceof Timestamp) {
    dateObj = date.toDate();
  } else if (date instanceof Date) {
    dateObj = date;
  } else if (typeof date === 'string') {
    // Try parsing the string as a date
    dateObj = new Date(date);
    // Check if the parsed date is valid
    if (isNaN(dateObj.getTime())) {
      console.error("Invalid date string provided to formatDate:", date);
      return 'Invalid Date';
    }
  } else {
    console.error("Invalid date type provided to formatDate:", date);
    return 'Invalid Date'; // Handle unexpected types
  }

  try {
    // Ensure dateObj is valid before calling toISOString
    if (isNaN(dateObj.getTime())) {
        return 'Invalid Date';
    }
    return dateObj.toISOString().split('T')[0];
  } catch (e) {
    console.error("Error formatting date in formatDate:", dateObj, e);
    return 'Invalid Date';
  }
};

const KST_TIMEZONE = 'Asia/Seoul';

/**
 * Returns the current date and time information in KST.
 */
export function getCurrentKST() {
  const kst = dayjs().tz(KST_TIMEZONE);
  const year = kst.year();
  const month = kst.month() + 1; // 0-based
  const day = kst.date();
  return {
    now: new Date(),
    todayKST: { year, month, day },
    currentMonthKey: `${year}-${String(month).padStart(2, '0')}`,
    kstDateString: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/**
 * Checks if two Date objects fall on the same day in KST.
 * @param date1 The first date.
 * @param date2 The second date.
 * @returns True if they are on the same KST day, false otherwise.
 */
export function isSameKSTDay(date1: Date, date2: Date): boolean {
  if (!date1 || !date2 || isNaN(date1.getTime()) || isNaN(date2.getTime())) return false;
  const d1 = dayjs(date1).tz(KST_TIMEZONE).format('YYYY-MM-DD');
  const d2 = dayjs(date2).tz(KST_TIMEZONE).format('YYYY-MM-DD');
  return d1 === d2;
}

/**
 * 내부 상수: KST 오프셋(ms)
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 주어진 Date에 대해 KST 기준의 연/월/일을 계산하여 반환합니다.
 */
function getKSTParts(date: Date): { year: number; month: number; day: number } {
  const kst = dayjs(date).tz(KST_TIMEZONE);
  return { year: kst.year(), month: kst.month() + 1, day: kst.date() };
}

/**
 * KST 자정(00:00)의 UTC 시각을 반환합니다.
 * 결과 Date는 [from, to) 구간 계산에 사용됩니다.
 */
function startOfKSTDay(date: Date): Date {
  return dayjs(date).tz(KST_TIMEZONE).startOf('day').toDate();
}

/**
 * ISO 주차 계산 (KST 기준)
 * - 주 시작: 월요일
 * - 키 포맷: yyyy-Www
 */
function getKSTISOWeekInfo(date: Date): { year: number; week: number } {
  const kst = dayjs(date).tz(KST_TIMEZONE);
  // dayjs isoWeek plugin provides isoWeek() and isoWeekYear()
  const week = (kst as any).isoWeek();
  const year = (kst as any).isoWeekYear();
  return { year, week };
}

/**
 * KST 일간 범위 계산: [from, to) 및 키(yyyy-MM-dd)
 */
export function getKSTDayRange(date: Date): { from: Date; to: Date; key: string } {
  const kst = dayjs(date).tz(KST_TIMEZONE);
  const from = kst.startOf('day').toDate();
  const to = kst.startOf('day').add(1, 'day').toDate();
  const key = kst.format('YYYY-MM-DD');
  return { from, to, key };
}

/**
 * KST 주간 범위 계산: [from, to) 및 키(yyyy-Www, 월요일 시작)
 */
export function getKSTWeekRange(date: Date): { from: Date; to: Date; key: string } {
  const kst = dayjs(date).tz(KST_TIMEZONE);
  // Compute Monday start manually to avoid locale variance
  const weekday = (kst.day() + 6) % 7; // Monday=0 ... Sunday=6 in KST
  const monday = kst.subtract(weekday, 'day').startOf('day');
  const from = monday.toDate();
  const to = monday.add(7, 'day').toDate();
  const { year, week } = getKSTISOWeekInfo(date);
  const key = `${year}-W${String(week).padStart(2, '0')}`;
  return { from, to, key };
}

/**
 * KST 월간 범위 계산: [from, to) 및 키(yyyy-MM)
 */
export function getKSTMonthRange(date: Date): { from: Date; to: Date; key: string } {
  const kst = dayjs(date).tz(KST_TIMEZONE);
  const start = kst.startOf('month');
  const next = start.add(1, 'month');
  const from = start.startOf('day').toDate();
  const to = next.startOf('day').toDate();
  const key = start.format('YYYY-MM');
  return { from, to, key };
}

/**
 * KST 기간 키 포맷터
 * - daily: yyyy-MM-dd
 * - weekly: yyyy-Www (월요일 시작, ISO 주차 규칙)
 * - monthly: yyyy-MM
 */
export function formatKSTPeriodKey(period: 'daily' | 'weekly' | 'monthly', d: Date): string {
  switch (period) {
    case 'daily':
      return getKSTDayRange(d).key;
    case 'weekly':
      return getKSTWeekRange(d).key;
    case 'monthly':
      return getKSTMonthRange(d).key;
    default:
      // 타입 가드상 도달 불가
      return getKSTDayRange(d).key;
  }
}
/**
 * Rolling window ranges (KST): [now-<days>, now)
 * - Upper bound is the current KST time (not startOf('day'))
 * - This matches "from 24 hours ago to now" semantics users expect
 */
export function getKSTRollingRangeDays(days: number): { from: Date; to: Date; key: string } {
  const d = Number.isFinite(days) && days > 0 ? Math.floor(days) : 7;
  const to = dayjs().tz(KST_TIMEZONE);          // current KST time
  const from = to.subtract(d, 'day');           // KST now minus d days
  const key = `rolling-${d}d`;
  return { from: from.toDate(), to: to.toDate(), key };
}