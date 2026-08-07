// app/(app)/settings/practice-focus.tsx
//
// "What you're working on" (focus) config AS A SETTINGS SUB-PAGE: pushed into the
// Settings modal's nested stack, so it slides in from the RIGHT with a back chevron
// (top-left), like edit-info. Same body as the top-level /practice-focus route
// (bottom sheet) — see components/ProfilePageShell.tsx. Title kept short ("Focus")
// since "What you're working on" overflows the centered header.

import * as Haptics from 'expo-haptics';

import { backFlow } from '../../../lib/navigation';
import { ProfilePageShell } from '../../../components/ProfilePageShell';
import { FocusEditor } from '../../../components/FocusEditor';

export default function SettingsPracticeFocus() {
  const dismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    backFlow();
  };
  return (
    <ProfilePageShell title="Focus" dismissKind="back" onDismiss={dismiss}>
      <FocusEditor />
    </ProfilePageShell>
  );
}