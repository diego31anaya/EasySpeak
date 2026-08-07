// app/(app)/settings/_layout.tsx
//
// Nested stack INSIDE the Settings modal. The parent (app) layout presents the
// `settings` group with presentation:'modal'; this inner stack then pushes the
// settings list (index) → edit pages as CARDS that slide in from the right *within*
// the modal's bounds — instead of each edit page popping up as its own bottom modal
// (which is what a flat push onto the modal did). Back pops within this stack;
// backing off `index` bubbles up and dismisses the modal.

import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
