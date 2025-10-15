import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { db } from '@/firebase/config';
import { collection, getDocs } from 'firebase/firestore';
import { SUMMARY_PROMPT } from '@/utils/memory/prompts';

// ==== ENV & DEFAULT LIMITS ====
const API_KEY =
  process.env.GOOGLE_API_KEY ||
  process.env.GOOGLE_AI_STUDIO_API_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_API_KEY;

const MAX_INPUT_CHARS_DEFAULT = Number(process.env.SUMMARY_SERVER_MAX_INPUT_CHARS || 12000);
const CHUNK_SIZE_DEFAULT = Number(process.env.SUMMARY_SERVER_CHUNK_CHARS || 6000);
const MAX_MESSAGES_DEFAULT = Number(process.env.SUMMARY_SERVER_MAX_MESSAGES || 100);

// ==== CLIENT ====
const genAI = API_KEY ? new GoogleGenerativeAI(API_KEY) : null;

// ==== FALLBACK NAIVE SUMMARIZER ====
function naiveSummarize(input: string): string {
  const text = String(input || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentences = text.split(/(?<=[.!?。！？])\s+/).filter(Boolean);
  const picked = sentences.slice(0, Math.min(3, sentences.length));
  const summary = picked.join(' ');
  return summary.length > 0 ? summary.slice(0, 600) : text.slice(0, 400);
}

// ==== PROMPT ====
// Canonical SUMMARY_PROMPT is imported from utils/memory/prompts.
// 클라이언트는 데이터만 보내고, 서버에서만 이 프롬프트를 1회 적용합니다. (이중 래핑 금지)

// ==== TYPES ====
type APIMsg = { role: 'user' | 'assistant'; content: string; createdAt?: string };

// ==== HELPERS ====
function toMillis(v: any): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof (v as any)?.toMillis === 'function') return (v as any).toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof (v as any)?.seconds === 'number') return Math.floor((v as any).seconds * 1000);
  return 0;
}

function isStatus413(e: any): boolean {
  const msg = String(e?.message || e || '');
  const st = Number(e?.status || e?.statusCode || 0);
  return (
    st === 413 ||
    /413/i.test(msg) ||
    /payload\s*too\s*large/i.test(msg) ||
    /content\s*length.*exceed/i.test(msg) ||
    /too\s*long/i.test(msg)
  );
}

// 뒤에서부터 role: content 줄을 누적하여 maxChars 이내 텍스트를 구성
function buildTextFromMessages(messages: APIMsg[], maxChars: number): string {
  const list = Array.isArray(messages) ? messages.slice() : [];
  const norm = list
    .map(m => ({
      role: (m?.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: String(m?.content ?? ''),
      createdAt: String(m?.createdAt ?? ''),
    }))
    .filter(m => m.content && typeof m.content === 'string');

  const lines: string[] = [];
  let acc = 0;
  for (let i = norm.length - 1; i >= 0; i--) {
    const line = `${norm[i].role}: ${norm[i].content}`.trim();
    const next = acc + line.length + 1;
    if (next > maxChars) {
      if (lines.length === 0) {
        const budget = Math.max(1, maxChars - acc);
        lines.push(line.slice(-budget));
        acc = maxChars;
      }
      break;
    }
    lines.push(line);
    acc = next;
  }
  return lines.reverse().join('\n');
}

// Firestore에서 chatRooms/{roomId}/messages 가져와 asc 정렬 → 최근 max개 → buildTextFromMessages
async function fetchRoomMessagesFromFirestore(roomId: string, max: number, maxChars: number): Promise<string> {
  try {
    const snap = await getDocs(collection(db, 'chatRooms', String(roomId), 'messages'));
    const raw = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

    raw.sort((a, b) => toMillis(a.createdAt ?? a.timestamp) - toMillis(b.createdAt ?? b.timestamp));

    const picked = raw.slice(Math.max(0, raw.length - max));
    const msgs: APIMsg[] = picked.map((r: any) => ({
      role: r?.isCharacter ? 'assistant' : 'user',
      content: String(r?.text ?? r?.content ?? '').trim(),
      createdAt: String(r?.createdAt ?? r?.timestamp ?? ''),
    }));

    return buildTextFromMessages(msgs, maxChars);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[summarize] fetchRoomMessagesFromFirestore failed', e);
    return '';
  }
}

function splitIntoChunks(input: string, chunkSize: number): string[] {
  const s = String(input || '');
  if (!s) return [];
  if (s.length <= chunkSize) return [s];

  const chunks: string[] = [];
  let i = 0;
  while (i < s.length) {
    const end = Math.min(i + chunkSize, s.length);
    chunks.push(s.slice(i, end));
    i = end;
  }
  return chunks;
}

function safetySettings() {
  return [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  ];
}

async function callModelOnce(text: string, targetTokens?: number): Promise<string> {
  if (!genAI) {
    return naiveSummarize(text);
  }
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite-preview-09-2025' });

  const prompt = SUMMARY_PROMPT.replace('{text}', text);

  const res = await model.generateContent({
    contents: [
      { role: 'user', parts: [{ text: prompt }] },
      { role: 'model', parts: [{ text: `알겠습니다, 지시 내용에 따라 요약을 시행합니다. 요약된 내용은 다음과 같습니다.

# 요약 결과:` }] }
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: Number(targetTokens ?? 8192),
    },
    safetySettings: safetySettings(),
  });

  if (!res?.response) {
    throw Object.assign(new Error('Empty model response'), { status: 500 });
  }
  const maybeText: any = (res.response as any).text;
const summary: string = typeof maybeText === 'function' ? (res.response as any).text() : String(maybeText ?? '');
  if (!summary || typeof summary !== 'string') {
    throw Object.assign(new Error('Invalid model response'), { status: 500 });
  }
  return summary;
}

// 413 발생 시 입력을 절반으로 축소(truncate)하여 재시도(최대 3회, 200→400ms 백오프)
async function summarizeWith413Retries(
  text: string,
  targetTokens?: number,
  maxAttempts = 3,
  shrinkCounter?: { count: number }
): Promise<string> {
  let cur = String(text || '');
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      return await callModelOnce(cur, targetTokens);
    } catch (e: any) {
      if (isStatus413(e)) {
        // 절반으로 축소(후반부 유지)
        const half = Math.max(1, Math.floor(cur.length / 2));
        cur = cur.slice(-half);
        const backoff = 200 * Math.pow(2, attempt); // 200ms, 400ms, 800ms
        // eslint-disable-next-line no-console
        console.warn('[summarize] 413 received; truncating and retrying', { attempt, nextLen: cur.length, backoff });
        if (shrinkCounter) shrinkCounter.count = (shrinkCounter.count || 0) + 1;
        await new Promise(r => setTimeout(r, backoff));
        attempt += 1;
        continue;
      }
      throw e;
    }
  }
  // 마지막 시도
  return await callModelOnce(cur, targetTokens);
}

// 길이 초과 시 청크 요약(map-reduce)
// 1차: 각 청크 요약 → 2차: 요약들을 다시 요약
async function chunkSummarize(
  text: string,
  chunkSize: number,
  targetTokens?: number,
  shrinkCounter?: { count: number }
): Promise<string> {
  const chunks = splitIntoChunks(text, chunkSize);
  if (chunks.length === 0) return '';

  // 1차 요약
  const partials: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const s = await summarizeWith413Retries(
      c,
      Math.max(1, Math.floor((targetTokens ?? 768) / 2)),
      3,
      shrinkCounter
    );
    partials.push(s);
    // small pacing
    await new Promise(r => setTimeout(r, 100));
  }

  // 2차 요약
  const combined = partials.join('\n---\n');
  return await summarizeWith413Retries(combined, targetTokens, 3, shrinkCounter);
}

async function safeSummarize(
  text: string,
  opts?: { maxChars?: number; chunkSize?: number; targetTokens?: number },
  shrinkCounter?: { count: number }
): Promise<string> {
  const MAX_CHARS = Number(opts?.maxChars || MAX_INPUT_CHARS_DEFAULT);
  const CHUNK_SIZE = Number(opts?.chunkSize || CHUNK_SIZE_DEFAULT);
  const targetTokens = opts?.targetTokens;

  const s = String(text || '');
  if (!s.trim()) return '';

  try {
    if (s.length <= MAX_CHARS) {
      return await summarizeWith413Retries(s, targetTokens, 3, shrinkCounter);
    }
    // 길이 초과 → 청크 요약
    return await chunkSummarize(s, CHUNK_SIZE, targetTokens, shrinkCounter);
  } catch (e: any) {
    if (isStatus413(e)) {
      // 마지막 방어: 절반 축소 후 재시도
      const shrunk = s.slice(-Math.max(1, Math.floor(s.length / 2)));
      const backoff = 400;
      await new Promise(r => setTimeout(r, backoff));
      try {
        return await summarizeWith413Retries(shrunk, targetTokens, 2, shrinkCounter);
      } catch (e2: any) {
        // 그래도 실패하면 413 전파
        throw Object.assign(new Error('Summarization failed due to payload too large'), { status: 413, cause: e2 });
      }
    }
    throw e;
  }
}

export async function POST(request: Request) {
  // 요청 파싱
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 JSON 요청 본문입니다.' }, { status: 400 });
  }

  // Union 타입 참고용
  // type SummarizeRequest =
  //   | { mode: 'room'; roomId: string; options?: { windowLimit?: number; lang?: string; style?: string } }
  //   | { mode: 'messages'; messages: Array<{ role: 'user'|'assistant'; content: string }>; options?: { byteBudget?: number; maxChars?: number; lang?: string; style?: string } }
  //   | { mode: 'text'; text: string; options?: { lang?: string; style?: string } };

  // 입력 파라미터
  const reqMode = typeof body?.mode === 'string' ? String(body.mode) : undefined;
  const options = (body?.options && typeof body.options === 'object') ? body.options : {};
  const reqMaxCharsOpt = Number(options?.maxChars || body?.maxInputChars || 0) || undefined;
  const maxChars = reqMaxCharsOpt ? Math.max(1, Math.min(reqMaxCharsOpt, MAX_INPUT_CHARS_DEFAULT * 4)) : MAX_INPUT_CHARS_DEFAULT; // hard cap
  const targetTokens = Number(body?.targetTokens || 0) || undefined;
  const windowLimit = Number(options?.windowLimit || 0) || undefined;
  const maxMessages = Math.max(1, Math.min(Number(windowLimit || MAX_MESSAGES_DEFAULT), MAX_MESSAGES_DEFAULT));

  // assembledText 생성
  let mode: 'room' | 'messages' | 'text' = 'text';
  let assembledText = '';

  // mode 명시 시 우선 처리
  if (reqMode === 'room' && typeof body?.roomId === 'string' && body.roomId.trim()) {
    mode = 'room';
    assembledText = await fetchRoomMessagesFromFirestore(body.roomId.trim(), maxMessages, maxChars);
    if (!assembledText) {
      return NextResponse.json({ error: '해당 roomId에서 메시지를 찾을 수 없습니다.' }, { status: 404 });
    }
  } else if (reqMode === 'messages' && Array.isArray(body?.messages) && body.messages.length > 0) {
    mode = 'messages';
    const trimmed = (body.messages as APIMsg[]).slice(-maxMessages).map(m => ({
      role: (m?.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: String(m?.content ?? ''),
      createdAt: String(m?.createdAt ?? ''),
    }));
    assembledText = buildTextFromMessages(trimmed, maxChars);
  } else if (reqMode === 'text' && typeof body?.text === 'string' && body.text.trim()) {
    mode = 'text';
    const incoming = String(body.text);
    // text 대용량 소프트 가드
    if (incoming.length > MAX_INPUT_CHARS_DEFAULT * 2) {
      return NextResponse.json(
        { error: '요청 텍스트가 너무 큽니다. mode=messages 또는 mode=room 사용을 권장합니다.' },
        { status: 400 }
      );
    }
    assembledText = incoming;
  } else {
    // 후방 호환: room → messages → text 순으로 해석
    if (typeof body?.roomId === 'string' && body.roomId.trim()) {
      mode = 'room';
      assembledText = await fetchRoomMessagesFromFirestore(body.roomId.trim(), maxMessages, maxChars);
      if (!assembledText) {
        return NextResponse.json({ error: '해당 roomId에서 메시지를 찾을 수 없습니다.' }, { status: 404 });
      }
    } else if (Array.isArray(body?.messages) && body.messages.length > 0) {
      mode = 'messages';
      const trimmed = (body.messages as APIMsg[]).slice(-maxMessages).map(m => ({
        role: (m?.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: String(m?.content ?? ''),
        createdAt: String(m?.createdAt ?? ''),
      }));
      assembledText = buildTextFromMessages(trimmed, maxChars);
    } else if (typeof body?.text === 'string' && body.text.trim()) {
      mode = 'text';
      const incoming = String(body.text);
      if (incoming.length > MAX_INPUT_CHARS_DEFAULT * 2) {
        return NextResponse.json(
          { error: '요청 텍스트가 너무 큽니다. mode=messages 또는 mode=room 사용을 권장합니다.' },
          { status: 400 }
        );
      }
      assembledText = incoming;
    } else {
      return NextResponse.json(
        { error: '요약 입력이 필요합니다. text 또는 messages[], 또는 roomId 중 하나를 제공하세요.' },
        { status: 400 }
      );
    }
  }

  // 메타 계산 및 로깅 준비
  const chunkSize = CHUNK_SIZE_DEFAULT;
  const chunkCount = assembledText.length > maxChars ? Math.ceil(assembledText.length / chunkSize) : 1;
  const totalInputChars = assembledText.length;

  // eslint-disable-next-line no-console
  console.info('[summarize] request', {
    mode,
    totalInputChars,
    chunkSize,
    chunkCount,
    maxChars,
    maxMessages,
  });

  // API 키 없으면 naive 경로로만 처리
  if (!genAI) {
    try {
      const s =
        assembledText.length <= maxChars
          ? naiveSummarize(assembledText)
          : naiveSummarize(assembledText.slice(-maxChars));
      return NextResponse.json(
        { summary: s, meta: { chunks: chunkCount, totalInputChars, fallback: true, reason: 'NO_API_KEY', mode } },
        { status: 200 }
      );
    } catch {
      return NextResponse.json(
        { summary: '', meta: { chunks: chunkCount, totalInputChars, fallback: true, reason: 'NO_API_KEY', mode } },
        { status: 200 }
      );
    }
  }

  // 모델 호출(안전 요약)
  const shrinkCounter = { count: 0 };
  try {
    const summary = await safeSummarize(
      assembledText,
      {
        maxChars,
        chunkSize,
        targetTokens,
      },
      shrinkCounter
    );

    // eslint-disable-next-line no-console
    console.info('[summarize] completed', {
      mode,
      totalInputChars,
      chunkSize,
      chunkCount,
      shrinkCount: shrinkCounter.count,
    });

    return NextResponse.json({ summary, meta: { chunks: chunkCount, totalInputChars } }, { status: 200 });
  } catch (error: any) {
    // 413 전파
    if (isStatus413(error)) {
      // eslint-disable-next-line no-console
      console.warn('[summarize] 413 terminal failure', {
        mode,
        totalInputChars,
        chunkSize,
        chunkCount,
        shrinkCount: shrinkCounter.count,
      });
      return NextResponse.json(
        { error: '입력이 너무 큽니다. 요청 크기를 줄이거나 roomId/messages 경로를 이용하세요.' },
        { status: 413 }
      );
    }
    const errorMessage = error?.message || '요약 API 처리 중 내부 서버 오류가 발생했습니다.';
    // eslint-disable-next-line no-console
    console.error('Error during summarization:', error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}