/**
 * Embedding utilities (server-only)
 * - Providers: OpenAI, OpenRouter, Local HTTP
 * - Preprocessing: normalizeForEmbedding (NFKC, control char removal, whitespace collapse, clamp)
 * - Batch execution with concurrency, retries, and optional RPM rate limiting
 *
 * Compatibility:
 * - normalizeText (legacy)
 * - embedText, embedMany (legacy) now wrap embedOne/embedBatch
 * - getEmbeddingFromText alias for embedOne
 */
import 'server-only';

function assertServerOnly(): void {
  if (typeof window !== 'undefined') {
    throw new Error('embeddings: This module must only be used on the server (server-only).');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * 에러 로그용 마스킹된 텍스트 정보
 * - 실제 내용은 출력하지 않고 길이 및 일부 메타만 남김
 */
function maskForLog(original: string): string {
  const len = original?.length ?? 0;
  return `[len=${len}]`;
}

/**
 * Legacy text normalization (kept for compatibility with existing code using normalizeText)
 * - Remove control chars
 * - Collapse whitespace
 * - Trim and clamp to maxLen (default 8192)
 */
export function normalizeText(input: string, maxLen = 8192): string {
  const withoutControl = (input ?? '').replace(/[\x00-\x1F\x7F]/g, ' ');
  const normalized = withoutControl.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLen ? normalized.slice(0, maxLen) : normalized;
}

/**
 * Preprocessing for embedding: NFKC normalization, remove control chars, collapse spaces, clamp length
 */
export function normalizeForEmbedding(input: string, opts?: { maxChars?: number }): string {
  const maxChars = Math.max(1, Math.min(100000, opts?.maxChars ?? 4000));
  let s = (input ?? '');
  try { s = s.normalize('NFKC'); } catch { /* ignore */ }
  s = s.replace(/[\x00-\x1F\x7F]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > maxChars) s = s.slice(0, maxChars);
  return s;
}

export interface EmbeddingProvider {
  embed(texts: string[], opts?: { model?: string }): Promise<number[][]>;
  maxBatchSize: number;
  maxRpm?: number;
  dim: number;
  id: 'openai' | 'openrouter' | 'local';
}

export type EmbedBatchOptions = {
  concurrency?: number;
  maxBatchSize?: number;
  backoffBaseMs?: number;
  backoffFactor?: number;
  maxRetries?: number;
  rpm?: number;
  model?: string;
};

function getEnvInt(name: string, def?: number): number | undefined {
  const v = process.env[name];
  if (!v) return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

async function safeReadError(res: Response): Promise<string> {
  try { const t = await res.text(); return t.slice(0, 500); } catch { return ''; }
}

function createOpenAIProvider(env = process.env): EmbeddingProvider {
  const key = env.OPENAI_API_KEY || '';
  if (!key) throw new Error('embeddings: OPENAI_API_KEY is required for openai provider');
  const modelDefault = env.EMBED_MODEL || 'text-embedding-3-small';
  const provider: EmbeddingProvider = {
    id: 'openai',
    dim: 1536,
    maxBatchSize: getEnvInt('EMBED_MAX_BATCH', 64) ?? 64,
    maxRpm: undefined,
    async embed(texts: string[], opts?: { model?: string }): Promise<number[][]> {
      const model = opts?.model || modelDefault;
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) {
        const msg = await safeReadError(res);
        const err: any = new Error(`openai embed failed: ${res.status} ${res.statusText} ${msg}`);
        err.status = res.status;
        throw err;
      }
      const json: any = await res.json();
      const data = Array.isArray(json?.data) ? json.data : [];
      const out: number[][] = data.map((d: any) => (Array.isArray(d?.embedding) ? d.embedding.map(Number) : []));
      if (out[0]?.length) (provider as any).dim = out[0].length;
      return out;
    },
  };
  return provider;
}

function createOpenRouterProvider(env = process.env): EmbeddingProvider {
  const key = env.OPENROUTER_API_KEY || '';
  if (!key) throw new Error('embeddings: OPENROUTER_API_KEY is required for openrouter provider');
  const modelDefault = env.EMBED_MODEL || 'text-embedding-3-small';
  const provider: EmbeddingProvider = {
    id: 'openrouter',
    dim: 1536,
    maxBatchSize: getEnvInt('EMBED_MAX_BATCH', 64) ?? 64,
    maxRpm: undefined,
    async embed(texts: string[], opts?: { model?: string }): Promise<number[][]> {
      const model = opts?.model || modelDefault;
      const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) {
        const msg = await safeReadError(res);
        const err: any = new Error(`openrouter embed failed: ${res.status} ${res.statusText} ${msg}`);
        err.status = res.status;
        throw err;
      }
      const json: any = await res.json();
      const data = Array.isArray(json?.data) ? json.data : [];
      const out: number[][] = data.map((d: any) => (Array.isArray(d?.embedding) ? d.embedding.map(Number) : []));
      if (out[0]?.length) (provider as any).dim = out[0].length;
      return out;
    },
  };
  return provider;
}

function createLocalProvider(env = process.env): EmbeddingProvider {
  const url = env.LOCAL_EMBEDDING_URL || '';
  if (!url) throw new Error('embeddings: LOCAL_EMBEDDING_URL is required for local provider');
  const provider: EmbeddingProvider = {
    id: 'local',
    dim: 0,
    maxBatchSize: getEnvInt('EMBED_MAX_BATCH', 64) ?? 64,
    maxRpm: undefined,
    async embed(texts: string[]): Promise<number[][]> {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: texts }),
      });
      if (!res.ok) {
        const msg = await safeReadError(res);
        const err: any = new Error(`local embed failed: ${res.status} ${res.statusText} ${msg}`);
        err.status = res.status;
        throw err;
      }
      const json: any = await res.json();
      const out: number[][] = Array.isArray(json?.embeddings) ? json.embeddings.map((row: any) => row.map(Number)) : [];
      if (out[0]?.length) (provider as any).dim = out[0].length;
      return out;
    },
  };
  return provider;
}

export function createEmbeddingProvider(env = process.env): EmbeddingProvider {
  const name = (env.EMBED_PROVIDER || 'openai').toLowerCase();
  if (name === 'openrouter') return createOpenRouterProvider(env);
  if (name === 'local') return createLocalProvider(env);
  return createOpenAIProvider(env);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function embedBatch(
  texts: string[],
  provider?: EmbeddingProvider,
  opts?: EmbedBatchOptions
): Promise<number[][]> {
  assertServerOnly();
  const p = provider ?? createEmbeddingProvider(process.env);
  const concurrency = Math.max(1, opts?.concurrency ?? getEnvInt('EMBED_CONCURRENCY', 3) ?? 3);
  const maxBatchSize = Math.max(1, opts?.maxBatchSize ?? p.maxBatchSize ?? 64);
  const backoffBaseMs = Math.max(1, opts?.backoffBaseMs ?? 500);
  const backoffFactor = Math.max(1, opts?.backoffFactor ?? 2);
  const maxRetries = Math.max(0, opts?.maxRetries ?? 5);
  const rpm = opts?.rpm ?? p.maxRpm;
  const model = opts?.model ?? (process.env.EMBED_MODEL || 'text-embedding-3-small');

  const batches = chunk(texts, maxBatchSize);
  const out: number[][] = new Array(texts.length);
  const minInterval = rpm ? Math.ceil(60000 / rpm) : 0;
  let nextAllowedAt = 0;

  const debug = !!process.env.DEBUG_EMBED;
  if (debug) {
    // eslint-disable-next-line no-console
    console.time(`[embedBatch] n=${texts.length} batch=${maxBatchSize} conc=${concurrency}`);
  }

  let cursor = 0;
  async function processBatch(items: string[], startIndex: number) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (minInterval > 0) {
          const wait = nextAllowedAt - Date.now();
          if (wait > 0) await sleep(wait);
          nextAllowedAt = Date.now() + minInterval;
        }

        const vecs = await p.embed(items, { model });
        if (!Array.isArray(vecs) || vecs.length !== items.length) {
          throw new Error(`embedBatch: mismatched result length: got ${vecs?.length} expected ${items.length}`);
        }
        for (let i = 0; i < vecs.length; i++) {
          out[startIndex + i] = vecs[i];
        }
        if (debug) {
          // eslint-disable-next-line no-console
          console.log(`[embedBatch] batch done size=${items.length} attempt=${attempt + 1}`);
        }
        return;
      } catch (err: any) {
        const status = Number.isFinite(err?.status) ? Number(err.status) : undefined;
        const retryable = status === 429 || (status != null && status >= 500);
        if (!retryable || attempt >= maxRetries) {
          // eslint-disable-next-line no-console
          console.error('[embeddings] batch failed', {
            attempt,
            status,
            size: items.length,
            error: err?.message ?? String(err),
          });
          throw err;
        }
        const delay = Math.min(60000, backoffBaseMs * Math.pow(backoffFactor, attempt));
        if (debug) {
          // eslint-disable-next-line no-console
          console.log(`[embedBatch] retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        }
        await sleep(delay);
      }
    }
  }

  while (cursor < batches.length) {
    const group: Promise<void>[] = [];
    for (let i = 0; i < concurrency && cursor < batches.length; i++, cursor++) {
      const batchIndex = cursor;
      const items = batches[batchIndex];
      const startIndex = batchIndex * maxBatchSize;
      group.push(processBatch(items, startIndex));
    }
    await Promise.all(group);
  }

  if (debug) {
    // eslint-disable-next-line no-console
    console.timeEnd(`[embedBatch] n=${texts.length} batch=${maxBatchSize} conc=${concurrency}`);
  }

  return out;
}

export async function embedOne(text: string, provider?: EmbeddingProvider, opts?: EmbedBatchOptions): Promise<number[]> {
  assertServerOnly();
  const [v] = await embedBatch([text], provider, opts);
  return v;
}

/**
 * Legacy compatibility exports
 */
export async function embedText(text: string): Promise<number[]> {
  assertServerOnly();
  const cleaned = normalizeForEmbedding(text);
  if (!cleaned) {
    throw new Error('embeddings: Empty text after normalization');
  }
  try {
    return await embedOne(cleaned);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('embeddings: failed to embed text', {
      error: err?.message ?? String(err),
      text: maskForLog(text),
    });
    throw err;
  }
}

export async function embedMany(texts: string[]): Promise<number[][]> {
  assertServerOnly();
  const arr = texts.map((t) => normalizeForEmbedding(t));
  return embedBatch(arr);
}

export const getEmbeddingFromText = (t: string) => embedOne(normalizeForEmbedding(t));