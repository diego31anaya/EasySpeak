-- Practice-session history: one row per finished Impromptu or 3-2-1 attempt,
-- plus a private Storage bucket for the recordings.

-- 1. Sessions table -------------------------------------------------------
create table if not exists public.sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  created_at   timestamptz not null default now(),
  mode         text not null check (mode in ('impromptu', 'tto')),
  score        numeric,                      -- impromptu: 1-10; tto: round avg; null if AI feedback failed
  duration_sec numeric not null default 0,
  title        text,                         -- display hint (impromptu prompt); null for tto
  data         jsonb not null                -- full results payload, re-rendered on the detail screen
);

-- The list query is always "my sessions, newest first".
create index if not exists sessions_user_created_idx
  on public.sessions (user_id, created_at desc);

-- 2. Row-Level Security ---------------------------------------------------
alter table public.sessions enable row level security;

create policy "Users manage own sessions"
  on public.sessions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. Storage bucket for recordings ---------------------------------------
-- Private bucket. Object path convention: `{user_id}/{session_id}/<file>.wav`
-- (impromptu: recording.wav; tto: round-0.wav, round-1.wav, round-2.wav).
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

-- Users can only touch objects under their own user-id folder.
-- (storage.foldername(name))[1] is the first path segment — the {user_id}.
create policy "Users read own recordings"
  on storage.objects for select
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users upload own recordings"
  on storage.objects for insert
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users delete own recordings"
  on storage.objects for delete
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
