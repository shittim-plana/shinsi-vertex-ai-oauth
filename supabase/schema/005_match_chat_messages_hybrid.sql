-- Hybrid semantic + lexical (trigram/tsvector) retrieval for chat messages
-- Additive RPC; relies on pgvector and pg_trgm; optional tsvector usage

create or replace function match_chat_messages_hybrid(
  p_room_id uuid,
  p_query_embedding vector(1536),
  p_query_text text,
  p_alpha double precision default 0.5,
  p_match_count int default 32,
  p_similarity_threshold double precision default 0.75,
  p_from_ts timestamptz default null,
  p_decay_halflife_hours double precision default null,
  p_role_filter text[] default null,
  p_author_filter text[] default null,
  p_use_tsv boolean default false
)
returns table (
  room_id uuid,
  message_id text,
  content_text text,
  role text,
  author_id text,
  message_created_at timestamptz,
  chunk_index int,
  chunk_count int,
  source_url text,
  sem_score double precision,
  lex_score double precision,
  combined_score double precision
)
language sql
volatile
parallel safe
as $$
  with candidates as (
    select
      cme.room_id,
      cme.message_id,
      cme.content_text,
      cme.role,
      cme.author_id,
      coalesce(cme.message_created_at, cme.created_at) as message_created_at,
      cme.chunk_index,
      cme.chunk_count,
      cme.source_url,
      greatest(1 - (cme.embedding <=> p_query_embedding), 0)::double precision as sem_score,
      case
        when p_use_tsv and cme.content_tsv is not null then
          coalesce(ts_rank_cd(cme.content_tsv, websearch_to_tsquery('korean', p_query_text)), 0)::double precision
        else
          greatest(similarity(cme.content_text, p_query_text), 0)::double precision
      end as lex_score
    from chat_message_embeddings cme
    where cme.room_id::text = p_room_id::text
      and (p_role_filter is null or cme.role = any(p_role_filter))
      and (p_author_filter is null or cme.author_id::text = any(p_author_filter))
      and (p_from_ts is null or coalesce(cme.message_created_at, cme.created_at) >= p_from_ts)
  ),
  scored as (
    select
      candidates.*,
      case
        when p_decay_halflife_hours is null then 1.0
        else power(0.5, extract(epoch from (now() - candidates.message_created_at))/3600.0 / p_decay_halflife_hours)
      end as decay_factor
    from candidates
  ),
  combined as (
    select
      scored.*,
      (p_alpha * sem_score + (1.0 - p_alpha) * lex_score) * decay_factor as combined_score
    from scored
    where sem_score >= p_similarity_threshold or lex_score >= 0.30
  )
  select
    p_room_id as room_id,
    combined.message_id as message_id,
    combined.content_text,
    combined.role,
    combined.author_id,
    combined.message_created_at,
    combined.chunk_index,
    combined.chunk_count,
    combined.source_url,
    combined.sem_score,
    combined.lex_score,
    combined.combined_score
  from combined
  order by combined_score desc
  limit p_match_count;
$$;