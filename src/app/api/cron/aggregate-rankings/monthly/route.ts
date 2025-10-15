// /src/app/api/cron/aggregate-rankings/monthly/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { adminApp } from '@/firebase/firebaseAdmin';
import { aggregateRankings } from '@/utils/ranking';
import { getKSTMonthRange } from '@/utils/dateUtils';
import { RANKINGS_MONTHLY_COLLECTION } from '@/firebase/collections';
import type { RankingDoc } from '@/types/ranking';

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

    // Determine last month in KST
    const now = new Date();
    const baseForLastMonth = new Date(now);
    baseForLastMonth.setMonth(baseForLastMonth.getMonth() - 1);
    const { from, to, key } = getKSTMonthRange(baseForLastMonth);

    // Aggregate rankings for the month
    const doc: RankingDoc = await aggregateRankings(from, to, 'monthly');

    // Upsert into Firestore (Admin)
    const db = getFirestore(adminApp);
    const docId = doc.metadata.periodKey;
    await db.collection(RANKINGS_MONTHLY_COLLECTION).doc(docId).set({
      metadata: doc.metadata,
      items: doc.items,
      totals: doc.totals,
    });

    const duration = Date.now() - started;
    console.log('[cron] aggregate-rankings/monthly', {
      periodKey: docId,
      count: doc.items.length,
      durationMs: duration,
    });

    return NextResponse.json(
      {
        period: 'monthly',
        periodKey: key,
        from: from.getTime(),
        to: to.getTime(),
        counts: { usersConsidered: doc.totals.usersConsidered, items: doc.items.length },
        upserted: true,
      },
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error('[cron] aggregate-rankings/monthly error', err?.message || err);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500, headers });
  }
}