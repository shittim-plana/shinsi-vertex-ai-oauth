-- pgvector 기반 유사도 검색 SQL 함수 (수동 실행)
-- 실행 위치: Supabase Dashboard > SQL Editor (코드에서 직접 실행하지 않음)
-- 목적: room_id 스코프에서 쿼리 임베딩과 유사한 메시지 검색 (IVFFlat 인덱스 활용)
--
-- Params:
--   - room_id text:     채팅방 식별자
--   - query_embedding:  vector(1536) — text-embedding-3-small 기준
--   - match_count int:  반환할 최대 개수 (기본 8)
--   - similarity_threshold float:  최소 유사도 (기본 0.75), 1 - 거리(cosine distance)
--
-- Returns:
--   (id uuid, room_id text, message_id text, role text, content text, character_id text, user_id text, created_at timestamptz, similarity float)

create or replace function match_chat_messages(
  room_id text,
  query_embedding vector(1536),
  match_count int default 8,
  similarity_threshold float default 0.75
)
returns table (
  id uuid,
  room_id text,
  message_id text,
  role text,
  content text,
  character_id text,
  user_id text,
  created_at timestamptz,
  similarity float
)
language sql
stable
as $func$
  select
    cme.id,
    cme.room_id,
    cme.message_id,
    cme.role,
    cme.content,
    cme.character_id,
    cme.user_id,
    cme.created_at,
    1 - (cme.embedding <=> query_embedding) as similarity
  from chat_message_embeddings cme
  where cme.room_id = match_chat_messages.room_id
    and cme.embedding is not null
    and (1 - (cme.embedding <=> query_embedding)) >= similarity_threshold
  order by cme.embedding <=> query_embedding -- IVFFlat 인덱스 사용
  limit greatest(1, match_count);
$func$;

comment on function match_chat_messages(text, vector, int, float)
is 'Chat message semantic retrieval using pgvector IVFFlat; returns rows ordered by cosine distance with similarity = 1 - distance';