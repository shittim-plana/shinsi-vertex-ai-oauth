-- Memory summaries tables and RPCs for summary-first RAG (HYPA/SUPA)
-- Additive, idempotent (IF NOT EXISTS / guarded)

-- Table: chat_memory_summaries
create table if not exists chat_memory_summaries (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  user_id uuid,
  level smallint not null check (level in (0,1)), -- 0=SUPA, 1=HYPA
  chunk_no integer not null,
  summary text not null,
  token_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  embedding vector(1536),
  summary_tsv tsvector
);

-- Uniqueness for idempotent upserts
do $$
begin
  begin
    alter table chat_memory_summaries
      add constraint chat_memory_summaries_room_level_chunk_unique
      unique (room_id, level, chunk_no);
  exception when duplicate_object then null;
  end;
end $$;

-- Indexes
create index if not exists idx_cms_room_level_chunk
  on chat_memory_summaries (room_id, level, chunk_no desc);

create index if not exists idx_cms_room_created
  on chat_memory_summaries (room_id, created_at desc);

create index if not exists idx_cms_summary_trgm
  on chat_memory_summaries using gin (summary gin_trgm_ops);

create index if not exists idx_cms_summary_tsv
  on chat_memory_summaries using gin (summary_tsv);

create index if not exists idx_cms_embedding_ivfflat
  on chat_memory_summaries using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Initial tsvector backfill
update chat_memory_summaries
set summary_tsv = to_tsvector('korean', coalesce(summary, ''))
where summary is not null
  and (summary_tsv is null or summary_tsv = ''::tsvector);

-- Trigger to maintain summary_tsv
create or replace function cms_update_tsv()
returns trigger
language plpgsql
as $$
begin
  new.summary_tsv := to_tsvector('korean', coalesce(new.summary, ''));
  return new;
end
$$;

drop trigger if exists cms_tsv_update on chat_memory_summaries;
create trigger cms_tsv_update
before insert or update of summary
on chat_memory_summaries
for each row
execute function cms_update_tsv();

-- Table: chat_memory_links (HYPA→SUPA and SUPA→MSG ranges)
create table if not exists chat_memory_links (
  id uuid primary key default gen_random_uuid(),
  parent_summary_id uuid not null references chat_memory_summaries(id) on delete cascade,
  child_summary_id uuid references chat_memory_summaries(id) on delete cascade,
  message_id_from bigint,
  message_id_to bigint,
  message_created_from timestamptz,
  message_created_to timestamptz,
  level_edge smallint not null check (level_edge in (0,1)), -- 0=SUPA→MSG, 1=HYPA→SUPA
  created_at timestamptz not null default now()
);

create index if not exists idx_cml_parent on chat_memory_links(parent_summary_id);
create index if not exists idx_cml_child on chat_memory_links(child_summary_id);
create index if not exists idx_cml_msg_id_range on chat_memory_links(message_id_from, message_id_to);
create index if not exists idx_cml_msg_ts_range on chat_memory_links(message_created_from, message_created_to);

-- Uniqueness across link key without non-immutable expressions
-- Case A: HYPA→SUPA (child_summary_id present)
create unique index if not exists idx_cml_unique_parent_edge_child
on chat_memory_links (parent_summary_id, level_edge, child_summary_id)
where child_summary_id is not null;

-- Case B: SUPA→MSG ranges (child_summary_id absent)
-- Use NULLS NOT DISTINCT (PG15+) so that multiple NULLs are treated as equal in uniqueness.
create unique index if not exists idx_cml_unique_parent_edge_msgrange
on chat_memory_links (parent_summary_id, level_edge, message_id_from, message_id_to, message_created_from, message_created_to) nulls not distinct
where child_summary_id is null;

-- RPC: match_chat_memory_summaries_hybrid
create or replace function match_chat_memory_summaries_hybrid(
  p_room_id uuid,
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
  room_id uuid,
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
      cms.room_id,
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

-- RPC: get_summary_children
create or replace function get_summary_children(
  p_parent_ids uuid[]
)
returns table (
  parent_summary_id uuid,
  child_summary_id uuid,
  level_edge smallint,
  message_id_from bigint,
  message_id_to bigint,
  message_created_from timestamptz,
  message_created_to timestamptz
)
language sql
stable
parallel safe
as $$
  select
    cml.parent_summary_id,
    cml.child_summary_id,
    cml.level_edge,
    cml.message_id_from,
    cml.message_id_to,
    cml.message_created_from,
    cml.message_created_to
  from chat_memory_links cml
  where cml.parent_summary_id = any(p_parent_ids)
$$;

-- Invalidate PostgREST schema cache to expose new RPCs immediately
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when undefined_object then
  null;
end
$$;