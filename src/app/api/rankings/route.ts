// /src/app/api/rankings/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import type { RankingPeriod } from '@/types/ranking';
import { fetchRanking } from '@/utils/ranking';

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

export async function GET(req: NextRequest) {
  const started = Date.now();
  try {
    const { searchParams } = new URL(req.url);
    const periodParam = searchParams.get('period');
    const key = searchParams.get('key');
    const limit = parseLimit(searchParams.get('limit'));

    if (!periodParam || !isValidPeriod(periodParam)) {
      return NextResponse.json(
        { error: 'Invalid period. Use daily|weekly|monthly', code: 'BAD_REQUEST' },
        { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    const period: RankingPeriod = periodParam;

    const doc = await fetchRanking(period, key ?? undefined);
    if (!doc) {
      return NextResponse.json(
        { error: 'Ranking document not found', code: 'NOT_FOUND' },
        { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
      );
    }

    const items = (doc.items ?? []).slice(0, limit);

    const metadata = {
      ...doc.metadata,
      from: (doc.metadata as any).from?.toMillis ? (doc.metadata as any).from.toMillis() : (doc.metadata as any).from,
      to: (doc.metadata as any).to?.toMillis ? (doc.metadata as any).to.toMillis() : (doc.metadata as any).to,
      generatedAt: (doc.metadata as any).generatedAt?.toMillis ? (doc.metadata as any).generatedAt.toMillis() : (doc.metadata as any).generatedAt,
    };

    const duration = Date.now() - started;
    console.log('[rankings] GET', { period, key, periodKey: doc.metadata.periodKey, count: items.length, durationMs: duration });

    return NextResponse.json(
      { metadata, items, totals: doc.totals },
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        },
      }
    );
  } catch (err: any) {
    console.error('[rankings] GET error', err?.message || err);
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  }
}