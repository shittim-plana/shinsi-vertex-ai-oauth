-- pgvector 확장 및 임베딩 저장 테이블 초기 스키마
-- 실행 위치: Supabase Dashboard > SQL Editor (코드에서 직접 실행하지 않음)

-- 확장
create extension if not exists vector;

-- 테이블
create table if not exists chat_message_embeddings (
  id uuid primary key default gen_random_uuid(),
  room_id text not null,
  message_id text not null,
  role text not null check (role in ('user','assistant','system','character')),
  content text not null,
  character_id text null,
  user_id text null,
  created_at timestamptz not null default now(),
  embedding vector(1536) not null -- text-embedding-3-small 차원
);

-- 유니크 제약
create unique index if not exists chat_message_embeddings_room_message_uidx
  on chat_message_embeddings (room_id, message_id);

-- 벡터 인덱스 (IVFFlat, cosine)
create index if not exists chat_message_embeddings_embedding_ivfflat_idx
  on chat_message_embeddings using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 조회 최적화 인덱스
create index if not exists chat_message_embeddings_room_created_idx
  on chat_message_embeddings (room_id, created_at);

-- RLS: 기본적으로 off 가정, 서버(Service Role) 경로에서만 접근
-- 운영 상 서비스 롤 키를 통해 서버에서만 접근하도록 유지하십시오.
-- 만약 RLS 를 ON 할 경우(권장), 서비스 역할 전용 정책 예시:
-- alter table chat_message_embeddings enable row level security;
-- create policy "service role only"
--   on chat_message_embeddings
--   for all
--   using (auth.role() = 'service_role')
--   with check (auth.role() = 'service_role');