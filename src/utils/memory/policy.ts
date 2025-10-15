/**
 * Memory 정책/임계값 유틸 (Summary-First RAG)
 *
 * 제공:
 * - getRetrievalMode(roomId?, userId?)
 * - getThresholds(roomId?, userId?)
 * - shouldRollSupa(windowStats)
 * - shouldRollHypa(supaCountSinceLastHypa, timeSinceLastHypaMinutes)
 *
 * 동작:
 * - process.env 기반으로 동작 (룸/유저 오버라이드는 차기 단계 TODO)
 *
 * TODO:
 * - 룸/유저별 오버라이드(Feature Flag/AB) 연결
 * - 운영환경 메트릭 기반 동적 튜닝
 */

import 'server-only';

export type RetrievalMode = 'summary_only' | 'cascaded' | 'messages_first';

export interface Thresholds {
  supaTokens: number;
  supaWindow: number;
  hypaChunks: number;
  gapMinutes: number;
  periodHours: number;
  k1: number;
  k2: number;
  beta: number;
  alpha: number;
  minScore: number;
  decayHalfLifeHours: number;
  maxSnippetTokens: number;
}

export interface SupaWindowStats {
  messageCount?: number;
  tokenCount?: number;
  /** 최근 창 내 최대 간격(분) */
  maxGapMinutes?: number;
}

/** 안전한 정수 파서 */
function toInt(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
/** 안전한 실수 파서 */
function toFloat(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
/** 안전한 불리언 파서 */
function toBool(v: string | undefined, fallback: boolean): boolean {
  if (typeof v !== 'string') return fallback;
  const s = v.trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return fallback;
}

/**
 * 검색 모드 결정
 * - Feature Toggle(SUPA_HYPA_MEMORY_ENABLED=false)이면 messages_first로 강등
 * - env: MEMORY_RETRIEVAL_MODE ('summary_only' | 'cascaded' | 'messages_first')
 */
export function getRetrievalMode(_roomId?: string, _userId?: string): RetrievalMode {
  const memoryEnabled = toBool(process.env.SUPA_HYPA_MEMORY_ENABLED, true);
  if (!memoryEnabled) return 'messages_first';
  const mode = (process.env.MEMORY_RETRIEVAL_MODE ?? 'cascaded').trim().toLowerCase();
  if (mode === 'summary_only' || mode === 'messages_first' || mode === 'cascaded') return mode;
  return 'cascaded';
}

/**
 * 임계값 집합
 * - 전부 env 기반, NaN/undefined 방지
 *
 * 매핑:
 * - SUPA_THRESHOLD_TOKENS        -> supaTokens
 * - SUPA_WINDOW_MESSAGES         -> supaWindow
 * - HYPA_ROLLUP_CHUNKS           -> hypaChunks
 * - SUPA_ROLLUP_MAX_GAP_MINUTES  -> gapMinutes
 * - HYPA_ROLLUP_PERIOD_HOURS     -> periodHours
 * - MEMORY_SUMMARY_K1            -> k1
 * - MEMORY_SUMMARY_K2            -> k2
 * - MEMORY_WEIGHT_BETA           -> beta
 * - MEMORY_ALPHA                 -> alpha
 * - MEMORY_MIN_SCORE             -> minScore
 * - DECAY_HALFLIFE_HOURS         -> decayHalfLifeHours
 * - MAX_CONTEXT_TOKENS_FOR_MEMORY-> maxSnippetTokens
 */
export function getThresholds(_roomId?: string, _userId?: string): Thresholds {
  return {
    supaTokens: toInt(process.env.SUPA_THRESHOLD_TOKENS, 384),
    supaWindow: toInt(process.env.SUPA_WINDOW_MESSAGES, 30),
    hypaChunks: toInt(process.env.HYPA_ROLLUP_CHUNKS, 6),
    gapMinutes: toInt(process.env.SUPA_ROLLUP_MAX_GAP_MINUTES, 90),
    periodHours: toInt(process.env.HYPA_ROLLUP_PERIOD_HOURS, 24),
    k1: toInt(process.env.MEMORY_SUMMARY_K1, 8),
    k2: toInt(process.env.MEMORY_SUMMARY_K2, 4),
    beta: Math.min(1, Math.max(0, toFloat(process.env.MEMORY_WEIGHT_BETA, 0.6))),
    alpha: Math.min(1, Math.max(0, toFloat(process.env.MEMORY_ALPHA, 0.5))),
    minScore: Math.min(1, Math.max(0, toFloat(process.env.MEMORY_MIN_SCORE, 0.2))),
    decayHalfLifeHours: Math.max(1, toInt(process.env.DECAY_HALFLIFE_HOURS, 72)),
    maxSnippetTokens: Math.max(128, toInt(process.env.MAX_CONTEXT_TOKENS_FOR_MEMORY, 1024)),
  };
}

/**
 * SUPA 롤업 필요 여부
 * - 메시지 수(supaWindow) 또는 토큰 수(supaTokens) 초과
 * - 또는 창 내 최대 간격이 gapMinutes 이상
 */
export function shouldRollSupa(windowStats: SupaWindowStats): boolean {
  const { messageCount = 0, tokenCount = 0, maxGapMinutes = 0 } = windowStats ?? {};
  const t = getThresholds();
  if (messageCount >= t.supaWindow) return true;
  if (tokenCount >= t.supaTokens) return true;
  if (maxGapMinutes >= t.gapMinutes) return true;
  return false;
}

/**
 * HYPA 롤업 필요 여부
 * - 마지막 HYPA 이후 SUPA 개수가 hypaChunks 이상이거나
 * - 시간 경과가 periodHours 이상일 때
 */
export function shouldRollHypa(supaCountSinceLastHypa: number, timeSinceLastHypaMinutes: number): boolean {
  const t = getThresholds();
  const countOk = (Number.isFinite(supaCountSinceLastHypa) ? supaCountSinceLastHypa : 0) >= t.hypaChunks;
  const timeOk = (Number.isFinite(timeSinceLastHypaMinutes) ? timeSinceLastHypaMinutes : 0) >= t.periodHours * 60;
  return countOk || timeOk;
}