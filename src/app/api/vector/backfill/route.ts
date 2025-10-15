'use server';

import { NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import {
  collection,
  query,
  orderBy,
  limit as fbLimit,
  getDocs,
  startAfter,
  Timestamp,
  QueryDocumentSnapshot,
  DocumentData,
  where,
} from 'firebase/firestore';
import { upsertMessageEmbedding } from '@/utils/vector/repository';
import { createEmbeddingProvider, embedBatch, normalizeForEmbedding } from '@/utils/vector/embeddings';
import { getSupabaseAdminClient } from '@/utils/vector/supabaseClient';

/**
 * Backfill chat messages into Supabase pgvector
 *
 * Security:
 * - Requires header "x-backfill-secret" to equal process.env.RAG_BACKFILL_SECRET
 *
 * Request (Query params preferred; body supported for legacy):
 * - roomId: string (required)
 * - batchSize: number (default 64)
 * - concurrency: number (default 3)
 * - dryRun: boolean (default false)
 * - reindex: boolean (default false; if false, skip if (room_id,message_id,chunk_index=0) exists)
 * - fromTs: ISO or epoch ms (optional, inclusive)
 * - toTs: ISO or epoch ms (optional, inclusive)
 *
 * Response:
 * {
 *   ok: true,
 *   roomId: "...",
 *   processed: number,
 *   embedded: number,
 *   skipped: number,
 *   failed: number,
 *   avgEmbedMs: number
 * }
 */
export async function POST(req: Request) {
  try {
    // Security gate
    const secret = req.headers.get('x-backfill-secret');
    const expected = process.env.RAG_BACKFILL_SECRET;
    if (!expected || !secret || secret !== expected) {
      return NextResponse.json(
        { error: 'Unauthorized: missing or invalid backfill secret' },
        { status: 401 }
      );
    }

    // Parse query params (preferred)
    const url = new URL(req.url);
    const roomIdQ = url.searchParams.get('roomId') ?? undefined;
    const batchSizeQ = url.searchParams.get('batchSize');
    const concurrencyQ = url.searchParams.get('concurrency');
    const dryRunQ = url.searchParams.get('dryRun');
    const reindexQ = url.searchParams.get('reindex');
    const fromTsQ = url.searchParams.get('fromTs');
    const toTsQ = url.searchParams.get('toTs');

    // Legacy body fallback
    const body = await req.json().catch(() => ({}));
    const roomId = String(roomIdQ ?? body.roomId ?? '').trim();

    const batchSize = clampInt(
      batchSizeQ != null ? Number(batchSizeQ) : body.batchSize,
      1,
      500,
      64
    );
    const concurrency = clampInt(
      concurrencyQ != null ? Number(concurrencyQ) : body.concurrency,
      1,
      16,
      3
    );
    const dryRun = toBool(dryRunQ ?? body.dryRun, false);
    const reindex = toBool(reindexQ ?? body.reindex, false);

    const fromTs = toDate(fromTsQ ?? body.fromTs);
    const toTs = toDate(toTsQ ?? body.toTs);

    if (!roomId) {
      return NextResponse.json({ error: 'roomId is required' }, { status: 400 });
    }

    // Scan messages in ascending timestamp order
    let qBase = query(collection(db, 'chatRooms', roomId, 'messages'), orderBy('timestamp', 'asc'));
    if (fromTs) qBase = query(qBase, where('timestamp', '>=', Timestamp.fromDate(fromTs)));
    if (toTs) qBase = query(qBase, where('timestamp', '<=', Timestamp.fromDate(toTs)));

    // Provider once per run
    const provider = createEmbeddingProvider();
    const model = process.env.EMBED_MODEL || 'text-embedding-3-small';

    const supabase = getSupabaseAdminClient();

    let processed = 0;
    let embedded = 0;
    let skipped = 0;
    let failed = 0;
    let batches = 0;
    let embedCalls = 0;
    let embedMsTotal = 0;
    let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

    const shouldIndex = (data: any): boolean => {
      const hasText = typeof data.text === 'string' && data.text.trim().length > 0;
      return hasText;
    };

    for (;;) {
      let q = query(qBase, fbLimit(batchSize));
      if (cursor) {
        q = query(qBase, startAfter(cursor), fbLimit(batchSize));
      }

      const snap = await getDocs(q);
      if (snap.empty) break;
      batches += 1;

      // Gather candidates
      const docs = snap.docs;
      const candidates: { id: string; role: 'user' | 'assistant'; content: string; createdAt: Date; authorId: string | null }[] = [];
      for (const docSnap of docs) {
        const data = docSnap.data();
        if (!shouldIndex(data)) { skipped += 1; continue; }

        const role: 'user' | 'assistant' = data.isCharacter ? 'assistant' : 'user';
        const contentRaw: string = (data.text || '').toString();
        const createdAt =
          (data.timestamp instanceof Timestamp ? data.timestamp.toDate() : new Date(data.timestamp || Date.now()));
        const authorId: string | null = role === 'user'
          ? (data.senderId ? String(data.senderId) : null)
          : (data.characterId ? String(data.characterId) : null);

        candidates.push({
          id: docSnap.id,
          role,
          content: normalizeForEmbedding(contentRaw),
          createdAt,
          authorId,
        });
      }

      // Skip existence when reindex=false
      let toEmbed = candidates;
      if (!reindex && candidates.length > 0) {
        const checks = await Promise.all(candidates.map(async (c) => {
          const { data, error } = await supabase
            .from('chat_message_embeddings')
            .select('message_id')
            .eq('room_id', roomId)
            .eq('message_id', c.id)
            .eq('chunk_index', 0)
            .limit(1);
          if (error) {
            // eslint-disable-next-line no-console
            console.warn('[backfill] existence check error', { message: error.message });
            return false; // fallback to reindex
          }
          return Array.isArray(data) && data.length > 0;
        }));
        toEmbed = candidates.filter((_, i) => {
          const exists = checks[i];
          if (exists) skipped += 1;
          return !exists;
        });
      }

      processed += candidates.length;
      if (dryRun || toEmbed.length === 0) {
        // advance cursor and continue
        cursor = docs[docs.length - 1];
        await sleep(25);
        continue;
      }

      // Embed batch
      const texts = toEmbed.map((c) => c.content);
      const t0 = Date.now();
      const vecs = await embedBatch(texts, provider, { concurrency, maxBatchSize: batchSize, model });
      const dt = Date.now() - t0;
      embedCalls += 1;
      embedMsTotal += dt;

      // Upsert
      for (let i = 0; i < toEmbed.length; i++) {
        const row = toEmbed[i];
        const vec = vecs[i];
        try {
          await upsertMessageEmbedding({
            roomId,
            messageId: row.id,
            role: row.role,
            content: row.content,
            authorId: row.authorId,
            messageCreatedAt: row.createdAt,
            sourceUrl: null,
            chunkIndex: 0,
            chunkCount: 1,
            embedding: vec,
            embeddingProvider: provider.id,
            embeddingModel: model,
            embeddingDim: vec?.length || provider.dim,
            embeddingVersion: 1,
          });
          embedded += 1;
        } catch (e) {
          failed += 1;
          // eslint-disable-next-line no-console
          console.error('[backfill] upsert failed:', e);
        }
      }

      // advance cursor
      cursor = docs[docs.length - 1];

      // Short break to reduce load
      await sleep(25);
    }

    const avgEmbedMs = embedCalls > 0 ? Math.round(embedMsTotal / embedCalls) : 0;

    return NextResponse.json(
      {
        ok: true,
        roomId,
        processed,
        embedded,
        skipped,
        failed,
        avgEmbedMs,
        // legacy fields (for compatibility)
        batches,
        dryRun,
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error('[backfill] fatal error:', e);
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}

function clampInt(v: any, min: number, max: number, def: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function toBool(v: any, def = false): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === '1';
  if (typeof v === 'number') return v !== 0;
  return def;
}

function toDate(v: any): Date | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? undefined : d;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}