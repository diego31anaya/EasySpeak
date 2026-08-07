// lib/navigation.ts
//
// EasySpeak navigation model. The app has two zones:
//
//   TAB zone   — Home / Practice. Always the ROOT of the stack.
//   FLOW zone  — focused tasks pushed ON TOP of the tabs: impromptu,
//                tto-explainer, tto-practice, practice, and their *-results.
//
// Screens MUST route cross-zone and cross-step navigation through these four
// verbs instead of calling router.push / replace / back directly. The verb
// names carry the intent; the actual router method and stack-unwinding policy
// live here and nowhere else. That's what keeps the stack honest as we add
// screens (e.g. the "home → home" duplicate-tabs bug came from a flow calling
// router.replace('/') to "go home", which stacks a SECOND tabs instance
// instead of returning to the existing one — exitFlow() is the fix).
//
//   enterFlow(href)    tab → flow            push    (tabs stays under the flow)
//   advanceFlow(href)  flow step → next      replace (no Back into the prior step)
//   restartFlow(href)  results → start over  replace
//   exitFlow()         flow → back to tabs   dismiss every pushed screen
//
// In-zone navigation does NOT go through here: switching tabs is the tab bar's
// job, and paging within a single screen (e.g. the explainer's 4 pages) is
// local component state.

import { router, type Href } from 'expo-router';

/** Tab → flow. Pushes the flow on top of the tab zone so it can be dismissed. */
export function enterFlow(href: Href) {
  router.push(href);
}

/**
 * One flow step → the next (recording → results, explainer → practice).
 * Replaces the current step so the user can't Back into a finished one.
 * Accepts the object form too, e.g. advanceFlow({ pathname, params }).
 */
export function advanceFlow(href: Href) {
  router.replace(href);
}

/** Results → start the same flow over. Replace keeps a single flow screen. */
export function restartFlow(href: Href) {
  router.replace(href);
}

/**
 * Flow → back to the tab zone. Dismisses every screen pushed on top of the
 * tabs, returning to the SAME tabs instance the user left (no duplicate, and
 * it preserves whichever tab was active). canDismiss() guards the cold
 * deep-link case where a flow screen is itself the stack root.
 */
export function exitFlow() {
  if (router.canDismiss()) {
    router.dismissAll();
  } else {
    router.replace('/');
  }
}

/**
 * Flow step → the screen that pushed it (a single pop). For back affordances
 * within the flow zone: a list detail's Back chevron, or a results screen
 * opened in review mode returning to the list it came from. Unlike exitFlow()
 * (which dismisses the WHOLE flow back to the tabs), this pops exactly one.
 */
export function backFlow() {
  router.back();
}