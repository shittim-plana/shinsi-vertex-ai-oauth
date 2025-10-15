-- 009: Convert chat_memory_summaries.room_id from uuid to text for Firestore-style IDs
alter table if exists chat_memory_summaries
  alter column room_id type text using room_id::text;

-- Nudge PostgREST to reload schema
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when undefined_object then
  null;
end
$$;