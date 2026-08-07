# EasySpeak — Release Milestones

The path from "feature-complete" to the App Store. Feature work is largely done; what remains is
launch-readiness (device QA, copy, AI calibration, dev-strip, release config, legal, submit).
Milestone names align to the roadmap in `CLAUDE.md` (the "LAUNCH ROADMAP" line). Status as of
2026-07-10.

## Scope decisions still open (the dev's call — they resize the milestones below)

1. **Intonation row** — the contour graph is hidden, but the Monotone/Dynamic verdict row still
   renders on all 6 results/review screens, driven by a YIN detector never run on device. Hide the
   row for v1 (one-line gate, matches the graph deferral) OR verify YIN on a release build.
2. **How many modes ship in v1** — 7 practice surfaces (Impromptu, 3-2-1, Explain, Storytelling,
   Debate, PREP, Vocabulary), each with placeholder copy + an uncalibrated rubric + zero device QA.
   Trim to a tight core, or ship all 7 and pay the QA/copy cost?

## M0 — Version-control hygiene ✅ DONE (2026-07-10)

All session work committed on `main` in logical commits; `tsc` clean. `main` is **local only**
(ahead of `origin/main`) — dev pushes manually.

## M1 — Backend (Edge Functions + RPCs) ✅ DONE (deployment)

All Edge Functions (`openai-chat` / `openai-tts` / `transcribe` / `delete-account`) and RPCs
(`lesson_scores`, `metric_trends`, `session_stats`, `metric_trends_all_time`,
`vocab_words_with_scores`) are deployed + JWT-gated; all migrations pushed (incl.
`20260709120000` definition_source). **The only leftover is verifying the authenticated live
round-trip on a running app → folds into M3.**

## M2 — Production email + auth hardening (non-device; gates M3 auth QA)

- Resend + a ~$10/yr domain → Supabase custom SMTP (built-in mailer is ~2–3/hr; drops real
  signup/reset codes).
- Enable Supabase **Secure password change** (today a live session can change the password with no
  reauth).
- Kill the email-enumeration oracles + add a client-side email-format check.

## M3 — On-device QA on a RELEASE build (biggest bucket — all device-dependent)

- **Prerequisite: native rebuild.** `expo-speech`, `expo-notifications`, the native datetime
  picker, and `expo-pitch`/YIN don't exist in the current JS build; YIN Swift compiles for the
  first time and runs in every finalize path.
- Verify the M1 edge-function round-trip (impromptu + TTO end to end).
- All practice modes: record → analyze → results → save → History → review, with **real-mic**
  metric accuracy. Includes the four exercise modes + PREP + the new Explain generated-topic flow.
- **Full Vocabulary loop**, incl. the `definition_source` branches, `getLatestVocabSession`, and
  all 6 bottom-sheet drags + keyboard compensation.
- **Everything redesigned recently is 100% unverified:** the Profile chart + chip row + range
  sheet + selected-session card, the skeleton, streak animations, reminders firing, the 3 editors.
- **Mic-permission denial path** (all 7 modes → Settings deep-link) — native, needs a device pass.
- Auth device checklist (gated on M2).
- **AI calibration:** read real `reasoning` / `[AI Prompt]` logs and tune every rubric. ⚠️ Do the
  small `lib/vocab-feedback.ts` reasoning-log fix FIRST (still discarded → the 3 definition-source
  branches are unobservable).

## M4 — Website + hosted legal + wire in-app links (gates M7 submission)

Fill `[DEVELOPER LEGAL NAME]` / `[CONTACT EMAIL]` / `[EFFECTIVE DATE]` in `PRIVACY_POLICY.md` +
`TERMS_OF_SERVICE.md`; host them; wire the two dead Settings rows (`onPress={() => {}}`). The App
Store requires a reachable privacy URL.

## M5 — Finalize placeholder copy

~150 PLACEHOLDER markers across the app (Home taglines, exercise setup screens, PREP explainer,
Streaks modal, Settings, reminders, History empty states, Vocab, focus labels, the new
Explain generator prompt/fallbacks) + every rubric's few-shots (overlaps M3 calibration).

## M6 — Strip dev surfaces + release config

- ✅ Placeholder tab removed (2026-07-10).
- Delete the now-orphaned `lib/dev-streak.ts` + `lib/dev-test-sessions.ts`; extract the
  `dev-cache-*` imports + `if (__DEV__)` blocks from `impromptu.tsx` / `tto-practice.tsx`.
- Strip the ~39 `console.log`s (keep the calibration logs until M3 calibration is done).
- Real **bundle ID** (`com.anonymous.EasySpeak` → owned reverse-domain) + re-prebuild; final app
  icon (current 1024 is a WIP export); App Store **App Privacy** disclosure + fix
  `PrivacyInfo.xcprivacy`; hide/wire the dead Email-change Settings row.

## M7 — TestFlight → submit

Distribution signing → App Store Connect record → metadata + screenshots → archive/upload →
TestFlight → submit.

---

**Critical path** (build & QA the shippable binary once): M0 ✅ → cheap pre-build code (vocab
reasoning-log, delete orphaned dev files, real bundle id + icon) → **in parallel** stand up M2
email + M4 website/legal + grind M5 copy → cut ONE native release build → run all of M3 (device QA
+ calibration + auth) → fix findings → finish M6 disclosures + log strip → M7.