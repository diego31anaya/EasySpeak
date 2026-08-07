-- Favorites: a per-session star toggle.
-- Additive + safe: NOT NULL with a default backfills every existing row to false,
-- and new sessions are never favorited on creation.
alter table public.sessions
  add column favorite boolean not null default false;

-- Partial index for the "favorites only" filter ("my favorites, newest first").
-- Indexing ONLY favorited rows keeps the index small and that query fast no
-- matter how many total sessions a user accumulates. The general list still uses
-- sessions_user_created_idx; this one is purely for favorite = true.
create index if not exists sessions_user_favorite_created_idx
  on public.sessions (user_id, created_at desc)
  where favorite;