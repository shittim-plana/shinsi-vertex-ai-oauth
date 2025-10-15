-- Parent-child windowing metadata and helper RPC
-- Additive change; safe IF NOT EXISTS guards

alter table if exists chat_message_embeddings
  add column if not exists parent_message_id uuid,
  add column if not exists window_left int default 0,
  add column if not exists window_right int default 0;

create or replace function expand_window_for_hits(
  p_room_id uuid,
  p_message_ids text[],
  p_window_size int default 1
)
returns table (
  base_message_id text,
  left_context jsonb[],
  right_context jsonb[]
)
language plpgsql
volatile
as $$
declare
  mid text;
  base_ts timestamptz;
  left_arr jsonb[];
  right_arr jsonb[];
begin
  foreach mid in array p_message_ids loop
    select coalesce(message_created_at, created_at) into base_ts
    from chat_message_embeddings
    where room_id::text = p_room_id::text and message_id::text = mid::text
    limit 1;

    select array_agg(to_jsonb(t) order by t.message_created_at asc) into left_arr
    from (
      select m.message_id as message_id, m.content_text, m.role, m.author_id,
             coalesce(m.message_created_at, m.created_at) as message_created_at,
             m.chunk_index, m.chunk_count
      from chat_message_embeddings m
      where m.room_id::text = p_room_id::text
        and coalesce(m.message_created_at, m.created_at) < base_ts
      order by coalesce(m.message_created_at, m.created_at) desc
      limit p_window_size
    ) t;

    select array_agg(to_jsonb(t) order by t.message_created_at asc) into right_arr
    from (
      select m.message_id as message_id, m.content_text, m.role, m.author_id,
             coalesce(m.message_created_at, m.created_at) as message_created_at,
             m.chunk_index, m.chunk_count
      from chat_message_embeddings m
      where m.room_id::text = p_room_id::text
        and coalesce(m.message_created_at, m.created_at) > base_ts
      order by coalesce(m.message_created_at, m.created_at) asc
      limit p_window_size
    ) t;

    base_message_id := mid;
    left_context := coalesce(left_arr, array[]::jsonb[]);
    right_context := coalesce(right_arr, array[]::jsonb[]);
    return next;
  end loop;
end
$$;