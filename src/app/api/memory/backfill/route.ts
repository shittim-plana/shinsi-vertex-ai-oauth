import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/utils/vector/supabaseClient';
import { getThresholds } from '@/utils/memory/policy';
import { runSupaSummarization, runHypaRollup } from '@/utils/memory/summarizer';
import {
  upsertSummary,
  storeLinks,
  nextChunkNo,
  type MemorySummary,
} from '@/utils/memory/summary-repository';

/**
 * Memory Backfill API
 * - Build SUPA rolling summaries from historical messages
 * - Optionally build HYPA rollups from SUPA chunks
 *
 * Auth:
 * - Requires ADMIN_BOOTSTRAP_TOKEN via header (x-backfill-token) or body.token
 *
 * Input (POST JSON):
 * {
 *   roomId: string,
 *   mode?: 'supa' | 'hypa' | 'both'   // default: 'both'
 *   dryRun?: boolean,                  // default: false
 *   maxWindows?: number                // optional cap for SUPA windows processed
 * }
 *
 * Output:
 * {
 *   ok: true,
 *   roomId: string,
 *   mode: string,
 *   dryRun: boolean,
 *   windowsProcessed: number,
 *   supaCreated: number,
 *   hypaCreated: number
 * }
 */

type MessageRow = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

function estimateTokens(s: string): number {
  return Math.max(1, Math.ceil((s ?? '').length / 4));
}
function minutesBetween(a: string, b: string): number {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.abs(tb - ta) / 60000;
}
function toIntOrNull(id: string): number | null {
  const n = Number(id);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const headerToken = req.headers.get('x-backfill-token') || '';
    const token = (body?.token as string) || headerToken;
    const expected = (process.env.ADMIN_BOOTSTRAP_TOKEN || '').trim();

    if (!expected || !token || token !== expected) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Extended controls via query/body:
    // - type=hypa or level=1 → HYPA backfill mode
    // - roomIds: string[] to process multiple rooms
    // - all=true → process all rooms that have SUPA
    const url = new URL(req.url);
    const typeQ = String(url.searchParams.get('type') || '').toLowerCase();
    const levelQ = url.searchParams.get('level');
    const wantsHypa =
      typeQ === 'hypa' ||
      String(levelQ || '') === '1' ||
      String(body?.type || '').toLowerCase() === 'hypa' ||
      Number(body?.level) === 1;

    const roomIdsArr: string[] = Array.isArray(body?.roomIds)
      ? (body.roomIds as any[]).map((x: any) => String(x)).filter(Boolean)
      : [];

    const allParam = String(url.searchParams.get('all') || body?.all || '').toLowerCase();
    const processAll = allParam === '1' || allParam === 'true';

    if (wantsHypa && (roomIdsArr.length > 0 || processAll)) {
      const supabase = getSupabaseAdminClient();

      // Build room list
      let rooms: string[] = roomIdsArr;
      if (rooms.length === 0 && processAll) {
        const { data: rows, error: rerr } = await supabase
          .from('chat_memory_summaries')
          .select('room_id')
          .eq('level', 0);
        if (rerr) {
          return NextResponse.json({ ok: false, error: rerr.message || String(rerr) }, { status: 500 });
        }
        const set = new Set<string>();
        (rows || []).forEach((r: any) => {
          const v = String(r?.room_id || '').trim();
          if (v) set.add(v);
        });
        rooms = Array.from(set);
      }

      const limit = Math.max(1, Math.min(5, Number(body?.concurrency || url.searchParams.get('concurrency') || 3)));
      let idx = 0;
      const processed: Array<{ roomId: string; hypaCreated: number; error?: string }> = [];

      const worker = async () => {
        while (idx < rooms.length) {
          const i = idx++;
          const r = rooms[i];
          try {
            const th = getThresholds(r, undefined);
            const { data: supaRows, error: supaErr } = await supabase
              .from('chat_memory_summaries')
              .select('id, chunk_no, summary')
              .eq('room_id', r)
              .eq('level', 0)
              .order('chunk_no', { ascending: true });
            if (supaErr) throw supaErr;

            const supaToRoll = (supaRows || []).map((row: any) => ({
              id: String(row.id),
              chunk_no: Number(row.chunk_no),
              summary: String(row.summary || ''),
            }));

            let created = 0;
            for (let i2 = 0; i2 < supaToRoll.length; i2 += th.hypaChunks) {
              const group = supaToRoll.slice(i2, i2 + th.hypaChunks);
              if (group.length === 0) continue;

              const roll = await runHypaRollup({
                roomId: r,
                supaSummaries: group,
                outputTokens: th.supaTokens,
              });

              const hypaChunkNo = await nextChunkNo(r, 1);
              const savedHypa = await upsertSummary({
                roomId: r,
                level: 1,
                chunkNo: hypaChunkNo,
                summary: roll.summary,
                tokenCount: Math.max(1, Math.ceil((roll.summary || '').length / 4)),
              });

              await storeLinks(
                savedHypa.id,
                group.map((g) => ({
                  level_edge: 1,
                  child_summary_id: g.id,
                  message_id_from: null,
                  message_id_to: null,
                  message_created_from: null,
                  message_created_to: null,
                })) as any,
              );

              created += 1;
            }

            processed.push({ roomId: r, hypaCreated: created });
          } catch (err: any) {
            processed.push({ roomId: r, hypaCreated: 0, error: err?.message || String(err) });
          }
        }
      };

      const workers = new Array(limit).fill(0).map(() => worker());
      await Promise.all(workers);

      const createdTotal = processed.reduce((acc, p) => acc + (p.hypaCreated || 0), 0);
      const failed = processed.filter(p => p.error).map(p => ({ roomId: p.roomId, error: p.error }));

      return NextResponse.json({
        ok: true,
        type: 'hypa',
        processed: processed.length,
        created: createdTotal,
        failed,
        rooms: processed,
      }, { status: 200 });
    }

    const roomId = String(body?.roomId || '').trim();
    if (!roomId) {
      return NextResponse.json({ ok: false, error: 'roomId is required' }, { status: 400 });
    }

    const modeIn = String(body?.mode || 'both').toLowerCase();
    const mode: 'supa' | 'hypa' | 'both' =
      modeIn === 'supa' || modeIn === 'hypa' || modeIn === 'both' ? (modeIn as any) : 'both';

    const dryRun = Boolean(body?.dryRun);
    const maxWindows =
      Number.isFinite(body?.maxWindows) && body?.maxWindows > 0 ? Math.trunc(body?.maxWindows) : undefined;

    const supabase = getSupabaseAdminClient();
    const th = getThresholds(roomId, undefined);

    // 1) Load message stream (chunk_index=0)
    const { data, error } = await supabase
      .from('chat_message_embeddings')
      .select('message_id, role, content_text, message_created_at, chunk_index')
      .eq('room_id', roomId)
      .eq('chunk_index', 0)
      .order('message_created_at', { ascending: true });

    if (error) {
      console.error('[backfill] load messages error', error);
      return NextResponse.json({ ok: false, error: error.message || String(error) }, { status: 500 });
    }

    const messages: MessageRow[] = (Array.isArray(data) ? data : [])
      .map((r: any) => ({
        id: String(r?.message_id ?? ''),
        role: String(r?.role ?? 'assistant'),
        content: String(r?.content_text ?? ''),
        createdAt: r?.message_created_at ? new Date(r?.message_created_at).toISOString() : new Date(0).toISOString(),
      }))
      .filter((m) => (m.content || '').trim().length > 0);

    if (messages.length === 0) {
      return NextResponse.json({
        ok: true,
        roomId,
        mode,
        dryRun,
        windowsProcessed: 0,
        supaCreated: 0,
        hypaCreated: 0,
        note: 'no messages found',
      });
    }

    // 2) Build SUPA windows by thresholds (tokens, count, gap)
    const windows: MessageRow[][] = [];
    let cur: MessageRow[] = [];
    let tokens = 0;

    for (let i = 0; i < messages.length; i += 1) {
      const m = messages[i];
      const t = estimateTokens(m.content);

      let shouldFlush = false;

      if (cur.length > 0) {
        const prev = cur[cur.length - 1];
        const gap = minutesBetween(prev.createdAt, m.createdAt);
        if (gap >= th.gapMinutes) {
          shouldFlush = true;
        }
      }
      if (!shouldFlush) {
        if (tokens + t > th.supaTokens || cur.length + 1 > th.supaWindow) {
          shouldFlush = true;
        }
      }

      if (shouldFlush) {
        if (cur.length > 0) windows.push(cur);
        cur = [];
        tokens = 0;
      }

      cur.push(m);
      tokens += t;
    }
    if (cur.length > 0) windows.push(cur);

    const limitedWindows = typeof maxWindows === 'number' ? windows.slice(0, maxWindows) : windows;

    // 3) Execute SUPA summarizations
    let windowsProcessed = 0;
    let supaCreated = 0;
    const supaSummariesForHypa: Array<{ id: string; chunk_no: number; summary: string }> = [];

    if (mode === 'supa' || mode === 'both') {
      for (const w of limitedWindows) {
        windowsProcessed += 1;

        const first = w[0];
        const last = w[w.length - 1];

        if (dryRun) {
          continue;
        }

        // Summarize window
        const summaryRes = await runSupaSummarization({
          roomId,
          windowMessages: w.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
          })),
          outputTokens: th.supaTokens, // soft target
        });

        const chunkNo = await nextChunkNo(roomId, 0);
        const saved: MemorySummary = await upsertSummary({
          roomId,
          level: 0,
          chunkNo,
          summary: summaryRes.summary,
          tokenCount: estimateTokens(summaryRes.summary),
        });

        // Link SUPA -> MSG(range)
        const msgFromId = toIntOrNull(first.id);
        const msgToId = toIntOrNull(last.id);
        await storeLinks(saved.id, [
          {
            level_edge: 0, // SUPA -> MSG
            child_summary_id: null,
            message_id_from: msgFromId,
            message_id_to: msgToId,
            message_created_from: first.createdAt,
            message_created_to: last.createdAt,
          } as any,
        ]);

        supaCreated += 1;
        supaSummariesForHypa.push({ id: saved.id, chunk_no: chunkNo, summary: summaryRes.summary });
      }
    }

    // 4) Execute HYPA rollups (group SUPA chunks by threshold)
    let hypaCreated = 0;
    if ((mode === 'hypa' || mode === 'both') && !dryRun) {
      // If SUPA was not built in this run (mode === 'hypa'), load recent SUPA summaries
      let supaToRoll: Array<{ id: string; chunk_no: number; summary: string }> = supaSummariesForHypa;
      if (supaToRoll.length === 0 && mode === 'hypa') {
        // Load all existing SUPA summaries (ordered by chunk_no ascending)
        const supabase2 = getSupabaseAdminClient();
        const { data: supaRows, error: supaErr } = await supabase2
          .from('chat_memory_summaries')
          .select('id, chunk_no, summary, level')
          .eq('room_id', roomId)
          .eq('level', 0)
          .order('chunk_no', { ascending: true });

        if (supaErr) {
          console.error('[backfill] load supa for hypa error', supaErr);
          return NextResponse.json({ ok: false, error: supaErr.message || String(supaErr) }, { status: 500 });
        }
        supaToRoll = (supaRows || []).map((r: any) => ({
          id: String(r.id),
          chunk_no: Number(r.chunk_no),
          summary: String(r.summary || ''),
        }));
      }

      // Group by hypaChunks
      for (let i = 0; i < supaToRoll.length; i += th.hypaChunks) {
        const group = supaToRoll.slice(i, i + th.hypaChunks);
        if (group.length === 0) continue;

        const roll = await runHypaRollup({
          roomId,
          supaSummaries: group.map((g) => ({ id: g.id, chunk_no: g.chunk_no, summary: g.summary })),
          outputTokens: th.supaTokens, // reuse allowance
        });

        const hypaChunkNo = await nextChunkNo(roomId, 1);
        const savedHypa: MemorySummary = await upsertSummary({
          roomId,
          level: 1,
          chunkNo: hypaChunkNo,
          summary: roll.summary,
          tokenCount: estimateTokens(roll.summary),
        });

        // Link HYPA -> SUPA(children)
        await storeLinks(
          savedHypa.id,
          group.map((g) => ({
            level_edge: 1, // HYPA -> SUPA
            child_summary_id: g.id,
            message_id_from: null,
            message_id_to: null,
            message_created_from: null,
            message_created_to: null,
          })) as any,
        );

        hypaCreated += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      roomId,
      mode,
      dryRun,
      windowsProcessed,
      supaCreated,
      hypaCreated,
    });
  } catch (err: any) {
    console.error('[memory/backfill] error', err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}