'use server';

// server-only 명시
import 'server-only';

import { NextResponse } from 'next/server';
import { upsertMessageEmbedding } from '../../../../utils/vector/repository';
import { createEmbeddingProvider, embedOne, normalizeForEmbedding } from '../../../../utils/vector/embeddings';

type Role = 'user' | 'assistant' | 'system' | 'character';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidRole(v: unknown): v is Role {
  return v === 'user' || v === 'assistant' || v === 'system' || v === 'character';
}

function toDateOrString(v: any): string | Date | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? undefined : d;
  }
  if (typeof v === 'string') return v;
  return undefined;
}

async function embedWithRetry(text: string, provider = createEmbeddingProvider(), maxRetries = 5): Promise<{ vec: number[]; providerId: string; model: string; dim: number; }> {
  const model = process.env.EMBED_MODEL || 'text-embedding-3-small';
  let lastErr: any;
  for (let attempt = 0; attempt < Math.max(1, maxRetries); attempt++) {
    try {
      const vec = await embedOne(text, provider, { model });
      return { vec, providerId: provider.id, model, dim: vec.length || provider.dim };
    } catch (err: any) {
      lastErr = err;
      const status = Number.isFinite(err?.status) ? Number(err.status) : undefined;
      const retryable = status === 429 || (status != null && status >= 500);
      if (!retryable || attempt === maxRetries - 1) break;
      const delay = Math.min(60000, 500 * Math.pow(2, attempt));
      if (process.env.DEBUG_RAG) {
        // eslint-disable-next-line no-console
        console.log(`[index-message] retry attempt=${attempt + 1} delay=${delay}ms status=${status}`);
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const roomId = body?.roomId;
    const messageId = body?.messageId;
    const roleBody = body?.role;
    const contentRaw = typeof body?.content === 'string' ? body.content : '';
    const characterId = typeof body?.characterId === 'string' ? body.characterId : body?.characterId ?? null;
    const userId = typeof body?.userId === 'string' ? body.userId : body?.userId ?? null;
    const createdAt = toDateOrString(body?.createdAt);
    const sourceUrl = typeof body?.sourceUrl === 'string' ? body.sourceUrl : null;

    if (!isNonEmptyString(roomId)) {
      return NextResponse.json({ ok: false, error: 'Invalid roomId' }, { status: 400 });
    }
    if (!isNonEmptyString(messageId)) {
      return NextResponse.json({ ok: false, error: 'Invalid messageId' }, { status: 400 });
    }
    const role = isValidRole(roleBody) ? roleBody : 'user';

    const content = normalizeForEmbedding(contentRaw);
    if (!content || content.length === 0) {
      return NextResponse.json({ ok: true, skipped: true }, { status: 200 });
    }

    const provider = createEmbeddingProvider();
    const { vec, providerId, model, dim } = await embedWithRetry(content, provider, 5);

    await upsertMessageEmbedding({
      roomId,
      messageId,
      role,
      content,
      authorId: (role === 'user' ? (userId ?? characterId ?? null) : (characterId ?? userId ?? null)),
      messageCreatedAt: createdAt,
      sourceUrl,
      chunkIndex: 0,
      chunkCount: 1,
      embedding: vec,
      embeddingProvider: providerId,
      embeddingModel: model,
      embeddingDim: dim,
      embeddingVersion: 1,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    // 원문/민감 정보는 로그에 남기지 않음
    // eslint-disable-next-line no-console
    console.error('[vector-index] API failed', {
      error: {
        message: err?.message ?? null,
        code: err?.code ?? null,
        details: err?.details ?? null,
        hint: err?.hint ?? null,
        raw: (() => {
          try { return JSON.stringify(err, Object.getOwnPropertyNames(err)); }
          catch { try { return JSON.stringify(err); } catch { return String(err); } }
        })(),
      }
    });
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}