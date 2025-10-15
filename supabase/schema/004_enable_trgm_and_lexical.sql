-- Ensure a 'korean' text search configuration exists; fallback copies 'simple' if not available
DO $$
BEGIN
  CREATE TEXT SEARCH CONFIGURATION korean ( COPY = simple );
EXCEPTION WHEN duplicate_object THEN
  NULL;
END
$$;
-- Enable trigram and lexical search, and extend chat_message_embeddings
-- This migration is additive and safe (IF NOT EXISTS or exception-guarded)

-- Extension: pg_trgm for trigram similarity and GIN trigram ops
create extension if not exists pg_trgm;

-- Columns: additive, guarded with IF NOT EXISTS
alter table if exists chat_message_embeddings
  add column if not exists content_text text,
  add column if not exists role text not null default 'user',
  add column if not exists author_id uuid,
  add column if not exists message_created_at timestamptz not null default now(),
  add column if not exists source_url text,
  add column if not exists chunk_index int not null default 0,
  add column if not exists chunk_count int not null default 1,
  add column if not exists content_tsv tsvector;

-- Backfill content_text from content if present
update chat_message_embeddings
set content_text = coalesce(content_text, content)
where content_text is null and content is not null;

-- Unique key migration: allow multi-chunk per message
-- Attempt to drop a potential existing unique constraint (name may vary)
do $$
begin
  begin
    alter table chat_message_embeddings
      drop constraint chat_message_embeddings_room_id_message_id_key;
  exception
    when undefined_object then null;
  end;
end $$;

-- Drop known unique index variant if it exists
drop index if exists chat_message_embeddings_room_message_uidx;

-- Add new unique constraint on (room_id, message_id, chunk_index)
do $$
begin
  begin
    alter table chat_message_embeddings
      add constraint chat_message_embeddings_room_id_message_id_chunk_index_key
      unique (room_id, message_id, chunk_index);
  exception
    when duplicate_object then null;
  end;
end $$;

-- Indexes to support lexical and filtering queries
create index if not exists idx_cme_content_text_trgm
  on chat_message_embeddings using gin (content_text gin_trgm_ops);

create index if not exists idx_cme_content_tsv
  on chat_message_embeddings using gin (content_tsv);

create index if not exists idx_cme_room_id_role
  on chat_message_embeddings (room_id, role);

-- Optional: precompute tsvector for existing rows
update chat_message_embeddings
set content_tsv = to_tsvector('korean', coalesce(content_text, ''))
where content_text is not null
  and (content_tsv is null or content_tsv = ''::tsvector);

-- Trigger function to keep tsvector in sync
create or replace function cme_update_tsv()
returns trigger
language plpgsql
as $$
begin
  new.content_tsv := to_tsvector('korean', coalesce(new.content_text, ''));
  return new;
end
$$;

-- Replace trigger
drop trigger if exists cme_tsv_update on chat_message_embeddings;
create trigger cme_tsv_update
before insert or update of content_text
on chat_message_embeddings
for each row
execute function cme_update_tsv();
-- Embed metadata columns for observability and compatibility with repository payload
ALTER TABLE chat_message_embeddings
  ADD COLUMN IF NOT EXISTS embedding_provider text,
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS embedding_dim integer,
  ADD COLUMN IF NOT EXISTS embedding_version integer DEFAULT 1;

-- Invalidate PostgREST schema cache so new columns are recognized immediately
DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN undefined_object THEN
  NULL;
END
$$;
-- Ensure author_id can store non-UUID identifiers (e.g., Firebase UID)
ALTER TABLE chat_message_embeddings
  ADD COLUMN IF NOT EXISTS author_id text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'chat_message_embeddings'
      AND column_name = 'author_id'
      AND udt_name = 'uuid'
  ) THEN
    ALTER TABLE chat_message_embeddings
      ALTER COLUMN author_id TYPE text USING author_id::text;
  END IF;
EXCEPTION
  WHEN undefined_table THEN NULL;
END
$$;