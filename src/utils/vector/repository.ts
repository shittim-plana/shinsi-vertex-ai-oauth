/**
 * Vector 저장소 유틸리티
 * - chat_message_embeddings 테이블 업서트 전용 래퍼
 *
 * Security:
 * - 서버 전용 (service role 사용). 브라우저에서 import되면 안 됨.
 */
import 'server-only';

import { getSupabaseAdminClient } from './supabaseClient';

/**
 * 업서트 시그니처 확장
 * - content: 전처리된 텍스트(content_text로 저장)
 * - embedding 및 메타 포함
 * - onConflict: (room_id, message_id, chunk_index)
 */
export async function upsertMessageEmbedding(params: {
  roomId: string;
  messageId: string;
  content: string;
  embedding: number[];
  role?: string;
  authorId?: string | null;
  messageCreatedAt?: string | Date;
  sourceUrl?: string | null;
  chunkIndex?: number;
  chunkCount?: number;
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingDim?: number;
  embeddingVersion?: number;
}): Promise<void> {
  if (typeof window !== 'undefined') {
    throw new Error('repository: This module must only be used on the server (server-only).');
  }

  const {
    roomId,
    messageId,
    content,
    embedding,
    role,
    authorId = null,
    messageCreatedAt,
    sourceUrl = null,
    chunkIndex = 0,
    chunkCount = 1,
    embeddingProvider,
    embeddingModel,
    embeddingDim,
    embeddingVersion,
  } = params;

  if (!roomId) throw new Error('upsertMessageEmbedding: roomId is required');
  if (!messageId) throw new Error('upsertMessageEmbedding: messageId is required');
  if (!Array.isArray(embedding) || embedding.length === 0) throw new Error('upsertMessageEmbedding: embedding is required');

  const supabase = getSupabaseAdminClient();

  const payload: any = {
    room_id: roomId,
    message_id: messageId,
    role: role ?? 'user',
    // Mirror legacy NOT NULL column
    content: content,
    // New normalized field
    content_text: content,
    message_created_at: toIso(messageCreatedAt) ?? new Date().toISOString(),
    source_url: sourceUrl,
    chunk_index: chunkIndex ?? 0,
    chunk_count: chunkCount ?? 1,
    embedding,
    embedding_provider: embeddingProvider ?? null,
    embedding_model: embeddingModel ?? null,
    embedding_dim: embeddingDim ?? (Array.isArray(embedding) ? embedding.length : null),
    embedding_version: embeddingVersion ?? 1,
  };
  // Only set author_id when it's a valid UUID. This avoids 22P02 errors on environments
  // where the DB column type is uuid (pre-migration) while we may receive Firebase UIDs.
  if (typeof authorId === 'string' && isUuid(authorId)) {
    payload.author_id = authorId;
  } else if (authorId === null) {
    payload.author_id = null;
  }

  try {
    const { error } = await supabase
      .from('chat_message_embeddings')
      .upsert(payload, { onConflict: 'room_id,message_id,chunk_index' });

    if (error) throw error;
  } catch (err: any) {
    // 원문 텍스트는 로그에 노출하지 않음
    // eslint-disable-next-line no-console
    console.error('[vector-index] upsert failed', {
      error: {
        message: err?.message ?? null,
        code: err?.code ?? null,
        details: err?.details ?? null,
        hint: err?.hint ?? null,
        raw: (() => {
          try { return JSON.stringify(err, Object.getOwnPropertyNames(err)); }
          catch { try { return JSON.stringify(err); } catch { return String(err); } }
        })(),
      },
      roomId,
      messageId,
      role,
      contentLen: content?.length ?? 0,
      chunkIndex,
    });
    throw err;
  }
}

function toIso(input?: string | Date): string | undefined {
  if (!input) return undefined;
  if (input instanceof Date) return input.toISOString();
  const d = new Date(input);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * UUID v4 format checker
 */
function isUuid(s: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s);
}