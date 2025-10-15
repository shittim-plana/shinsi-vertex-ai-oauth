/**
 * Memory Summary 저장소 (SUPA/HYPA)
 *
 * - Supabase Admin 클라이언트 패턴은 vector/repository.ts와 동일하게 사용
 * - 테이블/칼럼명은 supabase/schema/007_memory_summaries.sql와 1:1 매칭
 *
 * 제공:
 * - upsertSummary
 * - storeLinks
 * - nextChunkNo
 * - getRecent
 * - matchHybrid (RPC: match_chat_memory_summaries_hybrid)
 * - getChildrenForSummaries (RPC: get_summary_children)
 *
 * TODO:
 * - 트랜잭션 단위 삽입/링킹(서버 RPC로 승격) 검토
 * - user_id가 uuid가 아닐 수 있는 환경 대비 추가 전략(별도 텍스트 컬럼)
 */

import 'server-only';

import { getSupabaseAdminClient } from '../vector/supabaseClient';
import { embedOne, normalizeForEmbedding } from '../vector/embeddings';

export type MemoryLevel = 0 | 1;

export interface MemorySummary {
  id: string;
  room_id: string;
  user_id?: string | null;
  level: MemoryLevel;
  chunk_no: number;
  summary: string;
  token_count: number;
  created_at: string;
  updated_at: string;
  embedding?: number[] | null;
}

export interface MemoryHit {
  id: string;
  room_id: string;
  level: MemoryLevel;
  chunk_no: number;
  summary: string;
  created_at: string;
  embedding_similarity?: number | null;
  lexical_score?: number | null;
  recency_weight?: number | null;
  combined_score?: number | null;
}

export interface MemoryChildLink {
  parent_summary_id: string;
  child_summary_id?: string | null;
  level_edge: 0 | 1;
  message_id_from?: number | null;
  message_id_to?: number | null;
  message_created_from?: string | null;
  message_created_to?: string | null;
}

/**
 * chat_memory_summaries 업서트
 * - onConflict: room_id, level, chunk_no
 * - 반환: 단일 행
 */
export async function upsertSummary(input: {
  roomId: string;
  userId?: string;
  level: MemoryLevel;
  chunkNo: number;
  summary: string;
  tokenCount?: number;
  embedding?: number[];
}): Promise<MemorySummary> {
  if (typeof window !== 'undefined') {
    throw new Error('summary-repository: server-only');
  }
  const { roomId, userId, level, chunkNo, summary, tokenCount = 0, embedding } = input;
  if (!roomId) throw new Error('upsertSummary: roomId is required');
  if (typeof level !== 'number') throw new Error('upsertSummary: level is required');
  if (!Number.isFinite(chunkNo)) throw new Error('upsertSummary: chunkNo is required');
  if (!summary || summary.length === 0) throw new Error('upsertSummary: summary is required');

  const supabase = getSupabaseAdminClient();

  const embeddingToSave = Array.isArray(embedding) && embedding.length > 0
    ? embedding
    : await (async () => {
      try {
        const cleaned = normalizeForEmbedding(summary);
        if (!cleaned) return null as any;
        return await embedOne(cleaned);
      } catch {
        return null as any;
      }
    })();

  const payload: any = {
    room_id: roomId,
    level,
    chunk_no: chunkNo,
    summary,
    token_count: Number.isFinite(tokenCount) ? Math.max(0, Math.trunc(tokenCount)) : 0,
    embedding: Array.isArray(embeddingToSave) ? embeddingToSave : null,
  };
  if (typeof userId === 'string') {
    payload.user_id = isUuid(userId) ? userId : null;
  }

  try {
    const { data, error } = await supabase
      .from('chat_memory_summaries')
      .upsert(payload, { onConflict: 'room_id,level,chunk_no' })
      .select('*')
      .single();

    if (error) throw error;
    return data as MemorySummary;
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[memory-summary] upsertSummary failed', {
      error: serializeError(err),
      roomId,
      level,
      chunkNo,
      hasEmbedding: Array.isArray(embedding) && embedding.length > 0,
      summaryLen: summary.length,
    });
    throw err;
  }
}

/**
 * chat_memory_links 저장
 * - 고유성은 표현식 unique index로 보장되어 upsert가 불가
 * - unique_violation(23505)은 무시(멱등)
 */
export async function storeLinks(parentId: string, links: MemoryChildLink[]): Promise<void> {
  if (typeof window !== 'undefined') {
    throw new Error('summary-repository: server-only');
  }
  if (!parentId) return;
  if (!Array.isArray(links) || links.length === 0) return;

  const supabase = getSupabaseAdminClient();

  for (const l of links) {
    const row = {
      parent_summary_id: parentId,
      child_summary_id: l.child_summary_id ?? null,
      level_edge: l.level_edge,
      message_id_from: toNullableNumber(l.message_id_from),
      message_id_to: toNullableNumber(l.message_id_to),
      message_created_from: toIsoOrNull(l.message_created_from),
      message_created_to: toIsoOrNull(l.message_created_to),
    };
    try {
      const { error } = await supabase.from('chat_memory_links').insert(row).select('id').single();
      if (error) {
        // 23505: unique_violation
        if (error.code === '23505') continue;
        throw error;
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[memory-summary] storeLinks insert failed', {
        error: serializeError(err),
        parentId,
        row,
      });
      throw err;
    }
  }
}

/**
 * 다음 chunk_no 계산 (연속 증가)
 * - 존재하지 않으면 0부터 시작
 */
export async function nextChunkNo(roomId: string, level: MemoryLevel): Promise<number> {
  if (typeof window !== 'undefined') {
    throw new Error('summary-repository: server-only');
  }
  if (!roomId) throw new Error('nextChunkNo: roomId is required');

  const supabase = getSupabaseAdminClient();

  try {
    const { data, error } = await supabase
      .from('chat_memory_summaries')
      .select('chunk_no')
      .eq('room_id', roomId)
      .eq('level', level)
      .order('chunk_no', { ascending: false })
      .limit(1);

    if (error) throw error;
    if (!data || data.length === 0) return 0;
    const maxChunk = Number(data[0]?.chunk_no ?? 0);
    return Number.isFinite(maxChunk) ? maxChunk + 1 : 0;
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[memory-summary] nextChunkNo failed', {
      error: serializeError(err),
      roomId,
      level,
    });
    throw err;
  }
}

/**
 * 최근 요약 조회
 */
export async function getRecent(params: {
  roomId: string;
  level?: MemoryLevel;
  limit?: number;
}): Promise<MemorySummary[]> {
  if (typeof window !== 'undefined') {
    throw new Error('summary-repository: server-only');
  }
  const { roomId, level, limit = 20 } = params;
  if (!roomId) throw new Error('getRecent: roomId is required');

  const supabase = getSupabaseAdminClient();
  try {
    let q = supabase
      .from('chat_memory_summaries')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.trunc(limit)));

    if (typeof level === 'number') {
      q = q.eq('level', level);
    }

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as MemorySummary[];
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[memory-summary] getRecent failed', {
      error: serializeError(err),
      roomId,
      level,
      limit,
    });
    throw err;
  }
}

/**
 * Hybrid 매칭 (LEX + SEM + RECENCY)
 * - RPC: match_chat_memory_summaries_hybrid()
 * - 파라미터 누락 시 null/기본값으로 전달
 */
export async function matchHybrid(params: {
  roomId: string;
  queryEmbedding?: number[];
  queryText?: string;
  alpha?: number;
  k?: number;
  minScore?: number;
  fromTs?: string; // ISO
  decayHalfLifeHours?: number;
  levelFilter?: MemoryLevel[];
  useTSV?: boolean;
}): Promise<MemoryHit[]> {
  if (typeof window !== 'undefined') {
    throw new Error('summary-repository: server-only');
  }
  const {
    roomId,
    queryEmbedding = null,
    queryText = null,
    alpha = 0.5,
    k = 5,
    minScore = 0,
    fromTs = null,
    decayHalfLifeHours = null,
    levelFilter = null,
    useTSV = false,
  } = params;

  if (!roomId) throw new Error('matchHybrid: roomId is required');

  const supabase = getSupabaseAdminClient();

  try {
    const { data, error } = await supabase.rpc('match_chat_memory_summaries_hybrid', {
      p_room_id: roomId,
      p_query_embedding: queryEmbedding,
      p_query_text: queryText,
      p_alpha: alpha,
      p_match_count: k,
      p_similarity_threshold: minScore,
      p_from_ts: fromTs,
      p_decay_halflife_hours: decayHalfLifeHours,
      p_level_filter: levelFilter,
      p_use_tsv: useTSV,
    });

    if (error) throw error;
    return (data ?? []) as MemoryHit[];
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[memory-summary] matchHybrid failed', {
      error: serializeError(err),
      roomId,
      hasEmbedding: Array.isArray(queryEmbedding) && queryEmbedding.length > 0,
      hasText: !!queryText && queryText.length > 0,
      alpha,
      k,
      minScore,
      fromTs,
      decayHalfLifeHours,
      levelFilter,
      useTSV,
    });

    // Fallback: lexical search to avoid hard failure (e.g., 42P13 record type mismatch)
    try {
      const fb = await matchHybridLexicalFallback({
        roomId,
        queryText: String(queryText || ''),
        k,
        levelFilter,
      });
      // eslint-disable-next-line no-console
      console.warn('[memory-summary] matchHybrid fallback to lexical', {
        roomId,
        k,
        useTSV,
        err: serializeError(err),
      });
      return fb;
    } catch (fallbackErr: any) {
      // eslint-disable-next-line no-console
      console.error('[memory-summary] lexical fallback failed', { err: serializeError(fallbackErr) });
      return [];
    }
  }
}

/**
 * 부모 요약들에 대한 자식 링크 조회
 * - RPC: get_summary_children()
 */
export async function getChildrenForSummaries(parentIds: string[]): Promise<MemoryChildLink[]> {
  if (typeof window !== 'undefined') {
    throw new Error('summary-repository: server-only');
  }
  if (!Array.isArray(parentIds) || parentIds.length === 0) return [];

  const supabase = getSupabaseAdminClient();
  try {
    const { data, error } = await supabase.rpc('get_summary_children', {
      p_parent_ids: parentIds,
    });
    if (error) throw error;
    return (data ?? []) as MemoryChildLink[];
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[memory-summary] getChildrenForSummaries failed', {
      error: serializeError(err),
      parentIdsCount: parentIds.length,
    });
    throw err;
  }
}

/**
 * Lexical fallback for matchHybrid — safe path when RPC fails or schema mismatch
 * - Filters by room_id and summary ILIKE %queryText%
 * - Scores via simple token presence ratio
 */
async function matchHybridLexicalFallback(params: {
  roomId: string;
  queryText?: string | null;
  k?: number;
  levelFilter?: MemoryLevel[] | null;
}): Promise<MemoryHit[]> {
  if (typeof window !== 'undefined') {
    throw new Error('summary-repository: server-only');
  }
  const roomId = String(params?.roomId || '').trim();
  const queryText = String(params?.queryText || '').trim();
  const k = Math.max(1, Math.trunc(typeof params?.k === 'number' ? (params.k as number) : 5));
  if (!roomId) return [];

  const supabase = getSupabaseAdminClient();

  // minimal tokenization + stopword pruning
  const rawTokens = String(queryText || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);
  const stop = new Set<string>([
    'the','is','are','and','or','of','to','a','an','in','on','for','with','at','by','from','as','that','this','it','be',
    'was','were','been','will','would','can','could','should','do','does','did','have','has','had','not','no','yes',
    // ko (very small)
    '그리고','또는','이','그','저','은','는','이','가','을','를','에','의','와','과','도','에서','으로'
  ]);
  const tokens = rawTokens.filter(t => !stop.has(t));

  try {
    let q = supabase
      .from('chat_memory_summaries')
      .select('id, room_id, level, chunk_no, summary, created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(k);

    // Apply level filter consistently on fallback as well
    const lf = Array.isArray(params?.levelFilter) ? params.levelFilter as MemoryLevel[] : null;
    if (lf && lf.length > 0) {
      if (lf.length === 1) {
        q = q.eq('level', lf[0]);
      } else {
        q = (q as any).in('level', lf as any);
      }
    }

    if (queryText) {
      q = q.ilike('summary', `%${queryText}%`);
    }

    const { data, error } = await q;
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const scored = rows.map((r: any) => {
      const text = String(r?.summary ?? '');
      const lower = text.toLowerCase();
      const tally = tokens.length > 0
        ? tokens.filter(t => lower.includes(t)).length
        : (queryText ? (lower.includes(queryText.toLowerCase()) ? 1 : 0) : 0);
      const lex = tokens.length > 0 ? (tally / Math.max(1, tokens.length)) : (tally > 0 ? 1 : 0);
      const combined = Number.isFinite(lex) ? lex : 0;

      const hit: MemoryHit = {
        id: String(r?.id ?? ''),
        room_id: String(r?.room_id ?? roomId),
        level: Number(r?.level ?? 0) as any,
        chunk_no: Number(r?.chunk_no ?? 0),
        summary: String(r?.summary ?? ''),
        created_at: r?.created_at ? new Date(r.created_at).toISOString() : new Date(0).toISOString(),
        embedding_similarity: null,
        lexical_score: lex,
        recency_weight: null,
        combined_score: combined,
      };
      return hit;
    });

    // sort by combined_score desc, then recency desc
    scored.sort((a, b) => {
      const ds = (b.combined_score ?? 0) - (a.combined_score ?? 0);
      if (ds !== 0) return ds;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return scored.slice(0, k);
  } catch {
    return [];
  }
}

/**
 * Detect Postgres record type/column mismatch (e.g., 42P13)
 */
function isRecordTypeMismatchError(err: any): boolean {
  try {
    const code = String((err?.code ?? '') || '');
    const msg = String((err?.message ?? err ?? '') || '');
    return code === '42P13'
      || /42P13/i.test(msg)
      || /record type mismatch/i.test(msg)
      || /column\s+2/i.test(msg)
      || /record type/i.test(msg);
  } catch {
    return false;
  }
}

/* ------------------------ 내부 유틸 ------------------------ */

function toIsoOrNull(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function toNullableNumber(v?: number | null): number | null {
  if (v === null || typeof v === 'undefined') return null;
  return Number.isFinite(v) ? Number(v) : null;
}
function isUuid(s: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s);
}
function serializeError(err: any) {
  try {
    return {
      message: err?.message ?? null,
      code: err?.code ?? null,
      details: err?.details ?? null,
      hint: err?.hint ?? null,
      raw: (() => {
        try {
          return JSON.stringify(err, Object.getOwnPropertyNames(err));
        } catch {
          try { return JSON.stringify(err); } catch { return String(err); }
        }
      })(),
    };
  } catch {
    try { return JSON.stringify(err); } catch { return String(err); }
  }
}