-- The "title" column always held the impromptu prompt (null for tto), never a
-- title. Rename it to match reality before adding a real user-editable title.
-- A column rename preserves all existing row data and the column's place in any
-- index (there is no index on this column).
alter table public.sessions rename column title to prompt;