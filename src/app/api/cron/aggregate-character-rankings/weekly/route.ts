// /src/app/api/cron/aggregate-character-rankings/weekly/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { adminApp } from '@/firebase/firebaseAdmin';
import { aggregateCharacterRankings } from '@/utils/characterRanking';
import { getKSTWeekRange, getKSTRollingRangeDays } from '@/utils/dateUtils';
import { RANKINGS_CHARACTER_WEEKLY_COLLECTION } from '@/firebase/collections';
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

    // Determine current week in KST snapshot (Monday-start): [from, to)
    const now = new Date();
    const { from, to, key } = getKSTWeekRange(now);

    // Aggregate character rankings for the week snapshot
    const computed: CharacterRankingDoc = await aggregateCharacterRankings(from, to, 'weekly');

    // Prepare Firestore upsert with calendar key
    const db = getFirestore(adminApp);
    const computedKey = computed.metadata.periodKey;
    const docId = computedKey;

    // Start log (before write)
    console.log('[character-cron][weekly] current-period snapshot', {
      period: 'weekly',
      from: from.getTime(),
      to: to.getTime(),
      docId,
      collection: RANKINGS_CHARACTER_WEEKLY_COLLECTION,
      computedKey,
    });
    if (docId !== computedKey) {
      console.warn('[cron] aggregate-character-rankings/weekly key mismatch', { computedKey, docId });
    }

    await db.collection(RANKINGS_CHARACTER_WEEKLY_COLLECTION).doc(docId).set({
      metadata: computed.metadata,
      items: computed.items,
      totals: computed.totals,
    });

    const duration = Date.now() - started;
    console.log('[cron] aggregate-character-rankings/weekly', {
      periodKey: docId,
      count: computed.items.length,
      durationMs: duration,
    });

    // Rolling window upsert for weekly: rolling-7d (guarded)
    try {
      const rollingStarted = Date.now();
      const { from: rFrom, to: rTo } = getKSTRollingRangeDays(7);
      console.log('[character-cron][weekly] rolling-7d start', { from: rFrom.getTime(), to: rTo.getTime(), docId: 'rolling-7d' });
      const rComputed: CharacterRankingDoc = await aggregateCharacterRankings(rFrom, rTo, 'weekly');
      await db
        .collection(RANKINGS_CHARACTER_WEEKLY_COLLECTION)
        .doc('rolling-7d')
        .set(
          {
            metadata: rComputed.metadata, // do not override metadata.periodKey
            items: rComputed.items,
            totals: rComputed.totals,
          },
          { merge: true }
        );
      const rDuration = Date.now() - rollingStarted;
      console.log('[character-cron][weekly] rolling-7d done', { count: rComputed.items.length, durationMs: rDuration });
    } catch (err) {
      console.error('[character-cron][weekly] rolling-7d failed', err);
    }

    return NextResponse.json(
      {
        period: 'weekly',
        periodKey: key,
        from: from.getTime(),
        to: to.getTime(),
        counts: { charactersConsidered: computed.totals.charactersConsidered, items: computed.items.length },
        upserted: true,
      },
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error('[cron] aggregate-character-rankings/weekly error', err?.message || err);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500, headers });
  }
}