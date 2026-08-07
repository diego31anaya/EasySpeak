-- Per-user pace target (ideal words-per-minute band). Two scalar columns rather
-- than an array/range: the bounds are distinct named values, the CHECK enforces a
-- valid (ascending) range at the source so an inverted band can never reach the
-- pace math (computePace / paceWpmStatus), and they drop-in-replace the existing
-- PACE_IDEAL_LOW/PACE_IDEAL_HIGH constants. NOT NULL + defaults 130/160 backfill
-- every existing row to today's built-in band. No index: nothing filters/sorts on
-- it. RLS unchanged — the existing own-row profiles policies cover both columns.
alter table public.profiles
  add column pace_target_low  int not null default 130,
  add column pace_target_high int not null default 160,
  add constraint pace_target_range_chk
    check (pace_target_low < pace_target_high);