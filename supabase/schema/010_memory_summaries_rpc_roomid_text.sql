-- 010: Fix RPC return type to text after room_id changed to text
drop function if exists match_chat_memory_summaries_hybrid(
  text,
  vector(1536),
  text,
  double precision,
  integer,
  double precision,
  timestamp with time zone,
  integer,
  smallint[],
  boolean
);

create or replace function match_chat_memory_summaries_hybrid(
  p_room_id text,
  p_query_embedding vector(1536),
  p_query_text text,
  p_alpha double precision default 0.5,
  p_match_count int default 5,
  p_similarity_threshold double precision default 0,
  p_from_ts timestamptz default null,
  p_decay_halflife_hours int default null,
  p_level_filter smallint[] default null,
  p_use_tsv boolean default false
)
returns table (
  id uuid,
  room_id text,
  level smallint,
  chunk_no int,
  summary text,
  created_at timestamptz,
  embedding_similarity double precision,
  lexical_score double precision,
  recency_weight double precision,
  combined_score double precision
)
language sql
volatile
parallel safe
as $$
  with candidates as (
    select
      cms.id,
      cms.room_id::text as room_id,
      cms.level,
      cms.chunk_no,
      cms.summary,
      cms.created_at,
      case
        when cms.embedding is not null and p_query_embedding is not null
          then greatest(1 - (cms.embedding <=> p_query_embedding), 0)::double precision
        else 0::double precision
      end as sem_score,
      case
        when p_use_tsv and cms.summary_tsv is not null then
          coalesce(ts_rank_cd(cms.summary_tsv, websearch_to_tsquery('korean', p_query_text)), 0)::double precision
        else
          greatest(similarity(cms.summary, p_query_text), 0)::double precision
      end as lex_score
    from chat_memory_summaries cms
    where cms.room_id::text = p_room_id::text
      and (p_level_filter is null or cms.level = any(p_level_filter))
      and (p_from_ts is null or cms.created_at >= p_from_ts)
  ),
  scored as (
    select
      candidates.*,
      case
        when p_decay_halflife_hours is null then 1.0
        else power(0.5, extract(epoch from (now() - candidates.created_at))/3600.0 / p_decay_halflife_hours::double precision)
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
    combined.id,
    combined.room_id,
    combined.level,
    combined.chunk_no,
    combined.summary,
    combined.created_at,
    combined.sem_score as embedding_similarity,
    combined.lex_score as lexical_score,
    combined.decay_factor as recency_weight,
    combined.combined_score
  from combined
  order by combined_score desc
  limit p_match_count;
$$;

-- Nudge PostgREST to reload schema
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when undefined_object then
  null;
end
$$;