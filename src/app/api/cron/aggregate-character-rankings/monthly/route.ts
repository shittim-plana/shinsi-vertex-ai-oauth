// /src/app/api/cron/aggregate-character-rankings/monthly/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { adminApp } from '@/firebase/firebaseAdmin';
import { aggregateCharacterRankings } from '@/utils/characterRanking';
import { getKSTMonthRange } from '@/utils/dateUtils';
import { RANKINGS_CHARACTER_MONTHLY_COLLECTION } from '@/firebase/collections';
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

    // Determine current month in KST snapshot: [from, to)
    const now = new Date();
    const { from, to, key } = getKSTMonthRange(now);

    // Aggregate character rankings for the month snapshot
    const computed: CharacterRankingDoc = await aggregateCharacterRankings(from, to, 'monthly');

    // Prepare Firestore upsert with calendar key
    const db = getFirestore(adminApp);
    const computedKey = computed.metadata.periodKey;
    const docId = computedKey;

    // Start log (before write)
    console.log('[character-cron][monthly] current-period snapshot', {
      period: 'monthly',
      from: from.getTime(),
      to: to.getTime(),
      docId,
      collection: RANKINGS_CHARACTER_MONTHLY_COLLECTION,
      computedKey,
    });
    if (docId !== computedKey) {
      console.warn('[cron] aggregate-character-rankings/monthly key mismatch', { computedKey, docId });
    }

    await db.collection(RANKINGS_CHARACTER_MONTHLY_COLLECTION).doc(docId).set({
      metadata: computed.metadata,
      items: computed.items,
      totals: computed.totals,
    });

    const duration = Date.now() - started;
    console.log('[cron] aggregate-character-rankings/monthly', {
      periodKey: docId,
      count: computed.items.length,
      durationMs: duration,
    });

    return NextResponse.json(
      {
        period: 'monthly',
        periodKey: key,
        from: from.getTime(),
        to: to.getTime(),
        counts: { charactersConsidered: computed.totals.charactersConsidered, items: computed.items.length },
        upserted: true,
      },
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error('[cron] aggregate-character-rankings/monthly error', err?.message || err);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500, headers });
  }
}