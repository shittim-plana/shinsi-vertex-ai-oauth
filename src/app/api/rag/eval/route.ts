import { NextResponse } from 'next/server';
import { searchSimilarMessages, retrieveAugmentedContext } from '@/utils/vector/rag';

// Basic normalization/tokenization utilities
function normalize(text: string): string {
  return (text ?? '').toString().normalize('NFKC').toLowerCase();
}

function stripPunct(text: string): string {
  return text.replace(/[^\p{L}\p{N}\s]/gu, ' ');
}

function tokenize(text: string): string[] {
  const cleaned = stripPunct(normalize(text));
  return cleaned.split(/\s+/).filter(Boolean);
}

function jaccard(aTokens: string[], bTokens: string[]): number {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function precisionRecall(foundIds: string[], goldIds: string[] | undefined): { precision: number | null; recall: number | null } {
  if (!Array.isArray(goldIds) || goldIds.length === 0) return { precision: null, recall: null };
  const setGold = new Set(goldIds.map(String));
  const setFound = new Set(foundIds.map(String));
  if (setFound.size === 0) return { precision: 0, recall: 0 };
  let inter = 0;
  for (const id of setFound) if (setGold.has(id)) inter++;
  const precision = inter / setFound.size;
  const recall = inter / setGold.size;
  return { precision, recall };
}

type EvalSample = {
  query: string;
  roomId: string;
  goldMessageIds?: string[];
  goldAnswer?: string;
  minScore?: number;
};

type EvalOptions = {
  k?: number;
  minScore?: number;
  profileName?: string;
  retrievalMode?: 'messages_first' | 'summary' | 'auto';
  // summary-first tuning (optional)
  k1?: number;
  k2?: number;
  alpha?: number;
  beta?: number;
  decayHalfLifeHours?: number;
  useTSV?: boolean;
};

type SampleResult = {
  index: number;
  roomId: string;
  query: string;
  k: number;
  hits: Array<{ messageId: string; similarity: number; }>;
  hitCount: number;
  goldMessageCount: number | null;
  contextPrecision: number | null;
  contextRecall: number | null;
  relevancyProxy: number;
  faithfulnessProxy: number | null;
  retrievalMs: number;
  // summary-first diagnostics
  retrievalKind?: 'messages' | 'summary';
  usedMode?: string;
  hypaCount?: number;
  supaCount?: number;
  snippetCount?: number;
  contextChars?: number;
};

type EvalResponse = {
  ok: true;
  profileName?: string;
  k: number;
  minScore: number;
  count: number;
  summary: {
    avgPrecision: number | null;
    avgRecall: number | null;
    avgRelevancyProxy: number;
    avgFaithfulnessProxy: number | null;
    avgRetrievalMs: number;
  };
  results: SampleResult[];
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const dataset: EvalSample[] = Array.isArray(body?.dataset) ? body.dataset : [];
    const options: EvalOptions = body?.options ?? {};
    if (dataset.length === 0) {
      return NextResponse.json({ ok: false, error: 'dataset is required (non-empty array)' }, { status: 400 });
    }
    const k = typeof options.k === 'number' && options.k > 0 ? Math.min(options.k, 50) : 10;
    const minScore = typeof options.minScore === 'number' ? options.minScore : 0.40;
    const profileName = typeof options.profileName === 'string' ? options.profileName : undefined;
    const retrievalMode = (options.retrievalMode as any) || 'messages_first';
    // optional summary-first tuning
    const optK1 = typeof options.k1 === 'number' ? options.k1 : undefined;
    const optK2 = typeof options.k2 === 'number' ? options.k2 : undefined;
    const optAlpha = typeof options.alpha === 'number' ? options.alpha : undefined;
    const optBeta = typeof options.beta === 'number' ? options.beta : undefined;
    const optDecay = typeof options.decayHalfLifeHours === 'number' ? options.decayHalfLifeHours : undefined;
    const optUseTSV = typeof options.useTSV === 'boolean' ? options.useTSV : undefined;

    const results: SampleResult[] = [];

    for (let i = 0; i < dataset.length; i++) {
      const sample = dataset[i];
      const q = String(sample.query ?? '');
      const roomId = String(sample.roomId ?? '');
      if (!q || !roomId) {
        results.push({
          index: i,
          roomId,
          query: q,
          k,
          hits: [],
          hitCount: 0,
          goldMessageCount: Array.isArray(sample.goldMessageIds) ? sample.goldMessageIds.length : null,
          contextPrecision: null,
          contextRecall: null,
          relevancyProxy: 0,
          faithfulnessProxy: null,
          retrievalMs: 0,
        });
        continue;
      }

      const t0 = Date.now();

      if (retrievalMode === 'messages_first') {
        const hits = await searchSimilarMessages({
          roomId,
          queryText: q,
          k,
          minScore: typeof sample.minScore === 'number' ? sample.minScore : minScore,
        });
        const retrievalMs = Date.now() - t0;

        const topHits = (Array.isArray(hits) ? hits : []).slice(0, k);
        const hitIds = topHits.map(h => String(h.messageId));
        const goldIds = Array.isArray(sample.goldMessageIds) ? sample.goldMessageIds.map(String) : undefined;

        const { precision, recall } = precisionRecall(hitIds, goldIds);

        // Build context text for proxy metrics
        const contextText = topHits.map(h => h.content ?? '').join(' ');
        const relevancyProxy = jaccard(tokenize(q), tokenize(contextText));

        let faithfulnessProxy: number | null = null;
        if (typeof sample.goldAnswer === 'string' && sample.goldAnswer.trim().length > 0) {
          faithfulnessProxy = jaccard(tokenize(sample.goldAnswer), tokenize(contextText));
        }

        results.push({
          index: i,
          roomId,
          query: q,
          k,
          hits: topHits.map(h => ({ messageId: String(h.messageId), similarity: Number(h.similarity || 0) })),
          hitCount: topHits.length,
          goldMessageCount: Array.isArray(sample.goldMessageIds) ? sample.goldMessageIds.length : null,
          contextPrecision: precision,
          contextRecall: recall,
          relevancyProxy,
          faithfulnessProxy,
          retrievalMs,
          retrievalKind: 'messages',
        });
      } else {
        // summary-first evaluation
        const aug = await retrieveAugmentedContext({
          roomId,
          queryText: q,
          k1: optK1,
          k2: optK2,
          alpha: optAlpha,
          beta: optBeta,
          minScore: typeof sample.minScore === 'number' ? sample.minScore : minScore,
          decayHalfLifeHours: optDecay,
          useTSV: optUseTSV,
        });
        const retrievalMs = Date.now() - t0;
 
        const systemBlock = (aug?.systemBlock || '').toString();
        const relevancyProxy = jaccard(tokenize(q), tokenize(systemBlock));

        // Diagnostics (summary-first): counts and top scores
        try {
          const hypaCount = Array.isArray(aug?.hypaHits) ? aug.hypaHits.length : 0;
          const supaCount = Array.isArray(aug?.supaHits) ? aug.supaHits.length : 0;
          const topScore = (arr: any[]) => (arr || []).reduce((m, h) => Math.max(m, Number(h?.combined_score ?? h?.embedding_similarity ?? 0)), 0);
          const hypaTopScore = topScore((aug as any)?.hypaHits || []);
          const supaTopScore = topScore((aug as any)?.supaHits || []);
          // eslint-disable-next-line no-console
          console.info('[diag] summary-hybrid', {
            roomId,
            k1: optK1,
            k2: optK2,
            alpha: optAlpha,
            useTSV: optUseTSV,
            hypaCount,
            supaCount,
            hypaTopScore,
            supaTopScore,
          });
        } catch {}

        let faithfulnessProxy: number | null = null;
        if (typeof sample.goldAnswer === 'string' && sample.goldAnswer.trim().length > 0) {
          faithfulnessProxy = jaccard(tokenize(sample.goldAnswer), tokenize(systemBlock));
        }

        results.push({
          index: i,
          roomId,
          query: q,
          k,
          hits: [], // not applicable in summary-first mode
          hitCount: 0,
          goldMessageCount: Array.isArray(sample.goldMessageIds) ? sample.goldMessageIds.length : null,
          contextPrecision: null,
          contextRecall: null,
          relevancyProxy,
          faithfulnessProxy,
          retrievalMs,
          retrievalKind: 'summary',
          usedMode: (aug?.usedMode as any) || undefined,
          hypaCount: Array.isArray(aug?.hypaHits) ? aug.hypaHits.length : 0,
          supaCount: Array.isArray(aug?.supaHits) ? aug.supaHits.length : 0,
          snippetCount: Array.isArray(aug?.messageSnippets) ? aug.messageSnippets.length : 0,
          contextChars: systemBlock.length,
        });
      }
    }

    const avg = <T>(arr: (T | null | undefined)[], fn: (x: T) => number): number | null => {
      const nums: number[] = [];
      for (const v of arr) if (v !== null && v !== undefined) nums.push(fn(v as T));
      if (nums.length === 0) return null;
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    };

    const summary = {
      avgPrecision: avg(results.map(r => r.contextPrecision), x => x as number),
      avgRecall: avg(results.map(r => r.contextRecall), x => x as number),
      avgRelevancyProxy: avg(results.map(r => r.relevancyProxy), x => x) ?? 0,
      avgFaithfulnessProxy: avg(results.map(r => r.faithfulnessProxy), x => x as number),
      avgRetrievalMs: avg(results.map(r => r.retrievalMs), x => x) ?? 0,
    };

    const res: EvalResponse = {
      ok: true,
      profileName,
      k,
      minScore,
      count: results.length,
      summary,
      results,
    };

    return NextResponse.json(res, { status: 200 });
  } catch (error: any) {
    console.error('[rag/eval] error:', error);
    return NextResponse.json({ ok: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}