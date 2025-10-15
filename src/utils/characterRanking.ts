// src/utils/characterRanking.ts

import { getFirestore, Timestamp as AdminTimestamp, QueryDocumentSnapshot, DocumentData, FieldPath } from 'firebase-admin/firestore';
import { adminApp } from '../firebase/firebaseAdmin';
import {
  POINT_TRANSACTIONS_COLLECTION,
  RANKINGS_CHARACTER_DAILY_COLLECTION,
  RANKINGS_CHARACTER_WEEKLY_COLLECTION,
  RANKINGS_CHARACTER_MONTHLY_COLLECTION,
} from '../firebase/collections';
import type { RankingPeriod, CharacterRankingDoc, CharacterRankingItem, CharacterRankingMetric } from '../types/ranking';
import { formatKSTPeriodKey } from './dateUtils';

/**
 * 캐릭터 랭킹 정렬 헬퍼
 */
export function sortCharacterItems(items: CharacterRankingItem[], metric: CharacterRankingMetric): CharacterRankingItem[] {
  const arr = items.map(i => ({ ...i }));
  const byId = (a: CharacterRankingItem, b: CharacterRankingItem) => a.characterId.localeCompare(b.characterId);
  if (metric === 'earned') {
    arr.sort((a, b) => {
      if (b.earned !== a.earned) return b.earned - a.earned;
      const netDiff = b.net - a.net;
      if (netDiff !== 0) return netDiff;
      const spentDiff = a.spent - b.spent;
      if (spentDiff !== 0) return spentDiff;
      return byId(a, b);
    });
  } else if (metric === 'net') {
    arr.sort((a, b) => {
      if (b.net !== a.net) return b.net - a.net;
      const earnedDiff = b.earned - a.earned;
      if (earnedDiff !== 0) return earnedDiff;
      return byId(a, b);
    });
  } else if (metric === 'spent') {
    arr.sort((a, b) => {
      if (b.spent !== a.spent) return b.spent - a.spent;
      const earnedDiff = b.earned - a.earned;
      if (earnedDiff !== 0) return earnedDiff;
      return byId(a, b);
    });
  } else {
    // played
    arr.sort((a, b) => {
      if (b.played !== a.played) return b.played - a.played;
      const earnedDiff = b.earned - a.earned;
      if (earnedDiff !== 0) return earnedDiff;
      return byId(a, b);
    });
  }
  // re-rank
  for (let i = 0; i < arr.length; i++) {
    arr[i].rank = i + 1;
  }
  return arr;
}

/**
 * 캐릭터 랭킹 집계
 * - Earned: creator_reward
 * - Spent: chat_usage
 * - Played: chat_usage 건수
 */
export async function aggregateCharacterRankings(
  from: Date,
  to: Date,
  period: RankingPeriod,
  options?: { topN?: number; populateProfiles?: boolean; runId?: string },
): Promise<CharacterRankingDoc> {
  const db = getFirestore(adminApp);

  const envTopN = (() => {
    const raw = process.env.RANKING_TOPN_DEFAULT;
    const parsed = raw != null ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
  })();
  const topN = options?.topN && Number.isFinite(options.topN) && options.topN! > 0 ? (options.topN as number) : envTopN;

  const pageSize = 1500;
  const fromTs = AdminTimestamp.fromDate(from);
  const toTs = AdminTimestamp.fromDate(to);

  const EARNED_TYPES: ReadonlyArray<string> = ['creator_reward'];
  const SPENT_TYPES: ReadonlyArray<string> = ['chat_usage'];
  const INTEREST_TYPES: ReadonlyArray<string> = [...EARNED_TYPES, ...SPENT_TYPES];

  type Acc = { earned: number; spent: number; played: number };
  const agg = new Map<string, Acc>();
  let totalEarned = 0;
  let totalSpent = 0;
  let totalPlayed = 0;

  let lastDoc: QueryDocumentSnapshot<DocumentData> | undefined;
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
       relatedId?: string;
     };

     const type = data.type;
     const characterId = (data.relatedId || '').trim();
     const amountNum = typeof data.amount === 'number' ? data.amount : Number(data.amount);

     if (!type || !Number.isFinite(amountNum)) continue;
     if (!characterId || characterId === 'generate_image') continue;

     const abs = Math.abs(amountNum);
     const prev = agg.get(characterId) ?? { earned: 0, spent: 0, played: 0 };
     if (EARNED_TYPES.includes(type)) {
       prev.earned += abs;
       totalEarned += abs;
     } else if (SPENT_TYPES.includes(type)) {
       prev.spent += abs;
       totalSpent += abs;
     }
     agg.set(characterId, prev);
   }

   lastDoc = snap.docs[snap.docs.length - 1];
   if (snap.size < pageSize) break;
  }

  // Recompute 'played' using chat messages (collectionGroup) over [from, to)
  // This counts actual character messages rather than inferring from point transactions.
  try {
    let lastMsgDoc: QueryDocumentSnapshot<DocumentData> | undefined;
    const msgPageSize = 2000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let q = db
        .collectionGroup('messages')
        .where('timestamp', '>=', fromTs)
        .where('timestamp', '<', toTs)
        .where('isCharacter', '==', true)
        .orderBy('timestamp', 'desc')
        .limit(msgPageSize);

      if (lastMsgDoc) {
        q = q.startAfter(lastMsgDoc);
      }

      const msgSnap = await q.get();
      if (msgSnap.empty) break;

      for (const d of msgSnap.docs) {
        const m = d.data() as { characterId?: string | null };
        const cid = (m.characterId || '').trim();
        if (!cid || cid === 'generate_image') continue;

        const prev = agg.get(cid) ?? { earned: 0, spent: 0, played: 0 };
        prev.played += 1;
        totalPlayed += 1;
        agg.set(cid, prev);
      }

      lastMsgDoc = msgSnap.docs[msgSnap.docs.length - 1];
      if (msgSnap.size < msgPageSize) break;
    }
  } catch (e) {
    console.error('[aggregateCharacterRankings] Failed to aggregate played from messages:', e);
  }

  let itemsAll: CharacterRankingItem[] = Array.from(agg.entries()).map(([characterId, v]) => ({
    characterId,
    earned: v.earned,
    spent: v.spent,
    net: v.earned - v.spent,
    played: v.played,
    rank: 0,
  }));

  // Filter out private characters (isPublic === false)
  try {
    const idSet = Array.from(new Set(itemsAll.map(i => i.characterId))).filter(Boolean);
    const chunkSize = 30; // Firestore 'in' limit
    const charDb = getFirestore(adminApp);
    const isPublicMap = new Map<string, boolean>();
    const isDeletedMap = new Map<string, boolean>();

    for (let i = 0; i < idSet.length; i += chunkSize) {
      const chunk = idSet.slice(i, i + chunkSize);
      const snap = await charDb
        .collection('characters')
        .where(FieldPath.documentId(), 'in', chunk as string[])
        .get();
      for (const d of snap.docs) {
        const data = d.data() as any;
        // Default to true if field missing; only hide when explicitly false
        isPublicMap.set(d.id, data?.isPublic !== false);
        // Deleted characters are hidden when isDeleted is explicitly true
        isDeletedMap.set(d.id, data?.isDeleted === true);
      }
    }

    itemsAll = itemsAll.filter(it => isPublicMap.get(it.characterId) !== false && isDeletedMap.get(it.characterId) !== true);
  } catch (e) {
    console.error('[aggregateCharacterRankings] Failed to filter private characters:', e);
    // In case of error, proceed without filtering to avoid empty results
  }

  // default persisted ordering: earned desc -> net desc -> spent asc -> id
  itemsAll.sort((a, b) => {
    if (b.earned !== a.earned) return b.earned - a.earned;
    const netDiff = b.net - a.net;
    if (netDiff !== 0) return netDiff;
    const spentDiff = a.spent - b.spent;
    if (spentDiff !== 0) return spentDiff;
    return a.characterId.localeCompare(b.characterId);
  });

  for (let i = 0; i < itemsAll.length; i++) {
    itemsAll[i].rank = i + 1;
  }

  const items = itemsAll.slice(0, topN);

  // Recompute totals after visibility filtering
  const totalEarnedFiltered = itemsAll.reduce((acc, it) => acc + it.earned, 0);
  const totalSpentFiltered = itemsAll.reduce((acc, it) => acc + it.spent, 0);
  const totalPlayedFiltered = itemsAll.reduce((acc, it) => acc + it.played, 0);

  // TODO: populateProfiles(displayName, avatarUrl, creatorId) for topN if requested
  // if (options?.populateProfiles) { ... }

  const rankingDoc: CharacterRankingDoc = {
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
      charactersConsidered: itemsAll.length,
      totalEarned: totalEarnedFiltered,
      totalSpent: totalSpentFiltered,
      totalPlayed: totalPlayedFiltered,
    },
  };

  return rankingDoc;
}

/**
 * 캐릭터 랭킹 문서 조회
 */
export async function fetchCharacterRanking(period: RankingPeriod, key?: string): Promise<CharacterRankingDoc | null> {
  const db = getFirestore(adminApp);
  const collectionName =
    period === 'daily'
      ? RANKINGS_CHARACTER_DAILY_COLLECTION
      : period === 'weekly'
      ? RANKINGS_CHARACTER_WEEKLY_COLLECTION
      : RANKINGS_CHARACTER_MONTHLY_COLLECTION;

  const colRef = db.collection(collectionName);
  if (key) {
    const byId = await colRef.doc(key).get();
    if (byId.exists) {
      return byId.data() as CharacterRankingDoc;
    }
    const byField = await colRef.where('metadata.periodKey', '==', key).limit(1).get();
    if (!byField.empty) {
      return byField.docs[0].data() as CharacterRankingDoc;
    }
    return null;
  }

  const latest = await colRef.orderBy('metadata.periodKey', 'desc').limit(1).get();
  if (latest.empty) return null;
  return latest.docs[0].data() as CharacterRankingDoc;
}