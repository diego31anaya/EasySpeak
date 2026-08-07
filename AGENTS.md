# AGENTS.md

Instructions for any AI coding agent (Codex, etc.) working in this repo. This is the maintained
agent handoff and the first source Codex should read for current project rules and decisions.

## What this app is

**EasySpeak** — a React Native (Expo) **iOS** speaking-practice app (solo dev). It records the
user answering a prompt, transcribes it (Deepgram), and scores delivery metrics (pace, filler
words, pauses, intonation) plus AI feedback. Practice modes: **Impromptu**, **3-2-1 / TTO**,
**Explain**, **Storytelling**, **Debate**, **PREP**, and a **Vocabulary** feature (learn words,
describe them in your own words → AI meaning-score). Backend is **Supabase** (auth, `sessions` +
`profiles` + `vocab_words` tables, Storage, and JWT-gated Edge Functions that hold the OpenAI +
Deepgram keys). Pre-launch; not yet on the App Store.

## Agent context and handoffs

`AGENTS.md` is the authoritative, actively-maintained handoff for Codex. Read it before substantive
work and update it after building or changing a feature when the change creates durable context,
an architectural decision, a constraint, a known gap, or an important verification result. Keep
updates concise and current rather than logging every small edit.

`CLAUDE.md` is the legacy detailed project archive from earlier Claude Code work. Consult it when a
task touches architecture, rationale, or a feature documented there, but do not update it for new
Codex work unless the user explicitly asks. When `AGENTS.md` and `CLAUDE.md` disagree about current
state or workflow, `AGENTS.md` wins; verify the live code before relying on either file.

## Current Codex handoff

### TanStack Query migration and cache ownership (2026-08-02)

- Continue moving server-state reads and writes to TanStack Query. Query keys are part of the data
  contract: verify the real key in the consuming screen before invalidating it.
- Successful mutations own cache freshness. Session saves from results screens, renames, favorite
  changes, and deletes must invalidate the affected History prefix:
  `['history', 'sessions', userId]`.
- A completed Vocabulary practice session also affects Vocabulary caches. Preserve the existing
  word-list/latest-session invalidations alongside History invalidation where applicable.
- Once every session mutation path invalidates its affected keys, History should not need a
  navigation-focus refetch. Until that work is complete, returning from a review can leave History
  stale; do not describe the migration as complete.
- Current `history.tsx` uses `useInfiniteQuery` with cursor pagination. Initial failures with no
  cached data use the full-screen error state. Later pagination failures preserve loaded pages,
  block repeated `onEndReached` attempts, and expose a manual retry footer.
- History search is backend-driven over `prompt` and `custom_title`, debounced by 300 ms, included
  in the infinite-query key, and combined with filters and cursor pagination. Search query changes
  keep the search bar mounted while replacing the list with skeletons; search failures retain the
  search bar so the user can retry, edit, or clear the term.

### Vocabulary pagination (2026-08-06)

- Vocabulary uses cursor-based `useInfiniteQuery` with the key
  `['vocab', 'words', userId, 'infinite-v1']`. The existing three-part prefix remains the mutation
  invalidation contract.
- `vocab_words_with_scores(integer, timestamptz, uuid)` owns the cursor predicate and `limit + 1`
  inside the RPC, selecting one page before computing latest-session scores. The client requires
  migration `20260806120000_paginate_vocab_words_with_scores.sql` to be deployed before it runs.

## Where things stand (2026-08-02)

- The worktree contains active user changes. Preserve them, do not treat them as drift, and do not
  commit or push unless asked. The developer pushes manually.
- Full `npx tsc --noEmit` passed on 2026-08-03 after the History search work.
- The current History TanStack Query/filter/pagination work is JS-only and not device-verified.
- The launch plan lives in **`RELEASE_MILESTONES.md`** (M0–M7).

## Working style (these were the dev's stated preferences — honor them)

- **Commit cadence:** the dev commits infrequently and pushes manually. Don't nag about
  committing, and don't treat an uncommitted/dirty tree as drift. Commit/push only when asked.
- **Genuine pushback over agreement.** Challenge copy, UI, and architecture. The dev often
  overrides a suggestion with their own preference after hearing the reasoning — that's the
  intended dynamic.
- **Verify, don't assume.** Read every file a change depends on and trace real behavior before
  acting; confirm claims against the actual code/DB rather than trusting docs or memory. The dev
  edits files between turns — re-read before editing.
- **Consider structural alternatives, not only additive fixes.** Before recommending a helper,
  flag, cache option, or another layer on top of existing code, identify the behavior that must
  remain invariant and check whether restructuring the current component/data flow would solve it
  more directly. Present meaningful alternatives with their tradeoffs and recommend the cleaner
  design even when it requires changing existing code. Do not treat the current structure as fixed.
- **Feature-first, UI-second** for new features: build + `console.log` the logic before wiring UI.
- **Judge performance ONLY on release builds** (`npx expo run:ios --device --configuration
  Release`). Debug RN is dramatically slower on the A12/iPhone XS — debug jank is not real jank. A
  whole session was once burned "fixing" a debug-only stutter that was smooth in release.
- **AI feedback copy must avoid audience framing** — no "audience/listener/the room/you'd win
  them over." The user practices alone to improve generally; judge the response as an object.
- **Copy standards:** plain language, no AI-tells (em-dashes, superlatives, abstract vocab). The
  dev writes their own final user-facing copy and wants critique, not rewrites; placeholder copy
  in code is marked PLACEHOLDER.

## Hard conventions (details in `CLAUDE.md`)

- **The app root is this directory** (`.../EasySpeak/EasySpeak/`), nested one level under the
  outer folder.
- **Navigation:** route cross-zone / cross-step moves through the verbs in `lib/navigation.ts`
  (`enterFlow` / `advanceFlow` / `restartFlow` / `exitFlow` / `backFlow`) — never raw
  `router.push/replace/back`.
- **Schema changes go through Supabase CLI migrations** (`supabase/migrations/*.sql` +
  `supabase db push`), never the dashboard. Anything you filter/sort/aggregate on becomes a real
  column; replay-only detail stays in the `sessions.data` jsonb.
- **`lib/metrics.ts` is pure** (no native/fs imports) so it stays Node-testable — keep it that way.
- Build/run: `npx expo start` hot-reloads JS only; `npx expo run:ios` does a full native build
  (required for any native-module change). `ios/` is CNG/gitignored — `app.json` is the source of
  truth for native config.
