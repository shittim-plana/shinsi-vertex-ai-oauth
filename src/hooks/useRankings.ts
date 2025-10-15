/**
 * fetch 기반 커스텀 훅
 * - SWR/React Query로 대체 가능하나(캐시/재검증) 현재는 의존성 추가 없이 구현
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RankingDoc, RankingPeriod } from '@/types/ranking';

export function useRankings(period: RankingPeriod, key?: string, options?: { limit?: number }) {
  const [data, setData] = useState<RankingDoc | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const limit = options?.limit ?? 100;

  const refetch = useCallback(async () => {
    // Cancel any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('period', period);
      if (key) params.set('key', key);
      if (limit) params.set('limit', String(Math.min(Math.max(limit, 1), 200)));
      // cache-busting
      params.set('_ts', String(Date.now()));

      const res = await fetch(`/api/rankings?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (res.status === 404) {
        // No ranking document found => treat as empty state
        setData(null);
        setError(null);
        setLoading(false);
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any)?.error || `Request failed: ${res.status}`);
      }

      const json = await res.json();
      // API converts Firestore Timestamps to millis. Cast to RankingDoc for consumer.
      setData(json as unknown as RankingDoc);
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        // Swallow abort errors
        return;
      }
      setError(e?.message ?? 'Unknown error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period, key, limit]);

  useEffect(() => {
    refetch();
    // Abort on unmount
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [refetch]);

  return { data, loading, error, refetch } as const;
}