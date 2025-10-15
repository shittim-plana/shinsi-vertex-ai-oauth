// /src/app/api/cron/aggregate-rankings/weekly/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { adminApp } from '@/firebase/firebaseAdmin';
import { aggregateRankings } from '@/utils/ranking';
import { getKSTWeekRange } from '@/utils/dateUtils';
import { RANKINGS_WEEKLY_COLLECTION } from '@/firebase/collections';
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

    // Determine last week in KST
    const now = new Date();
    const baseForLastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { from, to, key } = getKSTWeekRange(baseForLastWeek);

    // Aggregate rankings for the week
    const doc: RankingDoc = await aggregateRankings(from, to, 'weekly');

    // Upsert into Firestore (Admin)
    const db = getFirestore(adminApp);
    const docId = doc.metadata.periodKey;
    await db.collection(RANKINGS_WEEKLY_COLLECTION).doc(docId).set({
      metadata: doc.metadata,
      items: doc.items,
      totals: doc.totals,
    });

    const duration = Date.now() - started;
    console.log('[cron] aggregate-rankings/weekly', {
      periodKey: docId,
      count: doc.items.length,
      durationMs: duration,
    });

    return NextResponse.json(
      {
        period: 'weekly',
        periodKey: key,
        from: from.getTime(),
        to: to.getTime(),
        counts: { usersConsidered: doc.totals.usersConsidered, items: doc.items.length },
        upserted: true,
      },
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error('[cron] aggregate-rankings/weekly error', err?.message || err);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500, headers });
  }
}