/**
 * Memory Summarizer (SUPA/HYPA)
 *
 * 동작:
 * - 내부 Next API: /api/summarize 로 POST 호출
 * - memory/prompts의 템플릿을 사용해 JSON-only 출력 유도
 * - 결과가 JSON이면 그대로 문자열화하여 summary에 저장, citations는 파싱하여 별도 반환
 * - 결과가 JSON이 아니면 summary는 원문 텍스트, citations는 빈 값으로 반환
 * - 지수 백오프(최대 3회 재시도)
 *
 * TODO:
 * - 직접 LLM 호출 경로 추가 (예: OpenAI/Gemini SDK)
 * - 응답 포맷 스키마 강화(zod 등)
 */

import 'server-only';
import { buildSupaPrompt, buildHypaPrompt } from './prompts';
import { headers } from 'next/headers';

export interface SupaWindowMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export type SupaSummarizationResult = {
  summary: string;
  citations: {
    message_id_from?: number;
    message_id_to?: number;
    message_id_list?: string[];
  };
};

export type HypaRollupResult = {
  summary: string;
  citations: {
    supa_chunk_refs: number[];
  };
};

type SummarizeApiResponse = { summary?: string; error?: string };

class SummarizerError extends Error {
  code: string;
  status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'SummarizerError';
    this.code = code;
    this.status = status;
  }
}

/**
 * 베이스 URL 계산
 * - 서버 환경 기준 절대 경로
 * - NEXT_PUBLIC_SITE_URL(권장) -> 그대로 사용(프로토콜 없으면 https 추가)
 * - VERCEL_URL -> https:// 접두
 * - fallback -> http://localhost:3000
 */
function getBaseUrl(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) {
    if (site.startsWith('http://') || site.startsWith('https://')) return site.replace(/\/+$/, '');
    return `https://${site.replace(/\/+$/, '')}`;
  }
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;
  return 'http://localhost:3000';
}

/**
 * 요청 컨텍스트 기반 베이스 URL
 * - X-Forwarded-Proto/Host 또는 Host 헤더를 사용
 * - 보호 환경(Vercel Protection)에서도 동일 도메인을 사용해 쿠키 인증을 유지
 */
async function getRequestBaseUrl(): Promise<string | null> {
  try {
    const h = await headers();
    const proto = (h.get('x-forwarded-proto') || 'https').replace(/[^a-z]+/gi, '');
    const host = h.get('x-forwarded-host') || h.get('host');
    if (host) {
      return `${proto}://${host.replace(/\/+$/, '')}`;
    }
  } catch {
    // no-op (headers() not available)
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// === Client byte-budget defaults ===
const SUMMARY_CLIENT_BODY_BUDGET_BYTES = Number(process.env.SUMMARY_CLIENT_BODY_BUDGET_BYTES || 524288); // 512KB
const SUMMARY_CLIENT_HEADROOM_BYTES = Number(process.env.SUMMARY_CLIENT_HEADROOM_BYTES || 8192); // 8KB
const SUMMARY_CLIENT_SUPA_PROMPT_ENABLED = String(process.env.SUMMARY_CLIENT_SUPA_PROMPT_ENABLED || 'false')
  .toLowerCase() === 'true';

// UTF-8 바이트 계산 유틸
export function getUtf8Size(input: unknown): number {
  try {
    const s = typeof input === 'string' ? input : JSON.stringify(input);
    return new TextEncoder().encode(s).length;
  } catch {
    return 0;
  }
}

// messages 경로 바이트 예산 슬라이싱
export function sliceMessagesByBudget(
  messages: Array<{ role: string; content: string }>,
  budgetBytes: number = SUMMARY_CLIENT_BODY_BUDGET_BYTES,
  headroomBytes: number = SUMMARY_CLIENT_HEADROOM_BYTES
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const result: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const target = Math.max(0, budgetBytes - headroomBytes);

  const slim = (m: any): { role: 'user' | 'assistant'; content: string } => ({
    role: m?.role === 'assistant' ? 'assistant' : 'user',
    content: String(m?.content ?? ''),
  });

  for (let i = messages.length - 1; i >= 0; i--) {
    const cand = slim(messages[i]);
    const trial = [...result, cand];
    const size = getUtf8Size({ mode: 'messages', messages: trial });
    if (size <= target) {
      result.push(cand);
      continue;
    }
    // 아무 것도 담지 못하는 경우, 단일 메시지를 트리밍하여 예산 내에 맞춤
    if (result.length === 0) {
      let text = cand.content;
      if (!text) break;
      while (text.length > 1) {
        text = text.slice(-Math.floor(text.length / 2));
        const single = [{ role: cand.role, content: text }];
        const sz = getUtf8Size({ mode: 'messages', messages: single });
        if (sz <= target) {
          result.push({ role: cand.role, content: text });
          break;
        }
      }
    }
    break;
  }
  return result.reverse();
}

/**
 * summarize API 호출 (임의 페이로드 + 413 전파 지원, 지수 백오프 200→400ms)
 */
async function callSummarizeApiPayload(
  payload: any,
  maxRetries = 2,
  shrinkContext?: {
    roomId?: string;
    windowMessages?: Array<{ role: string; content: string; createdAt?: string }>;
    budgetBytes?: number;
    headroomBytes?: number;
  }
): Promise<string> {
  // Endpoint candidates: request-aware absolute -> relative -> config absolute
  const rel = '/api/summarize';
  const reqBase = await getRequestBaseUrl();
  const candidates = reqBase ? [`${reqBase}${rel}`, rel, `${getBaseUrl()}${rel}`] : [rel, `${getBaseUrl()}${rel}`];

  let lastErr: any;
  let curPayload = payload ?? {};

  const budget = Number(shrinkContext?.budgetBytes || SUMMARY_CLIENT_BODY_BUDGET_BYTES);
  const headroom = Number(shrinkContext?.headroomBytes || SUMMARY_CLIENT_HEADROOM_BYTES);

  const modeOf = (p: any): 'room' | 'messages' | 'text' => {
    if (typeof p?.mode === 'string') return p.mode;
    if (p?.roomId) return 'room';
    if (Array.isArray(p?.messages)) return 'messages';
    return 'text';
  };

  const shrinkByHalf = (p: any): any => {
    const m = modeOf(p);
    if (m === 'messages' || Array.isArray(p?.messages)) {
      const msgs = Array.isArray(p.messages) ? p.messages : [];
      const half = Math.max(1, Math.floor(msgs.length / 2));
      const shrunk = msgs.slice(-half).map((x: any) => ({
        role: x?.role === 'assistant' ? 'assistant' : 'user',
        content: String(x?.content ?? ''),
      }));
      return { ...p, mode: 'messages', messages: shrunk };
    }
    if (m === 'room') {
      const wm = shrinkContext?.windowMessages || [];
      const sliced = sliceMessagesByBudget(
        wm.map(mm => ({ role: mm.role === 'assistant' ? 'assistant' : 'user', content: String((mm as any).content ?? '') })),
        budget,
        headroom
      );
      if (sliced.length > 0) return { ...p, mode: 'messages', messages: sliced, roomId: undefined };
    }
    // text 또는 알 수 없는 경우 → messages/room으로 전환 시도
    const wm2 = shrinkContext?.windowMessages || [];
    if (wm2.length > 0) {
      const sliced = sliceMessagesByBudget(
        wm2.map(mm => ({ role: mm.role === 'assistant' ? 'assistant' : 'user', content: String((mm as any).content ?? '') })),
        budget,
        headroom
      );
      if (sliced.length > 0) return { mode: 'messages', messages: sliced, targetTokens: p?.targetTokens };
    }
    if (shrinkContext?.roomId) {
      return { mode: 'room', roomId: shrinkContext.roomId, targetTokens: p?.targetTokens };
    }
    // 최후: text를 절반으로 축소
    if (typeof p?.text === 'string') {
      const halfChars = Math.max(1, Math.floor(p.text.length / 2));
      return { ...p, mode: 'text', text: p.text.slice(-halfChars) };
    }
    return p;
  };

  for (let attempt = 0; attempt <= Math.max(0, maxRetries); attempt += 1) {
    try {
      const payloadBytes = getUtf8Size(curPayload);
      // eslint-disable-next-line no-console
      console.info('[summarizer] sending summarize payload', {
        attempt,
        mode: modeOf(curPayload),
        bytes: payloadBytes,
      });

      let lastCandidateErr: any = null;
      let shrunkOn413 = false;

      // Try relative URL first, then absolute fallback
      for (const url of candidates) {
        try {
          // eslint-disable-next-line no-console
          console.info('[summarizer] trying summarize endpoint', { url });
          // 원 요청의 쿠키/인증 정보를 전달하여 Vercel 보호 환경(401) 회피
          const fwdHeaders: Record<string, string> = { 'content-type': 'application/json' };
          try {
            const h = await headers();
            const cookie = h.get('cookie');
            if (cookie) fwdHeaders['cookie'] = cookie;
            const auth = h.get('authorization');
            if (auth) fwdHeaders['authorization'] = auth;
          } catch {
            // headers() 사용 불가한 컨텍스트면 무시
          }
          // Vercel Password Protection 우회 토큰(환경변수에 설정된 경우)
          const bypass = process.env.VERCEL_PROTECTION_BYPASS || process.env.NEXT_PUBLIC_VERCEL_PROTECTION_BYPASS;
          if (bypass) {
            fwdHeaders['x-vercel-protection-bypass'] = String(bypass);
          }

          const res = await fetch(url, {
            method: 'POST',
            headers: fwdHeaders,
            body: JSON.stringify(curPayload),
          });

          let json: (SummarizeApiResponse & { meta?: any }) | null = null;
          try {
            json = (await res.json()) as any;
          } catch {
            json = null;
          }

          if (res.status === 413) {
            const backoffMs = 200 * Math.pow(2, attempt); // 200, 400, 800ms
            // eslint-disable-next-line no-console
            console.warn('[summarizer] 413 from summarize API; shrinking by half and retrying', { attempt, backoffMs });
            curPayload = shrinkByHalf(curPayload);
            await delay(backoffMs);
            shrunkOn413 = true;
            break; // break candidates loop; retry with shrunk payload
          }

          if (!res.ok) {
            const msg = (json as any)?.error || `summarize API error (status=${res.status})`;
            // 404는 다른 후보 URL로 즉시 폴백 시도
            if (res.status === 404) {
              lastCandidateErr = new SummarizerError('SUMMARIZE_API_FAILED', msg, 404);
              continue; // try next candidate
            }
            throw new SummarizerError('SUMMARIZE_API_FAILED', msg, res.status);
          }

          const summary = (json as any)?.summary;
          if (!summary || typeof summary !== 'string' || summary.trim().length === 0) {
            throw new SummarizerError('SUMMARIZE_EMPTY', 'summarize API returned empty summary');
          }

          return summary.trim();
        } catch (e: any) {
          // 네트워크/파싱 오류 등: 다음 후보 URL 시도
          lastCandidateErr = e;
          continue;
        }
      }

      // 후보 모두 실패. 만약 413에서 축소 처리했다면 다음 attempt로 진행.
      if (shrunkOn413) {
        continue;
      }

      // 404 등으로 모든 후보 실패
      throw lastCandidateErr || new SummarizerError('SUMMARIZE_API_FAILED', 'All summarize endpoints failed', 500);
    } catch (err: any) {
      lastErr = err;
      if (err?.status === 413) {
        const backoffMs = 200 * Math.pow(2, attempt);
        // eslint-disable-next-line no-console
        console.warn('[summarizer] network-level 413; shrinking by half and retrying', { attempt, backoffMs });
        curPayload = shrinkByHalf(curPayload);
        await delay(backoffMs);
        continue;
      }
      if (attempt < maxRetries) {
        const backoffMs = 200 * Math.pow(2, attempt); // 200ms, 400ms, 800ms
        // eslint-disable-next-line no-console
        console.warn('[summarizer] summarize call failed; retrying', {
          attempt,
          backoffMs,
          error: serializeError(err),
        });
        await delay(backoffMs);
        continue;
      }
      break;
    }
  }

  if (lastErr instanceof SummarizerError) throw lastErr;
  throw new SummarizerError('SUMMARIZE_API_UNAVAILABLE', 'summarize API unavailable or failed repeatedly');
}

/**
 * 기존 시그니처 유지 래퍼(text only)
 */
async function callSummarizeApi(text: string, maxRetries = 2): Promise<string> {
  return callSummarizeApiPayload({ text }, maxRetries);
}

/**
 * JSON 파싱 시도
 * - 완전체 파싱 실패 시, 첫 '{' 부터 마지막 '}' 까지 잘라 2차 시도
 */
function tryParseJsonObject(s: string): any | null {
  if (!s) return null;
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === 'object') return obj;
  } catch {
    // no-op
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const sub = s.slice(start, end + 1);
    try {
      const obj = JSON.parse(sub);
      if (obj && typeof obj === 'object') return obj;
    } catch {
      // no-op
    }
  }
  return null;
}

function toIntOrUndef(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function toNumArray(v: any): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => Number(x)).filter((x) => Number.isFinite(x));
}

function toStrArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter((x) => x.length > 0);
}

function serializeError(err: any) {
  try {
    return {
      message: err?.message ?? null,
      code: err?.code ?? null,
      status: err?.status ?? null,
      details: err?.details ?? null,
      hint: err?.hint ?? null,
      raw: (() => {
        try { return JSON.stringify(err, Object.getOwnPropertyNames(err)); }
        catch { try { return JSON.stringify(err); } catch { return String(err); } }
      })(),
    };
  } catch {
    try { return JSON.stringify(err); } catch { return String(err); }
  }
}

/**
 * SUPA 요약 실행
 * - 입력 메시지가 없으면 빈 결과 반환
 */
export async function runSupaSummarization(input: {
  roomId: string;
  windowMessages: Array<{ id: string; role: string; content: string; createdAt: string }>;
  outputTokens?: number;
}): Promise<SupaSummarizationResult> {
  if (typeof window !== 'undefined') {
    throw new SummarizerError('SERVER_ONLY', 'summarizer: server-only');
  }
  const { roomId, windowMessages, outputTokens } = input;
  if (!Array.isArray(windowMessages) || windowMessages.length === 0) {
    return { summary: '', citations: {} };
  }

  // 로그: 시작
  // eslint-disable-next-line no-console
  console.info('[summarizer] runSupaSummarization start', {
    roomIdPresent: !!roomId,
    windowSize: windowMessages.length,
    budgetBytes: SUMMARY_CLIENT_BODY_BUDGET_BYTES,
    headroomBytes: SUMMARY_CLIENT_HEADROOM_BYTES,
    supaPromptEnabled: SUMMARY_CLIENT_SUPA_PROMPT_ENABLED,
  });

  // 메시지 정규화 (role/content만 사용)
  const slimWindow = windowMessages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? ''),
    createdAt: m.createdAt,
  }));

  // 결과 파서 (JSON 우선)
  const parseResult = (raw: string): SupaSummarizationResult => {
    const obj = tryParseJsonObject(raw);
    if (obj && typeof obj === 'object') {
      const citations = obj?.citations ?? {};
      return {
        summary: JSON.stringify(obj),
        citations: {
          message_id_from: toIntOrUndef(citations?.message_id_from),
          message_id_to: toIntOrUndef(citations?.message_id_to),
          message_id_list: (() => {
            const arr = citations?.message_id_list;
            const list = toStrArray(arr);
            return list.length > 0 ? list : undefined;
          })(),
        },
      };
    }
    return { summary: raw, citations: {} };
  };

  const budget = SUMMARY_CLIENT_BODY_BUDGET_BYTES;
  const headroom = SUMMARY_CLIENT_HEADROOM_BYTES;
  const shrinkContext = {
    roomId,
    windowMessages: slimWindow,
    budgetBytes: budget,
    headroomBytes: headroom,
  };

  // 1) 기본 경로: roomId가 있으면 room, 아니면 messages(슬라이싱). text는 개발 플래그에서만 사용.
  const callMessages = async (msgs: Array<{ role: 'user' | 'assistant'; content: string }>) => {
    const payload = { mode: 'messages' as const, messages: msgs, targetTokens: outputTokens };
    const raw = await callSummarizeApiPayload(payload, 2, shrinkContext);
    return parseResult(raw);
  };

  const callRoom = async () => {
    const payload = { mode: 'room' as const, roomId, targetTokens: outputTokens };
    const raw = await callSummarizeApiPayload(payload, 2, shrinkContext);
    return parseResult(raw);
  };

  const callTextIfEnabled = async () => {
    // 하위호환 플래그가 true일 때만 사용
    const prompt = buildSupaPrompt({
      roomId,
      messages: slimWindow.map((m) => ({ role: m.role, content: m.content })),
      maxTokens: outputTokens,
    });
    const payload = { mode: 'text' as const, text: prompt, targetTokens: outputTokens };
    const raw = await callSummarizeApiPayload(payload, 2, shrinkContext);
    return parseResult(raw);
  };

  // 안전한 로컬 맵-리듀스 (바이트 예산 기반)
  const localMapReduce = async (): Promise<SupaSummarizationResult> => {
    // eslint-disable-next-line no-console
    console.info('[summarizer] localMapReduce start', {
      windowSize: slimWindow.length,
      budget,
      headroom,
    });

    // 배치 구성: 각 배치의 JSON 바이트가 budget-headroom 이하
    const target = Math.max(0, budget - headroom);
    const normalize = (m: any) => ({
      role: m?.role === 'assistant' ? 'assistant' : 'user',
      content: String(m?.content ?? ''),
    });

    const buildBatchesByBudget = (messages: Array<{ role: string; content: string }>) => {
      const batches: Array<Array<{ role: 'user' | 'assistant'; content: string }>> = [];
      let current: Array<{ role: 'user' | 'assistant'; content: string }> = [];

      const fits = (arr: any[]) => getUtf8Size({ mode: 'messages', messages: arr }) <= target;

      for (let i = 0; i < messages.length; i++) {
        const cand = normalize(messages[i]) as { role: 'user' | 'assistant'; content: string };
        if (current.length === 0) {
          let single = [cand];
          if (!fits(single)) {
            // 단일 메시지가 너무 큰 경우 내용 절반 축소 반복
            let txt = cand.content;
            while (txt.length > 1) {
              txt = txt.slice(-Math.max(1, Math.floor(txt.length / 2)));
              single = [{ role: cand.role, content: txt }];
              if (fits(single)) break;
            }
          }
          current = single;
          continue;
        }

        const trial = [...current, cand];
        if (fits(trial)) {
          current = trial;
        } else {
          batches.push(current);
          // 새 배치 시작 (cand가 안 맞으면 트리밍)
          let next = [cand];
          if (!fits(next)) {
            let txt = cand.content;
            while (txt.length > 1) {
              txt = txt.slice(-Math.max(1, Math.floor(txt.length / 2)));
              next = [{ role: cand.role, content: txt }];
              if (fits(next)) break;
            }
          }
          current = next;
        }
      }
      if (current.length > 0) batches.push(current);
      return batches;
    };

    const batches = buildBatchesByBudget(slimWindow);
    // eslint-disable-next-line no-console
    console.info('[summarizer] localMapReduce batches', { batches: batches.length });

    // 1차 배치 요약
    const partialTokens = Math.max(1, Math.floor((outputTokens ?? 512) / 2));
    const partials: string[] = [];
    for (let i = 0; i < batches.length; i++) {
      const payload = { mode: 'messages' as const, messages: batches[i], targetTokens: partialTokens };
      const raw = await callSummarizeApiPayload(payload, 2, shrinkContext);
      const r = parseResult(raw);
      partials.push(r.summary);
      await delay(200);
    }

    // 2차/3차 집계: partials가 크면 그룹 요약으로 축소
    let currentLevel = partials.slice();
    const joinDelim = '\n---\n';

    const summarizeStringsOnce = async (items: string[], tokens: number) => {
      const msg = [{ role: 'user' as const, content: items.join(joinDelim) }];
      const payload = { mode: 'messages' as const, messages: msg, targetTokens: tokens };
      const raw = await callSummarizeApiPayload(payload, 2, shrinkContext);
      return parseResult(raw).summary;
    };

    // 최종 페이로드가 예산 이내가 될 때까지 그룹화 요약
    while (getUtf8Size({ mode: 'messages', messages: [{ role: 'user', content: currentLevel.join(joinDelim) }] }) > target) {
      // 절반으로 그룹화
      const mid = Math.max(1, Math.floor(currentLevel.length / 2));
      const groups = [currentLevel.slice(0, mid), currentLevel.slice(mid)].filter((g) => g.length > 0);
      const nextLevel: string[] = [];
      for (const g of groups) {
        const s = await summarizeStringsOnce(g, Math.max(1, Math.floor((outputTokens ?? 512) / 2)));
        nextLevel.push(s);
        await delay(200);
      }
      currentLevel = nextLevel;
      if (currentLevel.length <= 1) break;
    }

    const finalSummary = await summarizeStringsOnce(currentLevel, outputTokens ?? 512);
    // eslint-disable-next-line no-console
    console.info('[summarizer] localMapReduce done', { batches: batches.length });
    return parseResult(finalSummary);
  };

  // 실행 플로우
  try {
    if (roomId) {
      // 기본: room 우선
      return await callRoom();
    }

    // messages 슬라이싱 후 전송
    const sliced = sliceMessagesByBudget(
      slimWindow.map((m) => ({ role: m.role, content: m.content })),
      budget,
      headroom
    );
    if (sliced.length > 0) {
      // eslint-disable-next-line no-console
      console.info('[summarizer] sending messages mode', { windowSize: slimWindow.length, sliced: sliced.length });
      return await callMessages(sliced);
    }

    // messages로 보낼 게 없고, 개발 플래그가 true면 text 경로 사용
    if (SUMMARY_CLIENT_SUPA_PROMPT_ENABLED) {
      return await callTextIfEnabled();
    }

    // 모두 불가 -> 빈 결과
    return { summary: '', citations: {} };
  } catch (err1: any) {
    const msgLower = String(err1?.message || '').toLowerCase();

    // 413 발생 시 축소 재시도는 callSummarizeApiPayload 내부에서 처리됨.
    // 그래도 실패하면 모드 전환 후 로컬 map-reduce 이전에 messages 경로 시도
    if (err1?.status === 413 || msgLower.includes('413')) {
      try {
        if (roomId) {
          // room 실패 → messages로 전환
          const sliced = sliceMessagesByBudget(
            slimWindow.map((m) => ({ role: m.role, content: m.content })),
            budget,
            headroom
          );
          if (sliced.length > 0) {
            await delay(400);
            return await callMessages(sliced);
          }
        }
      } catch {
        // fallthrough
      }
      // 최후 수단: 로컬 map-reduce
      // eslint-disable-next-line no-console
      console.warn('[summarizer] falling back to local map-reduce after 413', { windowSize: slimWindow.length });
      return await localMapReduce();
    }

    // 404 (roomId not found) → messages 경로 우선 시도
    if (err1?.status === 404 || msgLower.includes('roomid') || msgLower.includes('not found')) {
      try {
        const sliced = sliceMessagesByBudget(
          slimWindow.map((m) => ({ role: m.role, content: m.content })),
          budget,
          headroom
        );
        if (sliced.length > 0) {
          await delay(200);
          return await callMessages(sliced);
        }
      } catch {
        // fallthrough
      }
      // messages가 없으면 로컬 map-reduce
      // eslint-disable-next-line no-console
      console.warn('[summarizer] roomId not found; using local map-reduce', { windowSize: slimWindow.length });
      return await localMapReduce();
    }

    // 기타 실패: 로컬 map-reduce
    // eslint-disable-next-line no-console
    console.warn('[summarizer] primary path failed; using local map-reduce', { error: serializeError(err1) });
    return await localMapReduce();
  }
}

/**
 * HYPA 롤업 실행
 * - 입력 SUPA 요약이 없으면 빈 결과 반환
 */
export async function runHypaRollup(input: {
  roomId: string;
  supaSummaries: Array<{ id: string; summary: string; chunk_no: number }>;
  outputTokens?: number;
}): Promise<HypaRollupResult> {
  if (typeof window !== 'undefined') {
    throw new SummarizerError('SERVER_ONLY', 'summarizer: server-only');
  }
  const { roomId, supaSummaries, outputTokens } = input;
  if (!Array.isArray(supaSummaries) || supaSummaries.length === 0) {
    return { summary: '', citations: { supa_chunk_refs: [] } };
  }

  const prompt = buildHypaPrompt({
    roomId,
    supaSummaries: supaSummaries.map((s) => ({ chunk_no: s.chunk_no, summary: s.summary })),
    maxTokens: outputTokens,
  });

  const raw = await callSummarizeApi(prompt);
  const obj = tryParseJsonObject(raw);

  if (obj && typeof obj === 'object') {
    const citations = obj?.citations ?? {};
    const refs = toNumArray(citations?.supa_chunk_refs);
    const result: HypaRollupResult = {
      summary: JSON.stringify(obj),
      citations: {
        supa_chunk_refs: refs,
      },
    };
    return result;
  }

  // JSON이 아닌 경우
  return { summary: raw, citations: { supa_chunk_refs: [] } };
}