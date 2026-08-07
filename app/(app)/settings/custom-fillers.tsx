// app/(app)/settings/custom-fillers.tsx
//
// Custom-filler-words config AS A SETTINGS SUB-PAGE: pushed into the Settings modal's
// nested stack, so it slides in from the RIGHT with a back chevron (top-left), like
// edit-info. Same body as the top-level /custom-fillers route (bottom sheet) — see
// components/ProfilePageShell.tsx.

import * as Haptics from 'expo-haptics';

import { backFlow } from '../../../lib/navigation';
import { ProfilePageShell } from '../../../components/ProfilePageShell';
import { CustomFillersEditor } from '../../../components/CustomFillersEditor';

export default function SettingsCustomFillers() {
  const dismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    backFlow();
  };
  return (
    <ProfilePageShell title="Custom filler words" dismissKind="back" onDismiss={dismiss}>
      <CustomFillersEditor />
    </ProfilePageShell>
  );
}