/**
 * pgvector RAG Retrieval 유틸 (server-only)
 *
 * - 검색 로직만 담당. 인덱싱 파이프라인은 기존 repository/upsert 로직을 그대로 사용.
 * - 실패 시 예외를 밖으로 던지지 않고 빈 배열/Null 블록을 반환하여 상위에서 폴백.
 *
 * ENV (optional):
 * - RAG_MODE: 'v1' | 'hybrid' (default: v1)
 * - RAG_K: 기본 8 (v1), hybrid 기본 10
 * - RAG_FETCH_K: hybrid fetch cap (default: 32)
 * - RAG_MIN_SCORE: 기본 0.75 (v1), hybrid 기본 0.40
 * - RAG_ALPHA: hybrid 가중치 (default: 0.5)
 * - RAG_WINDOW_SIZE: 주변 윈도우 확장 step (default: 1 = disabled)
 * - RAG_USE_TSV: hybrid에서 tsvector 경로 사용 (default: false)
 * - RAG_USE_MQ: 멀티 쿼리 (default: false)
 * - RAG_USE_HYDE: HyDE (default: false)
 * - RAG_USE_RERANK: 재순위화 (default: false)
 * - RAG_DECAY_HALFLIFE_HOURS: 시간 감쇠 하프라이프 (default: null)
 * - DEBUG_RAG: 디버그 로깅 (1/true 시 활성)
 */
import 'server-only';

import { getSupabaseAdminClient } from './supabaseClient';
import { embedText, normalizeText, embedOne, normalizeForEmbedding } from './embeddings';

// Summary-First RAG imports
import { getRetrievalMode as getPolicyRetrievalMode, getThresholds } from '../memory/policy';
import type { RetrievalMode as PolicyRetrievalMode } from '../memory/policy';
import { matchHybrid as matchSummariesHybrid, getChildrenForSummaries, type MemoryHit, type MemoryChildLink } from '../memory/summary-repository';
import { normalizeAndMerge } from '../memory/merger';

const DEFAULT_K = Number(process.env.RAG_K || '') || 8;           // legacy v1 default
const DEFAULT_MIN_SCORE = Number(process.env.RAG_MIN_SCORE || '') || 0.60;

const DEBUG_RAG = String(process.env.DEBUG_RAG || '').toLowerCase() === '1'
  || String(process.env.DEBUG_RAG || '').toLowerCase() === 'true';

/**
 * Summary-First RAG: 타입/파라미터/결과
 */
export type RetrievalMode = PolicyRetrievalMode;

export interface RetrievalParams {
  roomId: string;
  queryText: string;
  embedding?: number[];
  modeOverride?: RetrievalMode;
  k1?: number;
  k2?: number;
  alpha?: number;
  beta?: number;
  minScore?: number;
  decayHalfLifeHours?: number;
  useTSV?: boolean;
  maxSnippetTokens?: number;
  recentBufferMessages?: number;
}

export interface RetrievalResult {
  systemBlock: string;
  usedMode: RetrievalMode;
  hypaHits: MemoryHit[];
  supaHits: MemoryHit[];
  messageSnippets?: Array<{ id: string; role: string; content: string; createdAt: string }>;
  drillDownPerformed: boolean;
}

/**
 * shouldDrillDown()
 * - mode === 'cascaded' 이고
 *   (HYPA/SUPA topScore < minScore || 쿼리에 인용/출처/정확/quote/citation/숫자 패턴 포함) 시 true
 */
export function shouldDrillDown(params: {
  mode: RetrievalMode;
  hypaTopScore?: number;
  supaTopScore?: number;
  minScore: number;
  queryText: string;
}): boolean {
  const { mode, hypaTopScore, supaTopScore, minScore, queryText } = params ?? ({} as any);
  if (mode !== 'cascaded') return false;

  const pattern = /(인용|출처|정확|quote|citation|숫자)/i;
  const scoreTrigger =
    (typeof hypaTopScore === 'number' ? hypaTopScore : -Infinity) < (Number.isFinite(minScore) ? minScore : 0) ||
    (typeof supaTopScore === 'number' ? supaTopScore : -Infinity) < (Number.isFinite(minScore) ? minScore : 0);
  const textTrigger = pattern.test(String(queryText || ''));
  return scoreTrigger || textTrigger;
}

/**
 * Legacy shape kept for compatibility with existing callers
 */
export interface SimilarMessageHit {
  messageId: string;
  role: string;
  content: string;
  characterId?: string | null;
  userId?: string | null;
  createdAt?: string | null;
  similarity: number;
}

/**
 * Hybrid search params and hit types
 */
export type HybridSearchParams = {
  roomId: string;
  queryText: string;
  k?: number;
  fetchK?: number;
  minScore?: number;
  alpha?: number;
  windowSize?: number;
  useTSV?: boolean;
  useMQ?: boolean;
  useHyDE?: boolean;
  useRerank?: boolean;
  decayHalfLifeHours?: number | null;
  roleFilter?: string[];
  authorFilter?: string[];
};

export type HybridHit = {
  room_id: string;
  message_id: string;
  content_text: string;
  role?: string | null;
  author_id?: string | null;
  message_created_at?: string | null;
  chunk_index?: number;
  chunk_count?: number;
  source_url?: string | null;
  sem_score?: number;
  lex_score?: number;
  combined_score?: number;
};

/**
 * rerankSimilarHits()
 * - similarity 내림차순, 동일 시 createdAt 최근순으로 재정렬
 */
export function rerankSimilarHits(hits: SimilarMessageHit[]): SimilarMessageHit[] {
  const list = Array.isArray(hits) ? hits.slice() : [];
  list.sort((a, b) => {
    const s = (b.similarity || 0) - (a.similarity || 0);
    if (s !== 0) return s;
    const ta = a.createdAt ? new Date(a.createdAt as any).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt as any).getTime() : 0;
    return tb - ta;
  });
  return list;
}

/**
 * 간단 재순위화 스텁 (hybrid용, 비용 없음)
 */
export function simpleRerank(hits: HybridHit[], topM = 24): HybridHit[] {
  return (Array.isArray(hits) ? hits.slice(0, topM) : [])
    .sort((a, b) => (b.combined_score ?? 0) - (a.combined_score ?? 0));
}

/**
 * RAG 설정 로딩
 */
function getEnvNumber(name: string, def: number | null): number | null {
  const raw = process.env[name];
  if (!raw) return def;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : def;
}

export function loadRagConfig(): {
  mode: 'hybrid' | 'v1';
  k: number;
  fetchK: number;
  minScore: number;
  alpha: number;
  windowSize: number;
  useTSV: boolean;
  useMQ: boolean;
  useHyDE: boolean;
  useRerank: boolean;
  decayHalfLifeHours: number | null;
} {
  const mode = (process.env.RAG_MODE || 'v1').toLowerCase() === 'hybrid' ? 'hybrid' : 'v1';
  const k = Number(process.env.RAG_K || '') || 10;
  const fetchK = Number(process.env.RAG_FETCH_K || '') || 32;
  const minScore = Number(process.env.RAG_MIN_SCORE || '') || 0.40;
  const alpha = Number(process.env.RAG_ALPHA || '') || 0.5;
  const windowSize = Number(process.env.RAG_WINDOW_SIZE || '') || 1;
  const useTSV = String(process.env.RAG_USE_TSV || '').toLowerCase() === '1'
    || String(process.env.RAG_USE_TSV || '').toLowerCase() === 'true';
  const useMQ = String(process.env.RAG_USE_MQ || '').toLowerCase() === '1'
    || String(process.env.RAG_USE_MQ || '').toLowerCase() === 'true';
  const useHyDE = String(process.env.RAG_USE_HYDE || '').toLowerCase() === '1'
    || String(process.env.RAG_USE_HYDE || '').toLowerCase() === 'true';
  const useRerank = String(process.env.RAG_USE_RERANK || '').toLowerCase() === '1'
    || String(process.env.RAG_USE_RERANK || '').toLowerCase() === 'true';
  const decayHalfLifeHours = getEnvNumber('RAG_DECAY_HALFLIFE_HOURS', null);
  return { mode, k, fetchK, minScore, alpha, windowSize, useTSV, useMQ, useHyDE, useRerank, decayHalfLifeHours };
}

/**
 * 쿼리 임베딩 생성 (embedOne 사용)
 */
async function embedQuery(text: string): Promise<number[]> {
  const cleaned = normalizeForEmbedding(text);
  if (!cleaned) throw new Error('embedQuery: empty text');
  return embedOne(cleaned);
}

/**
 * RPC 에러 헬퍼: 함수 미존재/시그니처 불일치 추정
 */
function isIncompatibleRPCError(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || err || '');
  // 42883: function does not exist
  // PGRST30x: PostgREST function invocation errors
  return code === '42883'
    || code === 'PGRST302'
    || code === 'PGRST301'
    || /function .* does not exist/i.test(msg)
    || /no function matches the given name/i.test(msg)
    || /schema .* has no function/i.test(msg);
}

/**
 * v1/v2/hybrid 응답 → HybridHit 매핑 (안전)
 */
function toHybridHit(row: any, fallbacks: { roomId?: string; alpha?: number }): HybridHit {
  const sem = typeof row?.sem_score === 'number' ? row.sem_score
    : (typeof row?.similarity === 'number' ? row.similarity : undefined);
  const lex = typeof row?.lex_score === 'number' ? row.lex_score : undefined;

  let combined: number | undefined = undefined;
  if (typeof row?.combined_score === 'number') combined = row.combined_score;
  else if (typeof row?.compositeScore === 'number') combined = row.compositeScore;
  else if (typeof sem === 'number') {
    // 계산 가능한 경우 가중합
    const a = typeof fallbacks.alpha === 'number' ? fallbacks.alpha : 1.0;
    const l = typeof lex === 'number' ? lex : 0;
    combined = a * sem + (1 - a) * l;
  }

  return {
    room_id: String(row?.room_id ?? fallbacks.roomId ?? ''),
    message_id: String(row?.message_id ?? ''),
    content_text: String(row?.content_text ?? row?.content ?? ''),
    role: row?.role ?? null,
    author_id: row?.author_id ?? row?.user_id ?? null,
    message_created_at: row?.message_created_at ?? row?.created_at ?? null,
    chunk_index: typeof row?.chunk_index === 'number' ? row.chunk_index : 0,
    chunk_count: typeof row?.chunk_count === 'number' ? row.chunk_count : 1,
    source_url: row?.source_url ?? null,
    sem_score: typeof sem === 'number' ? sem : undefined,
    lex_score: typeof lex === 'number' ? lex : undefined,
    combined_score: typeof combined === 'number' ? combined : undefined,
  };
}

/**
 * Hybrid RPC 호출 (fallback: v2 → v1)
 */
async function callHybridRpc(args: {
  roomId: string;
  queryEmbedding: number[];
  queryText: string;
  fetchK: number;
  minScore: number;
  alpha: number;
  decayHalfLifeHours: number | null;
  useTSV: boolean;
  roleFilter?: string[];
  authorFilter?: string[];
}): Promise<HybridHit[]> {
  const {
    roomId,
    queryEmbedding,
    queryText,
    fetchK,
    minScore,
    alpha,
    decayHalfLifeHours,
    useTSV,
    roleFilter,
    authorFilter,
  } = args;

  const supabase = getSupabaseAdminClient();

  // 1) Try hybrid
  try {
    if (DEBUG_RAG) {
      // eslint-disable-next-line no-console
      console.time('[RAG] RPC match_chat_messages_hybrid');
    }
    const { data, error } = await supabase.rpc('match_chat_messages_hybrid', {
      p_room_id: roomId,
      p_query_embedding: queryEmbedding as unknown as number[],
      p_query_text: queryText,
      p_alpha: alpha,
      p_match_count: fetchK,
      p_similarity_threshold: minScore,
      p_from_ts: null,
      p_decay_halflife_hours: decayHalfLifeHours,
      p_role_filter: roleFilter ?? null,
      p_author_filter: authorFilter ?? null,
      p_use_tsv: !!useTSV,
    });
    if (DEBUG_RAG) {
      // eslint-disable-next-line no-console
      console.timeEnd('[RAG] RPC match_chat_messages_hybrid');
    }
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const hits = rows.map((r) => toHybridHit(r, { roomId, alpha }));
    if (DEBUG_RAG) {
      const top = hits.slice(0, 5).map(h => ({
        combined: Number(h.combined_score ?? 0).toFixed(3),
        sem: Number(h.sem_score ?? 0).toFixed(3),
        lex: Number(h.lex_score ?? 0).toFixed(3),
      }));
      // eslint-disable-next-line no-console
      console.log('[RAG] hybrid ok', { k: hits.length, fetchK, alpha, minScore, top });
    }
    return hits;
  } catch (e1: any) {
    if (!isIncompatibleRPCError(e1)) {
      // eslint-disable-next-line no-console
      console.error('[RAG] hybrid rpc error', safeErrorForLog(e1));
      // 계속 폴백 시도
    }
  }

  // 2) Try v2 if exists
  try {
    if (DEBUG_RAG) {
      // eslint-disable-next-line no-console
      console.time('[RAG] RPC match_chat_messages_v2');
    }
    const { data, error } = await supabase.rpc('match_chat_messages_v2', {
      room_id: roomId,
      query_embedding: queryEmbedding as unknown as number[],
      match_count: fetchK,
      similarity_threshold: minScore,
      from_ts: null,
      decay_halflife_hours: decayHalfLifeHours,
      alpha: alpha,
      role: null,
      character_id: null,
    });
    if (DEBUG_RAG) {
      // eslint-disable-next-line no-console
      console.timeEnd('[RAG] RPC match_chat_messages_v2');
    }
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const hits = rows.map((r) => toHybridHit(r, { roomId, alpha }));
    if (DEBUG_RAG) {
      const top = hits.slice(0, 5).map(h => ({
        combined: Number(h.combined_score ?? 0).toFixed(3),
        sem: Number(h.sem_score ?? 0).toFixed(3),
        lex: Number(h.lex_score ?? 0).toFixed(3),
      }));
      // eslint-disable-next-line no-console
      console.log('[RAG] v2 ok', { k: hits.length, fetchK, alpha, minScore, top });
    }
    return hits;
  } catch (e2: any) {
    if (!isIncompatibleRPCError(e2)) {
      // eslint-disable-next-line no-console
      console.error('[RAG] v2 rpc error', safeErrorForLog(e2));
      // 계속 폴백 시도
    }
  }

  // 3) Fallback v1 (semantic-only)
  try {
    if (DEBUG_RAG) {
      // eslint-disable-next-line no-console
      console.time('[RAG] RPC match_chat_messages (v1)');
    }
    const { data, error } = await supabase.rpc('match_chat_messages', {
      room_id: roomId,
      query_embedding: queryEmbedding as unknown as number[],
      match_count: fetchK,
      similarity_threshold: minScore,
    });
    if (DEBUG_RAG) {
      // eslint-disable-next-line no-console
      console.timeEnd('[RAG] RPC match_chat_messages (v1)');
    }
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const hits = rows.map((r) =>
      toHybridHit(
        {
          ...r,
          content_text: r?.content ?? r?.content_text ?? '',
          sem_score: typeof r?.similarity === 'number' ? r.similarity : undefined,
          lex_score: 0,
          combined_score: typeof r?.similarity === 'number' ? r.similarity : undefined,
          message_created_at: r?.created_at ?? r?.message_created_at ?? null,
        },
        { roomId, alpha: 1.0 },
      ),
    );
    if (DEBUG_RAG) {
      const top = hits.slice(0, 5).map(h => ({
        combined: Number(h.combined_score ?? 0).toFixed(3),
        sem: Number(h.sem_score ?? 0).toFixed(3),
        lex: Number(h.lex_score ?? 0).toFixed(3),
      }));
      // eslint-disable-next-line no-console
      console.log('[RAG] v1 ok', { k: hits.length, fetchK, minScore, top });
    }
    return hits;
  } catch (e3: any) {
    // eslint-disable-next-line no-console
    console.error('[RAG] v1 rpc error', safeErrorForLog(e3));
    return [];
  }
}

function safeErrorForLog(err: any) {
  return {
    error: {
      message: err?.message ?? null,
      code: err?.code ?? null,
      details: err?.details ?? null,
      hint: err?.hint ?? null,
      raw: (() => {
        try { return JSON.stringify(err, Object.getOwnPropertyNames(err as any)); }
        catch { try { return JSON.stringify(err); } catch { return String(err); } }
      })(),
    },
  };
}

/**
 * 멀티쿼리/HyDE — 현재는 안전 no-op
 */
async function multiQueryRewriteIfEnabled(q: string, useMQ: boolean): Promise<string[]> {
  return useMQ ? [q] /* TODO: LLM 기반 구현 예정 */ : [q];
}

async function hydeIfEnabled(q: string, useHyDE: boolean): Promise<string[]> {
  return useHyDE ? [q] /* TODO: LLM 기반 구현 예정 */ : [q];
}

/**
 * 컨텍스트 압축 및 중복 제거
 * - 동일 (message_id, chunk_index) 제거
 * - 문자 예산(maxChars) 내에서 수집
 * - 간단 다양성: (role, author_id) 버킷을 최소 1개씩 포함하도록 우선 수집
 */
export function compressContext(hits: HybridHit[], opts?: { maxChars?: number }): HybridHit[] {
  const maxChars = Math.max(1, opts?.maxChars ?? 6000);

  // 1) dedup by message_id + chunk_index (pick highest combined_score)
  const bestByKey = new Map<string, HybridHit>();
  for (const h of (hits || [])) {
    const key = `${h.message_id ?? ''}#${h.chunk_index ?? 0}`;
    const prev = bestByKey.get(key);
    if (!prev || (h.combined_score ?? 0) > (prev.combined_score ?? 0)) {
      bestByKey.set(key, h);
    }
  }
  const deduped = Array.from(bestByKey.values());

  // 2) sort by combined_score desc (fallback to sem_score)
  deduped.sort((a, b) => (b.combined_score ?? b.sem_score ?? 0) - (a.combined_score ?? a.sem_score ?? 0));

  // 3) bucket by (role, author_id)
  const bucketKey = (h: HybridHit) => `${h.role ?? ''}|${h.author_id ?? ''}`;
  const buckets = new Map<string, HybridHit[]>();
  for (const h of deduped) {
    const k = bucketKey(h);
    const arr = buckets.get(k) ?? [];
    arr.push(h);
    buckets.set(k, arr);
  }
  for (const arr of buckets.values()) {
    arr.sort((a, b) => (b.combined_score ?? b.sem_score ?? 0) - (a.combined_score ?? a.sem_score ?? 0));
  }

  // 4) round-robin: 우선 각 버킷에서 1개씩 뽑아 다양성 확보 → 이후 전체 순위로 채우기
  const selected: HybridHit[] = [];
  let usedChars = 0;

  // stage A: take first item from each bucket in descending bucket-top score order
  const orderedBuckets = Array.from(buckets.values()).sort((a, b) =>
    (b[0]?.combined_score ?? b[0]?.sem_score ?? 0) - (a[0]?.combined_score ?? a[0]?.sem_score ?? 0)
  );
  for (const arr of orderedBuckets) {
    const h = arr[0];
    const delta = (h.content_text ?? '').length + 1;
    if (usedChars + delta > maxChars) break;
    selected.push(h);
    usedChars += delta;
  }

  // stage B: fill remainder by global order, skipping those already included
  const already = new Set(selected.map(h => `${h.message_id ?? ''}#${h.chunk_index ?? 0}`));
  for (const h of deduped) {
    const key = `${h.message_id ?? ''}#${h.chunk_index ?? 0}`;
    if (already.has(key)) continue;
    const delta = (h.content_text ?? '').length + 1;
    if (usedChars + delta > maxChars) break;
    selected.push(h);
    usedChars += delta;
  }

  return selected;
}

/**
 * (선택) 윈도우 확장 훅 — 미존재 시 빈 결과
 */
async function expandWindowIfSupported(
  roomId: string,
  baseMessageIds: string[],
  windowSize: number
): Promise<Record<string, { left: any[]; right: any[] }>> {
  if (windowSize <= 1) return {};
  const supabase = getSupabaseAdminClient();
  try {
    const { data, error } = await supabase.rpc('expand_window_for_hits', {
      room_id: roomId,
      base_message_ids: baseMessageIds,
      window_size: windowSize,
    } as any);
    if (error) throw error;
    return (data ?? {}) as any;
  } catch {
    // alt param names (best-effort)
    try {
      const { data, error } = await supabase.rpc('expand_window_for_hits', {
        p_room_id: roomId,
        p_message_ids: baseMessageIds,
        p_window_size: windowSize,
      } as any);
      if (error) throw error;
      return (data ?? {}) as any;
    } catch {
      return {};
    }
  }
}

/**
 * 공개 API: 하이브리드 검색
 */
export async function searchHybridMessages(params: HybridSearchParams): Promise<HybridHit[]> {
  const cfg = loadRagConfig();
  const roomId = String(params.roomId || '').trim();
  const queryText = String(params.queryText || '').trim();
  if (!roomId || !queryText) return [];

  const k = typeof params.k === 'number' ? params.k : cfg.k;
  const fetchK = typeof params.fetchK === 'number' ? params.fetchK : cfg.fetchK;
  const minScore = typeof params.minScore === 'number' ? params.minScore : cfg.minScore;
  const alpha = typeof params.alpha === 'number' ? params.alpha : cfg.alpha;
  const windowSize = typeof params.windowSize === 'number' ? params.windowSize : cfg.windowSize;
  const useTSV = typeof params.useTSV === 'boolean' ? params.useTSV : cfg.useTSV;
  const useMQ = typeof params.useMQ === 'boolean' ? params.useMQ : cfg.useMQ;
  const useHyDE = typeof params.useHyDE === 'boolean' ? params.useHyDE : cfg.useHyDE;
  const useRerank = typeof params.useRerank === 'boolean' ? params.useRerank : cfg.useRerank;
  const decayHalfLifeHours =
    params.decayHalfLifeHours === undefined ? cfg.decayHalfLifeHours : params.decayHalfLifeHours;
  const roleFilter = params.roleFilter;
  const authorFilter = params.authorFilter;

  try {
    // 1) query rewrite
    const mqList = await multiQueryRewriteIfEnabled(queryText, useMQ);
    const variantsSet = new Set<string>();
    for (const q of mqList) {
      const hydeList = await hydeIfEnabled(q, useHyDE);
      for (const qq of hydeList) {
        const cleaned = (qq || '').trim();
        if (cleaned) variantsSet.add(cleaned);
      }
    }
    const queries = Array.from(variantsSet.size ? variantsSet : new Set([queryText]));

    // 2) per-query retrieval then merge
    const byKey = new Map<string, HybridHit>(); // key: message_id#chunk_index
    for (const q of queries) {
      const queryEmbedding = await embedQuery(q);

      const hits = await callHybridRpc({
        roomId,
        queryEmbedding,
        queryText: q,
        fetchK,
        minScore,
        alpha,
        decayHalfLifeHours,
        useTSV,
        roleFilter,
        authorFilter,
      });

      for (const h of hits) {
        const key = `${h.message_id ?? ''}#${h.chunk_index ?? 0}`;
        const prev = byKey.get(key);
        if (!prev || (h.combined_score ?? 0) > (prev.combined_score ?? 0)) {
          byKey.set(key, h);
        }
      }
    }

    // 3) merge list
    let merged = Array.from(byKey.values())
      .sort((a, b) => (b.combined_score ?? b.sem_score ?? 0) - (a.combined_score ?? a.sem_score ?? 0));

    // 4) optional rerank
    if (useRerank) {
      merged = simpleRerank(merged, Math.max(k * 2, 24));
    }

    // 5) optional window expand (disabled by default)
    if (windowSize > 1 && merged.length > 0) {
      const baseIds = merged.map(h => h.message_id).filter(Boolean) as string[];
      try {
        await expandWindowIfSupported(roomId, baseIds, windowSize);
        // NOTE: 본 태스크에서는 확장 결과를 사용하지 않음(후속 태스크에서 통합 가능)
      } catch {
        /* ignore */
      }
    }

    // 6) compress to char budget, then slice k
    const compressed = compressContext(merged, { maxChars: 6000 });
    return compressed.slice(0, k);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[rag] searchHybridMessages failed', {
      error: err?.message ?? String(err),
      roomId,
      queryLen: normalizeText(queryText).length,
      k,
      minScore,
      alpha,
    });
    return [];
  }
}

/**
 * 기존 v1 경로 (semantic-only) — 분리하여 래퍼에서 사용
 */
async function searchSimilarMessagesV1(params: {
  roomId: string;
  queryText: string;
  k?: number;
  minScore?: number;
}): Promise<SimilarMessageHit[]> {
  const roomId = String(params.roomId || '').trim();
  const queryText = String(params.queryText || '').trim();
  const k = typeof params.k === 'number' ? params.k : DEFAULT_K;
  const minScore = typeof params.minScore === 'number' ? params.minScore : DEFAULT_MIN_SCORE;

  if (!roomId || !queryText) return [];

  try {
    const supabase = getSupabaseAdminClient();
    const queryEmbedding = await embedText(queryText);

    const { data, error } = await supabase.rpc('match_chat_messages', {
      room_id: roomId,
      query_embedding: queryEmbedding as unknown as number[], // @supabase/postgrest: vector is serialized server-side
      match_count: k,
      similarity_threshold: minScore,
    });

    if (error) {
      // eslint-disable-next-line no-console
      console.error('[rag] match_chat_messages rpc error', {
        error: {
          message: (error as any)?.message ?? null,
          code: (error as any)?.code ?? null,
          details: (error as any)?.details ?? null,
          hint: (error as any)?.hint ?? null,
          raw: (() => {
            try { return JSON.stringify(error, Object.getOwnPropertyNames(error as any)); }
            catch { try { return JSON.stringify(error); } catch { return String(error); } }
          })(),
        },
        guidance: 'Supabase 함수 존재/시그니처 확인 필요. supabase/schema/002_match_chat_messages.sql 적용 후 Schema Reload.',
        params: { room_id: roomId, k, minScore },
      });
      return [];
    }

    const rows = Array.isArray(data) ? data : [];
    const hits: SimilarMessageHit[] = rows.map((r: any) => ({
      messageId: String(r.message_id ?? ''),
      role: String(r.role ?? 'assistant'),
      content: String(r.content ?? ''),
      characterId: r.character_id ?? null,
      userId: r.user_id ?? null,
      createdAt: r.created_at ?? null,
      similarity: typeof r.similarity === 'number' ? r.similarity : Number(r.similarity ?? 0),
    }));

    if (DEBUG_RAG) {
      const top = hits.slice(0, 3).map(h => Number(h.similarity).toFixed(3));
      // eslint-disable-next-line no-console
      console.log('[rag] retrieved (v1)', { roomId, k, minScore, hits: hits.length, top });
    }

    return hits;
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[rag] searchSimilarMessages failed', {
      error: err?.message ?? String(err),
      roomId,
      queryLen: normalizeText(queryText).length,
      k,
      minScore,
    });
    return [];
  }
}

/**
 * 기존 함수 호환 래퍼(절대 제거 금지)
 * - env RAG_MODE === 'hybrid' 이면 하이브리드 경로로 실행 후 SimilarMessageHit로 매핑
 * - 그 외는 기존 v1 경로 유지
 */
export async function searchSimilarMessages(params: {
  roomId: string;
  queryText: string;
  k?: number;
  minScore?: number;
}): Promise<SimilarMessageHit[]> {
  const mode = loadRagConfig().mode;
  if (mode === 'hybrid') {
    const k = typeof params.k === 'number' ? params.k : undefined;
    const minScore = typeof params.minScore === 'number' ? params.minScore : undefined;
    const hh = await searchHybridMessages({
      roomId: params.roomId,
      queryText: params.queryText,
      k,
      minScore,
    });
    // HybridHit → SimilarMessageHit 매핑 (similarity = combined_score 우선)
    const out: SimilarMessageHit[] = hh.map(h => ({
      messageId: String(h.message_id ?? ''),
      role: String(h.role ?? 'assistant'),
      content: String(h.content_text ?? ''),
      characterId: null,
      userId: h.author_id ?? null,
      createdAt: h.message_created_at ?? null,
      similarity: (typeof h.combined_score === 'number' ? h.combined_score
        : (typeof h.sem_score === 'number' ? h.sem_score : 0)),
    }));
    return out;
  }
  // v1
  return searchSimilarMessagesV1(params);
}

/**
 * buildRagSystemBlock()
 * - 결과 중복 제거(messageId 기준)
 * - 전체 길이 제한(maxChars) 내에서 bullet 형태로 구성
 * - 컨텐츠가 없으면 null 반환
 */
export function buildRagSystemBlock(
  results: SimilarMessageHit[],
  maxChars: number = 1500
): string | null {
  if (!Array.isArray(results) || results.length === 0) return null;

  const seen = new Set<string>();
  const bullets: string[] = [];

  for (const r of results) {
    const id = r.messageId || '';
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);

    const role = r.role || 'assistant';
    const content = (r.content || '').trim();
    if (!content) continue;

    const snippet = truncate(content, 220);
    bullets.push(`- (${role}) ${snippet}`);
  }

  if (bullets.length === 0) return null;

  // 헤더 + bullets 합치기 및 전체 길이 제한
  const header = 'Relevant memory (retrieved):';
  let body = header + '\n' + bullets.join('\n');

  if (body.length > maxChars) {
    // 자르는 위치는 줄 경계를 가급적 유지
    body = body.slice(0, maxChars);
    const lastNl = body.lastIndexOf('\n');
    if (lastNl > header.length) {
      body = body.slice(0, lastNl) + '\n- ...';
    } else {
      body = body.slice(0, Math.max(header.length + 1, maxChars - 3)) + '...';
    }
  }

  return body;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 40) return cut.slice(0, lastSpace) + '...';
  return cut + '...';
}
/**
 * fetchMessageSnippetsByRanges()
 * - 요약(parent) → 자식 링크 범위로 원문 메시지 스니펫을 조회
 * - 저장소 유틸 부재 시 Supabase 직접 호출 (chat_message_embeddings / chat_messages)
 * - recentBufferMessages > 0 이면 최신 n개를 추가
 * - 문자/4 근사 토큰 예산을 넘지 않도록 누적 절단
 *
 * Note:
 * - chat_messages 테이블이 환경에 없을 수 있으므로 예외/에러는 무시하고 가능한 경로만 사용
 * - message_id 기준 중복 제거
 */
export async function fetchMessageSnippetsByRanges(
  roomId: string,
  links: MemoryChildLink[],
  maxTokens: number,
  recentBufferMessages: number,
): Promise<Array<{ id: string; role: string; content: string; createdAt: string }>> {
  if (!roomId || !Array.isArray(links) || links.length === 0) return [];
  try {
    const supabase = getSupabaseAdminClient();

    const dedup = new Map<string, { id: string; role: string; content: string; createdAt: string }>();

    const push = (id: any, role: any, content: any, createdAt: any) => {
      const sId = String(id ?? '').trim();
      const roleStr = String(role ?? 'assistant');
      const text = String(content ?? '').trim();
      const ts = createdAt ? new Date(createdAt).toISOString() : new Date(0).toISOString();
      if (!sId || !text) return;
      if (!dedup.has(sId)) {
        dedup.set(sId, { id: sId, role: roleStr, content: text, createdAt: ts });
      }
    };

    // A) created_at 범위: chat_message_embeddings (chunk_index = 0)
    for (const l of links) {
      const from = l.message_created_from ?? null;
      const to = l.message_created_to ?? null;
      if (!from && !to) continue;
      try {
        let q: any = supabase
          .from('chat_message_embeddings')
          .select('message_id, role, content_text, message_created_at, chunk_index')
          .eq('room_id', roomId)
          .eq('chunk_index', 0)
          .order('message_created_at', { ascending: true });

        if (from) q = q.gte('message_created_at', from);
        if (to) q = q.lte('message_created_at', to);

        const { data, error } = await q;
        if (!error && Array.isArray(data)) {
          for (const r of data) {
            push(r.message_id, r.role, r.content_text ?? r.content, r.message_created_at);
          }
        }
      } catch {
        /* ignore */
      }
    }

    // B) id 범위: chat_messages (존재하는 환경에서만)
    for (const l of links) {
      const fromId = typeof l.message_id_from === 'number' ? l.message_id_from : null;
      const toId = typeof l.message_id_to === 'number' ? l.message_id_to : null;
      if (fromId == null && toId == null) continue;
      try {
        let q: any = supabase
          .from('chat_messages')
          .select('id, role, content, created_at')
          .eq('room_id', roomId)
          .order('id', { ascending: true });
        if (fromId != null) q = q.gte('id', fromId);
        if (toId != null) q = q.lte('id', toId);

        const { data, error } = await q;
        if (!error && Array.isArray(data)) {
          for (const r of data) {
            push(r.id, r.role, r.content, r.created_at);
          }
        }
      } catch {
        // chat_messages 테이블이 없을 수 있음
      }
    }

    // C) 최근 버퍼 추가
    if (Number.isFinite(recentBufferMessages) && recentBufferMessages > 0) {
      try {
        const { data, error } = await supabase
          .from('chat_message_embeddings')
          .select('message_id, role, content_text, message_created_at, chunk_index')
          .eq('room_id', roomId)
          .eq('chunk_index', 0)
          .order('message_created_at', { ascending: false })
          .limit(Math.max(1, Math.trunc(recentBufferMessages)));
        if (!error && Array.isArray(data)) {
          data.reverse(); // 오래된 → 최신 순으로 정렬
          for (const r of data) {
            push(r.message_id, r.role, r.content_text ?? (r as any).content, r.message_created_at);
          }
        }
      } catch {
        /* ignore */
      }
    }

    // 정렬 및 토큰 예산 절단 (문자/4 근사)
    const all = Array.from(dedup.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const estimate = (s: string) => Math.max(1, Math.ceil((s ?? '').length / 4));
    const out: Array<{ id: string; role: string; content: string; createdAt: string }> = [];
    let used = 0;
    const limit = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.trunc(maxTokens) : Number.POSITIVE_INFINITY;

    for (const m of all) {
      const t = estimate(m.content);
      if (used + t > limit) break;
      used += t;
      out.push(m);
    }

    return out;
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[rag] fetchMessageSnippetsByRanges failed', { error: err?.message ?? String(err) });
    return [];
  }
}

/**
 * retrieveSummaryContext()
 * - HYPA(level=1)/SUPA(level=0) 요약 검색 → 병합 → (조건부) 자식 범위 드릴다운
 * - 실패 시 콘솔 로깅 후 안전한 빈 결과 반환
 *
 * 테스트 힌트:
 * - embedding 없이도 queryText + useTSV=true 로 검색 가능
 * - minScore 높여 shouldDrillDown 트리거 확인
 * - maxSnippetTokens 낮춰 누적 절단 확인
 */
export async function retrieveSummaryContext(params: RetrievalParams): Promise<RetrievalResult> {
  const roomId = String(params.roomId || '').trim();
  const queryText = String(params.queryText || '').trim();
  if (!roomId || !queryText) {
    return {
      systemBlock: '',
      usedMode: params.modeOverride ?? (getPolicyRetrievalMode(roomId, undefined) as PolicyRetrievalMode),
      hypaHits: [],
      supaHits: [],
      messageSnippets: [],
      drillDownPerformed: false,
    };
  }

  const thresholds = getThresholds(roomId, undefined);
  const mode = (params.modeOverride ?? getPolicyRetrievalMode(roomId, undefined)) as PolicyRetrievalMode;

  const alpha = typeof params.alpha === 'number' ? params.alpha : thresholds.alpha;
  const minScore = typeof params.minScore === 'number' ? params.minScore : thresholds.minScore;
  const decayHalfLifeHours =
    typeof params.decayHalfLifeHours === 'number' ? params.decayHalfLifeHours : thresholds.decayHalfLifeHours;
  const useTSV = typeof params.useTSV === 'boolean' ? params.useTSV : true;
  const k1 = Number.isFinite(params.k1 as number) ? (params.k1 as number) : thresholds.k1;
  const k2 = Number.isFinite(params.k2 as number) ? (params.k2 as number) : thresholds.k2;
  const beta = typeof params.beta === 'number' ? params.beta : thresholds.beta;
  const limitTokens = Number.isFinite(params.maxSnippetTokens as number)
    ? (params.maxSnippetTokens as number)
    : thresholds.maxSnippetTokens;

const queryEmbedding = Array.isArray(params.embedding) ? params.embedding : await embedQuery(queryText);
  let hypaHits: MemoryHit[] = [];
  let supaHits: MemoryHit[] = [];
  try {
    // HYPA: level 1
    try {
      hypaHits = await matchSummariesHybrid({
        roomId,
        queryEmbedding,
        queryText,
        alpha,
        k: k1,
        minScore,
        fromTs: null as any,
        decayHalfLifeHours,
        levelFilter: [1],
        useTSV,
      });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[rag] retrieveSummaryContext: HYPA matchHybrid failed', e?.message ?? e);
      hypaHits = [];
    }
    // SUPA: level 0
    try {
      supaHits = await matchSummariesHybrid({
        roomId,
        queryEmbedding,
        queryText,
        alpha,
        k: k2,
        minScore,
        fromTs: null as any,
        decayHalfLifeHours,
        levelFilter: [0],
        useTSV,
      });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[rag] retrieveSummaryContext: SUPA matchHybrid failed', e?.message ?? e);
      supaHits = [];
    }
  } catch {
    /* ignore */
  }
  if (DEBUG_RAG && (hypaHits.length === 0 || supaHits.length === 0)) {
    // eslint-disable-next-line no-console
    console.warn('[RAG] summary hybrid empty results; likely using lexical fallback or DB function mismatch', {
      hypa: hypaHits.length,
      supa: supaHits.length,
    });
  }

  const topHypa =
    hypaHits.reduce((m, h) => Math.max(m, Number(h.combined_score ?? h.embedding_similarity ?? 0)), -Infinity) || 0;
  const topSupa =
    supaHits.reduce((m, h) => Math.max(m, Number(h.combined_score ?? h.embedding_similarity ?? 0)), -Infinity) || 0;

  // Diagnostics: summary hybrid retrieval counts and top scores
  try {
    // eslint-disable-next-line no-console
    console.info('[diag] summary-hybrid', {
      roomId,
      k1,
      k2,
      alpha,
      useTSV,
      hypaCount: hypaHits.length,
      supaCount: supaHits.length,
      hypaTopScore: topHypa,
      supaTopScore: topSupa,
    });
  } catch {}

  // 병합 → systemBlock
  let systemBlock = '';
  try {
    const merged = normalizeAndMerge({
      hypa: hypaHits,
      supa: supaHits,
      beta,
      limitTokens,
    });
    systemBlock = merged.systemBlock ?? '';
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[rag] normalizeAndMerge failed', e?.message ?? e);
    systemBlock = '';
  }

  // 조건부 드릴다운
  let drillDownPerformed = false;
  let snippets: Array<{ id: string; role: string; content: string; createdAt: string }> = [];

  try {
    if (
      shouldDrillDown({
        mode: mode as RetrievalMode,
        hypaTopScore: topHypa,
        supaTopScore: topSupa,
        minScore,
        queryText,
      })
    ) {
      const parentIds = Array.from(new Set<string>([...hypaHits, ...supaHits].map((h) => String(h.id))));
      let children: MemoryChildLink[] = [];
      if (parentIds.length > 0) {
        try {
          children = await getChildrenForSummaries(parentIds);
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.error('[rag] getChildrenForSummaries failed', e?.message ?? e);
          children = [];
        }
      }

      // Resolve two-hop links: HYPA->SUPA -> (SUPA->MSG ranges)
      const linksForSnippets: MemoryChildLink[] = [];
      if (children.length > 0) {
        // A) Direct SUPA->MSG ranges already present
        const directMsgRanges = children.filter(
          (l) =>
            l.level_edge === 0 &&
            (
              (l.message_created_from && l.message_created_to) ||
              typeof l.message_id_from === 'number' ||
              typeof l.message_id_to === 'number'
            ),
        );
        linksForSnippets.push(...directMsgRanges);

        // B) HYPA->SUPA (no ranges) => look up SUPA children to obtain SUPA->MSG ranges
        const supaIds = Array.from(
          new Set(
            children
              .filter((l) => l.level_edge === 1 && l.child_summary_id)
              .map((l) => String(l.child_summary_id as string)),
          ),
        );

        if (supaIds.length > 0) {
          try {
            const supaChildren = await getChildrenForSummaries(supaIds);
            const supaMsgRanges = (supaChildren || []).filter((l) => l.level_edge === 0);
            linksForSnippets.push(...supaMsgRanges);
          } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('[rag] getChildrenForSummaries (second-hop) failed', e?.message ?? e);
          }
        }

        // C) Fetch message snippets only from message-range links
        if (linksForSnippets.length > 0) {
          snippets = await fetchMessageSnippetsByRanges(
            roomId,
            linksForSnippets,
            limitTokens,
            Math.max(0, Math.trunc(params.recentBufferMessages ?? 0)),
          );
        }
      }

      if (snippets.length > 0) {
        const lines = snippets.map((s) => `- (${s.role}) ${truncate(s.content, 220)}`);
        const snippetSection = `Snippets (linked evidence only):\n${lines.join('\n')}`;
        systemBlock = (systemBlock || '').trim();
        systemBlock = systemBlock ? `${systemBlock}\n\n${snippetSection}` : snippetSection;
      }

      drillDownPerformed = true;
    }
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[rag] drill-down failed', e?.message ?? e);
  }

  const usedMode: RetrievalMode =
    mode === 'messages_first' ? 'messages_first' : (mode as RetrievalMode);

  return {
    systemBlock,
    usedMode,
    hypaHits,
    supaHits,
    messageSnippets: snippets,
    drillDownPerformed,
  };
}

/**
 * retrieveAugmentedContext()
 * - messages_first 모드면 기존 "메시지 우선" 경로를 유지하여 systemBlock 구성
 * - 그 외 모드는 retrieveSummaryContext() 경로로 수행
 */
export async function retrieveAugmentedContext(params: RetrievalParams): Promise<RetrievalResult> {
  const roomId = String(params.roomId || '').trim();
  const queryText = String(params.queryText || '').trim();
  const thresholds = getThresholds(roomId, undefined);
  const mode = (params.modeOverride ?? getPolicyRetrievalMode(roomId, undefined)) as PolicyRetrievalMode;

  if (mode === 'messages_first') {
    try {
      const k = Number.isFinite(params.k2 as number) ? (params.k2 as number) : thresholds.k2;
      const minScore = Number.isFinite(params.minScore as number) ? (params.minScore as number) : thresholds.minScore;

      const hits = await searchSimilarMessages({ roomId, queryText, k, minScore });
      const systemBlock = buildRagSystemBlock(hits, thresholds.maxSnippetTokens) ?? '';

      return {
        systemBlock,
        usedMode: 'messages_first',
        hypaHits: [],
        supaHits: [],
        messageSnippets: [],
        drillDownPerformed: false,
      };
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[rag] retrieveAugmentedContext(messages_first) failed', err?.message ?? err);
      return {
        systemBlock: '',
        usedMode: 'messages_first',
        hypaHits: [],
        supaHits: [],
        messageSnippets: [],
        drillDownPerformed: false,
      };
    }
  }

  // summary-first 경로
  return retrieveSummaryContext(params);
}