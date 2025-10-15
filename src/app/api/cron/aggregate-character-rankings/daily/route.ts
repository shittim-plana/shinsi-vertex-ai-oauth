// /src/app/api/cron/aggregate-character-rankings/daily/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { adminApp } from '@/firebase/firebaseAdmin';
import { aggregateCharacterRankings } from '@/utils/characterRanking';
import { getKSTDayRange, getKSTRollingRangeDays } from '@/utils/dateUtils';
import { RANKINGS_CHARACTER_DAILY_COLLECTION, RANKINGS_CHARACTER_WEEKLY_COLLECTION, RANKINGS_CHARACTER_MONTHLY_COLLECTION } from '@/firebase/collections';
import type { CharacterRankingDoc } from '@/types/ranking';

export async function GET(request: NextRequest) {
  const started = Date.now();
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

  try {
    // Security: X-Cron-Auth header check
    const provided = request.headers.get('X-Cron-Auth') ?? '';
    const secret = process.env.CRON_SECRET ?? '';
    if (!secret || provided !== secret) {
      return NextResponse.json({ error: 'Unauthorized cron request', code: 'UNAUTHORIZED' }, { status: 401, headers });
    }

    // Determine current day in KST snapshot: [from, to)
    const now = new Date();
    const { from, to, key } = getKSTDayRange(now);

    // Aggregate character rankings for the day snapshot
    const computed: CharacterRankingDoc = await aggregateCharacterRankings(from, to, 'daily');

    // Prepare Firestore upsert (Admin) with calendar key
    const db = getFirestore(adminApp);
    const computedKey = computed.metadata.periodKey;
    const docId = computedKey;

    // Start log (before write)
    console.log('[character-cron][daily] current-period snapshot', {
      period: 'daily',
      from: from.getTime(),
      to: to.getTime(),
      docId,
      collection: RANKINGS_CHARACTER_DAILY_COLLECTION,
      computedKey,
    });
    if (docId !== computedKey) {
      console.warn('[cron] aggregate-character-rankings/daily key mismatch', { computedKey, docId });
    }

    await db.collection(RANKINGS_CHARACTER_DAILY_COLLECTION).doc(docId).set({
      metadata: computed.metadata,
      items: computed.items,
      totals: computed.totals,
    });

    const duration = Date.now() - started;
    console.log('[cron] aggregate-character-rankings/daily', {
      periodKey: docId,
      count: computed.items.length,
      durationMs: duration,
    });

    // Rolling window upserts (individually guarded)
    // rolling-1d -> rankings_character_daily
    try {
      const rolling1Started = Date.now();
      const { from: r1From, to: r1To } = getKSTRollingRangeDays(1);
      console.log('[cron] aggregate-character-rankings/daily rolling-1d start', {
        from: r1From.getTime(),
        to: r1To.getTime(),
        target: RANKINGS_CHARACTER_DAILY_COLLECTION,
        docId: 'rolling-1d',
      });
      const r1Computed: CharacterRankingDoc = await aggregateCharacterRankings(r1From, r1To, 'daily');
      await db
        .collection(RANKINGS_CHARACTER_DAILY_COLLECTION)
        .doc('rolling-1d')
        .set(
          {
            metadata: r1Computed.metadata, // do not override metadata.periodKey
            items: r1Computed.items,
            totals: r1Computed.totals,
          },
          { merge: true }
        );
      const r1Duration = Date.now() - rolling1Started;
      console.log('[cron] aggregate-character-rankings/daily rolling-1d done', {
        count: r1Computed.items.length,
        durationMs: r1Duration,
      });
    } catch (err) {
      console.error('[cron] aggregate-character-rankings/daily rolling-1d failed', err);
    }

    // rolling-7d -> rankings_character_weekly
    try {
      const rolling7Started = Date.now();
      const { from: r7From, to: r7To } = getKSTRollingRangeDays(7);
      console.log('[cron] aggregate-character-rankings/daily rolling-7d start', {
        from: r7From.getTime(),
        to: r7To.getTime(),
        target: RANKINGS_CHARACTER_WEEKLY_COLLECTION,
        docId: 'rolling-7d',
      });
      const r7Computed: CharacterRankingDoc = await aggregateCharacterRankings(r7From, r7To, 'weekly');
      await db
        .collection(RANKINGS_CHARACTER_WEEKLY_COLLECTION)
        .doc('rolling-7d')
        .set(
          {
            metadata: r7Computed.metadata, // do not override metadata.periodKey
            items: r7Computed.items,
            totals: r7Computed.totals,
          },
          { merge: true }
        );
      const r7Duration = Date.now() - rolling7Started;
      console.log('[cron] aggregate-character-rankings/daily rolling-7d done', {
        count: r7Computed.items.length,
        durationMs: r7Duration,
      });
    } catch (err) {
      console.error('[cron] aggregate-character-rankings/daily rolling-7d failed', err);
    }

    // rolling-30d -> rankings_character_monthly
    try {
      const rolling30Started = Date.now();
      const { from: r30From, to: r30To } = getKSTRollingRangeDays(30);
      console.log('[cron] aggregate-character-rankings/daily rolling-30d start', {
        from: r30From.getTime(),
        to: r30To.getTime(),
        target: RANKINGS_CHARACTER_MONTHLY_COLLECTION,
        docId: 'rolling-30d',
      });
      const r30Computed: CharacterRankingDoc = await aggregateCharacterRankings(r30From, r30To, 'monthly');
      await db
        .collection(RANKINGS_CHARACTER_MONTHLY_COLLECTION)
        .doc('rolling-30d')
        .set(
          {
            metadata: r30Computed.metadata, // do not override metadata.periodKey
            items: r30Computed.items,
            totals: r30Computed.totals,
          },
          { merge: true }
        );
      const r30Duration = Date.now() - rolling30Started;
      console.log('[cron] aggregate-character-rankings/daily rolling-30d done', {
        count: r30Computed.items.length,
        durationMs: r30Duration,
      });
    } catch (err) {
      console.error('[cron] aggregate-character-rankings/daily rolling-30d failed', err);
    }

    return NextResponse.json(
      {
        period: 'daily',
        periodKey: key,
        from: from.getTime(),
        to: to.getTime(),
        counts: { charactersConsidered: computed.totals.charactersConsidered, items: computed.items.length },
        upserted: true,
      },
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error('[cron] aggregate-character-rankings/daily error', err?.message || err);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500, headers });
  }
}