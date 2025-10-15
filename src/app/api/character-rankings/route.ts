// /src/app/api/character-rankings/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import type { RankingPeriod, CharacterRankingMetric, CharacterRankingItem } from '@/types/ranking';
import { fetchCharacterRanking, sortCharacterItems, aggregateCharacterRankings } from '@/utils/characterRanking';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { adminApp } from '@/firebase/firebaseAdmin';
import { getKSTRollingRangeDays, getKSTMonthRange } from '@/utils/dateUtils';
import {
  RANKINGS_CHARACTER_DAILY_COLLECTION,
  RANKINGS_CHARACTER_WEEKLY_COLLECTION,
  RANKINGS_CHARACTER_MONTHLY_COLLECTION,
} from '@/firebase/collections';

function parseLimit(value: string | null): number {
  const def = 100;
  const max = 200;
  if (!value) return def;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

function isValidPeriod(p: string): p is RankingPeriod {
  return p === 'daily' || p === 'weekly' || p === 'monthly';
}

function isValidMetric(m: string | null): m is CharacterRankingMetric {
  return m === 'earned' || m === 'net' || m === 'spent' || m === 'played';
}

async function populateCharacterProfiles(items: CharacterRankingItem[]): Promise<CharacterRankingItem[]> {
  if (!items.length) return items;
  const db = getFirestore(adminApp);
  const idSet = Array.from(new Set(items.map(i => i.characterId))).filter(Boolean);
  const chunkSize = 30; // Firestore 'in' limit
  const nameMap = new Map<string, { name?: string; image?: string; isPublic?: boolean; isDeleted?: boolean }>();

  for (let i = 0; i < idSet.length; i += chunkSize) {
    const chunk = idSet.slice(i, i + chunkSize);
    const snap = await db
      .collection('characters')
      .where(FieldPath.documentId(), 'in', chunk as string[])
      .get();
    for (const doc of snap.docs) {
      const d = doc.data() as any;
      nameMap.set(doc.id, { name: d?.name, image: d?.image, isPublic: d?.isPublic, isDeleted: d?.isDeleted === true });
    }
  }

  const visibleItems = items.filter(it => {
    const prof = nameMap.get(it.characterId);
    return prof?.isPublic !== false && prof?.isDeleted !== true; // 비공개/삭제 캐릭터 숨김
  });

  return visibleItems.map(it => {
    const prof = nameMap.get(it.characterId);
    return {
      ...it,
      displayName: prof?.name || it.displayName || it.characterId,
      avatarUrl: prof?.image || it.avatarUrl,
    };
  });
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  try {
    const { searchParams } = new URL(req.url);
    const periodParam = searchParams.get('period');
    const key = searchParams.get('key');
    const metricParam = searchParams.get('metric');
    const limit = parseLimit(searchParams.get('limit'));

    if (!periodParam || !isValidPeriod(periodParam)) {
      return NextResponse.json(
        { error: 'Invalid period. Use daily|weekly|monthly', code: 'BAD_REQUEST' },
        { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }
    const period: RankingPeriod = periodParam;

    const metric: CharacterRankingMetric = isValidMetric(metricParam) ? metricParam : 'earned';
    const rolling = searchParams.get('rolling') === 'true';

    // Stored-first default, with on-demand rolling upsert path for rolling-* keys
    let doc: any = null;
    let usedSource: 'stored' | 'rolling' = 'stored';
    let resolvedKey: string | undefined;

    // On-demand rolling compute + upsert when key matches rolling-1d|rolling-7d|rolling-30d
    const rollingMatch = key?.match(/^rolling-(\d+)d$/);
    if (rollingMatch) {
      const rollingDays = parseInt(rollingMatch[1], 10);
      if (![1, 7, 30].includes(rollingDays)) {
        return NextResponse.json(
          { error: 'Invalid rolling key. Use rolling-1d | rolling-7d | rolling-30d', code: 'BAD_REQUEST' },
          { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
        );
      }

      // Map to period and target collection (periodParam is ignored for rolling-* keys)
      let mappedPeriod: RankingPeriod;
      let targetCollection: string;
      if (rollingDays === 1) {
        mappedPeriod = 'daily';
        targetCollection = RANKINGS_CHARACTER_DAILY_COLLECTION;
      } else if (rollingDays === 7) {
        mappedPeriod = 'weekly';
        targetCollection = RANKINGS_CHARACTER_WEEKLY_COLLECTION;
      } else {
        mappedPeriod = 'monthly';
        targetCollection = RANKINGS_CHARACTER_MONTHLY_COLLECTION;
      }

      const { from, to } = getKSTRollingRangeDays(rollingDays);
      console.debug('[character-rankings][rolling-upsert] start', { key, period: mappedPeriod, from, to, collection: targetCollection });

      try {
        const computed = await aggregateCharacterRankings(from, to, mappedPeriod);

        // Upsert to Firestore with docId = key ('rolling-1d' etc.), preserving computed.metadata.periodKey
        const db = getFirestore(adminApp);
        await db.collection(targetCollection).doc(key!).set(computed as any, { merge: true });

        const durationUpsert = Date.now() - started;
        console.debug('[character-rankings][rolling-upsert] done', {
          key,
          count: computed.items.length,
          durationMs: durationUpsert,
        });

        doc = computed; // Keep computed.metadata.periodKey as-is
        usedSource = 'rolling';
        resolvedKey = computed?.metadata?.periodKey;
      } catch (e: any) {
        console.warn('[character-rankings][rolling-upsert] failed', { key, error: e?.message || e });
        return NextResponse.json(
          { error: 'Rolling upsert failed', code: 'INTERNAL_ERROR' },
          { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
        );
      }
    } else if (key) {
      // Stored-first for explicit non-rolling keys
      doc = await fetchCharacterRanking(period, key);
      resolvedKey = doc?.metadata?.periodKey;
    } else if (rolling && (period === 'daily' || period === 'weekly' || period === 'monthly')) {
      // Existing rolling=true behavior (compute-only, no upsert)
      const days = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;
      const { from, to } = getKSTRollingRangeDays(days);
      const computed = await aggregateCharacterRankings(from, to, period);
      doc = computed; // Do not override computed.metadata.periodKey
      usedSource = 'rolling';
      resolvedKey = doc?.metadata?.periodKey;
    } else if (period === 'daily' && !key && !rolling) {
      // Daily default (no key, rolling !== 'true'): compute rolling-1d, upsert, and return
      const { from, to } = getKSTRollingRangeDays(1);
      console.debug('[character-rankings][daily-rolling-default] start', { from, to });
      try {
        const computed = await aggregateCharacterRankings(from, to, 'daily');

        // Upsert to Firestore with docId = 'rolling-1d', preserving computed.metadata.periodKey
        const db = getFirestore(adminApp);
        await db.collection(RANKINGS_CHARACTER_DAILY_COLLECTION).doc('rolling-1d').set(computed as any, { merge: true });

        console.debug('[character-rankings][daily-rolling-default] upsert', { docId: 'rolling-1d', count: computed.items.length });
        const durationUpsert = Date.now() - started;
        console.debug('[character-rankings][daily-rolling-default] done', { durationMs: durationUpsert });

        doc = computed; // Keep computed.metadata.periodKey as-is
        usedSource = 'rolling'; // computed path (with upsert)
        resolvedKey = computed?.metadata?.periodKey;
      } catch (e: any) {
        console.warn('[character-rankings][daily-rolling-default] failed', e);
        return NextResponse.json(
          { error: 'Daily rolling-1d upsert failed', code: 'INTERNAL_ERROR' },
          { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
        );
      }
    } else if (period === 'weekly' && !key && !rolling) {
      // Weekly default (no key, rolling !== 'true'): compute rolling-7d, upsert, and return
      const { from, to } = getKSTRollingRangeDays(7);
      console.debug('[character-rankings][weekly-rolling-default] start', { from, to });
      try {
        const computed = await aggregateCharacterRankings(from, to, 'weekly');

        // Upsert to Firestore with docId = 'rolling-7d', preserving computed.metadata.periodKey
        const db = getFirestore(adminApp);
        await db.collection(RANKINGS_CHARACTER_WEEKLY_COLLECTION).doc('rolling-7d').set(computed as any, { merge: true });

        console.debug('[character-rankings][weekly-rolling-default] upsert', { docId: 'rolling-7d', count: computed.items.length });
        const durationUpsert = Date.now() - started;
        console.debug('[character-rankings][weekly-rolling-default] done', { durationMs: durationUpsert });

        doc = computed; // Keep computed.metadata.periodKey as-is
        usedSource = 'rolling'; // computed path (with upsert)
        resolvedKey = computed?.metadata?.periodKey;
      } catch (e: any) {
        console.warn('[character-rankings][weekly-rolling-default] failed', e);
        return NextResponse.json(
          { error: 'Weekly rolling-7d upsert failed', code: 'INTERNAL_ERROR' },
          { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
        );
      }
    } else if (period === 'monthly' && !key && !rolling) {
      // Monthly default (no key, rolling !== 'true'): compute current month's snapshot, upsert, and return
      const now = new Date();
      const { from, to } = getKSTMonthRange(now);
      console.debug('[character-rankings][monthly-current] start', { from, to });
      try {
        const computed = await aggregateCharacterRankings(from, to, 'monthly');

        // Upsert to Firestore with docId = computed.metadata.periodKey (YYYY-MM), preserving computed.metadata.periodKey
        const db = getFirestore(adminApp);
        const docId = computed?.metadata?.periodKey;
        await db.collection(RANKINGS_CHARACTER_MONTHLY_COLLECTION).doc(docId).set(computed as any, { merge: true });

        console.debug('[character-rankings][monthly-current] upsert', { docId, count: computed.items.length });
        const durationUpsert = Date.now() - started;
        console.debug('[character-rankings][monthly-current] done', { key: docId, durationMs: durationUpsert });

        doc = computed; // Keep computed.metadata.periodKey as-is
        usedSource = 'rolling'; // computed path (with upsert)
        resolvedKey = computed?.metadata?.periodKey;
      } catch (e: any) {
        console.warn('[character-rankings][monthly-current] failed', e);
        return NextResponse.json(
          { error: 'Monthly current upsert failed', code: 'INTERNAL_ERROR' },
          { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
        );
      }
    } else {
      // Latest stored snapshot
      doc = await fetchCharacterRanking(period, undefined);
      resolvedKey = doc?.metadata?.periodKey;
    }

    if (!doc) {
      return NextResponse.json(
        { error: 'Ranking document not found', code: 'NOT_FOUND' },
        { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
      );
    }

    // 캐릭터 이름/이미지 보강 및 비공개 캐릭터 필터링
    const enrichedAll = await populateCharacterProfiles(doc.items ?? []);
    // metric 기준 정렬 및 제한 적용
    const enriched = sortCharacterItems(enrichedAll, metric).slice(0, limit);

    const metadata = {
      ...doc.metadata,
      from: (doc.metadata as any).from?.toMillis ? (doc.metadata as any).from.toMillis() : (doc.metadata as any).from,
      to: (doc.metadata as any).to?.toMillis ? (doc.metadata as any).to.toMillis() : (doc.metadata as any).to,
      generatedAt: (doc.metadata as any).generatedAt?.toMillis ? (doc.metadata as any).generatedAt.toMillis() : (doc.metadata as any).generatedAt,
    };

    const duration = Date.now() - started;
    console.debug('[character-rankings] GET', {
      source: usedSource, // 'stored' | 'rolling'
      period,
      key,
      metric,
      resolvedKey: resolvedKey ?? doc.metadata?.periodKey,
      count: enriched.length,
      durationMs: duration,
    });

    return NextResponse.json(
      { metadata, items: enriched, totals: doc.totals, metric },
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        },
      }
    );
  } catch (err: any) {
    console.error('[character-rankings] GET error', err?.message || err);
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  }
}