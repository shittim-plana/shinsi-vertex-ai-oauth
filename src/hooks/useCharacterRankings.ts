/**
 * 캐릭터 랭킹 전용 fetch 훅
 * - /api/character-rankings 엔드포인트를 호출하여 기간/메트릭 기준으로 정렬된 결과를 가져온다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RankingPeriod, CharacterRankingMetric, CharacterRankingDoc } from '@/types/ranking';

export function useCharacterRankings(
  period: RankingPeriod,
  metric: CharacterRankingMetric,
  key?: string,
  options?: { limit?: number },
) {
  const [data, setData] = useState<CharacterRankingDoc | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const limit = options?.limit ?? 100;

  const refetch = useCallback(async () => {
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
      params.set('metric', metric);
      if (key) params.set('key', key);
      if (limit) params.set('limit', String(Math.min(Math.max(limit, 1), 200)));
      params.set('_ts', String(Date.now())); // cache-busting

      const res = await fetch(`/api/character-rankings?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (res.status === 404) {
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
      setData(json as unknown as CharacterRankingDoc);
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        return;
      }
      setError(e?.message ?? 'Unknown error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period, metric, key, limit]);

  useEffect(() => {
    refetch();
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [refetch]);

  return { data, loading, error, refetch } as const;
}