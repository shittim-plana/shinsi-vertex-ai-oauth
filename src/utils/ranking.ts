// src/utils/ranking.ts

import { getFirestore, Timestamp as AdminTimestamp, QueryDocumentSnapshot, DocumentData } from 'firebase-admin/firestore';
import { adminApp } from '../firebase/firebaseAdmin';
import {
  POINT_TRANSACTIONS_COLLECTION,
  RANKINGS_DAILY_COLLECTION,
  RANKINGS_WEEKLY_COLLECTION,
  RANKINGS_MONTHLY_COLLECTION,
} from '../firebase/collections';
import type { RankingDoc, RankingItem } from '../types/ranking';
import { formatKSTPeriodKey } from './dateUtils';

/**
 * 트랜잭션 타입을 랭킹 계산용으로 분류합니다.
 * - earned = ['attendance','patreon_reward','creator_reward','coupon_redemption','event_reward','admin_distribution','stripe_purchase']
 * - spent  = ['chat_usage','goods_purchase']
 * - 나머지 = 'ignore'
 */
export function classifyTransaction(type: import('../types/point').PointTransactionType): 'earned'|'spent'|'ignore' {
  const EARNED_TYPES: ReadonlyArray<string> = [
    'attendance',
    'patreon_reward',
    'creator_reward',
    'coupon_redemption',
    'event_reward',
    'admin_distribution', // 사양 상 earned로 분류 (현재 타입 union에는 없을 수 있음)
    'stripe_purchase',    // 사양 상 earned로 분류 (현재 타입 union에는 없을 수 있음)
  ];
  const SPENT_TYPES: ReadonlyArray<string> = ['chat_usage', 'goods_purchase'];

  const t = String(type);
  if (EARNED_TYPES.includes(t)) return 'earned';
  if (SPENT_TYPES.includes(t)) return 'spent';
  return 'ignore';
}

/**
 * 포인트 트랜잭션을 스캔하여 KST 기간(from, to) 동안의 랭킹을 집계합니다.
 * - 쿼리: transactionDate >= from AND transactionDate < to AND type IN([...관심 타입...])
 * - 페이지 사이즈: 1500
 * - 정렬: earned desc, net desc, spent asc, userId asc
 * - rank: 1부터
 * - metadata.periodKey: formatKSTPeriodKey(period, from)
 */
export async function aggregateRankings(
  from: Date,
  to: Date,
  period: import('../types/ranking').RankingPeriod,
  options?: { topN?: number; populateProfiles?: boolean; runId?: string },
): Promise<import('../types/ranking').RankingDoc> {
  const db = getFirestore(adminApp);

  // 안전한 topN 파싱 (기본 100)
  const envTopN = (() => {
    const raw = process.env.RANKING_TOPN_DEFAULT;
    const parsed = raw != null ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
  })();
  const topN = options?.topN && Number.isFinite(options.topN) && options.topN! > 0 ? (options.topN as number) : envTopN;

  const pageSize = 1500;
  const fromTs = AdminTimestamp.fromDate(from);
  const toTs = AdminTimestamp.fromDate(to);

  // 관심 타입 목록 (IN 연산 사용, 10개 이하 유지)
  const EARNED_TYPES: ReadonlyArray<string> = [
    'attendance',
    'patreon_reward',
    'creator_reward',
    'coupon_redemption',
    'event_reward',
    'admin_distribution',
    'stripe_purchase',
  ];
  const SPENT_TYPES: ReadonlyArray<string> = ['chat_usage', 'goods_purchase'];
  const INTEREST_TYPES: ReadonlyArray<string> = [...EARNED_TYPES, ...SPENT_TYPES];

  const agg = new Map<string, { earned: number; spent: number }>();
  let totalEarned = 0;
  let totalSpent = 0;

  let lastDoc: QueryDocumentSnapshot<DocumentData> | undefined;

  // 페이지네이션 루프
  // orderBy(transactionDate desc) + startAfter(lastDoc)
  // 참고: IN + 범위 + orderBy 조합은 인덱스 필요(다음 단계에서 인덱스 추가)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = db
      .collection(POINT_TRANSACTIONS_COLLECTION)
      .where('transactionDate', '>=', fromTs)
      .where('transactionDate', '<', toTs)
      .where('type', 'in', INTEREST_TYPES as string[])
      .orderBy('transactionDate', 'desc')
      .limit(pageSize);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snap = await query.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const data = doc.data() as {
        userId?: string;
        type?: string;
        amount?: number | string;
      };

      const userId = data.userId;
      const type = data.type;
      const amountNum = typeof data.amount === 'number' ? data.amount : Number(data.amount);

      if (!userId || !type || !Number.isFinite(amountNum)) {
        continue;
      }

      // 사양 분류 함수를 재사용하되, 타입 미스매치(예: 'stripe_purchase')는 캐스팅
      const cls = classifyTransaction(type as unknown as import('../types/point').PointTransactionType);
      if (cls === 'ignore') continue;

      const abs = Math.abs(amountNum);
      const prev = agg.get(userId) ?? { earned: 0, spent: 0 };
      if (cls === 'earned') {
        prev.earned += abs;
        totalEarned += abs;
      } else {
        prev.spent += abs;
        totalSpent += abs;
      }
      agg.set(userId, prev);
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  // 배열 변환 및 정렬/랭크
  const itemsAll: RankingItem[] = Array.from(agg.entries()).map(([userId, v]) => ({
    userId,
    earned: v.earned,
    spent: v.spent,
    net: v.earned - v.spent,
    rank: 0,
  }));

  itemsAll.sort((a, b) => {
    if (b.earned !== a.earned) return b.earned - a.earned;
    const netDiff = b.net - a.net;
    if (netDiff !== 0) return netDiff;
    const spentDiff = a.spent - b.spent;
    if (spentDiff !== 0) return spentDiff;
    return a.userId.localeCompare(b.userId);
  });

  // 랭크 부여
  for (let i = 0; i < itemsAll.length; i++) {
    itemsAll[i].rank = i + 1;
  }

  // 상위 N만 포함
  const items = itemsAll.slice(0, topN);

  // TODO(populateProfiles): displayName, avatarUrl 보강 (이번 단계에서는 NO-OP)

  const rankingDoc: RankingDoc = {
    metadata: {
      periodKey: formatKSTPeriodKey(period, from),
      from: AdminTimestamp.fromDate(from),
      to: AdminTimestamp.fromDate(to),
      generatedAt: AdminTimestamp.now(),
      timezone: 'KST',
      metric: 'earned',
      version: 1,
      topN,
    },
    items,
    totals: {
      usersConsidered: itemsAll.length,
      totalEarned,
      totalSpent,
    },
  };

  return rankingDoc;
}

/**
 * 랭킹 문서를 조회합니다.
 * - period에 따라 컬렉션 선택
 * - key가 있으면 해당 문서 ID 우선 조회, 없으면 metadata.periodKey == key로 fallback
 * - key 없으면 metadata.periodKey desc 기준 최신 1건 반환
 */
export async function fetchRanking(period: import('../types/ranking').RankingPeriod, key?: string): Promise<import('../types/ranking').RankingDoc | null> {
  const db = getFirestore(adminApp);

  const collectionName =
    period === 'daily'
      ? RANKINGS_DAILY_COLLECTION
      : period === 'weekly'
      ? RANKINGS_WEEKLY_COLLECTION
      : RANKINGS_MONTHLY_COLLECTION;

  const colRef = db.collection(collectionName);

  if (key) {
    // 1) 문서 ID == key 우선
    const byId = await colRef.doc(key).get();
    if (byId.exists) {
      return byId.data() as RankingDoc;
    }
    // 2) metadata.periodKey == key fallback
    const byField = await colRef.where('metadata.periodKey', '==', key).limit(1).get();
    if (!byField.empty) {
      return byField.docs[0].data() as RankingDoc;
    }
    return null;
  }

  // 최신 1건 (키가 시간순 정렬되도록 설계됨)
  const latest = await colRef.orderBy('metadata.periodKey', 'desc').limit(1).get();
  if (latest.empty) return null;
  return latest.docs[0].data() as RankingDoc;
}