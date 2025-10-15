/**
 * Memory 결과 병합 유틸 (Summary-First RAG)
 *
 * 제공:
 * - normalizeAndMerge
 * - deduplicateByText
 * - recencyBoost
 *
 * 설계:
 * - HYPA, SUPA 결과 각각 점수(0..1) 정규화 후 beta 가중 합성
 * - 텍스트 기준 중복 제거(정규화된 텍스트 해시)
 * - 상위 점수부터 토큰 제한까지 누적 선택
 * - systemBlock은 "Relevant memory" 섹션 문자열을 구성
 *
 * TODO:
 * - 토큰 카운팅을 tiktoken 등으로 교체
 * - 유사도 기반(예: cosine n-gram) 중복 제거 정밀화
 */

import type { MemoryHit } from './summary-repository';

export type MergedItem = {
  type: 'HYPA' | 'SUPA';
  id: string;
  text: string;
  score: number; // [0,1]
};

export function recencyBoost(createdAt: string, halfLifeHours: number): number {
  try {
    const d = new Date(createdAt);
    if (isNaN(d.getTime()) || !Number.isFinite(halfLifeHours) || halfLifeHours <= 0) return 1.0;
    const ageHours = (Date.now() - d.getTime()) / 3600_000;
    // 0.5^(age / halfLife)
    return Math.pow(0.5, ageHours / halfLifeHours);
  } catch {
    return 1.0;
  }
}

/**
 * 간단한 토큰 근사치 (문자 길이/4)
 */
function estimateTokens(s: string): number {
  const n = (s ?? '').length;
  return Math.max(1, Math.ceil(n / 4));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizeText(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 텍스트 기반 중복 제거
 * - normalizeText 후 최초 등장 인덱스를 유지
 * - 반환: 유지해야 할 인덱스 배열(원본 items의 인덱스)
 */
export function deduplicateByText(items: Array<{ text: string }>): number[] {
  const seen = new Set<string>();
  const keep: number[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const sig = normalizeText(items[i]?.text ?? '');
    if (sig.length === 0) continue;
    if (seen.has(sig)) continue;
    seen.add(sig);
    keep.push(i);
  }
  return keep;
}

/**
 * HYPA/SUPA 결과를 점수 정규화 및 dedup 후 토큰 제한으로 병합
 */
export function normalizeAndMerge(input: {
  hypa: MemoryHit[];
  supa: MemoryHit[];
  beta: number;
  limitTokens: number;
}): { mergedItems: MergedItem[]; systemBlock: string } {
  const hypa = Array.isArray(input.hypa) ? input.hypa : [];
  const supa = Array.isArray(input.supa) ? input.supa : [];
  const beta = clamp01(input.beta);
  const limitTokens = Number.isFinite(input.limitTokens) && input.limitTokens > 0 ? Math.trunc(input.limitTokens) : Number.POSITIVE_INFINITY;

  if (hypa.length === 0 && supa.length === 0) {
    return { mergedItems: [], systemBlock: '' };
  }

  function rawScore(h: MemoryHit): number {
    // 선호: combined_score, 대체: (embedding_similarity, lexical_score) 평균
    const comb = h.combined_score;
    if (Number.isFinite(comb as number)) return (comb as number) > 0 ? (comb as number) : 0;
    const sem = clamp01(h.embedding_similarity ?? 0);
    const lex = clamp01(h.lexical_score ?? 0);
    const base = (sem + lex) / 2;
    const rec = clamp01(h.recency_weight ?? 1);
    return clamp01(base * rec);
  }

  type Cand = {
    type: 'HYPA' | 'SUPA';
    id: string;
    text: string;
    createdAt: string | undefined;
    raw: number;
  };

  const candidates: Cand[] = [
    ...hypa.map((h) => ({
      type: 'HYPA' as const,
      id: String(h.id),
      text: h.summary ?? '',
      createdAt: h.created_at,
      raw: rawScore(h),
    })),
    ...supa.map((h) => ({
      type: 'SUPA' as const,
      id: String(h.id),
      text: h.summary ?? '',
      createdAt: h.created_at,
      raw: rawScore(h),
    })),
  ].filter(c => (c.text ?? '').trim().length > 0);

  // 0..1 정규화 (max 스케일)
  const maxRaw = candidates.reduce((m, c) => Math.max(m, c.raw), 0);
  const scored = candidates.map((c) => {
    const norm = maxRaw > 0 ? clamp01(c.raw / maxRaw) : 0;
    const typeWeight = c.type === 'HYPA' ? beta : (1 - beta);
    return { ...c, score: clamp01(norm * typeWeight) };
  });

  // 점수 내림차순
  scored.sort((a, b) => b.score - a.score);

  // 중복 제거(정규화된 텍스트 서명 기준) + 토큰 제한 누적
  const seenSig = new Set<string>();
  const mergedItems: MergedItem[] = [];
  let used = 0;

  for (const c of scored) {
    const sig = normalizeText(c.text);
    if (sig.length === 0) continue;
    if (seenSig.has(sig)) continue;
    const t = estimateTokens(c.text);
    if (used + t > limitTokens) break;
    used += t;
    seenSig.add(sig);
    mergedItems.push({
      type: c.type,
      id: c.id,
      text: c.text,
      score: c.score,
    });
  }

  const systemBlock = mergedItems.length > 0
    ? `Relevant memory:\n${mergedItems.map(i => `- ${i.text}`).join('\n')}`
    : '';

  return { mergedItems, systemBlock };
}